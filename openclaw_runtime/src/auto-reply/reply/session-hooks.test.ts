import { describe, expect, it } from "vitest";
import { buildSessionEndHookPayload } from "./session-hooks.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

describe("session lifecycle hook payloads", () => {
  it("carries the durable delete operationId for hook-side deduplication", () => {
    const payload = buildSessionEndHookPayload({
      sessionId: "session-1",
      sessionKey: "agent:main:child",
      operationId: "delete-op-1",
      cfg: {} as OpenClawConfig,
      reason: "deleted",
    });

    expect(payload.event).toMatchObject({
      sessionId: "session-1",
      sessionKey: "agent:main:child",
      operationId: "delete-op-1",
      reason: "deleted",
    });
  });
});
