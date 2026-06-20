import { hostApi } from '@/lib/host-api';
import { isCapabilityAuditBlocked } from '@/lib/capability-audit';
import type {
  CapabilityOrchestrationStep,
  CapabilityOrchestrationStepStatus,
  CapabilityOrchestrationSummary,
  ChatCapabilityActionPlan,
  ChatCapabilityActionResult,
} from '@shared/host-api/contract';

export type CapabilityActionHostApi = {
  skills: Pick<typeof hostApi.skills, 'local' | 'updateConfigs'>;
  mcp: Pick<typeof hostApi.mcp, 'listServers' | 'createServer' | 'testServer' | 'heartbeat' | 'listTools' | 'reloadRuntime'>;
};

export type CapabilityActionExecutionContext = {
  workspaceId?: string | null;
  agentId?: string | null;
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

  return results;
}
