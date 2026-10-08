import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompletionsTransportStreamFn, testing } from "./openai-transport-stream.js";

describe("OpenAI Responses transport event compatibility", () => {
  it("prefers SDK response event type and keeps legacy event fallback", () => {
    expect(testing.resolveResponsesEventType({ type: "response.completed" })).toBe(
      "response.completed",
    );
    expect(testing.resolveResponsesEventType({ event: "response.completed" })).toBe(
      "response.completed",
    );
  });

  it("uses call_id for function outputs and marks completed tool calls as toolUse", () => {
    expect(testing.resolveResponsesFunctionCallId({ id: "fc_1", call_id: "call_1" })).toBe(
      "call_1",
    );
    expect(testing.resolveResponsesStopReason("completed", true)).toBe("toolUse");
    expect(testing.resolveResponsesStopReason("incomplete", false)).toBe("length");
    expect(testing.resolveResponsesStopReason("completed", false)).toBe("stop");
  });
});

import { attachModelProviderRequestTransport } from './provider-request-config.js';
import type { Model } from '../llm/types.js';

afterEach(() => vi.unstubAllGlobals());

describe('Chat Completions frames containing usage and choices', () => {
  it.each(['text', 'tool'] as const)('keeps %s deltas and finish reason alongside usage', async (kind) => {
    const choices = kind === 'text'
      ? [
          { index: 0, delta: { content: 'hello ', reasoning_content: 'synthetic reasoning' }, finish_reason: null },
          { index: 0, delta: { content: 'world' }, finish_reason: 'length' },
        ]
      : [
          { index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"id":' } }] }, finish_reason: null },
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"blue"}' } }] }, finish_reason: 'tool_calls' },
        ];
    const events = choices.map((choice, index) => 'data: ' + JSON.stringify({
      id: 'fixture-response', object: 'chat.completion.chunk', model: 'fixture',
      choices: [choice], usage: { prompt_tokens: 10, completion_tokens: index + 1, total_tokens: 11 + index },
    }) + '\n\n').join('') + 'data: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(events, { headers: { 'content-type': 'text/event-stream' } })));
    const model = attachModelProviderRequestTransport({
      id: 'fixture', name: 'fixture', provider: 'custom', api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:40123/v1', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128,
    } as Model, { allowPrivateNetwork: true });
    const stream = await createOpenAICompletionsTransportStreamFn()(model, {
      messages: [{ role: 'user', content: 'synthetic probe', timestamp: 1 }],
    }, { apiKey: 'fixture-key', maxTokens: 128 });
    for await (const _event of stream) { /* consume complete stream */ }
    const result = await stream.result();
    expect(result.usage).toMatchObject({ input: 10, output: 2, totalTokens: 12 });
    if (kind === 'text') {
      expect(result.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'hello world' }),
        expect.objectContaining({ type: 'thinking', thinking: 'synthetic reasoning' }),
      ]));
      expect(result.stopReason).toBe('length');
    } else {
      expect(result.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { id: 'blue' } }),
      ]));
      expect(result.stopReason).toBe('toolUse');
    }
  });
});
