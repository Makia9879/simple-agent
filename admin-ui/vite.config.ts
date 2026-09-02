import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { loadEnv } from 'vite';
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMock = env.VITE_USE_MOCK !== 'false';
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8080';

  return {
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
      // 真实后端（VITE_USE_MOCK=false）：Core API 无 CORS 头、Cookie 固定在 /api/v1 路径，
      // 开发态必须同源 —— 由 Vite 把 /api 代理到 VITE_PROXY_TARGET（默认 localhost:8080）。
      // mock 模式不配置代理，请求由 MSW Service Worker 拦截。
      ...(useMock
        ? {}
        : {
            proxy: {
              '/api': {
                target: proxyTarget,
                changeOrigin: false,
              },
            },
          }),
    },
    preview: {
      port: 5175,
      strictPort: false,
      headers: securityHeaders,
      ...(useMock
        ? {}
        : {
            proxy: {
              '/api': {
                target: proxyTarget,
                changeOrigin: false,
              },
            },
          }),
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
  };
});
