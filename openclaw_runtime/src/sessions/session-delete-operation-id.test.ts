import { describe, expect, it } from "vitest";
import { buildSessionDeleteOperationId } from "./session-delete-operation-id.js";

describe("buildSessionDeleteOperationId", () => {
  it("is stable, owner-sensitive, bounded, and does not expose the identity", () => {
    const first = buildSessionDeleteOperationId("subagent cleanup", "agent:main:secret-child");
    expect(first).toBe(
      buildSessionDeleteOperationId("subagent cleanup", "agent:main:secret-child"),
    );
    expect(first).not.toBe(
      buildSessionDeleteOperationId("cron cleanup", "agent:main:secret-child"),
    );
    expect(first).not.toContain("secret-child");
    expect(first.length).toBeLessThan(128);
  });
});
