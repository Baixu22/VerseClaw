/**
 * Issue #120: the unified user error exit must speak the active language and
 * classify from structured error data — never from an already-translated string.
 */
import { afterEach, describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { APP_ERROR_CODES, AppError, normalizeAppError } from '@/lib/error-model';
import { getErrorCopy, toUserMessage } from '@/lib/error-message';

const LANGUAGES = ['en', 'zh', 'ja', 'ru'] as const;

/** Exact-locale lookup (no fallbackLng), i.e. "is this key really translated?". */
function localized(language: (typeof LANGUAGES)[number], namespacedKey: string): string | undefined {
  return i18n.getResource(language, 'common', namespacedKey.replace(/^common:/, '')) as string | undefined;
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('error-message i18n contract', () => {
  it('carries what/whose/nextStep copy for every class in all four locales', () => {
    for (const code of APP_ERROR_CODES) {
      const copy = getErrorCopy(code);
      for (const key of [copy.messageKey, copy.responsibilityKey, copy.nextStepKey]) {
        expect(key, `${code} key scheme`).toMatch(
          /^common:errors\.[a-z0-9_]+\.(what|responsibility|nextStep)$/,
        );
        for (const language of LANGUAGES) {
          const value = localized(language, key);
          expect(typeof value === 'string' && value.trim().length > 0, `${language}:${key}`).toBe(true);
        }
      }
    }
  });

  it('renders the message in the active language instead of a hardcoded English constant', async () => {
    await i18n.changeLanguage('en');
    const english = toUserMessage(new AppError('AUTH_INVALID', 'Invalid Authentication'));
    expect(english).toBe(localized('en', 'common:errors.auth_invalid.what'));

    await i18n.changeLanguage('zh');
    const chinese = toUserMessage(new AppError('AUTH_INVALID', 'Invalid Authentication'));
    expect(chinese).toBe(localized('zh', 'common:errors.auth_invalid.what'));
    expect(chinese).not.toBe(english);
    expect(chinese).not.toContain('Authentication failed');
  });

  it('classifies from structured data, so a contradicting (or translated) string cannot change the class', async () => {
    // The human-readable text reads like a timeout; the structured HTTP status
    // says rate limited. Structure must win.
    const rateLimited = Object.assign(new Error('Request timed out. Please retry.'), { status: 429 });

    await i18n.changeLanguage('ja');
    expect(normalizeAppError(rateLimited).code).toBe('RATE_LIMIT');
    await i18n.changeLanguage('ru');
    expect(normalizeAppError(rateLimited).code).toBe('RATE_LIMIT');

    // ...and the localized copy describes the structured class, not the prose.
    expect(toUserMessage(rateLimited)).toBe(localized('ru', 'common:errors.rate_limit.what'));
  });

  it('keeps the UNKNOWN branch inside the redaction boundary', () => {
    const raw = 'read failed at C:\\Users\\me\\secret\\file.ts sk-proj-1234567890abcdefgh'
      + '\n    at Module.load (node:internal)';
    const msg = toUserMessage(new AppError('UNKNOWN', raw));
    expect(msg).not.toContain('at Module.load');
    expect(msg).not.toContain('sk-proj-1234567890abcdefgh');
    expect(msg).toContain('sk-proj-[REDACTED]');
  });

  it('falls back to the localized unknown copy when there is nothing to redact', async () => {
    await i18n.changeLanguage('ru');
    expect(toUserMessage(new AppError('UNKNOWN', ''))).toBe(localized('ru', 'common:errors.unknown.what'));
  });

  it('never resolves to retry_now for refusal or insufficient-balance classes', () => {
    expect(getErrorCopy('BILLING')).toMatchObject({ action: 'top_up_balance', retryable: false });
    expect(getErrorCopy('AUTH_PERMANENT')).toMatchObject({ action: 'fix_credentials', retryable: false });
    expect(getErrorCopy('AUTH_INVALID')).toMatchObject({ action: 'fix_credentials', retryable: false });
    expect(getErrorCopy('MODEL_NOT_FOUND')).toMatchObject({ action: 'choose_another_model', retryable: false });

    const nonRetryableActions = APP_ERROR_CODES
      .filter((code) => !getErrorCopy(code).retryable)
      .map((code) => getErrorCopy(code).action);
    expect(nonRetryableActions).not.toContain('retry_now');
    expect(nonRetryableActions).not.toContain('wait_then_retry');
  });

  it('separates plain retry from wait/verify variants for transient classes', () => {
    expect(getErrorCopy('NETWORK')).toMatchObject({ action: 'retry_now', retryable: true });
    // A timeout may already have produced an upstream side effect, and a rate
    // limit or overloaded provider needs pacing first — neither is "retry now".
    expect(getErrorCopy('TIMEOUT')).toMatchObject({ action: 'verify_then_retry', retryable: true });
    expect(getErrorCopy('RATE_LIMIT')).toMatchObject({ action: 'wait_then_retry', retryable: true });
    expect(getErrorCopy('OVERLOADED')).toMatchObject({ action: 'wait_then_retry', retryable: true });
  });
});
