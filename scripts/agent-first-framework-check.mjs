#!/usr/bin/env node
/**
 * Static validation of the Agent-first evaluation framework core (TF-0620).
 *
 *   node scripts/agent-first-framework-check.mjs
 *   node scripts/agent-first-framework-check.mjs --json
 *   node scripts/agent-first-framework-check.mjs --actor codex --out harness/specs/fixtures/agent-first-framework/validation-report.json
 *
 * Reads the guide and the framework registry from disk, checks that every
 * registered subject adapter can be evaluated, every suite carries a held-out
 * split and a floor, every grader is calibrated and not authored by the subject,
 * and every profile composes registered parts. It also re-runs every declared
 * negative control against the real fixture, so "the framework fails closed" is
 * an observed result rather than a claim in prose.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  AGENT_FIRST_FRAMEWORK_VALIDATION_SCHEMA,
  loadFrameworkFiles,
  runFrameworkNegativeControls,
  validateFrameworkContract,
} from './lib/agent-first-evaluation-framework.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function missingCalibration(root, registry) {
  const missing = [];
  for (const grader of registry?.registeredGraders ?? []) {
    for (const bucket of ['knownGood', 'knownBad']) {
      for (const ref of grader?.calibration?.[bucket] ?? []) {
        if (!existsSync(resolve(root, String(ref)))) {
          missing.push({
            code: 'calibration.missing-file',
            path: `registry.graders.${grader?.id}.calibration.${bucket}`,
            message: `calibration fixture not found on disk: ${ref}`,
          });
        }
      }
    }
  }
  return missing;
}

export function checkAgentFirstFrameworkContract(root = ROOT, actor = 'unspecified-agent', checkedAt = localDate()) {
  const files = loadFrameworkFiles(root);
  const { violations, counts } = validateFrameworkContract(files);
  violations.push(...missingCalibration(root, files.registry));
  const controls = runFrameworkNegativeControls(files);
  const unrejected = controls.filter((control) => !control.rejected);
  return {
    ok: violations.length === 0 && unrejected.length === 0,
    report: {
      schemaVersion: AGENT_FIRST_FRAMEWORK_VALIDATION_SCHEMA,
      checkedAt,
      driven_by: 'agent',
      actor,
      command: 'node scripts/agent-first-framework-check.mjs',
      scope: 'TF-0620 framework core registry validation over file bodies read from disk',
      counts,
      negativeControls: controls,
      violations,
      limitations: [
        'This is a static contract check: it proves the framework registry is internally complete and fails closed, not that any profile has been run.',
        'The acceptance profile is registered but not run; its status stays not-run and no current-candidate result is claimed.',
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
  const result = checkAgentFirstFrameworkContract(ROOT, actor);

  if (out) {
    const target = resolve(ROOT, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
    if (!asJson) console.log(`[agent-first-framework] wrote ${out}`);
  }

  if (asJson) console.log(JSON.stringify(result.report, null, 2));

  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(`[agent-first-framework] ${violation.code}: ${violation.path} - ${violation.message}`);
    }
    for (const control of result.controls.filter((entry) => !entry.rejected)) {
      console.error(`[agent-first-framework] negative control NOT rejected: ${control.id} (expected ${control.expectedCode})`);
    }
    process.exitCode = 1;
    return;
  }

  if (asJson) return;

  const rejected = result.controls.filter((control) => control.rejected).length;
  console.log(
    `[agent-first-framework] PASS ${result.counts.subjects} subjects, ${result.counts.suites} suites, `
    + `${result.counts.graders} graders, ${result.counts.profiles} profiles; `
    + `${rejected}/${result.controls.length} negative controls rejected`,
  );
}

if (isMainEntrypoint(import.meta.url)) await main();