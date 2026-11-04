import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { artifactPath } from './agent-first-trials.mjs';
import { evaluateAblation } from './paired-ablation.mjs';
import { summarizeTf0592Trials } from '../rsi-tf0592-statistical-adjudication.mjs';
import { sha256File } from '../rsi-tf0604-baseline.mjs';
import { buildResponsesRequest, parseResponsesReply } from './rsi-responses-provider.mjs';

export const BENEFIT_ARMS = Object.freeze(['sekb-off', 'sekb-shadow', 'sekb-confirmed']);
const CORPUS = 'harness/specs/fixtures/rsi-evidence-loop/tf0604/task-corpus.v1.json';
const TASKS = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
const POLICY = 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json';
const SOURCES = [CORPUS, TASKS, POLICY, 'scripts/lib/rsi-benefit-eval.mjs', 'scripts/lib/rsi-benefit-eval.d.mts',
  'scripts/rsi-benefit-eval.mjs', 'scripts/lib/rsi-responses-provider.mjs', 'scripts/lib/rsi-responses-provider.d.mts',
  'scripts/lib/paired-ablation.mjs', 'scripts/lib/reliability-aggregation.mjs',
  'scripts/rsi-tf0604-baseline.mjs', 'scripts/lib/entrypoint.mjs',
  'scripts/rsi-tf0592-statistical-adjudication.mjs', 'scripts/lib/agent-first-trials.mjs',
  'tests/unit/rsi-benefit-eval.test.ts', 'tests/unit/rsi-responses-provider.test.ts',
  'harness/specs/tasks/rsi-benefit-eval.md'];
const FLAGS = {
  'sekb-off': { enabled: false, shadowEvaluation: false, injection: false },
  'sekb-shadow': { enabled: true, shadowEvaluation: true, injection: false },
  'sekb-confirmed': { enabled: true, shadowEvaluation: true, injection: true },
};
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const benefitDigest = (value) => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fileDigest = (path) => benefitDigest(readFileSync(path));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function write(path, value, exclusive = false) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) writeFileSync(path, bytes, { flag: 'wx' });
  else {
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, bytes, { flag: 'wx' });
    renameSync(temp, path);
  }
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
}
function taskSet(root) {
  const corpus = read(join(root, CORPUS));
  const historical = read(join(root, TASKS));
  return corpus.cases.map((entry) => {
    const task = historical.tasks.find((task) => task.id === entry.id);
    assert(task, `task-source-missing:${entry.id}`);
    return {
      id: entry.id, taskId: entry.taskId, split: historical.split.heldOut.includes(entry.id) ? 'held-out' : 'public',
      safetyRequired: entry.safetyRequired === true, anchor: entry.anchor ?? null,
      negativeExpectedOutcome: entry.negativeExpectedOutcome ?? 'fail',
      prompt: task.input.prompt, oracleDigest: benefitDigest(task.oracle),
      oracle: { commands: task.oracle.commandLines, testPaths: task.oracle.testPaths,
        expectedSkips: task.oracle.expectedSkips, inputDigests: task.oracle.inputDigests },
    };
  });
}
function schedule(tasks) {
  // Rotate arm order within each case/repeat: no all-off-then-all-treatment run.
  return tasks.flatMap((task, index) => [1, 2, 3].flatMap((repeat) => {
    const offset = (index + repeat - 1) % BENEFIT_ARMS.length;
    return BENEFIT_ARMS.map((_, armIndex) => {
      const arm = BENEFIT_ARMS[(armIndex + offset) % BENEFIT_ARMS.length];
      return { id: `${task.id}-${repeat}-${arm}`, caseId: task.id, repeat, arm,
        caseDigest: benefitDigest(task), pairSeed: index * 3 + repeat, flagsDigest: benefitDigest(FLAGS[arm]) };
    });
  })).map((slot, position) => ({ ...slot, position }));
}

export function createBenefitPlan(root, options = {}) {
  root = resolve(root);
  const tasks = taskSet(root), policy = read(join(root, POLICY));
  assert.equal(tasks.length, 24, 'existing-corpus-required');
  assert.equal(policy.taskSet.k, 3); assert.equal(policy.taskSet.minimumCompleteCases, 20);
  assert.equal(policy.promotion.thresholds.passKAbsoluteImprovement.minimum, 0.05);
  assert.equal(policy.budgets.costCeiling.maxRelativeIncrease, 0.1);
  const endpoint = options.endpoint ?? 'http://127.0.0.1:3065/v1/responses';
  const url = new URL(endpoint);
  assert(!url.username && !url.password && !url.search && !url.hash, 'credential-free-endpoint-required');
  assert(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'invalid-provider-endpoint');
  const model = options.model ?? 'space-bunny';
  const mode = options.mode ?? 'offline';
  assert(['offline', 'measured'].includes(mode), 'invalid-evaluation-mode');
  assert(text(model) && text(options.actor ?? 'codex/rsi-benefit-eval'), 'actor-and-model-required');
  const candidate = options.candidate ?? {
    id: 'offline-context-control', kind: 'synthetic-control', sourceCaseIds: ['offline-training-control'],
    context: 'Offline SEKB context marker. This control does not contain a solution to any evaluation task.',
  };
  assert(text(candidate.id) && candidate.kind === (mode === 'offline' ? 'synthetic-control' : 'confirmed-sekb') && text(candidate.context), 'candidate-kind-mismatch');
  assert.deepEqual(Object.keys(candidate).sort(), ['context', 'id', 'kind', 'sourceCaseIds'], 'undeclared-candidate-fields');
  assert(Array.isArray(candidate.sourceCaseIds) && candidate.sourceCaseIds.length > 0, 'candidate-provenance-required');
  assert(candidate.sourceCaseIds.every((id) => text(id) && !tasks.some((task) => task.id === id)), 'training-evaluation-overlap');
  const maxProviderCalls = mode === 'offline' ? 0 : options.maxProviderCalls;
  const maxTotalTokens = mode === 'offline' ? null : options.maxTotalTokens;
  if (mode === 'measured') assert(Number.isSafeInteger(maxProviderCalls) && maxProviderCalls >= 216
    && Number.isSafeInteger(maxTotalTokens) && maxTotalTokens > 0, 'explicit-measurement-budget-required');
  const paths = [...new Set([...SOURCES, ...tasks.flatMap((task) => Object.keys(task.oracle.inputDigests))])].sort();
  // Source bindings use the repository's canonical text bytes across LF/CRLF
  // checkouts. Raw run receipts and their manifest remain byte-addressed.
  const bindings = Object.fromEntries(paths.map((path) => [path, sha256File(artifactPath(root, path))]));
  const commit = git(root, ['rev-parse', 'HEAD']);
  return {
    schemaVersion: 'RsiBenefitPlan/v1', driven_by: 'agent', actor: options.actor ?? 'codex/rsi-benefit-eval',
    runId: options.runId ?? randomUUID(), evidenceKind: mode === 'offline' ? 'synthetic-wiring-fixture' : 'live-provider',
    source: { commit, tree: git(root, ['rev-parse', 'HEAD^{tree}']), bindings,
      boundary: 'Bindings pin working bytes; measured receipts also require a clean committed evaluator at final check.' },
    provider: { endpoint, model, maxOutputTokens: 2048 },
    budget: { providerCallsAuthorized: maxProviderCalls, maxTotalTokens, network: mode === 'offline' ? 'none' : 'declared-provider-only', retries: 0 },
    design: { k: 3, minimumCompleteCases: 20, primaryComparison: 'sekb-confirmed-vs-off', order: 'rotating-three-arm',
      unit: 'caseId', minimumImprovement: 0.05, costIncreaseMaximum: 0.1 },
    arms: structuredClone(FLAGS), candidate, candidateDigest: benefitDigest(candidate), tasks, policy, slots: schedule(tasks),
    claims: { realHuman: false, liveProvider: false, benefit: false, promotionReady: false, productLocksChanged: false },
  };
}

export function validateBenefitPlan(plan, root) {
  assert.equal(plan?.schemaVersion, 'RsiBenefitPlan/v1');
  assert(text(plan.runId) && plan.driven_by === 'agent' && text(plan.actor), 'plan-identity');
  assert(['synthetic-wiring-fixture', 'live-provider'].includes(plan.evidenceKind), 'invalid-evidence-kind');
  const expected = createBenefitPlan(root, { endpoint: plan.provider?.endpoint, model: plan.provider?.model,
    actor: plan.actor, runId: plan.runId, candidate: plan.candidate,
    mode: plan.evidenceKind === 'live-provider' ? 'measured' : 'offline',
    maxProviderCalls: plan.budget?.providerCallsAuthorized, maxTotalTokens: plan.budget?.maxTotalTokens });
  for (const field of ['provider', 'budget', 'design', 'arms', 'candidate', 'candidateDigest', 'tasks', 'policy', 'slots', 'claims']) {
    assert.deepEqual(plan[field], expected[field], `frozen-${field}-drift`);
  }
  assert.deepEqual(plan.source.bindings, expected.source.bindings, 'evaluator-source-drift');
  assert.equal(git(root, ['rev-parse', `${plan.source.commit}^{tree}`]), plan.source.tree, 'candidate-tree-drift');
  git(root, ['merge-base', '--is-ancestor', plan.source.commit, 'HEAD']);
  return true;
}

export function writeBenefitPlan(root, directory, options = {}) {
  const plan = createBenefitPlan(root, options);
  directory = resolve(directory);
  assert(!existsSync(directory) || readdirSync(directory).length === 0, 'new-run-directory-required');
  write(join(directory, 'plan.json'), plan, true);
  writeFileSync(join(directory, 'plan.sha256'), `${fileDigest(join(directory, 'plan.json'))}\n`, { flag: 'wx' });
  return plan;
}
function loadPlan(root, directory) {
  const plan = read(artifactPath(directory, 'plan.json'));
  assert.equal(readFileSync(artifactPath(directory, 'plan.sha256'), 'utf8').trim(), fileDigest(join(directory, 'plan.json')), 'plan-seal-drift');
  validateBenefitPlan(plan, root);
  return plan;
}

export function buildBenefitRequest(plan, slot) {
  const task = plan.tasks.find((entry) => entry.id === slot.caseId);
  assert(task && plan.slots.some((entry) => entry.id === slot.id), 'unknown-trial');
  // Only this projection reaches the subject. No oracle, split or reference solution.
  const instructions = 'Perform the supplied task. Treat retrieved experience as advisory; preserve existing safety and authorization rules.';
  return buildResponsesRequest({ model: plan.provider.model, maxOutputTokens: plan.provider.maxOutputTokens,
    instructions: slot.arm === 'sekb-confirmed' ? `${instructions}\n${plan.candidate.context}` : instructions,
    input: task.prompt });
}

function offlineResponse(plan, slot) {
  const protectedTask = (task) => task.safetyRequired || task.anchor === 'positive';
  const improved = new Set(plan.tasks.filter((task) => !protectedTask(task)).slice(0, 6).map((task) => task.id));
  const task = plan.tasks.find((task) => task.id === slot.caseId);
  const correct = protectedTask(task) || slot.arm === 'sekb-confirmed' && improved.has(task.id);
  const inputTokens = slot.arm === 'sekb-confirmed' ? 1020 : 1000;
  return {
    id: `offline-${slot.id}`, model: plan.provider.model, status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ caseId: task.id, probeValue: correct ? 'ok' : 'wrong' }) }] }],
    usage: { input_tokens: inputTokens, output_tokens: 100, total_tokens: inputTokens + 100 },
  };
}
const recordPath = (slot) => `trials/${slot.id}.json`;
const startPath = (slot) => `started/${slot.id}.json`;

function trialReceipt(plan, slot, interrupted = false) {
  const request = buildBenefitRequest(plan, slot);
  return {
    schemaVersion: 'RsiBenefitTrial/v1', driven_by: 'agent', actor: `${plan.actor}/executor`,
    planDigest: benefitDigest(plan), slot, evidenceKind: plan.evidenceKind,
    request, requestDigest: benefitDigest(request),
    runtime: { flags: plan.arms[slot.arm], flagsDigest: slot.flagsDigest,
      candidateDigest: plan.candidateDigest, injectionDigest: slot.arm === 'sekb-confirmed' ? benefitDigest(plan.candidate.context) : null,
      isolationId: `${plan.runId}/${slot.id}`, runtimeEffectMeasured: plan.evidenceKind === 'live-provider' },
    execution: { status: interrupted ? 'crash' : 'completed', failureClass: interrupted ? 'infrastructure' : null,
      attempts: 1, providerCalls: 0, wallClockMs: null, costUsd: null, toolEvents: [],
      runPosition: slot.position, startedAt: null, endedAt: null,
      measurementBasis: plan.evidenceKind === 'live-provider' ? 'live-provider' : 'synthetic-control',
      note: interrupted ? 'interrupted slot preserved; no retry' : 'No model or historical task execution; protocol control only.' },
    rawResponse: interrupted ? null : offlineResponse(plan, slot), providerAttempts: [], grader: null,
  };
}

export function runOfflineBenefit(root, directory, options = {}) {
  directory = resolve(directory);
  const plan = loadPlan(root, directory), limit = options.limit ?? plan.slots.length;
  assert.equal(plan.evidenceKind, 'synthetic-wiring-fixture', 'offline-driver-cannot-execute-measured-plan');
  assert(Number.isInteger(limit) && limit >= 0, 'invalid-trial-limit');
  const lock = join(directory, '.run.lock');
  const handle = openSync(lock, 'wx');
  let written = 0, resumed = 0;
  try {
    for (const slot of plan.slots) {
      const path = artifactPath(directory, recordPath(slot));
      if (existsSync(path)) { readTrial(plan, slot, directory); resumed++; continue; }
      if (written >= limit) break;
      const journal = artifactPath(directory, startPath(slot));
      const interrupted = existsSync(journal);
      if (interrupted) assert.deepEqual(read(journal), { planDigest: benefitDigest(plan), slotId: slot.id }, 'interrupted-plan-drift');
      if (!interrupted) write(journal, { planDigest: benefitDigest(plan), slotId: slot.id }, true);
      const startedAt = performance.now();
      const receipt = trialReceipt(plan, slot, interrupted);
      receipt.execution.startedAt = new Date().toISOString();
      receipt.execution.wallClockMs = Math.max(0, performance.now() - startedAt);
      receipt.execution.endedAt = new Date().toISOString();
      write(path, receipt, true);
      written++;
    }
  } finally { closeSync(handle); unlinkSync(lock); }
  return { written, resumed, planned: plan.slots.length, providerCalls: 0 };
}

function readTrial(plan, slot, directory, supplied) {
  const path = artifactPath(directory, recordPath(slot));
  if (supplied === undefined && !existsSync(path)) return null;
  const row = supplied ?? read(path), expected = trialReceipt(plan, slot);
  assert.deepEqual(Object.keys(row).sort(), Object.keys(expected).sort(), 'undeclared-trial-fields');
  for (const field of ['schemaVersion', 'driven_by', 'actor', 'planDigest', 'slot', 'evidenceKind', 'request', 'requestDigest', 'runtime']) {
    assert.deepEqual(row[field], expected[field], `trial-${field}-drift:${slot.id}`);
  }
  if (supplied === undefined) assert.deepEqual(read(artifactPath(directory, startPath(slot))), { planDigest: benefitDigest(plan), slotId: slot.id }, 'start-receipt-drift');
  const execution = row.execution;
  assert.equal(execution.attempts, 1, 'hidden-retry');
  const measured = plan.evidenceKind === 'live-provider';
  assert.equal(execution.measurementBasis, measured ? 'live-provider' : 'synthetic-control', 'measurement-basis-drift');
  assert((execution.costUsd === null || measured && Number.isFinite(execution.costUsd) && execution.costUsd >= 0)
    && Array.isArray(execution.toolEvents) && Array.isArray(row.providerAttempts), 'invalid-cost-receipt');
  if (!measured) assert(execution.providerCalls === 0 && row.providerAttempts.length === 0 && row.grader === null, 'offline-provider-or-grader-claim');
  const attempts = measured ? readProviderAttempts(plan, row) : [];
  assert(Number.isFinite(execution.wallClockMs) && execution.wallClockMs >= 0, 'invalid-duration');
  assert.equal(execution.runPosition, slot.position, 'actual-execution-order-drift');
  assert(typeof execution.startedAt === 'string' && typeof execution.endedAt === 'string'
    && Number.isFinite(Date.parse(execution.startedAt)) && Number.isFinite(Date.parse(execution.endedAt))
    && Date.parse(execution.endedAt) >= Date.parse(execution.startedAt), 'invalid-execution-timestamps');
  assert(['completed', 'timeout', 'crash'].includes(execution.status), 'invalid-execution-status');
  if (execution.status !== 'completed') {
    assert(row.rawResponse === null && execution.failureClass === 'infrastructure', 'invalid-interrupted-trial');
    return { row, outcome: execution.status, failureClass: 'infrastructure',
      tokens: attempts.length && attempts.every((attempt) => attempt.usage) ? attempts.reduce((n, attempt) => n + attempt.usage.totalTokens, 0) : null,
      turns: attempts.length || null, toolCalls: execution.toolEvents.length };
  }
  assert.equal(execution.failureClass, null, 'completed-failure-class');
  const response = parseResponsesReply(row.rawResponse);
  assert.equal(response.model, plan.provider.model, 'resolved-model-drift');
  if (!measured) assert.equal(response.id, `offline-${slot.id}`, 'response-identity-reused-or-drifted');
  else assert.deepEqual(row.rawResponse, row.providerAttempts.at(-1)?.rawResponse, 'terminal-provider-response-drift');
  assert.equal(response.functionCalls.length, 0, 'unconsumed-terminal-tool-call');
  let success = false;
  if (response.status === 'completed') {
    if (measured) success = gradeMeasuredObservation(plan, slot, row);
    else try { const answer = JSON.parse(response.text); success = answer.caseId === slot.caseId && answer.probeValue === 'ok'; } catch { /* Malformed output is an agent failure. */ }
  }
  const outcome = response.status === 'completed' ? success ? 'pass' : 'fail' : 'missing';
  return { row, outcome, failureClass: outcome === 'pass' ? null : 'agent',
    tokens: measured ? attempts.every((attempt) => attempt.usage) ? attempts.reduce((n, attempt) => n + attempt.usage.totalTokens, 0) : null : response.usage?.totalTokens ?? null,
    turns: measured ? attempts.length : 1, toolCalls: execution.toolEvents.filter((event) => event.type === 'tool-call').length };
}

function readProviderAttempts(plan, row) {
  assert.equal(row.execution.providerCalls, row.providerAttempts.length, 'provider-attempt-coverage');
  const calls = [];
  const attempts = row.providerAttempts.map((attempt, index) => {
    assert.deepEqual(Object.keys(attempt).sort(), ['endpoint', 'parsedResponse', 'rawResponse', 'request'], 'undeclared-provider-attempt-fields');
    assert.equal(attempt.endpoint, plan.provider.endpoint, 'provider-endpoint-drift');
    assert.equal(attempt.request?.model, plan.provider.model, 'provider-model-drift');
    assert.equal(attempt.request?.instructions, row.request.instructions, 'provider-context-drift');
    assert.deepEqual(Object.keys(attempt.request).sort(), Object.keys(row.request).sort(), 'provider-request-fields');
    for (const field of ['store', 'stream', 'truncation', 'max_output_tokens']) assert.deepEqual(attempt.request[field], row.request[field], 'provider-request-policy');
    if (index === 0) assert.deepEqual(attempt.request, row.request, 'initial-provider-request-drift');
    const parsed = parseResponsesReply(attempt.rawResponse);
    assert.deepEqual(attempt.parsedResponse, parsed, 'raw-parsed-response-drift');
    assert.equal(parsed.model, plan.provider.model, 'resolved-model-drift');
    calls.push(...parsed.functionCalls);
    return parsed;
  });
  for (let index = 0; index < attempts.length - 1; index++) {
    assert(attempts[index].status === 'completed' && attempts[index].functionCalls.length > 0, 'undeclared-provider-retry');
    const nextInput = row.providerAttempts[index + 1].request.input;
    const previousInput = row.providerAttempts[index].request.input;
    const toolOutputs = attempts[index].functionCalls.map((call) => {
      const event = row.execution.toolEvents.find((event) => event.callId === call.callId);
      assert(event && event.name === call.name && event.arguments === call.arguments && typeof event.output === 'string', 'tool-result-not-bound');
      return { type: 'function_call_output', call_id: call.callId, output: event.output };
    });
    const history = Array.isArray(previousInput) ? previousInput : [{ role: 'user', content: previousInput }];
    assert.deepEqual(nextInput, [...history, ...row.providerAttempts[index].rawResponse.output, ...toolOutputs], 'tool-continuation-context-drift');
  }
  assert(row.execution.toolEvents.every((event) => event?.type === 'tool-call' && text(event.callId)), 'invalid-tool-events');
  assert.deepEqual(row.execution.toolEvents.map((event) => event.callId).sort(), calls.map((call) => call.callId).sort(), 'tool-call-coverage');
  assert.equal(new Set(calls.map((call) => call.callId)).size, calls.length, 'repeated-tool-effect');
  if (row.execution.status === 'completed') assert(attempts.length > 0, 'missing-provider-receipt');
  return attempts;
}

function gradeMeasuredObservation(plan, slot, row) {
  const task = plan.tasks.find((task) => task.id === slot.caseId), grader = row.grader;
  assert(grader?.driven_by === 'agent' && text(grader.actor) && grader.actor !== row.actor && grader.actor !== plan.actor, 'independent-grader-required');
  assert.equal(grader.oracleDigest, task.oracleDigest, 'grader-oracle-drift');
  assert.deepEqual(grader.commands, task.oracle.commands, 'grader-command-drift');
  assert.equal(grader.responseDigest, benefitDigest(row.rawResponse), 'grader-response-drift');
  assert(grader.isolation?.hiddenOracleVisible === false && grader.isolation?.unapprovedEgress === false
    && grader.isolation?.candidateChangedEvaluator === false, 'evaluation-contamination');
  assert(Array.isArray(grader.reports) && grader.reports.length === grader.commands.length, 'grader-report-coverage');
  const tested = new Set(), outcomes = [];
  assert.equal(task.oracle.expectedSkips, 0, 'zero-skip-oracle-required');
  for (const [index, item] of grader.reports.entries()) {
    assert.equal(item.command, task.oracle.commands[index], 'grader-report-command-drift');
    assert(Number.isInteger(item.exitCode) && Array.isArray(item.report?.testResults), 'grader-result-missing');
    const assertions = item.report.testResults.flatMap((suite) => {
      const path = typeof suite.name === 'string' ? suite.name.replaceAll('\\', '/') : '';
      for (const required of task.oracle.testPaths) if (path === required || path.endsWith(`/${required}`)) tested.add(required);
      assert(Array.isArray(suite.assertionResults), 'grader-assertions-missing');
      return suite.assertionResults;
    });
    assert(assertions.length > 0 && assertions.length === item.report.numTotalTests, 'grader-test-count-drift');
    const failed = assertions.filter((entry) => entry.status === 'failed').length;
    const passed = assertions.filter((entry) => entry.status === 'passed').length;
    assert.equal(item.report.numFailedTests, failed, 'grader-failed-count-drift');
    assert.equal(item.report.numPassedTests, passed, 'grader-passed-count-drift');
    assert.equal(item.report.numSkippedTests ?? 0, task.oracle.expectedSkips, 'grader-skip-budget');
    assert.equal(item.report.numTodoTests ?? 0, 0, 'grader-todo-budget');
    outcomes.push(item.exitCode === 0 && failed === 0 && passed === assertions.length && item.report.numPendingTests === 0 && item.report.success === true);
  }
  assert(task.oracle.testPaths.every((path) => tested.has(path)), 'grader-test-path-coverage');
  return outcomes.every(Boolean);
}

export function recordMeasuredBenefitTrials(root, directory, receipts) {
  directory = resolve(directory);
  const plan = loadPlan(root, directory);
  assert.equal(plan.evidenceKind, 'live-provider', 'measured-receipt-requires-measured-plan');
  assert(Array.isArray(receipts) && receipts.length > 0, 'receipt-array-required');
  assert.equal(new Set(receipts.map((receipt) => receipt?.slot?.id)).size, receipts.length, 'duplicate-import-slot');
  // Import only collector output. Existing receipts are immutable, never retries.
  const lock = join(directory, '.run.lock'), handle = openSync(lock, 'wx');
  try {
    const existing = plan.slots.filter((slot) => existsSync(artifactPath(directory, recordPath(slot))));
    assert(existing.every((slot, index) => slot.position === index), 'existing-schedule-gap');
    const admitted = receipts.map((receipt) => {
      const slot = plan.slots.find((slot) => slot.id === receipt?.slot?.id);
      assert(slot, 'unknown-trial');
      const path = artifactPath(directory, recordPath(slot)), journal = artifactPath(directory, startPath(slot));
      assert(!existsSync(path) && !existsSync(journal), 'trial-already-recorded');
      return { slot, path, journal, receipt, validated: readTrial(plan, slot, directory, receipt) };
    });
    assert(admitted.every(({ slot }, index) => slot.position === existing.length + index), 'import-schedule-drift');
    const prior = existing.length ? readTrial(plan, existing.at(-1), directory).row : null;
    const ordered = [...(prior ? [prior] : []), ...admitted.map(({ receipt }) => receipt)];
    assert(ordered.every((row, index) => index === 0 || Date.parse(row.execution.startedAt) >= Date.parse(ordered[index - 1].execution.endedAt)), 'collector-order-or-overlap');
    for (const { slot, path, journal, receipt } of admitted) {
      write(journal, { planDigest: benefitDigest(plan), slotId: slot.id }, true);
      write(path, receipt, true);
    }
    return admitted.map(({ validated }) => validated);
  } finally { closeSync(handle); unlinkSync(lock); }
}

export function summarizeBenefitRun(root, directory, actor = 'codex/rsi-benefit-verifier') {
  directory = resolve(directory);
  assert(!existsSync(join(directory, '.run.lock')), 'run-in-progress');
  const plan = loadPlan(root, directory);
  assert(text(actor) && actor !== plan.actor && actor !== `${plan.actor}/executor`, 'distinct-verifier-role-required');
  const records = new Map(plan.slots.map((slot) => [slot.id, readTrial(plan, slot, directory)]));
  const actual = [...records.values()].filter(Boolean);
  assert(actual.every((record, index) => index === 0 || Date.parse(record.row.execution.startedAt) >= Date.parse(actual[index - 1].row.execution.endedAt)), 'collector-order-or-overlap');
  assert(actual.every((record) => record.row.grader?.actor !== actor), 'verifier-cannot-grade-own-run');
  const responseIds = actual.flatMap((record) => record.row.providerAttempts.map((attempt) => attempt.rawResponse.id));
  assert.equal(new Set(responseIds).size, responseIds.length, 'reused-provider-response');
  const providerCalls = actual.reduce((total, record) => total + record.row.execution.providerCalls, 0);
  assert(providerCalls <= plan.budget.providerCallsAuthorized, 'provider-call-budget-exceeded');
  const totalTokens = actual.every((record) => record.tokens !== null) ? actual.reduce((n, record) => n + record.tokens, 0) : null;
  if (totalTokens !== null && plan.budget.maxTotalTokens !== null) assert(totalTokens <= plan.budget.maxTotalTokens, 'token-budget-exceeded');
  const corpus = { cases: plan.tasks.map((task) => ({ id: task.id, taskId: task.taskId, safetyRequired: task.safetyRequired,
    ...(task.anchor ? { anchor: task.anchor } : {}), negativeExpectedOutcome: task.negativeExpectedOutcome })) };
  const pair = (treatment) => summarizeTf0592Trials(corpus, { cases: plan.tasks.map((task) => ({ caseId: task.id,
    trials: plan.slots.filter((slot) => slot.caseId === task.id && ['sekb-off', treatment].includes(slot.arm)).map((slot) => {
      const trial = records.get(slot.id);
      return { arm: slot.arm === 'sekb-off' ? 'baseline' : 'treatment', repeat: slot.repeat,
        outcome: trial?.outcome ?? 'missing', failureClass: trial?.failureClass ?? (trial ? null : 'infrastructure'),
        tokens: trial?.tokens ?? null, turns: trial?.turns ?? null, toolCalls: trial?.toolCalls ?? null,
        wallClockMs: trial?.row.execution.wallClockMs ?? null, cost: trial?.row.execution.costUsd ?? null };
    }),
  })) }, plan.policy);
  const confirmed = pair('sekb-confirmed'), shadow = pair('sekb-shadow');
  const splitEffects = Object.fromEntries(['public', 'held-out'].map((split) => {
    const tasks = plan.tasks.filter((task) => task.split === split);
    const runs = (arm) => plan.slots.filter((slot) => slot.arm === arm && tasks.some((task) => task.id === slot.caseId)).map((slot) => {
      const record = records.get(slot.id), task = tasks.find((task) => task.id === slot.caseId);
      return { caseId: slot.caseId, repeat: slot.repeat, success: record?.outcome === 'pass', outcome: record?.outcome ?? 'missing',
        safetyRequired: task.safetyRequired, ...(task.anchor ? { anchor: task.anchor } : {}), negativeExpectedOutcome: task.negativeExpectedOutcome };
    });
    const result = evaluateAblation({ baselineRuns: runs('sekb-off'), treatmentRuns: runs('sekb-confirmed'),
      preRegistered: { primaryMetric: 'success', k: 3, minCases: 20, maxFlakeCases: 1 } });
    return [split, { cases: tasks.length, completePairs: result.effect.pairCount, passK: { off: result.baseline.passK, confirmed: result.treatment.passK }, effect: result.effect, verdict: result.verdict }];
  }));
  const missing = plan.slots.filter((slot) => records.get(slot.id) === null).map((slot) => slot.id);
  const incomplete = plan.slots.filter((slot) => records.get(slot.id) && !['pass', 'fail'].includes(records.get(slot.id).outcome)).map((slot) => slot.id);
  const measured = plan.evidenceKind === 'live-provider';
  const benefitStatus = !measured ? 'insufficient-evidence'
    : confirmed.promotion.status === 'eliminate' || shadow.promotion.status === 'eliminate' ? 'eliminate'
      : missing.length || incomplete.length || totalTokens === null ? 'insufficient-evidence'
        : shadow.runStatus !== 'pass' ? 'hold' : confirmed.promotion.status;
  return {
    schemaVersion: 'RsiBenefitReport/v1', driven_by: 'agent', actor, planDigest: benefitDigest(plan),
    evidenceKind: plan.evidenceKind, status: measured ? benefitStatus : 'synthetic-wiring-only',
    coverage: { planned: plan.slots.length, recorded: records.size - missing.length, missing, incomplete },
    comparisons: { confirmedVsOff: confirmed, shadowVsOff: shadow }, splitEffects,
    wiring: { offShadowInputsIdentical: true, confirmedCandidateBound: true, runtimeEffectMeasured: measured },
    benefit: { status: benefitStatus, numericalStatus: confirmed.promotion.status,
      reasons: measured ? ['Benefit is scoped to the frozen task cohort; this is not product promotion or evidence of a complete RSI system.',
        ...confirmed.promotion.reasons] : ['Offline controls do not execute the historical tasks or measure model quality.',
        'A live executor, independent final-state oracle and runtime effect receipts are required.'] },
    cost: { measurementBasis: measured ? 'live-provider' : 'synthetic-control', providerCalls, totalTokens,
      actualCostUsd: measured && actual.every((record) => record.row.execution.costUsd !== null) ? actual.reduce((n, record) => n + record.row.execution.costUsd, 0) : null,
      missingUsageTrials: [...records.values()].filter((record) => record && record.tokens === null).length },
    claims: { benefit: measured && benefitStatus === 'promote', promotionReady: false, liveProvider: measured && providerCalls > 0, realHuman: false, productLocksChanged: false },
  };
}

function packFiles(directory) {
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name), rel = relative(directory, full).replaceAll('\\', '/');
    artifactPath(directory, rel);
    return entry.isDirectory() ? walk(full) : [rel];
  });
  return walk(directory).filter((path) => path !== 'SHA256SUMS').sort();
}
function allowedFiles(plan) {
  return new Set(['plan.json', 'plan.sha256', 'report.json', ...plan.slots.flatMap((slot) => [recordPath(slot), startPath(slot)])]);
}
export function sealBenefitRun(root, directory, actor) {
  directory = resolve(directory);
  const report = summarizeBenefitRun(root, directory, actor);
  write(join(directory, 'report.json'), report);
  const allowed = allowedFiles(loadPlan(root, directory)), files = packFiles(directory);
  assert(files.every((path) => allowed.has(path)), 'undeclared-pack-file');
  writeFileSync(join(directory, 'SHA256SUMS'), files.map((path) => `${fileDigest(join(directory, path))}  ${path}`).join('\n') + '\n');
  return report;
}
export function checkBenefitRun(root, directory) {
  const errors = [];
  let report;
  try {
    directory = resolve(directory);
    const saved = read(artifactPath(directory, 'report.json'));
    report = summarizeBenefitRun(root, directory, saved.actor);
    assert.deepEqual(saved, report, 'report-recomputation');
    const plan = loadPlan(root, directory), allowed = allowedFiles(plan), files = packFiles(directory);
    if (plan.evidenceKind === 'live-provider') {
      assert.equal(git(root, ['status', '--porcelain', '--', ...Object.keys(plan.source.bindings)]), '', 'measured-evaluator-uncommitted');
      for (const [path, digest] of Object.entries(plan.source.bindings)) {
        const committed = execFileSync('git', ['show', `${plan.source.commit}:${path}`], { cwd: root, windowsHide: true, encoding: 'utf8' });
        assert.equal(benefitDigest(committed.replace(/\r\n?/gu, '\n')), digest, 'measured-source-not-in-candidate');
      }
    }
    assert(files.every((path) => allowed.has(path)), 'undeclared-pack-file');
    const sums = files.map((path) => `${fileDigest(join(directory, path))}  ${path}`).join('\n') + '\n';
    assert.equal(readFileSync(artifactPath(directory, 'SHA256SUMS'), 'utf8'), sums, 'pack-digest-drift');
    assert.equal(report.coverage.missing.length, 0, 'unexecuted-slots');
    assert.equal(report.coverage.incomplete.length, 0, 'incomplete-slots');
  } catch (caught) { errors.push(caught.message); }
  return { passed: errors.length === 0, errors, evidenceKind: report?.evidenceKind ?? 'invalid',
    reportStatus: report?.status ?? 'invalid', benefitStatus: report?.benefit.status ?? 'insufficient-evidence',
    coverage: report?.coverage ?? null, claims: errors.length ? { benefit: false, promotionReady: false, liveProvider: false, realHuman: false }
      : report.claims };
}
