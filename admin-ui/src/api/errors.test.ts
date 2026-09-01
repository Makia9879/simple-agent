/**
 * F9 安全收口：错误信息脱敏与友好映射。
 */
import { describe, expect, it } from 'vitest';

import { ApiError, sanitizeErrorMessage, toApiError } from './errors';

describe('sanitizeErrorMessage', () => {
  it('抹除绝对路径、堆栈帧与凭据形态', () => {
    const dirty = 'failed at /Users/admin/secret/agent.ts:12 (node:internal) api_key=abc123 Bearer abc.def.ghi sk-abcdef123456';
    const clean = sanitizeErrorMessage(dirty);
    expect(clean).not.toContain('/Users/');
    expect(clean).not.toContain('api_key=abc123');
    expect(clean).not.toContain('Bearer');
    expect(clean).not.toContain('sk-abcdef123456');
  });

  it('超长文本被截断', () => {
    expect(sanitizeErrorMessage('x'.repeat(500))).toHaveLength(200);
  });
});

describe('ApiError.displayMessage', () => {
  it('优先展示脱敏后的服务端文案', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', '用户名已存在');
    expect(err.displayMessage).toBe('用户名已存在');
  });

  it('服务端无文案时按错误码映射', () => {
    const err = new ApiError(502, 'PI_UNAVAILABLE', '');
    expect(err.displayMessage).toBe('PI 服务暂时不可用，请稍后重试');
  });

  it('未知错误码回落到通用文案，且不透出内部细节', () => {
    const err = new ApiError(500, 'SOMETHING', 'at /etc/passwd boom');
    expect(err.displayMessage).not.toContain('/etc/passwd');
  });

  it('网络异常被规约为 ApiError', () => {
    const err = toApiError(new TypeError('fetch failed'));
    expect(err).toBeInstanceOf(ApiError);
    expect(toApiError('weird')).toBeInstanceOf(ApiError);
  });
});
