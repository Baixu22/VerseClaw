/**
 * TF-0733 behavioral gate: the 12-scenario validation matrix.
 *
 * Every scenario is a stub HTTP response sequence fed through the SAME
 * classifier the Settings/Setup surfaces consume. The assertion set is about
 * *state*, not prose: `ready` may be true only for the scenario whose endpoint
 * actually served a usable credential + protocol + model.
 *
 * Baseline (source-derived, artifacts/runs/.../baseline-before-fix.json):
 * VALID-1 = 3 collapsed classes, VALID-2 = 1 state dimension. This matrix is
 * the behavioral counterpart and fails on the old code (429 and non-auth 400
 * were `valid: true` and would have rendered a verified chip).
 *
 * Scenarios that make the /models probe unusable (400/404/500 style) carry a
 * second response for the chat/completions fallback, because that is what the
 * real validation flow does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetch = vi.fn();

vi.mock('@electron/utils/proxy-fetch', () => ({ proxyAwareFetch }));

type StubResponse = { status: number; body: unknown; headers?: Record<string, string> };
type ExpectedState = {
  ready: boolean;
  reachable: string;
  auth: string;
  protocol: string;
  model: string;
  rateLimited: boolean;
  reason: string;
  retryAfterMs?: number;
};
type Scenario = {
  id: string;
  responses: StubResponse[];
  transportError?: Error;
  expect: ExpectedState;
};

const json = (status: number, body: unknown, headers?: Record<string, string>): StubResponse => ({
  status,
  body,
  ...(headers ? { headers } : {}),
});

const scenarios: Scenario[] = [
  {
    id: '200-with-model',
    responses: [json(200, { data: [{ id: 'model-a' }] })],
    expect: { ready: true, reachable: 'reachable', auth: 'valid', protocol: 'compatible', model: 'available', rateLimited: false, reason: 'ok' },
  },
  {
    id: '401-unauthorized',
    responses: [json(401, { error: { message: 'Invalid API key provided' } })],
    expect: { ready: false, reachable: 'reachable', auth: 'invalid', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'unauthorized' },
  },
  {
    id: '403-forbidden',
    responses: [json(403, { error: { message: 'Forbidden' } })],
    expect: { ready: false, reachable: 'reachable', auth: 'invalid', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'unauthorized' },
  },
  {
    id: '429-rate-limited',
    responses: [json(429, { error: { message: 'Too many requests' } }, { 'retry-after': '7' })],
    expect: { ready: false, reachable: 'reachable', auth: 'unknown', protocol: 'unknown', model: 'unknown', rateLimited: true, reason: 'rate-limited', retryAfterMs: 7000 },
  },
  {
    id: '400-auth-wording',
    responses: [json(400, { error: { message: 'Invalid API key' } })],
    expect: { ready: false, reachable: 'reachable', auth: 'invalid', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'unauthorized' },
  },
  {
    id: '400-auth-code',
    responses: [json(400, { error: { message: 'Bad Request', code: 'invalid_api_key' } })],
    expect: { ready: false, reachable: 'reachable', auth: 'invalid', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'unauthorized' },
  },
  {
    id: '400-parameter',
    responses: [
      json(400, { error: { message: 'Bad Request: unsupported parameter temperature' } }),
      json(400, { error: { message: 'Bad Request: unsupported parameter temperature' } }),
    ],
    expect: { ready: false, reachable: 'reachable', auth: 'valid', protocol: 'incompatible', model: 'unknown', rateLimited: false, reason: 'protocol-error' },
  },
  {
    id: '404-model',
    responses: [
      json(404, { error: { message: 'model not found' } }),
      json(404, { error: { message: 'model not found' } }),
    ],
    expect: { ready: false, reachable: 'reachable', auth: 'unknown', protocol: 'compatible', model: 'unavailable', rateLimited: false, reason: 'model-unavailable' },
  },
  {
    id: '500-server-error',
    responses: [
      json(500, { error: { message: 'Internal error' } }),
      json(500, { error: { message: 'Internal error' } }),
    ],
    expect: { ready: false, reachable: 'reachable', auth: 'unknown', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'server-error' },
  },
  {
    id: 'timeout',
    responses: [],
    transportError: new Error('request timed out after 15000ms'),
    expect: { ready: false, reachable: 'unreachable', auth: 'unknown', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'timeout' },
  },
  {
    id: 'dns-failure',
    responses: [],
    transportError: new Error('fetch failed: getaddrinfo ENOTFOUND metadata.invalid'),
    expect: { ready: false, reachable: 'unreachable', auth: 'unknown', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'dns-error' },
  },
  {
    id: 'ssrf-blocked',
    responses: [],
    transportError: new Error('blocked: private network address 169.254.169.254'),
    expect: { ready: false, reachable: 'unreachable', auth: 'unknown', protocol: 'unknown', model: 'unknown', rateLimited: false, reason: 'blocked' },
  },
];

function stub(scenario: Scenario) {
  if (scenario.transportError) {
    proxyAwareFetch.mockRejectedValueOnce(scenario.transportError);
    return;
  }
  for (const response of scenario.responses) {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...(response.headers ?? {}) },
      }),
    );
  }
}

describe('TF-0733 provider validation 12-scenario matrix', () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it.each(scenarios)('$id', async (scenario) => {
    stub(scenario);
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-test', {
      baseUrl: 'https://provider.example.com/v1',
      apiProtocol: 'openai-completions',
    });

    expect(result).toMatchObject(scenario.expect);
    // The compatibility field must never claim a credential is good when the
    // provider only rate-limited or refused the request shape.
    if (scenario.expect.reason === 'rate-limited' || scenario.expect.reason === 'protocol-error') {
      expect(result.valid).toBe(false);
    }
  });

  it('reports false_ready_rate = 0/12 and covers all six dimensions', () => {
    expect(scenarios).toHaveLength(12);
    const nonReady = scenarios.filter((scenario) => !scenario.expect.ready);
    expect(nonReady).toHaveLength(11);
    expect(new Set(nonReady.map((s) => s.expect.reason)).size).toBeGreaterThanOrEqual(6);
    for (const scenario of scenarios) {
      for (const dimension of ['reachable', 'auth', 'protocol', 'model', 'rateLimited', 'ready'] as const) {
        expect(scenario.expect).toHaveProperty(dimension);
      }
    }
  });

  it('treats a 2xx model list with zero models as credential-only, not ready', async () => {
    proxyAwareFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    );
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-test', {
      baseUrl: 'https://provider.example.com/v1',
      apiProtocol: 'openai-completions',
    });
    expect(result).toMatchObject({
      valid: true,
      auth: 'valid',
      model: 'unavailable',
      ready: false,
      reason: 'model-unavailable',
    });
  });

  it('never reports ready for any scenario whose credential/protocol/model chain failed', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    let falseReady = 0;
    for (const scenario of scenarios.filter((entry) => !entry.expect.ready)) {
      proxyAwareFetch.mockReset();
      stub(scenario);
      const result = await validateApiKeyWithProvider('custom', 'sk-test', {
        baseUrl: 'https://provider.example.com/v1',
        apiProtocol: 'openai-completions',
      });
      if (result.ready) falseReady += 1;
    }
    expect(falseReady).toBe(0);
  });
});
