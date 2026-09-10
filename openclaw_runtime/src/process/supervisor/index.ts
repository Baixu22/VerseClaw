// Process supervisor barrel exposes the supervised process API.
import { createProcessSupervisor } from "./supervisor.js";
import type { ProcessSupervisor } from "./types.js";

let singleton: ProcessSupervisor | null = null;

/** Return the process-wide supervisor used by runtime code that does not inject one. */
export function getProcessSupervisor(): ProcessSupervisor {
  if (singleton) {
    return singleton;
  }
  singleton = createProcessSupervisor();
  return singleton;
}

/**
 * Attaches a persisted run manifest to the process-wide supervisor and
 * reconciles entries orphaned by a previous owner process. Intended for
 * gateway startup; re-attaching only replaces the manifest store.
 */
export async function attachSupervisorRunManifestAndReconcile(
  dir: string,
): Promise<import("./reconcile.js").SupervisorReconcileResult> {
  const { createSupervisorRunManifestStore } = await import("./run-manifest.js");
  const store = createSupervisorRunManifestStore(dir);
  getProcessSupervisor().attachRunManifest(store);
  return await getProcessSupervisor().reconcileOrphans();
}

export { createProcessSupervisor } from "./supervisor.js";
export type { SupervisorReconcileResult } from "./reconcile.js";
export type {
  SupervisorRunManifestEntry,
  SupervisorRunManifestLoad,
  SupervisorRunManifestStore,
} from "./run-manifest.js";
export type {
  ManagedRun,
  ProcessSupervisor,
  RunExit,
  RunRecord,
  RunState,
  SpawnInput,
  SpawnMode,
  SupervisorSessionRunSnapshot,
  TerminationReason,
} from "./types.js";
