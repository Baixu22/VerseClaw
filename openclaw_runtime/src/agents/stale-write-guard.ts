/**
 * C2-2: full-file write stale guard (STORM-style).
 * Only blocks files this session has read when disk content diverged since last read.
 * Edit tool is intentionally not wrapped (oldText is implicit protection).
 */
import { codingObservability } from "../context-engine/coding-observability.js";
import type { FactStore } from "../context-engine/factstore/store.js";
import { checkFileFreshness } from "../context-engine/factstore/freshness.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { WriteToolOptions } from "./sessions/tools/write.js";
import {
  getSessionReadHash,
  hashFileContent,
  hashFileOnDisk,
  resolveWorkspaceFile,
} from "./session-read-hashes.js";
import { toFactRelPath } from "./fact-rel-path.js";

export type StaleWriteGuardOptions = {
  workspaceRoot: string;
  sessionId?: string;
  enabled?: boolean;
  factStore?: Pick<FactStore, "getFileRecord">;
  /** Override for tests. */
  readDiskHash?: (absolutePath: string) => string | undefined;
};

// Preserve original errors/codes while identifying admission with no file effect.
const admissionRejections = new WeakSet<object>();
export function isWriteAdmissionRejection(error: unknown): boolean {
  return error !== null && typeof error === "object" && admissionRejections.has(error);
}

export class StaleWriteError extends Error {
  readonly code = "STALE_WRITE";
  readonly relPath: string;
  constructor(relPath: string) {
    super(
      `Stale write blocked for ${relPath}: file changed since last read in this session. ` +
        `Re-read the file before writing, or pass force=true / allowStaleWrite=true to override (recorded as allowance).`,
    );
    this.name = "StaleWriteError";
    this.relPath = relPath;
  }
}

/** Explicit operator/agent override keys (TASK-P1-07). */
export function isStaleWriteOverrideRequested(args: unknown): boolean {
  const record = getToolParamsRecord(args);
  if (!record) return false;
  for (const key of ["force", "allowStaleWrite", "allow_stale_write"] as const) {
    const v = record[key];
    if (v === true) return true;
    if (typeof v === "string") {
      const raw = v.trim().toLowerCase();
      if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
    }
  }
  return false;
}

export function shouldBlockStaleWrite(params: {
  workspaceRoot: string;
  filePath: string;
  sessionId?: string;
  factStore?: Pick<FactStore, "getFileRecord">;
  readDiskHash?: (absolutePath: string) => string | undefined;
}): { block: boolean; relPath?: string; reason?: string } {
  const rel = toFactRelPath(params.filePath, params.workspaceRoot);
  if (!rel) {
    return { block: false };
  }
  const lastRead = getSessionReadHash(params.sessionId, rel);
  if (!lastRead) {
    // Never read in this session — do not block generators/external outputs.
    return { block: false, relPath: rel, reason: "unread" };
  }
  const abs = resolveWorkspaceFile(params.workspaceRoot, params.filePath);
  const diskHash = (params.readDiskHash ?? hashFileOnDisk)(abs);
  if (!diskHash) {
    // File missing: full write is create, not stale overwrite.
    return { block: false, relPath: rel, reason: "missing" };
  }
  if (diskHash === lastRead) {
    return { block: false, relPath: rel, reason: "fresh-read" };
  }
  // Disk diverged from last session read — optional FactStore corroboration.
  if (params.factStore) {
    const record = params.factStore.getFileRecord(params.workspaceRoot, rel);
    const freshness = checkFileFreshness(
      record
        ? {
            path: rel,
            producedHash: record.provenance.producedHash,
            producer: record.provenance.producer,
          }
        : undefined,
      diskHash,
    );
    // Block when disk != last-read; FactStore status is informational for metrics.
    void freshness;
  }
  return { block: true, relPath: rel, reason: "stale-since-read" };
}

export function createStaleWriteGuard(
  options: StaleWriteGuardOptions,
  readFile: (absolutePath: string) => Promise<Buffer | string>,
  statFile?: NonNullable<WriteToolOptions["operations"]>["statFile"],
): WriteToolOptions["beforeWrite"] {
  if (options.enabled !== true) {
    return undefined;
  }
  return async (absolutePath, args) => {
    try {
      const record = getToolParamsRecord(args);
      const filePath = typeof record?.path === "string" ? record.path : undefined;
      if (filePath) {
        const relPath = toFactRelPath(filePath, options.workspaceRoot);
        let diskHash: string | undefined;
        if (relPath && getSessionReadHash(options.sessionId, relPath)) {
          if (options.readDiskHash) {
            diskHash = options.readDiskHash(absolutePath);
          } else {
            try {
              diskHash = hashFileContent(await readFile(absolutePath));
            } catch (error) {
              const code =
                error && typeof error === "object" && "code" in error ? error.code : undefined;
              // Remote bridges can report a process exit code. Only their scoped
              // stat's explicit absence can turn that read failure into a create.
              if (
                code !== "ENOENT" &&
                code !== "not-found" &&
                !(statFile && (await statFile(absolutePath)) === null)
              )
                throw error;
            }
          }
        }
        const decision = shouldBlockStaleWrite({
          workspaceRoot: options.workspaceRoot,
          filePath,
          sessionId: options.sessionId,
          factStore: options.factStore,
          readDiskHash: () => diskHash,
        });
        if (decision.block) {
          // TASK-P1-07: explicit override path (force/allowStaleWrite) — still counts as allowance for metrics.
          if (isStaleWriteOverrideRequested(args)) {
            codingObservability.recordStaleAllowance();
            return;
          }
          codingObservability.recordStaleBlock();
          throw new StaleWriteError(decision.relPath ?? filePath);
        }
        codingObservability.recordStaleAllowance();
      }
    } catch (error) {
      if (error !== null && typeof error === "object") admissionRejections.add(error);
      throw error;
    }
  };
}
