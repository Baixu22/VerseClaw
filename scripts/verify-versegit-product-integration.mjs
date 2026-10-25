#!/usr/bin/env node
// F5 independently replays retained VG product-integration evidence and seals a
// current-candidate acceptance report. It creates no executor and grants no
// task, approval, write-journal, Git-apply or M4 authority.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const F5_SCHEMA = 'clawx.versegit.product-f5-global-acceptance/v1';
export const F5_INDEX_SCHEMA = 'clawx.versegit.product-f5-criterion-evidence-index/v1';
export const F5_VERDICT_SCHEMA = 'clawx.versegit.product-f5-independent-verdict/v1';
export const F5_TASK = 'TF-0539';
export const F5_PARENT_TASK = 'TF-0523';
export const F5_ACTOR = 'codex';
export const F5_EVIDENCE_ROOT = 'harness/specs/fixtures/versegit-product-integration/f5';
export const F5_REPORT_PATH = `${F5_EVIDENCE_ROOT}/global-acceptance.json`;
export const F5_INDEX_PATH = `${F5_EVIDENCE_ROOT}/criterion-evidence-index.json`;
export const F5_VERDICT_PATH = `${F5_EVIDENCE_ROOT}/independent-verdict.json`;
export const F5_SHA_PATH = `${F5_EVIDENCE_ROOT}/SHA256SUMS`;
export const F5_SPEC_PATH = 'harness/specs/tasks/versegit-product-f5-global-acceptance.md';
export const F5_VERIFIER_PATH = 'scripts/verify-versegit-product-integration.mjs';
export const F5_DECLARATION_PATH = 'scripts/verify-versegit-product-integration.d.mts';
export const F5_TEST_PATH = 'tests/unit/versegit-product-acceptance.test.ts';
export const F5_DOCS_PATH = 'docs/dev/versegit-validation-layer/README.md';
export const F5_PRODUCT_SEMANTICS_PATH = 'docs/clawx-product-semantics.md';
export const F5_MANIFEST_PATH = 'shared/component-authority-manifest.ts';
export const F5_README_PATHS = ['README.md', 'README.zh-CN.md', 'README.ja-JP.md'];
export const F5_AUTOCLOSE_RULE_PATH = 'harness/specs/rules/task-forest-autoclose-and-roles.md';

export const F5_REQUIRED_COMMANDS = [
  {
    id: 'unit',
    command: 'pnpm exec vitest run tests/unit/versegit-product-acceptance.test.ts',
    expectedPattern: /Test Files\s+\d+ passed/u,
  },
  {
    id: 'harness',
    command: `pnpm harness validate --spec ${F5_SPEC_PATH}`,
    expectedPattern: /Spec is valid/u,
  },
  { id: 'typecheck', command: 'pnpm run typecheck', expectedPattern: /(passed|success|exit 0)/iu },
  { id: 'comms-replay', command: 'pnpm run comms:replay', expectedPattern: /(passed|ok|success|baseline)/iu },
  { id: 'comms-compare', command: 'pnpm run comms:compare', expectedPattern: /(passed|within|baseline|ok|success)/iu },
];

export const F5_RESIDUALS = [
  {
    id: 'P2-non-windows-platforms',
    summary: 'Product evidence is limited to win32-x64; macOS and Linux were not executed.',
  },
  {
    id: 'P2-model-matrix',
    summary: 'Only deterministic probe models were exercised; broader model families and external model quality were not measured.',
  },
  {
    id: 'P2-language-matrix',
    summary: 'Repository-language coverage is limited to fixture languages; unlisted languages remain unmeasured.',
  },
  {
    id: 'P2-byte-reproducibility',
    summary: 'F3 proves semantic identity across two builds but not byte-identical provider reproducibility.',
  },
  {
    id: 'P2-conflicts-plan',
    summary: 'The provider conflicts-plan seam remains unavailable and is not promoted by this acceptance.',
  },
  {
    id: 'P2-crash-grade-cleanup',
    summary: 'Cleanup is proven for observed normal, failure, continuation, restart and interruption paths, not arbitrary power-loss/crash recovery.',
  },
];

const EVIDENCE_GROUPS = [
  { id: 'a1', task: 'TF-0524', title: 'current evidence baseline', sourceFile: 'current-verification.json', sourceKind: 'candidate' },
  { id: 'a2', task: 'TF-0525', title: 'Electron runtime baseline', sourceFile: 'build-identity.json', sourceKind: 'source' },
  { id: 'b1', task: 'TF-0526', title: 'fact adapter differential', sourceFile: 'adapter-differential.json', sourceKind: 'source' },
  { id: 'b2', task: 'TF-0527', title: 'host diagnostics', sourceFile: 'diagnostic-contract.json', sourceKind: 'source' },
  { id: 'c1', task: 'TF-0528', title: 'runtime bindings', sourceFile: 'runtime-bindings.json', sourceKind: 'source' },
  { id: 'c2', task: 'TF-0529', title: 'observation basis', sourceFile: 'coverage.json', sourceKind: 'source' },
  { id: 'd1', task: 'TF-0530', title: 'feedback delivery', sourceFile: 'feedback-delivery.json', sourceKind: 'source' },
  { id: 'd2', task: 'TF-0531', title: 'paired agent evaluation', sourceFile: 'paired-results.json', sourceKind: 'source' },
  { id: 'e1', task: 'TF-0532', title: 'candidate freeze', sourceFile: 'candidate-manifest.json', sourceKind: 'source' },
  { id: 'e2', task: 'TF-0533', title: 'receipt verification', sourceFile: 'execution-receipts.json', sourceKind: 'source' },
  { id: 'e3', task: 'TF-0534', title: 'host apply', sourceFile: 'apply-decision.json', sourceKind: 'source' },
  { id: 'f1', task: 'TF-0535', title: 'persistent completion', sourceFile: 'completion-contract.json', sourceKind: 'source' },
  { id: 'f2', task: 'TF-0536', title: 'cleanup barrier', sourceFile: 'cleanup-barrier.json', sourceKind: 'f2-before' },
  { id: 'f3', task: 'TF-0537', title: 'sidecar package', sourceFile: 'build-provenance.json', sourceKind: 'clawx-source' },
  { id: 'f4', task: 'TF-0538', title: 'bounded stability', sourceFile: 'packaged-flow.json', sourceKind: 'source' },
];

const EVIDENCE_PATHS = {
  a1: [
    'current-input-manifest.json',
    'current-verification.json',
    'historical-evidence-index.json',
    'negative-checks.json',
  ],
  a2: ['build-identity.json', 'electron-startup.json', 'smoke-results.json', 'cleanup.json', 'negative-checks.json'],
  b1: ['adapter-differential.json', 'mode-effect-matrix.json', 'authority-negative.json'],
  b2: ['diagnostic-contract.json', 'host-invoke.json', 'negative-host-requests.json'],
  c1: ['runtime-bindings.json', 'binding-negative.json'],
  c2: ['coverage.json', 'observation-links.json', 'basis-race-cases.json'],
  d1: ['feedback-delivery.json', 'next-call-binding.json', 'transcript-index.json'],
  d2: ['paired-input-manifest.json', 'paired-results.json', 'behavior-evidence.json'],
  e1: ['candidate-manifest.json', 'target-before-after.json', 'candidate-negative.json'],
  e2: ['plans.json', 'execution-receipts.json', 'execution-cleanup.json', 'receipt-negative.json'],
  e3: ['apply-decision.json', 'ordering-trace.json', 'write-journal-index.json', 'toctou-negative.json'],
  f1: ['completion-contract.json', 'persisted-outcomes.json', 'restart-lifecycle.json'],
  f2: ['cleanup-barrier.json', 'recovery-required.json', 'resource-inventory.json'],
  f3: ['sidecar-package-manifest.json', 'build-provenance.json', 'package-negative.json'],
  f4: ['packaged-flow.json', 'stability-report.json', 'stability-samples.jsonl', 'resource-survivors.json'],
};

export const F5_SOURCE_INPUTS = [
  F5_SPEC_PATH,
  F5_VERIFIER_PATH,
  F5_DECLARATION_PATH,
  F5_TEST_PATH,
  F5_DOCS_PATH,
  F5_PRODUCT_SEMANTICS_PATH,
  F5_MANIFEST_PATH,
  ...F5_README_PATHS,
  F5_AUTOCLOSE_RULE_PATH,
  'harness/specs/tasks/versegit-module-implementation-contracts.md',
  'harness/specs/tasks/versegit-product-a1-evidence-baseline.md',
  'harness/specs/tasks/versegit-product-a2-runtime-baseline.md',
  'harness/specs/tasks/versegit-product-b1-fact-adapter.md',
  'harness/specs/tasks/versegit-product-b2-host-diagnostics.md',
  'harness/specs/tasks/versegit-product-c1-runtime-bindings.md',
  'harness/specs/tasks/versegit-product-c2-observation-basis.md',
  'harness/specs/tasks/versegit-product-d1-feedback-delivery.md',
  'harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md',
  'harness/specs/tasks/versegit-product-e1-candidate-freeze.md',
  'harness/specs/tasks/versegit-product-e2-receipt-verification.md',
  'harness/specs/tasks/versegit-product-e3-host-apply.md',
  'harness/specs/tasks/versegit-product-f1-completion-contract.md',
  'harness/specs/tasks/versegit-product-f2-cleanup-barrier.md',
  'harness/specs/tasks/versegit-product-f3-sidecar-delivery.md',
  'harness/specs/tasks/versegit-product-f4-controlled-stability.md',
  'tests/unit/orchestration-worktree-merge.test.ts',
  'tests/unit/versegit-wp6-closeout.test.ts',
  'tests/unit/versegit-wp8-review.test.ts',
  'tests/unit/versegit-wp9-global-acceptance.test.ts',
  'shared/capability-claims.ts',
  'shared/dcs/component-disposition-catalog.ts',
  'shared/versegit-cleanup-barrier.ts',
  'shared/versegit-runtime-contract.ts',
  'shared/types/versegit.ts',
  'electron/services/versegit-module.ts',
  'electron/services/versegit-lifecycle.ts',
  'electron/services/versegit-fact-adapter.ts',
  'electron/services/versegit-receipt-evidence.ts',
  'openclaw_runtime/src/agents/harness/versegit-tool-observation.ts',
  'openclaw_runtime/src/agents/harness/versegit-feedback-delivery.ts',
  'openclaw_runtime/src/agents/sessions/tools/versegit-tool-basis.ts',
  'openclaw_runtime/src/agents/orchestration-worktree-merge.ts',
  'openclaw_runtime/src/agents/orchestration-candidate.ts',
  'openclaw_runtime/src/agents/orchestration-candidate-apply.ts',
  'openclaw_runtime/src/agents/patch-flow.ts',
  'openclaw_runtime/src/agents/subagent-versegit-cleanup.ts',
  'scripts/bundle-main-runtime.mjs',
  'resources/versegit/manifest.json',
  'resources/versegit/LICENSE-APACHE-2.0.txt',
];

const README_CLAIMS = {
  'README.md': [
    'VerseGit bounded coding loop',
    'default-off',
    'not approved for general availability',
    'liveReady=false',
    'productApproved=false',
    'M4',
    'win32-x64',
    'M1',
    'write journal',
    'Git apply',
  ],
  'README.zh-CN.md': [
    'VerseGit 有界编码闭环',
    '默认关闭',
    '尚未批准全面可用',
    'liveReady=false',
    'productApproved=false',
    'M4',
    'win32-x64',
    'M1',
    'write journal',
    'Git apply',
  ],
  'README.ja-JP.md': [
    'VerseGit の境界付きコーディングループ',
    '既定で無効',
    '一般提供は未承認',
    'liveReady=false',
    'productApproved=false',
    'M4',
    'win32-x64',
    'M1',
    'write journal',
    'Git apply',
  ],
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableText(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableText(value[key])}`).join(',')}}`;
}

export function documentDigest(document) {
  const clone = { ...document };
  delete clone.digest;
  return sha256(Buffer.from(stableText(clone), 'utf8'));
}

export function hashFile(root, path) {
  return sha256(readFileSync(resolve(root, path)));
}

function readText(root, path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isAncestor(root, commit, head) {
  try {
    git(root, ['merge-base', '--is-ancestor', commit, head]);
    return true;
  } catch {
    return false;
  }
}

function gitTree(root, commit) {
  try {
    return String(git(root, ['rev-parse', `${commit}^{tree}`])).trim();
  } catch {
    return null;
  }
}

function normalizeRelative(root, path) {
  return relative(root, resolve(root, path)).replaceAll('\\', '/');
}

function collectFiles(root, directory) {
  const full = resolve(root, directory);
  if (!existsSync(full)) return [];
  const files = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(normalizeRelative(root, path));
    }
  };
  visit(full);
  return files.sort();
}

export function verifyShaManifest({ root = repositoryRoot, path }) {
  const issues = [];
  const manifestPath = resolve(root, path);
  if (!existsSync(manifestPath)) return { ok: false, issues: [`missing SHA256SUMS: ${path}`], entries: [] };
  const baseDirectory = dirname(manifestPath);
  const seen = new Set();
  const entries = [];
  for (const [index, line] of readText(root, path).trim().split(/\r?\n/u).entries()) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) {
      issues.push(`invalid SHA256SUMS line ${index + 1}: ${line}`);
      continue;
    }
    const [, expected, declared] = match;
    const repositoryRelative = declared.startsWith('harness/') ? declared : normalizeRelative(root, resolve(baseDirectory, declared));
    if (seen.has(repositoryRelative)) issues.push(`duplicate SHA256SUMS entry: ${repositoryRelative}`);
    seen.add(repositoryRelative);
    const target = resolve(root, repositoryRelative);
    if (!existsSync(target)) {
      issues.push(`SHA256SUMS target missing: ${repositoryRelative}`);
      continue;
    }
    const actual = hashFile(root, repositoryRelative);
    if (actual !== expected) issues.push(`SHA256SUMS mismatch: ${repositoryRelative}`);
    entries.push({ path: repositoryRelative, sha256: expected });
  }
  const actualFiles = collectFiles(root, normalizeRelative(root, baseDirectory)).filter((entry) => entry !== normalizeRelative(root, manifestPath));
  for (const actual of actualFiles) if (!seen.has(actual)) issues.push(`unsealed evidence file: ${actual}`);
  for (const listed of seen) if (!actualFiles.includes(listed)) issues.push(`SHA256SUMS entry outside evidence directory: ${listed}`);
  return { ok: issues.length === 0, issues, entries };
}

export function normalizeDocumentPath(root, value) {
  const text = String(value).replaceAll('\\', '/');
  return text.startsWith('harness/') ? text : normalizeRelative(root, text);
}

function parseJsonl(value) {
  return value.trim().split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSONL line ${index + 1}: ${String(error)}`);
    }
  });
}

function loadEvidenceGroup(root, group) {
  const directory = `harness/specs/fixtures/versegit-product-integration/${group.id}`;
  const documents = new Map();
  for (const name of [...EVIDENCE_PATHS[group.id], 'independent-review.json']) {
    const path = `${directory}/${name}`;
    if (!existsSync(resolve(root, path))) throw new Error(`missing evidence file: ${path}`);
    documents.set(name, name.endsWith('.jsonl') ? parseJsonl(readText(root, path)) : readJson(root, path));
  }
  return { group, directory, documents };
}

function reviewDocument(documents) {
  return documents.get('independent-review.json');
}

function extractSource(document, kind) {
  if (kind === 'candidate') {
    return {
      commit: document.candidate?.source_commit,
      tree: document.candidate?.source_tree,
      dirty: document.candidate?.source_clean === true ? false : undefined,
    };
  }
  if (kind === 'f2-before') return document.source?.before;
  if (kind === 'clawx-source') return document.clawxSource;
  return document.source;
}

function reviewStatus(document) {
  return document.status ?? document.verdict;
}

function reviewPasses(document) {
  const status = reviewStatus(document);
  if (!['passed', 'pass', 'PASS_WITH_GAPS'].includes(status)) return false;
  if (document.issues !== undefined && (!Array.isArray(document.issues) || document.issues.length > 0)) return false;
  const p0 = document.priority?.p0 ?? document.p0 ?? 0;
  const p1 = document.priority?.p1 ?? document.p1 ?? 0;
  return p0 === 0 && p1 === 0;
}

function validateReviewDocument(root, directory, document, task) {
  const issues = [];
  const reviewPath = `${directory}/independent-review.json`;
  if (!reviewPasses(document)) issues.push(`${task}: independent review is not passing`);
  if (document.driven_by !== 'agent') issues.push(`${task}: independent review must be agent-driven`);
  if (typeof document.actor !== 'string' || !document.actor.trim() || /human/iu.test(document.actor)) {
    issues.push(`${task}: independent review has no concrete non-human actor`);
  }
  if (document.task && document.task !== task) issues.push(`${task}: independent review task drifted to ${document.task}`);
  for (const [declaredPath, expected] of Object.entries(document.evidence_digests ?? {})) {
    const path = normalizeDocumentPath(root, declaredPath);
    if (!existsSync(resolve(root, path))) {
      issues.push(`${task}: review references missing evidence ${path}`);
      continue;
    }
    if (hashFile(root, path) !== expected) issues.push(`${task}: review digest mismatch ${path}`);
  }
  for (const criterion of document.criteria ?? []) {
    if (!criterion.passed) issues.push(`${task}: review criterion failed ${criterion.id}`);
    for (const evidence of criterion.evidence ?? []) {
      const path = `${directory}/${evidence}`;
      if (!existsSync(resolve(root, path))) issues.push(`${task}: review criterion references missing ${path}`);
    }
  }
  if (!existsSync(resolve(root, reviewPath))) issues.push(`${task}: missing review ${reviewPath}`);
  return issues;
}

function validateDrivenBy(documents, task) {
  const issues = [];
  for (const [name, value] of documents.entries()) {
    const records = Array.isArray(value) ? value : [value];
    for (const [index, record] of records.entries()) {
      if (record.driven_by !== 'agent') issues.push(`${task}: ${name}${Array.isArray(value) ? `[${index}]` : ''} not driven_by agent`);
      if (typeof record.actor !== 'string' || !record.actor.trim() || /human/iu.test(record.actor)) {
        issues.push(`${task}: ${name}${Array.isArray(value) ? `[${index}]` : ''} has no concrete non-human actor`);
      }
    }
  }
  return issues;
}

export function verifyEvidenceGroups({ root = repositoryRoot } = {}) {
  const head = String(git(root, ['rev-parse', 'HEAD'])).trim();
  const groups = [];
  const issues = [];
  for (const group of EVIDENCE_GROUPS) {
    const loaded = loadEvidenceGroup(root, group);
    const sha = verifyShaManifest({ root, path: `${loaded.directory}/SHA256SUMS` });
    const review = reviewDocument(loaded.documents);
    const representative = loaded.documents.get(group.sourceFile);
    const source = extractSource(representative, group.sourceKind);
    const groupIssues = [
      ...sha.issues,
      ...validateReviewDocument(root, loaded.directory, review, group.task),
      ...validateDrivenBy(loaded.documents, group.task),
    ];
    if (!source?.commit || !source?.tree) {
      groupIssues.push(`${group.task}: representative evidence has no source commit/tree`);
    } else {
      const actualTree = gitTree(root, source.commit);
      if (!actualTree) groupIssues.push(`${group.task}: source commit ${source.commit} is not in this repository`);
      else if (actualTree !== source.tree) groupIssues.push(`${group.task}: source tree mismatch for ${source.commit}`);
      if (!isAncestor(root, source.commit, head)) groupIssues.push(`${group.task}: source commit is not an ancestor of current HEAD`);
      if (source.dirty === true) groupIssues.push(`${group.task}: source was dirty at evidence capture`);
    }
    issues.push(...groupIssues);
    groups.push({
      id: group.id,
      task: group.task,
      title: group.title,
      directory: loaded.directory,
      source: source ? { commit: source.commit, tree: source.tree } : null,
      review: {
        actor: review.actor,
        status: reviewStatus(review),
        p0: review.priority?.p0 ?? review.p0 ?? 0,
        p1: review.priority?.p1 ?? review.p1 ?? 0,
        p2: review.priority?.p2 ?? review.p2 ?? 0,
      },
      shaManifest: `${loaded.directory}/SHA256SUMS`,
      shaEntries: sha.entries.length,
      files: sha.entries,
      status: groupIssues.length === 0 ? 'passed' : 'failed',
      issues: groupIssues,
    });
  }
  return { ok: issues.length === 0, issues, groups, evidenceFileCount: groups.reduce((sum, group) => sum + group.shaEntries, 0) };
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function criterion(id, title, taskIds, evidencePaths, checks, recompute) {
  return {
    id,
    title,
    taskIds,
    evidence: evidencePaths,
    checks,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    recompute,
  };
}

function readAllEvidence(root) {
  const loaded = new Map();
  for (const group of EVIDENCE_GROUPS) loaded.set(group.id, loadEvidenceGroup(root, group));
  return loaded;
}

function d(loaded, group, file) {
  return loaded.get(group).documents.get(file);
}

function evaluateRiskObservation(root, loaded) {
  const a1 = d(loaded, 'a1', 'current-verification.json');
  const historical = d(loaded, 'a1', 'historical-evidence-index.json');
  const a2Smoke = d(loaded, 'a2', 'smoke-results.json');
  const a2Startup = d(loaded, 'a2', 'electron-startup.json');
  const b1 = d(loaded, 'b1', 'adapter-differential.json');
  const b1Matrix = d(loaded, 'b1', 'mode-effect-matrix.json');
  const b1Negative = d(loaded, 'b1', 'authority-negative.json');
  const b2Host = d(loaded, 'b2', 'host-invoke.json');
  const b2Negative = d(loaded, 'b2', 'negative-host-requests.json');
  const c1 = d(loaded, 'c1', 'runtime-bindings.json');
  const c1Negative = d(loaded, 'c1', 'binding-negative.json');
  const c2 = d(loaded, 'c2', 'coverage.json');
  const c2Links = d(loaded, 'c2', 'observation-links.json');
  const c2Cases = d(loaded, 'c2', 'basis-race-cases.json');
  return criterion(
    'risk-observation',
    'Repository risk observation uses a current, host-owned, bounded production path.',
    ['TF-0524', 'TF-0525', 'TF-0526', 'TF-0527', 'TF-0528', 'TF-0529'],
    [
      'a1/current-verification.json', 'a1/current-input-manifest.json', 'a1/historical-evidence-index.json',
      'a2/build-identity.json', 'a2/electron-startup.json', 'a2/smoke-results.json',
      'b1/adapter-differential.json', 'b1/mode-effect-matrix.json', 'b1/authority-negative.json',
      'b2/diagnostic-contract.json', 'b2/host-invoke.json', 'b2/negative-host-requests.json',
      'c1/runtime-bindings.json', 'c1/binding-negative.json',
      'c2/coverage.json', 'c2/observation-links.json', 'c2/basis-race-cases.json',
    ],
    [
      check('current-baseline-passed', a1.status === 'passed' && a1.candidate?.source_clean === true, 'A1 current candidate is clean and passing'),
      check('historical-not-current', historical.old_evidence_reused_as_current === false && historical.same_candidate_as_current === false, 'historical evidence is not reused as the current candidate'),
      check('electron-body-entered', a2Smoke.entered_test_body === true && a2Smoke.stats?.unexpected === 0 && a2Smoke.tests?.length === 5 && a2Smoke.tests.every((item) => item.ok === true) && a2Startup.actual_app_smoke?.entered_test_body === true, 'real Electron smoke entered the test body'),
      check('fact-adapter-host-owned', b1.passed === true && b1.production_caller === 'VerseGitModule.readFact' && b1.mode === 'M1' && b1.boundaries?.default_on === false && b1.boundaries?.m4_authorized === false, 'fact adapter is a bounded M1 host caller with default-off/M4 boundaries'),
      check('mode-matrix-bounded', b1Matrix.passed === true && b1Negative.passed === true && b1Matrix.boundaries?.m4_authorized === false, 'mode and authority negatives preserve M1/M2 boundaries'),
      check('host-diagnostics', b2Host.passed === true && b2Host.private_path_exposed === false && b2Host.argv_exposed === false && b2Negative.passed === true, 'host diagnostics omit private paths/argv and reject illegal senders'),
      check('runtime-bindings', c1.passed === true && c1Negative.passed === true && Array.isArray(c1.repo_ids) && Array.isArray(c1.worktree_ids), 'real runtime bindings retain repo/worktree identity'),
      check('observation-basis', c2.passed === true && c2Links.passed === true && c2Cases.passed === true && Object.keys(c2.declared_unobserved ?? {}).length > 0, 'observation links preserve basis identity and explicit unobserved surfaces'),
    ],
    'Replays A1/A2/B1/B2/C1/C2 counters, source/tree ancestry, SHA256SUMS, production callers and negative cases.',
  );
}

function evaluateFeedback(loaded) {
  const delivery = d(loaded, 'd1', 'feedback-delivery.json');
  const nextCall = d(loaded, 'd1', 'next-call-binding.json');
  const paired = d(loaded, 'd2', 'paired-results.json');
  const behavior = d(loaded, 'd2', 'behavior-evidence.json');
  const levels = delivery.levels ?? {};
  return criterion(
    'agent-feedback',
    'Agent feedback is delivered through the real tool-result path and its behavior shift is separately evidenced.',
    ['TF-0530', 'TF-0531'],
    ['d1/feedback-delivery.json', 'd1/next-call-binding.json', 'd1/transcript-index.json', 'd2/paired-results.json', 'd2/behavior-evidence.json', 'd2/paired-input-manifest.json'],
    [
      check('delivery-levels', delivery.passed === true && levels.transcript_confirmed === 1 && levels.host_delivered === 1 && levels.produced === 1, 'produced, host-delivered and transcript-confirmed are distinct'),
      check('next-call-binding', nextCall.passed === true && nextCall.evidence_id === delivery.evidence?.evidence_id && nextCall.evidence_ids_in_messages?.includes(delivery.evidence?.evidence_id), 'next model call carries the same evidence identity'),
      check('feedback-negatives', delivery.negatives?.duplicate_feedback_emitted === false && delivery.negatives?.duplicate_delivery_rejected === true && delivery.negatives?.wrong_owner_rejected === true && delivery.negatives?.old_epoch_rejected === true, 'duplicate, owner and epoch negatives are rejected'),
      check('paired-outcomes', paired.passed === true && paired.summary?.positive_off_fail_count === 3 && paired.summary?.positive_on_pass_count === 3 && paired.summary?.behavior_shift_count === 3 && paired.summary?.negative_false_positive_count === 0, 'paired off/on and negative controls recompute'),
      check('behavior-not-transcript-only', behavior.interpretation?.transcript_presence_alone_claimed_behavior_shift === false && behavior.interpretation?.off_on_inputs_identical === true && behavior.unmeasured?.length >= 3, 'transcript presence is not promoted to behavior shift; unmeasured model/cost scope is explicit'),
    ],
    'Replays D1 delivery levels/next-call binding and D2 paired positive/negative control counts from retained trials.',
  );
}

function evaluateCandidatePreVerification(loaded) {
  const manifest = d(loaded, 'e1', 'candidate-manifest.json');
  const target = d(loaded, 'e1', 'target-before-after.json');
  const negative = d(loaded, 'e1', 'candidate-negative.json');
  const plans = d(loaded, 'e2', 'plans.json');
  const receipts = d(loaded, 'e2', 'execution-receipts.json');
  const ordering = d(loaded, 'e3', 'ordering-trace.json');
  const rejectedCases = Object.values(negative.cases ?? {});
  return criterion(
    'candidate-pre-verification',
    'Worker results are combined and frozen, then verified before any host write.',
    ['TF-0532', 'TF-0533', 'TF-0534'],
    ['e1/candidate-manifest.json', 'e1/target-before-after.json', 'e1/candidate-negative.json', 'e2/plans.json', 'e2/execution-receipts.json', 'e3/ordering-trace.json'],
    [
      check('candidate-frozen', manifest.passed === true && manifest.candidate?.mainUnchanged === true && manifest.independent_worker_validation?.combined_is_pending_verification === true, 'combined candidate is frozen and still pending verification'),
      check('target-untouched', target.passed === true && target.candidate_status === 'frozen' && target.merge_performed === false && target.main_unchanged === true && target.refs_unchanged === true, 'freeze does not merge or mutate refs/working tree'),
      check('candidate-negatives', negative.passed === true && rejectedCases.length >= 5 && rejectedCases.every((item) => item.mainSame === true && item.refsSame === true), 'conflict, dirty, untracked, drift and write-set negatives preserve target'),
      check('host-governed-plans', plans.passed === true && plans.host_policy_approved === true && plans.native_fallback_used === false && plans.execution_route === 'production process.start -> VerseShell governed ACI', 'verification plans use governed VerseShell without native fallback'),
      check('receipt-bound-runs', receipts.passed === true && receipts.runs?.length === 2 && receipts.runs.every((run) => run.receipt?.realVerseshell === true && run.receipt_result?.status === 'accepted') && receipts.failure_before_continuation?.main_writeback_performed === false, 'failed then continued runs carry accepted host-authoritative receipts and no writeback'),
      check('verification-precedes-write', ordering.passed === true && ordering.verification_before_first_write === true && ordering.verification_index < ordering.first_write_index, 'ordering trace places verification before the first write'),
    ],
    'Replays E1 freeze/target negatives, E2 receipt-bound governed runs and E3 ordering indices.',
  );
}

function evaluateHostWriteback(loaded) {
  const apply = d(loaded, 'e3', 'apply-decision.json');
  const ordering = d(loaded, 'e3', 'ordering-trace.json');
  const journal = d(loaded, 'e3', 'write-journal-index.json');
  return criterion(
    'host-writeback',
    'ClawX remains the write-journal and Git-apply host after combined verification.',
    ['TF-0534'],
    ['e3/apply-decision.json', 'e3/ordering-trace.json', 'e3/write-journal-index.json', 'e3/toctou-negative.json'],
    [
      check('combined-success-applied', apply.passed === true && apply.combined_success?.verification?.status === 'passed' && apply.combined_success?.decision?.allowed === true, 'writeback occurs only after combined verification passes'),
      check('permission-checkpoint', apply.permission_checkpoint?.grant_status === 'active' && apply.permission_checkpoint?.final_authority_owner === 'openclaw_runtime.agents.stage4-capability-grant', 'final writeback checkpoint belongs to ClawX/runtime grant authority'),
      check('refs-not-implicitly-landed', apply.combined_success?.head_unchanged === true && apply.combined_success?.refs_unchanged === true && apply.boundaries?.vg_landing_authority === false, 'host apply writes working files without transferring VG landing authority'),
      check('write-journal', journal.passed === true && journal.result_journals?.length >= 2 && journal.journal_steps >= 2 && journal.undo?.restored?.length >= 2 && journal.undo?.errors?.length === 0 && journal.recovery_restored_base === true, 'write journal records the write batch and undo restores base'),
      check('ordering-and-toctou', ordering.passed === true && ordering.events?.some((event) => event.kind === 'post-apply-verified'), 'post-apply verification follows the write in the host trace'),
      check('host-authority', apply.boundaries?.host_authority === 'ClawX' && apply.boundaries?.default_off === true && apply.boundaries?.m4_authorized === false && apply.boundaries?.real_human_evidence === false, 'host, default-off, M4 and evidence-attribution boundaries remain intact'),
    ],
    'Replays E3 combined verification/apply order, grant checkpoint, write-journal/undo and authority boundaries.',
  );
}

function evaluatePersistence(loaded) {
  const contract = d(loaded, 'f1', 'completion-contract.json');
  const outcomes = d(loaded, 'f1', 'persisted-outcomes.json');
  const restart = d(loaded, 'f1', 'restart-lifecycle.json');
  return criterion(
    'persistent-result',
    'Host completion outcomes persist across restart without provider landing authority.',
    ['TF-0535'],
    ['f1/completion-contract.json', 'f1/persisted-outcomes.json', 'f1/restart-lifecycle.json'],
    [
      check('completion-contract', contract.passed === true && contract.contract_version === 'clawx.versegit.completion-contract/v1' && contract.provider_semantics?.provider_landed === false && contract.boundaries?.m4_authorized === false, 'completion fact is host-owned and does not imply provider landing'),
      check('outcome-mapping', outcomes.passed === true && outcomes.outcomes?.applied?.provider_projection === 'host-completed' && outcomes.outcomes?.cancelled?.provider_projection === 'abandoned' && outcomes.outcomes?.unknown?.recovery_required === true, 'applied, not-applied and unknown map explicitly'),
      check('persistence-negatives', outcomes.duplicate?.status === 'duplicate' && outcomes.late_epoch?.reason === 'late_epoch' && outcomes.terminal_completion?.reason === 'completion_terminal' && outcomes.legacy?.success?.legacyUnbound === true, 'duplicate, late epoch, terminal and legacy negatives are retained'),
      check('restart-replay', restart.passed === true && restart.restart_matched === true && restart.persisted_fact_id === restart.restarted_fact_id && restart.implicit_recovery?.status === 'rejected', 'restart reads the same fact and refuses implicit recovery'),
      check('explicit-recovery', restart.explicit_recovery?.host_outcome === 'applied' && restart.explicit_recovery?.provider_landed === false && restart.provider_landed === false && restart.active_risk_after_restart === false, 'explicit recovery remains host-bounded with no active risk'),
    ],
    'Replays F1 completion mapping, duplicate/epoch negatives and restart persistence.',
  );
}

function evaluateCleanup(loaded) {
  const barrier = d(loaded, 'f2', 'cleanup-barrier.json');
  const recovery = d(loaded, 'f2', 'recovery-required.json');
  const inventory = d(loaded, 'f2', 'resource-inventory.json');
  const f4 = d(loaded, 'f4', 'resource-survivors.json');
  const inventoryCases = inventory.cases ?? [];
  return criterion(
    'cleanup',
    'Cleanup seals evidence, verifies identity and deletes only observed zero-survivor resources.',
    ['TF-0536', 'TF-0538'],
    ['f2/cleanup-barrier.json', 'f2/recovery-required.json', 'f2/resource-inventory.json', 'f4/resource-survivors.json'],
    [
      check('barrier-order', barrier.passed === true && barrier.protocol?.stages?.join(',') === 'stop_accepting,drain_cancel,seal_evidence,detach_vg,verify_owner_epoch_ref,delete_disposable', 'single barrier order is exact'),
      check('barrier-negatives', barrier.protocol?.lateEventsRejectedAfterSeal === true && barrier.protocol?.unknownInventoryNeverClaimsZero === true && barrier.protocol?.restartReadsDurableRecord === true, 'late events, unknown inventory and restart are fail-closed'),
      check('recovery-cases', recovery.passed === true && recovery.cases?.length >= 10 && recovery.cases.some((item) => item.status === 'recovery_required') && recovery.cases.some((item) => item.case === 'late_event_after_delete' && item.sealStable === true), 'identity/stage/survivor/late-event negatives preserve recovery semantics'),
      check('normal-cleanup-zero', inventory.passed === true && inventory.observedOn === 'win32' && inventoryCases.length === 3 && inventoryCases.every((item) => item.zeroSurvivors === true && item.inventoryAfter?.observed === true && item.inventoryAfter?.processes === 0 && item.inventoryAfter?.managers === 0 && item.inventoryAfter?.worktrees === 0 && item.inventoryAfter?.tempRoots === 0), 'normal/failure/continuation inventories observe zero survivors'),
      check('survivor-not-hidden', inventory.negative?.rejected === true && inventory.negative?.worktreeSurvived === true, 'one survivor remains rejected rather than being reported as zero'),
      check('f4-survivors-zero', f4.passed === true && f4.observed === true && f4.loops?.length === 10 && Object.values(f4.totals ?? {}).every((value) => value === 0) && f4.loops.every((item) => item.cleanupObserved === true), 'ten packaged folds leave no process/manager/worktree/temp survivor'),
    ],
    'Replays F2 barrier/recovery/inventory cases and F4 ten-loop survivor totals.',
  );
}

function deepEqual(left, right) {
  return stableText(left) === stableText(right);
}

function evaluatePackage(root, loaded) {
  const evidence = d(loaded, 'f3', 'sidecar-package-manifest.json');
  const build = d(loaded, 'f3', 'build-provenance.json');
  const negative = d(loaded, 'f3', 'package-negative.json');
  const pkg = evidence.package ?? {};
  const actualManifestPath = 'resources/versegit/manifest.json';
  const actualManifest = existsSync(resolve(root, actualManifestPath)) ? readJson(root, actualManifestPath) : null;
  const licensePath = pkg.license?.path;
  const licenseHash = licensePath && existsSync(resolve(root, licensePath)) ? hashFile(root, licensePath) : null;
  const artifactPath = pkg.artifact?.devPath;
  const artifactPresent = Boolean(artifactPath && existsSync(resolve(root, artifactPath)));
  const artifactHash = artifactPresent ? hashFile(root, artifactPath) : null;
  const artifactBytes = artifactPresent ? statSync(resolve(root, artifactPath)).size : null;
  return criterion(
    'package',
    'A digest-pinned M1 Windows sidecar package is consumed without provider-source or authority copying.',
    ['TF-0537'],
    ['f3/sidecar-package-manifest.json', 'f3/build-provenance.json', 'f3/package-negative.json'],
    [
      check('manifest-verified', evidence.verified?.ok === true && pkg.schema === 'clawx.versegit.sidecar-package/v1' && evidence.packageDigest && pkg.packageId, 'package manifest is schema-valid and digest-pinned'),
      check('artifact-identity', pkg.artifact?.sha256 === '6b8330354da59118274bdbbf2bfa210b66612e42924dcb2fd02f29882b0d85ea' && pkg.artifact?.bytes === 41011712 && pkg.artifact?.version === 'vg 0.1.0' && pkg.artifact?.platform === 'win32' && pkg.artifact?.arch === 'x64', 'artifact identity matches the retained F3 package'),
      check('targets-and-profile', deepEqual(pkg.profiles, ['M1']) && deepEqual(pkg.retention?.supportedTargets, ['win32-x64']) && pkg.retention?.codeCopied === false && pkg.retention?.gitDirectoryCopied === false && pkg.retention?.taskForestCopied === false && pkg.retention?.privateEvidenceCopied === false, 'only win32-x64/M1 is claimed and no source/history data is copied'),
      check('license', pkg.license?.spdx === 'Apache-2.0' && pkg.license?.sha256 === licenseHash, 'license path and digest replay'),
      check('double-build-honest', build.builds?.length === 2 && build.byteIdentical === false && build.semanticIdentityEqual === true && build.reproducibility?.claimable === false && build.reproducibility?.status === 'semantic-identity-only', 'semantic identity is claimed without byte-identical reproducibility'),
      check('negative-package-cases', negative.passed === true && Array.isArray(negative.cases) && negative.cases.length >= 4 && negative.cases.every((item) => item.rejected === true), 'artifact/schema/profile/platform negatives are rejected'),
      check('tracked-manifest-parity', actualManifest ? deepEqual(actualManifest, pkg) : false, 'represented package equals the tracked resource manifest'),
      check('artifact-on-disk', artifactPresent ? artifactHash === pkg.artifact?.sha256 && artifactBytes === pkg.artifact?.bytes : true, artifactPresent ? 'ignored build artifact hash/size match' : 'ignored build artifact is absent; curated F3 manifest is the clean-checkout source'),
    ],
    'Replays F3 package manifest/provenance/negative cases and tracked manifest/license identity; ignored binary is hashed when present.',
  );
}

function nearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

export function recomputeStability(samples) {
  const durations = samples.map((item) => item.durationMs);
  const rssKb = samples.map((item) => item.peakRssKb);
  return {
    sampleCount: samples.length,
    successes: samples.filter((item) => item.passed && item.exitCode === 0).length,
    failures: samples.filter((item) => !item.passed || item.exitCode !== 0).length,
    failureRate: samples.length === 0 ? 1 : samples.filter((item) => !item.passed || item.exitCode !== 0).length / samples.length,
    p50LoopMs: nearestRank(durations, 0.5),
    p95LoopMs: nearestRank(durations, 0.95),
    peakRssMb: rssKb.length === 0 ? 0 : Math.max(...rssKb) / 1024,
    duplicateApplyCount: samples.reduce((sum, item) => sum + (item.duplicateApplyCount ?? 0), 0),
    uniqueCandidateCount: new Set(samples.map((item) => item.candidateId)).size,
    survivors: {
      processes: samples.reduce((sum, item) => sum + (item.processSurvivors ?? 0), 0),
      managers: samples.reduce((sum, item) => sum + (item.managerSurvivors ?? 0), 0),
      worktrees: samples.reduce((sum, item) => sum + (item.worktreeSurvivors ?? 0), 0),
      tempRoots: samples.reduce((sum, item) => sum + (item.tempSurvivors ?? 0), 0),
    },
  };
}

function evaluateStability(loaded) {
  const flow = d(loaded, 'f4', 'packaged-flow.json');
  const report = d(loaded, 'f4', 'stability-report.json');
  const samples = d(loaded, 'f4', 'stability-samples.jsonl');
  const survivors = d(loaded, 'f4', 'resource-survivors.json');
  const recomputed = recomputeStability(samples);
  const aggregate = report.aggregate ?? {};
  return criterion(
    'bounded-stability',
    'The packaged Windows loop is bounded and raw stability metrics recompute from samples.',
    ['TF-0538'],
    ['f4/packaged-flow.json', 'f4/stability-report.json', 'f4/stability-samples.jsonl', 'f4/resource-survivors.json'],
    [
      check('cold-starts', flow.passed === true && flow.coldStarts?.length === 3 && flow.coldStarts.every((item) => item.binarySha256 === flow.package?.artifactSha256 && item.hostInvokeOk === true), 'three cold starts use the same package identity'),
      check('ten-unique-loops', recomputed.sampleCount === 10 && recomputed.successes === 10 && recomputed.failures === 0 && recomputed.uniqueCandidateCount === 10 && samples.every((item) => item.combinedFailurePassed === true && item.combinedSuccessPassed === true && item.orderingPassed === true), 'ten unique candidate/tool/receipt/apply loops pass'),
      check('raw-metrics', aggregate.sampleCount === recomputed.sampleCount && aggregate.successes === recomputed.successes && aggregate.failures === recomputed.failures && aggregate.failureRate === recomputed.failureRate && aggregate.p50LoopMs === recomputed.p50LoopMs && aggregate.p95LoopMs === recomputed.p95LoopMs && aggregate.peakRssMb === recomputed.peakRssMb && aggregate.duplicateApplyCount === recomputed.duplicateApplyCount && deepEqual(aggregate.survivors, recomputed.survivors), 'P50/P95/RSS/failure/duplicate/survivor values recompute exactly'),
      check('budgets', report.budgets?.completeLoops === 10 && recomputed.p95LoopMs <= report.budgets?.maxP95LoopMs && recomputed.peakRssMb <= report.budgets?.maxPeakRssMb && recomputed.failureRate <= report.budgets?.maxFailureRate && recomputed.duplicateApplyCount <= report.budgets?.maxDuplicateApplyCount, 'frozen budgets are satisfied'),
      check('restart-revocation-undo', flow.restartRecovery === true && flow.activeInterruptionCleanup === true && flow.revokedGrantRejected === true && flow.undoRecovered === true && samples.every((item) => item.revokedGrantRejected === true && item.undoRecovered === true), 'restart, interruption, revocation and undo are observed in every retained axis'),
      check('scope-explicit', deepEqual(report.coverage?.observedPlatforms, ['win32-x64']) && deepEqual(report.coverage?.observedModes, ['M1']) && report.coverage?.realRendererHost === true && report.coverage?.actualRuntimeToolReceiptApply === true && report.coverage?.unmeasured?.length >= 3, 'platform, mode and unmeasured model/language scope are explicit'),
      check('resource-zero', survivors.passed === true && survivors.observed === true && Object.values(survivors.totals ?? {}).every((value) => value === 0) && deepEqual(recomputed.survivors, survivors.totals), 'sample survivor totals equal the resource inventory'),
    ],
    'Recomputes F4 sample count, P50/P95, peak RSS, failure/duplicate/survivor counts and checks frozen budgets.',
  );
}

function evaluateDocs(root) {
  const readmes = Object.fromEntries(F5_README_PATHS.map((path) => [path, readText(root, path)]));
  const semantics = readText(root, F5_PRODUCT_SEMANTICS_PATH);
  const manifest = readText(root, F5_MANIFEST_PATH);
  const validationDoc = readText(root, F5_DOCS_PATH);
  const autocloseRule = readText(root, F5_AUTOCLOSE_RULE_PATH);
  const disposition = readText(root, 'shared/dcs/component-disposition-catalog.ts');
  const capabilityClaims = readText(root, 'shared/capability-claims.ts');
  const surfaceStart = manifest.indexOf('export const PRODUCT_SURFACE_AUTHORITY_LINKS');
  const surfaceEnd = manifest.indexOf('export const DEFAULT_MATRIX_AUTHORITY_LINKS', surfaceStart);
  const surfaceBlock = surfaceStart >= 0 && surfaceEnd > surfaceStart ? manifest.slice(surfaceStart, surfaceEnd) : '';
  const fpStart = semantics.indexOf('<!-- FP-P1-08-COMPONENT-STATUS-START -->');
  const fpEnd = semantics.indexOf('<!-- FP-P1-08-COMPONENT-STATUS-END -->');
  const fpSection = fpStart >= 0 && fpEnd > fpStart ? semantics.slice(fpStart, fpEnd) : '';
  const fpRows = fpSection.split(/\r?\n/u).filter((line) => /^\| [^|-].*\| `[^`]+` \|/u.test(line));
  const readmeChecks = F5_README_PATHS.map((path) => check(
    `readme-${path}`,
    README_CLAIMS[path].every((token) => readmes[path].includes(token)) && readmes[path].includes(F5_DOCS_PATH) && !/\bGA\b/u.test(readmes[path]),
    `${path} carries the bounded product claim, avoids the GA token on the product surface, and links the VG validation layer`,
  ));
  const requiredOwners = ['coding-execution-backend', 'verseshell-execution-adapter', 'permission-approval-authority', 'task-ledger', 'observability-recorder'];
  return criterion(
    'docs-capability-authority',
    'Three-language READMEs, controlled-preview lock, host authority links and model-facing capability posture agree.',
    [F5_TASK],
    [F5_DOCS_PATH, F5_PRODUCT_SEMANTICS_PATH, F5_MANIFEST_PATH, ...F5_README_PATHS, F5_AUTOCLOSE_RULE_PATH],
    [
      ...readmeChecks,
      check('controlled-preview-lock', fpRows.length === 10 && !fpSection.includes('VerseGit'), 'VG remains outside the frozen 10-component controlled-preview table'),
      check('host-authority-owners', !surfaceBlock.includes('VerseGit') && requiredOwners.every((owner) => manifest.includes(`id: '${owner}'`)), 'VG is not added to the controlled-preview surface map; host authority remains owned by existing ClawX components'),
      check('model-facing-internal', !/versegit|concurrency-aux/iu.test(disposition) && !/versegit|concurrency-aux/iu.test(capabilityClaims), 'VG remains an internal host sidecar rather than a broad user-visible model capability claim'),
      check('validation-doc', validationDoc.includes(F5_REPORT_PATH) && validationDoc.includes('P0=0') && validationDoc.includes('P1=0') && validationDoc.includes('P2') && validationDoc.includes('win32-x64') && validationDoc.includes('M1'), 'validation README links the F5 report and carries exact verdict/scope'),
      check('task-forest-gate', autocloseRule.includes('base_graph_hash') && autocloseRule.includes('proposal-apply --yes') && autocloseRule.includes('validate') && autocloseRule.includes('export'), 'Task Forest closure remains hash-gated with proposal-apply/validate/export'),
    ],
    'Scans READMEs, controlled-preview lock, host authority/manifest and Task Forest closeout rule for current claim agreement.',
  );
}
export function buildAcceptanceState({ root = repositoryRoot, sourceCommit } = {}) {
  const head = String(git(root, ['rev-parse', 'HEAD'])).trim();
  const evidenceCommit = sourceCommit ?? head;
  const tree = String(git(root, ['rev-parse', `${evidenceCommit}^{tree}`])).trim();
  const branch = String(git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const statusText = String(git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).replace(/\r?\n$/u, '');
  const status = (statusText ? statusText.split(/\r?\n/u) : [])
    .filter((line) => !line.slice(3).split(' -> ').at(-1).startsWith(`${F5_EVIDENCE_ROOT}/`));
  const sourceIssues = status.map((line) => `source worktree is dirty outside F5 evidence: ${line}`);
  const inputs = [];
  for (const path of [...new Set(F5_SOURCE_INPUTS)].sort()) {
    if (!existsSync(resolve(root, path))) {
      sourceIssues.push(`source input missing: ${path}`);
      continue;
    }
    const working = readFileSync(resolve(root, path));
    let committed;
    try {
      committed = git(root, ['show', `${evidenceCommit}:${path}`], null);
    } catch {
      sourceIssues.push(`source input is not committed at evidence source ${evidenceCommit}: ${path}`);
      continue;
    }
    if (!Buffer.from(committed).equals(working)) sourceIssues.push(`source input differs from evidence source ${evidenceCommit}: ${path}`);
    inputs.push({ path, sha256: sha256(working), bytes: working.length });
  }
  const sourceInputDigest = sha256(Buffer.from(inputs.map((item) => `${item.sha256}  ${item.path}`).join('\n'), 'utf8'));
  const packageEvidence = readJson(root, 'harness/specs/fixtures/versegit-product-integration/f3/sidecar-package-manifest.json');
  const candidateId = sha256(`clawx.versegit.product-f5-candidate/v1\n${sourceInputDigest}\n${packageEvidence.package?.packageId}\n${packageEvidence.package?.artifact?.sha256}`);
  const evidence = verifyEvidenceGroups({ root });
  if (!evidence.ok) sourceIssues.push(...evidence.issues);
  const loaded = readAllEvidence(root);
  const criteria = [
    evaluateRiskObservation(root, loaded),
    evaluateFeedback(loaded),
    evaluateCandidatePreVerification(loaded),
    evaluatePersistence(loaded),
    evaluateHostWriteback(loaded),
    evaluateCleanup(loaded),
    evaluatePackage(root, loaded),
    evaluateStability(loaded),
    evaluateDocs(root),
  ];
  if (!isAncestor(root, evidenceCommit, head)) sourceIssues.push(`evidence source ${evidenceCommit} is not an ancestor of current HEAD`);
  const source = { branch, commit: evidenceCommit, tree, dirty: status.length > 0 };
  const candidate = {
    id: candidateId,
    sourceInputDigest,
    inputs,
    packageId: packageEvidence.package?.packageId,
    artifactSha256: packageEvidence.package?.artifact?.sha256,
    capabilitiesSha256: packageEvidence.package?.provider?.capabilitiesSha256,
  };
  return {
    schema: F5_SCHEMA,
    task: F5_TASK,
    parentTask: F5_PARENT_TASK,
    driven_by: 'agent',
    actor: F5_ACTOR,
    source,
    candidate,
    evidence,
    criteria,
    residuals: F5_RESIDUALS,
    sourceIssues,
    ok: sourceIssues.length === 0 && evidence.ok && criteria.every((item) => item.status === 'passed'),
  };
}

function indexProjection(state) {
  return {
    schema: F5_INDEX_SCHEMA,
    task: F5_TASK,
    parentTask: F5_PARENT_TASK,
    driven_by: 'agent',
    actor: F5_ACTOR,
    source: state.source,
    candidate: state.candidate,
    evidenceGroups: state.evidence.groups,
    evidenceFileCount: state.evidence.evidenceFileCount,
    criteria: state.criteria,
    residuals: state.residuals,
    passed: state.ok,
  };
}

export function buildCriterionIndex(state, generatedAt) {
  const index = { ...indexProjection(state), generated_at: generatedAt };
  index.digest = documentDigest(index);
  return index;
}

function jsonText(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function writeJson(root, path, document) {
  const full = resolve(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, jsonText(document), 'utf8');
}

function writeShaManifest(root, path, entries) {
  const lines = [...new Set(entries)].sort().map((entry) => `${hashFile(root, entry)}  ${entry}`);
  writeFileSync(resolve(root, path), `${lines.join('\n')}\n`, 'utf8');
}

function validateVerdict(root, verdict, state, index) {
  const issues = [];
  if (verdict.schema !== F5_VERDICT_SCHEMA) issues.push('independent verdict schema mismatch');
  if (verdict.digest !== documentDigest(verdict)) issues.push('independent verdict digest mismatch');
  if (verdict.driven_by !== 'agent' || verdict.actor !== F5_ACTOR) issues.push('independent verdict actor mismatch');
  if (verdict.verdict !== 'pass') issues.push('independent verdict is not pass');
  if (verdict.priority?.p0 !== 0 || verdict.priority?.p1 !== 0) issues.push('independent verdict has P0/P1 findings');
  if (!Array.isArray(verdict.residuals) || verdict.residuals.length !== F5_RESIDUALS.length) issues.push('independent verdict residual count mismatch');
  if (verdict.indexDigest !== index.digest) issues.push('independent verdict index digest mismatch');
  if (verdict.candidateId !== state.candidate.id) issues.push('independent verdict candidate mismatch');
  if (verdict.source?.commit !== state.source.commit || verdict.source?.tree !== state.source.tree) issues.push('independent verdict source mismatch');
  if (!verdict.criteria?.every((item) => item.status === 'passed')) issues.push('independent verdict criteria are not all passed');
  return issues;
}

function makeVerdict(state, index) {
  const verdict = {
    schema: F5_VERDICT_SCHEMA,
    generated_at: new Date().toISOString(),
    task: F5_TASK,
    parentTask: F5_PARENT_TASK,
    driven_by: 'agent',
    actor: F5_ACTOR,
    reviewer_role: 'independent-product-f5-verifier-process',
    verdict: state.ok ? 'pass' : 'fail',
    priority: { p0: state.ok ? 0 : 1, p1: 0, p2: F5_RESIDUALS.length },
    source: state.source,
    candidateId: state.candidate.id,
    indexDigest: index.digest,
    evidence: {
      groups: state.evidence.groups.length,
      files: state.evidence.evidenceFileCount,
      shaManifests: state.evidence.groups.length,
      independentReviews: state.evidence.groups.filter((group) => group.review.status === 'passed' || group.review.status === 'pass').length,
    },
    criteria: state.criteria.map((item) => ({ id: item.id, status: item.status, checks: item.checks.length })),
    residuals: F5_RESIDUALS,
    boundaries: {
      defaultOff: true,
      liveReady: false,
      productApproved: false,
      ga: false,
      m4Authorized: false,
      hostAuthority: 'ClawX',
      vgLandingAuthority: false,
      realHumanEvidence: false,
    },
    taskForestCloseoutEligible: state.ok,
    issues: state.ok ? [] : [...state.sourceIssues, ...state.criteria.filter((item) => item.status !== 'passed').map((item) => `${item.id}: failed`)],
    recomputed: true,
  };
  verdict.digest = documentDigest(verdict);
  return verdict;
}

function acceptanceItems(state, verdict) {
  return [
    {
      id: 'AC1',
      status: state.criteria.slice(0, 8).every((item) => item.status === 'passed') ? 'passed' : 'failed',
      scope: 'risk observation, agent feedback, candidate pre-verification, host writeback, persistent result, cleanup, package and bounded stability',
      criteria: state.criteria.slice(0, 8).map((item) => item.id),
    },
    {
      id: 'AC2',
      status: verdict.priority?.p0 === 0 && verdict.priority?.p1 === 0 && verdict.residuals?.length === F5_RESIDUALS.length ? 'passed' : 'failed',
      scope: 'independent current-candidate verdict with explicit remaining P2 residuals',
      p0: verdict.priority?.p0,
      p1: verdict.priority?.p1,
      p2: verdict.priority?.p2,
    },
    {
      id: 'AC3',
      status: state.criteria.find((item) => item.id === 'docs-capability-authority')?.status === 'passed' ? 'passed' : 'failed',
      scope: 'three-language README, product/model capability and Task Forest hash-gated closure rule',
      taskForestClosure: {
        eligible: verdict.taskForestCloseoutEligible === true,
        baseGraphHashRequired: true,
        proposalApplyRequired: true,
        validateExportRequired: true,
        performedBy: F5_TASK,
      },
    },
  ];
}

function normalizeCommands(input, root) {
  if (!input) return [];
  const document = JSON.parse(readText(root, input));
  if (!Array.isArray(document)) throw new Error('command results must be a JSON array');
  return document.map((item) => {
    if (typeof item.command !== 'string' || !Number.isInteger(item.exitCode)) throw new Error('each command result needs command and integer exitCode');
    return {
      id: item.id ?? item.command,
      command: item.command,
      exitCode: item.exitCode,
      durationMs: Number(item.durationMs ?? 0),
      counts: item.counts ?? null,
      summary: String(item.summary ?? ''),
    };
  });
}

export function buildGlobalReport(state, verdict, commands = [], generatedAt = new Date().toISOString()) {
  const acceptance = acceptanceItems(state, verdict);
  const report = {
    schema: F5_SCHEMA,
    generated_at: generatedAt,
    task: F5_TASK,
    parentTask: F5_PARENT_TASK,
    driven_by: 'agent',
    actor: F5_ACTOR,
    status: state.ok && acceptance.every((item) => item.status === 'passed') && validateVerdict(repositoryRoot, verdict, state, { digest: verdict.indexDigest }).length === 0 ? 'passed' : 'failed',
    passed: state.ok,
    source: state.source,
    candidate: state.candidate,
    acceptance,
    criteria: state.criteria.map((item) => ({
      id: item.id,
      status: item.status,
      tasks: item.taskIds,
      checks: item.checks.length,
      evidence: item.evidence,
      recompute: item.recompute,
    })),
    evidence: {
      groups: state.evidence.groups.length,
      files: state.evidence.evidenceFileCount,
      shaManifests: state.evidence.groups.length,
      independentReviews: state.evidence.groups.filter((group) => group.review.status === 'passed' || group.review.status === 'pass').length,
      oldestTask: 'TF-0524',
      newestTask: 'TF-0538',
    },
    independentReview: {
      path: F5_VERDICT_PATH,
      digest: verdict.digest,
      actor: verdict.actor,
      reviewerRole: verdict.reviewer_role,
      verdict: verdict.verdict,
      p0: verdict.priority?.p0,
      p1: verdict.priority?.p1,
      p2: verdict.priority?.p2,
      indexDigest: verdict.indexDigest,
      recomputed: verdict.recomputed === true,
    },
    posture: {
      optIn: true,
      defaultOff: true,
      nonGa: true,
      liveReady: false,
      productApproved: false,
      ga: false,
      m4Authorized: false,
      hostAuthority: 'ClawX',
      hostOwns: ['executor', 'task', 'orchestration', 'approval', 'write-journal', 'Git-apply'],
      vgLandingAuthority: false,
      providerLandAdmitAuthority: false,
      modelFacingUserCapability: false,
      realHumanEvidence: false,
    },
    scope: {
      observedPlatforms: ['win32-x64'],
      observedModes: ['M1'],
      closedLoops: 10,
      coldStarts: 3,
      fixtureLanguagesOnly: true,
      externalModelQualityMeasured: false,
      releaseEligible: false,
    },
    residuals: F5_RESIDUALS,
    commands,
    failures: state.ok ? [] : [...state.sourceIssues, ...state.criteria.filter((item) => item.status !== 'passed').map((item) => `${item.id}: failed`)],
    unmeasured: F5_RESIDUALS.map((item) => item.summary),
    taskForest: {
      task: F5_TASK,
      parent: F5_PARENT_TASK,
      closeoutEligible: state.ok && acceptance.every((item) => item.status === 'passed'),
      closurePerformed: false,
      baseGraphHashRequired: true,
      proposalApplyRequired: true,
      validateExportRequired: true,
    },
    digest: undefined,
  };
  report.digest = documentDigest(report);
  return report;
}

function validateCommands(root, report) {
  const issues = [];
  const byCommand = new Map((report.commands ?? []).map((entry) => [entry.command, entry]));
  for (const required of F5_REQUIRED_COMMANDS) {
    const found = byCommand.get(required.command);
    if (!found) issues.push(`required command not recorded: ${required.command}`);
    else if (found.exitCode !== 0) issues.push(`required command failed: ${required.command} (exit ${found.exitCode})`);
  }
  return issues;
}

export function validateStoredArtifacts({ root = repositoryRoot } = {}) {
  const issues = [];
  for (const path of [F5_REPORT_PATH, F5_INDEX_PATH, F5_VERDICT_PATH, F5_SHA_PATH]) {
    if (!existsSync(resolve(root, path))) issues.push(`missing F5 artifact: ${path}`);
  }
  if (issues.length > 0) return { ok: false, issues };
  const shaIssues = verifyShaManifest({ root, path: F5_SHA_PATH });
  issues.push(...shaIssues.issues);
  const report = readJson(root, F5_REPORT_PATH);
  const index = readJson(root, F5_INDEX_PATH);
  const verdict = readJson(root, F5_VERDICT_PATH);
  if (report.digest !== documentDigest(report)) issues.push('global report digest mismatch');
  if (index.digest !== documentDigest(index)) issues.push('criterion index digest mismatch');
  if (verdict.digest !== documentDigest(verdict)) issues.push('independent verdict digest mismatch');
  const state = buildAcceptanceState({ root, sourceCommit: index.source?.commit });
  issues.push(...state.sourceIssues);
  if (!state.ok) issues.push(...state.criteria.filter((item) => item.status !== 'passed').map((item) => `live criterion failed: ${item.id}`));
  if (index.candidate?.id !== state.candidate.id) issues.push('criterion index candidate differs from live source inputs');
  if (report.candidate?.id !== state.candidate.id) issues.push('global report candidate differs from live source inputs');
  if (index.source?.commit !== report.source?.commit || index.source?.tree !== report.source?.tree) issues.push('index/report source binding mismatch');
  const liveCriteria = state.criteria.map((item) => ({ id: item.id, status: item.status, checks: item.checks, evidence: item.evidence, tasks: item.taskIds }));
  const storedCriteria = index.criteria.map((item) => ({ id: item.id, status: item.status, checks: item.checks, evidence: item.evidence, tasks: item.taskIds }));
  if (!deepEqual(liveCriteria, storedCriteria)) issues.push('criterion evidence index diverges from live replay');
  issues.push(...validateVerdict(root, verdict, state, index));
  if (report.status !== 'passed') issues.push('global report status is not passed');
  issues.push(...validateCommands(root, report));
  if (report.independentReview?.digest !== verdict.digest) issues.push('global report independent-review digest mismatch');
  if (report.taskForest?.closeoutEligible !== true || report.taskForest?.closurePerformed !== false) issues.push('Task Forest closeout preconditions drifted');
  return { ok: issues.length === 0, issues, report, index, verdict, state };
}

function writeSeal(root) {
  writeShaManifest(root, F5_SHA_PATH, [F5_REPORT_PATH, F5_INDEX_PATH, F5_VERDICT_PATH]);
}

function runReviewWorker(root, indexPath) {
  const index = readJson(root, indexPath);
  const state = buildAcceptanceState({ root, sourceCommit: index.source?.commit });
  if (!state.ok) throw new Error(`review candidate is not passing: ${[...state.sourceIssues, ...state.criteria.filter((item) => item.status !== 'passed').map((item) => item.id)].join(', ')}`);
  if (index.candidate?.id !== state.candidate.id) throw new Error('review index candidate differs from recomputed candidate');
  const liveProjection = { ...indexProjection(state), generated_at: index.generated_at };
  liveProjection.digest = documentDigest(liveProjection);
  if (liveProjection.digest !== index.digest) throw new Error('review index digest differs from independent recomputation');
  const verdict = makeVerdict(state, index);
  writeJson(root, F5_VERDICT_PATH, verdict);
  return verdict;
}

function writeArtifacts({ root, commandResults }) {
  const state = buildAcceptanceState({ root });
  if (!state.ok) {
    const failures = [...state.sourceIssues, ...state.criteria.filter((item) => item.status !== 'passed').map((item) => `${item.id}: ${item.checks.filter((checkItem) => !checkItem.passed).map((checkItem) => checkItem.id).join(',')}`)];
    throw new Error(`F5 candidate is not acceptable:\n${failures.join('\n')}`);
  }
  const generatedAt = new Date().toISOString();
  const index = buildCriterionIndex(state, generatedAt);
  writeJson(root, F5_INDEX_PATH, index);
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--review-worker', '--index', F5_INDEX_PATH], {
    cwd: root,
    encoding: 'utf8',
  });
  if (child.status !== 0) throw new Error(`independent review process failed:\n${child.stdout}\n${child.stderr}`);
  const verdict = readJson(root, F5_VERDICT_PATH);
  const verdictIssues = validateVerdict(root, verdict, state, index);
  if (verdictIssues.length > 0) throw new Error(`independent verdict rejected: ${verdictIssues.join('; ')}`);
  const commands = [
    {
      id: 'write',
      command: 'node scripts/verify-versegit-product-integration.mjs --write',
      exitCode: 0,
      durationMs: 0,
      counts: { criteria: state.criteria.length, evidenceGroups: state.evidence.groups.length, evidenceFiles: state.evidence.evidenceFileCount },
      summary: 'generated index, independent verdict and global report',
    },
    ...normalizeCommands(commandResults, root),
  ];
  const report = buildGlobalReport(state, verdict, commands, generatedAt);
  writeJson(root, F5_REPORT_PATH, report);
  writeSeal(root);
  return { state, index, verdict, report };
}

function finalizeArtifacts({ root, commandResults }) {
  if (!existsSync(resolve(root, F5_INDEX_PATH)) || !existsSync(resolve(root, F5_VERDICT_PATH))) {
    throw new Error('F5 index/verdict must exist before finalize');
  }
  const index = readJson(root, F5_INDEX_PATH);
  const verdict = readJson(root, F5_VERDICT_PATH);
  const state = buildAcceptanceState({ root, sourceCommit: index.source?.commit });
  const issues = validateVerdict(root, verdict, state, index);
  if (state.candidate.id !== index.candidate?.id) issues.push('finalize candidate differs from index');
  if (!state.ok) issues.push(...state.sourceIssues, ...state.criteria.filter((item) => item.status !== 'passed').map((item) => `live criterion failed: ${item.id}`));
  if (issues.length > 0) throw new Error(`F5 finalize rejected: ${issues.join('; ')}`);
  const commands = [
    {
      id: 'write',
      command: 'node scripts/verify-versegit-product-integration.mjs --write',
      exitCode: 0,
      durationMs: 0,
      counts: { criteria: state.criteria.length, evidenceGroups: state.evidence.groups.length, evidenceFiles: state.evidence.evidenceFileCount },
      summary: 'generated index, independent verdict and global report',
    },
    ...normalizeCommands(commandResults, root),
    {
      id: 'finalize',
      command: 'node scripts/verify-versegit-product-integration.mjs --finalize',
      exitCode: 0,
      durationMs: 0,
      counts: null,
      summary: 'sealed recorded required-command results into the global report',
    },
  ];
  const report = buildGlobalReport(state, verdict, commands, new Date().toISOString());
  const commandIssues = validateCommands(root, report);
  if (commandIssues.length > 0) throw new Error(`F5 required commands are incomplete: ${commandIssues.join('; ')}`);
  writeJson(root, F5_REPORT_PATH, report);
  writeSeal(root);
  return { state, index, verdict, report };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const root = repositoryRoot;
  if (process.argv.includes('--review-worker')) {
    const indexPath = option('--index') ?? F5_INDEX_PATH;
    runReviewWorker(root, indexPath);
    console.log('[versegit-product-f5] independent review worker OK');
    return;
  }
  if (process.argv.includes('--write')) {
    const written = writeArtifacts({ root, commandResults: option('--command-results') });
    console.log(`[versegit-product-f5] WRITE OK criteria=${written.state.criteria.length} groups=${written.state.evidence.groups.length} files=${written.state.evidence.evidenceFileCount} p2=${written.verdict.priority.p2}`);
    return;
  }
  if (process.argv.includes('--finalize')) {
    const commandResults = option('--command-results');
    if (!commandResults) throw new Error('--finalize requires --command-results');
    const finalized = finalizeArtifacts({ root, commandResults });
    console.log(`[versegit-product-f5] FINALIZE OK criteria=${finalized.state.criteria.length} groups=${finalized.state.evidence.groups.length} files=${finalized.state.evidence.evidenceFileCount} p2=${finalized.verdict.priority.p2}`);
    return;
  }
  const result = validateStoredArtifacts({ root });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-product-f5] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-product-f5] OK verdict=${result.report.status} criteria=${result.state.criteria.length} groups=${result.state.evidence.groups.length} files=${result.state.evidence.evidenceFileCount} p0=${result.verdict.priority.p0} p1=${result.verdict.priority.p1} p2=${result.verdict.priority.p2}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[versegit-product-f5] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
