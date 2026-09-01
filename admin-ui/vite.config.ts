import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const securityHeaders = {
  // F9: 页面侧可验证的 CSP 与安全响应头。
  // 说明：开发态允许 'unsafe-inline' 样式（Ant Design Vue 的 cssinjs 运行时注入 <style>）。
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    headers: securityHeaders,
  },
  preview: {
    port: 5175,
    strictPort: false,
    headers: securityHeaders,
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
