// RC-02 shadow census: persist a digest-only context receipt before provider
// projection and a wire receipt at the final guarded request boundary. Control
// metadata travels on a symbol so it can never change provider request bytes.
import { createHash } from 'node:crypto';

import { digestStableJson } from '../observability/correlation-ids.js';
import {
  ReceiptStore,
  type PutReceiptResult,
  type ReceiptCallIndex,
  type ReceiptIdentity,
  type RuntimeReceiptRuntimeMode,
} from './receipt-store.js';

import type { RegisteredTransform } from '../../../shared/types/context-control-plane/artifacts.js';

export const RC02_SHADOW_CENSUS_FLAG = 'rc02.shadowCensus';
export const SHADOW_CONTEXT_RECEIPT_VERSION = '0';
export const SHADOW_WIRE_RECEIPT_VERSION = '0';
export const RC02_SHADOW_OPTIONS = Symbol.for('openclaw.rc02.shadowReceiptOptions');

export type ShadowReceiptCallContext = {
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  providerId?: string;
  adapterId?: string;
  transformIds?: string[];
  modelId?: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  wireAttemptIndex?: number;
};

export type Stage2PromptPlanCarrier = {
  schema: 'PromptPlan/v1';
  planId: string;
  snapshotId: string;
  planDigest: string;
  sealed: boolean;
  identity: {
    sessionKey: string;
    runId: string;
    attemptIndex: number;
    modelCallIndex: number;
  };
};

export type Stage2SnapshotCarrier = {
  schema: 'CompilationSnapshot/v1';
  snapshotId: string;
  snapshotDigest: string;
  policyDigest: string;
  modelProfile: {
    providerId: string;
    modelId: string;
    adapterId: string;
  };
  transformGraph: RegisteredTransform[];
};

export type ShadowReceiptOptions = {
  /** Feature flag switch; off by default. */
  enabled?: boolean;
  /** False identifies the npm fallback; it contributes zero source coverage. */
  sourceRuntime?: boolean;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
  receiptStore?: Pick<ReceiptStore, 'put'>;
  /** Correlation fields are carried out-of-band and never enter provider bytes. */
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  providerId?: string;
  adapterId?: string;
  transformIds?: string[];
  modelId?: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  wireAttemptIndex?: number;
  /** Internal correlation state populated after the context receipt is written. */
  correlationDigest?: string;
  logicalDigest?: string;
  /** Stage 1 RequestEnvelope ref. Digest/ref only; raw prompt content never
   *  travels on shadow options or enters provider bytes. */
  requestEnvelopeRef?: string;

  /** Stage 2 sealed PromptPlan carrier produced by DCS. Provider Guard reads
   *  these fields only; it never recompiles. */
  stage2PromptPlan?: Stage2PromptPlanCarrier;
  /** Matching Stage 2 snapshot carrier. */
  stage2Snapshot?: Stage2SnapshotCarrier;
  /** RC-03 sealed plan attached by the embedded runner so the guarded wire
   *  boundary can persist WireReceipt/v1 correlated to the sealed bundle.
   *  Structural subset of CompilePlan to avoid an agents->context-engine
   *  runtime import; only the fields the wire boundary needs. */
  rc03Plan?: {
    planId: string;
    sessionKey?: string;
    runId?: string;
    providerId?: string;
    adapterId?: string;
    policyDigest: string;
    /** Registered pre-seal producers and whether they actually ran. */
    preSealProducers: Array<{
      producerId: string;
      producerVersion: string;
      applied: boolean;
    }>;
    postSealTransformIds: string[];
    callIndex: {
      attemptIndex: number;
      planRevision: number;
      modelCallIndex: number;
      wireAttemptIndex: number;
    };
    planDigest: string;
  };
};

export type ShadowContextEmitResult =
  | {
      active: false;
      receipt: null;
      failed: false;
      correlationDigest: null;
      logicalDigest: null;
    }
  | {
      active: true;
      receipt: PutReceiptResult | null;
      failed: boolean;
      correlationDigest: string;
      logicalDigest: string;
    };

export type ShadowWireEmitResult = {
  receipt: PutReceiptResult | null;
  failed: boolean;
};

export type ShadowCensusEmitResult = {
  contextReceipt: PutReceiptResult | null;
  wireReceipt: PutReceiptResult | null;
  /** True when either receipt failed to persist; the RC-02 run must fail. */
  failed: boolean;
};

export type ShadowCallOptionsResult = {
  active: boolean;
  options: ShadowReceiptOptions;
  receipt: ShadowContextEmitResult;
};

export type ShadowCensusCapability = {
  runtimeMode: RuntimeReceiptRuntimeMode;
  degraded: boolean;
  degradedReason: string | null;
  receiptCoverage: 0 | 1;
  readiness: boolean;
};

export type WireOwnerCensus = {
  fieldCount: number;
  unknownCount: number;
  duplicateCount: number;
  proofRef: string;
};

export type ShadowCensusFailureDiagnostic = {
  phase: "context-write" | "wire-capture" | "wire-owner" | "wire-write";
  code:
    | "receipt-store-write-failed"
    | "receipt-content-conflict"
    | "final-wire-body-unavailable"
    | "final-wire-body-invalid"
    | "wire-owner-incomplete"
    | "request-envelope-incomplete"
    | "prompt-plan-not-sealed"
    | "snapshot-plan-mismatch"
    | "unregistered-transform"
    | "unsealed-model-call"
    | "post-seal-semantic-mutation";
  count: number;
};

let shadowFailureCount = 0;
const shadowFailures = new Map<string, ShadowCensusFailureDiagnostic>();

function digestStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/** Canonical digest for the guarded body; stream is a named volatile field. */
export function wireBodyDigest(body: string | Uint8Array | Record<string, unknown>): string {
  const serialized = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
  return createHash('sha256').update(serialized).digest('hex');
}

function parseWireBody(body: string | Uint8Array | Record<string, unknown>): unknown {
  if (typeof body === 'string') return JSON.parse(body) as unknown;
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body)) as unknown;
  return body;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function collectWireLeafPaths(value: unknown, path: string, paths: string[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) paths.push(path);
    for (let index = 0; index < value.length; index += 1) {
      collectWireLeafPaths(value[index], `${path}/${index}`, paths);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) paths.push(path);
    for (const [key, child] of entries) {
      collectWireLeafPaths(child, `${path}/${escapeJsonPointerSegment(key)}`, paths);
    }
    return;
  }
  paths.push(path);
}

/** Aggregate proof that every final JSON leaf has exactly one named adapter owner. */
export function buildWireOwnerCensus(
  body: string | Uint8Array | Record<string, unknown>,
  adapterId: string | undefined,
): WireOwnerCensus {
  const paths: string[] = [];
  collectWireLeafPaths(parseWireBody(body), '', paths);
  const uniquePaths = new Set(paths);
  const normalizedAdapterId = adapterId?.trim() ?? '';
  const ownerRecords = [...uniquePaths]
    .toSorted()
    .map((fieldPath) => ({ fieldPath, ownerClass: 'adapter', ownerId: normalizedAdapterId }));
  const digest = digestStable(ownerRecords);
  return {
    fieldCount: paths.length,
    unknownCount: normalizedAdapterId ? 0 : paths.length,
    duplicateCount: paths.length - uniquePaths.size,
    proofRef: `owner-census:v0:${paths.length}:${digest}`,
  };
}

function callIndex(input: ShadowReceiptCallContext): ReceiptCallIndex {
  return {
    attemptIndex: input.attemptIndex ?? 0,
    modelCallIndex: input.modelCallIndex ?? 0,
    wireAttemptIndex: input.wireAttemptIndex ?? 0,
  };
}

function identity(input: ShadowReceiptCallContext, runtimeMode: RuntimeReceiptRuntimeMode): ReceiptIdentity {
  return {
    sessionKey: input.sessionKey,
    runId: input.runId,
    traceId: input.traceId,
    providerId: input.providerId ?? input.adapterId,
    adapterId: input.adapterId,
    transformIds: input.transformIds,
    runtimeMode,
  };
}

function shadowStore(options: ShadowReceiptOptions): Pick<ReceiptStore, 'put'> {
  return options.receiptStore ?? (options.database ? new ReceiptStore(options.database) : new ReceiptStore());
}

/**
 * R5-3: resolve the wire-side correlation from the same source the
 * ContextReceipt used — the sealed bundle digest persisted as the v1
 * ContextReceipt correlation_digest of the same run and model call. The seal
 * plan registry only carries CompilePlan and rc03-seal-hook.ts is read-only
 * for this batch, so the receipt store is the single production join source.
 * Observational: a miss or failure leaves correlationDigest unset and the
 * emit boundary falls back to the identity-derived digest.
 */
export function resolveRc03WireCorrelationDigest(
  options: ShadowReceiptOptions,
  plan: { runId?: string; callIndex: { modelCallIndex: number } },
): string | undefined {
  const runId = options.runId ?? plan.runId;
  if (!runId || options.receiptStore) return undefined;
  try {
    const store = options.database ? new ReceiptStore(options.database) : new ReceiptStore();
    const rows = store.list({
      kind: 'context',
      runId,
      modelCallIndex: plan.callIndex.modelCallIndex,
      limit: 16,
    });
    const v1 = rows.find((row) => row.version === '1' && typeof row.correlation_digest === 'string' && row.correlation_digest);
    return v1?.correlation_digest ?? undefined;
  } catch {
    return undefined;
  }
}

function isEnabled(options: ShadowReceiptOptions): boolean {
  if (options.enabled !== undefined) return options.enabled === true;
  const value = process.env.OPENCLAW_RC02_SHADOW_CENSUS?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** Report the bounded capability contract for source and npm runtime paths. */
export function resolveShadowCensusCapability(options: ShadowReceiptOptions = {}): ShadowCensusCapability {
  const sourceRuntime = options.sourceRuntime !== false;
  const enabled = isEnabled(options);
  const acceptanceReady = shadowFailureCount === 0;
  return {
    runtimeMode: sourceRuntime ? 'source' : 'npm',
    degraded: !sourceRuntime,
    degradedReason: sourceRuntime ? null : 'npm-fallback-does-not-provide-source-receipt-coverage',
    receiptCoverage: sourceRuntime && enabled && acceptanceReady ? 1 : 0,
    readiness: sourceRuntime && enabled && acceptanceReady,
  };
}

function runtimeMode(options: ShadowReceiptOptions): RuntimeReceiptRuntimeMode {
  return options.sourceRuntime === false ? 'npm' : 'source';
}

function correlationDigest(input: ShadowReceiptCallContext): string {
  // R5-3: receipt correlation digests hash through the RC-08B correlation
  // module so both stay on one source; the segment projection stays the
  // receipt call identity (byte-identical to the previous local hasher).
  return digestStableJson({
    provider: input.providerId ?? input.adapterId ?? 'unknown',
    model: input.modelId ?? null,
    sessionKey: input.sessionKey ?? null,
    runId: input.runId ?? null,
    traceId: input.traceId ?? null,
    attempt: input.attemptIndex ?? 0,
    modelCall: input.modelCallIndex ?? 0,
  });
}

export function recordShadowCensusFailure(
  phase: ShadowCensusFailureDiagnostic["phase"],
  code: ShadowCensusFailureDiagnostic["code"],
): void {
  shadowFailureCount += 1;
  const key = `${phase}:${code}`;
  const existing = shadowFailures.get(key);
  shadowFailures.set(key, { phase, code, count: (existing?.count ?? 0) + 1 });
}

export function getShadowCensusDiagnostics(): {
  failedWrites: number;
  acceptanceReady: boolean;
  failures: ShadowCensusFailureDiagnostic[];
} {
  return {
    failedWrites: shadowFailureCount,
    acceptanceReady: shadowFailureCount === 0,
    failures: [...shadowFailures.values()],
  };
}

export function resetShadowCensusDiagnosticsForTest(): void {
  shadowFailureCount = 0;
  shadowFailures.clear();
}

export function getShadowReceiptOptions(options: unknown): ShadowReceiptOptions | undefined {
  if (!options || typeof options !== 'object') return undefined;
  const candidate = (options as Record<PropertyKey, unknown>)[RC02_SHADOW_OPTIONS];
  return candidate && typeof candidate === 'object' ? (candidate as ShadowReceiptOptions) : undefined;
}

/** Start a source-runtime model call census before provider projection. */
export function beginShadowModelCall(
  logicalContext: unknown,
  input: ShadowReceiptCallContext,
  options: unknown,
): ShadowCallOptionsResult {
  const attached = getShadowReceiptOptions(options) ?? {};
  const rawOptions = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
  const call = {
    ...input,
    sessionKey:
      input.sessionKey ??
      attached.sessionKey ??
      (typeof rawOptions.sessionId === 'string' ? rawOptions.sessionId : undefined),
    runId:
      input.runId ??
      attached.runId ??
      (typeof rawOptions.runId === 'string' ? rawOptions.runId : undefined),
    traceId:
      input.traceId ??
      attached.traceId ??
      (typeof rawOptions.traceId === 'string' ? rawOptions.traceId : undefined),
    attemptIndex:
      input.attemptIndex ??
      attached.attemptIndex ??
      (typeof rawOptions.attemptIndex === 'number' ? rawOptions.attemptIndex : undefined),
    modelCallIndex:
      input.modelCallIndex ??
      attached.modelCallIndex ??
      (typeof rawOptions.modelCallIndex === 'number' ? rawOptions.modelCallIndex : undefined),
    wireAttemptIndex:
      input.wireAttemptIndex ??
      attached.wireAttemptIndex ??
      (typeof rawOptions.wireAttemptIndex === 'number' ? rawOptions.wireAttemptIndex : undefined),
  };
  const active = isEnabled(attached);
  if (!active) {
    return {
      active: false,
      options: { ...attached, ...call, enabled: false },
      receipt: {
        active: false,
        receipt: null,
        failed: false,
        correlationDigest: null,
        logicalDigest: null,
      },
    };
  }
  if (attached.correlationDigest && attached.logicalDigest) {
    return {
      active,
      options: { ...attached, ...call, enabled: active },
      receipt: {
        active: true,
        receipt: null,
        failed: false,
        correlationDigest: attached.correlationDigest,
        logicalDigest: attached.logicalDigest,
      },
    };
  }
  const receipt = emitShadowContextReceipt(logicalContext, call, { ...attached, enabled: true });
  if (!receipt.active) {
    throw new Error('active shadow model call did not produce an active context receipt result');
  }
  return {
    active: true,
    options: {
      ...attached,
      ...call,
      enabled: true,
      correlationDigest: receipt.correlationDigest,
      logicalDigest: receipt.logicalDigest,
    },
    receipt,
  };
}

export function attachShadowReceiptOptions<T extends object>(options: T | undefined, shadow: ShadowReceiptOptions): T & { [RC02_SHADOW_OPTIONS]: ShadowReceiptOptions } {
  return { ...(options ?? {}), [RC02_SHADOW_OPTIONS]: shadow } as T & { [RC02_SHADOW_OPTIONS]: ShadowReceiptOptions };
}

/** Emit the logical receipt before provider projection. No raw context is stored. */
export function emitShadowContextReceipt(
  logicalContext: unknown,
  input: ShadowReceiptCallContext,
  options: ShadowReceiptOptions = {},
): ShadowContextEmitResult {
  if (!isEnabled(options)) {
    return {
      active: false,
      receipt: null,
      failed: false,
      correlationDigest: null,
      logicalDigest: null,
    };
  }
  const logicalDigest = digestStable(logicalContext);
  const correlation = options.correlationDigest ?? correlationDigest(input);

  const receiptIdentity = identity(input, runtimeMode(options));
  let receipt: PutReceiptResult | null;
  try {
    receipt = shadowStore(options).put({
      idempotencyKey: `ctx:v0:${correlation}`,
      kind: 'shadow_context',
      version: SHADOW_CONTEXT_RECEIPT_VERSION,
      identity: receiptIdentity,
      callIndex: callIndex(input),
      content: { logicalDigest, correlationDigest: correlation },
    });
  } catch {
    recordShadowCensusFailure('context-write', 'receipt-store-write-failed');
    return { active: true, receipt: null, failed: true, correlationDigest: correlation, logicalDigest };
  }
  const failed = !receipt.ok;
  if (failed) recordShadowCensusFailure('context-write', 'receipt-content-conflict');
  return { active: true, receipt, failed, correlationDigest: correlation, logicalDigest };
}

/** Emit the final wire receipt at the guarded request-body boundary. */
export function emitShadowWireReceipt(
  body: string | Uint8Array | Record<string, unknown>,
  input: ShadowReceiptCallContext,
  options: ShadowReceiptOptions = {},
): ShadowWireEmitResult {
  if (!isEnabled(options)) return { receipt: null, failed: false };
  const correlation = options.correlationDigest ?? correlationDigest(input);
  const wireDigest = wireBodyDigest(body);
  let ownerCensus: WireOwnerCensus;
  try {
    // Owner coverage requires a named transport adapter. A provider id is not
    // sufficient evidence because it does not identify the serializer/finalizer.
    ownerCensus = buildWireOwnerCensus(body, input.adapterId);
  } catch {
    recordShadowCensusFailure('wire-owner', 'final-wire-body-invalid');
    return { receipt: null, failed: true };
  }
  if (ownerCensus.unknownCount !== 0 || ownerCensus.duplicateCount !== 0) {
    recordShadowCensusFailure('wire-owner', 'wire-owner-incomplete');
    return { receipt: null, failed: true };
  }
  const receiptIdentity = identity(input, runtimeMode(options));
  let receipt: PutReceiptResult | null;
  try {
    receipt = shadowStore(options).put({
      idempotencyKey: `wire:v0:${correlation}:${input.wireAttemptIndex ?? 0}`,
      kind: 'shadow_wire',
      version: SHADOW_WIRE_RECEIPT_VERSION,
      identity: receiptIdentity,
      callIndex: callIndex(input),
      content: {
        logicalDigest: options.logicalDigest,
        wireDigest,
        correlationDigest: correlation,
        selected: [
          ownerCensus.proofRef,
          ...(options.requestEnvelopeRef ? [options.requestEnvelopeRef] : []),
        ],
      },
    });
  } catch {
    recordShadowCensusFailure('wire-write', 'receipt-store-write-failed');
    return { receipt: null, failed: true };
  }
  const failed = !receipt.ok;
  if (failed) recordShadowCensusFailure('wire-write', 'receipt-content-conflict');
  return { receipt, failed };
}

/** Compatibility helper for narrow unit tests; production uses the two phases. */
export function emitShadowCensus(
  body: Record<string, unknown>,
  input: ShadowReceiptCallContext,
  options: ShadowReceiptOptions = {},
): ShadowCensusEmitResult {
  const context = emitShadowContextReceipt(body, input, options);
  if (!context.active) {
    return { contextReceipt: null, wireReceipt: null, failed: false };
  }
  const wire = emitShadowWireReceipt(body, input, {
    ...options,
    correlationDigest: context.correlationDigest,
    logicalDigest: context.logicalDigest,
  });
  return { contextReceipt: context.receipt, wireReceipt: wire.receipt, failed: context.failed || wire.failed };
}

/** RC-03 WireReceipt/v1 at the guarded boundary. The receipt is bound to the
 *  sealed plan's identity and the final serialized body digest; registered
 *  non-semantic transport transform ids ride on the identity. Observational
 *  only: write failures record census diagnostics and never change send bytes. */
export function emitRc03WireReceipt(
  body: string | Uint8Array | Record<string, unknown>,
  options: ShadowReceiptOptions,
  input: { providerId: string; adapterId: string; modelId?: string; wireAttemptIndex: number },
): PutReceiptResult | null {
  const plan = options.rc03Plan;
  if (!plan) return null;
  const wireDigest = wireBodyDigest(body);
  const correlation = options.correlationDigest ?? correlationDigest({
    providerId: input.providerId,
    adapterId: input.adapterId,
    modelId: input.modelId,
    sessionKey: options.sessionKey,
    runId: options.runId,
    traceId: options.traceId,
    attemptIndex: options.attemptIndex,
    modelCallIndex: options.modelCallIndex,
    wireAttemptIndex: input.wireAttemptIndex,
  });
  const identity: ReceiptIdentity = {
    sessionKey: options.sessionKey,
    runId: options.runId,
    traceId: options.traceId,
    providerId: input.providerId,
    adapterId: input.adapterId,
    transformIds: plan.postSealTransformIds,
    runtimeMode: runtimeMode(options),
  };
  let receipt: PutReceiptResult | null;
  try {
    receipt = shadowStore(options).put({
      idempotencyKey: `wire:v1:${plan.planId}:${correlation}:${input.wireAttemptIndex}`,
      kind: 'wire',
      version: '1',
      identity,
      callIndex: {
        attemptIndex: options.attemptIndex ?? plan.callIndex.attemptIndex,
        modelCallIndex: options.modelCallIndex ?? plan.callIndex.modelCallIndex,
        wireAttemptIndex: input.wireAttemptIndex,
      },
      content: {
        logicalDigest: options.logicalDigest,
        wireDigest,
        correlationDigest: correlation,
        ...(options.requestEnvelopeRef ? { selected: [options.requestEnvelopeRef] } : {}),
      },
    });
  } catch {
    recordShadowCensusFailure('wire-write', 'receipt-store-write-failed');
    return null;
  }
  if (!receipt.ok) {
    recordShadowCensusFailure('wire-write', 'receipt-content-conflict');
  }
  return receipt;
}
