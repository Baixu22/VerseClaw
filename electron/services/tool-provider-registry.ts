import type { McpCallToolResult } from '@shared/types/mcp';
import type {
  RuntimeShadowRegistryDiagnostic,
  RuntimeShadowToolCallRequest,
  RuntimeShadowToolCallResult,
  RuntimeShadowToolProviderManifest,
} from '@shared/types/runtime-tool-shadow';
  RuntimeCoreJsonObject,
  RuntimeRegistryDiagnostic,
  RuntimeToolProviderManifest,
  ToolCallRequest,
  ToolCallResult,
} from '../../openclaw_runtime/src/runtime-core';import type {
  McpToolCallRequestShadow,
  McpToolCallResultShadow,
} from './tool-protocol-shadow';

export const MCP_CALL_TOOL_COMPAT_PROVIDER_ID = 'mcp-call-tool-compat';
export const BUILTIN_HOST_TOOL_DIAGNOSTIC_PROVIDER_ID = 'builtin-host-tool-compat';

const VERSE_CLAW_GIT_MCP_SERVER_ID = 'clawx-git';
const SUPPORTED_MCP_CONTENT_TYPES = new Set(['text', 'resource']);

export const MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST: RuntimeShadowToolProviderManifest = {
  id: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
  kind: 'tool',
  title: 'MCP callTool compatibility provider',
  description: 'Shadow-only registry wrapper around the existing MCP callTool adapter.',
  source: 'mcp',
  capabilities: ['tool.mcp.callTool'],
  priority: 0,
  order: 0,
  permission: {
    decision: 'ask',
    capability: 'tool.mcp.callTool',
    reason: 'Preserve existing MCP approval/waiting semantics during the registry pilot.',
  },
  enabledByDefault: false,
  shadowOnly: true,
  fallbackReasons: [
    'legacy_authoritative',
    'provider_error',
    'provider_exception',
    'policy_denied',
    'policy_waiting',
    'tool_cancelled',
    'tool_error',
    'runtime_unavailable',
    'unsupported_content',
    'no_result',
  ],
  evidenceRefs: [
    { type: 'file', ref: 'electron/services/mcp-api.ts', label: 'Legacy MCP callTool path' },
    {
      type: 'file',
      ref: 'electron/services/tool-protocol-shadow.ts',
      label: 'Normalized MCP ToolCallResult shadow adapter',
    },
  ],
  metadata: {
    legacyResponseShape: 'McpCallToolResult',
    legacyAuthoritative: true,
    visibleCatalogUnchanged: true,
  },
  toolNames: ['mcp.callTool'],
  parameterSchema: {
    type: 'object',
    additionalProperties: true,
  },
  resultStatuses: ['success', 'error', 'denied', 'cancelled'],
};

export type McpToolProviderRegistryShadowRuntimeFlags = {
  runtime?: {
    toolRegistry?: {
      shadow?: boolean;
    };
  };
};

export type McpToolProviderRegistryRequestShadow = {
  kind: 'tool_provider.request';
  schemaVersion: 1;
  provider: RuntimeShadowToolProviderManifest;
  operation: 'mcp.callTool';
  request: RuntimeShadowToolCallRequest;
  diagnostics: RuntimeShadowRegistryDiagnostic[];
};

export type McpToolProviderRegistryResultShadow = {
  kind: 'tool_provider.result';
  schemaVersion: 1;
  provider: RuntimeShadowToolProviderManifest;
  operation: 'mcp.callTool';
  request: RuntimeShadowToolCallRequest;
  result: RuntimeShadowToolCallResult;
  diagnostics: RuntimeShadowRegistryDiagnostic[];
  shadow: {
    legacyResponseShape: 'McpCallToolResult';
    legacyAuthoritative: true;
    adapterStatus: McpToolCallResultShadow['shadow']['status'];
    adapterReason: McpToolCallResultShadow['shadow']['reason'];
    approval?: McpToolCallResultShadow['shadow']['approval'];
  };
};

export type McpToolProviderRegistryShadowRecord =
  | McpToolProviderRegistryRequestShadow
  | McpToolProviderRegistryResultShadow;

export type McpToolProviderRegistryShadowSink = (
  record: McpToolProviderRegistryShadowRecord,
) => void;

export type McpToolProviderRegistryShadowEmitterOptions =
  McpToolProviderRegistryShadowRuntimeFlags & {
    toolProviderRegistryShadowSink?: McpToolProviderRegistryShadowSink;
  };

export function isMcpToolProviderRegistryShadowEnabled(
  options: McpToolProviderRegistryShadowRuntimeFlags,
): boolean {
  return options.runtime?.toolRegistry?.shadow === true;
}

export function emitMcpToolProviderRegistryShadow(
  options: McpToolProviderRegistryShadowEmitterOptions,
  record: McpToolProviderRegistryShadowRecord,
): void {
  if (!isMcpToolProviderRegistryShadowEnabled(options)) return;
  try {
    options.toolProviderRegistryShadowSink?.(record);
  } catch {
    // Registry shadows are diagnostics only; legacy MCP responses stay authoritative.
  }
}

function providerEvidenceRef(callId: string) {
  return {
    type: 'tool' as const,
    ref: callId,
    label: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
    metadata: {
      providerId: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
      operation: 'mcp.callTool',
      legacyAuthoritative: true,
    },
  };
}

function requestDiagnostic(request: RuntimeShadowToolCallRequest): RuntimeShadowRegistryDiagnostic {
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unsupportedMcpContentTypes(legacyResult?: McpCallToolResult): string[] {
  const result = isRecord(legacyResult?.result) ? legacyResult.result : undefined;
  const content = Array.isArray(result?.content) ? result.content : [];
  const unsupported = new Set<string>();
  for (const item of content) {
    if (!isRecord(item)) {
      unsupported.add('non_object');
      continue;
    }
    const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'missing_type';
    if (!SUPPORTED_MCP_CONTENT_TYPES.has(type)) {
      unsupported.add(type);
    }
  }
  return [...unsupported].sort();
}

function messageMatchesCancel(message?: string): boolean {
  return /\bcancell?ed\b|\babort(?:ed)?\b/iu.test(message ?? '');
}

function resultDiagnosticClassification(
  resultShadow: McpToolCallResultShadow,
  legacyResult?: McpCallToolResult,
): Pick<RuntimeRegistryDiagnostic, 'status' | 'reason' | 'message'> & {
  errorCategory: string;
  metadata?: RuntimeCoreJsonObject;
} {
  const reasonCode = resultShadow.shadow.reason.code;
  const unsupportedContentTypes = unsupportedMcpContentTypes(legacyResult);
  const message = resultShadow.shadow.reason.message
    ?? legacyResult?.reason
    ?? legacyResult?.error
    ?? resultShadow.result.error?.message;

  if (reasonCode === 'success' && unsupportedContentTypes.length > 0) {
    return {
      status: 'fallback',
      reason: 'unsupported_content',
      message: 'MCP callTool returned content types that are unsupported by the normalized registry diagnostic surface.',
      errorCategory: 'unsupported_mcp_content',
      metadata: { unsupportedContentTypes },
    };
  }
  if (reasonCode === 'success') {
    return {
      status: 'ok',
      reason: 'legacy_authoritative',
      message: 'MCP callTool registry pilot kept the legacy McpCallToolResult authoritative.',
      errorCategory: 'none',
    };
  }
  if (reasonCode === 'permission/waiting') {
    return {
      status: 'waiting',
      reason: 'policy_waiting',
      message: 'MCP callTool is waiting for legacy approval; registry diagnostics do not decide permission.',
      errorCategory: 'permission_waiting',
    };
  }
  if (reasonCode === 'exception') {
    return {
      status: 'error',
      reason: 'provider_exception',
      message: 'MCP callTool provider exception was normalized as diagnostics only.',
      errorCategory: 'provider_exception',
    };
  }
  if (messageMatchesCancel(message)) {
    return {
      status: 'cancelled',
      reason: 'tool_cancelled',
      message: 'MCP callTool cancellation-like outcome was normalized as diagnostics only.',
      errorCategory: 'tool_cancelled',
    };
  }
  if (reasonCode === 'gateway/unavailable') {
    return {
      status: 'fallback',
      reason: 'runtime_unavailable',
      message: 'MCP callTool runtime unavailable outcome was normalized as diagnostics only.',
      errorCategory: 'runtime_unavailable',
    };
  }
  if (reasonCode === 'tool/blocked') {
    return {
      status: 'denied',
      reason: 'policy_denied',
      message: 'MCP callTool blocked outcome was normalized as diagnostics only.',
      errorCategory: 'policy_denied',
    };
  }
  return {
    status: 'error',
    reason: 'tool_error',
    message: 'MCP callTool error outcome was normalized as diagnostics only.',
    errorCategory: 'tool_error',
  };
}

function requestDiagnostic(request: ToolCallRequest): RuntimeRegistryDiagnostic {  return {
    surface: 'tool',
    providerId: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
    status: 'ok',
    reason: 'registered',
    message: 'MCP callTool compatibility provider observed the legacy request.',
    evidenceRefs: [providerEvidenceRef(request.callId)],
    metadata: {
      policyDecision: MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST.permission.decision,
      legacyAuthoritative: true,
      visibleCatalogUnchanged: true,
    },
  };
}

function resultDiagnostic(
  resultShadow: McpToolCallResultShadow,
  legacyResult?: McpCallToolResult,
): RuntimeShadowRegistryDiagnostic {
): RuntimeRegistryDiagnostic {
  const classification = resultDiagnosticClassification(resultShadow, legacyResult);  return {
    surface: 'tool',
    providerId: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
    status: classification.status,
    reason: classification.reason,
    message: classification.message,
    retryable: resultShadow.result.error?.retryable,
    evidenceRefs: [providerEvidenceRef(resultShadow.result.callId)],
    metadata: {
      adapterStatus: resultShadow.shadow.status,
      adapterReasonCode: resultShadow.shadow.reason.code,
      errorCategory: classification.errorCategory,
      legacyResponseShape: 'McpCallToolResult',
      legacyAuthoritative: true,
      ...(legacyResult?.blocked === true ? { legacyBlocked: true } : {}),
      ...(classification.metadata ?? {}),
    },
  };
}

function builtInHostToolDiagnostic(
  requestShadow: McpToolCallRequestShadow,
  resultShadow: McpToolCallResultShadow,
): RuntimeRegistryDiagnostic | undefined {
  if (requestShadow.target.serverId !== VERSE_CLAW_GIT_MCP_SERVER_ID) {
    return undefined;
  }
  return {
    surface: 'tool',
    providerId: BUILTIN_HOST_TOOL_DIAGNOSTIC_PROVIDER_ID,
    status: resultShadow.shadow.status === 'success' ? 'ok' : 'fallback',
    reason: 'legacy_authoritative',
    message: 'Built-in host Git tool diagnostic shape observed through the existing MCP adapter seam.',
    retryable: resultShadow.result.error?.retryable,
    evidenceRefs: [providerEvidenceRef(resultShadow.result.callId)],
    metadata: {
      builtInToolDiagnosticShape: true,
      existingAdapterSeam: 'electron.services.mcp-api.callTool.clawx-git',
      noNewTransport: true,
      legacyAuthoritative: true,
      toolName: requestShadow.target.toolName,
      adapterStatus: resultShadow.shadow.status,
      adapterReasonCode: resultShadow.shadow.reason.code,
    },
  };
}

export function createMcpToolProviderRegistryRequestShadow(
  requestShadow: McpToolCallRequestShadow,
): McpToolProviderRegistryRequestShadow {
  return {
    kind: 'tool_provider.request',
    schemaVersion: 1,
    provider: MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST,
    operation: 'mcp.callTool',
    request: requestShadow.request,
    diagnostics: [requestDiagnostic(requestShadow.request)],
  };
}

export function createMcpToolProviderRegistryResultShadow(
  requestShadow: McpToolCallRequestShadow,
  resultShadow: McpToolCallResultShadow,
  legacyResult?: McpCallToolResult,
): McpToolProviderRegistryResultShadow {
  const diagnostics = [resultDiagnostic(resultShadow, legacyResult)];
  const builtInDiagnostic = builtInHostToolDiagnostic(requestShadow, resultShadow);
  if (builtInDiagnostic) {
    diagnostics.push(builtInDiagnostic);
  }
  return {
    kind: 'tool_provider.result',
    schemaVersion: 1,
    provider: MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST,
    operation: 'mcp.callTool',
    request: requestShadow.request,
    result: resultShadow.result,
    diagnostics,
    shadow: {
      legacyResponseShape: 'McpCallToolResult',
      legacyAuthoritative: true,
      adapterStatus: resultShadow.shadow.status,
      adapterReason: resultShadow.shadow.reason,
      ...(resultShadow.shadow.approval ? { approval: resultShadow.shadow.approval } : {}),
    },
  };
}
