import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // [09/07/2026 - Alexandre Carvalho] DEV LOCAL: /api -> Fastify :3020 (em prod o Caddy faz handle_path; rotas Fastify nao tem prefixo /api)
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3020', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') }
    }
  },
  build:  { outDir: 'dist', sourcemap: false }
});
