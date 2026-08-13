import { describe, expect, it } from 'vitest';
import type { AssistantMessage, Usage } from '../../openclaw_runtime/src/llm/types';
import {
  createDeepSeekPrefixContinuationWrapper,
  toDeepSeekBetaPrefixUrl,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/deepseek-prefix-continuation';

function zeroUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: zeroUsage(),
    stopReason: 'stop',
    timestamp: 1,
    ...overrides,
  };
}

function streamReturning(message: AssistantMessage): { result: () => Promise<AssistantMessage> } {
  return { result: async () => message };
}

const deepSeekModel = {
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  reasoning: true,
  input: ['text'] as const,
  cost: zeroUsage().cost,
  contextWindow: 1000,
  maxTokens: 1000,
};

describe('DeepSeek prefix-continuation', () => {
  it('maps only DeepSeek hosts to the beta prefix endpoint', () => {
    expect(toDeepSeekBetaPrefixUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/beta/chat/completions',
    );
    expect(toDeepSeekBetaPrefixUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/beta/chat/completions',
    );
    expect(toDeepSeekBetaPrefixUrl('https://custom.gateway.example')).toBeUndefined();
    expect(toDeepSeekBetaPrefixUrl('not a url')).toBeUndefined();
    expect(toDeepSeekBetaPrefixUrl(undefined)).toBeUndefined();
  });

  it('does not continue a non-length completion', async () => {
    const first = assistant({ stopReason: 'stop', content: [{ type: 'text', text: 'done' }] });
    const wrapper = createDeepSeekPrefixContinuationWrapper({
      baseStreamFn: () => streamReturning(first),
      shouldPatchModel: () => true,
    })!;
    const stream = await wrapper(deepSeekModel as never, { messages: [] });
    expect(await stream.result()).toBe(first);
  });

  it('does not continue a length completion that already produced a tool call', async () => {
    const first = assistant({
      stopReason: 'length',
      content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: {} }],
    });
    let calls = 0;
    const wrapper = createDeepSeekPrefixContinuationWrapper({
      baseStreamFn: (() => {
        calls += 1;
        return streamReturning(first);
      }) as never,
      shouldPatchModel: () => true,
    })!;
    const stream = await wrapper(deepSeekModel as never, { messages: [] });
    expect(await stream.result()).toBe(first);
    expect(calls).toBe(1);
  });

  it('continues a length completion once, folds usage, and marks prefix on the beta payload', async () => {
    const first = assistant({
      stopReason: 'length',
      content: [
        { type: 'text', text: 'truncated ' },
        { type: 'thinking', thinking: 'some reasoning' },
      ],
      usage: zeroUsage({ output: 5, totalTokens: 5 }),
    });
    const second = assistant({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'continuation' }],
      usage: zeroUsage({ output: 6, totalTokens: 6, cacheRead: 2 }),
    });

    let continuationBaseUrl: string | undefined;
    let capturedOnPayload: ((p: unknown, m: unknown) => unknown) | undefined;
    let calls = 0;

    const baseStreamFn = ((model: unknown, _ctx: unknown, opts: unknown) => {
      calls += 1;
      if (calls === 1) {
        return streamReturning(first);
      }
      continuationBaseUrl = (model as { baseUrl?: string }).baseUrl;
      capturedOnPayload = (opts as { onPayload?: (p: unknown, m: unknown) => unknown }).onPayload;
      return streamReturning(second);
    }) as never;

    const wrapper = createDeepSeekPrefixContinuationWrapper({
      baseStreamFn: baseStreamFn as never,
      shouldPatchModel: () => true,
    })!;
    const stream = await wrapper(deepSeekModel as never, { messages: [] });
    const merged = await stream.result();

    expect(calls).toBe(2);
    expect(continuationBaseUrl).toBe('https://api.deepseek.com/beta/chat/completions');
    expect(merged.content.map((b) => (b.type === 'text' ? b.text : b.type))).toEqual([
      'truncated ',
      'thinking',
      'continuation',
    ]);
    expect(merged.usage.output).toBe(11);
    expect(merged.usage.cacheRead).toBe(2);

    // The beta request payload must mark the trailing assistant message as
    // prefix: true and carry the accumulated reasoning_content forward.
    const payload: { messages: Array<Record<string, unknown>> } = {
      messages: [{ role: 'assistant', content: 'truncated ' }],
    };
    capturedOnPayload!(payload, {});
    expect(payload.messages[0].prefix).toBe(true);
    expect(payload.messages[0].reasoning_content).toBe('some reasoning');
  });

  it('keeps the truncated first response when the beta call errors', async () => {
    const first = assistant({
      stopReason: 'length',
      content: [{ type: 'text', text: 'truncated' }],
      usage: zeroUsage({ output: 3, totalTokens: 3 }),
    });
    const errored = assistant({ stopReason: 'error', errorMessage: 'beta down' });
    let calls = 0;
    const baseStreamFn = (() => {
      calls += 1;
      return calls === 1 ? streamReturning(first) : streamReturning(errored);
    }) as never;

    const wrapper = createDeepSeekPrefixContinuationWrapper({
      baseStreamFn: baseStreamFn as never,
      shouldPatchModel: () => true,
    })!;
    const stream = await wrapper(deepSeekModel as never, { messages: [] });
    const out = await stream.result();
    expect(out).toBe(first);
    expect(out.stopReason).toBe('length');
  });

  it('passes through when the model is not a DeepSeek V4 candidate', async () => {
    const first = assistant({ stopReason: 'length', content: [{ type: 'text', text: 'truncated' }] });
    let calls = 0;
    const wrapper = createDeepSeekPrefixContinuationWrapper({
      baseStreamFn: (() => {
        calls += 1;
        return streamReturning(first);
      }) as never,
      shouldPatchModel: () => false,
    })!;
    const stream = await wrapper(deepSeekModel as never, { messages: [] });
    expect(await stream.result()).toBe(first);
    // shouldPatchModel=false bypasses the continuation entirely, so no beta call.
    expect(calls).toBe(1);
  });

  it('returns undefined when no base stream fn is provided', () => {
    expect(
      createDeepSeekPrefixContinuationWrapper({
        baseStreamFn: undefined,
        shouldPatchModel: () => true,
      }),
    ).toBeUndefined();
  });
});
