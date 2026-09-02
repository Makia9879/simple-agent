/**
 * 线格式归一层测试：真实后端（Go 风格键、map 形 items、items:null）与
 * docs/program-design.md §6 冻结契约（snake_case、数组 items）都必须能归一。
 */
import { describe, expect, it } from 'vitest';

import {
  buildPaged,
  normalizeAudit,
  normalizeConversation,
  normalizeGrant,
  normalizeGroup,
  normalizeItems,
  normalizeMessagesPage,
  normalizeModel,
  normalizeProvider,
  normalizeUsage,
  normalizeUser,
  paginateList,
} from './wire';

describe('normalizeItems', () => {
  it('数组 items 直接映射', () => {
    const rows = normalizeItems({ items: [{ id: 'a' }, { id: 'b' }] }, (e) => e.id as string);
    expect(rows).toEqual(['a', 'b']);
  });

  it('对象 items（以 ID 为键，groups/providers/models/conversations）展开为行', () => {
    const rows = normalizeItems({ items: { g1: { ID: 'g1' }, g2: { ID: 'g2' } } }, (e) => e.ID as string);
    expect(rows.sort()).toEqual(['g1', 'g2']);
  });

  it('items 为 null（Go nil 切片）或缺失时返回空数组', () => {
    expect(normalizeItems({ items: null }, (e) => e)).toEqual([]);
    expect(normalizeItems({}, (e) => e)).toEqual([]);
    expect(normalizeItems(null, (e) => e)).toEqual([]);
  });

  it('顶层就是数组时也能接受', () => {
    expect(normalizeItems([{ id: 'x' }], (e) => e.id as string)).toEqual(['x']);
  });
});

describe('normalizeUser', () => {
  it('真实后端小写键 + 契约 snake_case 键都归一', () => {
    const fromBackend = normalizeUser({ id: 'u_1', username: 'alice', role: 'admin', status: 'active' });
    expect(fromBackend).toMatchObject({ id: 'u_1', username: 'alice', role: 'admin', status: 'active' });
    expect(fromBackend.nickname).toBeUndefined();
    expect(fromBackend.group_ids).toBeUndefined();

    const fromContract = normalizeUser({
      id: 'u_2', username: 'bob', role: 'user', status: 'disabled',
      nickname: 'Bob', email: 'b@x', group_ids: ['g1'], created_at: '2026-09-01T00:00:00Z',
    });
    expect(fromContract).toMatchObject({
      id: 'u_2', role: 'user', status: 'disabled', nickname: 'Bob', email: 'b@x',
    });
    expect(fromContract.group_ids).toEqual(['g1']);
  });

  it('未知角色 / 状态回退到安全默认值', () => {
    const user = normalizeUser({ id: 'u', username: 'x', role: 'weird', status: 'weird' });
    expect(user.role).toBe('user');
    expect(user.status).toBe('active');
  });
});

describe('normalizeGroup', () => {
  it('真实后端 Go 风格键；成员未知时 member_ids 为 null', () => {
    const group = normalizeGroup({ ID: 'g_1', Name: '研发组', Status: 'active' });
    expect(group).toMatchObject({ id: 'g_1', name: '研发组', status: 'active' });
    expect(group.member_ids).toBeNull();
    expect(group.member_count).toBeNull();
  });

  it('契约形态带 member_ids 时保留成员信息', () => {
    const group = normalizeGroup({ id: 'g', name: 'n', status: 'disabled', member_ids: ['u1', 'u2'] });
    expect(group.member_ids).toEqual(['u1', 'u2']);
    expect(group.member_count).toBe(2);
  });
});

describe('normalizeModel / normalizeProvider', () => {
  it('真实后端模型键为 ID/Provider/UpstreamModelID/Name/Enabled/Available', () => {
    const model = normalizeModel({
      ID: 'm_1', Provider: 'glm', UpstreamModelID: 'glm-4-flash', Name: 'GLM', Enabled: false, Available: true,
    });
    expect(model).toEqual({
      id: 'm_1', provider: 'glm', upstream_model_id: 'glm-4-flash', name: 'GLM', enabled: false, available: true,
    });
  });

  it('Provider 的 Go 零值时间视为从未同步；模型按 provider 合并', () => {
    const models = new Map([
      ['glm', [{ id: 'm_1', name: 'GLM', provider: 'glm', upstream_model_id: 'g', enabled: true, available: true }]],
    ]);
    const never = normalizeProvider(
      { Provider: 'glm', Name: 'GLM', Status: 'active', LastSyncedAt: '0001-01-01T00:00:00Z' },
      models,
    );
    expect(never.last_synced_at).toBeNull();
    expect(never.models).toHaveLength(1);

    const synced = normalizeProvider(
      { provider: 'glm', name: 'GLM', status: 'stale', last_synced_at: '2026-09-01T00:00:00Z' },
      models,
    );
    expect(synced.status).toBe('stale');
    expect(synced.last_synced_at).toBe('2026-09-01T00:00:00Z');
  });
});

describe('normalizeGrant', () => {
  it('真实后端 SubjectType/SubjectID/ModelID 键', () => {
    const grant = normalizeGrant({ SubjectType: 'group', SubjectID: 'g_1', ModelID: 'm_1' });
    expect(grant).toMatchObject({ subject_type: 'group', subject_id: 'g_1', model_id: 'm_1' });
    expect(grant.subject_name).toBeUndefined();
  });
});

describe('normalizeUsage', () => {
  it('真实后端键 + null Token；状态 completed/failed/aborted 原样保留', () => {
    const record = normalizeUsage({
      RequestID: 'r1', ConversationID: 'c1', UserID: 'u1', ModelID: 'm1',
      Status: 'completed', InputTokens: 2, OutputTokens: null, TotalTokens: null,
      StartedAt: '2026-09-01T00:00:00Z', EndedAt: '2026-09-01T00:00:01Z',
    });
    expect(record).toMatchObject({
      request_id: 'r1', user_id: 'u1', model_id: 'm1', status: 'completed',
      started_at: '2026-09-01T00:00:00Z', ended_at: '2026-09-01T00:00:01Z',
      input_tokens: 2, output_tokens: null, total_tokens: null,
    });
    expect(normalizeUsage({ Status: 'failed', StartedAt: 't' }).status).toBe('failed');
  });
});

describe('normalizeConversation', () => {
  it('真实后端原始索引行：丢弃 SessionRef，status 缺失为 null', () => {
    const conversation = normalizeConversation({
      ID: 'c_1', OwnerID: 'u_1', ModelID: 'm_1', SessionRef: 'session_secret_ref',
      Title: 't', Hidden: true, CreatedAt: '2026-09-01T00:00:00Z', UpdatedAt: '2026-09-01T00:00:00Z',
    });
    expect(conversation).toMatchObject({
      id: 'c_1', owner_id: 'u_1', model_id: 'm_1', title: 't', hidden: true,
    });
    expect(conversation.status).toBeNull();
    expect(JSON.stringify(conversation)).not.toContain('session_secret_ref');
  });

  it('契约形态的 status 字段被保留', () => {
    const conversation = normalizeConversation({ id: 'c', owner_id: 'u', model_id: 'm', title: 't', status: 'readonly', hidden: false });
    expect(conversation.status).toBe('readonly');
  });
});

describe('normalizeMessagesPage', () => {
  it('真实后端 Items/NextSince/HasMore 键；Items 为 null 时空数组', () => {
    const page = normalizeMessagesPage({
      Items: [{ ID: 'e1', Role: 'user', Content: 'hi', Status: 'completed', CreatedAt: '2026-09-01T00:00:00Z' }],
      NextSince: 'e1',
      HasMore: true,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'e1', role: 'user', content: 'hi', status: 'completed' });
    expect(page.next_since).toBe('e1');
    expect(page.has_more).toBe(true);

    const empty = normalizeMessagesPage({ Items: null, NextSince: '', HasMore: false });
    expect(empty.items).toEqual([]);
    expect(empty.has_more).toBe(false);
  });
});

describe('normalizeAudit', () => {
  it('真实后端键；无自增 ID 时用 trace_id 兜底', () => {
    const entry = normalizeAudit({
      ActorID: 'u_1', Action: 'conversation.review', ObjectType: 'conversation',
      ObjectID: 'c_1', Result: 'failed', TraceID: 'req_1', CreatedAt: '2026-09-01T00:00:00Z',
    });
    expect(entry).toMatchObject({
      actor_id: 'u_1', action: 'conversation.review', object_type: 'conversation',
      object_id: 'c_1', result: 'failed', trace_id: 'req_1',
    });
    expect(entry.id).toBe('req_1');
    expect(entry.actor_username).toBeUndefined();
  });
});

describe('client-side pagination', () => {
  it('分页与 total 计算（后端无服务端分页）', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    expect(paginateList(rows, 1, 10)).toHaveLength(10);
    expect(paginateList(rows, 3, 10)).toHaveLength(5);
    expect(paginateList(rows, 4, 10)).toHaveLength(0);
    const paged = buildPaged(rows, 2, 10);
    expect(paged.total).toBe(25);
    expect(paged.page).toBe(2);
    expect(paged.page_size).toBe(10);
  });
});
