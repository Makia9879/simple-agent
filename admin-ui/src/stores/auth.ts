/**
 * 角色与登录态（AU-01 / AUTH-02）：
 * - 仅管理员可进入后台；普通用户登录成功后也会被守卫拦截到无权限页。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import * as authApi from '@/api/modules/auth';
import type { AuthUser, CurrentUser } from '@/api/types';
import { USE_MOCK } from '@/config';
import { clearMockSession, saveMockSession } from '@/mocks/session';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const ready = ref(false);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.role === 'admin');

  async function ensureReady(): Promise<void> {
    if (ready.value) {
      return;
    }
    try {
      const me: CurrentUser = await authApi.me();
      user.value = me.status === 'active' ? me : null;
    } catch {
      user.value = null;
      clearMockSession();
    } finally {
      ready.value = true;
    }
  }

  async function login(username: string, password: string): Promise<AuthUser> {
    const result = await authApi.login(username, password);
    if (USE_MOCK) {
      saveMockSession({
        user_id: result.user.id,
        username: result.user.username,
        role: result.user.role,
        issued_at: Date.now(),
      });
    }
    user.value = result.user;
    ready.value = true;
    return result.user;
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      // 退出时后端失败也继续清理本地状态
    }
    user.value = null;
    ready.value = true;
    clearMockSession();
  }

  /** 供测试与 403 页“返回登录”使用。 */
  function reset(): void {
    user.value = null;
    ready.value = false;
    clearMockSession();
  }

  return { user, ready, isAuthenticated, isAdmin, ensureReady, login, logout, reset };
});
