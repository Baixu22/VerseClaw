// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathsMock = vi.hoisted(() => ({
  configDir: '',
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => pathsMock.configDir,
}));

describe('cron browser automation run results', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cron-browser-run-result-'));
    pathsMock.configDir = root;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns structured browser automation run results from cron session history', async () => {
    const { createCronApi } = await import('@electron/services/cron-api');
    await mkdir(join(root, 'cron', 'runs'), { recursive: true });
    await writeFile(join(root, 'cron', 'runs', 'browser-job.jsonl'), `${JSON.stringify({
      jobId: 'browser-job',
      action: 'finished',
      status: 'ok',
      summary: 'Browser task finished.',
      ts: 1_800_000_000_000,
      browserAutomationResult: {
        schemaVersion: 1,
        runId: 'run-1',
        status: 'success',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
        profile: 'work',
        finalUrl: 'https://example.com/check-in',
        title: 'Check-in',
        loginState: 'authenticated',
        steps: [{ id: 'open', label: 'Open page', status: 'passed' }],
        evidence: {
          textSample: 'Signed in',
          artifacts: [{ id: 'shot', kind: 'screenshot', label: 'Screenshot', path: '/tmp/shot.png', createdAt: '2026-01-01T00:00:01.000Z' }],
        },
      },
    })}\n`, 'utf8');

    const rpc = vi.fn(async () => ({
      jobs: [{
        id: 'browser-job',
        name: 'Browser job',
        enabled: true,
        createdAtMs: 1_800_000_000_000,
        updatedAtMs: 1_800_000_000_000,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'Run browser task' },
        delivery: { mode: 'none' },
        state: {},
        agentId: 'main',
      }],
    }));
    const api = createCronApi({ gatewayManager: { rpc } as never });

    await expect(api.sessionHistory({ sessionKey: 'agent:main:cron:browser-job', limit: 10 }))
      .resolves.toMatchObject({
        browserAutomationRuns: [{
          runId: 'run-1',
          status: 'success',
          finalUrl: 'https://example.com/check-in',
          evidence: { artifacts: [{ kind: 'screenshot' }] },
        }],
        messages: expect.arrayContaining([expect.objectContaining({
          content: expect.stringContaining('Browser automation: success'),
        })]),
      });
  });
});
