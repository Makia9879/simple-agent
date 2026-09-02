/**
 * Mock 网关集成测试：用 msw/node 直接驱动 handlers。
 * 断言对象是「真实后端的线格式」（与 backend/api/internal/handler/hub 对齐）：
 * Go 风格键名、map 形 items、白名单请求体（未知字段 400）、grants 的
 * SubjectType/SubjectID/ModelID 键、DELETE 走请求体、密码至少 12 位、
 * 审计动作小写点分、正文 Items 空时为 null。
 * 前端归一层（src/api/wire.ts）另有单测覆盖两种拼写的兼容。
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

async function request(
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = ADMIN_HEADERS): Promise<Response> {
  return request(path, 'GET', undefined, headers);
}

async function send(path: string, method: string, body: unknown, headers = ADMIN_HEADERS): Promise<Response> {
  return request(path, method, body, headers);
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
  it('密码错误返回 401，错误信封键名为 Go 风格 Code/Message/RequestID', async () => {
    const res = await send('/auth/login', 'POST', { username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { Code: string; RequestID: string } };
    expect(body.error.Code).toBe('UNAUTHENTICATED');
    expect(body.error.RequestID).toMatch(/^req_/);
  });

  it('禁用账号登录返回 403 FORBIDDEN', async () => {
    const res = await send('/auth/login', 'POST', { username: 'bob', password: 'bob123' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { Code: string } };
    expect(body.error.Code).toBe('FORBIDDEN');
  });

  it('连续失败触发登录限流 429', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await send('/auth/login', 'POST', { username: 'eve', password: 'nope' });
      expect(res.status).toBe(401);
    }
    const limited = await send('/auth/login', 'POST', { username: 'eve', password: 'nope' });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: { Code: string } };
    expect(body.error.Code).toBe('LOGIN_RATE_LIMITED');
  });

  it('管理员登录成功返回用户且不含密码', async () => {
    const res = await send('/auth/login', 'POST', { username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; role: string; status: string } };
    expect(body.user.id).toBe('u_admin');
    expect(body.user.role).toBe('admin');
    expect(body.user.status).toBe('active');
    expect(JSON.stringify(body)).not.toMatch(/password|admin123/i);
  });

  it('登录请求体出现未知字段返回 400 invalid request（镜像 DisallowUnknownFields）', async () => {
    const res = await send('/auth/login', 'POST', { username: 'admin', password: 'admin123', nickname: 'x' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid request');
  });
});

describe('admin authorization', () => {
  it('未登录访问 /admin/* 返回 401；普通用户返回 403', async () => {
    const anonymous = await get('/admin/users', { 'Content-Type': 'application/json' });
    expect(anonymous.status).toBe(401);

    const asUser = await get('/admin/users', USER_HEADERS);
    expect(asUser.status).toBe(403);
    const body = (await asUser.json()) as { error: { Code: string } };
    expect(body.error.Code).toBe('FORBIDDEN');
  });
});

describe('users', () => {
  it('列表返回数组 items，字段为 id/username/role/status（小写）', async () => {
    const res = await get('/admin/users');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, string>> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(5);
    for (const user of body.items) {
      expect(Object.keys(user).sort()).toEqual(['id', 'role', 'status', 'username']);
    }
    expect(JSON.stringify(body)).not.toMatch(/password|nickname|email/i);
  });

  it('创建用户：额外字段 400；短密码 400 字符串错误；成功 201；重名 409', async () => {
    const extra = await send('/admin/users', 'POST', {
      username: 'frank', password: 'frank-password-1', role: 'user', nickname: 'Frank',
    });
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as { error: string }).error).toBe('invalid request');

    const short = await send('/admin/users', 'POST', { username: 'frank', password: 'short', role: 'user' });
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toBe(
      'password must be at least 12 characters',
    );

    const ok = await send('/admin/users', 'POST', {
      username: 'frank', password: 'frank-password-1', role: 'user',
    });
    expect(ok.status).toBe(201);
    const created = (await ok.json()) as { id: string; username: string; role: string; status: string };
    expect(created.username).toBe('frank');
    expect(created.status).toBe('active');

    const dup = await send('/admin/users', 'POST', {
      username: 'frank', password: 'frank-password-1', role: 'user',
    });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe('username exists');
  });

  it('更新用户只接受 status/role；重置密码只接受 password 并返回 204', async () => {
    const patched = await send('/admin/users/u_dave', 'PATCH', { status: 'disabled' });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { status: string }).status).toBe('disabled');

    const bad = await send('/admin/users/u_dave', 'PATCH', { nickname: 'x' });
    expect(bad.status).toBe(400);

    const badKey = await send('/admin/users/u_dave/reset-password', 'POST', { new_password: 'another-password-1' });
    expect(badKey.status).toBe(400);

    const short = await send('/admin/users/u_dave/reset-password', 'POST', { password: 'short' });
    expect(short.status).toBe(400);

    const ok = await send('/admin/users/u_dave/reset-password', 'POST', { password: 'another-password-1' });
    expect(ok.status).toBe(204);
  });
});

describe('groups', () => {
  it('列表 items 是以组 ID 为键的对象，字段为 ID/Name/Status；成员信息不返回', async () => {
    const res = await get('/admin/groups');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, Record<string, string>> };
    expect(Array.isArray(body.items)).toBe(false);
    const group = body.items.g_eng!;
    expect(Object.keys(group).sort()).toEqual(['ID', 'Name', 'Status']);
    expect(group.Name).toBe('研发组');
  });

  it('创建 / 更新 / 成员变更：请求体白名单 + Go 风格响应 + {"ok":true}', async () => {
    const created = await send('/admin/groups', 'POST', { name: '审计组' });
    expect(created.status).toBe(201);
    const group = (await created.json()) as { ID: string; Name: string; Status: string };
    expect(group.Name).toBe('审计组');
    expect(group.Status).toBe('active');

    const withDescription = await send('/admin/groups', 'POST', { name: '描述组', description: 'x' });
    expect(withDescription.status).toBe(400);

    const patched = await send(`/admin/groups/${group.ID}`, 'PATCH', { status: 'disabled' });
    expect(((await patched.json()) as { Status: string }).Status).toBe('disabled');

    const members = await send(`/admin/groups/${group.ID}/members`, 'PATCH', {
      add_user_ids: ['u_alice', 'u_dave'],
      remove_user_ids: [],
    });
    expect(members.status).toBe(200);
    expect(((await members.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe('providers and models', () => {
  it('providers 的 items 是以 provider 为键的对象，字段白名单且不含模型清单', async () => {
    const res = await get('/admin/providers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, Record<string, string>> };
    const glm = body.items.glm!;
    expect(Object.keys(glm).sort()).toEqual(['LastSyncedAt', 'Name', 'Provider', 'Status']);
    expect(JSON.stringify(body)).not.toMatch(FORBIDDEN);
  });

  it('同步成功：新模型默认停用，缺失模型不可用且授权保留；audit 记录 provider.sync', async () => {
    db.grants.push({
      subject_type: 'group',
      subject_id: 'g_op',
      model_id: 'm_dsreasoner',
      created_at: '2026-09-01T00:00:00Z',
    });
    const res = await send('/admin/providers/sync', 'POST', undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, Record<string, string>> };

    const models = (await (await get('/admin/models')).json()) as {
      items: Record<string, Record<string, unknown>>;
    };
    expect(Array.isArray(models.items)).toBe(false);
    const glmPlus = Object.values(models.items).find((m) => m.UpstreamModelID === 'glm-4-plus')!;
    expect(glmPlus.Enabled).toBe(false); // 新模型默认停用
    expect(glmPlus.Available).toBe(true);
    const reasoner = Object.values(models.items).find((m) => m.UpstreamModelID === 'deepseek-reasoner')!;
    expect(reasoner.Available).toBe(false); // 清单缺失
    expect(reasoner.Enabled).toBe(true);
    expect(db.grants.some((g) => g.model_id === 'm_dsreasoner')).toBe(true);
    expect(body.items.glm!.Status).toBe('active');
    expect(db.audit.some((a) => a.action === 'provider.sync' && a.result === 'success')).toBe(true);
  });

  it('同步失败：返回 502 PI_UNAVAILABLE，旧快照保留并标记 stale', async () => {
    db.scenario.syncOutcome = 'failure';
    const res = await send('/admin/providers/sync', 'POST', undefined);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { Code: string } };
    expect(body.error.Code).toBe('PI_UNAVAILABLE');

    const after = (await (await get('/admin/providers')).json()) as {
      items: Record<string, { Status: string }>;
    };
    expect(after.items.glm!.Status).toBe('stale');
    expect(db.audit.some((a) => a.action === 'provider.sync' && a.result === 'failed')).toBe(true);
  });

  it('模型启停：PATCH 只接受 enabled，写 model.update 审计', async () => {
    const res = await send('/admin/models/m_glm4air', 'PATCH', { enabled: true });
    expect(res.status).toBe(200);
    const model = (await res.json()) as { Enabled: boolean; ID: string };
    expect(model.Enabled).toBe(true);
    expect(db.audit.some((a) => a.action === 'model.update' && a.object_id === 'm_glm4air')).toBe(true);

    const bad = await send('/admin/models/m_glm4air', 'PATCH', { Enabled: true, name: 'x' });
    expect(bad.status).toBe(400);
  });
});

describe('grants', () => {
  it('列表是数组且字段为 SubjectType/SubjectID/ModelID', async () => {
    const res = await get('/admin/grants');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, string>> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    for (const grant of body.items) {
      expect(Object.keys(grant).sort()).toEqual(['ModelID', 'SubjectID', 'SubjectType']);
    }
  });

  it('POST 使用 snake_case 键被拒绝；Go 风格键成功', async () => {
    const snake = await send('/admin/grants', 'POST', {
      subject_type: 'group', subject_id: 'g_eng', model_id: 'm_dschat',
    });
    expect(snake.status).toBe(400);

    const ok = await send('/admin/grants', 'POST', {
      SubjectType: 'group', SubjectID: 'g_eng', ModelID: 'm_dschat',
    });
    expect(ok.status).toBe(201);
    const grant = (await ok.json()) as { SubjectType: string; SubjectID: string; ModelID: string };
    expect(grant.SubjectType).toBe('group');
    expect(db.audit.some((a) => a.action === 'grant.create')).toBe(true);
  });

  it('DELETE 从请求体解码三项定位并返回 204', async () => {
    const viaQuery = await request(
      '/admin/grants?SubjectType=group&SubjectID=g_eng&ModelID=m_glm4flash',
      'DELETE',
      undefined,
      ADMIN_HEADERS,
    );
    expect(viaQuery.status).toBe(400);

    const viaBody = await send('/admin/grants', 'DELETE', {
      SubjectType: 'group', SubjectID: 'g_eng', ModelID: 'm_glm4flash',
    });
    expect(viaBody.status).toBe(204);
    expect(db.grants.some((g) => g.model_id === 'm_glm4flash' && g.subject_id === 'g_eng')).toBe(false);
  });

  it('有效模型预览返回数组 items（Go 风格字段）', async () => {
    const res = await get('/admin/users/u_alice/effective-models');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, string>> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.map((m) => m.ID).sort()).toEqual(['m_dschat', 'm_glm4flash']);
    for (const model of body.items) {
      expect(Object.keys(model).sort()).toEqual(['ID', 'Name', 'Provider', 'UpstreamModelID']);
    }
  });
});

describe('usage', () => {
  it('列表是数组，Go 风格字段，未知 Token 为 null，支持 user_id 筛选', async () => {
    const res = await get('/admin/usage');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    for (const record of body.items) {
      expect(Object.keys(record).sort()).toEqual([
        'CachedTokens', 'ConversationID', 'EndedAt', 'InputTokens', 'ModelID',
        'OutputTokens', 'RequestID', 'StartedAt', 'Status', 'TotalTokens', 'UserID',
      ]);
    }
    // Provider 未返回 Token 时为 null，不伪造估算值
    expect(body.items.some((r) => r.TotalTokens === null)).toBe(true);

    const filtered = await get('/admin/usage?user_id=u_alice');
    const filteredBody = (await filtered.json()) as { items: Array<Record<string, unknown>> };
    expect(filteredBody.items.length).toBeGreaterThan(0);
    expect(filteredBody.items.every((r) => r.UserID === 'u_alice')).toBe(true);
  });
});

describe('conversations review', () => {
  it('列表 items 是以会话 ID 为键的对象（镜像后端含 SessionRef），正文分页游标', async () => {
    const list = await get('/admin/conversations');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: Record<string, Record<string, unknown>> };
    expect(Array.isArray(body.items)).toBe(false);
    const conversation = body.items.c_1!;
    expect(Object.keys(conversation).sort()).toEqual([
      'CreatedAt', 'Hidden', 'ID', 'ModelID', 'OwnerID', 'SessionRef', 'Title', 'UpdatedAt',
    ]);
    // 隐藏会话对管理员仍可见（c_4）
    expect(body.items.c_4!.Hidden).toBe(true);

    const first = await get('/admin/conversations/c_1/messages?limit=20');
    expect(first.status).toBe(200);
    const page = (await first.json()) as { Items: Array<Record<string, string>>; NextSince: string; HasMore: boolean };
    expect(Array.isArray(page.Items)).toBe(true);
    expect(page.Items).toHaveLength(20);
    expect(page.HasMore).toBe(true);
    for (const item of page.Items) {
      expect(Object.keys(item).sort()).toEqual(['Content', 'CreatedAt', 'ID', 'Role', 'Status']);
    }
    const second = await get(`/admin/conversations/c_1/messages?since=${page.NextSince}&limit=50`);
    const page2 = (await second.json()) as { Items: Array<Record<string, string>> };
    expect(page2.Items[0]!.ID > page.Items.at(-1)!.ID).toBe(true);
  });

  it('读取正文先写 conversation.review 审计；无消息会话 Items 为 null；不存在返回 404 且记失败审阅', async () => {
    const res = await get('/admin/conversations/c_2/messages?limit=50');
    expect(res.status).toBe(200);
    const reviews = db.audit.filter((a) => a.action === 'conversation.review' && a.object_id === 'c_2');
    expect(reviews.length).toBeGreaterThanOrEqual(1);

    // 没有会话正文的会话：镜像后端 nil 切片 → Items:null
    db.conversations.push({
      id: 'c_empty',
      owner_id: 'u_alice',
      model_id: 'm_glm4flash',
      pi_session_ref: 'session_c_empty',
      title: '空会话',
      hidden: false,
      generating: false,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    });
    const empty = await get('/admin/conversations/c_empty/messages');
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { Items: unknown }).Items).toBeNull();

    const missing = await get('/admin/conversations/c_none/messages');
    expect(missing.status).toBe(404);
    expect(db.audit.some((a) => a.action === 'conversation.review' && a.result === 'failed')).toBe(true);
  });

  it('PI 暂不可读的会话返回 502 且失败审阅入审计', async () => {
    db.scenario.piUnavailableConversations = ['c_5'];
    const res = await get('/admin/conversations/c_5/messages');
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { Code: string } };
    expect(body.error.Code).toBe('PI_UNAVAILABLE');
    expect(
      db.audit.some((a) => a.action === 'conversation.review' && a.object_id === 'c_5' && a.result === 'failed'),
    ).toBe(true);
  });
});

describe('audit', () => {
  it('列表是数组，Go 风格字段，动作是小写点分值', async () => {
    const res = await get('/admin/audit');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, string>> };
    expect(Array.isArray(body.items)).toBe(true);
    for (const entry of body.items) {
      expect(Object.keys(entry).sort()).toEqual([
        'Action', 'ActorID', 'CreatedAt', 'ObjectID', 'ObjectType', 'Result', 'TraceID',
      ]);
      expect(entry.Action).toMatch(/^[a-z]+\.[a-z]+$/);
    }
    expect(JSON.stringify(body)).not.toMatch(FORBIDDEN);
  });
});
