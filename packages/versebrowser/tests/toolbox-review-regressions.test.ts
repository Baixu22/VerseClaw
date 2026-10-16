import { expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { PageTextExtractor } from '../src/engine/browser-control/page-text-extractor.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

it('does not start a wait probe after the original deadline', async () => {
  vi.useFakeTimers();
  try {
    const evaluate = vi.fn().mockRejectedValueOnce(new Error('Execution context was destroyed')).mockResolvedValue({ success: true, value: true });
    const facade = new AgentBrowserFacade({ api: { evaluate } as unknown as AgentBrowserHostApi });
    const waiting = facade.wait({ sessionId: 's', text: 'ready', timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await waiting).ok).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('does not start a text extraction retry after its deadline', async () => {
  vi.useFakeTimers();
  try {
    const evaluate = vi.fn<() => Promise<unknown>>(async () => { vi.setSystemTime(Date.now() + 1000); throw new Error('Execution context was destroyed'); });
    const extractor = new PageTextExtractor({ evaluate });
    const error = await extractor.extract({ url: 'https://example.test', rules: [] }).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(evaluate).toHaveBeenCalledTimes(1);
    // The sleep itself can also consume the remaining budget.
    evaluate.mockReset().mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 990); throw new Error('Execution context was destroyed'); })
      .mockResolvedValue({ result: { value: '{"text":"late","truncated":false,"usedFallback":false}' } });
    const pending = extractor.extract({ url: 'https://example.test', rules: [] }).catch(e => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeInstanceOf(Error);
    expect(evaluate).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('serializes a loaded SVG document without requiring an HTML body', async () => {
  const api = await createPlaywrightHostApi();
  const opened = await api.open({ mode: 'headless', url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>Ready</text></svg>') });
  try {
    const facade = new AgentBrowserFacade({ api });
    const result = await facade.extractPageText({ sessionId: opened.session.id, selector: 'svg', extractMode: 'all' });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('<svg');
  } finally { await api.close({ sessionId: opened.session.id }); }
});

it('does not promote a warning containing Error into a recorded error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-review-warning-'));
  const facade = new AgentBrowserFacade({ evidenceRoot: root, api: {
    getConsoleMessages: async () => ({ success: true, content: '[warning] Error with Feature-Policy header' }),
    networkListRequests: async () => ({ success: true, requests: [] }),
    close: async () => ({ success: true }),
  } as unknown as AgentBrowserHostApi });
  await facade.recordStart('s');
  try {
    const result = await facade.verifyFlow({ sessionId: 's', screenshot: false });
    expect(result.data).toMatchObject({ outcome: 'pass', diagnosis: { ok: true } });
  } finally { await facade.close('s'); }
});
