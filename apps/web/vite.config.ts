import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.VITE_BASE ?? '/';
const normalizedBase = base.endsWith('/') ? base : `${base}/`;
const apiTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3000';

const proxy: Record<
  string,
  {
    target: string;
    changeOrigin: boolean;
    rewrite?: (path: string) => string;
  }
> = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
};

// Mounting the app under /tool/music/ also moves its API base to
// /tool/music/api. Keep the dev proxy in sync with the production subpath.
if (normalizedBase !== '/') {
  proxy[`${normalizedBase}api`] = {
    target: apiTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(`${normalizedBase}api`, '/api'),
  };
}

export default defineConfig({
  base: normalizedBase,
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
});
