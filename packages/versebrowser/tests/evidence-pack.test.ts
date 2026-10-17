import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatEvidencePackSummary,
  readEvidencePack,
  writeEvidencePack,
} from '../src/evidence/index';

describe('evidence pack writer/reader', () => {
  it('round-trips manifest, summary, explain, and screenshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-ev-'));
    // 1x1 PNG
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const written = await writeEvidencePack({
      rootDir: root,
      packId: 'test-pack',
      label: 'unit pack',
      sessionId: 's-1',
      summaryMarkdown: '# PASS',
      consoleDiff: { baselineCount: 0, newErrors: ['boom'], newWarnings: [], collection: 'ok' },
      networkFailures: { count: 0, failures: [], collection: 'ok' },
      explain: {
        message: 'TypeError',
        frames: [],
        content: 'explain',
      },
      verify: {
        schemaVersion: 1,
        ok: true,
        outcome: 'pass',
        collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [] },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        sessionId: 's-1',
        selectors: [],
        expectations: [],
        consoleDiff: { baselineCount: 0, newErrors: ['boom'], newWarnings: [], collection: 'ok' },
        networkFailures: { count: 0, failures: [], collection: 'ok' },
        screenshotPaths: [],
        summaryMarkdown: '# PASS',
        evidence: [],
      },
      screenshots: [{ dataUrl: png, name: 'home.png' }],
    });

    expect(written.manifest.schemaVersion).toBe(1);
    expect(written.manifest.files.some((file) => file.path === 'summary.md')).toBe(true);
    expect(written.evidence.some((item) => item.kind === 'screenshot')).toBe(true);

    const pack = await readEvidencePack(written.packDir);
    expect(pack.manifest.packId).toBe('test-pack');
    expect(pack.summaryMarkdown).toBe('# PASS');
    expect(pack.consoleDiff?.newErrors).toEqual(['boom']);
    expect(pack.explain?.message).toBe('TypeError');
    expect(pack.screenshots.length).toBe(1);

    const shot = await readFile(pack.screenshots[0]);
    expect(shot.byteLength).toBeGreaterThan(0);

    const summary = formatEvidencePackSummary(pack);
    expect(summary).toContain('test-pack');
    expect(summary).toContain('PASS');
    expect(summary).toContain('network failures: 0');
  });

  it('rejects unknown schemaVersion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-ev-'));
    const written = await writeEvidencePack({
      rootDir: root,
      packId: 'bad-ver',
      label: 'x',
      summaryMarkdown: 'x',
    });
    const manifestPath = join(written.packDir, 'manifest.json');
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as { schemaVersion: number };
    raw.schemaVersion = 99;
    await (await import('node:fs/promises')).writeFile(manifestPath, JSON.stringify(raw));
    await expect(readEvidencePack(written.packDir)).rejects.toThrow(/schemaVersion/u);
  });
});
