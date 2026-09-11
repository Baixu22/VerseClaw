/**
 * Binds a read-only patch preview to the one ClawX write journal that may commit.
 *
 * This module is deliberately free of VerseShell imports: the preview producer
 * lives behind the VerseShell facade, but the *authority* that recomputes and
 * enforces the binding is the generic apply_patch path. Keeping the algorithm
 * here means both sides agree by construction instead of by convention.
 */
import { createHash } from "node:crypto";

const MAX_STORED_PREVIEWS = 32;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

/** Accepts `sha256:<hex>` or a bare `<hex>` digest and returns the canonical form. */
export function normalizeContentHash(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const hex = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  return SHA256_HEX.test(hex) ? `sha256:${hex}` : null;
}

/**
 * The preview reader reports workspace-relative POSIX paths; the write path uses
 * `path.relative`, which is backslash-separated on Windows. Normalizing here is
 * what keeps the two digests comparable on every platform.
 */
export function canonicalPreviewPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export type ChangeSummaryChange = "add" | "update" | "delete";

export type ChangeSummaryEntry = {
  path: string;
  change: ChangeSummaryChange;
  /** sha256 of the target's encoded bytes before the patch; null when absent. */
  baseHash: string | null;
  /** sha256 of the utf8 post-image text; null for a delete. */
  postHash: string | null;
  movePath?: string;
};

/**
 * Length-prefixed fields make the canonical form self-delimiting, so no path or
 * digest value can be arranged to collide with a different change set.
 */
function canonicalField(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Binds a preview to the exact pre/post identity of every target. The write
 * journal recomputes this immediately before it mutates; any drift means the
 * preview is stale and the commit is refused rather than reconciled.
 */
export function buildChangeSummaryDigest(entries: readonly ChangeSummaryEntry[]): string {
  const canonical = entries
    .map((entry) =>
      [
        canonicalPreviewPath(entry.path),
        entry.change,
        normalizeContentHash(entry.baseHash) ?? "-",
        normalizeContentHash(entry.postHash) ?? "-",
        entry.movePath ? canonicalPreviewPath(entry.movePath) : "-",
      ]
        .map(canonicalField)
        .join(""),
    )
    .toSorted()
    .join("");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function contentDigest(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value as never).digest("hex")}`;
}

/**
 * Narrow, structural description of one prepared change. Deliberately not the
 * write path's own hunk type: keeping this module free of `apply-patch-preflight`
 * imports is what prevents an import cycle between the gate and its caller.
 */
export type PreviewEntrySource = {
  change: ChangeSummaryChange;
  path: string;
  movePath?: string;
  /** Encoded bytes of the target before the patch; undefined when it did not exist. */
  baseEncoded?: Buffer | string;
  /** Decoded post-image text; undefined for a delete. */
  postText?: string;
};

/**
 * Pre/post identity derived from what the write path itself read and computed —
 * never from the caller. `baseHash` covers the encoded bytes (so any encoding
 * round trips) and `postHash` covers the decoded post-image text (so it is
 * comparable with a preview reader that only ever saw text).
 */
export function buildPreviewEntries(
  sources: readonly PreviewEntrySource[],
): ChangeSummaryEntry[] {
  return sources.map((source) => ({
    path: source.path,
    change: source.change,
    baseHash: source.baseEncoded === undefined ? null : contentDigest(source.baseEncoded),
    postHash: source.postText === undefined ? null : contentDigest(source.postText),
    ...(source.movePath ? { movePath: source.movePath } : {}),
  }));
}

export type PatchPreviewRecord = {
  previewId: string;
  changeSummaryDigest: string;
  workspaceId: string;
  revision: string;
  policyProfile: string;
  policyDigest: string;
  /** True only when every target carried a complete, conflict-free identity. */
  commitEligible: boolean;
  paths: readonly string[];
  /**
   * Handles of the diff artifacts this preview produced, host-side only.
   *
   * They exist so a later audit record can tie one approval id and one change
   * summary digest to the diffs a reviewer would actually have looked at. Like
   * every other field here they are read back from this record, never accepted
   * from the caller — a caller-supplied artifact ref would let the commit cite a
   * diff nobody rendered.
   */
  diffArtifacts?: readonly string[];
  createdAtMs: number;
};

/** Bounds for the artifact handles the runtime reports; they are foreign input. */
const MAX_DIFF_ARTIFACTS = 64;
const MAX_DIFF_ARTIFACT_CHARS = 256;

/**
 * Keep only well-formed handles, deduplicated and ordered, so the stored set is
 * deterministic and cannot be padded into an unbounded field.
 */
export function normalizeDiffArtifacts(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_DIFF_ARTIFACT_CHARS || trimmed.includes("\0")) continue;
    seen.add(trimmed);
    if (seen.size >= MAX_DIFF_ARTIFACTS) break;
  }
  return [...seen].toSorted();
}

/** Refused commits, separated so callers can tell "never previewed" from "moved". */
export class UnknownPatchPreviewError extends Error {
  readonly previewId: string;

  constructor(previewId: string) {
    super(
      `Unknown or expired patch preview ${previewId}; take a fresh preview_patch before committing`,
    );
    this.name = "UnknownPatchPreviewError";
    this.previewId = previewId;
  }
}

export class StalePatchPreviewError extends Error {
  readonly previewId: string;
  readonly expectedDigest: string;
  readonly actualDigest: string;

  constructor(params: { previewId: string; expected: string; actual: string; reason: string }) {
    super(
      `Patch preview ${params.previewId} is stale (${params.reason}); nothing was written. ` +
        `expected ${params.expected}, recomputed ${params.actual}`,
    );
    this.name = "StalePatchPreviewError";
    this.previewId = params.previewId;
    this.expectedDigest = params.expected;
    this.actualDigest = params.actual;
  }
}

/**
 * Bounded, process-local and insertion-ordered. The model never supplies a
 * digest — only an opaque preview id — so a caller cannot forge an expectation
 * that its own patch is guaranteed to satisfy.
 */
const previews = new Map<string, PatchPreviewRecord>();

export function registerPatchPreview(record: PatchPreviewRecord): void {
  previews.delete(record.previewId);
  while (previews.size >= MAX_STORED_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (typeof oldest !== "string") break;
    previews.delete(oldest);
  }
  previews.set(record.previewId, record);
}

export function lookupPatchPreview(previewId: string): PatchPreviewRecord | undefined {
  return previews.get(previewId.trim());
}

export function __resetPatchPreviewStore(): void {
  previews.clear();
}

export type VerifiedPatchPreview = {
  previewId: string;
  changeSummaryDigest: string;
  /** AC-3's association: the diffs this approval and change summary stand for. */
  diffArtifacts?: readonly string[];
};

/**
 * The gate the write journal calls immediately before the first mutation.
 *
 * It throws — it never repairs. A stale preview means the workspace or the patch
 * moved after the preview was taken, and silently committing the newer intent is
 * exactly the class of defect the preview exists to prevent.
 */
export function verifyPatchPreviewBinding(params: {
  previewId: string;
  entries: readonly ChangeSummaryEntry[];
}): VerifiedPatchPreview {
  const previewId = params.previewId.trim();
  const record = lookupPatchPreview(previewId);
  if (!record) throw new UnknownPatchPreviewError(previewId);
  const actual = buildChangeSummaryDigest(params.entries);
  if (!record.commitEligible) {
    throw new StalePatchPreviewError({
      previewId,
      expected: record.changeSummaryDigest,
      actual,
      reason: "the preview reported a conflict or an unreadable baseline",
    });
  }
  if (record.changeSummaryDigest !== actual) {
    throw new StalePatchPreviewError({
      previewId,
      expected: record.changeSummaryDigest,
      actual,
      reason: "the target baselines or the patch result changed after the preview",
    });
  }
  return {
    previewId,
    changeSummaryDigest: record.changeSummaryDigest,
    // Read back from the stored record, so the commit can only cite diffs the
    // host-side preview actually produced.
    ...(record.diffArtifacts?.length ? { diffArtifacts: record.diffArtifacts } : {}),
  };
}
