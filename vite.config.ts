import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The UI is served by Vite; the PTY/ACP server is a separate Node process on
 * 5177. Only the browser half is bundled here — src/server never enters the
 * client graph (it imports node-pty, which has no browser build).
 */
export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5177', changeOrigin: true },
      '/pty': { target: 'ws://127.0.0.1:5177', ws: true },
    },
  },
  build: { outDir: 'dist/web' },
  plugins: [react()],
});
