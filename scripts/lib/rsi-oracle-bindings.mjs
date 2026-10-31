import { execFileSync } from 'node:child_process';

/** Resolve the blob id of a path at a revision, or null when the path is absent. */
export function gitBlob(root, revision, path) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${revision}:${path}`], { cwd: root, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Split a task's oracle test paths into the ones that carry hidden signal and the ones that do not.
 *
 * A path the reference revision introduces, or rewrites relative to the base revision, is the
 * hidden signal the task is graded on. A path that already exists byte-identically at the base
 * revision is a sealed regression guard: it legitimately pre-exists in the repository, so it must
 * be scrubbed from the agent snapshot and restored by the grader instead of invalidating the task.
 * Treating every pre-existing oracle path as a task defect would discard most of a frozen corpus
 * whose regression guards predate the acceptance records that sealed them.
 */
export function classifyOracleBindings(root, testPaths, baseCommit, referenceCommit) {
  if (!Array.isArray(testPaths) || testPaths.length === 0) throw new Error('oracle test paths are required');
  if (typeof baseCommit !== 'string' || typeof referenceCommit !== 'string' || !baseCommit || !referenceCommit) {
    throw new Error('base and reference revisions are required to classify oracle bindings');
  }
  const hiddenSignalPaths = [];
  const preexistingGuardPaths = [];
  for (const path of testPaths) {
    const atReference = gitBlob(root, referenceCommit, path);
    if (!atReference) throw new Error(`oracle test missing at reference revision: ${path}`);
    const atBase = gitBlob(root, baseCommit, path);
    if (atBase && atBase === atReference) preexistingGuardPaths.push(path);
    else hiddenSignalPaths.push(path);
  }
  return { hiddenSignalPaths, preexistingGuardPaths };
}
