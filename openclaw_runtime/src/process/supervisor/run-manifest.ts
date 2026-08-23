// Persisted manifest of supervisor-active runs used for restart reconciliation.
//
// The supervisor owns processes in memory only; after a gateway restart that
// memory is gone while the OS processes may survive. Each active run is
// therefore mirrored here (owner PID + run PID) so the next boot can identify
// orphans. The file is the authority: every add/remove re-reads, merges, and
// atomically rewrites it (tmp + rename), so a fresh boot's store sees entries
// written by a previous boot. Any unreadable or corrupt manifest is treated
// fail-closed: mutations leave the file untouched and reconciliation refuses
// to kill anything, preserving the file for diagnosis.
import fs from "node:fs";
import path from "node:path";

const MANIFEST_FILE_NAME = "active-runs.json";
const MANIFEST_SCHEMA = "supervisor-run-manifest.v1";

export type SupervisorRunManifestEntry = {
  runId: string;
  pid: number;
  /** PID of the supervisor owner process that spawned the run. */
  ownerPid: number;
  sessionId?: string;
  scopeKey?: string;
  lifecycle?: {
    agentId: string;
    canonicalSessionKey: string;
    expectedSessionId: string;
  };
  startedAtMs: number;
};

export type SupervisorRunManifestLoad =
  | { status: "ok"; entries: SupervisorRunManifestEntry[] }
  | { status: "missing" }
  | { status: "corrupt"; detail: string };

export type SupervisorRunManifestStore = {
  readonly filePath: string;
  readonly ownerPid: number;
  /** Adds or replaces an entry. Returns false when the manifest is corrupt and was left untouched. */
  add(entry: SupervisorRunManifestEntry): boolean;
  /** Removes an entry if present. Returns false when the manifest is corrupt and was left untouched. */
  remove(runId: string): boolean;
  /** Loads and validates the on-disk manifest. */
  load(): SupervisorRunManifestLoad;
};

function isValidEntry(value: unknown): value is SupervisorRunManifestEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Partial<SupervisorRunManifestEntry>;
  return (
    typeof entry.runId === "string" &&
    entry.runId.length > 0 &&
    typeof entry.pid === "number" &&
    Number.isInteger(entry.pid) &&
    entry.pid > 0 &&
    typeof entry.ownerPid === "number" &&
    Number.isInteger(entry.ownerPid) &&
    entry.ownerPid > 0 &&
    typeof entry.startedAtMs === "number"
  );
}

function parseManifest(raw: string): SupervisorRunManifestLoad {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "corrupt", detail: String(error) };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { status: "corrupt", detail: "manifest root is not an object" };
  }
  const schema = (parsed as { schema?: unknown }).schema;
  if (schema !== MANIFEST_SCHEMA) {
    return { status: "corrupt", detail: `unsupported manifest schema: ${String(schema)}` };
  }
  const list = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(list) || !list.every(isValidEntry)) {
    return { status: "corrupt", detail: "manifest entries are invalid" };
  }
  return { status: "ok", entries: list as SupervisorRunManifestEntry[] };
}

/** Creates a manifest store under `dir`; the file itself is only touched on first mutation. */
export function createSupervisorRunManifestStore(dir: string): SupervisorRunManifestStore {
  const filePath = path.join(dir, MANIFEST_FILE_NAME);
  const ownerPid = process.pid;

  const readForMutation = (): Map<string, SupervisorRunManifestEntry> | null => {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return new Map();
      }
      return null;
    }
    const loaded = parseManifest(raw);
    return loaded.status === "ok" ? new Map(loaded.entries.map((e) => [e.runId, e])) : null;
  };

  const persist = (entries: Map<string, SupervisorRunManifestEntry>): boolean => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const payload = JSON.stringify(
        {
          schema: MANIFEST_SCHEMA,
          entries: [...entries.values()],
        },
        null,
        2,
      );
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, payload, "utf8");
      fs.renameSync(tmpPath, filePath);
      return true;
    } catch {
      // Manifest mirroring is best-effort diagnostics state: a failed write
      // must never fail the spawn/finalize path it rides on.
      return false;
    }
  };

  return {
    filePath,
    ownerPid,
    add(entry) {
      const current = readForMutation();
      if (current === null) {
        return false;
      }
      current.set(entry.runId, entry);
      return persist(current);
    },
    remove(runId) {
      const current = readForMutation();
      if (current === null || !current.has(runId)) {
        return current !== null;
      }
      current.delete(runId);
      return persist(current);
    },
    load() {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return { status: "missing" };
        }
        return { status: "corrupt", detail: String(error) };
      }
      return parseManifest(raw);
    },
  };
}
