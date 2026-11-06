import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design-system/global.css';
import App from './app/App';
import { AppProvider } from './app/AppContext';
import { startDevicePreferences } from './app/devicePreferences';
import { loadRuntime } from './app/runtime';

startDevicePreferences();
// top-level await は使わない。入口のファイルが待っている間に、後から読む部品（runtime.mock など）が入口のファイルを読もうとすると、互いに待ち続ける。
void loadRuntime().then((runtime) => createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider runtime={runtime}><App/></AppProvider></StrictMode>));

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => window.dispatchEvent(new Event('family-hub-update-available')));
    }).catch(() => undefined);
  });
}
