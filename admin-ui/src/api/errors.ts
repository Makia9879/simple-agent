/**
 * 统一错误结构与脱敏（F9：错误文案不得包含内部路径、堆栈或凭据）。
 * 契约错误结构见 docs/program-design.md §6.5。
 */

export interface ApiErrorShape {
  code: string;
  message: string;
  request_id?: string;
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: '登录状态已失效，请重新登录',
  FORBIDDEN: '没有权限执行该操作',
  MODEL_NOT_AUTHORIZED: '当前用户无权使用该模型',
  NOT_FOUND: '请求的对象不存在',
  CONVERSATION_BUSY: '该会话正在生成中，请稍候再试',
  NO_ACTIVE_GENERATION: '当前没有正在进行的生成',
  CONCURRENCY_LIMIT: '并发数已达上限，请稍后再试',
  LOGIN_RATE_LIMITED: '登录尝试过于频繁，请稍后再试',
  PI_UNAVAILABLE: 'PI 服务暂时不可用，请稍后重试',
  PROVIDER_ERROR: '模型服务暂时不可用，请稍后重试',
  PROVIDER_TIMEOUT: '模型服务响应超时，请稍后重试',
  VALIDATION_ERROR: '请求参数不合法，请检查输入',
};

const SENSITIVE_PATTERNS: RegExp[] = [
  // 绝对路径（Unix 风格）
  /\/(?:Users|home|var|tmp|root|opt|etc)\/[^\s'"，。；)]*/g,
  // 堆栈帧
  /\bat\s+[\w$./<>[\]-]+\s*(?:\([^)]*\))?/gi,
  // 常见凭据形态
  /sk-[A-Za-z0-9_-]{6,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /(api[_-]?key|apikey|secret|passwd?)\s*[:=]\s*\S+/gi,
];

/** 对任何来源的错误文本做脱敏与截断，供界面展示。 */
export function sanitizeErrorMessage(message: string): string {
  let out = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, '[已脱敏]');
  }
  return out.slice(0, 200);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** 供界面展示的安全文案：优先使用服务端给定文案（脱敏后），其次按错误码映射。 */
  get displayMessage(): string {
    const fromServer = sanitizeErrorMessage(this.message).trim();
    if (fromServer.length > 0) {
      return fromServer;
    }
    return FRIENDLY_MESSAGES[this.code] ?? '操作失败，请稍后重试';
  }
}

/** 把未知异常规约为 ApiError，便于统一展示。 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    return err;
  }
  if (err instanceof Error) {
    return new ApiError(0, 'UNKNOWN', sanitizeErrorMessage(err.message));
  }
  return new ApiError(0, 'UNKNOWN', '操作失败，请稍后重试');
}
