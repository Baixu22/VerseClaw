// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { testing } from '../../openclaw_runtime/src/gateway/openresponses-http';
import { buildAgentPrompt } from '../../openclaw_runtime/src/gateway/openresponses-prompt';

describe('OpenResponses usage breakdowns', () => {
  it('surfaces cache reads and reasoning tokens as optional usage details', () => {
    const usage = testing.toUsage({
      input: 100,
      output: 40,
      cacheRead: 900,
      cacheWrite: 25,
      reasoningTokens: 12,
      total: 1040,
    });
    // input_tokens is the full prompt (uncached + cached), matching the
    // chat-completions lane; total_tokens keeps the upstream aggregate.
    expect(usage).toEqual({
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 900 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 12 },
      total_tokens: 1040,
    });
  });

  it('omits optional details when no cache or reasoning tokens were reported', () => {
    const usage = testing.toUsage({ input: 7, output: 3, total: 10 });
    expect(usage).toEqual({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
    expect('input_tokens_details' in usage).toBe(false);
    expect('output_tokens_details' in usage).toBe(false);
  });
});

describe('OpenResponses replayed tool history', () => {
  it('keeps a function_call paired with its function_call_output', () => {
    const prompt = buildAgentPrompt([
      { type: 'message', role: 'user', content: 'list files' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'list_files',
        arguments: '{"path":"."}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: 'a.txt\nb.txt' },
    ]);
    expect(prompt.message).toContain('tool_call id=call_1 name=list_files arguments={"path":"."}');
    expect(prompt.message).toContain('Tool:call_1: a.txt\nb.txt');
  });

  it('falls back to the item id when call_id is absent', () => {
    const prompt = buildAgentPrompt([
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'function_call', id: 'fc_9', name: 'noop', arguments: '{}' },
      { type: 'function_call_output', call_id: 'fc_9', output: 'done' },
    ]);
    expect(prompt.message).toContain('tool_call id=fc_9 name=noop arguments={}');
  });
});
