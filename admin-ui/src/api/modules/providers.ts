/**
 * Provider / Model / 授权 API（AU-04 ~ AU-07）。
 *
 * 真实后端约束（backend handler）：
 * - GET /admin/providers 的 items 是「以 provider 为键的对象」，字段 Provider/Name/Status/
 *   LastSyncedAt，不含模型清单 —— 模型统一从 GET /admin/models 读取后按 provider 合并展示；
 * - POST /admin/providers/sync 成功返回 {items:{...}}；失败返回 502 PI_UNAVAILABLE 信封，
 *   服务端已把旧快照标记为 stale；
 * - Grant 结构体未打 json tag：POST/DELETE 的请求体键必须是 SubjectType/SubjectID/ModelID
 *   （snake_case 键会因未知字段被 400 拒绝），且 DELETE 从请求体（而非查询串）解码；
 * - PATCH /admin/models/{id} 仅接受 {enabled}。
 */
import { apiRequest } from '../client';
import {
  normalizeEffectiveModel,
  normalizeGrant,
  normalizeItems,
  normalizeModel,
  normalizeProvider,
} from '../wire';
import type {
  EffectiveModel,
  Grant,
  ModelSummary,
  ProvidersResponse,
  SubjectType,
  SyncResponse,
} from '../types';

/** 把 /admin/models 的清单按 provider 分组，供 Provider 登记表展示。 */
async function providersWithModels(): Promise<ProvidersResponse> {
  const [providersPayload, modelsPayload] = await Promise.all([
    apiRequest<unknown>('/admin/providers'),
    apiRequest<unknown>('/admin/models'),
  ]);
  const models = normalizeItems<ModelSummary>(modelsPayload, normalizeModel);
  const byProvider = new Map<string, ModelSummary[]>();
  for (const model of models) {
    const bucket = byProvider.get(model.provider) ?? [];
    bucket.push(model);
    byProvider.set(model.provider, bucket);
  }
  const providers = normalizeItems((providersPayload ?? {}) as Record<string, unknown>, (entry) =>
    normalizeProvider(entry, byProvider),
  );
  providers.sort((a, b) => a.provider.localeCompare(b.provider));
  return { providers, last_sync_error: null };
}

export function listProviders(): Promise<ProvidersResponse> {
  return providersWithModels();
}

export function syncProviders(): Promise<SyncResponse> {
  return apiRequest<unknown>('/admin/providers/sync', { method: 'POST' }).then(async () => {
    // 同步成功后重新拉取（含模型清单）；失败由调用方捕获 ApiError（502 PI_UNAVAILABLE），
    // 页面随后调用 listProviders() 仍能看到被标记 stale 的旧快照。
    const fresh = await providersWithModels();
    return { result: 'success' as const, providers: fresh.providers, error: null };
  });
}

export function listModels(): Promise<{ items: ModelSummary[] }> {
  return apiRequest<unknown>('/admin/models').then((payload) => {
    const items = normalizeItems<ModelSummary>(payload, normalizeModel);
    items.sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
    );
    return { items };
  });
}

export function setModelEnabled(id: string, enabled: boolean): Promise<ModelSummary> {
  return apiRequest<unknown>(`/admin/models/${id}`, {
    method: 'PATCH',
    body: { enabled },
  }).then((payload) => normalizeModel((payload ?? {}) as Record<string, unknown>));
}

export interface GrantListQuery {
  subject_type?: SubjectType;
  subject_id?: string;
  model_id?: string;
}

export function listGrants(query: GrantListQuery = {}): Promise<{ items: Grant[] }> {
  return apiRequest<unknown>('/admin/grants').then((payload) => {
    let items = normalizeItems<Grant>(payload, normalizeGrant);
    if (query.subject_type === 'user' || query.subject_type === 'group') {
      items = items.filter((g) => g.subject_type === query.subject_type);
    }
    if (query.subject_id) {
      items = items.filter((g) => g.subject_id === query.subject_id);
    }
    if (query.model_id) {
      items = items.filter((g) => g.model_id === query.model_id);
    }
    items.sort(
      (a, b) =>
        a.subject_type.localeCompare(b.subject_type) ||
        a.subject_id.localeCompare(b.subject_id) ||
        a.model_id.localeCompare(b.model_id),
    );
    return { items };
  });
}

export interface CreateGrantPayload {
  subject_type: SubjectType;
  subject_id: string;
  model_id: string;
}

export function createGrant(payload: CreateGrantPayload): Promise<Grant> {
  if (!payload.subject_id || !payload.model_id) {
    return Promise.reject(new Error('请选择授权对象与模型'));
  }
  // 真实后端 Grant 结构体未打 json tag，请求体使用 Go 字段名。
  return apiRequest<unknown>('/admin/grants', {
    method: 'POST',
    body: {
      SubjectType: payload.subject_type,
      SubjectID: payload.subject_id,
      ModelID: payload.model_id,
    },
  }).then((payload2) => normalizeGrant((payload2 ?? {}) as Record<string, unknown>));
}

/** 撤销授权：与新增使用同一三项定位；真实后端从请求体读取（不是查询串）。 */
export function deleteGrant(payload: CreateGrantPayload): Promise<void> {
  return apiRequest<void>('/admin/grants', {
    method: 'DELETE',
    body: {
      SubjectType: payload.subject_type,
      SubjectID: payload.subject_id,
      ModelID: payload.model_id,
    },
  });
}

export function effectiveModels(userId: string): Promise<{ items: EffectiveModel[] }> {
  return apiRequest<unknown>(`/admin/users/${userId}/effective-models`).then((payload) => {
    const items = normalizeItems<EffectiveModel>(payload, normalizeEffectiveModel);
    items.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
    return { items };
  });
}
