/**
 * vb_diagnose_page content budget.
 *
 * The pack is paid for on every agent turn, so its size must be bounded — while
 * the `data` payload keeps the full evidence and a collection failure must never
 * be trimmed away.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIAGNOSE_BUDGET,
  renderDiagnosePack,
  type DiagnosePackInput,
} from '../src/engine/diagnose-pack.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const BIG_SNAPSHOT = `# snapshot\n${'x'.repeat(50_000)}`;
const CONSOLE_LINES = Array.from(
  { length: 20 },
  (_, i) => `[error] TypeError boom ${i} at app.min.js:1:${i}`,
);
const NETWORK_ROWS = Array.from({ length: 20 }, (_, i) => ({
  id: `n-${i}`,
  url: `http://x/api/${i}`,
  method: 'GET',
  status: 404,
  failed: true,
}));

function bigApi(overrides: Record<string, unknown> = {}): AgentBrowserHostApi {
  return {
    takeSnapshot: async () => ({ success: true, snapshot: BIG_SNAPSHOT, session: { id: 's1' } }),
    getConsoleMessages: async () => ({ success: true, content: CONSOLE_LINES.join('\n') }),
    networkListRequests: async () => ({ success: true, requests: NETWORK_ROWS }),
    close: async () => ({ success: true }),
    ...overrides,
  } as unknown as AgentBrowserHostApi;
}

function input(overrides: Partial<DiagnosePackInput> = {}): DiagnosePackInput {
  return {
    collectionOverall: 'ok',
    consoleCollection: 'ok',
    networkCollection: 'ok',
    consoleErrors: CONSOLE_LINES,
    consoleWarnings: [],
    networkFailures: NETWORK_ROWS,
    networkCount: NETWORK_ROWS.length,
    primary: 'src/promo.ts:14',
    explainContent: `primary frame\n${'y'.repeat(9000)}`,
    snapshotText: BIG_SNAPSHOT,
    ...overrides,
  };
}

describe('diagnose pack budget (pure renderer)', () => {
  it('never exceeds maxChars, at any budget', () => {
    for (const maxChars of [600, 1200, 4000, 20_000]) {
      const rendered = renderDiagnosePack(
        input(),
        { ...DEFAULT_DIAGNOSE_BUDGET, maxChars },
      );
      expect(rendered.chars, `maxChars=${maxChars}`).toBeLessThanOrEqual(maxChars);
      expect(rendered.markdown.length).toBe(rendered.chars);
    }
  });

  it('keeps the mandatory head even under a degenerate budget', () => {
    const rendered = renderDiagnosePack(input(), { ...DEFAULT_DIAGNOSE_BUDGET, maxChars: 200 });
    expect(rendered.markdown).toContain('# page diagnosis');
    expect(rendered.markdown).toContain('collection: ok');
    expect(rendered.markdown).toContain('console errors: 20');
    expect(rendered.markdown).toContain('network failures: 20');
  });

  it('always surfaces an incomplete collection warning', () => {
    const rendered = renderDiagnosePack(
      input({ collectionOverall: 'failed', consoleCollection: 'failed' }),
      { ...DEFAULT_DIAGNOSE_BUDGET, maxChars: 800 },
    );
    expect(rendered.markdown).toContain('collection: failed');
    expect(rendered.markdown).toContain('do not treat empty lists');
  });

  it('says how many rows were withheld instead of dropping them silently', () => {
    const rendered = renderDiagnosePack(input(), DEFAULT_DIAGNOSE_BUDGET);
    expect(rendered.truncated.console).toBe(true);
    expect(rendered.markdown).toContain('(+16 more');
    expect(rendered.markdown).toContain('data.consoleDiff.newErrors');
    expect(rendered.markdown).toContain('data.networkFailures.failures');
  });

  it('distinguishes "none" from "not observed"', () => {
    const clean = renderDiagnosePack(
      input({ consoleErrors: [], networkFailures: [], networkCount: 0 }),
      DEFAULT_DIAGNOSE_BUDGET,
    );
    expect(clean.markdown).toContain('- none');

    const blind = renderDiagnosePack(
      input({
        collectionOverall: 'failed',
        consoleCollection: 'failed',
        networkCollection: 'failed',
        consoleErrors: [],
        networkFailures: [],
        networkCount: 0,
      }),
      DEFAULT_DIAGNOSE_BUDGET,
    );
    expect(blind.markdown).toContain('(not observed — collection incomplete)');
  });

  it('keeps the mapped primary line and trims explain/snapshot', () => {
    const rendered = renderDiagnosePack(input(), DEFAULT_DIAGNOSE_BUDGET);
    expect(rendered.markdown).toContain('primary: src/promo.ts:14');
    expect(rendered.truncated.explain).toBe(true);
    expect(rendered.markdown).toContain('data.explain');
    expect(rendered.truncated.snapshot).toBe(true);
    expect(rendered.markdown).toContain('data.snapshot');
  });

  it('omits the snapshot with a pointer when nothing is left', () => {
    const rendered = renderDiagnosePack(
      input({ explainContent: 'z'.repeat(4000) }),
      { ...DEFAULT_DIAGNOSE_BUDGET, maxChars: 900 },
    );
    expect(rendered.chars).toBeLessThanOrEqual(900);
    expect(rendered.markdown).toMatch(/Snapshot\n\(omitted|data\.snapshot/u);
  });
});

describe('diagnosePage content budget (facade)', () => {
  it('bounds the model-facing content but keeps full evidence in data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-diag-budget-'));
    const facade = new AgentBrowserFacade({ api: bigApi(), evidenceRoot: root });
    const result = await facade.diagnosePage({ sessionId: 's1' });
    expect(result.ok).toBe(true);

    const content = result.content;
    expect(content.length).toBeLessThanOrEqual(DEFAULT_DIAGNOSE_BUDGET.maxChars);
    expect(content).toContain('# page diagnosis');
    expect(content).toContain('collection: ok');
    expect(content).toContain('console errors: 20');

    const data = result.data as {
      snapshot: string;
      consoleDiff: { newErrors: string[] };
      networkFailures: { failures: unknown[] };
      contextChars: number;
      truncated: { snapshot: boolean; console: boolean };
      budget: { maxChars: number };
    };
    // Evidence is NOT trimmed — only the summary is.
    expect(data.snapshot.length).toBe(BIG_SNAPSHOT.length);
    expect(data.consoleDiff.newErrors.length).toBe(CONSOLE_LINES.length);
    expect(data.networkFailures.failures.length).toBe(NETWORK_ROWS.length);
    expect(data.contextChars).toBe(content.length);
    expect(data.truncated.snapshot).toBe(true);
    expect(data.truncated.console).toBe(true);
    expect(data.budget.maxChars).toBe(DEFAULT_DIAGNOSE_BUDGET.maxChars);

    await facade.close('s1').catch(() => undefined);
  });

  it('honours a custom budget and still never hides a failed collection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-diag-budget-'));
    const facade = new AgentBrowserFacade({
      api: bigApi({
        getConsoleMessages: async () => {
          throw new Error('console down');
        },
      }),
      evidenceRoot: root,
    });
    const result = await facade.diagnosePage({
      sessionId: 's1',
      budget: { ...DEFAULT_DIAGNOSE_BUDGET, maxChars: 900 },
    });
    expect(result.content.length).toBeLessThanOrEqual(900);
    expect(result.content).toContain('collection: failed');
    expect(result.content).toContain('do not treat empty lists');
    await facade.close('s1').catch(() => undefined);
  });
});
