import type { ProxyOptions } from 'vite';

/**
 * Keeps browser requests same-origin in real API mode so development cookies
 * work without exposing a backend address to the SPA.
 */
export function apiProxy(env: Record<string, string | undefined>): Record<string, ProxyOptions> | undefined {
  if (env.VITE_USE_MOCK !== 'false') return undefined;

  return {
    '/api': {
      target: env.VITE_PROXY_TARGET || 'http://localhost:8080',
      changeOrigin: true
    }
  };
}
