import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildToolCallRequestFromUnknown,
  buildToolCallResultFromUnknown,
  clearSecurityVerificationShadowRecords,
  evaluateRuntimeCheckpointShadow,
  evaluateRuntimeEventLogShadow,
  evaluateSecurityShadow,
  evaluateVerificationShadow,
  getSecurityVerificationShadowRecords,
  getSecurityVerificationShadowSummary,
  getSecurityVerificationShadowStatus,
  recordSecurityVerificationShadow,
  resolveSecurityVerificationShadowHealthLevel,
  sampleRuntimeCheckpointVerification,
  sampleRuntimeEventLogVerification,
} from '../../openclaw_runtime/src/security-verification-shadow';
import {
  buildCheckpointFixture,
  buildEvidenceVerifierInputFixture,
  buildRuntimeTaskEventFixture,
  RuntimeTaskEventLogStore,
  serializeRuntimeCheckpoint,
  type ToolCallRequest,
  type ToolCallResult,
} from '../../openclaw_runtime/src/runtime-core';
import {
  createCoreGatewayMethodDescriptors,
  listCoreAdvertisedGatewayMethodNames,
  resolveCoreOperatorGatewayMethodScope,
} from '../../openclaw_runtime/src/gateway/methods/core-descriptors';
import { securityVerificationShadowHandlers } from '../../openclaw_runtime/src/gateway/server-methods/security-verification-shadow';

type CapturedResponse = {
  ok: boolean;
  payload?: unknown;
  error?: { message?: string };
};

const MVP_METHODS = [
  'security.health',
  'security.policy.get',
  'security.policy.simulate',
  'security.intercepts.list',
  'verification.health',
  'verification.run',
  'verification.status',
  'verification.results.list',
  'verification.results.get',
] as const;

function request(overrides: Partial<ToolCallRequest> = {}): ToolCallRequest {
  return {
    callId: 'call_1',
    taskId: 'task_1',
    toolName: 'read',
    args: {},
    traceContext: { traceId: 'trace_1', spanId: 'span_1' },
    ...overrides,
  };
}

function result(overrides: Partial<ToolCallResult> = {}): ToolCallResult {
  return {
    callId: 'call_1',
    status: 'success',
    contextItems: [],
    startedAt: 1,
    finishedAt: 2,
    evidence: [{ type: 'tool', ref: 'call_1' }],
    ...overrides,
  };
}

async function callHandler(
  method: string,
  params: Record<string, unknown> = {},
  runtimeConfig: Record<string, unknown> = {},
): Promise<CapturedResponse> {
  const captured: CapturedResponse[] = [];
  const handler = securityVerificationShadowHandlers[method];
  if (!handler) throw new Error(`missing handler: ${method}`);
  await handler({
    req: { id: 1, method, params },
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

beforeEach(() => {
  clearSecurityVerificationShadowRecords();
});

describe('security/verification shadow evaluators', () => {
  it('allows low-risk successful tool calls with evidence', () => {
    expect(evaluateSecurityShadow(request(), result())).toMatchObject({
      decision: 'allow',
      severity: 'info',
      findings: [],
    });
    expect(evaluateVerificationShadow(request(), result())).toMatchObject({
      status: 'passed',
      findings: [],
    });
  });

  it('warns on network/mutating tools and sensitive argument keys without storing values', () => {
    const req = request({
      toolName: 'web_fetch',
      args: { url: 'https://example.test', apiToken: 'secret-value' },
    });
    const security = evaluateSecurityShadow(req, result());
    expect(security.decision).toBe('warn');
    expect(security.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['mutating-or-network-tool', 'sensitive-argument-key']),
    );

    const record = recordSecurityVerificationShadow({ source: 'verification.run', request: req, result: result(), storeTrace: false });
    expect(record.request.argKeys).toEqual(['apiToken', 'url']);
    expect(JSON.stringify(record)).not.toContain('secret-value');
  });

  it('classifies shell tools as approval-class and destructive commands as would-block', () => {
    expect(evaluateSecurityShadow(request({ toolName: 'bash', args: { command: 'git status' } })).decision)
      .toBe('would_require_approval');

    const blocked = evaluateSecurityShadow(request({ toolName: 'bash', args: { command: 'git reset --hard' } }));
    expect(blocked.decision).toBe('would_block');
    expect(blocked.severity).toBe('high');
  });

  it('marks failed, denied, and missing-evidence results deterministically', () => {
    expect(evaluateVerificationShadow(request(), result({ status: 'error' })).status).toBe('failed');
    expect(evaluateVerificationShadow(request(), result({ status: 'denied' })).status).toBe('failed');
    expect(evaluateVerificationShadow(request(), result({ evidence: [] })).status).toBe('insufficient_evidence');
  });

  it('verifies runtime event logs without retaining raw event payloads', () => {
    const events = [
      buildRuntimeTaskEventFixture({
        eventId: 'event_created',
        kind: 'created',
        timestamp: 1,
        payload: { status: 'created', metadata: { prompt: 'raw-prompt' } },
      }),
      buildRuntimeTaskEventFixture({
        eventId: 'event_running',
        kind: 'running',
        timestamp: 2,
        payload: { status: 'running' },
      }),
      buildRuntimeTaskEventFixture({
        eventId: 'event_completed',
        kind: 'completed',
        timestamp: 3,
        payload: { status: 'completed' },
      }),
    ];

    const evaluation = evaluateRuntimeEventLogShadow(events);
    expect(evaluation).toMatchObject({
      eventLog: {
        eventCount: 3,
        validEventCount: 3,
        replayState: 'completed',
        replayStatus: 'completed',
        diagnosticCount: 0,
        diagnosticCodes: [],
      },
      verification: { status: 'passed' },
    });

    const record = recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_events',
      events,
      storeTrace: false,
    });
    expect(record).toMatchObject({
      subject: 'event_log',
      runId: 'run_events',
      eventLog: { eventCount: 3, diagnosticCount: 0 },
      verification: { status: 'passed' },
    });
    expectNoRawSensitivePayload(record);
  });

  it('stores sanitized canonical evidence verifier decision summaries', () => {
    const record = recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_verifier_summary',
      request: request(),
      result: result(),
      evidenceVerifier: buildEvidenceVerifierInputFixture({
        objective: 'raw-prompt complete tool output with secret-value',
        obligations: [
          {
            id: 'external_blocker',
            description: 'Waiting for hidden-token from an external system.',
            status: 'blocked',
            externalDependency: true,
          },
        ],
        evidenceRefs: [],
        toolResults: [],
        eventReplay: {
          status: 'not_run',
          diagnosticCodes: [],
          pendingToolCallIds: [],
        },
      }),
      storeTrace: false,
    });

    expect(record.evidenceVerifier).toEqual({
      decision: 'blocked',
      findingCount: 5,
      evidenceRefCount: 0,
      requiredEvidenceKinds: ['file', 'test', 'tool'],
      findingCodes: [
        'external_dependency_blocked',
        'missing_file_evidence',
        'missing_test_evidence',
        'missing_tool_evidence',
        'event_replay_not_run',
      ],
      findingCategories: ['external_dependency', 'evidence', 'event_replay'],
      legacyDecisionUnaffected: true,
    });
    expectNoRawSensitivePayload(record);
  });

  it('maps event replay diagnostics and checkpoint diagnostics to failed verification summaries', () => {
    const duplicateEvents = [
      buildRuntimeTaskEventFixture({
        eventId: 'event_duplicate',
        kind: 'created',
        timestamp: 1,
        payload: { status: 'created' },
      }),
      buildRuntimeTaskEventFixture({
        eventId: 'event_duplicate',
        kind: 'running',
        timestamp: 2,
        payload: { status: 'running' },
      }),
    ];
    expect(evaluateRuntimeEventLogShadow(duplicateEvents)).toMatchObject({
      eventLog: {
        eventCount: 2,
        validEventCount: 2,
        diagnosticCodes: ['duplicate_event_id'],
      },
      verification: { status: 'failed' },
    });

    const invalidCheckpoint = evaluateRuntimeCheckpointShadow({
      schemaVersion: 999,
      schemaMarker: 'runtime.checkpoint-serializer.v999',
      checkpoint: { checkpointId: 'checkpoint_secret', taskId: 'task_1' },
    });
    expect(invalidCheckpoint).toMatchObject({
      checkpoint: {
        diagnosticCodes: ['schema_marker_mismatch'],
      },
      verification: { status: 'failed' },
    });
    expectNoRawSensitivePayload(invalidCheckpoint);
  });

  it('verifies serialized runtime checkpoints with sanitized checkpoint summaries', () => {
    const checkpoint = buildCheckpointFixture({
      checkpointId: 'checkpoint_contract',
      taskId: 'task_contract',
      contextSummary: 'complete tool output with secret-value',
    });
    const serialized = serializeRuntimeCheckpoint(checkpoint, {
      metadata: { prompt: 'raw-prompt' },
    });
    expect(serialized.json).toBeTypeOf('string');

    const record = recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_checkpoint',
      checkpoint: serialized.json,
      storeTrace: false,
    });
    expect(record).toMatchObject({
      subject: 'checkpoint',
      runId: 'run_checkpoint',
      checkpoint: {
        checkpointId: 'checkpoint_contract',
        taskId: 'task_contract',
        state: 'running',
        diagnosticCount: 0,
        diagnosticCodes: [],
      },
      verification: { status: 'passed' },
    });
    expectNoRawSensitivePayload(record);
  });

  it('derives deterministic health levels from shadow summaries', () => {
    expect(resolveSecurityVerificationShadowHealthLevel(getSecurityVerificationShadowSummary())).toBe('healthy');

    recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_degraded',
      request: request({ toolName: 'bash', args: { command: 'git status' } }),
      storeTrace: false,
    });
    expect(getSecurityVerificationShadowSummary().healthLevel).toBe('degraded');
    expect(getSecurityVerificationShadowStatus().healthLevel).toBe('degraded');

    recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_failing',
      request: request({ callId: 'call_fail' }),
      result: result({ callId: 'call_fail', status: 'error' }),
      storeTrace: false,
    });
    expect(getSecurityVerificationShadowSummary()).toMatchObject({
      healthLevel: 'failing',
      verificationStatusCounts: { failed: 1 },
    });
  });

  it('auto-samples runtime event logs and checkpoints only when explicitly enabled', () => {
    const event = buildRuntimeTaskEventFixture({
      eventId: 'event_auto_sample',
      taskId: 'task_auto_sample',
      kind: 'completed',
      timestamp: 1,
      payload: { status: 'completed', secret: 'secret-value' },
    });
    expect(sampleRuntimeEventLogVerification({ cfg: {}, events: [event], storeTrace: false })).toBeUndefined();
    expect(getSecurityVerificationShadowRecords()).toHaveLength(0);

    const sampledEvents = sampleRuntimeEventLogVerification({
      cfg: { runtime: { eventLog: { shadow: true } } } as never,
      events: [event],
      runId: 'run_sample_events',
      storeTrace: false,
    });
    expect(sampledEvents).toMatchObject({
      subject: 'event_log',
      runId: 'run_sample_events',
      eventLog: { eventCount: 1, validEventCount: 1 },
    });
    expectNoRawSensitivePayload(sampledEvents);

    const checkpoint = serializeRuntimeCheckpoint(buildCheckpointFixture({
      checkpointId: 'checkpoint_auto_sample',
      taskId: 'task_auto_sample',
      contextSummary: 'complete tool output with secret-value',
    }));
    expect(sampleRuntimeCheckpointVerification({ cfg: {}, checkpoint: checkpoint.json, storeTrace: false })).toBeUndefined();

    const sampledCheckpoint = sampleRuntimeCheckpointVerification({
      cfg: { runtime: { checkpointSerializer: { shadow: true } } } as never,
      checkpoint: checkpoint.json,
      runId: 'run_sample_checkpoint',
      storeTrace: false,
    });
    expect(sampledCheckpoint).toMatchObject({
      subject: 'checkpoint',
      runId: 'run_sample_checkpoint',
      checkpoint: { checkpointId: 'checkpoint_auto_sample', taskId: 'task_auto_sample' },
    });
    expectNoRawSensitivePayload(sampledCheckpoint);
  });

  it('runtime-core event-log store and checkpoint serializer feed the registered shadow sampler', () => {
    const store = new RuntimeTaskEventLogStore();
    const event = buildRuntimeTaskEventFixture({
      eventId: 'event_store_auto_sample',
      taskId: 'task_store_auto_sample',
      kind: 'running',
      timestamp: 1,
      payload: { status: 'running', prompt: 'raw-prompt' },
    });

    store.append(event);
    expect(getSecurityVerificationShadowRecords()).toHaveLength(0);

    const append = store.append(buildRuntimeTaskEventFixture({
      ...event,
      eventId: 'event_store_auto_sample_enabled',
      timestamp: 2,
    }), {
      shadow: { enabled: true, runId: 'run_store_auto_sample', storeTrace: false },
    });
    expect(append.appended).toBe(true);
    expect(getSecurityVerificationShadowRecords({ subject: 'event_log' })).toEqual([
      expect.objectContaining({
        subject: 'event_log',
        runId: 'run_store_auto_sample',
        eventLog: expect.objectContaining({ eventCount: 1, validEventCount: 1 }),
      }),
    ]);

    serializeRuntimeCheckpoint(buildCheckpointFixture({
      checkpointId: 'checkpoint_serializer_auto_sample',
      taskId: 'task_serializer_auto_sample',
      contextSummary: 'complete tool output with secret-value',
    }), {
      shadow: { enabled: true, runId: 'run_serializer_auto_sample', storeTrace: false },
    });
    expect(getSecurityVerificationShadowRecords({ subject: 'checkpoint' })).toEqual([
      expect.objectContaining({
        subject: 'checkpoint',
        runId: 'run_serializer_auto_sample',
        checkpoint: expect.objectContaining({ checkpointId: 'checkpoint_serializer_auto_sample' }),
      }),
    ]);
    expectNoRawSensitivePayload(getSecurityVerificationShadowRecords());
  });
});

describe('security/verification gateway methods', () => {
  it('registers every MVP method as advertised operator.read core descriptors', () => {
    const descriptors = createCoreGatewayMethodDescriptors(securityVerificationShadowHandlers);
    expect(descriptors.map((descriptor) => descriptor.name).sort()).toEqual([...MVP_METHODS].sort());
    expect(listCoreAdvertisedGatewayMethodNames()).toEqual(expect.arrayContaining([...MVP_METHODS]));

    for (const method of MVP_METHODS) {
      expect(resolveCoreOperatorGatewayMethodScope(method)).toBe('operator.read');
      expect(descriptors.find((descriptor) => descriptor.name === method)).toMatchObject({
        name: method,
        scope: 'operator.read',
        owner: { kind: 'core', area: 'gateway' },
      });
      expect(descriptors.find((descriptor) => descriptor.name === method)?.controlPlaneWrite).toBeUndefined();
      expect(descriptors.find((descriptor) => descriptor.name === method)?.startup).toBeUndefined();
    }
  });

  it('returns stable health, policy, and status shapes without enabling enforcement', async () => {
    const runtimeConfig = { security: { validationShadow: { enabled: true } } };

    await expect(callHandler('security.health', {}, runtimeConfig)).resolves.toMatchObject({
      ok: true,
      payload: {
        ok: true,
        health: {
          enabled: true,
          bufferSize: 0,
          maxBufferSize: 100,
          lastRecordAt: null,
          securityFindingCount: 0,
          verificationFindingCount: 0,
          summary: {
            totalRecords: 0,
            latestRunId: null,
            securityDecisionCounts: {
              allow: 0,
              warn: 0,
              would_require_approval: 0,
              would_block: 0,
            },
            verificationStatusCounts: {
              passed: 0,
              warning: 0,
              failed: 0,
              insufficient_evidence: 0,
            },
          },
        },
      },
    });
    await expect(callHandler('verification.health', {}, runtimeConfig)).resolves.toMatchObject({
      ok: true,
      payload: { ok: true, health: { enabled: true, bufferSize: 0 } },
    });
    await expect(callHandler('verification.status', {}, runtimeConfig)).resolves.toMatchObject({
      ok: true,
      payload: { status: { enabled: true, bufferSize: 0 } },
    });
    await expect(callHandler('security.policy.get', {}, runtimeConfig)).resolves.toMatchObject({
      ok: true,
      payload: {
        policy: {
          mode: 'shadow',
          enabled: true,
          enforcement: 'observe-only',
          deterministicOnly: true,
          llmJudge: false,
          externalTests: false,
        },
      },
    });
  });

  it('simulates security policy without recording a result', async () => {
    const response = await callHandler('security.policy.simulate', {
      request: {
        toolName: 'bash',
        args: { command: 'git clean -fd', apiToken: 'hidden-token', prompt: 'raw-prompt' },
      },
    });
    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      recorded: false,
      decision: { decision: 'would_block' },
      verification: { status: 'insufficient_evidence' },
    });
    expectNoRawSensitivePayload(response.payload);
    expect(getSecurityVerificationShadowRecords()).toHaveLength(0);
  });

  it('verification.run records only sanitized data and list/get return stable result shapes', async () => {
    const run = await callHandler('verification.run', {
      runId: 'run_contract_1',
      request: {
        callId: 'call_v',
        taskId: 'task_v',
        toolName: 'write',
        args: { path: 'a.ts', apiToken: 'hidden-token', prompt: 'raw-prompt' },
        traceContext: { traceId: 'trace_v', spanId: 'span_v' },
      },
      result: {
        status: 'error',
        error: { type: 'tool', message: 'complete tool output with secret-value' },
        structuredData: { output: 'complete tool output' },
        evidence: [],
      },
    });
    expect(run.ok).toBe(true);
    const payload = run.payload as {
      record: {
        id: string;
        request: Record<string, unknown>;
        result: Record<string, unknown>;
        security: { findings: unknown[] };
        verification: { findings: unknown[] };
      };
      result: { status: string };
    };
    expect(payload.result.status).toBe('failed');
    expect(payload.record).toMatchObject({ runId: 'run_contract_1' });
    expect(Object.keys(payload.record.request).sort()).toEqual([
      'argKeyCount',
      'argKeys',
      'callId',
      'hasPermissionContext',
      'sensitiveArgKeyCount',
      'spanId',
      'taskId',
      'toolName',
      'traceId',
    ]);
    expect(payload.record.request).toMatchObject({
      toolName: 'write',
      argKeys: ['apiToken', 'path', 'prompt'],
      argKeyCount: 3,
      sensitiveArgKeyCount: 1,
      traceId: 'trace_v',
      spanId: 'span_v',
    });
    expect(Object.keys(payload.record.result).sort()).toEqual([
      'callId',
      'contextItemCount',
      'errorType',
      'evidenceCount',
      'hasErrorMessage',
      'status',
      'structuredDataType',
    ]);
    expect(payload.record.result).toMatchObject({
      status: 'error',
      evidenceCount: 0,
      structuredDataType: 'object',
      errorType: 'tool',
      hasErrorMessage: true,
    });
    expectNoRawSensitivePayload(payload.record);
    expect(getSecurityVerificationShadowRecords()).toHaveLength(1);

    const list = await callHandler('verification.results.list', { limit: 10 });
    expect(list.ok).toBe(true);
    expect(list.payload).toMatchObject({
      summary: {
        totalRecords: 1,
        latestRunId: 'run_contract_1',
        securityDecisionCounts: { warn: 1 },
        verificationStatusCounts: { failed: 1 },
      },
      results: [
        {
          id: payload.record.id,
          runId: 'run_contract_1',
          source: 'verification.run',
          request: { toolName: 'write' },
          result: { status: 'error' },
          security: { decision: 'warn' },
          verification: { status: 'failed' },
        },
      ],
    });
    expectNoRawSensitivePayload(list.payload);

    const intercepts = await callHandler('security.intercepts.list', { limit: 1 });
    expect(intercepts.ok).toBe(true);
    expect(intercepts.payload).toMatchObject({
      intercepts: [{ id: payload.record.id, security: { decision: 'warn' } }],
    });
    expectNoRawSensitivePayload(intercepts.payload);

    const get = await callHandler('verification.results.get', { id: payload.record.id });
    expect(get.ok).toBe(true);
    expect(get.payload).toMatchObject({ result: { id: payload.record.id } });
    expectNoRawSensitivePayload(get.payload);
  });

  it('returns protocol errors for invalid verification result lookups', async () => {
    await expect(callHandler('verification.results.get')).resolves.toMatchObject({
      ok: false,
      error: { message: 'verification.results.get requires "id"' },
    });
    await expect(callHandler('verification.results.get', { id: 'missing' })).resolves.toMatchObject({
      ok: false,
      error: { message: 'unknown verification result "missing"' },
    });
  });

  it('summarizes and filters shadow records by runId, source, decision, and verification status', async () => {
    const runA1 = recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_a',
      request: request({ toolName: 'read', traceContext: { traceId: 'trace_a', spanId: 'span_a' } }),
      result: result(),
      storeTrace: false,
    });
    recordSecurityVerificationShadow({
      source: 'verification.run',
      runId: 'run_a',
      request: request({ callId: 'call_a2', toolName: 'bash', args: { command: 'git reset --hard' } }),
      result: result({ callId: 'call_a2', status: 'denied' }),
      storeTrace: false,
    });
    recordSecurityVerificationShadow({
      source: 'tools.invoke',
      runId: 'run_b',
      request: request({ callId: 'call_b', toolName: 'web_fetch', args: { url: 'https://example.test' } }),
      result: result({ callId: 'call_b', evidence: [] }),
      storeTrace: false,
    });

    expect(runA1.runId).toBe('run_a');
    expect(getSecurityVerificationShadowSummary()).toMatchObject({
      totalRecords: 3,
      latestRunId: 'run_b',
      securityDecisionCounts: {
        allow: 1,
        warn: 1,
        would_require_approval: 0,
        would_block: 1,
      },
      verificationStatusCounts: {
        passed: 1,
        warning: 0,
        failed: 1,
        insufficient_evidence: 1,
      },
      sourceCounts: {
        'tools.invoke': 1,
        'security.policy.simulate': 0,
        'verification.run': 2,
      },
      evidenceVerifierDecisionCounts: {
        completed: 0,
        failed: 0,
        blocked: 0,
        cancelled: 0,
        insufficient_evidence: 0,
      },
    });

    expect(getSecurityVerificationShadowRecords({ runId: 'run_a' })).toHaveLength(2);
    expect(getSecurityVerificationShadowRecords({ source: 'tools.invoke' })).toHaveLength(1);
    expect(getSecurityVerificationShadowRecords({ securityDecision: 'would_block' })).toHaveLength(1);
    expect(getSecurityVerificationShadowRecords({ verificationStatus: 'failed' })).toHaveLength(1);

    const filtered = await callHandler('verification.results.list', {
      runId: 'run_a',
      status: 'failed',
      decision: 'would_block',
    });
    expect(filtered.ok).toBe(true);
    expect(filtered.payload).toMatchObject({
      summary: {
        totalRecords: 1,
        latestRunId: 'run_a',
        securityDecisionCounts: { would_block: 1 },
        verificationStatusCounts: { failed: 1 },
      },
      results: [{ runId: 'run_a', security: { decision: 'would_block' }, verification: { status: 'failed' } }],
    });
    expectNoRawSensitivePayload(filtered.payload);
  });

  it('builds tool call requests from loose RPC payloads without raw argument values in sanitized records', () => {
    const req = buildToolCallRequestFromUnknown({
      source: 'verification.run',
      value: { toolName: 'write', args: { path: 'file.txt', password: 'hidden' } },
    });
    const record = recordSecurityVerificationShadow({ source: 'verification.run', request: req, storeTrace: false });
    expect(record.request.argKeys).toEqual(['password', 'path']);
    expect(JSON.stringify(record)).not.toContain('hidden');
  });

  it('normalizes loose evidence types to the runtime evidence enum', () => {
    const req = request();
    const built = buildToolCallResultFromUnknown({
      request: req,
      value: { status: 'success', evidence: [{ type: 'custom-system', ref: 'evidence_1' }] },
    });
    expect(built?.evidence).toEqual([{ type: 'other', ref: 'evidence_1' }]);
  });
});
