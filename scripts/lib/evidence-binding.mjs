/**
 * Evidence binding: which repository paths may invalidate a sealed evidence pack.
 *
 * A pack is bound to the inputs it was judged against — the criteria, the
 * corpus and the implementation that produced the numbers. It is deliberately
 * NOT bound to "no other commit may exist after the seal": documentation,
 * unrelated product code and neighbouring evidence packs change all the time,
 * and treating that as tampering turned every seal into a reseal obligation
 * (the TF-0592 / TF-0590 reseal treadmill).
 *
 * Bound-input digests already guarantee the judged inputs are byte-identical to
 * what was sealed. This helper answers the narrower question the commit range
 * can still answer: did any *bound* path move between the candidate commit and
 * the current head?
 */
import { execFileSync } from 'node:child_process';

/**
 * @param {string} root repository root
 * @param {string} fromCommit commit the evidence was sealed against
 * @param {string} [toRef] comparison ref, defaults to HEAD
 * @param {string[]} [paths] bound inputs; empty means "every path"
 * @returns {string[]} changed paths (repository-relative, posix separators)
 */
export function changedPathsBetween(root, fromCommit, toRef = 'HEAD', paths = []) {
  const args = ['diff', '--name-only', fromCommit, toRef];
  if (Array.isArray(paths) && paths.length > 0) args.push('--', ...paths);
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  return out ? out.split(/\r?\n/u).filter(Boolean) : [];
}
/**
 * Split the working-tree status into paths that are judged inputs of a pack and
 * paths that are unrelated. Only the former may invalidate a seal: an unrelated
 * in-flight edit (another agent's work, a docs change) must stay a warning,
 * otherwise every seal depends on the whole shared checkout being clean.
 *
 * @param {string} root repository root
 * @param {string[]} boundPaths judged inputs plus the pack's own files
 * @returns {{judged: string[], unrelated: string[]}}
 */
export function splitDirtyPaths(root, boundPaths) {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return { judged: [], unrelated: [] };
  }
  if (!out) return { judged: [], unrelated: [] };
  const bound = new Set((boundPaths ?? []).map((path) => String(path).replaceAll('\\', '/')));
  const judged = [];
  const unrelated = [];
  for (const line of out.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let path = line.slice(3).trim();
    const renamed = path.split(' -> ');
    if (renamed.length === 2) path = renamed[1];
    path = path.replace(/^"|"$/gu, '').replaceAll('\\', '/');
    if (bound.has(path)) judged.push(path);
    else unrelated.push(path);
  }
  return { judged, unrelated };
}
