/**
 * MSW mock 网关：逐字段镜像真实后端（backend/api/internal/handler/hub/handler.go）
 * 的线格式，使 mock 模式与 VITE_USE_MOCK=false 的真实路径走完全相同的归一代码：
 *
 * - 响应是 Go 结构体直接序列化：字段名 ID/Name/Status/Provider/LastSyncedAt/
 *   SubjectType/RequestID/StartedAt…（Go 风格大小写）；错误信封是
 *   {"error":{"Code","Message","RequestID"}}，参数校验类 400/409 是 {"error":"<字符串>"}；
 * - users/grants/usage/audit 的 items 是数组；groups/providers/models/conversations
 *   的 items 是「以 ID 为键的对象」；空列表可能为 items:null；
 * - 请求体按 DisallowUnknownFields 语义做白名单校验（未知字段一律 400），
 *   grants 的键必须是 SubjectType/SubjectID/ModelID，DELETE 从请求体解码；
 * - 密码至少 12 位；审计动作是 user.create / provider.sync / model.update /
 *   grant.create / conversation.review；正文审阅先写审计再返回（无 review 反馈字段）。
 *
 * 仅拦截 /api/v1/*；不访问任何真实后端、Provider 或外网。
 */
import { API_BASE_URL } from '@/config';
import { db } from './db';
import {
  SUCCESS_MANIFEST,
  applyProviderSyncFailure,
  applyProviderSyncSuccess,
  checkLoginAllowed,
  computeEffectiveModels,
  filterVisibleEntries,
  findGroup,
  findModel,
  findUser,
  recordLoginFailure,
  recordLoginSuccess,
  validateUsername,
} from './logic';
import { decodeMockSession, type MockSession } from './session';
import type { SeedConversation, SeedGroup, SeedModel, SeedUser } from './fixtures';
import { delay, HttpResponse, http, type DefaultBodyType, type StrictRequest } from 'msw';

type JsonResponse = ReturnType<typeof HttpResponse.json>;
type MockRequest = StrictRequest<DefaultBodyType>;

const P = API_BASE_URL;

/** 与真实后端 pbkdf2 哈希前的密码策略一致。 */
const MIN_PASSWORD_LENGTH = 12;

function nowIso(): string {
  return new Date().toISOString();
}

function requestID(): string {
  return `req_${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** Go 风格错误信封（键名为 Code/Message/RequestID）。 */
function jsonError(status: number, code: string, message: string): JsonResponse {
  return HttpResponse.json(
    { error: { Code: code, Message: message, RequestID: requestID() } },
    { status },
  );
}

/** 字符串形错误（镜像后端参数校验 / 重名的响应形态）。 */
function stringError(status: number, message: string): JsonResponse {
  return HttpResponse.json({ error: message }, { status });
}

const PUBLIC_MESSAGE: Record<string, string> = {
  UNAUTHENTICATED: '请先登录',
  FORBIDDEN: '无权执行此操作',
  MODEL_NOT_AUTHORIZED: '当前用户无权使用该模型',
  NOT_FOUND: '资源不存在',
  PI_UNAVAILABLE: '服务暂时不可用',
};

interface AdminContext {
  session: MockSession;
  userId: string;
  username: string;
}

function resolveActor(request: MockRequest): { session: MockSession | null; user: SeedUser | undefined } {
  const session = decodeMockSession(request.headers.get('x-mock-session'));
  if (!session) {
    return { session: null, user: undefined };
  }
  return { session, user: findUser(db, session.user_id) };
}

function requireAdmin(request: MockRequest): { actor: AdminContext } | { response: JsonResponse } {
  const { session, user } = resolveActor(request);
  if (!session || !user || user.status !== 'active') {
    return { response: jsonError(401, 'UNAUTHENTICATED', PUBLIC_MESSAGE.UNAUTHENTICATED) };
  }
  if (user.role !== 'admin') {
    return { response: jsonError(403, 'FORBIDDEN', PUBLIC_MESSAGE.FORBIDDEN) };
  }
  return { actor: { session, userId: user.id, username: user.username } };
}

/**
 * 镜像 Go json.Decoder + DisallowUnknownFields：
 * 未知键（大小写不敏感比较）一律 400 {"error":"invalid request"}。
 */
async function strictBody(
  request: MockRequest,
  allowedKeys: string[],
): Promise<Record<string, unknown> | JsonResponse> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return stringError(400, 'invalid request');
  }
  const allowed = new Set(allowedKeys.map((key) => key.toLowerCase()));
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key.toLowerCase())) {
      return stringError(400, 'invalid request');
    }
  }
  return parsed as Record<string, unknown>;
}

/** Go 字段名大小写不敏感取值。 */
function field(body: Record<string, unknown>, goName: string): unknown {
  const direct = body[goName];
  if (direct !== undefined) {
    return direct;
  }
  const lower = goName.toLowerCase();
  for (const [key, value] of Object.entries(body)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

function fieldString(body: Record<string, unknown>, goName: string): string {
  const value = field(body, goName);
  return typeof value === 'string' ? value : '';
}

function fieldStringArray(body: Record<string, unknown>, goName: string): string[] {
  const value = field(body, goName);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function fieldBool(body: Record<string, unknown>, goName: string): boolean {
  const value = field(body, goName);
  return value === true;
}

// ---------------------------------------------------------------------------
// 审计（动作与后端一致：user.create / provider.sync / model.update / grant.create /
// conversation.review；成功与失败都记录）
// ---------------------------------------------------------------------------

function appendWireAudit(entry: {
  actor_id: string;
  action: string;
  object_type: string;
  object_id: string;
  result: 'success' | 'failed';
}): void {
  db.audit.push({
    id: `audit_${String(db.seq.audit).padStart(4, '0')}`,
    actor_id: entry.actor_id,
    actor_username: '',
    action: entry.action,
    object_type: entry.object_type,
    object_id: entry.object_id,
    result: entry.result,
    detail: '',
    trace_id: requestID(),
    created_at: nowIso(),
  });
  db.seq.audit += 1;
}

// ---------------------------------------------------------------------------
// db → 线格式映射（Go 风格键）
// ---------------------------------------------------------------------------

function wireUser(user: SeedUser): Record<string, string> {
  return { id: user.id, username: user.username, role: user.role, status: user.status };
}

function wireGroup(group: SeedGroup): Record<string, string> {
  return { ID: group.id, Name: group.name, Status: group.status };
}

function wireProvider(provider: { provider: string; name: string; status: string; last_synced_at: string | null }): Record<string, string> {
  // 镜像 Go time.Time：零值序列化为 0001-01-01T00:00:00Z。
  return {
    Provider: provider.provider,
    Name: provider.name,
    Status: provider.status,
    LastSyncedAt: provider.last_synced_at ?? '0001-01-01T00:00:00Z',
  };
}

function wireModel(model: SeedModel): Record<string, unknown> {
  return {
    ID: model.id,
    Provider: model.provider,
    UpstreamModelID: model.upstream_model_id,
    Name: model.name,
    Enabled: model.enabled,
    Available: model.available,
  };
}

function wireGrant(grant: { subject_type: string; subject_id: string; model_id: string }): Record<string, string> {
  return { SubjectType: grant.subject_type, SubjectID: grant.subject_id, ModelID: grant.model_id };
}

function wireConversation(conversation: SeedConversation): Record<string, unknown> {
  return {
    ID: conversation.id,
    OwnerID: conversation.owner_id,
    ModelID: conversation.model_id,
    // 真实后端会返回该字段（内部引用）；前端归一层丢弃，永不展示。
    SessionRef: conversation.pi_session_ref,
    Title: conversation.title,
    Hidden: conversation.hidden,
    CreatedAt: conversation.created_at,
    UpdatedAt: conversation.updated_at,
  };
}

function wireUsage(record: (typeof db.usage)[number]): Record<string, unknown> {
  return {
    RequestID: record.request_id,
    ConversationID: record.conversation_id,
    UserID: record.user_id,
    ModelID: record.model_id,
    Status: record.status,
    InputTokens: record.input_tokens,
    OutputTokens: record.output_tokens,
    CachedTokens: null,
    TotalTokens: record.total_tokens,
    StartedAt: record.started_at,
    EndedAt: record.ended_at,
  };
}

function wireAudit(entry: (typeof db.audit)[number]): Record<string, unknown> {
  return {
    ActorID: entry.actor_id,
    Action: entry.action,
    ObjectType: entry.object_type,
    ObjectID: entry.object_id,
    Result: entry.result,
    TraceID: entry.trace_id,
    CreatedAt: entry.created_at,
  };
}

function emptyMode(): boolean {
  return db.scenario.emptyMode;
}

// ---------------------------------------------------------------------------
// 认证（镜像 §6.2 + 后端行为）
// ---------------------------------------------------------------------------

const loginHandler = http.post(`${P}/auth/login`, async ({ request }) => {
  const body = await strictBody(request, ['Username', 'Password']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const username = fieldString(body, 'Username');
  const password = fieldString(body, 'Password');

  const limit = checkLoginAllowed(db, username, Date.now());
  if (!limit.allowed) {
    return jsonError(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请稍后再试');
  }
  const user = db.users.find((u) => u.username === username);
  if (!user || user.password !== password) {
    recordLoginFailure(db, username, Date.now());
    return jsonError(401, 'UNAUTHENTICATED', PUBLIC_MESSAGE.UNAUTHENTICATED);
  }
  if (user.status !== 'active') {
    return jsonError(403, 'FORBIDDEN', PUBLIC_MESSAGE.FORBIDDEN);
  }
  recordLoginSuccess(db, username);
  return HttpResponse.json({ user: { id: user.id, username: user.username, role: user.role, status: user.status } });
});

const logoutHandler = http.post(`${P}/auth/logout`, () => new HttpResponse(null, { status: 204 }));

const refreshHandler = http.post(`${P}/auth/refresh`, ({ request }) => {
  const { user } = resolveActor(request);
  if (!user || user.status !== 'active') {
    return jsonError(401, 'UNAUTHENTICATED', PUBLIC_MESSAGE.UNAUTHENTICATED);
  }
  return HttpResponse.json({ user: { id: user.id, username: user.username, role: user.role, status: user.status } });
});

const meHandler = http.get(`${P}/auth/me`, ({ request }) => {
  const { user } = resolveActor(request);
  if (!user || user.status !== 'active') {
    return jsonError(401, 'UNAUTHENTICATED', PUBLIC_MESSAGE.UNAUTHENTICATED);
  }
  return HttpResponse.json({ id: user.id, username: user.username, role: user.role, status: user.status });
});

// ---------------------------------------------------------------------------
// 用户管理（镜像 admin users）
// ---------------------------------------------------------------------------

const listUsersHandler = http.get(`${P}/admin/users`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  if (emptyMode()) {
    return HttpResponse.json({ items: [] });
  }
  return HttpResponse.json({ items: db.users.map(wireUser) });
});

const createUserHandler = http.post(`${P}/admin/users`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const body = await strictBody(request, ['Username', 'Password', 'Role']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const username = fieldString(body, 'Username');
  const password = fieldString(body, 'Password');
  const role = fieldString(body, 'Role');
  if (username === '') {
    return stringError(400, 'invalid request');
  }
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return stringError(409, 'username exists');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return stringError(400, 'password must be at least 12 characters');
  }
  const invalid = validateUsername(username);
  if (invalid) {
    return stringError(400, 'invalid request');
  }
  const now = nowIso();
  const id = `u_${db.seq.user}`;
  db.seq.user += 1;
  const user = {
    id,
    username,
    password,
    nickname: '',
    email: '',
    role: role === 'admin' ? ('admin' as const) : ('user' as const),
    status: 'active' as const,
    created_at: now,
    updated_at: now,
  };
  db.users.push(user);
  appendWireAudit({ actor_id: guard.actor.userId, action: 'user.create', object_type: 'user', object_id: id, result: 'success' });
  return HttpResponse.json(wireUser(user), { status: 201 });
});

const resetPasswordHandler = http.post(`${P}/admin/users/:id/reset-password`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const user = findUser(db, String(params.id));
  if (!user) {
    return jsonError(404, 'NOT_FOUND', PUBLIC_MESSAGE.NOT_FOUND);
  }
  const body = await strictBody(request, ['Password']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const password = fieldString(body, 'Password');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return stringError(400, 'password must be at least 12 characters');
  }
  user.password = password;
  user.updated_at = nowIso();
  return new HttpResponse(null, { status: 204 });
});

const updateUserHandler = http.patch(`${P}/admin/users/:id`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const user = findUser(db, String(params.id));
  if (!user) {
    return jsonError(404, 'NOT_FOUND', PUBLIC_MESSAGE.NOT_FOUND);
  }
  const body = await strictBody(request, ['Status', 'Role']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const status = fieldString(body, 'Status');
  const role = fieldString(body, 'Role');
  if (status === 'active' || status === 'disabled') {
    user.status = status;
  }
  if (role === 'admin' || role === 'user') {
    user.role = role;
  }
  user.updated_at = nowIso();
  return HttpResponse.json(wireUser(user));
});

// ---------------------------------------------------------------------------
// 用户组管理（items 为对象，键为组 ID）
// ---------------------------------------------------------------------------

const listGroupsHandler = http.get(`${P}/admin/groups`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  if (emptyMode()) {
    return HttpResponse.json({ items: {} });
  }
  const items: Record<string, Record<string, string>> = {};
  for (const group of db.groups) {
    items[group.id] = wireGroup(group);
  }
  return HttpResponse.json({ items });
});

const createGroupHandler = http.post(`${P}/admin/groups`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const body = await strictBody(request, ['ID', 'Name', 'Status']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const name = fieldString(body, 'Name');
  if (!name.trim()) {
    return stringError(400, 'invalid request');
  }
  const now = nowIso();
  const id = `g_${db.seq.group}`;
  db.seq.group += 1;
  const group = { id, name, description: '', status: 'active' as const, member_ids: [], created_at: now, updated_at: now };
  db.groups.push(group);
  return HttpResponse.json(wireGroup(group), { status: 201 });
});

const updateGroupHandler = http.patch(`${P}/admin/groups/:id`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const group = findGroup(db, String(params.id));
  if (!group) {
    return jsonError(404, 'NOT_FOUND', PUBLIC_MESSAGE.NOT_FOUND);
  }
  const body = await strictBody(request, ['ID', 'Name', 'Status']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const name = fieldString(body, 'Name');
  const status = fieldString(body, 'Status');
  if (name !== '') {
    group.name = name;
  }
  if (status === 'active' || status === 'disabled') {
    group.status = status;
  }
  group.updated_at = nowIso();
  return HttpResponse.json(wireGroup(group));
});

const changeMembersHandler = http.patch(`${P}/admin/groups/:id/members`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const group = findGroup(db, String(params.id));
  if (!group) {
    return jsonError(404, 'NOT_FOUND', PUBLIC_MESSAGE.NOT_FOUND);
  }
  const body = await strictBody(request, ['add_user_ids', 'remove_user_ids']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const add = fieldStringArray(body, 'add_user_ids');
  const remove = fieldStringArray(body, 'remove_user_ids');
  const next = new Set(group.member_ids);
  for (const id of add) {
    next.add(id);
  }
  for (const id of remove) {
    next.delete(id);
  }
  group.member_ids = [...next];
  group.updated_at = nowIso();
  return HttpResponse.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Provider 登记（items 为对象，键为 provider；不含模型清单）
// ---------------------------------------------------------------------------

const listProvidersHandler = http.get(`${P}/admin/providers`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const items: Record<string, Record<string, string>> = {};
  for (const provider of db.providers) {
    items[provider.provider] = wireProvider(provider);
  }
  return HttpResponse.json({ items });
});

const syncProvidersHandler = http.post(`${P}/admin/providers/sync`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  await delay(400);
  if (db.scenario.syncOutcome === 'failure') {
    applyProviderSyncFailure(db, 'PI_UNAVAILABLE', 'PI Agent 暂不可用');
    appendWireAudit({ actor_id: guard.actor.userId, action: 'provider.sync', object_type: 'provider', object_id: '', result: 'failed' });
    return jsonError(502, 'PI_UNAVAILABLE', PUBLIC_MESSAGE.PI_UNAVAILABLE);
  }
  applyProviderSyncSuccess(db, SUCCESS_MANIFEST, nowIso());
  appendWireAudit({ actor_id: guard.actor.userId, action: 'provider.sync', object_type: 'provider', object_id: '', result: 'success' });
  const items: Record<string, Record<string, string>> = {};
  for (const provider of db.providers) {
    items[provider.provider] = wireProvider(provider);
  }
  return HttpResponse.json({ items });
});

// ---------------------------------------------------------------------------
// Model 启停 / 授权 / 有效模型预览（models 的 items 为对象，键为模型 ID）
// ---------------------------------------------------------------------------

const listModelsHandler = http.get(`${P}/admin/models`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const items: Record<string, Record<string, unknown>> = {};
  for (const model of db.models) {
    items[model.id] = wireModel(model);
  }
  return HttpResponse.json({ items });
});

const patchModelHandler = http.patch(`${P}/admin/models/:id`, async ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const model = findModel(db, String(params.id));
  if (!model) {
    return jsonError(404, 'NOT_FOUND', PUBLIC_MESSAGE.NOT_FOUND);
  }
  const body = await strictBody(request, ['ID', 'Enabled']);
  if (body instanceof HttpResponse) {
    return body;
  }
  model.enabled = fieldBool(body, 'Enabled');
  appendWireAudit({ actor_id: guard.actor.userId, action: 'model.update', object_type: 'model', object_id: model.id, result: 'success' });
  return HttpResponse.json(wireModel(model));
});

const listGrantsHandler = http.get(`${P}/admin/grants`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  return HttpResponse.json({ items: db.grants.map(wireGrant) });
});

const createGrantHandler = http.post(`${P}/admin/grants`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  // 镜像后端：Grant 结构体未打 json tag，键必须是 SubjectType/SubjectID/ModelID。
  const body = await strictBody(request, ['SubjectType', 'SubjectID', 'ModelID']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const subjectType = fieldString(body, 'SubjectType');
  const subjectID = fieldString(body, 'SubjectID');
  const modelID = fieldString(body, 'ModelID');
  if (subjectType !== 'user' && subjectType !== 'group') {
    return new HttpResponse(null, { status: 400 });
  }
  const grant = { subject_type: subjectType as 'user' | 'group', subject_id: subjectID, model_id: modelID, created_at: nowIso() };
  if (db.grants.some((g) => g.subject_type === grant.subject_type && g.subject_id === grant.subject_id && g.model_id === grant.model_id)) {
    return new HttpResponse(null, { status: 400 });
  }
  db.grants.push(grant);
  appendWireAudit({ actor_id: guard.actor.userId, action: 'grant.create', object_type: 'model', object_id: grant.model_id, result: 'success' });
  return HttpResponse.json(wireGrant(grant), { status: 201 });
});

const deleteGrantHandler = http.delete(`${P}/admin/grants`, async ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  // 镜像后端：DELETE 从请求体解码三项定位。
  const body = await strictBody(request, ['SubjectType', 'SubjectID', 'ModelID']);
  if (body instanceof HttpResponse) {
    return body;
  }
  const subjectType = fieldString(body, 'SubjectType');
  const subjectID = fieldString(body, 'SubjectID');
  const modelID = fieldString(body, 'ModelID');
  const index = db.grants.findIndex(
    (g) => g.subject_type === subjectType && g.subject_id === subjectID && g.model_id === modelID,
  );
  if (index < 0) {
    // 后端对不存在的授权同样返回 204（RemoveGrant 是幂等删除）。
    return new HttpResponse(null, { status: 204 });
  }
  db.grants.splice(index, 1);
  return new HttpResponse(null, { status: 204 });
});

const effectiveModelsHandler = http.get(`${P}/admin/users/:id/effective-models`, ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const items = computeEffectiveModels(db, String(params.id)).map((model) => ({
    ID: model.id,
    Name: model.name,
    Provider: model.provider,
    UpstreamModelID: model.upstream_model_id,
  }));
  return HttpResponse.json({ items });
});

// ---------------------------------------------------------------------------
// 全局用量
// ---------------------------------------------------------------------------

const listUsageHandler = http.get(`${P}/admin/usage`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const userId = url.searchParams.get('user_id');
  const modelId = url.searchParams.get('model_id');
  let rows = [...db.usage];
  if (from) rows = rows.filter((r) => r.started_at >= from);
  if (to) rows = rows.filter((r) => r.started_at <= to);
  if (userId) rows = rows.filter((r) => r.user_id === userId);
  if (modelId) rows = rows.filter((r) => r.model_id === modelId);
  return HttpResponse.json({ items: rows.map(wireUsage) });
});

// ---------------------------------------------------------------------------
// 会话索引 / 正文审阅（conversations 的 items 为对象；正文 Items 可为 null）
// ---------------------------------------------------------------------------

const listConversationsHandler = http.get(`${P}/admin/conversations`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  if (emptyMode()) {
    return HttpResponse.json({ items: {} });
  }
  const items: Record<string, Record<string, unknown>> = {};
  for (const conversation of db.conversations) {
    items[conversation.id] = wireConversation(conversation);
  }
  return HttpResponse.json({ items });
});

const readMessagesHandler = http.get(`${P}/admin/conversations/:id/messages`, ({ request, params }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  const conversation = db.conversations.find((c) => c.id === String(params.id));
  if (!conversation) {
    appendWireAudit({ actor_id: guard.actor.userId, action: 'conversation.review', object_type: 'conversation', object_id: String(params.id), result: 'failed' });
    return jsonError(404, 'NOT_FOUND', PUBLIC_MESSAGE.NOT_FOUND);
  }
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 50;

  // 先写审阅审计（成功 / 失败都记录，AU-11），再读取正文。
  const piUnavailable = db.scenario.piUnavailableConversations.includes(conversation.id);
  appendWireAudit({
    actor_id: guard.actor.userId,
    action: 'conversation.review',
    object_type: 'conversation',
    object_id: conversation.id,
    result: piUnavailable ? 'failed' : 'success',
  });
  if (piUnavailable) {
    return jsonError(502, 'PI_UNAVAILABLE', '服务暂时不可用');
  }
  const entries = db.sessions[conversation.id] ?? [];
  const filtered = filterVisibleEntries(entries, since, limit);
  // 镜像后端：Items 是 []Message（空时为 null）、键为 Go 风格。
  const items = filtered.items.map((entry) => ({
    ID: entry.id,
    Role: entry.role,
    Content: entry.content,
    Status: entry.status,
    CreatedAt: entry.created_at,
  }));
  return HttpResponse.json({
    Items: items.length > 0 ? items : null,
    NextSince: filtered.next_since ?? '',
    HasMore: filtered.has_more,
  });
});

// ---------------------------------------------------------------------------
// 审计（items 为数组，空时为 null）
// ---------------------------------------------------------------------------

const listAuditHandler = http.get(`${P}/admin/audit`, ({ request }) => {
  const guard = requireAdmin(request);
  if ('response' in guard) {
    return guard.response;
  }
  if (emptyMode()) {
    return HttpResponse.json({ items: null });
  }
  return HttpResponse.json({ items: db.audit.map(wireAudit) });
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
