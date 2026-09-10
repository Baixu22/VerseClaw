import { describe, expect, it } from 'vitest';
// Verifies the explicit-mode fix in createInputModeAction: a caller-supplied
// inputMode ("interrupt" | "guide" | "queue") must override the regex
// classifier. This is the contract chat.send now honors (chat.ts passes
// params.inputMode as the second arg to createInputModeAction).
import { createInputModeAction } from '../../openclaw_runtime/src/sessions/input-mode';

describe('createInputModeAction explicit mode', () => {
  it('honors an explicit interrupt mode even when text has no interrupt keyword', () => {
    // Text "consider the edge cases" would classify as guide by default.
    const action = createInputModeAction('consider the edge cases', 'interrupt');
    expect(action.mode).toBe('interrupt');
    expect(action.abort).toBe(true);
  });

  it('honors an explicit guide mode even when text looks like an interrupt', () => {
    // Text "stop" would classify as interrupt by default.
    const action = createInputModeAction('stop and reconsider', 'guide');
    expect(action.mode).toBe('guide');
    expect(action.abort).toBe(false);
    expect((action as any).steeringMessages.length).toBeGreaterThan(0);
  });

  it('honors an explicit queue mode regardless of text content', () => {
    const action = createInputModeAction('do something urgent', 'queue');
    expect(action.mode).toBe('queue');
    expect(action.abort).toBe(false);
    expect((action as any).followUpMessages.length).toBeGreaterThan(0);
  });

  it('falls back to the classifier when no explicit mode is given', () => {
    // No second arg → regex classifier decides.
    const interrupt = createInputModeAction('停下当前任务');
    expect(interrupt.mode).toBe('interrupt');

    const guide = createInputModeAction('btw consider caching');
    expect(guide.mode).toBe('guide');
  });

  it('guide steering messages are prefixed as non-interrupting guidance', () => {
    const action = createInputModeAction('also handle timeouts', 'guide');
    const text = (action as any).steeringMessages[0].content[0];
    expect(text).toMatchObject({ type: 'text' });
    if (text.type === 'text') {
      expect(text.text).toContain('Non-interrupting guidance');
      expect(text.text).toContain('also handle timeouts');
    }
  });
});
