#!/usr/bin/env node
// WP6 closeout: aggregate child evidence, replay every retained SHA256SUMS entry,
// seal the optional MC6 sidecar-only decision, and write a non-GA closeout manifest.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export const WP6_SCHEMA = 'clawx.versegit.wp6-closeout/v1';
export const WP6_MANIFEST_SCHEMA = 'clawx.versegit.wp6-manifest/v1';
export const MC6_SCHEMA = 'clawx.versegit.mc6-decision/v1';
export const WP6_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp6-closeout-fixture.json';
export const MC6_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc6-extraction-decision-fixture.json';
export const WP6_REPORT_PATH = 'artifacts/versegit/wp6/final-report.json';
export const WP6_MANIFEST_PATH = 'artifacts/versegit/wp6/manifest.json';
export const MC6_DECISION_PATH = 'artifacts/versegit/mc6/decision.json';
export const WP6_EVIDENCE_ROOT = 'harness/specs/fixtures/versegit-planning-correction/wp6-evidence';
export const MC6_EVIDENCE_ROOT = 'harness/specs/fixtures/versegit-planning-correction/mc6-evidence';
export const WP6_SHA_PATH = 'artifacts/versegit/wp6/SHA256SUMS';
export const MC6_SHA_PATH = 'artifacts/versegit/mc6/SHA256SUMS';

const WP6_COMMON_SHA_PATHS = [
  'scripts/versegit-wp6-closeout.mjs',
  'scripts/verify-versegit-wp6.mjs',
  'tests/unit/versegit-wp6-closeout.test.ts',
  'harness/specs/tasks/versegit-wp6-merged-closeout.md',
  WP6_FIXTURE_PATH,
];

export const WP6_SHA_PATHS = [
  WP6_REPORT_PATH,
  WP6_MANIFEST_PATH,
  ...WP6_COMMON_SHA_PATHS,
];

export const WP6_EVIDENCE_SHA_PATHS = [
  `${WP6_EVIDENCE_ROOT}/final-report.json`,
  `${WP6_EVIDENCE_ROOT}/manifest.json`,
  ...WP6_COMMON_SHA_PATHS,
];

const MC6_COMMON_SHA_PATHS = [
  MC6_FIXTURE_PATH,
  'harness/specs/tasks/versegit-mc6-extraction-decision.md',
  'scripts/verify-versegit-mc6.mjs',
  'scripts/versegit-wp6-closeout.mjs',
  'tests/unit/versegit-wp6-closeout.test.ts',
];

export const MC6_SHA_PATHS = [MC6_DECISION_PATH, ...MC6_COMMON_SHA_PATHS];
export const MC6_EVIDENCE_SHA_PATHS = [`${MC6_EVIDENCE_ROOT}/decision.json`, ...MC6_COMMON_SHA_PATHS];

const repositoryRoot = resolve(process.cwd());
const ignoredDigestKeys = new Set(['generated_at', 'digest']);
const CREDENTIAL_PATTERNS = [
  { id: 'openai-like', pattern: /sk-[A-Za-z0-9]{16,}/u },
  { id: 'github-like', pattern: /ghp_[A-Za-z0-9]{16,}/u },
  { id: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/u },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { id: 'phc-like', pattern: /phc_[A-Za-z0-9]{16,}/u },
];

export function scanCredentialEvidence({ root = repositoryRoot, paths = [] } = {}) {
  const uniquePaths = [...new Set(paths.map(normalizePath))].filter((path) => {
    const full = resolve(root, path);
    return existsSync(full) && statSync(full).isFile();
  });
  const hits = [];
  for (const path of uniquePaths) {
    const text = readFileSync(resolve(root, path), 'utf8');
    for (const rule of CREDENTIAL_PATTERNS) {
      if (rule.pattern.test(text)) hits.push({ path, pattern: rule.id });
    }
  }
  return {
    status: hits.length === 0 ? 'passed' : 'rejected',
    filesScanned: uniquePaths.length,
    patterns: CREDENTIAL_PATTERNS.map((rule) => rule.id),
    hits,
    passed: hits.length === 0,
  };
}
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function semanticDigest(document) {
  const clean = Object.fromEntries(
    Object.entries(document).filter(([key]) => !ignoredDigestKeys.has(key)),
  );
  return sha256(JSON.stringify(canonicalize(clean)));
}

export function documentDigest(document) {
  return sha256(JSON.stringify({ ...document, generated_at: undefined, digest: undefined }));
}

function assertInsideRoot(root, path, label) {
  if (typeof path !== 'string' || path.length === 0) throw new Error(`${label} path is empty`);
  const full = resolve(root, path);
  const relativePath = relative(root, full);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} escapes repository root: ${path}`);
  }
  return full;
}

function readJson(root, path, label) {
  const full = assertInsideRoot(root, path, label);
  if (!existsSync(full)) throw new Error(`${label} missing: ${path}`);
  return JSON.parse(readFileSync(full, 'utf8'));
}

function fileSha(root, path, label) {
  const full = assertInsideRoot(root, path, label);
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`${label} missing: ${path}`);
  return sha256(readFileSync(full));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizedHostVerdict(document) {
  return document?.host_verdict ?? document?.hostVerdict ?? null;
}

function recursiveBoundaryIssues(value, path = 'root', issues = []) {
  if (!value || typeof value !== 'object') return issues;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      ['land_or_admit_invoked', 'landOrAdmitInvoked', 'host_worktree_deleted', 'hostWorktreesDeleted', 'provider_source_modified', 'source_tree_copied', 'vg_source_tree_copied'].includes(key)
      && child === true
    ) {
      issues.push(`${childPath} must not be true`);
    }
    if (key === 'default_on' && child === true) issues.push(`${childPath} must not be true`);
    recursiveBoundaryIssues(child, childPath, issues);
  }
  return issues;
}

function gateChecks(role, document) {
  const issues = [];
  const add = (condition, message) => { if (!condition) issues.push(message); };
  switch (role) {
    case 'MC0':
      add(document.deliverable === 'rejected', 'MC0 must retain its rejected diagnostic baseline');
      add(Array.isArray(document.blockers) && document.blockers.includes('source_worktree_dirty'), 'MC0 must retain source_worktree_dirty');
      add(Boolean(document.source?.head && document.source?.tree), 'MC0 source head/tree missing');
      add(Boolean(document.binary?.sha256), 'MC0 binary digest missing');
      break;
    case 'MC1':
      add(document.owner === 'TF-0474', 'MC1 owner mismatch');
      add(document.surface?.module_report?.schema === 'clawx.versegit.module-report/v1', 'MC1 module-report schema missing');
      add(document.surface?.command_plan?.schema === 'clawx.versegit.command-plan/v1', 'MC1 command-plan schema missing');
      add(document.import_policy?.deep_import_allowed === false, 'MC1 deep imports must be denied');
      break;
    case 'MC2':
      add(Array.isArray(document.coverage?.positive_controls) && document.coverage.positive_controls.length > 0, 'MC2 positive control missing');
      add(Array.isArray(document.coverage?.negative_controls) && document.coverage.negative_controls.length >= 5, 'MC2 negative controls missing');
      add(Array.isArray(document.coverage?.unobserved_surfaces) && document.coverage.unobserved_surfaces.length >= 5, 'MC2 unobserved surfaces missing');
      break;
    case 'MC3':
      add(document.status === 'rejected' && document.deliverable === 'rejected', 'MC3 package must stay rejected');
      add(Array.isArray(document.blockers) && document.blockers.includes('release_binary_not_built'), 'MC3 release-binary blocker missing');
      add(document.boundaries?.release_binary_built === false, 'MC3 must not claim a release binary');
      add((document.startup_smoke ?? []).some((entry) => entry.id === 'startup_missing_binary' && entry.status === 'unavailable' && entry.host_verdict === 'unchanged'), 'MC3 missing-binary fail-open evidence missing');
      break;
    case 'MC4':
      add(document.status === 'equivalent', 'MC4 adapter must be equivalent');
      add(document.contract_conformance?.ok === true, 'MC4 contract conformance failed');
      add(document.migration_budget_scope?.provider_source_files_changed === 0, 'MC4 changed provider source');
      add(document.migration_budget_scope?.provider_internal_imports === 0, 'MC4 imported provider internals');
      add((document.differential?.negative_controls ?? []).every((entry) => entry.fired === true), 'MC4 negative control did not fire');
      break;
    case 'MC5':
      add(document.status === 'framework_verified', 'MC5 framework must be verified');
      add(document.provenance_check?.passed === true, 'MC5 provenance check failed');
      add((document.negative_controls ?? []).length >= 6 && (document.negative_controls ?? []).every((entry) => entry.fired === true), 'MC5 negative controls incomplete');
      add(Boolean(document.diff_budget?.max_files_per_seam), 'MC5 diff budget missing');
      break;
    case 'WP0':
      add(document.status === 'verified', 'WP0 contract must be verified');
      add(document.host_verdict === 'unchanged', 'WP0 changed host verdict');
      add(document.gate?.passed === true, 'WP0 gate failed');
      add(document.eligibility?.single_worktree_single_session_commands === 0, 'WP0 single-worktree calls are not zero');
      add(document.eligibility?.default_enabled === false, 'WP0 must stay default-off');
      break;
    case 'WP1':
      add(document.passed === true, 'WP1 did not pass');
      add(document.host_verdict === 'unchanged', 'WP1 changed host verdict');
      add(document.boundaries?.vg_process_started === false, 'WP1 started VG');
      add(document.boundaries?.host_worktree_deleted === false, 'WP1 deleted a host worktree');
      break;
    case 'WP2': {
      const single = (document.cases ?? []).find((entry) => entry.caseId === 'single-worktree');
      const multi = (document.cases ?? []).find((entry) => entry.caseId === 'multi-worktree');
      const missing = (document.cases ?? []).find((entry) => entry.caseId === 'missing-binary');
      add(document.passed === true, 'WP2 did not pass');
      add(document.hostVerdict === 'unchanged', 'WP2 changed host verdict');
      add(single?.status === 'not_applicable' && single?.usage?.processesStarted === 0, 'WP2 single-worktree zero-call case missing');
      add(multi?.status === 'partial', 'WP2 multi-worktree case must remain partial');
      add((multi?.probes ?? []).some((entry) => entry.id === 'provider.conflicts-plan' && entry.status === 'unavailable' && entry.reason === 'provider_seam_unavailable'), 'WP2 conflicts-plan unavailable fact missing');
      add(missing?.status === 'unavailable', 'WP2 missing-binary case missing');
      break;
    }
    case 'WP3':
      add(document.passed === true, 'WP3 did not pass');
      add(document.hostVerdict === 'unchanged', 'WP3 changed host verdict');
      add(document.structuralOnly === true, 'WP3 structural-only boundary missing');
      add(document.realVerseshellExecutionClaimed === false, 'WP3 must not claim live VerseShell execution');
      add(document.boundaries?.secondExecutor === false, 'WP3 added a second executor');
      break;
    case 'WP4':
      add(document.passed === true, 'WP4 did not pass');
      add(document.boundaries?.hostVerdictUnchanged === true, 'WP4 host verdict boundary missing');
      add(document.redaction?.rawPayloadStored === false && document.redaction?.secretStored === false && document.redaction?.absolutePathStored === false, 'WP4 redaction boundary failed');
      add(document.coverage?.coverageVector?.directFs === 'unobserved', 'WP4 directFs must stay unobserved');
      add(document.coverage?.coverageVector?.shellRead === 'unobserved', 'WP4 shellRead must stay unobserved');
      break;
    case 'WP5':
      add(document.passed === true, 'WP5 did not pass');
      add(document.hostVerdict === 'unchanged', 'WP5 changed host verdict');
      add(document.summary?.cycles === 3 && document.summary?.failedScenarios === 0 && document.summary?.processCalls === 0, 'WP5 summary drifted');
      add(document.boundaries?.sidecarProcessesStarted === false && document.boundaries?.hostWorktreesDeleted === false && document.boundaries?.tempSurvivors === 0, 'WP5 cleanup boundary failed');
      break;
    default:
      issues.push(`unknown gate role ${role}`);
  }
  issues.push(...recursiveBoundaryIssues(document, role));
  return unique(issues);
}

function mc0StableProjection(document) {
  return {
    version: document.version,
    vgSchema: document.vgSchema,
    source: { head: document.source?.head, tree: document.source?.tree, status: document.source?.status },
    binary: { sha256: document.binary?.sha256, version: document.binary?.version, capabilities_schema: document.binary?.capabilities_schema },
    deliverable: document.deliverable,
    blockers: document.blockers,
  };
}

function collectGate(root, entry) {
  const curated = readJson(root, entry.curatedPath, `${entry.role} curated evidence`);
  const localMirrorPath = entry.artifactPath ?? null;
  const localMirrorExists = localMirrorPath ? existsSync(assertInsideRoot(root, localMirrorPath, `${entry.role} local artifact mirror`)) : false;
  const localMirror = localMirrorExists ? readJson(root, localMirrorPath, `${entry.role} local artifact mirror`) : null;
  const issues = [];
  const schema = curated?.[entry.schemaField];
  if (schema !== entry.expectedSchema) issues.push(`schema ${schema ?? 'missing'} != ${entry.expectedSchema}`);
  if (entry.taskSpec && !existsSync(assertInsideRoot(root, entry.taskSpec, `${entry.role} task spec`))) issues.push(`task spec missing: ${entry.taskSpec}`);
  if (entry.verifier && !existsSync(assertInsideRoot(root, entry.verifier, `${entry.role} verifier`))) issues.push(`verifier missing: ${entry.verifier}`);
  const artifactRelationship = entry.artifactComparison
    ?? (localMirrorPath ? 'semantic-equivalent-when-local-mirror-present' : 'curated-only');
  if (localMirror) {
    const artifactSchema = localMirror?.[entry.schemaField];
    if (artifactSchema !== entry.expectedSchema) issues.push(`local mirror schema ${artifactSchema ?? 'missing'} != ${entry.expectedSchema}`);
    if (semanticDigest(localMirror) !== semanticDigest(curated)) {
      if (entry.artifactComparison === 'separate-diagnostic-captures' && entry.role === 'MC0') {
        if (JSON.stringify(mc0StableProjection(localMirror)) !== JSON.stringify(mc0StableProjection(curated))) {
          issues.push('separate MC0 captures disagree on stable source/binary/schema fields');
        }
      } else {
        issues.push('local artifact mirror and curated evidence differ semantically');
      }
    }
  } else if (!localMirrorPath && !entry.artifactAliasReason) {
    issues.push('curated-only artifact requires an explicit alias reason');
  }
  issues.push(...gateChecks(entry.role, curated));
  return {
    nodeId: entry.nodeId,
    role: entry.role,
    schema,
    artifactPath: entry.curatedPath,
    artifactSha256: fileSha(root, entry.curatedPath, `${entry.role} canonical artifact`),
    curatedPath: entry.curatedPath,
    curatedSha256: fileSha(root, entry.curatedPath, `${entry.role} curated evidence`),
    localMirrorPath,
    localMirrorPolicy: localMirrorPath ? 'tracked-curated-canonical; optional ignored mirror checked when present' : 'tracked-curated-canonical',
    artifactAliasReason: entry.artifactAliasReason
      ?? (localMirrorPath ? 'Tracked evidence is canonical; artifacts/ is an optional ignored local mirror and is not required for clean-checkout replay.' : null),
    artifactRelationship,
    semanticDigest: semanticDigest(curated),
    taskSpec: entry.taskSpec,
    taskSpecSha256: fileSha(root, entry.taskSpec, `${entry.role} task spec`),
    verifier: entry.verifier,
    verifierSha256: fileSha(root, entry.verifier, `${entry.role} verifier`),
    hostVerdict: normalizedHostVerdict(curated),
    issues: unique(issues),
  };
}

function collectManifest(root, path) {
  const full = assertInsideRoot(root, path, 'evidence manifest');
  if (!existsSync(full)) {
    return { path, sha256: null, entries: 0, files: [], missing: [path], mismatches: ['manifest missing'] };
  }
  const lines = readFileSync(full, 'utf8').split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const files = [];
  const missing = [];
  const mismatches = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/u);
    if (!match) {
      mismatches.push(`line ${index + 1} is malformed`);
      continue;
    }
    const [, expected, relativePath] = match;
    const normalized = normalizePath(relativePath);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      mismatches.push(`line ${index + 1} escapes root`);
      continue;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      missing.push(normalized);
      files.push({ path: normalized, expected, actual: null });
      continue;
    }
    const actual = sha256(readFileSync(target));
    if (actual !== expected) mismatches.push(`${normalized}: expected ${expected.slice(0, 12)} actual ${actual.slice(0, 12)}`);
    files.push({ path: normalized, expected, actual });
  }
  return {
    path,
    sha256: sha256(readFileSync(full)),
    entries: files.length,
    files,
    missing,
    mismatches,
  };
}
export function buildMc6Decision({ root = repositoryRoot, fixturePath = resolve(root, MC6_FIXTURE_PATH), generatedAt = new Date().toISOString() } = {}) {
  const fixture = readJson(root, normalizePath(relative(root, fixturePath)), 'MC6 fixture');
  if (fixture.schema !== 'clawx.versegit.mc6-extraction-fixture/v1') throw new Error(`MC6 fixture schema mismatch: ${fixture.schema}`);
  const evidence = Object.fromEntries(fixture.requiredEvidence.map((path) => [path, readJson(root, path, 'MC6 evidence')]));
  const mc1Path = 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json';
  const mc4Path = 'harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json';
  const mc5Path = 'harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json';
  const wp0Path = 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json';
  const wp2Path = 'harness/specs/fixtures/versegit-planning-correction/wp2-evidence/report.json';
  const wp5Path = 'harness/specs/fixtures/versegit-planning-correction/wp5-evidence/soak-report.json';
  const mc1 = evidence[mc1Path];
  const mc4 = evidence[mc4Path];
  const mc5 = evidence[mc5Path];
  const wp0 = evidence[wp0Path];
  const wp2 = evidence[wp2Path];
  const wp5 = evidence[wp5Path];
  const multi = (wp2.cases ?? []).find((entry) => entry.caseId === 'multi-worktree');
  const sidecarStable = mc4.status === 'equivalent'
    && mc5.status === 'framework_verified'
    && wp5.passed === true
    && wp5.summary?.processCalls === 0
    && (wp5.failures ?? []).some((entry) => entry.id === 'sidecar_crash' && entry.status === 'passed');
  const publicContractStable = mc1.schema === 'clawx.versegit.consumer-contract/v1'
    && mc1.import_policy?.deep_import_allowed === false
    && wp0.status === 'verified'
    && wp0.host_verdict === 'unchanged'
    && wp0.gate?.passed === true
    && wp0.version_matrix?.consumer_contract_version === mc1.schema
    && wp0.version_matrix?.module_report_schema === mc1.surface?.module_report?.schema
    && wp0.version_matrix?.command_plan_schema === mc1.surface?.command_plan?.schema;
  const conflictsPlanUnavailable = (multi?.probes ?? []).some(
    (entry) => entry.id === 'provider.conflicts-plan' && entry.status === 'unavailable' && entry.reason === 'provider_seam_unavailable',
  );
  const bind = (role, path) => ({ role, path, sha256: fileSha(root, path, `${role} MC6 evidence`) });
  const assessment = [
    {
      id: 'sidecar-contract-stable',
      status: sidecarStable ? 'observed' : 'unavailable',
      observed: sidecarStable,
      evidence: [bind('MC4', mc4Path), bind('MC5', mc5Path), bind('WP5', wp5Path)],
    },
    {
      id: 'public-contract-stable',
      status: publicContractStable ? 'observed' : 'unavailable',
      observed: publicContractStable,
      evidence: [bind('MC1', mc1Path), bind('WP0', wp0Path)],
    },
    {
      id: 'measured-in-process-requirement',
      status: 'not_observed',
      evidence: [],
      basis: 'No measured in-process performance or security requirement is present in the required evidence set.',
    },
    {
      id: 'performance-or-security-blocker',
      status: 'not_observed',
      evidence: [],
      basis: 'No sidecar performance or security blocker is present in the required evidence set.',
    },
  ];
  const decision = {
    schema: MC6_SCHEMA,
    generated_at: generatedAt,
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0479',
    fixture: MC6_FIXTURE_PATH,
    fixtureDigest: fileSha(root, MC6_FIXTURE_PATH, 'MC6 fixture'),
    decision: fixture.decision,
    sourceExtractionTriggered: fixture.sourceExtractionTriggered,
    triggerAssessment: assessment,
    conflictsPlanSeam: conflictsPlanUnavailable ? 'unavailable' : 'unexpected-availability',
    migrationFiles: [],
    retainedArchitecture: 'versioned sidecar consumed through the host-owned anti-corruption adapter',
    rollback: fixture.rollback,
    reopenPolicy: fixture.reopenPolicy,
    authority: {
      hostVerdict: 'unchanged',
      singleGreenLight: false,
      defaultOn: false,
      m4Authorized: false,
    },
    boundaries: {
      providerStandalonePreserved: true,
      providerSourceCopied: false,
      providerHistoryCopied: false,
      providerBuildOutputsCopied: false,
      userWorkspaceMutated: false,
    },
    passed: fixture.decision === 'sidecar-only'
      && fixture.sourceExtractionTriggered === false
      && sidecarStable
      && publicContractStable
      && conflictsPlanUnavailable,
    issues: [],
    digest: null,
  };
  decision.digest = documentDigest(decision);
  decision.issues = validateMc6Decision(decision).issues;
  decision.passed = decision.issues.length === 0;
  decision.digest = documentDigest(decision);
  return { fixture, decision };
}

export function validateMc6Decision(decision) {
  const issues = [];
  const add = (condition, message) => { if (!condition) issues.push(message); };
  add(decision?.schema === MC6_SCHEMA, 'schema mismatch');
  add(decision?.task === 'TF-0479', 'task mismatch');
  add(decision?.decision === 'sidecar-only', 'decision must remain sidecar-only');
  add(decision?.sourceExtractionTriggered === false, 'source extraction must not be triggered');
  add(decision?.conflictsPlanSeam === 'unavailable', 'conflicts-plan seam must remain unavailable');
  add(Array.isArray(decision?.migrationFiles) && decision.migrationFiles.length === 0, 'migration files must remain empty');
  add(decision?.retainedArchitecture === 'versioned sidecar consumed through the host-owned anti-corruption adapter', 'sidecar architecture not retained');
  add(decision?.rollback?.providerStandalonePreserved === true, 'rollback must preserve the standalone provider');
  add(typeof decision?.reopenPolicy === 'string' && /measured/iu.test(decision.reopenPolicy) && /separate/iu.test(decision.reopenPolicy), 'reopen policy must require measurement and a separate decision');
  add(decision?.authority?.hostVerdict === 'unchanged', 'host verdict changed');
  add(decision?.authority?.singleGreenLight === false && decision?.authority?.defaultOn === false && decision?.authority?.m4Authorized === false, 'authority/product locks changed');
  add(decision?.boundaries?.providerSourceCopied === false && decision?.boundaries?.providerHistoryCopied === false && decision?.boundaries?.providerBuildOutputsCopied === false && decision?.boundaries?.userWorkspaceMutated === false, 'provider or workspace boundary failed');
  const assessment = new Map((decision?.triggerAssessment ?? []).map((entry) => [entry.id, entry]));
  const sidecar = assessment.get('sidecar-contract-stable');
  const publicContract = assessment.get('public-contract-stable');
  const inProcess = assessment.get('measured-in-process-requirement');
  const blocker = assessment.get('performance-or-security-blocker');
  add(sidecar?.status === 'observed' && sidecar?.observed === true && (sidecar?.evidence ?? []).length >= 3, 'sidecar stability not observed');
  add(publicContract?.status === 'observed' && publicContract?.observed === true && (publicContract?.evidence ?? []).length >= 2, 'public contract stability not observed');
  add(inProcess?.status === 'not_observed' && inProcess?.observed === undefined, 'in-process requirement must remain unobserved');
  add(blocker?.status === 'not_observed' && blocker?.observed === undefined, 'no performance/security blocker may be claimed');
  for (const entry of [sidecar, publicContract]) {
    for (const binding of entry?.evidence ?? []) {
      add(/^[0-9a-f]{64}$/u.test(binding.sha256 ?? ''), `${entry.id}: evidence digest missing for ${binding.role}`);
    }
  }
  add(decision?.passed === true, 'MC6 decision did not pass');
  add(Array.isArray(decision?.issues) && decision.issues.length === 0, 'MC6 issues must be empty');
  if (decision?.digest !== documentDigest(decision)) issues.push('digest is not reproducible');
  return { ok: issues.length === 0, issues };
}

function validateRetirement(layers, issues) {
  if (!Array.isArray(layers) || layers.length < 5) issues.push('retirement layers incomplete');
  for (const layer of layers ?? []) {
    if (!['kept', 'kept-long-term', 'removed-per-run', 'removed'].includes(layer.disposition)) issues.push(`retirement ${layer.id}: disposition invalid`);
    if (!layer.reason || !layer.retirementCondition || !layer.reviewPoint) issues.push(`retirement ${layer.id}: reason/condition/review point required`);
    if (/TODO|TBD/iu.test(`${layer.reason} ${layer.retirementCondition} ${layer.reviewPoint}`)) issues.push(`retirement ${layer.id}: unresolved placeholder`);
  }
}

export function buildWp6Closeout({ root = repositoryRoot, fixturePath = resolve(root, WP6_FIXTURE_PATH), generatedAt = new Date().toISOString() } = {}) {
  const normalizedFixturePath = normalizePath(relative(root, fixturePath));
  const fixture = readJson(root, normalizedFixturePath, 'WP6 fixture');
  if (fixture.schema !== 'clawx.versegit.wp6-closeout-fixture/v1') throw new Error(`WP6 fixture schema mismatch: ${fixture.schema}`);
  const issues = [];
  const requiredGates = fixture.requiredGates.map((entry) => {
    const gate = collectGate(root, entry);
    issues.push(...gate.issues.map((issue) => `${gate.role}: ${issue}`));
    return gate;
  });
  if (requiredGates.length !== 12) issues.push(`required gate count ${requiredGates.length} != 12`);
  const roles = requiredGates.map((entry) => entry.role);
  for (const role of ['MC0', 'MC1', 'MC2', 'MC3', 'MC4', 'MC5', 'WP0', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5']) {
    if (!roles.includes(role)) issues.push(`required gate missing ${role}`);
  }
  const evidenceManifests = fixture.evidenceManifests.map((path) => collectManifest(root, path));
  for (const manifest of evidenceManifests) {
    if (manifest.missing.length > 0) issues.push(`${manifest.path}: missing ${manifest.missing.length} file(s)`);
    if (manifest.mismatches.length > 0) issues.push(`${manifest.path}: ${manifest.mismatches.length} digest mismatch(es)`);
  }
  if (evidenceManifests.length !== 12) issues.push(`required evidence manifest count ${evidenceManifests.length} != 12`);
  const declaredLocalMirrorManifests = fixture.localMirrorManifests ?? [];
  if (declaredLocalMirrorManifests.length !== 12) issues.push(`optional local mirror manifest count ${declaredLocalMirrorManifests.length} != 12`);
  const localMirrorManifests = declaredLocalMirrorManifests
    .filter((path) => existsSync(assertInsideRoot(root, path, 'optional local mirror manifest')))
    .map((path) => collectManifest(root, path));
  for (const manifest of localMirrorManifests) {
    if (manifest.missing.length > 0) issues.push(`optional local mirror ${manifest.path}: missing ${manifest.missing.length} file(s)`);
    if (manifest.mismatches.length > 0) issues.push(`optional local mirror ${manifest.path}: ${manifest.mismatches.length} digest mismatch(es)`);
  }
  const credentialScan = scanCredentialEvidence({
    root,
    paths: [
      ...evidenceManifests.flatMap((manifest) => manifest.files.map((entry) => entry.path)),
      ...WP6_COMMON_SHA_PATHS,
      ...MC6_COMMON_SHA_PATHS,
      WP6_FIXTURE_PATH,
      MC6_FIXTURE_PATH,
    ],
  });
  if (!credentialScan.passed) issues.push(`credential scan found ${credentialScan.hits.length} hit(s)`);

  const gateByRole = Object.fromEntries(requiredGates.map((entry) => [entry.role, entry]));
  const mc0 = readJson(root, gateByRole.MC0.curatedPath, 'MC0 closeout read');
  const mc3 = readJson(root, gateByRole.MC3.curatedPath, 'MC3 closeout read');
  const wp2 = readJson(root, gateByRole.WP2.curatedPath, 'WP2 closeout read');
  const wp3 = readJson(root, gateByRole.WP3.curatedPath, 'WP3 closeout read');
  const wp4 = readJson(root, gateByRole.WP4.curatedPath, 'WP4 closeout read');
  const wp5 = readJson(root, gateByRole.WP5.curatedPath, 'WP5 closeout read');
  const multi = (wp2.cases ?? []).find((entry) => entry.caseId === 'multi-worktree');
  const conflictsProbe = (multi?.probes ?? []).find((entry) => entry.id === 'provider.conflicts-plan');
  const conflictsPlan = {
    status: conflictsProbe?.status === 'unavailable' ? 'unavailable' : 'unexpected',
    reason: conflictsProbe?.reason ?? 'missing provider seam evidence',
    hostVerdict: multi?.hostVerdict ?? null,
  };
  if (conflictsPlan.status !== 'unavailable' || conflictsPlan.reason !== 'provider_seam_unavailable') issues.push('conflicts-plan seam boundary drifted');

  const coverage = fixture.aggregateCoverage;
  const wp4Vector = wp4.coverage?.coverageVector ?? {};
  for (const [surface, status] of Object.entries(coverage.coverageVector)) {
    if (wp4Vector[surface] !== status) issues.push(`coverage ${surface}: expected ${status} observed ${wp4Vector[surface] ?? 'missing'}`);
  }
  if ((coverage.requiredUnobservedSurfaces ?? []).length < 5) issues.push('unobserved surface list incomplete');

  const release = {
    productPosture: fixture.releaseExpectation.productPosture,
    defaultOn: false,
    packageStatus: mc3.status,
    releaseEligible: false,
    ga: false,
    sourceStatus: mc0.source?.status ?? 'unknown',
    binaryProfile: mc3.identity?.binary_profile ?? mc0.binary?.profile ?? 'unknown',
    releaseBinaryBuilt: mc3.boundaries?.release_binary_built ?? null,
    blockers: unique([...(mc0.blockers ?? []), ...(mc3.blockers ?? [])]).sort(),
    evidenceClosureIsProductApproval: false,
  };
  for (const key of ['productPosture', 'defaultOn', 'packageStatus', 'releaseEligible', 'ga', 'sourceStatus', 'binaryProfile', 'releaseBinaryBuilt']) {
    if (release[key] !== fixture.releaseExpectation[key]) issues.push(`release ${key}: expected ${fixture.releaseExpectation[key]} observed ${release[key]}`);
  }
  if (JSON.stringify(release.blockers) !== JSON.stringify([...fixture.releaseExpectation.blockers].sort())) issues.push('release blockers differ from fixture');

  const liveReceipt = wp3.realVerseshellExecutionClaimed === true || wp3.structuralOnly !== true;
  if (liveReceipt) issues.push('a live VerseShell receipt cannot be synthesized by closeout');
  const authority = {
    hostVerdict: fixture.authority.hostVerdict,
    singleGreenLight: fixture.authority.singleGreenLight,
    harnessVerdictOwner: fixture.authority.harnessVerdictOwner,
    executionOwner: fixture.authority.executionOwner,
    landingOwner: fixture.authority.landingOwner,
    liveVerseShellReceiptExecuted: false,
    verseShellBridgeMode: 'structural-only',
    landOrAdmitInvoked: false,
    m4Authorized: fixture.authority.m4Authorized,
    observedHostVerdicts: requiredGates.map((gate) => ({ role: gate.role, value: gate.hostVerdict })).filter((entry) => entry.value !== null),
  };
  const changedVerdicts = authority.observedHostVerdicts.filter((entry) => entry.value !== 'unchanged');
  if (changedVerdicts.length > 0) issues.push(`host verdict changed in ${changedVerdicts.map((entry) => entry.role).join(',')}`);
  if (authority.hostVerdict !== 'unchanged' || authority.singleGreenLight !== false || authority.harnessVerdictOwner !== 'host' || authority.executionOwner !== 'verseShell' || authority.landingOwner !== 'host-git') issues.push('authority contract drifted');
  if (authority.liveVerseShellReceiptExecuted !== false || authority.landOrAdmitInvoked !== false || authority.m4Authorized !== false) issues.push('authority boundary promoted without evidence');

  validateRetirement(fixture.retirementLayers, issues);
  const residualRisks = [...fixture.residualRisks];
  for (const required of ['live-verseShell-receipt', 'conflicts-plan-seam', 'partial-read-surfaces', 'language-completeness', 'non-windows-platforms', 'release-package', 'm4-recovery', 'historical-planning-manifest', 'verifier-shared-builder']) {
    if (!residualRisks.some((entry) => entry.id === required)) issues.push(`residual risk missing ${required}`);
  }
  const mc6Built = buildMc6Decision({
    root,
    fixturePath: resolve(root, MC6_FIXTURE_PATH),
    generatedAt,
  });
  issues.push(...mc6Built.decision.issues.map((issue) => `MC6: ${issue}`));

  const activeGateIssues = requiredGates.filter((gate) => gate.issues.length > 0).length;
  const report = {
    schema: WP6_SCHEMA,
    generated_at: generatedAt,
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0472',
    fixture: normalizedFixturePath,
    fixtureDigest: fileSha(root, normalizedFixturePath, 'WP6 fixture'),
    productPosture: release.productPosture,
    requiredGates,
    gateSummary: {
      required: requiredGates.length,
      verified: requiredGates.filter((gate) => gate.issues.length === 0).length,
      failed: activeGateIssues,
      deprecated: fixture.deprecatedNodes.length,
      optionalDecision: 1,
    },
    childDispositions: [
      {
        id: fixture.optionalDecision.nodeId,
        role: fixture.optionalDecision.role,
        status: 'done',
        decision: mc6Built.decision.decision,
        sourceExtractionTriggered: mc6Built.decision.sourceExtractionTriggered,
        digest: mc6Built.decision.digest,
      },
      ...fixture.deprecatedNodes.map((node) => ({ ...node, digest: null })),
    ],
    authority,
    coverage,
    languageCoverage: fixture.languageCoverage,
    platformCoverage: fixture.platformCoverage,
    release,
    conflictsPlan,
    m4: fixture.m4Broker,
    retirement: fixture.retirementLayers,
    evidenceManifests: {
      count: evidenceManifests.length,
      entryCount: evidenceManifests.reduce((sum, manifest) => sum + manifest.entries, 0),
      uniqueFileCount: new Set(evidenceManifests.flatMap((manifest) => manifest.files.map((entry) => entry.path))).size,
      reproducible: evidenceManifests.every((manifest) => manifest.missing.length === 0 && manifest.mismatches.length === 0),
      items: evidenceManifests,
    },
    credentialScan,
    localMirrorManifests: {
      declared: declaredLocalMirrorManifests.length,
      policy: 'checked-when-present; ignored artifacts are not required for clean-checkout replay',
      requiredForCleanReplay: false,
    },
    mc6: {
      path: MC6_DECISION_PATH,
      curatedPath: `${MC6_EVIDENCE_ROOT}/decision.json`,
      schema: mc6Built.decision.schema,
      decision: mc6Built.decision.decision,
      sourceExtractionTriggered: mc6Built.decision.sourceExtractionTriggered,
      digest: mc6Built.decision.digest,
    },
    residualRisks,
    boundaries: {
      sourceExtractionTriggered: false,
      providerSourceCopied: false,
      vgProcessesStarted: 0,
      realAgentInvocationClaimed: false,
      liveVerseShellReceiptExecuted: false,
      m4AuthorizationClaimed: false,
      releasePromotionClaimed: false,
      independentFinalReviewClaimed: false,
    },
    passed: false,
    issues: unique(issues),
    digest: null,
  };
  report.passed = report.issues.length === 0;
  report.digest = documentDigest(report);
  const validated = validateWp6Report(report);
  report.issues = unique([...report.issues, ...validated.issues]);
  report.passed = report.issues.length === 0;
  report.digest = documentDigest(report);
  return { fixture, report, mc6Decision: mc6Built.decision, mc6Fixture: mc6Built.fixture };
}

export function validateWp6Report(report) {
  const issues = [];
  const add = (condition, message) => { if (!condition) issues.push(message); };
  add(report?.schema === WP6_SCHEMA, 'schema mismatch');
  add(report?.task === 'TF-0472', 'task mismatch');
  add(report?.productPosture === 'non-ga-landed-unwired', 'product posture must be non-GA landed-unwired');
  add(report?.gateSummary?.required === 12 && report?.gateSummary?.verified === 12 && report?.gateSummary?.failed === 0, 'required gate summary is not 12/12/0');
  add(Array.isArray(report?.requiredGates) && report.requiredGates.length === 12, 'required gates incomplete');
  add(new Set((report?.requiredGates ?? []).map((gate) => gate.role)).size === 12, 'gate roles are not unique');
  add((report?.requiredGates ?? []).every((gate) => gate.issues?.length === 0 && gate.taskSpecSha256 && gate.verifierSha256), 'one or more gates is incomplete');
  add(report?.gateSummary?.deprecated === 1 && report?.gateSummary?.optionalDecision === 1, 'optional/deprecated disposition missing');
  add(report?.evidenceManifests?.count === 12 && report?.evidenceManifests?.reproducible === true, 'tracked pre-closeout evidence manifests are not reproducible');
  add(Number.isInteger(report?.evidenceManifests?.uniqueFileCount) && report.evidenceManifests.uniqueFileCount > 0, 'unique evidence file count missing');
  add(report?.localMirrorManifests?.declared === 12 && report?.localMirrorManifests?.requiredForCleanReplay === false, 'optional local mirror policy missing');
  add(report?.credentialScan?.passed === true && report?.credentialScan?.status === 'passed' && report?.credentialScan?.hits?.length === 0 && report?.credentialScan?.filesScanned > 0, 'credential scan missing or failed');
  add((report?.evidenceManifests?.items ?? []).every((manifest) => manifest.missing?.length === 0 && manifest.mismatches?.length === 0), 'an evidence manifest contains missing or stale files');
  add(report?.authority?.hostVerdict === 'unchanged', 'host verdict changed');
  add(report?.authority?.singleGreenLight === false && report?.authority?.defaultOn !== true, 'single green light or default-on promoted');
  add(report?.authority?.harnessVerdictOwner === 'host' && report?.authority?.executionOwner === 'verseShell' && report?.authority?.landingOwner === 'host-git', 'authority owner mismatch');
  add(report?.authority?.liveVerseShellReceiptExecuted === false && report?.authority?.verseShellBridgeMode === 'structural-only', 'live VerseShell receipt was claimed');
  add(report?.authority?.landOrAdmitInvoked === false && report?.authority?.m4Authorized === false, 'land/admit or M4 authority promoted');
  add(report?.release?.defaultOn === false && report?.release?.ga === false && report?.release?.releaseEligible === false && report?.release?.evidenceClosureIsProductApproval === false, 'release or product posture promoted');
  add(report?.release?.packageStatus === 'rejected' && report?.release?.sourceStatus === 'dirty' && report?.release?.binaryProfile === 'debug' && report?.release?.releaseBinaryBuilt === false, 'release blockers were erased');
  add(JSON.stringify(report?.release?.blockers) === JSON.stringify(['not_a_deliverable_baseline', 'release_binary_not_built', 'source_worktree_dirty']), 'release blockers drifted');
  add(report?.conflictsPlan?.status === 'unavailable' && report?.conflictsPlan?.reason === 'provider_seam_unavailable', 'conflicts-plan availability was erased');
  add(report?.m4?.status === 'not_authorized' && report?.m4?.landOrAdmitInvoked === false, 'M4 authorization drifted');
  add(report?.coverage?.coverageVector?.shellRead === 'unobserved', 'shellRead must remain unobserved');
  add(report?.coverage?.coverageVector?.directFs === 'unobserved', 'directFs must remain unobserved');
  add(report?.coverage?.coverageVector?.mcpWrite === 'unobserved', 'arbitrary MCP writes must remain unobserved');
  add(report?.coverage?.coverageVector?.browser === 'unobserved', 'browser must remain unobserved');
  add((report?.coverage?.requiredUnobservedSurfaces ?? []).length >= 5, 'unobserved surfaces removed');
  add(report?.languageCoverage?.some((entry) => entry.id === 'all-other-languages' && entry.status === 'unverified'), 'unsupported-language boundary removed');
  add(report?.languageCoverage?.some((entry) => entry.id === 'javascript-mjs' && entry.status === 'partial'), 'mjs partial coverage removed');
  add(report?.platformCoverage?.executed?.includes('win32-x64') && report?.platformCoverage?.unexecuted?.includes('linux') && report?.platformCoverage?.unexecuted?.includes('macos'), 'platform boundary removed');
  add(Array.isArray(report?.retirement) && report.retirement.length >= 5 && report.retirement.every((layer) => layer.retirementCondition && layer.reviewPoint), 'retirement conditions incomplete');
  add(report?.mc6?.decision === 'sidecar-only' && report?.mc6?.sourceExtractionTriggered === false, 'MC6 disposition drifted');
  add(report?.boundaries?.sourceExtractionTriggered === false && report?.boundaries?.providerSourceCopied === false, 'source extraction or copy was claimed');
  add(report?.boundaries?.vgProcessesStarted === 0 && report?.boundaries?.liveVerseShellReceiptExecuted === false && report?.boundaries?.m4AuthorizationClaimed === false, 'runtime authority boundary failed');
  add(report?.boundaries?.independentFinalReviewClaimed === false, 'independent final review was synthesized');
  add(Array.isArray(report?.residualRisks) && report.residualRisks.length >= 7, 'residual risk ledger incomplete');
  add(report?.passed === true && Array.isArray(report?.issues) && report.issues.length === 0, 'closeout did not pass or retained issues');
  if (report?.digest !== documentDigest(report)) issues.push('digest is not reproducible');
  return { ok: issues.length === 0, issues };
}

function buildManifest(reportText, report, mc6Text, mc6Decision) {
  const manifest = {
    schema: WP6_MANIFEST_SCHEMA,
    generated_at: report.generated_at,
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0472',
    productPosture: report.productPosture,
    finalReport: {
      path: WP6_REPORT_PATH,
      curatedPath: `${WP6_EVIDENCE_ROOT}/final-report.json`,
      sha256: sha256(Buffer.from(reportText, 'utf8')),
      digest: report.digest,
    },
    mc6Decision: {
      path: MC6_DECISION_PATH,
      curatedPath: `${MC6_EVIDENCE_ROOT}/decision.json`,
      sha256: sha256(Buffer.from(mc6Text, 'utf8')),
      digest: mc6Decision.digest,
      decision: mc6Decision.decision,
      sourceExtractionTriggered: mc6Decision.sourceExtractionTriggered,
    },
    requiredGates: report.requiredGates.map((gate) => ({
      nodeId: gate.nodeId,
      role: gate.role,
      curatedPath: gate.curatedPath,
      curatedSha256: gate.curatedSha256,
      artifactPath: gate.artifactPath,
      artifactSha256: gate.artifactSha256,
      localMirrorPath: gate.localMirrorPath,
      localMirrorPolicy: gate.localMirrorPolicy,
      artifactRelationship: gate.artifactRelationship,
      taskSpec: gate.taskSpec,
      taskSpecSha256: gate.taskSpecSha256,
      verifier: gate.verifier,
      verifierSha256: gate.verifierSha256,
      schema: gate.schema,
    })),
    evidenceManifests: report.evidenceManifests.items.map((manifestEntry) => ({
      path: manifestEntry.path,
      sha256: manifestEntry.sha256,
      entries: manifestEntry.entries,
    })),
    evidenceUniqueFileCount: report.evidenceManifests.uniqueFileCount,
    credentialScan: report.credentialScan,
    localMirrorManifests: report.localMirrorManifests,
    authority: report.authority,
    release: report.release,
    coverage: report.coverage,
    platformCoverage: report.platformCoverage,
    m4: report.m4,
    passed: report.passed,
    digest: null,
  };
  manifest.digest = documentDigest(manifest);
  return manifest;
}

export function verifyShaManifest({ root = repositoryRoot, path, expectedPaths = [] } = {}) {
  if (!path) throw new Error('SHA256SUMS path is required');
  const manifest = collectManifest(root, path);
  const issues = [];
  if (manifest.missing.length > 0) issues.push(`${path}: missing ${manifest.missing.length} file(s)`);
  if (manifest.mismatches.length > 0) issues.push(...manifest.mismatches.map((issue) => `${path}: ${issue}`));
  const actualPaths = manifest.files.map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
  const normalizedExpected = [...new Set(expectedPaths.map(normalizePath))].sort((a, b) => a.localeCompare(b));
  if (normalizedExpected.length > 0 && JSON.stringify(actualPaths) !== JSON.stringify(normalizedExpected)) {
    issues.push(`${path}: listed file set differs from the expected closeout set`);
  }
  return { ...manifest, expectedPaths: normalizedExpected, issues };
}

function writeShaFile(root, path, listedPaths) {
  const lines = [...new Set(listedPaths.map(normalizePath))]
    .sort((a, b) => a.localeCompare(b))
    .map((relativePath) => `${fileSha(root, relativePath, 'SHA256SUMS input')}  ${relativePath}`);
  const content = `${lines.join('\n')}\n`;
  const full = assertInsideRoot(root, path, 'SHA256SUMS output');
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return content;
}

export function writeWp6Closeout({
  root = repositoryRoot,
  fixturePath = resolve(root, WP6_FIXTURE_PATH),
  reportPath = resolve(root, WP6_REPORT_PATH),
  manifestPath = resolve(root, WP6_MANIFEST_PATH),
  mc6Path = resolve(root, MC6_DECISION_PATH),
  evidenceRoot = resolve(root, WP6_EVIDENCE_ROOT),
  mc6EvidenceRoot = resolve(root, MC6_EVIDENCE_ROOT),
} = {}) {
  const built = buildWp6Closeout({ root, fixturePath });
  const reportText = `${JSON.stringify(built.report, null, 2)}\n`;
  const mc6Text = `${JSON.stringify(built.mc6Decision, null, 2)}\n`;
  const manifest = buildManifest(reportText, built.report, mc6Text, built.mc6Decision);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(mc6Path), { recursive: true });
  writeFileSync(reportPath, reportText, 'utf8');
  writeFileSync(manifestPath, manifestText, 'utf8');
  writeFileSync(mc6Path, mc6Text, 'utf8');
  mkdirSync(evidenceRoot, { recursive: true });
  mkdirSync(mc6EvidenceRoot, { recursive: true });
  copyFileSync(reportPath, resolve(evidenceRoot, 'final-report.json'));
  copyFileSync(manifestPath, resolve(evidenceRoot, 'manifest.json'));
  copyFileSync(mc6Path, resolve(mc6EvidenceRoot, 'decision.json'));
  writeShaFile(root, WP6_SHA_PATH, WP6_SHA_PATHS);
  writeShaFile(root, resolve(evidenceRoot, 'SHA256SUMS'), WP6_EVIDENCE_SHA_PATHS);
  writeShaFile(root, MC6_SHA_PATH, MC6_SHA_PATHS);
  writeShaFile(root, resolve(mc6EvidenceRoot, 'SHA256SUMS'), MC6_EVIDENCE_SHA_PATHS);
  return { ...built, manifest };
}

function at(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? resolve(process.argv[index + 1]) : undefined;
}

function main() {
  const root = process.env.VERSEGIT_WP6_ROOT ? resolve(process.env.VERSEGIT_WP6_ROOT) : repositoryRoot;
  const built = writeWp6Closeout({
    root,
    fixturePath: at('--fixture') ?? resolve(root, WP6_FIXTURE_PATH),
    reportPath: at('--report') ?? resolve(root, WP6_REPORT_PATH),
    manifestPath: at('--manifest') ?? resolve(root, WP6_MANIFEST_PATH),
    mc6Path: at('--mc6') ?? resolve(root, MC6_DECISION_PATH),
  });
  if (!built.report.passed) {
    for (const issue of built.report.issues) console.error(`[versegit-wp6] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-wp6] OK gates=${built.report.gateSummary.verified}/${built.report.gateSummary.required} manifests=${built.report.evidenceManifests.count} entries=${built.report.evidenceManifests.entryCount} decision=${built.mc6Decision.decision} release_eligible=${built.report.release.releaseEligible}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[versegit-wp6] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
