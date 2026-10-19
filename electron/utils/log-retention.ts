import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Retention and rotation for append-only local logs.
 *
 * Knowledge audit (`knowledge/audit.jsonl`) and watched-directory events
 * (`knowledge/watched-events/<id>.jsonl`) grow without bound: nothing in the
 * product ever trimmed them, so a long-lived installation accumulated an
 * ever-growing record of governance activity that nothing could reclaim.
 *
 * This helper adds bounded growth without touching the data that actually
 * matters:
 *
 *   - **Session transcripts are never touched.** Conversations are the user's
 *     primary asset and their lifecycle is the user's decision, not a policy.
 *   - **Audit/event logs rotate by age and by size.** Rotation renames the
 *     current file to `<name>.<timestamp>.log` and starts a fresh one, so a
 *     reader that tolerates a torn tail line still sees all history.
 *   - **Rotation is bounded.** A caller-supplied `keep` count limits how many
 *     rotated generations are retained, and `maxBytes` / `maxAgeMs` decide when
 *     to rotate at all.
 *
 * A default retention constant is provided so call sites do not each invent
 * their own number; 30 days mirrors the widely used default for local agent
 * transcripts and is long enough to debug a regression.
 */

export const DEFAULT_LOG_RETENTION_DAYS = 30;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_KEEP_GENERATIONS = 3;

export type RotationOptions = {
  /** Rotate when the current file exceeds this size. Default 32 MiB. */
  maxBytes?: number;
  /** Delete rotated generations older than this. Default 30 days. */
  maxAgeMs?: number;
  /** How many rotated generations to keep. Default 3. */
  keep?: number;
  /** Injected clock, for deterministic tests. */
  nowMs?: number;
};

export type RotationResult = {
  rotated: boolean;
  removed: string[];
  reason?: 'size' | 'age' | 'forced';
};

/** Files matching this shape are rotated generations, never live data. */
function isRotatedGeneration(name: string, baseName: string): boolean {
  return name.startsWith(`${baseName}.`) && name.endsWith('.log');
}

/**
 * Rotate `filePath` if it has grown past `maxBytes`, then prune old generations.
 *
 * Safe to call on a path that does not exist: it is a no-op, so callers do not
 * need to guard the first run.
 */
export async function rotateLogIfNeeded(
  filePath: string,
  options: RotationOptions & { force?: boolean } = {},
): Promise<RotationResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = Math.max(0, options.keep ?? DEFAULT_KEEP_GENERATIONS);
  const nowMs = options.nowMs ?? Date.now();
  const baseName = path.basename(filePath);
  const dir = path.dirname(filePath);

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return { rotated: false, removed: [] };

  let rotated = false;
  const tooBig = stat.size >= maxBytes;
  const tooOld = nowMs - stat.mtimeMs >= maxAgeMs;
  if (options.force || tooBig || tooOld) {
    const stamp = new Date(nowMs).toISOString().replaceAll(':', '-');
    const rotatedPath = path.join(dir, `${baseName}.${stamp}.log`);
    // Never clobber an existing generation: two rotations inside the same
    // millisecond would otherwise silently drop one.
    const uniquePath = await fs
      .access(rotatedPath, fsConstants.F_OK)
      .then(() => path.join(dir, `${baseName}.${stamp}-${Math.random().toString(36).slice(2, 8)}.log`))
      .catch(() => rotatedPath);
    await fs.rename(filePath, uniquePath);
    rotated = true;
  }

  const removed: string[] = [];
  const generations = (await fs.readdir(dir).catch(() => [] as string[]))
    .filter((name) => isRotatedGeneration(name, baseName))
    .map((name) => ({ name, full: path.join(dir, name) }));

  generations.sort((a, b) => a.name.localeCompare(b.name));

  // Apply the age limit first, then the generation cap, so a burst of rotations
  // cannot exceed the disk budget even inside a single retention window.
  //
  // Age is derived from the timestamp embedded in the generation's own name
  // rather than its filesystem mtime: a rename preserves the source file's
  // mtime, and using mtime would make retention depend on when the *previous*
  // log was last written rather than when the generation was created. It also
  // keeps pruning consistent when the clock is injected.
  for (const generation of generations) {
    const generationMs = parseGenerationTimestamp(generation.name, baseName);
    if (generationMs === null) continue;
    if (nowMs - generationMs >= maxAgeMs) {
      const ok = await fs.rm(generation.full, { force: true }).then(() => true).catch(() => false);
      if (ok) removed.push(generation.full);
    }
  }

  const survivors = generations
    .filter((generation) => !removed.includes(generation.full))
    .slice(-Math.max(keep, 0));
  const beyondCap = generations.filter((generation) => !removed.includes(generation.full))
    .slice(0, -Math.max(keep, 0));
  for (const generation of beyondCap) {
    const ok = await fs.rm(generation.full, { force: true }).then(() => true).catch(() => false);
    if (ok) removed.push(generation.full);
  }
  void survivors;

  return {
    rotated,
    removed,
    reason: options.force ? 'forced' : tooBig ? 'size' : tooOld ? 'age' : undefined,
  };
}

/**
 * Parse the ISO timestamp embedded in `<base>.<iso-stamped>.log`.
 *
 * The stamp has `:` replaced with `-` for filesystem safety, so the date part
 * (which itself contains `-`) must be stripped from both ends rather than split
 * on `-`. A collision-suffix segment (`-<random>`) is tolerated and ignored.
 */
function parseGenerationTimestamp(name: string, baseName: string): number | null {
  if (!isRotatedGeneration(name, baseName)) return null;
  const middle = name.slice(baseName.length + 1, -'.log'.length);
  // "2026-01-02T03-04-05-678Z" -> "2026-01-02T03:04:05.678Z"
  const isoLike = middle.replace(/^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1$2:$3:$4.$5Z');
  const parsed = Date.parse(isoLike);
  return Number.isFinite(parsed) ? parsed : null;
}
export const testApi = { isRotatedGeneration, parseGenerationTimestamp };