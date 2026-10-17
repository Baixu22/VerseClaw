import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderTrajectoryViewer,
  writeTrajectoryViewer,
} from '../src/evidence/viewer.ts';
import { writeEvidencePack } from '../src/evidence/writer.ts';
import { readEvidencePack } from '../src/evidence/reader.ts';
import type { DiagnosisReport, TimelineRecord } from '../src/contracts/index.ts';
import type { EvidencePackContents } from '../src/evidence/schema.ts';

const timeline: TimelineRecord = {
  schemaVersion: 1,
  startedAt: '2026-09-24T10:00:00.000Z',
  endedAt: '2026-09-24T10:00:05.000Z',
  sessionId: 's-view',
  events: [
    {
      seq: 1,
      at: '2026-09-24T10:00:01.000Z',
      kind: 'action',
      name: 'goto',
      detail: { url: 'https://example.test' },
      ok: true,
    },
    {
      seq: 2,
      at: '2026-09-24T10:00:02.000Z',
      kind: 'network',
      name: 'network-failure',
      detail: { method: 'GET', url: '/api/pay', status: 404 },
      ok: false,
    },
    {
      seq: 3,
      at: '2026-09-24T10:00:03.000Z',
      kind: 'console',
      name: '<script>alert(1)</script>',
      detail: { level: 'error', text: 'boom' },
      ok: false,
    },
  ],
};

const diagnosis: DiagnosisReport = {
  schemaVersion: 1,
  createdAt: '2026-09-24T10:00:06.000Z',
  sessionId: 's-view',
  ok: false,
  failureCount: 2,
  firstFailure: {
    index: 2,
    kind: 'network',
    name: 'network-failure',
    at: '2026-09-24T10:00:02.000Z',
    summary: 'status 404',
  },
  failures: [
    {
      index: 2,
      kind: 'network',
      name: 'network-failure',
      at: '2026-09-24T10:00:02.000Z',
      summary: 'status 404',
    },
    {
      index: 3,
      kind: 'console',
      name: 'boom',
      at: '2026-09-24T10:00:03.000Z',
      summary: 'level error',
    },
  ],
  summaryMarkdown: '# trajectory diagnosis FAIL',
};

function basePack(overrides: Partial<EvidencePackContents> = {}): EvidencePackContents {
  return {
    manifest: {
      schemaVersion: 1,
      createdAt: '2026-09-24T10:00:00.000Z',
      packId: 'test-pack',
      label: 'unit viewer pack',
      sessionId: 's-view',
      files: [{ path: 'timeline.json', kind: 'timeline', mimeType: 'application/json' }],
    },
    screenshots: [],
    timeline,
    diagnosis,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('neutralizes markup and quotes', () => {
    expect(escapeHtml('<script>"x"&\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;',
    );
  });
});

describe('renderTrajectoryViewer', () => {
  it('renders first-failure callout, timeline chips, and escaped names', () => {
    const html = renderTrajectoryViewer({
      pack: basePack(),
      packDir: '/tmp/pack',
    });

    expect(html).toContain('<title>trajectory viewer — test-pack</title>');
    expect(html).toContain('badge-fail');
    expect(html).toContain('First failure');
    expect(html).toContain('first failure');
    expect(html).toContain('data-seq="2"');
    expect(html).toContain('kind-network');
    expect(html).toContain('failures only');
    // XSS: event name must be escaped, not raw script tag
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    // no external assets (data URLs for pack content may still appear in JSON details)
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toContain('cdn.');
    expect(html).not.toContain('data:image');
  });

  it('shows CLEAN empty first-failure block when diagnosis is ok', () => {
    const clean: DiagnosisReport = {
      ...diagnosis,
      ok: true,
      failureCount: 0,
      firstFailure: undefined,
      failures: [],
      summaryMarkdown: '# CLEAN',
    };
    const html = renderTrajectoryViewer({
      pack: basePack({ diagnosis: clean }),
    });
    expect(html).toContain('badge-pass');
    expect(html).toContain('No failure points');
  });

  it('handles packs without timeline or diagnosis', () => {
    const html = renderTrajectoryViewer({
      pack: basePack({ timeline: undefined, diagnosis: undefined }),
    });
    expect(html).toContain('No timeline.json events');
    expect(html).toContain('badge-neutral');
    expect(html).toContain('No screenshots');
  });

  it('uses relative screenshot paths when packDir is known', () => {
    const packDir = join(tmpdir(), 'vb-viewer-pack');
    const html = renderTrajectoryViewer({
      pack: basePack({
        screenshots: [join(packDir, 'shots', 'a.png')],
      }),
      packDir,
    });
    expect(html).toContain('src="shots/a.png"');
  });
});

describe('writeTrajectoryViewer', () => {
  it('writes viewer.html and registers it in manifest.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-viewer-'));
    const written = await writeEvidencePack({
      rootDir: root,
      packId: 'view-pack',
      label: 'viewer integration',
      sessionId: 's-view',
      summaryMarkdown: '# FAIL',
      timeline,
      diagnosis,
    });

    const { outPath, html } = await writeTrajectoryViewer(written.packDir);
    expect(outPath.endsWith('viewer.html')).toBe(true);
    expect(html).toContain('First failure');

    const onDisk = await readFile(outPath, 'utf8');
    expect(onDisk).toBe(html);

    const pack = await readEvidencePack(written.packDir);
    expect(pack.manifest.files.some((file) => file.path === 'viewer.html')).toBe(true);
  });

  it('synthesizes a minimal pack when only timeline.json exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vb-viewer-tl-'));
    await writeFile(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2), 'utf8');
    const { outPath, html } = await writeTrajectoryViewer(dir);
    expect(outPath.endsWith('viewer.html')).toBe(true);
    expect(html).toContain('s-view');
    expect(html).toContain('network-failure');
    expect(html).not.toContain('No timeline.json events');
  });

  it('does not pollute pack manifest when outFile is outside the pack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-viewer-ext-'));
    const written = await writeEvidencePack({
      rootDir: root,
      packId: 'ext-pack',
      label: 'external out',
      summaryMarkdown: '# x',
      timeline,
    });
    const outside = join(root, 'outside-viewer.html');
    await writeTrajectoryViewer(written.packDir, { outFile: outside });
    const pack = await readEvidencePack(written.packDir);
    expect(pack.manifest.files.some((file) => file.path.includes('outside-viewer'))).toBe(false);
    expect(pack.manifest.files.some((file) => file.path === 'viewer.html')).toBe(false);
  });
});
