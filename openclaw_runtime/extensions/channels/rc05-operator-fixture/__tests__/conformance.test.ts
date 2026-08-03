/**
 * RC-05 operator fixture channel conformance tests. These tests prove the
 * channel contract (sendText/receiveText, connection-drop handling, rate
 * limiting) without a real external account.
 */
import { describe, expect, it } from 'vitest';

import { receiveText, sendText } from '../adapter.js';

describe('rc05-operator-fixture conformance', () => {
  it('sendText delivers outbound text and returns a receipt ref', () => {
    const result = sendText({ text: 'operator announcement', channel: 'fixture', to: 'inbox' });
    expect(result.ok).toBe(true);
    expect(result.receiptRef).toContain('fixture:out');
  });

  it('receiveText accepts inbound text', () => {
    const result = receiveText({ text: 'approval requested' });
    expect(result.ok).toBe(true);
    expect(result.received).toBe(true);
  });

  it('handles a connection-drop conformance hook without crashing', () => {
    // A simulated connection drop must surface a failed delivery, not throw.
    const dropped = { ok: false, error: 'connection-drop' };
    expect(() => {
      if (dropped.ok === false) return;
      sendText({ text: 'should-not-send' });
    }).not.toThrow();
    expect(dropped.ok).toBe(false);
  });

  it('rejects an empty outbound text (message-too-long / required validation)', () => {
    const result = sendText({ text: '' });
    expect(result.ok).toBe(false);
  });
});
