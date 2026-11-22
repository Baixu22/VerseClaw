import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

type FrozenSource = { base64: string; rawSha256: string };

/** A sparse, detached repository preserves real commit/tree/ancestry checks in historical replays. */
export function initializeFrozenGitReplay(sourceRoot: string, replayRoot: string, commit: string, paths: string[]): void {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('source replay requires an exact commit');
  const git = (root: string, args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const objects = git(sourceRoot, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']).trim();
  git(replayRoot, ['init', '--quiet']);
  git(replayRoot, ['config', 'core.autocrlf', 'false']);
  git(replayRoot, ['config', 'core.longpaths', 'true']);
  writeFileSync(join(replayRoot, '.git/objects/info/alternates'), `${objects.replaceAll('\\', '/')}\n`);
  git(replayRoot, ['sparse-checkout', 'init', '--no-cone']);
  git(replayRoot, ['sparse-checkout', 'set', '--no-cone', '--', ...paths.map((path) => `/${path}`)]);
  git(replayRoot, ['checkout', '--detach', '--quiet', commit]);
}

/** Restore sealed source bytes while the owning validator checks their original pins. */
export function copyFrozenSourceInputs(sourceRoot: string, replayRoot: string, paths: string[], files: Record<string, FrozenSource>): void {
  for (const path of paths) {
    const target = resolve(replayRoot, path);
    const scope = relative(resolve(replayRoot), target);
    if (scope.startsWith('..') || isAbsolute(scope)) throw new Error(`source replay escaped its root: ${path}`);
    const frozen = files[path];
    const bytes = frozen ? Buffer.from(frozen.base64, 'base64') : readFileSync(join(sourceRoot, path));
    if (frozen && createHash('sha256').update(bytes).digest('hex') !== frozen.rawSha256) throw new Error(`changed frozen source: ${path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}
