import { describe, expect, it } from "vitest";
import { validateConfigObjectRaw } from "./validation.js";
import { OpenClawSchema } from "./zod-schema.js";

/**
 * Issue #95: `runtime.coding.uftk` was a declared-only config surface — 19 leaves
 * accepted by the type, the exhaustive fixture and the strict zod schema, with no
 * runtime reader anywhere outside `src/config/`. It was removed from all three.
 *
 * The removal is only safe because the installed workspace config still carries
 * the block: `validateConfigObjectRaw` strips the removed subtree before the
 * strict parse (`stripDeprecatedValidationKeys`), so an existing file keeps
 * starting the gateway instead of failing validation with exit code=1.
 */
const LEGACY_UFTK_BLOCK = {
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
    allowWorkspaceRoots: ["D:/ClawX-UFTK-Pilot"],
    allowAgentIds: ["uftk-pilot"],
    minIntervalMs: 0,
    retention: { maxCount: 20, maxAgeMs: 604_800_000 },
  },
  execSideEffects: { enabled: true },
  commandApproval: {
    enabled: true,
    defaultDecision: "prompt",
    rules: [{ prefix: "pnpm test", decision: "allow", reason: "test" }],
  },
};

describe("runtime.coding.uftk removal (issue #95)", () => {
  it("the strict schema no longer accepts the removed subtree", () => {
    const parsed = OpenClawSchema.safeParse({ runtime: { coding: { uftk: LEGACY_UFTK_BLOCK } } });
    expect(parsed.success).toBe(false);
  });

  it("a config written before the removal still validates and loses the dead subtree", () => {
    const result = validateConfigObjectRaw({
      runtime: { coding: { writeJournal: { enabled: true }, uftk: LEGACY_UFTK_BLOCK } },
    });
    if (!result.ok) throw new Error(`expected a valid config, got ${JSON.stringify(result.issues)}`);
    const coding = result.config.runtime?.coding ?? {};
    expect(Object.hasOwn(coding, "uftk")).toBe(false);
    // A live sibling leaf is untouched by the strip.
    expect(coding.writeJournal?.enabled).toBe(true);
  });

  it("tolerates unknown keys inside the removed subtree instead of failing validation", () => {
    const result = validateConfigObjectRaw({
      runtime: { coding: { uftk: { enabled: true, extra: true, nested: { deep: 1 } } } },
    });
    expect(result.ok).toBe(true);
  });

  it("keeps stripping the superseded commands.modelsWrite alias", () => {
    const result = validateConfigObjectRaw({ commands: { modelsWrite: true } });
    if (!result.ok) throw new Error(`expected a valid config, got ${JSON.stringify(result.issues)}`);
    expect(Object.hasOwn(result.config.commands ?? {}, "modelsWrite")).toBe(false);
  });

  it("still rejects genuinely unknown coding leaves", () => {
    const result = validateConfigObjectRaw({ runtime: { coding: { notARealLeaf: { enabled: true } } } });
    expect(result.ok).toBe(false);
  });
});
