/**
 * 用户组 API（AU-03）。
 *
 * 真实后端约束：
 * - Group 结构体只有 ID/Name/Status；POST/PATCH 请求体出现 description 等额外字段会被
 *   DisallowUnknownFields 拒绝；
 * - GET /admin/groups 的 items 是「以组 ID 为键的对象」，值字段为 ID/Name/Status；
 * - 后端没有组成员读取接口，member_ids 归一为 null（未知），界面需降级；
 * - PATCH /admin/groups/{id}/members 返回 {"ok":true}，不含更新后的组。
 */
import { apiRequest } from '../client';
import { buildPaged, normalizeGroup, normalizeItems } from '../wire';
import type { AdminGroup, GroupStatus, Paged } from '../types';

export interface GroupListQuery {
  query?: string;
  status?: GroupStatus;
  page: number;
  page_size: number;
}

export interface CreateGroupPayload {
  name: string;
}

export interface UpdateGroupPayload {
  name?: string;
  status?: GroupStatus;
}

export interface ChangeMembersPayload {
  add_user_ids: string[];
  remove_user_ids: string[];
}

export function listGroups(query: GroupListQuery): Promise<Paged<AdminGroup>> {
  return apiRequest<unknown>('/admin/groups').then((payload) => {
    let rows = normalizeItems<AdminGroup>(payload, normalizeGroup);
    const keyword = (query.query ?? '').trim().toLowerCase();
    if (keyword) {
      rows = rows.filter(
        (g) =>
          g.name.toLowerCase().includes(keyword) ||
          (g.description ?? '').toLowerCase().includes(keyword),
      );
    }
    if (query.status === 'active' || query.status === 'disabled') {
      rows = rows.filter((g) => g.status === query.status);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return buildPaged(rows, query.page, query.page_size);
  });
}

export function createGroup(payload: CreateGroupPayload): Promise<AdminGroup> {
  const name = payload.name.trim();
  if (name.length === 0 || name.length > 32) {
    return Promise.reject(new Error('用户组名称不能为空且不超过 32 个字符'));
  }
  return apiRequest<unknown>('/admin/groups', { method: 'POST', body: { name } }).then((payload2) =>
    normalizeGroup((payload2 ?? {}) as Record<string, unknown>),
  );
}

export function updateGroup(id: string, payload: UpdateGroupPayload): Promise<AdminGroup> {
  const body: Record<string, string> = {};
  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (name.length === 0 || name.length > 32) {
      return Promise.reject(new Error('用户组名称不能为空且不超过 32 个字符'));
    }
    body.name = name;
  }
  if (payload.status !== undefined) {
    body.status = payload.status;
  }
  return apiRequest<unknown>(`/admin/groups/${id}`, { method: 'PATCH', body }).then((payload2) =>
    normalizeGroup((payload2 ?? {}) as Record<string, unknown>),
  );
}

/** 变更成员：一次请求同时给出加入与移除（§6.4）。后端仅返回 {"ok":true}。 */
export function changeMembers(id: string, payload: ChangeMembersPayload): Promise<void> {
  return apiRequest<void>(`/admin/groups/${id}/members`, {
    method: 'PATCH',
    body: {
      add_user_ids: payload.add_user_ids,
      remove_user_ids: payload.remove_user_ids,
    },
  });
}
