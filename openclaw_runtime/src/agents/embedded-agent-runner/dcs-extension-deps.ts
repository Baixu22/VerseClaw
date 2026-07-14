/**
 * Resolve DCS (context-block) runtime dependencies for embedded-agent extension factories.
 *
 * Production attempt/compact paths use this helper so task-state wiring can set
 * TaskStateHandlerConfig (sink/store) without inventing a second store.
 * When SEKB is explicitly enabled, also supplies TrajectoryCapture for terminal
 * task_phase_change capture and production confirm_and_save experience writes.
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlockSink } from "../../context-engine/block.js";
import { BlockStore } from "../../context-engine/block-store.js";
import type { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { createContextBlockSink } from "../harness/hook-context.js";
import { log } from "./logger.js";
import {
  resolveEmbeddedSekbRuntime,
  type EmbeddedSekbRuntime,
} from "./sekb-runtime.js";

export type EmbeddedDcsExtensionDeps = {
  workingMemoryStore: Pick<BlockStoreApi, "query" | "queryByEntity" | "upsert">;
  contextBlockSink: ContextBlockSink;
  objective?: string;
  parentSessionId?: string;
  /** Present only when SEKB is explicitly enabled. */
  trajectoryCapture?: TrajectoryCapture;
  /** Present only when SEKB is explicitly enabled. */
  sekbRuntime?: EmbeddedSekbRuntime;
};

/**
 * Best-effort construction of BlockStore + ContextBlockSink for embedded runs.
 * Returns undefined when the state database cannot be opened so callers stay
 * safe and factories omit task-state wiring (existing no-sink behavior).
 *
 * SEKB is only attached when isSekbEnabled (config or OPENCLAW_SEKB_ENABLED).
 */
export function resolveEmbeddedDcsExtensionDeps(params: {
  prompt?: string;
  spawnedBy?: string | null;
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
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
    };
  } catch (error) {
    log.warn(`dcs extension deps unavailable: ${String(error)}`);
    return undefined;
  }
}