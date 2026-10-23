// Existing archive-index artifact I/O. The lifecycle service remains the only mutation caller.
// Read/list paths must not import cleanup, native backends or the runtime finalizer.
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { resolveDefaultAgentId } from "../agents/agent-scope-config.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { writeJsonAtomic } from "../infra/json-files.js";
import { withFileLock } from "../infra/file-lock.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { SessionArchiveIndexSnapshot } from "./session-mutation-operation-journal.js";
type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
const log = createSubsystemLogger("gateway/session-archive-index");
export const SESSION_ARCHIVE_INDEX_VERSION = 1;

export type SessionArchiveEntry = SessionArchiveIndexSnapshot;

export type SessionArchiveIndex = {
  version: 1;
  entries: SessionArchiveEntry[];
};

export function resolveSessionArchiveIndexPath(storePath: string): string {
  return path.join(path.dirname(path.resolve(storePath)), "sessions.archives.json");
}

export function resolveSessionArchiveIndexPathForAgent(
  cfg: OpenClawConfig,
  agentId: string,
): string {
  const storePath = resolveStorePath(cfg.session?.store, { agentId: normalizeAgentId(agentId) });
  return resolveSessionArchiveIndexPath(storePath);
}

function validateArchiveEntry(value: unknown): SessionArchiveEntry | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.agentId) ||
    !isNonEmptyString(value.transcriptPath) ||
    !isNonEmptyString(value.label) ||
    typeof value.archivedAt !== "number" ||
    !Number.isFinite(value.archivedAt) ||
    !isRecord(value.sessionsJsonSnapshot)
  ) {
    return null;
  }
  if (value.originalWorkspaceId !== null && !isNonEmptyString(value.originalWorkspaceId)) {
    return null;
  }
  if (value.originalFolderId !== null && !isNonEmptyString(value.originalFolderId)) {
    return null;
  }
  return value as SessionArchiveEntry;
}

export async function readSessionArchiveIndex(indexPath: string): Promise<SessionArchiveIndex> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: SESSION_ARCHIVE_INDEX_VERSION, entries: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.version !== SESSION_ARCHIVE_INDEX_VERSION ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(`Invalid session archive index schema at ${indexPath}`);
  }
  const entries = parsed.entries
    .map(validateArchiveEntry)
    .filter((entry): entry is SessionArchiveEntry => Boolean(entry));
  if (entries.length !== parsed.entries.length) {
    throw new Error(`Session archive index at ${indexPath} contains invalid entries`);
  }
  return { version: SESSION_ARCHIVE_INDEX_VERSION, entries };
}

async function writeSessionArchiveIndex(
  indexPath: string,
  index: SessionArchiveIndex,
): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await writeJsonAtomic(indexPath, index, {
    mode: 0o600,
    dirMode: 0o700,
    trailingNewline: true,
  });
}

export async function upsertArchiveEntry(indexPath: string, entry: SessionArchiveEntry): Promise<void> {
  await withFileLock(indexPath, { lockPath: `${indexPath}.clawx-write.lock`, stale: 30_000, retries: { retries: 80, minTimeout: 25, maxTimeout: 125, factor: 1 } }, async () => {
  const index = await readSessionArchiveIndex(indexPath);
  const entries = index.entries.filter((candidate) => candidate.sessionKey !== entry.sessionKey);
  entries.push(entry);
  await writeSessionArchiveIndex(indexPath, { version: 1, entries });
  });
}

export async function removeArchiveEntry(
  indexPath: string,
  sessionKey: string,
): Promise<SessionArchiveEntry | null> {
  return withFileLock(indexPath, { lockPath: `${indexPath}.clawx-write.lock`, stale: 30_000, retries: { retries: 80, minTimeout: 25, maxTimeout: 125, factor: 1 } }, async () => {
  const index = await readSessionArchiveIndex(indexPath);
  let removed: SessionArchiveEntry | null = null;
  const entries = index.entries.filter((candidate) => {
    if (candidate.sessionKey === sessionKey) {
      removed = candidate;
      return false;
    }
    return true;
  });
  if (removed) await writeSessionArchiveIndex(indexPath, { version: 1, entries });
  return removed;
  });
}

export async function readArchivedSessionKeysForStore(
  cfg: OpenClawConfig,
  store: Record<string, SessionEntry>,
): Promise<Set<string>> {
  const indexCache = new Map<string, SessionArchiveIndex>();
  const keys = new Set<string>();
  for (const sessionKey of Object.keys(store)) {
    const agentId = normalizeAgentId(
      parseAgentSessionKey(sessionKey)?.agentId ?? resolveDefaultAgentId(cfg),
    );
    const indexPath = resolveSessionArchiveIndexPathForAgent(cfg, agentId);
    let index = indexCache.get(indexPath);
    if (!index) {
      try {
        index = await readSessionArchiveIndex(indexPath);
      } catch (error) {
        // Listing is a read-only compatibility surface. A malformed or
        // foreign-version index must not hide or fail every live session.
        log.warn(`Ignoring unreadable session archive index at ${indexPath}: ${String(error)}`);
        index = { version: SESSION_ARCHIVE_INDEX_VERSION, entries: [] };
      }
      indexCache.set(indexPath, index);
    }
    if (index.entries.some((entry) => entry.sessionKey === sessionKey)) keys.add(sessionKey);
  }
  return keys;
}

export async function filterArchivedSessionStore(
  cfg: OpenClawConfig,
  store: Record<string, SessionEntry>,
): Promise<Record<string, SessionEntry>> {
  const archivedKeys = await readArchivedSessionKeysForStore(cfg, store);
  if (archivedKeys.size === 0) return store;
  return Object.fromEntries(
    Object.entries(store).filter(([sessionKey]) => !archivedKeys.has(sessionKey)),
  );
}
