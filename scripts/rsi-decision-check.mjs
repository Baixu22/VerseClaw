#!/usr/bin/env node
/**
 * Reproducible readback for the six RSI decisions (D1..D6) and their
 * implementation acceptance record.
 *
 * Why this exists: `decision-implementation-validation.v1.json` used to be a
 * self-declared artifact with zero readers — nothing re-checked its bound blob
 * hashes or its claims. It was already stale by two files when the audit
 * started. This script turns it into a gate.
 *
 * Rules:
 * - The decisions file is the single source of truth for the six choices.
 * - The acceptance record must agree with it.
 * - Policy v2, the annotated corpus and the curated historical run must still
 *   satisfy the chosen options.
 * - Every bound blob is hashed against disk. Files declared in
 *   `source.nonJudgedInputs` are reported as warnings, never as failures:
 *   repository registries and README documentation are legitimately edited by
 *   unrelated tasks, while RSI code, fixtures and rules remain hard failures.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The checker owns coverage; the mutable acceptance record cannot omit a
// judged source or relabel it as non-judged to bypass verification.
const NON_JUDGED_PATHS = [
  '.gitignore',
  'README.ja-JP.md',
  'README.md',
  'README.zh-CN.md',
  'scripts/repository-artifacts.json',
];
const REQUIRED_BOUND_PATHS = [
  '.gitignore',
  'README.ja-JP.md',
  'README.md',
  'README.zh-CN.md',
  'docs/dev/rsi-capability-and-boundaries.md',
  'docs/dev/rsi-decision-implementation.md',
  'harness/specs/fixtures/agent-first-framework/loop-validation-report.json',
  'harness/specs/fixtures/rsi-coding-cohort/instruments/measurement-archive-v3/SHA256SUMS',
  'harness/specs/fixtures/rsi-coding-cohort/instruments/measurement-archive-v3/verification.v2.json',
  'harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/decisions.20261101.json',
  'harness/specs/fixtures/rsi-evidence-loop/evidence-identities.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/SHA256SUMS',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/aggregate.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/corpus.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/manifest.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/progress.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/promotion-policy.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/provenance.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/raw-trials.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/run-audit.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/run-exclusions.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/verification.v1.json',
  'harness/specs/fixtures/rsi-evidence-loop/tf0604/task-corpus.v1.json',
  'harness/specs/rules/paired-ablation-boundary.md',
  'harness/specs/rules/reliability-aggregation-boundary.md',
  'harness/specs/tasks/rsi-decision-implementation.md',
  'harness/specs/tasks/rsi-evidence-loop-contract.md',
  'harness/specs/tasks/rsi-tf0592-statistical-adjudication.md',
  'harness/specs/tasks/rsi-tf0604-baseline-corpus.md',
  'openclaw_runtime/src/context-engine/handlers/task-loop-handler.test.ts',
  'openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts',
  'scripts/lib/evidence-binding.d.mts',
  'scripts/lib/evidence-binding.mjs',
  'scripts/lib/paired-ablation.d.mts',
  'scripts/lib/paired-ablation.mjs',
  'scripts/lib/reliability-aggregation.d.mts',
  'scripts/lib/reliability-aggregation.mjs',
  'scripts/repository-artifacts.json',
  'scripts/rsi-decision-check.mjs',
  'scripts/rsi-feedback-export.d.mts',
  'scripts/rsi-feedback-export.mjs',
  'scripts/rsi-feedback-pilot.d.mts',
  'scripts/rsi-feedback-pilot.mjs',
  'scripts/rsi-measurement-archive.d.mts',
  'scripts/rsi-measurement-archive.mjs',
  'scripts/rsi-sekb-arms.d.mts',
  'scripts/rsi-sekb-arms.mjs',
  'scripts/rsi-tf0592-statistical-adjudication.d.mts',
  'scripts/rsi-tf0592-statistical-adjudication.mjs',
  'scripts/rsi-tf0604-baseline.d.mts',
  'scripts/rsi-tf0604-baseline.mjs',
  'shared/i18n/locales/en/agents.json',
  'shared/i18n/locales/en/knowledge.json',
  'shared/i18n/locales/ja/agents.json',
  'shared/i18n/locales/ja/knowledge.json',
  'shared/i18n/locales/ru/agents.json',
  'shared/i18n/locales/ru/knowledge.json',
  'shared/i18n/locales/zh/agents.json',
  'shared/i18n/locales/zh/knowledge.json',
  'src/components/agents/RolesOrchestrationPanel.tsx',
  'src/pages/Knowledge/index.tsx',
  'tests/e2e/knowledge-hub.spec.ts',
  'tests/e2e/role-memory-panel.spec.ts',
  'tests/unit/agent-dev-ablation-verdict-guards.test.ts',
  'tests/unit/agent-dev-paired-ablation.test.ts',
  'tests/unit/agent-dev-reliability-aggregation.test.ts',
  'tests/unit/evidence-binding.test.ts',
  'tests/unit/rsi-decision-check.test.ts',
  'tests/unit/rsi-evidence-loop-contract.test.ts',
  'tests/unit/rsi-feedback-export.test.ts',
  'tests/unit/rsi-feedback-pilot.test.ts',
  'tests/unit/rsi-measurement-archive.test.ts',
  'tests/unit/rsi-sekb-arms.test.ts',
  'tests/unit/rsi-tf0592-statistical-adjudication.test.ts',
  'tests/unit/runtime-memory-paired-ablation.test.ts',
];
export const PATHS = {
  acceptance: 'harness/specs/fixtures/rsi-coding-cohort/instruments/decision-acceptance.v4.json',
  decisions: 'harness/specs/fixtures/rsi-evidence-loop/decisions.20261101.json',
  policyV2: 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json',
  corpus: 'harness/specs/fixtures/rsi-evidence-loop/tf0604/task-corpus.v1.json',
  historicalRun: 'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/aggregate.json',
};

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const error = (code, message) => ({ code, message });
const warning = (code, message) => ({ code, message });

function gitHashObject(root, path) {
  try {
    return execFileSync('git', ['hash-object', path], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function gitStatus(root) {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

/**
 * @param {any} acceptance parsed decision-implementation-validation record
 * @param {string} root repository root
 * @param {{allowDirty?: boolean, skipHashes?: boolean}} [options]
 */
export function validateDecisionAcceptance(acceptance, root = ROOT, options = {}) {
  const errors = [];
  const warnings = [];
  const originalPath = 'harness/specs/fixtures/rsi-evidence-loop/decision-implementation-validation.v1.json';
  if (acceptance?.bindingRevision !== 2 || acceptance.historicalAcceptance?.path !== originalPath
    || acceptance.historicalAcceptance?.gitBlob !== gitHashObject(root, originalPath)) {
    errors.push(error('historical-acceptance-binding', 'current readback must preserve the immutable original acceptance identity'));
  }

  if (acceptance?.schemaVersion !== 'RsiDecisionImplementationAcceptance/v1') {
    errors.push(error('schema-version', 'unexpected acceptance schema'));
  }
  if (acceptance?.driven_by !== 'agent' || typeof acceptance?.actor !== 'string' || acceptance.actor.length === 0) {
    errors.push(error('agent-label', 'acceptance must be agent-driven with a concrete actor'));
  }
  const expectedBoundaries = { driven_by: 'agent', realHuman: false, additionalProviderCalls: 0,
    completeRsiImplementation: false, liveReady: false, productApproved: false, defaultOn: false, releaseApproved: false };
  if (Object.keys(acceptance?.boundaries ?? {}).length !== Object.keys(expectedBoundaries).length
    || Object.entries(expectedBoundaries).some(([key, value]) => acceptance?.boundaries?.[key] !== value)) {
    errors.push(error('boundary', 'integration acceptance cannot authorise product, release, human or capability claims'));
  }
  if (acceptance?.boundaries?.driven_by !== 'agent') errors.push(error('boundary', 'boundaries.driven_by must be agent'));

  let decisions = null;
  try {
    decisions = readJson(root, PATHS.decisions);
  } catch {
    errors.push(error('decisions-read', `cannot read ${PATHS.decisions}`));
  }
  const expected = new Map((decisions?.decisions ?? []).map((entry) => [entry.id, entry.choice]));
  const actual = new Map((acceptance?.decisions ?? []).map((entry) => [entry.id, entry.choice]));
  if (actual.size !== 6 || acceptance?.decisions?.length !== 6) errors.push(error('decision-coverage', 'exactly six distinct decisions are required'));
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) {
    if (!expected.has(id)) errors.push(error('decision-missing', `decisions file has no ${id}`));
    if (actual.get(id) !== expected.get(id)) {
      errors.push(error('decision-mismatch', `${id}: acceptance says ${String(actual.get(id))}, decisions say ${String(expected.get(id))}`));
    }
    if (acceptance?.decisions?.find((entry) => entry.id === id)?.implemented !== true) {
      errors.push(error('decision-unimplemented', `${id} is not marked implemented`));
    }
  }

  let policy = null;
  try {
    policy = readJson(root, PATHS.policyV2);
  } catch {
    errors.push(error('policy-read', `cannot read ${PATHS.policyV2}`));
  }
  if (policy && expected.get('D1') === 'C') {
    if (policy.taskSet?.maxFlakeCases !== 1) {
      errors.push(error('d1-case-count', 'D1=C requires taskSet.maxFlakeCases = 1'));
    }
    if (policy.taskSet?.maxSafetyFlakeCases !== 0) {
      errors.push(error('d1-safety-zero', 'D1=C requires taskSet.maxSafetyFlakeCases = 0'));
    }
    if (typeof policy.taskSet?.flakeRule !== 'string' || policy.taskSet.flakeRule.length === 0) {
      errors.push(error('d1-rule-text', 'D1=C requires an explicit taskSet.flakeRule'));
    }
  }
  if (policy && expected.get('D2') === 'B') {
    const mde = policy.metrics?.minimumDetectableEffect;
    if (!mde?.meaning || !Array.isArray(mde?.requiredReporting)) {
      errors.push(error('d2-decoupling', 'D2=B requires minimumDetectableEffect.meaning and requiredReporting'));
    } else if (!mde.requiredReporting.includes('observedDetectableEffect') || !mde.requiredReporting.includes('requiredCasesApprox')) {
      errors.push(error('d2-decoupling', 'D2=B requires observedDetectableEffect and requiredCasesApprox in requiredReporting'));
    }
  }

  let corpus = null;
  try {
    corpus = readJson(root, PATHS.corpus);
  } catch {
    errors.push(error('corpus-read', `cannot read ${PATHS.corpus}`));
  }
  if (corpus && expected.get('D3') === 'A') {
    const cases = corpus.cases ?? [];
    const safety = cases.filter((entry) => entry.safetyRequired === true).length;
    const positive = cases.filter((entry) => entry.anchor === 'positive').length;
    const negative = cases.filter((entry) => entry.anchor === 'negative').length;
    const minimumSafety = policy?.taskSet?.minimumSafetyCases ?? 1;
    const minimumPositive = policy?.taskSet?.minimumPositiveAnchors ?? 1;
    const minimumNegative = policy?.taskSet?.minimumNegativeAnchors ?? 1;
    if (safety < minimumSafety) errors.push(error('d3-safety', `safety cases ${safety} < required ${minimumSafety}`));
    if (positive < minimumPositive) errors.push(error('d3-positive', `positive anchors ${positive} < required ${minimumPositive}`));
    if (negative < minimumNegative) errors.push(error('d3-negative', `negative anchors ${negative} < required ${minimumNegative}`));
    if (cases.length !== 24) errors.push(error('d3-case-count', `annotated corpus must keep the 24 task identities, saw ${cases.length}`));
  }

  if (expected.get('D4') === 'A' && !existsSync(join(root, PATHS.historicalRun))) {
    errors.push(error('d4-evidence', `curated historical run missing: ${PATHS.historicalRun}`));
  } else if (expected.get('D4') === 'A') {
    try {
      const run = readJson(root, PATHS.historicalRun);
      if (run.recordedTrials !== 144) errors.push(error('d4-evidence', `curated run records ${String(run.recordedTrials)} trials, expected 144`));
      if (run.claims?.rsiImprovement === true || run.claims?.promotionReady === true) {
        errors.push(error('d4-claim', 'curated run cannot claim benefit or promotion'));
      }
    } catch {
      errors.push(error('d4-evidence', 'curated historical run is unreadable'));
    }
  }

  const bound = acceptance?.source?.gitBlobHashes ?? {};
  const nonJudged = acceptance?.source?.nonJudgedInputs ?? {};
  const hashDrift = [];
  for (const path of REQUIRED_BOUND_PATHS) {
    if (!/^[a-f0-9]{40}$/u.test(bound[path] ?? '')) errors.push(error('bound-file-coverage', path));
  }
  for (const path of Object.keys(nonJudged)) {
    if (!NON_JUDGED_PATHS.includes(path)) errors.push(error('non-judged-scope', path));
  }
  if (!options.skipHashes) {
    for (const [path, recorded] of Object.entries(bound)) {
      const current = gitHashObject(root, path);
      if (current === null) {
        errors.push(error('bound-file-missing', path));
        continue;
      }
      if (current === recorded) continue;
      hashDrift.push({ path, recorded, current });
      if (Object.hasOwn(nonJudged, path)) warnings.push(warning('non-judged-drift', `${path} (${nonJudged[path]})`));
      else errors.push(error('bound-file-drift', path));
    }
  }

  if (!options.allowDirty && gitStatus(root) !== '') {
    warnings.push(warning('dirty-worktree', 'readback ran on a dirty worktree; commit before treating it as final evidence'));
  }

  return {
    passed: errors.length === 0,
    status: acceptance?.status ?? null,
    decisions: Object.fromEntries(actual),
    boundFileCount: Object.keys(bound).length,
    nonJudgedInputCount: Object.keys(nonJudged).length,
    hashDrift,
    errors,
    warnings,
  };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, 'allow-dirty': { type: 'boolean' } } });
  try {
    const acceptance = readJson(ROOT, PATHS.acceptance);
    const result = validateDecisionAcceptance(acceptance, ROOT, { allowDirty: values['allow-dirty'] === true });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch (caught) {
    console.error(caught.message);
    process.exitCode = 1;
  }
}
