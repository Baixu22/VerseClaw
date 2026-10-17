import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TimelineWriter, readTimeline } from '../src/evidence/timeline.ts';
import { diagnoseTimeline, writeDiagnosisPack } from '../src/evidence/diagnosis.ts';
import type { TimelineRecord } from '../src/contracts/index.ts';

describe('m3-timeline TimelineWriter', () => {
  it('appends events and persists timeline.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vb-timeline-'));
    const writer = new TimelineWriter({ dir, sessionId: 's1' });
    await writer.action('nav', { url: 'https://example.test' }, true);
    await writer.network('GET /api', { status: 500 }, false);
    await writer.console('error', { level: 'error' }, false);
    await writer.snapshot('snap');
    await writer.mode('upgrade', { from: 'normal', to: 'controlled' });
    const record = await writer.stop();

    expect(record.events).toHaveLength(5);
    expect(record.sessionId).toBe('s1');
    expect(record.events[0]!.kind).toBe('action');
    expect(record.events[1]!.ok).toBe(false);
    expect(record.endedAt).toBeTruthy();

    const disk = JSON.parse(await readFile(join(dir, 'timeline.json'), 'utf8')) as TimelineRecord;
    expect(disk.events).toHaveLength(5);
    expect(disk.schemaVersion).toBe(1);

    const reread = await readTimeline(dir);
    expect(reread?.events.map((e) => e.name)).toEqual([
      'nav',
      'GET /api',
      'error',
      'snap',
      'upgrade',
    ]);
  });

  it('seq is monotonic and append is durable mid-recording', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vb-timeline-'));
    const writer = new TimelineWriter({ dir });
    await writer.action('a');
    const mid = await readTimeline(dir);
    expect(mid?.events).toHaveLength(1);
    await writer.action('b');
    expect(writer.toRecord().events.map((e) => e.seq)).toEqual([1, 2]);
    await writer.stop();
  });
});

describe('m3-diagnosis diagnoseTimeline', () => {
  it('locates first failure with context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vb-diag-'));
    const writer = new TimelineWriter({ dir, sessionId: 's1' });
    await writer.action('nav', { url: 'https://ok.test' }, true);
    await writer.action('click', { selector: '#go' }, true);
    await writer.network('GET /fail', { status: 503 }, false);
    await writer.console('boom', { level: 'error' }, false);
    const timeline = await writer.stop();

    const report = diagnoseTimeline({ dir, timeline });
    expect(report.ok).toBe(false);
    expect(report.failureCount).toBe(2);
    expect(report.firstFailure?.kind).toBe('network');
    expect(report.firstFailure?.name).toBe('GET /fail');
    expect(report.firstFailure?.context?.length).toBeGreaterThan(0);
    expect(report.summaryMarkdown).toContain('First failure');

    await writeDiagnosisPack(dir, report);
    const md = await readFile(join(dir, 'diagnosis.md'), 'utf8');
    expect(md).toContain('trajectory diagnosis FAIL');
  });

  it('reports CLEAN when timeline has no failures', async () => {
    const timeline: TimelineRecord = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      events: [
        { seq: 1, at: new Date().toISOString(), kind: 'action', name: 'nav', ok: true },
      ],
    };
    const report = diagnoseTimeline({ dir: 'unused', timeline });
    expect(report.ok).toBe(true);
    expect(report.failureCount).toBe(0);
    expect(report.summaryMarkdown).toContain('CLEAN');
  });

  it('includes assertion failures after timeline events', async () => {
    const timeline: TimelineRecord = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      events: [
        { seq: 1, at: new Date().toISOString(), kind: 'action', name: 'nav', ok: true },
      ],
    };
    const report = diagnoseTimeline({
      dir: 'unused',
      timeline,
      assertionFailures: [{ name: 'selector #missing', summary: 'not found' }],
    });
    expect(report.failureCount).toBe(1);
    expect(report.firstFailure?.kind).toBe('assertion');
  });
});
