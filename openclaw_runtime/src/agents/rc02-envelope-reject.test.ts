// @vitest-environment node
// S01: the Provider content guard becomes a rejectable pre-wire boundary.
//
// Opt-in (default off). When the RC-02 shadow boundary is active AND the reject
// flag is set, an invalid/unknown request envelope is refused BEFORE any provider
// bytes go on the wire; the digest-only wire receipt is already written at that
// boundary. The default / flag-off path stays observational and byte-identical.
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicMessagesTransportStreamFn } from './anthropic-transport-stream.js';
import { attachModelProviderRequestTransport } from './provider-request-config.js';
import {
  attachShadowReceiptOptions,
  ProviderEnvelopeRejectedError,
  resolveEnvelopeRejectEnabled,
} from './shadow-census.js';

function makeModel() {
  return attachModelProviderRequestTransport(
    {
      name: 'S01 fixture',
      reasoning: false,
      input: ['text'] as Array<'text'>,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 128,
      api: 'anthropic-messages',
      provider: 'anthropic',
      id: 'claude-s01',
      baseUrl: 'http://127.0.0.1:40123/v1',
    } as never,
    { allowPrivateNetwork: true },
  );
}

const CONTEXT = { messages: [{ role: 'user' as const, content: 'hello', timestamp: 1 }] };
const UNREGISTERED = ['definitely-unregistered-transform'];

async function drive(options: unknown): Promise<{ rejected: boolean; fetchCalls: number }> {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = vi.fn(async () => {
    fetchCalls += 1;
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
  let rejected = false;
  try {
    const stream = await createAnthropicMessagesTransportStreamFn()(makeModel(), CONTEXT, options as never);
    for await (const _event of stream) {
      // consume
    }
    const result = await stream.result();
    rejected = result.stopReason === 'error' && /envelope rejected/i.test(result.errorMessage ?? '');
  } catch (error) {
    rejected = error instanceof ProviderEnvelopeRejectedError || /envelope rejected/i.test(String(error));
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { rejected, fetchCalls };
}

describe('S01 provider envelope reject boundary', () => {
  it('resolveEnvelopeRejectEnabled is off by default and opt-in only', () => {
    const saved = process.env.OPENCLAW_RC02_REJECT_INVALID_ENVELOPE;
    delete process.env.OPENCLAW_RC02_REJECT_INVALID_ENVELOPE;
    try {
      expect(resolveEnvelopeRejectEnabled({})).toBe(false);
      expect(resolveEnvelopeRejectEnabled({ rejectInvalidEnvelope: true })).toBe(true);
      expect(resolveEnvelopeRejectEnabled({ rejectInvalidEnvelope: false })).toBe(false);
      process.env.OPENCLAW_RC02_REJECT_INVALID_ENVELOPE = '1';
      expect(resolveEnvelopeRejectEnabled({})).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.OPENCLAW_RC02_REJECT_INVALID_ENVELOPE;
      else process.env.OPENCLAW_RC02_REJECT_INVALID_ENVELOPE = saved;
    }
  });

  it('rejects an invalid envelope before any provider bytes are sent (0 fetch calls)', async () => {
    const options = attachShadowReceiptOptions(
      { apiKey: 'fixture-key', sessionId: 'sess-s01', runId: 'run-s01' },
      { enabled: true, sourceRuntime: true, rejectInvalidEnvelope: true, transformIds: UNREGISTERED },
    );
    const { rejected, fetchCalls } = await drive(options);
    expect(rejected).toBe(true);
    expect(fetchCalls).toBe(0);
  });

  it('keeps the default (flag off) path observational: the request still goes out', async () => {
    const options = attachShadowReceiptOptions(
      { apiKey: 'fixture-key', sessionId: 'sess-s01-off', runId: 'run-s01-off' },
      { enabled: true, sourceRuntime: true, transformIds: UNREGISTERED },
    );
    const { rejected, fetchCalls } = await drive(options);
    expect(rejected).toBe(false);
    expect(fetchCalls).toBeGreaterThanOrEqual(1);
  });
});