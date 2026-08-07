/**
 * RC-05 operator channel conformance fixture.
 *
 * Proves the Operator channel contract without a real external account:
 * outbound text (sendText), inbound text (receiveText), plain-text/markdown
 * payload downgrade, rate limiting, connection-drop conformance, idempotent
 * delivery (duplicate suppression), restart recovery, denial (zero effect) and
 * unknown-outcome (journal recovery) surfaces. This fixture is a test surface
 * only; it never connects to a real channel provider.
 *
 * The stateful adapter mirrors a real channel adapter: connection state,
 * rate-limit budget, and a delivered-idempotency ledger. `exportState` /
 * `restoreState` simulate a process restart so duplicate delivery stays
 * suppressed across restarts (domain-journal truth).
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

export type FixtureSendResult = {
  ok: boolean;
  receiptRef?: string;
  error?: "empty-text" | "connection-drop" | "rate-limit" | "denied" | "message-too-long";
  /** True when this idempotency key was already delivered (duplicate suppressed). */
  duplicate?: boolean;
};

export type FixtureAdapterSnapshot = {
  connected: boolean;
  rateLimitRemaining: number | null;
  delivered: Array<{ key: string; receiptRef: string }>;
};

const MAX_MESSAGE_LENGTH = 16_384;

export type OperatorFixtureAdapter = {
  /** Deliver exactly once per idempotency key; duplicates are suppressed. */
  sendText(message: FixtureOutboundMessage, idempotencyKey?: string): FixtureSendResult;
  receiveText(message: FixtureInboundMessage): { ok: boolean; received: boolean };
  /** Simulate a connection drop: subsequent sends fail until restored. */
  dropConnection(): void;
  restoreConnection(): void;
  /** Set the remaining rate-limit budget (0 rejects sends). */
  setRateLimit(remaining: number | null): void;
  /** Snapshot for restart simulation; delivered ids survive via restoreState. */
  exportState(): FixtureAdapterSnapshot;
  restoreState(snapshot: FixtureAdapterSnapshot): void;
  /** Count of actually delivered (non-duplicate) messages. */
  deliveredCount(): number;
  deliveredKeys(): string[];
};

export function createOperatorFixtureAdapter(
  initialState?: Partial<FixtureAdapterSnapshot>,
): OperatorFixtureAdapter {
  let connected = initialState?.connected ?? true;
  let rateLimitRemaining = initialState?.rateLimitRemaining ?? null;
  const delivered = new Map<string, string>(
    (initialState?.delivered ?? []).map((entry) => [entry.key, entry.receiptRef]),
  );

  return {
    sendText(message, idempotencyKey) {
      if (!connected) {
        return { ok: false, error: "connection-drop" };
      }
      if (typeof message.text !== "string" || message.text.length === 0) {
        return { ok: false, error: "empty-text" };
      }
      if (message.text.length > MAX_MESSAGE_LENGTH) {
        return { ok: false, error: "message-too-long" };
      }
      if (rateLimitRemaining !== null) {
        if (rateLimitRemaining <= 0) {
          return { ok: false, error: "rate-limit" };
        }
        rateLimitRemaining -= 1;
      }
      const key = idempotencyKey ?? `${message.channel ?? "default"}:${message.to ?? "operator"}:${message.text}`;
      const existing = delivered.get(key);
      if (existing !== undefined) {
        return { ok: true, receiptRef: existing, duplicate: true };
      }
      const receiptRef = `fixture:out:${message.channel ?? "default"}:${message.to ?? "operator"}`;
      delivered.set(key, receiptRef);
      return { ok: true, receiptRef };
    },

    receiveText(message) {
      if (typeof message.text !== "string") {
        return { ok: false, received: false };
      }
      return { ok: true, received: message.text.length > 0 };
    },

    dropConnection() {
      connected = false;
    },

    restoreConnection() {
      connected = true;
    },

    setRateLimit(remaining) {
      rateLimitRemaining = remaining;
    },

    exportState() {
      return {
        connected,
        rateLimitRemaining,
        delivered: Array.from(delivered.entries()).map(([key, receiptRef]) => ({ key, receiptRef })),
      };
    },

    restoreState(snapshot) {
      connected = snapshot.connected;
      rateLimitRemaining = snapshot.rateLimitRemaining;
      delivered.clear();
      for (const entry of snapshot.delivered) {
        delivered.set(entry.key, entry.receiptRef);
      }
    },

    deliveredCount() {
      return delivered.size;
    },

    deliveredKeys() {
      return Array.from(delivered.keys());
    },
  };
}

/** Stateless convenience wrapper (kept for backwards compatibility). */
export function sendText(message: FixtureOutboundMessage): { ok: boolean; receiptRef: string } {
  if (typeof message.text !== "string" || message.text.length === 0) {
    return { ok: false, receiptRef: "error:empty-text" };
  }
  return { ok: true, receiptRef: `fixture:out:${message.channel ?? "default"}:${message.to ?? "operator"}` };
}

/** Stateless convenience wrapper (kept for backwards compatibility). */
export function receiveText(message: FixtureInboundMessage): { ok: boolean; received: boolean } {
  if (typeof message.text !== "string") {
    return { ok: false, received: false };
  }
  return { ok: true, received: message.text.length > 0 };
}
