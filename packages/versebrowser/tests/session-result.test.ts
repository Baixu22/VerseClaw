/**
 * The shared session-id helper exists so a failed `open` cannot be mistaken for
 * a crash in the test itself. These cases pin the three outcomes.
 */
import { describe, expect, it } from 'vitest';
import { sessionIdOf } from './session-result.ts';

describe('sessionIdOf', () => {
  it('returns the session id when the open succeeded', () => {
    expect(sessionIdOf({ ok: true, content: 'session s1 opened', data: { session: { id: 's1' } } })).toBe('s1');
  });

  it('carries the real reason when the open failed (not a TypeError)', () => {
    // 2026-10-14: the unchecked inline form turned this exact shape into
    // "Cannot read properties of undefined (reading 'session')" and hid `E_OPEN`.
    let error: unknown;
    try {
      sessionIdOf({ ok: false, content: 'E_OPEN: target closed before open' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('E_OPEN: target closed before open');
    expect((error as Error).message).not.toContain('undefined');
  });

  it('falls back to the whole result when a failure carries no content', () => {
    expect(() => sessionIdOf({ ok: false, data: { recoveryHint: 'retry' } })).toThrow(/open failed:/u);
  });

  it('rejects an ok result that has no session id', () => {
    expect(() => sessionIdOf({ ok: true, content: 'opened', data: {} })).toThrow(/no session id/u);
  });
});
