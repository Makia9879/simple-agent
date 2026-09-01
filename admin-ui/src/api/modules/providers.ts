import { apiRequest } from '../client';
import type {
  EffectiveModel,
  Grant,
  ModelSummary,
  ProvidersResponse,
  SubjectType,
  SyncResponse,
} from '../types';

export function listProviders(): Promise<ProvidersResponse> {
  return apiRequest<ProvidersResponse>('/admin/providers');
}

export function syncProviders(): Promise<SyncResponse> {
  return apiRequest<SyncResponse>('/admin/providers/sync', { method: 'POST' });
}

export function listModels(): Promise<{ items: ModelSummary[] }> {
  return apiRequest<{ items: ModelSummary[] }>('/admin/models');
}

export function setModelEnabled(id: string, enabled: boolean): Promise<ModelSummary> {
  return apiRequest<ModelSummary>(`/admin/models/${id}`, {
    method: 'PATCH',
    body: { enabled },
  });
}

export interface GrantListQuery {
  subject_type?: SubjectType;
  subject_id?: string;
  model_id?: string;
}

export function listGrants(query: GrantListQuery = {}): Promise<{ items: Grant[] }> {
  return apiRequest<{ items: Grant[] }>('/admin/grants', { query });
}

export interface CreateGrantPayload {
  subject_type: SubjectType;
  subject_id: string;
  model_id: string;
}

export function createGrant(payload: CreateGrantPayload): Promise<Grant> {
  return apiRequest<Grant>('/admin/grants', { method: 'POST', body: payload });
}

export function deleteGrant(payload: CreateGrantPayload): Promise<void> {
  const query: Record<string, string> = {
    subject_type: payload.subject_type,
    subject_id: payload.subject_id,
    model_id: payload.model_id,
  };
  return apiRequest<void>('/admin/grants', { method: 'DELETE', query });
}

export function effectiveModels(userId: string): Promise<{ items: EffectiveModel[] }> {
  return apiRequest<{ items: EffectiveModel[] }>(`/admin/users/${userId}/effective-models`);
}
