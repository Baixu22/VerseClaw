#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = 'harness/specs/fixtures/verseshell-reintegration/source-lock.json';
const GENERATED_DIRS = new Set(['__pycache__', '.pytest_cache', 'target']);

// Preserve every byte except CR in CRLF, including invalid UTF-8 fixture bytes.
export function hashSource(bytes) {
  const canonical = Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
  return createHash('sha256').update(canonical).digest('hex');
}

function within(root, relative) {
  if (!relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)
    || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..')) {
    throw new Error('Unsafe source-lock path: ' + relative);
  }
  const absolute = path.resolve(root, relative);
  const remainder = path.relative(root, absolute);
  if (!remainder || remainder.startsWith('..') || path.isAbsolute(remainder)) {
    throw new Error('Source-lock path escapes root: ' + relative);
  }
  return absolute;
}

export async function inspectSourceTree(rootPath, lock, digestField) {
  const root = await realpath(rootPath);
  const expected = new Map();
  for (const entry of lock.files) {
    within(root, entry.path);
    if (expected.has(entry.path)) throw new Error('Duplicate source-lock path: ' + entry.path);
    if (!/^[a-f0-9]{64}$/.test(entry[digestField])) throw new Error('Invalid source hash: ' + entry.path);
    expected.set(entry.path, entry[digestField]);
  }
  const issues = [];
  for (const [relative, digest] of expected) {
    const absolute = within(root, relative);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        issues.push({ kind: 'not-regular-file', path: relative });
      } else {
        const actual = hashSource(await readFile(absolute));
        if (actual !== digest) issues.push({ kind: 'hash-mismatch', path: relative, expected: digest, actual });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      issues.push({ kind: 'missing', path: relative });
    }
  }
  async function walk(relative) {
    const absolute = within(root, relative);
    let stat;
    try { stat = await lstat(absolute); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      issues.push({ kind: 'symlink', path: relative });
    } else if (stat.isDirectory()) {
      for (const child of (await readdir(absolute)).sort()) {
        if (!GENERATED_DIRS.has(child)) await walk(relative + '/' + child);
      }
    } else if (!expected.has(relative)) {
      issues.push({ kind: 'undeclared-file', path: relative });
    }
  }
  for (const relative of [...lock.protected_roots, ...lock.protected_root_files]) await walk(relative);
  return issues.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}

/**
 * A temporary derivation tree is not a git repository, but on Windows a low-integrity temp
 * directory cannot be entered as a working directory for `git apply` unless the ancestor
 * boundary is declared. Without this, `git` walks up and silently applies the patch inside an
 * enclosing repository instead of the scratch tree (observed as a swallowed, no-op apply that
 * produced a derivation mismatch rather than an error). Declaring the scratch parent as a
 * ceiling keeps every derivation self-contained.
 */
function gitCeilingFor(workDir) {
  return { GIT_CEILING_DIRECTORIES: path.dirname(workDir) };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}


/**
 * Derive the effective source from the frozen upstream commit plus the ordered residual
 * patches, then compare it to the candidate. A candidate that merely happens to hash-match
 * on the frozen files but was produced by a different process is still rejected here: the
 * derived tree must reproduce every declared effective digest, and the candidate must equal
 * the derived tree for every file any residual patch touches.
 */
export async function deriveAndCompareCandidate(upstream, candidate, lock, controlRoot) {
  const issues = [];
  if (!lock.patches.length) return issues;
  const work = await mkdtemp(path.join(tmpdir(), 'verseshell-derive-'));
  try {
    const archive = execFileSync('git', ['-C', upstream, 'archive', '--format=tar', lock.upstream.commit], {
      encoding: 'buffer', windowsHide: true, maxBuffer: 1024 * 1024 * 1024,
    });
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('tar', ['-xf', '-', '-C', work], { windowsHide: true });
      child.on('error', rejectPromise);
      child.on('close', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error('tar exited ' + code))));
      child.stdin.end(archive);
    });
    // Fail closed if the scratch tree is somehow claimed by an enclosing repository.
    try {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: work, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...gitCeilingFor(work) },
      }).trim();
      if (top) {
        issues.push({ kind: 'derive-workdir-inside-repository', path: work, detail: `scratch tree resolves to ${top}` });
        return issues;
      }
    } catch {
      // Not a repository: expected.
    }
    for (const patch of lock.patches) {
      const patchPath = within(controlRoot, patch.path);
      try {
        execFileSync('git', ['apply', '--whitespace=nowarn', patchPath], {
          cwd: work, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...gitCeilingFor(work) },
        });
      } catch (error) {
        issues.push({ kind: 'residual-patch-not-applicable', path: patch.path, detail: String(error.stderr || error.message).slice(0, 400) });
        return issues;
      }
    }
    for (const entry of lock.files) {
      const derived = await readFile(path.join(work, entry.path));
      const derivedDigest = hashSource(derived);
      if (derivedDigest !== entry.effective_sha256_lf) {
        issues.push({ kind: 'derivation-mismatch', path: entry.path, expected: entry.effective_sha256_lf, actual: derivedDigest, side: 'derived' });
        continue;
      }
      const patch = lock.patches.find((item) => item.id === entry.residual_patch);
      if (!patch) continue;
      const candidateBytes = await readFile(within(candidate, entry.path));
      if (hashSource(candidateBytes) !== derivedDigest) {
        issues.push({ kind: 'candidate-not-derived', path: entry.path, expected: derivedDigest, actual: hashSource(candidateBytes), side: 'candidate' });
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return issues;
}

export async function verifyMigrationSource({ upstream, candidate, controlRoot = ROOT }) {
  const lockBytes = await readFile(path.join(controlRoot, LOCK_PATH));
  const lock = JSON.parse(lockBytes);
  if (lock.schema !== 'verseshell.reintegration-source-lock/v1'
    || !['planned-target-only', 'frozen-target-plus-registered-residuals'].includes(lock.state)) {
    throw new Error('Unexpected source-lock contract');
  }
  const issues = [];
  if (git(upstream, ['rev-parse', 'HEAD']).trim() !== lock.upstream.commit) issues.push({ kind: 'upstream-head-drift' });
  if (git(upstream, ['rev-parse', lock.upstream.commit + '^{tree}']).trim() !== lock.upstream.tree) {
    issues.push({ kind: 'upstream-tree-drift' });
  }
  const tracked = git(upstream, ['ls-tree', '-r', '--name-only', '-z', lock.upstream.commit, '--',
    ...lock.protected_roots, ...lock.protected_root_files]).split('\0').filter(Boolean).sort();
  const declared = lock.files.map(entry => entry.path).sort();
  if (JSON.stringify(tracked) !== JSON.stringify(declared)) issues.push({ kind: 'source-inventory-drift' });
  for (const patch of lock.patches) {
    const actual = hashSource(await readFile(within(controlRoot, patch.path)));
    if (actual !== patch.sha256_lf) issues.push({ kind: 'patch-drift', path: patch.path });
  }
  for (const entry of lock.files) {
    const patch = lock.patches.find(item => item.id === entry.residual_patch);
    if (entry.upstream_sha256_lf !== entry.effective_sha256_lf
      && !patch?.changed_paths.includes(entry.path)) {
      issues.push({ kind: 'unregistered-residual', path: entry.path });
    }
  }
  issues.push(...(await deriveAndCompareCandidate(upstream, candidate, lock, controlRoot)));
  issues.push(...(await inspectSourceTree(upstream, lock, 'upstream_sha256_lf')).map(issue => ({ ...issue, side: 'upstream' })));
  issues.push(...(await inspectSourceTree(candidate, lock, 'effective_sha256_lf')).map(issue => ({ ...issue, side: 'candidate' })));
  const operations = new Set();
  for (const entry of lock.files.filter(item => item.path === 'src/operation.rs' || item.path.startsWith('src/ops/'))) {
    const text = await readFile(within(candidate, entry.path), 'utf8');
    for (const match of text.matchAll(/name:\s*"([a-z_]+\.[a-z_.]+)"/g)) operations.add(match[1]);
  }
  if (JSON.stringify([...operations].sort()) !== JSON.stringify([...lock.operations].sort())) {
    issues.push({ kind: 'operation-inventory-drift' });
  }
  return {
    schema: 'verseshell.reintegration-source-check/v1',
    stage: 'source-preservation-only',
    driven_by: 'agent', actor: 'codex',
    targetCommit: lock.upstream.commit,
    contractSha256: createHash('sha256').update(lockBytes).digest('hex'),
    protectedFiles: lock.files.length,
    operations: operations.size,
    sourcePreserved: issues.length === 0,
    migrationComplete: false,
    issues,
  };
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { upstream: { type: 'string' }, candidate: { type: 'string' } } });
    if (!values.upstream || !values.candidate) throw new Error('Required: --upstream <frozen-checkout> --candidate <effective-source>');
    const result = await verifyMigrationSource(values);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.sourcePreserved ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ sourcePreserved: false, migrationComplete: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
