import { apiRequest } from '../client';
import type {
  AdminConversation,
  AuditAction,
  AuditEntry,
  ConversationStatus,
  MessagesResponse,
  Paged,
} from '../types';

export interface ConversationListQuery {
  user_id?: string;
  model_id?: string;
  status?: ConversationStatus;
  hidden?: boolean;
  from?: string;
  to?: string;
  page: number;
  page_size: number;
}

export function listConversations(
  query: ConversationListQuery,
): Promise<Paged<AdminConversation>> {
  return apiRequest<Paged<AdminConversation>>('/admin/conversations', { query });
}

export interface MessagesQuery {
  since?: string;
  limit?: number;
}

export function readConversationMessages(
  conversationId: string,
  query: MessagesQuery = {},
): Promise<MessagesResponse> {
  return apiRequest<MessagesResponse>(`/admin/conversations/${conversationId}/messages`, {
    query,
  });
}

export interface AuditListQuery {
  action?: AuditAction;
  object_type?: string;
  from?: string;
  to?: string;
  page: number;
  page_size: number;
}

export function listAudit(query: AuditListQuery): Promise<Paged<AuditEntry>> {
  return apiRequest<Paged<AuditEntry>>('/admin/audit', { query });
}
