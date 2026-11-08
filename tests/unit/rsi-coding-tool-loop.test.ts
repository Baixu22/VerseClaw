// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createBenefitPlan, buildBenefitRequest, benefitDigest, validateCollectedBenefitTrial, type BenefitTask } from '../../scripts/lib/rsi-benefit-eval.mjs';
import { CODING_TOOLS, TOOL_CODING_COLLECTOR } from '../../scripts/lib/rsi-coding-protocol.mjs';
import { createResponsesProvider } from '../../scripts/lib/rsi-responses-provider.mjs';
import { collectCodingTrial, reservedCodingTokens } from '../../scripts/rsi-coding-collector.mjs';
import { codingToolEdits, createCodingToolState, executeCodingTool, verifyCodingToolJournal } from '../../scripts/lib/rsi-coding-tools.mjs';
import { createCampaignLedger, type CampaignBudget } from '../../scripts/lib/rsi-campaign-budget.mjs';

const root = process.cwd(), created: string[] = [];
const plan = createBenefitPlan(root, { codingCollector: true, collectorVersion: TOOL_CODING_COLLECTOR.version });
const task = plan.tasks.find(task => task.id === 'tf-0291-g03')!;
const slot = plan.slots.find(slot => slot.caseId === task.id)!;
function scratch() { const path = mkdtempSync('D:/tmp/rsi-tool-loop-test-'); created.push(path); return path; }
afterAll(() => { for (const path of created) {
  if (!resolve(path).startsWith(resolve('D:/tmp') + sep + 'rsi-tool-loop-test-')) throw Error('unsafe-cleanup');
  rmSync(path, { recursive: true, force: true });
} });
async function prepare(workspace: string, selected: BenefitTask) {
  mkdirSync(workspace, { recursive: true });
  for (const file of selected.publicInput!.baseFiles) if (selected.targetScope.includes(file.path) && file.content !== null) {
    mkdirSync(dirname(join(workspace, file.path)), { recursive: true }); writeFileSync(join(workspace, file.path), file.content);
  }
}
const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
function sender(outputs: unknown[][], usages?: Array<null | { input_tokens: number; output_tokens: number; total_tokens: number }>) {
  let index = 0;
  const transport = vi.fn(async (_url: string, _init: RequestInit) => {
    const turn = index++;
    return new Response(JSON.stringify({ id: 'tool-turn-' + turn, model: plan.provider.model, status: 'completed',
      output: outputs[turn], usage: usages ? usages[turn] : { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { transport, send: createResponsesProvider({ ...plan.provider, apiKey: 'scripted-provider-key',
    timeoutMs: 1000, reasoningEffort: 'low', jsonSchema: plan.collector!.responseSchema, tools: CODING_TOOLS, transport }) };
}
const finish = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"finish":true}' }] }];
const implementations = task.targetScope.map(path => {
  let content = execFileSync('git', ['show', task.source.reference + ':' + path],
    { cwd: root, windowsHide: true, encoding: 'utf8' });
  if (path.startsWith('harness/specs/tasks/') && !/^lifecycleStatus:/mu.test(content)) {
    content = content.replace(/^---\r?\n/u, '---\nlifecycleStatus: completed\n');
  }
  return { path, oldText: null, newText: content };
});
describe('bounded coding tool loop (scripted providers)', () => {
  it('shares preflight authorization and stops an unreserved continuation before the provider call', async () => {
    const campaign: CampaignBudget = { schemaVersion: 'RsiCampaignBudget/v1', driven_by: 'agent', actor: 'scripted-campaign',
      endpoint: plan.provider.endpoint, model: plan.provider.model,
      authorization: { approvedBy: 'owner', currency: 'CNY', maxCost: 300, maxProviderCalls: 2, maxTotalTokens: 12000000, source: 'scripted fixture' },
      billing: { kind: 'token-tariff', currency: 'CNY', inputPerMillion: 5, outputPerMillion: 20, evidenceDigest: 'a'.repeat(64) } };
    const ledger = createCampaignLedger({ directory: join(scratch(), 'ledger'), campaign });
    ledger.settle(await ledger.reserve(buildBenefitRequest(plan, slot), 'provider-preflight'), null);
    const scripted = sender([[call('edit', 'apply_edits', { edits: implementations }), call('public', 'check_public_contract', {})], finish]);
    const measuredShape = { ...plan, budget: { ...plan.budget, campaign } };
    const row = await collectCodingTrial({ root, plan: measuredShape, slot, apiKey: 'scripted-provider-key', scratch: scratch(),
      supportRoot: root, provider: scripted.send, prepare, campaignLedger: ledger });
    expect(row.execution).toMatchObject({ failureCategory: 'budget', providerCalls: 1, status: 'crash' });
    expect(scripted.transport).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot()).toMatchObject({ providerCalls: 2, unknownUsageRequests: ['provider-preflight'] });
    expect(row.providerAttempts).toHaveLength(1);
  });
  it('freezes function tools and a final acknowledgement without changing the single-shot contract', () => {
    const request = buildBenefitRequest(plan, slot);
    expect(request.tools).toEqual(CODING_TOOLS);
    expect(request.text!.format.schema).toEqual({ type: 'object', additionalProperties: false,
      required: ['finish'], properties: { finish: { type: 'boolean', const: true } } });
    expect(plan.collector).toMatchObject({ maxProviderCalls: 4, maxToolCalls: 12, maxEditFiles: 32 });
  });
  it('applies twenty document changes in one real-filesystem batch and rejects a forged effect hash', async () => {
    const selected = plan.tasks.find(task => task.id === 'tf-0290-g02')!, workspace = scratch();
    await prepare(workspace, selected);
    const state = createCodingToolState(root, selected, workspace);
    const edits = selected.targetScope.map(path => ({ path, oldText: null,
      newText: path.startsWith('harness/specs/') ? '---\nid: document\nlifecycleStatus: active\ntitle: Updated\nintent: Updated\nrequiredRules: []\nrequiredTests: []\n---\n' : 'Updated document\n' }));
    const request = { name: 'apply_edits', arguments: JSON.stringify({ edits }) };
    const result = executeCodingTool(state, request);
    expect(result.infrastructure).toBe(false); expect(result.output.ok).toBe(true);
    expect(result.output.effects).toHaveLength(20);
    for (const edit of edits) expect(readFileSync(join(workspace, edit.path), 'utf8')).toBe(edit.newText);
    const events = [{ type: 'tool-call' as const, callId: 'batch', ...request, output: JSON.stringify(result.output) }];
    expect(verifyCodingToolJournal(root, selected, events, codingToolEdits(state))).toBe(true);
    const forged = JSON.parse(events[0].output); forged.effects[0].afterSha256 = '0'.repeat(64);
    events[0].output = JSON.stringify(forged);
    expect(() => verifyCodingToolJournal(root, selected, events, codingToolEdits(state))).toThrow('tool-output-or-effect-drift');
  });
  it('validates an entire batch before writing and rejects ambiguous replacements', async () => {
    const workspace = scratch(); await prepare(workspace, task);
    const state = createCodingToolState(root, task, workspace), path = task.targetScope[0];
    const rejected = executeCodingTool(state, { name: 'apply_edits', arguments: JSON.stringify({ edits: [
      { path, oldText: null, newText: 'should never be written' }, { path: '../outside.mjs', oldText: null, newText: 'bad' },
    ] }) });
    expect(rejected.output.ok).toBe(false); expect(existsSync(join(workspace, path))).toBe(false);
    expect(codingToolEdits(state)).toEqual([]);
    executeCodingTool(state, { name: 'apply_edits', arguments: JSON.stringify({ edits: [{ path, oldText: null, newText: 'repeat repeat' }] }) });
    const ambiguous = executeCodingTool(state, { name: 'apply_edits', arguments: JSON.stringify({ edits: [{ path, oldText: 'repeat', newText: 'once' }] }) });
    expect(ambiguous.output).toMatchObject({ ok: false, error: 'edit-match-not-unique' });
    expect(readFileSync(join(workspace, path), 'utf8')).toBe('repeat repeat');
  });
  it('refuses private reads and follows no writable junction outside the task workspace', async () => {
    const workspace = scratch(), outside = scratch(); await prepare(workspace, task);
    const state = createCodingToolState(root, task, workspace);
    expect(executeCodingTool(state, { name: 'read_file', arguments: JSON.stringify({
      path: task.oracle.testPaths[0], startLine: 1, maxLines: 10 }) }).output.ok).toBe(false);
    symlinkSync(outside, join(workspace, 'scripts'), 'junction');
    const result = executeCodingTool(state, { name: 'apply_edits', arguments: JSON.stringify({ edits: [implementations[0]] }) });
    expect(result.infrastructure).toBe(true);
    expect(result.output.reason).toContain('workspace-symlink');
    expect(codingToolEdits(state)).toEqual([]);
    expect(existsSync(join(outside, 'lib/trace-to-eval-sample.mjs'))).toBe(false);
  });
  it('repairs after a public syntax error, records every turn and grades only the final files', async () => {
    const scripted = sender([
      [call('bad-edit', 'apply_edits', { edits: [{ ...implementations[0], newText: 'export function {' }] }), call('bad-check', 'check_public_contract', {})],
      [call('good-edit', 'apply_edits', { edits: implementations }), call('good-check', 'check_public_contract', {})], finish,
    ]);
    const grade = vi.fn(async (edits) => {
      expect(edits).toHaveLength(4);
      return { passed: true, failureClass: null, oracleTestDigests: task.oracleTestDigests, oracleUnchanged: true,
        diagnostics: [], executions: [] };
    });
    const row = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: scratch(),
      supportRoot: root, provider: scripted.send, grade: grade as never, prepare });
    expect(row.execution).toMatchObject({ status: 'completed', providerCalls: 3, attempts: 1, failureCategory: null });
    expect(row.execution.toolEvents).toHaveLength(4);
    expect(JSON.parse(row.execution.toolEvents[1].output).ok).toBe(false);
    expect(JSON.parse(row.execution.toolEvents[3].output).ok).toBe(true);
    expect(row.grader!.editsDigest).toBe(benefitDigest(row.edits));
    expect(reservedCodingTokens(plan, [row])).toBe(60);
    expect(verifyCodingToolJournal(root, task, row.execution.toolEvents, row.edits)).toBe(true);
    expect(grade).toHaveBeenCalledTimes(1);
    const continuation = JSON.parse(scripted.transport.mock.calls[1][1]!.body as string).input;
    expect(continuation.some((item: { type?: string }) => item.type === 'function_call_output')).toBe(true);
  });
  it('stops at the declared provider turn budget with partial files and unexecuted final calls visible', async () => {
    const scripted = sender([[call('one', 'check_public_contract', {})], [call('two', 'check_public_contract', {})],
      [call('three', 'check_public_contract', {})], [call('four', 'check_public_contract', {})]]);
    const grade = vi.fn();
    const row = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: scratch(),
      supportRoot: root, provider: scripted.send, grade, prepare });
    expect(row.execution).toMatchObject({ status: 'completed', providerCalls: 4, failureCategory: 'model-turn-limit' });
    expect(row.execution.toolEvents).toHaveLength(3); expect(row.grader).toBeNull();
    expect(grade).not.toHaveBeenCalled(); expect(scripted.transport).toHaveBeenCalledTimes(4);
  });
  it('retains unknown usage and performs no tool effect or hidden retry', async () => {
    const scripted = sender([[call('never-write', 'apply_edits', { edits: implementations })]], [null]);
    const base = scratch();
    const row = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: base,
      supportRoot: root, provider: scripted.send, prepare });
    expect(row.execution).toMatchObject({ status: 'crash', failureClass: 'infrastructure', failureCategory: 'provider-usage', providerCalls: 1 });
    expect(row.edits).toEqual([]); expect(row.execution.toolEvents).toEqual([]);
    expect(row.providerAttempts[0].rawResponse).not.toBeNull();
    await expect(collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: base,
      supportRoot: root, provider: scripted.send, prepare })).rejects.toThrow('interrupted-attempt-preserved-no-retry');
    expect(scripted.transport).toHaveBeenCalledTimes(1);
  });
  it('enforces whole-run, executed-tool and slot-time budgets before further effects', async () => {
    const noTokens = sender([finish]);
    const tokenRow = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: scratch(),
      supportRoot: root, provider: noTokens.send, prepare, remainingTokens: 0 });
    expect(tokenRow.execution).toMatchObject({ status: 'crash', failureClass: 'infrastructure', failureCategory: 'budget', providerCalls: 0 });
    expect(noTokens.transport).not.toHaveBeenCalled();
    const tooMany = sender([Array.from({ length: 13 }, (_, i) => call('limit-' + i, 'check_public_contract', {}))]);
    const toolRow = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: scratch(),
      supportRoot: root, provider: tooMany.send, prepare });
    expect(toolRow.execution).toMatchObject({ status: 'completed', failureCategory: 'model-tool-limit', providerCalls: 1 });
    expect(toolRow.execution.toolEvents).toEqual([]); expect(toolRow.grader).toBeNull();
    let time = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => time);
    try {
      const timed = sender([[call('check-once', 'check_public_contract', {})]]);
      const send = async (request: { instructions: string; input: unknown }) => {
        const result = await timed.send(request); time += TOOL_CODING_COLLECTOR.slotTimeoutMs + 1; return result;
      };
      const timeRow = await collectCodingTrial({ root, plan, slot, apiKey: 'scripted-provider-key', scratch: scratch(),
        supportRoot: root, provider: send, prepare });
      expect(timeRow.execution).toMatchObject({ status: 'timeout', failureCategory: 'budget', providerCalls: 1 });
      expect(timeRow.execution.toolEvents).toEqual([]);
      expect(timed.transport).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
  it('rejects re-signed tool effects, budget changes and unregistered tool schemas in measured-shape fixtures', async () => {
    const measured = createBenefitPlan(root, { codingCollector: true, collectorVersion: TOOL_CODING_COLLECTOR.version,
      mode: 'measured', maxProviderCalls: 864, maxTotalTokens: 12000000,
      candidate: JSON.parse(readFileSync(join(root, 'harness/specs/fixtures/rsi-coding-cohort/candidate.json'), 'utf8')) });
    const first = measured.tasks[0], selected = measured.slots[0];
    const edits = first.targetScope.map(path => {
      let content = execFileSync('git', ['show', first.source.reference + ':' + path], { cwd: root, windowsHide: true, encoding: 'utf8' });
      if (path.startsWith('harness/specs/tasks/') && !/^lifecycleStatus:/mu.test(content)) content = content.replace(/^---\r?\n/u, '---\nlifecycleStatus: completed\n');
      return { path, oldText: null, newText: content };
    });
    const scripted = sender([[call('all-files', 'apply_edits', { edits }), call('public', 'check_public_contract', {})], finish]);
    const row = await collectCodingTrial({ root, plan: measured, slot: selected, apiKey: 'scripted-provider-key',
      scratch: scratch(), supportRoot: root, provider: scripted.send, prepare,
      grade: (async () => ({ passed: true, failureClass: null, diagnostics: [], oracleUnchanged: true,
        oracleTestDigests: first.oracleTestDigests, executions: first.oracle.commands.map(command => ({
          command, kind: 'vitest', exitCode: 0, report: { success: true, numTotalTests: first.oracle.testPaths.length,
            numPassedTests: first.oracle.testPaths.length, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
            testResults: first.oracle.testPaths.map(name => ({ name, assertionResults: [{ status: 'passed' }] })) },
        })) })) as never });
    expect(row.execution.failureCategory, row.execution.note).toBeNull();
    expect(validateCollectedBenefitTrial(root, measured, row).outcome).toBe('pass');
    const forged = structuredClone(row);
    const output = JSON.parse(forged.execution.toolEvents[0].output); output.effects[0].afterSha256 = '0'.repeat(64);
    forged.execution.toolEvents[0].output = JSON.stringify(output);
    const history = forged.providerAttempts[1].request.input as Array<{ type?: string; call_id?: string; output?: string }>;
    history.find(item => item.type === 'function_call_output' && item.call_id === 'all-files')!.output = forged.execution.toolEvents[0].output;
    expect(() => validateCollectedBenefitTrial(root, measured, forged)).toThrow('tool-output-or-effect-drift');
    const budget = structuredClone(row); budget.execution.tokenBudgetAtStart = budget.execution.tokenBudgetAtStart! + 1;
    expect(() => validateCollectedBenefitTrial(root, measured, budget)).toThrow('tool-token-budget-start-drift');
    const policy = structuredClone(row); policy.providerAttempts[1].request.tools = [];
    expect(() => validateCollectedBenefitTrial(root, measured, policy)).toThrow('provider-request-policy');
  });
});
