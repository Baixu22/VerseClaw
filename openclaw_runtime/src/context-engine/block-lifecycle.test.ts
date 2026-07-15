import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveLowHeatBlocks,
  filterBlocksByLifecycle,
  hydrateLifecycleBlock,
  type LifecycleBlock,
} from "./block-lifecycle.js";
import { selectBlocksUnderTokenPressure } from "./token-pressure.js";
import {
  buildToolOutputArchivePayload,
  compressToolOutputText,
} from "../agents/tool-output-compress.js";
import { codingObservability } from "./coding-observability.js";
import { dcsObservability } from "./dcs-observability.js";
import { applyContextLadder } from "./context-ladder.js";
import { evaluateTaskStateRewrite, taskStateBlockId } from "./task-state-rewrite.js";
import { evaluateL4SemanticReadiness } from "./l4-semantic-eval.js";

function blk(
  type: LifecycleBlock["block_type"],
  heat = 0,
  content = "x".repeat(100),
  createdAt = new Date("2026-01-01T00:00:00.000Z"),
): LifecycleBlock {
  return {
    block_id: `${type}-${heat}-${createdAt.getTime()}`,
    block_type: type,
    source_system: "working-memory",
    presence: { always_on: false },
    entities: [],
    valid_at: createdAt,
    created_at: createdAt,
    mutability: "system_managed",
    summary: content.slice(0, 20),
    full_content: content,
    compression_depth: 0,
    entity_extraction_status: "empty",
    heat,
  };
}

describe("context ladder (C6)", () => {
  beforeEach(() => {
    codingObservability.reset();
    dcsObservability.reset();
  });
  afterEach(() => {
    codingObservability.reset();
    dcsObservability.reset();
  });

  it("archives low-heat blocks without dropping", () => {
    const out = archiveLowHeatBlocks([blk("notes", 0), blk("persona", 0)]);
    expect(out.find((b) => b.block_type === "notes")?.lifecycle_state).toBe("archived");
    expect(out.find((b) => b.block_type === "persona")?.lifecycle_state).not.toBe("archived");
    const activeOnly = filterBlocksByLifecycle(out);
    expect(activeOnly.every((b) => b.lifecycle_state !== "archived")).toBe(true);
    expect(filterBlocksByLifecycle(out, { includeArchived: true })).toHaveLength(2);
    expect(codingObservability.snapshot().compactionLayerHits.archive).toBeGreaterThan(0);
    expect(dcsObservability.snapshot().contextLadderActionHits.archive).toBeGreaterThan(0);
  });

  it("hydrates archived state from presence overlay", () => {
    const archived = archiveLowHeatBlocks([blk("notes", 0)])[0]!;
    const hydrated = hydrateLifecycleBlock({
      ...archived,
      lifecycle_state: undefined,
      archived_at: undefined,
    });
    expect(hydrated.lifecycle_state).toBe("archived");
  });

  it("compresses oversized tool output and keeps archive payload", () => {
    const big = "a".repeat(10_000);
    const c = compressToolOutputText(big, { limit: 4000, archiveKey: "k1" });
    expect(c.truncated).toBe(true);
    expect(c.text.length).toBeLessThan(big.length);
    expect(c.text).toContain("context_read working_memory");
    const payload = buildToolOutputArchivePayload({
      originalText: big,
      compressed: c,
      toolName: "bash",
    });
    expect(payload).toContain(big.slice(0, 20));
    expect(codingObservability.snapshot().compactionLayerHits.tool_output_compress).toBe(1);
  });

  it("emergency pressure keeps persona/task_state and recent turn", () => {
    const older = blk("notes", 1, "old".repeat(200), new Date("2026-01-01T00:00:00.000Z"));
    const recent = blk("notes", 1, "new".repeat(200), new Date("2026-01-01T00:10:00.000Z"));
    recent.block_id = "notes-recent";
    const kept = selectBlocksUnderTokenPressure({
      blocks: [blk("persona", 1, "p"), older, recent, blk("task_state", 1, "t")],
      tokenBudget: 500,
      mode: "emergency",
    });
    const types = kept.map((b) => b.block_type).sort();
    expect(types).toContain("persona");
    expect(types).toContain("task_state");
    expect(kept.some((b) => b.block_id === "notes-recent")).toBe(true);
    expect(kept.some((b) => b.block_id === older.block_id)).toBe(false);
  });

  it("applyContextLadder archives pressure dropouts instead of discarding", () => {
    const result = applyContextLadder({
      blocks: [
        blk("persona", 10, "p"),
        blk("task_state", 10, "t"),
        blk("notes", 0, "n".repeat(8000)),
      ],
      tokenBudget: 50,
      mode: "pressure",
    });
    expect(result.activeBlocks.some((b) => b.block_type === "persona")).toBe(true);
    expect(result.archivedBlocks.length).toBeGreaterThan(0);
    expect(result.blocks.length).toBe(3);
  });

  it("task_state rewrite acceptance records scorecard", () => {
    const id = taskStateBlockId("sess-a", "task-1");
    const probe = evaluateTaskStateRewrite({
      expectedStableBlockId: id,
      writes: [
        { block_id: id, full_content: JSON.stringify({ phase: "running" }) },
        { block_id: id, full_content: JSON.stringify({ phase: "done" }) },
      ],
    });
    expect(probe.ok).toBe(true);
    expect(probe.rewrite).toBe(true);
    expect(probe.appendDetected).toBe(false);
    expect(codingObservability.snapshot().taskStateRewriteOk).toBe(1);

    const drift = evaluateTaskStateRewrite({
      writes: [
        { block_id: id, full_content: "a" },
        { block_id: `${id}:extra`, full_content: "b" },
      ],
    });
    expect(drift.ok).toBe(false);
    expect(drift.appendDetected).toBe(true);
    expect(codingObservability.snapshot().taskStateRewriteDrift).toBe(1);
  });

  it("L4 eval defers without permanent embedding default", () => {
    const report = evaluateL4SemanticReadiness();
    expect(report.decision).toBe("defer");
    expect(report.semanticBranchPresent).toBe(false);
    expect(report.embeddingDefaultOn).toBe(false);
    expect(report.recommendation.toLowerCase()).toContain("defer");
  });
});
