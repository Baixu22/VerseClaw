import type { McpCallToolResult } from '@shared/types/mcp';
import type {
  RuntimeRegistryDiagnostic,
  RuntimeToolProviderManifest,
  ToolCallRequest,
  ToolCallResult,
} from '../../openclaw_runtime/src/runtime-core';
import type {
  McpToolCallRequestShadow,
  McpToolCallResultShadow,
} from './tool-protocol-shadow';

export const MCP_CALL_TOOL_COMPAT_PROVIDER_ID = 'mcp-call-tool-compat';

export const MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST: RuntimeToolProviderManifest = {
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
  fallbackReasons: ['legacy_authoritative', 'provider_error', 'policy_denied', 'no_result'],
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
  provider: RuntimeToolProviderManifest;
  operation: 'mcp.callTool';
  request: ToolCallRequest;
  diagnostics: RuntimeRegistryDiagnostic[];
};

export type McpToolProviderRegistryResultShadow = {
  kind: 'tool_provider.result';
  schemaVersion: 1;
  provider: RuntimeToolProviderManifest;
  operation: 'mcp.callTool';
  request: ToolCallRequest;
  result: ToolCallResult;
  diagnostics: RuntimeRegistryDiagnostic[];
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

function requestDiagnostic(request: ToolCallRequest): RuntimeRegistryDiagnostic {
  return {
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
): RuntimeRegistryDiagnostic {
  return {
    surface: 'tool',
    providerId: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
    status: resultShadow.shadow.status === 'success' ? 'ok' : 'fallback',
    reason: resultShadow.shadow.reason.code === 'permission/waiting'
      ? 'policy_denied'
      : 'legacy_authoritative',
    message: 'MCP callTool registry pilot kept the legacy McpCallToolResult authoritative.',
    retryable: resultShadow.result.error?.retryable,
    evidenceRefs: [providerEvidenceRef(resultShadow.result.callId)],
    metadata: {
      adapterStatus: resultShadow.shadow.status,
      adapterReasonCode: resultShadow.shadow.reason.code,
      legacyResponseShape: 'McpCallToolResult',
      legacyAuthoritative: true,
      ...(legacyResult?.blocked === true ? { legacyBlocked: true } : {}),
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
  return {
    kind: 'tool_provider.result',
    schemaVersion: 1,
    provider: MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST,
    operation: 'mcp.callTool',
    request: requestShadow.request,
    result: resultShadow.result,
    diagnostics: [resultDiagnostic(resultShadow, legacyResult)],
    shadow: {
      legacyResponseShape: 'McpCallToolResult',
      legacyAuthoritative: true,
      adapterStatus: resultShadow.shadow.status,
      adapterReason: resultShadow.shadow.reason,
      ...(resultShadow.shadow.approval ? { approval: resultShadow.shadow.approval } : {}),
    },
  };
}
