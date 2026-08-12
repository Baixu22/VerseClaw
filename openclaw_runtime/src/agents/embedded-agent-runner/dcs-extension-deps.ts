/**
 * Resolve DCS (context-block) runtime dependencies for embedded-agent extension factories.
 *
 * Production attempt/compact paths use this helper so task-state wiring can set
 * TaskStateHandlerConfig (sink/store) without inventing a second store.
 * When SEKB is explicitly enabled, also supplies TrajectoryCapture for terminal
 * task_phase_change capture and production confirm_and_save experience writes.
 * When a coding workspace root is available, also supplies WorkspaceFactService
 * so Fact view tools share one store/materializer (C0-3).
 *
 * TASK-P0-04: failures are not silent — callers get a user-visible degradation notice
 * so missing context_* tools are explained as storage degraded, not "feature does not exist".
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlockSink } from "../../context-engine/block.js";
import { BlockStore } from "../../context-engine/block-store.js";
import {
  resolveWorkspaceFactService,
  type WorkspaceFactService,
} from "../../context-engine/factstore/workspace-fact-service.js";
import type { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { createContextBlockSink } from "../harness/hook-context.js";
import { log } from "./logger.js";
import {
  resolveEmbeddedSekbRuntime,
  type EmbeddedSekbRuntime,
} from "./sekb-runtime.js";

export type EmbeddedDcsExtensionDeps = {
  workingMemoryStore: Pick<BlockStoreApi, "query" | "queryByEntity" | "upsert" | "invalidate">;
  contextBlockSink: ContextBlockSink;
  objective?: string;
  parentSessionId?: string;
  /** Present only when SEKB is explicitly enabled. */
  trajectoryCapture?: TrajectoryCapture;
  /** Present only when SEKB is explicitly enabled. */
  sekbRuntime?: EmbeddedSekbRuntime;
  /**
   * C0-3: shared FactStore service for the coding workspace.
   * Undefined when workspaceRoot is missing or FactService failed to open.
   */
  factService?: WorkspaceFactService;
  /** B-3 v3: write-set coordinate for a spawned-worker child (re-anchor hint). */
  writeSet?: string[];
};

/** Heading used in extraSystemPrompt when BlockStore/state DB is unavailable (TASK-P0-04). */
export const DCS_BLOCKSTORE_UNAVAILABLE_HEADING = "## Context storage unavailable";

/** Heading when FactService fails but BlockStore is healthy. */
export const DCS_FACTSERVICE_UNAVAILABLE_HEADING = "## Fact store unavailable";

export type DcsDepsResolution = {
  /** Present when BlockStore + sink constructed successfully. */
  deps?: EmbeddedDcsExtensionDeps;
  /**
   * Short markdown notice for the model/user when DCS storage is degraded.
   * Explains missing context tools as a storage failure, not a missing product feature.
   */
  degradationNotice?: string;
  /** Machine-oriented reason for logs/tests. */
  failureCode?: "block_store_open_failed" | "fact_service_open_failed";
};

function truncateReason(error: unknown, max = 180): string {
  const raw = error instanceof Error ? error.message : String(error);
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export function buildBlockStoreUnavailableNotice(error: unknown): string {
  const detail = truncateReason(error);
  return [
    DCS_BLOCKSTORE_UNAVAILABLE_HEADING,
    "",
    "DCS BlockStore / state database could not be opened for this turn.",
    "Tools `context_read`, `context_search`, and `context_write` are **temporarily unavailable** because storage failed — not because the product lacks them.",
    "Working-memory injection and task_state persistence are also degraded until storage recovers.",
    detail ? `Technical detail: ${detail}` : undefined,
    "Check OpenClaw state DB permissions/disk space and application logs (`dcs extension deps unavailable`).",
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

export function buildFactServiceUnavailableNotice(error: unknown): string {
  const detail = truncateReason(error);
  return [
    DCS_FACTSERVICE_UNAVAILABLE_HEADING,
    "",
    "Workspace FactStore could not be opened for this turn.",
    "Block tools may still work, but Fact view tools (`context_understand` / `context_impact` / `context_reuse` / `context_verify`) are unavailable until the fact store recovers.",
    detail ? `Technical detail: ${detail}` : undefined,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

/**
 * Best-effort construction of BlockStore + ContextBlockSink for embedded runs.
 * On failure returns `{ deps: undefined, degradationNotice }` so callers can surface
 * a user-visible explanation instead of silently omitting context tools.
 *
 * SEKB is only attached when isSekbEnabled (config or OPENCLAW_SEKB_ENABLED).
 * FactService is attached when workspaceRoot is set (dep-gate, no default-true flag).
 */
export function resolveEmbeddedDcsExtensionDeps(params: {
  prompt?: string;
  spawnedBy?: string | null;
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  /** Coding workspace root for FactService (C0-3). */
  workspaceRoot?: string;
  /** B-3 v3: write-set coordinate for a spawned-worker child. */
  writeSet?: string[];
}): DcsDepsResolution {
  try {
    const workingMemoryStore = new BlockStore(openOpenClawStateDatabase().db);
    const contextBlockSink = createContextBlockSink(workingMemoryStore);
    const objective = params.prompt?.trim() || undefined;
    const parentSessionId = params.spawnedBy?.trim() || undefined;
    const sekbRuntime = resolveEmbeddedSekbRuntime({
      cfg: params.cfg,
      env: params.env,
    });
    const workspaceRoot = params.workspaceRoot?.trim();
    let factService: WorkspaceFactService | undefined;
    let factServiceUnavailableReason: string | undefined;
    if (workspaceRoot) {
      try {
        factService = resolveWorkspaceFactService(workspaceRoot);
      } catch (error) {
        log.warn(`fact service unavailable: ${String(error)}`);
        factServiceUnavailableReason = buildFactServiceUnavailableNotice(error);
      }
    }
    const deps: EmbeddedDcsExtensionDeps = {
      workingMemoryStore,
      contextBlockSink,
      ...(objective ? { objective } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(sekbRuntime
        ? {
            trajectoryCapture: sekbRuntime.capture,
            sekbRuntime,
          }
        : {}),
      ...(factService ? { factService } : {}),
      ...(params.writeSet?.length ? { writeSet: [...params.writeSet] } : {}),
    };
    if (factServiceUnavailableReason) {
      return {
        deps,
        degradationNotice: factServiceUnavailableReason,
        failureCode: "fact_service_open_failed",
      };
    }
    return { deps };
  } catch (error) {
    log.warn(`dcs extension deps unavailable: ${String(error)}`);
    return {
      deps: undefined,
      degradationNotice: buildBlockStoreUnavailableNotice(error),
      failureCode: "block_store_open_failed",
    };
  }
}
