// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';
import { getMainResourceEnvelopeSnapshot } from '../../electron/services/resource-envelope';
import { ResourceLeaseManager } from '../../openclaw_runtime/src/agents/resource-leases';

const owners = vi.hoisted(() => ({ browsers: [{ id: 'browser-owned', workspaceId: 'workspace-one' }] }));
vi.mock('../../electron/services/agent-browser-api', () => ({ getDefaultAgentBrowserService: () => ({ list: () => owners.browsers }) }));
vi.mock('../../openclaw_runtime/src/process/process-tree-sampler', () => ({
  ProcessTreeSampler: class {
    async sample() { return { status: 'ok', sampledAt: Date.now(), processCount: 1, treeRssBytes: 1024, treeCpuPercent: 0, rootPids: [process.pid], queueDepth: 0, queueWaitMs: 0,
      processes: [{ pid: process.pid, parentPid: process.ppid, creationToken: 'fixture', rssBytes: 1024, privateBytes: 512, cpuTimeMs: 0, cpuPercent: 0 }] }; }
  },
}));

describe('resource envelopes rebuild from existing owners', () => {
  beforeEach(() => resetResourceEnvelopeLedgerForTest());

  it('reconstructs browser and terminal occupancy after the Main projection is cleared', async () => {
    const terminalManager = { listAll: () => [{ sessionId: 'terminal-owned', workspaceId: 'workspace-one', sessionKey: 'session-one',
      expectedSessionId: 'generation-one', pid: 123, keepOnLeave: true }] };
    const snapshot = await getMainResourceEnvelopeSnapshot({ terminalManager });
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main:browser-session:browser-owned', workspaceKey: 'workspace-one', activeSlots: 1 }),
      expect.objectContaining({ id: 'main:pty-session:terminal-owned', workspaceKey: 'workspace-one', activeSlots: 1, pids: [123] }),
    ]));
  });

  it('reconstructs active and waiting runtime leases without freeing capacity', async () => {
    const manager = new ResourceLeaseManager();
    const active = await manager.acquire('workspaceWriter', 'workspace-one');
    const waiting = manager.acquire('workspaceWriter', 'workspace-one');
    try {
      resetResourceEnvelopeLedgerForTest();
      manager.rebuildResourceEnvelope();
      expect(getResourceEnvelopeLedger().get('gateway:workspaceWriter:workspace-one')).toMatchObject({ activeSlots: 1, queuedCount: 1 });
    } finally { active.release(); (await waiting).release(); }
  });
});
