/**
 * Deterministic synthetic-agent coding corpus generator (-30 tasks).
 * Aligns with coding-ab-fixtures three arms: baseline / factstore / mcp_control.
 * Never emits kind=live; never reads user privacy dirs; never flips defaults.
 */
import {
  CODING_AB_FIXTURES,
  type AbArm,
  type CodingAbFixture,
} from "../../experiments/coding-ab-fixtures.js";
import {
  estimateTokensFromChars,
  type DcsCorpusArm,
  type DcsCorpusDocument,
  type DcsCorpusEntry,
  type DcsCorpusTurn,
} from "./dcs-corpus-schema.js";

export const DEFAULT_SYNTHETIC_CORPUS_SEED = 42;
export const DEFAULT_SYNTHETIC_TASK_COUNT = 32;

export type SyntheticCorpusTask = CodingAbFixture & {
  /** Deterministic baseline tool call count after seed jitter. */
  baselineToolCount: number;
};

export type GenerateSyntheticCorpusOptions = {
  seed?: number;
  /** Number of unique coding tasks (default 32, minimum 30). */
  taskCount?: number;
  source?: string;
};

const CATEGORIES: CodingAbFixture["category"][] = [
  "impact_callers",
  "impact_radius",
  "understand",
  "reuse",
  "verify",
];

const EXPECTED_TOOL_BY_CATEGORY: Record<CodingAbFixture["category"], string> = {
  impact_callers: "context_impact",
  impact_radius: "context_impact",
  understand: "context_understand",
  reuse: "context_reuse",
  verify: "context_verify",
};

/** Mulberry32 PRNG - deterministic, seedable. */
export function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function padId(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Expand base AB fixtures to -taskCount deterministic coding tasks.
 * Reuses the 12 base fixtures, then synthesizes additional tasks with stable ids.
 */
export function buildSyntheticTasks(options?: {
  seed?: number;
  taskCount?: number;
}): SyntheticCorpusTask[] {
  const seed = options?.seed ?? DEFAULT_SYNTHETIC_CORPUS_SEED;
  const taskCount = Math.max(30, options?.taskCount ?? DEFAULT_SYNTHETIC_TASK_COUNT);
  const rng = createSeededRng(seed);
  const tasks: SyntheticCorpusTask[] = [];

  for (let i = 0; i < taskCount; i++) {
    const base = CODING_AB_FIXTURES[i % CODING_AB_FIXTURES.length]!;
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const useBase = i < CODING_AB_FIXTURES.length;
    const id = useBase ? base.id : `nav-syn-${padId(i + 1)}`;
    const query = useBase
      ? base.query
      : `[seed=${seed}#${i}] ${category.replaceAll("_", " ")} task ${i + 1}`;
    const expectedTool = useBase
      ? base.expectedTool
      : EXPECTED_TOOL_BY_CATEGORY[category];
    const baselineLen = useBase
      ? base.baselineTools.length
      : 3 + Math.floor(rng() * 5); // 3..7
    const baselineTools = useBase
      ? [...base.baselineTools]
      : Array.from({ length: baselineLen }, (_, j) => (j % 2 === 0 ? "grep" : "read"));
    // Small deterministic jitter on baseline length for synthetic-only tasks already baked in.
    tasks.push({
      id,
      category: useBase ? base.category : category,
      query,
      expectedTool,
      baselineTools,
      baselineToolCount: baselineTools.length,
    });
  }
  return tasks;
}

function toolTurn(index: number, name: string, resultChars: number): DcsCorpusTurn {
  const argsChars = 24 + name.length * 2;
  const assistantChars = 40 + name.length;
  return {
    index,
    role: "assistant",
    chars: assistantChars,
    tokenEstimate: estimateTokensFromChars(assistantChars),
    toolCalls: [
      {
        name,
        argsChars,
        resultChars,
      },
    ],
  };
}

function resultTurn(index: number, resultChars: number): DcsCorpusTurn {
  return {
    index,
    role: "tool",
    chars: resultChars,
    tokenEstimate: estimateTokensFromChars(resultChars),
  };
}

/**
 * Build a trajectory for one task - one arm.
 */
export function buildArmTrajectory(
  task: SyntheticCorpusTask,
  arm: DcsCorpusArm,
  seed: number,
): DcsCorpusEntry {
  const turns: DcsCorpusTurn[] = [
    {
      index: 0,
      role: "user",
      chars: task.query.length + 8,
      tokenEstimate: estimateTokensFromChars(task.query.length + 8),
    },
  ];
  const pass = true;
  let nextIndex = 1;

  if (arm === "baseline") {
    for (const tool of task.baselineTools) {
      const resultChars = 400;
      turns.push(toolTurn(nextIndex++, tool, resultChars));
      turns.push(resultTurn(nextIndex++, resultChars));
    }
  } else if (arm === "factstore") {
    const resultChars = 220;
    turns.push(toolTurn(nextIndex++, task.expectedTool, resultChars));
    turns.push(resultTurn(nextIndex++, resultChars));
  } else {
    // mcp_control reference: two search-like tools
    for (const tool of ["codebase_search", "read"]) {
      const resultChars = 300;
      turns.push(toolTurn(nextIndex++, tool, resultChars));
      turns.push(resultTurn(nextIndex++, resultChars));
    }
  }

  // Closing assistant answer
  turns.push({
    index: nextIndex,
    role: "assistant",
    chars: 120,
    tokenEstimate: estimateTokensFromChars(120),
  });

  return {
    sessionId: `syn-${seed}-${task.id}-${arm}`,
    kind: "synthetic-agent",
    source: `synthetic-agent/seed=${seed}/${task.id}/${arm}`,
    pass,
    arm,
    taskId: task.id,
    category: task.category,
    query: task.query,
    turns,
  };
}

/**
 * Generate a full synthetic-agent corpus document (deterministic for a given seed).
 */
export function generateSyntheticAgentCorpus(
  options?: GenerateSyntheticCorpusOptions,
): DcsCorpusDocument {
  const seed = options?.seed ?? DEFAULT_SYNTHETIC_CORPUS_SEED;
  const taskCount = Math.max(30, options?.taskCount ?? DEFAULT_SYNTHETIC_TASK_COUNT);
  const source =
    options?.source ??
    `synthetic-agent/deterministic seed=${seed} tasks=${taskCount} arms=baseline,factstore,mcp_control`;
  const tasks = buildSyntheticTasks({ seed, taskCount });
  const arms: DcsCorpusArm[] = ["baseline", "factstore", "mcp_control"];
  const entries: DcsCorpusEntry[] = [];
  for (const task of tasks) {
    for (const arm of arms) {
      entries.push(buildArmTrajectory(task, arm, seed));
    }
  }
  return {
    version: 1,
    kind: "synthetic-agent",
    source,
    seed,
    notes: [
      "kind=synthetic-agent only; not live traffic",
      "three arms: baseline / factstore / mcp_control for C1 canary A/B",
      `seed=${seed} taskCount=${tasks.length} entries=${entries.length}`,
    ],
    entries,
  };
}

/** Count unique taskIds in a synthetic corpus. */
export function countSyntheticTasks(doc: DcsCorpusDocument): number {
  return new Set(doc.entries.map((e) => e.taskId).filter(Boolean)).size;
}

/** Map corpus arm entries into evaluateAbGate-compatible rows (toolCalls / tokenCost / pass). */
export function corpusEntriesToAbResults(
  doc: DcsCorpusDocument,
): Array<{
  fixtureId: string;
  arm: AbArm;
  toolCalls: number;
  tokenCost: number;
  passed: boolean;
  firstTool: string;
  routingCorrect: boolean;
}> {
  return doc.entries
    .filter((e): e is DcsCorpusEntry & { arm: DcsCorpusArm; taskId: string } =>
      Boolean(e.arm && e.taskId),
    )
    .map((e) => {
      const toolNames = e.turns.flatMap((t) => (t.toolCalls ?? []).map((tc) => tc.name));
      const toolCalls = toolNames.length;
      const tokenCost = e.turns.reduce((s, t) => s + t.tokenEstimate, 0);
      const firstTool = toolNames[0] ?? "unknown";
      const expected = e.turns
        .flatMap((t) => t.toolCalls ?? [])
        .find((tc) => tc.name.startsWith("context_"));
      const routingCorrect =
        e.arm === "factstore" && Boolean(expected) && firstTool === expected?.name;
      return {
        fixtureId: e.taskId,
        arm: e.arm as AbArm,
        toolCalls,
        tokenCost,
        passed: e.pass,
        firstTool,
        routingCorrect: e.arm === "factstore" ? routingCorrect : false,
      };
    });
}
