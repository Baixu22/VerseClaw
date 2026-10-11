// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailoverError, coerceToFailoverError } from '../../openclaw_runtime/src/agents/failover-error';
import { redactProviderErrorBody } from '../../openclaw_runtime/src/agents/provider-http-errors';
import { resolveOpenAiCompatError } from '../../openclaw_runtime/src/gateway/openai-compat-errors';
import { retryAsync } from '../../openclaw_runtime/src/infra/retry';
import { createChannelApiRetryRunner } from '../../openclaw_runtime/src/infra/retry-policy';
import { MAX_TIMER_TIMEOUT_MS } from '../../openclaw_runtime/src/shared/number-coercion';

vi.mock('../../openclaw_runtime/src/infra/secure-random', () => ({
  generateSecureFraction: vi.fn(() => 0),
}));
import { generateSecureFraction } from '../../openclaw_runtime/src/infra/secure-random';
vi.mock('../../openclaw_runtime/src/logging/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../openclaw_runtime/src/logging/config')>(),
  readLoggingConfig: vi.fn(() => undefined),
}));
import { readLoggingConfig } from '../../openclaw_runtime/src/logging/config';

const secret = 'SYNTHETIC_NOT_A_CREDENTIAL_20261009';
const detail = `request_id=req-test-117 api_key=${secret} Authorization: Bearer ${secret} ${'x'.repeat(1800)}`;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(readLoggingConfig).mockReturnValue(undefined);
});

describe('public provider error boundary (#117)', () => {
  it.each([
    ['auth', 401, 'authentication_error'],
    ['auth_permanent', 403, 'permission_error'],
    ['billing', 402, 'insufficient_quota'],
    ['format', 400, 'invalid_request_error'],
    ['model_not_found', 404, 'invalid_request_error'],
    ['rate_limit', 429, 'rate_limit_error'],
    ['session_expired', 400, 'invalid_request_error'],
  ] as const)('redacts %s messages and preserves classification', (reason, status, type) => {
    const mapped = resolveOpenAiCompatError(new FailoverError('safe wrapper', {
      reason, status, rawError: detail, code: 'provider_code',
    }));
    expect(mapped).toMatchObject({ status, error: { type, code: 'provider_code' } });
    expect(mapped!.error.message).toBe(redactProviderErrorBody(detail));
    expect(mapped!.error.message.length).toBeLessThanOrEqual(500);
    expect(mapped!.error.message).toContain('request_id=req-test-117');
    expect(JSON.stringify(mapped)).not.toContain(secret);
  });

  it.each(['server_error', 'timeout', 'overloaded'] as const)('keeps stable %s errors and sanitizes code', (reason) => {
    const mapped = resolveOpenAiCompatError(new FailoverError(detail, { reason, code: detail }));
    expect(mapped!.error.message).toMatch(/^upstream provider /);
    expect(mapped!.error.code!.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(mapped)).not.toContain(secret);
  });

  it.each(['off', 'custom'])('keeps mandatory redaction when logging uses %s settings', (mode) => {
    vi.mocked(readLoggingConfig).mockReturnValue(mode === 'off'
      ? { redactSensitive: 'off' }
      : { redactPatterns: ['CUSTOM_SECRET_VALUE'] });
    const message = redactProviderErrorBody(`api_key=${secret} CUSTOM_SECRET_VALUE`);
    expect(message).not.toContain(secret);
    if (mode === 'custom') expect(message).not.toContain('CUSTOM_SECRET_VALUE');
  });

  it('redacts a normalized SDK error and a nested cause without mutating the original', () => {
    const raw = Object.assign(new Error(detail), { status: 401 });
    for (const error of [raw, new Error('SDK wrapper', { cause: raw })]) {
      const normalized = coerceToFailoverError(error);
      expect(normalized).not.toBeNull();
      const mapped = resolveOpenAiCompatError(normalized);
      expect(mapped?.status).toBe(401);
      expect(JSON.stringify(mapped)).not.toContain(secret);
      expect(mapped!.error.message.length).toBeLessThanOrEqual(500);
    }
    expect(raw.message).toBe(detail);
  });

  it('keeps an already sanitized preview readable and leaves unclassified failures to the generic handler', () => {
    const preview = redactProviderErrorBody(detail);
    const message = resolveOpenAiCompatError(new FailoverError(preview, { reason: 'auth' }))!.error.message;
    expect(message).toContain('request_id=req-test-117');
    expect(message).not.toContain(secret);
    expect(message.length).toBeLessThanOrEqual(500);
    expect(resolveOpenAiCompatError(new Error('unclassified failure'))).toBeUndefined();
  });
});

describe('Retry-After lower bound (#119)', () => {
  it.each([[0, 0], [0.5, 0], [0.5, 0.999999]])('honors hints with jitter=%s fraction=%s', async (jitter, fraction) => {
    vi.useFakeTimers();
    vi.mocked(generateSecureFraction).mockReturnValue(fraction);
    for (const hint of [0, 1.4, 50, 100]) {
      const error = new Error('synthetic 429');
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');
      const onRetry = vi.fn();
      const result = retryAsync(fn, { attempts: 2, minDelayMs: 0, maxDelayMs: 100,
        retryAfterMs: () => hint, jitter, onRetry });
      await vi.advanceTimersByTimeAsync(0);
      const delay = onRetry.mock.calls[0][0].delayMs;
      expect(delay).toBeGreaterThanOrEqual(Math.ceil(hint));
      expect(delay).toBeLessThanOrEqual(100);
      if (delay > 0) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
      }
      await expect(result).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    }
  });

  it.each([100.1, 250, MAX_TIMER_TIMEOUT_MS + 1])('stops before scheduling an unsatisfiable hint %s', async (hint) => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('synthetic 429'), { retryAfterMs: hint });
    const fn = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();
    await expect(retryAsync(fn, { attempts: 2, minDelayMs: 0, maxDelayMs: 100,
      retryAfterMs: () => hint, jitter: 0.5, onRetry })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a hint beyond the timer range even when zero maxDelay means uncapped', async () => {
    vi.useFakeTimers();
    const error = new Error('synthetic 429');
    const fn = vi.fn().mockRejectedValue(error);
    await expect(retryAsync(fn, { attempts: 2, minDelayMs: 0, maxDelayMs: 0,
      retryAfterMs: () => MAX_TIMER_TIMEOUT_MS + 1 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps positive jitter at the platform timer limit without violating the hint', async () => {
    vi.useFakeTimers();
    vi.mocked(generateSecureFraction).mockReturnValue(0.999999);
    const fn = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue('ok');
    const onRetry = vi.fn();
    const result = retryAsync(fn, { attempts: 2, minDelayMs: 0, maxDelayMs: 0, jitter: 1,
      retryAfterMs: () => MAX_TIMER_TIMEOUT_MS, onRetry });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry.mock.calls[0][0].delayMs).toBe(MAX_TIMER_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(MAX_TIMER_TIMEOUT_MS);
    await expect(result).resolves.toBe('ok');
  });

  it.each([undefined, NaN, Infinity, -1])('uses ordinary exponential backoff for invalid hint %s', async (hint) => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(new Error('retry')).mockRejectedValueOnce(new Error('retry')).mockResolvedValue('ok');
    const onRetry = vi.fn();
    const result = retryAsync(fn, { attempts: 3, minDelayMs: 10, maxDelayMs: 100,
      retryAfterMs: () => hint, jitter: 0, onRetry });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry.mock.calls[0][0].delayMs).toBe(10);
    await vi.advanceTimersByTimeAsync(30);
    expect(onRetry.mock.calls.map(([info]) => info.delayMs)).toEqual([10, 20]);
    await expect(result).resolves.toBe('ok');
  });

  it('preserves exponential backoff and maximum attempts', async () => {
    vi.useFakeTimers();
    const error = new Error('retry');
    const fn = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();
    const result = retryAsync(fn, { attempts: 3, minDelayMs: 10, maxDelayMs: 100, jitter: 0, onRetry });
    const rejected = expect(result).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await rejected;
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([info]) => info.delayMs)).toEqual([10, 20]);
  });

  it.each(['root', 'response', 'error'])('does not resend channel retry_after=120 from %s', async (shape) => {
    vi.useFakeTimers();
    const parameters = { retry_after: 120 };
    const error = Object.assign(new Error('429 Too Many Requests'),
      shape === 'root' ? { parameters } : { [shape]: { parameters } });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(createChannelApiRetryRunner({})(fn)).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains structured retry metadata when a channel throws a non-Error object', async () => {
    const error = { message: '429 Too Many Requests', parameters: { retry_after: 120 }, status: 429 };
    const fn = vi.fn().mockRejectedValue(error);
    await expect(createChannelApiRetryRunner({})(fn)).rejects.toMatchObject({
      cause: error, parameters: error.parameters, status: 429,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never overrides strict shouldRetry for a non-idempotent channel call', async () => {
    const error = Object.assign(new Error('429 Too Many Requests'), { parameters: { retry_after: 0 } });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(createChannelApiRetryRunner({ shouldRetry: () => false, strictShouldRetry: true })(fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
