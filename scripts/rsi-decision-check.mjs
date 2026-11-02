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
 *   `source.nonJudgedInputs` are reported as warnings, never as failures: they
 *   are repository registries that unrelated tasks legitimately edit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  acceptance: 'harness/specs/fixtures/rsi-evidence-loop/decision-implementation-validation.v1.json',
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

  if (acceptance?.schemaVersion !== 'RsiDecisionImplementationAcceptance/v1') {
    errors.push(error('schema-version', 'unexpected acceptance schema'));
  }
  if (acceptance?.driven_by !== 'agent' || typeof acceptance?.actor !== 'string' || acceptance.actor.length === 0) {
    errors.push(error('agent-label', 'acceptance must be agent-driven with a concrete actor'));
  }
  if (acceptance?.boundaries && Object.entries(acceptance.boundaries).some(([key, value]) => key !== 'driven_by' && value !== false && value !== 0)) {
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
    if (!Number.isInteger(policy.taskSet?.maxFlakeCases) || policy.taskSet.maxFlakeCases < 0) {
      errors.push(error('d1-case-count', 'D1=C requires an integer taskSet.maxFlakeCases'));
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