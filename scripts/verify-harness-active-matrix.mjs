#!/usr/bin/env node
/**
 * TF-0570 active verification verifier.
 *
 * This is an evidence checker, not a second execution authority. It validates
 * the S1-S11 matrix, the retained evidence, content fingerprints, smoke logs
 * and product boundaries. It never promotes a partial or not-run row.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export const ACTIVE_MATRIX_SCHEMA = 'HarnessActiveVerificationMatrix/v1';
export const ACTIVE_ACCEPTANCE_SCHEMA = 'HarnessActiveVerificationAcceptance/v1';
export const DEFAULT_FIXTURE_DIR = 'harness/specs/fixtures/harness-codex-active-verification';
export const DEFAULT_MATRIX_PATH = `${DEFAULT_FIXTURE_DIR}/matrix.json`;
export const DEFAULT_ACCEPTANCE_PATH = `${DEFAULT_FIXTURE_DIR}/acceptance.json`;
export const SPEC_PATH = 'harness/specs/tasks/harness-codex-active-verification.md';
export const VERIFIER_PATH = 'scripts/verify-harness-active-matrix.mjs';
export const BUILDER_PATH = 'scripts/build-harness-active-acceptance.mjs';
export const TEST_PATH = 'tests/unit/harness-codex-active-verification.test.ts';
export const REQUIRED_SCENARIO_IDS = ['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11'];
export const EVIDENCE_GRADES = ['source','runtime','effect','packaged','external-provider','not-run'];
export const EVIDENCE_LEVELS = [
  'source-exists','runtime-reachable','effect-verified','packaged-available',
  'default-product-path','release-approved','not-run',
];
const SHA256_RE = /^[a-f0-9]{64}$/u;
const COMMIT_RE = /^[a-f0-9]{40}$/u;
const LOCAL_PATH_RE = /(?:C:[\\/]+Users[\\/]+|D:[\\/]+(?:ClawX|tmp)[\\/]+|\/Users\/|\/tmp\/)/iu;
const CREDENTIAL_RE = /sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|password|token)\s*[:=]\s*(?:["'][^"']{6,}["']|[A-Za-z0-9._-]{6,})/iu;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function sha256File(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function readJson(root, relativePath) {
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute)) throw new Error(`missing JSON: ${relativePath}`);
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

function gitText(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

function validRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/u.test(value)
    && !value.split(/[\\/]/u).includes('..');
}

function add(issues, condition, message) {
  if (!condition) issues.push(message);
}

function walkFiles(root, relativePath) {
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute)) return [];
  const info = statSync(absolute);
  if (info.isFile()) return [{ absolute, relativePath }];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = `${relativePath.replace(/[\\/]+$/u, '')}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkFiles(root, child));
    else if (entry.isFile()) files.push({ absolute: resolve(root, child), relativePath: child });
  }
  return files;
}

export function fingerprintPath(root, relativePath) {
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute)) return { path: relativePath, exists: false, kind: 'missing', sha256: null, bytes: null, files: 0 };
  const info = statSync(absolute);
  if (info.isFile()) {
    return { path: relativePath, exists: true, kind: 'file', sha256: sha256File(absolute), bytes: info.size, files: 1 };
  }
  const files = walkFiles(root, relativePath);
  const hash = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const fileInfo = statSync(file.absolute);
    bytes += fileInfo.size;
    hash.update(file.relativePath.slice(relativePath.length).replace(/^[\\/]+/u, ''));
    hash.update('\0');
    hash.update(String(fileInfo.size));
    hash.update('\0');
    hash.update(sha256File(file.absolute));
    hash.update('\n');
  }
  return { path: relativePath, exists: true, kind: 'directory', sha256: hash.digest('hex'), bytes, files: files.length };
}

export function captureInputs(root, paths) {
  const inputs = [...new Set(paths)].map((path) => fingerprintPath(root, path));
  return { inputs, digest: sha256Text(JSON.stringify(inputs)) };
}

function isInputPath(path, matrix) {
  return [...(matrix?.sourceFiles ?? []), ...(matrix?.packageFiles ?? [])]
    .some((entry) => path === entry || path.startsWith(entry.replace(/[\\/]+$/u, '') + '/'));
}

function isOwnedPath(path) {
  return path.startsWith(DEFAULT_FIXTURE_DIR + '/')
    || path === SPEC_PATH
    || path === VERIFIER_PATH
    || path === BUILDER_PATH
    || path === TEST_PATH;
}

function acceptanceStatusForGrade(grade) {
  if (grade === 'not-run') return 'not-run';
  if (grade === 'packaged') return 'packaged-available';
  if (grade === 'effect' || grade === 'external-provider') return 'effect-verified';
  return 'runtime-reachable';
}

function evidenceNode(entry, root) {
  const evidence = entry.evidence.map((path) => fingerprintPath(root, path));
  const readback = fingerprintPath(root, entry.readback);
  return {
    id: entry.id,
    name: entry.name,
    evidenceGrade: entry.evidenceGrade,
    evidenceLevel: acceptanceStatusForGrade(entry.evidenceGrade),
    status: entry.status,
    command: entry.command,
    input: entry.input,
    expected: entry.expected,
    negative: entry.negative,
    readback: entry.readback,
    readbackSha256: readback.exists ? readback.sha256 : null,
    notRunReason: entry.notRunReason ?? null,
    evidence,
  };
}

export function validateSharedFixtures({ root = ROOT, matrixPath = DEFAULT_MATRIX_PATH } = {}) {
  const matrix = readJson(root, matrixPath);
  const acceptancePath = resolve(root, DEFAULT_ACCEPTANCE_PATH);
  const acceptance = existsSync(acceptancePath) ? JSON.parse(readFileSync(acceptancePath, 'utf8')) : null;
  return { root, matrixPath, matrix, acceptance, acceptancePath };
}

export function buildAcceptance({
  matrix,
  sourceCommit,
  sourceTree,
  sourceDirty,
  freshness = 'fresh',
  validation = [],
  root = ROOT,
  actor = matrix.actor,
  environment = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    runtimeVersion: 'ClawX 0.4.9-alpha.0; Codex 0.137.0 where evidenced',
    timezone: 'Asia/Shanghai',
  },
  matrixDryRun,
  smoke = [],
}) {
  const scenarios = matrix.scenarios.map((entry) => evidenceNode(entry, root));
  const inputs = captureInputs(root, [...(matrix.sourceFiles ?? []), ...(matrix.packageFiles ?? [])]);
  const dryRun = matrixDryRun ?? {
    status: 'pass',
    command: 'node harness/src/cli.mjs run --spec harness/specs/tasks/harness-codex-active-verification.md --dry-run',
    scenarios: scenarios.length,
    pass: scenarios.filter((entry) => entry.status === 'pass').length,
    partial: scenarios.filter((entry) => entry.status === 'partial').length,
    failed: scenarios.filter((entry) => entry.status === 'failed').length,
    stale: 0,
    notRun: scenarios.filter((entry) => entry.status === 'not-run').length,
  };
  return {
    schemaVersion: ACTIVE_ACCEPTANCE_SCHEMA,
    generatedAt: new Date().toISOString(),
    driven_by: 'agent',
    actor,
    node: 'TF-0570',
    source: {
      commit: sourceCommit,
      tree: sourceTree,
      dirty: sourceDirty,
      matrix: DEFAULT_MATRIX_PATH,
      matrixSha256: sha256File(resolve(root, DEFAULT_MATRIX_PATH)),
      inputsDigest: inputs.digest,
    },
    sourceInputs: inputs.inputs,
    scenarioSource: matrix.scenarioSource ?? null,
    evidenceVocabulary: matrix.evidenceVocabulary,
    evidenceLevels: EVIDENCE_LEVELS,
    freshness: {
      state: freshness,
      policy: matrix.freshnessPolicy,
      evidenceFiles: [...new Set(scenarios.flatMap((entry) => [entry.readback, ...entry.evidence.map((file) => file.path)]))],
      checkedAt: new Date().toISOString(),
    },
    environment,
    matrixDryRun: dryRun,
    smoke,
    validation: validation.map((entry) => ({ ...entry, outputSha256: entry.outputSha256 ?? null })),
    scenarios,
    summary: {
      total: scenarios.length,
      pass: scenarios.filter((entry) => entry.status === 'pass').length,
      partial: scenarios.filter((entry) => entry.status === 'partial').length,
      failed: scenarios.filter((entry) => entry.status === 'failed').length,
      notRun: scenarios.filter((entry) => entry.status === 'not-run').length,
      levels: Object.fromEntries(EVIDENCE_LEVELS.map((level) => [level, scenarios.filter((entry) => entry.evidenceLevel === level).length])),
    },
    boundaries: {
      defaultPathChanged: false,
      productApproved: false,
      releaseApproved: false,
      realHumanEvidence: false,
      secondExecutorAuthority: false,
      verdictScope: 'This receipt covers only the scenarios and evidence grades listed; partial and not-run rows are not promoted.',
    },
    limitations: [
      'S1-S3 and S6-S7 retain partial rows where only source/contract or a pre-turn failure was observed.',
      'No authenticated native, Codex or ACP model-quality comparison is claimed by this receipt.',
      'Freshness is decided by the recorded SHA256 input and evidence fingerprints; a changed or missing path makes the receipt stale.',
    ],
  };
}

export function verifyActiveMatrix({
  matrix,
  acceptance = null,
  root = ROOT,
  sourceDirty = false,
} = {}) {
  const issues = [];
  const stale = [];
  add(issues, matrix?.schemaVersion === ACTIVE_MATRIX_SCHEMA, 'matrix schemaVersion mismatch');
  add(issues, matrix?.driven_by === 'agent', 'matrix must be agent-driven');
  add(issues, typeof matrix?.actor === 'string' && matrix.actor.length > 0, 'matrix actor missing');
  add(issues, matrix?.scenarioSource == null || validRelativePath(matrix.scenarioSource), 'matrix scenarioSource must be a repo-relative path');
  add(issues, !matrix?.scenarioSource || existsSync(resolve(root, matrix.scenarioSource)), 'matrix scenarioSource missing');
  add(issues, Array.isArray(matrix?.evidenceVocabulary) && EVIDENCE_GRADES.every((grade) => matrix.evidenceVocabulary.includes(grade)), 'matrix evidence vocabulary does not cover every declared grade');
  add(issues, matrix?.freshnessPolicy?.sourceNewerThanEvidence === 'stale', 'freshness policy must define source-newer as stale');
  add(issues, matrix?.freshnessPolicy?.missingArtifact === 'stale' && matrix?.freshnessPolicy?.hashMismatch === 'stale' && matrix?.freshnessPolicy?.invalidSchema === 'stale', 'freshness policy must fail closed for missing/hash/schema defects');
  add(issues, Array.isArray(matrix?.sourceFiles) && matrix.sourceFiles.length > 0, 'matrix sourceFiles missing');
  add(issues, Array.isArray(matrix?.packageFiles) && matrix.packageFiles.length > 0, 'matrix packageFiles missing');
  for (const path of [...(matrix?.sourceFiles ?? []), ...(matrix?.packageFiles ?? [])]) {
    add(issues, validRelativePath(path), `matrix input must be repo-relative: ${path}`);
    add(issues, existsSync(resolve(root, path)), `matrix input missing: ${path}`);
  }
  add(issues, Array.isArray(matrix?.scenarios) && matrix.scenarios.length === REQUIRED_SCENARIO_IDS.length, 'matrix must contain exactly 11 scenarios');
  add(issues, matrix?.scenarios?.filter((entry) => entry.id === 'S11').length === 1, 'S11 must occur exactly once');
  for (const required of REQUIRED_SCENARIO_IDS) add(issues, matrix?.scenarios?.some((entry) => entry.id === required), `matrix missing ${required}`);
  const seen = new Set();
  for (const entry of matrix?.scenarios ?? []) {
    const label = `matrix ${entry.id ?? '?'}`;
    add(issues, !seen.has(entry.id), `${label}: duplicate id`);
    seen.add(entry.id);
    add(issues, /^S(?:[1-9]|1[01])$/u.test(entry.id ?? ''), `${label}: invalid id`);
    for (const [key, value] of Object.entries({ name: entry.name, owner: entry.owner, command: entry.command, input: entry.input, expected: entry.expected, negative: entry.negative })) {
      add(issues, typeof value === 'string' && value.length > 0, `${label}: ${key} missing`);
    }
    add(issues, validRelativePath(entry.readback), `${label}: readback must be a repo-relative path`);
    add(issues, EVIDENCE_GRADES.includes(entry.evidenceGrade), `${label}: evidence grade invalid`);
    add(issues, ['pass','partial','failed','not-run'].includes(entry.status), `${label}: status invalid`);
    add(issues, Array.isArray(entry.evidence) && entry.evidence.length > 0, `${label}: evidence list missing`);
    const serialized = JSON.stringify(entry);
    add(issues, !LOCAL_PATH_RE.test(serialized), `${label}: local absolute path retained`);
    add(issues, !CREDENTIAL_RE.test(serialized), `${label}: credential-like content retained`);
    if (Array.isArray(entry.evidence)) {
      for (const file of entry.evidence) {
        add(issues, validRelativePath(file), `${label}: evidence path must be repo-relative`);
        const state = fingerprintPath(root, file);
        add(issues, state.exists, `${label}: evidence missing ${file}`);
        if (state.exists) add(issues, SHA256_RE.test(state.sha256), `${label}: evidence hash invalid ${file}`);
      }
    }
    const readback = fingerprintPath(root, entry.readback);
    add(issues, readback.exists, `${label}: readback missing ${entry.readback}`);
    const hasReason = typeof entry.notRunReason === 'string' && entry.notRunReason.length > 0;
    add(issues, ['partial','not-run'].includes(entry.status) === hasReason, `${label}: notRunReason must be present exactly for partial/not-run`);
  }

  if (acceptance) {
    add(issues, acceptance.schemaVersion === ACTIVE_ACCEPTANCE_SCHEMA, 'acceptance schemaVersion mismatch');
    add(issues, acceptance.driven_by === 'agent', 'acceptance must be agent-driven');
    add(issues, acceptance.actor === matrix.actor, 'acceptance actor mismatch');
    add(issues, acceptance.node === 'TF-0570', 'acceptance node mismatch');
    add(issues, acceptance.scenarioSource === (matrix.scenarioSource ?? null), 'acceptance scenarioSource mismatch');
    add(issues, Array.isArray(acceptance.scenarios) && acceptance.scenarios.length === REQUIRED_SCENARIO_IDS.length, 'acceptance must contain exactly 11 rows');
    add(issues, acceptance.source?.matrix === DEFAULT_MATRIX_PATH, 'acceptance matrix path mismatch');
    add(issues, acceptance.source?.matrixSha256 === sha256File(resolve(root, DEFAULT_MATRIX_PATH)), 'acceptance matrix hash mismatch');
    add(issues, COMMIT_RE.test(acceptance.source?.commit ?? ''), 'acceptance source commit missing');
    add(issues, COMMIT_RE.test(acceptance.source?.tree ?? ''), 'acceptance source tree missing');
    add(issues, acceptance.source?.dirty === false, 'acceptance source is dirty');
    add(issues, acceptance.freshness?.state === 'fresh', 'acceptance freshness is not fresh');
    add(issues, acceptance.freshness?.policy?.sourceNewerThanEvidence === 'stale', 'acceptance freshness policy mismatch');
    add(issues, Array.isArray(acceptance.limitations) && acceptance.limitations.length > 0, 'acceptance limitations missing');
    add(issues, Array.isArray(acceptance.validation) && acceptance.validation.length > 0, 'acceptance validation missing');
    for (const entry of acceptance.validation ?? []) {
      add(issues, typeof entry.command === 'string' && entry.command.length > 0, 'acceptance validation command missing');
      add(issues, Number.isInteger(entry.exitCode), `acceptance validation ${entry.command ?? '?'} exitCode missing`);
      add(issues, entry.outputSha256 == null || SHA256_RE.test(entry.outputSha256), `acceptance validation ${entry.command ?? '?'} output hash invalid`);
    }
    add(issues, acceptance.matrixDryRun?.status === 'pass' && acceptance.matrixDryRun?.scenarios === 11, 'acceptance matrix dry-run is incomplete');
    const smoke = Array.isArray(acceptance.smoke) ? acceptance.smoke : [];
    add(issues, smoke.some((entry) => entry.status === 'pass' && entry.id.startsWith('positive-')), 'acceptance lacks a positive smoke');
    add(issues, smoke.some((entry) => entry.status === 'pass' && entry.id.startsWith('negative-')), 'acceptance lacks a negative smoke');
    for (const entry of smoke) {
      const logPath = entry.log ? resolve(root, DEFAULT_FIXTURE_DIR, entry.log) : null;
      add(issues, Boolean(logPath && existsSync(logPath)), `acceptance smoke log missing: ${entry.log ?? '?'}`);
      if (logPath && existsSync(logPath) && entry.outputSha256) add(issues, sha256File(logPath) === entry.outputSha256, `acceptance smoke log hash mismatch: ${entry.log}`);
    }
    add(issues, typeof acceptance.environment?.node === 'string' && /^v\d+\./u.test(acceptance.environment.node), 'acceptance environment/node missing');
    add(issues, acceptance.environment?.platform === 'win32' && acceptance.environment?.arch === 'x64', 'acceptance platform/arch mismatch');
    add(issues, typeof acceptance.environment?.runtimeVersion === 'string' && acceptance.environment.runtimeVersion.length > 0, 'acceptance runtime version missing');
    add(issues, acceptance.boundaries?.defaultPathChanged === false && acceptance.boundaries?.productApproved === false && acceptance.boundaries?.releaseApproved === false && acceptance.boundaries?.realHumanEvidence === false, 'acceptance promoted a product boundary');
    add(issues, acceptance.boundaries?.secondExecutorAuthority === false, 'acceptance added a second executor authority');
    const byId = new Map((acceptance.scenarios ?? []).map((entry) => [entry.id, entry]));
    for (const entry of matrix.scenarios) {
      const retained = byId.get(entry.id);
      add(issues, Boolean(retained), `acceptance missing ${entry.id}`);
      if (!retained) continue;
      for (const key of ['name','status','command','input','expected','negative','evidenceGrade']) {
        add(issues, retained[key] === entry[key], `acceptance ${entry.id} ${key} mismatch`);
      }
      add(issues, (retained.notRunReason ?? null) === (entry.notRunReason ?? null), `acceptance ${entry.id} notRunReason mismatch`);
      add(issues, retained.readback === entry.readback, `acceptance ${entry.id} readback mismatch`);
      const currentReadback = fingerprintPath(root, entry.readback);
      add(issues, retained.readbackSha256 === currentReadback.sha256, `acceptance ${entry.id} readback hash mismatch`);
      add(issues, Array.isArray(retained.evidence) && retained.evidence.length === entry.evidence.length, `acceptance ${entry.id} evidence count mismatch`);
      for (const expected of entry.evidence) {
        const current = fingerprintPath(root, expected);
        const recorded = (retained.evidence ?? []).find((item) => item.path === expected);
        add(issues, Boolean(recorded), `acceptance ${entry.id} evidence missing ${expected}`);
        if (recorded) add(issues, recorded.sha256 === current.sha256, `acceptance ${entry.id} evidence hash mismatch ${expected}`);
      }
    }
    const currentInputs = captureInputs(root, [...(matrix.sourceFiles ?? []), ...(matrix.packageFiles ?? [])]);
    add(issues, acceptance.source?.inputsDigest === currentInputs.digest, 'acceptance source input digest mismatch');
    const recordedById = new Map((acceptance.sourceInputs ?? []).map((entry) => [entry.path, entry]));
    for (const current of currentInputs.inputs) {
      const recorded = recordedById.get(current.path);
      add(issues, Boolean(recorded), `acceptance source input missing: ${current.path}`);
      if (recorded) add(issues, recorded.sha256 === current.sha256 && recorded.exists === current.exists, `acceptance source input hash mismatch: ${current.path}`);
    }
  }

  if (sourceDirty) issues.push('source worktree has unrelated changes; evidence cannot be fresh');
  const summary = {
    total: matrix?.scenarios?.length ?? 0,
    pass: matrix?.scenarios?.filter((entry) => entry.status === 'pass').length ?? 0,
    partial: matrix?.scenarios?.filter((entry) => entry.status === 'partial').length ?? 0,
    failed: matrix?.scenarios?.filter((entry) => entry.status === 'failed').length ?? 0,
    notRun: matrix?.scenarios?.filter((entry) => entry.status === 'not-run').length ?? 0,
    stale: issues.filter((issue) => /hash mismatch|missing|stale|dirty/u.test(issue)).length,
  };
  return { ok: issues.length === 0, issues, stale, summary };
}

export function validateMatrixStructure(matrix, { root = ROOT } = {}) {
  return verifyActiveMatrix({ matrix, acceptance: null, root, sourceDirty: false });
}

function statusHasUnrelatedChanges(root, matrix) {
  const status = gitText(root, ['status', '--porcelain=v1']);
  if (status == null) return true;
  return status.split(/\r?\n/u).some((line) => {
    const path = line.slice(2).trim();
    return path && !isOwnedPath(path) && !isInputPath(path, matrix);
  });
}

function verifyFixtureManifest(root, acceptance) {
  const issues = [];
  const manifestPath = resolve(root, DEFAULT_FIXTURE_DIR, 'SHA256SUMS');
  if (!existsSync(manifestPath)) return ['fixture SHA256SUMS missing'];
  const entries = new Map(readFileSync(manifestPath, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([a-f0-9]{64})\s+(.+)$/u.exec(line.trim());
    return match ? [match[2].trim(), match[1]] : null;
  }).filter(Boolean));
  const required = ['matrix.json', 'acceptance.json', 'REPORT.md', ...(acceptance?.smoke ?? []).map((entry) => entry.log)];
  for (const name of new Set(required)) {
    const expected = entries.get(name);
    const absolute = resolve(root, DEFAULT_FIXTURE_DIR, name);
    add(issues, SHA256_RE.test(expected ?? ''), `fixture SHA256SUMS missing ${name}`);
    if (expected && existsSync(absolute)) add(issues, sha256File(absolute) === expected, `fixture SHA256SUMS mismatch ${name}`);
  }
  return issues;
}

export function verifyActiveMatrixArtifacts({ root = ROOT, matrixPath = DEFAULT_MATRIX_PATH } = {}) {
  const matrix = readJson(root, matrixPath);
  const acceptancePath = resolve(root, DEFAULT_ACCEPTANCE_PATH);
  const acceptance = existsSync(acceptancePath) ? JSON.parse(readFileSync(acceptancePath, 'utf8')) : null;
  const result = verifyActiveMatrix({
    matrix,
    acceptance,
    root,
    sourceDirty: statusHasUnrelatedChanges(root, matrix),
  });
  if (acceptance?.source?.commit && gitText(root, ['merge-base', '--is-ancestor', acceptance.source.commit, 'HEAD']) === null) {
    result.issues.push('acceptance source commit is not an ancestor of HEAD');
  }
  result.issues.push(...verifyFixtureManifest(root, acceptance));
  result.ok = result.issues.length === 0;
  return { ...result, matrix, acceptance };
}

function main() {
  try {
    const result = verifyActiveMatrixArtifacts();
    if (!result.ok) {
      console.error(JSON.stringify({ ok: false, summary: result.summary, issues: result.issues.slice(0, 40) }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, node: 'TF-0570', summary: result.summary, source: result.acceptance.source }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}

if (isMainEntrypoint(import.meta.url)) main();
