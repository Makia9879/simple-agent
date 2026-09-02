import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { apiProxy } from './vite.proxy';

export default defineConfig(({ mode }) => {
 const env = loadEnv(mode, process.cwd(), '');
 const proxy = apiProxy(env);

 return {
  plugins: [sveltekit()],
  server: { proxy },
  preview: { proxy },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
 };
});
