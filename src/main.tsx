import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SettingsProvider } from './contexts/SettingsContext';
import ErrorBoundary from './components/ErrorBoundary';

// The generated service worker activates updated offline bundles immediately.
// A controlled page still needs to reload once before its JavaScript changes,
// so listen for that hand-off and periodically ask for an update while online.
// First-time installs do not reload.
if ('serviceWorker' in navigator) {
  const hadControllerAtBoot = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtBoot || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  const checkForAppUpdate = () => {
    if (!navigator.onLine) return;
    navigator.serviceWorker.getRegistration()
      .then(registration => registration?.update())
      .catch(error => console.warn('Could not check for an app update:', error));
  };

  window.addEventListener('load', checkForAppUpdate);
  window.addEventListener('online', checkForAppUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForAppUpdate();
  });
  window.setInterval(checkForAppUpdate, 60 * 60 * 1000);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </SettingsProvider>
  </StrictMode>,
);
