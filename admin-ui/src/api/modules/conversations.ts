/**
 * 会话审阅与审计 API（AU-09 ~ AU-12）。
 *
 * 真实后端约束：
 * - GET /admin/conversations 的 items 是「以会话 ID 为键的对象」，字段 ID/OwnerID/ModelID/
 *   SessionRef/Title/Hidden/CreatedAt/UpdatedAt —— 不含计算出的 status 与消息数，
 *   SessionRef（PI 会话引用）在归一层被丢弃，永不展示；
 * - GET /admin/conversations/{id}/messages 返回 {Items,NextSince,HasMore}（Go 风格键，
 *   Items 可能为 null），并在服务端先写审阅审计再读正文；响应不回传审阅反馈，
 *   界面按「请求成功即已记录审计」展示；
 * - GET /admin/audit 的 items 是数组（可能为 null），动作是 user.create / provider.sync /
 *   model.update / grant.create / conversation.review 等小写点分值。
 */
import { apiRequest } from '../client';
import { buildPaged, normalizeAudit, normalizeConversation, normalizeItems, normalizeMessagesPage } from '../wire';
import type { AdminConversation, AuditEntry, MessagesResponse, Paged } from '../types';

export interface ConversationListQuery {
  user_id?: string;
  model_id?: string;
  hidden?: boolean;
  from?: string;
  to?: string;
  page: number;
  page_size: number;
}

export function listConversations(query: ConversationListQuery): Promise<Paged<AdminConversation>> {
  return apiRequest<unknown>('/admin/conversations').then((payload) => {
    let rows = normalizeItems<AdminConversation>(payload, normalizeConversation);
    if (query.user_id) {
      rows = rows.filter((c) => c.owner_id === query.user_id);
    }
    if (query.model_id) {
      rows = rows.filter((c) => c.model_id === query.model_id);
    }
    if (query.hidden !== undefined) {
      rows = rows.filter((c) => c.hidden === query.hidden);
    }
    if (query.from) {
      rows = rows.filter((c) => (c.updated_at ?? c.created_at ?? '') >= query.from!);
    }
    if (query.to) {
      rows = rows.filter((c) => (c.updated_at ?? c.created_at ?? '') <= query.to!);
    }
    rows.sort((a, b) =>
      (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''),
    );
    return buildPaged(rows, query.page, query.page_size);
  });
}

export interface MessagesQuery {
  since?: string;
  limit?: number;
}

export function readConversationMessages(
  conversationId: string,
  query: MessagesQuery = {},
): Promise<MessagesResponse> {
  return apiRequest<unknown>(`/admin/conversations/${conversationId}/messages`, {
    query,
  }).then((payload) => {
    const page = normalizeMessagesPage(payload);
    const review = (payload as { review?: MessagesResponse['review'] } | null)?.review;
    return review !== undefined ? { ...page, review } : page;
  });
}

export interface AuditListQuery {
  action?: string;
  object_type?: string;
  from?: string;
  to?: string;
  page: number;
  page_size: number;
}

export function listAudit(query: AuditListQuery): Promise<Paged<AuditEntry>> {
  return apiRequest<unknown>('/admin/audit').then((payload) => {
    let rows = normalizeItems<AuditEntry>(payload, normalizeAudit);
    if (query.action) {
      rows = rows.filter((a) => a.action === query.action);
    }
    if (query.object_type) {
      rows = rows.filter((a) => a.object_type === query.object_type);
    }
    if (query.from) {
      rows = rows.filter((a) => (a.created_at ?? '') >= query.from!);
    }
    if (query.to) {
      rows = rows.filter((a) => (a.created_at ?? '') <= query.to!);
    }
    rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id.localeCompare(a.id));
    return buildPaged(rows, query.page, query.page_size);
  });
}
