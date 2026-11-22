import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../e2e/fixtures/fp-p1-harness', () => ({ hostInvoke: invoke }));
import { addSessionChainChildren } from '../e2e/fixtures/session-task-chain';

const app = {} as ElectronApplication;
const project = { workspaceId: 'project', sessionKey: 'agent:main:parent' };

describe('session-chain fixture preparation', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('bounds creation batches and saves every draft serially in child order', async () => {
    let activeCreates = 0, maxCreates = 0, activeSaves = 0, maxSaves = 0;
    const saved: Array<{ key: string; draft: string }> = [];
    invoke.mockImplementation(async (_app, module, _action, payload) => {
      if (module === 'gateway') {
        activeCreates += 1; maxCreates = Math.max(maxCreates, activeCreates);
        const ordinal = Number(payload.params.label.match(/^Child (\d+)/)[1]);
        await new Promise(resolve => setTimeout(resolve, 8 - ordinal));
        activeCreates -= 1;
        return { key: `child-${ordinal}` };
      }
      activeSaves += 1; maxSaves = Math.max(maxSaves, activeSaves);
      await new Promise(resolve => setTimeout(resolve, 1));
      saved.push({ key: payload.sessionKey, draft: payload.state.draftInput });
      activeSaves -= 1;
      return { success: true };
    });

    expect(await addSessionChainChildren(app, project, 0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => `child-${i + 1}`));
    expect(maxCreates).toBe(4);
    expect(maxSaves).toBe(1);
    expect(saved).toEqual(Array.from({ length: 7 }, (_, i) => ({ key: `child-${i + 1}`, draft: `Child ${i + 1} draft` })));
  });

  it('settles the entire creation batch and retains confirmed drafts before reporting a failure', async () => {
    const releases: Array<() => void> = [];
    const saved: string[] = [];
    invoke.mockImplementation(async (_app, module, _action, payload) => {
      if (module !== 'gateway') { saved.push(payload.sessionKey); return { success: true }; }
      const ordinal = Number(payload.params.label.match(/^Child (\d+)/)[1]);
      if (ordinal === 1) throw new Error('create failed');
      await new Promise<void>(resolve => releases.push(resolve));
      return { key: `child-${ordinal}` };
    });
    let settled = false;
    const result = addSessionChainChildren(app, project, 0, 8);
    void result.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(settled).toBe(false);
    releases.forEach(release => release());
    await expect(result).rejects.toThrow('create failed');
    expect(saved).toEqual(['child-2', 'child-3', 'child-4']);
    expect(invoke.mock.calls.filter(call => call[1] === 'gateway')).toHaveLength(4);
  });
});
