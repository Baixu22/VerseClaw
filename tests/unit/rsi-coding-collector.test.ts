// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CODING_COLLECTOR, parseCodingEdits } from '../../scripts/lib/rsi-coding-protocol.mjs';
import { buildBenefitRequest, createBenefitPlan, verifyCodingAdmission } from '../../scripts/lib/rsi-benefit-eval.mjs';
import { createResponsesProvider } from '../../scripts/lib/rsi-responses-provider.mjs';
import { collectCodingTrial } from '../../scripts/rsi-coding-collector.mjs';

const root = process.cwd(), created: string[] = [];
function scratch() { const dir = mkdtempSync('D:/tmp/rsi-collector-test-'); created.push(dir); return dir; }
afterAll(() => { for (const dir of created) {
  if (!resolve(dir).startsWith(resolve('D:/tmp') + sep + 'rsi-collector-test-')) throw Error('unsafe-cleanup');
  rmSync(dir, { recursive: true, force: true });
} });
const plan = createBenefitPlan(root, { codingCollector: true });
const slot = plan.slots[0], task = plan.tasks[0];
const apiKey = 'test-credential-never-retained';
function provider(text: string) {
  const transport = vi.fn(async () => new Response(JSON.stringify({
    id: 'collector-stub', model: plan.provider.model, status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  return { transport, send: createResponsesProvider({ ...plan.provider, apiKey, timeoutMs: 1000,
    reasoningEffort: 'low', transport }) };
}

describe('bounded coding collector (stub providers only)', () => {
  it('freezes low reasoning and filters tests, source acceptance and checksums from subject input', () => {
    expect(plan.collector).toEqual(CODING_COLLECTOR);
    const request = buildBenefitRequest(plan, slot);
    expect(request.reasoning).toEqual({ effort: 'low' });
    for (const item of plan.tasks) {
      const input = JSON.parse(buildBenefitRequest(plan, plan.slots.find(s => s.caseId === item.id)!).input as string);
      expect(input.targetScope).not.toContain(item.source.recordPath);
      expect(input.baseFiles.some((file: { path: string }) => item.oracle.testPaths.includes(file.path)
        || file.path === item.source.recordPath || file.path.endsWith('SHA256SUMS'))).toBe(false);
    }
    const g02 = plan.tasks.find(t => t.id === 'tf-0290-g02')!;
    expect(JSON.parse(buildBenefitRequest(plan, plan.slots.find(s => s.caseId === g02.id)!).input as string).baseFiles.length).toBeGreaterThan(0);
  });
  it('rejects absent full admission before a collector can dispatch', () => {
    expect(() => verifyCodingAdmission(root, scratch(), plan)).toThrow();
  });
  it.each(['../escape.ts', 'C:/outside.ts', 'src/../outside.ts', task.oracle.testPaths[0]])('rejects unsafe or oracle edits: %s', path => {
    expect(() => parseCodingEdits(JSON.stringify({ edits: [{ path, content: '' }] }), task)).toThrow();
  });
  it('retains a malformed model answer and never retries the same slot', async () => {
    const dir = scratch(), stub = provider('not JSON');
    const options = { root, plan, slot, apiKey, scratch: dir, supportRoot: dir, provider: stub.send };
    const row = await collectCodingTrial(options);
    expect(row.execution.failureCategory).toBe('model-format');
    expect(row.execution.status).toBe('completed');
    expect(row.grader).toBeNull();
    expect(row.providerAttempts).toHaveLength(1);
    expect(readFileSync(join(dir, slot.id, 'receipt.json'), 'utf8')).not.toContain(apiKey);
    await expect(collectCodingTrial(options)).rejects.toThrow();
    expect(stub.transport).toHaveBeenCalledTimes(1);
  });
  it('keeps transport failure as infrastructure with unknown usage and no retry', async () => {
    const dir = scratch(), send = vi.fn(async () => { throw Error('Responses request failed with HTTP 429'); });
    const row = await collectCodingTrial({ root, plan, slot, apiKey, scratch: dir, supportRoot: dir, provider: send });
    expect(row.execution).toMatchObject({ status: 'crash', failureClass: 'infrastructure', failureCategory: 'provider', attempts: 1 });
    expect(row.providerAttempts[0].parsedResponse).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('refuses to persist a provider response containing the credential', async () => {
    const dir = scratch(), stub = provider(apiKey);
    await expect(collectCodingTrial({ root, plan, slot, apiKey, scratch: dir, supportRoot: dir, provider: stub.send })).rejects.toThrow('credential-in-evidence-rejected');
    expect(existsSync(join(dir, slot.id, 'provider-response.json'))).toBe(false);
    expect(existsSync(join(dir, slot.id, 'receipt.json'))).toBe(false);
  });
});
