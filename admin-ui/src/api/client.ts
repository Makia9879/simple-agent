/**
 * 统一请求客户端：所有页面只通过本模块访问后端。
 * - 真实后端：HttpOnly Cookie（credentials: 'include'）。
 * - mock 模式：额外携带 X-Mock-Session 头（见 mocks/session.ts）。
 */
import { API_BASE_URL, USE_MOCK } from '@/config';
import { ApiError, type ApiErrorShape } from './errors';
import { getMockSessionHeader } from '@/mocks/session';

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 查询参数对象；值为 undefined / null / 空字符串时跳过。 */
  query?: object;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`, globalThis.location.origin);
  for (const [key, raw] of Object.entries(options.query ?? {})) {
    const value = raw as unknown;
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (USE_MOCK) {
    const session = getMockSessionHeader();
    if (session) {
      headers['X-Mock-Session'] = session;
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络请求失败，请检查连接后重试');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let json: unknown;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!response.ok) {
    const shape = (json as { error?: ApiErrorShape } | undefined)?.error;
    throw new ApiError(
      response.status,
      shape?.code ?? 'HTTP_ERROR',
      shape?.message ?? '',
      shape?.request_id,
    );
  }

  return json as T;
}
