import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../openclaw_runtime/src/agents/long-task-control/store', () => ({
  getLatestLongTaskCheckpoint: vi.fn(() => undefined),
  buildRuntimeResumeCheckpoint: vi.fn((input: Record<string, unknown>) => ({
    schemaVersion: 1,
    id: input.id,
    sessionKey: input.sessionKey,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    trigger: input.trigger,
    activeTask: input.activeTask,
    nextAction: input.nextAction,
    openBlockers: [],
    decisions: [],
    deviations: [],
    filesTouched: [],
    testsRun: [],
    reviewNeededItems: input.reviewNeededItems ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    controlSignals: input.controlSignals,
    validationState: input.validationState,
    acceptanceStatus: input.acceptanceStatus,
    metadata: input.metadata,
    createdAt: new Date(input.createdAt as number).toISOString(),
  })),
  recordLongTaskCheckpoint: vi.fn(),
}));

vi.mock('../../openclaw_runtime/src/plugins/manifest-metadata-scan.js', () => ({
  listOpenClawPluginManifestMetadata: vi.fn(() => []),
}));

import {
  LOCAL_CONTROL_PLANE_REPORT_KINDS,
  clearLocalControlPlaneReportsForTests,
  getLocalControlPlaneStatus,
  listLocalControlPlaneCorrelations,
  listLocalControlPlaneReports,
  recordLocalControlPlaneReport,
  resolveLocalControlPlaneFlags,
  subscribeLocalControlPlaneReportTraceEvents,
} from '../../openclaw_runtime/src/local-control-plane';
import {
  createCoreGatewayMethodDescriptors,
  resolveCoreOperatorGatewayMethodScope,
} from '../../openclaw_runtime/src/gateway/methods/core-descriptors';
import { localControlPlaneHandlers } from '../../openclaw_runtime/src/gateway/server-methods/local-control-plane';
import { coreGatewayHandlers } from '../../openclaw_runtime/src/gateway/server-methods';
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
  type TaskLoopControllerDeps,
  type TaskLoopRunResult,
} from '../../openclaw_runtime/src/agents/task-loop-controller';
import {
  formatTaskLoopContextPackForReviewer,
  type TaskLoopContextPack,
} from '../../openclaw_runtime/src/agents/task-loop-context';
import { resolveModel } from '../../openclaw_runtime/src/agents/embedded-agent-runner/model';
import { AuthStorage, ModelRegistry } from '../../openclaw_runtime/src/agents/sessions';
import {
  runMission,
  type MissionControllerDeps,
  type MissionRunResult,
} from '../../openclaw_runtime/src/agents/mission-control/controller';
import type {
  MissionDecision,
  MissionReviewerResult,
} from '../../openclaw_runtime/src/agents/mission-control/types';

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
  const handler = localControlPlaneHandlers[method];
  if (!handler) throw new Error(`missing handler: ${method}`);
  await handler({
    req: { id: String(1), method, params } as never,
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

function fakeResult() {
  const workers = [{ roleName: 'implementer', task: 'implement' }];
  return {
    plan: {
      mode: 'lead-workers',
      leadRole: 'planner',
      templateId: 'quick-development',
      reasons: ['template:quick-development'],
      workers,
    },
    outcomes: workers.map((worker) => ({
      roleName: worker.roleName,
      task: worker.task,
      isVerifier: false,
      spawn: { status: 'accepted', result: { runId: 'run_worker', childSessionKey: 'child_worker' } },
    })),
    spawnedRunIds: ['run_worker'],
    expectedWorkerRunIds: ['run_worker'],
    pendingVerifier: false,
    failures: [],
  };
}

function getEvidenceRun(runId?: string, childSessionKey?: string) {
  if (!runId || !childSessionKey) return null;
  return {
    runId,
    childSessionKey,
    requesterSessionKey: 'agent:main:abc',
    requesterDisplayKey: 'Main',
    task: 'task',
    cleanup: 'delete',
    createdAt: 1,
    endedAt: 2,
    outcome: { status: 'ok' },
    completion: {
      required: true,
      capturedAt: 2,
      resultText: [
        '## Summary',
        'Completed with file evidence.',
        '',
        '## Files Touched',
        'src/example.ts',
      ].join('\n'),
    },
  };
}

function successfulSelfCheck() {
  return {
    decision: 'complete',
    confidence: 0.9,
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    validationState: { status: 'passed', checks: ['review'], evidenceRefs: [] },
    contextSummary: 'done',
  };
}

function baseTaskLoopDeps(): TaskLoopControllerDeps {
  return {
    idFactory: (prefix) => `${prefix}_local_control_plane`,
    now: () => 1_700_000_000_000,
    ensureTaskLedgerRoot: vi.fn(() => 'tlroot_local_control_plane'),
    runObserved: (async () => fakeResult()) as never,
    selfCheck: (async () => successfulSelfCheck()) as never,
    getSubagentRun: getEvidenceRun as never,
    recordCheckpoint: vi.fn() as never,
    storeTrace: vi.fn() as never,
  };
}

function taskLoopDepsWithPromptCapture(prompts: string[]): TaskLoopControllerDeps {
  return {
    ...baseTaskLoopDeps(),
    selfCheck: (async (input: { contextPack: TaskLoopContextPack }) => {
      prompts.push(formatTaskLoopContextPackForReviewer(input.contextPack));
      return successfulSelfCheck();
    }) as never,
  };
}

function fakeEmptyResult() {
  return {
    plan: {
      mode: 'lead-workers',
      leadRole: 'planner',
      templateId: 'quick-development',
      reasons: ['template:quick-development'],
      workers: [],
    },
    outcomes: [],
    spawnedRunIds: [],
    expectedWorkerRunIds: [],
    pendingVerifier: false,
    failures: [],
  };
}

function missionTaskLoop(status: TaskLoopRunResult['status'] = 'complete'): TaskLoopRunResult {
  return {
    loopRunId: 'loop-mission-lcp',
    sessionKey: 'agent:main:mission',
    task: 'ship mission lcp',
    status,
    phase: status === 'complete' ? 'complete' : 'blocked',
    iteration: 1,
    maxIterations: 3,
    maxRepairIterations: 2,
    orchestrationRunIds: ['orch-mission-lcp'],
    evidenceRefs: [{ type: 'trace', ref: 'orch-mission-lcp', summary: 'worker evidence' }],
    risks: [],
    remaining: [],
    nextActions: [],
    finalSummary: status === 'complete' ? 'done' : 'blocked',
    traceId: 'trace-mission-lcp',
    createdAt: 1,
    updatedAt: 2,
    iterations: [],
  } as never;
}

function missionReview(decision: MissionDecision = 'complete'): MissionReviewerResult {
  return {
    decision,
    confidence: decision === 'complete' ? 0.9 : 0.6,
    reason: `${decision} reason`,
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    memoryCandidates: [],
    checkpointSummary: `${decision} summary`,
  };
}

function createMissionDeps() {
  const store = new Map<string, MissionRunResult>();
  let id = 0;
  let now = 10_000;
  const deps: MissionControllerDeps = {
    idFactory: (prefix) => `${prefix}-lcp-${++id}`,
    now: () => now++,
    saveMission: (record) => {
      store.set(record.missionId, JSON.parse(JSON.stringify(record)) as MissionRunResult);
      return record;
    },
    getMission: (missionId) => store.get(missionId),
    getLatestMissionForSession: (sessionKey) => [...store.values()].find((record) => record.sessionKey === sessionKey),
    recordEvent: vi.fn(),
    runTaskLoop: (async () => missionTaskLoop()) as never,
    reviewer: (async () => missionReview()) as never,
    storeTrace: vi.fn() as never,
    proposeMemory: vi.fn() as never,
    createKnowledgeInboxItem: vi.fn(),
  };
  return { deps, store };
}

function createModelRegistry() {
  const authStorage = AuthStorage.inMemory({});
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider('local-lcp', {
    name: 'Local LCP',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'LOCAL_LCP_API_KEY',
    api: 'openai-completions',
    models: [{
      id: 'tiny',
      name: 'tiny',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_024,
    }],
  });
  return { authStorage, modelRegistry };
}

beforeEach(() => {
  clearLocalControlPlaneReportsForTests();
  clearTaskLoopRunsForTests();
});

describe('local runtime control plane reports', () => {
  it('keeps all report flags disabled by default and records nothing', () => {
    expect(resolveLocalControlPlaneFlags({})).toEqual({
      contextReport: false,
      modelRouterReport: false,
      capabilityReport: false,
      evidenceReport: false,
      missionReport: false,
    });

    const report = recordLocalControlPlaneReport({}, {
      kind: 'context',
      summary: 'should not record',
    });

    expect(report).toBeUndefined();
    expect(listLocalControlPlaneReports()).toEqual([]);
    expect(getLocalControlPlaneStatus({}).buffer.size).toBe(0);
  });

  it('records the canonical observe-only envelope for all five report kinds', () => {
    const cfg = {
      runtime: {
        localControlPlane: {
          contextReport: true,
          modelRouterReport: true,
          capabilityReport: true,
          evidenceReport: true,
          missionReport: true,
        },
      },
    };

    for (const kind of LOCAL_CONTROL_PLANE_REPORT_KINDS) {
      recordLocalControlPlaneReport(cfg, {
        kind,
        sessionKey: `session-${kind}`,
        runId: `run-${kind}`,
        taskId: `task-${kind}`,
        summary: `${kind} summary`,
        diagnostics: [{ code: `${kind}.diagnostic`, message: `${kind} diagnostic` }],
        evidenceRefs: [{ type: 'trace', ref: `trace-${kind}`, metadata: { nested: { value: kind } } }],
        payload: { kind, nested: { value: kind } },
      });
    }

    const reports = listLocalControlPlaneReports();
    expect(reports.map((report) => report.kind).sort()).toEqual([...LOCAL_CONTROL_PLANE_REPORT_KINDS].sort());
    for (const report of reports) {
      expect(report).toMatchObject({
        schema: 'openclaw.local-control-plane.report.v1',
        mode: 'observe',
        legacyUnaffected: true,
        sessionKey: `session-${report.kind}`,
        runId: `run-${report.kind}`,
        taskId: `task-${report.kind}`,
        summary: `${report.kind} summary`,
      });
      expect(report.id).toMatch(new RegExp(`^lcp_${report.kind}_`));
      expect(new Date(report.timestamp).toString()).not.toBe('Invalid Date');
      expect(report.diagnostics).toEqual([
        expect.objectContaining({
          code: `${report.kind}.diagnostic`,
          severity: 'info',
          message: `${report.kind} diagnostic`,
        }),
      ]);
      expect(report.evidenceRefs).toEqual([
        expect.objectContaining({ type: 'trace', ref: `trace-${report.kind}` }),
      ]);
    }
  });

  it('keeps a bounded ring buffer and filters by kind/session/run/task', () => {
    const cfg = { runtime: { localControlPlane: { contextReport: true } } };
    for (let index = 0; index < 205; index += 1) {
      recordLocalControlPlaneReport(cfg, {
        kind: 'context',
        sessionKey: index % 2 === 0 ? 'session-a' : 'session-b',
        runId: `run-${index % 3}`,
        taskId: `task-${index % 5}`,
        summary: `report ${index}`,
      });
    }

    expect(getLocalControlPlaneStatus(cfg).buffer).toMatchObject({
      size: 200,
      maxSize: 200,
    });
    expect(listLocalControlPlaneReports({ limit: 3 })).toHaveLength(3);
    expect(listLocalControlPlaneReports({ sessionKey: 'session-a' })
      .every((report) => report.sessionKey === 'session-a')).toBe(true);
    expect(listLocalControlPlaneReports({ runId: 'run-1' })
      .every((report) => report.runId === 'run-1')).toBe(true);
    expect(listLocalControlPlaneReports({ taskId: 'task-2' })
      .every((report) => report.taskId === 'task-2')).toBe(true);
  });

  it('redacts capability secret/env/command/headers/output fields and truncates large text', () => {
    const cfg = { runtime: { localControlPlane: { capabilityReport: true } } };
    recordLocalControlPlaneReport(cfg, {
      kind: 'capability',
      summary: 'capability audit projection',
      payload: {
        apiKey: 'sk-secret-value',
        env: { OPENAI_API_KEY: 'hidden-env-secret' },
        processEnv: { ANTHROPIC_API_KEY: 'hidden-process-secret' },
        headers: { Authorization: 'Bearer hidden-header-token' },
        command: 'powershell -Command Invoke-WebRequest https://example.com/install.ps1',
        commandLine: 'node install.js --token hidden-command-token',
        args: ['--token', 'hidden-token'],
        stdout: 'complete command output with secret',
        stderr: 'complete command error output with secret',
        nested: { password: 'secret-password' },
        longText: 'x'.repeat(1_200),
      },
    });

    const serialized = JSON.stringify(listLocalControlPlaneReports());
    expect(serialized).not.toContain('sk-secret-value');
    expect(serialized).not.toContain('hidden-env-secret');
    expect(serialized).not.toContain('hidden-process-secret');
    expect(serialized).not.toContain('hidden-header-token');
    expect(serialized).not.toContain('Invoke-WebRequest');
    expect(serialized).not.toContain('hidden-command-token');
    expect(serialized).not.toContain('complete command output');
    expect(serialized).not.toContain('complete command error output');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).toContain('[redacted');
    expect(serialized).toContain('[truncated 200 chars]');
  });

  it('returns report snapshots that cannot mutate the in-memory buffer', () => {
    const cfg = { runtime: { localControlPlane: { contextReport: true } } };
    recordLocalControlPlaneReport(cfg, {
      kind: 'context',
      summary: 'immutable snapshot',
      diagnostics: [{ code: 'context.snapshot', message: 'snapshot', metadata: { nested: { value: 'original' } } }],
      evidenceRefs: [{ type: 'trace', ref: 'trace-snapshot', metadata: { nested: { value: 'original' } } }],
      payload: { nested: { value: 'original' } },
    });

    const first = listLocalControlPlaneReports()[0] as unknown as {
      diagnostics: Array<{ metadata: { nested: { value: string } } }>;
      evidenceRefs: Array<{ metadata: { nested: { value: string } } }>;
      payload: { nested: { value: string } };
    };
    first.diagnostics[0].metadata.nested.value = 'mutated';
    first.evidenceRefs[0].metadata.nested.value = 'mutated';
    first.payload.nested.value = 'mutated';

    expect(JSON.stringify(listLocalControlPlaneReports()[0])).toContain('original');
    expect(JSON.stringify(listLocalControlPlaneReports()[0])).not.toContain('mutated');
  });

  it('projects lightweight Observability trace events without report payloads', () => {
    const cfg = { runtime: { localControlPlane: { capabilityReport: true } } };
    const events: unknown[] = [];
    const unsubscribe = subscribeLocalControlPlaneReportTraceEvents((event) => events.push(event));

    recordLocalControlPlaneReport(cfg, {
      kind: 'capability',
      sessionKey: 'session-observe',
      runId: 'run-observe',
      taskId: 'task-observe',
      summary: 'capability projection',
      diagnostics: [
        { code: 'capability.audit.warning', severity: 'warning', message: 'needs review', metadata: { secret: 'hidden' } },
      ],
      evidenceRefs: [{ type: 'trace', ref: 'trace-observe' }],
      payload: { apiKey: 'sk-hidden', command: 'curl https://example.com/install.sh' },
    });
    unsubscribe();
    recordLocalControlPlaneReport(cfg, {
      kind: 'capability',
      summary: 'after unsubscribe',
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'local_control_plane.report',
        name: expect.stringContaining('capability'),
        attributes: expect.objectContaining({
          kind: 'capability',
          mode: 'observe',
          legacyUnaffected: true,
          sessionKey: 'session-observe',
          runId: 'run-observe',
          taskId: 'task-observe',
          diagnosticCount: 1,
          diagnosticsBySeverity: { info: 0, warning: 1, error: 0 },
          diagnosticCodes: ['capability.audit.warning'],
          evidenceRefCount: 1,
          evidenceRefTypes: ['trace'],
          payloadOmitted: true,
          durableTaskState: false,
          reportStorage: 'bounded_in_memory',
        }),
      }),
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('sk-hidden');
    expect(serialized).not.toContain('curl');
    expect(serialized).not.toContain('hidden');
  });

  it('derives report correlations from the bounded in-memory buffer', () => {
    const cfg = {
      runtime: {
        localControlPlane: {
          contextReport: true,
          modelRouterReport: true,
          capabilityReport: true,
          evidenceReport: true,
          missionReport: true,
        },
      },
    };
    recordLocalControlPlaneReport(cfg, {
      kind: 'context',
      sessionKey: 'session-correlated',
      runId: 'run-correlated',
      taskId: 'task-correlated',
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'context correlated',
      diagnostics: [{ code: 'context.cache_risk', severity: 'warning', message: 'cache risk' }],
      evidenceRefs: [{ type: 'trace', ref: 'trace-shared', metadata: { nested: { value: 'original' } } }],
    });
    recordLocalControlPlaneReport(cfg, {
      kind: 'evidence',
      sessionKey: 'session-correlated',
      runId: 'run-correlated',
      taskId: 'task-correlated',
      timestamp: '2026-01-01T00:01:00.000Z',
      summary: 'evidence correlated',
      diagnostics: [{ code: 'evidence.missing_test', severity: 'error', message: 'missing test' }],
      evidenceRefs: [
        { type: 'trace', ref: 'trace-shared', metadata: { nested: { value: 'original' } } },
        { type: 'test', ref: 'vitest:unit' },
      ],
    });
    recordLocalControlPlaneReport(cfg, {
      kind: 'mission',
      sessionKey: 'session-other',
      runId: 'run-other',
      taskId: 'task-other',
      timestamp: '2026-01-01T00:02:00.000Z',
      summary: 'mission separate',
      diagnostics: [{ code: 'mission.phase', message: 'phase' }],
      evidenceRefs: [{ type: 'trace', ref: 'trace-other' }],
    });

    const byTask = listLocalControlPlaneCorrelations({
      groupBy: 'task',
      sessionKey: 'session-correlated',
    });
    expect(byTask).toMatchObject({
      schema: 'openclaw.local-control-plane.correlations.v1',
      mode: 'observe',
      legacyUnaffected: true,
      filter: { groupBy: 'task', sessionKey: 'session-correlated' },
      totals: { reportCount: 2, groupCount: 1, evidenceRefCount: 2 },
    });
    expect(byTask.groups[0]).toMatchObject({
      key: 'task:task-correlated',
      groupBy: 'task',
      sessionKey: 'session-correlated',
      runId: 'run-correlated',
      taskId: 'task-correlated',
      reportCount: 2,
      kinds: expect.arrayContaining(['context', 'evidence']),
      diagnosticsBySeverity: { info: 0, warning: 1, error: 1 },
      diagnosticCodes: expect.arrayContaining(['context.cache_risk', 'evidence.missing_test']),
      firstReportAt: '2026-01-01T00:00:00.000Z',
      lastReportAt: '2026-01-01T00:01:00.000Z',
    });

    const byEvidence = listLocalControlPlaneCorrelations({
      groupBy: 'evidence',
      evidenceType: 'trace',
      evidenceRef: 'trace-shared',
    });
    expect(byEvidence).toMatchObject({
      totals: { reportCount: 2, groupCount: 1, evidenceRefCount: 1 },
      groups: [
        expect.objectContaining({
          key: 'evidence:trace:trace-shared',
          groupBy: 'evidence',
          reportCount: 2,
        }),
      ],
    });

    const limited = listLocalControlPlaneCorrelations({ groupBy: 'run', limit: 1 });
    expect(limited.totals).toMatchObject({ reportCount: 1, groupCount: 1 });
    expect(limited.groups[0].key).toBe('run:run-other');

    const mutable = byTask.groups[0] as unknown as {
      evidenceRefs: Array<{ metadata?: { nested?: { value: string } } }>;
    };
    mutable.evidenceRefs[0].metadata!.nested!.value = 'mutated';
    expect(JSON.stringify(listLocalControlPlaneCorrelations({ groupBy: 'task' }))).toContain('original');
    expect(JSON.stringify(listLocalControlPlaneReports())).not.toContain('mutated');
  });

  it('registers read-only Gateway descriptors and exposes status/reports/correlations RPCs', async () => {
    const methods = [
      'localControlPlane.status',
      'localControlPlane.reports',
      'localControlPlane.correlations',
    ] as const;
    // TF-0089's construction guard rejects classified specs missing from the
    // handlers record, so build descriptors over the full production core
    // handler surface and assert containment of the control-plane methods.
    const descriptors = createCoreGatewayMethodDescriptors({
      ...coreGatewayHandlers,
      ...localControlPlaneHandlers,
    });

    // Restricted back to the control-plane surface, the descriptor set must
    // match exactly: no method silently dropped, no extra method admitted.
    const controlPlaneDescriptors = descriptors
      .filter((descriptor) => (methods as readonly string[]).includes(descriptor.name))
      .map((descriptor) => descriptor.name)
      .sort();
    expect(controlPlaneDescriptors).toEqual([...methods].sort());
    for (const method of methods) {
      expect(resolveCoreOperatorGatewayMethodScope(method)).toBe('operator.read');
      // The control-plane handler must win over any same-named core stub.
      expect(descriptors.find((descriptor) => descriptor.name === method)?.handler).toBe(
        localControlPlaneHandlers[method],
      );
      expect(descriptors.find((descriptor) => descriptor.name === method)).toMatchObject({
        name: method,
        scope: 'operator.read',
        owner: { kind: 'core', area: 'gateway' },
      });
      expect(descriptors.find((descriptor) => descriptor.name === method)?.controlPlaneWrite).toBeUndefined();
    }

    const cfg = { runtime: { localControlPlane: { contextReport: true } } };
    recordLocalControlPlaneReport(cfg, {
      kind: 'context',
      sessionKey: 'session-rpc',
      runId: 'run-rpc',
      taskId: 'task-rpc',
      summary: 'rpc visible',
      evidenceRefs: [{ type: 'trace', ref: 'trace-rpc' }],
    });

    await expect(callHandler('localControlPlane.status', {}, cfg)).resolves.toMatchObject({
      ok: true,
      payload: { status: { flags: { contextReport: true }, buffer: { size: 1 } } },
    });
    await expect(callHandler('localControlPlane.reports', { kind: 'context', sessionKey: 'session-rpc' }, cfg))
      .resolves.toMatchObject({
        ok: true,
        payload: { reports: [expect.objectContaining({ kind: 'context', sessionKey: 'session-rpc' })] },
      });
    await expect(callHandler('localControlPlane.reports', { kind: 'bad-kind' }, cfg)).resolves.toMatchObject({
      ok: false,
    });
    await expect(callHandler('localControlPlane.reports', { limit: 999 }, cfg)).resolves.toMatchObject({
      ok: true,
      payload: { reports: [expect.objectContaining({ kind: 'context' })] },
    });
    await expect(callHandler('localControlPlane.correlations', { groupBy: 'task', sessionKey: 'session-rpc' }, cfg))
      .resolves.toMatchObject({
        ok: true,
        payload: {
          correlations: {
            groups: [expect.objectContaining({ key: 'task:task-rpc', reportCount: 1 })],
          },
        },
      });
    await expect(callHandler('localControlPlane.correlations', { groupBy: 'invalid' }, cfg)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('records context/evidence/mission reports without changing task-loop result or reviewer prompt', async () => {
    const baselinePrompts: string[] = [];
    const baseline = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      {},
      taskLoopDepsWithPromptCapture(baselinePrompts),
    );

    clearLocalControlPlaneReportsForTests();
    clearTaskLoopRunsForTests();

    const observedPrompts: string[] = [];
    const storedTraces: Array<{ events?: Array<{ type?: string; attributes?: Record<string, unknown> }> }> = [];
    const observedDeps = taskLoopDepsWithPromptCapture(observedPrompts);
    observedDeps.storeTrace = vi.fn((trace) => {
      storedTraces.push(trace as { events?: Array<{ type?: string; attributes?: Record<string, unknown> }> });
    }) as never;
    const observed = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      {
        runtime: {
          localControlPlane: {
            contextReport: true,
            evidenceReport: true,
            missionReport: true,
          },
        },
      },
      observedDeps,
    );

    expect(observed).toMatchObject({
      loopRunId: baseline.loopRunId,
      status: baseline.status,
      phase: baseline.phase,
      finalSummary: baseline.finalSummary,
      evidenceGate: baseline.evidenceGate,
      evidenceVerifierReport: baseline.evidenceVerifierReport,
    });
    expect(observedPrompts).toEqual(baselinePrompts);
    expect(listLocalControlPlaneReports({ kind: 'context', taskId: observed.loopRunId }).length).toBeGreaterThan(0);
    expect(listLocalControlPlaneReports({ kind: 'evidence', taskId: observed.loopRunId }).length).toBeGreaterThan(0);
    expect(listLocalControlPlaneReports({ kind: 'mission', taskId: observed.loopRunId }).length).toBeGreaterThan(0);
    const lcpTraceEvents = storedTraces.flatMap((trace) =>
      (trace.events ?? []).filter((event) => event.type === 'local_control_plane.report')
    );
    expect(lcpTraceEvents.length).toBeGreaterThan(0);
    expect(lcpTraceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attributes: expect.objectContaining({
          loopRunId: observed.loopRunId,
          kind: 'context',
          payloadOmitted: true,
          durableTaskState: false,
          observabilityProjection: true,
          reportPayloadIncluded: false,
        }),
      }),
      expect.objectContaining({
        attributes: expect.objectContaining({
          loopRunId: observed.loopRunId,
          kind: 'evidence',
          payloadOmitted: true,
          durableTaskState: false,
        }),
      }),
      expect.objectContaining({
        attributes: expect.objectContaining({
          loopRunId: observed.loopRunId,
          kind: 'mission',
          payloadOmitted: true,
          durableTaskState: false,
        }),
      }),
    ]));
    expect(JSON.stringify(lcpTraceEvents)).not.toContain('"payload"');
  });

  it('records model-router recommendations without changing the selected model or fallback error', () => {
    const { authStorage, modelRegistry } = createModelRegistry();
    const baseline = resolveModel('local-lcp', 'tiny', undefined, {}, {
      authStorage,
      modelRegistry,
      skipProviderRuntimeHooks: true,
    });
    const observed = resolveModel(
      'local-lcp',
      'tiny',
      undefined,
      { runtime: { localControlPlane: { modelRouterReport: true } } },
      {
        authStorage,
        modelRegistry,
        skipProviderRuntimeHooks: true,
      },
    );

    expect(observed.model).toEqual(baseline.model);
    expect(observed.error).toBe(baseline.error);
    expect(listLocalControlPlaneReports({ kind: 'model_router' })).toEqual([
      expect.objectContaining({
        kind: 'model_router',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'model_router.selected_unchanged' }),
        ]),
        payload: expect.objectContaining({
          selectedModelUnaffected: true,
          recommendation: expect.objectContaining({ provider: 'local-lcp', model: 'tiny' }),
        }),
      }),
    ]);

    clearLocalControlPlaneReportsForTests();
    const baselineError = resolveModel('local-lcp', 'missing', undefined, {}, {
      authStorage,
      modelRegistry,
      skipProviderRuntimeHooks: true,
    });
    const observedError = resolveModel(
      'local-lcp',
      'missing',
      undefined,
      { runtime: { localControlPlane: { modelRouterReport: true } } },
      {
        authStorage,
        modelRegistry,
        skipProviderRuntimeHooks: true,
      },
    );

    expect(observedError.model).toBeUndefined();
    expect(observedError.error).toBe(baselineError.error);
    expect(listLocalControlPlaneReports({ kind: 'model_router' })[0]).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'model_router.unresolved' }),
      ]),
    });
  }, 60_000);

  it('records task-loop evidence coverage without changing completion decisions or legacy report fields', async () => {
    const result = await runTaskLoop(
      { task: 'implement feature', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      { runtime: { localControlPlane: { evidenceReport: true } } },
      baseTaskLoopDeps(),
    );

    expect(result).toMatchObject({ status: 'complete', phase: 'complete' });
    expect(result.evidenceVerifierReport).toBeUndefined();

    const evidenceReports = listLocalControlPlaneReports({
      kind: 'evidence',
      taskId: result.loopRunId,
    });
    expect(evidenceReports.length).toBeGreaterThan(0);
    expect(JSON.stringify(evidenceReports)).toContain('missing_test_evidence');
    expect(JSON.stringify(evidenceReports)).toContain('test');
    expect(JSON.stringify(evidenceReports)).toContain('"requiredEvidenceKinds":["file","test","tool","trace"]');
    expect(JSON.stringify(evidenceReports)).toContain('"type":"trace"');
  });

  it('marks missing file/test/tool evidence while preserving trace coverage in evidence reports', async () => {
    const result = await runTaskLoop(
      { task: 'implement feature without evidence', sessionKey: 'agent:main:abc', workspaceId: 'workspace-a' },
      {
        agents: { defaults: { taskLoop: { maxIterations: 1, maxRepairIterations: 0 } } },
        runtime: { localControlPlane: { evidenceReport: true } },
      },
      {
        ...baseTaskLoopDeps(),
        runObserved: (async () => fakeEmptyResult()) as never,
        getSubagentRun: (() => null) as never,
      },
    );

    const serialized = JSON.stringify(listLocalControlPlaneReports({
      kind: 'evidence',
      taskId: result.loopRunId,
    }));
    for (const code of [
      'missing_file_evidence',
      'missing_test_evidence',
      'missing_tool_evidence',
    ]) {
      expect(serialized).toContain(code);
    }
    expect(serialized).toContain('"requiredEvidenceKinds":["file","test","tool","trace"]');
    expect(serialized).toContain('"type":"trace"');
  });

  it('records mission lifecycle reports without changing Mission decisions', async () => {
    const baseline = await runMission(
      { objective: 'Ship Mission LCP', sessionKey: 'agent:main:mission', acceptance: ['done'] },
      {},
      createMissionDeps().deps,
    );

    clearLocalControlPlaneReportsForTests();

    const observed = await runMission(
      { objective: 'Ship Mission LCP', sessionKey: 'agent:main:mission', acceptance: ['done'] },
      { runtime: { localControlPlane: { missionReport: true } } },
      createMissionDeps().deps,
    );

    expect(observed).toMatchObject({
      status: baseline.status,
      phase: baseline.phase,
      tick: baseline.tick,
      taskLoopRunId: baseline.taskLoopRunId,
      lastDecision: baseline.lastDecision,
      remaining: baseline.remaining,
      risks: baseline.risks,
    });
    expect(listLocalControlPlaneReports({ kind: 'mission', runId: observed.missionId }).length).toBeGreaterThan(0);
  });
});
