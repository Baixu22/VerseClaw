// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FailoverError } from '../../openclaw_runtime/src/agents/failover-error';
import { handleOpenAiHttpRequest } from '../../openclaw_runtime/src/gateway/openai-http';
import { handleOpenResponsesHttpRequest } from '../../openclaw_runtime/src/gateway/openresponses-http';

const { dispatch, logWarn } = vi.hoisted(() => ({ dispatch: vi.fn(), logWarn: vi.fn() }));
// Isolate model execution and runtime ownership; exercise real request parsing,
// handler failure paths, redaction and JSON/SSE serialization over loopback HTTP.
vi.mock('../../openclaw_runtime/src/gateway/agent-command', () => ({ agentCommandFromIngress: dispatch }));
vi.mock('../../openclaw_runtime/src/gateway/types/deps', () => ({ createDefaultDeps: () => ({}) }));
vi.mock('../../openclaw_runtime/src/agents/agent-tool-definition-adapter', () => ({
  isClientToolNameConflictError: () => false,
}));
vi.mock('../../openclaw_runtime/src/logger', () => ({ logWarn }));
vi.mock('../../openclaw_runtime/src/runtime', () => ({ defaultRuntime: { log: vi.fn(), error: vi.fn() } }));
vi.mock('../../openclaw_runtime/src/gateway/http-utils', () => ({
  authorizeGatewayHttpRequestOrReply: async () => ({ ok: true, method: 'token' }),
  resolveTrustedHttpOperatorScopes: () => ['operator.admin'],
  resolveOpenAiCompatibleHttpOperatorScopes: () => ['operator.admin'],
  resolveGatewayRequestContext: () => ({ agentId: 'main', sessionKey: 'agent:main:test-117', messageChannel: 'webchat' }),
  resolveOpenAiCompatModelOverride: async () => ({}),
  resolveAgentIdForRequest: () => 'main',
  getBearerToken: () => undefined,
  getHeader: () => undefined,
}));

const secret = 'SYNTHETIC_NOT_A_CREDENTIAL_20261009';
const raw = `request_id=req-loopback-117 api_key=${secret} Authorization: Bearer ${secret} ${'x'.repeat(1800)}`;
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const handler = req.url === '/v1/responses' ? handleOpenResponsesHttpRequest : handleOpenAiHttpRequest;
      await handler(req, res, { auth: { mode: 'none', modeSource: 'config', allowTailscale: false } });
    } catch {
      res.statusCode = 599;
      res.end('unexpected harness failure');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(() => vi.clearAllMocks());
afterAll(async () => {
  if (server) {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
});

describe.each(['/v1/chat/completions', '/v1/responses'])('provider failure boundary %s (#117)', (path) => {
  it.each([
    ['auth', 401, false], ['auth', 401, true],
    ['billing', 402, false], ['billing', 402, true],
    ['format', 400, false], ['format', 400, true],
    ['unclassified', 500, false], ['unclassified', 500, true],
  ] as const)('sanitizes %s status=%s stream=%s', async (reason, status, stream) => {
    dispatch.mockRejectedValueOnce(reason === 'unclassified' ? new Error(raw)
      : new FailoverError(raw, { reason, status, rawError: raw, code: raw }));
    const payload = path === '/v1/responses'
      ? { model: 'openclaw', input: 'synthetic boundary check', stream }
      : { model: 'openclaw', messages: [{ role: 'user', content: 'synthetic boundary check' }], stream };
    const response = await fetch(`${origin}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(stream ? 200 : status);
    expect(text).not.toContain(secret);
    expect(logWarn).toHaveBeenCalledTimes(1);
    const logged = logWarn.mock.calls[0][0] as string;
    expect(logged).not.toContain(secret);
    expect(logged).toContain('request_id=req-loopback-117');
    expect(logged.length).toBeLessThan(600);
    if (reason === 'unclassified') {
      expect(text).toContain('internal error');
      return; // Unknown Chat SSE success semantics remain separate issue 116.
    }
    const envelopes = stream
      ? text.split('\n').filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
        .map((line) => JSON.parse(line.slice(6)))
      : [JSON.parse(text)];
    const envelope = path === '/v1/responses' && stream
      ? envelopes.find((event) => event.type === 'response.failed')?.response
      : envelopes.find((event) => event.error);
    expect(envelope?.error.message).toContain('request_id=req-loopback-117');
    expect(envelope.error.message.length).toBeLessThanOrEqual(500);
    // Exporting the same failure envelope cannot resurrect the original rawError.
    expect(JSON.stringify(envelope)).not.toContain(secret);
  });
});
