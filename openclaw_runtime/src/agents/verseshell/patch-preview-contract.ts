/**
 * VS-P3-01 preview contract: bounds, types and the deny gate.
 *
 * Kept separate from the adapter so the "no second write authority" boundary is
 * a small, independently readable unit — and so `patch-preview.ts` stays under
 * the 500-line ceiling enforced by `check:loc`.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { ToolInputError } from "../tools/common.js";
import { generateUnifiedPatch } from "../sessions/tools/edit-diff.js";
import type { ApplyPatchSummary } from "../apply-patch-types.js";
import type { Observation } from "../../../../shared/verseshell/types.js";
import {
  VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS,
  VERSESHELL_PATCH_PREVIEW_OPERATIONS,
  VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
} from "./policy-profile.js";

export const PREVIEW_PATCH_TOOL_NAME = "preview_patch";

/** VerseShell's own read cap for a single ranged read. */
export const MAX_BASELINE_LINES = 500;
/**
 * A baseline larger than one window has to be paged, and the page count is
 * bounded so a preview can never become an unbounded read loop against a
 * multi-million-line file. Together these give a hard ceiling of
 * `MAX_BASELINE_LINES * MAX_BASELINE_PAGES` lines.
 */
export const MAX_BASELINE_PAGES = 40;
/** Second, independent ceiling: long lines can blow the byte budget well inside the page budget. */
export const MAX_BASELINE_BYTES = 4 * 1024 * 1024;
export const MAX_PATCH_BYTES = 512 * 1024;
export const MAX_PREVIEW_PATHS = 64;
const MAX_DIFF_CHARS = 64 * 1024;

const PREVIEW_OPS = new Set(VERSESHELL_PATCH_PREVIEW_OPERATIONS);
const DENIED_OPS = new Set(VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS);

/**
 * Mechanical form of the "no second journal" boundary: an operation is usable by
 * the bridge only when the reviewed profile lists it and the denied set does not.
 */
export function isPatchPreviewOperationAllowed(op: string): boolean {
  return PREVIEW_OPS.has(op) && !DENIED_OPS.has(op);
}

export type PatchPreviewChange = "add" | "update" | "delete";

/**
 * Why a baseline could not be used, recorded so a refusal is diagnosable instead
 * of collapsing three different causes into one boolean.
 */
export type PatchPreviewBaselineReason =
  /** The file needs more windows than {@link MAX_BASELINE_PAGES}, or more bytes than {@link MAX_BASELINE_BYTES}. */
  | "over-cap"
  /** A ranged read failed or carried no text field. */
  | "unreadable"
  /** The paged windows did not rejoin to the file's own digest: a bad stitch, or a write landed mid-read. */
  | "torn-stitch";

/** One optimistic-concurrency token per target, read before anything mutates. */
export type PatchPreviewPrecondition = {
  path: string;
  change: PatchPreviewChange;
  exists: boolean;
  /** sha256 from file.hash, or null when the target does not exist yet. */
  baseHash: string | null;
  /** True when the baseline could not be read in full, so no diff is claimed. */
  baselineTruncated: boolean;
  /** Present only alongside `baselineTruncated`. */
  baselineReason?: PatchPreviewBaselineReason;
  movePath?: string;
  conflict?: "add-over-existing" | "missing-target" | "baseline-unreadable";
};

export type PatchPreviewDiff = {
  path: string;
  /**
   * Unified diff, rendered host-side from the hash-proven baseline and the exact
   * post-image the commit gate binds — so it is what ClawX intends to write, and
   * it is bounded by {@link MAX_DIFF_CHARS} rather than the runtime's much
   * tighter cap on its own rendering. Empty only when there is nothing to show.
   */
  unified: string;
  /** True when this render hit the host cap. Never reports the runtime's cap. */
  truncated: boolean;
  /** result:// handle if the runtime ever archives a rendering of its own. */
  artifact?: string;
};

export type PatchPreview = {
  previewId: string;
  workspaceId: string;
  revision: string;
  policyProfile: typeof VERSESHELL_PATCH_PREVIEW_PROFILE_ID;
  policyDigest: string;
  summary: ApplyPatchSummary;
  preconditions: PatchPreviewPrecondition[];
  diffs: PatchPreviewDiff[];
  /**
   * Binds the diff artifacts to a later approval and commit. The ClawX write
   * journal recomputes it before mutating; a mismatch is a stale preview.
   */
  changeSummaryDigest: string;
  /** True only when every target produced a complete, conflict-free identity. */
  commitEligible: boolean;
  /** The bridge never commits. Recorded so callers cannot mistake it for one. */
  commitAuthority: "clawx-write-journal";
  verseShellTransaction: "denied";
  deniedOperations: readonly string[];
};

/** Thrown when the bridge is asked for an operation outside its read-only profile. */
export class PatchPreviewOperationDeniedError extends Error {
  readonly op: string;

  constructor(op: string) {
    super(
      DENIED_OPS.has(op)
        ? `VerseShell operation ${op} is a competing write authority and is denied by ${VERSESHELL_PATCH_PREVIEW_PROFILE_ID}`
        : `VerseShell operation ${op} is outside ${VERSESHELL_PATCH_PREVIEW_PROFILE_ID}`,
    );
    this.name = "PatchPreviewOperationDeniedError";
    this.op = op;
  }
}

export function canonicalWorkspace(cwd: string): string {
  const value = cwd.trim();
  if (!value || value.includes("\0")) throw new ToolInputError("workspace is invalid");
  return path.resolve(value);
}

export function workspaceIdentity(cwd: string): string {
  const workspace = canonicalWorkspace(cwd);
  const identity = process.platform === "win32" ? workspace.toLowerCase() : workspace;
  return `ws_sha256_${createHash("sha256").update(identity).digest("hex")}`;
}

export function observationData(observation: Observation): Record<string, unknown> {
  const data = observation.data as Record<string, unknown> | undefined;
  return data && typeof data === "object" ? data : {};
}

export function readString(
  data: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function readInteger(
  data: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (Number.isSafeInteger(value)) return value as number;
  }
  return undefined;
}

/**
 * Like {@link readString} but keeps an empty value.
 *
 * A ranged-read window can legitimately be empty — the last window of a file
 * that ends in a newline is a single empty line — so "field absent" and "field
 * empty" must not collapse into one answer here.
 */
export function readTextField(
  data: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export type BaselinePage = { start: number; end: number };

/**
 * Split a `total_lines` baseline into ranged-read windows, or refuse outright.
 *
 * Returns null when the file would need more windows than
 * {@link MAX_BASELINE_PAGES}. The caller then reports `baselineTruncated`
 * instead of reading a prefix — the same fail-closed answer the single-window
 * implementation gave for anything over one window.
 */
export function planBaselinePages(totalLines: number): BaselinePage[] | null {
  if (!Number.isSafeInteger(totalLines) || totalLines <= 0) return null;
  if (totalLines > MAX_BASELINE_LINES * MAX_BASELINE_PAGES) return null;
  const pages: BaselinePage[] = [];
  for (let start = 1; start <= totalLines; start += MAX_BASELINE_LINES) {
    pages.push({ start, end: Math.min(start + MAX_BASELINE_LINES - 1, totalLines) });
  }
  return pages;
}

/**
 * Rejoin ranged-read windows into the whole file, or refuse.
 *
 * `file.read_range` reports each line's body with its terminator stripped, so
 * the records alone do not determine the file's bytes: a file ending in a
 * newline and one that does not come back identical, and a CRLF file comes back
 * with its carriage returns gone. Guessing a spelling would produce a baseline
 * that never existed on disk — the exact failure the boundary rule forbids.
 *
 * So nothing is guessed. Each candidate spelling is hashed against the digest
 * the runtime reports for that target, and only an exact match is used. Four
 * hashes, no search, and a hit is byte-identical to disk rather than probable.
 * Anything else — mixed endings, a torn stitch, a write landing mid-read — finds
 * no match and is refused.
 */
export function reconstructBaseline(
  texts: readonly string[],
  hash: string | null,
): string | null {
  if (hash === null) return null;
  if (texts.length === 0) return contentHash("") === hash ? "" : null;
  for (const newline of BASELINE_NEWLINES) {
    const joined = texts.join(newline);
    for (const candidate of [joined, `${joined}${newline}`]) {
      if (contentHash(candidate) === hash) return candidate;
    }
  }
  return null;
}

/** The line terminators a ranged read can have stripped. */
const BASELINE_NEWLINES = ["\n", "\r\n"] as const;

export function contentHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function boundedDiff(text: string): { unified: string; truncated: boolean } {
  if (text.length <= MAX_DIFF_CHARS) return { unified: text, truncated: false };
  return { unified: text.slice(0, MAX_DIFF_CHARS), truncated: true };
}

/**
 * Render a diff host-side, from the baseline and post-image the preview already
 * proved. This is what the runtime's `file.diff` does too, but under a cap about
 * three orders of magnitude tighter; the same generator the write journal uses
 * for full-file writes handles both additions and updates. A diff an agent cannot
 * read in full is not compensation for a preview, so being able to render the
 * whole change matters more than who renders it — which is why the source is
 * recorded rather than implied.
 */
export function renderLocalDiff(params: {
  path: string;
  existed: boolean;
  baseline: string;
  postImage: string;
}): PatchPreviewDiff {
  const unified = generateUnifiedPatch(
    params.path,
    params.existed ? params.baseline : "",
    params.postImage,
    4,
    params.existed ? "modified" : "added",
  );
  const bounded = boundedDiff(unified);
  return { path: params.path, unified: bounded.unified, truncated: bounded.truncated };
}

/**
 * The degenerate render for a pure addition, kept for callers that only have the
 * contents. All-added blocks are exact rather than approximate, and no diff
 * algorithm is reimplemented here.
 */
export function renderAddedDiff(target: string, contents: string): PatchPreviewDiff {
  const lines = contents.length === 0 ? [] : contents.replace(/\n$/u, "").split("\n");
  const body = [
    "--- /dev/null",
    `+++ b/${target}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
  const bounded = boundedDiff(body);
  return { path: target, unified: bounded.unified, truncated: bounded.truncated };
}

export function boundedPatch(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError("patch is required");
  }
  if (value.length > MAX_PATCH_BYTES) {
    throw new ToolInputError("patch exceeds the bounded preview contract");
  }
  return value;
}

export function boundedRevision(value: string | undefined): string {
  const revision = (value ?? "untracked").trim();
  if (!revision || revision.length > 256 || revision.includes("\0")) {
    throw new ToolInputError("revision exceeds the bounded preview contract");
  }
  return revision;
}

/**
 * The change-summary digest, the preview store and the commit gate live in
 * `apply-patch-preview-binding.ts` so the write journal can enforce them without
 * importing anything VerseShell-specific. Re-exported here to keep one entry
 * point for preview consumers.
 */
export {
  buildChangeSummaryDigest,
  canonicalPreviewPath,
  lookupPatchPreview,
  normalizeContentHash,
  normalizeDiffArtifacts,
  registerPatchPreview,
  __resetPatchPreviewStore,
  type ChangeSummaryEntry,
  type PatchPreviewRecord,
} from "../apply-patch-preview-binding.js";
