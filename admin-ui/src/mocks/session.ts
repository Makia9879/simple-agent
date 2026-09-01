/**
 * Mock 会话桥（仅 mock 模式使用）。
 *
 * 真实后端使用 HttpOnly Cookie（tah_access / tah_refresh）；
 * Service Worker 合成响应无法写入浏览器 Cookie，因此 mock 模式下用
 * sessionStorage 保存会话并通过 X-Mock-Session 头随请求发送，由 MSW
 * handler 视为 Cookie。切到真实后端时此文件不再参与请求链路。
 */

export interface MockSession {
  user_id: string;
  username: string;
  role: 'admin' | 'user';
  issued_at: number;
}

const STORAGE_KEY = 'tah_admin_mock_session';

function encode(value: MockSession): string {
  return globalThis.btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function decode(raw: string): MockSession | null {
  try {
    return JSON.parse(decodeURIComponent(escape(globalThis.atob(raw)))) as MockSession;
  } catch {
    return null;
  }
}

export function getMockSessionHeader(): string | null {
  try {
    return globalThis.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function decodeMockSession(raw: string | null | undefined): MockSession | null {
  if (!raw) {
    return null;
  }
  return decode(raw);
}

export function saveMockSession(session: MockSession): void {
  try {
    globalThis.sessionStorage.setItem(STORAGE_KEY, encode(session));
  } catch {
    // sessionStorage 不可用时忽略（例如隐私模式），登录态仅存内存
  }
}

export function clearMockSession(): void {
  try {
    globalThis.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
