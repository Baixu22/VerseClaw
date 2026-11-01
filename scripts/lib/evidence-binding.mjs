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