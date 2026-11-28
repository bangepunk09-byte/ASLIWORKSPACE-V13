import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Component, Suspense, lazy, useEffect, useRef, useState } from "react";
import { Toaster } from "./components/ui/sonner";
import { AppProvider, useApp } from "./context/AppContext";
import Shell from "./components/Shell";
import { Spinner } from "./components/common";
import { routeLoaders } from "./lib/routePreload";
import { isValidRoomSlug, roomStorageKey } from "./lib/roomContext";

import Dashboard from "./pages/Dashboard";
import Beranda from "./pages/Beranda";
import Employees from "./pages/Employees";
import Messages from "./pages/Messages";
import Tasks from "./pages/Tasks";
import Projects from "./pages/Projects";
import EmployeeArchives from "./pages/EmployeeArchives";

const Login = lazy(routeLoaders["/login"]);
const PlatformOwnerConsole = lazy(routeLoaders["/platform-owner"]);
const Groups = lazy(routeLoaders["/groups"]);
const Directory = lazy(routeLoaders["/directory"]);
const Profile = lazy(routeLoaders["/people"]);
const Org = lazy(routeLoaders["/org"]);
const Settings = lazy(routeLoaders["/settings"]);
const Onboarding = lazy(routeLoaders["/onboarding"]);
const Schedule = lazy(routeLoaders["/schedule"]);
const Marketplace = lazy(routeLoaders["/marketplace"]);
const NotificationList = lazy(() =>
  import("./components/NotificationPanel").then((m) => ({ default: m.NotificationList }))
);

function RouteFallback() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(id);
  }, []);
  if (!visible) return <div className="min-h-[50vh]" />;
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
    </div>
  );
}

function ErrorFallback({ onReload }) {
  const { t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-ink">
      <p className="text-base font-bold">{tr("err_page_title", "Terjadi kendala saat memuat halaman.")}</p>
      <button
        type="button"
        onClick={onReload}
        className="btn-accent h-10 px-5 text-xs font-bold"
      >
        {tr("err_reload_btn", "Muat Ulang Halaman")}
      </button>
    </div>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          onReload={() => {
            this.setState({ hasError: false });
            window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}

function AuthCallback() {
  const done = useRef(false);
  const navigate = useNavigate();
  const { setSession, t } = useApp();
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    setSession(null);
    navigate("/login", { replace: true });
  }, [navigate, setSession]);
  return <Spinner label={t("err_signing_in", "Signing you in")} />;
}

function Protected({ children }) {
  const { session, t } = useApp();
  if (session === undefined) return <Spinner label={t("err_loading_circle", "Loading ASLIWORKSPACE")} />;
  if (!session?.user?.user_id) return <Navigate to="/login" replace />;
  if (session.user?.needs_onboarding) {
    return (
      <Suspense fallback={<Spinner label={t("err_loading_page", "Memuat halaman")} />}>
        <Onboarding />
      </Suspense>
    );
  }
  return children;
}

function RoomProtected({ children }) {
  const { slug } = useParams();
  const { session, currentRoomSlug, enterRoomSession, t } = useApp();
  const cleanSlug = isValidRoomSlug(slug) ? slug : "asli-workspace";
  const [switching, setSwitching] = useState(() => cleanSlug !== currentRoomSlug);

  useEffect(() => {
    if (cleanSlug === currentRoomSlug) {
      setSwitching(false);
      return;
    }
    setSwitching(true);
    try {
      const raw =
        sessionStorage.getItem(roomStorageKey("circle_tab_session_cache", cleanSlug)) ||
        localStorage.getItem(roomStorageKey("circle_session_cache", cleanSlug));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.user?.user_id) {
          enterRoomSession(cleanSlug, parsed);
          setSwitching(false);
          return;
        }
      }
    } catch {}
    setSwitching(false);
  }, [cleanSlug, currentRoomSlug, enterRoomSession]);

  if (switching || session === undefined) {
    return <Spinner label={t("err_loading_circle", "Memuat Workspace Room")} />;
  }
  if (!session?.user?.user_id || cleanSlug !== currentRoomSlug) {
    return <Navigate to={`/w/${cleanSlug}/login`} replace />;
  }
  if (session.user?.needs_onboarding) {
    return (
      <Suspense fallback={<Spinner label={t("err_loading_page", "Memuat halaman")} />}>
        <Onboarding />
      </Suspense>
    );
  }
  return children;
}

function LazyPage({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

const workspaceChildRoutes = (
  <>
    <Route index element={<Dashboard />} />
    <Route path="beranda" element={<Beranda />} />
    <Route path="beranda/:pid" element={<Beranda />} />
    <Route path="messages" element={<Messages />} />
    <Route path="messages/:cid" element={<Messages />} />
    <Route path="groups" element={<LazyPage><Groups /></LazyPage>} />
    <Route path="directory" element={<LazyPage><Directory /></LazyPage>} />
    <Route path="employee" element={<Employees />} />
    <Route path="people" element={<Employees />} />
    <Route path="people/:uid" element={<LazyPage><Profile /></LazyPage>} />
    <Route path="org" element={<LazyPage><Org /></LazyPage>} />
    <Route path="tasks" element={<Tasks />} />
    <Route path="schedule" element={<LazyPage><Schedule /></LazyPage>} />
    <Route path="projects" element={<Projects />} />
    <Route path="projects/:pid" element={<Projects />} />
    <Route path="marketplace" element={<LazyPage><Marketplace /></LazyPage>} />
    <Route path="marketplace/:itemId" element={<LazyPage><Marketplace /></LazyPage>} />
    <Route
      path="notifications"
      element={
        <LazyPage>
          <div className="h-[calc(100dvh-7.5rem)] bg-surface md:h-screen">
            <NotificationList />
          </div>
        </LazyPage>
      }
    />
    <Route path="archives" element={<LazyPage><EmployeeArchives /></LazyPage>} />
    <Route path="settings" element={<LazyPage><Settings /></LazyPage>} />
  </>
);

function Router() {
  const location = useLocation();
  const { t } = useApp();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<Spinner label={t("err_loading_page", "Memuat halaman")} />}>
            <Login />
          </Suspense>
        }
      />
      <Route
        path="/w/:slug/login"
        element={
          <Suspense fallback={<Spinner label={t("err_loading_page", "Memuat halaman")} />}>
            <Login />
          </Suspense>
        }
      />
      <Route
        path="/platform-owner"
        element={
          <Suspense fallback={<Spinner label={t("err_loading_page", "Memuat Console Owner")} />}>
            <PlatformOwnerConsole />
          </Suspense>
        }
      />
      <Route path="/w/:slug" element={<RoomProtected><Shell /></RoomProtected>}>
        {workspaceChildRoutes}
      </Route>
      <Route path="/" element={<Protected><Shell /></Protected>}>
        {workspaceChildRoutes}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PWANavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const onNav = (e) => {
      const url = e?.detail?.url;
      if (url && typeof url === "string") {
        navigate(url);
      }
    };
    window.addEventListener("circle:navigate", onNav);
    return () => window.removeEventListener("circle:navigate", onNav);
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <AppProvider>
      <AppErrorBoundary>
        <BrowserRouter>
          <PWANavigationBridge />
          <Router />
        </BrowserRouter>
      </AppErrorBoundary>
      <Toaster position="top-center" richColors closeButton />
    </AppProvider>
  );
}
