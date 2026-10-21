import { describe, expect, it } from 'vitest';
import {
  DIFF_BUDGET, classifyFile, countChangedLines, evaluateBehaviorSamples, evaluateChangeSet,
  evaluateProvenance, fileUsesAstRule, isNormalizedNoOpDiff, isWhitespaceOnlyDiff, normalizeCode,
  projectValue, sha256, validateMc5Report,
} from '../../scripts/versegit-mc5-differential.mjs';

const big = (count: number, prefix = 'x') => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n');

function baselineSamples() {
  return [
    { id: 's1', seam: 'identity.version', reference: 'vg 0.1.0', candidate: 'vg 0.1.0' },
    { id: 's2', seam: 'identity.capabilities', reference: { schema: 'versegit.capabilities/v1' }, candidate: { schema: 'versegit.capabilities/v1' } },
    { id: 's3', seam: 'behavior.conflict-report', reference: { counts: { textual: 1 } }, candidate: { counts: { textual: 1 } } },
  ];
}

const cases = (result: { failures: { case: string }[] }) => result.failures.map((failure) => failure.case);

describe('MC5 differential migration gate', () => {
  it('classifies files and exempts docs, schema and config from the code no-op rule', () => {
    expect(classifyFile('docs/dev/versegit-validation-layer/README.md')).toBe('docs');
    expect(classifyFile('harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json')).toBe('config');
    expect(classifyFile('scripts/versegit-mc1-contract.mjs')).toBe('code');
    expect(classifyFile('src/pages/Knowledge/index.tsx')).toBe('code');
    expect(classifyFile('tests/unit/versegit-mc5-differential.test.ts')).toBe('test');
    expect(fileUsesAstRule('docs/a.md')).toBe(false);
    expect(fileUsesAstRule('electron/a.ts')).toBe(true);
    expect(fileUsesAstRule('README.md')).toBe(false);
  });

  it('detects whitespace-only and comment-only code edits as no-ops', () => {
    expect(isWhitespaceOnlyDiff('const a = 1;\n', 'const  a = 1;\n\n')).toBe(true);
    expect(isWhitespaceOnlyDiff('const a = 1;\n', 'const a = 2;\n')).toBe(false);
    expect(isNormalizedNoOpDiff('const a = 1;\n// intent\n', 'const a = 1;\n// rewritten\n')).toBe(true);
    expect(isNormalizedNoOpDiff('const a = 1;\n', 'const a = 2;\n')).toBe(false);
    expect(normalizeCode('const a = 1;')).toContain('const a = 1;');
    expect(DIFF_BUDGET.code_similarity).toContain('not a full parse');
  });

  it('counts changed lines by longest common subsequence', () => {
    expect(countChangedLines('a\nb\nc', 'a\nb\nc').total).toBe(0);
    expect(countChangedLines('a\nb', 'a\nb\nc').added).toBe(1);
    expect(countChangedLines('a\nb\nc', 'a\nc').removed).toBe(1);
  });

  it('refuses a whitespace-only slice, an over-budget slice and a multi-seam slice', () => {
    const whitespace = evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: 'const a = 1;\n', after: 'const   a = 1;\n' }] });
    expect(whitespace.passed).toBe(false);
    expect(cases(whitespace)).toContain('whitespace_only_diff');
    const commentOnly = evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: 'const a = 1;\n// intent\n', after: 'const a = 1;\n// rewritten\n' }] });
    expect(cases(commentOnly)).toContain('normalized_no_op_diff');

    const overBudget = evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: big(40, 'a'), after: big(520, 'b') }] });
    expect(overBudget.passed).toBe(false);
    expect(cases(overBudget)).toEqual(expect.arrayContaining(['per_file_budget_exceeded', 'seam_budget_exceeded']));

    const multiSeam = evaluateChangeSet({ seam: 'identity.version', files: [{ path: 'electron/a.ts', seam: 'identity.version', before: 'a\n', after: 'b\n' }, { path: 'src/pages/B.tsx', seam: 'behavior.conflict-report', before: 'a\n', after: 'b\n' }] });
    expect(multiSeam.passed).toBe(false);
    expect(cases(multiSeam)).toContain('multiple_seams_in_change_set');

    const tooManyFiles = evaluateChangeSet({
      seam: 's',
      files: Array.from({ length: DIFF_BUDGET.max_files_per_seam + 1 }, (_, i) => ({ path: `electron/f${i}.ts`, seam: 's', before: 'a\n', after: `b${i}\n` })),
    });
    expect(cases(tooManyFiles)).toContain('file_count_over_budget');

    expect(evaluateChangeSet({ seam: 's', files: [{ path: 'electron/a.ts', seam: 's', before: 'const a = 1;\n', after: 'const a = 2;\n' }] }).passed).toBe(true);
  });

  it('exempts docs from the no-op rule instead of refusing them', () => {
    const docs = evaluateChangeSet({ seam: 's', files: [{ path: 'docs/dev/x.md', seam: 's', before: '# Title\n', after: '# Title\n' }] });
    expect(docs.passed).toBe(true);
    expect(docs.notes.map((note: { case: string }) => note.case)).toContain('ast_rule_exempt');
  });

  it('projects volatile keys while keeping unknown and unobserved evidence visible', () => {
    const projected = JSON.parse(projectValue(
      { merged_tree_oid: 'abc', stale: 'unknown', coverage: 'unobserved', session_id: 'x', nested: { deep: ['b', 'a'] } },
      { volatile_keys: ['merged_tree_oid', 'session_id'] },
    ));
    expect(projected.merged_tree_oid).toBe('<merged_tree_oid>');
    expect(projected.stale).toBe('unknown');
    expect(projected.coverage).toBe('unobserved');
    // canonicalize() sorts arrays and keys so reordering cannot change the digest.
    expect(projected.nested.deep).toEqual(['a', 'b']);
    expect(projectValue({ a: 1, b: 2 }, {})).toBe(projectValue({ b: 2, a: 1 }, {}));
  });

  it('requires a complete behavior-change record for any real difference', () => {
    const differing = (record?: Record<string, string>) => [{
      id: 's1', seam: 'identity.version', reference: { a: 1 }, candidate: { a: 2 },
      ...(record ? { behavior_change_record: record } : {}),
    }, { id: 's2', seam: 'identity.capabilities', reference: { a: 1 }, candidate: { a: 1 } }, { id: 's3', seam: 'behavior.conflict-report', reference: { a: 1 }, candidate: { a: 1 } }];

    const undeclared = evaluateBehaviorSamples({ samples: differing(), declarations: {} });
    expect(undeclared.passed).toBe(false);
    expect(cases(undeclared)).toContain('undeclared_behavior_change');

    const incomplete = evaluateBehaviorSamples({ samples: differing({ old_behavior: 'a=1' }), declarations: {} });
    expect(cases(incomplete)).toContain('incomplete_behavior_change_record');

    const complete = evaluateBehaviorSamples({
      samples: differing({ old_behavior: 'a=1', new_behavior: 'a=2', reason: 'declared', verification: 'golden replay' }),
      declarations: {},
    });
    expect(complete.passed).toBe(true);
  });

  it('refuses an empty projection and too few representative inputs', () => {
    const swallowed = evaluateBehaviorSamples({
      samples: [
        { id: 's1', seam: 'identity.version', reference: { a: 1 }, candidate: { a: 1 } },
        { id: 's2', seam: 'identity.capabilities', reference: { a: 1 }, candidate: { a: 1 } },
        { id: 's3', seam: 'behavior.conflict-report', reference: { counts: { textual: 0 } }, candidate: null },
      ],
      declarations: { 'behavior.conflict-report': { drop_keys: ['counts'] } },
    });
    expect(swallowed.passed).toBe(false);
    expect(cases(swallowed)).toContain('empty_projection');

    const tooFew = evaluateBehaviorSamples({ samples: baselineSamples().slice(0, 2), declarations: {} });
    expect(cases(tooFew)).toEqual(expect.arrayContaining(['insufficient_samples', 'insufficient_seam_coverage']));
    expect(evaluateBehaviorSamples({ samples: baselineSamples(), declarations: {} }).passed).toBe(true);
  });

  it('binds every differential result to node, contract, golden and source provenance', () => {
    const mc0 = { source: { head: 'b'.repeat(40) }, binary: { sha256: 'a'.repeat(64) } };
    const mc1 = { schema: 'v1' };
    const mc2 = { digest: 'd'.repeat(64) };
    const mc3 = { digest: 'e'.repeat(64) };
    const provenance = {
      node: 'TF-0478', source_commit: mc0.source.head, binary_sha256: mc0.binary.sha256,
      contract_digest: sha256(JSON.stringify(mc1)), golden_bundle_digest: mc2.digest, sidecar_package_digest: mc3.digest,
    };
    expect(evaluateProvenance({ provenance, mc0, mc1, mc2, mc3, node: 'TF-0478' }).passed).toBe(true);
    expect(cases(evaluateProvenance({ provenance: { ...provenance, source_commit: 'f'.repeat(40) }, mc0, mc1, mc2, mc3, node: 'TF-0478' }))).toContain('source_commit_mismatch');
    expect(cases(evaluateProvenance({ provenance: { ...provenance, golden_bundle_digest: 'f'.repeat(64) }, mc0, mc1, mc2, mc3, node: 'TF-0478' }))).toContain('golden_digest_mismatch');
    expect(cases(evaluateProvenance({ provenance, mc0, mc1, mc2, mc3, node: 'TF-0466' }))).toContain('node_mismatch');
    expect(cases(evaluateProvenance({ provenance: null, mc0, mc1, mc2, mc3, node: 'TF-0478' }))).toContain('missing_provenance');
  });

  it('validates a framework-verified report and refuses a widened or premature one', () => {
    const report = {
      reportSchema: 'clawx.versegit.mc5-differential/v1',
      provenance: {
        source_commit: 'b'.repeat(40), binary_sha256: 'a'.repeat(64), contract_digest: 'c'.repeat(64),
        golden_bundle_digest: 'd'.repeat(64), sidecar_package_digest: 'e'.repeat(64),
      },
      diff_budget: DIFF_BUDGET,
      semantic_projection: { code_similarity: DIFF_BUDGET.code_similarity },
      controlled_samples: {
        representative_inputs: 4,
        passed: true,
        results: [
          { id: 'sample_identity_version', identical: true, behavior_change_record: false, reference_digest: sha256('1'), candidate_digest: sha256('1') },
          { id: 'sample_capabilities', identical: true, behavior_change_record: false, reference_digest: sha256('2'), candidate_digest: sha256('2') },
          { id: 'sample_conflict_report', identical: true, behavior_change_record: false, reference_digest: sha256('3'), candidate_digest: sha256('3') },
          { id: 'sample_stale_read_advisory', identical: true, behavior_change_record: false, reference_digest: sha256('4'), candidate_digest: sha256('4') },
        ],
      },
      negative_controls: [
        { id: 'control_whitespace_only_diff', fired: true },
        { id: 'control_seam_budget_exceeded', fired: true },
        { id: 'control_multiple_seams', fired: true },
        { id: 'control_undeclared_behavior_change', fired: true },
        { id: 'control_swallowed_unknown', fired: true },
        { id: 'control_provenance_drift', fired: true },
      ],
      provenance_check: { passed: true },
      adapter_comparison_available: false,
      status: 'framework_verified',
      blockers: [],
      boundaries: { adapter_implemented: false },
    };
    expect(validateMc5Report(report).issues).toEqual([]);

    const premature = structuredClone(report);
    premature.adapter_comparison_available = true;
    premature.boundaries.adapter_implemented = true;
    premature.negative_controls = premature.negative_controls.slice(0, 2);
    premature.status = 'accepted';
    const result = validateMc5Report(premature);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'MC5 must not claim an adapter comparison before MC4 exists',
      'MC5 must not claim the adapter is implemented',
      'the gate must be framework_verified, got accepted',
    ]));
    expect(result.issues).toEqual(expect.arrayContaining([
      'negative control control_swallowed_unknown is missing',
      'negative control control_provenance_drift is missing',
    ]));
    const silent = structuredClone(report);
    silent.negative_controls = silent.negative_controls.map((control: { id: string; fired: boolean }) => (control.id === 'control_provenance_drift' ? { ...control, fired: false } : control));
    expect(validateMc5Report(silent).issues).toContain('negative control control_provenance_drift did not fire');
  });
});
