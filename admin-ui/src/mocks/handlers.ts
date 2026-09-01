/**
 * MSW mock 网关：实现 docs/task-breakdown.md §3.2 / docs/program-design.md §6.4 的全部后台契约路径。
 * 仅拦截 /api/v1/*；不访问任何真实后端、Provider 或外网。
 */
import { API_BASE_URL } from '@/config';
import type { AuditAction } from '@/api/types';
import { db } from './db';
import {
  SUCCESS_MANIFEST,
  appendAudit,
  applyProviderSyncFailure,
  applyProviderSyncSuccess,
  checkLoginAllowed,
  clampPageSize,
  computeEffectiveModels,
  filterVisibleEntries,
  findGroup,
  findModel,
  findUser,
  makeReviewFeedback,
  normalizePage,
  paginate,
  recordLoginFailure,
  recordLoginSuccess,
  toAdminConversation,
  toAdminGroup,
  toAdminUser,
  toGrant,
  toModelSummary,
  toProviderRegistration,
  toUsageRecord,
  usageSummary,
  validateNewUser,
  validatePassword,
} from './logic';
import { decodeMockSession, type MockSession } from './session';
import { delay, HttpResponse, http, type DefaultBodyType, type StrictRequest } from 'msw';

type JsonResponse = ReturnType<typeof HttpResponse.json>;
type MockRequest = StrictRequest<DefaultBodyType>;

const P = API_BASE_URL;

function nowIso(): string {
  return new Date().toISOString();
}

function jsonError(status: number, code: string, message: string): JsonResponse {
  return HttpResponse.json({ error: { code, message } }, { status });
}

function validationError(message: string): JsonResponse {
  return jsonError(400, 'VALIDATION_ERROR', message);
}

function notFound(message: string): JsonResponse {
  return jsonError(404, 'NOT_FOUND', message);
}

async function readJson<T>(request: MockRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

interface AdminContext {
  session: MockSession;
  userId: string;
  username: string;
}

function resolveActor(request: MockRequest): { session: MockSession; user: ReturnType<typeof findUser> } {
  const session = decodeMockSession(request.headers.get('x-mock-session'));
  if (!session) {
    return { session: null as unknown as MockSession, user: undefined };
  }
  return { session, user: findUser(db, session.user_id) };
}

function requireAdmin(request: MockRequest): { actor: AdminContext } | { response: JsonResponse } {
  const { session, user } = resolveActor(request);
  if (!session || !user || user.status !== 'active') {
    return { response: jsonError(401, 'UNAUTHENTICATED', '未登录或登录状态已失效，请重新登录') };
  }
  if (user.role !== 'admin') {
    return { response: jsonError(403, 'FORBIDDEN', '仅管理员可访问后台') };
  }
  return { actor: { session, userId: user.id, username: user.username } };
}

function audit(
  actor: AdminContext | null,
  entry: {
    action: AuditAction;
    object_type: string;
    object_id: string;
    result: 'success' | 'failed';
    detail: string;
    actor_username?: string;
    actor_id?: string;
  },
): string {
  const row = appendAudit(
    db,
    {
      actor_id: actor?.userId ?? entry.actor_id ?? '',
      actor_username: actor?.username ?? entry.actor_username ?? '',
      action: entry.action,
      object_type: entry.object_type,
      object_id: entry.object_id,
      result: entry.result,
      detail: entry.detail,
    },
    nowIso(),
  );
  return row.trace_id;
}

function emptyListResponse<T>(page: number, pageSize: number) {
  return HttpResponse.json({ items: [] as T[], total: 0, page, page_size: pageSize });
}

// ---------------------------------------------------------------------------
// 认证 §6.2
// ---------------------------------------------------------------------------

const loginHandler = http.post(`${P}/auth/login`, async ({ request }) => {
  const body = await readJson<{ username?: string; password?: string }>(request);
  const username = body?.username ?? '';
  const password = body?.password ?? '';
  if (typeof username !== 'string' || username.length === 0 || typeof password !== 'string' || password.length === 0) {
    return validationError('请输入用户名和密码');
  }

  const limit = checkLoginAllowed(db, username, Date.now());
  if (!limit.allowed) {
    const seconds = Math.ceil(limit.retryAfterMs / 1000);
    return jsonError(429, 'LOGIN_RATE_LIMITED', `登录尝试过于频繁，请 ${seconds} 秒后再试`);
  }

  const user = db.users.find((u) => u.username === username);
  if (!user || user.password !== password) {
    recordLoginFailure(db, username, Date.now());
    audit(null, {
      action: 'LOGIN_FAILED',
      object_type: 'auth',
      object_id: user?.id ?? username,
      result: 'failed',
      detail: '登录失败：用户名或密码不正确',
      actor_username: username,
    });
    return jsonError(401, 'UNAUTHENTICATED', '用户名或密码不正确');
  }
  if (user.status === 'disabled') {
    recordLoginFailure(db, username, Date.now());
    audit(null, {
      action: 'LOGIN_FAILED',
      object_type: 'auth',
      object_id: user.id,
      result: 'failed',
      detail: '登录失败：账号已被禁用',
      actor_username: username,
    });
    return jsonError(403, 'FORBIDDEN', '账号已被禁用，请联系管理员');
  }

  recordLoginSuccess(db, username);
  audit(null, {
    action: 'LOGIN',
    object_type: 'auth',
    object_id: user.id,
    result: 'success',
    detail: `用户 ${user.username} 登录成功`,
    actor_id: user.id,
    actor_username: user.username,
  });
  return HttpResponse.json(
    { user: { id: user.id, username: user.username, role: user.role } },
    {
      headers: {
        // 真实后端在此设置 HttpOnly Cookie；SW 响应无法写入 Cookie，mock 模式由页面侧桥接会话。
        'Set-Cookie': 'tah_access=mock; Path=/; HttpOnly; SameSite=Lax',
      },
    },
  );
});

const logoutHandler = http.post(`${P}/auth/logout`, ({ request }) => {
  const { session, user } = resolveActor(request);
  if (session && user) {
    audit(
      { session, userId: user.id, username: user.username },
      { action: 'LOGOUT', object_type: 'auth', object_id: user.id, result: 'success', detail: `用户 ${user.username} 退出登录` },
    );
  }
  return new HttpResponse(null, { status: 204 });
});

const refreshHandler = http.post(`${P}/auth/refresh`, ({ request }) => {
  const { user } = resolveActor(request);
  if (!user || user.status !== 'active') {
    return jsonError(401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录');
  }
  return HttpResponse.json({});
});

const meHandler = http.get(`${P}/auth/me`, ({ request }) => {
  const { user } = resolveActor(request);
  if (!user || user.status !== 'active') {
    return jsonError(401, 'UNAUTHENTICATED', '未登录或登录状态已失效');
  }
  return HttpResponse.json({ id: user.id, username: user.username, role: user.role, status: user.status });
});

// ---------------------------------------------------------------------------
// 用户管理 §6.4
// ---------------------------------------------------------------------------

const listUsersHandler = http.get(`${P}/admin/users`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const page = normalizePage(Number(url.searchParams.get('page')));
  const pageSize = clampPageSize(Number(url.searchParams.get('page_size')), 10);
  if (db.scenario.emptyMode) {
    return emptyListResponse<ReturnType<typeof toAdminUser>>(page, pageSize);
  }
  const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
  const status = url.searchParams.get('status');
  let rows = [...db.users];
  if (query) {
    rows = rows.filter(
      (u) =>
        u.username.toLowerCase().includes(query) ||
        u.nickname.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query),
    );
  }
  if (status === 'active' || status === 'disabled') {
    rows = rows.filter((u) => u.status === status);
  }
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const items = paginate(rows, page, pageSize).map((u) => toAdminUser(db, u));
  return HttpResponse.json({ items, total: rows.length, page, page_size: pageSize });
});

const createUserHandler = http.post(`${P}/admin/users`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const body = await readJson<{
    username?: string;
    nickname?: string;
    email?: string;
    role?: string;
    password?: string;
  }>(request);
  const invalid = validateNewUser(body ?? {});
  if (invalid) {
    return validationError(invalid);
  }
  const payload = body!;
  if (db.users.some((u) => u.username === payload.username)) {
    return validationError('用户名已存在');
  }
  const now = nowIso();
  const id = `u_${db.seq.user}`;
  db.seq.user += 1;
  const user = {
    id,
    username: payload.username!,
    password: payload.password && payload.password.length >= 8 ? payload.password : 'Init@123456',
    nickname: payload.nickname!,
    email: payload.email!,
    role: payload.role as 'admin' | 'user',
    status: 'active' as const,
    created_at: now,
    updated_at: now,
  };
  db.users.push(user);
  audit(guard.actor, {
    action: 'USER_CREATE',
    object_type: 'user',
    object_id: id,
    result: 'success',
    detail: `创建用户 ${user.username}`,
  });
  return HttpResponse.json(toAdminUser(db, user), { status: 201 });
});

const updateUserHandler = http.patch(`${P}/admin/users/:id`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const user = findUser(db, String(params.id));
  if (!user) {
    return notFound('用户不存在');
  }
  const body = await readJson<{ nickname?: string; email?: string; role?: string; status?: string }>(request);
  if (!body) {
    return validationError('请求体不合法');
  }
  if (body.nickname !== undefined && (body.nickname.trim().length === 0 || body.nickname.length > 32)) {
    return validationError('昵称不能为空且不超过 32 个字符');
  }
  if (body.email !== undefined && !/^\S+@\S+\.\S+$/.test(body.email)) {
    return validationError('邮箱格式不正确');
  }
  if (body.role !== undefined && body.role !== 'admin' && body.role !== 'user') {
    return validationError('角色只能是 admin 或 user');
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
    return validationError('状态只能是 active 或 disabled');
  }
  if (user.id === guard.actor.userId) {
    if (body.status === 'disabled') {
      return validationError('不能禁用当前登录的管理员');
    }
    if (body.role === 'user') {
      return validationError('不能将当前登录管理员降级为普通用户');
    }
  }
  const now = nowIso();
  if (body.nickname !== undefined) user.nickname = body.nickname;
  if (body.email !== undefined) user.email = body.email;
  if (body.role !== undefined) user.role = body.role as 'admin' | 'user';
  let action: AuditAction = 'USER_UPDATE';
  let detail = `更新用户 ${user.username} 的资料`;
  if (body.status !== undefined && body.status !== user.status) {
    user.status = body.status as 'active' | 'disabled';
    action = body.status === 'disabled' ? 'USER_DISABLE' : 'USER_ENABLE';
    detail = body.status === 'disabled' ? `禁用用户 ${user.username}` : `启用用户 ${user.username}`;
  }
  user.updated_at = now;
  audit(guard.actor, { action, object_type: 'user', object_id: user.id, result: 'success', detail });
  return HttpResponse.json(toAdminUser(db, user));
});

const resetPasswordHandler = http.post(`${P}/admin/users/:id/reset-password`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const user = findUser(db, String(params.id));
  if (!user) {
    return notFound('用户不存在');
  }
  const body = await readJson<{ new_password?: string }>(request);
  const invalid = validatePassword(body?.new_password ?? '');
  if (invalid) {
    return validationError(invalid);
  }
  user.password = body!.new_password!;
  user.updated_at = nowIso();
  audit(guard.actor, {
    action: 'USER_RESET_PASSWORD',
    object_type: 'user',
    object_id: user.id,
    result: 'success',
    // 审计不记录明文密码
    detail: `重置用户 ${user.username} 的密码`,
  });
  return HttpResponse.json({ reset: true });
});

// ---------------------------------------------------------------------------
// 用户组管理 §6.4
// ---------------------------------------------------------------------------

const listGroupsHandler = http.get(`${P}/admin/groups`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const page = normalizePage(Number(url.searchParams.get('page')));
  const pageSize = clampPageSize(Number(url.searchParams.get('page_size')), 10);
  if (db.scenario.emptyMode) {
    return emptyListResponse<ReturnType<typeof toAdminGroup>>(page, pageSize);
  }
  const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
  const status = url.searchParams.get('status');
  let rows = [...db.groups];
  if (query) {
    rows = rows.filter((g) => g.name.toLowerCase().includes(query) || g.description.toLowerCase().includes(query));
  }
  if (status === 'active' || status === 'disabled') {
    rows = rows.filter((g) => g.status === status);
  }
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const items = paginate(rows, page, pageSize).map((g) => toAdminGroup(g));
  return HttpResponse.json({ items, total: rows.length, page, page_size: pageSize });
});

const createGroupHandler = http.post(`${P}/admin/groups`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const body = await readJson<{ name?: string; description?: string }>(request);
  if (!body?.name || body.name.trim().length === 0 || body.name.length > 32) {
    return validationError('用户组名称不能为空且不超过 32 个字符');
  }
  if (db.groups.some((g) => g.name === body.name)) {
    return validationError('用户组名称已存在');
  }
  const now = nowIso();
  const id = `g_${db.seq.group}`;
  db.seq.group += 1;
  const group = {
    id,
    name: body.name,
    description: body.description ?? '',
    status: 'active' as const,
    member_ids: [] as string[],
    created_at: now,
    updated_at: now,
  };
  db.groups.push(group);
  audit(guard.actor, { action: 'GROUP_CREATE', object_type: 'group', object_id: id, result: 'success', detail: `创建用户组 ${group.name}` });
  return HttpResponse.json(toAdminGroup(group), { status: 201 });
});

const updateGroupHandler = http.patch(`${P}/admin/groups/:id`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const group = findGroup(db, String(params.id));
  if (!group) {
    return notFound('用户组不存在');
  }
  const body = await readJson<{ name?: string; description?: string; status?: string }>(request);
  if (!body) {
    return validationError('请求体不合法');
  }
  if (body.name !== undefined) {
    if (body.name.trim().length === 0 || body.name.length > 32) {
      return validationError('用户组名称不能为空且不超过 32 个字符');
    }
    if (db.groups.some((g) => g.id !== group.id && g.name === body.name)) {
      return validationError('用户组名称已存在');
    }
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
    return validationError('状态只能是 active 或 disabled');
  }
  if (body.name !== undefined) group.name = body.name;
  if (body.description !== undefined) group.description = body.description;
  if (body.status !== undefined) group.status = body.status as 'active' | 'disabled';
  group.updated_at = nowIso();
  audit(guard.actor, {
    action: 'GROUP_UPDATE',
    object_type: 'group',
    object_id: group.id,
    result: 'success',
    detail: `更新用户组 ${group.name}`,
  });
  return HttpResponse.json(toAdminGroup(group));
});

const changeMembersHandler = http.patch(`${P}/admin/groups/:id/members`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const group = findGroup(db, String(params.id));
  if (!group) {
    return notFound('用户组不存在');
  }
  const body = await readJson<{ add_user_ids?: string[]; remove_user_ids?: string[] }>(request);
  const add = body?.add_user_ids ?? [];
  const remove = body?.remove_user_ids ?? [];
  if (!Array.isArray(add) || !Array.isArray(remove)) {
    return validationError('成员参数不合法');
  }
  const missing = [...add, ...remove].filter((id) => !findUser(db, id));
  if (missing.length > 0) {
    return validationError(`包含不存在的用户 ID：${missing.join(', ')}`);
  }
  const next = new Set(group.member_ids);
  for (const id of add) next.add(id);
  for (const id of remove) next.delete(id);
  group.member_ids = [...next];
  group.updated_at = nowIso();
  audit(guard.actor, {
    action: 'GROUP_MEMBERS_CHANGE',
    object_type: 'group',
    object_id: group.id,
    result: 'success',
    detail: `调整成员：加入 ${add.length} 人，移除 ${remove.length} 人，当前 ${group.member_ids.length} 人`,
  });
  return HttpResponse.json(toAdminGroup(group));
});

// ---------------------------------------------------------------------------
// Provider 登记 §6.4（无密钥）
// ---------------------------------------------------------------------------

const listProvidersHandler = http.get(`${P}/admin/providers`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  return HttpResponse.json({
    providers: db.providers.map((p) => toProviderRegistration(db, p)),
    last_sync_error: db.lastSyncError,
  });
});

const syncProvidersHandler = http.post(`${P}/admin/providers/sync`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  await delay(600);
  if (db.scenario.syncOutcome === 'failure') {
    applyProviderSyncFailure(db, 'PI_UNAVAILABLE', 'PI Agent 暂不可用，已保留上次快照');
    audit(guard.actor, {
      action: 'PROVIDER_SYNC_FAILURE',
      object_type: 'provider',
      object_id: 'all',
      result: 'failed',
      detail: '同步失败：PI Agent 暂不可用，保留旧快照并标记过期',
    });
    return jsonError(502, 'PI_UNAVAILABLE', 'PI Agent 暂不可用，已保留上次快照');
  }
  applyProviderSyncSuccess(db, SUCCESS_MANIFEST, nowIso());
  audit(guard.actor, {
    action: 'PROVIDER_SYNC_SUCCESS',
    object_type: 'provider',
    object_id: 'all',
    result: 'success',
    detail: '同步成功：新增模型 glm-4-plus（默认停用），deepseek-reasoner 清单缺失标记不可用',
  });
  return HttpResponse.json({
    result: 'success' as const,
    providers: db.providers.map((p) => toProviderRegistration(db, p)),
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Model 启停 / 授权 / 有效模型预览 §6.4
// ---------------------------------------------------------------------------

const listModelsHandler = http.get(`${P}/admin/models`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const rows = [...db.models].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.upstream_model_id.localeCompare(b.upstream_model_id),
  );
  return HttpResponse.json({ items: rows.map(toModelSummary) });
});

const patchModelHandler = http.patch(`${P}/admin/models/:id`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const model = findModel(db, String(params.id));
  if (!model) {
    return notFound('模型不存在');
  }
  const body = await readJson<{ enabled?: boolean }>(request);
  if (!body || typeof body.enabled !== 'boolean') {
    return validationError('enabled 必须为布尔值');
  }
  if (body.enabled && !model.available) {
    return validationError('模型当前不可用（Provider 清单缺失），暂不能启用');
  }
  model.enabled = body.enabled;
  audit(guard.actor, {
    action: body.enabled ? 'MODEL_ENABLE' : 'MODEL_DISABLE',
    object_type: 'model',
    object_id: model.id,
    result: 'success',
    detail: `${body.enabled ? '启用' : '停用'}模型 ${model.name}`,
  });
  return HttpResponse.json(toModelSummary(model));
});

const listGrantsHandler = http.get(`${P}/admin/grants`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const subjectType = url.searchParams.get('subject_type');
  const subjectId = url.searchParams.get('subject_id');
  const modelId = url.searchParams.get('model_id');
  let rows = [...db.grants];
  if (subjectType === 'user' || subjectType === 'group') {
    rows = rows.filter((g) => g.subject_type === subjectType);
  }
  if (subjectId) {
    rows = rows.filter((g) => g.subject_id === subjectId);
  }
  if (modelId) {
    rows = rows.filter((g) => g.model_id === modelId);
  }
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return HttpResponse.json({ items: rows.map((g) => toGrant(db, g)) });
});

const createGrantHandler = http.post(`${P}/admin/grants`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const body = await readJson<{ subject_type?: string; subject_id?: string; model_id?: string }>(request);
  if (!body || (body.subject_type !== 'user' && body.subject_type !== 'group')) {
    return validationError('subject_type 只能是 user 或 group');
  }
  if (!body.subject_id || !body.model_id) {
    return validationError('subject_id 与 model_id 不能为空');
  }
  const subjectExists =
    body.subject_type === 'user' ? !!findUser(db, body.subject_id) : !!findGroup(db, body.subject_id);
  if (!subjectExists) {
    return notFound('授权对象不存在');
  }
  const model = findModel(db, body.model_id);
  if (!model) {
    return notFound('模型不存在');
  }
  if (!model.enabled) {
    return validationError('模型已停用，不能授权；请先启用模型');
  }
  if (
    db.grants.some(
      (g) =>
        g.subject_type === body.subject_type && g.subject_id === body.subject_id && g.model_id === body.model_id,
    )
  ) {
    return validationError('该授权已存在');
  }
  const grant = {
    subject_type: body.subject_type as 'user' | 'group',
    subject_id: body.subject_id,
    model_id: body.model_id,
    created_at: nowIso(),
  };
  db.grants.push(grant);
  const subjectName =
    grant.subject_type === 'user'
      ? (findUser(db, grant.subject_id)?.username ?? grant.subject_id)
      : (findGroup(db, grant.subject_id)?.name ?? grant.subject_id);
  audit(guard.actor, {
    action: 'GRANT_CREATE',
    object_type: 'grant',
    object_id: `${grant.subject_id}/${grant.model_id}`,
    result: 'success',
    detail: `${grant.subject_type === 'user' ? '用户' : '用户组'} ${subjectName} 授权模型 ${model.name}`,
  });
  return HttpResponse.json(toGrant(db, grant), { status: 201 });
});

const deleteGrantHandler = http.delete(`${P}/admin/grants`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const subjectType = url.searchParams.get('subject_type');
  const subjectId = url.searchParams.get('subject_id');
  const modelId = url.searchParams.get('model_id');
  if ((subjectType !== 'user' && subjectType !== 'group') || !subjectId || !modelId) {
    return validationError('缺少 subject_type / subject_id / model_id');
  }
  const index = db.grants.findIndex(
    (g) => g.subject_type === subjectType && g.subject_id === subjectId && g.model_id === modelId,
  );
  if (index < 0) {
    return notFound('授权不存在');
  }
  const [removed] = db.grants.splice(index, 1);
  const model = findModel(db, removed.model_id);
  audit(guard.actor, {
    action: 'GRANT_DELETE',
    object_type: 'grant',
    object_id: `${removed.subject_id}/${removed.model_id}`,
    result: 'success',
    detail: `撤销授权：${removed.subject_id} → ${model?.name ?? removed.model_id}`,
  });
  return new HttpResponse(null, { status: 204 });
});

const effectiveModelsHandler = http.get(`${P}/admin/users/:id/effective-models`, ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const user = findUser(db, String(params.id));
  if (!user) {
    return notFound('用户不存在');
  }
  return HttpResponse.json({ items: computeEffectiveModels(db, user.id) });
});

// ---------------------------------------------------------------------------
// 全局用量 §6.4
// ---------------------------------------------------------------------------

const listUsageHandler = http.get(`${P}/admin/usage`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const page = normalizePage(Number(url.searchParams.get('page')));
  const pageSize = clampPageSize(Number(url.searchParams.get('page_size')), 10);
  if (db.scenario.emptyMode) {
    return HttpResponse.json({
      items: [],
      total: 0,
      page,
      page_size: pageSize,
      summary: usageSummary([]),
    });
  }
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const userId = url.searchParams.get('user_id');
  const modelId = url.searchParams.get('model_id');
  let rows = [...db.usage];
  if (from) rows = rows.filter((r) => r.started_at >= from);
  if (to) rows = rows.filter((r) => r.started_at <= to);
  if (userId) rows = rows.filter((r) => r.user_id === userId);
  if (modelId) rows = rows.filter((r) => r.model_id === modelId);
  rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
  const mapped = rows.map((r) => toUsageRecord(db, r));
  return HttpResponse.json({
    items: paginate(mapped, page, pageSize),
    total: mapped.length,
    page,
    page_size: pageSize,
    summary: usageSummary(mapped),
  });
});

// ---------------------------------------------------------------------------
// 会话索引 / 正文审阅 §6.4
// ---------------------------------------------------------------------------

const listConversationsHandler = http.get(`${P}/admin/conversations`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const page = normalizePage(Number(url.searchParams.get('page')));
  const pageSize = clampPageSize(Number(url.searchParams.get('page_size')), 10);
  if (db.scenario.emptyMode) {
    return emptyListResponse<ReturnType<typeof toAdminConversation>>(page, pageSize);
  }
  const userId = url.searchParams.get('user_id');
  const modelId = url.searchParams.get('model_id');
  const status = url.searchParams.get('status');
  const hiddenParam = url.searchParams.get('hidden');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  let rows = db.conversations.map((c) => toAdminConversation(db, c));
  if (userId) rows = rows.filter((c) => c.owner_id === userId);
  if (modelId) rows = rows.filter((c) => c.model_id === modelId);
  if (status === 'active' || status === 'generating' || status === 'readonly') {
    rows = rows.filter((c) => c.status === status);
  }
  if (hiddenParam === 'true') rows = rows.filter((c) => c.hidden);
  if (hiddenParam === 'false') rows = rows.filter((c) => !c.hidden);
  if (from) rows = rows.filter((c) => c.updated_at >= from);
  if (to) rows = rows.filter((c) => c.updated_at <= to);
  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return HttpResponse.json({ items: paginate(rows, page, pageSize), total: rows.length, page, page_size: pageSize });
});

const readMessagesHandler = http.get(`${P}/admin/conversations/:id/messages`, ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const conversation = db.conversations.find((c) => c.id === String(params.id));
  if (!conversation) {
    return notFound('会话不存在');
  }
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const limit = clampPageSize(Number(url.searchParams.get('limit')), 20);
  const owner = findUser(db, conversation.owner_id);

  // 先写审阅审计（成功 / 失败都记录，AU-11），再读取正文
  const piUnavailable = db.scenario.piUnavailableConversations.includes(conversation.id);
  const traceId = audit(guard.actor, {
    action: 'CONVERSATION_REVIEW',
    object_type: 'conversation',
    object_id: conversation.id,
    result: piUnavailable ? 'failed' : 'success',
    detail: piUnavailable
      ? `审阅会话 ${conversation.id} 失败：PI 暂不可读（用户 ${owner?.username ?? conversation.owner_id}）`
      : `审阅会话 ${conversation.id} 正文（用户 ${owner?.username ?? conversation.owner_id}）`,
  });

  if (piUnavailable) {
    return jsonError(502, 'PI_UNAVAILABLE', '会话正文暂不可读，请稍后重试');
  }
  const entries = db.sessions[conversation.id] ?? [];
  const filtered = filterVisibleEntries(entries, since, limit);
  return HttpResponse.json({
    ...filtered,
    review: makeReviewFeedback(true, traceId, 'success'),
  });
});

// ---------------------------------------------------------------------------
// 审计 §6.4
// ---------------------------------------------------------------------------

const listAuditHandler = http.get(`${P}/admin/audit`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const page = normalizePage(Number(url.searchParams.get('page')));
  const pageSize = clampPageSize(Number(url.searchParams.get('page_size')), 10);
  if (db.scenario.emptyMode) {
    return emptyListResponse<Record<string, never>>(page, pageSize);
  }
  const action = url.searchParams.get('action');
  const objectType = url.searchParams.get('object_type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  let rows = [...db.audit];
  if (action) rows = rows.filter((a) => a.action === action);
  if (objectType) rows = rows.filter((a) => a.object_type === objectType);
  if (from) rows = rows.filter((a) => a.created_at >= from);
  if (to) rows = rows.filter((a) => a.created_at <= to);
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return HttpResponse.json({
    items: paginate(rows, page, pageSize).map((a) => ({ ...a })),
    total: rows.length,
    page,
    page_size: pageSize,
  });
});

export const handlers = [
  loginHandler,
  logoutHandler,
  refreshHandler,
  meHandler,
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  resetPasswordHandler,
  listGroupsHandler,
  createGroupHandler,
  updateGroupHandler,
  changeMembersHandler,
  listProvidersHandler,
  syncProvidersHandler,
  listModelsHandler,
  patchModelHandler,
  listGrantsHandler,
  createGrantHandler,
  deleteGrantHandler,
  effectiveModelsHandler,
  listUsageHandler,
  listConversationsHandler,
  readMessagesHandler,
  listAuditHandler,
];
