import { apiRequest } from '../client';
import type { AdminUser, Paged, Role, UserStatus } from '../types';

export interface UserListQuery {
  query?: string;
  status?: UserStatus;
  page: number;
  page_size: number;
}

export interface CreateUserPayload {
  username: string;
  nickname: string;
  email: string;
  role: Role;
  password?: string;
}

export interface UpdateUserPayload {
  nickname?: string;
  email?: string;
  role?: Role;
  status?: UserStatus;
}

export function listUsers(query: UserListQuery): Promise<Paged<AdminUser>> {
  return apiRequest<Paged<AdminUser>>('/admin/users', { query });
}

export function createUser(payload: CreateUserPayload): Promise<AdminUser> {
  return apiRequest<AdminUser>('/admin/users', { method: 'POST', body: payload });
}

export function updateUser(id: string, payload: UpdateUserPayload): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: payload });
}

export function resetPassword(id: string, newPassword: string): Promise<{ reset: boolean }> {
  return apiRequest<{ reset: boolean }>(`/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: { new_password: newPassword },
  });
}
