import { describe, expect, it } from "vitest";
import { testing } from "./harness/native-hook-relay.js";
import type { NativeHookRelayRegistration } from "./harness/native-hook-relay.js";

function registration(
  overrides: Partial<NativeHookRelayRegistration> = {},
): NativeHookRelayRegistration {
  return {
    relayId: "relay-1",
    provider: "codex",
    sessionId: "session-id-only",
    runId: "run-1",
    allowedEvents: ["pre_tool_use"],
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

describe("native hook relay loop detection gating", () => {
  it("enables pre_tool_use loop detection when only sessionId is present", () => {
    const sessionIdOnly = registration();
    expect(testing.nativePreToolUseMayRunLoopDetectionForTests(sessionIdOnly)).toBe(true);
    expect(testing.nativeHookRelayEventHasLocalWorkForTests(sessionIdOnly, "pre_tool_use")).toBe(
      true,
    );
  });

  it("does not enable loop detection without session identity", () => {
    const missing = registration({ sessionId: "" });
    expect(testing.nativePreToolUseMayRunLoopDetectionForTests(missing)).toBe(false);
  });
});
