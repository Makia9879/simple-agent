/**
 * Mock 网关集成测试：用 msw/node 直接驱动 handlers，验证 /api/v1 契约端到端行为
 * （登录、角色拒绝、Provider 同步、正文分页审阅与审计、登录限流）。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';

import { db, resetDb } from './db';
import { handlers } from './handlers';

// 与 handlers 的相对路径解析基准（happy-dom 的 location.origin）保持一致
const BASE = 'http://localhost:3000/api/v1';

const FORBIDDEN = /api[_-]?key|apikey|secret|sk-[A-Za-z0-9_-]{6,}|bearer\s+\S+/i;

const server = setupServer(...handlers);

function sessionHeader(userId: string, username: string, role: 'admin' | 'user'): Record<string, string> {
  const raw = globalThis.btoa(
    unescape(encodeURIComponent(JSON.stringify({ user_id: userId, username, role, issued_at: Date.now() }))),
  );
  return { 'X-Mock-Session': raw, 'Content-Type': 'application/json' };
}

const ADMIN_HEADERS = sessionHeader('u_admin', 'admin', 'admin');
const USER_HEADERS = sessionHeader('u_alice', 'alice', 'user');

async function post(path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetDb();
});

describe('auth', () => {
  it('密码错误返回 401，且响应不包含密码', async () => {
    const res = await post('/auth/login', { username: 'admin', password: 'wrong' }, ADMIN_HEADERS);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('禁用账号登录返回 403 FORBIDDEN', async () => {
    const res = await post('/auth/login', { username: 'bob', password: 'bob123' }, ADMIN_HEADERS);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('连续失败触发登录限流 429', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await post('/auth/login', { username: 'eve', password: 'nope' }, ADMIN_HEADERS);
      expect(res.status).toBe(401);
    }
    const limited = await post('/auth/login', { username: 'eve', password: 'nope' }, ADMIN_HEADERS);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LOGIN_RATE_LIMITED');
  });

  it('管理员登录成功返回用户且不含密码', async () => {
    const res = await post('/auth/login', { username: 'admin', password: 'admin123' }, ADMIN_HEADERS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; role: string } };
    expect(body.user.id).toBe('u_admin');
    expect(body.user.role).toBe('admin');
    expect(JSON.stringify(body)).not.toMatch(/password|admin123/i);
  });
});

describe('admin authorization', () => {
  it('未登录访问 /admin/* 返回 401；普通用户返回 403', async () => {
    const anonymous = await get('/admin/users', { 'Content-Type': 'application/json' });
    expect(anonymous.status).toBe(401);

    const asUser = await get('/admin/users', USER_HEADERS);
    expect(asUser.status).toBe(403);
    const body = (await asUser.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('管理员可读取用户列表（分页）', async () => {
    const res = await get('/admin/users?page=1&page_size=10', ADMIN_HEADERS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number; page: number };
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(5);
    expect(body.page).toBe(1);
  });
});

describe('provider sync', () => {
  it('同步成功：新模型默认停用，缺失模型不可用且授权保留', async () => {
    db.grants.push({
      subject_type: 'group',
      subject_id: 'g_op',
      model_id: 'm_dsreasoner',
      created_at: '2026-09-01T00:00:00Z',
    });
    const res = await post('/admin/providers/sync', {}, ADMIN_HEADERS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: string;
      providers: Array<{
        provider: string;
        status: string;
        models: Array<{ upstream_model_id: string; enabled: boolean; available: boolean }>;
      }>;
    };
    expect(body.result).toBe('success');
    const glm = body.providers.find((p) => p.provider === 'glm')!;
    const plus = glm.models.find((m) => m.upstream_model_id === 'glm-4-plus')!;
    expect(plus.enabled).toBe(false);
    expect(plus.available).toBe(true);
    const deepseek = body.providers.find((p) => p.provider === 'deepseek')!;
    const reasoner = deepseek.models.find((m) => m.upstream_model_id === 'deepseek-reasoner')!;
    expect(reasoner.available).toBe(false);
    expect(db.grants.some((g) => g.model_id === 'm_dsreasoner')).toBe(true);
  });

  it('同步失败返回 502，快照保留且标记过期', async () => {
    db.scenario.syncOutcome = 'failure';
    const before = db.providers.map((p) => ({ ...p }));
    const res = await post('/admin/providers/sync', {}, ADMIN_HEADERS);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PI_UNAVAILABLE');

    const snapshot = await get('/admin/providers', ADMIN_HEADERS);
    const data = (await snapshot.json()) as {
      providers: Array<{ status: string; last_synced_at: string | null }>;
      last_sync_error: { code: string } | null;
    };
    expect(data.providers.every((p) => p.status === 'stale')).toBe(true);
    expect(data.providers.map((p) => p.last_synced_at)).toEqual(before.map((p) => p.last_synced_at));
    expect(data.last_sync_error?.code).toBe('PI_UNAVAILABLE');
    expect(db.models).toHaveLength(4);
  });
});

describe('conversation review', () => {
  it('正文按 limit 分页返回，成功审阅写审计并返回 trace_id', async () => {
    const res = await get('/admin/conversations/c_1/messages?limit=20', ADMIN_HEADERS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; role: string }>;
      next_since: string;
      has_more: boolean;
      review: { recorded: boolean; trace_id: string; result: string };
    };
    expect(body.items).toHaveLength(20);
    expect(body.has_more).toBe(true);
    expect(body.review.recorded).toBe(true);
    expect(body.review.result).toBe('success');
    expect(body.review.trace_id).toMatch(/^tr_/);

    const audit = await get('/admin/audit?action=CONVERSATION_REVIEW&page=1&page_size=10', ADMIN_HEADERS);
    const auditBody = (await audit.json()) as {
      items: Array<{ action: string; object_id: string; result: string; trace_id: string }>;
    };
    expect(auditBody.items.length).toBeGreaterThanOrEqual(1);
    expect(auditBody.items[0]!.object_id).toBe('c_1');
    expect(auditBody.items[0]!.result).toBe('success');

    // 下一页
    const next = await get(
      `/admin/conversations/c_1/messages?limit=20&since=${encodeURIComponent(body.next_since)}`,
      ADMIN_HEADERS,
    );
    const nextBody = (await next.json()) as { items: Array<{ id: string }> };
    expect(nextBody.items[0]!.id > body.items.at(-1)!.id).toBe(true);
  });

  it('PI 暂不可读时返回 502 且失败审阅同样写审计', async () => {
    db.scenario.piUnavailableConversations = ['c_5'];
    const res = await get('/admin/conversations/c_5/messages?limit=20', ADMIN_HEADERS);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PI_UNAVAILABLE');

    const audit = await get('/admin/audit?action=CONVERSATION_REVIEW&page=1&page_size=10', ADMIN_HEADERS);
    const auditBody = (await audit.json()) as {
      items: Array<{ object_id: string; result: string }>;
    };
    expect(auditBody.items[0]!.object_id).toBe('c_5');
    expect(auditBody.items[0]!.result).toBe('failed');
  });

  it('会话列表包含用户已隐藏会话并可按隐藏筛选', async () => {
    const res = await get('/admin/conversations?hidden=true&page=1&page_size=10', ADMIN_HEADERS);
    const body = (await res.json()) as { items: Array<{ id: string; hidden: boolean }> };
    expect(body.items.map((c) => c.id)).toEqual(['c_4']);
  });
});

describe('grants & effective models', () => {
  it('停用模型不能被授权；授权后有效模型立即生效', async () => {
    const denied = await post(
      '/admin/grants',
      { subject_type: 'group', subject_id: 'g_eng', model_id: 'm_glm4air' },
      ADMIN_HEADERS,
    );
    expect(denied.status).toBe(400);

    const before = await get('/admin/users/u_dave/effective-models', ADMIN_HEADERS);
    const beforeBody = (await before.json()) as { items: Array<{ id: string }> };
    expect(beforeBody.items.map((m) => m.id)).toEqual(['m_dschat']);

    const created = await post(
      '/admin/grants',
      { subject_type: 'group', subject_id: 'g_op', model_id: 'm_glm4flash' },
      ADMIN_HEADERS,
    );
    expect(created.status).toBe(201);

    const after = await get('/admin/users/u_dave/effective-models', ADMIN_HEADERS);
    const afterBody = (await after.json()) as { items: Array<{ id: string }> };
    expect(afterBody.items.map((m) => m.id).sort()).toEqual(['m_dschat', 'm_glm4flash']);
  });

  it('撤销授权立即生效（有效模型减少）', async () => {
    const res = await fetch(`${BASE}/admin/grants?subject_type=user&subject_id=u_alice&model_id=m_dschat`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(204);

    const effective = await get('/admin/users/u_alice/effective-models', ADMIN_HEADERS);
    const body = (await effective.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((m) => m.id)).toEqual(['m_glm4flash']);
  });
});

describe('usage', () => {
  it('按用户筛选用量并返回汇总（未知 Token 不伪造）', async () => {
    const res = await get('/admin/usage?user_id=u_alice&page=1&page_size=10', ADMIN_HEADERS);
    const body = (await res.json()) as {
      items: Array<{ username: string }>;
      total: number;
      summary: { calls: number; unknown_token_records: number };
    };
    expect(body.total).toBe(6);
    expect(body.items.every((r) => r.username === 'alice')).toBe(true);
    expect(body.summary.calls).toBe(6);
    expect(body.summary.unknown_token_records).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(FORBIDDEN);
  });
});

describe('security', () => {
  it('Provider / Model / 会话响应中不出现密钥类字段或内部路径', async () => {
    const providers = await get('/admin/providers', ADMIN_HEADERS);
    expect(JSON.stringify(await providers.json())).not.toMatch(FORBIDDEN);

    const models = await get('/admin/models', ADMIN_HEADERS);
    expect(JSON.stringify(await models.json())).not.toMatch(FORBIDDEN);

    const messages = await get('/admin/conversations/c_1/messages?limit=50', ADMIN_HEADERS);
    const messagesText = JSON.stringify(await messages.json());
    expect(messagesText).not.toMatch(FORBIDDEN);
    expect(messagesText).not.toContain('/Users/');
    expect(messagesText).not.toContain('must-not-leak');
  });
});
