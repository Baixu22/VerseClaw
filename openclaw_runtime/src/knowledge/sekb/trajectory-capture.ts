import { randomUUID } from "node:crypto";
import { extractErrorSignatureSync, type ErrorSignatureExtractor } from "./error-signature.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import { attachSekbShadowMetadata, evaluateTrajectoryShadowV1 } from "./shadow-evaluator.js";
import { sanitizeTrajectoryForPersistence } from "./trajectory-redaction.js";
import { normalizeRuntimeLineage, type RuntimeLineage } from "../../runtime-core/lineage.js";
import {
  normalizeTags,
  type JsonObject,
  type Trajectory,
  type TrajectoryOutcome,
  type TrajectoryStep,
} from "./types.js";

export type TrajectoryCaptureOptions = {
  store: KnowledgeStore;
  now?: () => Date;
  errorSignatureExtractor?: ErrorSignatureExtractor;
  shadowEvaluation?: boolean;
};

export const SEKB_CAPTURE_ORIGIN_METADATA_KEY = "sekbCaptureOrigin" as const;
export const SEKB_CAPTURE_KEY_METADATA_KEY = "sekbCaptureKey" as const;
export type SekbCaptureOrigin = "agent_end" | "task_phase_terminal" | "manual";

export type TerminalTrajectoryCaptureParams = {
  task_intent: string;
  task_type: string;
  context_fingerprint: string[];
  outcome: TrajectoryOutcome;
  raw_error?: string | null;
  runtime_lineage?: RuntimeLineage;
  capture_key?: string;
};

export type TerminalTrajectoryCaptureResult = {
  trajectory: Trajectory;
  duplicate: boolean;
};

type ActiveTrajectory = {
  trajectory_id: string;
  created_at: Date;
  task_intent: string;
  task_type: string;
  context_fingerprint: string[];
  steps: TrajectoryStep[];
  metadata: JsonObject;
};

/** Captures one runtime task as a structured L3 trajectory. */
export class TrajectoryCapture {
  readonly #store: KnowledgeStore;
  readonly #now: () => Date;
  readonly #errorSignatureExtractor?: ErrorSignatureExtractor;
  readonly #shadowEvaluation: boolean;
  readonly #active = new Map<string, ActiveTrajectory>();
  readonly #captureKeys = new Map<string, string>();

  constructor(options: TrajectoryCaptureOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#errorSignatureExtractor = options.errorSignatureExtractor;
    this.#shadowEvaluation = options.shadowEvaluation === true;
  }

  start_trajectory(
    task_intent: string,
    task_type: string,
    context_fingerprint: string[],
    metadata: JsonObject = {},
  ): string {
    const id = randomUUID();
    this.#active.set(id, {
      trajectory_id: id,
      created_at: this.#now(),
      task_intent,
      task_type: task_type.trim().toLowerCase(),
      context_fingerprint: normalizeTags(context_fingerprint),
      steps: [],
      metadata: structuredClone(metadata),
    });
    return id;
  }

  log_step(trajectory_id: string, action: string, input: unknown, output: unknown): void {
    const active = this.#active.get(trajectory_id);
    if (!active) {
      throw new Error(`SEKB active trajectory not found: ${trajectory_id}`);
    }
    active.steps.push({
      action,
      input,
      output,
      timestamp: this.#now().toISOString(),
    });
  }

  /** Attach bounded runtime metadata before the active trajectory is finalized. */
  update_active_metadata(trajectory_id: string, metadata: JsonObject): void {
    const active = this.#active.get(trajectory_id);
    if (!active) {
      throw new Error(`SEKB active trajectory not found: ${trajectory_id}`);
    }
    active.metadata = { ...active.metadata, ...structuredClone(metadata) };
  }

  finish_trajectory(
    trajectory_id: string,
    outcome: TrajectoryOutcome,
    raw_error?: string | null,
  ): Trajectory {
    const active = this.#active.get(trajectory_id);
    if (!active) {
      throw new Error(`SEKB active trajectory not found: ${trajectory_id}`);
    }
    if (outcome === "failure" && !raw_error?.trim()) {
      throw new Error("raw_error is required when finishing a failed SEKB trajectory.");
    }
    const endedAt = this.#now();
    const error_signature = raw_error?.trim() ? this.extract_error_signature(raw_error) : null;
    const trajectory: Trajectory = {
      trajectory_id,
      created_at: active.created_at.toISOString(),
      task_intent: active.task_intent,
      task_type: active.task_type,
      context_fingerprint: active.context_fingerprint,
      steps: compressSteps(active.steps, endedAt),
      outcome,
      error_signature,
      cost: {
        tokens: 0,
        duration_seconds: Math.max(0, (endedAt.getTime() - active.created_at.getTime()) / 1_000),
        retries: 0,
      },
      distilled: false,
      distilled_into: [],
      expires_at: null,
      metadata: active.metadata,
    };
    if (this.#shadowEvaluation) {
      const priorMatchingErrorSignatureCount = error_signature
        ? this.#store.count_trajectories_by_error_signature(error_signature)
        : 0;
      trajectory.metadata = attachSekbShadowMetadata(
        trajectory.metadata,
        evaluateTrajectoryShadowV1(trajectory, priorMatchingErrorSignatureCount),
      );
    }
    const sanitized = sanitizeTrajectoryForPersistence(trajectory);
    this.#store.save_trajectory(sanitized);
    this.#active.delete(trajectory_id);
    return sanitized;
  }

  /** Capture a terminal marker once for a stable run/trace identity. */
  capture_terminal_trajectory(
    params: TerminalTrajectoryCaptureParams,
  ): TerminalTrajectoryCaptureResult {
    const captureKey = params.capture_key?.trim() || undefined;
    if (captureKey) {
      const localId = this.#captureKeys.get(captureKey);
      if (localId) {
        const local = this.#store.find_trajectory(localId);
        if (local) {
          return { trajectory: local, duplicate: true };
        }
        this.#captureKeys.delete(captureKey);
      }
      const persisted = this.#store
        .query_trajectories({})
        .find((trajectory) => trajectory.metadata[SEKB_CAPTURE_KEY_METADATA_KEY] === captureKey);
      if (persisted) {
        this.#captureKeys.set(captureKey, persisted.trajectory_id);
        return { trajectory: persisted, duplicate: true };
      }
    }

    const lineage = normalizeRuntimeLineage(params.runtime_lineage);
    const metadata = {
      [SEKB_CAPTURE_ORIGIN_METADATA_KEY]: "task_phase_terminal" as const,
      ...(captureKey ? { [SEKB_CAPTURE_KEY_METADATA_KEY]: captureKey } : {}),
      ...(lineage ? { runtimeLineage: lineage } : {}),
    };
    const trajectoryId = this.start_trajectory(
      params.task_intent,
      params.task_type,
      params.context_fingerprint,
      metadata,
    );
    if (captureKey) {
      this.#captureKeys.set(captureKey, trajectoryId);
    }
    try {
      return {
        trajectory: this.finish_trajectory(trajectoryId, params.outcome, params.raw_error),
        duplicate: false,
      };
    } catch (error) {
      if (captureKey) {
        this.#captureKeys.delete(captureKey);
      }
      throw error;
    }
  }

  extract_error_signature(raw_error: string): string {
    return extractErrorSignatureSync({
      store: this.#store,
      rawError: raw_error,
      ...(this.#errorSignatureExtractor ? { extractor: this.#errorSignatureExtractor } : {}),
    });
  }

  get_trajectory(trajectory_id: string): Trajectory {
    return this.#store.get_trajectory(trajectory_id);
  }

  list_trajectories(filters: Parameters<KnowledgeStore["query_trajectories"]>[0]): Trajectory[] {
    return this.#store.query_trajectories(filters);
  }
}

export function capture_trajectory<TArgs extends unknown[], TResult>(
  capture: TrajectoryCapture,
  details: {
    task_intent: (...args: TArgs) => string;
    task_type: string;
    context_fingerprint?: (...args: TArgs) => string[];
  },
  operation: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args: TArgs) => {
    const trajectoryId = capture.start_trajectory(
      details.task_intent(...args),
      details.task_type,
      details.context_fingerprint?.(...args) ?? [],
    );
    try {
      const result = operation(...args);
      capture.finish_trajectory(trajectoryId, "success");
      return result;
    } catch (error) {
      capture.finish_trajectory(
        trajectoryId,
        "failure",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };
}

function compressSteps(steps: TrajectoryStep[], now: Date): TrajectoryStep[] {
  if (steps.length <= 50) {
    return [...steps];
  }
  const head = steps.slice(0, 5);
  const tail = steps.slice(-5);
  const omitted = steps.length - head.length - tail.length;
  return [
    ...head,
    {
      action: "steps.compressed",
      input: { omitted_count: omitted },
      output: { summary: `${omitted} middle steps omitted from SEKB trajectory storage.` },
      timestamp: now.toISOString(),
    },
    ...tail,
  ];
}
