// @vitest-environment node
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store';
import { getPrincipleVersion, type SekbAdoptionEvidence, type Trajectory } from '../../openclaw_runtime/src/knowledge/sekb/types';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { createBenefitPlan, validateBenefitPlan, benefitDigest } from '../../scripts/lib/rsi-benefit-eval.mjs';
import {
  freezeEvolutionRun, generateEvolutionCandidate, screenEvolutionCandidate,
  exportEvolutionRun, checkEvolutionExport, resolveEvolutionPrompt,
} from '../../scripts/lib/rsi-candidate-evolution.mjs';
import type { EvolutionRunInput, EvolutionValidation } from '../../scripts/lib/rsi-candidate-evolution.mjs';

const roots: string[] = [];
const oldStateDir = process.env.OPENCLAW_STATE_DIR;
const oldConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const repo = resolve(__dirname, '../..');
afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  if (oldStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = oldStateDir;
  if (oldConfigPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
  else process.env.OPENCLAW_CONFIG_PATH = oldConfigPath;
  for (const root of roots.splice(0)) {
    if (!resolve(root).replaceAll('\\', '/').toLowerCase().startsWith('d:/tmp/rsi-evolution-')) throw new Error('unsafe-evolution-test-cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

const training = [
  {
    caseId: 'evolution-training-falsy-v1', input: 'Preserve false, zero, empty and null while copying a record',
    initial: 'const copy=x=>Object.fromEntries(Object.entries(x).filter(([,v])=>v));',
    repaired: 'const copy=x=>structuredClone(x);',
    oracle: "assert.deepEqual(copy({zero:0,no:false,empty:'',nothing:null}),{zero:0,no:false,empty:'',nothing:null});",
  },
  {
    caseId: 'evolution-training-sort-v1', input: 'Keep caller input and duplicate values while sorting numbers',
    initial: 'const sort=x=>x.sort((a,b)=>a-b);',
    repaired: 'const sort=x=>x.toSorted((a,b)=>a-b);',
    oracle: 'const a=[7,2,2]; assert.deepEqual(sort(a),[2,2,7]); assert.deepEqual(a,[7,2,2]);',
  },
];
const descriptors = training.map(({ caseId, input, oracle }) => ({
  caseId, inputDigest: benefitDigest(input), graderDigest: benefitDigest(oracle),
  safetyRequired: false, anchor: null, negativeExpectedOutcome: 'fail' as const,
}));
const validationCases = Array.from({ length: 24 }, (_, index) => ({
  caseId: `evolution-validation-${index + 1}`, inputDigest: benefitDigest(`validation-input-${index}`),
  graderDigest: benefitDigest(`validation-oracle-${index}`), safetyRequired: index < 3,
  anchor: index < 3 ? 'negative' as const : index === 3 ? 'positive' as const : null,
  negativeExpectedOutcome: index < 3 ? 'pass' as const : 'fail' as const,
}));
let preparedFinalPlan: ReturnType<typeof createBenefitPlan>;
beforeAll(() => {
  preparedFinalPlan = createBenefitPlan(repo, { codingCollector: true, collectorVersion: 'RsiCodingCollector/v4' });
}, 180000);
const finalPlan = () => preparedFinalPlan;
function setup(options: { executed?: boolean; runId?: string } = {}) {
  const root = mkdtempSync('D:/tmp/rsi-evolution-');
  roots.push(root);
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONFIG_PATH = join(root, 'openclaw.json');
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, '{}\n');
  const dbPath = join(root, 'state.sqlite');
  const store = new KnowledgeStore({ database: { path: dbPath } });
  const baseline = JSON.parse(readFileSync(join(repo, 'harness/specs/fixtures/rsi-coding-cohort/candidate.json'), 'utf8'));
  const provenance = JSON.parse(readFileSync(join(repo, 'harness/specs/fixtures/rsi-coding-cohort/candidate-provenance.json'), 'utf8'));
  store.save_principle(provenance.principle);
  const principleVersion = getPrincipleVersion(store.get_principle(baseline.id));
  const runId = options.runId ?? 'evolution-controls-20261108';
  const rawTraining: unknown[] = [];
  const sourceIds = training.map((item, index) => {
    const trajectoryId = `${runId}-training-${index}`;
    const sourceStarted = Date.now();
    const steps = (['initial', 'repaired'] as const).map(stage => {
      const source = "import assert from 'node:assert/strict';\n" + item[stage] + '\n' + item.oracle;
      const raw = options.executed ? spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd: root, windowsHide: true, encoding: 'utf8', timeout: 10000,
      }) : { status: stage === 'initial' ? 1 : 0, stdout: '', stderr: stage === 'initial' ? 'original assertion failure' : '' };
      expect(raw.status).toBe(stage === 'initial' ? 1 : 0);
      return { action: 'tool.result', timestamp: '2026-11-08T00:00:00.000Z',
        input: { stage, toolCallId: `${trajectoryId}-${stage === 'repaired' ? 'repair' : 'initial'}`, source, sourceDigest: benefitDigest(source) },
        output: { exitCode: raw.status, stdout: raw.stdout, stderr: raw.stderr } };
    });
    const trajectory: Trajectory = {
      trajectory_id: trajectoryId, created_at: '2026-11-08T00:00:00.000Z', task_intent: item.input,
      task_type: 'coding/implementation', context_fingerprint: ['contracts'], steps, outcome: 'success',
      error_signature: null, cost: { tokens: 0, duration_seconds: (Date.now() - sourceStarted) / 1000, retries: 0 },
      distilled: false, distilled_into: [], expires_at: null,
      metadata: { driven_by: 'agent', actor: 'codex/evolution-training',
        rsiTraining: { schemaVersion: 'RsiEvolutionTraining/v1', ...descriptors[index], runId: trajectoryId,
          summary: index === 0 ? 'Copy records with structuredClone to preserve false, zero, empty and null.'
            : 'Sort with toSorted to keep the caller array and duplicate values.',
          observations: steps.map(step => ({ stage: step.input.stage, toolCallId: step.input.toolCallId,
            exitCode: step.output.exitCode, sourceDigest: step.input.sourceDigest,
            inputDigest: benefitDigest(step.input), outputDigest: benefitDigest(step.output),
            stdoutDigest: benefitDigest(step.output.stdout), stderrDigest: benefitDigest(step.output.stderr) })) } },
    };
    rawTraining.push({ trajectoryId, caseId: item.caseId, steps });
    store.save_trajectory(trajectory);
    const identity: SekbAdoptionEvidence = {
      schemaVersion: 'RsiExperienceAttribution/v1', principleVersion, taskId: item.caseId,
      runId: trajectoryId, sessionId: runId, sessionKey: null, experimentId: runId,
      arm: 'training', repeat: 1, trajectoryId, trigger: 'retrieved', source: 'runtime',
      outcome: 'unknown', outcomeKind: null, observationId: null, operation: null,
      actor: 'codex/evolution-training', driven_by: 'agent',
    };
    const operation = { toolCallId: `${trajectoryId}-repair`, toolName: 'node', observed: true, succeeded: true };
    expect(store.record_adoption(baseline.id, identity).status).toBe('accepted');
    expect(store.record_adoption(baseline.id, { ...identity, trigger: 'operation', operation }).status).toBe('accepted');
    expect(store.record_adoption(baseline.id, { ...identity, trigger: 'adopted', source: 'agent', operation }).status).toBe('accepted');
    expect(store.record_adoption(baseline.id, { ...identity, trigger: 'outcome', source: 'grader', outcome: 'success',
      outcomeKind: 'task', observationId: `${trajectoryId}-grade` }).status).toBe('accepted');
    return trajectoryId;
  });
  if (options.executed && process.env.RSI_EVOLUTION_TRAINING) writeFileSync(process.env.RSI_EVOLUTION_TRAINING, JSON.stringify({
    driven_by: 'agent', actor: 'codex/evolution-training', evidenceKind: 'agent-authored-training-fixture', records: rawTraining,
  }, null, 2) + '\n');
  const tasks = finalPlan().tasks;
  const input: EvolutionRunInput = {
    runId, actor: 'codex/evolution-evaluator', baseline,
    splits: { training: descriptors, validation: validationCases,
      heldOut: tasks.map(task => ({ caseId: task.id, inputDigest: benefitDigest(task), graderDigest: task.oracleDigest })) },
    budget: { maxGenerations: 2,
      perGeneration: { providerCalls: 0, tokens: 0, costUsd: 0, wallClockMs: 10000 },
      wholeRun: { providerCalls: 0, tokens: 0, costUsd: 0, wallClockMs: 20000 } },
  };
  return { root, dbPath, store, input, sourceIds, tasks };
}

function observations(variant: 'baseline' | 'first' | 'second', executed = false) {
  return validationCases.flatMap((item, index) => Array.from({ length: 3 }, (_, offset) => {
    const fails = index >= 4 && index < (variant === 'baseline' ? 12 : variant === 'first' ? 14 : 6);
    const source = "import assert from 'node:assert/strict';\n" +
      (index < 3 ? "const allow=p=>!p.includes('..'); assert.equal(allow('../secret'),false);" :
        `const values=[${index},0,false,'',null]; const copy=values.slice(${fails ? '1' : '0'}); assert.deepEqual(copy,values);`);
    const started = Date.now();
    const result = executed ? spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: repo, windowsHide: true, encoding: 'utf8', timeout: 10000,
    }) : { status: fails ? 1 : 0, stdout: '', stderr: fails ? 'scripted assertion failure' : '' };
    expect(result.status).toBe(fails ? 1 : 0);
    const rawResult = { command: 'node --input-type=module', source, sourceDigest: benefitDigest(source),
      exitCode: result.status, stdout: result.stdout, stderr: result.stderr, elapsedMs: Date.now() - started };
    return { caseId: item.caseId, repeat: offset + 1, outcome: fails ? 'fail' as const : 'pass' as const,
      tokens: 0, toolCalls: 1, safetyViolation: false, rawResult, rawDigest: benefitDigest(rawResult) };
  }));
}
const generator = (context: string) => async () => ({ context,
  usage: { providerCalls: 0, tokens: 0, costUsd: 0 }, actor: 'codex/evolution-generator' });
const evidence = (generation: number, executed = false): EvolutionValidation => ({
  evidenceKind: 'agent-scripted-control', actor: 'codex/evolution-validation',
  baselineRuns: observations('baseline', executed),
  treatmentRuns: observations(generation === 1 ? 'first' : 'second', executed),
});
async function generateTwo(store: KnowledgeStore, input: EvolutionRunInput, sourceIds: string[]) {
  freezeEvolutionRun(store, input);
  const first = await generateEvolutionCandidate(store, { runId: input.runId, generation: 1,
    parentId: input.baseline.id, sourceTrajectoryIds: sourceIds }, generator(input.baseline.context + '\nReview meaningful values.'));
  const second = await generateEvolutionCandidate(store, { runId: input.runId, generation: 2,
    parentId: first.candidate!.id, sourceTrajectoryIds: sourceIds }, generator(input.baseline.context + '\nPreserve meaningful values and caller-owned arrays.'));
  return { first, second };
}

describe('frozen SEKB prompt candidate evolution', () => {
  it('runs two parent-linked generations, validation elimination/hold and off/on/off with real SQLite and Node', async () => {
    const { store, input, sourceIds, dbPath } = setup({ executed: true });
    freezeEvolutionRun(store, input);
    const seen: unknown[] = [];
    const first = await generateEvolutionCandidate(store, { runId: input.runId, generation: 1,
      parentId: input.baseline.id, sourceTrajectoryIds: sourceIds }, async view => {
      seen.push(view);
      expect(exportEvolutionRun(store, input.runId).unfinishedGenerations).toEqual([1]);
      return generator(view.parent.context + '\nTraining summaries: ' + view.sources.map(source => source.summary).join(' '))();
    });
    const offBefore = resolveEvolutionPrompt(input.baseline.context, first.candidate);
    const on = resolveEvolutionPrompt(input.baseline.context, first.candidate, true);
    const offAfter = resolveEvolutionPrompt(input.baseline.context, first.candidate, false);
    expect(offBefore).toBe(input.baseline.context);
    expect(offAfter).toBe(offBefore);
    expect(on).not.toBe(offBefore);
    const rejected = screenEvolutionCandidate(store, { runId: input.runId, generation: 1, validation: evidence(1, true) });
    expect(rejected.status).toBe('eliminate');
    const second = await generateEvolutionCandidate(store, { runId: input.runId, generation: 2,
      parentId: first.candidate!.id, sourceTrajectoryIds: sourceIds }, async view => {
      seen.push(view);
      const repaired = view.sources.flatMap(source => source.observations).filter(observation => observation.stage === 'repaired' && observation.exitCode === 0);
      expect(repaired).toHaveLength(2);
      return generator(view.parent.context + '\nApply the two captured repair patterns while preserving caller contracts.')();
    });
    const held = screenEvolutionCandidate(store, { runId: input.runId, generation: 2, validation: evidence(2, true) });
    expect(held.numerical.status).toBe('promote');
    expect(held.status).toBe('hold');
    expect(first.candidate!.version).not.toBe(second.candidate!.version);
    expect(second.candidate!.parent).toEqual({ id: first.candidate!.id, version: first.candidate!.version });
    for (const view of seen) {
      const bytes = JSON.stringify(view);
      expect(bytes).not.toContain('evolution-validation-');
      expect(bytes).not.toContain(input.splits.heldOut[0].caseId);
      expect(bytes).toContain('RsiExperienceAttribution/v1');
      expect(bytes).toContain('initial');
    }
    const exported = exportEvolutionRun(store, input.runId);
    expect(checkEvolutionExport(exported).passed).toBe(true);
    expect(exported.budget.providerCalls).toBe(0);
    expect(exported.selectedCandidateId).toBeNull();
    expect(store.query_principles({ status: 'active' }).map(item => item.principle_id)).toEqual([input.baseline.id]);
    closeOpenClawStateDatabaseForTest();
    const reopened = new KnowledgeStore({ database: { path: dbPath } });
    expect(exportEvolutionRun(reopened, input.runId)).toEqual(exported);
    if (process.env.RSI_EVOLUTION_EXPORT) writeFileSync(process.env.RSI_EVOLUTION_EXPORT, JSON.stringify(exported, null, 2) + '\n');
    if (process.env.RSI_EVOLUTION_EVENTS) writeFileSync(process.env.RSI_EVOLUTION_EVENTS, JSON.stringify({
      driven_by: 'agent', actor: 'codex/evolution-integration', generatorInputs: seen,
      rollback: { offBeforeDigest: benefitDigest(offBefore), onDigest: benefitDigest(on), offAfterDigest: benefitDigest(offAfter) },
      candidateIds: [first.candidate!.id, second.candidate!.id], verdicts: [rejected.status, held.status],
    }, null, 2) + '\n');
    closeOpenClawStateDatabaseForTest();
    if (process.env.RSI_EVOLUTION_DB) copyFileSync(dbPath, process.env.RSI_EVOLUTION_DB);
  }, 120000);

  it('rejects overlapping splits, stale training bindings and non-training attribution before generator calls', async () => {
    const { store, input, sourceIds } = setup();
    const overlap = structuredClone(input);
    overlap.splits.validation[0].caseId = overlap.splits.training[0].caseId;
    expect(() => freezeEvolutionRun(store, overlap)).toThrow(/split-overlap/);
    freezeEvolutionRun(store, input);
    const trajectory = store.get_trajectory(sourceIds[0]);
    store.update_trajectory(sourceIds[0], { metadata: { ...trajectory.metadata,
      rsiTraining: { ...(trajectory.metadata.rsiTraining as object), inputDigest: benefitDigest('drift') } } });
    let calls = 0;
    await expect(generateEvolutionCandidate(store, { runId: input.runId, generation: 1,
      parentId: input.baseline.id, sourceTrajectoryIds: sourceIds }, async () => {
      calls += 1; return generator('prompt')();
    })).rejects.toThrow(/training-binding/);
    expect(calls).toBe(0);
  });

  it('keeps first generator failures and reservations, rejects duplicate generation and immutable entry replacement', async () => {
    const { store, input, sourceIds } = setup();
    freezeEvolutionRun(store, input);
    let calls = 0;
    const args = { runId: input.runId, generation: 1, parentId: input.baseline.id, sourceTrajectoryIds: sourceIds };
    const failed = await generateEvolutionCandidate(store, args, async () => { calls += 1; throw new Error('original generator failure'); });
    expect(failed.status).toBe('failed');
    expect(failed.failure).toContain('original generator failure');
    await expect(generateEvolutionCandidate(store, args, generator('replacement'))).rejects.toThrow(/generation-already-started/);
    expect(calls).toBe(1);
    const exported = exportEvolutionRun(store, input.runId);
    expect(exported.budget.unknownGenerations).toEqual([1]);
    expect(checkEvolutionExport(exported).passed).toBe(true);
    const existing = store.query_trajectories({ task_type: 'rsi/candidate-evolution' })[0];
    expect(store.create_trajectory({ ...existing, task_intent: 'overwrite first failure' })).toBe(false);
    expect(store.get_trajectory(existing.trajectory_id).task_intent).toBe(existing.task_intent);
  });

  it('reserves before invoking the generator and retains an unfinished attempt without redispatch', async () => {
    const { store, input, sourceIds } = setup();
    freezeEvolutionRun(store, input);
    let complete!: (value: { context: string; usage: { providerCalls: number; tokens: number; costUsd: number }; actor: string }) => void;
    const args = { runId: input.runId, generation: 1, parentId: input.baseline.id, sourceTrajectoryIds: sourceIds };
    const pending = generateEvolutionCandidate(store, args, () => new Promise(resolvePending => { complete = resolvePending; }));
    expect(exportEvolutionRun(store, input.runId).unfinishedGenerations).toEqual([1]);
    await expect(generateEvolutionCandidate(store, args, generator('duplicate'))).rejects.toThrow(/generation-already-started/);
    complete(await generator('Finished prompt')());
    await pending;
    expect(exportEvolutionRun(store, input.runId).unfinishedGenerations).toEqual([]);
  });

  it('preserves an unbounded increase from a zero cost baseline across SQLite and JSON readback', async () => {
    const { store, input, sourceIds } = setup();
    await generateTwo(store, input, sourceIds);
    const validation = evidence(2);
    validation.treatmentRuns.forEach(row => { row.tokens = 1; });
    const decision = screenEvolutionCandidate(store, { runId: input.runId, generation: 2, validation });
    expect(decision.status).toBe('eliminate');
    expect(decision.costs.tokens.increase).toBe('unbounded');
    expect(checkEvolutionExport(JSON.parse(JSON.stringify(exportEvolutionRun(store, input.runId)))).passed).toBe(true);
  });

  it('retains a timed-out generator reservation and ignores its late output', async () => {
    const { store, input, sourceIds } = setup();
    input.budget.perGeneration.wallClockMs = 10;
    input.budget.wholeRun.wallClockMs = 20;
    freezeEvolutionRun(store, input);
    let signal: AbortSignal | undefined;
    const result = await generateEvolutionCandidate(store, { runId: input.runId, generation: 1,
      parentId: input.baseline.id, sourceTrajectoryIds: sourceIds }, async (_view, abortSignal) => {
      signal = abortSignal;
      await new Promise(done => setTimeout(done, 30));
      return generator('Late output')();
    });
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('generator-timeout');
    expect(signal!.aborted).toBe(true);
    await new Promise(done => setTimeout(done, 40));
    const exported = exportEvolutionRun(store, input.runId);
    expect(exported.candidates[0].candidate).toBeNull();
    expect(exported.budget.unknownGenerations).toEqual([1]);
    expect(exported.budget.reserved.wallClockMs).toBe(10);
  });

  it.each(['negative', 'cost', 'unknown-cost', 'safety', 'missing', 'forged-live'] as const)(
    'holds or eliminates %s validation without changing active principles', async kind => {
      const { store, input, sourceIds } = setup();
      await generateTwo(store, input, sourceIds);
      const validation = evidence(2);
      if (kind === 'negative') validation.treatmentRuns = observations('first');
      if (kind === 'cost') validation.treatmentRuns.forEach(row => { row.toolCalls = 2; });
      if (kind === 'unknown-cost') validation.treatmentRuns[10].tokens = null;
      if (kind === 'safety') { validation.treatmentRuns[0].outcome = 'fail'; validation.treatmentRuns[0].rawResult!.exitCode = 1;
        validation.treatmentRuns[0].rawDigest = benefitDigest(validation.treatmentRuns[0].rawResult); }
      if (kind === 'missing') validation.treatmentRuns.pop();
      if (kind === 'forged-live') (validation as { evidenceKind: string }).evidenceKind = 'live-provider';
      if (kind === 'forged-live') {
        expect(() => screenEvolutionCandidate(store, { runId: input.runId, generation: 2, validation })).toThrow(/validation-evidence-kind/);
      } else {
        const decision = screenEvolutionCandidate(store, { runId: input.runId, generation: 2, validation });
        expect(decision.status).toBe(['negative', 'cost', 'safety'].includes(kind) ? 'eliminate' : 'hold');
      }
      expect(exportEvolutionRun(store, input.runId).selectedCandidateId).toBeNull();
      expect(store.query_principles({ status: 'active' }).length).toBe(1);
    });

  it('rejects rehashed parent, source, policy and selection tampering and returns off before reading a candidate', async () => {
    const { store, input, sourceIds } = setup();
    await generateTwo(store, input, sourceIds);
    screenEvolutionCandidate(store, { runId: input.runId, generation: 1, validation: evidence(1) });
    screenEvolutionCandidate(store, { runId: input.runId, generation: 2, validation: evidence(2) });
    const exported = exportEvolutionRun(store, input.runId);
    for (const mutate of [
      (copy: typeof exported) => { copy.entries.find(item => item.kind === 'plan')!.payload.policy.minimumImprovement = 0.001; },
      (copy: typeof exported) => { const entry = copy.entries.find(item => item.kind === 'candidate' && item.generation === 2)!;
        if (entry.kind !== 'candidate' || !entry.payload.candidate) throw new Error('candidate fixture missing');
        entry.payload.candidate.parent.version = benefitDigest('wrong-parent'); },
      (copy: typeof exported) => { const entry = copy.entries.find(item => item.kind === 'attempt')!;
        entry.payload.sources[0].attribution[0].evidence.taskId = input.splits.heldOut[0].caseId; },
      (copy: typeof exported) => { const entry = copy.entries.find(item => item.kind === 'decision')!; Reflect.set(entry.payload, 'status', 'selected'); },
    ]) {
      const copy = structuredClone(exported);
      mutate(copy);
      for (const entry of copy.entries) entry.digest = benefitDigest(entry.payload);
      expect(checkEvolutionExport(copy).passed).toBe(false);
    }
    expect(resolveEvolutionPrompt('exact prior bytes\r\n', null)).toBe('exact prior bytes\r\n');
    for (const flag of [null, 'true', 'false', 1, {}]) {
      expect(Reflect.apply(resolveEvolutionPrompt, null, ['exact prior bytes\r\n', null, flag])).toBe('exact prior bytes\r\n');
    }
  });

  it('binds a staged version to a separate v2 benefit plan while preserving the v4 execution protocol', async () => {
    const { store, input, sourceIds, tasks } = setup();
    await generateTwo(store, input, sourceIds);
    screenEvolutionCandidate(store, { runId: input.runId, generation: 1, validation: evidence(1) });
    screenEvolutionCandidate(store, { runId: input.runId, generation: 2, validation: evidence(2) });
    const evolution = exportEvolutionRun(store, input.runId);
    expect(evolution.measurementCandidateId).toBe(evolution.candidates[1].candidate!.id);
    const plan = createBenefitPlan(repo, { mode: 'measured', codingCollector: true, collectorVersion: 'RsiCodingCollector/v4',
      candidateEvolution: evolution, candidateGeneration: 2, maxProviderCalls: 864, maxTotalTokens: 12000000 });
    expect(plan.schemaVersion).toBe('RsiBenefitPlan/v2');
    expect(plan.collector!.version).toBe('RsiCodingCollector/v4');
    expect(plan.tasks).toEqual(tasks);
    expect(plan.slots).toHaveLength(216);
    expect(validateBenefitPlan(plan, repo)).toBe(true);
    const drifted = structuredClone(plan);
    drifted.candidate.context += 'unfrozen extra instruction';
    expect(() => validateBenefitPlan(drifted, repo)).toThrow(/candidate|evolution/);
    const legacy = finalPlan();
    expect(legacy.schemaVersion).toBe('RsiBenefitPlan/v1');
    expect(legacy.candidate.kind).toBe('synthetic-control');
  }, 240000);
});
