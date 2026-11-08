#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createBenefitPlan } from './lib/rsi-benefit-eval.mjs';
import { TOOL_CODING_COLLECTOR } from './lib/rsi-coding-protocol.mjs';
import { createResponsesProvider } from './lib/rsi-responses-provider.mjs';
import { collectCodingTrial } from './rsi-coding-collector.mjs';
import { prepareGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } from './lib/rsi-live-grader.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function runCodingToolIntegration(root = ROOT) {
  const directory = mkdtempSync('D:/tmp/rsi-tools-integration-');
  const plan = createBenefitPlan(root, { codingCollector: true, collectorVersion: TOOL_CODING_COLLECTOR.version });
  const task = plan.tasks.find(task => task.id === 'tf-0291-g03'), slot = plan.slots.find(slot => slot.caseId === task.id);
  const historical = resolveHistoricalTask(root, task.id, { codingCohort: true });
  const edits = task.targetScope.map(path => {
    let content = execFileSync('git', ['show', task.source.reference + ':' + path], { cwd: root, windowsHide: true, encoding: 'utf8' });
    if (path.startsWith('harness/specs/tasks/') && !/^lifecycleStatus:/mu.test(content)) {
      content = content.replace(/^---\r?\n/u, '---\nlifecycleStatus: completed\n');
    }
    return { path, oldText: null, newText: content };
  });
  let turns = 0;
  const provider = createResponsesProvider({ ...plan.provider, apiKey: 'scripted-integration-key',
    timeoutMs: 1000, reasoningEffort: 'low', jsonSchema: plan.collector.responseSchema, tools: plan.collector.tools,
    transport: async () => {
      const index = turns++;
      const output = index === 0 ? [
        { type: 'function_call', call_id: 'implement', name: 'apply_edits', arguments: JSON.stringify({ edits }) },
        { type: 'function_call', call_id: 'public-check', name: 'check_public_contract', arguments: '{}' },
      ] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"finish":true}' }] }];
      return new Response(JSON.stringify({ id: 'scripted-integration-' + index, model: plan.provider.model,
        status: 'completed', output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  const started = Date.now();
  const row = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-integration-key', scratch: directory,
    supportRoot: root, provider,
    prepare: async workspace => { await prepareGradeWorkspace({ root, task: historical, workspace, revision: task.source.base }); },
    grade: async (_edits, workspace) => runLiveTaskOracles({ root, task: historical, workspace,
      outDir: join(directory, 'oracle'), timeoutMs: plan.collector.oracleTimeoutMs, supportRoot: root }) });
  const report = { schemaVersion: 'RsiCodingToolIntegration/v1', date: '2026-11-08', driven_by: 'agent',
    actor: 'codex/rsi-tool-integration-verifier', evidenceKind: 'scripted-provider-real-filesystem-and-historical-oracle',
    candidate: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim().length > 0 },
    passed: row.execution.failureCategory === null && row.grader?.reports.every(item => item.exitCode === 0),
    durationMs: Date.now() - started, directory, row,
    claims: { providerCalls: 0, scriptedProviderCalls: turns, benefit: false, promotionReady: false, realHuman: false } };
  writeFileSync(join(directory, 'integration-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  assert(report.passed, row.execution.note + ' [' + row.execution.failureCategory + ']');
  assert.equal(row.grader.oracleRevision, task.source.reference);
  assert.deepEqual(row.grader.oracleTestDigests, task.oracleTestDigests);
  assert.equal(row.grader.reports[0].report.numPassedTests, 6);
  assert.equal(row.grader.reports[0].report.numFailedTests, 0);
  return report;
}
if (isMainEntrypoint(import.meta.url)) {
  try {
    const report = await runCodingToolIntegration();
    console.log(JSON.stringify({ passed: report.passed, directory: report.directory,
      tests: report.row.grader.reports[0].report.numPassedTests, claims: report.claims }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
