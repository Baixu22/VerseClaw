// Node-only provenance. Interactive readback uses async I/O; final commit is sync.
import { execFile, execFileSync, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync, lstatSync, readlinkSync, statSync, realpathSync, readdirSync } from 'node:fs';
import { lstat, readFile, readlink, realpath, readdir, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative as relativePath, sep as separator } from 'node:path';
import { taskLedgerDigest } from './task-ledger-journal.js';
import type { TaskLedgerCompletionCandidate } from './types/task-ledger.js';
import { TextDecoder } from 'node:util';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const strictGitText = (value: string | Uint8Array): string => typeof value === 'string'
  ? value : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
// Preserve callback outputs even when the host wraps execFile for metrics.
// Node's private multi-result promisify metadata does not survive every wrapper.
const execAsync = (file: string, args: string[], options: ExecFileOptionsWithStringEncoding) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { ...options, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) reject(error); else {
        try { resolve({ stdout: strictGitText(stdout), stderr: strictGitText(stderr) }); } catch (error) { reject(error); }
      }
    });
  });
const gitFlags = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
const hostGitEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key))), GIT_OPTIONAL_LOCKS: '0' });
const physicalPath = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
function assertDiscoveredTree(requested: string, discovered: string): void {
  const relative = relativePath(realpathSync(discovered), realpathSync(requested));
  if (relative === '..' || relative.startsWith('..' + separator) || isAbsolute(relative)) {
    throw new Error('Git repository configuration selected a different physical source tree');
  }
}
function linkedBytesSync(path: string, ancestors: Set<string>, depth = 0): Buffer {
  if (depth > 32) throw new Error('Linked source nesting is unavailable');
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    const target = realpathSync(path), key = physicalPath(target);
    if (ancestors.has(key)) throw new Error('Linked source cycle is unavailable');
    return Buffer.from(taskLedgerDigest({ link: readlinkSync(path), target: key, mode: info.mode & 0o777,
      bytes: sha(linkedBytesSync(target, ancestors, depth + 1)) }));
  }
  if (info.isDirectory()) {
    const key = physicalPath(realpathSync(path));
    if (ancestors.has(key)) throw new Error('Linked source cycle is unavailable');
    const next = new Set(ancestors); next.add(key);
    return Buffer.from(taskLedgerDigest({ mode: info.mode & 0o777,
      entries: readdirSync(path).sort().map(name => ({ name, sha256: sha(linkedBytesSync(join(path, name), next, depth + 1)) })) }));
  }
  if (!info.isFile()) throw new Error('Linked source is not a regular file or directory');
  return Buffer.from(taskLedgerDigest({ mode: info.mode & 0o777, sha256: sha(readFileSync(path)) }));
}
async function linkedBytesAsync(path: string, ancestors: Set<string>, depth = 0): Promise<Buffer> {
  if (depth > 32) throw new Error('Linked source nesting is unavailable');
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    const target = await realpath(path), key = physicalPath(target);
    if (ancestors.has(key)) throw new Error('Linked source cycle is unavailable');
    return Buffer.from(taskLedgerDigest({ link: await readlink(path), target: key, mode: info.mode & 0o777,
      bytes: sha(await linkedBytesAsync(target, ancestors, depth + 1)) }));
  }
  if (info.isDirectory()) {
    const key = physicalPath(await realpath(path));
    if (ancestors.has(key)) throw new Error('Linked source cycle is unavailable');
    const next = new Set(ancestors); next.add(key);
    const rows = [];
    for (const name of (await readdir(path)).sort()) rows.push({ name, sha256: sha(await linkedBytesAsync(join(path, name), next, depth + 1)) });
    return Buffer.from(taskLedgerDigest({ mode: info.mode & 0o777, entries: rows }));
  }
  if (!info.isFile()) throw new Error('Linked source is not a regular file or directory');
  return Buffer.from(taskLedgerDigest({ mode: info.mode & 0o777, sha256: sha(await readFile(path)) }));
}
const sourcePaths = (text: string) => [...new Set(text.split('\0').filter(Boolean))]
  .filter(path => path !== '.ae' && !path.startsWith('.ae/')).sort();
const indexRows = (text: string) => text.split('\0').filter(Boolean)
  .filter(row => { const path = row.slice(row.indexOf('\t') + 1); return path !== '.ae' && !path.startsWith('.ae/'); }).sort();

function hostGit(): string {
  // Windows otherwise searches the untrusted project cwd before PATH. Do not
  // resolve relative/empty PATH entries or project-local command wrappers.
  for (const entry of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (!isAbsolute(entry)) continue;
    const file = join(entry, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return file;
    } catch { /* Try the next host PATH entry. */ }
  }
  throw new Error('Host Git executable is unavailable');
}

/** Include ignored-state-independent source facts; .ae is the existing host evidence artifact. */
export function readTaskCompletionCandidate(root: string, configSha256: string, depth = 0): TaskLedgerCompletionCandidate {
  if (depth > 32) throw new Error('Submodule provenance nesting is unavailable');
  if (!/^[a-f0-9]{64}$/u.test(configSha256)) throw new Error('Runtime configuration digest is unavailable');
  const executable = hostGit();
  const requestedRoot = root;
  root = realpathSync(strictGitText(execFileSync(executable, [...gitFlags, 'rev-parse', '--show-toplevel'],
    { cwd: root, env: hostGitEnv(), windowsHide: true, timeout: 20_000, maxBuffer: 4096 })).trim());
  assertDiscoveredTree(requestedRoot, root);
  const git = (args: string[]) => execFileSync(executable, [...gitFlags, ...args], { cwd: root, env: hostGitEnv(), windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 });
  const source = strictGitText(git(['rev-parse', '--verify', 'HEAD'])).trim();
  const index = indexRows(strictGitText(git(['ls-files', '--stage', '-z'])));
  const gitlinks = new Set(index.filter(row => row.startsWith('160000 ')).map(row => row.slice(row.indexOf('\t') + 1)));
  const files = (args: string[]) => sourcePaths(strictGitText(git(args))).map(path => {
      const absolute = join(root, path);
      try {
        const stat = lstatSync(absolute);
        if (gitlinks.has(path)) {
          if (!(stat.isDirectory() || stat.isSymbolicLink() && statSync(absolute).isDirectory())) throw new Error('Gitlink source is not a directory');
          let initialized = false;
          try { lstatSync(join(absolute, '.git')); initialized = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (!initialized && readdirSync(absolute).length) throw new Error('Gitlink source is populated without its repository owner');
          const bytes = Buffer.from(initialized ? taskLedgerDigest({ link: stat.isSymbolicLink() ? readlinkSync(absolute) : null,
            candidate: readTaskCompletionCandidate(realpathSync(absolute), configSha256, depth + 1) }) : 'uninitialized-gitlink');
          return { path, sha256: sha(bytes), bytes: bytes.byteLength };
        }
        if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Candidate source is not a regular file');
        const bytes = stat.isSymbolicLink() ? linkedBytesSync(absolute, new Set([physicalPath(root)])) : readFileSync(absolute);
        return { path, sha256: sha(bytes), bytes: bytes.byteLength };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, sha256: null, bytes: 0 };
        throw error;
      }
    });
  const tracked = files(['ls-files', '-z']);
  const untracked = files(['ls-files', '--others', '--exclude-standard', '-z']);
  return { source, inputSha256: taskLedgerDigest(tracked), configSha256,
    dirtyDiffSha256: taskLedgerDigest({
      // Index object IDs/modes and physical worktree bytes cover staged and
      // unstaged intent without invoking diff, textconv, or clean filters.
      index,
      tracked, modes: [...tracked, ...untracked].map(file => {
        try { return { path: file.path, mode: lstatSync(join(root, file.path)).mode & 0o777 }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: file.path, mode: null }; throw error; }
      }), untracked,
    }) };
}

/** Fresh per read; no persisted cache can hide source edits or policy changes. */
export async function readTaskCompletionCandidateAsync(root: string, configSha256: string, depth = 0): Promise<TaskLedgerCompletionCandidate> {
  if (depth > 32) throw new Error('Submodule provenance nesting is unavailable');
  if (!/^[a-f0-9]{64}$/u.test(configSha256)) throw new Error('Runtime configuration digest is unavailable');
  const executable = hostGit();
  const requestedRoot = root;
  root = await realpath((await execAsync(executable, [...gitFlags, 'rev-parse', '--show-toplevel'],
    { cwd: root, env: hostGitEnv(), windowsHide: true, timeout: 20_000, encoding: 'utf8', maxBuffer: 4096 })).stdout.trim());
  assertDiscoveredTree(requestedRoot, root);
  const git = async (args: string[]) => (await execAsync(executable, [...gitFlags, ...args], { cwd: root,
    env: hostGitEnv(), windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' })).stdout;
  const source = (await git(['rev-parse', '--verify', 'HEAD'])).trim();
  const index = indexRows(await git(['ls-files', '--stage', '-z']));
  const gitlinks = new Set(index.filter(row => row.startsWith('160000 ')).map(row => row.slice(row.indexOf('\t') + 1)));
  const files = async (args: string[]) => {
    const result: Array<{ path: string; sha256: string | null; bytes: number }> = [];
    // Bound open files; filesystem work yields instead of blocking Main.
    for (const path of sourcePaths(await git(args))) {
      const absolute = join(root, path);
      try {
        const info = await lstat(absolute);
        if (gitlinks.has(path)) {
          if (!(info.isDirectory() || info.isSymbolicLink() && (await stat(absolute)).isDirectory())) throw new Error('Gitlink source is not a directory');
          let initialized = false;
          try { await lstat(join(absolute, '.git')); initialized = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (!initialized && (await readdir(absolute)).length) throw new Error('Gitlink source is populated without its repository owner');
          const bytes = Buffer.from(initialized ? taskLedgerDigest({ link: info.isSymbolicLink() ? await readlink(absolute) : null,
            candidate: await readTaskCompletionCandidateAsync(await realpath(absolute), configSha256, depth + 1) }) : 'uninitialized-gitlink');
          result.push({ path, sha256: sha(bytes), bytes: bytes.byteLength });
          continue;
        }
        if (!info.isFile() && !info.isSymbolicLink()) throw new Error('Candidate source is not a regular file');
        const bytes = info.isSymbolicLink() ? await linkedBytesAsync(absolute, new Set([physicalPath(root)])) : await readFile(absolute);
        result.push({ path, sha256: sha(bytes), bytes: bytes.byteLength });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        result.push({ path, sha256: null, bytes: 0 });
      }
    }
    return result;
  };
  const tracked = await files(['ls-files', '-z']);
  const untracked = await files(['ls-files', '--others', '--exclude-standard', '-z']);
  const modes: Array<{ path: string; mode: number | null }> = [];
  for (const file of [...tracked, ...untracked]) {
    try { modes.push({ path: file.path, mode: (await lstat(join(root, file.path))).mode & 0o777 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; modes.push({ path: file.path, mode: null }); }
  }
  return { source, inputSha256: taskLedgerDigest(tracked), configSha256, dirtyDiffSha256: taskLedgerDigest({ index, tracked, modes, untracked }) };
}

function combineExecutionCandidate(workspaceRoot: string, workdir: string, executionRoot: string,
  workspace: TaskLedgerCompletionCandidate, execution: TaskLedgerCompletionCandidate): TaskLedgerCompletionCandidate {
  // The task source is the tree used by the process. Bootstrap/workspace inputs
  // still contribute to the digest without impersonating that execution tree.
  const coordinates = { workspaceRoot, workdir, executionRoot };
  return { source: execution.source, configSha256: workspace.configSha256,
    inputSha256: taskLedgerDigest({ ...coordinates, workspace: workspace.inputSha256, execution: execution.inputSha256 }),
    dirtyDiffSha256: taskLedgerDigest({ ...coordinates, workspace, execution }) };
}

/** Bind the actual task cwd as well as the session's existing workspace owner. */
export function readTaskExecutionCandidate(root: string, workdir: string, configSha256: string): TaskLedgerCompletionCandidate {
  const workspaceRoot = physicalPath(realpathSync(root)), cwd = physicalPath(realpathSync(workdir));
  const workspace = readTaskCompletionCandidate(root, configSha256);
  if (workspaceRoot === cwd) return workspace;
  const executionRoot = physicalPath(realpathSync(strictGitText(execFileSync(hostGit(), [...gitFlags, 'rev-parse', '--show-toplevel'],
    { cwd: workdir, env: hostGitEnv(), windowsHide: true, timeout: 20_000, maxBuffer: 4096 })).trim()));
  const execution = executionRoot === workspaceRoot ? workspace : readTaskCompletionCandidate(executionRoot, configSha256);
  return combineExecutionCandidate(workspaceRoot, cwd, executionRoot, workspace, execution);
}

export async function readTaskExecutionCandidateAsync(root: string, workdir: string, configSha256: string): Promise<TaskLedgerCompletionCandidate> {
  const workspaceRoot = physicalPath(await realpath(root)), cwd = physicalPath(await realpath(workdir));
  const workspace = await readTaskCompletionCandidateAsync(root, configSha256);
  if (workspaceRoot === cwd) return workspace;
  const executionRoot = physicalPath(await realpath((await execAsync(hostGit(), [...gitFlags, 'rev-parse', '--show-toplevel'],
    { cwd: workdir, env: hostGitEnv(), windowsHide: true, timeout: 20_000, encoding: 'utf8', maxBuffer: 4096 })).stdout.trim()));
  const execution = executionRoot === workspaceRoot ? workspace : await readTaskCompletionCandidateAsync(executionRoot, configSha256);
  return combineExecutionCandidate(workspaceRoot, cwd, executionRoot, workspace, execution);
}
