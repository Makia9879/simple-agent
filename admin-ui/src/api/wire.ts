/**
 * 真实后端线格式（wire format）归一层。
 *
 * 背景：真实后端（backend/api/internal/handler/hub/handler.go）直接用 encoding/json
 * 序列化未打 json tag 的 Go 结构体，因此：
 *  - 字段名是 ID/Name/Status/Provider/LastSyncedAt/SubjectType 等 Go 风格拼写；
 *  - users/grants/usage/audit 的 items 是数组，groups/providers/models/conversations
 *    的 items 是「以 ID 为键的对象」；
 *  - 空列表可能序列化为 items:null（nil 切片）；
 *  - 错误信封是 {"error":{"Code","Message","RequestID"}}，部分 400/409 是
 *    {"error":"<字符串>"}。
 *
 * docs/program-design.md §6 冻结契约使用 snake_case。本模块对两种拼写都兼容：
 * 读取时逐字段取第一个非空候选键；写入侧的请求体键由各 api module 按真实后端的
 * 校验规则（DisallowUnknownFields + 字段名大小写不敏感匹配）白名单生成。
 */
import type {
  AdminConversation,
  AdminGroup,
  AdminUser,
  AuditEntry,
  EffectiveModel,
  Grant,
  GroupStatus,
  MessageStatus,
  ModelSummary,
  ProviderRegistration,
  ProviderStatus,
  Role,
  SubjectType,
  UsageRecord,
  UsageStatus,
  UserStatus,
  VisibleMessage,
} from './types';

export type WireObject = Record<string, unknown>;

/** 从候选键中取第一个非 undefined 的原始值。 */
function raw(obj: WireObject | null | undefined, keys: string[]): unknown {
  if (!obj) {
    return undefined;
  }
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** 取第一个非空字符串候选。 */
export function pickString(obj: WireObject | null | undefined, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return fallback;
}

/** 取第一个非空字符串候选；空 / 不存在返回 null（用于可空时间与 Token）。 */
export function pickNullableString(obj: WireObject | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

export function pickBool(obj: WireObject | null | undefined, keys: string[], fallback = false): boolean {
  const value = raw(obj, keys);
  return typeof value === 'boolean' ? value : fallback;
}

export function pickNumber(obj: WireObject | null | undefined, keys: string[]): number | null {
  const value = raw(obj, keys);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 把后端 items 归一为数组：
 * - 数组：users/grants/usage/audit、会话 UI 的 conversations；
 * - 对象（以 ID 为键）：groups/providers/models、admin conversations；
 * - null（Go nil 切片）或缺失：空数组。
 */
export function normalizeItems<T>(payload: unknown, map: (entry: WireObject) => T): T[] {
  let source: unknown = payload;
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    source = (payload as WireObject).items ?? (payload as WireObject).Items ?? [];
  }
  if (source === null || source === undefined) {
    return [];
  }
  if (Array.isArray(source)) {
    return source
      .filter((entry): entry is WireObject => entry !== null && typeof entry === 'object')
      .map(map);
  }
  if (typeof source === 'object') {
    return Object.values(source)
      .filter((entry): entry is WireObject => entry !== null && typeof entry === 'object')
      .map(map);
  }
  return [];
}

/** Go time.Time 零值（0001-01-01T00:00:00Z）视为「从未同步」。 */
export function normalizeTimestamp(value: string | null): string | null {
  if (value === null || value.startsWith('0001-01-01')) {
    return null;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 资源归一
// ---------------------------------------------------------------------------

function asRole(value: string): Role {
  return value === 'admin' ? 'admin' : 'user';
}

function asUserStatus(value: string): UserStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

export function normalizeUser(entry: WireObject): AdminUser {
  const status = asUserStatus(pickString(entry, ['status', 'Status'], 'active'));
  const user: AdminUser = {
    id: pickString(entry, ['id', 'ID']),
    username: pickString(entry, ['username', 'Username']),
    role: asRole(pickString(entry, ['role', 'Role'], 'user')),
    status,
  };
  const nickname = pickNullableString(entry, ['nickname', 'Nickname']);
  if (nickname !== null) {
    user.nickname = nickname;
  }
  const email = pickNullableString(entry, ['email', 'Email']);
  if (email !== null) {
    user.email = email;
  }
  const groups = raw(entry, ['group_ids', 'GroupIds']);
  if (Array.isArray(groups)) {
    user.group_ids = groups.filter((g): g is string => typeof g === 'string');
  }
  const names = raw(entry, ['group_names', 'GroupNames']);
  if (Array.isArray(names)) {
    user.group_names = names.filter((g): g is string => typeof g === 'string');
  }
  const created = normalizeTimestamp(pickNullableString(entry, ['created_at', 'CreatedAt']));
  if (created !== null) {
    user.created_at = created;
  }
  const updated = normalizeTimestamp(pickNullableString(entry, ['updated_at', 'UpdatedAt']));
  if (updated !== null) {
    user.updated_at = updated;
  }
  return user;
}

export function normalizeGroup(entry: WireObject): AdminGroup {
  const memberIds = raw(entry, ['member_ids', 'MemberIds']);
  const hasMembers = Array.isArray(memberIds);
  return {
    id: pickString(entry, ['id', 'ID']),
    name: pickString(entry, ['name', 'Name']),
    status: (pickString(entry, ['status', 'Status'], 'active') === 'disabled'
      ? 'disabled'
      : 'active') as GroupStatus,
    member_ids: hasMembers ? (memberIds as unknown[]).filter((v): v is string => typeof v === 'string') : null,
    member_count: hasMembers ? (memberIds as unknown[]).length : null,
    description: pickNullableString(entry, ['description', 'Description']) ?? undefined,
    created_at: normalizeTimestamp(pickNullableString(entry, ['created_at', 'CreatedAt'])) ?? undefined,
    updated_at: normalizeTimestamp(pickNullableString(entry, ['updated_at', 'UpdatedAt'])) ?? undefined,
  };
}

export function normalizeModel(entry: WireObject): ModelSummary {
  return {
    id: pickString(entry, ['id', 'ID']),
    name: pickString(entry, ['name', 'Name']),
    provider: pickString(entry, ['provider', 'Provider']),
    upstream_model_id: pickString(entry, ['upstream_model_id', 'UpstreamModelID']),
    enabled: pickBool(entry, ['enabled', 'Enabled']),
    available: pickBool(entry, ['available', 'Available'], true),
  };
}

export function normalizeEffectiveModel(entry: WireObject): EffectiveModel {
  return {
    id: pickString(entry, ['id', 'ID']),
    name: pickString(entry, ['name', 'Name']),
    provider: pickString(entry, ['provider', 'Provider']),
    upstream_model_id: pickString(entry, ['upstream_model_id', 'UpstreamModelID']),
  };
}

export function normalizeProvider(
  entry: WireObject,
  modelsByProvider: Map<string, ModelSummary[]>,
): ProviderRegistration {
  const providerKey = pickString(entry, ['provider', 'Provider']);
  return {
    provider: providerKey,
    name: pickString(entry, ['name', 'Name'], providerKey),
    status: (pickString(entry, ['status', 'Status'], 'active') === 'stale' ? 'stale' : 'active') as ProviderStatus,
    last_synced_at: normalizeTimestamp(pickNullableString(entry, ['last_synced_at', 'LastSyncedAt'])),
    models: (modelsByProvider.get(providerKey) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function normalizeGrant(entry: WireObject): Grant {
  const subjectType = pickString(entry, ['subject_type', 'SubjectType']);
  return {
    subject_type: (subjectType === 'user' ? 'user' : 'group') as SubjectType,
    subject_id: pickString(entry, ['subject_id', 'SubjectID']),
    model_id: pickString(entry, ['model_id', 'ModelID']),
    subject_name: pickNullableString(entry, ['subject_name', 'SubjectName']) ?? undefined,
    model_name: pickNullableString(entry, ['model_name', 'ModelName']) ?? undefined,
    created_at: normalizeTimestamp(pickNullableString(entry, ['created_at', 'CreatedAt'])) ?? undefined,
  };
}

function asUsageStatus(value: string): UsageStatus {
  if (value === 'completed' || value === 'aborted' || value === 'failed' || value === 'error') {
    return value;
  }
  return 'success';
}

export function normalizeUsage(entry: WireObject): UsageRecord {
  const startedAt = pickString(entry, ['started_at', 'StartedAt']);
  return {
    request_id: pickString(entry, ['request_id', 'RequestID']),
    conversation_id: pickString(entry, ['conversation_id', 'ConversationID']),
    user_id: pickString(entry, ['user_id', 'UserID']),
    username: pickNullableString(entry, ['username', 'Username']) ?? undefined,
    model_id: pickString(entry, ['model_id', 'ModelID']),
    model_name: pickNullableString(entry, ['model_name', 'ModelName']) ?? undefined,
    status: asUsageStatus(pickString(entry, ['status', 'Status'], 'completed')),
    started_at: startedAt,
    ended_at: pickString(entry, ['ended_at', 'EndedAt'], startedAt),
    input_tokens: pickNumber(entry, ['input_tokens', 'InputTokens']),
    output_tokens: pickNumber(entry, ['output_tokens', 'OutputTokens']),
    total_tokens: pickNumber(entry, ['total_tokens', 'TotalTokens']),
  };
}

export function normalizeConversation(entry: WireObject): AdminConversation {
  const status = pickNullableString(entry, ['status', 'Status']);
  const messageCount = pickNumber(entry, ['message_count', 'MessageCount']);
  return {
    id: pickString(entry, ['id', 'ID']),
    owner_id: pickString(entry, ['owner_id', 'OwnerID']),
    owner_username: pickNullableString(entry, ['owner_username', 'OwnerUsername']) ?? undefined,
    model_id: pickString(entry, ['model_id', 'ModelID']),
    model_name: pickNullableString(entry, ['model_name', 'ModelName']) ?? undefined,
    title: pickString(entry, ['title', 'Title']),
    status:
      status === 'active' || status === 'generating' || status === 'readonly' ? status : null,
    hidden: pickBool(entry, ['hidden', 'Hidden']),
    message_count: messageCount,
    created_at: normalizeTimestamp(pickNullableString(entry, ['created_at', 'CreatedAt'])) ?? undefined,
    updated_at: normalizeTimestamp(pickNullableString(entry, ['updated_at', 'UpdatedAt'])) ?? undefined,
    // SessionRef / pi_session_ref 永不读取、永不展示（§4.2、§9）。
  };
}

function asMessageStatus(value: string): MessageStatus {
  if (value === 'aborted' || value === 'error') {
    return value;
  }
  return 'completed';
}

export function normalizeVisibleMessage(entry: WireObject): VisibleMessage {
  return {
    id: pickString(entry, ['id', 'ID']),
    role: pickString(entry, ['role', 'Role']) === 'assistant' ? 'assistant' : 'user',
    content: pickString(entry, ['content', 'Content']),
    status: asMessageStatus(pickString(entry, ['status', 'Status'], 'completed')),
    created_at: pickString(entry, ['created_at', 'CreatedAt']),
  };
}

export function normalizeMessagesPage(payload: unknown): {
  items: VisibleMessage[];
  next_since: string | null;
  has_more: boolean;
} {
  const page = (payload ?? {}) as WireObject;
  const itemsRaw = raw(page, ['items', 'Items']);
  const items = Array.isArray(itemsRaw)
    ? itemsRaw
        .filter((entry): entry is WireObject => entry !== null && typeof entry === 'object')
        .map(normalizeVisibleMessage)
    : [];
  const hasMore = pickBool(page, ['has_more', 'HasMore']);
  const nextSince = pickNullableString(page, ['next_since', 'NextSince']);
  return {
    items,
    next_since: nextSince,
    has_more: hasMore,
  };
}

export function normalizeAudit(entry: WireObject): AuditEntry {
  return {
    id: pickString(entry, ['id', 'ID'], pickString(entry, ['trace_id', 'TraceID'])),
    actor_id: pickString(entry, ['actor_id', 'ActorID']),
    actor_username: pickNullableString(entry, ['actor_username', 'ActorUsername']) ?? undefined,
    action: pickString(entry, ['action', 'Action']),
    object_type: pickString(entry, ['object_type', 'ObjectType']),
    object_id: pickString(entry, ['object_id', 'ObjectID']),
    result: pickString(entry, ['result', 'Result']) === 'failed' ? 'failed' : 'success',
    detail: pickNullableString(entry, ['detail', 'Detail']) ?? undefined,
    trace_id: pickString(entry, ['trace_id', 'TraceID']),
    created_at: normalizeTimestamp(pickNullableString(entry, ['created_at', 'CreatedAt'])) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// 客户端分页 / 过滤（真实后端一次返回全量列表，无服务端分页）
// ---------------------------------------------------------------------------

export function paginateList<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Math.trunc(pageSize) || 10));
  return items.slice((safePage - 1) * safeSize, safePage * safeSize);
}

export function buildPaged<T>(items: T[], page: number, pageSize: number): {
  items: T[];
  total: number;
  page: number;
  page_size: number;
} {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Math.trunc(pageSize) || 10));
  return {
    items: paginateList(items, safePage, safeSize),
    total: items.length,
    page: safePage,
    page_size: safeSize,
  };
}
