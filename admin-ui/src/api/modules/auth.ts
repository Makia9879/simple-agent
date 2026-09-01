import { apiRequest } from '../client';
import type { CurrentUser, LoginResponse } from '../types';

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' });
}

export function refresh(): Promise<void> {
  return apiRequest<void>('/auth/refresh', { method: 'POST' });
}

export function me(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>('/auth/me');
}
