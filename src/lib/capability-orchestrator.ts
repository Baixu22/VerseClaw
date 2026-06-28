import { hostApi } from '@/lib/host-api';
import { isCapabilityAuditBlocked } from '@/lib/capability-audit';
import type {
  CapabilityOrchestrationStep,
  CapabilityOrchestrationStepStatus,
  CapabilityOrchestrationSummary,
  ChatCapabilityActionPlan,
  ChatCapabilityActionResult,
  LocalControlPlaneReport,
} from '@shared/host-api/contract';
import type { ObservabilitySpan, ObservabilityTokenUsage, ObservabilityTrace, ObservabilityTraceEvent } from '@shared/types/observability';

export type CapabilityActionHostApi = {
  skills: Pick<typeof hostApi.skills, 'local' | 'updateConfigs'>;
  mcp: Pick<typeof hostApi.mcp, 'listServers' | 'createServer' | 'testServer' | 'heartbeat' | 'listTools' | 'reloadRuntime'>;
  observability?: Pick<typeof hostApi.observability, 'reportTrace'>;
};

export type CapabilityActionExecutionContext = {
  workspaceId?: string | null;
  agentId?: string | null;
  confirmation?: {
    required?: boolean;
    confirmed?: boolean;
    source?: string;
    approvalId?: string;
  };
};

type RegisteredServer = {
  resultIndex: number;
  action: ChatCapabilityActionPlan;
  serverId: string;
  steps: CapabilityOrchestrationStep[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyTokenUsage(): ObservabilityTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function step(
  actionId: string,
  stage: CapabilityOrchestrationStep['stage'],
  status: CapabilityOrchestrationStepStatus,
  message?: string,
  details?: CapabilityOrchestrationStep['details'],
  error?: string,
): CapabilityOrchestrationStep {
  return {
    id: `${actionId}:${stage}`,
    actionId,
    stage,
    status,
    message,
    details,
    error,
    completedAt: nowIso(),
  };
}

function summaryStatus(steps: CapabilityOrchestrationStep[]): CapabilityOrchestrationSummary['status'] {
  if (steps.some((entry) => entry.status === 'blocked')) return 'blocked';
  if (steps.some((entry) => entry.status === 'failed')) return 'failed';
  if (steps.some((entry) => entry.status === 'warning')) return 'partial';
  return 'success';
}

function buildSummary(
  steps: CapabilityOrchestrationStep[],
  extras: Omit<CapabilityOrchestrationSummary, 'status' | 'steps'> = {},
): CapabilityOrchestrationSummary {
  return {
    status: summaryStatus(steps),
    steps,
    ...extras,
  };
}

function parseStepTime(stepEntry: CapabilityOrchestrationStep, fallback: number): number {
  const parsed = Date.parse(stepEntry.completedAt);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-z0-9_.:-]+/giu, '-').slice(0, 80) || 'capability';
}

function completedAtForResult(result: ChatCapabilityActionResult, fallback: number): string {
  const steps = result.orchestration?.steps ?? [];
  const latest = steps.length > 0
    ? Math.max(...steps.map((entry) => parseStepTime(entry, fallback)))
    : fallback;
  return new Date(latest).toISOString();
}

function diagnosticSeverityForResult(result: ChatCapabilityActionResult): 'info' | 'warning' | 'error' {
  if (!result.success || result.orchestration?.status === 'failed' || result.orchestration?.status === 'blocked') {
    return 'error';
  }
  if (result.auditResult?.status === 'warning' || result.orchestration?.status === 'partial') {
    return 'warning';
  }
  return 'info';
}

function compactAuditResult(result: ChatCapabilityActionResult) {
  const audit = result.auditResult;
  if (!audit) return undefined;
  return {
    status: audit.status,
    summary: audit.summary,
    auditedAt: audit.auditedAt,
    source: audit.source ?? null,
    findings: audit.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
    })),
  };
}

function buildCapabilityActionReportProjection(params: {
  traceId: string;
  action?: ChatCapabilityActionPlan;
  result: ChatCapabilityActionResult;
  context: CapabilityActionExecutionContext;
  completedAtMs: number;
}): LocalControlPlaneReport {
  const { traceId, action, result, context, completedAtMs } = params;
  const target = result.targetName ?? result.skillId ?? result.serverId ?? action?.targetName ?? action?.skillId ?? action?.serverId ?? result.id;
  const severity = diagnosticSeverityForResult(result);
  const audit = compactAuditResult(result);
  return {
    schema: 'openclaw.local-control-plane.report.v1',
    id: `lcp_capability_${safeIdPart(traceId)}_${safeIdPart(result.id)}`,
    kind: 'capability',
    mode: 'observe',
    legacyUnaffected: true,
    timestamp: completedAtForResult(result, completedAtMs),
    runId: traceId,
    taskId: result.id,
    summary: `Chat capability action ${result.kind} ${result.success ? 'succeeded' : 'failed'} for ${target}.`,
    diagnostics: [
      {
        code: `capability.chat_action.${result.kind.replace('.', '_')}`,
        severity,
        message: result.error ?? result.message ?? `Chat capability action ${result.kind} completed.`,
        metadata: {
          actionId: result.id,
          actionKind: result.kind,
          auditStatus: result.auditResult?.status ?? 'unknown',
          orchestrationStatus: result.orchestration?.status ?? 'unknown',
          confirmationRequired: context.confirmation?.required ?? null,
          confirmationConfirmed: context.confirmation?.confirmed ?? null,
        },
      },
    ],
    evidenceRefs: [
      { type: 'trace', ref: traceId, summary: 'Capability management trace' },
      ...(result.serverId ? [{ type: 'tool' as const, ref: result.serverId, summary: 'MCP server capability target' }] : []),
      ...(result.skillId ? [{ type: 'file' as const, ref: result.skillId, summary: 'Skill capability target' }] : []),
    ],
    payload: {
      source: 'chat.capability.action',
      observeOnlyProjection: true,
      reportDoesNotDriveCapabilityState: true,
      action: {
        id: result.id,
        kind: result.kind,
        targetName: result.targetName ?? null,
        skillId: result.skillId ?? action?.skillId ?? null,
        serverId: result.serverId ?? action?.serverId ?? null,
        risk: action?.risk ?? null,
      },
      result: {
        success: result.success,
        skipped: result.skipped ?? false,
        orchestrationStatus: result.orchestration?.status ?? null,
        verified: result.orchestration?.verified ?? null,
        reloaded: result.orchestration?.reloaded ?? null,
        heartbeatStatus: result.orchestration?.heartbeatStatus ?? null,
        toolNames: result.toolNames ?? result.orchestration?.toolNames ?? [],
      },
      audit: audit ?? null,
      confirmation: context.confirmation
        ? {
            required: context.confirmation.required ?? null,
            confirmed: context.confirmation.confirmed ?? null,
            source: context.confirmation.source ?? null,
            approvalId: context.confirmation.approvalId ?? null,
          }
        : {
            required: null,
            confirmed: null,
            source: 'caller-owned',
            approvalId: null,
          },
    },
  };
}

function makeTraceId(results: ChatCapabilityActionResult[]): string {
  const seed = results.map((result) => `${result.kind}:${result.targetName ?? result.skillId ?? result.serverId ?? result.id}`).join('|');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(31, hash) + seed.charCodeAt(index) | 0;
  }
  return `trace_capability_${Date.now().toString(36)}_${Math.abs(hash).toString(36)}`;
}

function statusForResult(result: ChatCapabilityActionResult): ObservabilityTrace['status'] {
  if (result.orchestration?.status === 'blocked') return 'aborted';
  return result.success ? 'completed' : 'error';
}

function buildCapabilityTrace(
  traceId: string,
  actions: ChatCapabilityActionPlan[],
  results: ChatCapabilityActionResult[],
  context: CapabilityActionExecutionContext,
): ObservabilityTrace {
  const now = Date.now();
  const allSteps = results.flatMap((result) => result.orchestration?.steps ?? []);
  const startedAt = allSteps.length > 0
    ? Math.min(...allSteps.map((entry) => parseStepTime(entry, now)))
    : now;
  const endedAt = Math.max(now, ...allSteps.map((entry) => parseStepTime(entry, now)));
  const status = results.some((result) => result.orchestration?.status === 'blocked')
    ? 'aborted'
    : results.some((result) => !result.success && result.id !== 'mcp.register:reload')
      ? 'error'
      : 'completed';
  const rootSpanId = `${traceId}:root`;
  const actionSpans: ObservabilitySpan[] = results
    .filter((result) => result.id !== 'mcp.register:reload')
    .map((result) => {
      const steps = result.orchestration?.steps ?? [];
      const spanStartedAt = steps.length > 0 ? Math.min(...steps.map((entry) => parseStepTime(entry, startedAt))) : startedAt;
      const spanEndedAt = steps.length > 0 ? Math.max(...steps.map((entry) => parseStepTime(entry, endedAt))) : endedAt;
      return {
        id: `${traceId}:action:${safeIdPart(result.id)}`,
        traceId,
        parentSpanId: rootSpanId,
        name: result.targetName ? `${result.kind}: ${result.targetName}` : result.kind,
        kind: 'tool',
        status: statusForResult(result),
        startedAt: spanStartedAt,
        endedAt: spanEndedAt,
        durationMs: Math.max(0, spanEndedAt - spanStartedAt),
        input: result.targetName ?? result.skillId ?? result.serverId,
        output: result.message,
        error: result.error,
        attributes: {
          actionId: result.id,
          kind: result.kind,
          targetName: result.targetName,
          skillId: result.skillId,
          serverId: result.serverId,
          auditStatus: result.auditResult?.status,
          orchestrationStatus: result.orchestration?.status,
          toolNames: result.toolNames,
        },
      };
    });
  const events: ObservabilityTraceEvent[] = results.flatMap((result) => (
    (result.orchestration?.steps ?? []).map((entry) => ({
      id: `${traceId}:event:${safeIdPart(entry.id)}`,
      traceId,
      spanId: result.id === 'mcp.register:reload'
        ? rootSpanId
        : `${traceId}:action:${safeIdPart(result.id)}`,
      type: `capability.${entry.stage}.${entry.status}`,
      name: entry.message || entry.error || entry.stage,
      timestamp: parseStepTime(entry, endedAt),
      attributes: {
        actionId: entry.actionId,
        stage: entry.stage,
        status: entry.status,
        error: entry.error,
        ...entry.details,
      },
    }))
  ));
  const reports = results
    .filter((result) => result.id !== 'mcp.register:reload')
    .map((result) => buildCapabilityActionReportProjection({
      traceId,
      action: actions.find((action) => action.id === result.id),
      result,
      context,
      completedAtMs: endedAt,
    }));
  const reportEvents: ObservabilityTraceEvent[] = reports.map((report) => ({
    id: `${traceId}:event:lcp:${safeIdPart(report.id)}`,
    traceId,
    spanId: rootSpanId,
    type: 'localControlPlane.capability.report.projected',
    name: report.summary,
    timestamp: Date.parse(report.timestamp),
    attributes: {
      report,
      reportId: report.id,
      reportKind: report.kind,
      observeOnlyProjection: true,
    },
  }));
  const rootSpan: ObservabilitySpan = {
    id: rootSpanId,
    traceId,
    name: 'Chat capability management',
    kind: 'orchestrator',
    status,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    attributes: {
      workspaceId: context.workspaceId,
      agentId: context.agentId,
      actionCount: actions.length,
      successfulActionCount: results.filter((result) => result.success && result.id !== 'mcp.register:reload').length,
      blockedActionCount: results.filter((result) => result.orchestration?.status === 'blocked').length,
      localControlPlaneReportCount: reports.length,
      localControlPlaneReports: reports,
    },
    error: status === 'error' || status === 'aborted'
      ? results.find((result) => result.error)?.error
      : undefined,
  };

  return {
    id: traceId,
    name: 'Capability management',
    runId: traceId,
    task: 'Chat-driven Skill/MCP capability management',
    mode: 'capability-management',
    status,
    startedAt,
    endedAt,
    updatedAt: endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    spans: [rootSpan, ...actionSpans],
    events: [...events, ...reportEvents],
    tokenUsage: emptyTokenUsage(),
    metrics: {
      actions: actions.length,
      successes: results.filter((result) => result.success && result.id !== 'mcp.register:reload').length,
      failures: results.filter((result) => !result.success && result.id !== 'mcp.register:reload').length,
      warnings: results.filter((result) => result.auditResult?.status === 'warning').length,
      blocked: results.filter((result) => result.orchestration?.status === 'blocked').length,
    },
    tags: ['capability-management', 'skill-mcp', 'chat-driven'],
    error: status === 'error' || status === 'aborted'
      ? results.find((result) => result.error)?.error
      : undefined,
  };
}

async function reportCapabilityTrace(
  actions: ChatCapabilityActionPlan[],
  results: ChatCapabilityActionResult[],
  context: CapabilityActionExecutionContext,
  api: CapabilityActionHostApi,
): Promise<void> {
  if (actions.length === 0 || results.length === 0) return;
  const traceId = makeTraceId(results);
  for (const result of results) {
    if (result.orchestration) {
      result.orchestration.traceId = traceId;
    }
  }
  if (!api.observability?.reportTrace) return;
  try {
    await api.observability.reportTrace(buildCapabilityTrace(traceId, actions, results, context));
  } catch {
    // Trace capture must never make capability management fail.
  }
}

function auditStep(action: ChatCapabilityActionPlan): CapabilityOrchestrationStep {
  const auditStatus = action.auditResult?.status ?? 'unknown';
  if (auditStatus === 'blocked') {
    return step(action.id, 'audit', 'blocked', action.auditResult?.summary, { auditStatus });
  }
  if (auditStatus === 'warning' || auditStatus === 'unknown') {
    return step(action.id, 'audit', 'warning', action.auditResult?.summary ?? 'Audit status needs review', { auditStatus });
  }
  return step(action.id, 'audit', 'success', action.auditResult?.summary ?? 'Audit passed', { auditStatus });
}

function blockedResult(
  action: ChatCapabilityActionPlan,
  message: string,
  steps: CapabilityOrchestrationStep[],
): ChatCapabilityActionResult {
  return {
    id: action.id,
    kind: action.kind,
    success: false,
    targetName: action.targetName,
    skillId: action.skillId,
    serverId: action.serverId,
    auditResult: action.auditResult,
    orchestration: buildSummary(steps),
    error: message,
  };
}

async function executeSkillEnable(
  action: ChatCapabilityActionPlan,
  api: CapabilityActionHostApi,
): Promise<ChatCapabilityActionResult> {
  const steps = [auditStep(action)];
  if (!action.skillId) throw new Error('Missing skill id');
  if (isCapabilityAuditBlocked(action.auditResult)) {
    return blockedResult(action, 'Capability audit blocked this skill action', steps);
  }

  if (action.skillAlreadyEnabled) {
    steps.push(step(action.id, 'enable', 'skipped', 'Skill was already enabled'));
    return {
      id: action.id,
      kind: action.kind,
      success: true,
      skipped: true,
      skillId: action.skillId,
      targetName: action.targetName,
      auditResult: action.auditResult,
      orchestration: buildSummary(steps, { verified: true }),
      message: 'Skill was already enabled',
    };
  }

  const result = await api.skills.updateConfigs([{ skillKey: action.skillId, enabled: true }]);
  const success = result.success !== false;
  steps.push(step(
    action.id,
    'enable',
    success ? 'success' : 'failed',
    success ? 'Skill enabled' : undefined,
    undefined,
    success ? undefined : result.error || 'Failed to enable skill',
  ));

  return {
    id: action.id,
    kind: action.kind,
    success,
    skillId: action.skillId,
    targetName: action.targetName,
    auditResult: action.auditResult,
    orchestration: buildSummary(steps, { verified: success }),
    message: success ? 'Skill enabled' : undefined,
    error: success ? undefined : result.error || 'Failed to enable skill',
  };
}

async function executeMcpRegister(
  action: ChatCapabilityActionPlan,
  api: CapabilityActionHostApi,
): Promise<{ result: ChatCapabilityActionResult; registered?: RegisteredServer }> {
  const steps = [auditStep(action)];
  if (!action.mcpServer) throw new Error('Missing MCP server config');
  if (isCapabilityAuditBlocked(action.auditResult)) {
    return {
      result: blockedResult(action, 'Capability audit blocked this MCP registration', steps),
    };
  }

  const created = await api.mcp.createServer(action.mcpServer);
  const server = created.servers?.find((entry) => entry.name === action.mcpServer?.name)
    ?? created.servers?.find((entry) => entry.id !== 'clawx-git');
  const serverId = server?.id;
  const registerSuccess = created.success !== false && Boolean(serverId);
  steps.push(step(
    action.id,
    'register',
    registerSuccess ? 'success' : 'failed',
    registerSuccess ? 'MCP server registered' : undefined,
    serverId ? { serverId } : undefined,
    registerSuccess ? undefined : created.error || 'Failed to register MCP server',
  ));

  let structureMessage: string | undefined;
  let structureSuccess = false;
  if (serverId) {
    const tested = await api.mcp.testServer({ id: serverId });
    structureMessage = tested.message || tested.error;
    structureSuccess = tested.success !== false;
    steps.push(step(
      action.id,
      'structureCheck',
      structureSuccess ? 'success' : 'failed',
      tested.message,
      { serverId },
      structureSuccess ? undefined : tested.error || 'MCP structure check failed',
    ));
  }

  const success = registerSuccess && structureSuccess;
  const result: ChatCapabilityActionResult = {
    id: action.id,
    kind: action.kind,
    success,
    serverId,
    targetName: action.targetName,
    auditResult: action.auditResult,
    orchestration: buildSummary(steps, { verified: success }),
    message: structureMessage || (success ? 'MCP server registered' : undefined),
    error: success ? undefined : created.error || structureMessage || 'MCP registration validation failed',
  };

  return {
    result,
    registered: success && serverId ? { resultIndex: -1, action, serverId, steps } : undefined,
  };
}

async function executeManagementAction(
  action: ChatCapabilityActionPlan,
  context: CapabilityActionExecutionContext,
  api: CapabilityActionHostApi,
): Promise<ChatCapabilityActionResult> {
  if (action.kind === 'mcp.reload') {
    const reloaded = await api.mcp.reloadRuntime(context);
    const success = reloaded.success !== false;
    const steps = [step(
      action.id,
      'runtimeReload',
      success ? 'success' : 'failed',
      reloaded.message,
      { serverCount: reloaded.serverCount, hotReloaded: reloaded.hotReloaded, restartRequired: reloaded.restartRequired },
      success ? undefined : reloaded.error || 'Failed to reload MCP runtime',
    )];
    return {
      id: action.id,
      kind: action.kind,
      success,
      serverCount: reloaded.serverCount,
      hotReloaded: reloaded.hotReloaded,
      restartRequired: reloaded.restartRequired,
      message: reloaded.message,
      error: success ? undefined : reloaded.error || 'Failed to reload MCP runtime',
      orchestration: buildSummary(steps, { reloaded: success }),
    };
  }

  if (action.kind === 'mcp.heartbeat') {
    if (!action.serverId) throw new Error('Missing MCP server id');
    const heartbeat = await api.mcp.heartbeat({ serverId: action.serverId });
    const success = heartbeat.success !== false;
    const steps = [step(
      action.id,
      'heartbeat',
      success ? 'success' : 'failed',
      heartbeat.message,
      { status: heartbeat.status, latencyMs: heartbeat.latencyMs },
      success ? undefined : heartbeat.error || 'MCP heartbeat failed',
    )];
    return {
      id: action.id,
      kind: action.kind,
      success,
      serverId: action.serverId,
      targetName: action.targetName,
      message: heartbeat.message,
      error: success ? undefined : heartbeat.error || 'MCP heartbeat failed',
      details: { status: heartbeat.status, latencyMs: heartbeat.latencyMs },
      orchestration: buildSummary(steps, { verified: success, heartbeatStatus: heartbeat.status }),
    };
  }

  if (action.kind === 'mcp.listTools') {
    if (!action.serverId) throw new Error('Missing MCP server id');
    const tools = await api.mcp.listTools({ serverId: action.serverId });
    const success = tools.success !== false;
    const toolNames = tools.tools.map((tool) => tool.name);
    const steps = [step(
      action.id,
      'listTools',
      success ? 'success' : 'failed',
      tools.message,
      { status: tools.status, toolCount: toolNames.length },
      success ? undefined : tools.error || 'Failed to list MCP tools',
    )];
    return {
      id: action.id,
      kind: action.kind,
      success,
      serverId: action.serverId,
      targetName: action.targetName,
      toolNames,
      message: tools.message,
      error: success ? undefined : tools.error || 'Failed to list MCP tools',
      details: { status: tools.status },
      orchestration: buildSummary(steps, { verified: success, toolNames }),
    };
  }

  throw new Error(`Unsupported capability action: ${action.kind}`);
}

async function verifyRegisteredServer(
  registered: RegisteredServer,
  api: CapabilityActionHostApi,
): Promise<{ success: boolean; toolNames?: string[]; heartbeatStatus?: string }> {
  const heartbeat = await api.mcp.heartbeat({ serverId: registered.serverId });
  const heartbeatSuccess = heartbeat.success !== false;
  registered.steps.push(step(
    registered.action.id,
    'heartbeat',
    heartbeatSuccess ? 'success' : 'failed',
    heartbeat.message,
    { status: heartbeat.status, latencyMs: heartbeat.latencyMs },
    heartbeatSuccess ? undefined : heartbeat.error || 'MCP heartbeat failed',
  ));

  const tools = await api.mcp.listTools({ serverId: registered.serverId });
  const listToolsSuccess = tools.success !== false;
  const toolNames = tools.tools.map((tool) => tool.name);
  registered.steps.push(step(
    registered.action.id,
    'listTools',
    listToolsSuccess ? 'success' : 'failed',
    tools.message,
    { status: tools.status, toolCount: toolNames.length },
    listToolsSuccess ? undefined : tools.error || 'Failed to list MCP tools',
  ));

  return {
    success: heartbeatSuccess && listToolsSuccess,
    toolNames,
    heartbeatStatus: heartbeat.status,
  };
}

export async function executeCapabilityActionPlan(
  actions: ChatCapabilityActionPlan[],
  context: CapabilityActionExecutionContext = {},
  api: CapabilityActionHostApi = hostApi,
): Promise<ChatCapabilityActionResult[]> {
  const results: ChatCapabilityActionResult[] = [];
  const registeredServers: RegisteredServer[] = [];

  for (const action of actions) {
    try {
      if (action.kind === 'skill.enable') {
        results.push(await executeSkillEnable(action, api));
        continue;
      }

      if (action.kind === 'mcp.register') {
        const { result, registered } = await executeMcpRegister(action, api);
        const resultIndex = results.push(result) - 1;
        if (registered) {
          registeredServers.push({ ...registered, resultIndex });
        }
        continue;
      }

      results.push(await executeManagementAction(action, context, api));
    } catch (error) {
      results.push({
        id: action.id,
        kind: action.kind,
        success: false,
        targetName: action.targetName,
        skillId: action.skillId,
        serverId: action.serverId,
        auditResult: action.auditResult,
        error: errorMessage(error),
      });
    }
  }

  if (registeredServers.length > 0) {
    try {
      const reloaded = await api.mcp.reloadRuntime(context);
      const reloadSuccess = reloaded.success !== false;
      const reloadStep = step(
        'mcp.register:reload',
        'runtimeReload',
        reloadSuccess ? 'success' : 'failed',
        reloaded.message,
        { serverCount: reloaded.serverCount, hotReloaded: reloaded.hotReloaded, restartRequired: reloaded.restartRequired },
        reloadSuccess ? undefined : reloaded.error || 'Failed to reload MCP runtime',
      );
      results.push({
        id: 'mcp.register:reload',
        kind: 'mcp.reload',
        success: reloadSuccess,
        serverCount: reloaded.serverCount,
        hotReloaded: reloaded.hotReloaded,
        restartRequired: reloaded.restartRequired,
        message: reloaded.message,
        error: reloadSuccess ? undefined : reloaded.error || 'Failed to reload MCP runtime',
        orchestration: buildSummary([reloadStep], { reloaded: reloadSuccess }),
      });

      for (const registered of registeredServers) {
        registered.steps.push({
          ...reloadStep,
          id: `${registered.action.id}:runtimeReload`,
          actionId: registered.action.id,
        });
        const result = results[registered.resultIndex];
        if (!result) continue;
        if (!reloadSuccess) {
          result.success = false;
          result.error = reloaded.error || 'Failed to reload MCP runtime';
          result.orchestration = buildSummary(registered.steps, { verified: false, reloaded: false });
          continue;
        }

        const verified = await verifyRegisteredServer(registered, api);
        result.success = result.success && verified.success;
        result.toolNames = verified.toolNames;
        result.error = result.success ? undefined : result.error || 'MCP runtime verification failed';
        result.orchestration = buildSummary(registered.steps, {
          verified: verified.success,
          reloaded: true,
          heartbeatStatus: verified.heartbeatStatus,
          toolNames: verified.toolNames,
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      results.push({
        id: 'mcp.register:reload',
        kind: 'mcp.reload',
        success: false,
        error: message,
      });
      for (const registered of registeredServers) {
        const result = results[registered.resultIndex];
        if (!result) continue;
        registered.steps.push(step(registered.action.id, 'runtimeReload', 'failed', undefined, undefined, message));
        result.success = false;
        result.error = message;
        result.orchestration = buildSummary(registered.steps, { verified: false, reloaded: false });
      }
    }
  }

  await reportCapabilityTrace(actions, results, context, api);

  return results;
}
