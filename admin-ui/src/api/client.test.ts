/**
 * 请求客户端测试（真实 API 路径的关键行为）：
 * - 两种错误体（Go 风格信封 / 字符串形）都能解析；
 * - 401 时先刷新一次再重放原请求（Access Cookie 15 分钟过期场景）；
 * - 刷新失败按原 401 抛出；登录/刷新接口自身不做刷新重试；
 * - 网络异常归一为 NETWORK_ERROR。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, parseErrorShape } from './client';
import { ApiError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseErrorShape', () => {
  it('真实后端信封：{"error":{"Code","Message","RequestID"}}', () => {
    expect(parseErrorShape({ error: { Code: 'UNAUTHENTICATED', Message: '请先登录', RequestID: 'req_1' } })).toEqual({
      code: 'UNAUTHENTICATED',
      message: '请先登录',
      requestId: 'req_1',
    });
  });

  it('契约信封：{"error":{"code","message","request_id"}}', () => {
    expect(parseErrorShape({ error: { code: 'FORBIDDEN', message: 'no', request_id: 'r' } })).toEqual({
      code: 'FORBIDDEN',
      message: 'no',
      requestId: 'r',
    });
  });

  it('字符串形：{"error":"password must be at least 12 characters"}', () => {
    expect(parseErrorShape({ error: 'password must be at least 12 characters' })).toEqual({
      message: 'password must be at least 12 characters',
    });
  });

  it('非错误结构返回空对象', () => {
    expect(parseErrorShape({ ok: true })).toEqual({});
    expect(parseErrorShape(null)).toEqual({});
  });
});

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('401 触发一次 /auth/refresh，成功后重放原请求', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, { user: { id: 'u_1', username: 'a', role: 'admin', status: 'active' } });
      }
      if (url.includes('/admin/users')) {
        const callsForUsers = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/admin/users')).length;
        if (callsForUsers === 1) {
          return jsonResponse(401, { error: { Code: 'UNAUTHENTICATED', Message: '请先登录', RequestID: 'r' } });
        }
        return jsonResponse(200, { items: [{ id: 'u_1', username: 'a', role: 'admin', status: 'active' }] });
      }
      return jsonResponse(500, {});
    });

    const payload = await apiRequest<{ items: unknown[] }>('/admin/users');
    expect(payload.items).toHaveLength(1);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('刷新失败时按原 401 抛出且只刷新一次', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(401, { error: { Code: 'UNAUTHENTICATED', Message: '请先登录', RequestID: 'r' } });
      }
      return jsonResponse(401, { error: { Code: 'UNAUTHENTICATED', Message: '请先登录', RequestID: 'r' } });
    });

    await expect(apiRequest('/admin/audit')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('登录接口自身不做刷新重试', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { Code: 'UNAUTHENTICATED', Message: '请先登录', RequestID: 'r' } }));

    await expect(apiRequest('/auth/login', { method: 'POST', body: { username: 'a', password: 'b' } })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('字符串形错误体映射为可展示消息（本地化 + 脱敏）', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'password must be at least 12 characters' }));

    const error = await apiRequest('/admin/users', { method: 'POST', body: {} }).catch((e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).displayMessage).toBe('密码长度至少 12 位');
  });

  it('网络异常归一为 NETWORK_ERROR', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(apiRequest('/admin/users')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('204 无内容返回 undefined', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});
