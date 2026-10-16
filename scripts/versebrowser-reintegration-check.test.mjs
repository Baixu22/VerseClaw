import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateReintegration,
  hashSource,
  inspectAllowlist,
  inspectHostSurface,
  inspectProtectedInputs,
  inspectTaskMapping,
} from './versebrowser-reintegration-check.mjs';

const sourceText = 'export const value = 1;\n';
const patchText = 'diff --git a/a b/a\n';
const hash = (text) => hashSource(Buffer.from(text));

function baseLock() {
  return {
    protectedInputs: [
      { path: 'src/a.ts', role: 'product_source', sha256: hash(sourceText), lfSha256: hash(sourceText) },
      { path: 'scripts/patch-upstream.mjs', role: 'required_runtime_patch', sha256: hash(patchText), lfSha256: hash(patchText) },
    ],
    hostApi: { existingMethods: ['click'], sourceMethods: ['click', 'drag'], sourceOnlyMethods: ['drag'], legacyMethodCount: 1, sourceMethodCount: 2 },
    comparison: { totalPairs: 1 },
    proposedModule: { excludedProjectRoots: ['.local', 'dist'] },
  };
}

function baseAllowlist() {
  return { groups: {
    product_source: [{ path: 'src/a.ts', role: 'product_source' }],
    required_runtime_patch: [{ path: 'scripts/patch-upstream.mjs', role: 'required_runtime_patch' }],
  } };
}

function baseTaskMapping() {
  return {
    sourceArchive: { nodeCount: 190, edgeCount: 338 },
    entries: Array.from({ length: 190 }, (_, index) => ({
      sourceTaskId: `TF-${String(index + 1).padStart(4, '0')}`,
      review: { reviewStatus: 'reviewed', disposition: 'wire_required' },
    })),
  };
}

function baseSurface(lock) {
  return inspectHostSurface(`const contract = {\n  agentBrowser: {\n    click: (payload) => payload,\n  },\n};\n`, lock);
}

test('accepts a preserved preparation baseline without declaring migration complete', () => {
  const lock = baseLock();
  const report = evaluateReintegration({
    protectedInputs: { status: 'pass', expected: 2, verified: 2, issues: [] },
    hostSurface: baseSurface(lock),
    taskMapping: inspectTaskMapping(baseTaskMapping(), lock),
    allowlist: inspectAllowlist(baseAllowlist(), lock),
    fileDeltas: { status: 'pass', pairCount: 1, verbatim: 0, importRewriteOnly: 0, behaviorDeltaReviewRequired: 1, knownDeltas: ['shared/a.ts'], issues: [] },
  });
  assert.equal(report.status, 'prepared');
  assert.equal(report.exitCode, 0);
  assert.equal(report.finalMigration.complete, false);
  assert.equal(evaluateReintegration({ ...report, protectedInputs: report.sourcePreservation, hostSurface: report.hostApi, taskMapping: report.taskMapping, allowlist: report.scopeAllowlist, fileDeltas: report.fileDeltas }, { requireFinal: true }).exitCode, 1);
});

test('rejects a missing frozen source input', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const result = await inspectProtectedInputs(baseLock(), 'D:/not-used', async () => { throw missing; });
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((entry) => entry.kind === 'source_missing'));
});

test('rejects deletion of a legacy host method', () => {
  const lock = baseLock();
  const result = inspectHostSurface(`const contract = {\n  agentBrowser: {\n  },\n};\n`, lock);
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((entry) => entry.kind === 'legacy_method_missing' && entry.method === 'click'));
});

test('rejects an omitted source-task mapping', () => {
  const artifact = baseTaskMapping();
  artifact.entries.pop();
  const result = inspectTaskMapping(artifact, baseLock());
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((entry) => entry.kind === 'source_task_entry_count_mismatch'));
});

test('rejects a process-only path in the next-phase allowlist', () => {
  const allowlist = baseAllowlist();
  allowlist.groups.product_source[0].path = '.local/secret.ts';
  const result = inspectAllowlist(allowlist, baseLock());
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((entry) => entry.kind === 'process_path_forbidden'));
});

test('rejects a runtime patch that is not registered in the source lock', () => {
  const allowlist = baseAllowlist();
  allowlist.groups.required_runtime_patch[0].path = 'scripts/new.patch';
  const result = inspectAllowlist(allowlist, baseLock());
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((entry) => entry.kind === 'unregistered_patch'));
});
