/**
 * Resolve DCS (context-block) runtime dependencies for embedded-agent extension factories.
 *
 * Production attempt/compact paths use this helper so task-state wiring can set
 * TaskStateHandlerConfig (sink/store) without inventing a second store.
 * TrajectoryCapture is intentionally omitted until SEKB install is productized (W4).
 */
import type { BlockStoreApi, ContextBlockSink } from "../../context-engine/block.js";
import { BlockStore } from "../../context-engine/block-store.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { createContextBlockSink } from "../harness/hook-context.js";
import { log } from "./logger.js";

export type EmbeddedDcsExtensionDeps = {
  workingMemoryStore: Pick<BlockStoreApi, "query" | "queryByEntity" | "upsert">;
  contextBlockSink: ContextBlockSink;
  objective?: string;
  parentSessionId?: string;
};

/**
 * Best-effort construction of BlockStore + ContextBlockSink for embedded runs.
 * Returns undefined when the state database cannot be opened so callers stay
 * safe and factories omit task-state wiring (existing no-sink behavior).
 */
export function resolveEmbeddedDcsExtensionDeps(params: {
  prompt?: string;
  spawnedBy?: string | null;
}): EmbeddedDcsExtensionDeps | undefined {
  try {
    const workingMemoryStore = new BlockStore(openOpenClawStateDatabase().db);
    const contextBlockSink = createContextBlockSink(workingMemoryStore);
    const objective = params.prompt?.trim() || undefined;
    const parentSessionId = params.spawnedBy?.trim() || undefined;
    return {
      workingMemoryStore,
      contextBlockSink,
      ...(objective ? { objective } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
    };
  } catch (error) {
    log.warn(`dcs extension deps unavailable: ${String(error)}`);
    return undefined;
  }
}
