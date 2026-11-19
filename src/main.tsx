import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './index.css';

try {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSW(true);
    },
  });
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const lastReload = Number(sessionStorage.getItem('circle_sw_reload_ts') || '0');
        if (Date.now() - lastReload > 10000) {
          sessionStorage.setItem('circle_sw_reload_ts', String(Date.now()));
          window.location.reload();
        }
      } catch {}
    });
  }
} catch {}

createRoot(document.getElementById('root')!).render(<App />);

