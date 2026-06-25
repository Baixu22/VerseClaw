// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { createCronApi } from '@electron/services/cron-api';
import { buildCronBrowserAutomationPrompt } from '@shared/cron-browser-automation';

function makeGatewayJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cron-browser-1',
    name: 'Daily check-in',
    enabled: true,
    createdAtMs: 1_800_000_000_000,
    updatedAtMs: 1_800_000_000_000,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    payload: { kind: 'agentTurn', message: 'Check in' },
    delivery: { mode: 'none' },
    sessionTarget: 'isolated',
    wakeMode: 'next-heartbeat',
    state: {},
    agentId: 'main',
    ...overrides,
  };
}

describe('createCronApi browser automation tasks', () => {
  it('creates browser automation cron jobs as isolated agent turns with agent_browser allowlist', async () => {
    const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => {
      expect(method).toBe('cron.add');
      return makeGatewayJob({
        payload: params.payload,
      });
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const job = await api.create({
      name: 'Daily check-in',
      message: 'Check in if needed.',
      schedule: '0 9 * * *',
      taskKind: 'browserAutomation',
      browserAutomation: {
        url: 'https://example.com/check-in',
        objective: 'Check in if needed.',
        successCondition: 'The page shows checked in.',
        failureCondition: 'Login is required.',
        template: 'checkIn',
        profile: 'work',
        authStateName: 'work-login',
        authPersistence: 'session-name',
        mode: 'headless',
        allowedDomains: ['example.com'],
        sensitiveActionPolicy: 'draft-only',
        retryOnTransientFailure: true,
      },
    });

    const payload = rpc.mock.calls[0]?.[1] as {
      payload?: { kind?: string; message?: string; toolsAllow?: string[] };
    };
    expect(payload.payload?.kind).toBe('agentTurn');
    expect(payload.payload?.toolsAllow).toEqual(['agent_browser']);
    expect(payload.payload?.message).toContain('Use the agent_browser tool only');
    expect(payload.payload?.message).toContain('profile: work');
    expect(payload.payload?.message).toContain('authStateName: work-login');
    expect(payload.payload?.message).toContain('Success condition: The page shows checked in.');
    expect(payload.payload?.message).toContain('Transient failure retry: if open/navigate/page-load/wait-for-selector fails');

    expect(job.taskKind).toBe('browserAutomation');
    expect(job.message).toBe('Check in if needed.');
    expect(job.browserAutomation).toMatchObject({
      url: 'https://example.com/check-in',
      objective: 'Check in if needed.',
      successCondition: 'The page shows checked in.',
      failureCondition: 'Login is required.',
      profile: 'work',
      authStateName: 'work-login',
      sensitiveActionPolicy: 'draft-only',
      retryOnTransientFailure: true,
    });
    expect(job.toolsAllow).toEqual(['agent_browser']);
  });

  it('restores browser automation metadata from listed cron prompt markers', async () => {
    const message = buildCronBrowserAutomationPrompt({
      url: 'https://example.com/status',
      objective: 'Read the current status.',
      successCondition: 'Status text is visible.',
      template: 'monitor',
      profile: 'ops',
      authPersistence: 'session-name',
      mode: 'visible',
      sensitiveActionPolicy: 'draft-only',
      retryOnTransientFailure: false,
    });
    const rpc = vi.fn(async () => ({
      jobs: [
        makeGatewayJob({
          name: 'Status monitor',
          payload: { kind: 'agentTurn', message, toolsAllow: ['agent_browser'] },
        }),
      ],
    }));
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const jobs = await api.list();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'Status monitor',
      taskKind: 'browserAutomation',
      message: 'Read the current status.',
      browserAutomation: {
        url: 'https://example.com/status',
        objective: 'Read the current status.',
        successCondition: 'Status text is visible.',
        template: 'monitor',
        profile: 'ops',
        mode: 'visible',
        retryOnTransientFailure: false,
      },
      toolsAllow: ['agent_browser'],
    });
  });

  it('updates browser automation jobs with compiled payload and tool allowlist', async () => {
    const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => {
      expect(method).toBe('cron.update');
      return makeGatewayJob({
        id: params.id,
        payload: (params.patch as { payload?: unknown }).payload,
      });
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    await api.update({
      id: 'cron-browser-1',
      input: {
        taskKind: 'browserAutomation',
        message: 'Prepare a draft.',
        browserAutomation: {
          url: 'https://example.com/publish',
          objective: 'Prepare a draft.',
          failureCondition: 'Editor is unavailable.',
          template: 'publishDraft',
          profile: 'publisher',
          authPersistence: 'session-name',
          mode: 'headless',
          sensitiveActionPolicy: 'draft-only',
          retryOnTransientFailure: true,
        },
      },
    });

    const update = rpc.mock.calls[0]?.[1] as {
      patch?: { payload?: { message?: string; toolsAllow?: string[] }; browserAutomation?: unknown };
    };
    expect(update.patch?.payload?.toolsAllow).toEqual(['agent_browser']);
    expect(update.patch?.payload?.message).toContain('Template: publishDraft');
    expect(update.patch?.payload?.message).toContain('Failure condition: Editor is unavailable.');
    expect(update.patch?.browserAutomation).toBeUndefined();
  });
});
