#!/usr/bin/env node
/**
 * TF-0711 / TF-0721 / TF-0723 evidence driver.
 *
 * Merges real window-trial receipts produced by tests/e2e/recovery-contract-eval.spec.ts
 * into the frozen TF-0709 evaluation and writes the curated report. It never
 * fabricates a measurement: a window with fewer than the frozen repeat count is
 * reported as incomplete and the evaluation stays EVIDENCE_INSUFFICIENT.
 *
 * Usage:
 *   node --experimental-strip-types scripts/recovery-contract-eval.mjs --dir D:/tmp/recovery-eval
 *   node --experimental-strip-types scripts/recovery-contract-eval.mjs --check
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRecoveryContractManifest,
  evaluateRecoveryContractEval,
} from '../shared/recovery-contract-eval.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'harness/specs/fixtures/recovery-contract-eval');
const ACTOR = 'recovery-contract-eval-driver';

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readReceipts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith('trial-') && name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((value) => value && typeof value === 'object');
}

const check = process.argv.includes('--check');
const dir = resolve(argValue('--dir', 'D:/tmp/recovery-eval'));
const manifest = buildRecoveryContractManifest();
const receipts = readReceipts(dir);

const windowTrials = receipts.map((receipt) => ({
  windowId: receipt.windowId,
  trialIndex: receipt.trialIndex,
  injectionPoint: receipt.injectionPoint,
  duplicateEffects: receipt.duplicateEffects,
  lostTasks: receipt.lostTasks,
  terminalCorrect: receipt.terminalCorrect,
  unknownClassifiable: receipt.unknownClassifiable,
  recoveryLatencyMs: receipt.recoveryLatencyMs,
  diskEvidenceComplete: receipt.diskEvidenceComplete,
  rerunOutsideAllowedRegion: receipt.rerunOutsideAllowedRegion,
  evidenceRef: receipt.evidenceRef,
}));

// Long-session recovery pairs are measured by TF-0722; until that runs the
// array is empty and the evaluation must stay EVIDENCE_INSUFFICIENT.
const longSessionMeasurements = [];

const result = evaluateRecoveryContractEval({
  manifest,
  windowTrials,
  longSessionMeasurements,
  actor: ACTOR,
});

const byWindow = {};
for (const trial of windowTrials) {
  byWindow[trial.windowId] = (byWindow[trial.windowId] ?? 0) + 1;
}

const report = {
  schema: 'RecoveryContractEvalReport/v1',
  drivenBy: 'agent',
  actor: ACTOR,
  realHumanEvidence: false,
  generatedAt: new Date().toISOString(),
  manifest: {
    schema: manifest.schema,
    frozenAt: manifest.frozenAt,
    manifestHash: manifest.manifestHash,
    windows: manifest.windows.length,
    longSessionPairs: manifest.longSessionPairs.length,
  },
  trialReceiptsDir: dir.replaceAll('\\', '/'),
  trialCountsByWindow: byWindow,
  evaluation: result,
};

if (!check) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeJson(join(OUT_DIR, 'report.json'), report);
  writeJson(join(OUT_DIR, 'recovery-contract-eval-manifest.json'), manifest);
  console.log(`wrote ${join(OUT_DIR, 'report.json')}`);
}

console.log(JSON.stringify({
  status: result.status,
  decision: result.decision.disposition,
  qualityClaimAllowed: result.qualityClaimAllowed,
  trialCountsByWindow: byWindow,
  metrics: result.metrics,
  blockers: result.blockers,
  unmeasured: result.unmeasured,
}, null, 1));

process.exit(result.status === 'PASS' ? 0 : 1);
