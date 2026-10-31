import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Delete a trial scratch tree without ever following a reparse point.
 *
 * Grading links the shared dependency store into the authority root as a Windows
 * junction (and a POSIX symlink elsewhere). A recursive delete that resolves those
 * links would wipe the source node_modules, which is how pnpm trees have been
 * destroyed on this machine. So this walk never descends into a symlink or junction,
 * detaches link entries with unlink/rmdir only, and never uses a recursive force
 * delete on a tree that might still contain one.
 */
export function removeScratchTree(root) {
  if (!existsSync(root)) return { removed: false, missing: true, failures: [] };
  const rootStat = lstatSync(root);
  const failures = [];
  if (rootStat.isSymbolicLink()) {
    unlinkSync(root);
    return { removed: true, link: true, failures };
  }
  const prune = (directory) => {
    for (const name of readdirSync(directory)) {
      const child = join(directory, name);
      let stat;
      try {
        stat = lstatSync(child);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        try {
          unlinkSync(child);
        } catch {
          failures.push(child);
        }
        continue;
      }
      if (stat.isDirectory()) {
        prune(child);
        try {
          rmdirSync(child);
        } catch (error) {
          failures.push(child + ': ' + error.code);
        }
        continue;
      }
      try {
        unlinkSync(child);
      } catch {
        try {
          unlinkSync(child);
        } catch (error) {
          failures.push(child + ': ' + error.code);
        }
      }
    }
  };
  prune(root);
  try {
    rmdirSync(root);
  } catch (error) {
    failures.push(root + ': ' + error.code);
  }
  return { removed: !existsSync(root), failures };
}
