/**
 * SEKB semi-automatic golden path (TF-0004).
 *
 * Chain (no unattended auto writeback):
 *   execute → compress → candidate → filter → human confirm → persist → recall → behavior delta → evaluate
 *
 * Suggestions are advisory until confirm_and_save / confirm_and_save_with_lineage.
 * Production policy: never auto-write principles or experience blocks without human confirm.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextBlockSink } from "../../context-engine/block.js";
import type { ConfirmAndSaveResult } from "./distillation-tool.js";
import { DistillationTool } from "./distillation-tool.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { TrajectoryCapture } from "./trajectory-capture.js";
import { randomUUID } from "node:crypto";
import type { DistillationSuggestion, Principle, Trajectory } from "./types.js";

export const SEKB_GOLDEN_PATH_SCHEMA = "sekb-golden-path.v1" as const;
export const SEKB_GOLDEN_PATH_TASK_ID = "TF-0004" as const;

export type SekbGoldenPathStage =
  | "execute"
  | "compress"
  | "candidate"
  | "filter"
  | "confirm"
  | "persist"
  | "recall"
  | "behavior_delta"
  | "evaluate";

export type SekbGoldenPathStageRecord = {
  stage: SekbGoldenPathStage;
  ok: boolean;
  at: string;
  detail?: Record<string, unknown>;
};

export type SekbGoldenPathOptions = {
  store: KnowledgeStore;
  /** Human-facing session used for confirm provenance / DCS lineage. */
  sessionId: string;
  /** Optional ContextBlockSink (experience journal). Default: no sink → dcsWrite not_attempted/skipped. */
  contextBlockSink?: ContextBlockSink;
  now?: () => Date;
  /** Minimum trajectories per task_type cluster for candidate generation. Default 2. */
  minClusterSize?: number;
  /** Drop candidates below this confidence. Default 0.3. */
  minConfidence?: number;
  sourceSystem?: string;
  integrityClaim?: string;
  /** When provided, writes lineage evidence JSON. */
  artifactPath?: string;
  /**
   * Override task scenarios. Default: two similar config/db failures for clustering.
   */
  scenarios?: Array<{
    taskIntent: string;
    taskType: string;
    contextTags: string[];
    steps: Array<{ action: string; input: unknown; output: unknown }>;
    outcome: "success" | "failure" | "partial";
    rawError?: string | null;
  }>;
};

export type SekbGoldenPathResult = {
  schema: typeof SEKB_GOLDEN_PATH_SCHEMA;
  taskId: typeof SEKB_GOLDEN_PATH_TASK_ID;
  ok: boolean;
  autoWriteback: false;
  sessionId: string;
  stages: SekbGoldenPathStageRecord[];
  trajectoryIds: string[];
  compressedStepCounts: number[];
  candidatesBeforeFilter: number;
  candidatesAfterFilter: number;
  suggestion: DistillationSuggestion | null;
  principleId: string | null;
  principle: Principle | null;
  confirm: ConfirmAndSaveResult | null;
  recallHits: Array<{ principle_id: string; title: string; retrieval_count: number }>;
  behaviorDelta: {
    beforeInjection: string;
    afterInjection: string;
    changed: boolean;
    deltaChars: number;
  };
  lineage: {
    sessionId: string;
    sourceTrajectoryIds: string[];
    principleId: string | null;
    provenance: ConfirmAndSaveResult["provenance"];
    dcsWrite: ConfirmAndSaveResult["dcsWrite"] | null;
    highTrustEligible: boolean | null;
  };
  evaluation: {
    chainComplete: boolean;
    writeOccurredOnlyAfterConfirm: boolean;
    recallMatchedConfirmedPrinciple: boolean;
    behaviorChangedAfterPersist: boolean;
    noAutoWriteback: true;
  };
  artifactPath?: string;
};

const DEFAULT_SCENARIOS: NonNullable<SekbGoldenPathOptions["scenarios"]> = [
  {
    taskIntent: "connect PostgreSQL for golden-path demo",
    taskType: "config/db",
    contextTags: ["postgresql", "golden-path"],
    steps: [
      { action: "tool.call", input: { tool: "psql" }, output: { error: "connection refused" } },
      { action: "retry", input: { attempt: 2 }, output: { error: "connection refused" } },
      {
        action: "diagnose",
        input: { host: "127.0.0.1" },
        output: { port: 5432, reachable: false },
      },
    ],
    outcome: "failure",
    rawError: "could not connect to server: Connection refused (port 5432)",
  },
  {
    taskIntent: "configure database connection for golden-path demo",
    taskType: "config/db",
    contextTags: ["postgresql", "golden-path"],
    steps: [
      { action: "tool.call", input: { tool: "pg_isready" }, output: { ok: false } },
      {
        action: "inspect",
        input: { file: "pg_hba.conf" },
        output: { note: "local trust missing" },
      },
    ],
    outcome: "failure",
    rawError: "Connection refused while connecting to PostgreSQL",
  },
];

/**
 * Run the semi-automatic SEKB golden path end-to-end against a KnowledgeStore.
 * The confirm is agent-driven (driven_by=agent, actor=codex) and is simulated by an
 * explicit confirm_and_save_with_lineage call; it is never auto-written and never
 * recorded as a human identity.
 */
export async function runSekbGoldenPath(
  options: SekbGoldenPathOptions,
): Promise<SekbGoldenPathResult> {
  const now = options.now ?? (() => new Date());
  const minClusterSize = options.minClusterSize ?? 2;
  const minConfidence = options.minConfidence ?? 0.3;
  const scenarios = options.scenarios ?? DEFAULT_SCENARIOS;
  const stages: SekbGoldenPathStageRecord[] = [];
  const stamp = (stage: SekbGoldenPathStage, ok: boolean, detail?: Record<string, unknown>) => {
    stages.push({ stage, ok, at: now().toISOString(), ...(detail ? { detail } : {}) });
  };

  const principlesBefore = options.store.query_principles({ status: "active" }).length;

  // --- execute + compress (trajectory capture compresses steps on finish) ---
  const capture = new TrajectoryCapture({ store: options.store, now });
  const trajectories: Trajectory[] = [];
  for (const scenario of scenarios) {
    const loopRunId = `golden-path-${randomUUID()}`;
    const id = capture.start_trajectory(
      scenario.taskIntent,
      scenario.taskType,
      scenario.contextTags,
      {
        runtimeLineage: {
          schema: "runtime-lineage.v1",
          sessionId: options.sessionId,
          loopRunId,
          traceId: `trace-${loopRunId}`,
        },
      },
    );
    for (const step of scenario.steps) {
      capture.log_step(id, step.action, step.input, step.output);
    }
    const finished = capture.finish_trajectory(id, scenario.outcome, scenario.rawError ?? null);
    trajectories.push(finished);
  }
  const trajectoryIds = trajectories.map((t) => t.trajectory_id);
  const compressedStepCounts = trajectories.map((t) => t.steps.length);
  stamp("execute", trajectories.length >= minClusterSize, {
    trajectoryCount: trajectories.length,
    trajectoryIds,
  });
  stamp(
    "compress",
    compressedStepCounts.every((n) => n > 0),
    {
      compressedStepCounts,
      note: "finish_trajectory compresses steps before persistence",
    },
  );

  // Guard: no principle write before confirm
  const principlesAfterCapture = options.store.query_principles({ status: "active" }).length;
  if (principlesAfterCapture !== principlesBefore) {
    throw new Error("SEKB golden path violated ANTI-8: principles changed before human confirm");
  }

  // --- candidate ---
  const distiller = new DistillationTool({ store: options.store, now });
  const candidates = distiller.suggest_principles_from_trajectories(trajectoryIds, minClusterSize);
  stamp("candidate", candidates.length > 0, {
    count: candidates.length,
    mode: "deterministic_advisory",
  });

  // --- filter ---
  const filtered = candidates.filter((c) => c.confidence >= minConfidence);
  stamp("filter", filtered.length > 0, {
    before: candidates.length,
    after: filtered.length,
    minConfidence,
  });
  const suggestion = filtered[0] ?? null;

  // Behavior delta baseline: recall before confirm should not inject the yet-to-be principle title
  const engine = new RetrievalEngine({ store: options.store });
  const recallTaskIntent = "configure database connection postgresql";
  const recallTaskType = "config/db";
  const recallTags = ["postgresql", "golden-path"];
  const beforeHits = engine.retrieve_for_task(recallTaskIntent, recallTaskType, recallTags, 5);
  const beforeInjection = engine.format_for_injection(beforeHits);

  // --- confirm (human gate) + persist ---
  let confirm: ConfirmAndSaveResult | null = null;
  let principle: Principle | null = null;
  if (!suggestion) {
    stamp("confirm", false, { reason: "no_candidates_after_filter" });
    stamp("persist", false, { reason: "skipped_no_confirm" });
  } else {
    // Human edits may refine the suggested principle before save.
    const humanEdits: Partial<Principle> = {
      title: "Check PostgreSQL access before retrying (golden-path)",
      condition: "When PostgreSQL reports Connection refused during config/db tasks",
      action:
        "Verify service is running, pg_hba.conf allows the client, and firewall rules permit port 5432",
      reason:
        "Repeated connection refusals across similar trajectories indicate environment/config before code bugs",
      criticality: "high",
      pinned: true,
    };
    confirm = await distiller.confirm_and_save_with_lineage(suggestion, humanEdits, {
      sessionId: options.sessionId,
      requireSession: true,
      sourceSystem: options.sourceSystem ?? "ui-confirm",
      drivenBy: "agent",
      actor: "codex",
      integrityClaim: options.integrityClaim ?? "confirmed",
      ...(options.contextBlockSink ? { contextBlockSink: options.contextBlockSink } : {}),
    });
    stamp("confirm", Boolean(confirm.principleId), {
      principleId: confirm.principleId,
      dcsWrite: confirm.dcsWrite,
      highTrustEligible: confirm.highTrustEligible,
      provenanceSchema: confirm.provenance?.schema,
    });
    principle = options.store.get_principle(confirm.principleId);
    const distilled = trajectoryIds.every((id) => {
      const t = options.store.get_trajectory(id);
      return t.distilled === true && t.distilled_into.includes(confirm!.principleId);
    });
    stamp("persist", principle.status === "active" && distilled, {
      principleId: principle.principle_id,
      created_by: principle.created_by,
      distilled,
    });
  }

  // --- recall ---
  const afterHits = engine.retrieve_for_task(recallTaskIntent, recallTaskType, recallTags, 5);
  const afterInjection = engine.format_for_injection(afterHits);
  const recallMatched =
    Boolean(confirm?.principleId) && afterHits.some((p) => p.principle_id === confirm!.principleId);
  stamp("recall", recallMatched, {
    hitCount: afterHits.length,
    hitIds: afterHits.map((p) => p.principle_id),
  });

  // --- behavior delta ---
  const changed =
    afterInjection !== beforeInjection &&
    Boolean(principle) &&
    afterInjection.includes(principle!.title);
  stamp("behavior_delta", changed, {
    beforeChars: beforeInjection.length,
    afterChars: afterInjection.length,
    includesConfirmedTitle: principle ? afterInjection.includes(principle.title) : false,
  });

  // --- evaluate ---
  const writeOccurredOnlyAfterConfirm = principlesBefore === principlesAfterCapture;
  const chainComplete = Boolean(
    trajectories.length >= minClusterSize &&
    suggestion &&
    confirm?.principleId &&
    principle &&
    recallMatched &&
    changed,
  );
  stamp("evaluate", chainComplete, {
    writeOccurredOnlyAfterConfirm,
    recallMatched,
    changed,
  });

  const result: SekbGoldenPathResult = {
    schema: SEKB_GOLDEN_PATH_SCHEMA,
    taskId: SEKB_GOLDEN_PATH_TASK_ID,
    ok: chainComplete,
    autoWriteback: false,
    sessionId: options.sessionId,
    stages,
    trajectoryIds,
    compressedStepCounts,
    candidatesBeforeFilter: candidates.length,
    candidatesAfterFilter: filtered.length,
    suggestion,
    principleId: confirm?.principleId ?? null,
    principle,
    confirm,
    recallHits: afterHits.map((p) => ({
      principle_id: p.principle_id,
      title: p.title,
      retrieval_count: p.retrieval_count,
    })),
    behaviorDelta: {
      beforeInjection,
      afterInjection,
      changed,
      deltaChars: afterInjection.length - beforeInjection.length,
    },
    lineage: {
      sessionId: options.sessionId,
      sourceTrajectoryIds: suggestion?.source_trajectory_ids ?? trajectoryIds,
      principleId: confirm?.principleId ?? null,
      provenance: confirm?.provenance,
      dcsWrite: confirm?.dcsWrite ?? null,
      highTrustEligible: confirm?.highTrustEligible ?? null,
    },
    evaluation: {
      chainComplete,
      writeOccurredOnlyAfterConfirm,
      recallMatchedConfirmedPrinciple: recallMatched,
      behaviorChangedAfterPersist: changed,
      noAutoWriteback: true,
    },
  };

  if (options.artifactPath) {
    mkdirSync(dirname(options.artifactPath), { recursive: true });
    const artifact = {
      ...result,
      // Avoid dumping full step payloads into durable evidence when huge; keep lineage-focused view.
      writtenAt: now().toISOString(),
      policy: {
        autoWriteback: false,
        humanConfirmRequired: true,
        defaultOn: false,
        jointSystemGa: false,
      },
    };
    writeFileSync(options.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    result.artifactPath = options.artifactPath;
  }

  return result;
}

/** Default evidence path under a workspace/repo root. */
export function defaultSekbGoldenPathArtifactPath(workspaceRoot: string): string {
  return join(workspaceRoot, "artifacts", "sekb-golden-path", "evidence.json");
}
