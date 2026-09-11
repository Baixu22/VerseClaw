import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSecurityVerificationShadowRecords,
  getSecurityVerificationShadowRecords,
  getSecurityVerificationShadowSummary,
} from '../../openclaw_runtime/src/security-verification-shadow';
import { securityVerificationShadowHandlers } from '../../openclaw_runtime/src/gateway/server-methods/security-verification-shadow';
import {
  buildCheckpointFixture,
  buildRuntimeTaskEventFixture,
  RuntimeTaskEventLogStore,
  serializeRuntimeCheckpoint,
  setRuntimeVerificationShadowSink,
} from '../../openclaw_runtime/src/runtime-core';

type CapturedResponse = {
  ok: boolean;
  payload?: unknown;
  error?: { message?: string };
};

async function callHandler(
  method: string,
  params: Record<string, unknown> = {},
  runtimeConfig: Record<string, unknown> = {},
): Promise<CapturedResponse> {
  const captured: CapturedResponse[] = [];
  const handler = securityVerificationShadowHandlers[method];
  if (!handler) throw new Error(`missing handler: ${method}`);
  await handler({
    req: { id: 1, method, params } as never,
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => captured.push({ ok, payload, error }),
    context: {
      getRuntimeConfig: () => runtimeConfig,
    } as never,
  });
  return captured[0]!;
}

function expectNoRawPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('raw-prompt');
  expect(serialized).not.toContain('secret-value');
  expect(serialized).not.toContain('complete tool output');
}

describe('runtime verification auto-sampling contract', () => {
  beforeEach(() => {
    clearSecurityVerificationShadowRecords();
  });

  it('keeps event-log and checkpoint sampling default-off', () => {
    const store = new RuntimeTaskEventLogStore();
    store.append(buildRuntimeTaskEventFixture({
      eventId: 'event_default_off',
      taskId: 'task_default_off',
      kind: 'created',
      timestamp: 1,
      payload: { status: 'created', metadata: { prompt: 'raw-prompt' } },
    }));

    serializeRuntimeCheckpoint(buildCheckpointFixture({
      checkpointId: 'checkpoint_default_off',
      taskId: 'task_default_off',
      contextSummary: 'complete tool output with secret-value',
    }));

    expect(getSecurityVerificationShadowRecords()).toEqual([]);
    expect(getSecurityVerificationShadowSummary()).toMatchObject({
      totalRecords: 0,
      healthLevel: 'healthy',
      samplingModeCounts: { manual: 0, auto: 0 },
    });
  });

  it('records sanitized auto-sampled event-log records with sampling metadata', async () => {
    const store = new RuntimeTaskEventLogStore();
    const append = store.append(buildRuntimeTaskEventFixture({
      eventId: 'event_auto_contract',
      taskId: 'task_auto_contract',
      kind: 'created',
      timestamp: 1,
      payload: { status: 'created', metadata: { prompt: 'raw-prompt' } },
    }), {
      shadow: { enabled: true, runId: 'run_auto_event', storeTrace: false },
    });

    expect(append.appended).toBe(true);
    const records = getSecurityVerificationShadowRecords();
    expect(records).toEqual([
      expect.objectContaining({
        runId: 'run_auto_event',
        subject: 'event_log',
        source: 'verification.run',
        sampling: { mode: 'auto', trigger: 'event-log-append' },
        eventLog: expect.objectContaining({
          eventCount: 1,
          validEventCount: 1,
          replayStatus: 'created',
        }),
      }),
    ]);
    expectNoRawPayload(records);

    const status = await callHandler('verification.status');
    expect(status).toMatchObject({
      ok: true,
      payload: {
        status: {
          healthLevel: 'healthy',
          summary: {
            totalRecords: 1,
            samplingModeCounts: { auto: 1, manual: 0 },
            subjectCounts: { event_log: 1 },
          },
        },
      },
    });
  });

  it('records sanitized auto-sampled checkpoint records with sampling metadata', async () => {
    serializeRuntimeCheckpoint(buildCheckpointFixture({
      checkpointId: 'checkpoint_auto_contract',
      taskId: 'task_auto_contract',
      contextSummary: 'complete tool output with secret-value',
    }), {
      shadow: { enabled: true, runId: 'run_auto_checkpoint', storeTrace: false },
    });

    const records = getSecurityVerificationShadowRecords();
    expect(records).toEqual([
      expect.objectContaining({
        runId: 'run_auto_checkpoint',
        subject: 'checkpoint',
        source: 'verification.run',
        sampling: { mode: 'auto', trigger: 'checkpoint-serialize' },
        checkpoint: expect.objectContaining({
          checkpointId: 'checkpoint_auto_contract',
          taskId: 'task_auto_contract',
        }),
      }),
    ]);
    expectNoRawPayload(records);

    const list = await callHandler('verification.results.list', { subject: 'checkpoint' });
    expect(list).toMatchObject({
      ok: true,
      payload: {
        summary: {
          totalRecords: 1,
          samplingModeCounts: { auto: 1, manual: 0 },
        },
        results: [
          {
            subject: 'checkpoint',
            sampling: { mode: 'auto', trigger: 'checkpoint-serialize' },
          },
        ],
      },
    });
    expectNoRawPayload(list.payload);
  });

  it('swallows sampler sink failures without changing runtime return shapes', () => {
    const restore = setRuntimeVerificationShadowSink({
      recordEventLog() {
        throw new Error('shadow sink unavailable');
      },
      recordCheckpoint() {
        throw new Error('shadow sink unavailable');
      },
    });
    try {
      const store = new RuntimeTaskEventLogStore();
      const append = store.append(buildRuntimeTaskEventFixture({
        eventId: 'event_sink_failure',
        taskId: 'task_sink_failure',
        kind: 'running',
        timestamp: 1,
        payload: { status: 'running' },
      }), {
        shadow: { enabled: true, runId: 'run_sink_failure' },
      });
      const checkpoint = serializeRuntimeCheckpoint(buildCheckpointFixture({
        checkpointId: 'checkpoint_sink_failure',
        taskId: 'task_sink_failure',
      }), {
        shadow: { enabled: true, runId: 'run_sink_failure' },
      });

      expect(append).toMatchObject({ appended: true, duplicate: false, diagnostics: [] });
      expect(checkpoint).toMatchObject({ diagnostics: [], json: expect.any(String) });
      expect(getSecurityVerificationShadowRecords()).toEqual([]);
    } finally {
      restore();
    }
  });
});
