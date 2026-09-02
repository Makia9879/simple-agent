/**
 * 仪表盘组件测试：副标题的数据来源标注随 USE_MOCK 配置动态切换
 * （mock 契约接口 / Core API），避免真实后端联调时误标为 mock。
 */
import Antd from 'ant-design-vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listUsersMock = vi.hoisted(() => vi.fn());
const listGroupsMock = vi.hoisted(() => vi.fn());
const listModelsMock = vi.hoisted(() => vi.fn());
const listConversationsMock = vi.hoisted(() => vi.fn());
const listUsageMock = vi.hoisted(() => vi.fn());
const listAuditMock = vi.hoisted(() => vi.fn());

/** 可变的 USE_MOCK 开关：配合 vi.resetModules + 动态导入，在每个用例内按当前值生效。 */
const useMockFlag = vi.hoisted(() => ({ value: true }));

vi.mock('@/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config')>();
  return {
    ...original,
    get USE_MOCK(): boolean {
      return useMockFlag.value;
    },
  };
});

vi.mock('@/api/modules/users', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/modules/users')>();
  return {
    ...original,
    listUsers: (...args: Parameters<typeof original.listUsers>) => listUsersMock(...args),
  };
});

vi.mock('@/api/modules/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/modules/groups')>();
  return {
    ...original,
    listGroups: (...args: Parameters<typeof original.listGroups>) => listGroupsMock(...args),
  };
});

vi.mock('@/api/modules/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/modules/providers')>();
  return {
    ...original,
    listModels: (...args: Parameters<typeof original.listModels>) => listModelsMock(...args),
  };
});

vi.mock('@/api/modules/conversations', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/modules/conversations')>();
  return {
    ...original,
    listConversations: (
      ...args: Parameters<typeof original.listConversations>
    ) => listConversationsMock(...args),
    listAudit: (...args: Parameters<typeof original.listAudit>) => listAuditMock(...args),
  };
});

vi.mock('@/api/modules/usage', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/modules/usage')>();
  return {
    ...original,
    listUsage: (...args: Parameters<typeof original.listUsage>) => listUsageMock(...args),
  };
});

/** resetModules 后重新导入组件，使 dataSourceLabel 按 useMockFlag 当前值重新求值。 */
async function mountDashboard() {
  vi.resetModules();
  const { default: DashboardView } = await import('./DashboardView.vue');
  const wrapper = mount(DashboardView, {
    global: { plugins: [Antd] },
  });
  await flushPromises();
  return wrapper;
}

describe('DashboardView', () => {
  beforeEach(() => {
    listUsersMock.mockResolvedValue({ items: [], total: 3, page: 1, page_size: 1 });
    listGroupsMock.mockResolvedValue({ items: [], total: 2, page: 1, page_size: 1 });
    listModelsMock.mockResolvedValue({ items: [] });
    listConversationsMock.mockResolvedValue({ items: [], total: 4, page: 1, page_size: 1 });
    listUsageMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 1,
      summary: {
        calls: 5,
        success: 4,
        error: 1,
        aborted: 0,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        unknown_token_records: 0,
      },
    });
    listAuditMock.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8 });
  });

  it('USE_MOCK=true 时副标题标注 mock 契约接口', async () => {
    useMockFlag.value = true;
    const wrapper = await mountDashboard();
    expect(wrapper.text()).toContain('数据来自 mock 契约接口');
    expect(wrapper.text()).not.toContain('Core API');
  });

  it('USE_MOCK=false 时副标题标注 Core API', async () => {
    useMockFlag.value = false;
    const wrapper = await mountDashboard();
    expect(wrapper.text()).toContain('数据来自 Core API');
    expect(wrapper.text()).not.toContain('mock 契约接口');
  });
});
