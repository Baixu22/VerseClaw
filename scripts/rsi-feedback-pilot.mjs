#!/usr/bin/env node
/**
 * TF-0654 feedback-weighting pilot: protocol validation + an honest report.
 *
 * This pilot is offline by construction: it may only read recorded feedback.
 * An empty store, an unattributable row, or a sample below the 20-case floor
 * must all resolve to `insufficient-evidence`; a positive-looking slice of a
 * handful of rows is exactly the overfitting the protocol exists to prevent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROTOCOL_PATH = 'harness/specs/fixtures/rsi-feedback-loop/protocol.v1.json';
export const REPORT_PATH = 'harness/specs/fixtures/rsi-feedback-loop/report.v1.json';
export const MIN_CASES = 20;
export const K = 3;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const error = (code, message) => ({ code, message });

export function validateFeedbackProtocol(protocol) {
  const errors = [];
  if (protocol?.schemaVersion !== 'RsiFeedbackLoopProtocol/v1') errors.push(error('schema-version', 'unexpected protocol schema'));
  if (protocol?.driven_by !== 'agent' || typeof protocol?.actor !== 'string' || !protocol.actor) errors.push(error('agent-label', 'protocol needs an agent actor'));
  if (protocol?.design?.k !== K) errors.push(error('k', `k must be ${K}`));
  if (protocol?.design?.minimumCompleteCases !== MIN_CASES) errors.push(error('floor', `minimumCompleteCases must be ${MIN_CASES}`));
  if (protocol?.design?.confidenceLevel !== 0.95) errors.push(error('interval', 'confidenceLevel must be 0.95'));
  if (protocol?.design?.inferenceUnit !== 'caseId') errors.push(error('inference-unit', 'inference unit must be the case cluster'));
  if (protocol?.flag?.default !== false) errors.push(error('flag-default', 'the single flag must default to false'));
  if (protocol?.flag?.singleFlagRollback !== true) errors.push(error('flag-rollback', 'single-flag rollback is required'));
  if (protocol?.budget?.providerCallsAuthorized !== 0) errors.push(error('provider-calls', 'this pilot authorises zero provider calls'));
  const arms = protocol?.arms ?? [];
  if (arms.length !== 2 || !arms.some((arm) => arm.id === 'off' && arm.feedbackWeight === 0) || !arms.some((arm) => arm.id === 'on')) {
    errors.push(error('arms', 'exactly an off/on arm pair is required'));
  }
  for (const arm of arms) {
    if (typeof arm.feedbackWeight !== 'number' || arm.feedbackWeight < 0 || arm.feedbackWeight > 1) errors.push(error('weight', `arm ${arm?.id} weight out of range`));
  }
  const controls = protocol?.negativeControls ?? [];
  if (controls.length < 5) errors.push(error('negative-controls', 'at least five negative controls are required'));
  for (const id of ['safety-anchor-regression', 'missing-cost']) {
    if (!controls.some((control) => control.id === id)) errors.push(error('negative-controls', `missing control ${id}`));
  }
  if (!Array.isArray(protocol?.decisionStates) || !protocol.decisionStates.includes('insufficient-evidence')) {
    errors.push(error('decision-states', 'decisionStates must include insufficient-evidence'));
  }
  return { passed: errors.length === 0, errors };
}

export function buildFeedbackReport(root = ROOT, protocol = readJson(join(root, PROTOCOL_PATH))) {
  const exportPath = protocol.feedbackSource?.exportPath;
  const absolute = resolve(root, exportPath);
  let rows = [];
  let sourceState = 'absent';
  if (existsSync(absolute)) {
    try {
      const parsed = readJson(absolute);
      rows = Array.isArray(parsed?.records) ? parsed.records : Array.isArray(parsed) ? parsed : [];
      sourceState = 'present';
    } catch {
      sourceState = 'unreadable';
    }
  }
  const attributed = rows.filter((row) => Boolean(row?.injectionId) && Boolean(row?.cardId));
  const unattributed = rows.length - attributed.length;
  const counts = attributed.reduce((acc, row) => ({ ...acc, [row.outcome ?? 'unknown']: (acc[row.outcome ?? 'unknown'] ?? 0) + 1 }), {});
  const completeCases = new Set(attributed.map((row) => row.caseId)).size;
  const belowFloor = completeCases < MIN_CASES;
  const reasons = [];
  let status = 'insufficient-evidence';
  if (sourceState !== 'present') reasons.push(`feedback export ${sourceState}: ${exportPath}`);
  if (rows.length === 0) reasons.push('no recorded feedback rows');
  if (belowFloor) reasons.push(`attributed cases ${completeCases} < required ${MIN_CASES}`);
  if (unattributed > 0) reasons.push(`${unattributed} unattributable row(s) rejected`);
  reasons.push('no provider calls authorised; this report is an offline eligibility readout, not an effect');

  return {
    schemaVersion: 'RsiFeedbackLoopReport/v1',
    generatedAt: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex/rsi-feedback-pilot',
    taskForestNode: 'TF-0654',
    protocolPath: PROTOCOL_PATH,
    status,
    reasons,
    feedbackSource: { state: sourceState, path: exportPath },
    input: { rows: rows.length, attributed: attributed.length, unattributed, completeCases, counts },
    design: protocol.design,
    flag: protocol.flag,
    claims: { benefit: false, promotionReady: false, productLocksChanged: false, providerCalls: 0, realHuman: false },
  };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, write: { type: 'boolean' }, json: { type: 'boolean' } } });
  try {
    const protocol = readJson(join(ROOT, PROTOCOL_PATH));
    const validation = validateFeedbackProtocol(protocol);
    const report = buildFeedbackReport(ROOT, protocol);
    if (values.write) {
      const target = join(ROOT, REPORT_PATH);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    const result = { passed: validation.passed, protocolValidation: validation, reportStatus: report.status, reasons: report.reasons };
    console.log(JSON.stringify(values.json ? result : result, null, 2));
    process.exitCode = validation.passed ? 0 : 1;
  } catch (caught) {
    console.error(caught.message);
    process.exitCode = 1;
  }
}