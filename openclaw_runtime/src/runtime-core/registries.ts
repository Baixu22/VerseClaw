import type { EvidenceRef } from "./evidence.js";
import {
  eventBus,
  evidenceLedger,
  failureContract,
  gateEngine,
  lifecycleEngine,
  type GateDecision,
} from "../runtime-spine/index.js";
import { registerToolPolicyCheckerForRuntimeSpine } from "../runtime-spine/checkers/tool-policy-checker.js";
import {
  TOOL_CALL_RESULT_STATUSES,
  isContextItem,
  isContextItemKind,
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  isToolCallResult,
  type ContextItem,
  type ContextItemKind,
  type RuntimeCoreJsonObject,
  type RuntimeError,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolCallResultStatus,
} from "./types.js";

export const RUNTIME_REGISTRY_FLAG_PATHS = {
  registryPilotEnabled: "runtime.registryPilot.enabled",
  providerRegistryShadow: "runtime.providerRegistry.shadow",
  contextProviderRegistryPilot: "runtime.contextProviders.registryPilot",
  toolRegistryShadow: "runtime.toolRegistry.shadow",
  registryDiagnosticsCollector: "runtime.registryDiagnostics.collector",
} as const;

export type RuntimeRegistryFeatureFlag = keyof typeof RUNTIME_REGISTRY_FLAG_PATHS;

export type RuntimeRegistryFeatureFlags = Record<RuntimeRegistryFeatureFlag, boolean>;

export const DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS = {
  registryPilotEnabled: false,
  providerRegistryShadow: false,
  contextProviderRegistryPilot: false,
  toolRegistryShadow: false,
  registryDiagnosticsCollector: false,
} as const satisfies RuntimeRegistryFeatureFlags;

export const RUNTIME_REGISTRY_SURFACES = ["context", "tool"] as const;
export type RuntimeRegistrySurface = (typeof RUNTIME_REGISTRY_SURFACES)[number];

export const RUNTIME_REGISTRY_PROVIDER_SOURCES = [
  "legacy",
  "runtime-core",
  "mcp",
  "builtin",
  "gateway",
  "host-api",
  "external",
] as const;
export type RuntimeRegistryProviderSource =
  (typeof RUNTIME_REGISTRY_PROVIDER_SOURCES)[number];

export const RUNTIME_REGISTRY_PERMISSION_DECISIONS = [
  "allow",
  "ask",
  "deny",
] as const;
export type RuntimeRegistryPermissionDecision =
  (typeof RUNTIME_REGISTRY_PERMISSION_DECISIONS)[number];

export const RUNTIME_REGISTRY_DIAGNOSTIC_STATUSES = [
  "ok",
  "skipped",
  "fallback",
  "waiting",
  "denied",
  "cancelled",
  "error",
] as const;
export type RuntimeRegistryDiagnosticStatus =
  (typeof RUNTIME_REGISTRY_DIAGNOSTIC_STATUSES)[number];

export const RUNTIME_REGISTRY_DIAGNOSTIC_REASONS = [
  "registered",
  "manifest_invalid",
  "duplicate_provider",
  "flag_disabled",
  "legacy_authoritative",
  "unknown_provider",
  "provider_disabled",
  "capability_unsupported",
  "unsupported_content",
  "policy_denied",
  "policy_waiting",
  "tool_cancelled",
  "tool_error",
  "provider_exception",
  "runtime_unavailable",
  "provider_error",
  "timeout",
  "no_result",
  /** FP-P1-181: the declared memory-injection budget truncated the block. */
  "memory_injection_budget_truncated",
] as const;
export type RuntimeRegistryDiagnosticReason =
  (typeof RUNTIME_REGISTRY_DIAGNOSTIC_REASONS)[number];

export type RuntimeRegistryPermission = {
  decision: RuntimeRegistryPermissionDecision;
  capability: string;
  reason?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeRegistryDiagnostic = {
  surface: RuntimeRegistrySurface;
  providerId?: string;
  status: RuntimeRegistryDiagnosticStatus;
  reason: RuntimeRegistryDiagnosticReason;
  message?: string;
  retryable?: boolean;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeRegistryManifestBase = {
  id: string;
  kind: RuntimeRegistrySurface;
  title: string;
  description?: string;
  source: RuntimeRegistryProviderSource;
  capabilities: string[];
  priority: number;
  order: number;
  permission: RuntimeRegistryPermission;
  enabledByDefault: boolean;
  shadowOnly: boolean;
  fallbackReasons: RuntimeRegistryDiagnosticReason[];
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeContextProviderManifest = RuntimeRegistryManifestBase & {
  kind: "context";
  outputKinds: ContextItemKind[];
  dependsOnIndexing: boolean;
};

export type RuntimeToolProviderManifest = RuntimeRegistryManifestBase & {
  kind: "tool";
  toolNames: string[];
  parameterSchema: RuntimeCoreJsonObject;
  resultStatuses: ToolCallResultStatus[];
};

export type RuntimeProviderManifest =
  | RuntimeContextProviderManifest
  | RuntimeToolProviderManifest;

export type RuntimeContextProviderQuery = {
  taskId?: string;
  goal?: string;
  workspace?: string;
  activeFiles?: string[];
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeContextProviderExtras = {
  legacyAuthoritative?: boolean;
  shadowOnly?: boolean;
  metadata?: RuntimeCoreJsonObject;
};

export const RUNTIME_CONTEXT_PROVIDER_RESULT_STATUSES = [
  "success",
  "error",
  "fallback",
] as const;
export type RuntimeContextProviderResultStatus =
  (typeof RUNTIME_CONTEXT_PROVIDER_RESULT_STATUSES)[number];

export type RuntimeContextProviderResult = {
  status: RuntimeContextProviderResultStatus;
  contextItems: ContextItem[];
  diagnostics: RuntimeRegistryDiagnostic[];
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeContextProvider = {
  readonly manifest: RuntimeContextProviderManifest;
  getContext: (
    query: RuntimeContextProviderQuery,
    extras?: RuntimeContextProviderExtras,
  ) =>
    | ContextItem[]
    | RuntimeContextProviderResult
    | Promise<ContextItem[] | RuntimeContextProviderResult>;
};

export type RuntimeToolProvider = {
  readonly manifest: RuntimeToolProviderManifest;
  callTool: (request: ToolCallRequest) => ToolCallResult | Promise<ToolCallResult>;
};

export type RuntimeRegistryValidationResult<T> =
  | { ok: true; manifest: T }
  | { ok: false; diagnostic: RuntimeRegistryDiagnostic };

export type RuntimeRegistryRegistrationResult =
  | { status: "registered"; diagnostic?: RuntimeRegistryDiagnostic }
  | { status: "duplicate"; diagnostic: RuntimeRegistryDiagnostic }
  | { status: "invalid"; diagnostic: RuntimeRegistryDiagnostic };

export type RuntimeRegistryIsolatedError = {
  isolated: true;
  diagnostic: RuntimeRegistryDiagnostic;
  error: RuntimeError;
};

export const RUNTIME_REGISTRY_DIAGNOSTIC_COLLECTOR_SCHEMA_VERSION = 1;
export const DEFAULT_RUNTIME_REGISTRY_DIAGNOSTIC_COLLECTOR_LIMIT = 32;
export const RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_SCHEMA_VERSION = 1;
export const RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_MODE =
  "controlled_internal_sanitized" as const;

export type RuntimeRegistryDiagnosticCollectorInput = {
  enabled?: boolean;
  limit?: number;
  prioritize?: boolean;
  sanitize?: boolean;
  contextDiagnostics?: readonly RuntimeRegistryDiagnostic[];
  toolDiagnostics?: readonly RuntimeRegistryDiagnostic[];
  diagnostics?: readonly RuntimeRegistryDiagnostic[];
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeRegistryControlledDiagnosticConsumerGateReason =
  | "consumer_disabled"
  | "feature_flags_missing"
  | "registry_diagnostics_collector_disabled"
  | "registry_pilot_disabled"
  | "provider_registry_shadow_disabled"
  | "context_provider_registry_pilot_disabled"
  | "tool_registry_shadow_disabled";

export type RuntimeRegistryControlledDiagnosticConsumerInput = Omit<
  RuntimeRegistryDiagnosticCollectorInput,
  "enabled" | "prioritize" | "sanitize"
> & {
  enabled?: boolean;
  featureFlags?: RuntimeRegistryFeatureFlags;
};

export type RuntimeRegistryOmittedDiagnosticSummary = {
  diagnosticCount: number;
  contextDiagnosticCount: number;
  toolDiagnosticCount: number;
  byStatus: Partial<Record<RuntimeRegistryDiagnosticStatus, number>>;
  byReason: Partial<Record<RuntimeRegistryDiagnosticReason, number>>;
};

export type RuntimeRegistryDiagnosticCollectorOutput = {
  schemaVersion: typeof RUNTIME_REGISTRY_DIAGNOSTIC_COLLECTOR_SCHEMA_VERSION;
  enabled: boolean;
  diagnostics: RuntimeRegistryDiagnostic[];
  omittedDiagnosticCount: number;
  omittedSummary: RuntimeRegistryOmittedDiagnosticSummary;
  evidenceRefs: EvidenceRef[];
  summary: {
    totalDiagnosticCount: number;
    includedDiagnosticCount: number;
    contextDiagnosticCount: number;
    toolDiagnosticCount: number;
    byStatus: Partial<Record<RuntimeRegistryDiagnosticStatus, number>>;
    byReason: Partial<Record<RuntimeRegistryDiagnosticReason, number>>;
  };
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeRegistryControlledDiagnosticConsumerOutput =
  RuntimeRegistryDiagnosticCollectorOutput & {
    consumer: {
      schemaVersion: typeof RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_SCHEMA_VERSION;
      mode: typeof RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_MODE;
      enabled: boolean;
      gateStatus: "open" | "closed";
      blockedReasons: RuntimeRegistryControlledDiagnosticConsumerGateReason[];
      sanitized: true;
      prioritized: true;
      inMemoryOnly: true;
      diagnosticsOnly: true;
      authoritativeness: "none";
      legacyDecisionUnaffected: true;
      finalTaskStatusUnaffected: true;
      limit: number;
      requiredFlags: RuntimeRegistryFeatureFlag[];
    };
  };

export type RuntimeRegistryControlledDiagnosticActionability =
  | "actionable"
  | "noise"
  | "review_required";

export type RuntimeRegistryControlledDiagnosticConsumerReportStatus =
  | "disabled"
  | "no_diagnostics"
  | "diagnostics_only_operator_summary";

export type RuntimeRegistryControlledDiagnosticConsumerReportInput = {
  enabled?: boolean;
  featureFlags?: RuntimeRegistryFeatureFlags;
  limit?: number;
  contextDiagnostics?: readonly unknown[];
  toolDiagnostics?: readonly unknown[];
  diagnostics?: readonly unknown[];
  metadata?: RuntimeCoreJsonObject;
  maxEvidenceRefs?: number;
};

export type RuntimeRegistryControlledDiagnosticConsumerAuthority = {
  noProviderOrderingChange: true;
  noToolAuthority: true;
  noTaskLoopAuthority: true;
  noGatewayAuthority: true;
  noProviderTransportAuthority: true;
  noPromptOrModelMessageInsertion: true;
  noPersistence: true;
  notTaskCompletionEvidence: true;
};

export type RuntimeRegistryControlledDiagnosticConsumerReport = {
  schemaVersion: typeof RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_SCHEMA_VERSION;
  decision: {
    status: RuntimeRegistryControlledDiagnosticConsumerReportStatus;
    diagnosticsOnly: true;
    operatorSummaryOnly: true;
    authoritative: false;
  };
  enabled: boolean;
  gateStatus: "open" | "closed";
  blockedReasons: RuntimeRegistryControlledDiagnosticConsumerGateReason[];
  totalDiagnosticCount: number;
  includedDiagnosticCount: number;
  omittedDiagnosticCount: number;
  invalidDiagnosticCount: number;
  byStatus: Partial<Record<RuntimeRegistryDiagnosticStatus, number>>;
  byReason: Partial<Record<RuntimeRegistryDiagnosticReason, number>>;
  actionability: {
    actionableDiagnosticCount: number;
    noiseDiagnosticCount: number;
    reviewRequiredDiagnosticCount: number;
    byCategory: Partial<Record<RuntimeRegistryControlledDiagnosticActionability, number>>;
  };
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
  authority: RuntimeRegistryControlledDiagnosticConsumerAuthority;
};

const PROVIDER_SOURCE_SET = new Set<RuntimeRegistryProviderSource>(
  RUNTIME_REGISTRY_PROVIDER_SOURCES,
);
const PERMISSION_DECISION_SET = new Set<RuntimeRegistryPermissionDecision>(
  RUNTIME_REGISTRY_PERMISSION_DECISIONS,
);
const DIAGNOSTIC_STATUS_SET = new Set<RuntimeRegistryDiagnosticStatus>(
  RUNTIME_REGISTRY_DIAGNOSTIC_STATUSES,
);
const DIAGNOSTIC_REASON_SET = new Set<RuntimeRegistryDiagnosticReason>(
  RUNTIME_REGISTRY_DIAGNOSTIC_REASONS,
);
const CONTEXT_RESULT_STATUS_SET = new Set<RuntimeContextProviderResultStatus>(
  RUNTIME_CONTEXT_PROVIDER_RESULT_STATUSES,
);
const TOOL_RESULT_STATUS_SET = new Set<ToolCallResultStatus>(TOOL_CALL_RESULT_STATUSES);
const SURFACE_SET = new Set<RuntimeRegistrySurface>(RUNTIME_REGISTRY_SURFACES);
const RUNTIME_REGISTRY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;

const DIAGNOSTIC_STATUS_PRIORITY: Record<RuntimeRegistryDiagnosticStatus, number> = {
  error: 100,
  denied: 90,
  waiting: 80,
  cancelled: 70,
  fallback: 50,
  skipped: 30,
  ok: 10,
};

const DIAGNOSTIC_REASON_PRIORITY: Record<RuntimeRegistryDiagnosticReason, number> = {
  provider_exception: 100,
  runtime_unavailable: 98,
  policy_denied: 96,
  policy_waiting: 94,
  tool_error: 92,
  provider_error: 90,
  timeout: 88,
  manifest_invalid: 86,
  unsupported_content: 70,
  tool_cancelled: 65,
  unknown_provider: 60,
  capability_unsupported: 55,
  provider_disabled: 40,
  duplicate_provider: 40,
  flag_disabled: 40,
  no_result: 35,
  // Informational degradation: the injection still happened, just smaller.
  memory_injection_budget_truncated: 45,
  legacy_authoritative: 10,
  registered: 0,
};

const RUNTIME_REGISTRY_CONTROLLED_CONSUMER_REQUIRED_FLAGS: RuntimeRegistryFeatureFlag[] = [
  "registryDiagnosticsCollector",
  "registryPilotEnabled",
  "providerRegistryShadow",
  "contextProviderRegistryPilot",
  "toolRegistryShadow",
];

const RUNTIME_REGISTRY_SANITIZED_PROVIDER_ID = "redacted-provider";
const RUNTIME_REGISTRY_PROVIDER_ID_MAX_LENGTH = 128;
const RUNTIME_REGISTRY_SANITIZED_REDACTED_FIELDS = [
  "message",
  "metadata",
  "evidenceRefs.ref",
  "evidenceRefs.label",
  "evidenceRefs.summary",
  "evidenceRefs.metadata",
];

const RUNTIME_REGISTRY_SENSITIVE_TEXT_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/u,
  /\bBearer\s+[A-Za-z0-9._-]{24,}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b[A-Z]:\\Users\\[^\\\s]+\\[^\s"]+/u,
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|KEY)=\S{8,}/u,
  /RAW_TOOL_PAYLOAD_SECRET_[A-Z0-9_]+/u,
];

const RUNTIME_REGISTRY_CONTROLLED_REPORT_MAX_EVIDENCE_REFS = 16;

const RUNTIME_REGISTRY_CONTROLLED_ACTIONABILITY_BY_REASON = {
  provider_exception: "actionable",
  runtime_unavailable: "actionable",
  policy_denied: "actionable",
  policy_waiting: "actionable",
  tool_error: "actionable",
  provider_error: "actionable",
  timeout: "actionable",
  manifest_invalid: "actionable",
  unsupported_content: "actionable",
  tool_cancelled: "review_required",
  unknown_provider: "review_required",
  capability_unsupported: "review_required",
  provider_disabled: "review_required",
  duplicate_provider: "review_required",
  flag_disabled: "review_required",
  no_result: "review_required",
  memory_injection_budget_truncated: "review_required",
  legacy_authoritative: "noise",
  registered: "noise",
} as const satisfies Record<
  RuntimeRegistryDiagnosticReason,
  RuntimeRegistryControlledDiagnosticActionability
>;

const RUNTIME_REGISTRY_CONTROLLED_REPORT_AUTHORITY = {
  noProviderOrderingChange: true,
  noToolAuthority: true,
  noTaskLoopAuthority: true,
  noGatewayAuthority: true,
  noProviderTransportAuthority: true,
  noPromptOrModelMessageInsertion: true,
  noPersistence: true,
  notTaskCompletionEvidence: true,
} as const satisfies RuntimeRegistryControlledDiagnosticConsumerAuthority;

// [SPINE] Register the diagnostic tool-policy checker when runtime registries initialize.
registerToolPolicyCheckerForRuntimeSpine();

function isEvidenceRefShape(value: unknown): value is EvidenceRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.type) &&
    isNonEmptyString(value.ref) &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

function isEvidenceRefs(value: unknown): value is EvidenceRef[] {
  return Array.isArray(value) && value.every(isEvidenceRefShape);
}

function isRegistryIdentifier(value: unknown): value is string {
  return typeof value === "string" && RUNTIME_REGISTRY_ID_PATTERN.test(value);
}

function containsRuntimeRegistrySensitiveText(value: string): boolean {
  return RUNTIME_REGISTRY_SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function sanitizeRuntimeRegistryProviderId(providerId: string | undefined): string | undefined {
  if (providerId === undefined) {
    return undefined;
  }
  const trimmed = providerId.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    trimmed.length > RUNTIME_REGISTRY_PROVIDER_ID_MAX_LENGTH ||
    !RUNTIME_REGISTRY_ID_PATTERN.test(trimmed) ||
    containsRuntimeRegistrySensitiveText(trimmed)
  ) {
    return RUNTIME_REGISTRY_SANITIZED_PROVIDER_ID;
  }
  return trimmed;
}

function sanitizeRuntimeRegistryEvidenceRef(
  ref: EvidenceRef,
  diagnostic: RuntimeRegistryDiagnostic,
  evidenceIndex: number,
): EvidenceRef {
  const providerId = sanitizeRuntimeRegistryProviderId(diagnostic.providerId) ?? "unknown";
  return {
    type: ref.type,
    ref: `runtime-registry-evidence:${diagnostic.surface}:${providerId}:${diagnostic.reason}:${evidenceIndex}`,
    label: "Runtime registry evidence",
    metadata: {
      redactionStatus: "sanitized",
      source: "runtime_registry.diagnostic_projection",
      originalType: ref.type,
      evidenceIndex,
    },
  };
}

export function sanitizeRuntimeRegistryDiagnostic(
  diagnostic: RuntimeRegistryDiagnostic,
): RuntimeRegistryDiagnostic {
  const providerId = sanitizeRuntimeRegistryProviderId(diagnostic.providerId);
  return {
    surface: diagnostic.surface,
    ...(providerId ? { providerId } : {}),
    status: diagnostic.status,
    reason: diagnostic.reason,
    ...(diagnostic.retryable === undefined ? {} : { retryable: diagnostic.retryable }),
    evidenceRefs: diagnostic.evidenceRefs.map((ref, index) =>
      sanitizeRuntimeRegistryEvidenceRef(ref, diagnostic, index)
    ),
    metadata: {
      redactionStatus: "sanitized",
      source: "runtime_registry.diagnostic_projection",
      originalEvidenceRefCount: diagnostic.evidenceRefs.length,
      redactedFields: RUNTIME_REGISTRY_SANITIZED_REDACTED_FIELDS,
      ...(diagnostic.message === undefined ? {} : { messageRedacted: true }),
      ...(diagnostic.metadata === undefined ? {} : { metadataRedacted: true }),
    },
  };
}

export function sanitizeRuntimeRegistryDiagnostics(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): RuntimeRegistryDiagnostic[] {
  return diagnostics.map(sanitizeRuntimeRegistryDiagnostic);
}

function sanitizeRuntimeRegistryCollectorMetadata(
  metadata: RuntimeCoreJsonObject | undefined,
): RuntimeCoreJsonObject | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  return {
    redactionStatus: "sanitized",
    source: "runtime_registry.diagnostic_projection",
    metadataRedacted: true,
  };
}

function isRegistryIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRegistryIdentifier);
}

function isProviderSource(value: unknown): value is RuntimeRegistryProviderSource {
  return typeof value === "string" && PROVIDER_SOURCE_SET.has(value as RuntimeRegistryProviderSource);
}

function isRegistrySurface(value: unknown): value is RuntimeRegistrySurface {
  return typeof value === "string" && SURFACE_SET.has(value as RuntimeRegistrySurface);
}

function isPermissionDecision(value: unknown): value is RuntimeRegistryPermissionDecision {
  return (
    typeof value === "string" &&
    PERMISSION_DECISION_SET.has(value as RuntimeRegistryPermissionDecision)
  );
}

function isDiagnosticStatus(value: unknown): value is RuntimeRegistryDiagnosticStatus {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_STATUS_SET.has(value as RuntimeRegistryDiagnosticStatus)
  );
}

function isDiagnosticReason(value: unknown): value is RuntimeRegistryDiagnosticReason {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_REASON_SET.has(value as RuntimeRegistryDiagnosticReason)
  );
}

function isContextResultStatus(value: unknown): value is RuntimeContextProviderResultStatus {
  return (
    typeof value === "string" &&
    CONTEXT_RESULT_STATUS_SET.has(value as RuntimeContextProviderResultStatus)
  );
}

function isToolResultStatus(value: unknown): value is ToolCallResultStatus {
  return typeof value === "string" && TOOL_RESULT_STATUS_SET.has(value as ToolCallResultStatus);
}

function isRuntimeRegistryPermission(value: unknown): value is RuntimeRegistryPermission {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isPermissionDecision(value.decision) &&
    isRegistryIdentifier(value.capability) &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeRegistryDiagnostic(
  value: unknown,
): value is RuntimeRegistryDiagnostic {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.surface === "context" || value.surface === "tool") &&
    (value.providerId === undefined || typeof value.providerId === "string") &&
    isDiagnosticStatus(value.status) &&
    isDiagnosticReason(value.reason) &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.retryable === undefined || typeof value.retryable === "boolean") &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

function isManifestBase(value: unknown): value is RuntimeRegistryManifestBase {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRegistryIdentifier(value.id) &&
    isRegistrySurface(value.kind) &&
    isNonEmptyString(value.title) &&
    (value.description === undefined || typeof value.description === "string") &&
    isProviderSource(value.source) &&
    isRegistryIdentifierArray(value.capabilities) &&
    Number.isInteger(value.priority) &&
    Number.isInteger(value.order) &&
    isRuntimeRegistryPermission(value.permission) &&
    typeof value.enabledByDefault === "boolean" &&
    typeof value.shadowOnly === "boolean" &&
    Array.isArray(value.fallbackReasons) &&
    value.fallbackReasons.every(isDiagnosticReason) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeContextProviderManifest(
  value: unknown,
): value is RuntimeContextProviderManifest {
  const record = isRecord(value) ? value : undefined;
  return (
    isManifestBase(value) &&
    value.kind === "context" &&
    Array.isArray(record?.outputKinds) &&
    record.outputKinds.length > 0 &&
    record.outputKinds.every(isContextItemKind) &&
    typeof record.dependsOnIndexing === "boolean"
  );
}

export function isRuntimeToolProviderManifest(
  value: unknown,
): value is RuntimeToolProviderManifest {
  const record = isRecord(value) ? value : undefined;
  return (
    isManifestBase(value) &&
    value.kind === "tool" &&
    isRegistryIdentifierArray(record?.toolNames) &&
    isRuntimeCoreJsonObject(record.parameterSchema) &&
    Array.isArray(record.resultStatuses) &&
    record.resultStatuses.length > 0 &&
    record.resultStatuses.every(isToolResultStatus)
  );
}

export function isRuntimeProviderManifest(value: unknown): value is RuntimeProviderManifest {
  return isRuntimeContextProviderManifest(value) || isRuntimeToolProviderManifest(value);
}

export function validateRuntimeContextProviderManifest(
  value: unknown,
): RuntimeRegistryValidationResult<RuntimeContextProviderManifest> {
  if (isRuntimeContextProviderManifest(value)) {
    return { ok: true, manifest: value };
  }
  return {
    ok: false,
    diagnostic: manifestInvalidDiagnostic("context", value),
  };
}

export function validateRuntimeToolProviderManifest(
  value: unknown,
): RuntimeRegistryValidationResult<RuntimeToolProviderManifest> {
  if (isRuntimeToolProviderManifest(value)) {
    return { ok: true, manifest: value };
  }
  return {
    ok: false,
    diagnostic: manifestInvalidDiagnostic("tool", value),
  };
}

export function isRuntimeContextProviderResult(
  value: unknown,
): value is ContextItem[] | RuntimeContextProviderResult {
  if (Array.isArray(value)) {
    return value.every(isContextItem);
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    isContextResultStatus(value.status) &&
    Array.isArray(value.contextItems) &&
    value.contextItems.every(isContextItem) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isRuntimeRegistryDiagnostic) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeToolProviderResult(value: unknown): value is ToolCallResult {
  return isToolCallResult(value);
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  const directRuntime = isRecord(record?.runtime) ? record.runtime : undefined;
  if (directRuntime) {
    return directRuntime;
  }
  const config = isRecord(record?.config) ? record.config : undefined;
  const configRuntime = isRecord(config?.runtime) ? config.runtime : undefined;
  if (configRuntime) {
    return configRuntime;
  }
  return undefined;
}

function strictFlag(section: unknown, key: string): boolean {
  return isRecord(section) && section[key] === true;
}

export function resolveRuntimeRegistryFeatureFlags(
  value: unknown,
): RuntimeRegistryFeatureFlags {
  const runtime = runtimeConfigFrom(value);
  return {
    registryPilotEnabled: strictFlag(runtime?.registryPilot, "enabled"),
    providerRegistryShadow: strictFlag(runtime?.providerRegistry, "shadow"),
    contextProviderRegistryPilot: strictFlag(runtime?.contextProviders, "registryPilot"),
    toolRegistryShadow: strictFlag(runtime?.toolRegistry, "shadow"),
    registryDiagnosticsCollector: strictFlag(runtime?.registryDiagnostics, "collector"),
  };
}

export function runtimeRegistryFlagEnabled(
  value: unknown,
  flag: RuntimeRegistryFeatureFlag,
): boolean {
  return resolveRuntimeRegistryFeatureFlags(value)[flag];
}

function compareManifestOrder<T extends RuntimeRegistryManifestBase>(left: T, right: T): number {
  const order = left.order - right.order;
  if (order !== 0) {
    return order;
  }
  const priority = left.priority - right.priority;
  if (priority !== 0) {
    return priority;
  }
  return left.id.localeCompare(right.id);
}

function manifestInvalidDiagnostic(
  surface: RuntimeRegistrySurface,
  value: unknown,
): RuntimeRegistryDiagnostic {
  const providerId = isRecord(value) && typeof value.id === "string" ? value.id : undefined;
  return {
    surface,
    providerId,
    status: "error",
    reason: "manifest_invalid",
    message: "Runtime registry provider manifest failed validation.",
    evidenceRefs: [],
    metadata: { legacyBehaviorUnaffected: true },
  };
}

function duplicateDiagnostic(
  surface: RuntimeRegistrySurface,
  providerId: string,
): RuntimeRegistryDiagnostic {
  return {
    surface,
    providerId,
    status: "skipped",
    reason: "duplicate_provider",
    message: "Runtime registry skipped a duplicate provider id.",
    evidenceRefs: [],
    metadata: { legacyBehaviorUnaffected: true },
  };
}

export class RuntimeContextProviderRegistry {
  readonly #providers = new Map<string, RuntimeContextProvider>();

  constructor(providers: RuntimeContextProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  size(): number {
    return this.#providers.size;
  }

  register(provider: RuntimeContextProvider): RuntimeRegistryRegistrationResult {
    const validation = validateRuntimeContextProviderManifest(provider.manifest);
    if (!validation.ok) {
      return { status: "invalid", diagnostic: validation.diagnostic };
    }
    if (this.#providers.has(validation.manifest.id)) {
      return {
        status: "duplicate",
        diagnostic: duplicateDiagnostic("context", validation.manifest.id),
      };
    }
    this.#providers.set(validation.manifest.id, provider);
    return { status: "registered" };
  }

  listManifests(): RuntimeContextProviderManifest[] {
    return [...this.#providers.values()]
      .map((provider) => provider.manifest)
      .sort(compareManifestOrder);
  }

  listByCapability(capability: string): RuntimeContextProviderManifest[] {
    return this.listManifests().filter((manifest) => manifest.capabilities.includes(capability));
  }

  resolve(providerId: string): RuntimeContextProvider | undefined {
    return this.#providers.get(providerId);
  }
}

export class ToolProviderRegistry {
  readonly #providers = new Map<string, RuntimeToolProvider>();

  constructor(providers: RuntimeToolProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  size(): number {
    return this.#providers.size;
  }

  register(provider: RuntimeToolProvider): RuntimeRegistryRegistrationResult {
    const validation = validateRuntimeToolProviderManifest(provider.manifest);
    if (!validation.ok) {
      return { status: "invalid", diagnostic: validation.diagnostic };
    }
    if (this.#providers.has(validation.manifest.id)) {
      return {
        status: "duplicate",
        diagnostic: duplicateDiagnostic("tool", validation.manifest.id),
      };
    }
    this.#providers.set(validation.manifest.id, provider);
    return { status: "registered" };
  }

  listManifests(): RuntimeToolProviderManifest[] {
    return [...this.#providers.values()]
      .map((provider) => provider.manifest)
      .sort(compareManifestOrder);
  }

  listByCapability(capability: string): RuntimeToolProviderManifest[] {
    return this.listManifests().filter((manifest) => manifest.capabilities.includes(capability));
  }

  resolve(providerId: string): RuntimeToolProvider | undefined {
    return this.#providers.get(providerId);
  }

  resolveByToolName(toolName: string): RuntimeToolProvider | undefined {
    return this.listManifests()
      .map((manifest) => this.#providers.get(manifest.id))
      .find((provider) => provider?.manifest.toolNames.includes(toolName));
  }

  async invokeTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const provider = this.resolveByToolName(request.toolName);
    if (!provider) {
      throw new Error(`Runtime tool provider not found for tool: ${request.toolName}`);
    }

    // [SPINE] Tool invocation lifecycle is diagnostic-only; provider callTool remains authoritative.
    const entity = lifecycleEngine.create("tool_invocation", {
      callId: request.callId,
      taskId: request.taskId,
      toolName: request.toolName,
      providerId: provider.manifest.id,
      authority: "diagnostic_only",
    });
    const gateDecision = await gateEngine.check({
      gateType: "pre_execution",
      entityId: entity.entityId,
      entityType: "tool_invocation",
      source: {
        sourceId: "runtime-core.tool-provider-registry",
        sourceType: "tool",
        stage: "pre_execution",
      },
      payload: {
        request,
        toolName: request.toolName,
        providerId: provider.manifest.id,
      },
      metadata: {
        diagnosticOnly: true,
        legacyAllowlistUnaffected: true,
      },
    });
    emitToolInvocationGateDecision(entity.entityId, gateDecision);
    lifecycleEngine.transition(entity.entityId, "pre_gate", {
      actor: "runtime-core.tool-provider-registry",
      reason: "pre-execution diagnostic gate observed",
      metadata: { callId: request.callId, toolName: request.toolName },
    });
    lifecycleEngine.transition(entity.entityId, "gated_approved", {
      actor: "runtime-core.tool-provider-registry",
      reason: "diagnostic-only gate cannot block invocation",
      metadata: { callId: request.callId, gateId: gateDecision.gateId },
    });
    lifecycleEngine.transition(entity.entityId, "running", {
      actor: "runtime-core.tool-provider-registry",
      reason: "provider invocation started",
      metadata: { callId: request.callId, toolName: request.toolName },
    });

    eventBus.emit(
      "tool.invoked",
      entity.entityId,
      "tool_invocation",
      {
        sourceId: "runtime-core.tool-provider-registry",
        sourceType: "tool",
        stage: "invoke",
      },
      {
        callId: request.callId,
        toolName: request.toolName,
        providerId: provider.manifest.id,
        diagnosticOnly: true,
        isCompletionProof: false,
      },
    );

    try {
      const result = await provider.callTool(request);
      const envelope = evidenceLedger.collect(
        entity.entityId,
        "diagnostic_snapshot",
        "runtime-core.tool-provider-registry",
        [
          {
            itemId: `${request.callId}:execution`,
            label: "Tool invocation execution evidence",
            value: {
              callId: result.callId,
              status: result.status,
              startedAt: result.startedAt,
              finishedAt: result.finishedAt,
              evidenceCount: result.evidence.length,
            },
            capturedAt: Date.now(),
            metadata: { evidenceKind: "execution_evidence", isCompletionProof: false },
          },
        ],
        { metadata: { evidenceKind: "execution_evidence", isCompletionProof: false } },
      );
      lifecycleEngine.transition(entity.entityId, "evidence_collected", {
        actor: "runtime-core.tool-provider-registry",
        reason: "tool execution evidence collected",
        metadata: {
          callId: request.callId,
          status: result.status,
          evidenceKind: "execution_evidence",
          isCompletionProof: false,
        },
      });
      eventBus.emit(
        "tool.result",
        entity.entityId,
        "tool_invocation",
        {
          sourceId: "runtime-core.tool-provider-registry",
          sourceType: "tool",
          stage: "result",
        },
        {
          callId: result.callId,
          toolName: request.toolName,
          providerId: provider.manifest.id,
          status: result.status,
          evidenceKind: "execution_evidence",
          isCompletionProof: false,
        },
        [evidenceLedger.toRef(envelope)],
      );
      return result;
    } catch (error) {
      // [SPINE] Tool invocation failures are diagnostic records; legacy exception behavior is preserved.
      const failure = failureContract.create(entity.entityId, error, "tool_execution", undefined, {
        callId: request.callId,
        toolName: request.toolName,
        providerId: provider.manifest.id,
        diagnosticOnly: true,
      });
      lifecycleEngine.transition(entity.entityId, "failed", {
        actor: "runtime-core.tool-provider-registry",
        reason: "provider invocation failed",
        metadata: { callId: request.callId, failureId: failure.failureId },
      });
      eventBus.emit(
        "failure_classified",
        entity.entityId,
        "tool_invocation",
        { sourceId: "runtime-spine.failure-contract", sourceType: "failure", stage: "tool_execution" },
        failure,
        [failureContract.toRef(failure)],
      );
      throw error;
    }
  }
}

function emitToolInvocationGateDecision(entityId: string, decision: GateDecision): void {
  // [SPINE] Gate decisions are emitted for operator diagnostics only.
  eventBus.emit(
    "gate_decision",
    entityId,
    "tool_invocation",
    {
      sourceId: "runtime-spine.gate-engine",
      sourceType: "runtime_spine",
      stage: "pre_execution",
    },
    decision,
    [
      {
        refType: "gate_decision",
        gateId: decision.gateId,
        gateType: decision.gateType,
        status: decision.status,
        authority: decision.authority,
      },
    ],
  );
}

export function isolateRuntimeRegistryError(params: {
  surface: RuntimeRegistrySurface;
  providerId: string;
  error: unknown;
  reason?: RuntimeRegistryDiagnosticReason;
  retryable?: boolean;
  metadata?: RuntimeCoreJsonObject;
}): RuntimeRegistryIsolatedError {
  const message = params.error instanceof Error
    ? params.error.message
    : "Runtime registry provider failed with a non-error value.";
  const evidenceRefs: EvidenceRef[] = [
    {
      type: params.surface === "tool" ? "tool" : "other",
      ref: params.providerId,
      label: "Runtime registry isolated error",
      summary: message,
      metadata: { surface: params.surface },
    },
  ];
  const diagnostic: RuntimeRegistryDiagnostic = {
    surface: params.surface,
    providerId: params.providerId,
    status: "error",
    reason: params.reason ?? "provider_error",
    message,
    retryable: params.retryable === true,
    evidenceRefs,
    metadata: params.metadata,
  };
  return {
    isolated: true,
    diagnostic,
    error: {
      type: params.surface === "tool" ? "tool" : "context",
      message,
      retryable: params.retryable === true,
      evidenceRefs,
    },
  };
}

function positiveCollectorLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RUNTIME_REGISTRY_DIAGNOSTIC_COLLECTOR_LIMIT;
  }
  return Math.max(0, Math.min(128, Math.floor(value)));
}

function countBy<T extends string>(values: readonly T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function summarizeRegistryDiagnostics(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): RuntimeRegistryOmittedDiagnosticSummary {
  return {
    diagnosticCount: diagnostics.length,
    contextDiagnosticCount: diagnostics.filter((diagnostic) => diagnostic.surface === "context")
      .length,
    toolDiagnosticCount: diagnostics.filter((diagnostic) => diagnostic.surface === "tool").length,
    byStatus: countBy(diagnostics.map((diagnostic) => diagnostic.status)),
    byReason: countBy(diagnostics.map((diagnostic) => diagnostic.reason)),
  };
}

function compareRuntimeRegistryDiagnosticPriority(
  left: RuntimeRegistryDiagnostic,
  right: RuntimeRegistryDiagnostic,
): number {
  const reasonPriority = DIAGNOSTIC_REASON_PRIORITY[right.reason] -
    DIAGNOSTIC_REASON_PRIORITY[left.reason];
  if (reasonPriority !== 0) {
    return reasonPriority;
  }
  const statusPriority = DIAGNOSTIC_STATUS_PRIORITY[right.status] -
    DIAGNOSTIC_STATUS_PRIORITY[left.status];
  return statusPriority;
}

function prioritizeRuntimeRegistryDiagnostics(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): RuntimeRegistryDiagnostic[] {
  return diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort((left, right) =>
      compareRuntimeRegistryDiagnosticPriority(left.diagnostic, right.diagnostic) ||
      left.index - right.index
    )
    .map((item) => item.diagnostic);
}

function dedupeRegistryEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.ref}:${ref.label ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function collectRuntimeRegistryDiagnostics(
  input: RuntimeRegistryDiagnosticCollectorInput = {},
): RuntimeRegistryDiagnosticCollectorOutput {
  const allDiagnostics = [
    ...(input.contextDiagnostics ?? []),
    ...(input.toolDiagnostics ?? []),
    ...(input.diagnostics ?? []),
  ].filter(isRuntimeRegistryDiagnostic);
  const limit = positiveCollectorLimit(input.limit);
  const enabled = input.enabled === true;
  const candidateDiagnostics = input.prioritize === true
    ? prioritizeRuntimeRegistryDiagnostics(allDiagnostics)
    : allDiagnostics;
  const rawDiagnostics = enabled ? candidateDiagnostics.slice(0, limit) : [];
  const diagnostics = input.sanitize === true
    ? sanitizeRuntimeRegistryDiagnostics(rawDiagnostics)
    : rawDiagnostics;
  const omittedDiagnostics = enabled ? candidateDiagnostics.slice(limit) : candidateDiagnostics;

  return {
    schemaVersion: RUNTIME_REGISTRY_DIAGNOSTIC_COLLECTOR_SCHEMA_VERSION,
    enabled,
    diagnostics,
    omittedDiagnosticCount: omittedDiagnostics.length,
    omittedSummary: summarizeRegistryDiagnostics(omittedDiagnostics),
    evidenceRefs: dedupeRegistryEvidenceRefs(
      diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs),
    ),
    summary: {
      totalDiagnosticCount: allDiagnostics.length,
      includedDiagnosticCount: diagnostics.length,
      contextDiagnosticCount: diagnostics.filter((diagnostic) => diagnostic.surface === "context")
        .length,
      toolDiagnosticCount: diagnostics.filter((diagnostic) => diagnostic.surface === "tool")
        .length,
      byStatus: countBy(diagnostics.map((diagnostic) => diagnostic.status)),
      byReason: countBy(diagnostics.map((diagnostic) => diagnostic.reason)),
    },
    metadata: input.sanitize === true
      ? sanitizeRuntimeRegistryCollectorMetadata(input.metadata)
      : input.metadata,
  };
}

function controlledDiagnosticConsumerBlockedReasons(
  input: RuntimeRegistryControlledDiagnosticConsumerInput,
): RuntimeRegistryControlledDiagnosticConsumerGateReason[] {
  const reasons: RuntimeRegistryControlledDiagnosticConsumerGateReason[] = [];
  if (input.enabled !== true) {
    reasons.push("consumer_disabled");
  }
  const flags = input.featureFlags;
  if (!flags) {
    reasons.push("feature_flags_missing");
    return reasons;
  }
  if (!flags.registryDiagnosticsCollector) {
    reasons.push("registry_diagnostics_collector_disabled");
  }
  if (!flags.registryPilotEnabled) {
    reasons.push("registry_pilot_disabled");
  }
  if (!flags.providerRegistryShadow) {
    reasons.push("provider_registry_shadow_disabled");
  }
  if (!flags.contextProviderRegistryPilot) {
    reasons.push("context_provider_registry_pilot_disabled");
  }
  if (!flags.toolRegistryShadow) {
    reasons.push("tool_registry_shadow_disabled");
  }
  return reasons;
}

function normalizeRuntimeRegistryDiagnostics(
  diagnostics: readonly unknown[] | undefined,
): RuntimeRegistryDiagnostic[] {
  return (diagnostics ?? []).filter(isRuntimeRegistryDiagnostic);
}

function countInvalidRuntimeRegistryDiagnostics(
  diagnostics: readonly unknown[] | undefined,
): number {
  return (diagnostics ?? []).filter((diagnostic) => !isRuntimeRegistryDiagnostic(diagnostic))
    .length;
}

function boundedRuntimeRegistryEvidenceRefLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return RUNTIME_REGISTRY_CONTROLLED_REPORT_MAX_EVIDENCE_REFS;
  }
  return Math.max(0, Math.min(32, Math.floor(value)));
}

function summarizeControlledDiagnosticActionability(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): RuntimeRegistryControlledDiagnosticConsumerReport["actionability"] {
  const byCategory: Partial<Record<RuntimeRegistryControlledDiagnosticActionability, number>> = {};
  for (const diagnostic of diagnostics) {
    const category = RUNTIME_REGISTRY_CONTROLLED_ACTIONABILITY_BY_REASON[diagnostic.reason];
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }

  return {
    actionableDiagnosticCount: byCategory.actionable ?? 0,
    noiseDiagnosticCount: byCategory.noise ?? 0,
    reviewRequiredDiagnosticCount: byCategory.review_required ?? 0,
    byCategory,
  };
}

function controlledDiagnosticConsumerReportStatus(
  output: RuntimeRegistryControlledDiagnosticConsumerOutput,
): RuntimeRegistryControlledDiagnosticConsumerReportStatus {
  if (!output.enabled) {
    return "disabled";
  }
  if (output.summary.totalDiagnosticCount === 0) {
    return "no_diagnostics";
  }
  return "diagnostics_only_operator_summary";
}

export function collectRuntimeRegistryDiagnosticsForControlledConsumer(
  input: RuntimeRegistryControlledDiagnosticConsumerInput = {},
): RuntimeRegistryControlledDiagnosticConsumerOutput {
  const blockedReasons = controlledDiagnosticConsumerBlockedReasons(input);
  const enabled = blockedReasons.length === 0;
  const limit = positiveCollectorLimit(input.limit);
  const collectorOutput = collectRuntimeRegistryDiagnostics({
    enabled,
    limit,
    prioritize: true,
    sanitize: true,
    contextDiagnostics: input.contextDiagnostics,
    toolDiagnostics: input.toolDiagnostics,
    diagnostics: input.diagnostics,
    metadata: input.metadata,
  });

  return {
    ...collectorOutput,
    consumer: {
      schemaVersion: RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_SCHEMA_VERSION,
      mode: RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_MODE,
      enabled,
      gateStatus: enabled ? "open" : "closed",
      blockedReasons,
      sanitized: true,
      prioritized: true,
      inMemoryOnly: true,
      diagnosticsOnly: true,
      authoritativeness: "none",
      legacyDecisionUnaffected: true,
      finalTaskStatusUnaffected: true,
      limit,
      requiredFlags: [...RUNTIME_REGISTRY_CONTROLLED_CONSUMER_REQUIRED_FLAGS],
    },
  };
}

export function buildProviderToolRegistryControlledDiagnosticConsumerReport(
  input: RuntimeRegistryControlledDiagnosticConsumerReportInput = {},
): RuntimeRegistryControlledDiagnosticConsumerReport {
  const contextDiagnostics = normalizeRuntimeRegistryDiagnostics(input.contextDiagnostics);
  const toolDiagnostics = normalizeRuntimeRegistryDiagnostics(input.toolDiagnostics);
  const diagnostics = normalizeRuntimeRegistryDiagnostics(input.diagnostics);
  const invalidDiagnosticCount =
    countInvalidRuntimeRegistryDiagnostics(input.contextDiagnostics) +
    countInvalidRuntimeRegistryDiagnostics(input.toolDiagnostics) +
    countInvalidRuntimeRegistryDiagnostics(input.diagnostics);
  const output = collectRuntimeRegistryDiagnosticsForControlledConsumer({
    enabled: input.enabled,
    featureFlags: input.featureFlags,
    limit: input.limit,
    contextDiagnostics,
    toolDiagnostics,
    diagnostics,
    metadata: input.metadata,
  });
  const maxEvidenceRefs = boundedRuntimeRegistryEvidenceRefLimit(input.maxEvidenceRefs);

  return {
    schemaVersion: RUNTIME_REGISTRY_CONTROLLED_DIAGNOSTIC_CONSUMER_SCHEMA_VERSION,
    decision: {
      status: controlledDiagnosticConsumerReportStatus(output),
      diagnosticsOnly: true,
      operatorSummaryOnly: true,
      authoritative: false,
    },
    enabled: output.enabled,
    gateStatus: output.consumer.gateStatus,
    blockedReasons: output.consumer.blockedReasons,
    totalDiagnosticCount: output.summary.totalDiagnosticCount,
    includedDiagnosticCount: output.summary.includedDiagnosticCount,
    omittedDiagnosticCount: output.omittedDiagnosticCount,
    invalidDiagnosticCount,
    byStatus: output.summary.byStatus,
    byReason: output.summary.byReason,
    actionability: summarizeControlledDiagnosticActionability(output.diagnostics),
    evidenceRefs: output.evidenceRefs.slice(0, maxEvidenceRefs),
    metadata: output.metadata,
    authority: RUNTIME_REGISTRY_CONTROLLED_REPORT_AUTHORITY,
  };
}

export function buildRuntimeContextProviderManifestFixture(
  overrides: Partial<RuntimeContextProviderManifest> = {},
): RuntimeContextProviderManifest {
  return {
    id: "legacy-context-engine",
    kind: "context",
    title: "Legacy context compatibility provider",
    source: "legacy",
    capabilities: ["context.legacy", "context.messages"],
    priority: 0,
    order: 0,
    permission: {
      decision: "allow",
      capability: "context.legacy",
      reason: "Compatibility provider remains shadow-only in Phase 3.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative", "provider_error"],
    evidenceRefs: [{ type: "file", ref: "openclaw_runtime/src/context-engine/legacy.ts" }],
    outputKinds: ["message", "summary"],
    dependsOnIndexing: false,
    ...overrides,
  };
}

export function buildRuntimeToolProviderManifestFixture(
  overrides: Partial<RuntimeToolProviderManifest> = {},
): RuntimeToolProviderManifest {
  return {
    id: "mcp-call-tool-compat",
    kind: "tool",
    title: "MCP callTool compatibility provider",
    source: "mcp",
    capabilities: ["tool.mcp.callTool"],
    priority: 0,
    order: 0,
    permission: {
      decision: "ask",
      capability: "tool.mcp",
      reason: "Preserve existing MCP approval semantics.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative", "provider_error", "policy_denied"],
    evidenceRefs: [{ type: "file", ref: "electron/services/mcp-api.ts" }],
    toolNames: ["mcp.callTool"],
    parameterSchema: { type: "object", properties: {} },
    resultStatuses: [...TOOL_CALL_RESULT_STATUSES],
    ...overrides,
  };
}
