/**
 * Session file helpers
 *
 * Shared between the Main IPC `session:delete` handler and the HTTP mirror
 * `POST /api/sessions/delete`. Both surfaces must agree on:
 *
 *   1. how a `sessionKey` (e.g. `agent:main:session-1234`) is resolved to an
 *      on-disk transcript path via `sessions.json`, and
 *   2. which sibling artefacts are swept when the user hard-deletes a
 *      conversation:
 *        - `<baseId>.jsonl`               the live transcript
 *        - `<baseId>.deleted.jsonl`       legacy soft-delete leftover
 *        - `<baseId>.archived.jsonl`      archived transcript (recycle bin)
 *        - `<baseId>.jsonl.reset.*`       reset snapshots from sessions.reset
 *        - `<baseId>.trajectory.jsonl`    OpenClaw runtime "flight recorder"
 *                                         (default location, beside session)
 *        - `<baseId>.trajectory-path.json` pointer sidecar; when present we
 *                                         follow `runtimeFile` so the actual
 *                                         trajectory still gets unlinked even
 *                                         if `OPENCLAW_TRAJECTORY_DIR` moved
 *                                         it out of the sessions/ folder
 *
 * The helper enforces that the resolved session path lives inside the
 * agent's `sessions/` directory so a corrupt or malicious `sessions.json`
 * can never steer the unlink loop into an unrelated folder. The pointer-
 * follow path is the only deliberate exception: it walks to whatever
 * `runtimeFile` says (defended by schema + extension checks) so Verse Claw can
 * cooperate with OpenClaw's documented `OPENCLAW_TRAJECTORY_DIR` override.
 *
 * Archive (recycle bin) contract:
 *   - Archiving renames `<baseId>.jsonl` → `<baseId>.archived.jsonl` and
 *     removes the entry from `sessions.json` so `sessions.list` skips it
 *     (same skip behaviour as the legacy `.deleted.jsonl` soft-delete).
 *   - A Verse-Claw-owned index `sessions.archives.json` (beside
 *     `sessions.json`) records each archived session's original metadata so
 *     it can be restored exactly. OpenClaw's runtime ignores this file.
 *   - Permanent delete (empty recycle bin) runs `sweepSessionArtefacts` on
 *     the `.archived.jsonl` base id, which unlinks the archived transcript
 *     and all sibling trajectory/reset artefacts.
 */

import { promises as fsP } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionArchiveEntry, SessionArchiveIndex } from '@shared/types/workspace';

export type SessionResolutionFailure =
  | { kind: 'not-found' }
  | { kind: 'path-outside-scope'; resolvedPath: string };

export type SessionResolutionResult =
  | { ok: true; resolvedSrcPath: string; sessionsDirAbs: string; baseId: string }
  | { ok: false; failure: SessionResolutionFailure };

/**
 * `path.isAbsolute` only respects the *current* platform's rules. OpenClaw
 * may be running in a context (or have been migrated from a profile) where
 * the on-disk `sessionFile` uses Windows-style backslash paths, Windows
 * forward-slash paths (`C:/...`) or POSIX paths. Accepting all three keeps
 * the IPC handler portable across Win32 + macOS + Linux installs.
 */
function isAnyAbsolute(candidate: string): boolean {
  return path.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

/**
 * Resolve the absolute on-disk transcript path for `sessionKey` from a parsed
 * `sessions.json` blob. Returns `{ ok: false, failure: 'not-found' }` when no
 * matching entry is found and `{ ok: false, failure: 'path-outside-scope' }`
 * when the resolved path escapes `sessionsDir` (defence-in-depth).
 *
 * Supports the three sessions.json shapes observed in the wild:
 *   A) `{ sessions: [{ key, file, ... }] }`           (array, file field)
 *   B) `{ [sessionKey]: { sessionFile|file|...|id } }` (object-keyed, current)
 *   C) `{ sessions: [{ key, id, ... }] }`             (array, id field only)
 */
export function resolveSessionTranscriptPath(
  sessionsJson: Record<string, unknown>,
  sessionsDir: string,
  sessionKey: string,
): SessionResolutionResult {
  let uuidFileName: string | undefined;
  let resolvedSrcPath: string | undefined;

  if (Array.isArray(sessionsJson.sessions)) {
    const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    if (entry) {
      uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (!uuidFileName && typeof entry.id === 'string') {
        uuidFileName = `${entry.id}.jsonl`;
      }
    }
  }

  if (!uuidFileName && sessionsJson[sessionKey] != null) {
    const val = sessionsJson[sessionKey];
    if (typeof val === 'string') {
      uuidFileName = val;
    } else if (typeof val === 'object' && val !== null) {
      const entry = val as Record<string, unknown>;
      const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (absFile) {
        if (isAnyAbsolute(absFile)) {
          resolvedSrcPath = absFile;
        } else {
          uuidFileName = absFile;
        }
      } else {
        const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
        if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
      }
    }
  }

  if (!uuidFileName && !resolvedSrcPath) {
    return { ok: false, failure: { kind: 'not-found' } };
  }

  if (!resolvedSrcPath) {
    if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
    resolvedSrcPath = path.join(sessionsDir, uuidFileName!);
  }

  const sessionsDirAbs = path.dirname(resolvedSrcPath);
  // sessionsDir is always built from `getOpenClawConfigDir()` + the validated
  // agentId, so anything that doesn't resolve underneath it is suspect. We
  // refuse rather than try to "normalise" the entry — the worst case for the
  // user is that the sidebar entry stops listing it; the worst case if we
  // proceeded is `unlink`s in someone else's directory.
  const rel = path.relative(sessionsDir, sessionsDirAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, failure: { kind: 'path-outside-scope', resolvedPath: resolvedSrcPath } };
  }

  const baseId = path.basename(resolvedSrcPath).replace(/\.jsonl$/, '');
  return { ok: true, resolvedSrcPath, sessionsDirAbs, baseId };
}

export interface SweepResult {
  removed: string[];
  errors: Array<{ path: string; error: NodeJS.ErrnoException }>;
}

export interface ContextArchiveCleanupResult {
  removed: string[];
  errors: Array<{ path: string; error: string }>;
}

const CONTEXT_ARCHIVE_FILE_SUFFIX = '.context-archive.json';

/**
 * Schema marker written by OpenClaw's `writeTrajectoryPointerBestEffort`.
 * Any pointer file that doesn't carry this exact `traceSchema` is treated
 * as untrusted and ignored — we only follow pointers we know OpenClaw
 * authored.
 */
const TRAJECTORY_POINTER_SCHEMA = 'openclaw-trajectory-pointer';

/**
 * Best-effort: parse the trajectory pointer sidecar and return the off-disk
 * runtime file path it points at. Returns null when the pointer is absent,
 * malformed, missing the openclaw-trajectory-pointer schema, or its
 * `runtimeFile` is not an absolute `.jsonl` path. Any of those conditions
 * means we silently skip the off-disk unlink — the local sidecar sweep
 * still runs and the worst case is one orphaned file the user can clean up
 * manually.
 */
async function readTrajectoryRuntimeFile(pointerPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fsP.readFile(pointerPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.traceSchema !== TRAJECTORY_POINTER_SCHEMA) return null;
  const runtimeFile = obj.runtimeFile;
  if (typeof runtimeFile !== 'string' || runtimeFile.length === 0) return null;
  // OpenClaw always writes a `.jsonl` path; refusing anything else keeps us
  // from being weaponised into deleting (say) `/etc/passwd` if a hostile
  // sessions.json/pointer combination ever showed up on disk.
  if (!runtimeFile.endsWith('.jsonl')) return null;
  if (!path.isAbsolute(runtimeFile) && !path.win32.isAbsolute(runtimeFile)) return null;
  return runtimeFile;
}

/**
 * Hard-delete every artefact that belongs to `baseId` inside
 * `sessionsDirAbs`. ENOENT is tolerated for both the directory itself and
 * each individual file — by the time the sweep runs we've already committed
 * to the deletion, so missing files just mean a previous sweep got there
 * first. Other errors are accumulated so the caller can log/surface them.
 *
 * In addition to the local sidecars (`.jsonl`, `.deleted.jsonl`,
 * `.jsonl.reset.*`, `.trajectory.jsonl`, `.trajectory-path.json`), the
 * sweep follows the `.trajectory-path.json` pointer when it exists and
 * unlinks the off-disk runtime file at `runtimeFile`. This keeps Verse Claw in
 * sync with OpenClaw's `OPENCLAW_TRAJECTORY_DIR` override (where the
 * actual trajectory is stored outside the sessions/ folder).
 */
export async function sweepSessionArtefacts(
  sessionsDirAbs: string,
  baseId: string,
): Promise<SweepResult> {
  const result: SweepResult = { removed: [], errors: [] };

  let dirEntries: string[];
  try {
    dirEntries = await fsP.readdir(sessionsDirAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return result;
    result.errors.push({ path: sessionsDirAbs, error: err as NodeJS.ErrnoException });
    return result;
  }

  const pointerName = `${baseId}.trajectory-path.json`;
  const targets = dirEntries.filter((name) =>
    name === `${baseId}.jsonl`
    || name === `${baseId}.deleted.jsonl`
    || name === `${baseId}.archived.jsonl`
    || name === `${baseId}.trajectory.jsonl`
    || name === pointerName
    || name.startsWith(`${baseId}.jsonl.reset.`),
  );

  // Follow the pointer FIRST so the off-disk runtime file (lives outside
  // sessionsDirAbs when OPENCLAW_TRAJECTORY_DIR is set) gets unlinked
  // before we delete its only on-disk reference. If the pointer is gone,
  // malformed, or carries an in-sessions-dir path, this is a no-op and the
  // standard local sweep below covers everything.
  if (targets.includes(pointerName)) {
    const pointerPath = path.join(sessionsDirAbs, pointerName);
    const runtimeFile = await readTrajectoryRuntimeFile(pointerPath);
    if (runtimeFile) {
      const absRuntime = path.resolve(runtimeFile);
      const rel = path.relative(sessionsDirAbs, absRuntime);
      // Only chase pointers that escape the sessions dir. Anything pointing
      // back inside is already covered by the local-target sweep below
      // (and would risk a double-unlink / double-error otherwise).
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        try {
          await fsP.unlink(absRuntime);
          result.removed.push(absRuntime);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            result.errors.push({ path: absRuntime, error: err as NodeJS.ErrnoException });
          }
        }
      }
    }
  }

  await Promise.all(targets.map(async (name) => {
    const target = path.join(sessionsDirAbs, name);
    try {
      await fsP.unlink(target);
      result.removed.push(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      result.errors.push({ path: target, error: err as NodeJS.ErrnoException });
    }
  }));

  return result;
}

export async function cleanupContextArchiveArtifacts(params: {
  sessionIds: string[];
  archiveRoot?: string;
}): Promise<ContextArchiveCleanupResult> {
  const root = path.resolve(
    params.archiveRoot
      ?? process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR
      ?? path.join(os.tmpdir(), 'openclaw-context-archive'),
  );
  const removed: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const sessionId of params.sessionIds.map(sanitizeArchivePathSegment)) {
    if (!sessionId) continue;
    const sessionDir = path.join(root, sessionId);
    try {
      const entries = await fsP.readdir(sessionDir);
      await Promise.all(entries.map(async (entry) => {
        if (!entry.endsWith(CONTEXT_ARCHIVE_FILE_SUFFIX)) return;
        const filePath = path.join(sessionDir, entry);
        try {
          await fsP.unlink(filePath);
          removed.push(filePath);
        } catch (error) {
          errors.push({
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }));
      await fsP.rmdir(sessionDir).catch(() => undefined);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') {
        errors.push({
          path: sessionDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    removed: removed.sort(),
    errors: errors.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Remove `sessionKey` from a parsed sessions.json object (mutates in place).
 * Handles both the array-shape (`{ sessions: [...] }`) and the object-keyed
 * shape so the IPC handler and HTTP route share one rewrite path.
 */
export function removeSessionEntry(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
): void {
  if (Array.isArray(sessionsJson.sessions)) {
    sessionsJson.sessions = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
  } else if (sessionsJson[sessionKey]) {
    delete sessionsJson[sessionKey];
  }
}

function sanitizeArchivePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
/**
 * Snapshot the sessions.json entry for `sessionKey` so it can be re-inserted
 * verbatim on restore. Returns the raw entry value (object or string) or
 * null when the session is not listed in sessions.json. Handles both the
 * array-shape and the object-keyed shape.
 */
export function snapshotSessionEntry(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
): unknown {
  if (Array.isArray(sessionsJson.sessions)) {
    const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    return entry ? structuredClone(entry) : null;
  }
  if (sessionsJson[sessionKey] != null) {
    return structuredClone(sessionsJson[sessionKey]);
  }
  return null;
}

/**
 * Re-insert a previously snapshotted sessions.json entry for `sessionKey`.
 * If the snapshot was taken from the array shape, it is pushed back onto
 * `sessions.sessions`; otherwise it is restored under the object key. When
 * the current sessions.json uses the array shape but the snapshot is an
 * object (or vice versa), we normalise into the current shape so restore
 * stays idempotent across sessions.json migrations.
 */
export function restoreSessionEntry(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
  snapshot: unknown,
): void {
  if (snapshot == null) return;
  if (Array.isArray(sessionsJson.sessions)) {
    const exists = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .some((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    if (exists) return;
    const entry = (snapshot && typeof snapshot === 'object')
      ? { ...(snapshot as Record<string, unknown>), key: sessionKey }
      : { key: sessionKey, sessionFile: snapshot };
    (sessionsJson.sessions as Array<Record<string, unknown>>).push(entry);
  } else {
    if (sessionsJson[sessionKey] != null) return;
    sessionsJson[sessionKey] = snapshot;
  }
}

/**
 * Rename `<baseId>.jsonl` → `<baseId>.archived.jsonl` inside the sessions
 * dir. Tolerates ENOENT (file already archived or concurrently removed) by
 * returning `false` so the caller can decide whether to treat it as success.
 * Refuses paths that would escape `sessionsDirAbs` (defence-in-depth, same
 * rule as the resolution step).
 */
export async function archiveSessionTranscript(
  sessionsDirAbs: string,
  baseId: string,
): Promise<{ renamed: boolean; archivedPath: string; error?: string }> {
  const livePath = path.join(sessionsDirAbs, `${baseId}.jsonl`);
  const archivedPath = path.join(sessionsDirAbs, `${baseId}.archived.jsonl`);
  const rel = path.relative(sessionsDirAbs, archivedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { renamed: false, archivedPath, error: `archived path escapes sessions dir: ${archivedPath}` };
  }
  try {
    await fsP.rename(livePath, archivedPath);
    return { renamed: true, archivedPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { renamed: false, archivedPath, error: 'live transcript not found' };
    return { renamed: false, archivedPath, error: String(err) };
  }
}

/**
 * Rename `<baseId>.archived.jsonl` → `<baseId>.jsonl` to bring an archived
 * session back into the live set. Tolerates ENOENT (already restored or
 * permanently deleted) by returning `false`.
 */
export async function restoreSessionTranscript(
  sessionsDirAbs: string,
  baseId: string,
): Promise<{ restored: boolean; livePath: string; error?: string }> {
  const livePath = path.join(sessionsDirAbs, `${baseId}.jsonl`);
  const archivedPath = path.join(sessionsDirAbs, `${baseId}.archived.jsonl`);
  try {
    await fsP.rename(archivedPath, livePath);
    return { restored: true, livePath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { restored: false, livePath, error: 'archived transcript not found' };
    return { restored: false, livePath, error: String(err) };
  }
}

const EMPTY_ARCHIVE_INDEX: SessionArchiveIndex = { version: 1, entries: [] };

/**
 * Read the Verse-Claw-owned archive index at `archiveIndexPath` (convention:
 * `<sessionsDir>/sessions.archives.json`). Returns an empty index when the
 * file is missing, malformed, or carries an unexpected schema version — the
 * caller can then treat the archive as empty rather than crashing the UI.
 */
export async function readArchiveIndex(
  archiveIndexPath: string,
): Promise<SessionArchiveIndex> {
  let raw: string;
  try {
    raw = await fsP.readFile(archiveIndexPath, 'utf8');
  } catch {
    return { ...EMPTY_ARCHIVE_INDEX, entries: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_ARCHIVE_INDEX, entries: [] };
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_ARCHIVE_INDEX, entries: [] };
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.entries)) {
    return { ...EMPTY_ARCHIVE_INDEX, entries: [] };
  }
  const entries = (obj.entries as unknown[])
    .filter((value): value is SessionArchiveEntry => Boolean(value) && typeof value === 'object'
      && typeof (value as SessionArchiveEntry).sessionKey === 'string'
      && typeof (value as SessionArchiveEntry).agentId === 'string'
      && typeof (value as SessionArchiveEntry).transcriptPath === 'string');
  return { version: 1, entries };
}

/**
 * Persist the archive index. Writes are atomic-ish (write to temp then
 * rename) so a crash mid-write cannot corrupt the existing index — the
 * index is the only record of which `.archived.jsonl` files exist on disk,
 * so losing it would orphan archived transcripts in the recycle bin.
 */
export async function writeArchiveIndex(
  archiveIndexPath: string,
  index: SessionArchiveIndex,
): Promise<void> {
  const tmpPath = `${archiveIndexPath}.tmp`;
  await fsP.writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf8');
  await fsP.rename(tmpPath, archiveIndexPath);
}

/**
 * Append/replace an archive entry. If an entry with the same `sessionKey`
 * already exists, it is replaced (idempotent re-archive).
 */
export async function upsertArchiveEntry(
  archiveIndexPath: string,
  entry: SessionArchiveEntry,
): Promise<SessionArchiveIndex> {
  const index = await readArchiveIndex(archiveIndexPath);
  const without = index.entries.filter((existing) => existing.sessionKey !== entry.sessionKey);
  without.push(entry);
  const next: SessionArchiveIndex = { version: 1, entries: without };
  await writeArchiveIndex(archiveIndexPath, next);
  return next;
}

/**
 * Remove an entry from the archive index by `sessionKey`. Returns the
 * updated index and the removed entry (or null when absent) so the caller
 * can use the snapshot for restore.
 */
export async function removeArchiveEntry(
  archiveIndexPath: string,
  sessionKey: string,
): Promise<{ index: SessionArchiveIndex; removed: SessionArchiveEntry | null }> {
  const index = await readArchiveIndex(archiveIndexPath);
  let removed: SessionArchiveEntry | null = null;
  const entries = index.entries.filter((existing) => {
    if (existing.sessionKey === sessionKey) {
      removed = existing;
      return false;
    }
    return true;
  });
  const next: SessionArchiveIndex = { version: 1, entries };
  await writeArchiveIndex(archiveIndexPath, next);
  return { index: next, removed };}
