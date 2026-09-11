/**
 * VS-P3-01 baseline reader: one target's pre-batch identity and body.
 *
 * Split out of the adapter because paging is a self-contained concern — plan the
 * windows, rejoin them, prove the result — with a single dependency on "some way
 * to make a read-only request". Keeping it here also keeps `patch-preview.ts`
 * under the 500-line ceiling enforced by `check:loc`.
 *
 * Every shape here is the one the pinned runtime was measured to return, not one
 * inferred from the caller's side: `lines` is an array of `{line, text}` records
 * with terminators stripped, `total_lines` counts content lines, `content_hash`
 * digests the whole file on every window, and `truncated` is the runtime saying
 * it clipped the range it was asked for.
 */
import type { JsonObject, Observation } from "../../../../shared/verseshell/types.js";
import {
  MAX_BASELINE_BYTES,
  MAX_BASELINE_LINES,
  normalizeContentHash,
  observationData,
  planBaselinePages,
  readInteger,
  readString,
  reconstructBaseline,
  type PatchPreviewBaselineReason,
} from "./patch-preview-contract.js";

/** The adapter's single gated request path, passed in rather than imported. */
export type PatchPreviewRequest = (
  op: string,
  args: JsonObject,
  signal?: AbortSignal,
) => Promise<Observation>;

export type Baseline = {
  exists: boolean;
  hash: string | null;
  text?: string;
  truncated: boolean;
  /** Set together with `truncated`, so the refusal says which bound it hit. */
  reason?: PatchPreviewBaselineReason;
};

/** One ranged-read window, as the runtime actually reports it. */
type BaselineWindow = {
  /** Line bodies in order, terminators already stripped by the runtime. */
  texts?: string[];
  /** Content lines in the whole file; the same value on every window. */
  totalLines?: number;
  /** Digest of the whole file at the moment this window was served. */
  contentHash: string | null;
  /** The runtime clipped the range it was asked for. */
  clipped: boolean;
};

/**
 * Decode `lines: [{ line, text }]`.
 *
 * A window that is not exactly that shape yields no texts at all. It must not
 * degrade into an empty string: that would be indistinguishable from a genuinely
 * empty file and would hand the diff builder a baseline nobody read.
 */
function decodeWindowLines(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const texts: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string") return undefined;
    texts.push(text);
  }
  return texts;
}

function windowBytes(texts: readonly string[]): number {
  let bytes = 0;
  for (const text of texts) bytes += text.length;
  return bytes;
}

/** One ranged-read window. A failed read, or a malformed one, yields no texts. */
async function readRange(
  request: PatchPreviewRequest,
  target: string,
  startLine: number,
  endLine: number,
  signal?: AbortSignal,
): Promise<BaselineWindow> {
  const ranged = await request(
    "file.read_range",
    { path: target, start_line: startLine, end_line: endLine },
    signal,
  );
  if (!ranged.ok) return { contentHash: null, clipped: true };
  const data = observationData(ranged);
  const texts = decodeWindowLines(data.lines);
  const totalLines = readInteger(data, "total_lines");
  return {
    ...(texts === undefined ? {} : { texts }),
    ...(totalLines === undefined ? {} : { totalLines }),
    contentHash: normalizeContentHash(readString(data, "content_hash", "hash")),
    // An over-cap request is not an error: the runtime quietly serves a prefix
    // and sets this flag, so ignoring it is how a prefix becomes a whole file.
    clipped: data.truncated === true,
  };
}

/**
 * Read the whole baseline, paging when it does not fit one ranged-read window.
 *
 * Both the single-window and the paged path end the same way: the line records
 * are rebuilt into candidate bytes and accepted only when they hash to the
 * target's own digest. A single read is an atomic observation but still not a
 * self-describing one — `lines` cannot say whether the file ended in a newline —
 * so proving it costs little and removes the last place a guess could enter.
 */
async function readBaselineBody(
  request: PatchPreviewRequest,
  target: string,
  hash: string | null,
  signal?: AbortSignal,
): Promise<Baseline> {
  const refuse = (reason: PatchPreviewBaselineReason = "unreadable"): Baseline => ({
    exists: true,
    hash,
    truncated: true,
    reason,
  });

  const first = await readRange(request, target, 1, MAX_BASELINE_LINES, signal);
  if (first.texts === undefined || first.clipped) return refuse();
  // Every window carries the whole file's digest. Disagreeing with `file.hash`
  // means the target moved between those two reads: a race, not a bad read.
  if (first.contentHash !== null && hash !== null && first.contentHash !== hash) {
    return refuse("torn-stitch");
  }
  let bytes = windowBytes(first.texts);
  if (bytes > MAX_BASELINE_BYTES) return refuse("over-cap");

  const totalLines = first.totalLines;
  if (totalLines === undefined || totalLines <= MAX_BASELINE_LINES) {
    const text = reconstructBaseline(first.texts, hash);
    return text === null ? refuse() : { exists: true, hash, text, truncated: false };
  }

  const pages = planBaselinePages(totalLines);
  if (!pages) return refuse("over-cap");

  const texts = [...first.texts];
  for (const page of pages.slice(1)) {
    if (signal?.aborted) throw new Error("VerseShell patch preview aborted");
    const next = await readRange(request, target, page.start, page.end, signal);
    if (next.texts === undefined || next.clipped) return refuse();
    // A window served after a write carries a different whole-file digest, so a
    // tear is caught at the window that caused it rather than pages later.
    if (next.contentHash !== first.contentHash) return refuse("torn-stitch");
    bytes += windowBytes(next.texts);
    if (bytes > MAX_BASELINE_BYTES) return refuse("over-cap");
    texts.push(...next.texts);
  }

  const text = reconstructBaseline(texts, hash);
  return text === null ? refuse("torn-stitch") : { exists: true, hash, text, truncated: false };
}

/**
 * Optimistic-concurrency read: hash first, then the bounded baseline body.
 *
 * `file.hash` failing with `E_NOT_FOUND` is the only failure that may be read as
 * "the target does not exist"; every other code is raised, so a policy refusal
 * or an out-of-workspace path can never be smoothed into a file addition.
 */
export async function readBaseline(params: {
  request: PatchPreviewRequest;
  target: string;
  needText: boolean;
  signal?: AbortSignal;
}): Promise<Baseline> {
  const { request, target, needText, signal } = params;
  const hashed = await request("file.hash", { path: target }, signal);
  if (!hashed.ok) {
    if (hashed.error?.code === "E_NOT_FOUND") {
      return { exists: false, hash: null, truncated: false };
    }
    throw new Error(
      `VerseShell file.hash failed for ${target}: ${hashed.error?.code ?? "unknown"}`,
    );
  }
  const hash = normalizeContentHash(readString(observationData(hashed), "content_hash", "hash"));
  if (!needText) return { exists: true, hash, truncated: false };
  return readBaselineBody(request, target, hash, signal);
}
