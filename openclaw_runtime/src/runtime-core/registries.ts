import type { EvidenceRef } from "./evidence.js";
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
} as const;

export type RuntimeRegistryFeatureFlag = keyof typeof RUNTIME_REGISTRY_FLAG_PATHS;

export type RuntimeRegistryFeatureFlags = Record<RuntimeRegistryFeatureFlag, boolean>;

export const DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS = {
  registryPilotEnabled: false,
  providerRegistryShadow: false,
  contextProviderRegistryPilot: false,
  toolRegistryShadow: false,
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
  "denied",
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
  "policy_denied",
  "provider_error",
  "timeout",
  "no_result",
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
