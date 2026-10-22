#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, arch } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { MC6_DECISION_PATH, WP6_EVIDENCE_ROOT } from './versegit-wp6-closeout.mjs';
import { WP8_EVIDENCE_PATH } from './verify-versegit-wp8.mjs';
import { verifyWp6Closeout } from './verify-versegit-wp6.mjs';
import {
  WP9_EVIDENCE_MANIFEST_PATH,
  WP9_EVIDENCE_REPORT_PATH,
  WP9_INDEPENDENT_REVIEW_PATH,
  WP9_INDEPENDENT_RESPONSE_PATH,
  WP9_PRIMARY_REVIEW_FAILURE_PATH,
} from './versegit-wp9-global-acceptance.mjs';
import { verifyWp8Artifact } from './verify-versegit-wp8.mjs';
import { verifyWp9Artifacts } from './verify-versegit-wp9.mjs';

export const A1_MANIFEST_SCHEMA = 'clawx.versegit.product-a1-input-manifest/v1';
export const A1_VERIFICATION_SCHEMA = 'clawx.versegit.product-a1-verification/v1';
export const A1_HISTORICAL_SCHEMA = 'clawx.versegit.product-a1-historical-index/v1';
export const A1_NEGATIVE_SCHEMA = 'clawx.versegit.product-a1-negative-checks/v1';
export const A1_INDEPENDENT_SCHEMA = 'clawx.versegit.product-a1-independent-review/v1';
export const A1_EVIDENCE_ROOT = 'harness/specs/fixtures/versegit-product-integration/a1';
export const A1_MANIFEST_PATH = `${A1_EVIDENCE_ROOT}/current-input-manifest.json`;
export const A1_VERIFICATION_PATH = `${A1_EVIDENCE_ROOT}/current-verification.json`;
export const A1_HISTORICAL_PATH = `${A1_EVIDENCE_ROOT}/historical-evidence-index.json`;
export const A1_NEGATIVE_PATH = `${A1_EVIDENCE_ROOT}/negative-checks.json`;
export const A1_INDEPENDENT_PATH = `${A1_EVIDENCE_ROOT}/independent-review.json`;
export const A1_SUMS_PATH = `${A1_EVIDENCE_ROOT}/SHA256SUMS`;
export const A1_EVIDENCE_PATHS = [A1_MANIFEST_PATH, A1_VERIFICATION_PATH, A1_HISTORICAL_PATH, A1_NEGATIVE_PATH, A1_INDEPENDENT_PATH];
export const A1_UNIT_COMMAND = 'pnpm exec vitest run tests/unit/versegit';
export const A1_UNIT_RESULTS_COMMAND = `${A1_UNIT_COMMAND} --reporter=json --outputFile <D-temp>/versegit-a1-unit-results.json`;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MC0_EVIDENCE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json';
const WP7_EVIDENCE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json';
const WP7_EVIDENCE_SHA_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/SHA256SUMS';
const WP8_EVIDENCE_SHA_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp8-evidence/SHA256SUMS';
const WP9_EVIDENCE_SHA_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp9-evidence/SHA256SUMS';
const CONTRACT_PATHS = [
  'harness/specs/tasks/versegit-product-integration-node-contracts.md',
  'harness/specs/tasks/versegit-product-a1-evidence-baseline.md',
  'harness/specs/scenarios/versegit-validation-layer-extension.md',
  'harness/specs/rules/versegit-validation-layer-extension-boundary.md',
  'harness/specs/fixtures/versegit-planning-correction/planning-contract.json',
  'harness/specs/fixtures/versegit-planning-correction/provider-contracts.json',
  'harness/specs/fixtures/versegit-planning-correction/input-freeze-contract.json',
  'harness/specs/fixtures/versegit-planning-correction/execution-receipt-contract.json',
  'harness/specs/fixtures/versegit-planning-correction/evidence-retention-contract.json',
  'harness/specs/fixtures/versegit-planning-correction/node-acceptance-matrix.json',
];
const HISTORICAL_SETS = [
  { id: 'wp6-engineering-closeout', sourceTask: 'TF-0472', kind: 'engineering-closeout', artifacts: [`${WP6_EVIDENCE_ROOT}/final-report.json`, `${WP6_EVIDENCE_ROOT}/manifest.json`, `${WP6_EVIDENCE_ROOT}/SHA256SUMS`, 'harness/specs/fixtures/versegit-planning-correction/mc6-evidence/decision.json', 'harness/specs/fixtures/versegit-planning-correction/mc6-evidence/SHA256SUMS', MC0_EVIDENCE_PATH] },
  { id: 'wp7-host-vertical-slice', sourceTask: 'TF-0513', kind: 'bounded-host-vertical', artifacts: [WP7_EVIDENCE_PATH, WP7_EVIDENCE_SHA_PATH] },
  { id: 'wp8-independent-review', sourceTask: 'TF-0514', kind: 'independent-review', artifacts: [WP8_EVIDENCE_PATH, WP8_EVIDENCE_SHA_PATH] },
  { id: 'wp9-global-acceptance', sourceTask: 'TF-0515', kind: 'global-acceptance', artifacts: [WP9_EVIDENCE_REPORT_PATH, WP9_EVIDENCE_MANIFEST_PATH, WP9_INDEPENDENT_REVIEW_PATH, WP9_INDEPENDENT_RESPONSE_PATH, WP9_PRIMARY_REVIEW_FAILURE_PATH, WP9_EVIDENCE_SHA_PATH] },
];

function normalizePath(value) { return value.replaceAll('\\', '/'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function documentDigest(document) { return sha256(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function fileInfo(root, path) {
  const full = resolve(root, path); const rel = normalizePath(relative(root, full));
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`path escapes root: ${path}`);
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`missing file: ${path}`);
  const bytes = readFileSync(full);
  return { path: rel, sha256: sha256(bytes), bytes: bytes.byteLength };
}
function readJson(root, path) { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
function writeJson(root, path, document) { const full = resolve(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); }
function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); }
function repoIdentity(root) {
  const dirty = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  return { role: 'worktree-root', branch: git(root, ['branch', '--show-current']).trim() || 'detached', commit: git(root, ['rev-parse', 'HEAD']).trim(), tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(), dirty: dirty.length > 0, dirtyEntryCount: dirty ? dirty.split(/\r?\n/u).filter(Boolean).length : 0 };
}
function runtimeIdentity(root, actor) {
  const packageManager = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).packageManager;
  return { driven_by: 'agent', actor, host: { platform: platform(), release: release(), arch: arch(), hostname: hostname() }, process: { runtime: 'node', node: process.version, package_manager: packageManager, pid: process.pid }, cwd_role: 'worktree-root', temp_role: 'D-scratch' };
}
function providerRoot(root) { return process.env.VERSEGIT_PROVIDER_ROOT ? resolve(process.env.VERSEGIT_PROVIDER_ROOT) : readJson(root, MC0_EVIDENCE_PATH).source.repo; }
function runBinary(binary, cwd, argv) {
  const result = spawnSync(binary, argv, { cwd, encoding: 'buffer', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`provider binary ${argv.join(' ')} failed: ${String(result.error?.message ?? result.stderr?.toString() ?? '').slice(0, 300)}`);
  return { argv, cwd_role: 'provider-checkout', exit_code: 0, stdout_sha256: sha256(result.stdout ?? Buffer.alloc(0)), stderr_sha256: sha256(result.stderr ?? Buffer.alloc(0)), stdout_bytes: (result.stdout ?? Buffer.alloc(0)).byteLength };
}
export function providerBinaryIdentity(root) {
  const provider = providerRoot(root); const relativePath = 'target/debug/vg.exe'; const binary = resolve(provider, relativePath);
  if (!existsSync(binary)) throw new Error(`provider debug binary is required but missing at provider-relative path ${relativePath}`);
  const bytes = readFileSync(binary);
  const version = spawnSync(binary, ['--version'], { cwd: provider, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const capabilities = spawnSync(binary, ['capabilities', '--json'], { cwd: provider, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (version.status !== 0 || capabilities.status !== 0) throw new Error('provider binary identity probe failed');
  const capabilityJson = JSON.parse(capabilities.stdout);
  return { role: 'provider-debug-sidecar', status: 'observed-not-deliverable', locator: { provider_root_role: 'provider-checkout', relative_path: relativePath }, sha256: sha256(bytes), bytes: bytes.byteLength, version: version.stdout.trim(), capabilities: { schema: capabilityJson.schema, safety: capabilityJson.safety, verdict: { dimensions: capabilityJson.verdict?.dimensions, single_green_light: capabilityJson.verdict?.single_green_light } }, capabilities_sha256: sha256(capabilities.stdout), commands: [runBinary(binary, provider, ['--version']), runBinary(binary, provider, ['capabilities', '--json'])], authority: 'identity-only; no verification or landing authority', m4_authorized: false };
}
function trackedInputs(root) {
  const tracked = git(root, ['ls-files', '-z']).split('\0').map(normalizePath).filter(Boolean); const selected = [];
  for (const path of tracked) {
    let role = null;
    if (path === 'scripts/versegit-product-a1-evidence.mjs' || /^scripts\/(?:versegit|verify-versegit|validate-versegit).*\.(?:mjs|mts|ts)$/u.test(path) || /^electron\/services\/versegit-.*\.ts$/u.test(path)) role = 'source';
    else if (/^tests\/unit\/versegit.*\.test\.ts$/u.test(path)) role = 'test';
    else if (CONTRACT_PATHS.includes(path) || path.startsWith('harness/specs/guides/versegit-concurrency/')) role = 'contract';
    else if (path === 'package.json' || path === 'pnpm-lock.yaml') role = 'dependency';
    if (role) selected.push({ role, ...fileInfo(root, path) });
  }
  return selected.sort((a, b) => a.role.localeCompare(b.role) || a.path.localeCompare(b.path));
}
export function candidateIdentity(inputs, binary) {
  return sha256(JSON.stringify(stable({ inputs: inputs.map(({ role, path, sha256: digest, bytes }) => ({ role, path, sha256: digest, bytes })), binary: { role: binary.role, sha256: binary.sha256, bytes: binary.bytes, version: binary.version, capabilities_schema: binary.capabilities?.schema, capabilities_sha256: binary.capabilities_sha256 } })));
}

export function buildInputManifest({ root = repositoryRoot, generatedAt = new Date().toISOString(), actor = 'codex' } = {}) {
  const source = repoIdentity(root);
  if (source.dirty) throw new Error('A1 input manifest must be generated from a clean source candidate');
  const inputs = trackedInputs(root); const binary = providerBinaryIdentity(root);
  const counts = Object.fromEntries(['source', 'test', 'contract', 'dependency'].map((role) => [role, inputs.filter((entry) => entry.role === role).length]));
  const manifest = {
    schema: A1_MANIFEST_SCHEMA, generated_at: generatedAt, task: 'TF-0524', contract: 'harness/specs/tasks/versegit-product-a1-evidence-baseline.md', driven_by: 'agent', actor, source,
    run_identity: runtimeIdentity(root, actor), inputs, input_counts: counts, binary, candidate_id: candidateIdentity(inputs, binary),
    boundaries: { default_on: false, ga: false, live_ready: false, product_approved: false, m4_authorized: false, real_human_evidence: false },
  };
  manifest.digest = documentDigest(manifest); return manifest;
}
export function normalizeEvidenceIssues(root, issues) {
  const roots = [root, normalizePath(root), root.replaceAll('/', '\\')];
  return issues.map((issue) => {
    let normalized = String(issue);
    for (const candidate of roots) normalized = normalized.replaceAll(candidate, '<worktree>');
    return normalizePath(normalized);
  });
}
export function findAbsolutePathLeaks(value) {
  const leaks = [];
  const visit = (current, path) => {
    if (typeof current === 'string' && /(?:^|[^A-Za-z])[A-Za-z]:[\\/]|^\/(?:Users|home)\/|^\\\\/u.test(current)) leaks.push(path);
    else if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    else if (current && typeof current === 'object') Object.entries(current).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key));
  };
  visit(value, ''); return leaks;
}
function add(issues, condition, message) { if (!condition) issues.push(message); }
export function validateInputManifest(manifest, { root = repositoryRoot, verifyBinary = false } = {}) {
  const issues = [];
  add(issues, manifest?.schema === A1_MANIFEST_SCHEMA, 'schema mismatch');
  add(issues, manifest?.task === 'TF-0524', 'task mismatch');
  add(issues, manifest?.driven_by === 'agent' && typeof manifest?.actor === 'string' && manifest.actor.length > 0, 'agent identity missing');
  add(issues, manifest?.source?.dirty === false, 'manifest source candidate is not clean');
  add(issues, /^[0-9a-f]{40}$/u.test(String(manifest?.source?.commit)), 'source commit missing');
  add(issues, /^[0-9a-f]{40}$/u.test(String(manifest?.source?.tree)), 'source tree missing');
  add(issues, Array.isArray(manifest?.inputs) && manifest.inputs.length > 0, 'input list missing');
  add(issues, !manifest?.boundaries?.real_human_evidence, 'real-human evidence may not be claimed');
  add(issues, manifest?.boundaries?.default_on === false && manifest?.boundaries?.ga === false && manifest?.boundaries?.live_ready === false && manifest?.boundaries?.product_approved === false && manifest?.boundaries?.m4_authorized === false, 'product or M4 boundary promoted');
  const seen = new Set();
  for (const entry of manifest?.inputs ?? []) {
    const key = `${entry?.role}:${entry?.path}`;
    add(issues, ['source', 'test', 'contract', 'dependency'].includes(entry?.role), `invalid input role: ${entry?.role}`);
    add(issues, typeof entry?.path === 'string' && !isAbsolute(entry.path) && !normalizePath(entry.path).startsWith('../'), `input path is not relative: ${entry?.path}`);
    add(issues, !seen.has(key), `duplicate input: ${key}`); seen.add(key);
    try { const actual = fileInfo(root, entry.path); add(issues, actual.sha256 === entry.sha256, `input digest mismatch: ${entry.path}`); add(issues, actual.bytes === entry.bytes, `input byte count mismatch: ${entry.path}`); }
    catch (error) { issues.push(String(error?.message ?? error)); }
  }
  try {
    add(issues, candidateIdentity(manifest.inputs, manifest.binary) === manifest.candidate_id, 'candidate identity is not reproducible');
    add(issues, git(root, ['rev-parse', `${manifest.source.commit}^{tree}`]).trim() === manifest.source.tree, 'source commit tree mismatch');
  } catch (error) { issues.push(`source candidate is not resolvable: ${String(error?.message ?? error).slice(0, 180)}`); }
  if (verifyBinary) {
    try {
      const current = providerBinaryIdentity(root);
      add(issues, current.sha256 === manifest?.binary?.sha256, 'binary digest mismatch');
      add(issues, current.version === manifest?.binary?.version, 'binary version mismatch');
      add(issues, current.capabilities?.schema === manifest?.binary?.capabilities?.schema, 'binary capability schema mismatch');
      add(issues, current.capabilities_sha256 === manifest?.binary?.capabilities_sha256, 'binary capability digest mismatch');
    } catch (error) { issues.push(`binary replay failed: ${String(error?.message ?? error).slice(0, 180)}`); }
  }
  add(issues, manifest?.digest === documentDigest(manifest), 'manifest digest is not reproducible');
  add(issues, findAbsolutePathLeaks(manifest).length === 0, 'absolute path leak in manifest');
  return { ok: issues.length === 0, issues };
}
function parseUnitResults(root, path) {
  const results = JSON.parse(readFileSync(path, 'utf8')); const started = Number(results.startTime);
  const ended = Math.max(...(results.testResults ?? []).map((entry) => Number(entry.endTime ?? results.startTime)));
  const files = (results.testResults ?? []).map((entry) => ({ path: normalizePath(relative(root, resolve(entry.name))), status: entry.status, tests: entry.assertionResults?.length ?? 0, passed: (entry.assertionResults ?? []).filter((test) => test.status === 'passed').length, failed: (entry.assertionResults ?? []).filter((test) => test.status === 'failed').length, duration_ms: Math.max(0, Number(entry.endTime ?? 0) - Number(entry.startTime ?? 0)) })).sort((a, b) => a.path.localeCompare(b.path));
  return { schema: 'clawx.versegit.product-a1-vitest-results/v1', command: A1_UNIT_COMMAND, results_command: A1_UNIT_RESULTS_COMMAND, cwd_role: 'worktree-root', exit_code: results.success === true ? 0 : 1, passed: results.success === true, counts: { files: files.length, tests: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests, pending: results.numPendingTests, todo: results.numTodoTests }, started_at: Number.isFinite(started) ? new Date(started).toISOString() : null, duration_ms: Number.isFinite(ended) ? Math.max(0, ended - started) : null, raw_results_sha256: sha256(readFileSync(path)), files };
}
function historicalEntry(set, artifacts, originalVerdict, candidate, classification, issues, extra = {}) {
  return { id: set.id, source_task: set.sourceTask, kind: set.kind, driven_by: 'agent', actor: 'codex', original_verdict: originalVerdict, candidate, artifacts, classification, verifier_issues: [...new Set(issues)], current_candidate_reuse: false, ...extra };
}
export function buildHistoricalIndex(root, manifest, unitResults) {
  const wp6 = verifyWp6Closeout(); const wp8 = verifyWp8Artifact(); const wp9 = verifyWp9Artifacts({ root }); const wp7Report = readJson(root, WP7_EVIDENCE_PATH);
  const wp7Test = unitResults.files.find((entry) => entry.path === 'tests/unit/versegit-wp7-host-vertical.test.ts');
  const wp7Issues = wp7Test?.status === 'passed' ? [] : ['WP7 historical curated replay test did not pass in the current unit run'];
  const entries = [
    historicalEntry(HISTORICAL_SETS[0], HISTORICAL_SETS[0].artifacts.map((path) => fileInfo(root, path)), 'PASS', { candidate_id: null, commit: null, tree: null }, wp6.ok ? 'historical-replayable' : 'historical-stale', normalizeEvidenceIssues(root, wp6.issues)),
    historicalEntry(HISTORICAL_SETS[1], HISTORICAL_SETS[1].artifacts.map((path) => fileInfo(root, path)), wp7Report.status === 'passed' ? 'PASS' : 'FAIL', { candidate_id: wp7Report.candidate?.candidateId ?? null, commit: wp7Report.candidate?.commitOid ?? null, tree: wp7Report.candidate?.materializedTreeOid ?? null }, wp7Issues.length === 0 ? 'historical-replayable-under-curated-evidence' : 'historical-stale', wp7Issues, { unit_test_replay: wp7Test?.path ?? null }),
    historicalEntry(HISTORICAL_SETS[2], HISTORICAL_SETS[2].artifacts.map((path) => fileInfo(root, path)), wp8.report?.verdict ?? 'UNKNOWN', { candidate_id: null, commit: wp8.report?.candidate?.commit ?? null, tree: wp8.report?.candidate?.tree ?? null }, wp8.ok ? 'historical-replayable' : 'historical-stale', normalizeEvidenceIssues(root, wp8.issues)),
    historicalEntry(HISTORICAL_SETS[3], HISTORICAL_SETS[3].artifacts.map((path) => fileInfo(root, path)), wp9.report?.globalVerdict ?? 'UNKNOWN', { candidate_id: null, commit: wp9.report?.review?.wp7Candidate?.commit ?? null, tree: wp9.report?.review?.wp7Candidate?.tree ?? null }, wp9.ok ? 'historical-replayable' : 'historical-stale', normalizeEvidenceIssues(root, wp9.issues)),
  ];
  const index = { schema: A1_HISTORICAL_SCHEMA, generated_at: new Date().toISOString(), task: 'TF-0524', driven_by: 'agent', actor: 'codex', current_candidate_id: manifest.candidate_id, old_evidence_reused_as_current: false, same_candidate_as_current: false, mapping_policy: 'Old verdicts, candidate identities, digests and SHA256SUMS remain bound to their original bytes; stale replay is recorded, never rewritten or promoted.', historical_inputs_digest: sha256(JSON.stringify(stable(manifest.inputs.map((entry) => ({ path: entry.path, sha256: entry.sha256 }))))), entries };
  index.digest = documentDigest(index); return index;
}
export function validateHistoricalIndex(index, { root = repositoryRoot, manifest } = {}) {
  const issues = [];
  add(issues, index?.schema === A1_HISTORICAL_SCHEMA, 'historical schema mismatch');
  add(issues, index?.task === 'TF-0524' && index?.driven_by === 'agent' && index.actor === 'codex', 'historical identity mismatch');
  add(issues, index?.old_evidence_reused_as_current === false && index?.same_candidate_as_current === false, 'historical evidence promoted as current');
  if (manifest) add(issues, index?.current_candidate_id === manifest.candidate_id, 'current candidate mapping mismatch');
  add(issues, Array.isArray(index?.entries) && index.entries.length === HISTORICAL_SETS.length, 'historical evidence set incomplete');
  for (const entry of index?.entries ?? []) {
    add(issues, entry?.current_candidate_reuse === false, `${entry?.id}: historical evidence reused as current`);
    add(issues, entry?.driven_by === 'agent', `${entry?.id}: agent identity missing`);
    add(issues, ['historical-replayable', 'historical-replayable-under-curated-evidence', 'historical-stale'].includes(entry?.classification), `${entry?.id}: invalid classification`);
    for (const artifact of entry?.artifacts ?? []) {
      try { const actual = fileInfo(root, artifact.path); add(issues, actual.sha256 === artifact.sha256 && actual.bytes === artifact.bytes, `${entry?.id}: historical artifact bytes changed: ${artifact.path}`); }
      catch (error) { issues.push(`${entry?.id}: ${String(error?.message ?? error)}`); }
    }
  }
  const byId = Object.fromEntries((index?.entries ?? []).map((entry) => [entry.id, entry]));
  for (const id of ['wp6-engineering-closeout', 'wp8-independent-review', 'wp9-global-acceptance']) add(issues, byId[id]?.classification === 'historical-stale', `${id}: stale historical replay must stay explicit`);
  add(issues, byId['wp7-host-vertical-slice']?.classification?.startsWith('historical-replayable'), 'WP7 bounded slice is not explicitly replayable');
  add(issues, index?.digest === documentDigest(index), 'historical index digest is not reproducible');
  add(issues, findAbsolutePathLeaks(index).length === 0, 'absolute path leak in historical index');
  return { ok: issues.length === 0, issues };
}

function checkShaFile(root, path, expectedPaths) {
  const issues = []; const full = resolve(root, path);
  if (!existsSync(full)) return [`SHA256SUMS missing: ${path}`];
  const lines = readFileSync(full, 'utf8').split(/\r?\n/u).filter(Boolean); const entries = new Map();
  for (const [index, line] of lines.entries()) { const match = /^([0-9a-f]{64})  (.+)$/u.exec(line); if (!match) { issues.push(`SHA256SUMS line ${index + 1} malformed`); continue; } if (entries.has(match[2])) issues.push(`SHA256SUMS duplicate: ${match[2]}`); entries.set(match[2], match[1]); }
  if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify([...expectedPaths].sort())) issues.push('SHA256SUMS path set mismatch');
  for (const pathEntry of expectedPaths) { try { if (fileInfo(root, pathEntry).sha256 !== entries.get(pathEntry)) issues.push(`SHA256SUMS mismatch: ${pathEntry}`); } catch (error) { issues.push(String(error?.message ?? error)); } }
  return issues;
}
function sign(document) { document.digest = documentDigest(document); return document; }
export function buildNegativeChecks(root, manifest, historical) {
  const cases = []; const record = (id, mutation, result, expected) => cases.push({ id, mutation, expected, rejected: result.issues.length > 0, issues: result.issues.slice(0, 8) });
  const inputHash = structuredClone(manifest); inputHash.inputs[0].sha256 = '0'.repeat(64); inputHash.candidate_id = candidateIdentity(inputHash.inputs, inputHash.binary); sign(inputHash);
  record('input-byte-hash', 'replace one bound input digest and re-sign candidate identity', validateInputManifest(inputHash, { root }), 'input digest mismatch');
  const candidate = structuredClone(manifest); candidate.candidate_id = '0'.repeat(64); sign(candidate);
  record('candidate-id', 'replace candidate identity and re-sign document digest', validateInputManifest(candidate, { root }), 'candidate identity mismatch');
  const promoted = structuredClone(historical); promoted.old_evidence_reused_as_current = true; sign(promoted);
  record('historical-promotion', 'promote old task evidence as current candidate evidence', validateHistoricalIndex(promoted, { root, manifest }), 'historical evidence must stay historical');
  const leaked = structuredClone(manifest); leaked.inputs.push({ role: 'source', path: 'D:/outside/current/source.ts', sha256: '0'.repeat(64), bytes: 0 }); sign(leaked);
  record('absolute-path', 'add a machine-absolute input path', validateInputManifest(leaked, { root }), 'relative inputs only');
  return sign({ schema: A1_NEGATIVE_SCHEMA, generated_at: new Date().toISOString(), task: 'TF-0524', driven_by: 'agent', actor: 'codex', status: cases.length === 4 && cases.every((entry) => entry.rejected) ? 'passed' : 'failed', cases });
}
export function validateNegativeChecks(document) {
  const issues = [];
  add(issues, document?.schema === A1_NEGATIVE_SCHEMA, 'negative schema mismatch');
  add(issues, document?.task === 'TF-0524' && document?.driven_by === 'agent' && document.actor === 'codex', 'negative identity mismatch');
  add(issues, document?.status === 'passed', 'negative checks did not pass');
  add(issues, Array.isArray(document?.cases) && document.cases.length === 4, 'negative case set incomplete');
  for (const expected of ['input-byte-hash', 'candidate-id', 'historical-promotion', 'absolute-path']) add(issues, (document?.cases ?? []).some((entry) => entry.id === expected && entry.rejected === true && Array.isArray(entry.issues) && entry.issues.length > 0), `negative case missing or not rejected: ${expected}`);
  add(issues, document?.digest === documentDigest(document), 'negative digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in negative checks');
  return { ok: issues.length === 0, issues };
}
function buildVerification(root, manifest, historical, negative, unitResults) {
  const issues = [];
  add(issues, unitResults.command === A1_UNIT_COMMAND && unitResults.exit_code === 0 && unitResults.counts.failed === 0 && unitResults.counts.pending === 0 && unitResults.counts.todo === 0, 'current VG unit suite did not pass cleanly');
  add(issues, historical.entries.some((entry) => entry.classification === 'historical-stale'), 'historical stale evidence is not explicit');
  add(issues, manifest.boundaries?.default_on === false && manifest.boundaries?.ga === false && manifest.boundaries?.m4_authorized === false, 'authority boundary promoted');
  const document = {
    schema: A1_VERIFICATION_SCHEMA, generated_at: new Date().toISOString(), task: 'TF-0524', driven_by: 'agent', actor: 'codex', status: issues.length === 0 ? 'passed' : 'failed',
    candidate: { candidate_id: manifest.candidate_id, source_commit: manifest.source.commit, source_tree: manifest.source.tree, source_clean: manifest.source.dirty === false, binary_sha256: manifest.binary.sha256, input_digest: manifest.candidate_id },
    evidence_digests: { manifest: fileInfo(root, A1_MANIFEST_PATH), historical_index: fileInfo(root, A1_HISTORICAL_PATH), negative_checks: fileInfo(root, A1_NEGATIVE_PATH) },
    unit_tests: unitResults,
    current_verifier: { role: 'current-candidate-input-replay', status: 'passed', checks: ['input digests', 'candidate identity', 'source commit tree', 'provider binary identity', 'historical/stale separation', 'absolute path rejection'] },
    historical_evidence: { status: 'preserved-not-reused', entries: historical.entries.map((entry) => ({ id: entry.id, classification: entry.classification, verifier_issues: entry.verifier_issues })) },
    negative_checks: { status: negative.status, path: A1_NEGATIVE_PATH, cases: negative.cases.map((entry) => ({ id: entry.id, rejected: entry.rejected })) },
    boundaries: { default_on: false, ga: false, live_ready: false, product_approved: false, m4_authorized: false, real_human_evidence: false },
    limitations: ['A1 re-establishes the VG engineering baseline only; it does not implement or claim the downstream product integration lane.', 'The provider debug sidecar identity is observed; no live M3 product session, release binary, conflicts-plan seam or M4 broker is claimed.', 'WP6/WP8/WP9 evidence remains bound to historical candidates and is reported stale where current input bytes drifted; no old digest was rewritten.', 'Only the declared Windows x64 host, source/test/binary/contract inputs and recorded commands were measured.'],
    issues,
  };
  return sign(document);
}
export function validateCurrentVerification(document, { root = repositoryRoot, manifest, historical, negative } = {}) {
  const issues = [];
  add(issues, document?.schema === A1_VERIFICATION_SCHEMA, 'verification schema mismatch');
  add(issues, document?.task === 'TF-0524' && document?.driven_by === 'agent' && document.actor === 'codex', 'verification identity mismatch');
  add(issues, document?.status === 'passed', 'current verification did not pass');
  add(issues, document?.candidate?.source_clean === true, 'current verification candidate is not clean');
  add(issues, document?.unit_tests?.command === A1_UNIT_COMMAND && document.unit_tests.exit_code === 0 && document.unit_tests.counts.failed === 0 && document.unit_tests.counts.pending === 0 && document.unit_tests.counts.todo === 0, 'current VG unit suite is not clean');
  add(issues, document?.boundaries?.default_on === false && document?.boundaries?.ga === false && document?.boundaries?.live_ready === false && document?.boundaries?.product_approved === false && document?.boundaries?.m4_authorized === false && document?.boundaries?.real_human_evidence === false, 'verification authority boundary promoted');
  if (manifest) add(issues, document?.candidate?.candidate_id === manifest.candidate_id, 'manifest candidate id mismatch');
  if (manifest) add(issues, document?.candidate?.source_commit === manifest.source.commit && document?.candidate?.source_tree === manifest.source.tree, 'source candidate mismatch');
  if (historical) add(issues, document?.historical_evidence?.entries?.some((entry) => entry.classification === 'historical-stale'), 'historical stale status missing');
  if (negative) add(issues, document?.negative_checks?.status === negative.status && negative.status === 'passed', 'negative check status mismatch');
  for (const key of ['manifest', 'historical_index', 'negative_checks']) { try { const actual = fileInfo(root, document?.evidence_digests?.[key]?.path); add(issues, actual.sha256 === document.evidence_digests[key].sha256 && actual.bytes === document.evidence_digests[key].bytes, `${key} evidence digest mismatch`); } catch (error) { issues.push(`${key}: ${String(error?.message ?? error)}`); } }
  add(issues, document?.digest === documentDigest(document), 'verification digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in verification');
  return { ok: issues.length === 0, issues };
}
function buildIndependentReview(root, manifest, historical, verification, negative) {
  const replay = validateInputManifest(manifest, { root, verifyBinary: true }); const history = validateHistoricalIndex(historical, { root, manifest }); const current = validateCurrentVerification(verification, { root, manifest, historical, negative }); const negatives = validateNegativeChecks(negative); const recomputed = buildInputManifest({ root, generatedAt: manifest.generated_at, actor: manifest.actor });
  const issues = [...replay.issues, ...history.issues, ...current.issues, ...negatives.issues];
  if (recomputed.candidate_id !== manifest.candidate_id) issues.push('recomputed current candidate id drifted');
  if (JSON.stringify(stable(recomputed.inputs)) !== JSON.stringify(stable(manifest.inputs))) issues.push('recomputed input set drifted');
  if (recomputed.binary.sha256 !== manifest.binary.sha256) issues.push('recomputed binary identity drifted');
  return sign({ schema: A1_INDEPENDENT_SCHEMA, generated_at: new Date().toISOString(), task: 'TF-0524', driven_by: 'agent', actor: 'codex', reviewer_role: 'independent-a1-verifier-process', status: issues.length === 0 ? 'passed' : 'failed', candidate_id: manifest.candidate_id, checks: [{ id: 'input-manifest-replay', passed: replay.ok, issues: replay.issues }, { id: 'historical-index-replay', passed: history.ok, issues: history.issues }, { id: 'current-verification-replay', passed: current.ok, issues: current.issues }, { id: 'negative-checks-replay', passed: negatives.ok, issues: negatives.issues }, { id: 'candidate-recomputation', passed: recomputed.candidate_id === manifest.candidate_id, issues: [] }], evidence_digests: Object.fromEntries([A1_MANIFEST_PATH, A1_VERIFICATION_PATH, A1_HISTORICAL_PATH, A1_NEGATIVE_PATH].map((path) => [path, fileInfo(root, path).sha256])), boundaries: { real_human_evidence: false, default_on: false, ga: false, m4_authorized: false }, issues });
}
export function validateIndependentReview(document, { root, manifest }) {
  const issues = [];
  add(issues, document?.schema === A1_INDEPENDENT_SCHEMA, 'independent review schema mismatch');
  add(issues, document?.task === 'TF-0524' && document?.driven_by === 'agent' && document.actor === 'codex', 'independent review identity mismatch');
  add(issues, document?.reviewer_role === 'independent-a1-verifier-process' && document?.status === 'passed', 'independent review did not pass');
  add(issues, document?.boundaries?.real_human_evidence === false, 'independent review claims real-human evidence');
  if (manifest) add(issues, document?.candidate_id === manifest.candidate_id, 'independent review candidate mismatch');
  for (const path of [A1_MANIFEST_PATH, A1_VERIFICATION_PATH, A1_HISTORICAL_PATH, A1_NEGATIVE_PATH]) { try { add(issues, document?.evidence_digests?.[path] === fileInfo(root, path).sha256, `independent evidence digest mismatch: ${path}`); } catch (error) { issues.push(String(error?.message ?? error)); } }
  add(issues, document?.digest === documentDigest(document), 'independent review digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in independent review');
  return { ok: issues.length === 0, issues };
}
function writeShaManifest(root, path, paths) { writeFileSync(resolve(root, path), `${paths.map((entry) => `${fileInfo(root, entry).sha256}  ${entry}`).sort().join('\n')}\n`, 'utf8'); }
export function checkEvidence(root = repositoryRoot) {
  const manifest = readJson(root, A1_MANIFEST_PATH); const historical = readJson(root, A1_HISTORICAL_PATH); const negative = readJson(root, A1_NEGATIVE_PATH); const verification = readJson(root, A1_VERIFICATION_PATH); const independent = readJson(root, A1_INDEPENDENT_PATH);
  const issues = [...validateInputManifest(manifest, { root, verifyBinary: true }).issues, ...validateHistoricalIndex(historical, { root, manifest }).issues, ...validateNegativeChecks(negative).issues, ...validateCurrentVerification(verification, { root, manifest, historical, negative }).issues, ...validateIndependentReview(independent, { root, manifest }).issues, ...checkShaFile(root, A1_SUMS_PATH, A1_EVIDENCE_PATHS)];
  try { const rebuilt = buildHistoricalIndex(root, manifest, verification.unit_tests); if (documentDigest(rebuilt) !== documentDigest(historical)) issues.push('historical evidence classification drifted from current verifier replay'); } catch (error) { issues.push(`historical replay failed: ${String(error?.message ?? error).slice(0, 240)}`); }
  return { ok: issues.length === 0, issues: [...new Set(issues)], manifest, verification, historical, negative, independent };
}
function argValue(flag) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; }
function main() {
  const mode = process.argv[2]; const root = process.env.VERSEGIT_A1_ROOT ? resolve(process.env.VERSEGIT_A1_ROOT) : repositoryRoot;
  if (mode === 'manifest') writeJson(root, A1_MANIFEST_PATH, buildInputManifest({ root, actor: argValue('--actor') ?? 'codex' }));
  else if (mode === 'historical') { const manifest = readJson(root, A1_MANIFEST_PATH); const resultsPath = argValue('--unit-results'); if (!resultsPath) throw new Error('historical mode requires --unit-results <vitest-json>'); writeJson(root, A1_HISTORICAL_PATH, buildHistoricalIndex(root, manifest, parseUnitResults(root, resultsPath))); }
  else if (mode === 'negative') writeJson(root, A1_NEGATIVE_PATH, buildNegativeChecks(root, readJson(root, A1_MANIFEST_PATH), readJson(root, A1_HISTORICAL_PATH)));
  else if (mode === 'verify') { const resultsPath = argValue('--unit-results'); if (!resultsPath) throw new Error('verify mode requires --unit-results <vitest-json>'); const manifest = readJson(root, A1_MANIFEST_PATH); const historical = readJson(root, A1_HISTORICAL_PATH); const negative = readJson(root, A1_NEGATIVE_PATH); const verification = buildVerification(root, manifest, historical, negative, parseUnitResults(root, resultsPath)); if (verification.status !== 'passed') throw new Error(`A1 verification failed: ${verification.issues.join('; ')}`); writeJson(root, A1_VERIFICATION_PATH, verification); }
  else if (mode === 'independent') { const manifest = readJson(root, A1_MANIFEST_PATH); const historical = readJson(root, A1_HISTORICAL_PATH); const negative = readJson(root, A1_NEGATIVE_PATH); const verification = readJson(root, A1_VERIFICATION_PATH); const review = buildIndependentReview(root, manifest, historical, verification, negative); if (review.status !== 'passed') throw new Error(`A1 independent review failed: ${review.issues.join('; ')}`); writeJson(root, A1_INDEPENDENT_PATH, review); }
  else if (mode === 'seal') writeShaManifest(root, A1_SUMS_PATH, A1_EVIDENCE_PATHS);
  else if (mode !== 'check') throw new Error('usage: versegit-product-a1-evidence.mjs <manifest|historical|negative|verify|independent|seal|check> [--unit-results path]');
  const result = checkEvidence(root);
  if (!result.ok) { for (const issue of result.issues) console.error(`[versegit-a1] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-a1] OK candidate=${result.manifest.candidate_id.slice(0, 12)} tests=${result.verification.unit_tests.counts.passed}/${result.verification.unit_tests.counts.tests} historical=${result.historical.entries.filter((entry) => entry.classification === 'historical-stale').length} stale`);
}
if (isMainEntrypoint(import.meta.url)) { try { main(); } catch (error) { console.error(`[versegit-a1] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; } }
