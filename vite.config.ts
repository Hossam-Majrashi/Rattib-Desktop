import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name: 'rattib-dev-csp', apply: 'serve',
    transformIndexHtml: html => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';").replace("connect-src 'self';", "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173;")
  }],
  base: './', server: { port: 5173, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true }
});
