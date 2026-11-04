// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { parseResponsesReply } from '../../scripts/lib/rsi-responses-provider.mjs';
import { assessTaskAdmission } from '../../scripts/rsi-live-acceptance.mjs';
import { BENEFIT_ARMS, benefitDigest, buildBenefitRequest, checkBenefitRun, createBenefitPlan, recordMeasuredBenefitTrials,
  runOfflineBenefit, sealBenefitRun, summarizeBenefitRun, validateBenefitPlan, writeBenefitPlan,
  type BenefitPlan } from '../../scripts/lib/rsi-benefit-eval.mjs';

const ROOT = process.cwd(), TEMP = 'D:/tmp', created: string[] = [];
function pack(limit?: number) {
  mkdirSync(TEMP, { recursive: true });
  const directory = mkdtempSync(join(TEMP, 'rsi-benefit-test-'));
  created.push(directory);
  const plan = writeBenefitPlan(ROOT, directory, { runId: 'offline-test' });
  runOfflineBenefit(ROOT, directory, { limit });
  return { directory, plan };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deliberately malformed retained JSON exercises runtime validation.
type JsonRecord = { [key: string]: any };
function editTrial(directory: string, plan: BenefitPlan, index: number, mutate: (row: JsonRecord) => void) {
  const path = join(directory, 'trials', `${plan.slots[index].id}.json`);
  const row = JSON.parse(readFileSync(path, 'utf8'));
  mutate(row);
  writeFileSync(path, JSON.stringify(row));
}
function rehash(directory: string) {
  const files = ['plan.json', 'plan.sha256', 'report.json', ...['trials', 'started'].flatMap((dir) =>
    readdirSync(join(directory, dir)).map((file) => `${dir}/${file}`))].sort();
  writeFileSync(join(directory, 'SHA256SUMS'), files.map((file) => `${benefitDigest(readFileSync(join(directory, file)))}  ${file}`).join('\n') + '\n');
}
afterAll(() => {
  for (const directory of created) {
    if (!resolve(directory).startsWith(`${resolve(TEMP)}${sep}rsi-benefit-test-`)) throw Error('unsafe-test-cleanup');
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('measured receipt admission (synthetic contract controls, no provider calls)', () => {
  function measuredPack(limit = 2) {
    const { directory: offlineDir, plan: offlinePlan } = pack(limit);
    const directory = mkdtempSync(join(TEMP, 'rsi-benefit-test-measured-'));
    created.push(directory);
    const plan = writeBenefitPlan(ROOT, directory, {
      mode: 'measured', runId: 'measured-contract-control', maxProviderCalls: 216, maxTotalTokens: 1_000_000,
      candidate: { ...offlinePlan.candidate, kind: 'confirmed-sekb' },
    });
    const historical = JSON.parse(readFileSync(join(ROOT, 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json'), 'utf8'));
    for (const task of plan.tasks) {
      const original = historical.tasks.find((entry: { id: string }) => entry.id === task.id);
      const record = JSON.parse(readFileSync(join(ROOT, original.referenceSolution.sourceRecord), 'utf8'));
      const stage = (pass: boolean) => ({ passed: pass, commands: task.oracle.commands, oracleUnchanged: true, inputDigests: task.oracle.inputDigests,
        executions: task.oracle.commands.map((command) => ({ command, kind: 'vitest', exitCode: pass ? 0 : 1, error: null, timedOut: false,
          report: { success: pass, numTotalTests: 1, numPassedTests: pass ? 1 : 0, numFailedTests: pass ? 0 : 1, numPendingTests: 0,
            testResults: [{ assertionResults: [{ status: pass ? 'passed' : 'failed' }] }] } })) });
      const stages = { reference: stage(true), baseline: stage(false) };
      const path = join(directory, 'calibration', task.id, 'admission.json'); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ evidenceKind: 'synthetic-contract-control', taskId: task.id,
        source: { base: record.candidate.base, reference: record.candidate.commit }, stages, admission: assessTaskAdmission(stages) }));
    }
    const receipts = plan.slots.slice(0, limit).map((slot) => {
      const row = JSON.parse(readFileSync(join(offlineDir, 'trials', `${slot.id}.json`), 'utf8'));
      const task = plan.tasks.find((task) => task.id === slot.caseId)!;
      const passed = JSON.parse(row.rawResponse.output[0].content[0].text).probeValue === 'ok';
      row.planDigest = benefitDigest(plan);
      row.evidenceKind = plan.evidenceKind;
      row.runtime.isolationId = `${plan.runId}/${slot.id}`;
      row.runtime.candidateDigest = plan.candidateDigest;
      row.runtime.runtimeEffectMeasured = true;
      row.execution.measurementBasis = 'live-provider';
      row.execution.providerCalls = 1;
      row.execution.startedAt = new Date(Date.UTC(2026, 0, 1) + slot.position * 10).toISOString();
      row.execution.endedAt = new Date(Date.UTC(2026, 0, 1) + slot.position * 10 + 1).toISOString();
      row.rawResponse.id = `contract-control-${slot.id}`;
      row.providerAttempts = [{ endpoint: plan.provider.endpoint, request: row.request, rawResponse: row.rawResponse, parsedResponse: parseResponsesReply(row.rawResponse) }];
      row.grader = {
        driven_by: 'agent', actor: 'offline-contract-grader', oracleDigest: task.oracleDigest, commands: task.oracle.commands,
        responseDigest: benefitDigest(row.rawResponse),
        isolation: { hiddenOracleVisible: false, unapprovedEgress: false, candidateChangedEvaluator: false },
        reports: task.oracle.commands.map((command) => ({ command, exitCode: passed ? 0 : 1, report: {
          success: passed, numTotalTests: task.oracle.testPaths.length, numPassedTests: passed ? task.oracle.testPaths.length : 0,
          numFailedTests: passed ? 0 : task.oracle.testPaths.length, numPendingTests: 0,
          testResults: task.oracle.testPaths.map((name) => ({ name, assertionResults: [{ status: passed ? 'passed' : 'failed', title: 'offline schema control' }] })),
        } })),
      };
      return row;
    });
    return { directory, plan, receipts };
  }

  it('has a reachable measured benefit gate and derives it from independent oracle results', () => {
    const { directory, receipts } = measuredPack(216);
    recordMeasuredBenefitTrials(ROOT, directory, receipts);
    const report = sealBenefitRun(ROOT, directory);
    expect(report.benefit.status).toBe('promote');
    expect(report.cost.providerCalls).toBe(216);
    expect(report.claims.promotionReady).toBe(false);
    // Final measured checks additionally require the evaluator inputs committed.
    expect(report.coverage.missing).toEqual([]);
    // These in-memory contract-control responses are never retained as live evidence.
  });

  it('rejects absent or failed calibration before importing a measured receipt', () => {
    const { directory, plan, receipts } = measuredPack();
    const path = join(directory, 'calibration', plan.tasks[0].id, 'admission.json');
    const admission = JSON.parse(readFileSync(path, 'utf8'));
    admission.stages.baseline = structuredClone(admission.stages.reference);
    admission.admission = assessTaskAdmission(admission.stages);
    writeFileSync(path, JSON.stringify(admission));
    expect(() => recordMeasuredBenefitTrials(ROOT, directory, [receipts[0]])).toThrow('task-calibration-rejected');
    unlinkSync(path);
    expect(() => recordMeasuredBenefitTrials(ROOT, directory, [receipts[0]])).toThrow();
  });

  it.each(['self-grade', 'oracle', 'test-count', 'contamination', 'endpoint', 'usage', 'hidden-retry', 'raw-parsed', 'skipped', 'actual-position'])(
    'rejects %s before writing an imported slot', (mutation) => {
      const { directory, plan, receipts } = measuredPack();
      const row = receipts[0];
      if (mutation === 'self-grade') row.grader.actor = row.actor;
      if (mutation === 'oracle') row.grader.oracleDigest = '0'.repeat(64);
      if (mutation === 'test-count') row.grader.reports[0].report.numTotalTests += 1;
      if (mutation === 'contamination') row.grader.isolation.hiddenOracleVisible = true;
      if (mutation === 'endpoint') row.providerAttempts[0].endpoint = 'https://other.example/v1/responses';
      if (mutation === 'usage') row.rawResponse.usage.total_tokens += 1;
      if (mutation === 'raw-parsed') row.providerAttempts[0].parsedResponse.text = 'different';
      if (mutation === 'skipped') row.grader.reports[0].report.numSkippedTests = 1;
      if (mutation === 'actual-position') row.execution.runPosition = 8;
      if (mutation === 'hidden-retry') {
        row.providerAttempts.push(structuredClone(row.providerAttempts[0]));
        row.execution.providerCalls = 2;
      }
      expect(() => recordMeasuredBenefitTrials(ROOT, directory, [row])).toThrow();
      expect(summarizeBenefitRun(ROOT, directory).coverage.missing).toContain(plan.slots[0].id);
    });

  it('rejects out-of-order imports and overlapping execution timestamps', () => {
    const { directory, receipts } = measuredPack();
    expect(() => recordMeasuredBenefitTrials(ROOT, directory, [receipts[1]])).toThrow('import-schedule-drift');
    receipts[1].execution.startedAt = receipts[0].execution.startedAt;
    expect(() => recordMeasuredBenefitTrials(ROOT, directory, receipts.slice(0, 2))).toThrow('collector-order-or-overlap');
  });

  it('binds the complete tool continuation and rejects additional hidden context', () => {
    const { directory, receipts, plan } = measuredPack();
    const row = receipts[0], call = { type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{"path":"task.txt"}' };
    const intermediate = { ...row.rawResponse, id: 'tool-control-1', output: [call] };
    const continuation = { ...row.request, input: [{ role: 'user', content: row.request.input }, call,
      { type: 'function_call_output', call_id: call.call_id, output: 'task contents' }] };
    row.providerAttempts = [
      { endpoint: plan.provider.endpoint, request: row.request, rawResponse: intermediate, parsedResponse: parseResponsesReply(intermediate) },
      { endpoint: plan.provider.endpoint, request: continuation, rawResponse: row.rawResponse, parsedResponse: parseResponsesReply(row.rawResponse) },
    ];
    row.execution.providerCalls = 2;
    row.execution.toolEvents = [{ type: 'tool-call', callId: call.call_id, name: call.name, arguments: call.arguments, output: 'task contents' }];
    continuation.input.push({ role: 'user', content: 'hidden oracle content' });
    expect(() => recordMeasuredBenefitTrials(ROOT, directory, [row])).toThrow('tool-continuation-context-drift');
    continuation.input.pop();
    expect(recordMeasuredBenefitTrials(ROOT, directory, [row])).toHaveLength(1);
  });

  it('does not run a measured plan through the offline driver or accept an unstated budget', () => {
    const { directory, plan } = measuredPack();
    expect(() => runOfflineBenefit(ROOT, directory)).toThrow('offline-driver-cannot-execute-measured-plan');
    expect(() => createBenefitPlan(ROOT, { mode: 'measured', candidate: plan.candidate })).toThrow('explicit-measurement-budget-required');
  });
});

describe('RSI benefit plan', () => {
  it('accepts equivalent CRLF source checkouts while rejecting meaningful source drift', () => {
    const original = createBenefitPlan(ROOT);
    const directory = mkdtempSync(join(TEMP, 'rsi-benefit-test-source-'));
    created.push(directory);
    for (const path of Object.keys(original.source.bindings)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), readFileSync(join(ROOT, path), 'utf8').replace(/\r\n?/gu, '\n'));
    }
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=rsi-offline-test', '-c', 'user.email=offline@example.invalid', ...args], { cwd: directory, windowsHide: true, encoding: 'utf8' });
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'offline source fixture');
    const plan = createBenefitPlan(directory);
    const path = join(directory, 'tests/unit/agent-dev-paired-ablation.test.ts');
    const lf = readFileSync(path, 'utf8');
    writeFileSync(path, lf.replaceAll('\n', '\r\n'));
    expect(validateBenefitPlan(plan, directory)).toBe(true);
    writeFileSync(path, `${lf}\n// meaningful change\n`);
    expect(() => validateBenefitPlan(plan, directory)).toThrow('evaluator-source-drift');
  });

  it('freezes all 24 tasks and 216 counterbalanced slots without changing the old protocol', () => {
    const plan = createBenefitPlan(ROOT);
    expect(plan.tasks).toHaveLength(24);
    expect(plan.tasks.filter((task) => task.split === 'held-out')).toHaveLength(12);
    expect(plan.slots).toHaveLength(216);
    expect(plan.budget).toMatchObject({ providerCallsAuthorized: 0, retries: 0 });
    for (const task of plan.tasks) {
      const slots = plan.slots.filter((slot) => slot.caseId === task.id);
      expect(new Set(slots.map((slot) => `${slot.arm}/${slot.repeat}`)).size).toBe(9);
      expect(new Set([0, 3, 6].map((index) => slots[index].arm)).size).toBe(3);
    }
    expect(validateBenefitPlan(plan, ROOT)).toBe(true);
  });

  it('projects equal off/shadow requests and keeps oracle metadata away from the subject', () => {
    const plan = createBenefitPlan(ROOT), slots = plan.slots.filter((slot) => slot.caseId === plan.tasks[0].id && slot.repeat === 1);
    const requests = Object.fromEntries(slots.map((slot) => [slot.arm, buildBenefitRequest(plan, slot)]));
    expect(requests['sekb-off']).toEqual(requests['sekb-shadow']);
    expect(requests['sekb-confirmed']).not.toEqual(requests['sekb-off']);
    const content = JSON.stringify(requests);
    expect(content).not.toContain(plan.tasks[0].oracleDigest);
    expect(content).not.toContain('referenceSolution');
    expect(content).not.toContain('apiKey');
  });

  it('rejects model, flags, policy, sample and evidence-type drift', () => {
    const original = createBenefitPlan(ROOT);
    for (const mutate of [
      (p: BenefitPlan) => { p.provider.maxOutputTokens = 1; },
      (p: BenefitPlan) => { p.arms['sekb-off'].injection = true; },
      (p: BenefitPlan) => { p.slots.pop(); },
      (p: BenefitPlan) => { p.design.minimumImprovement = 0; },
      (p: BenefitPlan) => { Object.assign(p, { evidenceKind: 'live-provider' }); },
      (p: BenefitPlan) => { p.tasks[0].prompt += ' changed'; },
      (p: BenefitPlan) => { p.source.bindings['scripts/lib/paired-ablation.mjs'] = '0'.repeat(64); },
    ]) {
      const plan = structuredClone(original); mutate(plan);
      expect(() => validateBenefitPlan(plan, ROOT)).toThrow();
    }
    expect(() => createBenefitPlan(ROOT, { candidate: { ...original.candidate, sourceCaseIds: [original.tasks[0].id] } })).toThrow('training-evaluation-overlap');
  });
});

describe('RSI offline benefit run', () => {
  it('replays every slot and refuses a quality claim even when numerical benefit clears the gate', () => {
    const { directory } = pack();
    const report = sealBenefitRun(ROOT, directory);
    expect(report.coverage).toMatchObject({ planned: 216, recorded: 216, missing: [], incomplete: [] });
    expect(report.comparisons.confirmedVsOff.promotion.status).toBe('promote');
    expect(report.comparisons.shadowVsOff.pairedDiff.meanDiff).toBe(0);
    expect(report.splitEffects['held-out'].completePairs).toBe(12);
    expect(report.benefit.status).toBe('insufficient-evidence');
    expect(Object.values(report.claims)).toEqual([false, false, false, false, false]);
    expect(checkBenefitRun(ROOT, directory).passed).toBe(true);
  });

  it('resumes only unfinished slots and preserves completed bytes', () => {
    const { directory, plan } = pack(5);
    const first = join(directory, 'trials', `${plan.slots[0].id}.json`), before = readFileSync(first);
    sealBenefitRun(ROOT, directory);
    expect(checkBenefitRun(ROOT, directory).passed).toBe(false);
    expect(runOfflineBenefit(ROOT, directory)).toMatchObject({ written: 211, resumed: 5 });
    expect(readFileSync(first)).toEqual(before);
    sealBenefitRun(ROOT, directory);
    expect(checkBenefitRun(ROOT, directory).passed).toBe(true);
    expect(runOfflineBenefit(ROOT, directory)).toMatchObject({ written: 0, resumed: 216 });
  });

  it('preserves an interrupted slot as a crash instead of retrying it', () => {
    const { directory, plan } = pack(0), slot = plan.slots[0];
    mkdirSync(join(directory, 'started'), { recursive: true });
    writeFileSync(join(directory, 'started', `${slot.id}.json`), JSON.stringify({ planDigest: benefitDigest(plan), slotId: slot.id }));
    runOfflineBenefit(ROOT, directory);
    const report = sealBenefitRun(ROOT, directory);
    expect(report.coverage.incomplete).toContain(slot.id);
    expect(checkBenefitRun(ROOT, directory).passed).toBe(false);
    expect(runOfflineBenefit(ROOT, directory).written).toBe(0);
  });

  it.each(['model', 'request', 'arm', 'response-id', 'retry', 'claim'])('rejects %s drift on resume and readback', (mutation) => {
    const { directory, plan } = pack(1);
    editTrial(directory, plan, 0, (row) => {
      if (mutation === 'model') row.rawResponse.model = 'other-model';
      if (mutation === 'request') row.request.input = 'changed';
      if (mutation === 'arm') row.runtime.flags.injection = !row.runtime.flags.injection;
      if (mutation === 'response-id') row.rawResponse.id = 'reused-response';
      if (mutation === 'retry') row.execution.attempts = 2;
      if (mutation === 'claim') row.success = true;
    });
    expect(() => runOfflineBenefit(ROOT, directory)).toThrow();
    expect(() => summarizeBenefitRun(ROOT, directory)).toThrow();
  });

  it('regrades modified outputs and rejects a forged saved report even after rehashing', () => {
    const { directory, plan } = pack();
    const safety = plan.slots.findIndex((slot) => slot.arm === 'sekb-confirmed' && plan.tasks.find((task) => task.id === slot.caseId)?.safetyRequired);
    editTrial(directory, plan, safety, (row) => { row.rawResponse.output[0].content[0].text = '{}'; });
    const report = sealBenefitRun(ROOT, directory);
    expect(report.comparisons.confirmedVsOff.promotion.status).toBe('eliminate');
    report.claims.benefit = true as false;
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report));
    rehash(directory);
    expect(checkBenefitRun(ROOT, directory).passed).toBe(false);
  });

  it('retains missing usage and catches a dropped result rather than lowering the denominator', () => {
    const { directory, plan } = pack();
    editTrial(directory, plan, 0, (row) => { delete row.rawResponse.usage; });
    const report = sealBenefitRun(ROOT, directory);
    expect(report.cost.missingUsageTrials).toBe(1);
    expect(report.comparisons.confirmedVsOff.promotion.status).toBe('hold');
    unlinkSync(join(directory, 'trials', `${plan.slots[1].id}.json`));
    expect(summarizeBenefitRun(ROOT, directory).coverage.missing).toContain(plan.slots[1].id);
    expect(checkBenefitRun(ROOT, directory).passed).toBe(false);
    expect(BENEFIT_ARMS).toHaveLength(3);
  });
});
