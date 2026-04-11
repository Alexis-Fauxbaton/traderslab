import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: 'all',
    proxy: {
      '/auth': 'http://localhost:8000',
      '/strategies': 'http://localhost:8000',
      '/variants': 'http://localhost:8000',
      '/runs': 'http://localhost:8000',
      '/compare': 'http://localhost:8000',
      '/analysis': 'http://localhost:8000',
      '/mt5': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('chart.js') || id.includes('react-chartjs-2') || id.includes('chartjs-plugin-zoom')) return 'chart';
          if (id.includes('vis-network') || id.includes('vis-data')) return 'vis';
        },
      },
    },
  },
});
