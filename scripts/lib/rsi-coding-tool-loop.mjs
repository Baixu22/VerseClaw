import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { benefitDigest, buildBenefitRequest } from './rsi-benefit-eval.mjs';
import { codingCollectorConfig, parseCodingFinish, reserveProviderTokens, TOOL_CODING_COLLECTOR } from './rsi-coding-protocol.mjs';
import { codingToolEdits, createCodingToolState, executeCodingTool, hasPassingPublicCheck } from './rsi-coding-tools.mjs';
import { createResponsesProvider } from './rsi-responses-provider.mjs';
import { prepareGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } from './rsi-live-grader.mjs';

export async function collectToolCodingTrial({ root, plan, slot, apiKey, scratch, supportRoot,
  provider, grade, prepare, remainingTokens, remainingProviderCalls, campaignLedger }) {
  assert.deepEqual(plan.collector, codingCollectorConfig(plan.collector?.version), 'collector-config-drift');
  assert.equal(plan.collector.version, TOOL_CODING_COLLECTOR.version, 'tool-collector-required');
  assert(!plan.budget.campaign || campaignLedger?.campaignDigest === benefitDigest(plan.budget.campaign), 'campaign-ledger-required');
  const task = plan.tasks.find(task => task.id === slot.caseId);
  assert(task && plan.slots.some(item => benefitDigest(item) === benefitDigest(slot)), 'unknown-slot');
  const directory = resolve(scratch, slot.id), rel = relative(resolve('D:/tmp'), directory);
  assert(rel && !rel.startsWith('..') && !rel.includes(':') && !existsSync(join(directory, '.git')),
    'collector-scratch-must-be-under-D-tmp');
  assert(!existsSync(join(directory, 'dispatch.json')), 'interrupted-attempt-preserved-no-retry');
  const scripted = plan.evidenceKind !== 'live-provider';
  assert(!scripted || provider, 'scripted-provider-required');
  const tokenLimit = remainingTokens ?? (scripted ? Number.MAX_SAFE_INTEGER : plan.budget.maxTotalTokens);
  const callLimit = Math.min(plan.collector.maxProviderCalls,
    remainingProviderCalls ?? (scripted ? plan.collector.maxProviderCalls : plan.budget.providerCallsAuthorized));
  assert(Number.isSafeInteger(tokenLimit) && tokenLimit >= 0 && Number.isSafeInteger(callLimit) && callLimit >= 0,
    'tool-loop-budget-required');
  mkdirSync(directory, { recursive: true });
  const write = (name, value) => {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    assert(!apiKey || !bytes.includes(apiKey), 'credential-in-evidence-rejected');
    writeFileSync(join(directory, name), bytes, { flag: 'wx' });
  };
  const initial = buildBenefitRequest(plan, slot), workspace = join(directory, 'workspace');
  const startedAt = new Date().toISOString(), start = Date.now(), deadline = start + plan.collector.slotTimeoutMs;
  write('dispatch.json', { driven_by: 'agent', actor: plan.actor + '/executor', planDigest: benefitDigest(plan),
    slot, requestDigest: benefitDigest(initial), request: initial, startedAt, attempts: 1 });
  const row = {
    schemaVersion: 'RsiBenefitTrial/v1', driven_by: 'agent', actor: plan.actor + '/executor',
    planDigest: benefitDigest(plan), slot, evidenceKind: plan.evidenceKind, request: initial, requestDigest: benefitDigest(initial),
    runtime: { flags: plan.arms[slot.arm], flagsDigest: slot.flagsDigest, candidateDigest: plan.candidateDigest,
      injectionDigest: slot.arm === 'sekb-confirmed' ? benefitDigest(plan.candidate.context) : null,
      isolationId: plan.runId + '/' + slot.id, runtimeEffectMeasured: true },
    edits: [], execution: { status: 'completed', failureClass: null, failureCategory: null,
      attempts: 1, providerCalls: 0, wallClockMs: 0, costUsd: null, toolEvents: [], runPosition: slot.position,
      startedAt, endedAt: null, measurementBasis: scripted ? 'scripted-provider' : 'live-provider',
      note: 'Bounded public tool loop; independent reference-bound final-state grading.',
      tokenBudgetAtStart: tokenLimit, providerBudgetAtStart: callLimit },
    rawResponse: null, providerAttempts: [], grader: null,
  };
  let phase = 'infrastructure', state = null, request = initial;
  const callIds = new Set();
  try {
    const historical = resolveHistoricalTask(root, task.id, { codingCohort: true });
    if (prepare) await prepare(workspace, task);
    else await prepareGradeWorkspace({ root, task: historical, workspace, revision: task.source.base, edits: [] });
    state = createCodingToolState(root, task, workspace);
    for (;;) {
      phase = 'budget';
      assert(row.execution.providerCalls < callLimit, 'whole-provider-budget-exhausted');
      assert(Date.now() < deadline, 'slot-provider-timeout');
      assert(reserveProviderTokens(plan, row.providerAttempts) + Buffer.byteLength(JSON.stringify(request))
        + plan.provider.maxOutputTokens <= tokenLimit, 'whole-token-budget-exhausted');
      const send = provider ?? createResponsesProvider({ endpoint: plan.provider.endpoint, model: plan.provider.model,
        apiKey, timeoutMs: Math.min(plan.collector.timeoutMs, deadline - Date.now()),
        maxOutputTokens: plan.provider.maxOutputTokens, reasoningEffort: plan.collector.reasoningEffort,
        jsonSchema: plan.collector.responseSchema, tools: plan.collector.tools });
      const reservation = campaignLedger ? await campaignLedger.reserve(request, slot.id + '/' + (row.execution.providerCalls + 1)) : null;
      phase = 'provider';
      row.execution.providerCalls++;
      row.providerAttempts.push({ endpoint: plan.provider.endpoint, request, rawResponse: null, parsedResponse: null });
      let response;
      try {
        response = await send({ instructions: request.instructions, input: request.input });
        Object.assign(row.providerAttempts.at(-1), { rawResponse: response.rawResponse, parsedResponse: response.response });
        row.rawResponse = response.rawResponse;
        write('provider-response-' + row.execution.providerCalls + '.json', response);
      } finally { if (reservation) campaignLedger.settle(reservation, response); }
      assert.deepEqual(response.request.body, request, 'dispatched-request-drift');
      assert.equal(response.response.model, plan.provider.model, 'provider-model-drift');
      const parsed = response.response;
      phase = 'provider-usage';
      assert(parsed.usage !== null, 'provider-usage-unknown');
      phase = 'budget';
      assert(Date.now() < deadline, 'slot-provider-timeout');
      if (parsed.status === 'incomplete' && parsed.incompleteReason === 'max_output_tokens') {
        row.execution.failureCategory = 'model-output-limit';
        break;
      }
      phase = 'provider-status';
      assert.equal(parsed.status, 'completed', 'provider-terminal-status');
      const calls = parsed.functionCalls;
      if (!calls.length) {
        try { parseCodingFinish(parsed.text); }
        catch (error) {
          row.execution.failureCategory = 'model-format';
          row.execution.note = error.message;
          break;
        }
        if (!hasPassingPublicCheck(row.execution.toolEvents)) {
          row.execution.failureCategory = 'model-public-check';
          break;
        }
        phase = 'infrastructure';
        row.edits = codingToolEdits(state);
        const result = grade ? await grade(row.edits, workspace) : await runLiveTaskOracles({
          root, task: historical, workspace, outDir: join(directory, 'oracle'),
          timeoutMs: plan.collector.oracleTimeoutMs, supportRoot,
        });
        phase = result.failureClass === 'oracle-input-drift' ? 'oracle' : 'infrastructure';
        assert(!['oracle-input-drift', 'infrastructure'].includes(result.failureClass), 'independent-grade-' + result.failureClass);
        row.grader = { schemaVersion: 'RsiBenefitGrader/v1', driven_by: 'agent', actor: 'codex/rsi-independent-final-state-grader',
          workspaceRevision: task.source.base, baselineSetup: task.baselineSetup, oracleDigest: task.oracleDigest,
          oracleRevision: task.source.reference, oracleTestDigests: result.oracleTestDigests,
          oracleUnchanged: result.oracleUnchanged, failureClass: result.failureClass, diagnostics: result.diagnostics,
          commands: task.oracle.commands, responseDigest: benefitDigest(row.rawResponse), editsDigest: benefitDigest(row.edits),
          isolation: { hiddenOracleVisible: false, unapprovedEgress: false, candidateChangedEvaluator: false },
          reports: result.executions.map(item => ({ command: item.command, kind: item.kind, exitCode: item.exitCode, report: item.report })) };
        if (!result.passed) row.execution.failureCategory = 'model';
        break;
      }
      if (row.execution.providerCalls >= plan.collector.maxProviderCalls) {
        row.execution.failureCategory = 'model-turn-limit'; break;
      }
      if (row.execution.toolEvents.length + calls.length > plan.collector.maxToolCalls) {
        row.execution.failureCategory = 'model-tool-limit'; break;
      }
      const outputs = [];
      for (const call of calls) {
        assert(!callIds.has(call.callId), 'repeated-tool-effect');
        callIds.add(call.callId);
        phase = 'tool-infrastructure';
        const result = executeCodingTool(state, call), output = JSON.stringify(result.output);
        const event = { type: 'tool-call', callId: call.callId, name: call.name, arguments: call.arguments, output };
        row.execution.toolEvents.push(event);
        write('tool-event-' + row.execution.toolEvents.length + '.json', event);
        assert(!result.infrastructure, 'coding-tool-infrastructure');
        outputs.push({ type: 'function_call_output', call_id: call.callId, output });
      }
      const history = Array.isArray(request.input) ? request.input : [{ role: 'user', content: request.input }];
      request = { ...initial, input: [...history, ...response.rawResponse.output, ...outputs] };
    }
  } catch (error) {
    row.execution.status = /timeout|timed out/iu.test(error.message) ? 'timeout' : 'crash';
    row.execution.failureClass = 'infrastructure';
    row.execution.failureCategory = phase;
    row.execution.note = apiKey ? String(error.message).split(apiKey).join('[REDACTED]') : String(error.message);
    row.rawResponse = null;
  } finally {
    if (state) row.edits = codingToolEdits(state);
    if (existsSync(workspace)) {
      assert(resolve(workspace).startsWith(resolve(directory) + sep), 'unsafe-workspace-cleanup');
      if (lstatSync(workspace).isSymbolicLink()) unlinkSync(workspace);
      else {
        assert(realpathSync(workspace).startsWith(realpathSync(directory) + sep), 'unsafe-workspace-realpath');
        rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }
  }
  row.execution.wallClockMs = Date.now() - start;
  row.execution.endedAt = new Date().toISOString();
  write('receipt.json', row);
  write('receipt-digest.json', { driven_by: 'agent', actor: 'codex/rsi-tool-loop-sealer', sha256: benefitDigest(row) });
  return row;
}
