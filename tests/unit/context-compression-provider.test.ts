// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = {
  baseUrl: 'https://provider.example/v1', apiKey: 'test-credential', model: 'test-model',
  system: 'Return JSON only.', user: 'Evaluate this sample.', sampleId: 'R1', purpose: 'judge',
};

describe('compression evaluation provider protocol', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('COMPACTION_API_FORMAT', 'responses');
    vi.stubEnv('COMPACTION_MAX_ATTEMPTS', '1');
    vi.stubEnv('COMPACTION_EXTRA_HEADERS', '');
    vi.stubEnv('COMPACTION_OMIT_RESPONSE_FORMAT', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends Responses input and reads output text after reasoning items', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'response-1', status: 'completed', usage: { input_tokens: 12, output_tokens: 8 },
      output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
    })));
    vi.stubGlobal('fetch', fetch);
    const { fetchCompactionJson } = await import('../../scripts/context-compression-eval-runner.mjs');
    const result = await fetchCompactionJson(request);
    expect(result.choices[0].message.content).toBe('{"ok":true}');
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 8 });
    expect(fetch.mock.calls[0][0]).toBe('https://provider.example/v1/responses');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'test-model', input: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
      max_output_tokens: 16000, store: false, text: { format: { type: 'json_object' } },
    });
  });

  it.each([
    ['incomplete', { status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }] }, /incomplete/],
    ['refused', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }, /refused/],
    ['empty', { status: 'completed', output: [{ type: 'reasoning', summary: [] }] }, /empty content/],
  ])('rejects %s Responses evidence', async (_name, body, error) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetch);
    const { fetchCompactionJson } = await import('../../scripts/context-compression-eval-runner.mjs');
    await expect(fetchCompactionJson(request)).rejects.toThrow(error as RegExp);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the default Chat Completions request and result', async () => {
    vi.stubEnv('COMPACTION_API_FORMAT', '');
    const result = { choices: [{ message: { content: '{"ok":true}' } }] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    const { fetchCompactionJson } = await import('../../scripts/context-compression-eval-runner.mjs');
    await expect(fetchCompactionJson(request)).resolves.toEqual(result);
    expect(fetch.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
      temperature: 0, max_tokens: 16000, response_format: { type: 'json_object' },
    });
  });

  it('redacts an echoed credential in provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`Invalid key: ${request.apiKey}`, { status: 401 })));
    const { fetchCompactionJson } = await import('../../scripts/context-compression-eval-runner.mjs');
    await expect(fetchCompactionJson(request)).rejects.toThrow('Invalid key: [redacted]');
  });
});
