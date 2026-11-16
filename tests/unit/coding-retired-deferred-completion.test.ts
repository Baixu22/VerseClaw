// @vitest-environment node
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

const fixture = vi.hoisted(() => ({ root: '', apply: vi.fn() }));
// The lifecycle/registry entry is real; candidate application is controlled at its effect boundary.
vi.mock('../../openclaw_runtime/src/agents/orchestration-patch-flow', () => ({
  applyDeferredPatchFlow: (...args: unknown[]) => fixture.apply(...args),
  recordDeferredPatchFlowCompletion: () => undefined,
}));

import {
  addSubagentRunForTests, finalizeInterruptedSubagentRun, getSubagentRunByRunId,
  resetSubagentRegistryForTests, testing,
} from '../../openclaw_runtime/src/agents/subagent-registry';

beforeEach(() => {
  resetSubagentRegistryForTests({ persist: false });
  fixture.root = mkdtempSync(join(tmpdir(), 'retired-deferred-'));
  fixture.apply.mockReset().mockImplementation(async () => {
    writeFileSync(join(fixture.root, 'legacy-apply.txt'), 'new legacy effect');
    return { status: 'applied', results: [], appliedAt: Date.now() };
  });
  testing.setDepsForTest({
    getRuntimeConfig: () => ({ plugins: { enabled: false } }),
    callGateway: vi.fn(async () => ({ status: 'ok' })),
    persistSubagentRunsToDisk: () => {}, persistSubagentRunsToDiskOrThrow: () => {},
    ensureContextEnginesInitialized: () => {}, ensureRuntimePluginsLoaded: () => {},
    resolveContextEngine: async () => ({ info: { id: 'fixture', name: 'Fixture', version: '1' } }),
    captureSubagentCompletionReply: async () => undefined,
    cleanupBrowserSessionsForLifecycleEnd: async () => {},
    candidateApplyHost: {}, runSubagentAnnounceFlow: vi.fn(async () => true),
  } as unknown as Parameters<typeof testing.setDepsForTest>[0]);
});
afterEach(() => {
  resetSubagentRegistryForTests({ persist: false });
  testing.setDepsForTest();
});

function workers(applied = false) {
  const ids = ['retired-1', 'retired-2', 'retired-3'];
  const records = ids.map((runId, index): SubagentRunRecord => ({
    runId, childSessionKey: `agent:main:${runId}`, requesterSessionKey: 'agent:main:retired-parent',
    requesterDisplayKey: 'retirement-fixture', task: 'legacy proposal', cleanup: 'keep',
    workspaceDir: fixture.root, createdAt: Date.now(),
    ...(index < 2 ? { endedAt: Date.now(), outcome: { status: 'ok' as const } } : {}),
    orchestration: { orchestrationRunId: 'retired-orchestration', roleName: 'implementer',
      isVerifier: false, phase: 'worker', leadRole: 'implementer', originalTask: 'legacy coding',
      expectedWorkerRunIds: ids, patchFlowExecution: true,
      ...(applied ? { patchFlowStatus: 'applied' as const, patchFlowAppliedAt: 42,
        patchFlowResults: [{ workerId: 'retired-1', ok: true }] } : {}),
    },
  }));
  for (const record of records) addSubagentRunForTests(record);
  return records;
}

describe('TF-0774 retired deferred execution', () => {
  it('rejects new candidate application carried by legacy completion metadata', async () => {
    const records = workers();
    expect(await finalizeInterruptedSubagentRun({ runId: records[2].runId, error: 'fixture stopped' })).toBe(1);
    expect(getSubagentRunByRunId(records[2].runId)?.endedAt).toBeTypeOf('number');
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(existsSync(join(fixture.root, 'legacy-apply.txt'))).toBe(false);
    expect(getSubagentRunByRunId(records[0].runId)?.orchestration).toMatchObject({
      patchFlowStatus: 'blocked', patchFlowError: 'patch_flow_retired', verifierSkippedReason: 'retired-patch-flow',
    });
  });

  it('retains previously applied effects and their recorded identity', async () => {
    const records = workers(true);
    const file = join(fixture.root, 'already-applied.txt');
    writeFileSync(file, 'historic effect');
    await finalizeInterruptedSubagentRun({ runId: records[2].runId, error: 'fixture stopped' });
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('historic effect');
    expect(getSubagentRunByRunId(records[0].runId)?.orchestration).toMatchObject({ patchFlowStatus: 'applied', patchFlowAppliedAt: 42 });
  });

  it.each([0, 1])('preserves applied worker %s while blocking mixed pending legacy entries', async (appliedIndex) => {
    const records = workers();
    const applied = records[appliedIndex].orchestration!;
    applied.patchFlowStatus = 'applied';
    applied.patchFlowAppliedAt = 42;
    applied.patchFlowCandidateId = 'historical-candidate';
    applied.patchFlowResults = [{ workerId: records[appliedIndex].runId, ok: true }];
    const original = structuredClone(applied);
    await finalizeInterruptedSubagentRun({ runId: records[2].runId, error: 'fixture stopped' });
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(records[appliedIndex].orchestration).toEqual(original);
    for (const record of records.filter((_, index) => index !== appliedIndex)) {
      expect(record.orchestration).toMatchObject({
        patchFlowStatus: 'blocked', patchFlowError: 'patch_flow_retired', verifierSkippedReason: 'retired-patch-flow',
      });
    }
  });
});
