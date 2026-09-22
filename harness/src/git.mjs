import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './specs.mjs';

const execFileAsync = promisify(execFile);

export function resolveDiffBase(explicitSince, configuredDiffBase, defaultBase = 'origin/main') {
  return explicitSince || configuredDiffBase || defaultBase;
}

/**
 * Default comparison base when neither `--since` nor the spec's `diffBase` is set.
 *
 * `origin/main` is the right base for a short-lived branch off the trunk, but this
 * repository develops on one long-lived integration branch: the diff against
 * `origin/main` is the whole branch divergence (thousands of files), so the
 * changed-path ownership gate failed for every task spec and the command was only
 * usable with `--no-diff`. The branch's own upstream is the base that means "what
 * this branch has not pushed yet". `origin/main` stays the fallback for a detached
 * HEAD or a checkout with no upstream, such as CI.
 */
export async function resolveDefaultDiffBase(cwd = ROOT) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { cwd, encoding: 'utf8' },
    );
    const upstream = stdout.trim();
    if (upstream && upstream !== '@{upstream}') return upstream;
  } catch {
    // No upstream configured: detached HEAD, CI checkout, or a purely local branch.
  }
  return 'origin/main';
}

async function gitPaths(args, cwd = ROOT) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.split('\0').filter(Boolean);
}

// A base ref that does not resolve must fail closed. Swallowing the git error
// and returning an empty file list would make every downstream changed-path
// ownership check vacuously pass, which is the failure mode the RC-09
// remediation plan (section 6) forbids.
export async function assertDiffBase(since, cwd = ROOT) {
  const base = typeof since === 'string' ? since.trim() : '';
  if (!base) throw new Error('diff base must be a non-empty ref');
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd, encoding: 'utf8' });
  } catch {
    throw new Error(`invalid or missing diff base ref: ${base}`);
  }
  return base;
}

export async function getChangedFiles(since = 'origin/main', cwd = ROOT) {
  await assertDiffBase(since, cwd);
  const files = new Set();
  for (const file of await gitPaths(['diff', '--name-only', '-z', `${since}...HEAD`], cwd)) files.add(file);
  for (const file of await gitPaths(['diff', '--cached', '--name-only', '-z'], cwd)) files.add(file);
  for (const file of await gitPaths(['diff', '--name-only', '-z'], cwd)) files.add(file);
  for (const file of await gitPaths(['ls-files', '--others', '--exclude-standard', '-z'], cwd)) files.add(file);
  return [...files].sort();
}
