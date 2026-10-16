/**
 * TF-0115 / TF-0119: one place that decides whether a path may be read or written
 * by an evidence sink.
 *
 * Why this module exists rather than a check at each call site: the same omission
 * was found **three times** by auditing, each time because a caller-supplied path
 * was joined without containment and `path.join` resolves `..`:
 *
 *   - `vb_screenshot { fileName }`  — escaped to the repo root, then the drive root
 *   - `vb_pr_comment { packDir }`   — read an out-of-workspace manifest and echoed it
 *   - `vb_diagnose { dir }`         — read a planted timeline and wrote a pack outside
 *
 * The remaining `dirName` sinks were safe only because they happened to pass
 * through `sanitize()` — no containment assert. Adding a fourth copy of the check
 * would leave the fifth sink to be discovered the same way. Every sink now goes
 * through these helpers, so the invariant belongs to the *write/read point* and a
 * new sink cannot silently lack it.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class EvidencePathError extends Error {
  readonly code = 'E_EVIDENCE_PATH';
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePathError';
  }
}

/** True when `candidate` resolves to `root` itself or somewhere beneath it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Resolve existing ancestors too: a new file can sit beneath a directory link. */
function physicalPath(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new EvidencePathError('refusing to use a dangling path link');
      }
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/** Throw unless `candidate` is inside `root`. */
export function assertInsideRoot(root: string, candidate: string, what = 'path'): string {
  const target = resolve(candidate);
  if (!isInsideRoot(root, target) || !isInsideRoot(physicalPath(root), physicalPath(target))) {
    throw new EvidencePathError(
      `refusing to use ${what} outside the evidence root (${target} is not under ${resolve(root)})`,
    );
  }
  return target;
}

/**
 * Sanitise a caller-supplied single path segment (directory or file name).
 * Strips separators and collapses dot runs, using the historical workspace naming rule;
 * `assertInsideRoot` then guards against a future change to this rule.
 */
export function sanitizeSegment(value: string, fallback = 'session'): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '__').slice(0, 64);
  return !safe || safe === '.' || safe === '__' ? fallback : safe;
}
