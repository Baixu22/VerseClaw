/**
 * TF-0734 behavioral gate: validation and inference share one network policy,
 * SSRF/private-network fails closed, every probe carries the total deadline and
 * an AbortSignal, and failures carry policyFingerprint/stage/blockedReason.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateProviderNetworkTarget,
  providerNetworkPolicyFingerprint,
  resolveProviderNetworkPolicy,
} from '../../openclaw_runtime/src/agents/provider-network-policy';

const proxyAwareFetch = vi.fn();

vi.mock('@electron/utils/proxy-fetch', () => ({ proxyAwareFetch }));

function okJson(body: unknown = { data: [{ id: 'model-a' }] }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TF-0734 shared provider network policy', () => {
  const targets = [
    'https://api.example.com/v1',
    'http://127.0.0.1:1234/v1',
    'http://10.20.30.40:8080/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/v1',
    'ftp://example.com/v1',
    'not a url',
  ];

  it.each(targets)('validation and inference resolve the same policy for %s', (target) => {
    const inference = resolveProviderNetworkPolicy({
      baseUrl: target,
      requestUrl: target,
      trustConfiguredBaseUrlOrigin: true,
    });
    const validation = resolveProviderNetworkPolicy({
      baseUrl: target,
      requestUrl: target,
      trustConfiguredBaseUrlOrigin: true,
    });
    expect(validation.fingerprint).toBe(inference.fingerprint);
    expect(validation.policy).toEqual(inference.policy);
    expect(evaluateProviderNetworkTarget(target, validation.policy)).toEqual(
      evaluateProviderNetworkTarget(target, inference.policy),
    );
  });

  it('is order-insensitive for policy fingerprints', () => {
    const a = providerNetworkPolicyFingerprint({
      allowedHostnames: ['b.example', 'a.example'],
      allowedOrigins: ['https://b.example', 'https://a.example'],
    });
    const b = providerNetworkPolicyFingerprint({
      allowedHostnames: ['a.example', 'b.example'],
      allowedOrigins: ['https://a.example', 'https://b.example'],
    });
    expect(a).toBe(b);
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data', 'metadata-address'],
    ['http://metadata.google.internal/v1', 'blocked-hostname'],
    ['http://[fe80::1]/v1', 'link-local-address'],
    ['ftp://example.com/v1', 'unsupported-protocol'],
    ['not a url', 'invalid-url'],
  ])('fails closed for %s (%s)', (target, reason) => {
    const decision = evaluateProviderNetworkTarget(target);
    expect(decision).toEqual({ allowed: false, blockedReason: reason });
  });

  it('routes inference through the same resolver (source contract)', () => {
    const source = readFileSync(
      'openclaw_runtime/src/agents/provider-transport-fetch.ts',
      'utf8',
    );
    expect(source).toContain('resolveProviderNetworkPolicy(');
    expect(source).not.toContain('ssrfPolicyFromHttpBaseUrlAllowedOrigin(');
  });

  it('allows operator-configured custom/local endpoints exactly like inference', () => {
    for (const target of ['http://127.0.0.1:1234/v1', 'http://10.20.30.40:8080/v1']) {
      const resolved = resolveProviderNetworkPolicy({
        baseUrl: target,
        requestUrl: target,
        trustConfiguredBaseUrlOrigin: true,
      });
      expect(evaluateProviderNetworkTarget(target, resolved.policy)).toEqual({ allowed: true });
    }
  });
});

describe('TF-0734 validation preflight and deadline coverage', () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(okJson());
  });

  it('blocks metadata targets before any network call', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-test', {
      baseUrl: 'http://169.254.169.254/latest/meta-data',
      apiProtocol: 'openai-completions',
    });
    expect(result).toMatchObject({
      ready: false,
      reason: 'blocked',
      stage: 'preflight',
      blockedReason: 'metadata-address',
    });
    expect(typeof result.policyFingerprint).toBe('string');
    expect(result.deadlineMs).toBe(15_000);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['openai-completions', 'custom', 'https://provider.example.com/v1'],
    ['openai-responses', 'custom', 'https://provider.example.com/v1'],
    ['anthropic-messages', 'custom', 'https://provider.example.com/v1'],
    ['google-generative-ai', 'google', 'https://generativelanguage.googleapis.com/v1beta'],
  ])('passes an AbortSignal and the total deadline on %s', async (apiProtocol, vendor, baseUrl) => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider(vendor, 'sk-test', { baseUrl, apiProtocol });
    expect(proxyAwareFetch).toHaveBeenCalled();
    const init = proxyAwareFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.deadlineMs).toBe(15_000);
    expect(typeof result.policyFingerprint).toBe('string');
    expect(result.stage).toBeDefined();
  });

  it('maps an aborted probe to a timeout with policy metadata', async () => {
    proxyAwareFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-test', {
      baseUrl: 'https://provider.example.com/v1',
      apiProtocol: 'openai-completions',
    });
    expect(result).toMatchObject({ ready: false, reason: 'timeout', stage: 'transport' });
    expect(typeof result.policyFingerprint).toBe('string');
  });
});
