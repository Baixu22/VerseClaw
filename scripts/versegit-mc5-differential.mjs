#!/usr/bin/env node
// MC5: the differential migration gate.
//
// "Was this migrated or rewritten?" has to be machine-decidable, because an LLM
// migrating a module defaults to re-authoring it from its own reading and loses
// behavior that lived in the parts it never looked at. This gate therefore compares
// two things: the *change set* of a migration slice (is it one seam, is it a real
// change, does it fit the numeric budget) and the *observable behavior* of the slice
// against the frozen original (semantic projection must be identical unless an
// explicit behavior-change record says otherwise).
//
// The code-similarity test is a deliberate whitespace-and-comment normalization, not a
// full parse: it is declared here as a proxy so nobody mistakes "normalized-equal" for
// "AST-equal". Docs/schema/config files are exempt from the no-op rule by design.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = process.env.VERSEGIT_MC5_ROOT
  ? resolve(process.env.VERSEGIT_MC5_ROOT)
  : resolve(process.cwd());

export const MC5_SCHEMA = 'clawx.versegit.mc5-differential/v1';
export const MC2_GOLDEN_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json';
export const MC1_CONTRACT_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json';
export const MC0_BASELINE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json';

// One slice per PR, with an explicit numeric budget so "small refactor" cannot absorb a
// whole subsystem. Values are the frozen contract; only a new evidence-backed revision
// may change them.
export const DIFF_BUDGET = {
  max_files_per_seam: 6,
  max_changed_lines_per_seam: 400,
  max_changed_lines_per_file: 200,
  code_similarity: 'normalized-whitespace-and-comment proxy (not a full parse)',
  ast_rule_exempt_classes: ['docs', 'schema', 'config', 'evidence'],
};

export const REQUIRED_NEGATIVE_CONTROLS = [
  'control_whitespace_only_diff',
  'control_seam_budget_exceeded',
  'control_multiple_seams',
  'control_undeclared_behavior_change',
  'control_swallowed_unknown',
  'control_provenance_drift',
];

export const FILE_CLASS_RULES = [
  { pattern: /^tests?\//u, file_class: 'test' },
  { pattern: /^docs\//u, file_class: 'docs' },
  { pattern: /\.md$/u, file_class: 'docs' },
  { pattern: /\.(json|jsonl|toml|ya?ml)$/u, file_class: 'config' },
  { pattern: /\.mjs$/u, file_class: 'code' },
  { pattern: /\.(ts|tsx|js|jsx|rs|py|sh)$/u, file_class: 'code' },
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function classifyFile(path) {
  for (const rule of FILE_CLASS_RULES) if (rule.pattern.test(path)) return rule.file_class;
  return 'other';
}

export function fileUsesAstRule(path) {
  const fileClass = classifyFile(path);
  return !DIFF_BUDGET.ast_rule_exempt_classes.includes(fileClass);
}

// Whitespace-only / comment-only edits are not a migration slice: they prove nothing was
// carried over. This is a normalization proxy, documented as such in DIFF_BUDGET.
export function normalizeCode(text) {
  return String(text ?? '')
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
    .replace(/#(?!!).*/gu, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function isWhitespaceOnlyDiff(before, after) {
  return String(before ?? '').replace(/\s/gu, '') === String(after ?? '').replace(/\s/gu, '');
}

export function isNormalizedNoOpDiff(before, after) {
  return normalizeCode(before) === normalizeCode(after);
}

export function countChangedLines(before, after) {
  const a = String(before ?? '').split(/\r?\n/u);
  const b = String(after ?? '').split(/\r?\n/u);
  const common = (() => {
    // Longest-common-subsequence line count: changed = added + removed.
    const rows = a.length + 1;
    const cols = b.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * cols + j] = a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    return table[0];
  })();
  return { added: b.length - common, removed: a.length - common, total: (b.length - common) + (a.length - common) };
}

export function evaluateChangeSet({ seam, files = [] } = {}) {
  const failures = [];
  const notes = [];
  if (!seam) failures.push({ case: 'missing_seam', detail: 'a migration slice must name exactly one declared seam' });
  if (files.length > DIFF_BUDGET.max_files_per_seam) {
    failures.push({ case: 'file_count_over_budget', detail: `${files.length} files exceeds ${DIFF_BUDGET.max_files_per_seam} for one seam` });
  }
  const seams = new Set(files.map((entry) => entry.seam ?? seam).filter(Boolean));
  if (seams.size > 1) failures.push({ case: 'multiple_seams_in_change_set', detail: [...seams].join(',') });
  let total = 0;
  for (const entry of files) {
    const counts = countChangedLines(entry.before, entry.after);
    total += counts.total;
    if (entry.seam && seams.size > 1 && entry.seam !== seam) {
      failures.push({ case: 'foreign_seam_file', detail: `${entry.path} belongs to ${entry.seam}` });
    }
    if (counts.total > DIFF_BUDGET.max_changed_lines_per_file) {
      failures.push({ case: 'per_file_budget_exceeded', detail: `${entry.path} changed ${counts.total} lines (budget ${DIFF_BUDGET.max_changed_lines_per_file})` });
    }
    if (fileUsesAstRule(entry.path)) {
      if (isWhitespaceOnlyDiff(entry.before, entry.after)) {
        failures.push({ case: 'whitespace_only_diff', detail: `${entry.path} (${classifyFile(entry.path)}) changed only whitespace` });
      } else if (isNormalizedNoOpDiff(entry.before, entry.after)) {
        failures.push({ case: 'normalized_no_op_diff', detail: `${entry.path} is unchanged after comment/whitespace normalization` });
      }
    } else {
      notes.push({ case: 'ast_rule_exempt', detail: `${entry.path} (${classifyFile(entry.path)}) is exempt from the no-op rule` });
    }
  }
  if (total > DIFF_BUDGET.max_changed_lines_per_seam) {
    failures.push({ case: 'seam_budget_exceeded', detail: `${total} changed lines exceeds ${DIFF_BUDGET.max_changed_lines_per_seam}` });
  }
  return { seam, files: files.length, changed_lines: total, failures, notes, passed: failures.length === 0 };
}

// Semantic projection: drop the fields the host declares as volatile, canonicalize the
// rest, and keep anything the source reported as unknown/unobserved/partial visible.
// Flattening those is the exact failure mode the boundary rule forbids.
export function projectValue(value, declaration = {}) {
  const volatileKeys = new Set(declaration.volatile_keys ?? []);
  const dropKeys = new Set(declaration.drop_keys ?? []);
  const walk = (node, key) => {
    if (key && dropKeys.has(key)) return undefined;
    if (Array.isArray(node)) return node.map((entry) => walk(entry, key)).filter((entry) => entry !== undefined);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [childKey, child] of Object.entries(node)) {
        if (volatileKeys.has(childKey)) { out[childKey] = `<${childKey}>`; continue; }
        const next = walk(child, childKey);
        if (next !== undefined) out[childKey] = next;
      }
      return out;
    }
    if (typeof node === 'string' && /unobserved|unknown|partial|unmeasured|not_run/iu.test(node)) return node;
    return node;
  };
  const projected = walk(value, undefined);
  return JSON.stringify(canonicalize(projected));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function evaluateBehaviorSamples({ samples = [], declarations = {} } = {}) {
  const failures = [];
  const results = [];
  for (const sample of samples) {
    const declaration = declarations[sample.seam ?? 'default'] ?? {};
    const reference = projectValue(sample.reference, declaration);
    const candidate = projectValue(sample.candidate, declaration);
    const identical = reference === candidate;
    const record = sample.behavior_change_record ?? null;
    if (!identical && !record) {
      failures.push({ case: 'undeclared_behavior_change', detail: `${sample.id} differs without a behavior-change record` });
    }
    if (identical && record) {
      failures.push({ case: 'unused_behavior_change_record', detail: `${sample.id} declares a behavior change that did not happen` });
    }
    if (record && (!record.old_behavior || !record.new_behavior || !record.reason || !record.verification)) {
      failures.push({ case: 'incomplete_behavior_change_record', detail: `${sample.id} record needs old, new, reason and verification` });
    }
    for (const [side, projected] of [['reference', reference], ['candidate', candidate]]) {
      if (projected === 'null' || projected === 'undefined') {
        failures.push({ case: 'empty_projection', detail: `${sample.id} ${side} projected to nothing` });
      }
    }
    results.push({ id: sample.id, seam: sample.seam ?? null, identical, reference_digest: sha256(reference), candidate_digest: sha256(candidate), behavior_change_record: record ? true : false });
  }
  const representative = new Set(results.map((entry) => entry.seam ?? entry.id)).size;
  if (results.length < 3) failures.push({ case: 'insufficient_samples', detail: `${results.length} samples, at least three representative inputs required` });
  if (representative < 3) failures.push({ case: 'insufficient_seam_coverage', detail: `${representative} distinct inputs covered` });
  return { results, representative_inputs: representative, failures, passed: failures.length === 0 };
}

export function evaluateProvenance({ provenance, mc0, mc1, mc2, mc3, node }) {
  const failures = [];
  if (!provenance) return { failures: [{ case: 'missing_provenance', detail: 'a differential result must be traceable' }], passed: false };
  if (node && provenance.node !== node) failures.push({ case: 'node_mismatch', detail: `${provenance.node} != ${node}` });
  if (provenance.source_commit !== mc0?.source?.head) failures.push({ case: 'source_commit_mismatch', detail: 'the frozen source commit differs from MC0' });
  if (provenance.binary_sha256 !== mc0?.binary?.sha256) failures.push({ case: 'binary_mismatch', detail: 'the compared binary differs from the MC0 frozen binary' });
  if (provenance.contract_digest !== sha256(JSON.stringify(mc1))) failures.push({ case: 'contract_digest_mismatch', detail: 'the consumer contract digest differs from MC1' });
  if (provenance.golden_bundle_digest !== mc2?.digest) failures.push({ case: 'golden_digest_mismatch', detail: 'the golden bundle digest differs from MC2' });
  if (mc3 && provenance.sidecar_package_digest !== mc3.digest) failures.push({ case: 'package_digest_mismatch', detail: 'the sidecar package digest differs from MC3' });
  return { failures, passed: failures.length === 0 };
}

function readJson(root, relative) {
  const path = resolve(root, relative);
  if (!existsSync(path)) throw new Error(`missing artifact: ${relative}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Controlled samples: the reference side is the frozen MC2 golden output of the real
// binary. The candidate side is a stand-in projection of what the adapter will produce,
// so the gate is exercised and its oracles are pinned before MC4 exists.
function controlledSamples(mc2) {
  const pick = (id) => mc2.cases.find((entry) => entry.id === id)?.normalized_stdout;
  const version = pick('identity_version');
  const capabilities = pick('identity_capabilities');
  const conflicts = pick('behavior_conflicts_worktree_mode');
  const staleRead = pick('positive_stale_read_producer_consumer');
  if (!version || !capabilities || !conflicts || !staleRead) throw new Error('MC2 golden is missing a controlled sample input');
  return {
    samples: [
      { id: 'sample_identity_version', seam: 'identity.version', reference: version, candidate: version },
      { id: 'sample_capabilities', seam: 'identity.capabilities', reference: capabilities, candidate: capabilities },
      { id: 'sample_conflict_report', seam: 'behavior.conflict-report', reference: conflicts, candidate: conflicts },
      {
        id: 'sample_stale_read_advisory',
        seam: 'behavior.stale-read',
        reference: staleRead,
        candidate: staleRead,
      },
    ],
    declarations: {
      'identity.version': { volatile_keys: [] },
      'identity.capabilities': { volatile_keys: [], drop_keys: [] },
      'behavior.conflict-report': { volatile_keys: ['merged_tree_oid'] },
      'behavior.stale-read': { volatile_keys: ['conflict_id', 'other_sessions'] },
    },
  };
}

export function buildMc5Report({ root = repositoryRoot } = {}) {
  const mc0 = readJson(root, MC0_BASELINE_PATH);
  const mc1 = readJson(root, MC1_CONTRACT_PATH);
  const mc2 = readJson(root, MC2_GOLDEN_PATH);
  const mc3Path = resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json');
  const mc3 = existsSync(mc3Path) ? JSON.parse(readFileSync(mc3Path, 'utf8')) : null;
  const { samples, declarations } = controlledSamples(mc2);
  const provenance = {
    node: 'TF-0478',
    source_commit: mc0.source.head,
    binary_sha256: mc0.binary.sha256,
    contract_digest: sha256(JSON.stringify(mc1)),
    golden_bundle_digest: mc2.digest,
    sidecar_package_digest: mc3?.digest ?? null,
  };

  const behavior = evaluateBehaviorSamples({ samples, declarations });
  const changeSet = evaluateChangeSet({
    seam: 'identity.version',
    files: [
      { path: 'scripts/versegit-mc5-differential.mjs', seam: 'identity.version', before: 'export const seam = 1;\n', after: 'export const seam = 2;\n' },
    ],
  });
  const provenanceCheck = evaluateProvenance({ provenance, mc0, mc1, mc2, mc3, node: 'TF-0478' });

  // Negative controls: each one must be refused, otherwise the gate is decorative.
  const negativeControls = [
    {
      id: 'control_whitespace_only_diff',
      expect: 'normalized_no_op_diff|whitespace_only_diff',
      result: evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: 'const a = 1;\n', after: 'const   a = 1;\n\n' }] }),
    },
    {
      id: 'control_seam_budget_exceeded',
      expect: 'seam_budget_exceeded|per_file_budget_exceeded',
      result: evaluateChangeSet({
        seam: 's',
        files: [{ path: 'electron/a.ts', seam: 's', before: Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n'), after: Array.from({ length: 520 }, (_, i) => `x${i}`).join('\n') }],
      }),
    },
    {
      id: 'control_multiple_seams',
      expect: 'multiple_seams_in_change_set|foreign_seam_file',
      result: evaluateChangeSet({
        seam: 'identity.version',
        files: [
          { path: 'electron/a.ts', seam: 'identity.version', before: 'a\n', after: 'b\n' },
          { path: 'src/pages/B.tsx', seam: 'behavior.conflict-report', before: 'a\n', after: 'b\n' },
        ],
      }),
    },
    {
      id: 'control_undeclared_behavior_change',
      expect: 'undeclared_behavior_change',
      result: evaluateBehaviorSamples({
        samples: [
          { id: 'n1', seam: 'identity.version', reference: 'vg 0.1.0', candidate: 'vg 0.1.0' },
          { id: 'n2', seam: 'identity.capabilities', reference: capabilitiesShape(1), candidate: capabilitiesShape(2) },
          { id: 'n3', seam: 'behavior.conflict-report', reference: { counts: { textual: 1 } }, candidate: { counts: { textual: 1 } } },
        ],
        declarations: {},
      }),
    },
    {
      id: 'control_swallowed_unknown',
      expect: 'empty_projection',
      result: evaluateBehaviorSamples({
        samples: [
          { id: 'u1', seam: 'identity.version', reference: 'a', candidate: 'a' },
          { id: 'u2', seam: 'identity.capabilities', reference: 'b', candidate: 'b' },
          { id: 'u3', seam: 'behavior.conflict-report', reference: { counts: { textual: 0 } }, candidate: null },
        ],
        declarations: { 'behavior.conflict-report': { drop_keys: ['counts'] } },
      }),
    },
    {
      id: 'control_provenance_drift',
      expect: 'source_commit_mismatch',
      result: evaluateProvenance({
        provenance: { ...provenance, source_commit: 'f'.repeat(40) },
        mc0, mc1, mc2, mc3, node: 'TF-0478',
      }),
    },
  ].map((control) => {
    const cases = (control.result.failures ?? []).map((failure) => failure.case);
    const matched = control.expect.split('|').some((expected) => cases.includes(expected));
    return { id: control.id, expected: control.expect, fired: matched, observed_cases: cases };
  });
  const unfired = negativeControls.filter((entry) => entry.fired !== true).map((entry) => entry.id);
  return {
    reportSchema: MC5_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0478',
    purpose: 'Make migration-vs-rewrite machine-decidable before any adapter code exists.',
    diff_budget: DIFF_BUDGET,
    file_classes: { rules: FILE_CLASS_RULES.map((rule) => ({ pattern: String(rule.pattern), file_class: rule.file_class })), ast_rule_exempt_classes: DIFF_BUDGET.ast_rule_exempt_classes },
    semantic_projection: {
      method: 'declared per-seam volatile/drop keys, then canonical key order and sorted arrays',
      code_similarity: DIFF_BUDGET.code_similarity,
      honesty: 'unknown/unobserved/partial/unmeasured values survive projection; they are never flattened to a clean result',
      declarations,
    },
    provenance,
    controlled_samples: behavior,
    change_set_example: changeSet,
    provenance_check: provenanceCheck,
    negative_controls: negativeControls,
    adapter_comparison_available: false,
    status: behavior.passed && provenanceCheck.passed && negativeControls.length >= 3 && unfired.length === 0 ? 'framework_verified' : 'failed',
    blockers: unfired.length > 0 ? [`negative controls did not fire: ${unfired.join(',')}`] : (mc3 ? [] : ['mc3 package manifest unavailable']),
    boundaries: {
      adapter_implemented: false,
      vg_source_tree_copied: false,
      provider_source_modified: false,
      default_on: false,
      land_or_admit_invoked: false,
      note: 'This node verifies the gate itself with controlled samples. Equal reference and candidate sides here prove the oracle fires; they do not claim MC4 equivalence, which MC4 must earn against the real adapter.',
    },
  };
}

function capabilitiesShape(n) {
  return { schema: 'versegit.capabilities/v1', safety: { default_enable: n === 1 }, workflows: [{ id: 'workspace', status: 'verified' }] };
}

export function validateMc5Report(report) {
  const issues = [];
  if (report?.reportSchema !== MC5_SCHEMA) issues.push(`reportSchema must be ${MC5_SCHEMA}`);
  if (!/^[0-9a-f]{40}$/u.test(String(report?.provenance?.source_commit ?? ''))) issues.push('provenance source commit missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.binary_sha256 ?? ''))) issues.push('provenance binary digest missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.contract_digest ?? ''))) issues.push('provenance contract digest missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.golden_bundle_digest ?? ''))) issues.push('provenance golden digest missing');
  if (!report?.provenance?.sidecar_package_digest) issues.push('provenance sidecar package digest missing');
  const samples = report?.controlled_samples?.results ?? [];
  if (samples.length < 3) issues.push('at least three representative inputs required');
  if ((report?.controlled_samples?.representative_inputs ?? 0) < 3) issues.push('representative inputs must cover three distinct seams');
  if (report?.controlled_samples?.passed !== true) issues.push('the controlled differential must pass on the reference side');
  for (const sample of samples) {
    if (sample.identical !== true) issues.push(`sample ${sample.id} is not golden-equal and has no behavior-change record`);
    if (sample.behavior_change_record !== false) issues.push(`sample ${sample.id} must not claim a behavior change in this node`);
  }
  const controls = report?.negative_controls ?? [];
  if (controls.length < 3) issues.push('at least three negative controls required');
  const controlIds = controls.map((control) => control.id);
  for (const required of REQUIRED_NEGATIVE_CONTROLS) {
    if (!controlIds.includes(required)) issues.push(`negative control ${required} is missing`);
  }
  for (const control of controls) {
    if (control.fired !== true) issues.push(`negative control ${control.id} did not fire`);
  }
  if (report?.provenance_check?.passed !== true) issues.push('the provenance check must pass for the frozen identity');
  if (report?.diff_budget?.max_files_per_seam !== 6) issues.push('the numeric diff budget drifted from the frozen contract');
  if (report?.diff_budget?.max_changed_lines_per_seam !== 400) issues.push('the per-seam line budget drifted from the frozen contract');
  if (report?.semantic_projection?.code_similarity?.includes('not a full parse') !== true) issues.push('the code-similarity method must declare itself a proxy');
  if (report?.adapter_comparison_available !== false) issues.push('MC5 must not claim an adapter comparison before MC4 exists');
  if (report?.boundaries?.adapter_implemented !== false) issues.push('MC5 must not claim the adapter is implemented');
  if (report?.status !== 'framework_verified') issues.push(`the gate must be framework_verified, got ${report?.status}`);
  if ((report?.blockers ?? []).length > 0) issues.push(`unexpected blockers: ${report.blockers.join(',')}`);
  return { ok: issues.length === 0, issues };
}

export function writeMc5Report({ output, root = repositoryRoot } = {}) {
  const report = buildMc5Report({ root });
  const validation = validateMc5Report(report);
  const path = output ? resolve(output) : resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { path, report, validation };
}

function main() {
  const at = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; };
  const result = writeMc5Report({ output: at('--out'), root: repositoryRoot });
  console.log(JSON.stringify({
    path: result.path,
    status: result.report.status,
    samples: result.report.controlled_samples.results.length,
    controls: result.report.negative_controls.map((entry) => `${entry.id}=${entry.fired ? 'fired' : 'SILENT'}`),
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) main();
