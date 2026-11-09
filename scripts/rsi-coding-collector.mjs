#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { benefitDigest, buildBenefitRequest, recordMeasuredBenefitTrials, sealBenefitRun, validateBenefitPlan, verifyCodingAdmission } from './lib/rsi-benefit-eval.mjs';
import { codingCollectorConfig, parseCodingEdits, reserveProviderTokens, TOOL_CODING_COLLECTOR } from './lib/rsi-coding-protocol.mjs';
import { collectToolCodingTrial } from './lib/rsi-coding-tool-loop.mjs';
import { createResponsesProvider } from './lib/rsi-responses-provider.mjs';
import { prepareGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } from './lib/rsi-live-grader.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function scratchPath(path) {
  const full = resolve(path), rel = relative(resolve('D:/tmp'), full);
  assert(rel && !rel.startsWith('..') && !rel.includes(':') && !existsSync(join(full, '.git')), 'collector-scratch-must-be-under-D-tmp');
  return full;
}

export function reservedCodingTokens(plan, rows) {
  return rows.reduce((total, row) => total + reserveProviderTokens(plan, row.providerAttempts), 0);
}

/** One immutable attempt. A retained dispatch marker is never a license to retry. */
export async function collectCodingTrial(options) {
  const { root, plan, slot, apiKey, scratch, supportRoot, provider, grade } = options;
  assert.deepEqual(plan.collector, codingCollectorConfig(plan.collector?.version), 'collector-config-drift');
  if (plan.collector.version === TOOL_CODING_COLLECTOR.version) return collectToolCodingTrial(options);
  const task = plan.tasks.find(task => task.id === slot.caseId);
  assert(task && plan.slots.some(item => benefitDigest(item) === benefitDigest(slot)), 'unknown-slot');
  const directory = scratchPath(join(scratch, slot.id));
  const request = buildBenefitRequest(plan, slot);
  const workspace = join(directory, 'workspace');
  const writeEvidence = (path, value) => {
    assert(!apiKey || !JSON.stringify(value).includes(apiKey), 'credential-in-evidence-rejected');
    write(path, value);
  };
  const startedAt = new Date().toISOString();
  const start = Date.now();
  write(join(directory, 'dispatch.json'), { driven_by: 'agent', actor: `${plan.actor}/executor`,
    planDigest: benefitDigest(plan), slot, requestDigest: benefitDigest(request), request, startedAt, attempts: 1 });
  const row = {
    schemaVersion: 'RsiBenefitTrial/v1', driven_by: 'agent', actor: `${plan.actor}/executor`,
    planDigest: benefitDigest(plan), slot, evidenceKind: plan.evidenceKind, request, requestDigest: benefitDigest(request),
    runtime: { flags: plan.arms[slot.arm], flagsDigest: slot.flagsDigest, candidateDigest: plan.candidateDigest,
      injectionDigest: slot.arm === 'sekb-confirmed' ? benefitDigest(plan.candidate.context) : null,
      isolationId: `${plan.runId}/${slot.id}`, runtimeEffectMeasured: true },
    edits: [], execution: { status: 'completed', failureClass: null, failureCategory: null, attempts: 1,
      providerCalls: 1, wallClockMs: 0, costUsd: null, toolEvents: [], runPosition: slot.position,
      startedAt, endedAt: null, measurementBasis: 'live-provider', note: 'Single JSON-edits request; independent reference-bound final-state grading.' },
    rawResponse: null, providerAttempts: [], grader: null,
  };
  let phase = 'provider';
  try {
    const send = provider ?? createResponsesProvider({ endpoint: plan.provider.endpoint, model: plan.provider.model,
      apiKey, timeoutMs: plan.collector.timeoutMs, maxOutputTokens: plan.provider.maxOutputTokens,
      reasoningEffort: plan.collector.reasoningEffort,
      ...(plan.collector.responseFormat === 'strict-json-schema' ? { jsonSchema: plan.collector.responseSchema } : {}) });
    const response = await send({ instructions: request.instructions, input: request.input });
    assert.deepEqual(response.request.body, request, 'dispatched-request-drift');
    row.providerAttempts.push({ endpoint: plan.provider.endpoint, request, rawResponse: response.rawResponse, parsedResponse: response.response });
    row.rawResponse = response.rawResponse;
    writeEvidence(join(directory, 'provider-response.json'), response);
    assert.equal(response.response.model, plan.provider.model, 'provider-model-drift');
    if (plan.collector.incompleteOutcome === 'known-output-limit-is-failure'
      && response.response.status === 'incomplete' && response.response.incompleteReason === 'max_output_tokens') {
      assert(response.response.usage !== null, 'output-limit-usage-missing');
      row.execution.failureCategory = 'model-output-limit';
      row.execution.note = 'Provider returned a bounded unsuccessful answer with known usage; no edits applied and no retry.';
    }
    if (response.response.status === 'completed') {
      phase = 'model-format';
      try { row.edits = parseCodingEdits(response.response.text, task); }
      catch (error) {
        row.execution.failureCategory = 'model-format';
        row.execution.note = `Rejected model output: ${error.message}`;
      }
      if (!row.execution.failureCategory) {
        phase = 'infrastructure';
        let result;
        if (grade) result = await grade(row.edits);
        else {
          const historical = resolveHistoricalTask(root, task.id, { codingCohort: true });
          assert.deepEqual(historical.baselineSetup ?? null, task.baselineSetup, 'collector-baseline-drift');
          await prepareGradeWorkspace({ root, task: historical, workspace, revision: task.source.base, edits: row.edits });
          result = await runLiveTaskOracles({ root, task: historical, workspace, outDir: join(directory, 'oracle'),
            timeoutMs: plan.collector.oracleTimeoutMs, supportRoot });
        }
        phase = result.failureClass === 'oracle-input-drift' ? 'oracle' : 'infrastructure';
        assert(!['oracle-input-drift', 'infrastructure'].includes(result.failureClass), `independent-grade-${result.failureClass}`);
        row.grader = { schemaVersion: 'RsiBenefitGrader/v1', driven_by: 'agent', actor: 'codex/rsi-independent-final-state-grader',
          workspaceRevision: task.source.base, baselineSetup: task.baselineSetup, oracleDigest: task.oracleDigest,
          oracleRevision: task.source.reference, oracleTestDigests: result.oracleTestDigests, oracleUnchanged: result.oracleUnchanged,
          failureClass: result.failureClass, diagnostics: result.diagnostics,
          commands: task.oracle.commands, responseDigest: benefitDigest(row.rawResponse), editsDigest: benefitDigest(row.edits),
          isolation: { hiddenOracleVisible: false, unapprovedEgress: false, candidateChangedEvaluator: false },
          reports: result.executions.map(entry => ({ command: entry.command, kind: entry.kind, exitCode: entry.exitCode, report: entry.report })) };
        if (!result.passed) row.execution.failureCategory = 'model';
      }
    }
  } catch (error) {
    row.execution.status = /timed out|timeout/iu.test(error.message) ? 'timeout' : 'crash';
    row.execution.failureClass = 'infrastructure';
    row.execution.failureCategory = phase;
    row.execution.note = apiKey ? String(error.message).split(apiKey).join('[REDACTED]') : String(error.message);
    row.rawResponse = null;
    if (!row.providerAttempts.length) row.providerAttempts.push({ endpoint: plan.provider.endpoint, request, rawResponse: null, parsedResponse: null });
  } finally {
    if (!grade && existsSync(workspace)) {
      assert(resolve(workspace).startsWith(resolve(directory) + sep), 'unsafe-workspace-cleanup');
      rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  row.execution.wallClockMs = Date.now() - start;
  row.execution.endedAt = new Date().toISOString();
  const bytes = JSON.stringify(row);
  assert(!apiKey || !bytes.includes(apiKey), 'credential-in-evidence-rejected');
  writeEvidence(join(directory, 'receipt.json'), row);
  write(join(directory, 'receipt-digest.json'), { driven_by: 'agent', actor: 'codex/rsi-collector-sealer', sha256: benefitDigest(row) });
  return row;
}

export async function runCodingCollector({ root = ROOT, directory, scratch, supportRoot, apiKey, limit = 216, campaignLedger }) {
  const plan = read(join(directory, 'plan.json'));
  validateBenefitPlan(plan, root);
  assert.equal(plan.evidenceKind, 'live-provider', 'measured-plan-required');
  assert.deepEqual(plan.collector, codingCollectorConfig(plan.collector?.version), 'coding-plan-required');
  assert(!plan.budget.campaign || campaignLedger?.campaignDigest === benefitDigest(plan.budget.campaign), 'campaign-ledger-required');
  verifyCodingAdmission(root, directory, plan);
  assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 216, 'invalid-slot-limit');
  assert.equal(read(join(supportRoot, 'node_modules/markdown-it/package.json')).version, '14.2.0', 'support-version-drift');
  scratch = scratchPath(scratch);
  mkdirSync(scratch, { recursive: true });
  const lock = join(scratch, 'collector.lock');
  if (existsSync(lock)) {
    const previous = read(lock);
    try { process.kill(previous.pid, 0); throw new Error('collector-in-progress'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    unlinkSync(lock);
  }
  write(lock, { pid: process.pid, planDigest: benefitDigest(plan) });
  let written = 0;
  try {
    // This recomputes admission before any paid request.
    sealBenefitRun(root, directory);
    for (const slot of plan.slots) {
      if (existsSync(join(directory, 'trials', `${slot.id}.json`))) continue;
      if (written >= limit) break;
      const receiptPath = join(scratch, slot.id, 'receipt.json');
      let row;
      if (existsSync(receiptPath)) row = read(receiptPath);
      else {
        assert(!existsSync(join(scratch, slot.id, 'dispatch.json')), 'interrupted-attempt-preserved-no-retry');
        const prior = plan.slots.slice(0, slot.position).map(s => read(join(directory, 'trials', `${s.id}.json`)));
        const knownTokens = reservedCodingTokens(plan, prior);
        const priorCalls = prior.reduce((sum, row) => sum + row.execution.providerCalls, 0);
        assert(priorCalls < plan.budget.providerCallsAuthorized, 'provider-call-budget-exhausted');
        const request = buildBenefitRequest(plan, slot);
        // UTF-8 bytes are a conservative input-token reserve; output is bounded by the provider.
        assert(knownTokens + Buffer.byteLength(JSON.stringify(request)) + plan.provider.maxOutputTokens <= plan.budget.maxTotalTokens, 'token-budget-exhausted');
        row = await collectCodingTrial({ root, plan, slot, apiKey, scratch, supportRoot,
          remainingTokens: plan.budget.maxTotalTokens - knownTokens,
          remainingProviderCalls: plan.budget.providerCallsAuthorized - priorCalls, campaignLedger });
      }
      const [record] = recordMeasuredBenefitTrials(root, directory, [row]);
      written++;
      console.log(JSON.stringify({ slot: slot.id, position: slot.position, outcome: record.outcome,
        failureCategory: row.execution.failureCategory, usage: row.providerAttempts[0]?.parsedResponse?.usage ?? null }));
      if (row.execution.failureClass === 'infrastructure'
        && (plan.collector.infrastructurePolicy !== 'retain-slot-and-continue' || row.execution.failureCategory === 'oracle')) break;
    }
    return { written, report: sealBenefitRun(root, directory) };
  } finally { unlinkSync(lock); }
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'run-dir': { type: 'string' }, scratch: { type: 'string' },
      'support-root': { type: 'string' }, limit: { type: 'string' } } });
    assert(values['run-dir'] && values.scratch && values['support-root'], 'run-dir, scratch and support-root required');
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const { key } = JSON.parse(input); input = '';
    assert(typeof key === 'string' && key.length > 0, 'stdin credential required');
    const result = await runCodingCollector({ directory: resolve(values['run-dir']), scratch: resolve(values.scratch),
      supportRoot: resolve(values['support-root']), apiKey: key, limit: values.limit ? Number(values.limit) : 216 });
    console.log(JSON.stringify({ written: result.written, status: result.report.status, coverage: result.report.coverage }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
