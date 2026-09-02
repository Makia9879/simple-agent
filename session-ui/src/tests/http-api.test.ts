import { beforeEach, describe, expect, it, vi } from 'vitest';

const response = (body: string, init: ResponseInit = {}) => new Response(body, init);
const sse = (chunks: string[]) => new Response(new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); }
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

describe('REST/SSE gateway when VITE_USE_MOCK=false', () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_USE_MOCK', 'false'); });

  it('uses the frozen REST paths, cookies, and parses split SSE frames', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({ user: { id: 'u_1', username: 'alice', role: 'user', status: 'active' } }), { status: 200 }))
      .mockResolvedValueOnce(sse([
        'event: text_delta\r\ndata: {"request_id":"req_1","conversation_id":"c_1",',
        '"delta":"你好"}\r\n\r\nevent: done\r\ndata: {"request_id":"req_1","finish_reason":"stop"}\r\n\r\n'
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('$lib/api');
    await expect(api.login('alice', 'demo')).resolves.toMatchObject({ id: 'u_1' });
    const events = [];
    for await (const event of api.send('c_1', '你好', new AbortController().signal)) events.push(event);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/auth/login', expect.objectContaining({ credentials: 'include', method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/conversations/c_1/messages', expect.objectContaining({ credentials: 'include', method: 'POST' }));
    expect(events).toEqual([
      { event: 'text_delta', data: { request_id: 'req_1', conversation_id: 'c_1', delta: '你好' } },
      { event: 'done', data: { request_id: 'req_1', finish_reason: 'stop' } }
    ]);
  });

  it('refreshes once after 401 and keeps stable public API errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('{"error":{"code":"UNAUTHENTICATED","message":"请先登录"}}', { status: 401 }))
      .mockResolvedValueOnce(response('{"user":{"id":"u_1"}}', { status: 200 }))
      .mockResolvedValueOnce(response('{"id":"u_1","username":"alice","role":"user","status":"active"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('$lib/api');
    await expect(api.me()).resolves.toMatchObject({ username: 'alice' });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/v1/auth/me', '/api/v1/auth/refresh', '/api/v1/auth/me']);
  });

  it('normalizes PascalCase Go structs from models, history, usage, and SSE', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('{"Items":[{"ID":"m_1","Name":"GLM","Provider":"glm","UpstreamModelID":"glm-4"}]}'))
      .mockResolvedValueOnce(response('{"items":[{"ID":"c_1","ModelID":"m_1","Title":"聊天","Status":"active","UpdatedAt":"2026-01-02T03:04:05Z"}]}'))
      .mockResolvedValueOnce(response('{"Items":[{"ID":"entry_1","Role":"assistant","Content":"你好","Status":"completed","CreatedAt":"2026-01-02T03:04:05Z"}],"NextSince":"entry_1","HasMore":true}'))
      .mockResolvedValueOnce(response('{"Items":[{"RequestID":"req_1","ModelID":"m_1","StartedAt":"2026-01-02T03:04:05Z","Status":"completed","InputTokens":2,"OutputTokens":3,"TotalTokens":5}]}'))
      .mockResolvedValueOnce(sse(['event: text_delta\ndata: {"RequestID":"req_1","ConversationID":"c_1","Delta":"你好"}\n\nevent: done\ndata: {"RequestID":"req_1","FinishReason":"stop"}\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('$lib/api');

    await expect(api.models()).resolves.toEqual([{ id: 'm_1', name: 'GLM', provider: 'glm', upstream_model_id: 'glm-4' }]);
    await expect(api.conversations()).resolves.toMatchObject([{ id: 'c_1', model_id: 'm_1', updated_at: '2026-01-02T03:04:05Z' }]);
    await expect(api.messages('c_1')).resolves.toEqual({ items: [{ id: 'entry_1', role: 'assistant', content: '你好', status: 'completed', created_at: '2026-01-02T03:04:05Z' }], next_since: 'entry_1', has_more: true });
    await expect(api.usage()).resolves.toEqual([{ request_id: 'req_1', model_id: 'm_1', started_at: '2026-01-02T03:04:05Z', status: 'completed', input_tokens: 2, output_tokens: 3, total_tokens: 5 }]);
    const events = [];
    for await (const event of api.send('c_1', '你好', new AbortController().signal)) events.push(event);
    expect(events).toEqual([
      { event: 'text_delta', data: { request_id: 'req_1', conversation_id: 'c_1', delta: '你好' } },
      { event: 'done', data: { request_id: 'req_1', finish_reason: 'stop' } }
    ]);
  });

  it('reads the Go Error envelope and string error bodies without exposing raw payloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('{"Error":{"Code":"MODEL_NOT_AUTHORIZED","Message":"当前用户无权使用该模型","RequestID":"req_1"}}', { status: 403 }))
      .mockResolvedValueOnce(response('"temporarily unavailable"', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('$lib/api');
    await expect(api.models()).rejects.toMatchObject({ status: 403, code: 'MODEL_NOT_AUTHORIZED', message: '当前用户无权使用该模型' });
    await expect(api.models()).rejects.toMatchObject({ status: 502, message: 'temporarily unavailable' });
  });
});
