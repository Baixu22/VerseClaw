import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("runtime.coding.uftk config", () => {
  it("accepts the installed OpenClaw UFTK block", () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        coding: {
          uftk: {
            enabled: true,
            baseVersionGuard: { enabled: true },
            auditLog: { enabled: true },
            gitCheckpoint: {
              enabled: true,
              pathScoped: { enabled: true },
              safetySnapshot: { enabled: true },
              lifecycle: { enabled: true },
            },
            concurrencyV2: { enabled: true },
            execUndo: { enabled: true },
            autoCheckpoint: {
              enabled: true,
              allowWorkspaceRoots: ["D:/ClawX"],
              allowAgentIds: ["main"],
              minIntervalMs: 1_000,
              retention: { maxCount: 10, maxAgeMs: 60_000 },
            },
            execSideEffects: { enabled: true },
            commandApproval: {
              enabled: true,
              defaultDecision: "prompt",
              rules: [{ prefix: "pnpm test", decision: "allow", reason: "test" }],
            },
          },
        },
      },
    });

    expect(parsed.runtime?.coding?.uftk?.enabled).toBe(true);
  });

  it("rejects unknown keys inside the UFTK block", () => {
    expect(() =>
      OpenClawSchema.parse({
        runtime: { coding: { uftk: { enabled: true, extra: true } } },
      }),
    ).toThrow();
  });
});
