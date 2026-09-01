/**
 * Mock 数据库（内存单例）。MSW handler 与页面的 Mock 控制台共享同一实例。
 */
import {
  SEED_AUDIT,
  SEED_CONVERSATIONS,
  SEED_GRANTS,
  SEED_GROUPS,
  SEED_MODELS,
  SEED_PROVIDERS,
  SEED_SESSIONS,
  SEED_USAGE,
  SEED_USERS,
  type SeedAudit,
  type SeedConversation,
  type SeedGrant,
  type SeedGroup,
  type SeedModel,
  type SeedProvider,
  type SeedUsage,
  type SeedUser,
  type SessionEntry,
} from './fixtures';

export interface MockScenario {
  /** 下一次 Provider 同步的结果：success 携带新模型与缺失模型；failure 返回 PI_UNAVAILABLE。 */
  syncOutcome: 'success' | 'failure';
  /** 这些会话读取正文时返回 PI_UNAVAILABLE（演示审阅失败也要写审计）。 */
  piUnavailableConversations: string[];
  /** 空数据模式：列表接口返回空结果（演示空态）。 */
  emptyMode: boolean;
}

export interface LoginAttemptState {
  failures: number;
  limitedUntil: number | null;
}

export interface HubDb {
  users: SeedUser[];
  groups: SeedGroup[];
  providers: SeedProvider[];
  models: SeedModel[];
  grants: SeedGrant[];
  conversations: SeedConversation[];
  sessions: Record<string, SessionEntry[]>;
  usage: SeedUsage[];
  audit: SeedAudit[];
  lastSyncError: { code: string; message: string } | null;
  loginAttempts: Record<string, LoginAttemptState>;
  scenario: MockScenario;
  seq: { user: number; group: number; grant: number; audit: number };
}

export function createDb(): HubDb {
  return {
    users: structuredClone(SEED_USERS),
    groups: structuredClone(SEED_GROUPS),
    providers: structuredClone(SEED_PROVIDERS),
    models: structuredClone(SEED_MODELS),
    grants: structuredClone(SEED_GRANTS),
    conversations: structuredClone(SEED_CONVERSATIONS),
    sessions: structuredClone(SEED_SESSIONS),
    usage: structuredClone(SEED_USAGE),
    audit: structuredClone(SEED_AUDIT),
    lastSyncError: null,
    loginAttempts: {},
    scenario: {
      syncOutcome: 'success',
      piUnavailableConversations: ['c_5'],
      emptyMode: false,
    },
    seq: { user: 6, group: 3, grant: 4, audit: 7 },
  };
}

export const db: HubDb = createDb();

export function resetDb(): void {
  Object.assign(db, createDb());
}
