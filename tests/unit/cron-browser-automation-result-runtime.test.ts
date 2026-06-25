import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCronBrowserAutomationRunResult,
  buildCronBrowserAutomationRunResultWithArtifacts,
} from '../../openclaw_runtime/src/cron/browser-automation-result';
import type { AgentBrowserAutomationEvent } from '../../openclaw_runtime/src/agents/tools/agent-browser-automation-event';
import type { CronJob } from '../../openclaw_runtime/src/cron/types';

function jobWithPrompt(message: string): CronJob {
  return {
    id: 'job-browser',
    name: 'Browser job',
    schedule: '* * * * *',
    enabled: true,
    payload: { kind: 'agentTurn', message, toolsAllow: ['agent_browser'] },
    state: {},
    sessionTarget: 'isolated',
    createdAt: 1,
    updatedAt: 1,
  } as CronJob;
}

describe('runtime cron browser automation result', () => {
  it('summarizes agent_browser telemetry and browser marker config', () => {
    const startedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
    const endedAt = startedAt + 1000;
    const marker = [
      '<!-- clawx:browser-automation',
      JSON.stringify({
        url: 'https://example.com/checkin',
        objective: 'sign in',
        profile: 'work',
        authStateName: 'mail',
      }),
      '-->',
    ].join('\n');
    const events: AgentBrowserAutomationEvent[] = [
      {
        schemaVersion: 1,
        tool: 'agent_browser',
        action: 'open',
        ok: true,
        ts: startedAt + 10,
        sessionId: 's1',
        profile: 'work',
        authStateName: 'mail',
        finalUrl: 'https://example.com/checkin',
        title: 'Daily check-in',
        textSample: 'Already checked in today',
      },
      {
        schemaVersion: 1,
        tool: 'agent_browser',
        action: 'screenshot',
        ok: true,
        ts: startedAt + 20,
        sessionId: 's1',
        screenshotDataUrl: 'data:image/png;base64,aaa',
      },
    ];

    const result = buildCronBrowserAutomationRunResult({
      job: jobWithPrompt(`Run browser task\n\n${marker}`),
      runId: 'run-1',
      status: 'success',
      startedAt,
      endedAt,
      events,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      runId: 'run-1',
      status: 'success',
      profile: 'work',
      authStateName: 'mail',
      finalUrl: 'https://example.com/checkin',
      title: 'Daily check-in',
      loginState: 'authenticated',
      evidence: {
        textSample: 'Already checked in today',
        artifacts: [{ kind: 'screenshot' }],
      },
    });
    expect(result?.steps).toHaveLength(2);
  });

  it('persists screenshot and command diagnostics as artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cron-browser-artifacts-'));
    try {
      const startedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
      const png1x1 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
      const result = await buildCronBrowserAutomationRunResultWithArtifacts({
        job: jobWithPrompt('Run browser task'),
        runId: 'run/with unsafe chars',
        status: 'success',
        startedAt,
        endedAt: startedAt + 1000,
        artifactRootDir: root,
        events: [
          {
            schemaVersion: 1,
            tool: 'agent_browser',
            action: 'screenshot',
            ok: true,
            ts: startedAt + 10,
            screenshotDataUrl: `data:image/png;base64,${png1x1}`,
          },
          {
            schemaVersion: 1,
            tool: 'agent_browser',
            action: 'command',
            ok: true,
            ts: startedAt + 20,
            command: ['snapshot', '-i'],
            stdout: JSON.stringify({ title: 'Snapshot', nodes: [] }),
          },
        ],
      });

      expect(result?.evidence.artifacts).toHaveLength(2);
      const screenshot = result?.evidence.artifacts.find((artifact) => artifact.kind === 'screenshot');
      const snapshot = result?.evidence.artifacts.find((artifact) => artifact.kind === 'snapshot');
      expect(screenshot?.path).toContain('cron-browser-artifacts');
      expect(snapshot?.path).toContain('cron-browser-artifacts');
      await expect(stat(screenshot!.path!)).resolves.toMatchObject({ size: screenshot?.bytes });
      await expect(readFile(snapshot!.path!, 'utf8')).resolves.toContain('"title": "Snapshot"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
