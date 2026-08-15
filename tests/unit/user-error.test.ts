// R2: unified renderer error exit — safe message, errorId, retryable
// classification, three-layer separation (user copy / errorId / dev log).
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/error-model';
import { describeUserError, errorMessageFrom } from '@/lib/user-error';

describe('user-error helper (R2)', () => {
  it('sanitizes raw errors: no stack frames, no secrets, bounded length', () => {
    const raw = 'boom sk-ant-1234567890abcdefgh at C:\\Users\\me\\secret\\file.ts'
      + '\n    at Module.load (node:internal/modules)';
    const details = describeUserError(new Error(raw));
    expect(details.message).not.toContain('at Module.load');
    expect(details.message).not.toContain('sk-ant-1234567890abcdefgh');
    expect(details.code).toBe('UNKNOWN');
  });

  it('classifies retryable errors and keeps friendly code-mapped copy', () => {
    expect(describeUserError(new AppError('NETWORK', 'econnrefused')).retryable).toBe(true);
    expect(describeUserError(new AppError('TIMEOUT', 'timeout')).retryable).toBe(true);
    expect(describeUserError(new AppError('GATEWAY', 'gateway down')).retryable).toBe(true);
    expect(describeUserError(new AppError('PERMISSION', 'denied')).retryable).toBe(false);
    expect(describeUserError(new AppError('AUTH_INVALID', 'bad key')).message).toContain('Authentication failed');
  });

  it('mints a distinct errorId per call for the developer log reference', () => {
    const first = describeUserError(new Error('one'));
    const second = describeUserError(new Error('two'));
    expect(first.errorId).toMatch(/^err-/);
    expect(second.errorId).toMatch(/^err-/);
    expect(first.errorId).not.toBe(second.errorId);
  });

  it('exposes a one-liner safe message helper', () => {
    const message = errorMessageFrom(new Error('secret sk-12345678901234567890'));
    // sanitizeUiErrorText rewrites the key to sk-[REDACTED]; the secret value must never survive.
    expect(message).not.toContain('12345678901234567890');
    expect(message).toContain('sk-[REDACTED]');
  });
});
