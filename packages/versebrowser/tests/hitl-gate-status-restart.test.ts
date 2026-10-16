/**
 * A human gate outlives the process that opened it (TF-0167).
 *
 * `assertResumedPersisted` already refuses actions after a restart by reading the persisted
 * checkpoint, and `resumeAfterHuman` reads it back too (see the sibling "keeps the gate closed
 * across a restart" test). The status tool must agree with them: `humanGateStatus` read the
 * in-memory map only, so a restarted host reported `paused:false` for a session whose actions were
 * still being refused with `E_HITL_PAUSED` - the exact "restart silently drops the gate" the guard
 * exists to prevent, just on the reporting surface.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade';
import { getWorkspaceSessionsRoot } from '../src/host/workspace-paths';
import { HitlSessionStore } from '../src/engine/hitl-checkpoint';
import type { AgentBrowserHostApi } from '../src/types/host-api';

const stub = (): AgentBrowserHostApi =>
  ({
    click: async () => ({ success: true }),
    navigate: async () => ({ success: true }),
    getConsoleMessages: async () => ({ success: true, messages: [] }),
  }) as unknown as AgentBrowserHostApi;

describe('HITL gate status across a restart (TF-0167)', () => {
  it('reports the persisted gate instead of paused:false when the in-memory map is empty', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-status-restart-'));
    const facadeA = new AgentBrowserFacade({ api: stub(), workspaceRoot: workspace });
    await facadeA.pauseForHuman({ sessionId: 'r-1', reason: 'login_wall', message: 'human must sign in' });

    // A restart means a new facade whose in-memory map has never seen the session. The persisted
    // gate must be visible to the status tool, matching the action guard and the resume path.
    const facadeB = new AgentBrowserFacade({ api: stub(), workspaceRoot: workspace });
    const status = await facadeB.humanGateStatus('r-1');
    expect(status.ok).toBe(true);
    expect(status.data, 'the restart must not report the gate as absent').toMatchObject({
      paused: true,
      reason: 'login_wall',
    });

    // And it agrees with the two paths that already read the checkpoint off disk.
    expect((await facadeB.click('r-1', '#save')).error?.code).toBe('E_HITL_PAUSED');
    const token = (await new HitlSessionStore(getWorkspaceSessionsRoot(workspace)).readOperatorResumeToken('r-1'))!;
    expect(token, 'the operator channel still holds the one-time token').toBeTruthy();
    expect((await facadeB.resumeAfterHuman('r-1', token)).ok).toBe(true);
  });

  it('still reports no gate for a session that never paused', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vb-hitl-status-none-'));
    const facade = new AgentBrowserFacade({ api: stub(), workspaceRoot: workspace });
    const status = await facade.humanGateStatus('never-paused');
    expect(status.ok).toBe(true);
    expect(status.data).toMatchObject({ paused: false });
  });
});