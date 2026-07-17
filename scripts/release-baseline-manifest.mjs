#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const comparePath = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function git(root, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: options.encoding === null ? null : 'utf8',
    shell: false,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  return options.encoding === null ? result.stdout : String(result.stdout).trim();
}

export function assertCleanReleaseTree(root = repositoryRoot) {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) {
    throw new Error(`release source tree is dirty:\n${status}`);
  }
  return true;
}

export function resolveReleaseIdentity({ root = repositoryRoot, commit, ref, version }) {
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const expectedVersion = version || packageVersion;
  if (expectedVersion !== packageVersion) {
    throw new Error(
      `release version ${expectedVersion} does not match package.json version ${packageVersion}`,
    );
  }

  const head = git(root, ['rev-parse', 'HEAD']);
  const expectedCommit = commit || head;
  if (!/^[a-f0-9]{40}$/iu.test(expectedCommit)) {
    throw new Error(`release commit must be a full 40-character SHA: ${expectedCommit}`);
  }
  if (head !== expectedCommit) {
    throw new Error(`release commit mismatch: HEAD=${head} expected=${expectedCommit}`);
  }
  if (!ref) throw new Error('release ref is required');

  const refCommit = git(root, ['rev-parse', `${ref}^{commit}`]);
  if (refCommit !== expectedCommit) {
    throw new Error(`release ref/commit mismatch: ${ref}=${refCommit} expected=${expectedCommit}`);
  }
  if (ref.startsWith('refs/tags/')) {
    const expectedTag = `refs/tags/v${expectedVersion}`;
    if (ref !== expectedTag) {
      throw new Error(`release tag/version mismatch: ref=${ref} expected=${expectedTag}`);
    }
  }

  return {
    version: expectedVersion,
    ref,
    commit: expectedCommit,
    tree: git(root, ['rev-parse', `${expectedCommit}^{tree}`]),
  };
}

function trackedEntries(root, commit) {
  const output = git(root, ['ls-tree', '-r', '-z', '--full-tree', commit], { encoding: null });
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const match = record.match(/^(\d{6}) (blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/u);
      if (!match) throw new Error(`cannot parse tracked entry: ${record}`);
      const [, mode, type, objectId, path] = match;
      return { mode, type, objectId, path };
    })
    .sort((a, b) => comparePath(a.path, b.path));
}

function readBlobBatch(root, objectIds) {
  const blobs = new Map();
  const unique = [...new Set(objectIds)];
  for (let start = 0; start < unique.length; start += 256) {
    const batch = unique.slice(start, start + 256);
    const result = spawnSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: `${batch.join('\n')}\n`,
      encoding: null,
      shell: false,
      maxBuffer: 512 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`git cat-file --batch failed: ${String(result.stderr || '').trim()}`);
    }
    let offset = 0;
    for (const requestedId of batch) {
      const newline = result.stdout.indexOf(0x0a, offset);
      if (newline < 0) throw new Error(`git cat-file response missing header for ${requestedId}`);
      const [objectId, type, sizeText] = result.stdout.subarray(offset, newline).toString('utf8').split(' ');
      const size = Number(sizeText);
      if (objectId !== requestedId || type !== 'blob' || !Number.isSafeInteger(size)) {
        throw new Error(`git cat-file returned an invalid blob header for ${requestedId}`);
      }
      const contentStart = newline + 1;
      const contentEnd = contentStart + size;
      blobs.set(requestedId, result.stdout.subarray(contentStart, contentEnd));
      offset = contentEnd + 1;
    }
  }
  return blobs;
}

export function createReleaseBaselineManifest(options = {}) {
  const root = resolve(options.root || repositoryRoot);
  if (options.checkClean !== false) assertCleanReleaseTree(root);
  const identity = resolveReleaseIdentity({ root, ...options });
  const entries = trackedEntries(root, identity.commit);
  const blobs = readBlobBatch(
    root,
    entries.filter((entry) => entry.type === 'blob').map((entry) => entry.objectId),
  );
  const files = entries.map((entry) => {
    const bytes =
      entry.type === 'blob' ? blobs.get(entry.objectId) : Buffer.from(`gitlink:${entry.objectId}\n`);
    if (!bytes) throw new Error(`tracked blob is missing: ${entry.path}`);
    return {
      path: entry.path,
      mode: entry.mode,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const manifest = {
    schemaVersion: 1,
    version: identity.version,
    ref: identity.ref,
    commit: identity.commit,
    tree: identity.tree,
    trackedFileCount: files.length,
    files,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeReleaseBaselineManifest(options = {}) {
  const outputPath = resolve(options.outputPath);
  const text = createReleaseBaselineManifest(options);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, text);
  return { outputPath, text, sha256: createHash('sha256').update(text).digest('hex') };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputPath = readArg('--output');
    if (!outputPath) throw new Error('--output is required');
    const result = writeReleaseBaselineManifest({
      root: readArg('--root') || repositoryRoot,
      outputPath,
      version: readArg('--version'),
      ref: readArg('--ref') || process.env.GITHUB_REF,
      commit: readArg('--commit') || process.env.GITHUB_SHA,
    });
    console.log(`[release-baseline] manifest OK sha256=${result.sha256}`);
  } catch (error) {
    console.error(`[release-baseline] manifest FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
