#!/usr/bin/env node
// Builds the showcase demo package for a closing date: copies the three live-model
// journeys into artifacts/showcase-<date>/journeys/ and regenerates the hash manifest
// plus the credential scan for the whole package directory.
//
// Usage:
//   node scripts/build-showcase-package.mjs [--date 20260922] [--verify]
//
// --verify recomputes every hash, reruns the scan, and re-asserts the journey counts
// that the package claims, then exits non-zero on any drift. The manifest carries no
// timestamp on purpose: rebuilding an unchanged package must reproduce manifest.json
// byte for byte. Everything here is offline: no network, no provider key, no Electron.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Journey source directories, in demo order. Keys become journeys/<key>/ in the package.
const JOURNEYS = {
  'J-02': 'artifacts/live-model-cdp/20260921-senseaudio-journey-J02',
  'J-03': 'artifacts/live-model-cdp/20260922-senseaudio-journey-J03',
  'J-04': 'artifacts/live-model-cdp/20260922-senseaudio-journey-J04',
};

// Generated files are excluded from their own scan and from the manifest.
const MANIFEST_NAME = 'manifest.json';
const SCAN_NAME = 'credential-scan.json';

const CREDENTIAL_PATTERNS = [
  { id: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{12,}/gu },
  { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu },
  { id: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/gu },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu },
  { id: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  { id: 'generic-secret-assignment', pattern: /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*["'][^"']{16,}["']/giu },
];

function parseArgs(argv) {
  const options = { date: '20260922', verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verify') options.verify = true;
    else if (arg === '--date') {
      options.date = argv[index + 1];
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!/^\d{8}$/u.test(options.date)) throw new Error(`--date must be YYYYMMDD, got ${options.date}`);
  return options;
}

async function listFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const next = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, next)));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

async function hashFile(absolute) {
  const bytes = await readFile(absolute);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function scanBuffer(bytes) {
  const text = bytes.toString('latin1');
  const hits = [];
  for (const { id, pattern } of CREDENTIAL_PATTERNS) {
    const found = text.match(new RegExp(pattern.source, pattern.flags));
    if (found) hits.push({ id, count: found.length });
  }
  return hits;
}

async function syncJourneys(packageRoot) {
  for (const [key, relative] of Object.entries(JOURNEYS)) {
    const source = path.join(REPO_ROOT, relative);
    if (!existsSync(source)) throw new Error(`missing journey source: ${relative}`);
    const target = path.join(packageRoot, 'journeys', key);
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

async function buildManifest(packageRoot) {
  const files = await listFiles(packageRoot);
  const manifest = {
    note: 'sha256 and byte size of every file in this package except this manifest. Re-check offline with: node scripts/build-showcase-package.mjs --verify',
    excludes: [MANIFEST_NAME],
    package: path.basename(packageRoot),
    journeys: JOURNEYS,
    fileCount: 0,
    files: {},
  };
  for (const relative of files) {
    if (relative === MANIFEST_NAME) continue;
    manifest.files[relative] = await hashFile(path.join(packageRoot, relative));
  }
  manifest.fileCount = Object.keys(manifest.files).length;
  return manifest;
}

async function buildScan(packageRoot) {
  const files = await listFiles(packageRoot);
  const scan = {
    note: 'Credential scan over every packaged file except the two generated JSON reports. Hits must be empty for the package to ship.',
    patterns: CREDENTIAL_PATTERNS.map(({ id, pattern }) => ({ id, pattern: pattern.source })),
    filesScanned: 0,
    hits: [],
  };
  for (const relative of files) {
    if (relative === MANIFEST_NAME || relative === SCAN_NAME) continue;
    scan.filesScanned += 1;
    const hits = scanBuffer(await readFile(path.join(packageRoot, relative)));
    for (const hit of hits) scan.hits.push({ file: relative, ...hit });
  }
  return scan;
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, 'utf8'));
}

// Re-asserts every number the package README/VERIFY claim, straight from the packaged
// JSON. A claim that is not read here is a claim the reader has to trust.
async function checkJourneyCounts(packageRoot, problems) {
  const journeyPath = (key, name) => path.join(packageRoot, 'journeys', key, name);
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) problems.push(`${label}: expected ${JSON.stringify(wanted)}, read ${JSON.stringify(actual)}`);
  };

  const j02 = await readJson(journeyPath('J-02', 'journey.json'));
  expect('J-02 workspace.before.tests.exitCode', j02.workspace.before.tests.exitCode, 1);
  expect('J-02 workspace.after.tests.exitCode', j02.workspace.after.tests.exitCode, 0);
  expect('J-02 receipts.runtime_receipts', j02.receipts.runtime_receipts, 0);
  expect('J-02 candidate.dirty', j02.candidate.dirty, true);
  const j02After = await hashFile(journeyPath('J-02', 'calc.js.after'));
  expect('J-02 calc.js.after sha256', j02After.sha256, j02.workspace.after.files['calc.js'].sha256);

  const j03 = await readJson(journeyPath('J-03', 'journey.json'));
  expect('J-03 receipts.runtime_receipts', j03.receipts.runtime_receipts, 28);
  expect('J-03 candidate.dirty', j03.candidate.dirty, false);
  expect('J-03 candidate.commit', j03.candidate.commit, 'b6c73619189f729c9e87b27210bb6abc21c1cda7');
  const kindCount = (kind, version) =>
    (j03.receipts.byKind ?? []).filter((row) => row.kind === kind && row.version === version)[0]?.n;
  expect('J-03 receipts.byKind context/v1', kindCount('context', '1'), 7);
  expect('J-03 receipts.byKind wire/v1', kindCount('wire', '1'), 7);
  const j03Join = await readJson(journeyPath('J-03', 'receipt-join.json'));
  expect('J-03 receipt-join v1ContextWirePairs', j03Join.v1ContextWirePairs, 7);
  const j03After = await hashFile(journeyPath('J-03', 'calc.js.after'));
  expect('J-03 calc.js.after sha256', j03After.sha256, j03.workspace.after.files['calc.js'].sha256);

  const j04 = await readJson(journeyPath('J-04', 'journey.json'));
  expect('J-04 stopReason', j04.stopReason, 'approval-boundary-observed');
  expect('J-04 boundaryProven', j04.boundaryProven, true);
  expect('J-04 finished', j04.finished, false);
  expect('J-04 candidate.dirty', j04.candidate.dirty, false);
  expect('J-04 approvalBoundary.permissionMode', j04.approvalBoundary.permissionMode, 'readOnly');
  expect('J-04 approvalBoundary.hostGate blocked', j04.approvalBoundary.hostGate.response.data.blocked, true);
  expect(
    'J-04 approvalBoundary.hostGate error',
    j04.approvalBoundary.hostGate.response.data.error,
    'Read-only mode does not allow Gateway mutations',
  );
  expect('J-04 approvalBoundary.continued', j04.approvalBoundary.continued, true);
  const resolvedAt = Date.parse(j04.approvalBoundary.runtimeResolve.at);
  const continuedAt = Date.parse(j04.approvalBoundary.continuation.timestamp);
  if (!(continuedAt > resolvedAt)) problems.push('J-04 continuation is not after the resolve timestamp');
  const frames = (await readFile(journeyPath('J-04', 'gateway-events.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  expect('J-04 gateway-events frames', frames.length, 32);
  expect('J-04 exec.approval.requested frames', frames.filter((f) => f.event === 'exec.approval.requested').length, 2);
  expect('J-04 exec.approval.resolved frames', frames.filter((f) => f.event === 'exec.approval.resolved').length, 1);
}

async function verify(packageRoot, manifest) {
  const problems = [];
  // The manifest covers every file in the directory except itself; verify the same set.
  const files = (await listFiles(packageRoot)).filter((relative) => relative !== MANIFEST_NAME);
  const expected = manifest.files;
  for (const relative of files) {
    const actual = await hashFile(path.join(packageRoot, relative));
    const recorded = expected[relative];
    if (!recorded) problems.push(`not in manifest: ${relative}`);
    else if (recorded.sha256 !== actual.sha256 || recorded.bytes !== actual.bytes) {
      problems.push(`hash drift: ${relative}`);
    }
  }
  for (const relative of Object.keys(expected)) {
    if (!files.includes(relative)) problems.push(`missing from package: ${relative}`);
  }
  const scan = await buildScan(packageRoot);
  for (const hit of scan.hits) problems.push(`credential pattern ${hit.id} in ${hit.file}`);
  await checkJourneyCounts(packageRoot, problems);
  return { problems, scan, checked: files.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageRoot = path.join(REPO_ROOT, 'artifacts', `showcase-${options.date}`);
  const manifestPath = path.join(packageRoot, MANIFEST_NAME);
  const scanPath = path.join(packageRoot, SCAN_NAME);

  if (options.verify) {
    if (!existsSync(manifestPath)) throw new Error(`no manifest to verify: ${path.relative(REPO_ROOT, manifestPath)}`);
    const manifest = await readJson(manifestPath);
    const { problems, scan, checked } = await verify(packageRoot, manifest);
    const scanRecorded = existsSync(scanPath) ? await readJson(scanPath) : null;
    if (scanRecorded && JSON.stringify(scanRecorded.hits) !== JSON.stringify(scan.hits)) {
      problems.push('credential-scan.json hits differ from a fresh scan');
    }
    if (problems.length > 0) {
      console.error(`verify FAILED (${problems.length} problem(s)):`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(`verify OK: ${checked} files match manifest.json; journey counts asserted; ${scan.filesScanned} scanned; 0 credential hits`);
    return;
  }

  await mkdir(packageRoot, { recursive: true });
  await syncJourneys(packageRoot);
  // Scan first, then the manifest: the manifest covers every file in the directory
  // except itself, and credential-scan.json is one of them.
  const scan = await buildScan(packageRoot);
  await writeFile(scanPath, `${JSON.stringify(scan, null, 2)}\n`, 'utf8');
  const manifest = await buildManifest(packageRoot);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const problems = [];
  await checkJourneyCounts(packageRoot, problems);
  console.log(`built ${path.relative(REPO_ROOT, packageRoot)}: ${manifest.fileCount} files, ${scan.filesScanned} scanned, ${scan.hits.length} credential hits, ${problems.length} count problem(s)`);
  if (scan.hits.length > 0 || problems.length > 0) process.exit(1);
}

await main();
