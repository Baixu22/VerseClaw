import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendRoutingMemo,
  readRoutingMemo,
  routingMemoToShadowBlock,
} from "./routing-memo-shadow.js";
import { handleVerifierFailure } from "../agents/verifier-discipline.js";

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

  it("verifier does not self-repair", () => {
    const out = handleVerifierFailure({ reason: "tests failed" });
    expect(out.status).toBe("failed");
    if (out.status === "failed") {
      expect(out.selfRepairAllowed).toBe(false);
      expect(out.createFixTask).toBe(true);
    }
  });
});
