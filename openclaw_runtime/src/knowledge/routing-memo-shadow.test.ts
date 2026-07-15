import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendRoutingMemo,
  readRoutingMemo,
  recordRoutingMemoShadow,
  routingMemoToShadowBlock,
} from "./routing-memo-shadow.js";
import { handleVerifierFailure } from "../agents/verifier-discipline.js";
import {
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
} from "../context-engine/coding-runtime-flags.js";

describe("C7 shadow memory + verifier discipline", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "memo-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("dual-writes routing memo jsonl and shadow block", () => {
    appendRoutingMemo(root, {
      atMs: 1,
      sessionId: "s1",
      query: "who calls login",
      chosenTool: "context_impact",
      success: true,
    });
    const rows = readRoutingMemo(root);
    expect(rows).toHaveLength(1);
    const block = routingMemoToShadowBlock(rows[0]!);
    expect(block.block_type).toBe("notes");
    expect(block.summary).toContain("context_impact");
  });

  it("recordRoutingMemoShadow is no-op when disabled (default)", () => {
    const r = recordRoutingMemoShadow({
      workspaceRoot: root,
      enabled: false,
      entry: {
        atMs: 2,
        sessionId: "s2",
        query: "noop",
        chosenTool: "context_search",
        success: true,
      },
    });
    expect(r.written).toBe(false);
    expect(readRoutingMemo(root)).toHaveLength(0);
  });

  it("recordRoutingMemoShadow writes jsonl + block when enabled", () => {
    const r = recordRoutingMemoShadow({
      workspaceRoot: root,
      enabled: true,
      entry: {
        atMs: 3,
        sessionId: "s3",
        query: "impact of auth",
        chosenTool: "context_impact",
        success: true,
      },
    });
    expect(r.written).toBe(true);
    expect(r.shadowBlock?.block_type).toBe("notes");
    expect(readRoutingMemo(root)).toHaveLength(1);
  });

  it("feature flags default off for memory shadows", () => {
    expect(isCodingRoutingMemoShadowEnabled()).toBe(false);
    expect(isCodingSekbExperienceShadowEnabled()).toBe(false);
  });

  it("verifier does not self-repair and creates lead fix task", () => {
    const out = handleVerifierFailure({ reason: "tests failed" });
    expect(out.status).toBe("failed");
    if (out.status === "failed") {
      expect(out.selfRepairAllowed).toBe(false);
      expect(out.createFixTask).toBe(true);
      expect(out.fixTask?.kind).toBe("lead-fix-task");
      expect(out.fixTask?.assignee).toBe("lead");
    }
  });

  it("verifier discipline opt-out does not mandate fix task factory", () => {
    const out = handleVerifierFailure({
      reason: "legacy",
      config: { verifierNoSelfRepair: false },
    });
    expect(out.status).toBe("failed");
    if (out.status === "failed") {
      expect(out.selfRepairAllowed).toBe(false);
      expect(out.createFixTask).toBe(false);
      expect(out.fixTask).toBeUndefined();
    }
  });
});
