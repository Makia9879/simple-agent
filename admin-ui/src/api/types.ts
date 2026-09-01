/**
 * Terminal Agent Hub 后台 UI 使用的 API 契约类型。
 * 与 docs/program-design.md §6 / docs/task-breakdown.md §3.2 冻结契约一一对应。
 */

export type Role = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';
export type GroupStatus = 'active' | 'disabled';
export type ProviderStatus = 'active' | 'stale';
export type SubjectType = 'user' | 'group';
export type UsageStatus = 'success' | 'error' | 'aborted';
export type ConversationStatus = 'active' | 'generating' | 'readonly';
export type MessageStatus = 'completed' | 'aborted' | 'error';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
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

export interface AdminUser {
  id: string;
  username: string;
  nickname: string;
  email: string;
  role: Role;
  status: UserStatus;
  group_ids: string[];
  group_names: string[];
  created_at: string;
  updated_at: string;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string;
  status: GroupStatus;
  member_ids: string[];
  member_count: number;
  created_at: string;
  updated_at: string;
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
  subject_name: string;
  model_id: string;
  model_name: string;
  created_at: string;
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
  username: string;
  model_id: string;
  model_name: string;
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
  owner_username: string;
  model_id: string;
  model_name: string;
  title: string;
  status: ConversationStatus;
  hidden: boolean;
  message_count: number;
  created_at: string;
  updated_at: string;
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
  review: ReviewFeedback;
}

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DISABLE'
  | 'USER_ENABLE'
  | 'USER_RESET_PASSWORD'
  | 'GROUP_CREATE'
  | 'GROUP_UPDATE'
  | 'GROUP_MEMBERS_CHANGE'
  | 'PROVIDER_SYNC_SUCCESS'
  | 'PROVIDER_SYNC_FAILURE'
  | 'MODEL_ENABLE'
  | 'MODEL_DISABLE'
  | 'GRANT_CREATE'
  | 'GRANT_DELETE'
  | 'CONVERSATION_REVIEW';

export interface AuditEntry {
  id: string;
  actor_id: string;
  actor_username: string;
  action: AuditAction;
  object_type: string;
  object_id: string;
  result: 'success' | 'failed';
  detail: string;
  trace_id: string;
  created_at: string;
}
