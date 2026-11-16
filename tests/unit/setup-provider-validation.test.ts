// @vitest-environment node
/**
 * FP-P1-01: Setup provider/model verification — pure-logic coverage.
 *
 * Covers the failure-classification contract (未填 / 凭据无效 / 网络不可达 /
 * 服务异常), the chat first-send readiness gate, and the "Complete may only be
 * declared verified" rule. UI wiring is covered by the Electron E2E.
 */
import { describe, expect, it } from 'vitest';
import type { ProviderValidationState } from '@shared/host-api/contract';
import {
  classifyProviderValidationError,
  DEFAULT_SETUP_PROVIDER_VERIFICATION,
  isProviderRuntimeReady,
  isSetupVerificationComplete,
  isSetupProviderReady,
  providerValidationFeedback,
} from '../../src/lib/setup-provider';
import type { ProviderAccount, ProviderWithKeyInfo } from '../../src/lib/providers';

function account(overrides: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: 'acct-1',
    vendorId: 'openai',
    label: 'OpenAI',
    authMode: 'api_key',
    enabled: true,
    isDefault: false,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
    ...overrides,
  };
}

function status(id: string, hasKey: boolean): ProviderWithKeyInfo {
  return {
    id,
    name: id,
    type: 'openai',
    enabled: true,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
    hasKey,
    keyMasked: hasKey ? 'sk-***' : null,
  } as ProviderWithKeyInfo;
}

describe('FP-P1-01 classifyProviderValidationError', () => {
  it('empty key on a key-requiring vendor classifies as not-filled (no request needed)', () => {
    expect(
      classifyProviderValidationError({ apiKeyPresent: false, requiresApiKey: true }),
    ).toBe('not-filled');
  });

  it('key-less vendors (ollama/local) never classify as not-filled', () => {
    expect(
      classifyProviderValidationError({ apiKeyPresent: false, requiresApiKey: false }),
    ).not.toBe('not-filled');
  });

  it.each([
    ['API error: 401 Unauthorized', 'credentials'],
    ['status 403 forbidden', 'credentials'],
    ['Invalid API key provided', 'credentials'],
    ['invalid_api_key: Incorrect API key', 'credentials'],
    ['authentication failed', 'credentials'],
  ])('credential rejection "%s" → credentials', (error, expected) => {
    expect(
      classifyProviderValidationError({ apiKeyPresent: true, requiresApiKey: true, error }),
    ).toBe(expected);
  });

  it.each([
    ['fetch failed: getaddrinfo ENOTFOUND api.example.com', 'network'],
    ['connect ECONNREFUSED 127.0.0.1:1', 'network'],
    ['request timed out after 10000ms', 'network'],
    ['network error', 'network'],
    ['socket hang up', 'network'],
  ])('unreachable endpoint "%s" → network', (error, expected) => {
    expect(
      classifyProviderValidationError({ apiKeyPresent: true, requiresApiKey: true, error }),
    ).toBe(expected);
  });

  it('unexpected provider responses fall into the explicit service bucket, never silently pass', () => {
    expect(
      classifyProviderValidationError({
        apiKeyPresent: true,
        requiresApiKey: true,
        error: 'unexpected response shape',
      }),
    ).toBe('service');
    // 401 embedded in a larger number must not be misread as credentials.
    expect(
      classifyProviderValidationError({
        apiKeyPresent: true,
        requiresApiKey: true,
        error: 'id 14013 rejected',
      }),
    ).toBe('service');
  });
});

describe('FP-P1-01 isProviderRuntimeReady (chat first-send gate)', () => {
  it('no accounts → not ready (Setup skipped clean install)', () => {
    expect(
      isProviderRuntimeReady({ accounts: [], statuses: [], defaultAccountId: null }),
    ).toBe(false);
  });

  it('default account with stored key → ready', () => {
    expect(
      isProviderRuntimeReady({
        accounts: [account({})],
        statuses: [status('acct-1', true)],
        defaultAccountId: 'acct-1',
      }),
    ).toBe(true);
  });

  it('default account WITHOUT stored key → not ready (key deleted after setup)', () => {
    expect(
      isProviderRuntimeReady({
        accounts: [account({})],
        statuses: [status('acct-1', false)],
        defaultAccountId: 'acct-1',
      }),
    ).toBe(false);
  });

  it('disabled default account → not ready', () => {
    expect(
      isProviderRuntimeReady({
        accounts: [account({ enabled: false })],
        statuses: [status('acct-1', true)],
        defaultAccountId: 'acct-1',
      }),
    ).toBe(false);
  });

  it('non-key auth modes (oauth/local) count as satisfied', () => {
    expect(
      isProviderRuntimeReady({
        accounts: [account({ authMode: 'local', vendorId: 'ollama' })],
        statuses: [],
        defaultAccountId: 'acct-1',
      }),
    ).toBe(true);
  });

  it('no default set falls back to any satisfied account', () => {
    expect(
      isProviderRuntimeReady({
        accounts: [account({ id: 'a' }), account({ id: 'b' })],
        statuses: [status('a', false), status('b', true)],
        defaultAccountId: null,
      }),
    ).toBe(true);
  });
});

describe('FP-P1-01 isSetupVerificationComplete', () => {
  it('default state is unverified', () => {
    expect(isSetupVerificationComplete(DEFAULT_SETUP_PROVIDER_VERIFICATION)).toBe(false);
    expect(isSetupVerificationComplete(undefined)).toBe(false);
  });

  it('skipped is NEVER complete — limited mode must stay visible', () => {
    expect(isSetupVerificationComplete({ status: 'skipped' })).toBe(false);
  });

  it('verified requires both accountId and model (credential + model both checked)', () => {
    expect(isSetupVerificationComplete({ status: 'verified' })).toBe(false);
    expect(isSetupVerificationComplete({ status: 'verified', accountId: 'a' })).toBe(false);
    expect(isSetupVerificationComplete({ status: 'verified', model: 'm' })).toBe(false);
    expect(
      isSetupVerificationComplete({
        status: 'verified',
        accountId: 'a',
        vendorId: 'openai',
        model: 'gpt-test',
        checkedAt: '2026-07-26T00:00:00Z',
      }),
    ).toBe(true);
  });
});

/**
 * TF-0733: the Setup failure copy must follow the structured state, not a
 * message regex. Each state maps to exactly one bucket, so a 429 can never
 * surface as "credentials rejected" and a non-auth 400 can never pass as
 * verified.
 */
function state(overrides: Partial<ProviderValidationState>): ProviderValidationState {
  return {
    reachable: 'reachable',
    auth: 'unknown',
    protocol: 'unknown',
    model: 'unknown',
    rateLimited: false,
    ready: false,
    reason: 'unknown',
    ...overrides,
  };
}

describe('TF-0733 structured provider validation states', () => {
  it.each([
    ['429 rate limit', state({ rateLimited: true, retryAfterMs: 5000, reason: 'rate-limited' }), 'rate-limited'],
    ['401 unauthorized', state({ auth: 'invalid', reason: 'unauthorized' }), 'credentials'],
    ['non-auth 400', state({ auth: 'valid', protocol: 'compatible', reason: 'protocol-error' }), 'protocol'],
    ['unknown model', state({ auth: 'valid', protocol: 'compatible', model: 'unavailable', reason: 'model-unavailable' }), 'model'],
    ['network down', state({ reachable: 'unreachable', reason: 'network-error' }), 'network'],
    ['5xx', state({ reason: 'server-error' }), 'service'],
  ])('%s → %s', (_label, input, expected) => {
    expect(
      classifyProviderValidationError({
        apiKeyPresent: true,
        requiresApiKey: true,
        state: input,
      }),
    ).toBe(expected);
  });

  it('a ready state is the only one that never classifies as a failure', () => {
    const ready = state({ auth: 'valid', protocol: 'compatible', model: 'available', ready: true, reason: 'ok' });
    expect(
      isSetupProviderReady({
        apiKeyPresent: true,
        requiresApiKey: true,
        state: ready,
      }),
    ).toBe(true);
    expect(
      isSetupProviderReady({
        apiKeyPresent: true,
        requiresApiKey: true,
        state: state({ auth: 'valid', protocol: 'compatible', reason: 'protocol-error' }),
      }),
    ).toBe(false);
    expect(
      isSetupProviderReady({
        apiKeyPresent: true,
        requiresApiKey: true,
        state: state({ rateLimited: true, reason: 'rate-limited' }),
      }),
    ).toBe(false);
  });

  it('providerValidationFeedback surfaces the retry window for 429', () => {
    const feedback = providerValidationFeedback(
      state({ rateLimited: true, retryAfterMs: 12_000, reason: 'rate-limited' }),
    );
    expect(feedback.key).toBe('rateLimited');
    expect(feedback.retryAfterMs).toBe(12_000);
  });

  it('providerValidationFeedback never maps a non-auth 400 to invalidKey', () => {
    const feedback = providerValidationFeedback(
      state({ auth: 'valid', protocol: 'compatible', reason: 'protocol-error' }),
      'Bad Request',
    );
    expect(feedback.key).toBe('protocolError');
  });
});
