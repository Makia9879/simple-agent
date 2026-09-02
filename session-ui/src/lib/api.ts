import { API_BASE } from './config';
import { mockApi, type StreamEvent } from './mock-api';
import type { ApiError, Conversation, Message, Model, Usage, User } from './types';

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

type MessagePage = { items: Message[]; next_since?: string; has_more: boolean };
type Api = {
  login(username: string, password: string): Promise<User>;
  me(): Promise<User>;
  logout(): Promise<void>;
  models(): Promise<Model[]>;
  conversations(): Promise<Conversation[]>;
  createConversation(modelID: string): Promise<Conversation>;
  rename(id: string, title: string): Promise<Conversation>;
  remove(id: string): Promise<void>;
  messages(id: string, since?: string): Promise<MessagePage>;
  usage(from?: string, to?: string, modelID?: string): Promise<Usage[]>;
  abort(id: string): Promise<void>;
  send(id: string, content: string, signal: AbortSignal): AsyncGenerator<StreamEvent>;
};

const apiURL = (path: string) => `${API_BASE}${path}`;

type WireObject = Record<string, unknown>;
const object = (value: unknown): WireObject => value !== null && typeof value === 'object' ? value as WireObject : {};
const field = (raw: unknown, snake: string, pascal: string): unknown => {
  const source = object(raw);
  return source[snake] ?? source[pascal];
};
const text = (raw: unknown, snake: string, pascal: string, fallback = ''): string => {
  const value = field(raw, snake, pascal);
  return typeof value === 'string' ? value : fallback;
};
const bool = (raw: unknown, snake: string, pascal: string, fallback = false): boolean => {
  const value = field(raw, snake, pascal);
  return typeof value === 'boolean' ? value : fallback;
};
const items = (raw: unknown): unknown[] => {
  const value = field(raw, 'items', 'Items');
  return Array.isArray(value) ? value : [];
};
const model = (raw: unknown): Model => ({
  id: text(raw, 'id', 'ID'), name: text(raw, 'name', 'Name'), provider: text(raw, 'provider', 'Provider'),
  upstream_model_id: text(raw, 'upstream_model_id', 'UpstreamModelID')
});
const message = (raw: unknown): Message => ({
  id: text(raw, 'id', 'ID'), role: text(raw, 'role', 'Role') as Message['role'], content: text(raw, 'content', 'Content'),
  status: text(raw, 'status', 'Status') as Message['status'], created_at: text(raw, 'created_at', 'CreatedAt')
});
const usage = (raw: unknown): Usage => {
  const token = (snake: string, pascal: string): number | null => {
    const value = field(raw, snake, pascal);
    return typeof value === 'number' ? value : null;
  };
  return {
    request_id: text(raw, 'request_id', 'RequestID'), model_id: text(raw, 'model_id', 'ModelID'),
    started_at: text(raw, 'started_at', 'StartedAt'), status: text(raw, 'status', 'Status') as Usage['status'],
    input_tokens: token('input_tokens', 'InputTokens'), output_tokens: token('output_tokens', 'OutputTokens'), total_tokens: token('total_tokens', 'TotalTokens')
  };
};
const sseData = (raw: unknown): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [snake, pascal] of [['request_id', 'RequestID'], ['conversation_id', 'ConversationID'], ['delta', 'Delta'], ['finish_reason', 'FinishReason'], ['code', 'Code'], ['message', 'Message']] as const) {
    const value = field(raw, snake, pascal);
    if (value !== undefined) normalized[snake] = value;
  }
  return normalized;
};
const errorFrom = async (response: Response): Promise<ApiError> => {
  let code: string | undefined;
  let message = '请求未完成，请稍后重试';
  try {
    const payload: unknown = await response.json();
    const envelope = field(payload, 'error', 'Error');
    if (typeof envelope === 'string') message = envelope;
    else if (typeof payload === 'string') message = payload;
    else {
      code = text(envelope, 'code', 'Code') || undefined;
      message = text(envelope, 'message', 'Message', message);
    }
  } catch { /* a proxy must not expose its response body to the UI */ }
  const error = new Error(message) as ApiError;
  error.status = response.status;
  error.code = code;
  return error;
};

async function request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const response = await fetch(apiURL(path), { credentials: 'include', ...init });
  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await fetch(apiURL('/auth/refresh'), { method: 'POST', credentials: 'include' });
    if (refreshed.ok) return request(path, init, false);
  }
  if (!response.ok) throw await errorFrom(response);
  return response;
}
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const conversation = (raw: unknown): Conversation => ({
  id: text(raw, 'id', 'ID'), model_id: text(raw, 'model_id', 'ModelID'), title: text(raw, 'title', 'Title'),
  status: text(raw, 'status', 'Status') as Conversation['status'],
  updated_at: text(raw, 'updated_at', 'UpdatedAt') || text(raw, 'created_at', 'CreatedAt') || new Date(0).toISOString()
});

async function* readSSE(response: Response, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error('模型服务暂时不可用');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal.aborted) return;
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, '\n');
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        let event = '';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (!event || !data.length) continue;
        if (!['text_delta', 'usage', 'done', 'error'].includes(event)) continue;
        try { yield { event: event as StreamEvent['event'], data: sseData(JSON.parse(data.join('\n'))) }; } catch { /* ignore malformed SSE frames */ }
      }
    }
  } finally { reader.releaseLock(); }
}

const httpApi: Api = {
  async login(username, password) { return (await request('/auth/login', { method: 'POST', ...json({ username, password }) })).json().then(x => x.user); },
  async me() { return (await request('/auth/me')).json(); },
  async logout() { await request('/auth/logout', { method: 'POST' }); },
  async models() { return (await request('/models')).json().then(payload => items(payload).map(model)); },
  async conversations() { return (await request('/conversations')).json().then(payload => items(payload).map(conversation)); },
  async createConversation(modelID) { return conversation(await (await request('/conversations', { method: 'POST', ...json({ model_id: modelID }) })).json()); },
  async rename(id, title) { await request(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', ...json({ title }) }); return { ...(await this.conversations()).find(c => c.id === id)! }; },
  async remove(id) { await request(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async messages(id, since) {
    const query = new URLSearchParams({ limit: '50' }); if (since) query.set('since', since);
    return (await request(`/conversations/${encodeURIComponent(id)}/messages?${query}`)).json().then(payload => ({
      items: items(payload).map(message), next_since: text(payload, 'next_since', 'NextSince') || undefined,
      has_more: bool(payload, 'has_more', 'HasMore')
    }));
  },
  async usage(from, to, modelID) { const query = new URLSearchParams(); if (from) query.set('from', `${from}T00:00:00Z`); if (to) query.set('to', `${to}T23:59:59Z`); if (modelID) query.set('model_id', modelID); return (await request(`/usage?${query}`)).json().then(payload => items(payload).map(usage)); },
  async abort(id) { await request(`/conversations/${encodeURIComponent(id)}/abort`, { method: 'POST' }); },
  async *send(id, content, signal) {
    const response = await request(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', signal, ...json({ content }) });
    yield* readSSE(response, signal);
  }
};

/** The only UI API gateway. Set VITE_USE_MOCK=false to use REST/SSE with credentials. */
export const api: Api = USE_MOCK ? mockApi : httpApi;
