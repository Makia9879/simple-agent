/**
 * 路由与守卫（AU-01 / AUTH-02）：
 * - 未登录访问管理页 → 跳转登录页并带回跳地址；
 * - 普通用户即使直接输入 URL 也进不了管理页 → 403 无权限页。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import { useAuthStore } from '@/stores/auth';

export function setupRouterGuard(router: ReturnType<typeof createRouter>): void {
  router.beforeEach(async (to) => {
    const auth = useAuthStore();

    if (to.path === '/login') {
      if (auth.isAuthenticated) {
        return auth.isAdmin ? { path: '/dashboard' } : { path: '/403' };
      }
      return true;
    }

    await auth.ensureReady();

    if (!auth.isAuthenticated) {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    // 已登录用户可访问 403 / 404；其余管理页仅管理员可进（AU-01）
    if (to.path === '/403' || to.name === 'not-found') {
      return true;
    }
    if (!auth.isAdmin) {
      return { path: '/403' };
    }
    return true;
  });
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/views/ForbiddenView.vue'),
    meta: { title: '无权限' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '仪表盘' },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/UsersView.vue'),
        meta: { title: '用户管理' },
      },
      {
        path: 'groups',
        name: 'groups',
        component: () => import('@/views/GroupsView.vue'),
        meta: { title: '用户组管理' },
      },
      {
        path: 'providers',
        name: 'providers',
        component: () => import('@/views/ProvidersView.vue'),
        meta: { title: 'Provider 登记' },
      },
      {
        path: 'models',
        name: 'models',
        component: () => import('@/views/ModelsView.vue'),
        meta: { title: 'Model 与授权' },
      },
      {
        path: 'usage',
        name: 'usage',
        component: () => import('@/views/UsageView.vue'),
        meta: { title: '全局用量' },
      },
      {
        path: 'conversations',
        name: 'conversations',
        component: () => import('@/views/ConversationsView.vue'),
        meta: { title: '会话审阅' },
      },
      {
        path: 'audit',
        name: 'audit',
        component: () => import('@/views/AuditView.vue'),
        meta: { title: '审计日志' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

setupRouterGuard(router);

export default router;
