import { apiRequest } from '../client';
import type { UsageResponse } from '../types';

export interface UsageQuery {
  from?: string;
  to?: string;
  user_id?: string;
  model_id?: string;
  page: number;
  page_size: number;
}

export function listUsage(query: UsageQuery): Promise<UsageResponse> {
  return apiRequest<UsageResponse>('/admin/usage', { query });
}
