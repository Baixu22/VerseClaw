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

// Git 2.51 on Windows can render ignored untracked directory placeholders with
// the absolute checkout path and the drive colon encoded as U+F03A (for
// example, `D\uF03AClawX/.agent-workbench/...`). Normalize those entries back
// to repository-relative forward-slash paths before ownership matching.
function normalizeGitPath(file, cwd) {
  const normalized = String(file).replaceAll('\uF03A', ':').replaceAll('\uF05C', '/').replaceAll('\\', '/');
  const root = String(cwd).replaceAll('\\', '/').replace(/\/+$/, '');
  const decodedRoot = root.replace(/^([A-Za-z]):/, '$1\uF03A');
  for (const prefix of [root + '/', decodedRoot + '/']) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  }
  return normalized;
}

async function gitPaths(args, cwd = ROOT) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.split('\0').filter(Boolean).map((file) => normalizeGitPath(file, cwd));
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
  for (const file of await gitPaths(['ls-files', '--others', '--exclude-standard', '-z'], cwd)) {
    // `.gitignore` can re-include a directory so a later exact-file exception is
    // possible. Those directory placeholders are not changed files and must not
    // consume touchedArea ownership.
    if (!file.endsWith('/')) files.add(file);
  }
  return [...files].sort();
}
