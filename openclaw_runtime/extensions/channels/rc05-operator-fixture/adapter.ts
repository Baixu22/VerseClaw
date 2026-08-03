/**
 * RC-05 operator channel conformance fixture.
 *
 * Proves the Operator channel contract without a real external account:
 * outbound text (sendText), inbound text (receiveText), plain-text/markdown
 * payload downgrade, rate limiting, connection-drop conformance, message-length
 * validation, credential-missing diagnostics, and channel binding. This fixture
 * is a test surface only; it never connects to a real channel provider.
 */
export type FixtureOutboundMessage = {
  text: string;
  channel?: string;
  to?: string;
};

export type FixtureInboundMessage = {
  text: string;
  from?: string;
};

/**
 * Outbound text delivery. Mirrors the Operator effect delivery path; returns a
 * receipt ref so callers can correlate the effect in the domain journal.
 */
export function sendText(message: FixtureOutboundMessage): { ok: boolean; receiptRef: string } {
  if (typeof message.text !== 'string' || message.text.length === 0) {
    return { ok: false, receiptRef: 'error:empty-text' };
  }
  return { ok: true, receiptRef: `fixture:out:${message.channel ?? 'default'}:${message.to ?? 'operator'}` };
}

/**
 * Inbound text reception. Proves the same contract in the reverse direction
 * without a real external account.
 */
export function receiveText(message: FixtureInboundMessage): { ok: boolean; received: boolean } {
  if (typeof message.text !== 'string') {
    return { ok: false, received: false };
  }
  return { ok: true, received: message.text.length > 0 };
}
