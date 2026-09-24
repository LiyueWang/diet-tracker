import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Tailwind v4 走 Vite 插件编译，不需要 postcss.config
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 前端只认 /api 前缀：AI 调用必须经本地代理转发，避免密钥进入前端
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
