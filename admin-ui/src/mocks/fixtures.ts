/**
 * Mock 种子数据（仅 B 线 mock 闭环使用）。
 * 密码字段只存在于 mock 内存库中，任何响应映射都不会输出它。
 * 时间统一使用 UTC ISO 8601。
 */

export interface SeedUser {
  id: string;
  username: string;
  password: string;
  nickname: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface SeedGroup {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'disabled';
  member_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface SeedModel {
  id: string;
  provider: string;
  upstream_model_id: string;
  name: string;
  enabled: boolean;
  available: boolean;
}

export interface SeedProvider {
  provider: string;
  name: string;
  status: 'active' | 'stale';
  last_synced_at: string | null;
}

export interface SeedGrant {
  subject_type: 'user' | 'group';
  subject_id: string;
  model_id: string;
  created_at: string;
}

export type SessionEntry =
  | {
      kind: 'message';
      id: string;
      role: 'user' | 'assistant';
      content: string;
      status: 'completed' | 'aborted' | 'error';
      created_at: string;
    }
  | { kind: 'thinking'; id: string; created_at: string; reasoning: string }
  | { kind: 'control'; id: string; created_at: string; event: string }
  | { kind: 'tool_call'; id: string; created_at: string; tool: string; input: string };

export interface SeedConversation {
  id: string;
  owner_id: string;
  model_id: string;
  /** 镜像真实后端：索引行携带不透明的 PI 会话引用；前端归一层丢弃，永不展示。 */
  pi_session_ref: string;
  title: string;
  hidden: boolean;
  generating: boolean;
  created_at: string;
  updated_at: string;
}

export interface SeedUsage {
  request_id: string;
  conversation_id: string;
  user_id: string;
  model_id: string;
  status: 'completed' | 'failed' | 'aborted';
  started_at: string;
  ended_at: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export interface SeedAudit {
  id: string;
  actor_id: string;
  actor_username: string;
  action: string;
  object_type: string;
  object_id: string;
  result: 'success' | 'failed';
  detail: string;
  trace_id: string;
  created_at: string;
}

export const SEED_USERS: SeedUser[] = [
  {
    id: 'u_admin',
    username: 'admin',
    password: 'admin123',
    nickname: '系统管理员',
    email: 'admin@tah.local',
    role: 'admin',
    status: 'active',
    created_at: '2026-08-28T08:00:00Z',
    updated_at: '2026-08-28T08:00:00Z',
  },
  {
    id: 'u_alice',
    username: 'alice',
    password: 'alice123',
    nickname: '爱丽丝',
    email: 'alice@tah.local',
    role: 'user',
    status: 'active',
    created_at: '2026-08-29T09:00:00Z',
    updated_at: '2026-08-29T09:00:00Z',
  },
  {
    id: 'u_bob',
    username: 'bob',
    password: 'bob123',
    nickname: '鲍勃',
    email: 'bob@tah.local',
    role: 'user',
    status: 'disabled',
    created_at: '2026-08-29T09:10:00Z',
    updated_at: '2026-08-31T15:00:00Z',
  },
  {
    id: 'u_carol',
    username: 'carol',
    password: 'carol123',
    nickname: '卡罗尔',
    email: 'carol@tah.local',
    role: 'user',
    status: 'active',
    created_at: '2026-08-29T09:20:00Z',
    updated_at: '2026-08-29T09:20:00Z',
  },
  {
    id: 'u_dave',
    username: 'dave',
    password: 'dave123',
    nickname: '戴夫',
    email: 'dave@tah.local',
    role: 'user',
    status: 'active',
    created_at: '2026-08-29T09:30:00Z',
    updated_at: '2026-08-29T09:30:00Z',
  },
];

export const SEED_GROUPS: SeedGroup[] = [
  {
    id: 'g_eng',
    name: '研发组',
    description: '研发团队，默认授权 GLM 系列',
    status: 'active',
    member_ids: ['u_alice', 'u_carol'],
    created_at: '2026-08-29T10:00:00Z',
    updated_at: '2026-08-29T10:00:00Z',
  },
  {
    id: 'g_op',
    name: '运维组',
    description: '运维团队，默认授权 DeepSeek 系列',
    status: 'active',
    member_ids: ['u_carol', 'u_dave'],
    created_at: '2026-08-29T10:05:00Z',
    updated_at: '2026-08-29T10:05:00Z',
  },
];

export const SEED_PROVIDERS: SeedProvider[] = [
  {
    provider: 'glm',
    name: '智谱 GLM',
    status: 'active',
    last_synced_at: '2026-08-31T08:00:00Z',
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    status: 'active',
    last_synced_at: '2026-08-31T08:00:00Z',
  },
];

export const SEED_MODELS: SeedModel[] = [
  {
    id: 'm_glm4flash',
    provider: 'glm',
    upstream_model_id: 'glm-4-flash',
    name: 'GLM-4-Flash',
    enabled: true,
    available: true,
  },
  {
    id: 'm_glm4air',
    provider: 'glm',
    upstream_model_id: 'glm-4-air',
    name: 'GLM-4-Air',
    // 新同步模型默认停用（AU-06）
    enabled: false,
    available: true,
  },
  {
    id: 'm_dschat',
    provider: 'deepseek',
    upstream_model_id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    enabled: true,
    available: true,
  },
  {
    id: 'm_dsreasoner',
    provider: 'deepseek',
    upstream_model_id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    enabled: true,
    available: true,
  },
];

export const SEED_GRANTS: SeedGrant[] = [
  {
    subject_type: 'group',
    subject_id: 'g_eng',
    model_id: 'm_glm4flash',
    created_at: '2026-08-29T10:10:00Z',
  },
  {
    subject_type: 'group',
    subject_id: 'g_op',
    model_id: 'm_dschat',
    created_at: '2026-08-29T10:15:00Z',
  },
  {
    subject_type: 'user',
    subject_id: 'u_alice',
    model_id: 'm_dschat',
    created_at: '2026-08-29T11:00:00Z',
  },
];

export const SEED_CONVERSATIONS: SeedConversation[] = [
  {
    id: 'c_1',
    owner_id: 'u_alice',
    model_id: 'm_glm4flash',
    pi_session_ref: 'session_m_glm4flash',
    title: 'GLM 使用咨询',
    hidden: false,
    generating: false,
    created_at: '2026-08-30T10:00:00Z',
    updated_at: '2026-09-01T09:40:00Z',
  },
  {
    id: 'c_2',
    owner_id: 'u_carol',
    model_id: 'm_dschat',
    pi_session_ref: 'session_m_dschat',
    title: 'DeepSeek 接口测试',
    hidden: false,
    generating: false,
    created_at: '2026-08-30T14:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  },
  {
    id: 'c_3',
    owner_id: 'u_alice',
    model_id: 'm_dsreasoner',
    pi_session_ref: 'session_m_dsreasoner',
    title: '推理模型体验',
    hidden: false,
    generating: false,
    created_at: '2026-08-31T09:00:00Z',
    updated_at: '2026-09-01T10:10:00Z',
  },
  {
    id: 'c_4',
    owner_id: 'u_dave',
    model_id: 'm_glm4flash',
    pi_session_ref: 'session_m_glm4flash',
    title: '已删除的临时会话',
    hidden: true,
    generating: false,
    created_at: '2026-08-30T16:00:00Z',
    updated_at: '2026-08-31T18:00:00Z',
  },
  {
    id: 'c_5',
    owner_id: 'u_carol',
    model_id: 'm_dschat',
    pi_session_ref: 'session_m_dschat',
    title: 'PI 故障演示会话',
    hidden: false,
    generating: false,
    created_at: '2026-09-01T09:20:00Z',
    updated_at: '2026-09-01T09:25:00Z',
  },
  {
    id: 'c_6',
    owner_id: 'u_dave',
    model_id: 'm_dschat',
    pi_session_ref: 'session_m_dschat',
    title: '进行中的长任务',
    hidden: false,
    generating: true,
    created_at: '2026-09-01T09:30:00Z',
    updated_at: '2026-09-01T09:35:00Z',
  },
];

function entryTime(baseMinutes: number, offsetSeconds: number): string {
  const base = Date.parse('2026-08-30T10:00:00Z') + baseMinutes * 60_000;
  return new Date(base + offsetSeconds).toISOString().replace('.000Z', 'Z');
}

/** c_1 的 64 条 PI Session 条目，混入必须被过滤的内部条目。 */
export function buildC1Entries(): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (let i = 1; i <= 64; i += 1) {
    const id = `entry_${String(i).padStart(3, '0')}`;
    const created_at = entryTime(0, i * 45);
    if (i % 8 === 3) {
      entries.push({
        kind: 'thinking',
        id,
        created_at,
        reasoning: '内部推理内容（thinking），不允许出现在任何展示或响应中',
      });
      continue;
    }
    if (i % 16 === 7) {
      entries.push({
        kind: 'control',
        id,
        created_at,
        event: 'pi_internal_control sk-mock-internal-credential-must-not-leak',
      });
      continue;
    }
    if (i % 16 === 12) {
      entries.push({
        kind: 'tool_call',
        id,
        created_at,
        tool: 'bash',
        input: 'echo /Users/leak/internal/path/forbidden',
      });
      continue;
    }
    const role: 'user' | 'assistant' = i % 2 === 1 ? 'user' : 'assistant';
    let status: 'completed' | 'aborted' | 'error' = 'completed';
    if (i === 30) {
      status = 'error';
    } else if (i === 62) {
      status = 'aborted';
    }
    const content =
      role === 'user'
        ? `第 ${(i + 1) / 2 | 0} 个问题：请帮我总结一下 Terminal Agent Hub 的第 ${i} 条要点，并保持简洁。`
        : `这是第 ${i} 条回复：要点 ${i} 已整理完毕，包含结论与后续建议，供你确认。`;
    entries.push({ kind: 'message', id, role, content, status, created_at });
  }
  return entries;
}

function shortEntries(prefix: string, baseTime: string, rounds: Array<[string, string, 'completed' | 'aborted' | 'error']>): SessionEntry[] {
  const base = Date.parse(baseTime);
  return rounds.map(([userText, assistantText, status], index) => {
    const n = index * 2 + 1;
    return [
      {
        kind: 'message' as const,
        id: `${prefix}_${String(n).padStart(3, '0')}`,
        role: 'user' as const,
        content: userText,
        status: 'completed' as const,
        created_at: new Date(base + n * 60_000).toISOString().replace('.000Z', 'Z'),
      },
      {
        kind: 'message' as const,
        id: `${prefix}_${String(n + 1).padStart(3, '0')}`,
        role: 'assistant' as const,
        content: assistantText,
        status,
        created_at: new Date(base + (n + 1) * 60_000).toISOString().replace('.000Z', 'Z'),
      },
    ];
  }).flat();
}

export const SEED_SESSIONS: Record<string, SessionEntry[]> = {
  c_1: buildC1Entries(),
  c_2: shortEntries('c2', '2026-08-30T14:00:00Z', [
    ['你好，帮我写一个调用 DeepSeek 的示例说明。', '可以，DeepSeek Chat 适合通用对话与代码说明任务。', 'completed'],
    ['它支持多轮上下文吗？', '支持，会话上下文由 PI Session 保存并随请求恢复。', 'completed'],
    ['今天先到这里。', '好的，历史会话可随时继续查看。', 'completed'],
  ]),
  c_3: shortEntries('c3', '2026-08-31T09:00:00Z', [
    ['体验一下推理模型。', '好的，推理模型适合复杂任务（示例回复）。', 'completed'],
    ['再来一轮。', '上一轮被中止的示例回复。', 'aborted'],
  ]),
  c_4: shortEntries('c4', '2026-08-30T16:00:00Z', [
    ['这个会话之后会被我自己删除。', '好的，删除只对你隐藏，管理员仍可审阅。', 'completed'],
    ['确认一下软删除语义。', '用户删除仅设置隐藏标记，正文与索引保留。', 'completed'],
  ]),
  c_5: shortEntries('c5', '2026-09-01T09:20:00Z', [
    ['这条会话用来演示 PI 暂不可读。', '当 PI 不可用时正文读取会明确失败。', 'completed'],
    ['失败时提示什么？', '会话正文暂不可读，请稍后重试，并保留审阅审计。', 'completed'],
    ['管理员能看到正文吗？', 'PI 恢复后即可继续读取。', 'completed'],
  ]),
  c_6: shortEntries('c6', '2026-09-01T09:30:00Z', [
    ['开始一个长任务。', '正在生成中……', 'completed'],
  ]),
};

export const SEED_USAGE: SeedUsage[] = [
  { request_id: 'req_001', conversation_id: 'c_1', user_id: 'u_alice', model_id: 'm_glm4flash', status: 'completed', started_at: '2026-08-30T10:00:00Z', ended_at: '2026-08-30T10:00:05Z', input_tokens: 12, output_tokens: 45, total_tokens: 57 },
  { request_id: 'req_002', conversation_id: 'c_1', user_id: 'u_alice', model_id: 'm_glm4flash', status: 'completed', started_at: '2026-08-30T10:05:00Z', ended_at: '2026-08-30T10:05:07Z', input_tokens: 20, output_tokens: 128, total_tokens: 148 },
  { request_id: 'req_003', conversation_id: 'c_2', user_id: 'u_carol', model_id: 'm_dschat', status: 'completed', started_at: '2026-08-30T14:00:00Z', ended_at: '2026-08-30T14:00:04Z', input_tokens: null, output_tokens: null, total_tokens: null },
  { request_id: 'req_004', conversation_id: 'c_4', user_id: 'u_dave', model_id: 'm_glm4flash', status: 'failed', started_at: '2026-08-30T16:00:00Z', ended_at: '2026-08-30T16:00:02Z', input_tokens: 8, output_tokens: null, total_tokens: null },
  { request_id: 'req_005', conversation_id: 'c_3', user_id: 'u_alice', model_id: 'm_dsreasoner', status: 'completed', started_at: '2026-08-31T09:00:00Z', ended_at: '2026-08-31T09:00:12Z', input_tokens: 100, output_tokens: 560, total_tokens: 660 },
  { request_id: 'req_006', conversation_id: 'c_2', user_id: 'u_carol', model_id: 'm_dschat', status: 'aborted', started_at: '2026-08-31T11:00:00Z', ended_at: '2026-08-31T11:00:06Z', input_tokens: 15, output_tokens: null, total_tokens: null },
  { request_id: 'req_007', conversation_id: 'c_1', user_id: 'u_alice', model_id: 'm_glm4flash', status: 'completed', started_at: '2026-09-01T09:00:00Z', ended_at: '2026-09-01T09:00:08Z', input_tokens: 30, output_tokens: 210, total_tokens: 240 },
  { request_id: 'req_008', conversation_id: 'c_5', user_id: 'u_dave', model_id: 'm_dschat', status: 'failed', started_at: '2026-09-01T09:10:00Z', ended_at: '2026-09-01T09:10:01Z', input_tokens: null, output_tokens: null, total_tokens: null },
  { request_id: 'req_009', conversation_id: 'c_5', user_id: 'u_carol', model_id: 'm_dschat', status: 'completed', started_at: '2026-09-01T09:20:00Z', ended_at: '2026-09-01T09:20:05Z', input_tokens: 22, output_tokens: 95, total_tokens: 117 },
  { request_id: 'req_010', conversation_id: 'c_6', user_id: 'u_dave', model_id: 'm_dschat', status: 'completed', started_at: '2026-09-01T09:30:00Z', ended_at: '2026-09-01T09:30:09Z', input_tokens: 40, output_tokens: 300, total_tokens: 340 },
  { request_id: 'req_011', conversation_id: 'c_1', user_id: 'u_alice', model_id: 'm_glm4flash', status: 'completed', started_at: '2026-09-01T09:40:00Z', ended_at: '2026-09-01T09:40:06Z', input_tokens: 18, output_tokens: 76, total_tokens: 94 },
  { request_id: 'req_012', conversation_id: 'c_2', user_id: 'u_carol', model_id: 'm_dschat', status: 'completed', started_at: '2026-09-01T10:00:00Z', ended_at: '2026-09-01T10:00:07Z', input_tokens: 25, output_tokens: 140, total_tokens: 165 },
  { request_id: 'req_013', conversation_id: 'c_6', user_id: 'u_dave', model_id: 'm_dschat', status: 'failed', started_at: '2026-09-01T10:05:00Z', ended_at: '2026-09-01T10:05:02Z', input_tokens: 50, output_tokens: null, total_tokens: null },
  { request_id: 'req_014', conversation_id: 'c_3', user_id: 'u_alice', model_id: 'm_dsreasoner', status: 'completed', started_at: '2026-09-01T10:10:00Z', ended_at: '2026-09-01T10:10:15Z', input_tokens: 120, output_tokens: 640, total_tokens: 760 },
];

/** 镜像真实后端审计动作（小写点分）：user.create / provider.sync / model.update / grant.create / conversation.review。 */
export const SEED_AUDIT: SeedAudit[] = [
  { id: 'audit_001', actor_id: 'u_admin', actor_username: 'admin', action: 'user.create', object_type: 'user', object_id: 'u_alice', result: 'success', detail: '', trace_id: 'tr_seed_001', created_at: '2026-08-29T09:00:00Z' },
  { id: 'audit_002', actor_id: 'u_admin', actor_username: 'admin', action: 'provider.sync', object_type: 'provider', object_id: '', result: 'success', detail: '', trace_id: 'tr_seed_002', created_at: '2026-08-29T09:30:00Z' },
  { id: 'audit_003', actor_id: 'u_admin', actor_username: 'admin', action: 'model.update', object_type: 'model', object_id: 'm_glm4flash', result: 'success', detail: '', trace_id: 'tr_seed_003', created_at: '2026-08-29T10:05:00Z' },
  { id: 'audit_004', actor_id: 'u_admin', actor_username: 'admin', action: 'grant.create', object_type: 'model', object_id: 'm_glm4flash', result: 'success', detail: '', trace_id: 'tr_seed_004', created_at: '2026-08-29T10:10:00Z' },
  { id: 'audit_005', actor_id: 'u_admin', actor_username: 'admin', action: 'provider.sync', object_type: 'provider', object_id: '', result: 'failed', detail: '', trace_id: 'tr_seed_005', created_at: '2026-08-30T15:00:00Z' },
  { id: 'audit_006', actor_id: 'u_admin', actor_username: 'admin', action: 'conversation.review', object_type: 'conversation', object_id: 'c_1', result: 'success', detail: '', trace_id: 'tr_seed_006', created_at: '2026-08-31T15:01:00Z' },
];
