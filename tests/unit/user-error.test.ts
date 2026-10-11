// R2: unified renderer error exit — localized message, errorId, retryable
// classification, three-layer separation (user copy / errorId / dev log).
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { AppError } from '@/lib/error-model';
import { describeUserError, errorMessageFrom, toastUserError } from '@/lib/user-error';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
}));

describe('user-error helper (R2)', () => {
  it('sanitizes raw errors: no stack frames, no secrets, bounded length', () => {
    const raw = 'boom sk-ant-1234567890abcdefgh at C:\\Users\\me\\secret\\file.ts'
      + '\n    at Module.load (node:internal/modules)';
    const details = describeUserError(new Error(raw));
    expect(details.message).not.toContain('at Module.load');
    expect(details.message).not.toContain('sk-ant-1234567890abcdefgh');
    expect(details.code).toBe('UNKNOWN');
  });

  it('classifies retryable errors and returns localized, key-addressed copy', () => {
    expect(describeUserError(new AppError('NETWORK', 'econnrefused')).retryable).toBe(true);
    expect(describeUserError(new AppError('TIMEOUT', 'timeout')).retryable).toBe(true);
    expect(describeUserError(new AppError('GATEWAY', 'gateway down')).retryable).toBe(true);
    expect(describeUserError(new AppError('PERMISSION', 'denied')).retryable).toBe(false);

    const auth = describeUserError(new AppError('AUTH_INVALID', 'bad key'));
    expect(auth.messageKey).toBe('common:errors.auth_invalid.what');
    expect(auth.message).toBe(i18n.t('common:errors.auth_invalid.what'));
    // The former hardcoded English constant must no longer be the contract.
    expect(auth.message).not.toBe('Authentication failed. Check API key or login session and retry.');
    expect(auth.responsibility).toBe(i18n.t('common:errors.auth_invalid.responsibility'));
    expect(auth.nextStep).toBe(i18n.t('common:errors.auth_invalid.nextStep'));
    expect(auth.responsibility.length).toBeGreaterThan(0);
    expect(auth.nextStep.length).toBeGreaterThan(0);
  });

  it('picks a different recovery affordance for refusal/balance than for transient classes', () => {
    expect(describeUserError(new AppError('BILLING', 'insufficient_balance')))
      .toMatchObject({ action: 'top_up_balance', retryable: false });
    expect(describeUserError(new AppError('AUTH_PERMANENT', 'invalid_api_key')))
      .toMatchObject({ action: 'fix_credentials', retryable: false });
    expect(describeUserError(new AppError('NETWORK', 'econnrefused')))
      .toMatchObject({ action: 'retry_now', retryable: true });
    expect(describeUserError(new AppError('TIMEOUT', 'timeout')))
      .toMatchObject({ action: 'verify_then_retry', retryable: true });
    expect(describeUserError(new AppError('RATE_LIMIT', 'HTTP 429')))
      .toMatchObject({ action: 'wait_then_retry', retryable: true });
  });

  it('mints a distinct errorId per call for the developer log reference', () => {
    const first = describeUserError(new Error('one'));
    const second = describeUserError(new Error('two'));
    expect(first.errorId).toMatch(/^err-/);
    expect(second.errorId).toMatch(/^err-/);
    expect(first.errorId).not.toBe(second.errorId);
  });

  it('uses the preserved host request id as the copyable error reference when present', () => {
    const details = describeUserError(new AppError('TIMEOUT', 'timeout', undefined, {}, 'req-host-118'));
    expect(details.errorId).toBe('req-host-118');
  });

  it('exposes a one-liner safe message helper', () => {
    const message = errorMessageFrom(new Error('secret sk-12345678901234567890'));
    // sanitizeUiErrorText rewrites the key to sk-[REDACTED]; the secret value must never survive.
    expect(message).not.toContain('12345678901234567890');
    expect(message).toContain('sk-[REDACTED]');
  });

  it('toasts message + responsibility + next step + error reference, never raw provider text', () => {
    const details = toastUserError(new AppError('BILLING', 'insufficient_balance sk-live-1234567890abcdef'));

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [string, { description: string }];
    expect(message).toBe(details.message);
    expect(message).not.toContain('insufficient_balance');
    expect(options.description).toContain(details.responsibility);
    expect(options.description).toContain(details.nextStep);
    expect(options.description).toContain(i18n.t('common:errorBoundary.errorReference'));
    expect(options.description).toContain(details.errorId);
  });

  it('keeps the caller fallback prefix for UNKNOWN and still appends the reference', () => {
    const details = toastUserError(new Error('boom sk-12345678901234567890'), { fallback: 'load failed' });
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [string, { description: string }];
    expect(details.code).toBe('UNKNOWN');
    expect(message.startsWith('load failed — ')).toBe(true);
    expect(message).toContain('sk-[REDACTED]');
    expect(options.description).toContain(details.errorId);
  });
});
