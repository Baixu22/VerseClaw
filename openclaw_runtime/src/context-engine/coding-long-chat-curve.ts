/**
 * C6-H: synthetic / recorded long-chat pressure curve for context ladder proof.
 * Does not flip assembler production flags; emits metrics for flip-gate evaluation.
 */
import { archiveLowHeatBlocks, type LifecycleBlock } from "./block-lifecycle.js";
import { codingObservability } from "./coding-observability.js";
import { selectBlocksUnderTokenPressure } from "./token-pressure.js";
import { compressToolOutputText } from "../agents/tool-output-compress.js";

export type LongChatCurvePoint = {
  turn: number;
  rawChars: number;
  compressedChars: number;
  activeBlocks: number;
  archivedBlocks: number;
  promptCharsEstimate: number;
  layers: string[];
};

export type LongChatCurveReport = {
  totalTurns: number;
  cumulativeRawChars: number;
  cumulativeCompressedChars: number;
  finalPromptCharsEstimate: number;
  maxPromptCharsEstimate: number;
  points: LongChatCurvePoint[];
  /** Flip gates — advisory only; never auto-flips flags. */
  flipGates: {
    promptNotLinearExploding: boolean;
    compactionLayersHit: boolean;
    passRateFloor: boolean;
    readyToConsiderAssemblerFlip: boolean;
    notes: string[];
  };
};

export type LongChatCurveOptions = {
  turns?: number;
  /** Per-turn raw tool output size (chars). Default 2500. */
  toolOutputCharsPerTurn?: number;
  /** Target cumulative pressure. Default 64000. */
  targetCumulativeChars?: number;
  /** Simulated task pass-rate for flip gate. Default 1.0 */
  simulatedPassRate?: number;
  baselinePassRate?: number;
};

function makeToolBlock(turn: number, text: string): LifecycleBlock {
  return {
    block_id: `tool-out:${turn}`,
    block_type: "notes",
    source_system: "agent-notes",
    session_id: "long-chat-curve",
    presence: { always_on: false, background: true },
    entities: [],
    valid_at: new Date(),
    created_at: new Date(),
    mutability: "system_managed",
    summary: text.slice(0, 80),
    full_content: text,
    compression_depth: 0,
    entity_extraction_status: "empty",
    heat: turn < 3 ? 0 : 2,
  };
}

/**
 * Run a deterministic long-chat curve using archive + tool compress + token pressure.
 * Suitable for ACCEPT evidence without live traffic.
 */
export function runLongChatCurve(options?: LongChatCurveOptions): LongChatCurveReport {
  const toolOutputCharsPerTurn = options?.toolOutputCharsPerTurn ?? 2500;
  const target = options?.targetCumulativeChars ?? 64_000;
  const turns = options?.turns ?? Math.ceil(target / toolOutputCharsPerTurn);
  const simulatedPassRate = options?.simulatedPassRate ?? 1;
  const baselinePassRate = options?.baselinePassRate ?? 1;

  let blocks: LifecycleBlock[] = [
    {
      block_id: "persona:main",
      block_type: "persona",
      source_system: "system",
      session_id: "long-chat-curve",
      presence: { always_on: true, background: false },
      entities: [],
      valid_at: new Date(),
      created_at: new Date(),
      mutability: "system_managed",
      summary: "persona",
      full_content: "persona core",
      compression_depth: 0,
      entity_extraction_status: "empty",
      heat: 100,
    },
    {
      block_id: "task:main",
      block_type: "task_state",
      source_system: "system",
      session_id: "long-chat-curve",
      presence: { always_on: true, background: false },
      entities: [],
      valid_at: new Date(),
      created_at: new Date(),
      mutability: "system_managed",
      summary: "task",
      full_content: "task state",
      compression_depth: 0,
      entity_extraction_status: "empty",
      heat: 100,
    },
  ];

  const points: LongChatCurvePoint[] = [];
  let cumulativeRaw = 0;
  let cumulativeCompressed = 0;
  let maxPrompt = 0;

  for (let turn = 1; turn <= turns; turn += 1) {
    const raw = "X".repeat(toolOutputCharsPerTurn);
    cumulativeRaw += raw.length;
    const compressed = compressToolOutputText(raw, { archiveKey: `turn-${turn}` });
    cumulativeCompressed += compressed.text.length;
    blocks.push(makeToolBlock(turn, compressed.text));

    const layers: string[] = [];
    if (compressed.truncated) layers.push("tool_output_compress");

    // Archive low-heat periodically
    if (turn % 4 === 0) {
      const before = blocks.length;
      blocks = archiveLowHeatBlocks(blocks, { heatThreshold: 1 });
      if (blocks.some((b) => b.lifecycle_state === "archived")) {
        layers.push("archive");
      }
      void before;
    }

    // Emergency pressure when estimated prompt grows too large
    const active = blocks.filter((b) => b.lifecycle_state !== "archived");
    let promptCharsEstimate = active.reduce((sum, b) => sum + (b.full_content?.length ?? 0), 0);
    if (promptCharsEstimate > 12_000) {
      const kept = selectBlocksUnderTokenPressure({
        blocks,
        tokenBudget: 3000,
        mode: "emergency",
      });
      // Mark non-kept non-core as archived rather than dropping identity
      const keptIds = new Set(kept.map((b) => b.block_id));
      blocks = blocks.map((b) =>
        keptIds.has(b.block_id) || b.block_type === "persona" || b.block_type === "task_state"
          ? b
          : { ...b, lifecycle_state: "archived" as const, archived_at: new Date() },
      );
      layers.push("token_pressure_emergency");
      promptCharsEstimate = blocks
        .filter((b) => b.lifecycle_state !== "archived")
        .reduce((sum, b) => sum + (b.full_content?.length ?? 0), 0);
    }

    const archivedBlocks = blocks.filter((b) => b.lifecycle_state === "archived").length;
    const activeBlocks = blocks.length - archivedBlocks;
    maxPrompt = Math.max(maxPrompt, promptCharsEstimate);
    points.push({
      turn,
      rawChars: raw.length,
      compressedChars: compressed.text.length,
      activeBlocks,
      archivedBlocks,
      promptCharsEstimate,
      layers,
    });
  }

  const finalPrompt = points[points.length - 1]?.promptCharsEstimate ?? 0;
  // Linear explode would mean final ≈ cumulativeRaw; we require substantial reduction.
  const promptNotLinearExploding = finalPrompt < cumulativeRaw * 0.5;
  const compactionLayersHit = Object.keys(codingObservability.snapshot().compactionLayerHits).length > 0
    || points.some((p) => p.layers.length > 0);
  const passRateFloor = simulatedPassRate >= baselinePassRate - 0.02;
  const notes: string[] = [];
  if (!promptNotLinearExploding) notes.push("prompt grew too close to raw cumulative chars");
  if (!compactionLayersHit) notes.push("no compaction layer hits recorded");
  if (!passRateFloor) notes.push("pass-rate below baseline floor");
  notes.push("assembler production flags remain unflipped; this report is evidence only");

  return {
    totalTurns: turns,
    cumulativeRawChars: cumulativeRaw,
    cumulativeCompressedChars: cumulativeCompressed,
    finalPromptCharsEstimate: finalPrompt,
    maxPromptCharsEstimate: maxPrompt,
    points,
    flipGates: {
      promptNotLinearExploding,
      compactionLayersHit,
      passRateFloor,
      readyToConsiderAssemblerFlip: false, // hard rule: never auto-ready without product review
      notes,
    },
  };
}