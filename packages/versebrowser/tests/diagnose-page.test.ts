/**
 * vb_diagnose_page — one-shot pack must include collection status + explain + snapshot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

function mockApi(overrides: Record<string, unknown> = {}): AgentBrowserHostApi {
  return {
    takeSnapshot: async () => ({
      success: true,
      snapshot: '# snapshot\n- [e1] button | "Buy" | sel=[data-vb-ref="e1"]',
      session: { id: 's1' },
    }),
    getConsoleMessages: async () => ({
      success: true,
      content: '[error] TypeError: Cannot read properties of undefined (reading percent)\n    at renderPromo (http://x/assets/promo.min.js:1:52)',
    }),
    networkListRequests: async () => ({ success: true, requests: [] }),
    waitForSelector: async () => ({ success: true }),
    close: async () => ({ success: true }),
    ...overrides,
  } as unknown as AgentBrowserHostApi;
}

describe('diagnosePage', () => {
  let facade: AgentBrowserFacade | undefined;

  afterEach(async () => {
    if (facade) await facade.close('s1').catch(() => undefined);
    facade = undefined;
  });

  it('packs console error, explain attempt, snapshot, and collection status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-diag-'));
    facade = new AgentBrowserFacade({ api: mockApi(), evidenceRoot: root });
    const result = await facade.diagnosePage({ sessionId: 's1' });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('# page diagnosis');
    expect(result.content).toContain('collection: ok');
    expect(result.content).toContain('console errors: 1');
    expect(result.content).toContain('data-vb-ref');
    const data = result.data as {
      collection: { overall: string };
      consoleDiff: { newErrors: string[] };
      snapshot: string;
    };
    expect(data.collection.overall).toBe('ok');
    expect(data.consoleDiff.newErrors.length).toBe(1);
    expect(data.snapshot).toContain('[e1]');
  });

  it('marks collection failed when console capture throws (never silent clean)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-diag-'));
    facade = new AgentBrowserFacade({
      api: mockApi({
        getConsoleMessages: async () => {
          throw new Error('console down');
        },
      }),
      evidenceRoot: root,
    });
    const result = await facade.diagnosePage({ sessionId: 's1' });
    expect(result.content).toContain('collection: failed');
    expect(result.content).toContain('do not treat empty lists');
  });
});
