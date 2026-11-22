// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { buildLongSessionPairedWorkload, evaluateLongSessionPair, summarizeLongSessionPairedEvaluation } from '../../shared/long-session-paired-evaluation';

describe('current project continuity over the frozen paired workload', () => {
  it('preserves decisions and prior failure outcomes across all 30 owner projections', () => {
    const manifest = buildLongSessionPairedWorkload();
    const baseline = JSON.parse(readFileSync(new URL('./fixtures/autonomy-context-baseline.json', import.meta.url), 'utf8')) as {
      sourceCandidate: string; workloadHash: string; rows: Array<{ caseId: string; inputHash: string; outputText: string }>;
    };
    expect(baseline.workloadHash).toBe(manifest.workloadHash);
    const rawArm = (outputText: string) => ({ provider: 'none', model: manifest.modelParameters.model,
      measurementBasis: 'agent-derived' as const, outputText, costSource: 'unmeasured' as const,
      inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      totalCostUsd: null, firstTokenMs: null, wallClockMs: null });
    const samples: Array<{ caseId: string; baselineChars: number; candidateChars: number; projectionMs: number }> = [];
    const rows = manifest.cases.map(entry => {
      const root = mkdtempSync(join(tmpdir(), 'm1-paired-'));
      const store = new TaskSystemStore(resolveTaskDomain(root));
      try {
        const scope = { workspaceId: 'paired-project', sessionKey: 'paired-coordinator', generation: 'paired-generation' };
        const contract = { objective: entry.mustPreserve[0].text, constraints: [entry.mustPreserve[1].text], target: '.',
          acceptance: [{ id: 'proof', description: 'Verify through the original effect owner', verification: { kind: 'owner-receipt' as const, owner: 'paired-fixture' } }] };
        const plan = store.saveProjectPlan(scope, { requestId: entry.id, goal: contract, nextAction: entry.expectedNextAction,
          decisions: [entry.mustPreserve[2].text], children: [{ key: 'work', contract }] });
        const task = store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, 'claim');
        store.checkpoint(task.claim!, { nextAction: entry.expectedNextAction, completed: [entry.mustPreserve[3].text],
          unresolved: [entry.mustPreserve[4].text], artifacts: [] });
        const old = baseline.rows.find(row => row.caseId === entry.id)!;
        expect(old.inputHash).toBe(entry.inputHash);
        const start = performance.now();
        const candidateText = store.context(scope.sessionKey, scope.generation)!;
        samples.push({ caseId: entry.id, baselineChars: old.outputText.length, candidateChars: candidateText.length, projectionMs: performance.now() - start });
        return evaluateLongSessionPair({ caseValue: entry, baseline: rawArm(old.outputText), candidate: rawArm(candidateText) });
      } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
    });
    const report = summarizeLongSessionPairedEvaluation({ manifest, rows, actor: 'codex-m1-owner-projection' });
    const fidelity = (arm: 'baseline' | 'candidate') => rows.reduce((sum, row) => sum + row[arm].matchedMustPreserve.length, 0);
    expect(rows).toHaveLength(30);
    expect(fidelity('candidate')).toBeGreaterThan(fidelity('baseline'));
    for (const row of rows) {
      expect(row.candidate.missedMustPreserve, row.caseId).toEqual([]);
      expect(row.candidate.leakedForbiddenFacts, row.caseId).toEqual([]);
      expect(row.candidate.nextActionCorrect, row.caseId).toBe(true);
      expect(row.candidate.falseCompletion, row.caseId).toBe(false);
      expect(row.candidate.totalCostUsd).toBeNull();
    }
    expect(report.qualityClaimAllowed).toBe(false);
    expect(report.metricsBasis).toBe('agent-derived-structural');
    const output = process.env.CLAWX_M1_PAIRED_OUTPUT;
    if (output) writeFileSync(output, JSON.stringify({ driven_by: 'agent', actor: 'codex-m1-owner-projection',
      baselineCandidate: baseline.sourceCandidate, workloadHash: manifest.workloadHash, counts: { pairs: rows.length,
        baselineFacts: fidelity('baseline'), candidateFacts: fidelity('candidate'), requiredFacts: manifest.cases.reduce((n, entry) => n + entry.mustPreserve.length, 0) },
      scope: 'Deterministic current owner projection; no provider calls or live-model quality measurements',
      samples, rows, report }, null, 2));
  });
});
