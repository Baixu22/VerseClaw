// @vitest-environment node
// E02: the first real single-component paired ablation.
//
// Component (reversible, non-safety): Phase-4 type-aware "importance" eviction
// vs the pre-Phase-4 "fifo" eviction in the real RuntimeMemoryStore. Baseline =
// leave-one-out (fifo); treatment = importance. The corpus is a deterministic
// local fixture (no live provider) of 20 cases x 3 repeated seeds x 2 conditions.
//
// Pre-registered: primary metric = procedural-fact retention; k=3; >=20 cases;
// degradation budget = 0 (the primary metric must not regress). Effect size and
// a 95% CI are reported; a zero/negative effect is a valid result and is never
// turned into a fabricated win.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import {
  RuntimeMemoryStore,
} from '../../openclaw_runtime/src/runtime-core/memory-store';
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from '../../openclaw_runtime/src/runtime-core';

import { readFileSync } from 'node:fs';
import {
  evaluateAblation,
  type AblationRun,
  type PreRegisteredAblation,
} from '../../scripts/lib/paired-ablation.mjs';

const PRE_REGISTERED: PreRegisteredAblation = JSON.parse(
  readFileSync(new URL('../../shared/agent-dev/paired-ablation-fixture.json', import.meta.url), 'utf8'),
).preRegistered;

const K = 3;
const CASE_COUNT = 20;
const PER_TYPE = 5;
const MAX_FACTS = 10;
const NOW = 8_640_000_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFact(id: string, memoryType: 'procedural' | 'episodic' | 'semantic'): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject: 'SharedEviction',
    predicate: 'has',
    objectSummary: `Fact ${id} summary.`,
    confidence: 0.7,
    source: 'tool_result',
    verificationStatus: 'verified',
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    memoryType,
    sourceEpisodeRefs: [{ episodeId: 'episode_test', taskId: 'task_test', kind: 'verifier_summary', idempotencyKey: `task:${id}`, reference_time: 10 }],
    evidenceRefs: [{ type: 'test', ref: 'tests/unit/runtime-memory-paired-ablation.test.ts' }],
  });
}

function buildCase(seed: number): RuntimeMemoryTemporalFact[] {
  const facts: RuntimeMemoryTemporalFact[] = [];
  for (let i = 0; i < PER_TYPE; i++) facts.push(makeFact(`proc_${i}`, 'procedural'));
  for (let i = 0; i < PER_TYPE; i++) facts.push(makeFact(`epis_${i}`, 'episodic'));
  for (let i = 0; i < PER_TYPE; i++) facts.push(makeFact(`sem_${i}`, 'semantic'));
  // Deterministic per-seed insertion order (varies FIFO outcome).
  const rand = mulberry32(seed);
  for (let i = facts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [facts[i], facts[j]] = [facts[j], facts[i]];
  }
  return facts;
}

function survivors(store: RuntimeMemoryStore, prefix: string): number {
  let count = 0;
  for (let i = 0; i < PER_TYPE; i++) if (store.getFactById(`${prefix}${i}`) !== undefined) count++;
  return count;
}

function runCondition(policy: 'fifo' | 'importance', seed: number): { procedural: number; episodic: number; evicted: string[] } {
  const store = new RuntimeMemoryStore({ maxFacts: MAX_FACTS, evictionPolicy: policy, now: () => NOW });
  const facts = buildCase(seed);
  const before = facts.map((fact) => fact.factId).sort();
  for (const fact of facts) store.appendFact(fact);
  const procedural = survivors(store, 'proc_') / PER_TYPE;
  const episodic = survivors(store, 'epis_') / PER_TYPE;
  const evicted = before.filter((id) => store.getFactById(id) === undefined);
  return { procedural, episodic, evicted };
}

describe('E02 paired ablation: type-aware eviction vs FIFO (real RuntimeMemoryStore)', () => {
  const baselineRuns: AblationRun[] = [];
  const treatmentRuns: AblationRun[] = [];
  const effectTraces: boolean[] = [];

  it('runs 20 cases x 3 repeats x 2 conditions and reports effect + 95% CI (never fabricating a win)', () => {
    const started = Date.now();
    for (let caseIndex = 0; caseIndex < CASE_COUNT; caseIndex++) {
      for (let repeat = 0; repeat < K; repeat++) {
        const seed = caseIndex * 97 + repeat * 13 + 1;
        const controlStart = performance.now();
        const control = runCondition('fifo', seed);
        const controlMs = performance.now() - controlStart;
        const treatedStart = performance.now();
        const treated = runCondition('importance', seed);
        const treatedMs = performance.now() - treatedStart;
        // Component-effect trace: removal (fifo) must change at least one run.
        effectTraces.push(control.procedural !== treated.procedural || control.evicted.join(',') !== treated.evicted.join(','));
        baselineRuns.push({ caseId: `case-${caseIndex}`, repeat, success: control.procedural >= 1, proceduralRetention: control.procedural, latencyMs: controlMs, tokens: MAX_FACTS });
        treatmentRuns.push({ caseId: `case-${caseIndex}`, repeat, success: treated.procedural >= 1, proceduralRetention: treated.procedural, latencyMs: treatedMs, tokens: MAX_FACTS });
      }
    }

    const result = evaluateAblation({
      baselineRuns,
      treatmentRuns,
      preRegistered: PRE_REGISTERED,
    });

    // Real runs, real 20 x 3 x 2 corpus.
    expect(baselineRuns).toHaveLength(CASE_COUNT * K);
    expect(treatmentRuns).toHaveLength(CASE_COUNT * K);

    // The component really takes effect (removal changes the evicted/retained set).
    expect(effectTraces.some(Boolean)).toBe(true);

    // Reported fields exist; verdict is one of the allowed honest outcomes.
    expect(result.effect.pairCount).toBe(CASE_COUNT);
    expect(result.effect.repeatPairCount).toBe(CASE_COUNT * K);
    expect(result.effect.inferenceUnit).toBe('caseId');
    expect(result.effect.ci95).not.toBeNull();
    expect(['component-helps', 'no-effect', 'hurts', 'insufficient-sample']).toContain(result.verdict);

    // The treatment must not silently regress procedural retention below the control.
    expect(result.treatment.p50LatencyMs).not.toBeNull();
    expect(result.treatment.falseBlocks).toBe(0);
    expect(result.treatment.safetyViolations).toBe(0);
    expect(result.treatment.passK ?? 0).toBeGreaterThanOrEqual(result.baseline.passK ?? 0);
    expect(result.effect.meanDiff ?? -1).toBeGreaterThanOrEqual(0);

    expect(Date.now() - started).toBeGreaterThan(0);

    // Emit the measured report so the acceptance evidence can cite real numbers.
    console.log('E02_REPORT ' + JSON.stringify(result));
  });
});
