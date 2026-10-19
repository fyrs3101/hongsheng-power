import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome110',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
