/**
 * 全局用量 API（AU-08）。
 *
 * 真实后端约束：GET /admin/usage 返回全量数组（items 元素为 RequestID/ConversationID/
 * UserID/ModelID/Status/InputTokens/OutputTokens/TotalTokens/StartedAt/EndedAt），状态取值
 * completed/aborted/failed，未知 Token 为 null。后端支持 from/to/user_id/model_id 查询参数，
 * 但不返回汇总与分页：过滤、汇总、分页都在客户端完成，且不伪造估算值。
 */
import { apiRequest } from '../client';
import { buildPaged, normalizeItems, normalizeUsage } from '../wire';
import type { UsageRecord, UsageResponse, UsageSummary } from '../types';

export interface UsageQuery {
  from?: string;
  to?: string;
  user_id?: string;
  model_id?: string;
  page: number;
  page_size: number;
}

/** 汇总：只统计已知值，未知记录数单列，不伪造估算值。 */
export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  const sum = (pick: (r: UsageRecord) => number | null): number | null => {
    const known = records.map(pick).filter((v): v is number => typeof v === 'number');
    if (known.length === 0) {
      return null;
    }
    return known.reduce((acc, v) => acc + v, 0);
  };
  return {
    calls: records.length,
    success: records.filter((r) => r.status === 'completed' || r.status === 'success').length,
    error: records.filter((r) => r.status === 'failed' || r.status === 'error').length,
    aborted: records.filter((r) => r.status === 'aborted').length,
    input_tokens: sum((r) => r.input_tokens),
    output_tokens: sum((r) => r.output_tokens),
    total_tokens: sum((r) => r.total_tokens),
    unknown_token_records: records.filter((r) => r.total_tokens === null).length,
  };
}

export function listUsage(query: UsageQuery): Promise<UsageResponse> {
  return apiRequest<unknown>('/admin/usage', { query }).then((payload) => {
    let rows = normalizeItems<UsageRecord>(payload, normalizeUsage);
    if (query.from) {
      rows = rows.filter((r) => r.started_at >= query.from!);
    }
    if (query.to) {
      rows = rows.filter((r) => r.started_at <= query.to!);
    }
    if (query.user_id) {
      rows = rows.filter((r) => r.user_id === query.user_id);
    }
    if (query.model_id) {
      rows = rows.filter((r) => r.model_id === query.model_id);
    }
    rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
    const summary = summarizeUsage(rows);
    return { ...buildPaged(rows, query.page, query.page_size), summary };
  });
}
