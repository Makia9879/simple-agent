/**
 * Terminal Agent Hub 后台 UI 使用的内部展示类型。
 *
 * 真实后端（backend/api/internal/handler/hub）当前的响应是 Go 结构体直接序列化：
 * 字段名为 ID/Name/Status/SubjectType 等 Go 风格大小写，列表 items 可能是数组
 * （users/grants/usage/audit）也可能是以 ID 为键的对象（groups/providers/models/
 * conversations），并且不包含分页字段。src/api/wire.ts 负责把两种拼写
 * （真实后端 Go 风格 + docs/program-design.md §6 的 snake_case）都归一为本文件的类型。
 *
 * 后端未提供的展示字段（昵称、邮箱、组成员、用量汇总、审阅 trace 等）标为可选，
 * 页面必须能优雅降级，不得假设它们存在。
 */

export type Role = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';
export type GroupStatus = 'active' | 'disabled';
export type ProviderStatus = 'active' | 'stale';
export type SubjectType = 'user' | 'group';
/** 真实后端写入 completed/aborted/failed；旧 mock 契约使用 success/error。 */
export type UsageStatus = 'completed' | 'aborted' | 'failed' | 'success' | 'error';
export type ConversationStatus = 'active' | 'generating' | 'readonly';
export type MessageStatus = 'completed' | 'aborted' | 'error';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  /** 真实后端登录响应携带 status；mock 桥接时可能缺失。 */
  status?: UserStatus;
}

export interface CurrentUser extends AuthUser {
  status: UserStatus;
}

export interface LoginResponse {
  user: AuthUser;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 真实后端用户只有 id/username/role/status；其余字段仅当后端提供时展示。 */
export interface AdminUser {
  id: string;
  username: string;
  role: Role;
  status: UserStatus;
  nickname?: string;
  email?: string;
  group_ids?: string[];
  group_names?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AdminGroup {
  id: string;
  name: string;
  status: GroupStatus;
  /** 真实后端没有组成员读取接口：null 表示成员未知，界面需降级。 */
  member_ids: string[] | null;
  member_count: number | null;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/** Model 字段白名单：id、provider、upstream_model_id、name、enabled、available。 */
export interface ModelSummary {
  id: string;
  name: string;
  provider: string;
  upstream_model_id: string;
  enabled: boolean;
  available: boolean;
}

/** Provider 登记字段白名单：provider、name、status、models、last_synced_at。 */
export interface ProviderRegistration {
  provider: string;
  name: string;
  status: ProviderStatus;
  last_synced_at: string | null;
  models: ModelSummary[];
}

export interface SyncError {
  code: string;
  message: string;
}

export interface ProvidersResponse {
  providers: ProviderRegistration[];
  last_sync_error: SyncError | null;
}

export interface SyncResponse {
  result: 'success' | 'failed';
  providers: ProviderRegistration[];
  error: SyncError | null;
}

export interface Grant {
  subject_type: SubjectType;
  subject_id: string;
  subject_id_display?: string;
  model_id: string;
  subject_name?: string;
  model_name?: string;
  created_at?: string;
}

export interface EffectiveModel {
  id: string;
  name: string;
  provider: string;
  upstream_model_id: string;
}

export interface UsageRecord {
  request_id: string;
  conversation_id: string;
  user_id: string;
  username?: string;
  model_id: string;
  model_name?: string;
  status: UsageStatus;
  started_at: string;
  ended_at: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export interface UsageSummary {
  calls: number;
  success: number;
  error: number;
  aborted: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  unknown_token_records: number;
}

export interface UsageResponse extends Paged<UsageRecord> {
  summary: UsageSummary;
}

export interface AdminConversation {
  id: string;
  owner_id: string;
  owner_username?: string;
  model_id: string;
  model_name?: string;
  title: string;
  /** 真实后端管理列表不计算会话状态；缺失时显示未知。 */
  status?: ConversationStatus | null;
  hidden: boolean;
  message_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface VisibleMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  created_at: string;
}

export interface ReviewFeedback {
  recorded: boolean;
  trace_id: string;
  result: 'success' | 'failed';
}

export interface MessagesResponse {
  items: VisibleMessage[];
  next_since: string | null;
  has_more: boolean;
  /** 真实后端在响应中不回传审阅反馈（审计已写库）；仅 mock 契约模式提供。 */
  review?: ReviewFeedback;
}

/** 真实后端审计动作为 user.create / provider.sync / model.update / grant.create /
 *  conversation.review 等小写点分值；页面按已知值映射文案，未知值原样展示。 */
export type AuditAction = string;

export interface AuditEntry {
  /** 真实后端无自增 ID；归一层用 trace_id 兜底作为列表 key。 */
  id: string;
  actor_id: string;
  actor_username?: string;
  action: AuditAction;
  object_type: string;
  object_id: string;
  result: 'success' | 'failed';
  detail?: string;
  trace_id: string;
  created_at?: string;
}
