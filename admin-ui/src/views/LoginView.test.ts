/**
 * 登录页组件测试（F2 / AU-01）：错误提示展示、普通用户登录后进入无权限页。
 */
import Antd from 'ant-design-vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginView from './LoginView.vue';
import { ApiError } from '@/api/errors';
import { useAuthStore } from '@/stores/auth';

const loginMock = vi.hoisted(() => vi.fn());
const meMock = vi.hoisted(() => vi.fn());
const logoutMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/modules/auth', () => ({
  login: (...args: unknown[]) => loginMock(...(args as [string, string])),
  me: () => meMock(),
  logout: () => logoutMock(),
  refresh: () => Promise.resolve(),
}));

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/403', component: { template: '<div>forbidden</div>' } },
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
    ],
  });
}

async function mountView() {
  const router = buildRouter();
  await router.push('/login');
  const wrapper = mount(LoginView, {
    global: { plugins: [Antd, router] },
  });
  return { wrapper, router };
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loginMock.mockReset();
    meMock.mockReset();
    logoutMock.mockReset();
  });

  it('空表单提交时提示输入用户名和密码', async () => {
    const { wrapper } = await mountView();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('请输入用户名和密码');
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('密码错误时展示脱敏后的服务端错误信息', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', '用户名或密码不正确'));
    const { wrapper } = await mountView();

    await wrapper.findAll('input')[0]!.setValue('admin');
    await wrapper.findAll('input')[1]!.setValue('wrong-password');
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('用户名或密码不正确');
    // 错误提示不包含堆栈 / 路径 / 凭据
    expect(wrapper.text()).not.toMatch(/\/Users\/|at .*\(|api_key|sk-/i);
  });

  it('禁用账号登录被拒绝（403）并展示提示', async () => {
    loginMock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', '账号已被禁用，请联系管理员'));
    const { wrapper } = await mountView();

    await wrapper.findAll('input')[0]!.setValue('bob');
    await wrapper.findAll('input')[1]!.setValue('bob123');
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('账号已被禁用，请联系管理员');
  });

  it('登录限流（429）时展示冷却提示', async () => {
    loginMock.mockRejectedValue(new ApiError(429, 'LOGIN_RATE_LIMITED', '登录尝试过于频繁，请 60 秒后再试'));
    const { wrapper } = await mountView();

    await wrapper.findAll('input')[0]!.setValue('admin');
    await wrapper.findAll('input')[1]!.setValue('whatever');
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('登录尝试过于频繁');
  });

  it('管理员登录成功后跳转仪表盘并写入登录态', async () => {
    loginMock.mockResolvedValue({ user: { id: 'u_admin', username: 'admin', role: 'admin' } });
    const { wrapper, router } = await mountView();

    await wrapper.findAll('input')[0]!.setValue('admin');
    await wrapper.findAll('input')[1]!.setValue('admin123');
    await wrapper.find('button').trigger('click');
    await flushPromises();

    const auth = useAuthStore();
    expect(auth.isAdmin).toBe(true);
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('普通用户登录成功但被引导到 403 无权限页', async () => {
    loginMock.mockResolvedValue({ user: { id: 'u_alice', username: 'alice', role: 'user' } });
    const { wrapper, router } = await mountView();

    await wrapper.findAll('input')[0]!.setValue('alice');
    await wrapper.findAll('input')[1]!.setValue('alice123');
    await wrapper.find('button').trigger('click');
    await flushPromises();

    const auth = useAuthStore();
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.isAdmin).toBe(false);
    expect(router.currentRoute.value.path).toBe('/403');
  });
});
