import assert from 'node:assert/strict';

export function verifyLifecycleReport(report, { smoke = false } = {}) {
  assert.equal(report.driven_by, 'agent'); assert.equal(report.status, 'pass');
  assert.equal(report.smoke, smoke);
  assert(report.cleanup.mainExited && report.cleanup.launcherExited, 'Final process exit missing');
  const repeated = report.cycles.filter(row => row.stage === 'repeat');
  assert.equal(repeated.length, smoke ? 3 : 50);
  assert.deepEqual(repeated.map(row => row.index), Array.from({ length: repeated.length }, (_, i) => i + 1));
  const terminalIds = new Set(), observerIds = new Set(), processIdentities = new Set();
  let lastEndedAt = 0;
  for (const row of report.cycles) {
    assert.equal(row.status, 'pass'); assert(row.receipt.root > 0 && row.receipt.child > 0);
    assert(row.staleGenerationRejected && typeof row.expectedSessionId === 'string');
    assert(typeof row.terminalId === 'string' && row.terminalId && !terminalIds.has(row.terminalId), 'Repeated terminal receipt'); terminalIds.add(row.terminalId);
    assert(Number.isSafeInteger(row.observerId) && row.observerId > 0 && !observerIds.has(row.observerId), 'Repeated observer receipt'); observerIds.add(row.observerId);
    assert(row.observerClose?.id === row.observerId && row.observerClose.destroyed === true);
    assert(row.closeReceipt?.success === true && row.closeReceipt.status === 'exited');
    assert.equal(row.closeReceipt.sessionId, row.terminalId); assert.equal(row.closeReceipt.expectedSessionId, row.expectedSessionId);
    assert.equal(row.closeReceipt.pid, row.terminalPid);
    assert(row.startedAt >= lastEndedAt && row.cancelledAt >= row.startedAt && row.endedAt >= row.exitObservedAt);
    assert(row.observerClose.closedAt >= row.startedAt && row.observerClose.closedAt <= row.cancelledAt);
    lastEndedAt = row.endedAt;
    assert.equal(row.createdTree.status, 'ok');
    assert(row.createdTree.processes.some(p => p.pid === row.receipt.root));
    assert(row.createdTree.processes.some(p => p.pid === row.receipt.child));
    assert(row.createdTree.processes.some(p => p.pid === row.terminalPid));
    assert.equal(row.exits.length, row.createdTree.processes.length);
    for (const process of row.createdTree.processes) {
      const key = `${process.pid}:${process.creationToken}`;
      assert(!processIdentities.has(key), 'A process identity was counted in multiple lifecycles'); processIdentities.add(key);
      const identity = Number(BigInt(process.creationToken) / 10000n - 11644473600000n);
      const exit = row.exits.find(entry => entry.pid === process.pid && entry.creationTime === identity);
      assert(exit && ['exited', 'replaced', 'terminated'].includes(exit.status), 'Missing owned exit identity');
    }
    assert.deepEqual(row.remainingTerminals, []);
    assert(row.exitObservedAt >= row.cancelledAt && row.cancelToExitMs === row.exitObservedAt - row.cancelledAt);
  }
  const required = { 'idle-before': smoke ? 0 : 300000, 'idle-recovery': smoke ? 0 : 300000, 'sustained-observation': smoke ? 0 : 1800000 };
  const intervals = [];
  for (const [name, duration] of Object.entries(required)) {
    const segments = report.segments.filter(segment => segment.name === name); assert.equal(segments.length, 1);
    const segment = segments[0]; assert(segment.end - segment.start >= duration && segment.elapsedMs === segment.end - segment.start);
    if (intervals.length) assert(segment.start >= intervals.at(-1).end, 'Overlapping observation segments'); intervals.push(segment);
    const samples = report.observations.filter(row => row.stage === `${name}:start` || row.stage === `${name}:sample`);
    assert(samples.length > 0 && samples.every(row => row.at >= segment.start && row.at <= segment.end));
    assert.equal(samples[0].stage, `${name}:start`);
    assert(samples[0].at - segment.start <= 120_000, 'Unobserved segment beginning');
    for (let i = 1; i < samples.length; i++) assert(samples[i].at > samples[i - 1].at, 'Repeated or reversed observation timestamp');
    if (!smoke) {
      assert(samples.length >= Math.floor(duration / 60_000), 'Insufficient sustained observations');
      assert(segment.end - samples.at(-1).at <= 120_000, 'Unobserved segment tail');
      for (let i = 1; i < samples.length; i++) assert(samples[i].at - samples[i - 1].at <= 120_000, 'Observation gap exceeds two minutes');
    }
  }
  assert(repeated[0].startedAt >= intervals[0].end && repeated.at(-1).endedAt <= intervals[1].start);
  const probes = report.cycles.filter(row => row.stage === 'soak');
  assert(probes.every(row => row.startedAt >= intervals[2].start && row.endedAt <= intervals[2].end), 'Probe outside sustained interval');
  if (!smoke) {
    assert(probes.length >= 5, 'Sustained observation lacked periodic live probes');
    for (let i = 0; i < 5; i++) assert(probes[i].startedAt >= intervals[2].start + (i + 1) * 300_000 && probes[i].startedAt <= intervals[2].start + (i + 1) * 300_000 + 120_000, 'Probe cadence outside five-minute window');
  }
  const recovered = report.observations.find(row => row.stage === 'recovered');
  const final = report.observations.at(-1); assert.equal(final.stage, 'final');
  for (const sample of [recovered, final]) {
    assert.equal(sample.owner.windows, 1); assert.deepEqual(sample.terminals.sessions, []);
    assert(Object.values(sample.owner.fabric.accounts).every(account => account.active === 0 && account.queued === 0));
  }
  if (!smoke) {
    const collected = report.observations.find(row => row.stage === 'cold-account-collected');
    assert(collected && !(report.accountKey in collected.owner.fabric.accounts), 'Cold workspace account was not collected');
  }
  const baseline = report.observations.find(row => row.stage === 'idle-before:end');
  const metric = row => ({ at: row.at, rssBytes: row.processTree.status === 'ok' ? row.processTree.treeRssBytes : null, privateBytes: row.processTree.status === 'ok' && row.processTree.processes?.length > 0 && row.processTree.processes.every(p => Number.isFinite(p.privateBytes) && p.privateBytes >= 0) ? row.processTree.processes.reduce((n, p) => n + p.privateBytes, 0) : null,
    handles: row.handles?.status === 'ok' ? row.handles.total : null, rendererHeapBytes: row.rendererHeap, machineCommit: row.processTree.machineCommit ?? null,
    accounts: Object.keys(row.owner.fabric.accounts).length, watchers: row.owner.watchers });
  return { verified: true, smoke, repeatCycles: repeated.length, soakProbes: report.cycles.filter(row => row.stage === 'soak').length,
    ownedExits: report.cycles.reduce((n, row) => n + row.exits.length, 0), cancelToExitMs: report.cycles.map(row => row.cancelToExitMs),
    segments: report.segments, baseline: metric(baseline), recovered: metric(recovered), final: metric(final), observations: report.observations.map(metric), unknown: report.unknown,
    cleanup: report.cleanup, boundary: smoke ? 'Development smoke with three cycles; no idle-duration acceptance.' : 'Measured50 lifecycle and30-minute sustained observation; unknown counters and memory trends remain explicit.' };
}
