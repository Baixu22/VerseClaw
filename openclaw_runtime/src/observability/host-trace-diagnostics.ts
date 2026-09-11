// Signed host lineage and bounded diagnostics for the VerseShell P2-03 contract.
import { createHmac, timingSafeEqual } from "node:crypto";

export const HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION = "1" as const;
export const HOST_TRACE_DIAGNOSTICS_KIND = "verseshell.host-trace" as const;
export const DEFAULT_HOST_TRACE_ENVELOPE_TTL_MS = 5 * 60 * 1000;
export const MAX_HOST_TRACE_ENVELOPE_TTL_MS = 15 * 60 * 1000;

const MIN_HOST_SECRET_BYTES = 32;
const MAX_ID_LENGTH = 128;
const MAX_EVIDENCE_TEXT_LENGTH = 2048;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;
const TRACE_ID_RE = /^[a-f0-9]{32}$/u;
const SPAN_ID_RE = /^[a-f0-9]{16}$/u;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SIGNATURE_RE = /^hmac-sha256:([a-f0-9]{64})$/u;

const LINEAGE_KEYS = [
  "requestId",
  "traceId",
  "spanId",
  "parentTraceId",
  "runId",
  "correlationDigest",
] as const;
const ENVELOPE_KEYS = ["kind", "schemaVersion", "issuedAt", "expiresAt", "lineage", "signature"] as const;

export type HostTraceLineageInput = Readonly<{
  requestId: string;
  traceId: string;
  spanId: string;
  parentTraceId?: string;
  runId?: string;
  correlationDigest?: string;
}>;

export type HostTraceLineage = HostTraceLineageInput;

export type HostIssuedTraceEnvelope = Readonly<{
  kind: typeof HOST_TRACE_DIAGNOSTICS_KIND;
  schemaVersion: typeof HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION;
  issuedAt: number;
  expiresAt: number;
  lineage: HostTraceLineage;
  signature: string;
}>;

export const TRACE_FAILURE_KINDS = [
  "compile",
  "test",
  "tool_missing",
  "permission",
  "environment",
  "runtime",
  "timeout",
  "cancelled",
  "unknown",
] as const;

export type TraceFailureKind = (typeof TRACE_FAILURE_KINDS)[number];

export const TRACE_SUGGESTED_ACTIONS = [
  "retry",
  "ask_user",
  "stop",
  "continue_with_caution",
] as const;

export type TraceSuggestedAction = (typeof TRACE_SUGGESTED_ACTIONS)[number];

/** Host-side evidence is consumed for classification and never copied to a summary. */
export type HostFailureEvidence = Readonly<{
  phase?: "compile" | "test" | "tool" | "permission" | "environment" | "runtime";
  code?: string;
  message?: string;
  exitCode?: number;
  signal?: string;
  durationMs?: number;
  timedOut?: boolean;
  cancelled?: boolean;
}>;

export type TraceDiagnosticSummary = Readonly<{
  schemaVersion: typeof HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION;
  trace: HostTraceLineage;
  failureKind: TraceFailureKind;
  suggestedAction: TraceSuggestedAction;
  durationMs?: number;
  exitCode?: number;
  signal?: "sigint" | "sigterm" | "sigkill" | "other";
  redaction: "raw-fields-omitted";
}>;

export type TraceDiagnosticsAuthority = Readonly<{
  issue(input: HostTraceLineageInput): HostIssuedTraceEnvelope;
  verify(value: unknown): HostIssuedTraceEnvelope | undefined;
  summarize(value: unknown, evidence: unknown): TraceDiagnosticSummary | undefined;
}>;

/** Keep recovery guidance low-cardinality and advisory-only. */
export function suggestedActionForTraceFailure(kind: TraceFailureKind): TraceSuggestedAction {
  switch (kind) {
    case "timeout":
    case "runtime":
      return "retry";
    case "permission":
    case "environment":
    case "tool_missing":
      return "ask_user";
    case "cancelled":
      return "stop";
    case "compile":
    case "test":
    case "unknown":
      return "continue_with_caution";
  }
}

type RecordLike = Record<string, unknown>;

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (!isRecordLike(value)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function hasOnlyOwnKeys(value: unknown, allowed: readonly string[]): boolean {
  if (!isRecordLike(value)) {
    return false;
  }
  try {
    const allowedSet = new Set(allowed);
    return Object.getOwnPropertyNames(value).every((key) => allowedSet.has(key)) &&
      Object.getOwnPropertySymbols(value).length === 0;
  } catch {
    return false;
  }
}

function normalizeOpaqueId(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && OPAQUE_ID_RE.test(value)
    ? value
    : undefined;
}

function normalizeTraceId(value: unknown): string | undefined {
  return typeof value === "string" && TRACE_ID_RE.test(value) && !/^0+$/.test(value) ? value : undefined;
}

function normalizeSpanId(value: unknown): string | undefined {
  return typeof value === "string" && SPAN_ID_RE.test(value) && !/^0+$/.test(value) ? value : undefined;
}

function normalizeCorrelationDigest(value: unknown): string | undefined {
  return typeof value === "string" && SHA256_HEX_RE.test(value) ? value : undefined;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeLineage(value: unknown): HostTraceLineage | undefined {
  if (!hasOnlyOwnKeys(value, LINEAGE_KEYS)) {
    return undefined;
  }
  const requestId = normalizeOpaqueId(readOwnDataProperty(value, "requestId"));
  const traceId = normalizeTraceId(readOwnDataProperty(value, "traceId"));
  const spanId = normalizeSpanId(readOwnDataProperty(value, "spanId"));
  if (!requestId || !traceId || !spanId) {
    return undefined;
  }
  const parentTraceIdValue = readOwnDataProperty(value, "parentTraceId");
  const parentTraceId = parentTraceIdValue === undefined
    ? undefined
    : normalizeTraceId(parentTraceIdValue);
  const runIdValue = readOwnDataProperty(value, "runId");
  const runId = runIdValue === undefined ? undefined : normalizeOpaqueId(runIdValue);
  const correlationDigestValue = readOwnDataProperty(value, "correlationDigest");
  const correlationDigest = correlationDigestValue === undefined
    ? undefined
    : normalizeCorrelationDigest(correlationDigestValue);
  if (
    (parentTraceIdValue !== undefined && !parentTraceId) ||
    (runIdValue !== undefined && !runId) ||
    (correlationDigestValue !== undefined && !correlationDigest)
  ) {
    return undefined;
  }
  return Object.freeze({
    requestId,
    traceId,
    spanId,
    ...(parentTraceId ? { parentTraceId } : {}),
    ...(runId ? { runId } : {}),
    ...(correlationDigest ? { correlationDigest } : {}),
  });
}

function canonicalPayload(
  kind: typeof HOST_TRACE_DIAGNOSTICS_KIND,
  schemaVersion: typeof HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION,
  issuedAt: number,
  expiresAt: number,
  lineage: HostTraceLineage,
): string {
  return JSON.stringify({
    kind,
    schemaVersion,
    issuedAt,
    expiresAt,
    lineage: {
      requestId: lineage.requestId,
      traceId: lineage.traceId,
      spanId: lineage.spanId,
      parentTraceId: lineage.parentTraceId ?? null,
      runId: lineage.runId ?? null,
      correlationDigest: lineage.correlationDigest ?? null,
    },
  });
}

function createSignature(secret: Uint8Array, payload: string): string {
  return `hmac-sha256:${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function signaturesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function decodeEnvelope(value: unknown):
  | {
      kind: typeof HOST_TRACE_DIAGNOSTICS_KIND;
      schemaVersion: typeof HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION;
      issuedAt: number;
      expiresAt: number;
      lineage: HostTraceLineage;
      signature: string;
    }
  | undefined {
  if (!hasOnlyOwnKeys(value, ENVELOPE_KEYS)) {
    return undefined;
  }
  const kind = readOwnDataProperty(value, "kind");
  const schemaVersion = readOwnDataProperty(value, "schemaVersion");
  const issuedAt = normalizeTimestamp(readOwnDataProperty(value, "issuedAt"));
  const expiresAt = normalizeTimestamp(readOwnDataProperty(value, "expiresAt"));
  const lineage = normalizeLineage(readOwnDataProperty(value, "lineage"));
  const signature = readOwnDataProperty(value, "signature");
  if (
    kind !== HOST_TRACE_DIAGNOSTICS_KIND ||
    schemaVersion !== HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION ||
    issuedAt === undefined ||
    expiresAt === undefined ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_HOST_TRACE_ENVELOPE_TTL_MS ||
    !lineage ||
    typeof signature !== "string" ||
    !SIGNATURE_RE.test(signature)
  ) {
    return undefined;
  }
  return { kind, schemaVersion, issuedAt, expiresAt, lineage, signature };
}

function normalizedEvidence(value: unknown): {
  phase?: HostFailureEvidence["phase"];
  code?: string;
  message?: string;
  exitCode?: number;
  signal?: string;
  durationMs?: number;
  timedOut: boolean;
  cancelled: boolean;
} {
  if (typeof value === "string") {
    return { message: value.slice(0, MAX_EVIDENCE_TEXT_LENGTH), timedOut: false, cancelled: false };
  }
  const phase = readOwnDataProperty(value, "phase");
  const code = readOwnDataProperty(value, "code");
  const message = readOwnDataProperty(value, "message");
  const exitCode = readOwnDataProperty(value, "exitCode");
  const signal = readOwnDataProperty(value, "signal");
  const durationMs = readOwnDataProperty(value, "durationMs");
  const timedOut = readOwnDataProperty(value, "timedOut");
  const cancelled = readOwnDataProperty(value, "cancelled");
  return {
    phase: phase === "compile" || phase === "test" || phase === "tool" || phase === "permission" ||
        phase === "environment" || phase === "runtime" ? phase : undefined,
    code: typeof code === "string" ? code.slice(0, MAX_EVIDENCE_TEXT_LENGTH) : undefined,
    message: typeof message === "string" ? message.slice(0, MAX_EVIDENCE_TEXT_LENGTH) : undefined,
    exitCode: typeof exitCode === "number" && Number.isSafeInteger(exitCode) && exitCode >= -1 && exitCode <= 255
      ? exitCode
      : undefined,
    signal: typeof signal === "string" ? signal.slice(0, 64) : undefined,
    durationMs: typeof durationMs === "number" && Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= MAX_DURATION_MS
      ? durationMs
      : undefined,
    timedOut: timedOut === true,
    cancelled: cancelled === true,
  };
}

function upper(value: string | undefined): string {
  return value?.toUpperCase() ?? "";
}

/** Classify host-side failure evidence into a deliberately low-cardinality value. */
export function classifyTraceFailure(value: unknown): TraceFailureKind {
  const evidence = normalizedEvidence(value);
  const code = upper(evidence.code);
  const text = upper(`${evidence.code ?? ""} ${evidence.message ?? ""}`);
  if (evidence.cancelled || /(?:ABORT|CANCEL)/u.test(code)) {
    return "cancelled";
  }
  if (evidence.timedOut || /(?:TIMEOUT|TIMED_OUT|ETIMEDOUT)/u.test(code) || /\b(?:TIMED OUT|TIMEOUT)\b/u.test(text)) {
    return "timeout";
  }
  if (
    /^(?:EACCES|EPERM|ACCESS_DENIED|PERMISSION_DENIED)$/u.test(code) ||
    /\b(?:ACCESS DENIED|PERMISSION DENIED|NOT PERMITTED)\b/u.test(text)
  ) {
    return "permission";
  }
  if (
    /^(?:INVALID_CWD|ENV_MISSING|INVALID_ENV|WORKSPACE_NOT_FOUND|CONFIG_MISSING|ENVIRONMENT_ERROR)$/u.test(code) ||
    /\b(?:INVALID (?:CWD|ENV)|MISSING ENV(?:IRONMENT)?|WORKSPACE NOT FOUND|CONFIG(?:URATION)? NOT FOUND)\b/u.test(text)
  ) {
    return "environment";
  }
  if (
    /^(?:ENOENT|ENOEXEC|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|COMMAND_NOT_FOUND|TOOL_NOT_FOUND)$/u.test(code) ||
    /\b(?:COMMAND NOT FOUND|TOOL NOT FOUND|NOT RECOGNIZED AS (?:AN )?INTERNAL|CANNOT FIND MODULE)\b/u.test(text)
  ) {
    return /\b(?:CWD|WORKING DIRECTORY|WORKSPACE|DIRECTORY)\b/u.test(text) ? "environment" : "tool_missing";
  }
  if (
    /(?:COMPILE|COMPIL|TYPECHECK|BUILD)_?(?:FAILED|ERROR)?/u.test(code) ||
    /\b(?:COMPIL(?:E|ATION)|TYPECHECK|BUILD) (?:FAILED|ERROR|FAILURE)\b/u.test(text)
  ) {
    return "compile";
  }
  if (
    /(?:TEST|ASSERTION)_(?:FAILED|FAILURE|ERROR)/u.test(code) ||
    /\b(?:TEST|ASSERTION) (?:FAILED|FAILURE|ERROR)\b/u.test(text)
  ) {
    return "test";
  }
  if (
    /^(?:RUNTIME_ERROR|PROTOCOL_ERROR|PROCESS_CRASH|INTERNAL_ERROR|PANIC)$/u.test(code) ||
    /\b(?:RUNTIME ERROR|PROCESS CRASH|INTERNAL ERROR|PANIC)\b/u.test(text)
  ) {
    return "runtime";
  }
  if (evidence.phase) {
    return evidence.phase === "tool" ? "runtime" : evidence.phase;
  }
  if (evidence.exitCode !== undefined && evidence.exitCode !== 0) {
    return "runtime";
  }
  return "unknown";
}

function normalizeSignal(value: string | undefined): "sigint" | "sigterm" | "sigkill" | "other" | undefined {
  if (!value) {
    return undefined;
  }
  const signal = upper(value).replace(/^SIG/u, "");
  if (signal === "INT") return "sigint";
  if (signal === "TERM") return "sigterm";
  if (signal === "KILL") return "sigkill";
  return "other";
}

export function createHostTraceDiagnosticsAuthority(
  secret: Uint8Array,
  options: {
    now?: () => number;
    ttlMs?: number;
  } = {},
): TraceDiagnosticsAuthority {
  if (secret.length < MIN_HOST_SECRET_BYTES) {
    throw new TypeError(`host trace secret must be at least ${MIN_HOST_SECRET_BYTES} bytes`);
  }
  const key = new Uint8Array(secret);
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_HOST_TRACE_ENVELOPE_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_HOST_TRACE_ENVELOPE_TTL_MS) {
    throw new RangeError("host trace envelope ttl is outside the bounded contract");
  }

  const issue = (input: HostTraceLineageInput): HostIssuedTraceEnvelope => {
    const lineage = normalizeLineage(input);
    const issuedAt = normalizeTimestamp(now());
    if (!lineage || issuedAt === undefined) {
      throw new TypeError("host trace lineage and clock must be valid host inputs");
    }
    const expiresAt = issuedAt + ttlMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError("host trace envelope expiry is outside the safe integer range");
    }
    const payload = canonicalPayload(
      HOST_TRACE_DIAGNOSTICS_KIND,
      HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION,
      issuedAt,
      expiresAt,
      lineage,
    );
    return Object.freeze({
      kind: HOST_TRACE_DIAGNOSTICS_KIND,
      schemaVersion: HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION,
      issuedAt,
      expiresAt,
      lineage,
      signature: createSignature(key, payload),
    });
  };

  const verify = (value: unknown): HostIssuedTraceEnvelope | undefined => {
    const decoded = decodeEnvelope(value);
    const currentTime = normalizeTimestamp(now());
    if (!decoded || currentTime === undefined) {
      return undefined;
    }
    if (decoded.issuedAt > currentTime + MAX_CLOCK_SKEW_MS || currentTime >= decoded.expiresAt) {
      return undefined;
    }
    const expected = createSignature(
      key,
      canonicalPayload(decoded.kind, decoded.schemaVersion, decoded.issuedAt, decoded.expiresAt, decoded.lineage),
    );
    if (!signaturesEqual(decoded.signature, expected)) {
      return undefined;
    }
    return Object.freeze(decoded);
  };

  const summarize = (value: unknown, evidence: unknown): TraceDiagnosticSummary | undefined => {
    const envelope = verify(value);
    if (!envelope) {
      return undefined;
    }
    const normalized = normalizedEvidence(evidence);
    const failureKind = classifyTraceFailure(normalized);
    return Object.freeze({
      schemaVersion: HOST_TRACE_DIAGNOSTICS_SCHEMA_VERSION,
      trace: envelope.lineage,
      failureKind,
      suggestedAction: suggestedActionForTraceFailure(failureKind),
      ...(normalized.durationMs !== undefined ? { durationMs: normalized.durationMs } : {}),
      ...(normalized.exitCode !== undefined ? { exitCode: normalized.exitCode } : {}),
      ...(normalized.signal ? { signal: normalizeSignal(normalized.signal) } : {}),
      redaction: "raw-fields-omitted",
    });
  };

  return Object.freeze({ issue, verify, summarize });
}
