import { apiRequest } from '../client';
import type { AdminGroup, GroupStatus, Paged } from '../types';

export interface GroupListQuery {
  query?: string;
  status?: GroupStatus;
  page: number;
  page_size: number;
}

export interface CreateGroupPayload {
  name: string;
  description: string;
}

export interface UpdateGroupPayload {
  name?: string;
  description?: string;
  status?: GroupStatus;
}

export interface ChangeMembersPayload {
  add_user_ids: string[];
  remove_user_ids: string[];
}

export function listGroups(query: GroupListQuery): Promise<Paged<AdminGroup>> {
  return apiRequest<Paged<AdminGroup>>('/admin/groups', { query });
}

export function createGroup(payload: CreateGroupPayload): Promise<AdminGroup> {
  return apiRequest<AdminGroup>('/admin/groups', { method: 'POST', body: payload });
}

export function updateGroup(id: string, payload: UpdateGroupPayload): Promise<AdminGroup> {
  return apiRequest<AdminGroup>(`/admin/groups/${id}`, { method: 'PATCH', body: payload });
}

export function changeMembers(
  id: string,
  payload: ChangeMembersPayload,
): Promise<AdminGroup> {
  return apiRequest<AdminGroup>(`/admin/groups/${id}/members`, {
    method: 'PATCH',
    body: payload,
  });
}
