// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildResponsesRequest,
  createResponsesProvider,
  parseResponsesReply,
  type ResponsesTransport,
} from '../../scripts/lib/rsi-responses-provider.mjs';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp_test',
    model: 'space-bunny',
    status: 'completed',
    output: [],
    usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
    ...overrides,
  };
}

function responseLike(ok: boolean, status: number, text: () => Promise<string>): Response {
  return { ok, status, text } as unknown as Response;
}

describe('Responses request and reply adapter', () => {
  it('builds the required non-streaming Responses request without temperature', () => {
    const request = buildResponsesRequest({
      model: 'space-bunny',
      instructions: 'Judge the result.',
      input: 'Candidate output',
      maxOutputTokens: 512,
    });

    expect(request).toEqual({
      model: 'space-bunny',
      instructions: 'Judge the result.',
      input: 'Candidate output',
      store: false,
      stream: false,
      truncation: 'disabled',
      max_output_tokens: 512,
    });
    expect(request).not.toHaveProperty('temperature');
  });

  it('joins every message output_text item and preserves function calls separately', () => {
    const parsed = parseResponsesReply(
      payload({
        output: [
          { type: 'reasoning', summary: [] },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'read_file',
            arguments: '{"path":"a.txt"}',
          },
          {
            type: 'message',
            content: [
              { type: 'output_text', text: 'first' },
              { type: 'refusal', refusal: 'ignored' },
            ],
          },
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'second' }],
          },
        ],
      }),
    );

    expect(parsed.text).toBe('firstsecond');
    expect(parsed.functionCalls).toEqual([
      { callId: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
    ]);
    expect(parsed.usage).toEqual({ inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    expect(parsed.incompleteReason).toBeNull();
  });

  it('keeps missing usage as null and retains incomplete status and reason', () => {
    const parsed = parseResponsesReply(
      payload({
        status: 'incomplete',
        usage: undefined,
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    );

    expect(parsed.status).toBe('incomplete');
    expect(parsed.usage).toBeNull();
    expect(parsed.incompleteReason).toBe('max_output_tokens');
    expect(parseResponsesReply(payload({ usage: { input_tokens: 1 } })).usage).toBeNull();
  });

  it.each([
    ['invalid status', payload({ status: 'done' }), 'status is invalid'],
    ['empty id', payload({ id: '   ' }), 'response id'],
    ['empty model', payload({ model: '' }), 'response model'],
    [
      'negative usage',
      payload({ usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 } }),
      'usage.input_tokens',
    ],
    [
      'non-integer usage',
      payload({ usage: { input_tokens: 1.5, output_tokens: 1, total_tokens: 2.5 } }),
      'usage.input_tokens',
    ],
    [
      'contradictory totals',
      payload({ usage: { input_tokens: 2, output_tokens: 3, total_tokens: 8 } }),
      'usage totals are inconsistent',
    ],
  ])('rejects %s', (_label, reply, message) => {
    expect(() => parseResponsesReply(reply)).toThrow(message);
  });

  it('accepts an official non-completed status without treating it as success text', () => {
    const parsed = parseResponsesReply(payload({ status: 'failed' }));
    expect(parsed.status).toBe('failed');
    expect(parsed.text).toBe('');
  });
});

describe('Responses provider transport boundary', () => {
  it('allows HTTPS and explicit loopback HTTP endpoints', () => {
    for (const endpoint of [
      'https://provider.example/v1/responses',
      'http://127.0.0.1:3065/v1/responses',
      'http://localhost:3065/v1/responses',
      'http://[::1]:3065/v1/responses',
    ]) {
      expect(() =>
        createResponsesProvider({
          endpoint,
          model: 'space-bunny',
          apiKey: 'offline-test-key',
          timeoutMs: 100,
          maxOutputTokens: 64,
          transport: async () => responseLike(true, 200, async () => JSON.stringify(payload())),
        }),
      ).not.toThrow();
    }
  });

  it.each([
    ['remote HTTP', 'http://provider.example/v1/responses', 'HTTPS'],
    ['userinfo', 'https://user:password@provider.example/v1/responses', 'userinfo'],
    ['query', 'https://provider.example/v1/responses?key=value', 'query'],
    ['fragment', 'https://provider.example/v1/responses#fragment', 'fragment'],
  ])('rejects %s endpoints', (_label, endpoint, message) => {
    expect(() =>
      createResponsesProvider({
        endpoint,
        model: 'space-bunny',
        apiKey: 'offline-test-key',
        timeoutMs: 100,
        maxOutputTokens: 64,
        transport: async () => responseLike(true, 200, async () => JSON.stringify(payload())),
      }),
    ).toThrow(message);
  });

  it('sends one uncached redirect-disabled request and keeps the key out of request evidence', async () => {
    const apiKey = 'offline-secret-token';
    const transport = vi.fn<ResponsesTransport>(async () =>
      responseLike(
        true,
        200,
        async () =>
          JSON.stringify(
            payload({
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
            }),
          ),
      ),
    );
    const provider = createResponsesProvider({
      endpoint: 'http://127.0.0.1:3065/v1/responses',
      model: 'space-bunny',
      apiKey,
      timeoutMs: 1_000,
      maxOutputTokens: 128,
      transport,
    });

    const result = await provider({ instructions: 'Reply.', input: 'hello' });

    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3065/v1/responses');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(init.body))).toEqual(result.request.body);
    expect(result.request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      body: { store: false, stream: false, truncation: 'disabled' },
    });
    expect(JSON.stringify(result.request)).not.toContain(apiKey);
    expect(result.response.text).toBe('ok');
    expect(parseResponsesReply(result.rawResponse)).toEqual(result.response);
  });

  it('reports only the HTTP code, aborts the response, and never reads the error body', async () => {
    const secret = 'offline-secret-token';
    const readErrorBody = vi.fn(async () => `provider echoed ${secret}`);
    let requestSignal: AbortSignal | null | undefined;
    const transport: ResponsesTransport = async (_url, init) => {
      requestSignal = init.signal as AbortSignal | null | undefined;
      return responseLike(false, 401, readErrorBody);
    };
    const provider = createResponsesProvider({
      endpoint: 'http://127.0.0.1:3065/v1/responses',
      model: 'space-bunny',
      apiKey: secret,
      timeoutMs: 1_000,
      maxOutputTokens: 128,
      transport,
    });

    let error: unknown;
    try {
      await provider({ instructions: 'Reply.', input: 'hello' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Responses request failed with HTTP 401');
    expect((error as Error).message).not.toContain(secret);
    expect(readErrorBody).not.toHaveBeenCalled();
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not echo a transport exception that contains the key', async () => {
    const secret = 'offline-secret-token';
    const provider = createResponsesProvider({
      endpoint: 'http://127.0.0.1:3065/v1/responses',
      model: 'space-bunny',
      apiKey: secret,
      timeoutMs: 1_000,
      maxOutputTokens: 128,
      transport: async () => {
        throw new Error(`network failed with ${secret}`);
      },
    });

    let error: unknown;
    try {
      await provider({ instructions: 'Reply.', input: 'hello' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Responses transport failed (network error)');
    expect((error as Error).message).not.toContain(secret);
  });

  it('times out while reading the response body and does not retry', async () => {
    const transport = vi.fn<ResponsesTransport>(async () =>
      responseLike(true, 200, () => new Promise<string>(() => undefined)),
    );
    const provider = createResponsesProvider({
      endpoint: 'http://127.0.0.1:3065/v1/responses',
      model: 'space-bunny',
      apiKey: 'offline-test-key',
      timeoutMs: 15,
      maxOutputTokens: 128,
      transport,
    });

    await expect(provider({ instructions: 'Reply.', input: 'hello' })).rejects.toThrow(
      'Responses request timed out',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects response bodies larger than 1 MiB before JSON parsing', async () => {
    const oversizedChunk = new Uint8Array(1024 * 1024 + 1);
    oversizedChunk.fill(120);
    let requestSignal: AbortSignal | null | undefined;
    const provider = createResponsesProvider({
      endpoint: 'http://127.0.0.1:3065/v1/responses',
      model: 'space-bunny',
      apiKey: 'offline-test-key',
      timeoutMs: 1_000,
      maxOutputTokens: 128,
      transport: async (_url, init) => {
        requestSignal = init.signal as AbortSignal | null | undefined;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(oversizedChunk);
              controller.close();
            },
          }),
          { status: 200 },
        );
      },
    });

    await expect(provider({ instructions: 'Reply.', input: 'hello' })).rejects.toThrow(
      'Responses response body exceeded 1 MiB',
    );
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not echo malformed response bodies', async () => {
    const secret = 'offline-secret-token';
    const provider = createResponsesProvider({
      endpoint: 'http://127.0.0.1:3065/v1/responses',
      model: 'space-bunny',
      apiKey: secret,
      timeoutMs: 1_000,
      maxOutputTokens: 128,
      transport: async () => responseLike(true, 200, async () => `not-json ${secret}`),
    });

    let error: unknown;
    try {
      await provider({ instructions: 'Reply.', input: 'hello' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Responses reply was invalid JSON');
    expect((error as Error).message).not.toContain(secret);
  });
});
