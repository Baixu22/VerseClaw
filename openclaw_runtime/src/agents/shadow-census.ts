// RC-02 shadow census emitter: generates ShadowContextReceipt/v0 before provider
// projection and ShadowWireReceipt/v0 at the guarded request-body boundary after
// provider-specific finalizers. It is strictly observational:
//   - it never mutates the params object or the final serialized bytes
//     (zero-byte parity, hard constraint of RC-02);
//   - a shadow write failure never throws into the send path and never changes
//     send behavior (hard constraint 5) — it surfaces a failure result that the
//     RC-02 acceptance run must fail on;
//   - the npm fallback reports runtimeMode=npm and never counts toward coverage.
import { createHash } from 'node:crypto';

import {
  ReceiptStore,
  receiptContentDigest,
  type PutReceiptResult,
  type ReceiptCallIndex,
  type ReceiptIdentity,
  type RuntimeReceiptRuntimeMode,
} from './receipt-store.js';

export const RC02_SHADOW_CENSUS_FLAG = 'rc02.shadowCensus';
export const SHADOW_CONTEXT_RECEIPT_VERSION = '0';
export const SHADOW_WIRE_RECEIPT_VERSION = '0';

export type ShadowCensusOptions = {
  /** Feature flag switch; off by default. Kill switch restores the legacy path. */
  enabled?: boolean;
  /** When false (npm fallback), receipts carry runtimeMode=npm and never count. */
  sourceRuntime?: boolean;
  /** OpenClaw state database options for the ReceiptStore. */
  database?: { env?: NodeJS.ProcessEnv; path?: string };
};

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

export type ShadowCensusEmitResult = {
  contextReceipt: PutReceiptResult | null;
  wireReceipt: PutReceiptResult | null;
  /** True when either receipt failed to persist; the RC-02 run must fail on this. */
  failed: boolean;
};

function digestStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/** Canonical stable JSON stringify used to compute the wire body digest. */
export function wireBodyDigest(body: Record<string, unknown>): string {
  const { stream: _stream, ...rest } = body;
  return digestStable(rest);
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

function shadowStore(database?: { env?: NodeJS.ProcessEnv; path?: string }): ReceiptStore {
  return database ? new ReceiptStore(database) : new ReceiptStore();
}

/**
 * Emit the shadow context + wire receipts for one model call. Never throws into
 * the send path: every failure is captured into the result and the caller must
 * fail the RC-02 acceptance run on `failed=true` without changing send behavior.
 * With the flag off this is a no-op returning empty results.
 */
export function emitShadowCensus(
  body: Record<string, unknown>,
  input: ShadowReceiptCallContext,
  options: ShadowCensusOptions = {},
): ShadowCensusEmitResult {
  const enabled = options.enabled === true;
  if (!enabled) {
    return { contextReceipt: null, wireReceipt: null, failed: false };
  }
  const runtimeMode: RuntimeReceiptRuntimeMode = options.sourceRuntime === false ? 'npm' : 'source';
  const correlationDigest = digestStable({
    provider: input.providerId ?? input.adapterId ?? 'unknown',
    model: input.modelId ?? null,
    runId: input.runId ?? null,
    traceId: input.traceId ?? null,
    attempt: input.attemptIndex ?? 0,
    modelCall: input.modelCallIndex ?? 0,
    wireAttempt: input.wireAttemptIndex ?? 0,
  });
  const wireDigest = wireBodyDigest(body);
  const wireIdentity = identity(input, runtimeMode);
  const store = shadowStore(options.database);

  let contextReceipt: PutReceiptResult | null;
  let wireReceipt: PutReceiptResult | null;
  let failed = false;

  const contextContent = {
    correlationDigest,
    logicalDigest: digestStable(body),
  };
  const wireContent = {
    correlationDigest,
    wireDigest,
    logicalDigest: digestStable(body),
  };
  const contextCallIndex = callIndex(input);

  try {
    // ShadowContextReceipt/v0: before provider projection, the logical bundle
    // digest is the pre-seal params digest (same object, non-mutating read).
    const contextKey = `ctx:${correlationDigest}`;
    contextReceipt = store.put({
      idempotencyKey: contextKey,
      kind: 'shadow_context',
      version: SHADOW_CONTEXT_RECEIPT_VERSION,
      identity: wireIdentity,
      callIndex: contextCallIndex,
      content: {
        ...contextContent,
        contentDigest: receiptContentDigest(wireIdentity, contextCallIndex, contextContent),
      },
    });
  } catch {
    failed = true;
    contextReceipt = null;
  }

  try {
    // ShadowWireReceipt/v0: at the guarded request-body boundary after every
    // provider-specific finalizer — the final body digest.
    const wireKey = `wire:${correlationDigest}:${wireDigest}`;
    wireReceipt = store.put({
      idempotencyKey: wireKey,
      kind: 'shadow_wire',
      version: SHADOW_WIRE_RECEIPT_VERSION,
      identity: wireIdentity,
      callIndex: callIndex(input),
      content: {
        ...wireContent,
        contentDigest: receiptContentDigest(wireIdentity, callIndex(input), wireContent),
      },
    });
  } catch {
    failed = true;
    wireReceipt = null;
  }

  if (contextReceipt && !contextReceipt.ok) failed = true;
  if (wireReceipt && !wireReceipt.ok) failed = true;
  return { contextReceipt, wireReceipt, failed };
}
