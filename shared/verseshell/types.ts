export const VERSESHELL_OBSERVATION_SCHEMA = 'verseshell.observation/v1' as const;
export const VERSESHELL_MCP_PROTOCOL_VERSION = '2024-11-05' as const;
export const VERSESHELL_SERVER_PROTOCOL = 'verseshell.jsonl/v1' as const;
export const VERSESHELL_OPERATION_CATALOG_SCHEMA = 'verseshell.operation-catalog/v1' as const;
export const VERSESHELL_CRATE_VERSION = '1.0.0' as const;
export const VERSESHELL_SERVER_NAME = 'ae-mcp' as const;

export const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
export const DEFAULT_OBSERVATION_MAX_TOKENS = 4_000;
export const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
export const DEFAULT_MAX_OBSERVATION_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_HANDSHAKE_BYTES = 64 * 1024;
export const DEFAULT_MAX_STDOUT_BYTES = 64 * 1024;
export const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
export const DEFAULT_MAX_JSON_FRAME_BYTES = 256 * 1024;
export const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;
export const DEFAULT_MAX_RESULT_TOKENS = 4_000;
export const DEFAULT_MAX_RESULT_LINES = 500;
export const DEFAULT_MAX_RESULT_MATCHES = 200;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: JsonValue[];
  description?: string;
  default?: JsonValue;
  minItems?: number;
  minimum?: number;
}

/** Mirrors `operation::ObservationBudget`. */
export interface ObservationBudget {
  max_tokens: number;
}

/** Mirrors `operation::OperationRequest`; defaults are applied only by the decoder. */
export interface OperationRequest {
  id: string;
  agent: string;
  op: string;
  args: JsonObject;
  timeout_ms: number;
  budget: ObservationBudget;
}

/** Mirrors the JSON emitted by `ops.list`. */
export interface OperationCatalogEntry {
  name: string;
  mcp_name: string;
  description: string;
  effect: string;
  capability: string;
  input_schema: JsonSchema;
  example?: JsonObject;
}

export interface SuggestedFix {
  action: string;
  tool?: string;
  args?: JsonValue;
  reason: string;
}

export interface OperationError {
  code: string;
  message: string;
  recoverable: boolean;
  hint?: string;
  fix?: SuggestedFix;
}

export interface Diagnostic {
  tool: string;
  severity: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  code?: string;
  expected?: string;
  found?: string;
  suggested_fix?: string;
}

export interface SuggestedAction {
  op: string;
  args: JsonValue;
}

export interface ObservationMeta {
  elapsed_ms: number;
  profile: string;
  token_estimate: number;
  effects?: string[];
  capabilities_used?: string[];
}

export type VerseShellArtifactStream = 'stdout' | 'stderr' | 'json' | 'observation' | 'combined';
export type ResultQueryMode = 'meta' | 'head' | 'tail' | 'slice' | 'grep' | 'raw';

export interface ArtifactOwnerLineage {
  workspace_id: string;
  runtime_id: string;
  process_id: string;
  request_id: string;
  agent_id?: string;
  session_id?: string;
  trace_id?: string;
}

export interface ArtifactQueryCapabilities {
  modes: ResultQueryMode[];
  max_bytes: number;
  max_tokens: number;
  max_lines: number;
  max_matches: number;
}

/** Runtime-owned, content-addressed output retained outside the observation envelope. */
export interface ArtifactDescriptor {
  handle: string;
  digest: string;
  stream: VerseShellArtifactStream;
  raw_bytes: number;
  retained_bytes: number;
  omitted_bytes: number;
  created_at: number;
  expires_at: number;
  owner: ArtifactOwnerLineage;
  query: ArtifactQueryCapabilities;
}

export interface StreamCapture {
  status: 'empty' | 'complete' | 'reduced' | 'truncated';
  encoding?: string;
  raw_complete?: boolean;
  retained_complete?: boolean;
  returned_bytes?: number;
  text?: string;
  summary?: string;
  artifact?: string;
  raw_bytes: number;
  retained_bytes: number;
  omitted_bytes: number;
  truncated: boolean;
}

export interface ResultQueryRequest {
  handle: string;
  mode: ResultQueryMode;
  lines?: number;
  start_line?: number;
  end_line?: number;
  pattern?: string;
  max_matches?: number;
  max_bytes?: number;
  max_tokens?: number;
}

/** Mirrors `operation::Observation`; this is the sole semantic result envelope. */
export interface Observation {
  schema: typeof VERSESHELL_OBSERVATION_SCHEMA;
  id: string;
  op: string;
  ok: boolean;
  data?: JsonValue;
  error?: OperationError;
  diagnostics?: Diagnostic[];
  meta: ObservationMeta;
  suggested_next?: SuggestedAction[];
}

/** Snake-case boundary form of the MCP `initialize` result; compatibility metadata only. */
export interface McpProtocolHandshake {
  protocol_version: typeof VERSESHELL_MCP_PROTOCOL_VERSION;
  capabilities: {
    tools: JsonObject;
  };
  server_info: {
    name: typeof VERSESHELL_SERVER_NAME;
    version: typeof VERSESHELL_CRATE_VERSION;
  };
}

/** @deprecated Use `McpProtocolHandshake`; this is not the internal readiness handshake. */
export type ProtocolHandshake = McpProtocolHandshake;

/**
 * Exact data contract returned by `ae --serve` for `runtime.handshake`.
 * Keep this snake_case form at the process boundary; callers may normalize it
 * only after this decoder has rejected malformed or drifting frames.
 */
export interface RuntimeHandshakeData {
  crate_version: string;
  runtime_version: string;
  server_protocol: typeof VERSESHELL_SERVER_PROTOCOL;
  observation_schema: typeof VERSESHELL_OBSERVATION_SCHEMA;
  operation_catalog_schema: typeof VERSESHELL_OPERATION_CATALOG_SCHEMA;
  workspace: {
    id: string;
    canonical: true;
  };
  capabilities: {
    mode: string;
    granted: string[];
  };
  /** Actual VerseShell enforcement mode, e.g. `agent_strict`. */
  policy_mode: string;
  /** Host-provided immutable policy-profile identity bound before process start. */
  policy_profile: {
    id: string;
    digest: string;
  };
  artifact_defaults: {
    ttl_seconds: number;
    max_total_bytes: number;
  };
  max_concurrency: number;
  operation_catalog: {
    digest: string;
    count: number;
  };
  features: string[];
}

export interface ProtocolManifest {
  protocol_version: typeof VERSESHELL_MCP_PROTOCOL_VERSION;
  observation_schema: typeof VERSESHELL_OBSERVATION_SCHEMA;
  server_name: typeof VERSESHELL_SERVER_NAME;
  server_version: typeof VERSESHELL_CRATE_VERSION;
  operations: OperationCatalogEntry[];
}

export type VerseShellLifecycleStage =
  | 'not_started'
  | 'starting'
  | 'handshaking'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type VerseShellTransportErrorCode =
  | 'transport_closed'
  | 'transport_io'
  | 'transport_timeout'
  | 'transport_protocol';

export type VerseShellLifecycleErrorCode =
  | 'lifecycle_invalid_transition'
  | 'lifecycle_start_failed'
  | 'lifecycle_handshake_failed'
  | 'lifecycle_stop_failed';
