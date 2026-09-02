/**
 * Mock 后端纯逻辑测试：有效模型、Provider 无密钥同步、正文过滤、
 * 密码策略、登录限流与安全字段白名单。
 * 线格式行为（Go 风格键、白名单请求体、审计动作等）见 handlers.test.ts。
 */
import { describe, expect, it } from 'vitest';

import type { HubDb } from './db';
import { createDb } from './db';
import {
  LOGIN_COOLDOWN_MS,
  SUCCESS_MANIFEST,
  applyProviderSyncFailure,
  applyProviderSyncSuccess,
  checkLoginAllowed,
  computeEffectiveModels,
  filterVisibleEntries,
  recordLoginFailure,
  recordLoginSuccess,
  validatePassword,
  validateUsername,
} from './logic';

function freshDb(): HubDb {
  return createDb();
}

const FORBIDDEN_PATTERN = /api[_-]?key|apikey|secret|sk-[A-Za-z0-9_-]{6,}|bearer\s+\S+|password/i;

// ---------------------------------------------------------------------------
// 有效模型（§5.1 / SA-02）
// ---------------------------------------------------------------------------

describe('computeEffectiveModels', () => {
  it('用户直接授权与所属组授权取并集', () => {
    const db = freshDb();
    const alice = computeEffectiveModels(db, 'u_alice');
    expect(alice.map((m) => m.id).sort()).toEqual(['m_dschat', 'm_glm4flash']);
  });

  it('多组成员取并集（carol 属于研发组与运维组）', () => {
    const db = freshDb();
    const carol = computeEffectiveModels(db, 'u_carol');
    expect(carol.map((m) => m.id).sort()).toEqual(['m_dschat', 'm_glm4flash']);
  });

  it('仅组授权的用户只获得组授权模型', () => {
    const db = freshDb();
    const dave = computeEffectiveModels(db, 'u_dave');
    expect(dave.map((m) => m.id)).toEqual(['m_dschat']);
  });

  it('管理员不自动拥有任何模型；禁用用户无有效模型', () => {
    const db = freshDb();
    expect(computeEffectiveModels(db, 'u_admin')).toEqual([]);
    expect(computeEffectiveModels(db, 'u_bob')).toEqual([]);
    expect(computeEffectiveModels(db, 'u_not_exist')).toEqual([]);
  });

  it('移出组后组授权立即失效；停用 / 缺失模型被排除', () => {
    const db = freshDb();
    const eng = db.groups.find((g) => g.id === 'g_eng')!;
    eng.member_ids = eng.member_ids.filter((id) => id !== 'u_carol');
    expect(computeEffectiveModels(db, 'u_carol').map((m) => m.id)).toEqual(['m_dschat']);

    const glm = db.models.find((m) => m.id === 'm_glm4flash')!;
    glm.enabled = false;
    expect(computeEffectiveModels(db, 'u_alice').map((m) => m.id)).toEqual(['m_dschat']);

    const ds = db.models.find((m) => m.id === 'm_dschat')!;
    ds.available = false;
    expect(computeEffectiveModels(db, 'u_alice')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Provider 无密钥同步（§8.4 / SA-07 / AU-05 / AU-06）
// ---------------------------------------------------------------------------

describe('provider sync', () => {
  it('同步成功：新模型默认停用；缺失模型标记不可用但保留启用状态与授权', () => {
    const db = freshDb();
    db.grants.push({
      subject_type: 'group',
      subject_id: 'g_op',
      model_id: 'm_dsreasoner',
      created_at: '2026-09-01T00:00:00Z',
    });
    applyProviderSyncSuccess(db, SUCCESS_MANIFEST, '2026-09-01T12:00:00Z');

    const glmPlus = db.models.find((m) => m.upstream_model_id === 'glm-4-plus');
    expect(glmPlus).toBeDefined();
    expect(glmPlus!.enabled).toBe(false); // 新同步默认停用
    expect(glmPlus!.available).toBe(true);

    const reasoner = db.models.find((m) => m.upstream_model_id === 'deepseek-reasoner')!;
    expect(reasoner.available).toBe(false); // 清单缺失
    expect(reasoner.enabled).toBe(true); // 保留既有状态
    // 授权不被删除
    expect(db.grants.some((g) => g.model_id === 'm_dsreasoner')).toBe(true);
    // 既有模型启用状态不变
    expect(db.models.find((m) => m.id === 'm_glm4flash')!.enabled).toBe(true);
    expect(db.providers.every((p) => p.status === 'active')).toBe(true);
    expect(db.providers.every((p) => p.last_synced_at === '2026-09-01T12:00:00Z')).toBe(true);
  });

  it('同步失败：保留旧快照与同步时间，仅标记过期', () => {
    const db = freshDb();
    const before = db.providers.map((p) => ({ ...p }));
    applyProviderSyncFailure(db, 'PI_UNAVAILABLE', 'PI Agent 暂不可用');
    expect(db.providers.every((p) => p.status === 'stale')).toBe(true);
    expect(db.providers.map((p) => p.last_synced_at)).toEqual(before.map((p) => p.last_synced_at));
    expect(db.models).toHaveLength(4); // 快照不变，不增不删
    expect(db.lastSyncError).toEqual({ code: 'PI_UNAVAILABLE', message: 'PI Agent 暂不可用' });
  });

  it('同步清单不含任何密钥类字段', () => {
    const db = freshDb();
    applyProviderSyncSuccess(db, SUCCESS_MANIFEST, '2026-09-01T12:00:00Z');
    const serialized = JSON.stringify(db.models) + JSON.stringify(db.providers);
    expect(serialized).not.toMatch(FORBIDDEN_PATTERN);
  });
});

// ---------------------------------------------------------------------------
// 正文过滤与分页（§7.3 / AU-10）
// ---------------------------------------------------------------------------

describe('filterVisibleEntries', () => {
  it('过滤 thinking / control / tool_call 内部条目，仅输出白名单字段', () => {
    const db = freshDb();
    const entries = db.sessions.c_1!;
    const result = filterVisibleEntries(entries, null, 100);
    expect(result.items).toHaveLength(48); // 64 条中 16 条为内部条目
    expect(result.has_more).toBe(false);
    const serialized = JSON.stringify(result.items);
    expect(serialized).not.toMatch(FORBIDDEN_PATTERN);
    expect(serialized).not.toContain('thinking');
    expect(serialized).not.toContain('tool_call');
    expect(serialized).not.toContain('/Users/');
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual(['content', 'created_at', 'id', 'role', 'status']);
    }
  });

  it('since 游标 + limit 分页：不一次返回全文', () => {
    const db = freshDb();
    const entries = db.sessions.c_1!;
    const first = filterVisibleEntries(entries, null, 20);
    expect(first.items).toHaveLength(20);
    expect(first.has_more).toBe(true);
    expect(first.next_since).toBe(first.items.at(-1)!.id);

    const second = filterVisibleEntries(entries, first.next_since, 20);
    expect(second.items).toHaveLength(20);
    // 下一页从上一页末尾之后开始（内部条目被跨过）
    expect(second.items[0]!.id > first.items.at(-1)!.id).toBe(true);

    // 继续用游标翻页直到末尾，总数应等于可见条数
    let cursor = second.next_since;
    let total = first.items.length + second.items.length;
    while (cursor) {
      const page = filterVisibleEntries(entries, cursor, 50);
      total += page.items.length;
      cursor = page.has_more ? page.next_since : null;
    }
    expect(total).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// 密码与用户名策略（与真实后端一致：至少 12 位）
// ---------------------------------------------------------------------------

describe('password policy', () => {
  it('密码至少 12 位，至多 64 位', () => {
    expect(validatePassword('short')).toBe('密码长度需为 12-64 位');
    expect(validatePassword('a'.repeat(11))).not.toBeNull();
    expect(validatePassword('a'.repeat(12))).toBeNull();
    expect(validatePassword('a'.repeat(65))).not.toBeNull();
  });

  it('用户名 3-32 位字母数字下划线', () => {
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('alice_01')).toBeNull();
    expect(validateUsername('不合法')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 登录限流（AUTH-06）
// ---------------------------------------------------------------------------

describe('login rate limit', () => {
  it('连续 5 次失败进入冷却；成功登录重置', () => {
    const db = freshDb();
    const now = 1_000_000;
    for (let i = 0; i < 4; i += 1) {
      recordLoginFailure(db, 'mallory', now + i);
      expect(checkLoginAllowed(db, 'mallory', now + i).allowed).toBe(true);
    }
    recordLoginFailure(db, 'mallory', now + 4);
    const limited = checkLoginAllowed(db, 'mallory', now + 4);
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterMs).toBeLessThanOrEqual(LOGIN_COOLDOWN_MS);

    // 冷却结束后恢复
    expect(checkLoginAllowed(db, 'mallory', now + 4 + LOGIN_COOLDOWN_MS + 1).allowed).toBe(true);

    // 成功登录清零
    for (let i = 0; i < 4; i += 1) {
      recordLoginFailure(db, 'oscar', now + i);
    }
    recordLoginSuccess(db, 'oscar');
    for (let i = 0; i < 4; i += 1) {
      recordLoginFailure(db, 'oscar', now + 10 + i);
    }
    expect(checkLoginAllowed(db, 'oscar', now + 14).allowed).toBe(true);
  });
});
