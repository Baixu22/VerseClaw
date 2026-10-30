#!/usr/bin/env node
/**
 * Static validation of the Agent-first evaluation loop contract (TF-0621).
 *
 *   node scripts/agent-first-loop-check.mjs
 *   node scripts/agent-first-loop-check.mjs --json
 *   node scripts/agent-first-loop-check.mjs --actor codex --out harness/specs/fixtures/agent-first-framework/loop-validation-report.json
 *
 * Reads the guide, the framework registry and the loop record from disk, checks
 * that every improvement signal resolves to a sealed dimension plus a gate or
 * task with evidence, that every re-evaluation runs on the same frozen suite and
 * held-out digest, that capability->regression promotions carry a pre-registered
 * threshold, and that the loop neither approves publication nor moves a locked
 * default. It also re-runs every declared negative control against the real
 * fixture, so "the loop fails closed" is an observed result rather than prose.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  AGENT_FIRST_LOOP_VALIDATION_SCHEMA,
  loadLoopFiles,
  runLoopNegativeControls,
  validateLoopContract,
} from './lib/agent-first-evaluation-loop.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function checkAgentFirstLoopContract(root = ROOT, actor = 'unspecified-agent', checkedAt = localDate()) {
  const files = loadLoopFiles(root);
  const { violations, counts } = validateLoopContract(files);
  const controls = runLoopNegativeControls(files);
  const unrejected = controls.filter((control) => !control.rejected);
  return {
    ok: violations.length === 0 && unrejected.length === 0,
    report: {
      schemaVersion: AGENT_FIRST_LOOP_VALIDATION_SCHEMA,
      checkedAt,
      driven_by: 'agent',
      actor,
      command: 'node scripts/agent-first-loop-check.mjs',
      scope: 'TF-0621 evaluation loop validation over file bodies read from disk',
      counts,
      inputDigests: files.inputDigests,
      evaluationStatus: counts.reEvaluations === 0 ? 'not-run' : 'recorded-results-not-replayed',
      negativeControls: controls,
      violations,
      limitations: [
        'This is a static contract check: it proves the loop record is internally complete and fails closed, not that any candidate was generated or measured.',
        'Sealed-result and graduation examples in the negative controls are deterministic contract fixtures, not measured evidence about the current system.',
        'Run result artifacts, their provenance and statistics are not replayed by this static validator; executable runners and independent adjudication remain later nodes.',
      ],
    },
    counts,
    controls,
    violations,
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1] ?? null;
  };
  const actor = flag('--actor') ?? 'unspecified-agent';
  const out = flag('--out');
  const asJson = args.includes('--json');
  const result = checkAgentFirstLoopContract(ROOT, actor);

  if (out) {
    const target = resolve(ROOT, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
    if (!asJson) console.log(`[agent-first-loop] wrote ${out}`);
  }

  if (asJson) console.log(JSON.stringify(result.report, null, 2));

  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(`[agent-first-loop] ${violation.code}: ${violation.path} - ${violation.message}`);
    }
    for (const control of result.controls.filter((entry) => !entry.rejected)) {
      console.error(`[agent-first-loop] negative control NOT rejected: ${control.id} (expected ${control.expectedCode})`);
    }
    process.exitCode = 1;
    return;
  }

  if (asJson) return;

  const rejected = result.controls.filter((control) => control.rejected).length;
  console.log(
    `[agent-first-loop] PASS ${result.counts.signals} signals, ${result.counts.candidates} candidates, `
    + `${result.counts.reEvaluations} re-evaluations, ${result.counts.promotions} promotions; `
    + `${rejected}/${result.controls.length} negative controls rejected`,
  );
}

if (isMainEntrypoint(import.meta.url)) await main();
