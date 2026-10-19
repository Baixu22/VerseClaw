#!/usr/bin/env node
/**
 * Validate repo-relative paths asserted by capability/reliability evidence.
 * These are strings, not imports, so a rename would otherwise silently break
 * the claim's source evidence.
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_FILES = [
  'shared/product-semantics.ts',
  'shared/capability-claims.ts',
  'shared/sensitive-content-boundary.ts',
  'shared/reliability-boundaries.ts',
  'shared/dcs/prod-flags-catalog.ts',
];

const REPO_PATH_PREFIXES = [
  'src/',
  'shared/',
  'electron/',
  'harness/',
  'openclaw_runtime/',
  'tests/',
  'scripts/',
  'docs/',
  'reports/',
  'plans/',
  'artifacts/',
];
const PATH_LIKE = /(?:^|[\s'"`\[(])((?:src|shared|electron|harness|openclaw_runtime|tests|scripts|docs|reports|plans|artifacts)\/[A-Za-z0-9_.@%+~()\/:-]+?\.(?:tsx|ts|jsonl|json|mjs|js|md|yml|yaml|css|html))/g;

export function collectEvidenceRefs(root = ROOT) {
  const refs = new Map();
  for (const relative of EVIDENCE_FILES) {
    const absolute = join(root, relative);
    if (!existsSync(absolute)) {
      refs.set(relative, [relative]);
      continue;
    }
    const text = readFileSync(absolute, 'utf8');
    const found = new Set();
    for (const match of text.matchAll(PATH_LIKE)) {
      const value = match[1];
      if (REPO_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))) found.add(value);
    }
    refs.set(relative, [...found].sort());
  }
  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath)) {
    const scripts = JSON.parse(readFileSync(packagePath, 'utf8')).scripts ?? {};
    const packageRefs = new Set();
    for (const command of Object.values(scripts)) {
      if (typeof command !== 'string') continue;
      for (const match of command.matchAll(PATH_LIKE)) {
        if (match[1].startsWith('openclaw_runtime/')) packageRefs.add(match[1]);
      }
    }
    refs.set('package.json scripts', [...packageRefs].sort());
  }
  return refs;
}

export function checkEvidenceRefs(root = ROOT) {
  const missing = [];
  for (const [owner, refs] of collectEvidenceRefs(root)) {
    for (const ref of refs) {
      if (!existsSync(join(root, ref))) missing.push({ owner, ref });
    }
  }
  return { ok: missing.length === 0, missing };
}

function main() {
  const result = checkEvidenceRefs(ROOT);
  if (!result.ok) {
    console.error('[evidence-refs] FAIL missing referenced paths:');
    for (const entry of result.missing) console.error(`  ${entry.owner}: ${entry.ref}`);
    process.exitCode = 1;
    return;
  }
  const count = [...collectEvidenceRefs(ROOT).values()].reduce((sum, refs) => sum + refs.length, 0);
  console.log(`[evidence-refs] PASS ${count} referenced path(s)`);
}

if (isMainEntrypoint(import.meta.url)) main();
