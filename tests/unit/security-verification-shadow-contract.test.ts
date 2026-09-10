import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSecurityVerificationShadowRecords,
  getSecurityVerificationShadowRecords,
} from '../../openclaw_runtime/src/security-verification-shadow';
import { securityVerificationShadowHandlers } from '../../openclaw_runtime/src/gateway/server-methods/security-verification-shadow';
import {
  buildCheckpointFixture,
  buildEvidenceVerifierInputFixture,
  buildRuntimeTaskEventFixture,
  serializeRuntimeCheckpoint,
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

function expectNoRawSensitivePayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('raw-prompt');
  expect(serialized).not.toContain('hidden-token');
  expect(serialized).not.toContain('secret-value');
  expect(serialized).not.toContain('complete tool output');
}

describe('security/verification shadow RPC regression fixture', () => {
  beforeEach(() => {
    clearSecurityVerificationShadowRecords();
  });

  it('keeps the full simulate -> run -> list/filter -> get -> intercepts -> summary flow stable', async () => {
    const simulate = await callHandler('security.policy.simulate', {
      request: {
        callId: 'simulate_call',
        taskId: 'simulate_task',
        toolName: 'bash',
        args: {
          command: 'git clean -fd',
          apiToken: 'hidden-token',
          prompt: 'raw-prompt',
        },
        traceContext: { traceId: 'trace_simulate', spanId: 'span_simulate' },
      },
    });

    expect(simulate).toMatchObject({
      ok: true,
      payload: {
        recorded: false,
        decision: { decision: 'would_block' },
        verification: { status: 'insufficient_evidence' },
      },
    });
    expect(getSecurityVerificationShadowRecords()).toHaveLength(0);
    expectNoRawSensitivePayload(simulate.payload);

    const run = await callHandler('verification.run', {
      runId: 'run_fixture',
      request: {
        callId: 'fixture_call',
        taskId: 'fixture_task',
        toolName: 'write',
        args: {
          path: 'src/example.ts',
          apiToken: 'hidden-token',
          prompt: 'raw-prompt',
        },
        traceContext: { traceId: 'trace_fixture', spanId: 'span_fixture' },
      },
      result: {
        callId: 'fixture_call',
        status: 'error',
        error: { type: 'tool', message: 'complete tool output with secret-value' },
        structuredData: { output: 'complete tool output' },
        evidence: [],
      },
      evidenceVerifier: buildEvidenceVerifierInputFixture({
        objective: 'raw-prompt complete tool output with secret-value',
        toolResults: [
          {
            callId: 'fixture_call',
            status: 'error',
            contextItems: [],
            startedAt: 1,
            finishedAt: 2,
            error: {
              type: 'tool',
              message: 'complete tool output with secret-value',
              retryable: false,
              evidenceRefs: [],
            },
            evidence: [],
          },
        ],
        obligations: [],
        evidenceRefs: [],
      }),
    });

    expect(run.ok).toBe(true);
    const runPayload = run.payload as { record: { id: string; runId: string } };
    expect(runPayload).toMatchObject({
      runId: 'run_fixture',
      result: { status: 'failed' },
      evidenceVerifier: {
        decision: 'failed',
        findingCodes: [
          'missing_file_evidence',
          'missing_test_evidence',
          'missing_tool_evidence',
          'tool_result_error',
        ],
      },
      record: {
        runId: 'run_fixture',
        source: 'verification.run',
        request: {
          toolName: 'write',
          argKeys: ['apiToken', 'path', 'prompt'],
          sensitiveArgKeyCount: 1,
          traceId: 'trace_fixture',
        },
        result: {
          status: 'error',
          errorType: 'tool',
          hasErrorMessage: true,
          structuredDataType: 'object',
        },
        security: { decision: 'warn' },
        verification: { status: 'failed' },
        evidenceVerifier: {
          decision: 'failed',
          findingCount: 4,
          evidenceRefCount: 0,
          requiredEvidenceKinds: ['file', 'test', 'tool'],
          findingCategories: ['evidence', 'tool'],
          legacyDecisionUnaffected: true,
        },
      },
    });
    expectNoRawSensitivePayload(run.payload);

    const otherRun = await callHandler('verification.run', {
      runId: 'run_other',
      request: {
        callId: 'other_call',
        taskId: 'other_task',
        toolName: 'read',
        args: { path: 'README.md' },
        traceContext: { traceId: 'trace_other', spanId: 'span_other' },
      },
      result: {
        callId: 'other_call',
        status: 'success',
        evidence: [{ type: 'tool', ref: 'other_call' }],
      },
      evidenceVerifier: buildEvidenceVerifierInputFixture(),
    });
    expect(otherRun).toMatchObject({
      ok: true,
      payload: {
        runId: 'run_other',
        record: {
          security: { decision: 'allow' },
          verification: { status: 'passed' },
          evidenceVerifier: { decision: 'completed' },
        },
      },
    });

    const latestLimited = await callHandler('verification.results.list', { limit: 1 });
    expect(latestLimited).toMatchObject({
      ok: true,
      payload: {
        summary: {
          totalRecords: 1,
          latestRunId: 'run_other',
          securityDecisionCounts: { allow: 1 },
          verificationStatusCounts: { passed: 1 },
          evidenceVerifierDecisionCounts: { completed: 1 },
        },
        results: [{ runId: 'run_other' }],
      },
    });

    const filteredList = await callHandler('verification.results.list', {
      runId: 'run_fixture',
      source: 'verification.run',
      decision: 'warn',
      status: 'failed',
      verifierDecision: 'failed',
      limit: 10,
    });
    expect(filteredList).toMatchObject({
      ok: true,
      payload: {
        summary: {
          totalRecords: 1,
          latestRunId: 'run_fixture',
          securityDecisionCounts: { warn: 1 },
          verificationStatusCounts: { failed: 1 },
          evidenceVerifierDecisionCounts: { failed: 1 },
          sourceCounts: { 'verification.run': 1 },
        },
        results: [
          {
            id: runPayload.record.id,
            runId: 'run_fixture',
            source: 'verification.run',
            security: { decision: 'warn' },
            verification: { status: 'failed' },
            evidenceVerifier: { decision: 'failed' },
          },
        ],
      },
    });
    expectNoRawSensitivePayload(filteredList.payload);

    const get = await callHandler('verification.results.get', { id: runPayload.record.id });
    expect(get).toMatchObject({
      ok: true,
      payload: {
        result: {
          id: runPayload.record.id,
          runId: 'run_fixture',
          security: { decision: 'warn' },
          verification: { status: 'failed' },
          evidenceVerifier: { decision: 'failed' },
        },
      },
    });
    expectNoRawSensitivePayload(get.payload);

    const intercepts = await callHandler('security.intercepts.list', {
      runId: 'run_fixture',
      decision: 'warn',
      status: 'failed',
      verifierDecision: 'failed',
    });
    expect(intercepts).toMatchObject({
      ok: true,
      payload: {
        summary: {
          totalRecords: 1,
          latestRunId: 'run_fixture',
          securityDecisionCounts: { warn: 1 },
          verificationStatusCounts: { failed: 1 },
          evidenceVerifierDecisionCounts: { failed: 1 },
        },
        intercepts: [
          {
            id: runPayload.record.id,
            runId: 'run_fixture',
            security: { decision: 'warn' },
            verification: { status: 'failed' },
            evidenceVerifier: { decision: 'failed' },
          },
        ],
      },
    });
    expectNoRawSensitivePayload(intercepts.payload);

    const status = await callHandler(
      'verification.status',
      {},
      { security: { validationShadow: { enabled: true } } },
    );
    expect(status).toMatchObject({
      ok: true,
      payload: {
        status: {
          enabled: true,
          bufferSize: 2,
          summary: {
            totalRecords: 2,
            latestRunId: 'run_other',
            securityDecisionCounts: { allow: 1, warn: 1 },
            verificationStatusCounts: { passed: 1, failed: 1 },
            evidenceVerifierDecisionCounts: { completed: 1, failed: 1 },
            sourceCounts: { 'verification.run': 2 },
          },
        },
      },
    });
    expectNoRawSensitivePayload(status.payload);
  });

  it('keeps event log and checkpoint verification subjects stable through RPC list/get/status', async () => {
    const events = [
      buildRuntimeTaskEventFixture({
        eventId: 'event_created',
        taskId: 'task_event_rpc',
        kind: 'created',
        timestamp: 1,
        payload: { status: 'created', metadata: { prompt: 'raw-prompt' } },
      }),
      buildRuntimeTaskEventFixture({
        eventId: 'event_running',
        taskId: 'task_event_rpc',
        kind: 'running',
        timestamp: 2,
        payload: { status: 'running' },
      }),
      buildRuntimeTaskEventFixture({
        eventId: 'event_completed',
        taskId: 'task_event_rpc',
        kind: 'completed',
        timestamp: 3,
        payload: { status: 'completed' },
      }),
    ];

    const eventRun = await callHandler('verification.run', {
      runId: 'run_event_rpc',
      events,
    });
    expect(eventRun).toMatchObject({
      ok: true,
      payload: {
        runId: 'run_event_rpc',
        result: { status: 'passed' },
        record: {
          subject: 'event_log',
          runId: 'run_event_rpc',
          eventLog: {
            eventCount: 3,
            validEventCount: 3,
            replayState: 'completed',
            replayStatus: 'completed',
            diagnosticCount: 0,
          },
          verification: { status: 'passed' },
        },
      },
    });
    expectNoRawSensitivePayload(eventRun.payload);

    const checkpoint = serializeRuntimeCheckpoint(
      buildCheckpointFixture({
        checkpointId: 'checkpoint_rpc',
        taskId: 'task_checkpoint_rpc',
        contextSummary: 'complete tool output with secret-value',
      }),
      { metadata: { prompt: 'raw-prompt' } },
    );
    const checkpointRun = await callHandler('verification.run', {
      runId: 'run_checkpoint_rpc',
      checkpoint: checkpoint.json,
    });
    expect(checkpointRun).toMatchObject({
      ok: true,
      payload: {
        runId: 'run_checkpoint_rpc',
        result: { status: 'passed' },
        record: {
          subject: 'checkpoint',
          runId: 'run_checkpoint_rpc',
          checkpoint: {
            checkpointId: 'checkpoint_rpc',
            taskId: 'task_checkpoint_rpc',
            diagnosticCount: 0,
          },
          verification: { status: 'passed' },
        },
      },
    });
    expectNoRawSensitivePayload(checkpointRun.payload);

    const eventList = await callHandler('verification.results.list', {
      subject: 'event_log',
      status: 'passed',
    });
    expect(eventList).toMatchObject({
      ok: true,
      payload: {
        summary: {
          totalRecords: 1,
          latestRunId: 'run_event_rpc',
          subjectCounts: { event_log: 1 },
          verificationStatusCounts: { passed: 1 },
        },
        results: [{ subject: 'event_log', runId: 'run_event_rpc' }],
      },
    });
    expectNoRawSensitivePayload(eventList.payload);

    const checkpointList = await callHandler('security.intercepts.list', {
      subject: 'checkpoint',
      runId: 'run_checkpoint_rpc',
    });
    expect(checkpointList).toMatchObject({
      ok: true,
      payload: {
        summary: {
          totalRecords: 1,
          latestRunId: 'run_checkpoint_rpc',
          subjectCounts: { checkpoint: 1 },
        },
        intercepts: [{ subject: 'checkpoint', runId: 'run_checkpoint_rpc' }],
      },
    });
    expectNoRawSensitivePayload(checkpointList.payload);

    const invalid = await callHandler('verification.run', {
      runId: 'run_invalid_rpc',
      events: [],
      checkpoint: checkpoint.json,
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { message: 'verification.run accepts either events or checkpoint, not both' },
    });
  });
});
