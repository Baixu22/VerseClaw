import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './specs.mjs';

const execFileAsync = promisify(execFile);

export function resolveDiffBase(explicitSince, configuredDiffBase) {
  return explicitSince || configuredDiffBase || 'origin/main';
}

async function gitLines(args, cwd = ROOT) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
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
  for (const line of await gitLines(['diff', '--name-only', `${since}...HEAD`], cwd)) files.add(line);
  for (const line of await gitLines(['diff', '--cached', '--name-only'], cwd)) files.add(line);
  for (const line of await gitLines(['diff', '--name-only'], cwd)) files.add(line);
  for (const line of await gitLines(['ls-files', '--others', '--exclude-standard'], cwd)) files.add(line);
  return [...files].sort();
}
