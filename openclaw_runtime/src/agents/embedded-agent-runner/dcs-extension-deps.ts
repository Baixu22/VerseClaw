/**
 * Resolve DCS (context-block) runtime dependencies for embedded-agent extension factories.
 *
 * Production attempt/compact paths use this helper so task-state wiring can set
 * TaskStateHandlerConfig (sink/store) without inventing a second store.
 * When SEKB is explicitly enabled, also supplies TrajectoryCapture for terminal
 * task_phase_change capture and production confirm_and_save experience writes.
 * When a coding workspace root is available, also supplies WorkspaceFactService
 * so Fact view tools share one store/materializer (C0-3).
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
   * Undefined when workspaceRoot is missing.
   */
  factService?: WorkspaceFactService;
};

/**
 * Best-effort construction of BlockStore + ContextBlockSink for embedded runs.
 * Returns undefined when the state database cannot be opened so callers stay
 * safe and factories omit task-state wiring (existing no-sink behavior).
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
}): EmbeddedDcsExtensionDeps | undefined {
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
    if (workspaceRoot) {
      try {
        factService = resolveWorkspaceFactService(workspaceRoot);
      } catch (error) {
        log.warn(`fact service unavailable: ${String(error)}`);
      }
    }
    return {
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
    };
  } catch (error) {
    log.warn(`dcs extension deps unavailable: ${String(error)}`);
    return undefined;
  }
}
