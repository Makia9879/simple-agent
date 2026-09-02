/**
 * 统一请求客户端：所有页面只通过本模块访问后端。
 * - 真实后端：HttpOnly Cookie（credentials: 'include'），开发态经 Vite 代理同源访问。
 * - mock 模式：额外携带 X-Mock-Session 头（见 mocks/session.ts）。
 * - 访问 Token 15 分钟过期：收到 401 时先尝试一次 POST /auth/refresh（合并并发刷新），
 *   成功后重放原请求；刷新失败按原 401 抛出，由路由守卫回到登录页。
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
  /** 供测试与刷新流程内部使用：本次请求不做 401 刷新重试。 */
  skipRefreshRetry?: boolean;
}

function buildUrl(path: string, query?: object): string {
  const url = new URL(`${API_BASE_URL}${path}`, globalThis.location.origin);
  for (const [key, rawValue] of Object.entries(query ?? {})) {
    const value = rawValue as unknown;
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(options: RequestOptions): Record<string, string> {
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
  return headers;
}

/**
 * 解析真实后端的错误响应体：
 * - 信封形 {"error":{"Code","Message","RequestID"}}（Go 结构体默认键，大小写不敏感兼容
 *   docs 契约的 code/message/request_id）；
 * - 字符串形 {"error":"password must be at least 12 characters"}（参数校验 / 重名等）。
 */
export function parseErrorShape(json: unknown): { code?: string; message?: string; requestId?: string } {
  if (json === null || typeof json !== 'object') {
    return {};
  }
  const error = (json as { error?: unknown }).error;
  if (typeof error === 'string') {
    return { message: error };
  }
  if (error === null || typeof error !== 'object') {
    return {};
  }
  const shape = error as Record<string, unknown>;
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    code: asString(shape.code) ?? asString(shape.Code),
    message: asString(shape.message) ?? asString(shape.Message),
    requestId: asString(shape.request_id) ?? asString(shape.RequestID),
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** 用 Refresh Cookie 换新的 Access Cookie；任意失败都视为需要重新登录。并发 401 共享同一次刷新。 */
async function refreshSession(): Promise<boolean> {
  if (refreshInFlight !== null) {
    return refreshInFlight;
  }
  const attempt = (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: USE_MOCK ? mockHeaders() : undefined,
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  })();
  refreshInFlight = attempt;
  const result = await attempt;
  // 刷新结束后立即释放，下一次 401 再触发新的刷新。
  if (refreshInFlight === attempt) {
    refreshInFlight = null;
  }
  return result;
}

function mockHeaders(): Record<string, string> {
  const session = getMockSessionHeader();
  return session ? { 'X-Mock-Session': session } : {};
}

function shouldTryRefresh(path: string, options: RequestOptions): boolean {
  if (options.skipRefreshRetry) {
    return false;
  }
  return !path.startsWith('/auth/');
}

async function execute(path: string, options: RequestOptions): Promise<Response> {
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: buildHeaders(options),
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await execute(path, options);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络请求失败，请检查连接后重试');
  }

  // 访问 Cookie 过期（401）时先刷新一次再重放；登录/刷新接口自身除外。
  if (response.status === 401 && shouldTryRefresh(path, options)) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await execute(path, options);
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', '网络请求失败，请检查连接后重试');
      }
    }
  }

  const json = await parseResponse(response);

  if (!response.ok) {
    const parsed = parseErrorShape(json);
    const shape: ApiErrorShape = {
      code: parsed.code ?? 'HTTP_ERROR',
      message: parsed.message ?? '',
      request_id: parsed.requestId,
    };
    throw new ApiError(response.status, shape.code, shape.message, shape.request_id);
  }

  return json as T;
}
