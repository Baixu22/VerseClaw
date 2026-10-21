#!/usr/bin/env node
// WP9 aggregates the whole VerseGit host-module goal from the live Task Forest
// graph and retained evidence. It creates no executor and promotes no authority.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { verifyWp6Closeout } from './verify-versegit-wp6.mjs';
import { verifyWp8Artifact } from './verify-versegit-wp8.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const WP9_SCHEMA = 'clawx.versegit.wp9-global-acceptance/v1';
export const WP9_MANIFEST_SCHEMA = 'clawx.versegit.wp9-manifest/v1';
export const WP9_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp9-global-acceptance-fixture.json';
export const WP9_GRAPH_PATH = '.agent-workbench/task-forest/graph/forest.json';
export const WP9_GRAPH_CONFIG_PATH = '.agent-workbench/task-forest/config.json';
export const WP9_REPORT_PATH = 'artifacts/versegit/wp9/global-report.json';
export const WP9_MANIFEST_PATH = 'artifacts/versegit/wp9/manifest.json';
export const WP9_EVIDENCE_ROOT = 'harness/specs/fixtures/versegit-planning-correction/wp9-evidence';
export const WP9_EVIDENCE_REPORT_PATH = `${WP9_EVIDENCE_ROOT}/global-report.json`;
export const WP9_EVIDENCE_MANIFEST_PATH = `${WP9_EVIDENCE_ROOT}/manifest.json`;
export const WP9_INDEPENDENT_REVIEW_PATH = `${WP9_EVIDENCE_ROOT}/independent-review-report.json`;
export const WP9_INDEPENDENT_RESPONSE_PATH = `${WP9_EVIDENCE_ROOT}/independent-review-response.md`;
export const WP9_PRIMARY_REVIEW_FAILURE_PATH = `${WP9_EVIDENCE_ROOT}/primary-reviewer-provider-failure.md`;
export const WP9_SHA_PATH = 'artifacts/versegit/wp9/SHA256SUMS';
export const WP9_EVIDENCE_SHA_PATH = `${WP9_EVIDENCE_ROOT}/SHA256SUMS`;
export const WP9_LIFECYCLE_GUIDE = 'harness/specs/guides/versegit-concurrency/wp9-lifecycle-closeout.md';
export const WP9_README_PATH = 'docs/dev/versegit-validation-layer/README.md';
export const WP9_TASK_SPEC_PATH = 'harness/specs/tasks/versegit-wp9-global-acceptance.md';
export const WP9_COMMON_SHA_PATHS = [
  'scripts/versegit-wp9-global-acceptance.mjs',
  'scripts/verify-versegit-wp9.mjs',
  'tests/unit/versegit-wp9-global-acceptance.test.ts',
  WP9_TASK_SPEC_PATH,
  WP9_FIXTURE_PATH,
  WP9_INDEPENDENT_REVIEW_PATH,
  WP9_INDEPENDENT_RESPONSE_PATH,
  WP9_PRIMARY_REVIEW_FAILURE_PATH,
  WP9_LIFECYCLE_GUIDE,
  WP9_README_PATH,
];
export const WP9_SHA_PATHS = [WP9_REPORT_PATH, WP9_MANIFEST_PATH, ...WP9_COMMON_SHA_PATHS];
export const WP9_EVIDENCE_SHA_PATHS = [WP9_EVIDENCE_REPORT_PATH, WP9_EVIDENCE_MANIFEST_PATH, ...WP9_COMMON_SHA_PATHS];

export const WP9_EXPECTED_ACCEPTANCE_IDS = [
  'AC1-contract-identity',
  'AC2-opt-in-adapter',
  'AC3-concurrent-replay',
  'AC4-default-and-failure-isolation',
  'AC5-verseshell-receipt-authority',
  'AC6-residual-boundaries',
  'AC7-migration-control',
];

const WP8_P2_IDS = [
  'P2-evidence-snapshot-pairing',
  'P2-bounded-validation',
  'P2-historical-manifest',
];

const WP6_RESIDUAL_IDS = [
  'live-verseShell-receipt',
  'conflicts-plan-seam',
  'partial-read-surfaces',
  'language-completeness',
  'non-windows-platforms',
  'release-package',
  'real-agent-invocation',
  'm4-recovery',
  'independent-final-review',
  'historical-planning-manifest',
  'verifier-shared-builder',
];

const ACCEPTANCE_EVIDENCE = {
  'AC1-contract-identity': [
    ['harness/specs/fixtures/versegit-planning-correction/planning-contract.json', 'versioned planning and authority contract'],
    ['harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json', 'consumer identity, lifecycle, failure and schema surface'],
    ['harness/specs/fixtures/versegit-planning-correction/execution-receipt-contract.json', 'execution receipt cross-boundary schema'],
    ['harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json', 'frozen binary and contract identity'],
    ['harness/specs/fixtures/versegit-planning-correction/wp1-evidence/events-report.json', 'observation identity and event schema evidence'],
    ['harness/specs/rules/versegit-validation-layer-extension-boundary.md', 'execution and harness authority boundary'],
    ['harness/specs/scenarios/versegit-validation-layer-extension.md', 'user-visible lifecycle scenario'],
  ],
  'AC2-opt-in-adapter': [
    ['harness/src/profiles.mjs', 'explicit concurrency-aux profile registration'],
    ['harness/specs/fixtures/versegit-planning-correction/wp2-evidence/report.json', 'opt-in diagnostic profile behavior'],
    ['harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json', 'host-owned adapter differential and escalation refusals'],
    ['electron/services/versegit-module.ts', 'shipped host adapter implementation'],
  ],
  'AC3-concurrent-replay': [
    ['harness/specs/fixtures/versegit-planning-correction/wp5-evidence/soak-report.json', 'bounded concurrent replay and soak evidence'],
    ['harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json', 'migration differential oracle and negative controls'],
    ['harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json', 'real host-shaped producer-consumer vertical slice'],
    ['harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json', 'independent review of the corrected live slice'],
  ],
  'AC4-default-and-failure-isolation': [
    ['harness/specs/fixtures/versegit-planning-correction/wp2-evidence/report.json', 'single-worktree zero-call and missing-binary isolation'],
    ['harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json', 'host verdict stability across failure and continuation'],
    ['harness/specs/fixtures/versegit-planning-correction/wp6-evidence/final-report.json', 'host verdict and default-off posture'],
  ],
  'AC5-verseshell-receipt-authority': [
    ['harness/specs/fixtures/versegit-planning-correction/wp3-evidence/verdict.json', 'receipt binding and rejection matrix'],
    ['harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json', 'file-backed live VerseShell receipt authority'],
    ['harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json', 'independent receipt-authority closure'],
  ],
  'AC6-residual-boundaries': [
    ['harness/specs/fixtures/versegit-planning-correction/wp6-evidence/final-report.json', 'coverage, release, conflicts and M4 boundaries'],
    ['harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json', 'independently retained P2 residuals'],
    [WP9_LIFECYCLE_GUIDE, 'final lifecycle and residual disposition'],
  ],
  'AC7-migration-control': [
    ['harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json', 'provider source, binary, schema and golden baseline'],
    ['harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json', 'host-owned adapter without provider source import'],
    ['harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json', 'anti-rewrite differential gate'],
    ['harness/specs/fixtures/versegit-planning-correction/mc6-evidence/decision.json', 'sidecar-only extraction decision'],
    ['harness/specs/fixtures/versegit-planning-correction/node-acceptance-matrix.json', 'separate execution verifier policy for every node'],
    [WP9_LIFECYCLE_GUIDE, 'final sidecar-only migration and retirement rationale'],
  ],
};

export const WP9_ACCEPTANCE_EVIDENCE = ACCEPTANCE_EVIDENCE;

const digestCache = new Map();
const jsonCache = new Map();

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function documentDigest(document) {
  const clean = Object.fromEntries(Object.entries(document).filter(([key]) => !['generated_at', 'digest'].includes(key)));
  return sha256(JSON.stringify(canonicalize(clean)));
}

function hashFile(root, path) {
  const full = resolve(root, path);
  if (digestCache.has(full)) return digestCache.get(full);
  if (!existsSync(full)) throw new Error(`WP9 evidence missing: ${path}`);
  const value = sha256(readFileSync(full));
  digestCache.set(full, value);
  return value;
}

function readJson(root, path, label) {
  const full = resolve(root, path);
  if (jsonCache.has(full)) return jsonCache.get(full);
  if (!existsSync(full)) throw new Error(`${label} missing: ${path}`);
  const value = JSON.parse(readFileSync(full, 'utf8'));
  jsonCache.set(full, value);
  return value;
}

function readText(root, path) {
  const full = resolve(root, path);
  if (!existsSync(full)) throw new Error(`WP9 text input missing: ${path}`);
  return readFileSync(full, 'utf8');
}

function evidence(root, path, claim) {
  return { path: path.replaceAll('\\', '/'), sha256: hashFile(root, path), claim };
}

function assertion(id, passed, detail) {
  return { id, passed: passed === true, detail };
}

function addAssertion(items, issues, id, passed, detail) {
  items.push(assertion(id, passed, detail));
  if (!passed) issues.push(`${id}: ${detail}`);
}

function sameSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function inspectTaskForest({ root = repositoryRoot, fixture }) {
  const graph = readJson(root, WP9_GRAPH_PATH, 'WP9 Task Forest graph');
  const config = readJson(root, WP9_GRAPH_CONFIG_PATH, 'WP9 Task Forest config');
  const issues = [];
  const parent = graph.nodes?.[fixture.parentNodeId];
  const self = graph.nodes?.[fixture.nodeId];
  const expectedChildren = (fixture.children ?? []).map((child) => child.id);
  const actualChildren = Array.isArray(parent?.children) ? parent.children : [];
  const allowed = new Set(fixture.allowedChildStatuses ?? []);
  const openQueue = new Set(graph.status_queues?.open ?? []);
  const blockedQueue = new Set(graph.status_queues?.blocked ?? []);

  if (config.graph_hash !== fixture.graphHash) issues.push('fixture graphHash differs from the live Task Forest graph hash');
  if (!parent) issues.push(`parent node missing: ${fixture.parentNodeId}`);
  if (!self) issues.push(`self node missing: ${fixture.nodeId}`);
  if (!['ready', 'in_progress', 'done'].includes(self?.status)) issues.push(`self status is illegal: ${String(self?.status)}`);
  if (!['in_progress', 'done'].includes(parent?.status)) issues.push(`parent status is illegal: ${String(parent?.status)}`);
  if (!sameSet(actualChildren, expectedChildren)) issues.push('required child set differs from fixture');
  if (parent?.primary_parent !== null) issues.push('global parent must remain a root');

  const dependencies = Object.values(graph.edges ?? {}).filter((edge) => edge?.type === 'depends_on');
  const children = expectedChildren.map((id) => {
    const expected = fixture.children.find((child) => child.id === id);
    const node = graph.nodes?.[id];
    const isSelf = id === fixture.nodeId;
    const entry = {
      id,
      self: isSelf,
      title: String(node?.title ?? expected?.title ?? ''),
      status: String(node?.status ?? 'missing'),
      acceptanceCount: Array.isArray(node?.acceptance_criteria) ? node.acceptance_criteria.length : 0,
      evidenceCount: Array.isArray(node?.evidence) ? node.evidence.length : 0,
      fixtureStatus: expected?.status ?? null,
    };
    if (!node) {
      issues.push(`required child missing: ${id}`);
    } else {
      if (!isSelf && !allowed.has(node.status)) issues.push(`required child is not done/deprecated: ${id}=${node.status}`);
      if (!isSelf && openQueue.has(id)) issues.push(`required child remains open: ${id}`);
      if (!isSelf && blockedQueue.has(id)) issues.push(`required child remains blocked: ${id}`);
      if (node.primary_parent !== fixture.parentNodeId) issues.push(`required child has wrong primary parent: ${id}`);
      if (!isSelf && node.status === 'done' && entry.evidenceCount === 0) issues.push(`done child has no retained evidence: ${id}`);
      if (expected?.status === 'deprecated' && node.status !== 'deprecated') issues.push(`retired child status drifted: ${id}`);
    }
    return entry;
  });

  const unresolvedDependencies = [];
  for (const id of expectedChildren.filter((childId) => childId !== fixture.nodeId)) {
    for (const edge of dependencies.filter((candidate) => candidate.from === id)) {
      const dependencyStatus = graph.nodes?.[edge.to]?.status ?? 'missing';
      if (!allowed.has(dependencyStatus)) unresolvedDependencies.push({ node: id, dependency: edge.to, status: dependencyStatus });
    }
  }
  if (unresolvedDependencies.length > 0) issues.push(`required children still have blocking dependencies: ${unresolvedDependencies.map((entry) => `${entry.node}->${entry.dependency}`).join(',')}`);
  if (graph.nodes?.['TF-0480']?.status !== 'deprecated') issues.push('TF-0480 must remain explicitly deprecated');
  if (graph.nodes?.['TF-0514']?.status !== 'done') issues.push('TF-0514 independent review must be done');
  if (graph.nodes?.['TF-0513']?.status !== 'done') issues.push('TF-0513 corrected live slice must be done');

  return {
    issues,
    snapshot: {
      authority: WP9_GRAPH_PATH,
      graphHash: fixture.graphHash,
      capturedAt: fixture.capturedAt,
      self: { id: fixture.nodeId, status: String(self?.status ?? 'missing') },
      parent: {
        id: fixture.parentNodeId,
        status: String(parent?.status ?? 'missing'),
        title: String(parent?.title ?? ''),
        acceptanceCount: Array.isArray(parent?.acceptance_criteria) ? parent.acceptance_criteria.length : 0,
        acceptanceCriteria: Array.isArray(parent?.acceptance_criteria) ? parent.acceptance_criteria.map(String) : [],
      },
      children,
      childCount: children.length,
      openChildren: children.filter((child) => !child.self && openQueue.has(child.id)).map((child) => child.id),
      blockedChildren: children.filter((child) => !child.self && blockedQueue.has(child.id)).map((child) => child.id),
      unresolvedDependencies,
      expectedFinal: { self: 'done', parent: 'done' },
    },
  };
}

export function buildAcceptances({ root = repositoryRoot, criteria, graphSnapshot }) {
  const issues = [];
  const planning = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/planning-contract.json', 'planning contract');
  const mc1 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json', 'MC1 contract');
  const receipt = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/execution-receipt-contract.json', 'execution receipt contract');
  const wp0 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json', 'WP0 contract evidence');
  const wp1 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp1-evidence/events-report.json', 'WP1 observation evidence');
  const wp2 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp2-evidence/report.json', 'WP2 profile evidence');
  const wp3 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp3-evidence/verdict.json', 'WP3 receipt evidence');
  const wp5 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp5-evidence/soak-report.json', 'WP5 soak evidence');
  const wp6 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp6-evidence/final-report.json', 'WP6 closeout evidence');
  const wp7 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json', 'WP7 host vertical evidence');
  const wp8 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json', 'WP8 independent review');
  const mc0 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json', 'MC0 baseline');
  const mc4 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json', 'MC4 adapter evidence');
  const mc5 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json', 'MC5 differential evidence');
  const mc6 = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/mc6-evidence/decision.json', 'MC6 extraction decision');
  const nodeMatrix = readJson(root, 'harness/specs/fixtures/versegit-planning-correction/node-acceptance-matrix.json', 'node acceptance matrix');
  const profilesText = readText(root, 'harness/src/profiles.mjs');
  const ruleText = readText(root, 'harness/specs/rules/versegit-validation-layer-extension-boundary.md');
  const scenarioText = readText(root, 'harness/specs/scenarios/versegit-validation-layer-extension.md');
  const guideText = readText(root, WP9_LIFECYCLE_GUIDE);
  const byId = (id) => (wp2.cases ?? []).find((entry) => entry.caseId === id);
  const wp2Single = byId('single-worktree');
  const wp2Missing = byId('missing-binary');
  const wp7Outcome = wp7.normalizedOutcome ?? {};
  const wp7Verseshell = wp7.verseshell ?? {};
  const wp8P2 = Array.isArray(wp8.p2) ? wp8.p2 : [];

  const build = (id, checks) => {
    const assertions = [];
    for (const check of checks) addAssertion(assertions, issues, check.id, check.passed, check.detail);
    const evidenceEntries = (ACCEPTANCE_EVIDENCE[id] ?? []).map(([path, claim]) => evidence(root, path, claim));
    const status = evidenceEntries.length > 0 && assertions.every((entry) => entry.passed) ? 'verified' : 'unverified';
    return {
      id,
      criterion: criteria[Number(id.slice(2, 3)) - 1] ?? '',
      status,
      evidence: evidenceEntries,
      assertions,
      conclusion: status === 'verified' ? 'direct retained evidence satisfies this goal criterion' : 'criterion is not accepted',
    };
  };

  const acceptance = [
    build('AC1-contract-identity', [
      { id: 'planning-contract-v2', passed: planning.schema === 'clawx.versegit.planning-correction/v2', detail: 'planning contract is versioned v2' },
      { id: 'live-graph-authority', passed: planning.authority?.execution_graph === WP9_GRAPH_PATH, detail: 'live Task Forest remains the execution authority' },
      { id: 'consumer-contract', passed: mc1.schema === 'clawx.versegit.consumer-contract/v1', detail: 'consumer schema is clawx.versegit.consumer-contract/v1' },
      { id: 'receipt-contract', passed: receipt.schema === 'clawx.verseshell.execution-receipt/v2', detail: 'receipt contract is execution-receipt/v2' },
      { id: 'failure-taxonomy', passed: ['missing_binary', 'schema_mismatch', 'missing_receipt', 'timeout'].every((key) => typeof mc1.failure_contract?.[key] === 'string'), detail: 'failure taxonomy is explicit' },
      { id: 'identity-evidence', passed: wp0.status === 'verified' && wp1.passed === true, detail: 'WP0/WP1 identity and observation gates pass' },
      { id: 'boundary-docs', passed: /harness verdict|execution authority/iu.test(ruleText) && /M3/iu.test(scenarioText), detail: 'rule and scenario document authority and lifecycle boundaries' },
    ]),
    build('AC2-opt-in-adapter', [
      { id: 'profile-registered', passed: profilesText.includes("'concurrency-aux'") && profilesText.includes('versegit-wp2-profile.mjs'), detail: 'concurrency-aux is explicitly selectable' },
      { id: 'profile-opt-in', passed: wp2.profile === 'concurrency-aux' && wp2.opt_in === true && wp2.passed === true, detail: 'WP2 profile is opt-in and passes' },
      { id: 'adapter-equivalent', passed: mc4.reportSchema === 'clawx.versegit.mc4-adapter/v1' && mc4.status === 'equivalent' && mc4.contract_conformance?.ok === true, detail: 'MC4 adapter is differentially equivalent' },
      { id: 'adapter-boundaries', passed: mc4.boundaries?.provider_source_modified === false && mc4.boundaries?.renderer_can_call_adapter === false && mc4.boundaries?.default_on === false, detail: 'adapter remains host-owned, non-renderer and default-off' },
    ]),
    build('AC3-concurrent-replay', [
      { id: 'wp5-replay', passed: wp5.passed === true && wp5.summary?.cycles === 3 && wp5.summary?.passedCycles === 3 && wp5.summary?.failedScenarios === 0, detail: 'WP5 bounded replay and soak pass' },
      { id: 'mc5-oracle', passed: mc5.status === 'framework_verified' && mc5.controlled_samples?.passed === true && (mc5.negative_controls ?? []).every((entry) => entry.fired === true), detail: 'MC5 differential oracle and all negative controls fire' },
      { id: 'wp7-live-slice', passed: wp7.status === 'passed' && wp7.passed === true && wp7.identity?.worktrees?.length === 2 && wp7.identity?.crossWorktreeViolations === 0, detail: 'WP7 has two isolated worktrees and zero identity leaks' },
      { id: 'producer-consumer', passed: ['ssi/api-drift', 'ssi/stale-read'].every((kind) => wp7Outcome.producerConsumerKinds?.includes(kind)) && wp7Outcome.candidateMaterialized === true && wp7Outcome.candidateCheckOk === true, detail: 'producer-consumer candidate facts and candidate check are observed' },
      { id: 'wp8-verdict', passed: ['PASS', 'PASS_WITH_GAPS'].includes(wp8.verdict) && wp8.p0?.length === 0 && wp8.p1?.length === 0, detail: 'WP8 independently passes with P0/P1 empty' },
    ]),
    build('AC4-default-and-failure-isolation', [
      { id: 'single-worktree-zero-call', passed: wp2Single?.status === 'not_applicable' && wp2Single?.usage?.processesStarted === 0 && wp2Single?.usage?.stateReads === 0, detail: 'single worktree/session starts no VG process and reads no VG state' },
      { id: 'missing-binary-isolated', passed: wp2Missing?.status === 'unavailable' && wp2Missing?.usage?.processesStarted === 0 && wp2Missing?.hostVerdict === 'unchanged', detail: 'missing binary is unavailable and does not change host verdict' },
      { id: 'host-verdict-stable', passed: wp7.hostVerdict?.owner === 'host' && wp7.hostVerdict?.unchanged === true && wp7.hostVerdict?.before === wp7.hostVerdict?.afterFailure && wp7.hostVerdict?.before === wp7.hostVerdict?.afterContinuation, detail: 'WP7 failure and continuation preserve the host verdict' },
      { id: 'wrong-receipt-contained', passed: wp7.receiptFlow?.wrongReceipt?.status === 'rejected_by_policy' && wp7.receiptFlow?.wrongReceipt?.hostVerdict === 'unchanged', detail: 'wrong receipt is rejected without changing the host verdict' },
      { id: 'default-off', passed: wp6.authority?.singleGreenLight === false && wp6.release?.defaultOn === false, detail: 'default-on and single-green-light stay false' },
    ]),
    build('AC5-verseshell-receipt-authority', [
      { id: 'receipt-matrix', passed: wp3.passed === true && wp3.structuralOnly === true && wp3.summary?.caseCount === 10 && wp3.summary?.rejected === 8 && wp3.summary?.duplicate === 1, detail: 'WP3 retains the complete structural accept/reject/duplicate matrix' },
      { id: 'caller-self-report-refused', passed: wp3.boundaries?.callerSelfReportAccepted === false && wp3.boundaries?.secondExecutor === false && wp3.boundaries?.selectedScopeAsFull === false, detail: 'caller self-report, second executor and selected-as-full are refused' },
      { id: 'live-governed-calls', passed: wp7Verseshell.governedCalls?.length === 2 && wp7Verseshell.governedCalls.every((call) => call.authorityObserved === true && call.approvalRequired === true && call.approvedByHost === true), detail: 'WP7 retains two host-approved governed VerseShell calls' },
      { id: 'receipt-authority', passed: wp7Outcome.receiptAuthorityVerified === true && wp7Outcome.governedCallCount === 2 && wp7.receiptFlow?.continuationVerdict?.realVerseshellExecution === true, detail: 'file-backed receipt authority reconstructs a real execution fact' },
      { id: 'failure-before-continuation', passed: wp7Outcome.failureRejectedBeforeContinuation === true && wp7.continuation?.failureRejectedBeforeContinuation === true && wp7.continuation?.continuationAccepted === true, detail: 'failure is consumed before an accepted continuation' },
      { id: 'independent-receipt-review', passed: wp8.scope?.receiptAuthorityReviewed === true && (wp8.initialReview?.closureEvidence ?? []).some((entry) => entry.id === 'P1-receipt-authority' && entry.status === 'closed'), detail: 'WP8 independently closes the receipt-authority finding' },
    ]),
    build('AC6-residual-boundaries', [
      { id: 'read-surfaces-retained', passed: ['shellRead', 'directFs', 'mcpWrite', 'network', 'browser'].every((surface) => wp6.coverage?.coverageVector?.[surface] !== 'host-event') && wp6.coverage?.requiredUnobservedSurfaces?.length >= 5, detail: 'unobserved and partial read surfaces remain explicit' },
      { id: 'conflicts-plan-unavailable', passed: wp6.conflictsPlan?.status === 'unavailable' && wp6.conflictsPlan?.hostVerdict === 'unchanged', detail: 'missing pure conflicts-plan seam remains explicit' },
      { id: 'release-ineligible', passed: wp6.release?.releaseEligible === false && wp6.release?.ga === false && wp6.release?.defaultOn === false && wp6.release?.sourceStatus === 'dirty' && wp6.release?.binaryProfile === 'debug', detail: 'release, GA, default-on, dirty source and debug binary posture remain visible' },
      { id: 'm4-not-authorized', passed: wp6.m4?.status === 'not_authorized' && wp6.m4?.landOrAdmitInvoked === false, detail: 'M4 remains unauthorized and land/admit were not invoked' },
      { id: 'wp8-p2-retained', passed: WP8_P2_IDS.every((id) => wp8P2.some((entry) => entry.id === id && entry.disposition === 'residual')), detail: 'all three WP8 P2 residuals remain retained' },
      { id: 'bounded-platform-language', passed: /non-Windows/iu.test(guideText) && /language coverage/iu.test(guideText) && /external-model/iu.test(guideText), detail: 'platform, language and external-model limits remain documented' },
    ]),
    build('AC7-migration-control', [
      { id: 'mc0-source-freeze', passed: mc0.source?.status === 'dirty' && mc0.binary?.status === 'observed' && mc0.source?.head === '89af0c36216e64bb0f7430fc3fe21c39c485be7c', detail: 'MC0 retains provider source/binary identity and dirty posture' },
      { id: 'adapter-no-source-copy', passed: mc4.boundaries?.vg_source_tree_copied === false && mc4.boundaries?.vg_history_copied === false && mc4.migration_budget_scope?.provider_source_files_changed === 0 && mc4.migration_budget_scope?.provider_internal_imports === 0, detail: 'MC4 copies no provider source or internals' },
      { id: 'differential-controls', passed: mc5.status === 'framework_verified' && mc5.negative_controls?.length >= 6 && mc5.negative_controls.every((entry) => entry.fired === true), detail: 'MC5 rejects rewrite-shaped drift' },
      { id: 'sidecar-only', passed: mc6.decision === 'sidecar-only' && mc6.sourceExtractionTriggered === false && mc6.passed === true && (mc6.migrationFiles ?? []).length === 0, detail: 'MC6 remains sidecar-only with no source extraction' },
      { id: 'separate-verifiers', passed: (nodeMatrix.nodes ?? []).every((node) => node.executionVerifier !== node.planningVerifier), detail: 'planning verifiers cannot close execution nodes' },
      { id: 'retired-duplicate', passed: graphSnapshot.children.some((child) => child.id === 'TF-0480' && child.status === 'deprecated'), detail: 'MC7 duplicate closeout remains retired into WP6' },
    ]),
  ];

  const expectedIds = WP9_EXPECTED_ACCEPTANCE_IDS;
  if (!sameSet(acceptance.map((entry) => entry.id), expectedIds)) issues.push('acceptance id set differs from the expected seven criteria');
  if (acceptance.some((entry) => entry.status !== 'verified')) issues.push('not every acceptance criterion is verified');
  if (acceptance.some((entry) => entry.evidence.length === 0)) issues.push('an acceptance criterion has no evidence');
  return { acceptance, issues };
}

function gitValue(root, argv) {
  return execFileSync('git', argv, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function uniqueInputs(entries, fixturePath, fixtureDigest) {
  const byPath = new Map();
  for (const entry of entries) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, { path: entry.path, sha256: entry.sha256 });
  }
  byPath.set(fixturePath, { path: fixturePath, sha256: fixtureDigest });
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function buildWp9GlobalAcceptance({ root = repositoryRoot, fixturePath = WP9_FIXTURE_PATH, generatedAt } = {}) {
  digestCache.clear();
  jsonCache.clear();
  const fixture = readJson(root, fixturePath, 'WP9 fixture');
  const issues = [];
  if (fixture.schema !== 'clawx.versegit.wp9-global-acceptance-fixture/v1') issues.push('fixture schema mismatch');
  if (fixture.nodeId !== 'TF-0515' || fixture.parentNodeId !== 'TF-0465') issues.push('fixture task identity mismatch');
  if (!sameSet(fixture.expectedAcceptanceIds ?? [], WP9_EXPECTED_ACCEPTANCE_IDS)) issues.push('fixture acceptance id set mismatch');
  if (fixture.residualDisposition !== 'retain') issues.push('fixture must retain residuals');

  const forest = inspectTaskForest({ root, fixture });
  issues.push(...forest.issues);
  const parent = readJson(root, WP9_GRAPH_PATH, 'WP9 Task Forest graph').nodes?.[fixture.parentNodeId] ?? {};
  const criteria = Array.isArray(parent.acceptance_criteria) ? parent.acceptance_criteria : [];
  if (criteria.length !== 7) issues.push(`parent must expose seven acceptance criteria, found ${criteria.length}`);

  const acceptanceResult = buildAcceptances({ root, criteria, graphSnapshot: forest.snapshot });
  issues.push(...acceptanceResult.issues);
  const independentReview = readJson(root, WP9_INDEPENDENT_REVIEW_PATH, 'WP9 independent review');
  const independentResponseText = readText(root, WP9_INDEPENDENT_RESPONSE_PATH);
  const primaryReviewFailureText = readText(root, WP9_PRIMARY_REVIEW_FAILURE_PATH);
  if (independentReview.schema !== 'clawx.versegit.wp9-independent-review/v1') issues.push('WP9 independent review schema mismatch');
  if (independentReview.task !== 'TF-0515' || independentReview.driven_by !== 'agent') issues.push('WP9 independent review identity mismatch');
  if (independentReview.actor !== 'ccs-hub/gpt-6.1-sol') issues.push('WP9 independent reviewer identity mismatch');
  if (independentReview.reviewedImplementationCommit !== fixture.wp9ImplementationCommit) issues.push('WP9 independent review candidate differs from fixture');
  if (independentReview.verdict !== 'PASS_WITH_GAPS' || independentReview.passed !== true) issues.push('WP9 independent review is not passing');
  if ((independentReview.p0 ?? []).length !== 0 || (independentReview.p1 ?? []).length !== 0) issues.push('WP9 independent review P0/P1 must be empty');
  if (!WP8_P2_IDS.every((id) => (independentReview.p2 ?? []).some((entry) => entry.id === id && entry.disposition === 'residual'))) issues.push('WP9 independent review residual set differs from WP8');
  if (independentReview.reviewerProviderFailure?.model !== 'ccs-agentrouter/gpt-6.1-sol' || independentReview.reviewerProviderFailure?.httpStatus !== 403 || independentReview.reviewerProviderFailure?.verdictCreated !== false) issues.push('primary reviewer failure provenance missing');
  if (!primaryReviewFailureText.includes('HTTP 403') && !primaryReviewFailureText.includes('http_status: 403')) issues.push('primary reviewer failure evidence is incomplete');
  if (!independentResponseText.includes(String(fixture.wp9ImplementationCommit)) || !independentResponseText.includes('PASS_WITH_GAPS')) issues.push('independent review response is not bound to the final implementation candidate');
  let reviewedCommit = '';
  try {
    reviewedCommit = gitValue(root, ['rev-parse', String(fixture.wp9ImplementationCommit ?? '')]);
  } catch (error) {
    issues.push(`WP9 independent review candidate is not resolvable: ${String(error?.message ?? error).slice(0, 180)}`);
  }
  if (reviewedCommit !== fixture.wp9ImplementationCommit) issues.push('WP9 independent review candidate does not resolve exactly');
  const wp6Verification = verifyWp6Closeout();
  const wp8Verification = verifyWp8Artifact();
  const wp6Report = wp6Verification.report;
  const wp8Report = wp8Verification.report;
  if (!wp6Verification.ok) issues.push(...wp6Verification.issues.map((issue) => `WP6 verifier: ${issue}`));
  if (!wp8Verification.ok) issues.push(...wp8Verification.issues.map((issue) => `WP8 verifier: ${issue}`));

  if (wp8Report.actor !== fixture.wp8Reviewer) issues.push('WP8 reviewer identity differs from fixture');
  if (wp8Report.candidate?.commit !== fixture.wp7Candidate?.commit) issues.push('WP8 candidate commit differs from fixture');
  if (wp8Report.candidate?.tree !== fixture.wp7Candidate?.tree) issues.push('WP8 candidate tree differs from fixture');
  if (!['PASS', 'PASS_WITH_GAPS'].includes(wp8Report.verdict)) issues.push('WP8 verdict is not passing');
  if ((wp8Report.p0 ?? []).length !== 0 || (wp8Report.p1 ?? []).length !== 0) issues.push('WP8 P0/P1 must be empty');
  if (wp8Report.verdict === 'PASS' && (wp8Report.p2 ?? []).length > 0) issues.push('WP8 PASS with retained P2 is incoherent');
  const expectedP2 = WP8_P2_IDS.every((id) => (wp8Report.p2 ?? []).some((entry) => entry.id === id));
  if (!expectedP2) issues.push('WP8 P2 residual set is incomplete');

  let resolvedCommit = '';
  let resolvedTree = '';
  try {
    resolvedCommit = gitValue(root, ['rev-parse', String(fixture.wp7Candidate?.commit ?? '')]);
    resolvedTree = gitValue(root, ['rev-parse', `${String(fixture.wp7Candidate?.commit ?? '')}^{tree}`]);
  } catch (error) {
    issues.push(`WP7 candidate is not resolvable: ${String(error?.message ?? error).slice(0, 180)}`);
  }
  if (resolvedCommit !== fixture.wp7Candidate?.commit) issues.push('WP7 candidate commit does not resolve exactly');
  if (resolvedTree !== fixture.wp7Candidate?.tree) issues.push('WP7 candidate tree does not resolve exactly');

  const authority = {
    humanEvidence: false,
    realHumanEvidenceClaimed: false,
    singleGreenLight: false,
    defaultOn: false,
    ga: false,
    releaseEligible: false,
    m4Authorized: false,
  };
  if (wp6Report.authority?.singleGreenLight !== false || wp6Report.release?.defaultOn !== false || wp6Report.release?.ga !== false || wp6Report.release?.releaseEligible !== false) issues.push('WP6 authority/release posture drifted');
  if (wp8Report.authority?.humanEvidence !== false || wp8Report.authority?.ga !== false || wp8Report.authority?.releaseEligible !== false || wp8Report.authority?.m4Authorized !== false) issues.push('WP8 authority posture drifted');

  const p2 = structuredClone(wp8Report.p2 ?? []);
  const residuals = [
    ...p2.map((entry) => ({ source: 'WP8', ...entry })),
    ...(wp6Report.residualRisks ?? []).map((entry) => ({ source: 'WP6', ...entry })),
  ];
  for (const id of [...WP8_P2_IDS, ...WP6_RESIDUAL_IDS]) {
    if (!residuals.some((entry) => entry.id === id)) issues.push(`residual missing: ${id}`);
  }
  if (residuals.some((entry) => entry.disposition && entry.disposition !== 'retain' && entry.disposition !== 'residual')) issues.push('a retained WP8 P2 was promoted or closed');

  const acceptanceEvidence = acceptanceResult.acceptance.flatMap((entry) => entry.evidence);
  const reviewEvidence = [
    evidence(root, WP9_INDEPENDENT_REVIEW_PATH, 'independent WP9 PASS_WITH_GAPS review'),
    evidence(root, WP9_INDEPENDENT_RESPONSE_PATH, 'raw independent reviewer response'),
    evidence(root, WP9_PRIMARY_REVIEW_FAILURE_PATH, 'primary provider failure provenance'),
  ];
  const fixtureDigest = hashFile(root, fixturePath);
  const requiredChildren = forest.snapshot.children.filter((child) => !child.self);
  const report = {
    schema: WP9_SCHEMA,
    generated_at: generatedAt ?? new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0515',
    parentTask: 'TF-0465',
    fixture: fixturePath.replaceAll('\\', '/'),
    fixtureDigest,
    globalVerdict: issues.length === 0 ? 'PASS_WITH_GAPS' : 'FAIL',
    passed: issues.length === 0,
    p0: [],
    p1: [],
    p2,
    acceptance: acceptanceResult.acceptance,
    acceptanceSummary: {
      required: WP9_EXPECTED_ACCEPTANCE_IDS.length,
      verified: acceptanceResult.acceptance.filter((entry) => entry.status === 'verified').length,
      withoutEvidence: acceptanceResult.acceptance.filter((entry) => entry.evidence.length === 0).length,
      statusesAllowed: ['verified', 'not_applicable', 'retired'],
    },
    taskForest: forest.snapshot,
    childGateSummary: {
      total: requiredChildren.length,
      done: requiredChildren.filter((child) => child.status === 'done').length,
      deprecated: requiredChildren.filter((child) => child.status === 'deprecated').length,
      openOrBlocked: [...forest.snapshot.openChildren, ...forest.snapshot.blockedChildren],
      unresolvedDependencies: forest.snapshot.unresolvedDependencies,
      includingSelf: {
        total: forest.snapshot.children.length,
        selfStatus: forest.snapshot.self.status,
        expectedSelfStatus: 'done',
      },
    },
    gateChecks: [
      { id: 'wp6-independent-verifier', passed: wp6Verification.ok, issues: wp6Verification.issues },
      { id: 'wp8-independent-verifier', passed: wp8Verification.ok, issues: wp8Verification.issues },
      { id: 'wp7-candidate-resolution', passed: resolvedCommit === fixture.wp7Candidate?.commit && resolvedTree === fixture.wp7Candidate?.tree, issues: [] },
      { id: 'wp9-independent-review', passed: independentReview.passed === true && independentReview.verdict === 'PASS_WITH_GAPS' && (independentReview.p0 ?? []).length === 0 && (independentReview.p1 ?? []).length === 0, issues: [] },
    ],
    review: {
      wp6: {
        reportPath: 'harness/specs/fixtures/versegit-planning-correction/wp6-evidence/final-report.json',
        schema: wp6Report.schema,
        passed: wp6Report.passed === true,
        verifierPassed: wp6Verification.ok,
      },
      wp8: {
        reportPath: 'harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json',
        actor: wp8Report.actor,
        verdict: wp8Report.verdict,
        p0: wp8Report.p0?.length ?? null,
        p1: wp8Report.p1?.length ?? null,
        p2: wp8Report.p2?.length ?? null,
        verifierPassed: wp8Verification.ok,
      },
      wp7Candidate: {
        commit: resolvedCommit,
        tree: resolvedTree,
        fixtureCommit: fixture.wp7Candidate?.commit,
        fixtureTree: fixture.wp7Candidate?.tree,
      },
      wp9: {
        reportPath: WP9_INDEPENDENT_REVIEW_PATH,
        responsePath: WP9_INDEPENDENT_RESPONSE_PATH,
        providerFailurePath: WP9_PRIMARY_REVIEW_FAILURE_PATH,
        actor: independentReview.actor,
        verdict: independentReview.verdict,
        p0: independentReview.p0?.length ?? null,
        p1: independentReview.p1?.length ?? null,
        p2: independentReview.p2?.length ?? null,
        reviewedImplementationCommit: independentReview.reviewedImplementationCommit,
        reviewedCommitResolvable: reviewedCommit === fixture.wp9ImplementationCommit,
        passed: independentReview.passed === true,
      },
    },
    lifecycle: {
      positioning: 'standalone-product-with-narrow-opt-in-host-module-profile',
      productPosture: 'non-ga-landed-unwired',
      highestObservedAuthority: 'bounded-M3-observation',
      m1HostProfileObserved: true,
      m2CandidateFactsObserved: true,
      m3BoundedHostSliceObserved: true,
      m3ProductComplete: false,
      m4Authorized: false,
      externalModelSessionObserved: false,
      realHumanEvidenceClaimed: false,
      singleSourceOfTruthReplaced: false,
      defaultOn: false,
      ga: false,
      releaseEligible: false,
      singleGreenLight: false,
    },
    authority,
    residuals,
    residualDisposition: 'retain',
    boundaries: {
      windowsOnlyExecution: true,
      agentDrivenBoundedSliceOnly: true,
      nonWindowsUnmeasured: true,
      externalModelUnmeasured: true,
      fullProductM3Unverified: true,
      fullLanguageCoverageUnverified: true,
      conflictsPlanUnavailable: true,
      releasePackageRejected: true,
      m4RecoveryUnverified: true,
      verifierSharedBuilderResidual: true,
    },
    closeout: {
      evidenceRoot: WP9_EVIDENCE_ROOT,
      requiredFinalStatus: { self: 'done', parent: 'done' },
      preconditionsPassed: issues.length === 0,
      proposalRequired: true,
    },
    inputs: uniqueInputs([...acceptanceEvidence, ...reviewEvidence], fixturePath.replaceAll('\\', '/'), fixtureDigest),
    issues: [...new Set(issues)],
  };
  report.digest = documentDigest(report);
  return report;
}

function jsonText(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function hashText(value) {
  return sha256(Buffer.from(value, 'utf8'));
}

function writeShaManifest(root, path, paths) {
  const lines = [...new Set(paths)].sort().map((entry) => {
    const full = resolve(root, entry);
    if (!existsSync(full)) throw new Error(`SHA256SUMS target missing: ${entry}`);
    return `${hashFile(root, entry)}  ${entry.replaceAll('\\', '/')}`;
  });
  const full = resolve(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${lines.join('\n')}\n`, 'utf8');
}

export function buildManifest(report, generatedAt = report.generated_at) {
  const manifest = {
    schema: WP9_MANIFEST_SCHEMA,
    generated_at: generatedAt,
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0515',
    parentTask: 'TF-0465',
    report: {
      path: WP9_REPORT_PATH,
      curatedPath: WP9_EVIDENCE_REPORT_PATH,
      digest: report.digest,
    },
    verdict: {
      globalVerdict: report.globalVerdict,
      passed: report.passed,
      p0: report.p0.length,
      p1: report.p1.length,
      p2: report.p2.length,
    },
    acceptance: report.acceptanceSummary,
    children: report.childGateSummary,
    independentReview: {
      actor: report.review.wp9.actor,
      verdict: report.review.wp9.verdict,
      p0: report.review.wp9.p0,
      p1: report.review.wp9.p1,
      p2: report.review.wp9.p2,
      reviewedImplementationCommit: report.review.wp9.reviewedImplementationCommit,
      passed: report.review.wp9.passed,
    },
    authority: report.authority,
    residualDisposition: report.residualDisposition,
    residualCount: report.residuals.length,
    fixtureDigest: report.fixtureDigest,
    graphHash: report.taskForest.graphHash,
    closeout: report.closeout,
  };
  manifest.digest = documentDigest(manifest);
  return manifest;
}

export function writeWp9Artifacts({ root = repositoryRoot, report, reportPath = WP9_REPORT_PATH } = {}) {
  if (!report?.passed) throw new Error('WP9 refuses to write a failing global report');
  const artifactReport = resolve(root, reportPath);
  const curatedReport = resolve(root, WP9_EVIDENCE_REPORT_PATH);
  const artifactManifest = resolve(dirname(artifactReport), 'manifest.json');
  const curatedManifest = resolve(root, WP9_EVIDENCE_MANIFEST_PATH);
  const reportBytes = jsonText(report);
  const manifest = buildManifest(report);
  manifest.report.sha256 = hashText(reportBytes);
  manifest.digest = documentDigest(manifest);
  const manifestBytes = jsonText(manifest);

  mkdirSync(dirname(artifactReport), { recursive: true });
  mkdirSync(dirname(curatedReport), { recursive: true });
  writeFileSync(artifactReport, reportBytes, 'utf8');
  writeFileSync(curatedReport, reportBytes, 'utf8');
  writeFileSync(artifactManifest, manifestBytes, 'utf8');
  writeFileSync(curatedManifest, manifestBytes, 'utf8');

  writeShaManifest(root, resolve(dirname(artifactReport), 'SHA256SUMS'), [
    relative(root, artifactReport).replaceAll('\\', '/'),
    relative(root, artifactManifest).replaceAll('\\', '/'),
    ...WP9_COMMON_SHA_PATHS,
  ]);
  writeShaManifest(root, WP9_EVIDENCE_SHA_PATH, [
    WP9_EVIDENCE_REPORT_PATH,
    WP9_EVIDENCE_MANIFEST_PATH,
    ...WP9_COMMON_SHA_PATHS,
  ]);
  return { report, manifest, manifestPath: relative(root, artifactManifest).replaceAll('\\', '/') };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const fixturePath = option('--fixture') ?? WP9_FIXTURE_PATH;
  const reportPath = option('--out') ?? WP9_REPORT_PATH;
  const report = buildWp9GlobalAcceptance({ fixturePath });
  if (!report.passed) {
    for (const issue of report.issues) console.error(`[versegit-wp9] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  const written = writeWp9Artifacts({ report, reportPath });
  console.log(`[versegit-wp9] OK verdict=${report.globalVerdict} acceptance=${report.acceptanceSummary.verified}/${report.acceptanceSummary.required} children=${report.childGateSummary.done}done/${report.childGateSummary.deprecated}deprecated p2=${report.p2.length} manifest=${written.manifestPath}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[versegit-wp9] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
