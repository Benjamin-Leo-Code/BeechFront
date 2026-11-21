import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // Relative asset paths: HA ingress serves us under /api/hassio_ingress/<token>/
  base: './',
  plugins: [react()],
  // The House Plan page's three.js chunk is ~730 kB (190 kB gzipped) and only loads on that page.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.PORT || 8484}` },
  },
});
