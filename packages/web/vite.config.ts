import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const masterPort = process.env.PORT || process.env.MASTER_PORT || '3005';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${masterPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${masterPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
