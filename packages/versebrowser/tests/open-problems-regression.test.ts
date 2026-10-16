import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { renderToolResultForTool } from '../src/mcp/result-envelope.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

it('keeps page-text truncation visible after data omission and content clipping', async () => {
  const facade = new AgentBrowserFacade({ api: {
    extractPageText: async () => ({ success: true, text: 'x'.repeat(20_000), truncated: true, usedFallback: true }),
  } as unknown as AgentBrowserHostApi });
  const result = await facade.extractPageText({ sessionId: 's' });
  const rendered = JSON.parse(renderToolResultForTool('vb_page_text', result));
  expect(rendered.data).toBeUndefined();
  expect(rendered.content).toContain('truncated=true');
  expect(rendered.content).toContain('usedFallback=true');
  expect(rendered.content).toContain('content truncated');
});

it('keeps network_wait request ids usable when the payload exceeds the envelope budget', async () => {
  const requests = Array.from({ length: 100 }, (_, i) => ({
    id: `n-${i}`, method: 'GET', url: `https://example.test/${'x'.repeat(200)}/${i}`, status: 200,
  }));
  const facade = new AgentBrowserFacade({ api: {
    networkWaitForRequests: async () => ({ success: true, requests }),
  } as unknown as AgentBrowserHostApi });
  const text = renderToolResultForTool('vb_network_wait', await facade.networkWait('s'));
  const rendered = JSON.parse(text);
  expect(rendered.data?.requests[0]?.id).toBe('n-0');
  expect(rendered.dataTruncated.dropped.requests.entriesTotal).toBe(100);
  expect(text.length).toBeLessThanOrEqual(12_000);
  expect(requests).toHaveLength(100);
});

it('keeps grant expiry and authorization state visible with a long upgrade reason', async () => {
  const facade = new AgentBrowserFacade({ api: {} as AgentBrowserHostApi });
  const upgraded = await facade.requestModeUpgrade({
    sessionId: 's', target: 'controlled_enhanced', confirmed: true, reason: 'r'.repeat(20_000),
  });
  for (const [name, result] of [
    ['vb_request_mode_upgrade', upgraded], ['vb_mode_status', await facade.modeStatus('s')],
  ] as const) {
    const rendered = JSON.parse(renderToolResultForTool(name, result));
    expect(rendered.data).toBeUndefined();
    expect(rendered.content).toContain(`expiresAt=${(result.data as { expiresAt: number }).expiresAt}`);
    expect(rendered.content).toContain('authMode=controlled_enhanced');
    expect(rendered.content).toContain('hasBoundaryGrant=false');
  }
});

it('puts compare outcomes ahead of long URLs', async () => {
  const facade = new AgentBrowserFacade({ api: {
    networkListRequests: async () => ({ success: true, requests: [
      { id: 'a', method: 'GET', url: `https://example.test/${'x'.repeat(15_000)}`, status: 200 },
      { id: 'b', method: 'POST', url: 'https://example.test/b', status: 500, failed: true },
    ] }),
  } as unknown as AgentBrowserHostApi });
  const result = await facade.networkCompare('s', ['a', 'b']);
  const rendered = JSON.parse(renderToolResultForTool('vb_network_compare', result));
  expect(rendered.data).toBeUndefined();
  expect(rendered.content).toContain('outcomeChanged: true');
  expect(rendered.content).toContain('sameUrl: false');
  expect(rendered.content).toContain('sameMethod: false');
  expect(rendered.content).toContain('statusDelta: 300');
});

it('keeps primary mapping status ahead of a long error message', async () => {
  const facade = new AgentBrowserFacade({ api: {} as AgentBrowserHostApi });
  const result = await facade.explain(`Error: ${'x'.repeat(20_000)}\n    at run (https://example.test/app.js:1:1)`);
  const rendered = JSON.parse(renderToolResultForTool('vb_explain_error', result));
  expect(rendered.data).toBeUndefined();
  expect(rendered.content).toContain('**Primary mapping:** unmapped');
  expect(rendered.content).toContain('https://example.test/app.js:1:1');
});

it('record_stop uses recorder state and can save an existing recording after the browser disappears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-record-stop-'));
  let probes = 0;
  const facade = new AgentBrowserFacade({ evidenceRoot: root, api: {
    getConsoleMessages: async () => {
      if (++probes > 1) throw Object.assign(new Error('gone'), { code: 'E_NO_SESSION' });
      return { success: true, content: '' };
    },
  } as unknown as AgentBrowserHostApi });
  try {
    expect((await facade.recordStop('missing')).error?.code).toBe('E_RECORD');
    expect((await facade.recordStart('s')).ok).toBe(true);
    const stopped = await facade.recordStop('s');
    expect(stopped.ok).toBe(true);
    expect((stopped.data as { events: number }).events).toBe(2);
    expect(stopped.evidence?.[0]?.path).toContain('timeline.json');
    expect((await facade.recordStop('s')).error?.code).toBe('E_RECORD');
    expect(probes).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('diagnosis declares evicted watermarks even when a large snapshot causes data omission', async () => {
  let evicted = false;
  const facade = new AgentBrowserFacade({ api: {
    getConsoleMessages: async () => ({ success: true, content: evicted ? '[log] new' : '[log] anchor' }),
    networkListRequests: async () => ({ success: true, requests: [
      { id: evicted ? 'new' : 'anchor', url: 'https://example.test/', method: 'GET', status: 200 },
    ] }),
    takeSnapshot: async () => ({ success: true, snapshot: 'x'.repeat(20_000) }),
  } as unknown as AgentBrowserHostApi });
  await facade.markConsoleBaseline('s');
  await facade.markNetworkBaseline('s');
  evicted = true;
  const rendered = JSON.parse(renderToolResultForTool('vb_diagnose_page', await facade.diagnosePage({ sessionId: 's' })));
  expect(rendered.data).toBeUndefined();
  expect(rendered.content).toContain('console watermark missing; judging all retained lines');
  expect(rendered.content).toContain('network baseline missing; judging all retained requests');
});

it('pr_comment reads the fixed pack layout, ignoring outside paths in manifest.files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-manifest-'));
  const packDir = join(root, 'evidence', 'pack');
  const outside = join(root, 'outside.md');
  try {
    await mkdir(packDir, { recursive: true });
    await writeFile(outside, 'OUTSIDE-CONTENT');
    await writeFile(join(packDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, packId: 'pack', label: 'fixed-layout', files: [
        { path: '../../outside.md', kind: 'summary' }, { path: outside, kind: 'summary' },
      ],
    }));
    await writeFile(join(packDir, 'summary.md'), 'INSIDE-CONTENT');
    const facade = new AgentBrowserFacade({ evidenceRoot: join(root, 'evidence'), api: {} as AgentBrowserHostApi });
    const result = await facade.exportPrComment(packDir);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('INSIDE-CONTENT');
    expect(result.content).not.toContain('OUTSIDE-CONTENT');
    expect(await readFile(join(packDir, 'pr-comment.md'), 'utf8')).not.toContain('OUTSIDE-CONTENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
