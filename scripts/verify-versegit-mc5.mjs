#!/usr/bin/env node
// MC5 verifier: re-derive the differential report from the frozen MC0/MC1/MC2/MC3
// artifacts, prove the controlled samples still hash identically, and prove every
// negative control still fires. A gate that nobody re-tests is decoration.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  DIFF_BUDGET, buildMc5Report, evaluateBehaviorSamples, evaluateChangeSet, evaluateProvenance,
  isNormalizedNoOpDiff, isWhitespaceOnlyDiff, normalizeCode, projectValue, sha256, validateMc5Report,
  MC0_BASELINE_PATH, MC1_CONTRACT_PATH, MC2_GOLDEN_PATH,
} from './versegit-mc5-differential.mjs';

const root = process.env.VERSEGIT_MC5_ROOT ? resolve(process.env.VERSEGIT_MC5_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }
function readJson(relative) {
  const path = resolve(root, relative);
  if (!existsSync(path)) throw new Error(`missing artifact: ${relative}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const artifact = at('--artifact') ?? resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json');
  if (!existsSync(artifact)) { console.error(`[versegit-mc5] FAIL: artifact missing: ${artifact}`); process.exitCode = 1; return; }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateMc5Report(stored).issues);

  const live = buildMc5Report({ root });
  issues.push(...validateMc5Report(live).issues.map((issue) => `live: ${issue}`));
  const compare = ['provenance', 'diff_budget', 'semantic_projection'];
  for (const key of compare) {
    if (JSON.stringify(stored[key]) !== JSON.stringify(live[key])) issues.push(`${key} drifted from the live gate`);
  }
  const storedDigests = (stored.controlled_samples?.results ?? []).map((entry) => `${entry.id}:${entry.reference_digest}:${entry.candidate_digest}`).sort();
  const liveDigests = (live.controlled_samples?.results ?? []).map((entry) => `${entry.id}:${entry.reference_digest}:${entry.candidate_digest}`).sort();
  if (JSON.stringify(storedDigests) !== JSON.stringify(liveDigests)) issues.push('controlled sample digests drifted from the live run');
  const storedControls = (stored.negative_controls ?? []).map((entry) => `${entry.id}=${entry.fired}`).sort();
  const liveControls = (live.negative_controls ?? []).map((entry) => `${entry.id}=${entry.fired}`).sort();
  if (JSON.stringify(storedControls) !== JSON.stringify(liveControls)) issues.push('negative control outcomes drifted from the live run');

  // Re-prove the oracles independently of the report: each refusal must actually fire.
  const whitespace = evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: 'const a = 1;\n', after: 'const  a = 1;\n' }] });
  if (whitespace.passed) issues.push('a whitespace-only diff must be refused');
  if (!isWhitespaceOnlyDiff('a b', 'ab') || !isNormalizedNoOpDiff('a\n// c\n', 'a\n// d\n') || normalizeCode('a\n//! keep\n') === '') {
    issues.push('the code-similarity proxy no longer behaves as declared');
  }
  const budget = evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: 'a\n', after: Array.from({ length: DIFF_BUDGET.max_changed_lines_per_file + 5 }, (_, i) => `x${i}`).join('\n') }] });
  if (budget.passed) issues.push('an over-budget slice must be refused');
  const multiSeam = evaluateChangeSet({ seam: 'a', files: [{ path: 'electron/a.ts', seam: 'a', before: 'x\n', after: 'y\n' }, { path: 'src/b.tsx', seam: 'b', before: 'x\n', after: 'y\n' }] });
  if (multiSeam.passed) issues.push('a change set that spans two seams must be refused');
  const undeclared = evaluateBehaviorSamples({ samples: [{ id: 'i1', seam: 'x', reference: { a: 1 }, candidate: { a: 2 } }, { id: 'i2', seam: 'y', reference: { a: 1 }, candidate: { a: 1 } }, { id: 'i3', seam: 'z', reference: { a: 1 }, candidate: { a: 1 } }], declarations: {} });
  if (undeclared.passed) issues.push('an undeclared behavior change must be refused');
  const declared = evaluateBehaviorSamples({
    samples: [{ id: 'i1', seam: 'x', reference: { a: 1 }, candidate: { a: 2 }, behavior_change_record: { old_behavior: 'a=1', new_behavior: 'a=2', reason: 'documented', verification: 'replay' } }, { id: 'i2', seam: 'y', reference: { a: 1 }, candidate: { a: 1 } }, { id: 'i3', seam: 'z', reference: { a: 1 }, candidate: { a: 1 } }],
    declarations: {},
  });
  if (!declared.passed) issues.push(`a documented behavior change must pass: ${declared.failures.map((f) => f.case).join(',')}`);
  const incompleteRecord = evaluateBehaviorSamples({
    samples: [{ id: 'i1', seam: 'x', reference: { a: 1 }, candidate: { a: 2 }, behavior_change_record: { old_behavior: 'a=1' } }, { id: 'i2', seam: 'y', reference: { a: 1 }, candidate: { a: 1 } }, { id: 'i3', seam: 'z', reference: { a: 1 }, candidate: { a: 1 } }],
    declarations: {},
  });
  if (!incompleteRecord.failures.some((failure) => failure.case === 'incomplete_behavior_change_record')) issues.push('a behavior-change record missing reason or verification must be refused');
  const swallowed = evaluateBehaviorSamples({ samples: [{ id: 'i1', seam: 'x', reference: { unobserved: ['bash'] }, candidate: null }, { id: 'i2', seam: 'y', reference: { a: 1 }, candidate: { a: 1 } }, { id: 'i3', seam: 'z', reference: { a: 1 }, candidate: { a: 1 } }], declarations: { x: { drop_keys: ['unobserved'] } } });
  if (swallowed.passed) issues.push('a projection that swallows the only evidence must be refused');

  const mc0 = readJson(MC0_BASELINE_PATH);
  const mc1 = readJson(MC1_CONTRACT_PATH);
  const mc2 = readJson(MC2_GOLDEN_PATH);
  const provenance = evaluateProvenance({ provenance: stored.provenance, mc0, mc1, mc2, mc3: null, node: 'TF-0478' });
  if (!provenance.passed) issues.push(`the stored provenance no longer matches the frozen artifacts: ${provenance.failures.map((failure) => failure.case).join(',')}`);
  const projected = JSON.parse(projectValue({ stale: 'unknown', keep: 'unobserved', volatile: 'x' }, { volatile_keys: ['volatile'] }));
  if (projected.keep !== 'unobserved' || projected.stale !== 'unknown' || projected.volatile !== '<volatile>') issues.push('projection must keep unknown/unobserved values and mask volatile keys');
  if (stored.status !== 'framework_verified' || live.status !== 'framework_verified') issues.push('the gate must report framework_verified');

  if (issues.length > 0) { for (const issue of issues) console.error(`[versegit-mc5] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-mc5] OK status=${stored.status} samples=${stored.controlled_samples.results.length} controls=${stored.negative_controls.length} head=${mc0.source.head.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) main();
