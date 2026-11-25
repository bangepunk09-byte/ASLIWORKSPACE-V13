import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';

import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
];

const loginProvider = new GoogleAuthProvider();
loginProvider.addScope('email');
loginProvider.addScope('profile');
loginProvider.setCustomParameters({ prompt: 'select_account' });

const provider = new GoogleAuthProvider();
provider.addScope('email');
provider.addScope('profile');
provider.addScope('https://www.googleapis.com/auth/calendar.events');
provider.setCustomParameters({ prompt: 'consent select_account' });

const gmailProvider = new GoogleAuthProvider();
gmailProvider.addScope('email');
gmailProvider.addScope('profile');
gmailProvider.addScope('https://www.googleapis.com/auth/gmail.send');
gmailProvider.setCustomParameters({ prompt: 'consent select_account' });

let isSigningIn = false;
const calendarAuthByUid = new Map();
let cachedGmailAccessToken = null;
let hasGmailScope = false;

function getActiveWorkspaceUserId() {
  try {
    const raw =
      sessionStorage.getItem('circle_tab_session_cache') ||
      localStorage.getItem('circle_session_cache');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user?.user_id) return String(parsed.user.user_id);
    }
  } catch {}
  return 'default';
}

function getScopedCalendarRecord(uid = getActiveWorkspaceUserId()) {
  if (calendarAuthByUid.has(uid)) {
    return calendarAuthByUid.get(uid);
  }
  try {
    const raw = sessionStorage.getItem(`circle_gcal_auth_${uid}`) || localStorage.getItem(`circle_gcal_auth_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.accessToken) {
        calendarAuthByUid.set(uid, parsed);
        return parsed;
      }
    }
  } catch {}
  return null;
}

function setScopedCalendarRecord(uid, record) {
  if (!uid) return;
  if (!record) {
    calendarAuthByUid.delete(uid);
    try {
      sessionStorage.removeItem(`circle_gcal_auth_${uid}`);
      localStorage.removeItem(`circle_gcal_auth_${uid}`);
    } catch {}
    return;
  }
  calendarAuthByUid.set(uid, record);
  try {
    const serialized = JSON.stringify(record);
    sessionStorage.setItem(`circle_gcal_auth_${uid}`, serialized);
    localStorage.setItem(`circle_gcal_auth_${uid}`, serialized);
  } catch {}
}

export const initAuth = (onAuthSuccess, onAuthFailure) => {
  return onAuthStateChanged(auth, async (user) => {
    const rec = getScopedCalendarRecord();
    if (rec?.accessToken) {
      if (onAuthSuccess) onAuthSuccess({ email: rec.email || user?.email || '' }, rec.accessToken);
    } else if (!isSigningIn) {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const setManualGoogleAuth = (userObj = {}, token = null) => {
  const uid = userObj.user_id || getActiveWorkspaceUserId();
  const realToken =
    typeof token === 'string' && token.trim() && !token.startsWith('gcal_workspace_sync_')
      ? token.trim()
      : null;
  const userRecord = {
    email: userObj.email || '',
    displayName: userObj.name || userObj.displayName || 'Workspace User',
    photoURL: userObj.picture || userObj.avatar || '',
    accessToken: realToken,
  };
  if (realToken) {
    setScopedCalendarRecord(uid, userRecord);
  }
  return { user: userRecord, accessToken: realToken };
};

export const clearCalendarAuth = (uid = getActiveWorkspaceUserId()) => {
  setScopedCalendarRecord(uid, null);
  try {
    localStorage.removeItem('circle_google_access_token');
    localStorage.removeItem('circle_google_user');
    sessionStorage.removeItem('circle_google_access_token');
  } catch {}
};

async function runPopupSignIn(targetProvider, { withCalendarScope = false, withGmailScope = false } = {}) {
  try {
    isSigningIn = true;
    const uid = getActiveWorkspaceUserId();
    const result = await signInWithPopup(auth, targetProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const realToken = credential?.accessToken || null;
    if (withCalendarScope) {
      if (!realToken) {
        throw new Error('Token akses Google Calendar tidak diterima dari popup OAuth.');
      }
      setScopedCalendarRecord(uid, {
        accessToken: realToken,
        email: result.user?.email || '',
        displayName: result.user?.displayName || '',
        photoURL: result.user?.photoURL || '',
        connectedAt: new Date().toISOString(),
      });
    }
    if (withGmailScope) {
      if (!realToken) {
        throw new Error('Token akses Gmail tidak diterima dari popup OAuth.');
      }
      cachedGmailAccessToken = realToken;
      hasGmailScope = true;
    }
    return {
      user: result.user,
      accessToken: realToken,
      isRealOAuth: Boolean(realToken),
    };
  } catch (error) {
    console.warn('Google popup sign-in note:', error?.code || error?.message);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

export const googleBasicSignIn = () => runPopupSignIn(loginProvider);

export const googleSignIn = () => runPopupSignIn(loginProvider);

export const googleCalendarOAuthSignIn = () => runPopupSignIn(provider, { withCalendarScope: true });

export const googleGmailOAuthSignIn = () => runPopupSignIn(gmailProvider, { withGmailScope: true });

export const getAccessToken = async (uid = getActiveWorkspaceUserId()) => {
  const rec = getScopedCalendarRecord(uid);
  return rec?.accessToken || null;
};

export const getGmailAccessToken = async () => {
  if (cachedGmailAccessToken && hasGmailScope) return cachedGmailAccessToken;
  return null;
};

export const clearGmailAuth = () => {
  cachedGmailAccessToken = null;
  hasGmailScope = false;
};

export const hasAccessToken = (uid = getActiveWorkspaceUserId()) => {
  const rec = getScopedCalendarRecord(uid);
  return Boolean(rec?.accessToken);
};

export const getConnectedCalendarEmail = (uid = getActiveWorkspaceUserId()) => {
  const rec = getScopedCalendarRecord(uid);
  return rec?.email || '';
};

export const logout = async () => {
  const uid = getActiveWorkspaceUserId();
  cachedGmailAccessToken = null;
  hasGmailScope = false;
  clearCalendarAuth(uid);
};

