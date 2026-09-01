/**
 * 路由守卫测试（AU-01 / AUTH-02）：未登录跳登录页；普通用户直接输 URL 也进不了管理页。
 */
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { setupRouterGuard } from './index';
import { useAuthStore } from '@/stores/auth';

function buildRouter(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: { template: '<div>login</div>' } },
      { path: '/403', component: { template: '<div>403</div>' } },
      {
        path: '/users',
        component: { template: '<div>users</div>' },
      },
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
    ],
  });
  setupRouterGuard(router);
  return router;
}

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('未登录访问管理页跳转登录页并保留回跳地址', async () => {
    const router = buildRouter();
    const auth = useAuthStore();
    auth.$patch({ user: null, ready: true });

    await router.push('/users');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/users');
  });

  it('普通用户（role=user）直接访问管理页被拦到 403', async () => {
    const router = buildRouter();
    const auth = useAuthStore();
    auth.$patch({
      user: { id: 'u_alice', username: 'alice', role: 'user' },
      ready: true,
    });

    await router.push('/dashboard');
    expect(router.currentRoute.value.path).toBe('/403');
    await router.push('/users');
    expect(router.currentRoute.value.path).toBe('/403');
  });

  it('管理员可正常进入管理页', async () => {
    const router = buildRouter();
    const auth = useAuthStore();
    auth.$patch({
      user: { id: 'u_admin', username: 'admin', role: 'admin' },
      ready: true,
    });

    await router.push('/users');
    expect(router.currentRoute.value.path).toBe('/users');
  });

  it('已登录普通用户访问登录页跳到 403；管理员跳到仪表盘', async () => {
    const router = buildRouter();
    const auth = useAuthStore();
    auth.$patch({
      user: { id: 'u_alice', username: 'alice', role: 'user' },
      ready: true,
    });
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/403');

    auth.$patch({
      user: { id: 'u_admin', username: 'admin', role: 'admin' },
      ready: true,
    });
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });
});
