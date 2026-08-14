import { randomUUID } from "node:crypto";
import type { AgentToolUpdateCallback } from "../../agents/runtime/index.js";
import { normalizeArchiveHandle } from "../../../../shared/types/context-family.js";
import { computeBackoff, sleepWithAbort, type BackoffPolicy } from "../../infra/backoff.js";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitBreakerOptions,
  type CircuitBreakerSnapshot,
} from "../../infra/circuit-breaker.js";
import {
  canonicalizeMetadataValue,
  hashCapabilityMetadata,
  validateCapabilityDescriptor,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";
import {
  createCapabilityProviderNativeRequest,
  parseCapabilityProviderNativeEvent,
  serializeCapabilityProviderNativeRequest,
  serializeCapabilityProviderNativeResponse,
  CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION,
  isCapabilityProviderNativeCorrelationId,
  matchesCapabilityProviderNativeCorrelation,
  type CapabilityProviderNativeEvent,
  type CapabilityProviderNativeResponse,
  type CapabilityProviderNativeTarget,
} from "./provider-native-protocol-v3.js";
import {
  CapabilityToolExecutionError,
  CapabilityToolExecutionService,
  type CapabilityToolExecutionEffectState,
} from "./tool-execution-v3.js";
import { CapabilityUnifiedResolver } from "./unified-resolver.js";
import {
  CAPABILITY_RESULT_POINTER_SCHEMA_VERSION,
  type CapabilityResultPointer,
} from "./result-pointer.js";

export type CapabilityProviderNativeAllowlistEntry = CapabilityProviderNativeTarget;

export type CapabilityProviderNativeProbe = {
  supported: boolean;
  protocolVersion?: string;
};

export type CapabilityProviderDeferredOwner = {
  run(params: {
    request: string;
    signal: AbortSignal;
    handleEvent(event: unknown): Promise<string>;
  }): Promise<unknown>;
};

export type CapabilityProviderNativeOwner = CapabilityProviderDeferredOwner & {
  probe(params: CapabilityProviderNativeTarget & { signal?: AbortSignal }): Promise<CapabilityProviderNativeProbe>;
};

export class CapabilityProviderNativeOwnerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Capability provider-native owner failed: ${code}`);
    this.name = "CapabilityProviderNativeOwnerError";
  }
}

export type CapabilityProviderNativePolicy = {
  timeoutMs: number;
  maxAttempts: number;
  maxRememberedRequests: number;
  backoff: BackoffPolicy;
  circuitBreaker: CircuitBreakerOptions;
};

export type CapabilityProviderNativeAdapterInput = {
  /** Explicit opt-in. There is no application config or default caller. */
  enabled?: boolean;
  target: CapabilityProviderNativeTarget;
  allowlist: readonly CapabilityProviderNativeAllowlistEntry[];
  resolver: CapabilityUnifiedResolver;
  execution: CapabilityToolExecutionService;
  nativeOwner: CapabilityProviderNativeOwner;
  proxyOwner?: CapabilityProviderDeferredOwner;
  policy: CapabilityProviderNativePolicy;
  requestIdFactory?: () => string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type CapabilityProviderNativeRunInput = {
  query: string;
  limit?: number;
  requestId?: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback;
};

export type CapabilityProviderNativeRunResult =
  | {
      ok: true;
      topology: "native" | "proxy";
      requestId: string;
      value: CapabilityProviderNativeResponseProjection;
      attempts: number;
      fallbackReason?: string;
    }
  | {
      ok: false;
      failure: {
        code:
          | "provider-native-disabled"
          | "invalid-request"
          | "request-id-conflict"
          | "request-capacity-exhausted"
          | "native-aborted"
          | "native-side-effect-uncertain"
          | "proxy-unavailable"
          | "provider-native-failed";
        message: string;
        effectState: CapabilityToolExecutionEffectState;
      };
    };

type CapabilityProviderNativeFailureCode =
  | "provider-native-disabled"
  | "invalid-request"
  | "request-id-conflict"
  | "request-capacity-exhausted"
  | "native-aborted"
  | "native-side-effect-uncertain"
  | "proxy-unavailable"
  | "provider-native-failed";

export type CapabilityProviderNativeSnapshot = {
  runs: number;
  nativeRuns: number;
  proxyRuns: number;
  nativeFailures: number;
  fallbacks: number;
  retries: number;
  replayHits: number;
  circuitBreaker: CircuitBreakerSnapshot;
};

type RunRecord = {
  fingerprint: string;
  promise: Promise<CapabilityProviderNativeRunResult>;
};

type EventRecord = {
  fingerprint: string;
  promise: Promise<string>;
};

type RunState = {
  effectState: CapabilityToolExecutionEffectState;
  eventRecords: Map<string, EventRecord>;
};

type RunSession = {
  request: string;
  correlationId: string;
  state: RunState;
};

type CapabilityProviderNativeLoadedProjection =
  | { kind: "skill"; descriptor: CapabilityDescriptor }
  | { kind: "tool"; descriptor: CapabilityDescriptor; schemaHash: string }
  | { kind: "context"; descriptor: CapabilityDescriptor };

type CapabilityProviderNativeDiscoveryProjection = {
  capabilities: CapabilityDescriptor[];
  fallbackUsed: boolean;
  resolverHash: string;
};

type CapabilityProviderNativePointerProjection = { pointer: CapabilityResultPointer };

type CapabilityProviderNativeControlledResponse = {
  schemaVersion: typeof CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION;
  requestId: string;
  correlationId?: string;
  ok: boolean;
  value?:
    | CapabilityProviderNativeDiscoveryProjection
    | CapabilityProviderNativeLoadedProjection
    | CapabilityDescriptor[]
    | CapabilityDescriptor
    | CapabilityProviderNativePointerProjection;
  failure?: {
    code: string;
    effectState: CapabilityToolExecutionEffectState;
  };
};

/** Closed response shapes that a provider owner may return to V3 callers. */
export type CapabilityProviderNativeResponseProjection =
  | CapabilityProviderNativeControlledResponse
  | CapabilityProviderNativePointerProjection
  | {
      native?: string | boolean;
      proxy?: string | boolean;
      topology?: "native" | "proxy";
      status?: string;
      reason?: string;
      attempts?: number;
      fallbackReason?: string;
      requestId?: string;
      correlationId?: string;
      searched?: CapabilityProviderNativeControlledResponse;
      described?: CapabilityProviderNativeControlledResponse;
      called?: CapabilityProviderNativeControlledResponse;
      replayed?: CapabilityProviderNativeControlledResponse;
      response?: CapabilityProviderNativeControlledResponse;
    };

class CapabilityProviderNativeTimeoutError extends CapabilityProviderNativeOwnerError {
  constructor() {
    super("native-timeout", false);
    this.name = "CapabilityProviderNativeTimeoutError";
  }
}

class CapabilityProviderNativeAbortError extends Error {
  constructor() {
    super("Capability provider-native run was aborted");
    this.name = "CapabilityProviderNativeAbortError";
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTarget(target: CapabilityProviderNativeTarget): boolean {
  return [target.providerId, target.modelId, target.workflowNamespace].every(
    (value) => typeof value === "string" && value.trim() === value && value.length > 0 && !value.includes("*"),
  );
}

function targetAllowed(
  target: CapabilityProviderNativeTarget,
  allowlist: readonly CapabilityProviderNativeAllowlistEntry[],
): boolean {
  return (
    validTarget(target) &&
    allowlist.some(
      (entry) =>
        validTarget(entry) &&
        entry.providerId === target.providerId &&
        entry.modelId === target.modelId &&
        entry.workflowNamespace === target.workflowNamespace,
    )
  );
}

function maxEffectState(
  left: CapabilityToolExecutionEffectState,
  right: CapabilityToolExecutionEffectState,
): CapabilityToolExecutionEffectState {
  const rank = { not_started: 0, completed: 1, unknown: 2 } as const;
  return rank[right] > rank[left] ? right : left;
}

const PROVIDER_NATIVE_METADATA_KEYS = new Set([
  "native",
  "proxy",
  "topology",
  "status",
  "reason",
  "attempts",
  "fallbackReason",
  "requestId",
  "correlationId",
  "searched",
  "described",
  "called",
  "replayed",
  "response",
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_PROJECTION_STRING_LENGTH = 4_096;
const MAX_PROJECTION_ENTRIES = 100;
const SAFE_METADATA_TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalizeMetadataValue(value)) as T;
}

function boundedString(value: unknown, maxLength = MAX_PROJECTION_STRING_LENGTH): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function projectDescriptor(value: unknown): CapabilityDescriptor | undefined {
  const validation = validateCapabilityDescriptor(value);
  if (!validation.ok) {
    return undefined;
  }
  try {
    return canonicalClone(value as CapabilityDescriptor);
  } catch {
    return undefined;
  }
}

function projectPointer(value: unknown): CapabilityProviderNativePointerProjection | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "pointer")) {
    return undefined;
  }
  const pointer = value.pointer;
  if (!isRecord(pointer)) {
    return undefined;
  }
  const allowedKeys = new Set([
    "schemaVersion",
    "pointerId",
    "capabilityId",
    "sessionId",
    "taskId",
    "summary",
    "archiveHandle",
    "requiredPermissions",
    "createdAt",
    "expiresAt",
  ]);
  if (Object.keys(pointer).some((key) => !allowedKeys.has(key))) {
    return undefined;
  }
  if (
    pointer.schemaVersion !== CAPABILITY_RESULT_POINTER_SCHEMA_VERSION ||
    !boundedString(pointer.pointerId, 128) ||
    !/^resultptr_[a-f0-9]{64}$/.test(pointer.pointerId) ||
    !boundedString(pointer.capabilityId, 320) ||
    !boundedString(pointer.sessionId, 256) ||
    (pointer.taskId !== undefined && !boundedString(pointer.taskId, 256)) ||
    !boundedString(pointer.summary, MAX_PROJECTION_STRING_LENGTH) ||
    !Array.isArray(pointer.requiredPermissions) ||
    pointer.requiredPermissions.length > 64 ||
    pointer.requiredPermissions.some((permission) => !boundedString(permission, 128)) ||
    !boundedString(pointer.createdAt, 64) ||
    !boundedString(pointer.expiresAt, 64) ||
    !isRecord(pointer.archiveHandle)
  ) {
    return undefined;
  }
  const archiveKeys = new Set(["uri", "checksum", "byteLength", "source", "createdAt"]);
  if (Object.keys(pointer.archiveHandle).some((key) => !archiveKeys.has(key))) {
    return undefined;
  }
  if (
    !boundedString(pointer.archiveHandle.uri, 512) ||
    !/^context-archive:\/\/[^\s]+$/.test(pointer.archiveHandle.uri) ||
    !boundedString(pointer.archiveHandle.checksum, 80) ||
    !HASH_PATTERN.test(pointer.archiveHandle.checksum) ||
    typeof pointer.archiveHandle.byteLength !== "number" ||
    !Number.isInteger(pointer.archiveHandle.byteLength) ||
    pointer.archiveHandle.byteLength < 0
  ) {
    return undefined;
  }
  try {
    const archiveHandle = normalizeArchiveHandle(pointer.archiveHandle);
    return {
      pointer: canonicalClone({
        ...(pointer as CapabilityResultPointer),
        archiveHandle,
      }),
    };
  } catch {
    return undefined;
  }
}

function projectLoadedValue(value: unknown): CapabilityProviderNativeLoadedProjection | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, "kind") || !Object.hasOwn(value, "descriptor")) {
    return undefined;
  }
  const descriptor = projectDescriptor(value.descriptor);
  if (!descriptor || (value.kind !== "skill" && value.kind !== "tool" && value.kind !== "context")) {
    return undefined;
  }
  if (value.kind === "tool") {
    if (
      Object.keys(value).some((key) => !["kind", "descriptor", "schema", "schemaHash"].includes(key)) ||
      !boundedString(value.schemaHash, 80) ||
      !HASH_PATTERN.test(value.schemaHash)
    ) {
      return undefined;
    }
    return { kind: "tool", descriptor, schemaHash: value.schemaHash };
  }
  if (Object.keys(value).some((key) => !["kind", "descriptor", "content"].includes(key))) {
    return undefined;
  }
  return value.kind === "skill" ? { kind: "skill", descriptor } : { kind: "context", descriptor };
}

function projectDiscovery(value: unknown): CapabilityProviderNativeDiscoveryProjection | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["capabilities", "fallbackUsed", "resolverHash"].includes(key)) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > MAX_PROJECTION_ENTRIES ||
    typeof value.fallbackUsed !== "boolean" ||
    !boundedString(value.resolverHash, 80) ||
    !HASH_PATTERN.test(value.resolverHash)
  ) {
    return undefined;
  }
  const capabilities = value.capabilities.map(projectDescriptor);
  if (capabilities.some((descriptor) => descriptor === undefined)) {
    return undefined;
  }
  return {
    capabilities: capabilities as CapabilityDescriptor[],
    fallbackUsed: value.fallbackUsed,
    resolverHash: value.resolverHash,
  };
}

function projectControlledValue(
  value: unknown,
):
  | CapabilityProviderNativeDiscoveryProjection
  | CapabilityProviderNativeLoadedProjection
  | CapabilityDescriptor[]
  | CapabilityDescriptor
  | CapabilityProviderNativePointerProjection
  | undefined {
  if (Array.isArray(value)) {
    if (value.length > MAX_PROJECTION_ENTRIES) {
      return undefined;
    }
    const descriptors = value.map(projectDescriptor);
    return descriptors.every((descriptor) => descriptor !== undefined)
      ? (descriptors as CapabilityDescriptor[])
      : undefined;
  }
  return (
    projectPointer(value) ??
    projectDiscovery(value) ??
    projectLoadedValue(value) ??
    projectDescriptor(value)
  );
}

function projectControlledResponse(value: unknown): CapabilityProviderNativeControlledResponse | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["schemaVersion", "requestId", "correlationId", "ok", "value", "failure"].includes(key)) ||
    value.schemaVersion !== CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION ||
    !boundedString(value.requestId, 128) ||
    !REQUEST_ID_PATTERN.test(value.requestId) ||
    (value.correlationId !== undefined && !isCapabilityProviderNativeCorrelationId(value.correlationId)) ||
    typeof value.ok !== "boolean"
  ) {
    return undefined;
  }
  if (value.ok === false) {
    if (!isRecord(value.failure) || Object.keys(value.failure).some((key) => !["code", "effectState"].includes(key))) {
      return undefined;
    }
    if (
      !boundedString(value.failure.code, 128) ||
      !SAFE_METADATA_TOKEN_PATTERN.test(value.failure.code) ||
      !["not_started", "unknown", "completed"].includes(value.failure.effectState as string)
    ) {
      return undefined;
    }
    return {
      schemaVersion: CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION,
      requestId: value.requestId,
      ...(value.correlationId !== undefined ? { correlationId: value.correlationId } : {}),
      ok: false,
      failure: { code: value.failure.code, effectState: value.failure.effectState as CapabilityToolExecutionEffectState },
    };
  }
  const projectedValue = value.value === undefined ? undefined : projectControlledValue(value.value);
  if (value.failure !== undefined || (value.value !== undefined && !projectedValue)) {
    return undefined;
  }
  return {
    schemaVersion: CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION,
    requestId: value.requestId,
    ...(value.correlationId !== undefined ? { correlationId: value.correlationId } : {}),
    ok: true,
    ...(projectedValue !== undefined ? { value: projectedValue } : {}),
  };
}

function acceptsProjectedResponseCorrelation(
  response: CapabilityProviderNativeControlledResponse,
  correlation: {
    requestId: string;
    correlationId: string;
    acceptedEventRequestIds?: ReadonlySet<string>;
  },
): boolean {
  if (!matchesCapabilityProviderNativeCorrelation({ response, requestId: correlation.requestId, correlationId: correlation.correlationId })) {
    const acceptedEvent =
      correlation.acceptedEventRequestIds?.has(response.requestId) === true &&
      (response.correlationId === undefined || response.correlationId === correlation.correlationId);
    if (!acceptedEvent) {
      return false;
    }
  }
  return response.requestId !== correlation.requestId || response.correlationId !== undefined;
}

function projectProviderNativeResponse(
  value: unknown,
  correlation?: {
    requestId: string;
    correlationId: string;
    acceptedEventRequestIds?: ReadonlySet<string>;
  },
): CapabilityProviderNativeResponseProjection | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (correlation && !matchesCapabilityProviderNativeCorrelation({ response: candidate, ...correlation })) {
    const candidateRecord = isRecord(candidate) ? candidate : undefined;
    const candidateRequestId = candidateRecord && typeof candidateRecord.requestId === "string"
      ? candidateRecord.requestId
      : undefined;
    const acceptedEvent =
      candidateRequestId !== undefined &&
      correlation.acceptedEventRequestIds?.has(candidateRequestId) === true &&
      (candidateRecord?.correlationId === undefined || candidateRecord?.correlationId === correlation.correlationId);
    if (!acceptedEvent) {
      return undefined;
    }
  }
  const controlled = projectControlledResponse(candidate);
  if (controlled) {
    if (correlation && !acceptsProjectedResponseCorrelation(controlled, correlation)) {
      return undefined;
    }
    return controlled;
  }
  const pointer = projectPointer(candidate);
  if (pointer) {
    return pointer;
  }
  if (
    !isRecord(candidate) ||
    Object.keys(candidate).length === 0 ||
    Object.keys(candidate).some((key) => !PROVIDER_NATIVE_METADATA_KEYS.has(key))
  ) {
    return undefined;
  }
  const projection: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (["searched", "described", "called", "replayed", "response"].includes(key)) {
      const response = projectControlledResponse(entry);
      if (!response) {
        return undefined;
      }
      if (correlation && !acceptsProjectedResponseCorrelation(response, correlation)) {
        return undefined;
      }
      projection[key] = response;
      continue;
    }
    if (key === "topology" && entry !== "native" && entry !== "proxy") {
      return undefined;
    }
    if (
      ["status", "reason", "fallbackReason"].includes(key) &&
      (typeof entry !== "string" || !SAFE_METADATA_TOKEN_PATTERN.test(entry))
    ) {
      return undefined;
    }
    if (key === "requestId" && (typeof entry !== "string" || !REQUEST_ID_PATTERN.test(entry))) {
      return undefined;
    }
    if (key === "correlationId" && (typeof entry !== "string" || !HASH_PATTERN.test(entry))) {
      return undefined;
    }
    if (
      (typeof entry !== "string" && typeof entry !== "boolean" && typeof entry !== "number") ||
      (typeof entry === "string" && !boundedString(entry)) ||
      (typeof entry === "number" && (!Number.isFinite(entry) || entry < 0 || entry > 1_000_000))
    ) {
      return undefined;
    }
    projection[key] = entry;
  }
  return projection as CapabilityProviderNativeResponseProjection;
}

function safeFallbackReason(value: string): string {
  return SAFE_METADATA_TOKEN_PATTERN.test(value) ? value : "native-owner-failed";
}

function failure(
  code: CapabilityProviderNativeFailureCode,
  effectState: CapabilityToolExecutionEffectState,
): CapabilityProviderNativeRunResult {
  return {
    ok: false,
    failure: {
      code,
      message: "Capability Registry V3 provider-native execution failed",
      effectState,
    },
  };
}

/** Default-disabled deferred-loading adapter over caller-owned provider transport. */
export class CapabilityProviderNativeAdapter {
  readonly #breaker: CircuitBreaker;
  readonly #runs = new Map<string, RunRecord>();
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  #metrics = {
    runs: 0,
    nativeRuns: 0,
    proxyRuns: 0,
    nativeFailures: 0,
    fallbacks: 0,
    retries: 0,
    replayHits: 0,
  };

  constructor(private readonly input: CapabilityProviderNativeAdapterInput) {
    if (
      !isPositiveInteger(input.policy.timeoutMs) ||
      !isPositiveInteger(input.policy.maxAttempts) ||
      !isPositiveInteger(input.policy.maxRememberedRequests)
    ) {
      throw new Error("Capability provider-native policy bounds must be positive integers");
    }
    this.#breaker = new CircuitBreaker(input.policy.circuitBreaker);
    this.#sleep = input.sleep ?? sleepWithAbort;
  }

  run(params: CapabilityProviderNativeRunInput): Promise<CapabilityProviderNativeRunResult> {
    if (this.input.enabled !== true) {
      return Promise.resolve(failure("provider-native-disabled", "not_started"));
    }
    if (!isRecord(params)) {
      return Promise.resolve(failure("invalid-request", "not_started"));
    }
    if (
      typeof params.query !== "string" ||
      params.query.length > 4_096 ||
      (params.limit !== undefined &&
        (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100))
    ) {
      return Promise.resolve(failure("invalid-request", "not_started"));
    }
    const requestId = params.requestId === undefined
      ? (this.input.requestIdFactory ?? (() => `capnative_${randomUUID()}`))()
      : params.requestId;
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
      return Promise.resolve(failure("invalid-request", "not_started"));
    }
    const fingerprint = hashCapabilityMetadata({ query: params.query, limit: params.limit ?? null });
    const existing = this.#runs.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.resolve(failure("request-id-conflict", "not_started"));
      }
      this.#metrics.replayHits += 1;
      return existing.promise;
    }
    if (this.#runs.size >= this.input.policy.maxRememberedRequests) {
      return Promise.resolve(failure("request-capacity-exhausted", "not_started"));
    }
    const promise = this.#runOnce({ ...params, requestId });
    this.#runs.set(requestId, { fingerprint, promise });
    return promise;
  }

  snapshot(): CapabilityProviderNativeSnapshot {
    return {
      ...this.#metrics,
      circuitBreaker: this.#breaker.getSnapshot(),
    };
  }

  async #runOnce(
    params: CapabilityProviderNativeRunInput & { requestId: string },
  ): Promise<CapabilityProviderNativeRunResult> {
    this.#metrics.runs += 1;
    if (params.signal?.aborted) {
      return failure("native-aborted", "not_started");
    }
    if (!targetAllowed(this.input.target, this.input.allowlist)) {
      return await this.#fallback(params, "native-not-allowlisted");
    }
    if (this.#breaker.getState() === "open") {
      return await this.#fallback(params, "native-circuit-open");
    }

    let probe: unknown;
    try {
      probe = await this.input.nativeOwner.probe({
        ...this.input.target,
        ...(params.signal ? { signal: params.signal } : {}),
      });
    } catch {
      if (params.signal?.aborted) {
        return failure("native-aborted", "not_started");
      }
      return await this.#fallback(params, "native-probe-failed");
    }
    if (params.signal?.aborted) {
      return failure("native-aborted", "not_started");
    }
    if (!isRecord(probe) || typeof probe.supported !== "boolean") {
      return await this.#fallback(params, "native-probe-failed");
    }
    if (probe.supported !== true) {
      return await this.#fallback(params, "native-unsupported");
    }

    const session = await this.#createRunSession(params);
    if (!session.ok) {
      return session.result;
    }
    if (params.signal?.aborted) {
      return failure("native-aborted", session.state.effectState);
    }
    try {
      const result = await this.#breaker.executeAsync(async () =>
        await this.#runNativeAttempts(params, session.request, session.state),
      );
      if (params.signal?.aborted) {
        return failure("native-aborted", session.state.effectState);
      }
      const projected = projectProviderNativeResponse(result.value, {
        requestId: params.requestId,
        correlationId: session.correlationId,
        acceptedEventRequestIds: new Set(session.state.eventRecords.keys()),
      });
      if (!projected) {
        this.#metrics.nativeFailures += 1;
        session.state.effectState = maxEffectState(session.state.effectState, "unknown");
        return failure("provider-native-failed", session.state.effectState);
      }
      this.#metrics.nativeRuns += 1;
      return {
        ok: true,
        topology: "native",
        requestId: params.requestId,
        value: projected,
        attempts: result.attempts,
      };
    } catch (error) {
      this.#metrics.nativeFailures += 1;
      if (params.signal?.aborted || error instanceof CapabilityProviderNativeAbortError) {
        return failure("native-aborted", session.state.effectState);
      }
      if (session.state.effectState !== "not_started") {
        return failure("native-side-effect-uncertain", session.state.effectState);
      }
      const reason = safeFallbackReason(
        error instanceof CircuitBreakerOpenError
          ? "native-circuit-open"
          : error instanceof CapabilityProviderNativeTimeoutError
            ? "native-timeout"
            : error instanceof CapabilityProviderNativeOwnerError
              ? error.code
              : "native-owner-failed",
      );
      return await this.#runProxyOwner(params, session.request, session.state, reason, session.correlationId);
    }
  }

  async #fallback(
    params: CapabilityProviderNativeRunInput & { requestId: string },
    reason: string,
  ): Promise<CapabilityProviderNativeRunResult> {
    const session = await this.#createRunSession(params);
    if (!session.ok) {
      return session.result;
    }
    if (params.signal?.aborted) {
      return failure("native-aborted", session.state.effectState);
    }
    return await this.#runProxyOwner(params, session.request, session.state, reason, session.correlationId);
  }

  async #createRunSession(
    params: CapabilityProviderNativeRunInput & { requestId: string },
  ): Promise<
    | ({ ok: true } & RunSession)
    | { ok: false; result: CapabilityProviderNativeRunResult }
  > {
    let discovered: Awaited<ReturnType<CapabilityUnifiedResolver["discover"]>>;
    try {
      discovered = await this.input.resolver.discover({
        query: params.query,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        kind: "tool",
      });
    } catch {
      if (params.signal?.aborted) {
        return { ok: false, result: failure("native-aborted", "not_started") };
      }
      return { ok: false, result: failure("provider-native-failed", "not_started") };
    }
    if (params.signal?.aborted) {
      return { ok: false, result: failure("native-aborted", "not_started") };
    }
    if (!discovered.ok) {
      return { ok: false, result: failure("provider-native-failed", "not_started") };
    }
    try {
      const request = serializeCapabilityProviderNativeRequest(
        createCapabilityProviderNativeRequest({
          requestId: params.requestId,
          target: this.input.target,
          query: params.query,
          navigation: discovered.value.capabilities,
        }),
      );
      if (params.signal?.aborted) {
        return { ok: false, result: failure("native-aborted", "not_started") };
      }
      return {
        ok: true,
        request,
        correlationId: hashCapabilityMetadata({ requestId: params.requestId, target: this.input.target }),
        state: { effectState: "not_started", eventRecords: new Map() },
      };
    } catch {
      return { ok: false, result: failure("provider-native-failed", "not_started") };
    }
  }

  async #runNativeAttempts(
    params: CapabilityProviderNativeRunInput & { requestId: string },
    request: string,
    state: RunState,
  ): Promise<{ value: unknown; attempts: number }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.input.policy.maxAttempts; attempt += 1) {
      try {
        if (params.signal?.aborted) {
          throw new CapabilityProviderNativeAbortError();
        }
        const value = await this.#runOwner(this.input.nativeOwner, params, request, state);
        return { value, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!(error instanceof CapabilityProviderNativeOwnerError)) {
          state.effectState = maxEffectState(state.effectState, "unknown");
        }
        const retryable =
          state.effectState === "not_started" &&
          error instanceof CapabilityProviderNativeOwnerError &&
          error.retryable;
        if (!retryable || attempt >= this.input.policy.maxAttempts) {
          throw error;
        }
        this.#metrics.retries += 1;
        await this.#sleep(computeBackoff(this.input.policy.backoff, attempt), params.signal);
      }
    }
    throw lastError;
  }

  async #runProxyOwner(
    params: CapabilityProviderNativeRunInput & { requestId: string },
    request: string,
    state: RunState,
    reason: string,
    correlationId: string,
  ): Promise<CapabilityProviderNativeRunResult> {
    if (!this.input.proxyOwner) {
      return failure("proxy-unavailable", state.effectState);
    }
    if (params.signal?.aborted) {
      return failure("native-aborted", state.effectState);
    }
    this.#metrics.fallbacks += 1;
    try {
      const value = await this.#runOwner(this.input.proxyOwner, params, request, state);
      if (params.signal?.aborted) {
        return failure("native-aborted", state.effectState);
      }
      const projected = projectProviderNativeResponse(value, {
        requestId: params.requestId,
        correlationId,
      });
      if (!projected) {
        state.effectState = maxEffectState(state.effectState, "unknown");
        return failure("provider-native-failed", state.effectState);
      }
      this.#metrics.proxyRuns += 1;
      return {
        ok: true,
        topology: "proxy",
        requestId: params.requestId,
        value: projected,
        attempts: 1,
        fallbackReason: safeFallbackReason(reason),
      };
    } catch (error) {
      if (params.signal?.aborted || error instanceof CapabilityProviderNativeAbortError) {
        return failure("native-aborted", state.effectState);
      }
      return failure("provider-native-failed", state.effectState);
    }
  }

  async #runOwner(
    owner: CapabilityProviderDeferredOwner,
    params: CapabilityProviderNativeRunInput & { requestId: string },
    request: string,
    state: RunState,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(params.signal?.reason);
    params.signal?.addEventListener("abort", abortFromParent, { once: true });
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      // AbortSignal listeners do not fire retroactively. Propagate an already
      // aborted parent before invoking an owner, then check again at the
      // exact call boundary so a cancelled request cannot start transport.
      if (params.signal?.aborted) {
        controller.abort(params.signal.reason);
      }
      if (controller.signal.aborted) {
        throw new CapabilityProviderNativeAbortError();
      }
      timeout = setTimeout(() => {
        timedOut = true;
        state.effectState = maxEffectState(state.effectState, "unknown");
        controller.abort(new CapabilityProviderNativeTimeoutError());
      }, this.input.policy.timeoutMs);
      if (params.signal?.aborted || controller.signal.aborted) {
        throw new CapabilityProviderNativeAbortError();
      }
      const ownerPromise = owner.run({
        request,
        signal: controller.signal,
        handleEvent: async (event) =>
          await this.#handleEvent(event, state, controller.signal, params.onUpdate),
      });
      const abortPromise = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          reject(timedOut ? new CapabilityProviderNativeTimeoutError() : new CapabilityProviderNativeAbortError());
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) {
          onAbort();
        }
      });
      return await Promise.race([ownerPromise, abortPromise]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      params.signal?.removeEventListener("abort", abortFromParent);
      if (onAbort) {
        controller.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async #handleEvent(
    rawEvent: unknown,
    state: RunState,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback | undefined,
  ): Promise<string> {
    const parsed = parseCapabilityProviderNativeEvent(rawEvent);
    if (!parsed.ok) {
      const response = serializeCapabilityProviderNativeResponse({
        schemaVersion: CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION,
        requestId:
          isRecord(rawEvent) && typeof rawEvent.requestId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(rawEvent.requestId)
            ? rawEvent.requestId
            : "invalid",
        ok: false,
        failure: { code: parsed.code, effectState: state.effectState },
      });
      const requestId = isRecord(rawEvent) && typeof rawEvent.requestId === "string" && REQUEST_ID_PATTERN.test(rawEvent.requestId)
        ? rawEvent.requestId
        : undefined;
      if (requestId) {
        const existing = state.eventRecords.get(requestId);
        if (existing) {
          return await existing.promise;
        }
        let fingerprint = "invalid-event";
        try {
          fingerprint = hashCapabilityMetadata(rawEvent);
        } catch {
          // Keep the malformed-event response bounded even when its input is not hashable.
        }
        const promise = Promise.resolve(response);
        state.eventRecords.set(requestId, { fingerprint, promise });
        return await promise;
      }
      return response;
    }
    let fingerprint: string;
    try {
      fingerprint = hashCapabilityMetadata(parsed.value);
    } catch {
      return this.#eventFailure(parsed.value.requestId, "invalid-event", state.effectState);
    }
    const existing = state.eventRecords.get(parsed.value.requestId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? await existing.promise
        : this.#eventFailure(parsed.value.requestId, "event-id-conflict", state.effectState);
    }
    const promise = this.#executeEvent(parsed.value, state, signal, onUpdate);
    state.eventRecords.set(parsed.value.requestId, { fingerprint, promise });
    return await promise;
  }

  async #executeEvent(
    event: CapabilityProviderNativeEvent,
    state: RunState,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback | undefined,
  ): Promise<string> {
    try {
      let value: unknown;
      if (event.type === "search") {
        const discovered = await this.input.resolver.discover({
          query: event.query,
          ...(event.limit !== undefined ? { limit: event.limit } : {}),
          kind: "tool",
        });
        if (!discovered.ok) {
          return this.#eventFailure(event.requestId, discovered.failure.code, state.effectState);
        }
        value = discovered.value.capabilities;
      } else if (event.type === "describe") {
        const loaded = await this.input.resolver.load(event.capabilityId);
        if (!loaded.ok) {
          return this.#eventFailure(event.requestId, loaded.failure.code, state.effectState);
        }
        value = loaded.value;
      } else {
        try {
          value = await this.input.execution.execute({
            capabilityId: event.capabilityId,
            input: event.input,
            ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
            signal,
            ...(onUpdate ? { onUpdate } : {}),
          });
          state.effectState = maxEffectState(state.effectState, "completed");
        } catch (error) {
          const effectState =
            error instanceof CapabilityToolExecutionError ? error.effectState : "unknown";
          state.effectState = maxEffectState(state.effectState, effectState);
          return this.#eventFailure(
            event.requestId,
            error instanceof CapabilityToolExecutionError ? error.code : "execution-failed",
            state.effectState,
          );
        }
      }
      const response: CapabilityProviderNativeResponse = {
        schemaVersion: CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION,
        requestId: event.requestId,
        ok: true,
        value,
      };
      return serializeCapabilityProviderNativeResponse(response);
    } catch {
      return this.#eventFailure(event.requestId, "event-failed", state.effectState);
    }
  }

  #eventFailure(
    requestId: string,
    code: string,
    effectState: CapabilityToolExecutionEffectState,
  ): string {
    return serializeCapabilityProviderNativeResponse({
      schemaVersion: "capability-provider-native-response/v1",
      requestId,
      ok: false,
      failure: { code, effectState },
    });
  }
}
