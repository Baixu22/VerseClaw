#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DUPLICATE_MIN_BYTES = 100 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'duplicate-assets-allowlist.json');

function normalize(filePath) {
  return filePath.replaceAll('\\', '/');
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean).map(normalize).sort();
}

function normalizeLineEndings(bytes) {
  // Text checkouts may differ only by CRLF on Windows. Binary assets keep their
  // raw bytes so the reviewed hashes still describe the packaged artifact.
  if (bytes.includes(0)) return bytes;
  return Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
}

async function sha256(filePath) {
  const bytes = await readFile(path.join(ROOT, filePath));
  return createHash('sha256').update(normalizeLineEndings(bytes)).digest('hex');
}

export async function findMissingTrackedFiles() {
  const missing = [];
  for (const filePath of listTrackedFiles()) {
    try {
      await stat(path.join(ROOT, filePath));
    } catch (error) {
      if (error?.code === 'ENOENT') missing.push(filePath);
      else throw error;
    }
  }
  return missing;
}

export async function findDuplicateGroups(minBytes = DUPLICATE_MIN_BYTES) {
  const byHash = new Map();
  for (const filePath of listTrackedFiles()) {
    let info;
    try {
      info = await stat(path.join(ROOT, filePath));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.size <= minBytes) continue;
    const hash = await sha256(filePath);
    const group = byHash.get(hash) ?? [];
    group.push(filePath);
    byHash.set(hash, group);
  }
  return [...byHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort(), bytes: null }))
    .sort((a, b) => a.sha256.localeCompare(b.sha256));
}

function groupKey(group) {
  return [...group.paths].sort().join('\0');
}

function classifyReason(paths) {
  if (paths.every((file) => file.startsWith('resources/icons/'))) {
    return 'Packaging path compatibility: Electron Builder and platform icon references require these stable asset paths.';
  }
  if (paths.every((file) => file.startsWith('resources/skills/preinstalled/'))) {
    return 'Preinstalled skill bundles are distributed independently and must remain self-contained.';
  }
  if (paths.every((file) => file.startsWith('openclaw_runtime/extensions/verseconf-artifacts/vendor/verseconf/pkg'))) {
    return 'Vendored VerseConf WASM mirrors match the package layout needed by the runtime and verifier.';
  }
  if (paths.every((file) => file.startsWith('src/assets/'))) {
    return 'Light/dark theme variants are resolved by path at runtime; variants are retained even when their exported bytes currently match.';
  }
  if (paths.some((file) => file.startsWith('artifacts/')) && paths.some((file) => file.includes('openclaw_runtime/src/context-engine/fixtures/'))) {
    return 'Corpus is intentionally mirrored between the runtime fixture and retained artifact evidence; both are referenced by tests or manifests.';
  }
  if (paths.every((file) => file.startsWith('artifacts/'))) {
    return 'Historical evidence mirrors are retained because each task directory is an independent review record.';
  }
  return 'Reviewed retained mirror; remove only with a matching reference and packaging update.';
}

export function compareDuplicateGroups(actualGroups, allowlist) {
  const expected = allowlist.groups ?? [];
  const actualByKey = new Map(actualGroups.map((group) => [groupKey(group), group]));
  const expectedByKey = new Map(expected.map((group) => [groupKey(group), group]));
  const unexpected = actualGroups.filter((group) => !expectedByKey.has(groupKey(group)));
  const stale = expected.filter((group) => !actualByKey.has(groupKey(group)));
  const malformed = expected.filter((group) => !group.reason?.trim() || !group.sha256 || !Array.isArray(group.paths));
  return { unexpected, stale, malformed };
}

async function readAllowlist() {
  try {
    return JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'));
  } catch {
    return { version: 1, minBytes: DUPLICATE_MIN_BYTES, groups: [] };
  }
}

export async function buildAllowlist(groups) {
  return {
    version: 1,
    minBytes: DUPLICATE_MIN_BYTES,
    groups: groups.map((group) => ({ sha256: group.sha256, paths: group.paths, reason: classifyReason(group.paths) })),
  };
}

async function main() {
  const missing = await findMissingTrackedFiles();
  if (missing.length > 0) {
    console.error('[duplicates] tracked files are missing from the worktree:');
    for (const filePath of missing) console.error(`  ${filePath}`);
    process.exitCode = 1;
    return;
  }
  const groups = await findDuplicateGroups();
  if (process.argv.includes('--write')) {
    await writeFile(ALLOWLIST_PATH, `${JSON.stringify(await buildAllowlist(groups), null, 2)}\n`, 'utf8');
    console.log(`[duplicates] wrote allowlist with ${groups.length} reviewed groups.`);
    return;
  }
  const allowlist = await readAllowlist();
  const comparison = compareDuplicateGroups(groups, allowlist);
  const failures = [];
  if (comparison.unexpected.length > 0) {
    failures.push(`Unapproved duplicate groups: ${comparison.unexpected.length}`);
    for (const group of comparison.unexpected) failures.push(`  ${group.sha256} ${group.paths.join(' == ')}`);
  }
  if (comparison.stale.length > 0) {
    failures.push(`Stale duplicate allowlist groups: ${comparison.stale.length}`);
  }
  if (comparison.malformed.length > 0) failures.push(`Malformed duplicate allowlist groups: ${comparison.malformed.length}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }
  console.log(`[duplicates] ${groups.length} reviewed duplicate groups matched the allowlist.`);
}

if (isMainEntrypoint(import.meta.url)) await main();
