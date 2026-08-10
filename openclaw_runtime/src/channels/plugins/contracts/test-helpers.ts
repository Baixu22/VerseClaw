// Shared contract assertion helpers for channel plugins (test SDK subpath).
// These keep the public contract-testing surface available to plugin test
// harnesses; assertions are shape checks that throw on contract violations.

type OutboundSendMockLike = {
  mockResolvedValueOnce(value: Record<string, unknown>): unknown;
};

/** Prime an outbound send mock with a fixed result sequence (base + extras). */
export function primeChannelOutboundSendMock(
  mock: OutboundSendMockLike,
  base: Record<string, unknown>,
  extras: Array<Record<string, unknown>> = [],
): void {
  const sequence = [base, ...extras];
  for (const result of sequence) {
    mock.mockResolvedValueOnce(result);
  }
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

/**
 * Assert the channel inbound context contract shape. The contract requires
 * stable identity fields so dispatch decisions can be traced and policy
 * evaluated deterministically.
 */
export function expectChannelInboundContextContract(value: unknown): void {
  assertPlainObject(value, "channel inbound context");
  for (const key of ["channelId", "senderId", "messageId"]) {
    if (typeof value[key] !== "string" || (value[key] as string).length === 0) {
      throw new TypeError(`channel inbound context ${key} must be a non-empty string`);
    }
  }
}

/**
 * Assert the channel turn dispatch result contract shape: a turn dispatch must
 * resolve to a delivery outcome with an optional message reference.
 */
export function expectChannelTurnDispatchResultContract(value: unknown): void {
  assertPlainObject(value, "channel turn dispatch result");
  const outcome = value.outcome;
  if (typeof outcome !== "string" || outcome.length === 0) {
    throw new TypeError("channel turn dispatch result outcome must be a non-empty string");
  }
  if (value.messageId !== undefined && typeof value.messageId !== "string") {
    throw new TypeError("channel turn dispatch result messageId must be a string when present");
  }
}
