import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two targets from one source tree.
 *
 * Web  — absolute asset paths from '/', because the server hands out the same
 *        index.html for every route and the browser resolves assets from the
 *        document root regardless of how deep the URL is.
 * APK  — relative paths, because Capacitor serves the bundle from inside the
 *        app and there is no server to rewrite anything. Built with
 *        `npm run build:android`, which sets POS_TARGET=android.
 */
const ANDROID = process.env.POS_TARGET === 'android';

export default defineConfig({
  base: ANDROID ? './' : '/',
  define: { __POS_TARGET__: JSON.stringify(ANDROID ? 'android' : 'web') },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
