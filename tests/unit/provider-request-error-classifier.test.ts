/**
 * Issue #120: the Node runtime classifier must stay locale-free — it returns a
 * neutral reason plus a shared `common:errors.*` key and params, never only
 * English prose, and its diagnostics are redacted.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { loadLanguageResources } from '@/i18n/resources';
import {
  classifyProviderRequestError,
  isProviderConversationStateErrorMessage,
} from '../../openclaw_runtime/src/auto-reply/reply/provider-request-error-classifier';

const LANGUAGES = ['en', 'zh', 'ja', 'ru'] as const;

/** The neutral key must resolve in the shared catalogue the renderer uses. */
function expectKeyInEveryLocale(messageKey: string | undefined): void {
  expect(messageKey).toMatch(/^common:errors\.[a-z0-9_]+\.what$/);
  for (const language of LANGUAGES) {
    const value = i18n.getResource(language, 'common', String(messageKey).replace(/^common:/, ''));
    expect(typeof value === 'string' && value.length > 0, `${language}:${messageKey}`).toBe(true);
  }
}

beforeAll(async () => {
  for (const language of LANGUAGES) {
    if (language === 'en') continue;
    const resources = await loadLanguageResources(language);
    for (const [namespace, bundle] of Object.entries(resources)) {
      i18n.addResourceBundle(language, namespace, bundle, true, true);
    }
  }
});

describe('provider request error classifier (#120)', () => {
  it('returns a neutral reason, message key and params for a 429 failure', () => {
    const err = Object.assign(new Error('An error occurred while processing your request'), { status: 429 });
    const classification = classifyProviderRequestError(err);

    expect(classification).toMatchObject({
      code: 'provider_rate_limit_or_quota_error',
      reason: 'rate_limit_or_quota',
      messageKey: 'common:errors.rate_limit.what',
      params: { httpStatus: 429 },
    });
    expectKeyInEveryLocale(classification?.messageKey);
  });

  it('maps conversation-state failures onto the shared conversation_state key', () => {
    const classification = classifyProviderRequestError(new Error('roles must alternate'));

    expect(classification).toMatchObject({
      code: 'provider_conversation_state_error',
      reason: 'conversation_state',
      messageKey: 'common:errors.conversation_state.what',
    });
    expect(classification?.params).toBeUndefined();
    expectKeyInEveryLocale(classification?.messageKey);
    expect(isProviderConversationStateErrorMessage('roles must alternate')).toBe(true);
  });

  it('keeps technicalMessage as redacted diagnostics only', () => {
    const err = Object.assign(
      new Error('An error occurred while processing your request Authorization: Bearer abcdefghijklmnop'),
      { status: 429 },
    );
    const classification = classifyProviderRequestError(err);

    expect(classification).toBeDefined();
    expect(classification?.technicalMessage).not.toContain('abcdefghijklmnop');
    // Detection must not depend on the redacted text.
    expect(classifyProviderRequestError(new Error('roles must alternate Authorization: Bearer abcdefghijklmnop')))
      .toMatchObject({ code: 'provider_conversation_state_error' });
  });

  it('returns nothing for unrelated failures', () => {
    expect(classifyProviderRequestError(new Error('ENOSPC: no space left on device'))).toBeUndefined();
    expect(classifyProviderRequestError(new Error('An error occurred while processing your request'))).toBeUndefined();
    expect(isProviderConversationStateErrorMessage('ENOSPC: no space left on device')).toBe(false);
  });
});
