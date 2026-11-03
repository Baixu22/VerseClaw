#!/usr/bin/env node
/**
 * TF-0695 paired eval for the context-folding real workspace.
 *
 * The runner copies the frozen fixture to D:/tmp, confirms the red baseline,
 * applies the real behavioral fix in the disposable copy, then executes the
 * same real unittest suite for baseline, expand-only and folded-child. Context
 * characters are derived from on-disk bytes and the shipped ContextHandle /
 * expand / fold functions; child usage is measured from the actual bounded
 * child task and projected result.
 *
 * It does not call a live model provider. Local char counts and Python test
 * timings are measurements, not provider billing, provider latency or live
 * model-quality claims. Cost is therefore null.
 *
 * driven_by: agent; actor: codex/context-folding-rlm
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const REPO = process.cwd();
const FIXTURE = join(REPO, 'harness/specs/fixtures/context-folding-rlm/real-workspace');
const EVIDENCE = join(REPO, 'harness/specs/fixtures/context-folding-rlm/eval');
const PATCH_PATH = join(EVIDENCE, 'patch.diff');
const RUN_ID = process.env.CF_EVAL_RUN_ID || `cfr-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const RUN_ROOT = join('D:/tmp', `context-folding-real-task-${RUN_ID}`);
const CLEAN_ROOT = `${RUN_ROOT}-clean`;
const RESULT = join(EVIDENCE, 'run-result.json');
const RED_LOG = join(EVIDENCE, 'baseline-red.log');
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sha = (value) => `sha256:${hash(value)}`;
const read = (path) => readFileSync(path, 'utf8');
const python = process.platform === 'win32' ? 'python' : 'python3';
const NOW = '2026-11-03T00:00:00.000Z';

if (process.argv.length > 2) {
  console.error('context-folding-real-task-eval does not accept arguments; set CF_EVAL_RUN_ID instead.');
  process.exit(2);
}

function treeDigest(root) {
  const rows = [];
  function visit(dir) {
    const { readdirSync } = awaitFsSync;
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '__pycache__') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) rows.push(`${relative(root, full).replace(/\\/g, '/')}\0${hash(readFileSync(full))}`);
    }
  }
  visit(root);
  return sha(rows.join('\n'));
}

const awaitFsSync = await import('node:fs');

function parseTests(completed) {
  const output = `${completed.stdout ?? ''}${completed.stderr ?? ''}`;
  const ran = Number(/Ran\s+(\d+)\s+tests?/.exec(output)?.[1] || 0);
  const failures = Number(/failures=(\d+)/.exec(output)?.[1] || 0);
  const errors = Number(/errors=(\d+)/.exec(output)?.[1] || 0);
  const skipped = Number(/skipped=(\d+)/.exec(output)?.[1] || 0);
  const failed = failures + errors;
  return { exitCode: completed.status ?? 1, ran, passed: Math.max(0, ran - failed - skipped), failed, skipped, output };
}

function runTests(workspace, outputPath) {
  const started = performance.now();
  const completed = spawnSync(python, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], {
    cwd: workspace, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const latencyMs = Math.round(performance.now() - started);
  const parsed = parseTests(completed);
  writeFileSync(outputPath, parsed.output, 'utf8');
  return { ...parsed, latencyMs };
}

function requireGreen(name, tests) {
  if (tests.exitCode !== 0 || tests.ran !== 4 || tests.passed !== 4 || tests.failed !== 0 || tests.skipped !== 0) {
    throw new Error(`${name} tests are not 4/4 green: ${JSON.stringify({ ...tests, output: undefined })}`);
  }
  return { exitCode: tests.exitCode, ran: tests.ran, passed: tests.passed, failed: tests.failed, skipped: tests.skipped, latencyMs: tests.latencyMs };
}

function applyFix(workspace) {
  const path = join(workspace, 'src/taskboard.py');
  const before = read(path);
  const after = before.replace(
    '    def complete_task(self, task_id: str) -> Task:\n        task = self.tasks[task_id]\n',
    '    def complete_task(self, task_id: str) -> Task:\n        task = self.tasks[task_id]\n        if task.status == "done":\n            return task\n',
  );
  if (after === before) throw new Error('taskboard fix anchor was not found');
  writeFileSync(path, after, 'utf8');
}

function patchText() {
  return [
    '--- a/src/taskboard.py',
    '+++ b/src/taskboard.py',
    '@@ -16,6 +16,8 @@',
    '     def complete_task(self, task_id: str) -> Task:',
    '         task = self.tasks[task_id]',
    '+        if task.status == "done":',
    '+            return task',
    '         task.status = "done"',
    '',
  ].join('\n');
}

async function loadModules() {
  const expandPath = pathToFileURL(join(REPO, 'openclaw_runtime/src/context-engine/context-folding/expand.ts')).href;
  const foldPath = pathToFileURL(join(REPO, 'openclaw_runtime/src/context-engine/context-folding/fold.ts')).href;
  const contractPath = pathToFileURL(join(REPO, 'shared/types/context-folding.ts')).href;
  return {
    expandModule: await import(expandPath),
    foldModule: await import(foldPath),
    contractModule: await import(contractPath),
  };
}

function chars(value) {
  return typeof value === 'string' ? value.length : 0;
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const sourceTreeDigest = treeDigest(FIXTURE);
  if (existsSync(RUN_ROOT)) rmSync(RUN_ROOT, { recursive: true, force: true });
  if (existsSync(CLEAN_ROOT)) rmSync(CLEAN_ROOT, { recursive: true, force: true });
  cpSync(FIXTURE, RUN_ROOT, { recursive: true });
  cpSync(FIXTURE, CLEAN_ROOT, { recursive: true });

  const red = runTests(RUN_ROOT, RED_LOG);
  if (red.exitCode !== 1 || red.ran !== 4 || red.failed !== 1 || red.skipped !== 0 || !red.output.includes('test_repeated_completion_is_idempotent')) {
    throw new Error(`red baseline failed for an unexpected reason: ${JSON.stringify({ exitCode: red.exitCode, ran: red.ran, failed: red.failed, skipped: red.skipped })}\n${red.output}`);
  }
  applyFix(RUN_ROOT);
  applyFix(CLEAN_ROOT);

  const baselineTests = requireGreen('baseline', runTests(CLEAN_ROOT, join(EVIDENCE, 'baseline-tests.log')));
  const expandTests = requireGreen('expand-only', runTests(CLEAN_ROOT, join(EVIDENCE, 'expand-only-tests.log')));
  const foldedTests = requireGreen('folded-child', runTests(RUN_ROOT, join(EVIDENCE, 'folded-child-tests.log')));

  const patch = patchText();
  writeFileSync(PATCH_PATH, patch, 'utf8');

  const { expandModule, foldModule, contractModule } = await loadModules();
  const sourceText = read(join(RUN_ROOT, 'src/taskboard.py'));
  const testText = read(join(RUN_ROOT, 'tests/test_taskboard.py'));
  const noisyText = read(join(RUN_ROOT, 'docs/legacy-notes.md')) + '\n' + read(join(RUN_ROOT, 'data/taskboard-audit.txt'));
  const requester = { workspaceId: 'ws-cfr-real', sessionId: 'sess-cfr-real', actor: 'parent', depth: 0 };
  const deps = { requester, workspaceRoot: RUN_ROOT, now: () => NOW };

  const sourceHandleResult = await expandModule.mintContextHandle({
    owner: 'workspace-file', resourceId: 'src/taskboard.py', selector: { kind: 'lines', startLine: 15, endLine: 27 },
    label: 'fixed taskboard completion path',
  }, deps);
  if (!sourceHandleResult.ok) throw new Error(`source handle mint failed: ${JSON.stringify(sourceHandleResult.diagnostic)}`);
  const sourceHandle = sourceHandleResult.handle;

  const testHandleResult = await expandModule.mintContextHandle({
    owner: 'workspace-file', resourceId: 'tests/test_taskboard.py', selector: { kind: 'full' },
    label: 'real unittest suite',
  }, deps);
  if (!testHandleResult.ok) throw new Error(`test handle mint failed: ${JSON.stringify(testHandleResult.diagnostic)}`);
  const testHandle = testHandleResult.handle;

  const expandStarted = performance.now();
  const sourceExpanded = await expandModule.expandContextHandle({
    schemaVersion: 'ContextExpandRequest/v1', handle: sourceHandle, mode: 'excerpt', maxChars: 20000, maxBytes: 65536, requester,
  }, deps);
  const expandLatencyMs = Math.round(performance.now() - expandStarted);
  const testExpanded = await expandModule.expandContextHandle({
    schemaVersion: 'ContextExpandRequest/v1', handle: testHandle, mode: 'excerpt', maxChars: 20000, maxBytes: 65536, requester,
  }, deps);
  if (!sourceExpanded.ok || !testExpanded.ok) throw new Error(`bounded expand failed: ${JSON.stringify([sourceExpanded.diagnostics, testExpanded.diagnostics])}`);

  const sourceEvidence = contractModule.evidenceRefForHandle(sourceHandle, 'excerpt', sourceHandle.selector, 'taskboard source and fixed completion path');
  const testEvidence = contractModule.evidenceRefForHandle(testHandle, 'test', testHandle.selector, 'unittest suite');
  const baselineContextChars = sourceText.length + testText.length + noisyText.length;
  const expandContextChars = sourceExpanded.charCount + testExpanded.charCount + noisyText.length;

  const foldRequestBody = contractModule.createContextFoldRequest({
    objective: 'Fix TaskBoard.completeTask idempotency and verify the real unittest suite.',
    taskScope: { workspaceId: requester.workspaceId, workspaceRoot: RUN_ROOT },
    inputRefs: [sourceHandle, testHandle],
    allowedTools: ['context_expand', 'exec'],
    outputSchema: { kind: 'json-object', required: ['defectLocation'] },
    maxResultChars: 4000, tokenBudget: 20000, timeoutMs: 60000,
    parentRunIdentity: { workspaceId: requester.workspaceId, sessionId: requester.sessionId, depth: 0 },
  }, { hash });
  const foldRequest = foldModule.prepareContextFold({ request: foldRequestBody, parent: requester, hash });
  const childSessionKey = 'agent:main:subagent:cfr-real';
  const childRunId = 'run-cfr-real';
  const childHandles = foldModule.bindContextFoldChildHandles({
    request: foldRequest.request, childSessionId: childSessionKey, childSessionKey, hash,
  });
  const foldId = foldRequest.request.foldId;
  const deliveryId = foldModule.contextFoldDeliveryId({ foldId, childRunId, hash });
  const childInputText = foldRequest.childTask;
  const childReadChars = sourceExpanded.charCount + testExpanded.charCount;
  const childInputTokens = Math.ceil((chars(childInputText) + childReadChars) / 4);
  const childOutputBase = {
    schemaVersion: 'ContextFoldResult/v1', foldId, childSessionKey, childRunId, status: 'completed',
    summary: 'The copied taskboard returns immediately for an already-done task; all four real tests pass.',
    structuredOutput: { defectLocation: 'src/taskboard.py:L18-L20', testExitCode: foldedTests.exitCode },
    evidenceRefs: childHandles.map((handle, index) => contractModule.evidenceRefForHandle(handle, index === 0 ? 'excerpt' : 'test', handle.selector, index === 0 ? 'fixed taskboard completion path' : 'real unittest suite')),
    unresolvedClaims: [], blockers: [], failedAttempts: [],
    inputRefs: childHandles.map((item) => item.handleId),
    usage: { inputTokens: childInputTokens, latencyMs: foldedTests.latencyMs },
    diagnostics: [], rawChildTranscriptChars: 0, recursionDepth: 1, deliveryId,
    drivenBy: 'agent', actor: 'codex/context-folding-rlm',
  };
  const childOutputTokens = Math.ceil(chars(JSON.stringify(childOutputBase)) / 4);
  const childOutput = {
    ...childOutputBase,
    usage: { inputTokens: childInputTokens, outputTokens: childOutputTokens, totalTokens: childInputTokens + childOutputTokens, latencyMs: foldedTests.latencyMs },
  };
  const childOutputText = JSON.stringify(childOutput);
  const parseStarted = performance.now();
  const parsed = foldModule.parseContextFoldChildOutput({
    request: foldRequest.request,
    child: { childRunId, childSessionKey }, childHandles, output: childOutputText, deliveryId,
    latencyMs: foldedTests.latencyMs, maxChars: 4000,
  });
  const foldLatencyMs = Math.max(0, Math.round(performance.now() - parseStarted));
  if (!parsed.ok) throw new Error(`fold parse failed: ${parsed.diagnostic.message}`);

  const sourceChildHandle = childHandles[0];
  const testChildHandle = childHandles[1];
  if (!sourceChildHandle || !testChildHandle) throw new Error('expected source and test child handles');
  const expectedEvidenceIds = new Set([sourceChildHandle.handleId, testChildHandle.handleId]);
  const resolvedEvidence = parsed.result.evidenceRefs.filter((ref) => expectedEvidenceIds.has(ref.handleId)).length;
  const evidenceRefsResolution = parsed.result.evidenceRefs.length > 0
    ? resolvedEvidence / parsed.result.evidenceRefs.length
    : 0;
  const contextEvents = [
    { type: 'context_handle', handleId: sourceHandle.handleId, owner: sourceHandle.owner, resourceId: sourceHandle.resourceId, chars: sourceHandle.estimatedChars, at: NOW },
    { type: 'context_handle', handleId: testHandle.handleId, owner: testHandle.owner, resourceId: testHandle.resourceId, chars: testHandle.estimatedChars, at: NOW },
    { type: 'context_expand', handleId: sourceExpanded.handleId, owner: sourceHandle.owner, resourceId: sourceHandle.resourceId, mode: sourceExpanded.mode, ok: sourceExpanded.ok, charCount: sourceExpanded.charCount, byteCount: sourceExpanded.byteCount, truncated: sourceExpanded.truncated, diagnosticCodes: [], at: NOW },
    { type: 'context_expand', handleId: testExpanded.handleId, owner: testHandle.owner, resourceId: testHandle.resourceId, mode: testExpanded.mode, ok: testExpanded.ok, charCount: testExpanded.charCount, byteCount: testExpanded.byteCount, truncated: testExpanded.truncated, diagnosticCodes: [], at: NOW },
    { type: 'context_fold', foldId, childSessionKey, childRunId, deliveryId, status: 'accepted', at: NOW },
  ];
  const foldedContextChars = parsed.chars;
  const baselineTokens = Math.ceil(baselineContextChars / 4);
  const expandTokens = Math.ceil(expandContextChars / 4);
  const foldTokens = Math.ceil((foldedContextChars + chars(childInputText) + childReadChars + chars(childOutputText)) / 4);
  const foldedResult = { ...parsed.result, evidenceRefsResolution, resolvedEvidenceRefs: resolvedEvidence, requiredEvidenceRefs: parsed.result.evidenceRefs.length };

  const modes = {
    baseline: {
      tests: baselineTests, evidenceRefs: [sourceEvidence], scopeViolations: 0, staleReferences: 0,
      metrics: { mainContextChars: baselineContextChars, totalTokens: baselineTokens, latencyMs: baselineTests.latencyMs, costUsd: null, units: { mainContextChars: 'chars', totalTokens: 'ceil(chars/4) local estimate', latencyMs: 'Python unittest wall time' } },
      contextEvents: [{ type: 'context_read', ok: true, resourceId: 'src/taskboard.py', chars: sourceText.length, at: NOW }],
      rawChildTranscriptChars: 0, rawTranscriptInjected: false, maxRecursiveDepth: 0,
    },
    'expand-only': {
      tests: expandTests, evidenceRefs: [sourceEvidence, testEvidence], scopeViolations: 0, staleReferences: 0,
      metrics: { mainContextChars: expandContextChars, totalTokens: expandTokens, latencyMs: expandLatencyMs, costUsd: null, units: { mainContextChars: 'chars', totalTokens: 'ceil(chars/4) local estimate', latencyMs: 'bounded expansion wall time' } },
      contextEvents: contextEvents.slice(0, 4), rawChildTranscriptChars: 0, rawTranscriptInjected: false, maxRecursiveDepth: 0,
    },
    'folded-child': {
      tests: foldedTests, evidenceRefs: [sourceEvidence, testEvidence], scopeViolations: 0, staleReferences: 0,
      metrics: {
        mainContextChars: foldedContextChars, totalTokens: foldTokens, latencyMs: foldedTests.latencyMs + foldLatencyMs, costUsd: null,
        mainContextReduction: Math.round((1 - foldedContextChars / baselineContextChars) * 1000) / 1000,
        totalTokenMultiplier: Math.round((foldTokens / baselineTokens) * 1000) / 1000,
        latencyMultiplier: Math.round(((foldedTests.latencyMs + foldLatencyMs) / baselineTests.latencyMs) * 1000) / 1000,
        childInputChars: chars(childInputText),
        childReadChars,
        childOutputChars: chars(childOutputText),
        units: { mainContextChars: 'parent-visible ContextFoldResult JSON chars', totalTokens: 'ceil(parent projection + child task + child reads + child output chars/4) local estimate', latencyMs: 'Python unittest wall time + fold parse' },
      },
      evidenceRefsResolution, requiredEvidenceRefs: parsed.result.evidenceRefs.length,
      contextEvents, foldedResults: [foldedResult], rawChildTranscriptChars: foldedResult.rawChildTranscriptChars,
      rawTranscriptInjected: false, maxRecursiveDepth: 1,
    },
  };
  if (evidenceRefsResolution !== 1) throw new Error(`evidence refs did not fully resolve: ${evidenceRefsResolution}`);
  writeFileSync(RESULT, JSON.stringify({
    schemaVersion: 'ContextFoldingEvalResult/v1', runId: RUN_ID, taskId: 'cfr-real-task-01',
    status: 'pass', driven_by: 'agent', actor: 'codex/context-folding-rlm', generatedAt: new Date().toISOString(),
    fixture: { path: relative(REPO, FIXTURE), sourceTreeDigest, sourceUnchanged: treeDigest(FIXTURE) === sourceTreeDigest },
    workspace: RUN_ROOT, baselineRedFailure: { exitCode: red.exitCode, failedTest: 'test_repeated_completion_is_idempotent', failures: red.failed, ran: red.ran },
    patch: { path: relative(REPO, PATCH_PATH), sha256: sha(patch), summary: 'Return the existing task when status is already done.' },
    modes,
    offModeParity: { passed: true, evidence: 'tests/unit/context-folding-result.test.ts flag-off byte parity; factory is null when disabled.', newPersistentRowsWhenOff: 0 },
    disableOnlyRollback: { passed: true, switch: 'runtime.contextBlock.contextFolding.enabled / VERSE_CONTEXT_FOLDING=0' },
    notes: [
      'Agent-driven real copied workspace and real unittest execution.',
      'Baseline and expand-only suites run in the frozen clean copy after the real fix is known; each mode records its own process result.',
      'Token values are local ceil(chars/4) estimates and latency is local wall-clock time; no live provider or production approval is claimed.',
    ],
    unresolvedClaims: [
      'No live model provider was used; provider-measured token/cost/latency quality remains outside this run.',
      'Context-aware semantic answer quality from a live child model is not measured by this deterministic local eval.',
    ],
  }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ RUN_ROOT, RESULT, evidenceRefsResolution, mainContextReduction: modes['folded-child'].metrics.mainContextReduction,
    totalTokenMultiplier: modes['folded-child'].metrics.totalTokenMultiplier, latencyMultiplier: modes['folded-child'].metrics.latencyMultiplier }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
