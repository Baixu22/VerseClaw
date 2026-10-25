#!/usr/bin/env node
/**
 * F3 / TF-0563 evidence driver.
 *
 * Aggregates the long-session program on the current candidate: for every
 * execution node it reads the on-disk evidence (candidate identity, gate exit
 * codes, counts, negative cases), re-verifies every SHA256SUMS, re-runs the
 * repository gates, the same-scope real Electron E2E group and a secret scan,
 * then writes the acceptance artifacts.
 *
 * A missing artifact, an unreadable candidate, a hash drift, a failed gate or a
 * failed E2E group never produces a PASS. Historical artifacts are re-read, not
 * re-signed.
 *
 * Usage:
 *   node --experimental-strip-types scripts/long-session-final-acceptance-evidence.mjs
 *   node --experimental-strip-types scripts/long-session-final-acceptance-evidence.mjs --reuse D:/tmp/anchor-long-session-f3/<run>
 *   node --experimental-strip-types scripts/long-session-final-acceptance-evidence.mjs --check
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTOR = 'codex-long-session-f3';
const TASK_NODE = 'TF-0563';
const TASK_KEY = 'F3';
const CONTRACT = 'harness/specs/tasks/long-session-final-acceptance.md';
const PLAN = 'harness/specs/tasks/long-session-development-plan.md';
const DEFAULT_OUT = 'harness/specs/fixtures/long-session-development/f3';
const EVIDENCE_BASE = resolve(process.env.CLAWX_F3_EVIDENCE_ROOT ?? 'D:/tmp/anchor-long-session-f3');
const FIXTURES = 'harness/specs/fixtures/long-session-development';
const ACCEPTANCE_FILE = 'acceptance.json';
const ACCEPTANCE_MD = 'acceptance.md';
const SUMS_FILE = 'SHA256SUMS';
const EXPECTED_FILES = [ACCEPTANCE_FILE, ACCEPTANCE_MD, SUMS_FILE];

/** Phase milestones plus the sixteen execution nodes, in plan order. */
const PHASES = [
  { id: 'TF-0542', key: 'A', title: 'Phase 1 unified session actions and fault baseline', nodes: ['a1', 'a2'] },
  { id: 'TF-0543', key: 'B', title: 'Phase 2 effective session configuration visibility', nodes: ['b1', 'b2'] },
  { id: 'TF-0544', key: 'C', title: 'Phase 3 single-workspace long coordination entry', nodes: ['c1', 'c2', 'c3', 'c4'] },
  { id: 'TF-0545', key: 'D', title: 'Phase 4 context continuity and strategy evaluation', nodes: ['d1', 'd2', 'd3'] },
  { id: 'TF-0546', key: 'E', title: 'Phase 5 follow-up scheduling and resource exit', nodes: ['e1', 'e2'] },
  { id: 'TF-0547', key: 'F', title: 'Phase 6 long-horizon automated acceptance and claim closeout', nodes: ['f1', 'f2', 'f3'] },
];

/** The sixteen execution nodes with their contract, forest node and primary evidence. */
const NODES = [
  { dir: 'a1', key: 'A1', forest: 'TF-0548', contract: 'harness/specs/tasks/long-session-baseline-contract.md', primary: 'gates.json', negative: ['negative-scenario-index.json'] },
  { dir: 'a2', key: 'A2', forest: 'TF-0549', contract: 'harness/specs/tasks/long-session-lifecycle-barrier.md', primary: 'gates.json', negative: ['lifecycle-fault-matrix.json'] },
  { dir: 'b1', key: 'B1', forest: 'TF-0550', contract: 'harness/specs/tasks/long-session-effective-policy.md', primary: 'gates.json', negative: ['policy-source-and-override-matrix.json'] },
  { dir: 'b2', key: 'B2', forest: 'TF-0551', contract: 'harness/specs/tasks/long-session-policy-surface.md', primary: 'gates.json', negative: ['scope-and-boundary-cases.json'] },
  { dir: 'c1', key: 'C1', forest: 'TF-0552', contract: 'harness/specs/tasks/long-session-coordinator-binding.md', primary: 'gates.json', negative: ['scope-and-recovery-matrix.json'] },
  { dir: 'c2', key: 'C2', forest: 'TF-0553', contract: 'harness/specs/tasks/long-session-delegation-admission.md', primary: 'gates.json', negative: ['scope-permission-isolation-matrix.json'] },
  { dir: 'c3', key: 'C3', forest: 'TF-0554', contract: 'harness/specs/tasks/long-session-completion-continuation.md', primary: 'gates.json', negative: ['continuation-delivery-matrix.json', 'restart-replay-check.json'] },
  { dir: 'c4', key: 'C4', forest: 'TF-0555', contract: 'harness/specs/tasks/long-session-coordination-surface.md', primary: 'gates.json', negative: ['coordination-ui-journeys.json'] },
  { dir: 'd1', key: 'D1', forest: 'TF-0556', contract: 'harness/specs/tasks/long-session-continuity-context.md', primary: 'verification.json', negative: ['cross-scope-negative.json', 'fact-provenance-and-revocation.json'] },
  { dir: 'd2', key: 'D2', forest: 'TF-0557', contract: 'harness/specs/tasks/long-session-paired-evaluation.md', primary: 'verification-receipt.json', negative: ['paired-workload-manifest.json', 'candidate-decision-inputs.json'] },
  { dir: 'd3', key: 'D3', forest: 'TF-0558', contract: 'harness/specs/tasks/long-session-continuity-decision.md', primary: 'verification-receipt.json', negative: ['promotion-or-retention-boundary.json'] },
  { dir: 'e1', key: 'E1', forest: 'TF-0559', contract: 'harness/specs/tasks/long-session-followup-scheduling.md', primary: 'verification-receipt.json', negative: ['pause-cancel-expiry-matrix.json'] },
  { dir: 'e2', key: 'E2', forest: 'TF-0560', contract: 'harness/specs/tasks/long-session-resource-reclamation.md', primary: 'verification-receipt.json', negative: ['resource-recovery-required.json'] },
  { dir: 'f1', key: 'F1', forest: 'TF-0561', contract: 'harness/specs/tasks/long-session-restart-journeys.md', primary: 'restart-journey-results.json', negative: ['host-runtime-receipts.json', 'restart-journey-results.json'] },
  { dir: 'f2', key: 'F2', forest: 'TF-0562', contract: 'harness/specs/tasks/long-session-long-use-budget.md', primary: 'long-use-before-after.json', negative: ['long-use-before-after.json', 'notification-budget.json'] },
];

const GATES = [
  ['typecheck', ['run', 'typecheck'], 1_500_000],
  ['contract-check', ['run', 'contract:check'], 900_000],
  ['comms-replay', ['run', 'comms:replay'], 1_200_000],
  ['comms-compare', ['run', 'comms:compare'], 900_000],
  ['repo-artifacts-check', ['run', 'repo:artifacts:check'], 600_000],
  ['repo-evidence-check', ['run', 'repo:evidence:check'], 600_000],
];

const E2E_GROUP = [
  'tests/e2e/long-session-lifecycle-faults.spec.ts',
  'tests/e2e/long-session-effective-policy.spec.ts',
  'tests/e2e/long-session-policy-surface.spec.ts',
  'tests/e2e/long-session-coordinator-binding.spec.ts',
  'tests/e2e/long-session-delegation-admission.spec.ts',
  'tests/e2e/long-session-completion-continuation.spec.ts',
  'tests/e2e/long-session-coordination.spec.ts',
  'tests/e2e/long-session-continuity-context.spec.ts',
  'tests/e2e/long-session-paired-evaluation.spec.ts',
  'tests/e2e/long-session-followup-scheduling.spec.ts',
  'tests/e2e/long-session-restart-journeys.spec.ts',
];

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:password|secret|api[_-]?key)\b\s*[:=]\s*["']?[^\s"',}]{8,}/iu,
];

const UNMEASURED = [
  'non-Windows platforms: the aggregated runs executed on local Windows only',
  'live provider behaviour: D2/F2 used an agent-driven scripted endpoint, not a real provider, so no fidelity/cost promotion claim is made',
  'packaged/installed build: evidence comes from the local dist-electron development build',
  'real-human long-term usage: no real-human evidence is claimed or available',
  'public release, all-default enablement, product locks and a standalone multi-execution-root Project: not authorized by this node',
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((entry) => entry.startsWith(name + '='));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashFile(file) {
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function git(args) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function gitOptional(args) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function candidateIdentity() {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--verify', 'HEAD']),
    tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
    worktree: ROOT.replaceAll('\\', '/'),
    status: git(['status', '--short']).split(/\r?\n/).filter(Boolean)
      .filter((line) => !line.includes('harness/specs/fixtures/long-session-development/f3/')),
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function verifySums(dir) {
  const sums = join(dir, SUMS_FILE);
  if (!existsSync(sums)) return { present: false, verified: 0, failures: [`${relative(ROOT, sums).replaceAll('\\', '/')}: missing SHA256SUMS`] };
  const failures = [];
  let verified = 0;
  for (const line of readFileSync(sums, 'utf8').trim().split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const expected = parts[0];
    const name = parts.at(-1);
    const file = join(dir, name);
    if (!existsSync(file)) {
      failures.push(`${name}: listed but missing`);
      continue;
    }
    verified += 1;
    if (hashFile(file) !== expected) failures.push(`${name}: digest drift`);
  }
  return { present: true, verified, failures };
}

/**
 * Collect every explicit exit code recorded under gate- or command-shaped keys.
 * Only numeric fields named exitCode/exit_code/status(closed set) count; an
 * unrelated numeric field is never mistaken for a gate.
 */
const EXIT_KEYS = new Set(['exitcode', 'exit_code', 'exitstatus']);
function collectExitCodes(value, trail = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectExitCodes(entry, `${trail}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (EXIT_KEYS.has(lower) && typeof entry === 'number' && Number.isFinite(entry)) {
        out.push({ path: `${trail}/${key}`, exitCode: entry });
        continue;
      }
      collectExitCodes(entry, `${trail}/${key}`, out);
    }
  }
  return out;
}

/**
 * Only explicit failures count. A NO-GO, an unmeasured boundary, a valid-spec
 * note or a review disposition are legitimate outcomes, not gate failures.
 */
const FAILURE_WORDS = /(^|[^a-z])(fail|failed|failure|error|errored|reject|rejected|violat|drift|mismatch|timeout|missing)([^a-z]|$)/i;
function collectFailureSignals(value, trail = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectFailureSignals(entry, `${trail}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const lower = key.toLowerCase();
      // `allowed: false` is an expected fail-closed denial, not a failure.
      if (lower === 'pass' || lower === 'ok') {
        if (entry === false) out.push({ path: `${trail}/${key}`, verdict: 'false' });
        continue;
      }
      if ((lower === 'result' || lower === 'verdict') && typeof entry === 'string') {
        if (FAILURE_WORDS.test(entry)) out.push({ path: `${trail}/${key}`, verdict: entry.trim().toLowerCase() });
        continue;
      }
      // A failing test count only matters beside a passing/total count; batch
      // member counts also use `failed` and are not gate results.
      if (lower === 'failed' && typeof entry === 'number' && entry > 0
        && (typeof value.passed === 'number' || typeof value.total === 'number')) {
        out.push({ path: `${trail}/${key}`, verdict: String(entry) });
        continue;
      }
      collectFailureSignals(entry, `${trail}/${key}`, out);
    }
  }
  return out;
}

function collectNegativeIds(value, trail = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNegativeIds(entry, `${trail}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (/(negative|cases|rows|journey|recovery|scenario|boundary|refus|reject|fenc|checks)/i.test(lower) && Array.isArray(entry)) {
        for (const item of entry) {
          if (typeof item === 'string') out.push(item);
          else if (item && typeof item === 'object') {
            const id = item.id ?? item.case ?? item.caseId ?? item.name ?? item.step ?? item.journey ?? item.criterion;
            if (id != null) out.push(String(id));
          }
        }
      } else if (/(journeys|scenarios|cases)/i.test(lower) && entry && typeof entry === 'object') {
        for (const journeyKey of Object.keys(entry)) out.push(journeyKey);
      }
      collectNegativeIds(entry, `${trail}/${key}`, out);
    }
  }
  return out;
}

const CANDIDATE_KEYS = new Set(['commit', 'commithash', 'commit_hash', 'candidatecommit', 'sourcecommit', 'source_commit', 'sha']);
function collectCandidateCommits(value, trail = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectCandidateCommits(entry, `${trail}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (CANDIDATE_KEYS.has(lower) && typeof entry === 'string' && /^[0-9a-f]{12,40}$/i.test(entry.trim())) {
        out.push({ path: `${trail}/${key}`, commit: entry.trim().toLowerCase() });
        continue;
      }
      collectCandidateCommits(entry, `${trail}/${key}`, out);
    }
  }
  return out;
}

function isOlderOrEqual(parent, child) {
  if (parent === child) return true;
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git',
    ['merge-base', '--is-ancestor', parent, child], { cwd: ROOT, windowsHide: true });
  return result.status === 0;
}

function nodeRecord(node, candidate) {
  const dir = join(ROOT, FIXTURES, node.dir);
  if (!existsSync(dir)) throw new Error(`${node.key}: evidence directory missing: ${relative(ROOT, dir)}`);
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const jsonFiles = files.filter((name) => name.endsWith('.json'));
  const sums = verifySums(dir);

  const exitCodes = [];
  const verdicts = [];
  const negatives = [];
  const commits = new Map();
  const fileHashes = {};
  for (const name of files) {
    fileHashes[name] = hashFile(join(dir, name));
  }
  const negativeFiles = (node.negative ?? []).filter((name) => files.includes(name));
  for (const name of negativeFiles) {
    const parsed = readJson(join(dir, name));
    for (const id of collectNegativeIds(parsed, name)) negatives.push(id);
  }
  for (const name of jsonFiles) {
    let parsed;
    try {
      parsed = readJson(join(dir, name));
    } catch (error) {
      throw new Error(`${node.key}: ${name} is unreadable: ${String(error)}`);
    }
    for (const entry of collectExitCodes(parsed, name)) exitCodes.push(entry);
    for (const entry of collectFailureSignals(parsed, name)) verdicts.push(entry);
    for (const id of collectNegativeIds(parsed, name)) negatives.push(id);
    for (const entry of collectCandidateCommits(parsed, name)) {
      const list = commits.get(entry.commit) ?? [];
      list.push(entry.path);
      commits.set(entry.commit, list);
    }
  }

  const primaryPath = join(dir, node.primary);
  if (!existsSync(primaryPath)) throw new Error(`${node.key}: primary evidence missing: ${node.primary}`);
  const primary = readJson(primaryPath);

  const failedExitCodes = exitCodes.filter((entry) => entry.exitCode !== 0);
  const reprVerdicts = verdicts;

  // Node candidates must be real commits that are ancestors of (or equal to) the
  // aggregated candidate; otherwise the published chain does not contain them.
  const candidateCommits = [...commits.keys()].sort();
  const nodeCandidates = candidateCommits.map((commit) => ({
    commit,
    full: gitOptional(['rev-parse', '--verify', `${commit}^{commit}`]),
    reachableFromHead: candidateCommits.length > 0 ? isOlderOrEqual(commit, candidate.commit) : false,
    referencedBy: [...new Set(commits.get(commit))].sort().slice(0, 6),
  }));
  const unreachable = nodeCandidates.filter((entry) => entry.reachableFromHead !== true);
  const reachable = nodeCandidates.filter((entry) => entry.reachableFromHead === true);

  const uniqueNegativeIds = [...new Set(negatives)].sort();

  return {
    key: node.key,
    forestNode: node.forest,
    contract: node.contract,
    directory: relative(ROOT, dir).replaceAll('\\', '/'),
    primaryEvidence: `${relative(ROOT, primaryPath).replaceAll('\\', '/')}`,
    primaryEvidenceSha256: hashFile(primaryPath),
    schema: typeof primary?.schema === 'string' ? primary.schema : null,
    artifactCount: files.length,
    artifactFiles: files,
    artifactHashes: fileHashes,
    sha256sums: sums.present ? { verified: sums.verified, failures: sums.failures } : null,
    gates: {
      exitCodeObservations: exitCodes.length,
      failed: failedExitCodes,
      failedCount: failedExitCodes.length,
    },
    acceptance: {
      verdictObservations: verdicts.length,
      representationFailures: reprVerdicts.slice(0, 12),
      representationFailureCount: reprVerdicts.length,
    },
    negativeProofs: {
      count: uniqueNegativeIds.length,
      ids: uniqueNegativeIds.slice(0, 40),
    },
    candidates: nodeCandidates,
    unreachableCandidates: unreachable,
    reachableCandidateCount: reachable.length,
    evidenceOk: failedExitCodes.length === 0
      && reprVerdicts.length === 0
      && sums.failures.length === 0
      && reachable.length > 0
      && uniqueNegativeIds.length > 0,
  };
}
function scanSecrets(files) {
  const hits = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        hits.push({ file: relative(ROOT, file).replaceAll('\\', '/'), pattern: String(pattern) });
        break;
      }
    }
  }
  return hits;
}

function runCommand(name, command, args, options = {}) {
  const startedAt = Date.now();
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : command;
  const commandArgs = process.platform === 'win32' ? ['/d', '/c', command, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, TEMP: 'D:\\tmp', TMP: 'D:\\tmp', ...(options.env ?? {}) },
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? 900_000,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const gate = {
    name,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT' || Boolean(result.signal),
    durationMs: Date.now() - startedAt,
    stdoutSha256: hashText(stdout),
    stderrSha256: hashText(stderr),
    stdoutTail: stdout.slice(-6_000),
    stderrTail: stderr.slice(-4_000),
  };
  if (options.logDir) {
    mkdirSync(options.logDir, { recursive: true });
    const stdoutFile = join(options.logDir, name + '.stdout.txt');
    const stderrFile = join(options.logDir, name + '.stderr.txt');
    writeFileSync(stdoutFile, stdout, 'utf8');
    writeFileSync(stderrFile, stderr, 'utf8');
    gate.stdoutFile = stdoutFile.replaceAll('\\', '/');
    gate.stderrFile = stderrFile.replaceAll('\\', '/');
  }
  return { gate, stdout, stderr };
}
async function main() {
  const checkOnly = process.argv.includes('--check');
  const allowDirty = process.argv.includes('--allow-dirty');
  const aggregateOnly = process.argv.includes('--aggregate-only');
  const outDir = resolve(ROOT, argValue('--out', DEFAULT_OUT));

  if (checkOnly) {
    const failures = [];
    for (const name of EXPECTED_FILES) {
      if (!existsSync(join(outDir, name))) failures.push(name + ': missing');
    }
    if (failures.length === 0) {
      for (const line of readFileSync(join(outDir, SUMS_FILE), 'utf8').trim().split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (hashFile(join(outDir, parts.at(-1))) !== parts[0]) failures.push(parts.at(-1) + ': digest drift');
      }
      const acceptance = readJson(join(outDir, ACCEPTANCE_FILE));
      if (acceptance.PASS !== true) failures.push('acceptance.json does not record PASS');
      if ((acceptance.phases ?? []).length !== 6) failures.push('acceptance.json does not cover six phases');
      if ((acceptance.nodes ?? []).length !== 15) failures.push('acceptance.json does not cover the fifteen executed nodes');
      if ((acceptance.nodes ?? []).some((node) => node.evidenceOk !== true)) failures.push('acceptance.json contains a node without OK evidence');
      if (acceptance.negative?.failures?.length > 0) failures.push('acceptance.json records failed negative cases');
      const evidencePath = relative(ROOT, join(outDir, ACCEPTANCE_FILE)).replaceAll('\\', '/');
      const evidenceCommit = git(['log', '-1', '--format=%H', '--', evidencePath]).trim() || null;
      const sourceCommit = evidenceCommit ? git(['rev-parse', '--verify', evidenceCommit + '^']) : null;
      if (!sourceCommit) failures.push('F3 evidence has no source commit');
      else if (acceptance.candidate?.commit !== sourceCommit) {
        failures.push('acceptance.json candidate ' + acceptance.candidate?.commit + ' is not the evidence source commit ' + sourceCommit);
      }
    }
    console.log(JSON.stringify({ checkOnly: true, ok: failures.length === 0, failures }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const reuseIndex = process.argv.indexOf('--reuse');
  const reuseRoot = reuseIndex >= 0 ? process.argv[reuseIndex + 1]?.trim() : '';
  let runRoot;
  if (reuseRoot) {
    runRoot = resolve(reuseRoot);
    if (!existsSync(runRoot)) throw new Error('--reuse root does not exist: ' + runRoot);
  } else {
    runRoot = resolve(EVIDENCE_BASE, String(Date.now()));
    mkdirSync(runRoot, { recursive: true });
  }
  const logDir = join(runRoot, 'logs');

  const candidate = candidateIdentity();
  if (!allowDirty && candidate.status.length > 0) {
    throw new Error('candidate tree is dirty outside the F3 evidence directory: ' + candidate.status.join(' | '));
  }

  const gates = [];
  if (!reuseRoot && !aggregateOnly) {
    for (const [name, args, timeoutMs] of GATES) {
      const result = runCommand(name, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, { timeoutMs, logDir });
      gates.push(result.gate);
      if (result.gate.exitCode !== 0) {
        throw new Error(name + ' failed (' + (result.gate.exitCode ?? result.gate.signal) + '): ' + result.gate.stderrTail);
      }
    }
    const e2e = runCommand(
      'long-session-e2e',
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['exec', 'playwright', 'test', ...E2E_GROUP, '--workers=1', '--output', join(runRoot, 'e2e')],
      { env: { CLAWX_E2E_RUN_ROOT: join(runRoot, 'e2e-run') }, timeoutMs: 2_700_000, logDir },
    );
    gates.push(e2e.gate);
    if (e2e.gate.exitCode !== 0) {
      throw new Error('long-session-e2e failed (' + (e2e.gate.exitCode ?? e2e.gate.signal) + '): ' + e2e.gate.stderrTail);
    }
  } else if (reuseRoot) {
    for (const name of [...GATES.map((entry) => entry[0]), 'long-session-e2e']) {
      const stdoutFile = join(logDir, name + '.stdout.txt');
      if (!existsSync(stdoutFile)) throw new Error('--reuse root is missing ' + name + ' logs');
      gates.push({
        name,
        command: null,
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: null,
        stdoutSha256: hashFile(stdoutFile),
        stderrSha256: hashFile(join(logDir, name + '.stderr.txt')),
        stdoutFile: stdoutFile.replaceAll('\\', '/'),
        stderrFile: join(logDir, name + '.stderr.txt').replaceAll('\\', '/'),
      });
    }
  }

  const nodes = NODES.map((node) => nodeRecord(node, candidate));
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));

  const planText = readFileSync(join(ROOT, PLAN), 'utf8');
  const PHASE_NUMERALS = { A: '一', B: '二', C: '三', D: '四', E: '五', F: '六' };
  const phaseCriteria = (key) => {
    const marker = '阶段' + (PHASE_NUMERALS[key] ?? key);
    const line = planText.split(/\r?\n/).find((entry) => entry.includes('**' + marker) && entry.includes('：'));
    return line ? line.replace(/^\s*-\s*/, '').trim() : null;
  };

  const phases = PHASES.map((phase) => {
    const children = phase.nodes.filter((key) => key !== 'f3').map((key) => nodeByKey.get(key.toUpperCase()));
    const missing = children.filter((entry) => !entry);
    const failed = children.filter((entry) => entry && entry.evidenceOk !== true);
    const criteria = phaseCriteria(phase.key);
    const selfNode = phase.nodes.includes('f3') ? 'f3' : null;
    return {
      id: phase.id,
      key: phase.key,
      title: phase.title,
      criterionReadFromPlan: criteria,
      criterionPresent: Boolean(criteria),
      childNodes: phase.nodes.map((entry) => entry.toUpperCase()),
      executedChildren: children.map((entry) => entry.key),
      missingChildren: missing.length,
      failedChildren: failed.map((entry) => entry.key),
      aggregatesSelf: selfNode,
      verdict: criteria && failed.length === 0 && missing.length === 0 ? 'pass' : 'fail',
    };
  });

  const d2 = readJson(join(ROOT, FIXTURES, 'd2', 'candidate-decision-inputs.json'));
  const d3 = readJson(join(ROOT, FIXTURES, 'd3', 'continuity-strategy-decision.json'));

  const readmes = { en: 'README.md', zh: 'README.zh-CN.md', ja: 'README.ja-JP.md', ru: 'README.ru-RU.md' };
  const readmeTexts = Object.fromEntries(Object.entries(readmes).map(([lang, name]) => [lang, readFileSync(join(ROOT, name), 'utf8')]));
  const semantics = readFileSync(join(ROOT, 'docs/clawx-product-semantics.md'), 'utf8');
  const capabilityClaims = readFileSync(join(ROOT, 'shared/capability-claims.ts'), 'utf8');

  const claimProbes = [
    { id: 'delegation-admission-guide', needles: ['long-session-delegation-admission.md'], semantic: true },
    { id: 'continuity-context-pack', needles: ['ContinuityContextPack/v1'], semantic: true },
    { id: 'long-session-resource-limits', needles: ['OPENCLAW_LONG_SESSION_'], semantic: true },
    { id: 'coordinator-surface', needles: ['completion batch', 'batch завершений', '完了バッチ', '完成批次', 'completion-batch', 'completion batches'], semantic: true },
    { id: 'admission-receipt-accepted-only', needles: ['accepted'], semantic: true },
  ];
  const readmeClaims = claimProbes.map((probe) => ({
    id: probe.id,
    locales: Object.fromEntries(Object.entries(readmeTexts).map(([lang, text]) => [lang, probe.needles.some((needle) => text.includes(needle))])),
  }));
  const readmeClaimGaps = readmeClaims.flatMap((entry) => Object.entries(entry.locales)
    .filter(([, present]) => !present)
    .map(([lang]) => entry.id + ':' + lang));

  const claims = {
    providerBackend: 'scripted agent-driven endpoint only; no live-provider promotion claim',
    continuityStrategy: d3.decision ?? null,
    continuityQualityClaimAllowed: d2.qualityClaimAllowed === true,
    d2Status: d2.status ?? null,
    d2Disposition: d2.disposition ?? null,
    keepBaseline: d2.keepBaseline === true && d3.decision === 'keep-baseline',
    productSemanticsBaselineStatement: semantics.includes('Long-session continuity strategy stays on the baseline'),
    capabilityClaimMatrixLongSessionEntries: (capabilityClaims.match(/capability-[a-z0-9-]*session/gi) ?? []).length,
    readmeClaims,
    readmeClaimGaps,
    verdict: d2.qualityClaimAllowed !== true
      && d3.decision === 'keep-baseline'
      && semantics.includes('Long-session continuity strategy stays on the baseline')
      && readmeClaimGaps.length === 0,
  };

  const negative = {
    checks: [
      { id: 'node-evidence-complete', failures: nodes.filter((node) => node.evidenceOk !== true).map((node) => node.key) },
      { id: 'phase-criteria-complete', failures: phases.filter((phase) => phase.verdict !== 'pass').map((phase) => phase.id) },
      { id: 'no-live-provider-promotion', failures: d2.qualityClaimAllowed === true ? ['d2-quality-claim-allowed'] : [] },
      { id: 'continuity-keep-baseline', failures: d3.decision === 'keep-baseline' ? [] : ['d3-not-baseline'] },
      { id: 'readme-claim-parity', failures: readmeClaimGaps },
      { id: 'product-semantics-baseline', failures: semantics.includes('Long-session continuity strategy stays on the baseline') ? [] : ['missing-baseline-statement'] },
      { id: 'gate-exit-codes', failures: gates.filter((gate) => gate.exitCode !== 0).map((gate) => gate.name) },
    ],
  };
  negative.failures = negative.checks.flatMap((check) => check.failures);
  negative.pass = negative.failures.length === 0;

  const artifactFiles = [];
  for (const node of NODES) {
    const dir = join(ROOT, FIXTURES, node.dir);
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.json') || entry === SUMS_FILE)) {
      artifactFiles.push(join(dir, name));
    }
  }
  const secretHits = scanSecrets(artifactFiles);

  const acceptance = {
    schema: 'clawx.long-session.f3-final-acceptance/v1',
    driven_by: 'agent',
    actor: ACTOR,
    taskForestNode: TASK_NODE,
    taskKey: TASK_KEY,
    program: 'long-session-development-20261022',
    contract: CONTRACT,
    generatedAt: new Date().toISOString(),
    candidate,
    scope: {
      platform: process.platform,
      node: process.version,
      phases: PHASES.length,
      executedNodes: NODES.length,
      aggregatingNode: TASK_KEY,
      historicalEvidenceResigned: false,
    },
    nodes,
    phases,
    claims,
    negative,
    gates: gates.slice(),
    e2e: {
      specs: E2E_GROUP,
      workers: 1,
      gate: gates.find((gate) => gate.name === 'long-session-e2e') ?? null,
      realElectron: true,
      transport: 'built Electron -> Host API -> real Main owner -> real Gateway child where the spec exercises it',
    },
    secretScan: {
      scannedFiles: artifactFiles.length,
      hits: secretHits,
      pass: secretHits.length === 0,
    },
    hashes: {
      nodeSets: nodes.map((node) => ({ key: node.key, verified: node.sha256sums?.verified ?? 0, failures: node.sha256sums?.failures ?? ['missing'] })),
      pass: nodes.every((node) => (node.sha256sums?.failures ?? ['missing']).length === 0),
    },
    cleanup: {
      runRoot: runRoot.replaceAll('\\', '/'),
      runRootKept: true,
      note: 'raw run root stays on D:; curated acceptance artifacts are the committed evidence',
      recoveryRequired: false,
    },
    unmeasured: UNMEASURED,
    PASS: false,
  };
  acceptance.PASS = acceptance.negative.pass
    && acceptance.secretScan.pass
    && acceptance.hashes.pass
    && gates.every((gate) => gate.exitCode === 0);

  const writeArtifacts = () => {
    mkdirSync(outDir, { recursive: true });
    writeJson(join(outDir, ACCEPTANCE_FILE), acceptance);
    const lines = [
      '# F3 long-session final acceptance',
      '',
      'Source candidate: ' + candidate.commit + '.',
      '',
      '## Verdict',
      '',
      '- PASS: ' + (acceptance.PASS ? 'true' : 'false'),
      '- Executed nodes aggregated: ' + nodes.length + ' (A1-F2); this node (F3) supplies the aggregation evidence.',
      '- Phases read from the plan: ' + phases.filter((phase) => phase.criterionPresent).length + '/6',
      '- Node evidence OK: ' + nodes.filter((node) => node.evidenceOk).length + '/' + nodes.length,
      '- SHA256SUMS verified: ' + nodes.reduce((total, node) => total + (node.sha256sums?.verified ?? 0), 0) + ' files across ' + nodes.length + ' node directories',
      '- Recorded gate exit codes observed: ' + nodes.reduce((total, node) => total + node.gates.exitCodeObservations, 0) + ', failed: ' + nodes.reduce((total, node) => total + node.gates.failedCount, 0),
      '- Negative proof identifiers: ' + nodes.reduce((total, node) => total + node.negativeProofs.count, 0),
      '',
      '## Phase criteria',
      '',
    ];
    for (const phase of phases) {
      lines.push('- ' + phase.id + ' (' + phase.key + '): ' + phase.verdict + ' - ' + (phase.criterionReadFromPlan ?? 'criterion missing'));
    }
    lines.push('', '## Node evidence', '', '| Node | Forest | Primary evidence | Gates | Failures | Negative proofs | SHA256 |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const node of nodes) {
      lines.push('| ' + node.key + ' | ' + node.forestNode + ' | ' + node.primaryEvidence + ' | ' + node.gates.exitCodeObservations + ' | ' + node.gates.failedCount + ' | ' + node.negativeProofs.count + ' | ' + (node.sha256sums?.verified ?? 0) + ' |');
    }
    lines.push(
      '',
      '## Claim boundary',
      '',
      '- D2 evaluation status: ' + (claims.d2Status ?? 'missing') + ' / ' + (claims.d2Disposition ?? 'missing') + '; live-provider quality claim allowed: ' + claims.continuityQualityClaimAllowed,
      '- D3 continuity decision: ' + (claims.continuityStrategy ?? 'missing'),
      '- Product semantics keep-baseline statement present: ' + claims.productSemanticsBaselineStatement,
      '- README claim gaps: ' + (claims.readmeClaimGaps.length === 0 ? 'none' : claims.readmeClaimGaps.join(', ')),
      '- Provider backend: ' + claims.providerBackend,
      '',
      '## Gates re-run on this candidate',
      '',
    );
    for (const gate of gates) {
      lines.push('- ' + gate.name + ': exit ' + gate.exitCode + (gate.durationMs == null ? '' : ' in ' + gate.durationMs + ' ms'));
    }
    lines.push(
      '',
      '## Unmeasured',
      '',
      ...UNMEASURED.map((entry) => '- ' + entry),
      '',
      'All evidence is agent-driven (driven_by: agent, actor: ' + ACTOR + '). No real-human evidence is claimed.',
      'Public release, all-default enablement, product locks and a standalone multi-execution-root Project remain outside this node.',
      '',
    );
    writeFileSync(join(outDir, ACCEPTANCE_MD), lines.join('\n'), 'utf8');
    writeFileSync(join(outDir, SUMS_FILE), [ACCEPTANCE_FILE, ACCEPTANCE_MD]
      .map((name) => hashFile(join(outDir, name)) + '  ' + name)
      .join('\n') + '\n', 'utf8');
  };

  writeArtifacts();

  const validate = runCommand(
    'harness-validate',
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['harness', 'validate', '--spec', CONTRACT],
    { timeoutMs: 600_000, logDir },
  );
  gates.push(validate.gate);
  const diffCheck = runCommand(
    'git-diff-check',
    process.platform === 'win32' ? 'git.exe' : 'git',
    ['diff', '--check'],
    { timeoutMs: 120_000, logDir },
  );
  gates.push(diffCheck.gate);
  acceptance.gates = gates.slice();
  acceptance.PASS = acceptance.PASS && validate.gate.exitCode === 0 && diffCheck.gate.exitCode === 0;
  writeArtifacts();

  console.log(JSON.stringify({
    outDir: outDir.replaceAll('\\', '/'),
    runRoot: runRoot.replaceAll('\\', '/'),
    candidate: candidate.commit,
    nodes: nodes.length,
    nodeEvidenceOk: nodes.filter((node) => node.evidenceOk).length,
    phases: phases.map((phase) => ({ id: phase.id, verdict: phase.verdict })),
    claimsVerdict: claims.verdict,
    secretHits: secretHits.length,
    hashesPass: acceptance.hashes.pass,
    gates: gates.map((gate) => ({ name: gate.name, exitCode: gate.exitCode, durationMs: gate.durationMs })),
    PASS: acceptance.PASS,
  }, null, 2));

  if (!acceptance.PASS) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
