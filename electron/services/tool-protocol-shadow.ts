import type { McpCallToolPayload } from '@shared/host-api/contract';
import type { McpCallToolResult } from '@shared/types/mcp';
import type {
  RuntimeShadowErrorType,
  RuntimeShadowJsonObject,
  RuntimeShadowJsonValue,
  RuntimeShadowToolCallRequest,
  RuntimeShadowToolCallResult,
} from '@shared/types/runtime-tool-shadow';

export type ToolProtocolShadowRuntimeFlags = {
  runtime?: {
    toolProtocol?: {
      mcpShadow?: boolean;
    };
  };
};

type McpToolCallShadowReasonCode =
  | 'success'
  | 'tool/error'
  | 'tool/blocked'
  | 'gateway/unavailable'
  | 'permission/waiting'
  | 'exception';

type McpToolCallBridgeState = 'success' | 'error' | 'blocked' | 'waiting';

type McpToolCallShadowTarget = {
  serverId: string;
  toolName: string;
};

type McpToolCallShadowReason = {
  code: McpToolCallShadowReasonCode;
  message?: string;
  state?: 'waiting';
};

type McpToolCallShadowApproval = {
  required: true;
  state: 'waiting';
  approvalId?: string;
};

export type McpToolCallRequestShadow = {
  kind: 'tool_call.request';
  schemaVersion: 1;
  protocol: 'mcp';
  operation: 'mcp.callTool';
  target: McpToolCallShadowTarget;
  request: RuntimeShadowToolCallRequest;
};

export type McpToolCallResultShadow = {
  kind: 'tool_call.result';
  schemaVersion: 1;
  protocol: 'mcp';
  operation: 'mcp.callTool';
  target: McpToolCallShadowTarget;
  result: RuntimeShadowToolCallResult;
  shadow: {
    status: McpToolCallBridgeState;
    reason: McpToolCallShadowReason;
    approval?: McpToolCallShadowApproval;
  };
};

export type McpToolCallShadowRecord = McpToolCallRequestShadow | McpToolCallResultShadow;

export type ToolProtocolShadowSink = (record: McpToolCallShadowRecord) => void;

export type ToolProtocolShadowEmitterOptions = ToolProtocolShadowRuntimeFlags & {
  toolProtocolShadowSink?: ToolProtocolShadowSink;
};

export type McpToolCallResultShadowOptions = {
  blockedReasonCode?: Extract<McpToolCallShadowReasonCode, 'tool/blocked' | 'gateway/unavailable'>;
};

let nextMcpShadowCallSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createCallId(target: McpToolCallShadowTarget): string {
  nextMcpShadowCallSequence += 1;
  return `mcp:${target.serverId}:${target.toolName}:${nextMcpShadowCallSequence}`;
}

function createTaskId(payload: McpCallToolPayload): string {
  const workspaceId = normalizeOptionalString(payload.workspaceId);
  if (workspaceId) return `workspace:${workspaceId}`;
  const agentId = normalizeOptionalString(payload.agentId);
  if (agentId) return `agent:${agentId}`;
  return `mcp:${payload.serverId}`;
}

function toRuntimeCoreJsonValue(value: unknown, arrayFallback = null): RuntimeShadowJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => (
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? arrayFallback
        : toRuntimeCoreJsonValue(item, arrayFallback)
    ));
  }
  if (isRecord(value)) return toRuntimeCoreJsonObject(value);
  return arrayFallback;
}

function toRuntimeCoreJsonObject(value: Record<string, unknown>): RuntimeShadowJsonObject {
  const output: RuntimeShadowJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
    output[key] = toRuntimeCoreJsonValue(item);
  }
  return output;
}

function toOptionalRuntimeCoreJsonValue(value: unknown): RuntimeShadowJsonValue | undefined {
  return value === undefined ? undefined : toRuntimeCoreJsonValue(value);
}

function readApprovalIdFromRecord(record: Record<string, unknown>): string | undefined {
  const direct = normalizeOptionalString(record.approvalId);
  if (direct) return direct;
  const approval = record.approval;
  if (isRecord(approval)) return normalizeOptionalString(approval.id);
  return undefined;
}

function readApprovalInfo(result: McpCallToolResult): { required: boolean; approvalId?: string } {
  const directRequired = result.approvalRequired === true;
  const directApprovalId = normalizeOptionalString(result.approvalId);
  const nested = isRecord(result.result) ? result.result : undefined;
  const nestedRequired = nested?.approvalRequired === true;
  const nestedApprovalId = nested ? readApprovalIdFromRecord(nested) : undefined;
  return {
    required: directRequired || nestedRequired,
    approvalId: directApprovalId ?? nestedApprovalId,
  };
}

function createBaseResult(
  request: McpToolCallRequestShadow,
  status: RuntimeShadowToolCallResult['status'],
  structuredData?: RuntimeShadowJsonValue,
  error?: RuntimeShadowToolCallResult['error'],
): RuntimeShadowToolCallResult {
  const timestamp = Date.now();
  return {
    callId: request.request.callId,
    status,
    contextItems: [],
    ...(structuredData === undefined ? {} : { structuredData }),
    ...(error ? { error } : {}),
    startedAt: timestamp,
    finishedAt: timestamp,
    evidence: [{ type: 'tool', ref: request.request.callId, label: 'MCP tool call shadow' }],
  };
}

function createRuntimeError(type: RuntimeShadowErrorType, message: string, retryable: boolean): RuntimeShadowToolCallResult['error'] {
  return {
    type,
    message,
    retryable,
    evidenceRefs: [],
  };
}

function createBridgeResult(
  request: McpToolCallRequestShadow,
  result: RuntimeShadowToolCallResult,
  status: McpToolCallBridgeState,
  reason: McpToolCallShadowReason,
  approval?: McpToolCallShadowApproval,
): McpToolCallResultShadow {
  return {
    kind: 'tool_call.result',
    schemaVersion: 1,
    protocol: 'mcp',
    operation: 'mcp.callTool',
    target: { ...request.target },
    result,
    shadow: {
      status,
      reason,
      ...(approval ? { approval } : {}),
    },
  };
}

function createDiagnosticData(
  state: Exclude<McpToolCallBridgeState, 'success'>,
  reason: McpToolCallShadowReason,
  legacyResult?: unknown,
  approval?: McpToolCallShadowApproval,
): RuntimeShadowJsonObject {
  return {
    shadowState: state,
    reasonCode: reason.code,
    ...(reason.message ? { message: reason.message } : {}),
    ...(approval ? { approval: toRuntimeCoreJsonObject(approval) } : {}),
    ...(legacyResult === undefined ? {} : { legacyResult: toRuntimeCoreJsonValue(legacyResult) }),
  };
}

export function isMcpToolProtocolShadowEnabled(options: ToolProtocolShadowRuntimeFlags): boolean {
  return options.runtime?.toolProtocol?.mcpShadow === true;
}

export function emitToolProtocolShadow(
  options: ToolProtocolShadowEmitterOptions,
  record: McpToolCallShadowRecord,
): void {
  if (!isMcpToolProtocolShadowEnabled(options)) return;
  try {
    options.toolProtocolShadowSink?.(record);
  } catch {
    // Shadow emission is observational and must never perturb legacy MCP responses.
  }
}

export function createMcpToolCallRequestShadow(payload: McpCallToolPayload): McpToolCallRequestShadow {
  const target = {
    serverId: payload.serverId,
    toolName: payload.toolName,
  };
  const approvalId = normalizeOptionalString(payload.approvalId);
  const workspaceId = normalizeOptionalString(payload.workspaceId);
  const agentId = normalizeOptionalString(payload.agentId);
  const permissionContext: RuntimeShadowJsonObject = {
    protocol: 'mcp',
    operation: 'mcp.callTool',
    serverId: target.serverId,
    toolName: target.toolName,
    ...(approvalId ? { approvalId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(agentId ? { agentId } : {}),
  };
  const callId = createCallId(target);
  const request: RuntimeShadowToolCallRequest = {
    callId,
    taskId: createTaskId(payload),
    toolName: payload.toolName,
    args: isRecord(payload.args) ? toRuntimeCoreJsonObject(payload.args) : {},
    permissionContext,
    idempotencyKey: callId,
    traceContext: {
      attributes: {
        protocol: 'mcp',
        operation: 'mcp.callTool',
        serverId: target.serverId,
        toolName: target.toolName,
      },
    },
  };

  return {
    kind: 'tool_call.request',
    schemaVersion: 1,
    protocol: 'mcp',
    operation: 'mcp.callTool',
    target,
    request,
  };
}

export function createMcpToolCallResultShadow(
  request: McpToolCallRequestShadow,
  result: McpCallToolResult,
  options: McpToolCallResultShadowOptions = {},
): McpToolCallResultShadow {
  const approval = readApprovalInfo(result);
  const message = normalizeOptionalString(result.reason) ?? normalizeOptionalString(result.error);

  if (approval.required) {
    const reason: McpToolCallShadowReason = {
      code: 'permission/waiting',
      ...(message ? { message } : {}),
      state: 'waiting',
    };
    const approvalShadow: McpToolCallShadowApproval = {
      required: true,
      state: 'waiting',
      ...(approval.approvalId ? { approvalId: approval.approvalId } : {}),
    };
    return createBridgeResult(
      request,
      createBaseResult(
        request,
        'error',
        createDiagnosticData('waiting', reason, result.result, approvalShadow),
        createRuntimeError('permission', message ?? 'MCP tool call is waiting for permission', true),
      ),
      'waiting',
      reason,
      approvalShadow,
    );
  }

  if (result.success) {
    const structuredData = toOptionalRuntimeCoreJsonValue(result.result);
    return createBridgeResult(
      request,
      createBaseResult(request, 'success', structuredData),
      'success',
      { code: 'success' },
    );
  }

  if (result.blocked) {
    const reasonCode = options.blockedReasonCode ?? 'tool/blocked';
    const reason: McpToolCallShadowReason = {
      code: reasonCode,
      ...(message ? { message } : {}),
    };
    return createBridgeResult(
      request,
      createBaseResult(
        request,
        'error',
        createDiagnosticData('blocked', reason, result.result),
        createRuntimeError(reasonCode === 'gateway/unavailable' ? 'runtime' : 'tool', message ?? 'MCP tool call blocked', true),
      ),
      'blocked',
      reason,
    );
  }

  const resolvedMessage = message ?? 'MCP tool call failed';
  const reason: McpToolCallShadowReason = {
    code: 'tool/error',
    message: resolvedMessage,
  };
  return createBridgeResult(
    request,
    createBaseResult(
      request,
      'error',
      createDiagnosticData('error', reason, result.result),
      createRuntimeError('tool', resolvedMessage, false),
    ),
    'error',
    reason,
  );
}

export function createMcpToolCallThrownErrorShadow(
  request: McpToolCallRequestShadow,
  error: unknown,
): McpToolCallResultShadow {
  const message = errorMessage(error);
  const reason: McpToolCallShadowReason = {
    code: 'exception',
    message,
  };
  return createBridgeResult(
    request,
    createBaseResult(
      request,
      'error',
      createDiagnosticData('error', reason),
      createRuntimeError('runtime', message, false),
    ),
    'error',
    reason,
  );
}
