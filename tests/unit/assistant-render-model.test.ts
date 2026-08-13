import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import { extractAssistantReasoning } from '@/components/assistant-render/model';

describe('assistant render model', () => {
  it('extracts reasoning from message metadata', () => {
    const message = {
      role: 'assistant',
      content: 'Primary answer',
      metadata: {
        reasoning: [{ title: 'Summary', summary: 'Checked files and tests.' }],
      },
    } as RawMessage;

    expect(extractAssistantReasoning(message)).toEqual([
      { id: 'reasoning-1', title: 'Summary', summary: 'Checked files and tests.' },
    ]);
  });

  /**
   * F6: metadata.reasoning is nice-to-have; the message's own `thinking`
   * content blocks are the channel that actually exists. Before the fallback
   * was wired, this message produced an empty reasoning list and the panel was
   * unreachable outside tests.
   */
  it('falls back to thinking content blocks when no reasoning metadata exists', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'First I read the auth middleware.' },
        { type: 'thinking', thinking: 'First I read the auth middleware. Then I checked the signing key.' },
        { type: 'text', text: 'Here is the fix.' },
      ],
    } as RawMessage;

    expect(extractAssistantReasoning(message)).toEqual([
      { id: 'thinking-1', summary: 'First I read the auth middleware.' },
      { id: 'thinking-2', summary: 'Then I checked the signing key.' },
    ]);
  });

  it('prefers metadata reasoning over thinking blocks when both exist', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Raw thinking that would be redundant.' },
      ],
      metadata: { reasoning: [{ title: 'TL;DR', summary: 'Summarized reasoning.' }] },
    } as RawMessage;

    expect(extractAssistantReasoning(message)).toEqual([
      { id: 'reasoning-1', title: 'TL;DR', summary: 'Summarized reasoning.' },
    ]);
  });

  it('returns nothing when neither channel carries reasoning', () => {
    expect(extractAssistantReasoning({ role: 'assistant', content: 'Plain text.' } as RawMessage)).toEqual([]);
    expect(extractAssistantReasoning({ role: 'user', content: 'hi' } as RawMessage)).toEqual([]);
  });

  it('extracts reasoning from content blocks when history normalization drops top-level extensions', () => {
    const message = {
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'Primary answer',
        assistantRender: {
          reasoning: 'Public summary',
        },
      }],
    } as RawMessage;

    expect(extractAssistantReasoning(message)).toEqual([
      { id: 'reasoning-1', summary: 'Public summary' },
    ]);
  });
});
