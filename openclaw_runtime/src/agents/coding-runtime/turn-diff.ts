/**
 * P2 UFTK: per-turn incremental unified diff.
 *
 * TurnDiffTracker keeps the first pre-image and the latest post-image per file
 * for one turn, so callers can emit one unified diff for diagnostics or event
 * payloads without re-reading disk. It is intentionally an in-memory diagnostic
 * projection: the file system + write-journal remain the only state authorities.
 */
import path from "node:path";
import type { FileVersion } from "../../../../shared/coding-runtime/types.js";
import {
  captureLineEndings,
  generateUnifiedPatch,
  normalizeToLF,
  stripBom,
  type LineEnding,
} from "../sessions/tools/edit-diff.js";

export type TurnDiffFileStatus = "added" | "modified" | "deleted";

export type TurnDiffFileChange = {
  path: string;
  oldText?: string;
  newText?: string;
  status: TurnDiffFileStatus;
  /** First observed line ending across the turn; used for diagnostics only. */
  lineEnding: LineEnding;
  bytesBefore: number;
  bytesAfter: number;
};

export type TurnDiffDelta = {
  path: string;
  diff: string;
  status: TurnDiffFileStatus;
  oldText: string;
  newText: string;
  lineEnding: LineEnding;
  bytesBefore: number;
  bytesAfter: number;
};

export type NormalizedTurnText = {
  text: string;
  lineEnding: LineEnding;
  bytes: number;
};

/**
 * Normalize a turn text sample with the same BOM/line-ending policy as the
 * edit tool. `captureLineEndings` reports the original ending; diffs are
 * emitted on normalized LF text so CRLF/CR files don't produce misleading
 * full-line deltas.
 */
export function normalizeTurnText(text: string): NormalizedTurnText {
  const stripped = stripBom(text).text;
  const lineEnding = captureLineEndings(stripped)[0] ?? "\n";
  return {
    text: normalizeToLF(stripped),
    lineEnding,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function statusFor(oldText: string | undefined, newText: string | undefined): TurnDiffFileStatus {
  if (oldText === undefined && newText !== undefined) return "added";
  if (oldText !== undefined && newText === undefined) return "deleted";
  return "modified";
}

function normalizedPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

type TrackedFile = {
  path: string;
  firstOld?: string;
  latestNew?: string;
  lineEnding: LineEnding;
  bytesBefore: number;
  bytesAfter: number;
};

/**
 * In-memory turn diff accumulator. Not a file-state or journal source of truth.
 */
export class TurnDiffTracker {
  readonly #files = new Map<string, TrackedFile>();

  /**
   * Record one mutation delta. Returns the per-mutation unified diff while the
   * tracker also accumulates the per-file old -> latest-new turn diff.
   */
  recordFileChange(params: {
    path: string;
    oldText?: string;
    newText?: string;
    bytesBefore?: number;
    bytesAfter?: number;
  }): TurnDiffDelta {
    const displayPath = normalizedPath(params.path);
    const normalizedOld =
      params.oldText === undefined ? undefined : normalizeTurnText(params.oldText);
    const normalizedNew =
      params.newText === undefined ? undefined : normalizeTurnText(params.newText);
    const status = statusFor(params.oldText, params.newText);
    const lineEnding =
      normalizedOld?.lineEnding ?? normalizedNew?.lineEnding ?? "\n";
    const deltaDiff = generateUnifiedPatch(
      displayPath,
      normalizedOld?.text ?? "",
      normalizedNew?.text ?? "",
      3,
      status,
    );

    const key = displayPath.toLowerCase();
    const tracked =
      this.#files.get(key) ??
      ({
        path: displayPath,
        lineEnding,
        bytesBefore: params.bytesBefore ?? normalizedOld?.bytes ?? 0,
        bytesAfter: params.bytesAfter ?? normalizedNew?.bytes ?? 0,
      } satisfies TrackedFile);
    if (tracked.firstOld === undefined && normalizedOld !== undefined) {
      tracked.firstOld = normalizedOld.text;
      tracked.bytesBefore = params.bytesBefore ?? normalizedOld.bytes;
    }
    if (normalizedNew !== undefined) {
      tracked.latestNew = normalizedNew.text;
      tracked.bytesAfter = params.bytesAfter ?? normalizedNew.bytes;
    } else {
      tracked.latestNew = undefined;
      tracked.bytesAfter = params.bytesAfter ?? 0;
    }
    this.#files.set(key, tracked);

    return {
      path: displayPath,
      diff: deltaDiff,
      status,
      oldText: normalizedOld?.text ?? "",
      newText: normalizedNew?.text ?? "",
      lineEnding,
      bytesBefore: params.bytesBefore ?? normalizedOld?.bytes ?? 0,
      bytesAfter: params.bytesAfter ?? normalizedNew?.bytes ?? 0,
    };
  }

  changeForPath(filePath: string): TurnDiffFileChange | undefined {
    const tracked = this.#files.get(normalizedPath(filePath).toLowerCase());
    if (!tracked) return undefined;
    return {
      path: tracked.path,
      ...(tracked.firstOld !== undefined ? { oldText: tracked.firstOld } : {}),
      ...(tracked.latestNew !== undefined ? { newText: tracked.latestNew } : {}),
      status: statusFor(tracked.firstOld, tracked.latestNew),
      lineEnding: tracked.lineEnding,
      bytesBefore: tracked.bytesBefore,
      bytesAfter: tracked.bytesAfter,
    };
  }

  /** One accumulated unified diff for a single file over this turn. */
  diffForPath(filePath: string): string {
    const change = this.changeForPath(filePath);
    if (!change) return "";
    if (change.oldText === change.newText) return "";
    return generateUnifiedPatch(
      change.path,
      change.oldText ?? "",
      change.newText ?? "",
      3,
      change.status,
    );
  }

  /** Accumulated turn diff for every touched file, sorted by path. */
  diff(): string {
    return [...this.#files.values()]
      .toSorted((a, b) => a.path.localeCompare(b.path))
      .map((tracked) => {
        if (tracked.firstOld === tracked.latestNew) return "";
        return generateUnifiedPatch(
          tracked.path,
          tracked.firstOld ?? "",
          tracked.latestNew ?? "",
          3,
          statusFor(tracked.firstOld, tracked.latestNew),
        );
      })
      .filter(Boolean)
      .join("\n");
  }

  hasChanges(): boolean {
    for (const tracked of this.#files.values()) {
      if (tracked.firstOld !== tracked.latestNew) return true;
    }
    return false;
  }

  clear(): void {
    this.#files.clear();
  }
}

function versionLine(label: string, version: FileVersion): string {
  return `${label}: hash=${version.contentHash} mtimeMs=${version.mtimeMs} size=${version.size}`;
}

/**
 * Conflict diagnostics diff.
 *
 * When both content samples are available (e.g. a caller retained the base
 * text) this is a real content diff. Otherwise it emits a deterministic
 * version-level unified diff, because `FileVersion` itself does not carry the
 * base content bytes.
 */
export function buildVersionConflictDiff(params: {
  path: string;
  baseVersion: FileVersion | undefined;
  currentVersion?: FileVersion | undefined;
  baseText?: string;
  currentText?: string;
}): string {
  const displayPath = normalizedPath(params.path);
  if (params.baseText !== undefined && params.currentText !== undefined) {
    const baseText = params.baseText ?? "";
    const currentText = params.currentText ?? "";
    const base = normalizeTurnText(baseText).text;
    const current = normalizeTurnText(currentText).text;
    if (base !== current) {
      return generateUnifiedPatch(
        displayPath,
        base,
        current,
        3,
        statusFor(params.baseText, params.currentText),
      );
    }
  }

  const base = params.baseVersion
    ? versionLine("baseVersion", params.baseVersion)
    : "baseVersion: null";
  const current = params.currentVersion
    ? versionLine("currentVersion", params.currentVersion)
    : "currentVersion: null";
  return generateUnifiedPatch(
    displayPath,
    `${base}\n`,
    `${current}\n`,
    3,
    "modified",
  );
}
