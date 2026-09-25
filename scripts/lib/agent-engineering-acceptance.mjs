import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, toArray } from '../../harness/src/specs.mjs';
import { selectSteps } from '../../harness/src/profiles.mjs';
import { validateTf0009AgentSurrogateReport } from './tf0009-agent-surrogate.mjs';

export const ACCEPTANCE_SCHEMA = 'agent-engineering-acceptance/v1';
export const ACCEPTANCE_REPORT_SCHEMA = ACCEPTANCE_SCHEMA;
export const TF0009_ADAPTER_ID = 'tf0009-agent-surrogate-output-dir';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(THIS_FILE), '../..');
const DEFAULT_OUTPUT_ROOT = join(REPOSITORY_ROOT, 'artifacts', 'agent-engineering-acceptance');
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
// Identity-backed root skip budget. Every entry is a test file whose skips are
// gated on an input the acceptance environment deliberately withholds, so the
// count is deterministic there. Enumerated from the vitest JSON reporter on the
// candidate (23f4a0c3b) and its diffBase (5dabc7ca5); both read identically.
// A reading above this sum means a capability-gated test was skipped (for
// example `skills-symlink-cleanup.test.ts` skips 3 tests when the process
// cannot create file symlinks); fix the environment, do not raise the budget.
export const ROOT_UNIT_SKIP_INVENTORY = Object.freeze([
  { file: 'tests/unit/agency-role-importer.test.ts', skips: 1, gate: 'AGENCY_AGENTS_REPO checkout absent' },
  { file: 'tests/unit/cross-encoder-rerank.test.ts', skips: 2, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/helpers/query-classifier.test.ts', skips: 2, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/justifier-rerank.test.ts', skips: 2, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/question-decomposer.test.ts', skips: 4, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-adversarial-holdout.test.ts', skips: 3, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-consumer-llm-judge.test.ts', skips: 3, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-interleaved-read-write.test.ts', skips: 3, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-llm-multi-judge.test.ts', skips: 4, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-llm-real-usage.test.ts', skips: 8, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-locomo-benchmark.test.ts', skips: 1, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-locomo-full-500.test.ts', skips: 1, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-long-conversation-real.test.ts', skips: 3, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-retention-llm-judge.test.ts', skips: 4, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-useless-content-judge.test.ts', skips: 6, gate: 'DEEPSEEK_API_KEY withheld' },
  { file: 'tests/unit/runtime-memory-write-path-llm-judge.test.ts', skips: 3, gate: 'DEEPSEEK_API_KEY withheld' },
].map(Object.freeze));
export const ROOT_UNIT_EXPECTED_SKIPS = ROOT_UNIT_SKIP_INVENTORY.reduce((sum, entry) => sum + entry.skips, 0);
// The 53 budget frozen on 2026-09-11 was read on a process without file-symlink
// privilege, where skills-symlink-cleanup.test.ts skips these 3 tests.
export const ROOT_UNIT_SYMLINK_PRIVILEGE_SKIPS = 3;
const RUNTIME_UNIT_EXPECTED_SKIPS = 0;
const SAFE_NETWORK_POLICIES = new Set(['none', 'isolated']);
const REQUIRED_LOCK_FILES = ['package.json', 'pnpm-lock.yaml', '.npmrc'];
const GATE_POLICY_FILES = ['harness/src/profiles.mjs'];
const CANDIDATE_BOUND_GATE_ARTIFACTS = Object.freeze({
  'comms-replay': [{
    kind: 'comms-replay-metrics',
    source: 'artifacts/comms/current-metrics.json',
    schema: 'comms-replay-metrics/v1',
  }],
  'comms-compare': [{
    kind: 'comms-compare-report',
    source: 'artifacts/comms/compare-report.json',
    schema: 'comms-compare-report/v1',
  }],
});
const PROVIDER_ENV_RE = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|CREDENTIAL)/iu;
const PROVIDER_ENV_ALLOWLIST = new Set([
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'CI',
  'TERM',
  'TEMP',
  'TMP',
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
]);

const FULL_BASELINE_STEPS = [
  { id: 'contract-check', profile: 'baseline', name: 'Host/API contract check', command: 'pnpm', args: ['run', 'contract:check'] },
  { id: 'i18n-lint', profile: 'baseline', name: 'Locale coverage lint', command: 'pnpm', args: ['run', 'i18n:lint'] },
  {
    id: 'integration',
    profile: 'baseline',
    name: 'Integration tests',
    command: 'pnpm',
    args: ['run', 'test:integration'],
    testExpectation: { requireCounts: true, expectedSkips: 0 },
  },
  { id: 'vite-build', profile: 'baseline', name: 'Vite production build', command: 'pnpm', args: ['run', 'build:vite'] },
  { id: 'runtime-build', profile: 'baseline', name: 'OpenClaw runtime build', command: 'pnpm', args: ['run', 'build:runtime'] },
  { id: 'runtime-smoke', profile: 'baseline', name: 'OpenClaw runtime smoke', command: 'node', args: ['scripts/smoke-openclaw-runtime.mjs'] },
  { id: 'agent-dev-audit', profile: 'baseline', name: 'Agent Dev evidence audit (hard-veto freshness gate)', command: 'pnpm', args: ['agent-dev:audit'] },
];

const EXTRA_PROFILE_STEPS = {
  runtime: [
    {
      id: 'runtime-unit',
      profile: 'runtime',
      name: 'OpenClaw runtime unit tests',
      command: 'pnpm',
      args: ['--dir', 'openclaw_runtime', 'test:unit'],
      testExpectation: { requireCounts: true, expectedSkips: RUNTIME_UNIT_EXPECTED_SKIPS },
    },
    // Bounded to the runtime production core (tsgo:core). The full extension +
    // test-type typecheck sweep (tsgo:all) is ambient repo debt owned by the
    // release-freeze node (TF-0041), not this self-contained baseline. See
    // docs/dev/engineering-product-node-plan-20260921.md §4.
    // --typecheck-core (bare flag): pnpm swallows `--flag=value` forms as its
    // own config so they never reach check.mjs; the bare alias does.
    { id: 'runtime-static-check', profile: 'runtime', name: 'OpenClaw runtime static checks', command: 'pnpm', args: ['--dir', 'openclaw_runtime', 'check', '--typecheck-core'] },
  ],
  maturity: [
    { id: 'maturity-validate', profile: 'maturity', name: 'System maturity validation', command: 'pnpm', args: ['run', 'maturity:validate'] },
  ],
  release: [
    { id: 'release-baseline-validate', profile: 'release', name: 'Release baseline validation', command: 'pnpm', args: ['run', 'release:baseline:validate'] },
  ],
  comms: [
    { id: 'comms-replay', profile: 'comms', name: 'Communication replay', command: 'pnpm', args: ['run', 'comms:replay'] },
    { id: 'comms-compare', profile: 'comms', name: 'Communication regression comparison', command: 'pnpm', args: ['run', 'comms:compare'] },
  ],
  e2e: [
    {
      id: 'electron-e2e',
      profile: 'e2e',
      name: 'Electron end-to-end tests',
      command: 'pnpm',
      args: ['run', 'test:e2e'],
      // The full Electron UI suite is ~310 tests at workers:1 and needs ~45 min
      // on this machine; the 30-minute default killed it at test 227 of the
      // 2026-09-25 RC-09 run. The budget is raised here, not in DEFAULT_TIMEOUT_MS,
      // so the faster gates keep their tighter bound.
      timeoutMs: 60 * 60 * 1000,
      testExpectation: { requireCounts: true, expectedSkips: 0 },
    },
  ],
};

const COVERAGE_PATTERNS = Object.freeze({
  runtime: [
    'openclaw_runtime/**',
    'scripts/build-openclaw-runtime.mjs',
    'scripts/smoke-openclaw-runtime.mjs',
  ],
  ui: [
    'src/**',
    'electron/**',
    'shared/**',
    'tests/e2e/**',
    'playwright.config.ts',
  ],
  comms: [
    'electron/gateway/**',
    'electron/services/**',
    'src/lib/host-api.ts',
    'src/lib/api-client.ts',
    'src/lib/host-events.ts',
    'shared/host-api/**',
    'shared/agent-dev/**',
    'openclaw_runtime/**',
  ],
  release: [
    // package.json is intentionally NOT a release trigger: release-baseline
    // evidence (P6-005) is branch-bound and its collector requires a clean
    // tracked tree, so every package.json-touching candidate would otherwise
    // carry a release gate it cannot satisfy. Release coverage fires only on
    // release-specific paths.
    'pnpm-lock.yaml',
    'electron-builder.yml',
    '.github/workflows/release.yml',
    'release/**',
    'scripts/release-**',
    'scripts/validate-release-**',
    'scripts/collect-p6-**',
    'plans/system-maturity/phase6-supply-release/**',
  ],
});

const FORBIDDEN_ARGUMENTS = [
  /^--(?:fix|yes|publish|push|deploy|probe-live|live|real-provider)$/iu,
  /^(?:--?)(?:allow[-_]?network|allow[-_]?production)$/iu,
];

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizePath(value) {
  const text = asString(value).replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!text || text === '.' || text.startsWith('/') || /^[A-Za-z]:\//u.test(text)) return null;
  const normalized = text.split('/').filter(Boolean).join('/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
}

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(comparePath).map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value))}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

/**
 * Reports are addressed by their semantic JSON payload, not by a caller-supplied
 * hexadecimal-looking value. Undefined reportDigest is omitted by JSON.stringify,
 * keeping this compatible with the persisted report representation.
 */
export function digestReport(report) {
  if (!report || typeof report !== 'object') return sha256(stableJson(report));
  const payload = { ...report, reportDigest: undefined };
  return sha256(stableJson(payload));
}

export function equalDigest(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (!/^[a-f0-9]{64}$/u.test(expected) || !/^[a-f0-9]{64}$/u.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function canonicalManifestPayload(manifest) {
  const { manifestDigest: _manifestDigest, ...payload } = manifest;
  return payload;
}

function canonicalPlanPayload(manifest) {
  const { manifestDigest: _manifestDigest, planDigest: _planDigest, ...payload } = manifest;
  return payload;
}

export function digestPlan(manifest) {
  return sha256(stableJson(canonicalPlanPayload(manifest)));
}

export function digestManifest(manifest) {
  return sha256(stableJson(canonicalManifestPayload(manifest)));
}

function commandName(command) {
  return asString(command).split(/[\\/]/u).pop()?.toLowerCase() ?? '';
}

function gitExecutable() {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

function pnpmExecutable() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runGit(root, args, options = {}) {
  const result = spawnSync(gitExecutable(), args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env ?? process.env,
  });
  const stdout = String(result.stdout ?? '').trim();
  const stderr = String(result.stderr ?? '').trim();
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return { status: result.status ?? 1, stdout, stderr, result };
}

export function repositoryIdentity(root = REPOSITORY_ROOT, options = {}) {
  const commitResult = runGit(root, ['rev-parse', '--verify', 'HEAD'], options);
  const treeResult = runGit(root, ['rev-parse', '--verify', 'HEAD^{tree}'], options);
  const refResult = runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { ...options, allowFailure: true });
  const statusResult = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all'], options);
  const commit = commitResult.stdout.toLowerCase();
  const tree = treeResult.stdout.toLowerCase();
  return {
    commit,
    tree,
    ref: refResult.status === 0 && refResult.stdout ? refResult.stdout : null,
    clean: statusResult.stdout.length === 0,
    status: statusResult.stdout,
  };
}

function assertBaseRef(root, since) {
  if (typeof since !== 'string' || since.trim() === '') {
    throw new Error('acceptance plan requires --since <ref> (or explicit --changed paths); the implicit HEAD^ default is removed');
  }
  const base = since.trim();
  // The base must resolve to a real commit that is an ancestor of HEAD.
  const rev = runGit(root, ['rev-parse', '--verify', `${base}^{commit}`], { allowFailure: true });
  if (rev.status !== 0 || !/^[a-f0-9]{40}$/u.test(rev.stdout)) {
    throw new Error(`invalid or missing base ref: ${since}`);
  }
  const mergeBase = runGit(root, ['merge-base', '--is-ancestor', rev.stdout, 'HEAD'], { allowFailure: true });
  if (mergeBase.status !== 0) {
    throw new Error(`base ref is not an ancestor of HEAD: ${since}`);
  }
  return rev.stdout;
}

function gitChangedPaths(root, since) {
  const base = assertBaseRef(root, since);
  const result = runGit(root, ['diff', '--name-only', '-z', `${base}..HEAD`]);
  return result.stdout
    .split('\0')
    .map(normalizePath)
    .filter(Boolean)
    .sort(comparePath);
}

function gitBlobIdentity(root, relativePath, ref = 'HEAD') {
  const result = runGit(root, ['rev-parse', '--verify', `${ref}:${relativePath}`], { allowFailure: true });
  return result.status === 0 && /^[a-f0-9]{40}$/u.test(result.stdout) ? result.stdout : null;
}

export function resolveChangedPaths(root = REPOSITORY_ROOT, options = {}) {
  if (Array.isArray(options.changedPaths)) {
    return [...new Set(options.changedPaths.map(normalizePath).filter(Boolean))].sort(comparePath);
  }
  // No implicit HEAD^ default and no catch-all fallback: an invalid or missing
  // --since ref must fail closed instead of silently using the HEAD file list.
  return gitChangedPaths(root, options.since);
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '::DOUBLE_STAR::')
    .replace(/\*/gu, '[^/]*')
    .replace(/::DOUBLE_STAR::/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u');
}

function pathMatches(path, pattern) {
  return globToRegExp(pattern).test(path);
}

export function inferCoverage(changedPaths = []) {
  const normalized = changedPaths.map(normalizePath).filter(Boolean);
  const coverage = {
    runtime: normalized.some((path) => COVERAGE_PATTERNS.runtime.some((pattern) => pathMatches(path, pattern))),
    ui: normalized.some((path) => COVERAGE_PATTERNS.ui.some((pattern) => pathMatches(path, pattern))),
    comms: normalized.some((path) => COVERAGE_PATTERNS.comms.some((pattern) => pathMatches(path, pattern))),
    release: normalized.some((path) => COVERAGE_PATTERNS.release.some((pattern) => pathMatches(path, pattern))),
  };
  if (coverage.runtime) coverage.comms = true;
  // Note: release coverage intentionally does NOT imply maturity coverage.
  // Maturity validation requires every linked source to be committed no later
  // than its evidence files (git commit-time freshness); pulling the full
  // system-maturity evidence set into every release-adjacent candidate would
  // bloat the changed-path ownership matrix with non-RC governance evidence.
  // The RC-09 candidate chain and the pre-F-03 formal plans did not carry the
  // maturity gate.
  return coverage;
}

function readRelativeFile(root, relativePath, ref = 'HEAD') {
  const normalized = normalizePath(relativePath);
  if (!normalized) return { path: relativePath, exists: false, sha256: null };
  const fullPath = resolve(root, normalized);
  const rootPrefix = `${resolve(root)}${sep}`;
  if (!fullPath.startsWith(rootPrefix) && fullPath !== resolve(root)) {
    return { path: normalized, exists: false, sha256: null };
  }
  if (!existsSync(fullPath)) return { path: normalized, exists: false, sha256: null };
  return {
    path: normalized,
    exists: true,
    // sha256 is retained for diagnostics; formal manifests use the Git blob
    // identity below so CRLF/LF checkout policy cannot change source identity.
    sha256: sha256File(fullPath),
    gitBlob: gitBlobIdentity(root, normalized, ref),
  };
}

function collectRulePaths(spec) {
  return toArray(spec.data?.requiredRules)
    .map((id) => normalizePath(`harness/specs/rules/${id}.md`))
    .filter(Boolean);
}

function loadTaskSpec(root, specPath) {
  const fullPath = resolve(root, specPath);
  if (!pathInside(fullPath, root)) throw new Error(`task spec escapes repository root: ${specPath}`);
  return {
    path: specPath,
    ...parseFrontmatter(readFileSync(fullPath, 'utf8')),
  };
}

function hasHumanEvidenceRequirement(spec) {
  const value = spec.data?.humanEvidence;
  if (value === true || value === 'required') return true;
  if (value && typeof value === 'object' && value.required === true) return true;
  return /humanEvidence\s*:\s*required/iu.test(spec.body ?? '');
}

// Core profiles a node can never defer: they gate the node's own engineering
// correctness. Only coverage-triggered, separately-ownable suites (full UI e2e,
// release packaging/provenance, system-maturity) may be deferred to another
// node, and only with an explicit owner + reason recorded in the manifest.
const NON_DEFERRABLE_PROFILES = new Set(['fast', 'comms', 'runtime', 'full']);

// Frontmatter form (the repo's minimal YAML subset supports nested key:value,
// not list-of-objects), each value is "OWNER :: reason":
//   deferredProfiles:
//     e2e: "TF-0041 :: full UI regression owned by the release-freeze node"
//     release: "TF-0041 :: release packaging/provenance owned by TF-0041"
function parseDeferredProfiles(spec) {
  const out = new Map();
  const raw = spec.data?.deferredProfiles;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [profile, value] of Object.entries(raw)) {
      const key = String(profile).trim();
      if (!key) continue;
      const [owner, ...rest] = String(value).split('::');
      out.set(key, { profile: key, owner: owner.trim(), reason: rest.join('::').trim() });
    }
  }
  return out;
}

function inferProfiles(spec, coverage, mode) {
  const profiles = new Set(['fast']);
  for (const profile of toArray(spec.data?.requiredProfiles)) profiles.add(String(profile));
  if (coverage.comms) profiles.add('comms');
  if (coverage.ui) profiles.add('e2e');
  if (coverage.runtime) profiles.add('runtime');
  if (coverage.maturity) profiles.add('maturity');
  if (coverage.release) profiles.add('release');
  if (mode === 'full') profiles.add('full');

  // A candidate can touch UI/release paths (so coverage triggers those gates)
  // while a different node owns the full suite. Honest deferral: strip the
  // deferred profile from THIS node's required set and record where it went.
  // Core profiles cannot be deferred; the validator re-checks this fail-closed.
  const deferralSpecs = parseDeferredProfiles(spec);
  const deferredProfiles = [];
  for (const [profile, record] of deferralSpecs) {
    if (NON_DEFERRABLE_PROFILES.has(profile)) continue;
    if (!profiles.has(profile)) continue;
    profiles.delete(profile);
    deferredProfiles.push(record);
  }
  return {
    profiles: [...profiles].sort(comparePath),
    deferredProfiles: deferredProfiles.sort((a, b) => comparePath(a.profile, b.profile)),
  };
}

function inferTestExpectation(step) {
  if (step.testExpectation) return step.testExpectation;
  if (step.profile === 'fast' && step.name === 'Unit tests') {
    return { requireCounts: true, expectedSkips: ROOT_UNIT_EXPECTED_SKIPS };
  }
  return null;
}

function gateFromStep(step, options = {}) {
  const testExpectation = options.testExpectation ?? inferTestExpectation(step);
  return {
    id: step.id ?? `${step.profile}-${step.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
    name: step.name,
    profile: step.profile,
    command: step.command,
    args: [...(step.args ?? [])],
    required: true,
    allowSkip: false,
    timeoutMs: step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    safety: {
      network: options.network ?? 'none',
      productionEffects: false,
      humanEvidence: false,
      ...(options.safety ?? {}),
    },
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.adapter ? { adapter: options.adapter } : {}),
    ...(testExpectation ? { testExpectation } : {}),
  };
}

function buildGates(profiles, options = {}) {
  const gates = [];
  const seen = new Set();
  const add = (step, gateOptions) => {
    const gate = gateFromStep(step, gateOptions);
    if (seen.has(gate.id)) return;
    seen.add(gate.id);
    gates.push(gate);
  };

  // Harness profiles remain the source of command selection. We only add the
  // structural validator and the full, non-cached baseline explicitly here.
  add({
    id: 'dependency-install-offline',
    profile: 'environment',
    name: 'Offline frozen dependency install',
    command: 'pnpm',
    args: ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
  });
  // openclaw_runtime is an independent pnpm workspace (own pnpm-workspace.yaml
  // and pnpm-lock.yaml). The root install above does not cover it, so the
  // detached worktree would lack its dependencies (e.g. oxlint for lint:dcs,
  // vitest for runtime-unit, tsgo for runtime-static-check). Install it with
  // the same offline/frozen/ignore-scripts posture to keep the acceptance
  // environment self-contained and fail-closed.
  add({
    id: 'dependency-install-offline-openclaw-runtime',
    profile: 'environment',
    name: 'Offline frozen dependency install (openclaw_runtime workspace)',
    command: 'pnpm',
    args: ['--dir', 'openclaw_runtime', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
  });
  // resources/bin/win32-x64/ae.exe is a source-built VerseShell binary that is
  // gitignored by design and required by the lifecycle tests. A clean detached
  // worktree reconstructs it from the pinned source and tracked patch stack;
  // an existing binary is never copied as evidence. The UAS-06 canary stub
  // artifacts/uas-06-single-local-exec-canary/live-observations.json is also
  // gitignored (artifacts/*) yet read by
  // tests/unit/uas-06-single-local-exec-canary.test.ts; it is a fixed empty
  // observations stub (non-executing channel), so a straight copy suffices.
  add({
    id: 'provision-verseshell-resources',
    profile: 'environment',
    name: 'Reconstruct VerseShell resources (ae.exe + canary stub)',
    command: 'internal',
    args: [
      '--manifest', 'resources/verseshell/manifest.json',
      '--binary', 'resources/bin/win32-x64/ae.exe',
      '--copy', 'artifacts/uas-06-single-local-exec-canary/live-observations.json',
      '--copy', 'artifacts/unified-agent-system/TF-0011/audit-manifest.json',
      '--copy', 'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json',
      '--copy', 'openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json',
      '--electron',
    ],
  }, { kind: 'provision-verseshell' });
  // The Harness gate must run a real changed-path diff. Passing --spec alone
  // leaves checkDiff false in harness/src/cli.mjs, so ownership enforcement
  // never engages and the gate cannot fail on unowned paths -- the same
  // vacuous pass that --no-diff used to produce. A formal plan always has a
  // baseRef (or explicit changedPaths); when a baseRef exists it is required.
  add({
    id: 'harness-validate',
    profile: 'harness',
    name: 'Harness task-spec validation',
    command: 'pnpm',
    args: options.baseRef
      ? ['harness', 'validate', '--spec', options.specPath, '--since', options.baseRef]
      : ['harness', 'validate', '--spec', options.specPath],
  });
  for (const step of selectSteps(['fast'])) add(step);
  for (const step of FULL_BASELINE_STEPS) add(step);
  for (const profile of profiles) {
    for (const step of EXTRA_PROFILE_STEPS[profile] ?? []) {
      add(step, { network: profile === 'e2e' ? 'isolated' : 'none' });
    }
  }

  if (options.taskId === 'tf0009-engineering-evidence-audit' || options.taskId === 'TF-0009') {
    add(
      {
        id: 'tf0009-agent-surrogate',
        profile: 'tf0009',
        name: 'TF-0009 isolated agent-surrogate adapter',
        command: 'pnpm',
        args: ['--dir', 'openclaw_runtime', 'exec', 'node', '--import', 'tsx', 'scripts/tf0009-agent-surrogate.mts'],
      },
      {
        kind: 'adapter',
        adapter: TF0009_ADAPTER_ID,
        network: 'isolated',
        safety: { adapterOutput: 'run-output/tf0009' },
        testExpectation: { requireCounts: true, expectedSkips: 0 },
      },
    );
  }
  return gates;
}

export function createAcceptancePlan(options = {}) {
  const root = resolve(options.root ?? REPOSITORY_ROOT);
  const specPath = normalizePath(options.specPath ?? 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md');
  if (!specPath) throw new Error('specPath must be a repository-relative path');
  const spec = options.spec ?? loadTaskSpec(root, specPath);
  const mode = options.mode ?? 'full';
  if (!['full', 'fast'].includes(mode)) throw new Error(`unsupported acceptance mode: ${mode}`);
  const identity = repositoryIdentity(root);
  const hasExplicitChangedPaths = Array.isArray(options.changedPaths);
  // Invalid or missing base refs must fail closed. A plan needs either an
  // explicit --since ref or explicit --changed paths; neither may be omitted
  // or fall back to the HEAD file list.
  let baseRef = null;
  if (!hasExplicitChangedPaths) {
    baseRef = assertBaseRef(root, options.since);
  } else if (typeof options.since === 'string' && options.since.trim() !== '') {
    baseRef = assertBaseRef(root, options.since);
  }
  if (baseRef && spec.data?.diffBase && baseRef !== assertBaseRef(root, String(spec.data.diffBase))) {
    throw new Error('comparison base must match the candidate task spec diffBase');
  }
  const changedPaths = resolveChangedPaths(root, options);
  const coverage = inferCoverage(changedPaths);
  const { profiles, deferredProfiles } = inferProfiles(spec, coverage, mode);
  const rulePaths = collectRulePaths(spec);
  const sourceFiles = [specPath, ...rulePaths, ...REQUIRED_LOCK_FILES, ...GATE_POLICY_FILES];
  const source = sourceFiles.map((path) => readRelativeFile(root, path, identity.commit));
  const missingSource = source.filter((entry) => !entry.exists).map((entry) => entry.path);
  const taskId = String(spec.data?.id ?? '');
  const humanEvidenceRequired = hasHumanEvidenceRequirement(spec);
  // F-03: the spec's own requiredTests must be executed by the formal runner,
  // not merely described. Each declared command line becomes a required gate.
  const requiredTests = toArray(spec.data?.requiredTests).map(String).filter((value) => value.trim().length > 0);
  const gates = buildGates(profiles, { specPath, taskId, baseRef });
  for (const [index, commandLine] of requiredTests.entries()) {
    const testExpectation = inferRequiredTestExpectation(commandLine);
    gates.push({
      id: `required-test-${index + 1}`,
      name: `Required test ${index + 1} (spec requiredTests)`,
      profile: 'required-tests',
      commandLine,
      command: null,
      args: [],
      required: true,
      allowSkip: false,
      // Spec-declared acceptance commands may themselves run the full formal
      // executor/verifier (nested acceptance runs exceed the 30-minute default
      // gate budget), so give them the same 3-hour ceiling as the install gates.
      timeoutMs: 180 * 60 * 1000,
      kind: 'required-test',
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
      ...(testExpectation ? { testExpectation } : {}),
    });
  }
  for (const gate of gates) {
    if (gate.kind === 'provision-verseshell') {
      gate.copyInputs = collectProvisionCopyInputs(root, gate.args);
    }
  }
  const manifest = {
    schema: ACCEPTANCE_SCHEMA,
    manifestVersion: 1,
    runId: options.runId ?? randomUUID(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    task: {
      id: taskId,
      title: String(spec.data?.title ?? ''),
      specPath,
      humanEvidence: humanEvidenceRequired ? 'required' : 'not-required',
      requiredRules: toArray(spec.data?.requiredRules).map(String).sort(comparePath),
      requiredTests,
    },
    executionMode: mode,
    candidate: {
      commit: identity.commit,
      tree: identity.tree,
      ref: identity.ref,
      cleanAtPlan: identity.clean,
    },
    baseRef,
    changedPaths,
    coverage,
    requiredProfiles: profiles,
    deferredProfiles,
    source: {
      files: source,
      missing: missingSource,
      lockFiles: source.filter((entry) => REQUIRED_LOCK_FILES.includes(entry.path)),
      provisionCopies: gates.flatMap((gate) => gate.copyInputs ?? []),
      identityPolicy: 'git-blob-v1',
      eolPolicy: 'git-blob',
    },
    gates,
    safety: {
      scope: 'engineering-only',
      networkPolicy: 'none-or-isolated',
      productionEffects: false,
      realProvider: false,
      humanEvidence: humanEvidenceRequired ? 'required' : 'not-required',
      productLocksMutable: false,
      allowedPromotion: false,
      prohibitedClaims: ['liveReady', 'productApproved', 'defaultOn', 'C1 continue', 'human/live canary'],
    },
    eligibility: {
      cleanWorktreeRequired: true,
      fullModeRequired: true,
      sourceComplete: missingSource.length === 0,
      cleanAtPlan: identity.clean,
    },
    residuals: humanEvidenceRequired
      ? ['human/product/live evidence remains required; agent evidence cannot promote task status']
      : [],
  };
  manifest.planDigest = digestPlan(manifest);
  manifest.manifestDigest = digestManifest(manifest);
  return manifest;
}

export function validateAcceptanceManifest(manifest, options = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  if (manifest.schema !== ACCEPTANCE_SCHEMA) errors.push('manifest schema mismatch');
  if (manifest.manifestVersion !== 1) errors.push('manifestVersion must be 1');
  if (!manifest.task?.id || !manifest.task?.specPath) errors.push('task id and specPath are required');
  if (!/^[a-f0-9]{40}$/u.test(asString(manifest.candidate?.commit))) errors.push('candidate.commit must be a full SHA');
  if (!/^[a-f0-9]{40}$/u.test(asString(manifest.candidate?.tree))) errors.push('candidate.tree must be a full tree SHA');
  if (!['full', 'fast'].includes(manifest.executionMode)) errors.push('executionMode must be full or fast');
  if (options.requireFull && manifest.executionMode !== 'full') errors.push('formal acceptance requires executionMode=full');
  if (typeof manifest.planDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.planDigest)) {
    errors.push('manifest plan digest is missing or malformed');
  } else if (!equalDigest(manifest.planDigest, digestPlan(manifest))) {
    errors.push('manifest plan digest mismatch');
  }
  if (typeof manifest.manifestDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.manifestDigest)) {
    errors.push('manifest digest is missing or malformed');
  } else if (!equalDigest(manifest.manifestDigest, digestManifest(manifest))) {
    errors.push('manifest digest mismatch');
  }
  if (manifest.source?.identityPolicy !== 'git-blob-v1' || manifest.source?.eolPolicy !== 'git-blob') {
    errors.push('formal source identity must use git-blob-v1 with git-blob EOL policy');
  }
  if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) errors.push('manifest must contain gates');
  // F-03 fail-closed: every spec-declared requiredTests command line must be
  // materialized as a required-test gate; a spec that declares required tests
  // the plan does not execute is invalid.
  const declaredRequiredTests = Array.isArray(manifest.task?.requiredTests)
    ? manifest.task.requiredTests.filter((value) => String(value).trim().length > 0)
    : [];
  const requiredTestGates = (manifest.gates ?? []).filter((gate) => gate.kind === 'required-test');
  if (declaredRequiredTests.length !== requiredTestGates.length) {
    errors.push(
      `manifest requiredTests (${declaredRequiredTests.length}) must map 1:1 to required-test gates (${requiredTestGates.length})`,
    );
  }
  for (const [index, gate] of requiredTestGates.entries()) {
    if (gate.commandLine !== declaredRequiredTests[index]) {
      errors.push(`required-test gate ${gate?.id ?? index}: commandLine must match the declared spec requiredTests entry`);
    }
  }
  // Deferred profiles: honest gate-layering. A deferred profile must (1) not be
  // a core profile, (2) name an owner node + reason, (3) not also appear in the
  // required set, and (4) contribute zero gates to this manifest. This is the
  // fail-closed check behind the spec's deferredProfiles declaration — deferral
  // moves a suite to another node with a recorded owner; it never deletes it.
  const deferred = Array.isArray(manifest.deferredProfiles) ? manifest.deferredProfiles : [];
  const requiredProfileSet = new Set(toArray(manifest.requiredProfiles).map(String));
  const deferredProfileNames = new Set();
  for (const record of deferred) {
    const profile = String(record?.profile ?? '').trim();
    if (!profile) { errors.push('deferredProfiles: each entry must name a profile'); continue; }
    if (deferredProfileNames.has(profile)) errors.push(`deferredProfiles: duplicate entry for ${profile}`);
    deferredProfileNames.add(profile);
    if (NON_DEFERRABLE_PROFILES.has(profile)) errors.push(`deferredProfiles: ${profile} is a core profile and cannot be deferred`);
    if (!String(record?.owner ?? '').trim()) errors.push(`deferredProfiles: ${profile} must name an owner node`);
    if (!String(record?.reason ?? '').trim()) errors.push(`deferredProfiles: ${profile} must record a reason`);
    if (requiredProfileSet.has(profile)) errors.push(`deferredProfiles: ${profile} cannot be both required and deferred`);
  }
  const gateIds = new Set();
  for (const gate of manifest.gates ?? []) {
    if (gate?.profile && deferredProfileNames.has(String(gate.profile))) {
      errors.push(`${gate?.id ?? '<gate>'}: belongs to deferred profile ${gate.profile} and must not appear in this manifest`);
    }
    if (!gate?.id || gateIds.has(gate.id)) errors.push(`gate id is missing or duplicated: ${gate?.id ?? '<empty>'}`);
    gateIds.add(gate?.id);
    if (!gate.command && typeof gate.commandLine !== 'string') {
      errors.push(`${gate?.id ?? '<gate>'}: command and args (or a commandLine for required-test gates) are required`);
    }
    if (gate.command && !Array.isArray(gate.args)) errors.push(`${gate?.id ?? '<gate>'}: command and args are required`);
    if (gate.required !== true) errors.push(`${gate?.id ?? '<gate>'}: required must be true`);
    if (gate.allowSkip !== false) errors.push(`${gate?.id ?? '<gate>'}: allowSkip must be false`);
    if (!SAFE_NETWORK_POLICIES.has(gate.safety?.network)) errors.push(`${gate?.id ?? '<gate>'}: unsafe network policy`);
    if (gate.safety?.productionEffects !== false || gate.safety?.humanEvidence !== false) {
      errors.push(`${gate?.id ?? '<gate>'}: unsafe side-effect or evidence declaration`);
    }
    if (gate.testExpectation) {
      if (gate.testExpectation.requireCounts !== true) errors.push(`${gate.id}: test gate must require parsed test counts`);
      if (!Number.isInteger(gate.testExpectation.expectedSkips) || gate.testExpectation.expectedSkips < 0) {
        errors.push(`${gate.id}: test gate must declare a non-negative fixed expectedSkips budget`);
      }
    }
    for (const arg of gateCommandTokens(gate)) {
      if (FORBIDDEN_ARGUMENTS.some((pattern) => pattern.test(String(arg)))) {
        errors.push(`${gate.id}: forbidden argument ${String(arg)}`);
      }
      if (String(arg) === '--no-diff') {
        errors.push(`${gate.id}: --no-diff is forbidden for formal acceptance`);
      }
    }
    if (gate.kind === 'required-test' && isCountableTestCommand(gate.command, gate.args, gate.commandLine)) {
      if (!gate.testExpectation) {
        errors.push(`${gate.id}: countable required-test gate must declare testExpectation`);
      }
    }
    if (gate.kind === 'provision-verseshell') {
      const copies = extractCopyPaths(gate.args ?? []);
      const inputs = Array.isArray(gate.copyInputs) ? gate.copyInputs : [];
      if (inputs.length !== copies.length) {
        errors.push(`${gate.id}: provision copyInputs must map 1:1 to --copy paths`);
      }
      for (const [index, copyPath] of copies.entries()) {
        const input = inputs[index];
        if (!copyPath || !input || input.path !== copyPath) {
          errors.push(`${gate.id}: provision copyInputs[${index}] path mismatch`);
          continue;
        }
        if (
          input.exists !== true
          || !Number.isInteger(input.bytes)
          || input.bytes < 0
          || typeof input.sha256 !== 'string'
          || !/^[a-f0-9]{64}$/u.test(input.sha256)
        ) {
          errors.push(`${gate.id}: provision copy ${copyPath} must lock sha256 and bytes`);
        }
      }
    }
    const name = commandName(gate.command);
    const firstArg = String(gate.args?.[0] ?? '').toLowerCase();
    if ((name === 'git' || name === 'git.exe') && ['push', 'commit', 'reset', 'clean', 'merge'].includes(firstArg)) {
      errors.push(`${gate.id}: git mutation command is forbidden`);
    }
    if (gate.kind === 'adapter' && gate.adapter !== TF0009_ADAPTER_ID) errors.push(`${gate.id}: unknown adapter`);
    if (gate.kind === 'required-test' && !gate.commandLine) errors.push(`${gate.id}: required-test gate must carry a commandLine`);
  }
  if (manifest.safety?.scope !== 'engineering-only') errors.push('manifest safety scope must be engineering-only');
  if (manifest.safety?.productionEffects !== false || manifest.safety?.realProvider !== false) {
    errors.push('manifest permits production effects or real providers');
  }
  if (options.root) {
    try {
      if (options.requireFull && !manifest.baseRef) {
        errors.push('formal acceptance requires a comparison base, not only explicit changed paths');
      }
      const expectedPlan = createAcceptancePlan({
        root: options.root,
        specPath: manifest.task.specPath,
        since: manifest.baseRef ?? undefined,
        // Explicit paths remain useful for diagnostic plans. A formal plan
        // always re-reads its actual diff rather than trusting this list.
        changedPaths: manifest.baseRef ? undefined : manifest.changedPaths,
        mode: manifest.executionMode,
        runId: manifest.runId,
        createdAt: manifest.createdAt,
      });
      if (stableJson(expectedPlan.task.requiredTests) !== stableJson(declaredRequiredTests)) {
        errors.push('manifest requiredTests must match the candidate task spec requiredTests');
      }
      for (const field of ['task', 'baseRef', 'changedPaths', 'coverage', 'requiredProfiles', 'safety']) {
        if (stableJson(manifest[field]) !== stableJson(expectedPlan[field])) {
          errors.push(`manifest ${field} must match the candidate-derived plan`);
        }
      }
      if (stableJson(manifest.gates) !== stableJson(expectedPlan.gates)) {
        errors.push('manifest gates must match the candidate-derived gate contracts');
      }
      // Git blobs, not checkout bytes, are authoritative for tracked inputs:
      // an LF/CRLF checkout must not invalidate an otherwise identical plan.
      const inputIdentities = (files) => (files ?? []).map(({ path, exists, gitBlob }) => ({ path, exists, gitBlob }));
      for (const field of ['files', 'lockFiles']) {
        if (stableJson(inputIdentities(manifest.source?.[field])) !== stableJson(inputIdentities(expectedPlan.source[field]))) {
          errors.push(`manifest source.${field} must match the candidate-derived inputs`);
        }
      }
      if (stableJson(manifest.source?.provisionCopies) !== stableJson(expectedPlan.source.provisionCopies)) {
        errors.push('manifest source.provisionCopies must match the candidate-derived inputs');
      }
      for (const gate of manifest.gates ?? []) {
        if (gate?.kind !== 'provision-verseshell') continue;
        const actual = collectProvisionCopyInputs(options.root, gate.args ?? []);
        const expected = Array.isArray(gate.copyInputs) ? gate.copyInputs : [];
        if (actual.length !== expected.length) {
          errors.push(`${gate.id}: provision copyInputs do not match source --copy paths`);
          continue;
        }
        for (const [index, input] of expected.entries()) {
          const current = actual[index];
          if (
            !input
            || !current
            || current.path !== input.path
            || current.exists !== true
            || current.bytes !== input.bytes
            || current.sha256 !== input.sha256
          ) {
            errors.push(`${gate.id}: provision copy digest mismatch: ${input?.path ?? current?.path ?? index}`);
          }
        }
      }
      const identity = repositoryIdentity(options.root);
      if (options.requireClean && !identity.clean) errors.push('source worktree is dirty');
      if (identity.commit !== manifest.candidate.commit) errors.push('candidate commit does not match source HEAD');
      if (identity.tree !== manifest.candidate.tree) errors.push('candidate tree does not match source HEAD');
      if (options.requireRef && manifest.candidate.ref && identity.ref !== manifest.candidate.ref) {
        errors.push('candidate ref does not match source ref');
      }
      for (const expected of manifest.source?.files ?? []) {
        const actual = readRelativeFile(options.root, expected.path, manifest.candidate?.commit);
        if (!expected?.path || !expected.gitBlob || !actual.gitBlob) {
          errors.push(`source input Git blob identity unavailable: ${expected?.path ?? '<unknown>'}`);
          continue;
        }
        if (actual.exists !== expected.exists || actual.gitBlob !== expected.gitBlob) {
          errors.push(`source input Git blob identity mismatch: ${expected.path}`);
        }
        const worktreeDiff = runGit(
          options.root,
          ['diff', '--quiet', manifest.candidate?.commit ?? 'HEAD', '--', expected.path],
          { allowFailure: true },
        );
        if (worktreeDiff.status !== 0) errors.push(`source input differs from candidate Git blob: ${expected.path}`);
      }
    } catch (error) {
      errors.push(`cannot inspect source repository: ${error.message}`);
    }
  }
  if (manifest.source?.missing?.length) errors.push(`missing source inputs: ${manifest.source.missing.join(', ')}`);
  return { ok: errors.length === 0, errors };
}

export function validateAcceptanceEnvironment(env = process.env) {
  const errors = [];
  if (Object.prototype.hasOwnProperty.call(env, 'NODE_TLS_REJECT_UNAUTHORIZED')) {
    errors.push('NODE_TLS_REJECT_UNAUTHORIZED must be unset for formal acceptance');
  }
  const providerKeys = Object.keys(env)
    .filter((key) => !PROVIDER_ENV_ALLOWLIST.has(key) && PROVIDER_ENV_RE.test(key) && String(env[key] ?? '').length > 0)
    .sort(comparePath);
  if (providerKeys.length > 0) errors.push(`provider or credential environment variables are forbidden: ${providerKeys.join(', ')}`);
  return { ok: errors.length === 0, errors, providerKeys };
}

function collectSecretValues(env) {
  return Object.entries(env ?? {})
    .filter(([key, value]) => !PROVIDER_ENV_ALLOWLIST.has(key) && PROVIDER_ENV_RE.test(key) && String(value ?? '').length >= 4)
    .map(([, value]) => String(value))
    .sort((left, right) => right.length - left.length);
}

export function redactText(value, options = {}) {
  let text = String(value ?? '');
  const replacements = [
    [options.sourceRoot, '<repo>'],
    [options.worktreeRoot, '<worktree>'],
    [options.outputDir, '<output>'],
    [homedir(), '<home>'],
    ...(options.secrets ?? []).map((secret) => [secret, '<secret>']),
  ];
  for (const [needle, replacement] of replacements) {
    if (!needle) continue;
    text = text.split(String(needle)).join(replacement);
    text = text.split(String(needle).replaceAll('\\', '/')).join(replacement);
  }
  return text;
}

function pathInside(child, parent) {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function assertSafeOutputDirectory(outputDir, sourceRoot = REPOSITORY_ROOT) {
  const resolvedOutput = resolve(outputDir);
  if (pathInside(resolvedOutput, sourceRoot)) {
    const relativeOutput = relative(resolve(sourceRoot), resolvedOutput).replaceAll('\\', '/');
    if (!relativeOutput.startsWith('artifacts/agent-engineering-acceptance/')) {
      throw new Error('acceptance output must be outside source root or under artifacts/agent-engineering-acceptance/');
    }
  }
  return resolvedOutput;
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function writeJson(path, value) {
  ensureDirectory(dirname(path));
  writeFileSync(path, stableJson(value), 'utf8');
}

function safeRelativeOutputPath(outputDir, pathValue) {
  const normalized = normalizePath(pathValue);
  if (!normalized || normalized.startsWith('..')) throw new Error(`unsafe output path: ${pathValue}`);
  const full = resolve(outputDir, normalized);
  if (!pathInside(full, outputDir)) throw new Error(`output path escapes output directory: ${pathValue}`);
  return { normalized, full };
}

export function createDetachedWorktree(root, options = {}) {
  const commit = options.commit ?? repositoryIdentity(root).commit;
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('detached worktree requires a full commit SHA');
  const holder = mkdtempSync(join(options.parent ?? tmpdir(), 'clawx-agent-acceptance-'));
  const checkout = join(holder, 'checkout');
  try {
    runGit(root, ['worktree', 'add', '--detach', checkout, commit], { timeoutMs: options.timeoutMs ?? 120_000 });
  } catch (error) {
    rmSync(holder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
  let cleaned = false;
  return {
    path: checkout,
    commit,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        runGit(root, ['worktree', 'remove', '--force', checkout], { allowFailure: true, timeoutMs: 120_000 });
      } finally {
        try {
          rmSync(holder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch (error) {
          const code = error?.code;
          if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error;
        }
      }
    },
  };
}

// Loopback hosts that must never be routed through a forward proxy. Gate
// subprocesses (unit/integration tests) stand up ephemeral servers on
// 127.0.0.1 and fetch them back; if the acceptance environment has HTTP(S)_PROXY
// set (e.g. to reach npm behind a corporate/dev proxy), those loopback fetches
// would otherwise be tunneled to the proxy and fail with a connection error
// that looks like a product defect (e.g. rc03-seal-wiring's guarded wire fetch).
const LOOPBACK_NO_PROXY = ['127.0.0.1', 'localhost', '::1', '[::1]'];

function makeEnvironment(options = {}) {
  const env = { ...(options.env ?? process.env) };
  // The validator rejects unsafe inherited values. We do not silently repair
  // them; deleting these keys here is only for explicitly supplied safe test
  // environments where the key is absent.
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  // If any forward proxy is configured, guarantee loopback bypasses it. This is
  // an environment-hygiene fix, not a network-policy relaxation: it never adds
  // outbound reach, it only keeps localhost local. Merge with any existing
  // NO_PROXY so a caller's own exclusions are preserved.
  const proxyConfigured = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
    .some((key) => String(env[key] ?? '').trim().length > 0);
  if (proxyConfigured) {
    for (const key of ['NO_PROXY', 'no_proxy']) {
      const existing = String(env[key] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
      const merged = [...new Set([...existing, ...LOOPBACK_NO_PROXY])];
      env[key] = merged.join(',');
    }
  }
  return env;
}

function extractCopyPaths(args = []) {
  const paths = [];
  for (let index = 0; index < args.length; index += 1) {
    if (String(args[index]) !== '--copy') continue;
    const value = args[index + 1];
    index += 1;
    paths.push(typeof value === 'string' ? normalizePath(value) : null);
  }
  return paths;
}

function collectProvisionCopyInputs(root, args) {
  return extractCopyPaths(args).map((relativePath) => {
    if (!relativePath) return { path: null, exists: false, bytes: null, sha256: null };
    const fullPath = resolve(root, relativePath);
    if (!pathInside(fullPath, root)) {
      return { path: relativePath, exists: false, bytes: null, sha256: null };
    }
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return { path: relativePath, exists: false, bytes: null, sha256: null };
    }
    const bytes = readFileSync(fullPath);
    return {
      path: relativePath,
      exists: true,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  });
}

function testCommandKinds(command, args = [], commandLine = '') {
  const line = String(commandLine ?? '').trim();
  const words = (line
    ? line.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|]+/gu) ?? []
    : [command, ...args].filter(Boolean))
    .map((word) => String(word).replace(/^["']|["']$/gu, '').replaceAll('\\', '/'));
  const kinds = [];
  const isTestFile = (word) => /\.(?:test|spec)\.(?:ts|tsx|js|mjs|cjs)$/iu.test(word ?? '');
  for (const [index, word] of words.entries()) {
    const executable = commandName(word).replace(/\.(?:cmd|exe)$/iu, '');
    if (executable === 'vitest' || (executable === 'playwright' && words[index + 1] === 'test')) {
      kinds.push('test');
    }
    if (executable === 'node') {
      let next = index + 1;
      while (words[next]?.startsWith('-')) {
        const option = words[next].split('=', 1)[0];
        if (option === '--test') kinds.push('test');
        next += ['--import', '--require', '-r', '--loader', '--conditions', '-C', '--eval', '-e', '--print', '-p'].includes(option)
          && !words[next].includes('=') ? 2 : 1;
      }
      const entry = commandName(words[next]);
      if (/^(?:run-)?vitest(?:\.mjs)?$/iu.test(entry) || isTestFile(entry)) kinds.push('test');
    }
    if (['pnpm', 'npm', 'yarn'].includes(executable)) {
      let next = index + 1;
      let selectedWorkspace = false;
      while (words[next]?.startsWith('-')) {
        const option = words[next].split('=', 1)[0];
        const selectsWorkspace = ['--dir', '-C', '--prefix', '--filter', '-F', '--workspace'].includes(option)
          || (executable === 'npm' && option === '-w');
        const hasValue = selectsWorkspace || ['--reporter', '--loglevel'].includes(option);
        selectedWorkspace ||= selectsWorkspace;
        next += hasValue && !words[next].includes('=') ? 2 : 1;
      }
      if (words[next] === 'run') next += 1;
      if (/^test(?::|$)/u.test(words[next] ?? '')) {
        kinds.push(executable === 'pnpm' && words[next] === 'test' && !selectedWorkspace ? 'root-test' : 'test');
      }
    }
  }
  // A bare spec path is task metadata. A lint/diff argument naming that path
  // must not turn the enclosing non-test command into a test runner.
  if (words.length === 1 && isTestFile(words[0])) kinds.push('test');
  return kinds;
}

export function isCountableTestCommand(command, args = [], commandLine = '') {
  return testCommandKinds(command, args, commandLine).length > 0;
}

function inferredSkipBudget(command, args = [], commandLine = '') {
  return testCommandKinds(command, args, commandLine).includes('root-test') ? ROOT_UNIT_EXPECTED_SKIPS : 0;
}

function inferRequiredTestExpectation(commandLine) {
  if (!isCountableTestCommand(null, [], commandLine)) return null;
  return { requireCounts: true, expectedSkips: inferredSkipBudget(null, [], commandLine) };
}

function gateCommandTokens(gate) {
  const tokens = [...(gate.args ?? [])].map((value) => String(value));
  if (typeof gate.commandLine === 'string' && gate.commandLine.trim()) {
    tokens.push(...gate.commandLine.trim().split(/[\s"';&|]+/u));
  }
  return tokens.map((token) => token.split('=', 1)[0]);
}

export function parseTestCounts(stdout, stderr = '') {
  const text = `${String(stdout ?? '')}\n${String(stderr ?? '')}`.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '');
  const segments = [];
  const statuses = {
    passed: 'passed', pass: 'passed', flaky: 'passed',
    failed: 'failed', fail: 'failed', interrupted: 'failed', cancelled: 'failed',
    skipped: 'skipped', todo: 'skipped', 'did not run': 'skipped',
  };
  for (const line of text.split(/\r?\n/u)) {
    const row = { passed: 0, failed: 0, skipped: 0 };
    if (/^\s*Tests\s+\d+/iu.test(line)) {
      const counts = [...line.matchAll(/\b(\d+)\s+(passed|failed|skipped|todo)\b/giu)];
      if (!counts.length) return null;
      for (const [, count, status] of counts) row[statuses[status.toLowerCase()]] += Number(count);
      const declaredTotal = line.match(/\((\d+)\)\s*$/u);
      if (declaredTotal && Number(declaredTotal[1]) !== row.passed + row.failed + row.skipped) return null;
    } else {
      // Playwright prints one status per line; Node's spec/TAP reporters use
      // "ℹ pass 2" / "# pass 2". Test-file summaries are deliberately excluded.
      const playwright = line.match(/^\s*(\d+)\s+(passed|failed|skipped|flaky|interrupted|did not run)(?:\s+\([^)]*\))?\s*$/iu);
      const node = line.match(/^\s*(?:#|ℹ)\s+(pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/iu);
      if (!playwright && !node) continue;
      const [, count, status] = playwright ?? [null, node[2], node[1]];
      row[statuses[status.toLowerCase()]] = Number(count);
    }
    if (!Object.values(row).every(Number.isSafeInteger)) return null;
    segments.push(row);
  }
  if (segments.length === 0) return null;
  const passed = segments.reduce((sum, row) => sum + row.passed, 0);
  const failed = segments.reduce((sum, row) => sum + row.failed, 0);
  const skipped = segments.reduce((sum, row) => sum + row.skipped, 0);
  if (![passed, failed, skipped, passed + failed + skipped].every(Number.isSafeInteger)) return null;
  return {
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    source: 'parsed',
    segments: segments.length,
  };
}

function pnpmGateSpawnSpec(command, args) {
  // Node cannot exec .cmd shims directly on Windows (EINVAL). Match the repo's
  // pnpm-runner pattern: wrap in cmd.exe and rely on the shim's trailing
  // `exit /b %errorlevel%` to propagate the child's real exit code. (The shim
  // must keep that line; a shim without it fails open.)
  if (process.platform !== 'win32' || !/^pnpm(\.cmd)?$/iu.test(commandName(command))) {
    return { command, args, shell: false };
  }
  const escaped = [command, ...args].map((part) => {
    const text = String(part);
    if (!/^[A-Za-z0-9_./\\:-]+$/u.test(text)) {
      return `"${text.replace(/"/gu, '""')}"`;
    }
    return text;
  });
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', escaped.join(' ')],
    shell: false,
    windowsVerbatimArguments: true,
  };
}

function shellCommandLineSpec(commandLine) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }
  return { command: 'sh', args: ['-c', commandLine], shell: false };
}

function spawnGate(gate, options = {}) {
  let spawnSpec;
  if (typeof gate.commandLine === 'string' && gate.commandLine.trim().length > 0) {
    // required-test gates carry a full command line declared by the task spec;
    // run it through the platform shell with the same failure posture.
    spawnSpec = shellCommandLineSpec(gate.commandLine);
  } else {
    const command = commandName(gate.command) === 'pnpm' ? pnpmExecutable() : gate.command;
    spawnSpec = pnpmGateSpawnSpec(command, gate.args);
  }
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = (options.spawn ?? spawnSync)(spawnSpec.command, spawnSpec.args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false,
    timeout: gate.timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const stdout = redactText(result.stdout ?? '', options);
  const stderr = redactText(result.stderr ?? '', options);
  const timedOut = Boolean(result.error && (result.error.code === 'ETIMEDOUT' || /timed out/iu.test(result.error.message ?? '')));
  const status = timedOut ? 'timeout' : result.status === 0 ? 'pass' : 'fail';
  return {
    id: gate.id,
    profile: gate.profile,
    name: gate.name,
    command: gate.commandLine ?? gate.command,
    args: [...gate.args],
    timeoutMs: gate.timeoutMs,
    safety: { ...(gate.safety ?? {}) },
    status,
    required: gate.required === true,
    allowSkip: gate.allowSkip === true,
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    timedOut,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    stdout,
    stderr,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    error: result.error ? String(result.error.message ?? result.error) : null,
    testExpectation: gate.testExpectation ?? null,
    testCounts: gate.testExpectation?.requireCounts ? parseTestCounts(stdout, stderr) : null,
  };
}

function writeGateLogs(outputDir, gateResult) {
  const stdoutPath = safeRelativeOutputPath(outputDir, `logs/${gateResult.id}.stdout.log`);
  const stderrPath = safeRelativeOutputPath(outputDir, `logs/${gateResult.id}.stderr.log`);
  ensureDirectory(dirname(stdoutPath.full));
  writeFileSync(stdoutPath.full, gateResult.stdout, 'utf8');
  writeFileSync(stderrPath.full, gateResult.stderr, 'utf8');
  return {
    stdout: stdoutPath.normalized,
    stderr: stderrPath.normalized,
    stdoutSha256: sha256File(stdoutPath.full),
    stderrSha256: sha256File(stderrPath.full),
  };
}

function tf0009TestCounts(report) {
  return { passed: report.runs.length, failed: 0, skipped: 0, total: report.runs.length, source: 'adapter-report' };
}

function runTf0009Adapter(gate, options = {}) {
  const result = spawnGate(gate, options);
  if (result.status !== 'pass') return result;
  const sourceReport = join(options.cwd, 'artifacts', 'first-product-preview', 'TF-0009', 'agent-surrogate-report.json');
  const sourceCharter = join(options.cwd, 'artifacts', 'first-product-preview', 'TF-0009', 'agent-surrogate-charter.json');
  const adapterDir = ensureDirectory(join(options.outputDir, 'adapters', 'tf0009'));
  if (!existsSync(sourceReport)) {
    result.status = 'fail';
    result.error = 'TF-0009 adapter did not produce agent-surrogate-report.json in isolated worktree';
    return result;
  }
  copyFileSync(sourceReport, join(adapterDir, 'agent-surrogate-report.json'));
  if (existsSync(sourceCharter)) copyFileSync(sourceCharter, join(adapterDir, 'agent-surrogate-charter.json'));
  const report = JSON.parse(readFileSync(sourceReport, 'utf8'));
  const validation = validateTf0009AgentSurrogateReport(report);
  if (!validation.ok) {
    result.status = 'fail';
    result.error = `TF-0009 adapter report invalid: ${validation.errors.join('; ')}`;
    return result;
  }
  if (report.humanEquivalent !== false || report.liveEvidence !== false || report.taskForest?.canMarkDone !== false) {
    result.status = 'fail';
    result.error = 'TF-0009 adapter attempted to promote agent evidence';
    return result;
  }
  const boundaries = report.frozenBoundaries ?? {};
  if (boundaries.liveReady !== false || boundaries.productApproved !== false || boundaries.defaultOn !== false) {
    result.status = 'fail';
    result.error = 'TF-0009 adapter changed a product lock';
    return result;
  }
  result.adapterEvidence = {
    report: 'adapters/tf0009/agent-surrogate-report.json',
    reportSha256: sha256File(join(adapterDir, 'agent-surrogate-report.json')),
    humanEquivalent: false,
    liveEvidence: false,
  };
  result.testCounts = tf0009TestCounts(report);
  return result;
}

/**
 * Reconstruct a gitignored VerseShell binary inside the detached acceptance
 * worktree. The ordered patch stack and pinned source are rebuilt by the
 * bundle qualification command; no binary is copied from the caller's dirty
 * repository or cited as source-of-truth evidence.
 */
function runVerseShellBinaryProvision(gate, options = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const base = {
    id: gate.id,
    profile: gate.profile,
    name: gate.name,
    command: gate.command,
    args: [...gate.args],
    timeoutMs: gate.timeoutMs,
    safety: { ...(gate.safety ?? {}) },
  };
  const fail = (error) => ({
    ...base,
    status: 'fail',
    required: true,
    allowSkip: false,
    exitCode: 1,
    signal: null,
    timedOut: false,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    stdout: '',
    stderr: `${String(error)}\n`,
    stdoutSha256: sha256(''),
    stderrSha256: sha256(`${String(error)}\n`),
    stdoutBytes: 0,
    stderrBytes: Buffer.byteLength(String(error)),
    error: String(error),
    testExpectation: gate.testExpectation ?? null,
    testCounts: null,
  });
  try {
    const argv = [...(gate.args ?? [])];
    const manifestRelative = argv[argv.indexOf('--manifest') + 1];
    const binaryRelative = argv[argv.indexOf('--binary') + 1];
    if (!manifestRelative || !binaryRelative) return fail('provision gate requires --manifest and --binary');
    const worktree = options.cwd;
    if (!worktree) return fail('provision gate requires cwd');
    const manifestPath = resolve(worktree, manifestRelative);
    if (!existsSync(manifestPath)) return fail(`committed manifest missing in worktree: ${manifestRelative}`);
    const rebuildArgs = ['scripts/verseshell-bundle.mjs', 'rebuild', '--mode', 'package'];
    if (process.env.VERSESHELL_SOURCE_MIRROR) {
      rebuildArgs.push('--source-mirror', process.env.VERSESHELL_SOURCE_MIRROR);
    }
    const rebuild = (options.spawn ?? spawnSync)(process.execPath, rebuildArgs, {
      cwd: worktree,
      encoding: 'utf8',
      env: { ...process.env, ...(options.env ?? {}) },
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      timeout: gate.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      windowsHide: true,
    });
    if (rebuild.error || rebuild.status !== 0) {
      return fail(`clean VerseShell reconstruction failed: ${rebuild.error?.message || rebuild.stderr || `exit ${rebuild.status}`}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const artifact = manifest.artifacts?.['win32-x64'];
    if (!artifact || typeof artifact.sha256 !== 'string' || !Number.isSafeInteger(artifact.bytes)) {
      return fail('reconstructed manifest lacks win32-x64 artifact sha256/bytes');
    }
    const sourceBinary = resolve(worktree, binaryRelative);
    if (!existsSync(sourceBinary)) return fail(`reconstructed binary missing: ${binaryRelative}`);
    const sourceBytes = readFileSync(sourceBinary);
    const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex');
    if (sourceDigest !== artifact.sha256 || sourceBytes.length !== artifact.bytes) {
      return fail(`source binary does not match committed manifest (sha256 ${sourceDigest.slice(0, 12)}… expected ${artifact.sha256.slice(0, 12)}…, bytes ${sourceBytes.length} expected ${artifact.bytes})`);
    }
    const dest = sourceBinary;
    mkdirSync(dirname(dest), { recursive: true });
    const provisionedBytes = readFileSync(dest);
    const provisionedDigest = createHash('sha256').update(provisionedBytes).digest('hex');
    if (provisionedDigest !== artifact.sha256 || provisionedBytes.length !== artifact.bytes) {
      return fail('provisioned binary verification failed in worktree');
    }
    let stdout = `provisioned ${binaryRelative} (${provisionedBytes.length} bytes, sha256 ${provisionedDigest.slice(0, 16)}…) verified against committed manifest\n`;
    const copied = [];
    const sourceRoot = options.sourceRoot;
    if (!sourceRoot) return fail('provision copy requires sourceRoot and cwd');
    const expectedCopies = Array.isArray(gate.copyInputs) ? gate.copyInputs : [];
    const copyRelativePaths = extractCopyPaths(argv);
    if (expectedCopies.length !== copyRelativePaths.length) {
      return fail('provision copyInputs must map 1:1 to --copy paths');
    }
    for (const [index, copyRelative] of copyRelativePaths.entries()) {
      const expected = expectedCopies[index];
      if (!copyRelative || !expected || expected.path !== copyRelative || expected.exists !== true) {
        return fail(`provision copy is not locked: ${copyRelative ?? index}`);
      }
      const sourcePath = resolve(sourceRoot, copyRelative);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        return fail(`provision source missing: ${copyRelative}`);
      }
      const sourceBytes = readFileSync(sourcePath);
      const sourceDigest = sha256(sourceBytes);
      if (sourceDigest !== expected.sha256 || sourceBytes.length !== expected.bytes) {
        return fail(`provision source digest mismatch: ${copyRelative}`);
      }
      const destPath = resolve(worktree, copyRelative);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(sourcePath, destPath);
      const destBytes = readFileSync(destPath);
      const destDigest = sha256(destBytes);
      if (destDigest !== expected.sha256 || destBytes.length !== expected.bytes) {
        return fail(`provision destination digest mismatch: ${copyRelative}`);
      }
      copied.push(`${copyRelative} (${destBytes.length} bytes, sha256 ${destDigest.slice(0, 16)}…)`);
    }
    if (copied.length > 0) stdout += `copied ${copied.join(', ')} from source repository\n`;
    if (argv.includes('--electron')) {
      const sourceElectron = resolve(sourceRoot, 'node_modules/.pnpm/electron@40.8.4/node_modules/electron');
      const worktreeElectron = resolve(worktree, 'node_modules/.pnpm/electron@40.8.4/node_modules/electron');
      const sourceDist = join(sourceElectron, 'dist');
      const sourcePathTxt = join(sourceElectron, 'path.txt');
      if (!existsSync(sourceDist) || !existsSync(sourcePathTxt)) {
        return fail('electron dist/path.txt missing in source repository (run electron postinstall or install without --ignore-scripts)');
      }
      const worktreeDist = join(worktreeElectron, 'dist');
      rmSync(worktreeDist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      mkdirSync(worktreeDist, { recursive: true });
      copyRecursiveSync(sourceDist, worktreeDist);
      copyFileSync(sourcePathTxt, join(worktreeElectron, 'path.txt'));
      const entry = readFileSync(join(worktreeElectron, 'path.txt'), 'utf8').trim();
      const provisionedElectron = join(worktreeDist, entry);
      if (!existsSync(provisionedElectron)) {
        return fail(`electron binary not provisioned: expected ${entry} in dist`);
      }
      stdout += `provisioned electron dist (${readdirSync(worktreeDist).length} entries, path.txt=${entry})\n`;
    }
    return {
      ...base,
      status: 'pass',
      required: true,
      allowSkip: false,
      exitCode: 0,
      signal: null,
      timedOut: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      stdout,
      stderr: '',
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(''),
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: 0,
      error: null,
      testExpectation: gate.testExpectation ?? null,
      testCounts: null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Recursively copy a directory tree. Used to provision the project-local
 * Electron binary (dist/) that pnpm --ignore-scripts does not produce in a
 * detached worktree.
 */
function copyRecursiveSync(sourceDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(sourcePath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, destPath);
    } else if (entry.isSymbolicLink()) {
      const link = readlinkSync(sourcePath);
      mkdirSync(dirname(destPath), { recursive: true });
      try {
        symlinkSync(link, destPath);
      } catch {
        const target = resolve(dirname(sourcePath), link);
        if (existsSync(target) && statSync(target).isFile()) copyFileSync(target, destPath);
      }
    }
  }
}

function sanitizeGateResult(gateResult, outputDir) {
  const logs = writeGateLogs(outputDir, gateResult);
  return {
    ...gateResult,
    stdout: undefined,
    stderr: undefined,
    logs,
  };
}

function resultContract(result) {
  return {
    id: result.id,
    profile: result.profile,
    name: result.name,
    command: result.command,
    args: result.args ?? [],
    status: result.status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    required: result.required,
    allowSkip: result.allowSkip,
    timeoutMs: result.timeoutMs,
    safety: result.safety ?? null,
    testExpectation: result.testExpectation ?? null,
    testCounts: result.testCounts ?? null,
    logs: result.logs
      ? {
        stdout: result.logs.stdout,
        stderr: result.logs.stderr,
        stdoutSha256: result.logs.stdoutSha256,
        stderrSha256: result.logs.stderrSha256,
      }
      : null,
  };
}

function prefixGateEvidence(gate, prefix) {
  const withPrefix = (pathValue) => (pathValue ? `${prefix.replace(/[\\/]+$/u, '')}/${pathValue}` : pathValue);
  return {
    ...gate,
    artifacts: gate.artifacts?.map((artifact) => ({
      ...artifact,
      path: withPrefix(artifact.path),
    })),
    logs: gate.logs
      ? {
        ...gate.logs,
        stdout: withPrefix(gate.logs.stdout),
        stderr: withPrefix(gate.logs.stderr),
      }
      : gate.logs,
    adapterEvidence: gate.adapterEvidence
      ? { ...gate.adapterEvidence, report: withPrefix(gate.adapterEvidence.report) }
      : gate.adapterEvidence,
  };
}

function verifyLogs(outputDir, result, gate) {
  const errors = [];
  const logText = {};
  for (const stream of ['stdout', 'stderr']) {
    const pathValue = result.logs?.[stream];
    if (!pathValue) {
      errors.push(`${result.id}: missing ${stream} log path`);
      continue;
    }
    try {
      const { full } = safeRelativeOutputPath(outputDir, pathValue);
      const bytes = readFileSync(full);
      const actual = sha256(bytes);
      logText[stream] = bytes.toString('utf8');
      const declared = result.logs[`${stream}Sha256`];
      if (typeof declared !== 'string' || !/^[a-f0-9]{64}$/u.test(declared) || !equalDigest(actual, declared)) {
        errors.push(`${result.id}: ${stream} log digest mismatch`);
      }
      if (typeof result[`${stream}Sha256`] === 'string' && !equalDigest(result[`${stream}Sha256`], declared)) {
        errors.push(`${result.id}: ${stream} report/log digest mismatch`);
      }
    } catch (error) {
      errors.push(`${result.id}: ${stream} log unavailable (${error.message})`);
    }
  }
  // Adapter counts are checked against their controlled JSON artifact below;
  // only the candidate-derived gate kind can select that evidence source.
  const usesAdapterCounts = gate.kind === 'adapter' && gate.adapter === TF0009_ADAPTER_ID;
  if (errors.length === 0 && gate.testExpectation?.requireCounts && !usesAdapterCounts) {
    const counts = parseTestCounts(logText.stdout, logText.stderr);
    if (!counts || stableJson(counts) !== stableJson(result.testCounts)) {
      errors.push(`${result.id}: persisted log test counts do not match the report`);
    }
  }
  return errors;
}

function environmentSnapshot(env, options = {}) {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    packageManager: 'pnpm',
    tlsOverridePresent: Object.prototype.hasOwnProperty.call(env, 'NODE_TLS_REJECT_UNAUTHORIZED'),
    providerKeysPresent: options.providerKeys ?? [],
    repositoryPathRedacted: true,
  };
}

function summarizeTestCounts(gateResults) {
  const summary = { passed: 0, failed: 0, skipped: 0, total: 0, unavailableGates: 0 };
  for (const result of gateResults) {
    if (!result.testExpectation?.requireCounts) continue;
    if (!result.testCounts) {
      summary.unavailableGates += 1;
      continue;
    }
    summary.passed += result.testCounts.passed ?? 0;
    summary.failed += result.testCounts.failed ?? 0;
    summary.skipped += result.testCounts.skipped ?? 0;
    summary.total += result.testCounts.total ?? 0;
  }
  return summary;
}

function controlledArtifacts(outputDir, manifest, gateResults) {
  const artifacts = [];
  const manifestPath = safeRelativeOutputPath(outputDir, 'manifest.snapshot.json');
  if (existsSync(manifestPath.full)) {
    artifacts.push({
      kind: 'manifest-snapshot',
      path: manifestPath.normalized,
      sha256: sha256File(manifestPath.full),
      sourceDigest: manifest.manifestDigest,
    });
  }
  for (const gate of gateResults) {
    for (const artifact of gate.artifacts ?? []) {
      artifacts.push({
        kind: artifact.kind,
        gateId: gate.id,
        path: artifact.path,
        sha256: artifact.sha256,
        schema: artifact.schema,
      });
    }
    if (!gate.adapterEvidence?.report || !gate.adapterEvidence.reportSha256) continue;
    artifacts.push({
      kind: 'adapter-evidence',
      gateId: gate.id,
      path: gate.adapterEvidence.report,
      sha256: gate.adapterEvidence.reportSha256,
    });
  }
  return artifacts;
}

function makeReport(manifest, options, gateResults, extras = {}) {
  const failures = gateResults.flatMap((result) => {
    if (result.status === 'pass' && result.required === true && result.allowSkip !== true) return [];
    return [
      `${result.id}: ${result.status}`,
      ...(result.error ? [`${result.id}: ${result.error}`] : []),
    ];
  });
  for (const result of gateResults) {
    if (!result.testExpectation?.requireCounts) continue;
    if (!result.testCounts) {
      failures.push(`${result.id}: test counts were not parsed`);
      continue;
    }
    if (
      result.testCounts.total !== result.testCounts.passed + result.testCounts.failed + result.testCounts.skipped
      || result.testCounts.total === 0
    ) {
      failures.push(`${result.id}: parsed test counts are inconsistent or empty`);
    }
    if (result.testCounts.failed !== 0) failures.push(`${result.id}: parsed failed tests=${result.testCounts.failed}`);
    if (result.testCounts.skipped !== result.testExpectation.expectedSkips) {
      failures.push(`${result.id}: skip budget mismatch expected=${result.testExpectation.expectedSkips} actual=${result.testCounts.skipped}`);
    }
  }
  if (manifest.executionMode !== 'full') failures.push('formal acceptance requires full execution mode');
  if (manifest.source?.missing?.length) failures.push(`missing source inputs: ${manifest.source.missing.join(', ')}`);
  const { failures: extraFailures = [], ...extraFields } = extras;
  failures.push(...extraFailures);
  const allPassed = failures.length === 0 && gateResults.length === manifest.gates.length;
  const humanResidual = manifest.task?.humanEvidence === 'required';
  return {
    schema: ACCEPTANCE_REPORT_SCHEMA,
    documentType: 'agent-engineering-acceptance-report',
    reportVersion: 1,
    runId: manifest.runId,
    role: options.role,
    actor: options.actor,
    executorActor: extras.executorActor ?? (options.role === 'executor' ? options.actor : null),
    verifierActor: extras.verifierActor ?? (options.role === 'verifier' ? options.actor : null),
    generatedAt: new Date().toISOString(),
    candidate: manifest.candidate,
    source: {
      planDigest: manifest.planDigest,
      manifestDigest: manifest.manifestDigest,
      changedPaths: manifest.changedPaths,
      sourceFiles: manifest.source?.files ?? [],
    },
    coverage: manifest.coverage,
    requiredProfiles: manifest.requiredProfiles,
    gates: gateResults,
    gateContractDigest: sha256(stableJson(gateResults.map(resultContract))),
    testCounts: summarizeTestCounts(gateResults),
    controlledArtifacts: extras.controlledArtifacts ?? [],
    result: allPassed ? 'pass' : 'NO-GO',
    engineeringAcceptedByAgent: options.role === 'verifier' ? allPassed : false,
    taskStatusRecommendation: allPassed && humanResidual ? 'review_needed' : allPassed ? 'engineering-accepted' : 'NO-GO',
    humanEvidenceRequired: humanResidual,
    residuals: [
      ...(manifest.residuals ?? []),
      ...(humanResidual ? ['agent evidence cannot satisfy human/product/live evidence'] : []),
    ],
    safety: {
      scope: 'engineering-only',
      productLocksChanged: false,
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      promotionAuthorized: false,
      prohibitedClaims: manifest.safety?.prohibitedClaims ?? [],
    },
    conclusion: {
      scope: 'engineering-only',
      verifierRequired: true,
      allowedPromotion: false,
      engineeringAcceptedByAgent: options.role === 'verifier' ? allPassed : false,
      residualHumanEvidence: humanResidual,
    },
    environment: environmentSnapshot(options.env ?? process.env, options),
    failures,
    ...extraFields,
  };
}

function collectCandidateBoundGateArtifacts(gate, workspace, outputDir, manifest) {
  const definitions = CANDIDATE_BOUND_GATE_ARTIFACTS[gate.id] ?? [];
  const artifacts = [];
  for (const definition of definitions) {
    const sourcePath = resolve(workspace, definition.source);
    if (!pathInside(sourcePath, workspace) || !existsSync(sourcePath)) {
      throw new Error(`${gate.id}: required candidate-bound artifact is missing: ${definition.source}`);
    }
    const bytes = readFileSync(sourcePath);
    if (bytes.length === 0) throw new Error(`${gate.id}: required candidate-bound artifact is empty: ${definition.source}`);
    let payload;
    try {
      payload = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error(`${gate.id}: required artifact is not JSON: ${definition.source} (${error.message})`);
    }
    if (payload?.schema !== definition.schema) {
      throw new Error(`${gate.id}: required artifact schema mismatch: ${definition.source}`);
    }
    if (
      payload?.candidate?.commit !== manifest.candidate.commit
      || payload?.candidate?.tree !== manifest.candidate.tree
    ) {
      throw new Error(`${gate.id}: required artifact is not bound to the manifest candidate: ${definition.source}`);
    }
    const target = safeRelativeOutputPath(outputDir, `evidence/${gate.id}/${basename(definition.source)}`);
    ensureDirectory(dirname(target.full));
    copyFileSync(sourcePath, target.full);
    artifacts.push({
      kind: definition.kind,
      path: target.normalized,
      sha256: sha256File(target.full),
      schema: definition.schema,
    });
  }
  return artifacts;
}

function failGateForArtifactError(result, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = `${result.stderr ?? ''}${result.stderr ? '\n' : ''}${message}\n`;
  result.status = 'fail';
  result.exitCode = 1;
  result.error = message;
  result.stderr = stderr;
  result.stderrSha256 = sha256(stderr);
  result.stderrBytes = Buffer.byteLength(stderr);
}

export function sealReport(report) {
  report.reportDigest = digestReport(report);
  return report;
}

export function runAcceptance(manifest, options = {}) {
  const role = options.role ?? 'executor';
  const actor = options.actor ?? (role === 'verifier' ? 'verifier-agent' : 'executor-agent');
  const root = resolve(options.sourceRoot ?? REPOSITORY_ROOT);
  const outputDir = assertSafeOutputDirectory(options.outputDir ?? join(DEFAULT_OUTPUT_ROOT, 'runs', manifest.runId), root);
  ensureDirectory(outputDir);
  const envValidation = validateAcceptanceEnvironment(options.env ?? process.env);
  const manifestValidation = validateAcceptanceManifest(manifest, { root, requireClean: true, requireFull: true });
  if (!envValidation.ok || !manifestValidation.ok) {
    const report = makeReport(manifest, { role, actor, env: options.env ?? process.env, providerKeys: envValidation.providerKeys }, [], {
      failures: [...envValidation.errors, ...manifestValidation.errors],
    });
    report.result = 'NO-GO';
    report.engineeringAcceptedByAgent = false;
    report.failures = [...envValidation.errors, ...manifestValidation.errors];
    sealReport(report);
    writeJson(join(outputDir, `${role}-report.json`), report);
    return report;
  }

  let checkout;
  const executionEnv = makeEnvironment(options);
  const secrets = collectSecretValues(options.env ?? process.env);
  const gateResults = [];
  try {
    checkout = createDetachedWorktree(root, { commit: manifest.candidate.commit });
    const workspace = checkout.path;
    for (const gate of manifest.gates) {
      // R1: every required gate, including spec-declared required-test
      // command lines, reruns in this role's detached worktree. Nested
      // acceptance still gets a heap cap so it cannot starve the outer run.
      const gateCwd = workspace;
      const gateEnv =
        gate.kind === 'required-test'
          ? { ...executionEnv, NODE_OPTIONS: '--max-old-space-size=4096' }
          : executionEnv;
      const gateOptions = {
        cwd: gateCwd,
        env: gateEnv,
        outputDir,
        sourceRoot: root,
        worktreeRoot: workspace,
        secrets,
        spawn: options.spawn,
      };
      const result = gate.kind === 'adapter' && gate.adapter === TF0009_ADAPTER_ID
        ? runTf0009Adapter(gate, gateOptions)
        : gate.kind === 'provision-verseshell'
          ? runVerseShellBinaryProvision(gate, gateOptions)
          : spawnGate(gate, gateOptions);
      if (result.status === 'pass') {
        try {
          result.artifacts = collectCandidateBoundGateArtifacts(gate, workspace, outputDir, manifest);
        } catch (error) {
          failGateForArtifactError(result, error);
        }
      }
      const sanitized = sanitizeGateResult(result, outputDir);
      gateResults.push(sanitized);
      if (sanitized.status !== 'pass' && options.continueOnError !== true) break;
    }
    // A skipped/missing gate is never accepted. Preserve a blocked entry for
    // every manifest gate so the report exposes omissions instead of hiding them.
    for (const gate of manifest.gates.slice(gateResults.length)) {
      gateResults.push({
        id: gate.id,
        profile: gate.profile,
        name: gate.name,
        command: gate.command,
        args: [...gate.args],
        status: 'blocked',
        required: true,
        allowSkip: false,
        exitCode: null,
        timedOut: false,
        testExpectation: gate.testExpectation ?? null,
        testCounts: null,
        logs: null,
      });
    }
    const mutationErrors = [];
    const worktreeState = repositoryIdentity(workspace);
    if (!worktreeState.clean) mutationErrors.push('detached worktree changed tracked or unexpected source files during acceptance');
    const sourceState = repositoryIdentity(root);
    if (!sourceState.clean) mutationErrors.push('source worktree changed during acceptance');
    writeJson(join(outputDir, 'manifest.snapshot.json'), manifest);
    const report = makeReport(
      manifest,
      { role, actor, env: options.env ?? process.env, providerKeys: [] },
      gateResults,
      {
        failures: mutationErrors,
        controlledArtifacts: controlledArtifacts(outputDir, manifest, gateResults),
        mutationCheck: {
          sourceCleanAfter: sourceState.clean,
          detachedWorktreeCleanAfter: worktreeState.clean,
          sourceStatusEntries: sourceState.clean ? 0 : sourceState.status.split(/\r?\n/u).filter(Boolean).length,
          detachedStatusEntries: worktreeState.clean ? 0 : worktreeState.status.split(/\r?\n/u).filter(Boolean).length,
          detachedStatus: worktreeState.clean ? [] : worktreeState.status.split(/\r?\n/u).filter(Boolean).slice(0, 20),
        },
      },
    );
    report.worktree = { mode: 'detached-temporary', isolated: true, cleaned: true };
    sealReport(report);
    writeJson(join(outputDir, `${role}-report.json`), report);
    return report;
  } catch (error) {
    if (!existsSync(join(outputDir, 'manifest.snapshot.json'))) writeJson(join(outputDir, 'manifest.snapshot.json'), manifest);
    let sourceCleanAfter = false;
    try {
      sourceCleanAfter = repositoryIdentity(root).clean;
    } catch {
      // The execution error itself remains the authoritative NO-GO reason.
    }
    const report = makeReport(
      manifest,
      { role, actor, env: options.env ?? process.env, providerKeys: [] },
      gateResults,
      {
        failures: [`acceptance execution error: ${error.message ?? String(error)}`],
        controlledArtifacts: controlledArtifacts(outputDir, manifest, gateResults),
        mutationCheck: { sourceCleanAfter, detachedWorktreeCleanAfter: false },
      },
    );
    report.worktree = { mode: 'detached-temporary', isolated: true, cleaned: true };
    sealReport(report);
    writeJson(join(outputDir, `${role}-report.json`), report);
    return report;
  } finally {
    checkout?.cleanup();
  }
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function verifyControlledArtifacts(outputDir, manifest, report, label) {
  const errors = [];
  if (!Array.isArray(report?.controlledArtifacts)) {
    errors.push(`${label} controlledArtifacts must be an array`);
    return errors;
  }
  for (const gate of manifest.gates ?? []) {
    if (gate.kind !== 'adapter' || gate.adapter !== TF0009_ADAPTER_ID) continue;
    const actual = report.gates?.find((result) => result.id === gate.id);
    const artifacts = report.controlledArtifacts.filter((artifact) => artifact.kind === 'adapter-evidence' && artifact.gateId === gate.id);
    if (artifacts.length !== 1) {
      errors.push(`${label} must contain one required adapter evidence artifact: ${gate.id}`);
      continue;
    }
    const artifact = artifacts[0];
    if (actual?.adapterEvidence?.report !== artifact.path || actual?.adapterEvidence?.reportSha256 !== artifact.sha256) {
      errors.push(`${label} adapter evidence record mismatch: ${gate.id}`);
    }
    try {
      const { full } = safeRelativeOutputPath(outputDir, artifact.path);
      const payload = readJson(full);
      const validation = validateTf0009AgentSurrogateReport(payload);
      if (!validation.ok) {
        errors.push(`${label} adapter report invalid: ${validation.errors.join('; ')}`);
      } else if (stableJson(actual?.testCounts) !== stableJson(tf0009TestCounts(payload))) {
        errors.push(`${label} adapter test counts do not match the controlled artifact: ${gate.id}`);
      }
    } catch (error) {
      errors.push(`${label} adapter evidence unavailable: ${gate.id} (${error.message})`);
    }
  }
  const requiredCandidateArtifacts = (manifest?.gates ?? []).flatMap((gate) =>
    (CANDIDATE_BOUND_GATE_ARTIFACTS[gate?.id] ?? []).map((definition) => ({
      gateId: gate.id,
      kind: definition.kind,
      schema: definition.schema,
    })),
  );
  for (const required of requiredCandidateArtifacts) {
    const matches = report.controlledArtifacts.filter((artifact) =>
      artifact?.gateId === required.gateId && artifact?.kind === required.kind,
    );
    if (matches.length === 0) {
      errors.push(`${label} is missing required candidate-bound artifact: ${required.gateId}/${required.kind}`);
    } else if (matches.length > 1) {
      errors.push(`${label} has duplicate candidate-bound artifacts: ${required.gateId}/${required.kind}`);
    } else if (matches[0].schema !== required.schema) {
      errors.push(`${label} controlled artifact schema record mismatch: ${matches[0].path}`);
    }
  }
  for (const artifact of report.controlledArtifacts) {
    if (!artifact?.path || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      errors.push(`${label} has an incomplete controlled artifact record`);
      continue;
    }
    try {
      const { full } = safeRelativeOutputPath(outputDir, artifact.path);
      if (!existsSync(full) || !equalDigest(sha256File(full), artifact.sha256)) {
        errors.push(`${label} controlled artifact digest mismatch: ${artifact.path}`);
        continue;
      }
      if (statSync(full).size === 0) {
        errors.push(`${label} controlled artifact is empty: ${artifact.path}`);
        continue;
      }
      if (artifact.kind === 'manifest-snapshot') {
        if (artifact.sourceDigest !== report?.source?.manifestDigest) {
          errors.push(`${label} manifest snapshot source digest mismatch`);
        }
        try {
          const snapshot = JSON.parse(readFileSync(full, 'utf8'));
          if (stableJson(snapshot) !== stableJson(manifest)) errors.push(`${label} manifest snapshot content mismatch`);
        } catch (error) {
          errors.push(`${label} manifest snapshot is not JSON: ${artifact.path} (${error.message})`);
        }
      }
      const expectedSchema = Object.values(CANDIDATE_BOUND_GATE_ARTIFACTS)
        .flat()
        .find((definition) => definition.kind === artifact.kind)?.schema;
      if (expectedSchema) {
        if (artifact.schema !== expectedSchema) errors.push(`${label} controlled artifact schema record mismatch: ${artifact.path}`);
        let payload;
        try {
          payload = JSON.parse(readFileSync(full, 'utf8'));
        } catch (error) {
          errors.push(`${label} controlled artifact is not JSON: ${artifact.path} (${error.message})`);
          continue;
        }
        if (
          payload?.schema !== expectedSchema
          || payload?.candidate?.commit !== report?.candidate?.commit
          || payload?.candidate?.tree !== report?.candidate?.tree
        ) {
          errors.push(`${label} controlled artifact schema or candidate mismatch: ${artifact.path}`);
        }
      }
    } catch (error) {
      errors.push(`${label} controlled artifact unavailable: ${artifact.path} (${error.message})`);
    }
  }
  return errors;
}

export function validateReportEvidence(manifest, report, outputDir, options = {}) {
  const label = options.label ?? 'report';
  const expectedRole = options.expectedRole;
  const errors = [];
  if (report?.schema !== ACCEPTANCE_REPORT_SCHEMA) errors.push(`${label} schema mismatch`);
  if (expectedRole && report?.role !== expectedRole) errors.push(`${label} role mismatch`);
  if (report?.runId !== manifest.runId) errors.push(`${label} runId mismatch`);
  if (report?.source?.planDigest !== manifest.planDigest) errors.push(`${label} plan digest mismatch`);
  if (report?.source?.manifestDigest !== manifest.manifestDigest) errors.push(`${label} manifest digest mismatch`);
  if (report?.candidate?.commit !== manifest.candidate.commit || report?.candidate?.tree !== manifest.candidate.tree) {
    errors.push(`${label} candidate identity mismatch`);
  }
  if (stableJson(report?.source?.changedPaths ?? null) !== stableJson(manifest.changedPaths ?? null)) {
    errors.push(`${label} changed-path evidence mismatch`);
  }
  if (stableJson(report?.source?.sourceFiles ?? null) !== stableJson(manifest.source?.files ?? null)) {
    errors.push(`${label} source-input evidence mismatch`);
  }
  const reportDigest = report?.reportDigest;
  if (typeof reportDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(reportDigest)) {
    errors.push(`${label} semantic reportDigest is missing or malformed`);
  } else if (!equalDigest(digestReport(report), reportDigest)) {
    errors.push(`${label} semantic reportDigest mismatch`);
  }

  const expectedGates = Array.isArray(manifest.gates) ? manifest.gates : [];
  const actualGates = Array.isArray(report?.gates) ? report.gates : [];
  const expectedIds = expectedGates.map((gate) => gate.id);
  const actualIds = actualGates.map((gate) => gate.id);
  if (expectedIds.join('\0') !== actualIds.join('\0')) errors.push(`${label} gate set/order mismatch`);
  for (let index = 0; index < expectedGates.length; index += 1) {
    const expected = expectedGates[index];
    const actual = actualGates[index];
    if (!actual || actual.id !== expected.id) continue;
    // Required-test gates carry a commandLine; spawnGate records the resolved
    // command as commandLine ?? command, so compare against the same effective
    // command rather than the manifest's raw (null) command field.
    const effectiveCommand = typeof expected.commandLine === 'string' && expected.commandLine.trim().length > 0
      ? expected.commandLine
      : expected.command;
    if (actual.command !== effectiveCommand || stableJson(actual.args ?? []) !== stableJson(expected.args ?? [])) {
      errors.push(`${label} gate command mismatch: ${expected.id}`);
    }
    if (actual.profile !== expected.profile || actual.name !== expected.name || actual.timeoutMs !== expected.timeoutMs) {
      errors.push(`${label} gate execution contract mismatch: ${expected.id}`);
    }
    if (stableJson(actual.safety ?? null) !== stableJson(expected.safety ?? null)) {
      errors.push(`${label} gate safety contract mismatch: ${expected.id}`);
    }
    if (actual.required !== true || actual.allowSkip !== false) {
      errors.push(`${label} gate requirement contract mismatch: ${expected.id}`);
    }
    if (actual.status !== 'pass' || actual.exitCode !== 0 || actual.timedOut !== false) {
      errors.push(`${label} gate result is not a passing completed run: ${expected.id}`);
    }
    if (stableJson(actual.testExpectation ?? null) !== stableJson(expected.testExpectation ?? null)) {
      errors.push(`${label} gate test contract mismatch: ${expected.id}`);
    }
    if (expected.testExpectation?.requireCounts) {
      const counts = actual.testCounts;
      if (!counts || !['passed', 'failed', 'skipped', 'total'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) {
        errors.push(`${label} gate test counts are missing or invalid: ${expected.id}`);
      } else {
        if (counts.total !== counts.passed + counts.failed + counts.skipped || counts.total === 0) {
          errors.push(`${label} gate test counts are inconsistent or empty: ${expected.id}`);
        }
        if (counts.failed !== 0) errors.push(`${label} gate parsed failures are non-zero: ${expected.id}`);
        if (counts.skipped !== expected.testExpectation.expectedSkips) {
          errors.push(`${label} gate skip budget mismatch: ${expected.id}`);
        }
      }
    }
    errors.push(...verifyLogs(outputDir, actual, expected));
  }
  const expectedGateContractDigest = sha256(stableJson(actualGates.map(resultContract)));
  if (!equalDigest(expectedGateContractDigest, report?.gateContractDigest)) {
    errors.push(`${label} gate contract digest mismatch`);
  }
  const actualCounts = summarizeTestCounts(actualGates);
  for (const key of ['passed', 'failed', 'skipped', 'total', 'unavailableGates']) {
    if (report?.testCounts?.[key] !== actualCounts[key]) errors.push(`${label} aggregate test count mismatch: ${key}`);
  }
  errors.push(...verifyControlledArtifacts(outputDir, manifest, report, label));
  if (report?.mutationCheck?.sourceCleanAfter !== true || report?.mutationCheck?.detachedWorktreeCleanAfter !== true) {
    errors.push(`${label} lacks a clean-after-run proof`);
  }
  return errors;
}

export function validateExecutorEvidence(manifest, executorReport, outputDir) {
  const errors = validateReportEvidence(manifest, executorReport, outputDir, {
    expectedRole: 'executor',
    label: 'executor report',
  });
  const actor = executorReport?.actor;
  if (typeof actor !== 'string' || actor.trim() === '') {
    errors.push('executor report actor is missing, blank, or not a string');
  }
  if (typeof executorReport?.executorActor !== 'string' || executorReport.executorActor.trim() === '') {
    errors.push('executor report executorActor is missing, blank, or not a string');
  } else if (executorReport.executorActor !== actor) {
    errors.push('executor report actor and executorActor fields differ');
  }
  if (executorReport?.result !== 'pass') errors.push('executor report is not a passing run');
  if (executorReport?.engineeringAcceptedByAgent === true) errors.push('executor cannot self-accept engineering evidence');
  return errors;
}

export function verifyAcceptance(manifest, options = {}) {
  const root = resolve(options.sourceRoot ?? REPOSITORY_ROOT);
  const outputDir = assertSafeOutputDirectory(options.outputDir ?? join(DEFAULT_OUTPUT_ROOT, 'runs', manifest.runId), root);
  const verifierActor = options.actor ?? 'verifier-agent';
  let executorReport;
  try {
    executorReport = options.executorReport ?? readJson(options.executorReportPath ?? join(outputDir, 'executor-report.json'));
  } catch (error) {
    const report = makeReport(manifest, { role: 'verifier', actor: verifierActor, env: options.env ?? process.env }, [], {
      executorActor: null,
      verifierActor,
      failures: [`executor report unavailable: ${error.message}`],
    });
    report.result = 'NO-GO';
    report.engineeringAcceptedByAgent = false;
    sealReport(report);
    writeJson(join(outputDir, 'verifier-report.json'), report);
    return report;
  }
  const evidenceErrors = validateExecutorEvidence(manifest, executorReport, outputDir);
  if (executorReport.actor && executorReport.actor === verifierActor) evidenceErrors.push('executor and verifier identities must differ');
  const envValidation = validateAcceptanceEnvironment(options.env ?? process.env);
  const manifestValidation = validateAcceptanceManifest(manifest, { root, requireClean: true, requireFull: true });
  const preflightErrors = [...evidenceErrors, ...envValidation.errors, ...manifestValidation.errors];
  if (preflightErrors.length > 0) {
    const report = makeReport(manifest, { role: 'verifier', actor: verifierActor, env: options.env ?? process.env, providerKeys: envValidation.providerKeys }, [], {
      executorActor: executorReport.actor ?? null,
      verifierActor,
      failures: preflightErrors,
      executorEvidence: { result: executorReport.result ?? 'unknown', verified: false },
    });
    report.result = 'NO-GO';
    report.engineeringAcceptedByAgent = false;
    report.failures = preflightErrors;
    sealReport(report);
    writeJson(join(outputDir, 'verifier-report.json'), report);
    return report;
  }

  const verifierOutputDir = ensureDirectory(join(outputDir, 'verifier'));
  const verifierRun = runAcceptance(manifest, {
    ...options,
    sourceRoot: root,
    outputDir: verifierOutputDir,
    role: 'verifier',
    actor: verifierActor,
    continueOnError: true,
  });
  const consistencyErrors = [];
  const executorContracts = new Map((executorReport.gates ?? []).map((gate) => [gate.id, resultContract(gate)]));
  for (const gate of verifierRun.gates ?? []) {
    const expected = executorContracts.get(gate.id);
    const actual = resultContract(gate);
    if (!expected || expected.status !== actual.status || expected.exitCode !== actual.exitCode || expected.timedOut !== actual.timedOut) {
      consistencyErrors.push(`${gate.id}: executor/verifier result contract differs`);
    }
  }
  const verifierGates = (verifierRun.gates ?? []).map((gate) => prefixGateEvidence(gate, 'verifier'));
  const verifierFailures = verifierRun.result === 'pass' ? [] : [...(verifierRun.failures ?? ['verifier rerun did not pass'])];
  const report = makeReport(manifest, { role: 'verifier', actor: verifierActor, env: options.env ?? process.env, providerKeys: [] }, verifierGates, {
    executorActor: executorReport.actor ?? null,
    verifierActor,
    executorEvidence: { result: executorReport.result, verified: true },
    consistency: { identicalGateContracts: consistencyErrors.length === 0, errors: consistencyErrors },
    controlledArtifacts: controlledArtifacts(outputDir, manifest, verifierGates),
    mutationCheck: verifierRun.mutationCheck,
    failures: [...verifierFailures, ...consistencyErrors],
  });
  if (consistencyErrors.length > 0) {
    report.result = 'NO-GO';
    report.engineeringAcceptedByAgent = false;
    report.taskStatusRecommendation = 'NO-GO';
  }
  sealReport(report);
  writeJson(join(outputDir, 'verifier-report.json'), report);
  writeJson(join(outputDir, 'final-report.json'), report);
  return report;
}

export function readAcceptanceStatus(outputRoot = DEFAULT_OUTPUT_ROOT) {
  const root = resolve(outputRoot);
  const runs = [];
  if (!existsSync(root)) return { schema: ACCEPTANCE_SCHEMA, outputRoot: '<redacted>', runs, latest: null, counts: {} };
  const addRun = (reportPathValue, displayPath) => {
    try {
      const report = readJson(reportPathValue);
      runs.push({
        runId: report.runId ?? basename(dirname(reportPathValue)),
        result: report.result ?? 'NO-GO',
        engineeringAcceptedByAgent: report.engineeringAcceptedByAgent === true,
        taskStatusRecommendation: report.taskStatusRecommendation ?? 'NO-GO',
        generatedAt: report.generatedAt ?? null,
        humanEvidenceRequired: report.humanEvidenceRequired === true,
        path: displayPath,
      });
    } catch {
      runs.push({
        runId: basename(dirname(reportPathValue)),
        result: 'NO-GO',
        engineeringAcceptedByAgent: false,
        taskStatusRecommendation: 'NO-GO',
        path: displayPath,
      });
    }
  };
  // A run directory may either nest under `runs/<runId>/` (default layout), be
  // written flat into the status root when the caller passes --output-dir
  // directly, or recurse from the runs/ parent (CLI default status root).
  const flatReport = join(root, 'final-report.json');
  const flatFallback = join(root, 'verifier-report.json');
  const flatPath = existsSync(flatReport) ? flatReport : existsSync(flatFallback) ? flatFallback : null;
  if (flatPath) addRun(flatPath, basename(flatPath));
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'verifier') continue;
    const runDir = join(root, entry.name);
    if (entry.name === 'runs') {
      // Default layout: <root>/runs/<runId>/{final,verifier}-report.json.
      // Note: files directly inside a runs/ dir are intentionally not scanned;
      // no generated layout writes them there (flat runs land at the root).
      for (const nested of readdirSync(runDir, { withFileTypes: true })) {
        if (!nested.isDirectory()) continue;
        const nestedReport = join(runDir, nested.name, 'final-report.json');
        const nestedFallback = join(runDir, nested.name, 'verifier-report.json');
        const nestedPath = existsSync(nestedReport) ? nestedReport : existsSync(nestedFallback) ? nestedFallback : null;
        if (!nestedPath) continue;
        addRun(nestedPath, `runs/${nested.name}/${basename(nestedPath)}`);
      }
      continue;
    }
    const reportPath = join(runDir, 'final-report.json');
    const fallbackPath = join(runDir, 'verifier-report.json');
    const pathValue = existsSync(reportPath) ? reportPath : existsSync(fallbackPath) ? fallbackPath : null;
    if (!pathValue) continue;
    addRun(pathValue, `runs/${entry.name}/${pathValue.endsWith('final-report.json') ? 'final-report.json' : 'verifier-report.json'}`);
  }
  runs.sort((left, right) => String(right.generatedAt ?? '').localeCompare(String(left.generatedAt ?? '')));
  const counts = {};
  for (const run of runs) counts[run.result] = (counts[run.result] ?? 0) + 1;
  return { schema: ACCEPTANCE_SCHEMA, outputRoot: '<redacted>', runs, latest: runs[0] ?? null, counts };
}

export function writePlan(outputDir, manifest) {
  const target = assertSafeOutputDirectory(outputDir, REPOSITORY_ROOT);
  ensureDirectory(target);
  writeJson(join(target, 'manifest.json'), manifest);
  writeJson(join(target, 'plan.json'), {
    schema: ACCEPTANCE_SCHEMA,
    runId: manifest.runId,
    manifestDigest: manifest.manifestDigest,
    planDigest: manifest.planDigest,
    candidate: manifest.candidate,
    changedPaths: manifest.changedPaths,
    coverage: manifest.coverage,
    requiredProfiles: manifest.requiredProfiles,
    gateIds: manifest.gates.map((gate) => gate.id),
    eligibility: manifest.eligibility,
    residuals: manifest.residuals,
  });
  return target;
}

export function loadManifest(manifestPath) {
  const manifest = readJson(resolve(manifestPath));
  const validation = validateAcceptanceManifest(manifest);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return manifest;
}

export const defaults = Object.freeze({ repositoryRoot: REPOSITORY_ROOT, outputRoot: DEFAULT_OUTPUT_ROOT, timeoutMs: DEFAULT_TIMEOUT_MS });
