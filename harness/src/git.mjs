import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './specs.mjs';

const execFileAsync = promisify(execFile);

export function resolveDiffBase(explicitSince, configuredDiffBase) {
  return explicitSince || configuredDiffBase || 'origin/main';
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
