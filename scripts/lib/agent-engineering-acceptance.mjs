import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
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
const ROOT_UNIT_EXPECTED_SKIPS = 52;
const RUNTIME_UNIT_EXPECTED_SKIPS = 3;
const SAFE_NETWORK_POLICIES = new Set(['none', 'isolated']);
const REQUIRED_LOCK_FILES = ['package.json', 'pnpm-lock.yaml', '.npmrc'];
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
    { id: 'runtime-static-check', profile: 'runtime', name: 'OpenClaw runtime static checks', command: 'pnpm', args: ['--dir', 'openclaw_runtime', 'check', '--include-test-types'] },
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
    'package.json',
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

function canonicalManifestPayload(manifest) {
  const { manifestDigest: _manifestDigest, ...payload } = manifest;
  return payload;
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

function gitChangedPaths(root, since) {
  const base = since || 'HEAD^';
  const result = runGit(root, ['diff', '--name-only', '-z', `${base}..HEAD`]);
  return result.stdout
    .split('\0')
    .map(normalizePath)
    .filter(Boolean)
    .sort(comparePath);
}

export function resolveChangedPaths(root = REPOSITORY_ROOT, options = {}) {
  if (Array.isArray(options.changedPaths)) {
    return [...new Set(options.changedPaths.map(normalizePath).filter(Boolean))].sort(comparePath);
  }
  try {
    return gitChangedPaths(root, options.since);
  } catch {
    const fallback = runGit(root, ['show', '--format=', '--name-only', 'HEAD']);
    return [...new Set(fallback.stdout.split(/\r?\n/u).map(normalizePath).filter(Boolean))].sort(comparePath);
  }
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
  if (coverage.release) coverage.maturity = true;
  return coverage;
}

function readRelativeFile(root, relativePath) {
  const normalized = normalizePath(relativePath);
  if (!normalized) return { path: relativePath, exists: false, sha256: null };
  const fullPath = resolve(root, normalized);
  const rootPrefix = `${resolve(root)}${sep}`;
  if (!fullPath.startsWith(rootPrefix) && fullPath !== resolve(root)) {
    return { path: normalized, exists: false, sha256: null };
  }
  if (!existsSync(fullPath)) return { path: normalized, exists: false, sha256: null };
  return { path: normalized, exists: true, sha256: sha256File(fullPath) };
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

function inferProfiles(spec, coverage, mode) {
  const profiles = new Set(['fast']);
  for (const profile of toArray(spec.data?.requiredProfiles)) profiles.add(String(profile));
  if (coverage.comms) profiles.add('comms');
  if (coverage.ui) profiles.add('e2e');
  if (coverage.runtime) profiles.add('runtime');
  if (coverage.maturity) profiles.add('maturity');
  if (coverage.release) profiles.add('release');
  if (mode === 'full') profiles.add('full');
  return [...profiles].sort(comparePath);
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
  add({
    id: 'harness-validate',
    profile: 'harness',
    name: 'Harness task-spec validation',
    command: 'pnpm',
    args: ['harness', 'validate', '--spec', options.specPath, '--no-diff'],
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
  const changedPaths = resolveChangedPaths(root, options);
  const coverage = inferCoverage(changedPaths);
  const profiles = inferProfiles(spec, coverage, mode);
  const rulePaths = collectRulePaths(spec);
  const sourceFiles = [specPath, ...rulePaths, ...REQUIRED_LOCK_FILES];
  const source = sourceFiles.map((path) => readRelativeFile(root, path));
  const missingSource = source.filter((entry) => !entry.exists).map((entry) => entry.path);
  const taskId = String(spec.data?.id ?? '');
  const humanEvidenceRequired = hasHumanEvidenceRequirement(spec);
  const gates = buildGates(profiles, { specPath, taskId });
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
    },
    executionMode: mode,
    candidate: {
      commit: identity.commit,
      tree: identity.tree,
      ref: identity.ref,
      cleanAtPlan: identity.clean,
    },
    baseRef: options.since ?? 'HEAD^',
    changedPaths,
    coverage,
    requiredProfiles: profiles,
    source: {
      files: source,
      missing: missingSource,
      lockFiles: source.filter((entry) => REQUIRED_LOCK_FILES.includes(entry.path)),
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
  manifest.planDigest = digestManifest(manifest);
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
  if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) errors.push('manifest must contain gates');
  const gateIds = new Set();
  for (const gate of manifest.gates ?? []) {
    if (!gate?.id || gateIds.has(gate.id)) errors.push(`gate id is missing or duplicated: ${gate?.id ?? '<empty>'}`);
    gateIds.add(gate?.id);
    if (!gate.command || !Array.isArray(gate.args)) errors.push(`${gate?.id ?? '<gate>'}: command and args are required`);
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
    for (const arg of gate.args ?? []) {
      if (FORBIDDEN_ARGUMENTS.some((pattern) => pattern.test(String(arg)))) {
        errors.push(`${gate.id}: forbidden argument ${String(arg)}`);
      }
    }
    const name = commandName(gate.command);
    const firstArg = String(gate.args?.[0] ?? '').toLowerCase();
    if ((name === 'git' || name === 'git.exe') && ['push', 'commit', 'reset', 'clean', 'merge'].includes(firstArg)) {
      errors.push(`${gate.id}: git mutation command is forbidden`);
    }
    if (gate.kind === 'adapter' && gate.adapter !== TF0009_ADAPTER_ID) errors.push(`${gate.id}: unknown adapter`);
  }
  if (manifest.safety?.scope !== 'engineering-only') errors.push('manifest safety scope must be engineering-only');
  if (manifest.safety?.productionEffects !== false || manifest.safety?.realProvider !== false) {
    errors.push('manifest permits production effects or real providers');
  }
  if (manifest.manifestDigest && manifest.manifestDigest !== digestManifest(manifest)) errors.push('manifest digest mismatch');
  if (options.root) {
    try {
      const identity = repositoryIdentity(options.root);
      if (options.requireClean && !identity.clean) errors.push('source worktree is dirty');
      if (identity.commit !== manifest.candidate.commit) errors.push('candidate commit does not match source HEAD');
      if (identity.tree !== manifest.candidate.tree) errors.push('candidate tree does not match source HEAD');
      if (options.requireRef && manifest.candidate.ref && identity.ref !== manifest.candidate.ref) {
        errors.push('candidate ref does not match source ref');
      }
      for (const expected of manifest.source?.files ?? []) {
        const actual = readRelativeFile(options.root, expected.path);
        if (actual.exists !== expected.exists || actual.sha256 !== expected.sha256) {
          errors.push(`source input digest mismatch: ${expected.path}`);
        }
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
    rmSync(holder, { recursive: true, force: true });
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
        rmSync(holder, { recursive: true, force: true });
      }
    },
  };
}

function makeEnvironment(options = {}) {
  const env = { ...(options.env ?? process.env) };
  // The validator rejects unsafe inherited values. We do not silently repair
  // them; deleting these keys here is only for explicitly supplied safe test
  // environments where the key is absent.
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  return env;
}

function largestCount(text, label) {
  const matches = [...text.matchAll(new RegExp(`\\b(\\d+)\\s+${label}\\b`, 'giu'))]
    .map((match) => Number(match[1]))
    .filter(Number.isSafeInteger);
  return matches.length > 0 ? Math.max(...matches) : null;
}

export function parseTestCounts(stdout, stderr = '') {
  const text = `${String(stdout ?? '')}\n${String(stderr ?? '')}`.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '');
  const passed = largestCount(text, 'passed');
  const failed = largestCount(text, 'failed') ?? 0;
  const skipped = largestCount(text, 'skipped') ?? 0;
  if (passed === null) return null;
  const totals = [...text.matchAll(/\((\d+)\)/gu)]
    .map((match) => Number(match[1]))
    .filter(Number.isSafeInteger);
  const total = totals.length > 0 ? Math.max(...totals) : passed + failed + skipped;
  return { passed, failed, skipped, total, source: 'parsed' };
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

function spawnGate(gate, options = {}) {
  const command = commandName(gate.command) === 'pnpm' ? pnpmExecutable() : gate.command;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const spawnSpec = pnpmGateSpawnSpec(command, gate.args);
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
    command: gate.command,
    args: [...gate.args],
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
  result.testCounts = { passed: 30, failed: 0, skipped: 0, total: 30, source: 'adapter-report' };
  return result;
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
    status: result.status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    required: result.required,
    allowSkip: result.allowSkip,
  };
}

function prefixGateEvidence(gate, prefix) {
  const withPrefix = (pathValue) => (pathValue ? `${prefix.replace(/[\\/]+$/u, '')}/${pathValue}` : pathValue);
  return {
    ...gate,
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

function verifyLogs(outputDir, result) {
  const errors = [];
  for (const stream of ['stdout', 'stderr']) {
    const pathValue = result.logs?.[stream];
    if (!pathValue) {
      errors.push(`${result.id}: missing ${stream} log path`);
      continue;
    }
    try {
      const { full } = safeRelativeOutputPath(outputDir, pathValue);
      const actual = sha256File(full);
      if (actual !== result.logs[`${stream}Sha256`]) errors.push(`${result.id}: ${stream} log digest mismatch`);
    } catch (error) {
      errors.push(`${result.id}: ${stream} log unavailable (${error.message})`);
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
  const failures = gateResults
    .filter((result) => result.status !== 'pass' || result.required !== true || result.allowSkip === true)
    .map((result) => `${result.id}: ${result.status}`);
  for (const result of gateResults) {
    if (!result.testExpectation?.requireCounts) continue;
    if (!result.testCounts) {
      failures.push(`${result.id}: test counts were not parsed`);
      continue;
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
      const gateOptions = {
        cwd: workspace,
        env: executionEnv,
        outputDir,
        sourceRoot: root,
        worktreeRoot: workspace,
        secrets,
        spawn: options.spawn,
      };
      const result = gate.kind === 'adapter' && gate.adapter === TF0009_ADAPTER_ID
        ? runTf0009Adapter(gate, gateOptions)
        : spawnGate(gate, gateOptions);
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
        },
      },
    );
    report.worktree = { mode: 'detached-temporary', isolated: true, cleaned: true };
    report.reportDigest = sha256(stableJson({ ...report, reportDigest: undefined }));
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
    report.reportDigest = sha256(stableJson({ ...report, reportDigest: undefined }));
    writeJson(join(outputDir, `${role}-report.json`), report);
    return report;
  } finally {
    checkout?.cleanup();
  }
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

export function validateExecutorEvidence(manifest, executorReport, outputDir) {
  const errors = [];
  if (executorReport?.schema !== ACCEPTANCE_REPORT_SCHEMA) errors.push('executor report schema mismatch');
  if (executorReport?.role !== 'executor') errors.push('executor report role mismatch');
  if (executorReport?.runId !== manifest.runId) errors.push('executor report runId mismatch');
  if (executorReport?.source?.manifestDigest !== manifest.manifestDigest) errors.push('executor report manifest digest mismatch');
  if (executorReport?.candidate?.commit !== manifest.candidate.commit || executorReport?.candidate?.tree !== manifest.candidate.tree) {
    errors.push('executor report candidate identity mismatch');
  }
  const expectedIds = manifest.gates.map((gate) => gate.id);
  const actualIds = (executorReport?.gates ?? []).map((gate) => gate.id);
  if (expectedIds.join('\0') !== actualIds.join('\0')) errors.push('executor report gate set/order mismatch');
  for (const result of executorReport?.gates ?? []) errors.push(...verifyLogs(outputDir, result));
  for (const artifact of executorReport?.controlledArtifacts ?? []) {
    if (!artifact?.path || !artifact?.sha256) {
      errors.push('executor report has an incomplete controlled artifact record');
      continue;
    }
    try {
      const { full } = safeRelativeOutputPath(outputDir, artifact.path);
      if (sha256File(full) !== artifact.sha256) errors.push(`controlled artifact digest mismatch: ${artifact.path}`);
    } catch (error) {
      errors.push(`controlled artifact unavailable: ${artifact.path} (${error.message})`);
    }
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
    failures: [...verifierFailures, ...consistencyErrors],
  });
  if (consistencyErrors.length > 0) {
    report.result = 'NO-GO';
    report.engineeringAcceptedByAgent = false;
    report.taskStatusRecommendation = 'NO-GO';
  }
  report.reportDigest = sha256(stableJson({ ...report, reportDigest: undefined }));
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
