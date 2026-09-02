/**
 * Mock 后端纯逻辑（可被单测直接覆盖）：
 * 有效模型计算、Provider 无密钥同步、正文过滤分页、登录限流等。
 * 规则来源：docs/system-requirements.md §5、docs/program-design.md §4.3/§8.4，
 * 线格式细节与 backend/api/internal/handler/hub 的真实实现对齐。
 */
import type { HubDb } from './db';
import type { SeedGroup, SeedModel, SeedUser, SessionEntry } from './fixtures';
import type { EffectiveModel } from '@/api/types';

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

export function validateUsername(username: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return '用户名需为 3-32 位字母、数字或下划线';
  }
  return null;
}

/** 与真实后端 pbkdf2 哈希前的密码策略一致：至少 12 位。 */
export const MIN_PASSWORD_LENGTH = 12;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 64) {
    return `密码长度需为 ${MIN_PASSWORD_LENGTH}-64 位`;
  }
  return null;
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
export function applyProviderSyncSuccess(db: HubDb, manifest: ProviderManifest[], now: string): void {
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

// ---------------------------------------------------------------------------
// 会话与正文
// ---------------------------------------------------------------------------

export function countVisibleMessages(entries: SessionEntry[]): number {
  return entries.filter((e) => e.kind === 'message').length;
}

/** 正文白名单：只输出 id/role/content/status/created_at，过滤 thinking、control、tool_call。 */
export function filterVisibleEntries(
  entries: SessionEntry[],
  since: string | null,
  limit: number,
): { items: Array<{ id: string; role: 'user' | 'assistant'; content: string; status: 'completed' | 'aborted' | 'error'; created_at: string }>; next_since: string | null; has_more: boolean } {
  const visible = entries.filter((e) => e.kind === 'message') as Array<{
    kind: 'message';
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'completed' | 'aborted' | 'error';
    created_at: string;
  }>;  const after = since ? visible.filter((e) => e.id > since) : visible;
  const slice = after.slice(0, Math.max(1, limit));
  const items = slice.map((e) => ({
    id: e.id,
    role: e.role,
    content: e.content,
    status: e.status,
    created_at: e.created_at,
  }));
  const hasMore = after.length > items.length;
  const nextSince = items.length > 0 ? items[items.length - 1]!.id : since;
  return { items, next_since: nextSince, has_more: hasMore };
}

// ---------------------------------------------------------------------------
// 登录限流（AUTH-06 mock：5 次失败冷却 60 秒，与真实后端一致）
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
