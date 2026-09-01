/**
 * Mock 后端纯逻辑（可被单测直接覆盖）：
 * 有效模型计算、Provider 无密钥同步、正文过滤分页、审计、登录限流等。
 * 规则来源：docs/system-requirements.md §5、docs/program-design.md §4.3/§8.4。
 */
import type { HubDb } from './db';
import type {
  SeedConversation,
  SeedGrant,
  SeedGroup,
  SeedModel,
  SeedUsage,
  SeedUser,
  SessionEntry,
} from './fixtures';
import type {
  AdminConversation,
  AdminGroup,
  AdminUser,
  AuditAction,
  AuditEntry,
  EffectiveModel,
  Grant,
  MessageStatus,
  ModelSummary,
  ProviderRegistration,
  ReviewFeedback,
  UsageRecord,
  UsageSummary,
  VisibleMessage,
} from '@/api/types';

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize) || 10));
  return items.slice((safePage - 1) * safeSize, safePage * safeSize);
}

export function clampPageSize(pageSize: number | undefined, fallback = 10): number {
  const size = Math.trunc(pageSize ?? fallback);
  if (!Number.isFinite(size) || size < 1) {
    return fallback;
  }
  return Math.min(100, size);
}

export function normalizePage(page: number | undefined): number {
  const value = Math.trunc(page ?? 1);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 用户 / 用户组
// ---------------------------------------------------------------------------

export function findUser(db: HubDb, id: string): SeedUser | undefined {
  return db.users.find((u) => u.id === id);
}

export function findGroup(db: HubDb, id: string): SeedGroup | undefined {
  return db.groups.find((g) => g.id === id);
}

export function findModel(db: HubDb, id: string): SeedModel | undefined {
  return db.models.find((m) => m.id === id);
}

/** 用户所属且处于启用状态的组。 */
export function userActiveGroupIds(db: HubDb, userId: string): string[] {
  return db.groups.filter((g) => g.status === 'active' && g.member_ids.includes(userId)).map((g) => g.id);
}

export function validateNewUser(payload: {
  username?: string;
  nickname?: string;
  email?: string;
  role?: string;
  password?: string;
}): string | null {
  if (!payload || typeof payload.username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(payload.username)) {
    return '用户名需为 3-32 位字母、数字或下划线';
  }
  if (!payload.nickname || payload.nickname.trim().length === 0 || payload.nickname.length > 32) {
    return '昵称不能为空且不超过 32 个字符';
  }
  if (!payload.email || !/^\S+@\S+\.\S+$/.test(payload.email)) {
    return '邮箱格式不正确';
  }
  if (payload.role !== 'admin' && payload.role !== 'user') {
    return '角色只能是 admin 或 user';
  }
  if (payload.password !== undefined && payload.password.length < 8) {
    return '密码长度至少 8 位';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8 || password.length > 64) {
    return '密码长度需为 8-64 位';
  }
  return null;
}

/** 响应映射白名单：绝不输出 password。 */
export function toAdminUser(db: HubDb, user: SeedUser): AdminUser {
  const groups = db.groups.filter((g) => g.member_ids.includes(user.id));
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    role: user.role,
    status: user.status,
    group_ids: groups.map((g) => g.id),
    group_names: groups.map((g) => g.name),
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export function toAdminGroup(group: SeedGroup): AdminGroup {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    status: group.status,
    member_ids: [...group.member_ids],
    member_count: group.member_ids.length,
    created_at: group.created_at,
    updated_at: group.updated_at,
  };
}

// ---------------------------------------------------------------------------
// 有效模型（唯一计算函数，模型列表与预览共用）
// ---------------------------------------------------------------------------

export function computeEffectiveModels(db: HubDb, userId: string): EffectiveModel[] {
  const user = findUser(db, userId);
  if (!user || user.status !== 'active') {
    return [];
  }
  const groupIds = new Set(userActiveGroupIds(db, userId));
  const candidateModelIds = new Set<string>();
  for (const grant of db.grants) {
    if (grant.subject_type === 'user' && grant.subject_id === userId) {
      candidateModelIds.add(grant.model_id);
    } else if (grant.subject_type === 'group' && groupIds.has(grant.subject_id)) {
      candidateModelIds.add(grant.model_id);
    }
  }
  const items = db.models
    .filter((m) => candidateModelIds.has(m.id) && m.enabled && m.available)
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      upstream_model_id: m.upstream_model_id,
    }));
  items.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return items;
}

// ---------------------------------------------------------------------------
// Provider 无密钥同步
// ---------------------------------------------------------------------------

export interface ProviderManifest {
  provider: string;
  name: string;
  models: Array<{ upstream_model_id: string; name: string }>;
}

/** 模拟 PI 返回的无密钥清单（不含任何 Key / 凭据字段）。 */
export const SUCCESS_MANIFEST: ProviderManifest[] = [
  {
    provider: 'glm',
    name: '智谱 GLM',
    models: [
      { upstream_model_id: 'glm-4-flash', name: 'GLM-4-Flash' },
      { upstream_model_id: 'glm-4-air', name: 'GLM-4-Air' },
      { upstream_model_id: 'glm-4-plus', name: 'GLM-4-Plus' },
    ],
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    models: [{ upstream_model_id: 'deepseek-chat', name: 'DeepSeek Chat' }],
  },
];

function modelId(provider: string, upstreamId: string): string {
  return `m_${provider}_${upstreamId.replace(/[^a-zA-Z0-9-]/g, '_')}`;
}

/**
 * 同步成功：
 * - 新模型默认停用（enabled=false）；
 * - 清单缺失的模型 available=false，但保留既有 enabled 状态和全部授权；
 * - 既有模型保持 enabled 不变；
 * - Provider 状态恢复 active，刷新 last_synced_at。
 */
export function applyProviderSyncSuccess(
  db: HubDb,
  manifest: ProviderManifest[],
  now: string,
): void {
  for (const entry of manifest) {
    let provider = db.providers.find((p) => p.provider === entry.provider);
    if (!provider) {
      provider = { provider: entry.provider, name: entry.name, status: 'active', last_synced_at: now };
      db.providers.push(provider);
    }
    provider.name = entry.name;
    provider.status = 'active';
    provider.last_synced_at = now;

    const upstreamIds = new Set(entry.models.map((m) => m.upstream_model_id));
    for (const incoming of entry.models) {
      const existing = db.models.find(
        (m) => m.provider === entry.provider && m.upstream_model_id === incoming.upstream_model_id,
      );
      if (existing) {
        existing.name = incoming.name;
        existing.available = true;
      } else {
        db.models.push({
          id: modelId(entry.provider, incoming.upstream_model_id),
          provider: entry.provider,
          upstream_model_id: incoming.upstream_model_id,
          name: incoming.name,
          enabled: false,
          available: true,
        });
      }
    }
    for (const model of db.models) {
      if (model.provider === entry.provider && !upstreamIds.has(model.upstream_model_id)) {
        model.available = false;
      }
    }
  }
  db.lastSyncError = null;
}

/** 同步失败：保留旧快照、保留 last_synced_at，仅把状态标记为 stale。 */
export function applyProviderSyncFailure(db: HubDb, code: string, message: string): void {
  for (const provider of db.providers) {
    provider.status = 'stale';
  }
  db.lastSyncError = { code, message };
}

/** Provider / Model 响应字段白名单映射。 */
export function toModelSummary(model: SeedModel): ModelSummary {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    upstream_model_id: model.upstream_model_id,
    enabled: model.enabled,
    available: model.available,
  };
}

export function toProviderRegistration(db: HubDb, provider: {
  provider: string;
  name: string;
  status: 'active' | 'stale';
  last_synced_at: string | null;
}): ProviderRegistration {
  return {
    provider: provider.provider,
    name: provider.name,
    status: provider.status,
    last_synced_at: provider.last_synced_at,
    models: db.models.filter((m) => m.provider === provider.provider).map(toModelSummary),
  };
}

// ---------------------------------------------------------------------------
// 会话与正文
// ---------------------------------------------------------------------------

export function computeConversationStatus(
  db: HubDb,
  conversation: SeedConversation,
): 'active' | 'generating' | 'readonly' {
  if (conversation.generating) {
    return 'generating';
  }
  const effective = computeEffectiveModels(db, conversation.owner_id);
  if (!effective.some((m) => m.id === conversation.model_id)) {
    return 'readonly';
  }
  return 'active';
}

export function countVisibleMessages(entries: SessionEntry[]): number {
  return entries.filter((e) => e.kind === 'message').length;
}

export function toAdminConversation(db: HubDb, conversation: SeedConversation): AdminConversation {
  const owner = findUser(db, conversation.owner_id);
  const model = findModel(db, conversation.model_id);
  return {
    id: conversation.id,
    owner_id: conversation.owner_id,
    owner_username: owner?.username ?? conversation.owner_id,
    model_id: conversation.model_id,
    model_name: model?.name ?? conversation.model_id,
    title: conversation.title,
    status: computeConversationStatus(db, conversation),
    hidden: conversation.hidden,
    message_count: countVisibleMessages(db.sessions[conversation.id] ?? []),
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  };
}

/** 正文白名单：只输出 id/role/content/status/created_at，过滤 thinking、control、tool_call。 */
export function filterVisibleEntries(
  entries: SessionEntry[],
  since: string | null,
  limit: number,
): { items: VisibleMessage[]; next_since: string | null; has_more: boolean } {
  const visible = entries.filter((e) => e.kind === 'message') as Array<{
    kind: 'message';
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'completed' | 'aborted' | 'error';
    created_at: string;
  }>;
  const after = since ? visible.filter((e) => e.id > since) : visible;
  const slice = after.slice(0, Math.max(1, limit));
  const items: VisibleMessage[] = slice.map((e) => ({
    id: e.id,
    role: e.role,
    content: e.content,
    status: e.status satisfies MessageStatus,
    created_at: e.created_at,
  }));
  const hasMore = after.length > items.length;
  const nextSince = items.length > 0 ? items[items.length - 1]!.id : since;
  return { items, next_since: nextSince, has_more: hasMore };
}

// ---------------------------------------------------------------------------
// 授权
// ---------------------------------------------------------------------------

export function toGrant(db: HubDb, grant: SeedGrant): Grant {
  const subjectName =
    grant.subject_type === 'user'
      ? (findUser(db, grant.subject_id)?.nickname ?? grant.subject_id)
      : (findGroup(db, grant.subject_id)?.name ?? grant.subject_id);
  return {
    subject_type: grant.subject_type,
    subject_id: grant.subject_id,
    subject_name: subjectName,
    model_id: grant.model_id,
    model_name: findModel(db, grant.model_id)?.name ?? grant.model_id,
    created_at: grant.created_at,
  };
}

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------

export function toUsageRecord(db: HubDb, record: SeedUsage): UsageRecord {
  return {
    request_id: record.request_id,
    conversation_id: record.conversation_id,
    user_id: record.user_id,
    username: findUser(db, record.user_id)?.username ?? record.user_id,
    model_id: record.model_id,
    model_name: findModel(db, record.model_id)?.name ?? record.model_id,
    status: record.status,
    started_at: record.started_at,
    ended_at: record.ended_at,
    input_tokens: record.input_tokens,
    output_tokens: record.output_tokens,
    total_tokens: record.total_tokens,
  };
}

/** 汇总：只统计已知值，未知记录数单列，不伪造估算值。 */
export function usageSummary(records: UsageRecord[]): UsageSummary {
  const sum = (pick: (r: UsageRecord) => number | null): number | null => {
    const known = records.map(pick).filter((v): v is number => typeof v === 'number');
    if (known.length === 0) {
      return null;
    }
    return known.reduce((acc, v) => acc + v, 0);
  };
  return {
    calls: records.length,
    success: records.filter((r) => r.status === 'success').length,
    error: records.filter((r) => r.status === 'error').length,
    aborted: records.filter((r) => r.status === 'aborted').length,
    input_tokens: sum((r) => r.input_tokens),
    output_tokens: sum((r) => r.output_tokens),
    total_tokens: sum((r) => r.total_tokens),
    unknown_token_records: records.filter((r) => r.total_tokens === null).length,
  };
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export interface NewAuditEntry {
  actor_id: string;
  actor_username: string;
  action: AuditAction;
  object_type: string;
  object_id: string;
  result: 'success' | 'failed';
  detail: string;
  trace_id?: string;
}

export function appendAudit(db: HubDb, entry: NewAuditEntry, now: string, traceId?: string): AuditEntry {
  const id = `audit_${String(db.seq.audit).padStart(4, '0')}`;
  db.seq.audit += 1;
  const trace = entry.trace_id ?? traceId ?? `tr_${Math.random().toString(36).slice(2, 10)}`;
  const row: AuditEntry = {
    id,
    actor_id: entry.actor_id,
    actor_username: entry.actor_username,
    action: entry.action,
    object_type: entry.object_type,
    object_id: entry.object_id,
    result: entry.result,
    detail: entry.detail,
    trace_id: trace,
    created_at: now,
  };
  db.audit.push({
    id: row.id,
    actor_id: row.actor_id,
    actor_username: row.actor_username,
    action: row.action,
    object_type: row.object_type,
    object_id: row.object_id,
    result: row.result,
    detail: row.detail,
    trace_id: row.trace_id,
    created_at: row.created_at,
  });
  return row;
}

export function makeReviewFeedback(recorded: boolean, traceId: string, result: 'success' | 'failed'): ReviewFeedback {
  return { recorded, trace_id: traceId, result };
}

// ---------------------------------------------------------------------------
// 登录限流（AUTH-06 mock）
// ---------------------------------------------------------------------------

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_COOLDOWN_MS = 60_000;

export function checkLoginAllowed(
  db: HubDb,
  username: string,
  nowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const state = db.loginAttempts[username];
  if (!state || state.limitedUntil === null) {
    return { allowed: true, retryAfterMs: 0 };
  }
  if (nowMs >= state.limitedUntil) {
    db.loginAttempts[username] = { failures: 0, limitedUntil: null };
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: false, retryAfterMs: state.limitedUntil - nowMs };
}

export function recordLoginFailure(db: HubDb, username: string, nowMs: number): void {
  const state = db.loginAttempts[username] ?? { failures: 0, limitedUntil: null };
  state.failures += 1;
  if (state.failures >= LOGIN_MAX_FAILURES) {
    state.limitedUntil = nowMs + LOGIN_COOLDOWN_MS;
    state.failures = 0;
  }
  db.loginAttempts[username] = state;
}

export function recordLoginSuccess(db: HubDb, username: string): void {
  delete db.loginAttempts[username];
}
