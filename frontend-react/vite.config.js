import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/strategies': 'http://localhost:8000',
      '/variants': 'http://localhost:8000',
      '/runs': 'http://localhost:8000',
      '/compare': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
