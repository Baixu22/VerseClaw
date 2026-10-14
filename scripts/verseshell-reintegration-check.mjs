#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
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

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

export async function verifyMigrationSource({ upstream, candidate, controlRoot = ROOT }) {
  const lockBytes = await readFile(path.join(controlRoot, LOCK_PATH));
  const lock = JSON.parse(lockBytes);
  if (lock.schema !== 'verseshell.reintegration-source-lock/v1' || lock.state !== 'planned-target-only') {
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
