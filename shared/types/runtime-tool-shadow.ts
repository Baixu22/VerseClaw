export type RuntimeShadowJsonPrimitive = string | number | boolean | null;

export type RuntimeShadowJsonValue =
  | RuntimeShadowJsonPrimitive
  | RuntimeShadowJsonValue[]
  | { [key: string]: RuntimeShadowJsonValue };

export type RuntimeShadowJsonObject = { [key: string]: RuntimeShadowJsonValue };

export type RuntimeShadowEvidenceRef = {
  type: 'file' | 'session' | 'tool' | 'trace' | 'test' | 'other';
  ref: string;
  label?: string;
  metadata?: RuntimeShadowJsonObject;
};

export type RuntimeShadowTraceContext = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  attributes?: RuntimeShadowJsonObject;
};

export type RuntimeShadowContextItem = {
  id: string;
  kind:
    | 'instruction'
    | 'message'
    | 'summary'
    | 'memory'
    | 'file'
    | 'symbol'
    | 'trace'
    | 'checkpoint'
    | 'evidence'
    | 'other';
  text: string;
  source?: string;
  priority?: 'P0' | 'P1' | 'P2';
  evidenceRefs: RuntimeShadowEvidenceRef[];
  createdAt?: number;
  metadata?: RuntimeShadowJsonObject;
};

export type RuntimeShadowToolCallRequest = {
  callId: string;
  taskId: string;
  toolName: string;
  args: RuntimeShadowJsonObject;
  permissionContext?: RuntimeShadowJsonObject;
  retryPolicy?: {
    maxAttempts?: number;
    backoffMs?: number;
    retryable?: boolean;
  };
  idempotencyKey?: string;
  traceContext?: RuntimeShadowTraceContext;
};

export type RuntimeShadowErrorType =
  | 'model'
  | 'tool'
  | 'permission'
  | 'budget'
  | 'context'
  | 'verifier'
  | 'runtime';

export type RuntimeShadowError = {
  type: RuntimeShadowErrorType;
  message: string;
  retryable: boolean;
  evidenceRefs: RuntimeShadowEvidenceRef[];
};

export type RuntimeShadowToolCallResult = {
  callId: string;
  status: 'success' | 'error' | 'denied' | 'cancelled';
  contextItems: RuntimeShadowContextItem[];
  structuredData?: RuntimeShadowJsonValue;
  error?: RuntimeShadowError;
  startedAt: number;
  finishedAt: number;
  evidence: RuntimeShadowEvidenceRef[];
};

export type RuntimeShadowRegistryPermission = {
  decision: 'allow' | 'ask' | 'deny';
  capability: string;
  reason?: string;
  metadata?: RuntimeShadowJsonObject;
};

export type RuntimeShadowRegistryDiagnostic = {
  surface: 'context' | 'tool';
  providerId?: string;
  status: 'ok' | 'skipped' | 'fallback' | 'waiting' | 'denied' | 'cancelled' | 'error';
  reason:
    | 'registered'
    | 'manifest_invalid'
    | 'duplicate_provider'
    | 'flag_disabled'
    | 'legacy_authoritative'
    | 'unknown_provider'
    | 'provider_disabled'
    | 'capability_unsupported'
    | 'unsupported_content'
    | 'policy_denied'
    | 'policy_waiting'
    | 'tool_cancelled'
    | 'tool_error'
    | 'provider_exception'
    | 'runtime_unavailable'
    | 'provider_error'
    | 'timeout'
    | 'no_result';
  message?: string;
  retryable?: boolean;
  evidenceRefs: RuntimeShadowEvidenceRef[];
  metadata?: RuntimeShadowJsonObject;
};

export type RuntimeShadowToolProviderManifest = {
  id: string;
  kind: 'tool';
  title: string;
  description?: string;
  source: 'legacy' | 'runtime-core' | 'mcp' | 'builtin' | 'gateway' | 'host-api' | 'external';
  capabilities: string[];
  priority: number;
  order: number;
  permission: RuntimeShadowRegistryPermission;
  enabledByDefault: boolean;
  shadowOnly: boolean;
  fallbackReasons: RuntimeShadowRegistryDiagnostic['reason'][];
  evidenceRefs: RuntimeShadowEvidenceRef[];
  metadata?: RuntimeShadowJsonObject;
  toolNames: string[];
  parameterSchema: RuntimeShadowJsonObject;
  resultStatuses: RuntimeShadowToolCallResult['status'][];
};
