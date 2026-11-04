import { describe, expect, it } from 'vitest';

import {
  RETRY_AUTHORIZED_TEXT,
  SYNTHETIC_MISSING_TOOL_RESULT_TEXT,
  authorizedToolCallIds,
  findRetryableToolCalls,
  markRetryAuthorized,
} from './retry-authorization.js';

function synthetic(toolCallId: string) {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'edit',
    content: [{ type: 'text', text: SYNTHETIC_MISSING_TOOL_RESULT_TEXT }],
    details: { openclawSyntheticMissingToolResult: true },
    isError: true,
  };
}

describe('TF-0719 retry authorization', () => {
  it('finds only synthetic missing results', () => {
    const messages = [
      synthetic('a'),
      { role: 'toolResult', toolCallId: 'b', content: [{ type: 'text', text: 'real result' }], isError: false },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    expect(findRetryableToolCalls(messages)).toEqual([{ toolCallId: 'a', toolName: 'edit' }]);
  });

  it('rewrites an authorized synthetic result into a retry instruction', () => {
    const { messages, authorized } = markRetryAuthorized([synthetic('a')], new Set(['a']));
    expect(authorized).toBe(1);
    const first = messages[0] as { content: Array<{ text: string }>; isError: boolean; details: Record<string, unknown> };
    expect(first.content[0].text).toBe(RETRY_AUTHORIZED_TEXT);
    expect(first.isError).toBe(false);
    expect(first.details.openclawRetryAuthorized).toBe(true);
  });

  it('never touches unauthorized or real results', () => {
    const real = { role: 'toolResult', toolCallId: 'b', content: [{ type: 'text', text: 'ok' }], isError: false };
    const { messages, authorized } = markRetryAuthorized([synthetic('a'), real], new Set(['b']));
    expect(authorized).toBe(0);
    expect(messages[0]).not.toEqual(messages[1]);
    expect((messages[1] as { content: Array<{ text: string }> }).content[0].text).toBe('ok');
  });

  it('authorizes only dispatched phases', () => {
    const ids = authorizedToolCallIds([
      { phase: 'dispatched', intent_json: JSON.stringify({ toolCallId: 'a' }) },
      { phase: 'effect_pending', intent_json: JSON.stringify({ toolCallId: 'b' }) },
      { phase: 'effect_committed', intent_json: JSON.stringify({ toolCallId: 'c' }) },
    ]);
    expect([...ids]).toEqual(['a']);
  });
});
