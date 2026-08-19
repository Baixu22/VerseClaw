/**
 * P7: operator recovery advice (the third optional P7 product).
 *
 * The load-bearing assertion here is the asymmetry: only `recovery_required`
 * demands human action. Every other outcome guarantees a byte-unchanged
 * worktree, so telling an operator to go recover would send them hunting for
 * damage that does not exist -- and telling them nothing when the workspace IS
 * mixed is the failure this module exists to prevent.
 *
 * Advice must also be safe to build on an already-failing path, so these tests
 * pin that it is pure: no git, no locks, no filesystem.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GitCheckpointRestoreResult } from "./git-checkpoint.js";
import { buildCheckpointRecoveryAdvice } from "./git-checkpoint-recovery-advice.js";

function result(over: Partial<GitCheckpointRestoreResult>): GitCheckpointRestoreResult {
  return { status: "restored", checkpointId: "abc123", ...over } as GitCheckpointRestoreResult;
}

describe("only a mixed worktree demands action", () => {
  it("flags recovery_required and nothing else", () => {
    const statuses: Array<GitCheckpointRestoreResult["status"]> = [
      "restored",
      "disabled",
      "unsupported",
      "not_found",
      "conflict",
      "failed",
      "recovery_required",
    ];
    const flagged = statuses.filter(
      (status) => buildCheckpointRecoveryAdvice(result({ status })).actionRequired,
    );
    expect(flagged).toEqual(["recovery_required"]);
  });

  it("always returns a non-empty summary and echoes the status", () => {
    for (const status of [
      "restored",
      "disabled",
      "unsupported",
      "not_found",
      "conflict",
      "failed",
      "recovery_required",
    ] as const) {
      const advice = buildCheckpointRecoveryAdvice(result({ status }));
      expect(advice.status).toBe(status);
      expect(advice.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("recovery_required advice", () => {
  it("orders the operator path and never suggests a destructive command", () => {
    const advice = buildCheckpointRecoveryAdvice(
      result({
        status: "recovery_required",
        reason: "state dir unwritable; safety rollback incomplete",
        safetyRef: "refs/openclaw/uftk-safety/deadbeef",
        recoveryRef: "C:/state/uftk-recovery/r1",
      }),
    );

    expect(advice.actionRequired).toBe(true);
    // First step must be "stop", not "try again".
    expect(advice.steps[0]?.action).toContain("Do not run another restore");
    // The failure reason is surfaced, not swallowed.
    expect(advice.steps.some((s) => s.detail.includes("state dir unwritable"))).toBe(true);
    // Both safety surfaces are named.
    expect(advice.steps.some((s) => s.command?.includes("uftk-safety/deadbeef"))).toBe(true);
    expect(advice.steps.some((s) => s.command?.includes("uftk-recovery/r1"))).toBe(true);
    expect(advice.safetyRef).toBe("refs/openclaw/uftk-safety/deadbeef");
    expect(advice.recoveryRef).toBe("C:/state/uftk-recovery/r1");

    // Recovery advice must never propose the forbidden primitives.
    const text = JSON.stringify(advice);
    expect(text).not.toContain("--hard");
    expect(text).not.toContain("clean -f");
  });

  it("tells the operator what to do when no safety snapshot exists", () => {
    const advice = buildCheckpointRecoveryAdvice(
      result({ status: "recovery_required", reason: "apply failed" }),
    );
    expect(advice.actionRequired).toBe(true);
    // Falls back to the diagnostic, and says how to avoid the situation next time.
    expect(advice.steps.some((s) => s.detail.includes("diagnostic.beforeStatus"))).toBe(true);
    expect(advice.steps.some((s) => s.detail.includes("safetySnapshot.enabled"))).toBe(true);
    // Does not reference refs that were never captured.
    expect(advice.safetyRef).toBeUndefined();
    expect(advice.recoveryRef).toBeUndefined();
  });

  it("omits the raw-replay step when no recovery directory was written", () => {
    const advice = buildCheckpointRecoveryAdvice(
      result({ status: "recovery_required", safetyRef: "refs/openclaw/uftk-safety/x" }),
    );
    expect(advice.steps.some((s) => s.detail.includes("raw byte copies"))).toBe(false);
  });
});

describe("zero-change outcomes are stated as such", () => {
  it("distinguishes a rolled-back apply from a prepare-stage failure", () => {
    const rolledBack = buildCheckpointRecoveryAdvice(
      result({
        status: "failed",
        reason: "removal failed (rolled back from safety snapshot)",
        safetyRef: "refs/openclaw/uftk-safety/x",
      }),
    );
    expect(rolledBack.actionRequired).toBe(false);
    expect(rolledBack.summary).toContain("back at its pre-restore state");
    expect(rolledBack.steps.some((s) => s.action.includes("Confirm the rollback"))).toBe(true);

    const prepareFailure = buildCheckpointRecoveryAdvice(
      result({ status: "failed", reason: "checkpoint scope path escapes the workspace" }),
    );
    expect(prepareFailure.summary).toContain("before mutating the worktree");
    expect(prepareFailure.steps.some((s) => s.action.includes("Confirm the rollback"))).toBe(false);
  });

  it("points a conflict at the collision rather than at recovery", () => {
    const advice = buildCheckpointRecoveryAdvice(
      result({ status: "conflict", reason: "refusing to overwrite 2 dirty in-scope path(s)" }),
    );
    expect(advice.actionRequired).toBe(false);
    expect(advice.summary).toContain("byte-unchanged");
    expect(advice.steps.some((s) => s.detail.includes("dirty in-scope path"))).toBe(true);
    expect(advice.steps.some((s) => s.detail.includes("safetySnapshot.enabled"))).toBe(true);
  });

  it("suggests listing both namespaces for a missing checkpoint", () => {
    const advice = buildCheckpointRecoveryAdvice(result({ status: "not_found" }));
    expect(advice.steps[0]?.command).toContain("listSafetyCheckpoints");
  });

  it("keeps the safety ref reminder on success and asks for nothing", () => {
    const advice = buildCheckpointRecoveryAdvice(
      result({ status: "restored", safetyRef: "refs/openclaw/uftk-safety/x" }),
    );
    expect(advice.actionRequired).toBe(false);
    expect(advice.steps).toHaveLength(1);
    expect(advice.steps[0]?.command).toContain("git show refs/openclaw/uftk-safety/x");

    // Without a safety ref there is nothing to say.
    expect(buildCheckpointRecoveryAdvice(result({ status: "restored" })).steps).toEqual([]);
  });
});

describe("purity", () => {
  it("runs no git, touches no locks and reads no files", async () => {
    const source = await fs.readFile(
      path.join(import.meta.dirname, "git-checkpoint-recovery-advice.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    // Type-only import of the result shape is the entire dependency surface.
    expect(imports).toEqual(["./git-checkpoint.js"]);
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "runGitCheckpointCommand",
      "execFile",
      "node:fs",
      "acquireCodingRuntimeFileLocks",
      "acquireWorkspaceRestoreBarrier",
      "--hard",
      "clean -f",
    ]) {
      expect(codeOnly).not.toContain(forbidden);
    }
  });
});
