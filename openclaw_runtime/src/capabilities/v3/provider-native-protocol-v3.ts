import {
  canonicalizeMetadataValue,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";

export const CAPABILITY_PROVIDER_NATIVE_REQUEST_SCHEMA_VERSION =
  "capability-provider-native-request/v1" as const;
export const CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION =
  "capability-provider-native-event/v1" as const;
export const CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION =
  "capability-provider-native-response/v1" as const;

export type CapabilityProviderNativeTarget = {
  providerId: string;
  modelId: string;
  workflowNamespace: string;
};

export type CapabilityProviderNativeRequest = {
  schemaVersion: typeof CAPABILITY_PROVIDER_NATIVE_REQUEST_SCHEMA_VERSION;
  requestId: string;
  correlationId: string;
  target: CapabilityProviderNativeTarget;
  query: string;
  navigation: CapabilityDescriptor[];
};

export type CapabilityProviderNativeEvent =
  | {
      schemaVersion: typeof CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION;
      requestId: string;
      type: "search";
      query: string;
      limit?: number;
    }
  | {
      schemaVersion: typeof CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION;
      requestId: string;
      type: "describe";
      capabilityId: string;
    }
  | {
      schemaVersion: typeof CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION;
      requestId: string;
      type: "call";
      capabilityId: string;
      input: unknown;
      toolCallId?: string;
    };

export type CapabilityProviderNativeResponse = {
  schemaVersion: typeof CAPABILITY_PROVIDER_NATIVE_RESPONSE_SCHEMA_VERSION;
  requestId: string;
  correlationId?: string;
  ok: boolean;
  value?: unknown;
  failure?: {
    code: string;
    effectState: "not_started" | "unknown" | "completed";
  };
};

export type CapabilityProviderNativeParseResult =
  | { ok: true; value: CapabilityProviderNativeEvent }
  | { ok: false; code: "invalid-event" };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const CORRELATION_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CAPABILITY_ID_PATTERN = /^(skill|tool|context):[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function isCapabilityProviderNativeCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value);
}

/** Validate optional response correlation metadata against the active request. */
export function matchesCapabilityProviderNativeCorrelation(params: {
  response: unknown;
  requestId: string;
  correlationId: string;
}): boolean {
  if (!isRecord(params.response)) {
    return false;
  }
  if (params.response.requestId !== undefined && params.response.requestId !== params.requestId) {
    return false;
  }
  if (params.response.correlationId !== undefined) {
    return (
      isCapabilityProviderNativeCorrelationId(params.response.correlationId) &&
      params.response.correlationId === params.correlationId
    );
  }
  return true;
}

function validCapabilityId(value: unknown): value is string {
  return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value);
}

function isJsonSafe(value: unknown): boolean {
  try {
    canonicalizeMetadataValue(value);
    return true;
  } catch {
    return false;
  }
}

export function createCapabilityProviderNativeRequest(params: {
  requestId: string;
  target: CapabilityProviderNativeTarget;
  query: string;
  navigation: readonly CapabilityDescriptor[];
}): CapabilityProviderNativeRequest {
  const correlationId = hashCapabilityMetadata({
    requestId: params.requestId,
    target: params.target,
  });
  return {
    schemaVersion: CAPABILITY_PROVIDER_NATIVE_REQUEST_SCHEMA_VERSION,
    requestId: params.requestId,
    correlationId,
    target: { ...params.target },
    query: params.query,
    navigation: params.navigation.map((descriptor) => ({
      ...descriptor,
      triggerKeywords: [...descriptor.triggerKeywords],
      source: { ...descriptor.source },
      ...(descriptor.dependsOn ? { dependsOn: [...descriptor.dependsOn] } : {}),
      ...(descriptor.permissions ? { permissions: [...descriptor.permissions] } : {}),
      ...(descriptor.executionTopologies
        ? { executionTopologies: [...descriptor.executionTopologies] }
        : {}),
    })),
  };
}

export function serializeCapabilityProviderNativeRequest(
  request: CapabilityProviderNativeRequest,
): string {
  return canonicalizeMetadataValue(request);
}

export function serializeCapabilityProviderNativeResponse(
  response: CapabilityProviderNativeResponse,
): string {
  return canonicalizeMetadataValue(response);
}

export function parseCapabilityProviderNativeEvent(
  value: unknown,
): CapabilityProviderNativeParseResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION ||
    !validRequestId(value.requestId) ||
    typeof value.type !== "string"
  ) {
    return { ok: false, code: "invalid-event" };
  }

  if (value.type === "search") {
    if (
      !hasOnlyKeys(value, ["schemaVersion", "requestId", "type", "query", "limit"]) ||
      typeof value.query !== "string" ||
      value.query.length > 4_096 ||
      (value.limit !== undefined &&
        (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 100))
    ) {
      return { ok: false, code: "invalid-event" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
        requestId: value.requestId,
        type: "search",
        query: value.query,
        ...(value.limit !== undefined ? { limit: Number(value.limit) } : {}),
      },
    };
  }

  if (value.type === "describe") {
    if (
      !hasOnlyKeys(value, ["schemaVersion", "requestId", "type", "capabilityId"]) ||
      !validCapabilityId(value.capabilityId)
    ) {
      return { ok: false, code: "invalid-event" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
        requestId: value.requestId,
        type: "describe",
        capabilityId: value.capabilityId,
      },
    };
  }

  if (value.type === "call") {
    if (
      !hasOnlyKeys(value, [
        "schemaVersion",
        "requestId",
        "type",
        "capabilityId",
        "input",
        "toolCallId",
      ]) ||
      !validCapabilityId(value.capabilityId) ||
      !isJsonSafe(value.input ?? {}) ||
      (value.toolCallId !== undefined &&
        (typeof value.toolCallId !== "string" ||
          value.toolCallId.length < 1 ||
          value.toolCallId.length > 256))
    ) {
      return { ok: false, code: "invalid-event" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
        requestId: value.requestId,
        type: "call",
        capabilityId: value.capabilityId,
        input: value.input ?? {},
        ...(value.toolCallId ? { toolCallId: value.toolCallId } : {}),
      },
    };
  }

  return { ok: false, code: "invalid-event" };
}
