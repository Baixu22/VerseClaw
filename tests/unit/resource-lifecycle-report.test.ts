import { describe, expect, it } from 'vitest';
import { verifyLifecycleReport } from '../../scripts/lib/resource-lifecycle-report.mjs';

function report() {
  const sample = (stage: string, at = 1000) => ({ stage, at, processTree: { status: 'ok', treeRssBytes: 10, processes: [{ privateBytes: 20 }] }, handles: { status: 'ok', total: 5 }, rendererHeap: 6,
    owner: { windows: 1, fabric: { accounts: {} }, watchers: null }, terminals: { sessions: [] } });
  return { driven_by: 'agent', status: 'pass', smoke: true, cleanup: { mainExited: true, launcherExited: true }, unknown: [],
    cycles: [1, 2, 3].map(index => ({ stage: 'repeat', index, status: 'pass', terminalId: `terminal-${index}`, terminalPid: index * 10, observerId: index, observerClose: { id: index, destroyed: true, closedAt: 1100 + index * 200 },
      startedAt: 1001 + index * 200, endedAt: 1111 + index * 200, closeReceipt: { success: true, status: 'exited', sessionId: `terminal-${index}`, expectedSessionId: `repeat-${index}`, pid: index * 10 },
      expectedSessionId: `repeat-${index}`, staleGenerationRejected: true, receipt: { root: index * 10, child: index * 10 + 1 }, createdTree: { status: 'ok', processes: [index * 10, index * 10 + 1].map(pid => ({ pid, creationToken: '116444736010000000' })) },
      exits: [index * 10, index * 10 + 1].map(pid => ({ pid, creationTime: 1000, status: 'exited' })), remainingTerminals: [], cancelledAt: 1100 + index * 200, exitObservedAt: 1110 + index * 200, cancelToExitMs: 10 })),
    segments: [{ name: 'idle-before', start: 1000, end: 1001, elapsedMs: 1 }, { name: 'idle-recovery', start: 1800, end: 1801, elapsedMs: 1 }, { name: 'sustained-observation', start: 1900, end: 1901, elapsedMs: 1 }],
    observations: [sample('idle-before:start'), sample('idle-before:end', 1001), sample('idle-recovery:start', 1800), sample('recovered', 1802), sample('sustained-observation:start', 1900), sample('final', 1902)],
  };
}
function formalReport() {
  const result = report(); result.smoke = false;
  const makeCycle = (index: number, stage: string, start: number, unique: number) => ({ ...result.cycles[0], index, stage, terminalId: `t-${unique}`, terminalPid: unique * 10, observerId: unique,
    observerClose: { id: unique, destroyed: true, closedAt: start + 10 }, startedAt: start, endedAt: start + 30, cancelledAt: start + 10, exitObservedAt: start + 20, cancelToExitMs: 10,
    receipt: { root: unique * 10, child: unique * 10 + 1 }, expectedSessionId: `g-${unique}`,
    closeReceipt: { success: true, status: 'exited', sessionId: `t-${unique}`, expectedSessionId: `g-${unique}`, pid: unique * 10 },
    createdTree: { status: 'ok', processes: [unique * 10, unique * 10 + 1].map(pid => ({ pid, creationToken: '116444736010000000' })) },
    exits: [unique * 10, unique * 10 + 1].map(pid => ({ pid, creationTime: 1000, status: 'exited' })),
  });
  result.cycles = Array.from({ length: 50 }, (_, i) => makeCycle(i + 1, 'repeat', 302000 + i * 200, i + 1));
  result.cycles.push(...Array.from({ length: 5 }, (_, i) => makeCycle(i + 1, 'soak', 615000 + (i + 1) * 300000, 60 + i)));
  result.segments = [{ name: 'idle-before', start: 1000, end: 301000, elapsedMs: 300000 }, { name: 'idle-recovery', start: 314000, end: 614000, elapsedMs: 300000 }, { name: 'sustained-observation', start: 615000, end: 2415000, elapsedMs: 1800000 }];
  const template = result.observations[0];
  result.observations = result.segments.flatMap(segment => Array.from({ length: segment.elapsedMs / 30000 }, (_, i) => ({ ...template, stage: segment.name + (i === 0 ? ':start' : ':sample'), at: segment.start + i * 30000 })));
  result.observations.push({ ...template, stage: 'idle-before:end', at: 301000 }, { ...template, stage: 'recovered', at: 614001 }, { ...template, stage: 'cold-account-collected', at: 614002 }, { ...template, stage: 'final', at: 2415001 });
  return { ...result, accountKey: 'ws' };
}
describe('lifecycle report evidence gate', () => {
  it('verifies identity-bound exits and reports explicit observation scope', () => {
    expect(verifyLifecycleReport(report(), { smoke: true })).toMatchObject({ repeatCycles: 3, ownedExits: 6, recovered: { accounts: 0, handles: 5 } });
  });
  it('rejects smoke as formal evidence and rejects missing exit receipts', () => {
    expect(() => verifyLifecycleReport(report())).toThrow();
    const incomplete = report(); incomplete.cycles[0].exits.pop();
    expect(() => verifyLifecycleReport(incomplete, { smoke: true })).toThrow();
  });
  it('rejects stale process identities and remaining active ownership', () => {
    const stale = report(); stale.cycles[0].exits[0].creationTime = 2;
    expect(() => verifyLifecycleReport(stale, { smoke: true })).toThrow();
    const active = report(); active.observations.at(-1)!.owner.windows = 2;
    expect(() => verifyLifecycleReport(active, { smoke: true })).toThrow();
  });
  it('rejects reused lifecycle receipts and overlapping stages', () => {
    const reused = report(); reused.cycles[1].terminalId = reused.cycles[0].terminalId;
    expect(() => verifyLifecycleReport(reused, { smoke: true })).toThrow();
    const overlap = report(); overlap.segments[1] = { ...overlap.segments[0], name: 'idle-recovery' };
    expect(() => verifyLifecycleReport(overlap, { smoke: true })).toThrow();
  });
  it('keeps unknown empty process measurements null', () => {
    const missing = report(); missing.observations.at(-1)!.processTree = { status: 'unknown', treeRssBytes: 0, processes: [] };
    expect(verifyLifecycleReport(missing, { smoke: true }).final).toMatchObject({ rssBytes: null, privateBytes: null });
  });
  it('requires complete chronological observation coverage for formal intervals', () => {
    expect(verifyLifecycleReport(formalReport()).repeatCycles).toBe(50);
    const duplicates = formalReport();
    for (const sample of duplicates.observations.filter(row => row.stage.startsWith('sustained-observation:'))) sample.at = 2414999;
    expect(() => verifyLifecycleReport(duplicates)).toThrow();
    const missingStart = formalReport(); missingStart.observations = missingStart.observations.filter(row => row.stage !== 'sustained-observation:start');
    expect(() => verifyLifecycleReport(missingStart)).toThrow();
  });
});
