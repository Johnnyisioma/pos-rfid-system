import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import { registerServiceWorker } from './lib/offline.js';
import { isNative } from './lib/platform.js';
import './index.css';

/**
 * Path routing on the web, hash routing in the APK.
 *
 * The Android build ships with relative asset paths (base: './'), which only
 * resolve correctly from the document root. A path route two levels deep —
 * /products/41 — would send the WebView looking for /products/assets/index.js.
 * Hashes keep every route at the root as far as the loader is concerned.
 */
const Router = isNative() ? HashRouter : BrowserRouter;

// The service worker is the PWA's offline story. In the APK the whole bundle is
// already on the device, so registering one there just adds a second cache that
// can go stale independently of the app.
if (!isNative()) registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </Router>
  </React.StrictMode>
);
