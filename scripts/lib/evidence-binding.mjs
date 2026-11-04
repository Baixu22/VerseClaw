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
  // Preserve path bytes and propagate Git failures: unavailable is not clean.
  const out = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (!out) return { judged: [], unrelated: [] };
  const bound = new Set((boundPaths ?? []).map((path) => String(path).replaceAll('\\', '/')));
  const judged = [];
  const unrelated = [];
  const fields = out.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    // A rename changes both paths, including a judged input moved out of scope.
    const status = field.slice(0, 2);
    const path = field.slice(3).replaceAll('\\', '/');
    if (!path) continue;
    const paths = [path];
    if (status.includes('R') || status.includes('C')) paths.push(fields[++index]?.replaceAll('\\', '/'));
    for (const changed of paths) {
      if (!changed) throw new Error('invalid-git-status');
      if (bound.has(changed)) judged.push(changed);
      else unrelated.push(changed);
    }
  }
  return { judged, unrelated };
}
