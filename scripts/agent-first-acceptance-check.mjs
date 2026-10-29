#!/usr/bin/env node
/**
 * Static validation of the agent-first acceptance contract (TF-0589).
 *
 *   node scripts/agent-first-acceptance-check.mjs
 *   node scripts/agent-first-acceptance-check.mjs --json
 *   node scripts/agent-first-acceptance-check.mjs --actor claude/tf0589-verifier --out harness/specs/fixtures/agent-first-acceptance/validation-report.json
 *
 * Reads the guide, the source manifest, the traceability matrix and the closeout
 * spec from disk, validates the cross references between them, and re-runs every
 * negative control against the real fixture so that "the contract fails closed"
 * is an observed result rather than a claim in prose.
 *
 * A command that printed a green line without checking anything would be a
 * no-op gate, so this script fails closed: a missing file, a contract violation
 * or a negative control that was NOT rejected all end in exit code 1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  AGENT_FIRST_ACCEPTANCE_VALIDATION_SCHEMA,
  loadAgentFirstAcceptanceContractFiles,
  runAgentFirstAcceptanceNegativeControls,
  validateAgentFirstAcceptanceContract,
} from './lib/agent-first-acceptance-contract.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** Local calendar date. A UTC date would disagree with the day the reviewer is
 * working on, which is the date this record is read against. */
function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function checkAgentFirstAcceptanceContract(root = ROOT, actor = 'unspecified-agent', checkedAt = localDate()) {
  const files = loadAgentFirstAcceptanceContractFiles(root);
  const { violations, counts } = validateAgentFirstAcceptanceContract(files);
  const controls = runAgentFirstAcceptanceNegativeControls(files);
  const unrejected = controls.filter((control) => !control.rejected);
  return {
    ok: violations.length === 0 && unrejected.length === 0,
    report: {
      schemaVersion: AGENT_FIRST_ACCEPTANCE_VALIDATION_SCHEMA,
      checkedAt,
      driven_by: 'agent',
      actor,
      command: 'node scripts/agent-first-acceptance-check.mjs',
      scope: 'TF-0589 static contract validation over file bodies read from disk',
      counts,
      negativeControls: controls,
      violations,
      limitations: [
        'This is a static contract check: it proves the acceptance contract is internally complete, not that any product candidate passes it.',
        'No runtime, package, model-quality, release or real-human claim is made.',
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
  const result = checkAgentFirstAcceptanceContract(ROOT, actor);

  if (out) {
    const target = resolve(ROOT, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
    if (!asJson) console.log(`[agent-first-acceptance] wrote ${out}`);
  }

  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  }

  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(`[agent-first-acceptance] ${violation.code}: ${violation.path} - ${violation.message}`);
    }
    for (const control of result.controls.filter((entry) => !entry.rejected)) {
      console.error(`[agent-first-acceptance] negative control NOT rejected: ${control.id} (expected ${control.expectedCode})`);
    }
    process.exitCode = 1;
    return;
  }

  if (asJson) return;

  const rej = result.controls.filter((control) => control.rejected).length;
  console.log(
    `[agent-first-acceptance] PASS ${result.counts.gates} gates, ${result.counts.dimensions} dimensions, `
    + `${result.counts.verdictStates} verdict states, ${result.counts.sources} sources; `
    + `${rej}/${result.controls.length} negative controls rejected`,
  );
}

if (isMainEntrypoint(import.meta.url)) await main();
