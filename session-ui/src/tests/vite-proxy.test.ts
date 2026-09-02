import { describe, expect, it } from 'vitest';
import { apiProxy } from '../../vite.proxy';

describe('Vite API proxy', () => {
 it('does not configure a proxy while the independent mock is enabled', () => {
  expect(apiProxy({})).toBeUndefined();
  expect(apiProxy({ VITE_USE_MOCK: 'true' })).toBeUndefined();
 });

 it('proxies /api to the local backend by default in real API mode', () => {
  expect(apiProxy({ VITE_USE_MOCK: 'false' })).toEqual({
   '/api': { target: 'http://localhost:8080', changeOrigin: true }
  });
 });

 it('uses VITE_PROXY_TARGET when a real API target is configured', () => {
  expect(apiProxy({ VITE_USE_MOCK: 'false', VITE_PROXY_TARGET: 'http://core-api:8888' })).toEqual({
   '/api': { target: 'http://core-api:8888', changeOrigin: true }
  });
 });
});
