// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  RECLAIM_ACTION_CONTRACTS,
  RECLAIM_OWNERS,
  actionClosesTerminals,
  buildReclaimReceipt,
  decideLongSessionCoordination,
  reclaimLongSessionResources,
  resolveLongSessionCoordinationPolicy,
  shouldKeepTerminalOnLeave,
  type ReclaimOwnerHandlers,
  type ReclaimScope,
} from '@shared/long-session-resource-reclamation';

const SCOPE: ReclaimScope = {
  workspaceId: 'workspace-a',
  sessionKey: 'agent:architect:long-session',
  expectedSessionId: 'session-generation-1',
  rootPath: 'D:/workspace-a',
};

function handlers(overrides: Partial<ReclaimOwnerHandlers> = {}): ReclaimOwnerHandlers {
  return {
    terminals: {
      reclaim: vi.fn(() => ({ attempted: 2, reclaimed: 2, kept: 0 })),
      count: vi.fn(() => 0),
    },
    browsers: { reclaim: vi.fn(() => ({ attempted: 1, reclaimed: 1 })) },
    backgroundPorts: { reclaim: vi.fn(async () => ({ attempted: 1, reclaimed: 1, failed: 0 })) },
    worktrees: { reclaim: vi.fn(async () => ({ attempted: 1, reclaimed: 1, failed: 0, kept: 0 })) },
    admission: { release: vi.fn(async () => 1) },
    ...overrides,
  };
}

describe('E2 resource owner inventory', () => {
  it('describes exactly the five existing owners, with no universal resource table', () => {
    expect(RECLAIM_OWNERS.map((owner) => owner.kind)).toEqual([
      'terminal',
      'browser',
      'background-port',
      'worktree',
      'admission-permit',
    ]);
    expect(RECLAIM_OWNERS.every((owner) => owner.owner.length > 0)).toBe(true);
    expect(RECLAIM_OWNERS.filter((owner) => owner.supportsKeepOnLeave).map((owner) => owner.kind)).toEqual(['terminal']);
  });

  it('keeps ui-unload, run-cancel, archive and delete as distinct contracts', () => {
    const byAction = Object.fromEntries(RECLAIM_ACTION_CONTRACTS.map((entry) => [entry.action, entry]));
    expect(byAction['ui-unload']).toMatchObject({
      closesTerminals: false,
      closesBrowsers: false,
      stopsManagedPorts: false,
      cleansWorktrees: false,
      releasesAdmission: false,
      invalidatesBinding: false,
    });
    expect(byAction['run-cancel']).toMatchObject({ releasesAdmission: true, closesTerminals: false, invalidatesBinding: false });
    expect(byAction['session-archive']).toMatchObject({ invalidatesBinding: true, closesTerminals: false, cleansWorktrees: false });
    expect(byAction['session-delete']).toMatchObject({
      closesTerminals: true,
      closesBrowsers: true,
      stopsManagedPorts: true,
      cleansWorktrees: true,
      releasesAdmission: true,
      invalidatesBinding: true,
    });
    expect(byAction['workspace-switch']).toMatchObject({ closesTerminals: false, closesBrowsers: false });
    expect(byAction['app-quit']).toMatchObject({ cleansWorktrees: false });
    expect(actionClosesTerminals('ui-unload')).toBe(false);
    expect(actionClosesTerminals('session-delete')).toBe(true);
  });

  it('never honors keep_on_leave for a delete, only for life-cycle actions', () => {
    expect(shouldKeepTerminalOnLeave('ui-unload', { keepOnLeave: true })).toBe(true);
    expect(shouldKeepTerminalOnLeave('workspace-switch', { keepOnLeave: true })).toBe(true);
    expect(shouldKeepTerminalOnLeave('session-delete', { keepOnLeave: true })).toBe(false);
    expect(shouldKeepTerminalOnLeave('app-quit', { keepOnLeave: true })).toBe(false);
    expect(shouldKeepTerminalOnLeave('ui-unload', undefined)).toBe(true);
  });
});

describe('E2 reclamation receipts', () => {
  it('does not touch any owner on ui-unload and records keep_on_leave separately', async () => {
    const terminalHandlers = {
      reclaim: vi.fn(() => ({ attempted: 0, reclaimed: 0, kept: 0 })),
      count: vi.fn(() => 2),
    };
    const others = {
      browsers: { reclaim: vi.fn() },
      backgroundPorts: { reclaim: vi.fn() },
      worktrees: { reclaim: vi.fn() },
      admission: { release: vi.fn() },
    };
    const receipt = await reclaimLongSessionResources({
      action: 'ui-unload',
      scope: SCOPE,
      owners: { terminals: terminalHandlers, ...others },
      generatedAt: '2026-10-24T05:00:00.000Z',
    });

    expect(terminalHandlers.reclaim).not.toHaveBeenCalled();
    expect(terminalHandlers.count).toHaveBeenCalledOnce();
    expect(others.browsers.reclaim).not.toHaveBeenCalled();
    expect(others.backgroundPorts.reclaim).not.toHaveBeenCalled();
    expect(others.worktrees.reclaim).not.toHaveBeenCalled();
    expect(others.admission.release).not.toHaveBeenCalled();
    expect(receipt.keptOnLeave).toBe(2);
    expect(receipt.recoveryRequired).toBe(false);
    expect(receipt.retryable).toBe(false);
  });

  it('reclaims every owned handle on session-delete and honors a keep_on_leave terminal', async () => {
    const owners = handlers({
      terminals: {
        reclaim: vi.fn(() => ({ attempted: 3, reclaimed: 2, kept: 1 })),
        count: vi.fn(() => 3),
      },
    });
    const receipt = await reclaimLongSessionResources({
      action: 'session-delete',
      scope: SCOPE,
      owners,
      generatedAt: '2026-10-24T05:00:00.000Z',
    });

    expect(receipt.action).toBe('session-delete');
    expect(receipt.keptOnLeave).toBe(1);
    expect(receipt.owners.find((owner) => owner.kind === 'terminal')).toMatchObject({ reclaimed: 2, kept: 1 });
    expect(receipt.owners.find((owner) => owner.kind === 'browser')).toMatchObject({ outcome: 'reclaimed' });
    expect(receipt.owners.find((owner) => owner.kind === 'background-port')).toMatchObject({ outcome: 'reclaimed' });
    expect(receipt.owners.find((owner) => owner.kind === 'worktree')).toMatchObject({ outcome: 'reclaimed' });
    expect(receipt.owners.find((owner) => owner.kind === 'admission-permit')).toMatchObject({ outcome: 'reclaimed' });
    expect(receipt.recoveryRequired).toBe(false);
  });

  it('marks recovery_required with a retry identity on owner failure or unknown', async () => {
    const owners = handlers({
      browsers: {
        reclaim: vi.fn(() => {
          throw new Error('browser window refused to close');
        }),
      },
      backgroundPorts: { reclaim: vi.fn(async () => ({ attempted: 2, reclaimed: 1, failed: 1 })) },
      worktrees: { reclaim: vi.fn(async () => ({ attempted: 1, reclaimed: 0, failed: 1 })) },
    });
    const receipt = await reclaimLongSessionResources({
      action: 'session-delete',
      scope: SCOPE,
      owners,
      generatedAt: '2026-10-24T05:00:00.000Z',
      recoveryId: 'recovery:e2:agent-1',
    });

    expect(receipt.recoveryRequired).toBe(true);
    expect(receipt.retryable).toBe(true);
    expect(receipt.recoveryId).toBe('recovery:e2:agent-1');
    expect(receipt.owners.find((owner) => owner.kind === 'browser')?.outcome).toBe('failed');
    expect(receipt.owners.find((owner) => owner.kind === 'background-port')?.outcome).toBe('failed');
    expect(receipt.owners.find((owner) => owner.kind === 'worktree')?.outcome).toBe('failed');
  });

  it('keeps unknown/unsupported owners explicit instead of claiming reclamation', () => {
    const receipt = buildReclaimReceipt({
      action: 'session-delete',
      scope: SCOPE,
      generatedAt: '2026-10-24T05:00:00.000Z',
      owners: [
        { kind: 'terminal', owner: 'TerminalSessionManager', outcome: 'reclaimed', authority: 'managed', generation: SCOPE.expectedSessionId ?? null, attempted: 2, reclaimed: 2, kept: 0 },
        { kind: 'browser', owner: 'HostAgentBrowserService', outcome: 'unknown', authority: 'unknown', generation: SCOPE.expectedSessionId ?? null, attempted: 1, reclaimed: 0, kept: 0, detail: 'packaged engine closed without receipt' },
      ],
    });
    expect(receipt.recoveryRequired).toBe(true);
    expect(receipt.retryable).toBe(true);
    expect(receipt.activeResidue).toBe(1);
  });
});

describe('E2 50 create/stop/archive-restore cycles', () => {
  it('leaves zero lane residue after 50 cycles and counts keep_on_leave separately', async () => {
    const liveTerminals = new Map<string, { keepOnLeave: boolean }>();
    const liveBrowsers = new Set<string>();
    const livePorts = new Set<string>();
    const liveWorktrees = new Set<string>();
    let activePermits = 0;

    const owners: ReclaimOwnerHandlers = {
      terminals: {
        reclaim: (_params) => {
          let attempted = 0;
          let reclaimed = 0;
          let kept = 0;
          for (const [id, terminal] of Array.from(liveTerminals)) {
            attempted += 1;
            if (terminal.keepOnLeave) {
              kept += 1;
              continue;
            }
            liveTerminals.delete(id);
            reclaimed += 1;
          }
          return { attempted, reclaimed, kept };
        },
        count: () => liveTerminals.size,
      },
      browsers: {
        reclaim: () => {
          let reclaimed = 0;
          for (const id of Array.from(liveBrowsers)) {
            liveBrowsers.delete(id);
            reclaimed += 1;
          }
          return { attempted: reclaimed, reclaimed };
        },
      },
      backgroundPorts: {
        reclaim: async () => {
          let reclaimed = 0;
          for (const id of Array.from(livePorts)) {
            livePorts.delete(id);
            reclaimed += 1;
          }
          return { attempted: reclaimed, reclaimed, failed: 0 };
        },
      },
      worktrees: {
        reclaim: async () => {
          let reclaimed = 0;
          for (const id of Array.from(liveWorktrees)) {
            liveWorktrees.delete(id);
            reclaimed += 1;
          }
          return { attempted: reclaimed, reclaimed, failed: 0, kept: 0 };
        },
      },
      admission: {
        release: () => {
          const released = activePermits;
          activePermits = 0;
          return released;
        },
      },
    };

    const receipts = [];
    let previousKept = 0;
    for (let cycle = 1; cycle <= 50; cycle += 1) {
      liveTerminals.set(`terminal-${cycle}-a`, { keepOnLeave: true });
      liveTerminals.set(`terminal-${cycle}-b`, { keepOnLeave: false });
      liveBrowsers.add(`browser-${cycle}`);
      livePorts.add(`port-${cycle}`);
      liveWorktrees.add(`worktree-${cycle}`);
      activePermits = 1;

      // Archive/restore cycles must not kill kept terminals.
      const archived = await reclaimLongSessionResources({
        action: 'session-archive',
        scope: SCOPE,
        owners,
        generatedAt: `2026-10-24T05:${String(cycle).padStart(2, '0')}:00.000Z`,
      });
      expect(archived.recoveryRequired).toBe(false);

      const deleted = await reclaimLongSessionResources({
        action: 'session-delete',
        scope: SCOPE,
        owners,
        generatedAt: `2026-10-24T05:${String(cycle).padStart(2, '0')}:30.000Z`,
      });
      receipts.push(deleted);

      expect(liveTerminals.size).toBe(previousKept + 1);
      expect(liveBrowsers.size).toBe(0);
      expect(livePorts.size).toBe(0);
      expect(liveWorktrees.size).toBe(0);
      expect(activePermits).toBe(0);
      expect(deleted.keptOnLeave).toBe(previousKept + 1);
      expect(deleted.owners.find((owner) => owner.kind === 'terminal')?.kept).toBe(previousKept + 1);
      previousKept = liveTerminals.size;
      expect(deleted.owners.every((owner) => owner.outcome !== 'failed' && owner.outcome !== 'unknown')).toBe(true);
    }

    expect(receipts).toHaveLength(50);
    expect(receipts.filter((receipt) => receipt.recoveryRequired)).toHaveLength(0);
    // The retained keep_on_leave terminal is the only lane residue and is
    // reported separately, never as an unresolved cleanup.
    expect(liveTerminals.size).toBe(50);
    expect([...liveTerminals.values()].every((terminal) => terminal.keepOnLeave === true)).toBe(true);
  });
});
describe('E2 explicit coordination policy', () => {
  it('reads only explicit session limits and preserves unset values as null', () => {
    expect(resolveLongSessionCoordinationPolicy({})).toEqual({
      maxProcesses: null,
      maxRssMb: null,
      maxBackgroundTerminals: null,
      maxWorktrees: null,
      idleTtlMs: null,
      keepOnLeave: null,
    });
    expect(resolveLongSessionCoordinationPolicy({
      OPENCLAW_LONG_SESSION_MAX_PROCESSES: '4',
      OPENCLAW_LONG_SESSION_MAX_RSS_MB: '512',
      OPENCLAW_LONG_SESSION_MAX_BACKGROUND_TERMINALS: '2',
      OPENCLAW_LONG_SESSION_MAX_WORKTREES: '3',
      OPENCLAW_LONG_SESSION_IDLE_TTL_MS: '60000',
      OPENCLAW_LONG_SESSION_KEEP_ON_LEAVE: 'false',
    })).toEqual({
      maxProcesses: 4,
      maxRssMb: 512,
      maxBackgroundTerminals: 2,
      maxWorktrees: 3,
      idleTtlMs: 60_000,
      keepOnLeave: false,
    });
  });

  it('rejects an exceeded budget and never treats an unavailable measurement as zero', () => {
    const base = resolveLongSessionCoordinationPolicy({
      OPENCLAW_LONG_SESSION_MAX_PROCESSES: '2',
      OPENCLAW_LONG_SESSION_MAX_RSS_MB: '512',
    });
    expect(decideLongSessionCoordination({
      policy: base,
      usage: { processCount: 2, rssKb: 1024, backgroundTerminals: 0, worktreeCount: 0 },
      request: { processes: 1 },
    })).toMatchObject({
      allowed: false,
      reasons: [{ dimension: 'maxProcesses', observed: 2, limit: 2, reason: 'limit-exceeded' }],
    });
    expect(decideLongSessionCoordination({
      policy: base,
      usage: { processCount: 0, rssKb: null, backgroundTerminals: 0, worktreeCount: 0 },
      request: { processes: 1, rssKb: 1 },
    })).toMatchObject({
      allowed: false,
      reasons: [{ dimension: 'maxRssMb', observed: null, limit: 512 * 1024, reason: 'measurement-unknown' }],
    });
  });

  it('fails closed when an action needs an owner but that owner is unavailable', async () => {
    const receipt = await reclaimLongSessionResources({
      action: 'session-delete',
      scope: SCOPE,
      owners: {
        terminals: handlers().terminals,
      },
      generatedAt: '2026-10-24T06:00:00.000Z',
    });
    expect(receipt.recoveryRequired).toBe(true);
    expect(receipt.owners.filter((owner) => owner.outcome === 'unknown').map((owner) => owner.kind)).toEqual([
      'browser',
      'background-port',
      'worktree',
      'admission-permit',
    ]);
    expect(receipt.owners.every((owner) => owner.generation === SCOPE.expectedSessionId)).toBe(true);
  });
});
