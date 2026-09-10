/**
 * S2: make an apply_patch call legible to the person watching it.
 *
 * Before this, `apply_patch`'s display spec carried `detailKeys: []`, so a human
 * saw "🩹 Apply Patch" and nothing else — no files, no counts, no sign that a
 * preview gate was involved. The information was always in the arguments; nothing
 * read it.
 *
 * Two deliberate limits:
 *
 * - This reads the **patch's declared targets**, which is intent, not outcome. It
 *   is rendered with the same A/M/D letters `formatCommittedSummary` uses in the
 *   tool's own result text, so the two read as the same vocabulary and a reader
 *   can compare intent against result rather than mistake one for the other.
 * - It scans envelope headers instead of calling the real parser. A display path
 *   must not throw on a malformed patch and must not do parser-scale work on a
 *   512 KiB argument, so this is a bounded line scan with no validation.
 */
import { asRecord } from "./tool-display-record.js";

const ADD_MARKER = "*** Add File: ";
const DELETE_MARKER = "*** Delete File: ";
const UPDATE_MARKER = "*** Update File: ";
const MOVE_MARKER = "*** Move to: ";

/** Same ceiling the preview bridge uses for one batch, so the scan cannot outrun it. */
const MAX_SCANNED_TARGETS = 64;
/** How many paths reach the one-line display before it collapses to a count. */
const MAX_SHOWN_TARGETS = 4;
/** Envelope headers live at column 0; no real patch needs more lines than this scanned. */
const MAX_SCANNED_LINES = 20_000;

type PatchTarget = { letter: "A" | "M" | "D"; path: string };

/**
 * Collect declared targets in patch order.
 *
 * A `*** Move to:` line rewrites the path of the update it follows rather than
 * adding a target, which is why it is applied to the last entry instead of
 * pushing a new one — a rename would otherwise show as two files.
 */
export function scanPatchTargets(patch: string): { targets: PatchTarget[]; truncated: boolean } {
  const targets: PatchTarget[] = [];
  let truncated = false;
  let scanned = 0;
  for (const line of patch.split("\n")) {
    if (++scanned > MAX_SCANNED_LINES) {
      truncated = true;
      break;
    }
    if (!line.startsWith("***")) continue;
    if (line.startsWith(MOVE_MARKER)) {
      const moved = line.slice(MOVE_MARKER.length).trim();
      const last = targets.at(-1);
      if (moved && last?.letter === "M") last.path = moved;
      continue;
    }
    const entry = targetForHeader(line);
    if (!entry) continue;
    if (targets.length >= MAX_SCANNED_TARGETS) {
      truncated = true;
      break;
    }
    targets.push(entry);
  }
  return { targets, truncated };
}

function targetForHeader(line: string): PatchTarget | null {
  if (line.startsWith(ADD_MARKER)) {
    const path = line.slice(ADD_MARKER.length).trim();
    return path ? { letter: "A", path } : null;
  }
  if (line.startsWith(UPDATE_MARKER)) {
    const path = line.slice(UPDATE_MARKER.length).trim();
    return path ? { letter: "M", path } : null;
  }
  if (line.startsWith(DELETE_MARKER)) {
    const path = line.slice(DELETE_MARKER.length).trim();
    return path ? { letter: "D", path } : null;
  }
  return null;
}

/**
 * One-line detail for an apply_patch call, or undefined when the arguments carry
 * no readable patch — in which case the caller falls back to its existing
 * behavior rather than showing a misleading empty summary.
 */
export function resolveApplyPatchDetail(args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) return undefined;
  const patch = typeof record.input === "string" ? record.input : undefined;
  if (!patch) return undefined;

  const { targets, truncated } = scanPatchTargets(patch);
  if (targets.length === 0) return undefined;

  const shown = targets
    .slice(0, MAX_SHOWN_TARGETS)
    .map((target) => `${target.letter} ${target.path}`)
    .join(", ");
  const hidden = targets.length - Math.min(targets.length, MAX_SHOWN_TARGETS);
  const parts = [shown];
  if (hidden > 0 || truncated) parts.push(`+${hidden}${truncated ? "+" : ""} more`);
  // A previewId is the only visible sign that this write passed a verified
  // preview gate rather than going straight to the journal. Worth one word.
  if (typeof record.preview_id === "string" && record.preview_id.trim()) {
    parts.push("previewed");
  }
  return parts.join(" · ");
}
