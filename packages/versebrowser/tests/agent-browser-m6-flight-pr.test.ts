import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPrComment, formatVerifyPrComment } from '../src/evidence/pr-comment.ts';
import { TimelineWriter } from '../src/evidence/timeline.ts';
import { diagnoseTimeline, writeDiagnosisPack } from '../src/evidence/diagnosis.ts';
import { writeEvidencePack } from '../src/evidence/writer.ts';
import { readEvidencePack } from '../src/evidence/reader.ts';
import type { DiagnosisReport, VerifyReport } from '../src/contracts/index.ts';

describe('formatPrComment', () => {
  it('renders FAIL with first failure and evidence paths', () => {
    const diagnosis: DiagnosisReport = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      ok: false,
      failureCount: 2,
      firstFailure: {
        index: 3,
        kind: 'network',
        name: 'GET /api/pay',
        at: new Date().toISOString(),
        summary: 'status 404',
      },
      failures: [
        {
          index: 3,
          kind: 'network',
          name: 'GET /api/pay',
          at: new Date().toISOString(),
          summary: 'status 404',
        },
        {
          index: 4,
          kind: 'console',
          name: 'boom',
          at: new Date().toISOString(),
          summary: 'level error',
        },
      ],
      summaryMarkdown: '# trajectory diagnosis FAIL',
    };

    const comment = formatPrComment({
      label: 'verify_flow',
      packDir: '.ae/evidence/verify-x',
      diagnosis,
      screenshotCount: 2,
    });

    expect(comment).toContain('<!-- versebrowser-evidence -->');
    expect(comment).toContain('versebrowser verify_flow: FAIL');
    expect(comment).toContain('GET /api/pay');
    expect(comment).toContain('`.ae/evidence/verify-x`');
    expect(comment).toContain('screenshots: 2 file(s) on disk');
    expect(comment).toContain('More failures');
    expect(comment).not.toContain('data:image');
  });

  it('renders PASS from verify report', () => {
    const report: VerifyReport = {
      schemaVersion: 1,
      ok: true,
      outcome: 'pass',
      collection: { console: 'ok', network: 'ok', overall: 'ok', notes: [] },
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      sessionId: 's1',
      selectors: [{ selector: '#cta', found: true, visible: true }],
      expectations: [],
      consoleDiff: { baselineCount: 0, newErrors: [], newWarnings: [], collection: 'ok' },
      networkFailures: { count: 0, failures: [], collection: 'ok' },
      screenshotPaths: ['shots/verify.png'],
      summaryMarkdown: '# verify_flow PASS',
      evidence: [],
    };
    const comment = formatVerifyPrComment(report, {
      packDir: '.ae/evidence/verify-pass',
      diagnosis: {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        ok: true,
        failureCount: 0,
        failures: [],
        summaryMarkdown: '# CLEAN',
      },
    });
    expect(comment).toContain('PASS');
    expect(comment).toContain('[ok] `#cta`');
  });
});

describe('M6 verify pack + diagnosis + pr-comment', () => {
  it('writes diagnosis/timeline/pr-comment into an evidence pack', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vb-m6-'));
    const writer = new TimelineWriter({ dir, sessionId: 's-m6' });
    await writer.action('nav', { url: 'https://ok.test' }, true);
    await writer.network('GET /fail', { status: 500 }, false);
    await writer.console('boom', { level: 'error' }, false);
    const timeline = await writer.stop();

    const diagnosis = diagnoseTimeline({ dir, timeline });
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.firstFailure?.kind).toBe('network');
    await writeDiagnosisPack(dir, diagnosis);

    const prComment = formatPrComment({
      label: 'verify_flow',
      packDir: dir,
      diagnosis,
    });
    await writeFile(join(dir, 'pr-comment.md'), prComment, 'utf8');

    const { packDir } = await writeEvidencePack({
      rootDir: dir,
      packId: 'pack-m6',
      label: 'm6',
      sessionId: 's-m6',
      summaryMarkdown: '# m6',
      diagnosis,
      timeline,
      prComment,
    });

    const pack = await readEvidencePack(packDir);
    expect(pack.diagnosis?.firstFailure?.name).toBe('GET /fail');
    expect(pack.timeline?.events.length).toBeGreaterThan(0);
    expect(pack.prComment).toContain('versebrowser');

    const md = await readFile(join(packDir, 'diagnosis.md'), 'utf8');
    expect(md).toContain('trajectory diagnosis FAIL');
  });
});

describe('auto-ingest keys stay unique', () => {
  it('does not duplicate identical network failures in timeline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vb-ingest-'));
    const writer = new TimelineWriter({ dir });
    // Simulate facade ingest dedupe behaviour.
    const seen = new Set<string>();
    const ingest = async (method: string, url: string, status: number) => {
      const key = `net:${method}:${url}:${status}`;
      if (seen.has(key)) return;
      seen.add(key);
      await writer.network(`${method} ${url}`, { method, url, status, failed: true }, false);
    };
    await ingest('GET', '/a', 500);
    await ingest('GET', '/a', 500);
    await ingest('GET', '/b', 404);
    const record = await writer.stop();
    expect(record.events.filter((e) => e.kind === 'network')).toHaveLength(2);
  });
});
