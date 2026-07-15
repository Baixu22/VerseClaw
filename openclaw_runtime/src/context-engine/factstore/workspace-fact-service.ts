/**
 * Per-workspace FactStore + Materializer service (C0-3).
 *
 * Tools (C0-1'), context-pack / impact providers, and any future parse-on-touch
 * path must share one service instance so touch queues and store handles stay
 * coherent within a process. Replaces private Map caches in providers.
 *
 * Lifecycle is linked to workspace fingerprints (workspace-fingerprint.ts):
 * when a session fingerprint changes, callers invalidate the previous entry
 * so materializer caches are not reused across workspace switches.
 */
import path from "node:path";
import { computeWorkspaceFingerprint } from "../workspace-fingerprint.js";
import { createMaterializer, type Materializer } from "./materialize.js";
import { openFactStore, type FactStore } from "./store.js";

export interface WorkspaceFactService {
  readonly repoRoot: string;
  readonly fingerprint: string;
  readonly store: FactStore;
  readonly materializer: Materializer;
}

type RegistryEntry = {
  fingerprint: string;
  service: WorkspaceFactService;
};

/** Process-scoped workspace -> service registry (keyed by resolved absolute path). */
const registry = new Map<string, RegistryEntry>();

function registryKey(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

/**
 * Resolve (or create) the shared FactService for a workspace root.
 * Subsequent calls with the same resolved path return the identical instance
 * while the fingerprint stays stable.
 */
export function resolveWorkspaceFactService(workspaceRoot: string): WorkspaceFactService {
  const key = registryKey(workspaceRoot);
  const fingerprint = computeWorkspaceFingerprint(key);
  const existing = registry.get(key);
  if (existing) {
    if (existing.fingerprint === fingerprint) {
      return existing.service;
    }
    // Path remount / identity drift: drop materializer cache for this root.
    registry.delete(key);
  }
  const store = openFactStore(key);
  const materializer = createMaterializer(store, key);
  const service: WorkspaceFactService = {
    repoRoot: materializer.repoRoot,
    fingerprint,
    store,
    materializer,
  };
  registry.set(key, { fingerprint, service });
  return service;
}

/** Drop the cached service for a workspace root (does not close FactStore handles). */
export function invalidateWorkspaceFactService(workspaceRoot: string): boolean {
  return registry.delete(registryKey(workspaceRoot));
}

/**
 * Drop every registry entry whose fingerprint matches (session workspace switch).
 * Returns the number of entries removed.
 */
export function invalidateWorkspaceFactServiceByFingerprint(fingerprint: string): number {
  const fp = fingerprint.trim();
  if (!fp) {
    return 0;
  }
  let removed = 0;
  for (const [key, entry] of registry) {
    if (entry.fingerprint === fp) {
      registry.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Test hygiene: drop every cached service (does not close FactStore handles). */
export function __resetWorkspaceFactServiceRegistry(): void {
  registry.clear();
}

/** Visible registry size for diagnostics/tests. */
export function workspaceFactServiceRegistrySize(): number {
  return registry.size;
}