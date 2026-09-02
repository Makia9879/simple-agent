/**
 * 用户管理 API（AU-02）。
 *
 * 真实后端约束（backend handler + DisallowUnknownFields）：
 * - POST /admin/users 仅接受 {username, password, role}（键名按 Go 字段大小写不敏感匹配），
 *   任何额外字段（昵称、邮箱等）都会被 400 拒绝；
 * - 密码至少 12 位（pbkdf2 哈希前校验）；
 * - PATCH /admin/users/{id} 仅接受 {status, role}；
 * - POST /admin/users/{id}/reset-password 仅接受 {password}；
 * - GET /admin/users 返回全量数组 {items:[{id,username,role,status}]}，无服务端分页，
 *   过滤与分页在客户端完成。
 */
import { apiRequest } from '../client';
import { buildPaged, normalizeItems, normalizeUser } from '../wire';
import type { AdminUser, Paged, Role, UserStatus } from '../types';

/** 真实后端密码策略：pbkdf2 哈希前要求至少 12 位。 */
export const MIN_PASSWORD_LENGTH = 12;

export interface UserListQuery {
  query?: string;
  status?: UserStatus;
  page: number;
  page_size: number;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: Role;
}

export interface UpdateUserPayload {
  role?: Role;
  status?: UserStatus;
}

function validatePasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (password.length > 64) {
    return '密码长度不能超过 64 位';
  }
  return null;
}

function validateUsername(username: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return '用户名需为 3-32 位字母、数字或下划线';
  }
  return null;
}

export function listUsers(query: UserListQuery): Promise<Paged<AdminUser>> {
  return apiRequest<unknown>('/admin/users').then((payload) => {
    let rows = normalizeItems<AdminUser>(payload, normalizeUser);
    const keyword = (query.query ?? '').trim().toLowerCase();
    if (keyword) {
      rows = rows.filter(
        (u) =>
          u.username.toLowerCase().includes(keyword) ||
          (u.nickname ?? '').toLowerCase().includes(keyword) ||
          (u.email ?? '').toLowerCase().includes(keyword),
      );
    }
    if (query.status === 'active' || query.status === 'disabled') {
      rows = rows.filter((u) => u.status === query.status);
    }
    rows.sort((a, b) => a.username.localeCompare(b.username));
    return buildPaged(rows, query.page, query.page_size);
  });
}

export function createUser(payload: CreateUserPayload): Promise<AdminUser> {
  const invalid = validateUsername(payload.username) ?? validatePasswordPolicy(payload.password);
  if (invalid) {
    return Promise.reject(new Error(invalid));
  }
  // 只发送后端白名单字段；多余字段会被 DisallowUnknownFields 拒绝。
  return apiRequest<unknown>('/admin/users', {
    method: 'POST',
    body: { username: payload.username, password: payload.password, role: payload.role },
  }).then((payload2) => normalizeUser((payload2 ?? {}) as Record<string, unknown>));
}

export function updateUser(id: string, payload: UpdateUserPayload): Promise<AdminUser> {
  const body: Record<string, string> = {};
  if (payload.status !== undefined) {
    body.status = payload.status;
  }
  if (payload.role !== undefined) {
    body.role = payload.role;
  }
  return apiRequest<unknown>(`/admin/users/${id}`, { method: 'PATCH', body }).then((payload2) =>
    normalizeUser((payload2 ?? {}) as Record<string, unknown>),
  );
}

export function resetPassword(id: string, newPassword: string): Promise<void> {
  const invalid = validatePasswordPolicy(newPassword);
  if (invalid) {
    return Promise.reject(new Error(invalid));
  }
  return apiRequest<void>(`/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: { password: newPassword },
  });
}
