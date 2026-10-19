#!/usr/bin/env node
/**
 * Verify committed SHA256SUMS evidence manifests.
 *
 * Legacy snapshots may intentionally exclude an evolving repository file. Such
 * an entry is accepted only when the same evidence directory carries an
 * INTEGRITY.json annotation naming the exact path and reason.
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readAnnotations(manifestPath) {
  const annotationPath = join(dirname(manifestPath), 'INTEGRITY.json');
  if (!existsSync(annotationPath)) return new Set();
  const parsed = JSON.parse(readFileSync(annotationPath, 'utf8'));
  return new Set((parsed.excludedEntries ?? []).map((entry) => entry.path));
}

export function verifyManifest(root, manifestPath) {
  const excluded = readAnnotations(manifestPath);
  const result = { manifest: relative(root, manifestPath).replace(/\\/g, '/'), checked: 0, matched: 0, annotatedDrift: [], missing: [], drifted: [], malformed: [] };
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s+[* ]?(.+)$/i.exec(line.trim());
    if (!match) {
      result.malformed.push(line);
      continue;
    }
    const expected = match[1].toLowerCase();
    const ref = match[2].trim();
    result.checked += 1;
    const absolute = join(root, ref);
    if (!existsSync(absolute)) {
      result.missing.push(ref);
      continue;
    }
    const actual = sha256File(absolute);
    if (actual === expected) {
      result.matched += 1;
    } else if (excluded.has(ref)) {
      result.annotatedDrift.push(ref);
    } else {
      result.drifted.push(ref);
    }
  }
  return result;
}

export function verifyAllManifests(root = ROOT) {
  const manifests = [];
  for (const base of ['artifacts', 'docs/dev/harness-gap-closure']) {
    const absolute = join(root, base);
    if (!existsSync(absolute)) continue;
    manifests.push(...walk(absolute).filter((file) => file.endsWith('SHA256SUMS') && existsSync(join(dirname(file), 'INTEGRITY.json'))));
  }
  return manifests.sort().map((manifest) => verifyManifest(root, manifest));
}

function main() {
  const results = verifyAllManifests(ROOT);
  let failed = false;
  const lines = [];
  for (const result of results) {
    const ok = result.missing.length === 0 && result.drifted.length === 0 && result.malformed.length === 0;
    failed ||= !ok;
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${result.manifest} checked=${result.checked} matched=${result.matched} annotatedDrift=${result.annotatedDrift.length} missing=${result.missing.length} drifted=${result.drifted.length} malformed=${result.malformed.length}`);
    for (const path of result.annotatedDrift) lines.push(`  ANNOTATED-DRIFT ${path}`);
    for (const path of result.missing) lines.push(`  MISSING ${path}`);
    for (const path of result.drifted) lines.push(`  DRIFT ${path}`);
    for (const line of result.malformed) lines.push(`  MALFORMED ${line}`);
  }
  console.log(lines.join('\n'));
  if (failed) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) main();
