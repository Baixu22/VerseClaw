import { describe, expect, it } from 'vitest';
import { resolveChatModelRef } from '@/lib/chat-model-selection';

const defaults = {
  hasMessages: false,
  lastModelRef: 'provider/recent',
  modelOptions: [{ modelRef: 'provider/default' }, { modelRef: 'provider/recent' }],
  agentModelRef: 'provider/default',
};

describe('chat model selection', () => {
  it('starts a new draft with the last explicit available model', () => {
    expect(resolveChatModelRef({ ...defaults, session: { key: 'new' } })).toBe('provider/recent');
  });
  it('restores a conversation choice instead of inheriting a later preference', () => {
    expect(resolveChatModelRef({ ...defaults, session: { key: 'old', modelRefOverride: 'provider/earlier' } })).toBe('provider/earlier');
  });
  it('does not change a conversation with history while its messages are loading', () => {
    expect(resolveChatModelRef({ ...defaults, session: { key: 'old', updatedAt: 123 } })).toBe('provider/default');
    expect(resolveChatModelRef({ ...defaults, hasMessages: true })).toBe('provider/default');
  });
  it('falls back when the preferred provider or model is removed', () => {
    expect(resolveChatModelRef({ ...defaults, lastModelRef: 'removed/model' })).toBe('provider/default');
    expect(resolveChatModelRef({ ...defaults, lastModelRef: null, agentModelRef: null })).toBe('provider/default');
  });
});
