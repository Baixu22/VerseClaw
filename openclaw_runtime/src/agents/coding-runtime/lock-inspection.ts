/**
 * P6A UFTK: read-only lock inspection for diagnostics and tests.
 *
 * This module exposes a read-only view of the in-process lock scheduler and
 * the cross-process reader marker registry. It never mutates lock state and is
 * not a second lock authority.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { processStartTimeProviderAvailable } from "../../shared/process-start-time.js";
import {
  inspectLocalLockState,
  lockScopeKind,
  sharedReaderRegistryKey,
  type LockCoreMode,
  type LockScopeKind,
} from "./lock-core.js";
import { isCodingLockConcurrencyV2Enabled } from "./file-lock-manager.js";

export type LockInspectionEntry = {
  key: string;
  scope: LockScopeKind;
  readers: number;
  writer: boolean;
  writerOwner?: string;
};

export type LockWaitingEntry = {
  key: string;
  scope: LockScopeKind;
  mode: LockCoreMode;
  owner: string;
};

export type SharedReaderEntry = {
  marker: string;
  pid: number | null;
  starttime: number | null;
  createdAt: string | null;
};

export type CodingLockInspection = {
  concurrencyV2Enabled: boolean;
  /**
   * Whether this platform can detect pid reuse (P7 carry-over D).
   *
   * When false, `starttime` on a shared-reader marker is null and marker
   * staleness degrades to pid liveness plus the `staleMs` age bound -- a bounded
   * wait, not a correctness loss. Surfacing it here is what makes that
   * degradation diagnosable in the field instead of invisible.
   */
  pidReuseDetectionAvailable: boolean;
  held: LockInspectionEntry[];
  waiting: LockWaitingEntry[];
  crossProcessSharedReaders: SharedReaderEntry[];
};

function parseMarker(raw: string): { pid: number | null; starttime: number | null; createdAt: string | null } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      starttime: typeof parsed.starttime === "number" ? parsed.starttime : null,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
    };
  } catch {
    return { pid: null, starttime: null, createdAt: null };
  }
}

async function readCrossProcessReaders(): Promise<SharedReaderEntry[]> {
  if (!isCodingLockConcurrencyV2Enabled()) return [];
  const stateDir = resolveStateDir(process.env);
  const locksDir = path.join(stateDir, "locks");
  let subdirs: string[];
  try {
    subdirs = await fs.readdir(locksDir, { withFileTypes: true }).then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("uftk-shared-read-"))
        .map((entry) => entry.name),
    );
  } catch {
    return [];
  }
  const result: SharedReaderEntry[] = [];
  for (const subdir of subdirs.sort()) {
    let markers: string[];
    try {
      markers = await fs.readdir(path.join(locksDir, subdir));
    } catch {
      continue;
    }
    for (const marker of markers.filter((name) => name.endsWith(".lock")).sort()) {
      let raw: string;
      try {
        raw = await fs.readFile(path.join(locksDir, subdir, marker), "utf8");
      } catch {
        continue;
      }
      result.push({ marker, ...parseMarker(raw) });
    }
  }
  return result;
}

/**
 * Read-only snapshot of held locks, waiting locks, and cross-process shared
 * readers. Safe to call from diagnostics and tests at any time.
 */
export async function inspectCodingLocks(): Promise<CodingLockInspection> {
  const local = inspectLocalLockState();
  const held: LockInspectionEntry[] = local.held.map((entry) => ({
    key: entry.key,
    scope: lockScopeKind(entry.key),
    readers: entry.readers,
    writer: entry.writer,
    ...(entry.writerOwner ? { writerOwner: entry.writerOwner } : {}),
  }));
  const waiting: LockWaitingEntry[] = local.waiting.map((entry) => ({
    key: entry.key,
    scope: lockScopeKind(entry.key),
    mode: entry.mode,
    owner: entry.owner,
  }));
  const crossProcessSharedReaders = await readCrossProcessReaders();
  return {
    concurrencyV2Enabled: isCodingLockConcurrencyV2Enabled(),
    pidReuseDetectionAvailable: processStartTimeProviderAvailable(),
    held,
    waiting,
    crossProcessSharedReaders,
  };
}

export { sharedReaderRegistryKey };
