#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(ROOT, 'openclaw_runtime');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function collectRuntimeSourcePolicyErrors() {
  const failures = [];
  const runtimePackage = await readJson(path.join(RUNTIME, 'package.json'));
  const prune = await readJson(path.join(RUNTIME, 'PRUNE-MANIFEST.json'));
  const upstream = await readFile(path.join(RUNTIME, 'UPSTREAM.md'), 'utf8');
  const baseline = await readJson(path.join(RUNTIME, 'scripts', 'ts-max-loc-baseline.json'));
  const layoutDoc = await readFile(path.join(ROOT, 'docs', 'dev', 'repository-layout.md'), 'utf8');

  if (prune.status !== 'superseded') failures.push('PRUNE-MANIFEST.json must be marked superseded');
  if (prune.currentVendoredVersion !== runtimePackage.version) {
    failures.push(`PRUNE-MANIFEST.json currentVendoredVersion must match openclaw_runtime version ${runtimePackage.version}`);
  }
  if (!String(prune.supersededBy ?? '').includes('UPSTREAM.md')) failures.push('PRUNE-MANIFEST.json must point to UPSTREAM.md');
  if (!upstream.includes('https://github.com/openclaw/openclaw')) failures.push('UPSTREAM.md must name the upstream repository');
  if (!upstream.includes(runtimePackage.version)) failures.push(`UPSTREAM.md must name vendored version ${runtimePackage.version}`);
  if (baseline.maxLines !== 500) failures.push('LOC baseline must use the upstream 500-line limit');
  if (!baseline.entries || Object.keys(baseline.entries).length === 0) failures.push('LOC baseline must contain tracked offenders');
  if (!runtimePackage.scripts?.['check:loc:baseline']) failures.push('runtime package must expose check:loc:baseline');
  if (!runtimePackage.scripts?.['check:import-cycles']) failures.push('runtime package must expose check:import-cycles');
  if (!runtimePackage.scripts?.['deadcode:unused-files']) failures.push('runtime package must expose deadcode:unused-files');
  const gitignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  for (const required of [
    '!openclaw_runtime/extensions/verseconf-artifacts/vendor/verseconf/dist/',
    '!openclaw_runtime/extensions/verseconf-artifacts/vendor/verseconf/dist/**',
  ]) {
    if (!gitignore.includes(required)) failures.push(`.gitignore missing tracked build-output exception: ${required}`);
  }
  if (gitignore.includes('!openclaw_runtime/extensions/codegraph/dist/')) failures.push('.gitignore must not retain removed CodeGraph tracked-output exception');
  if (!upstream.includes('CodeGraph') || !upstream.includes('2026-10-17')) failures.push('UPSTREAM.md must record the CodeGraph retirement date');
  if (!layoutDoc.includes('send-button-states-design.md')) failures.push('repository layout doc must record the moved root design file');
  if (!layoutDoc.includes('packages/vtoken')) failures.push('repository layout doc must classify packages/vtoken');
  return failures;
}

async function main() {
  const failures = await collectRuntimeSourcePolicyErrors();
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }
  console.log('[runtime-policy] upstream, prune, layout and LOC baseline metadata are aligned.');
}

if (isMainEntrypoint(import.meta.url)) await main();
