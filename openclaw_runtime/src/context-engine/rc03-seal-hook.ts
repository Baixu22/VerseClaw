// RC-03 production wiring: the seal hook is called from the pre-seal semantic
// producer convergence point (finalizeContextOrchestratorTurn). It enforces that
// every DCS semantic producer was registered before the bundle is sealed
// (zero-bypass), builds the immutable ContextBundle, seals it, and persists a
// ContextReceipt/v1 when the RC-03 flag is on. Gated by a feature flag
// (default-off) and the existing enhancement kill switch; when off, it is a
// no-op and the legacy path is byte-identical.
import { createHash } from 'node:crypto';

import {
  ReceiptStore,
  type ReceiptCandidateDecisions,
  type ReceiptCandidateDisposition,
  type ReceiptCandidateReason,
} from '../agents/receipt-store.js';
import { createSubsystemLogger } from '../logging/subsystem.js';
import {
  recordShadowCensusFailure,
  type ShadowCensusFailureDiagnostic,
} from '../agents/shadow-census.js';
import { createContextBundle, sealContextBundle } from './context-bundle.js';
import { buildContextReceiptInput } from './dcs-receipts.js';
import { createCompilePlan, type CompilePlan } from './compile-plan.js';
import { isContextEnhancementKillSwitchEngaged } from './enhancement-kill-switch.js';
import {
  assertSealMutation,
  getSealCoverageMatrix,
  getSealProducer,
  registeredTransportTransformIds,
  SealMutationError,
} from './seal-registry.js';
import { stripSystemPromptCacheBoundary } from '../agents/system-prompt-cache-boundary.js';
import { resolveKillSwitchConfig } from './kill-switch-config-source.js';
import {
  RC03_PRE_SEAL_PRODUCERS,
  rc03PreSealProducerIds,
  registerRc03SealProducers,
} from './rc03-producers.js';
import type { ContextCandidateProjection } from './context-candidate.js';

const receiptLog = createSubsystemLogger('runtime-receipts');

export const RC03_SEAL_FLAG = 'rc03.seal';
export const RC03_SEAL_ENV = 'OPENCLAW_RC03_SEAL';
/** Compile-plan policy digest: sha256("rc03-seal-policy-v1"). */
export const RC03_SEAL_POLICY_DIGEST =
  '49ae4fddce0451f75ab207a392c8b51394d39abc9998027a705b29a677ffced1';

/** Sealed plans per run and model call, so the guarded wire boundary can emit
 *  WireReceipt/v1 correlated to the sealed ContextBundle of the same run and
 *  model call. In-process only; cleared with the turn. */
const sealedPlansByRun = new Map<string, Map<number, CompilePlan>>();
/** sha256 of the provider-bound system prompt each sealed model call bound. */
const sealedSystemPromptDigestsByRun = new Map<string, Map<number, string>>();
/** ContextReceipt correlation digest (bundle digest) per run and model call. */
const sealedCorrelationDigestsByRun = new Map<string, Map<number, string>>();
/** Accepted model calls include summaries and periods when enhancement is killed. */
const modelCallHighWaterByRun = new Map<string, Map<number, number>>();

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Check the actual stream input and the allowed transforms before provider code runs. */
export function assertRc03SealedSystemPrompt(runId: string | undefined, modelCallIndex: number, systemPrompt: string | undefined): void {
  const plan = getRc03SealPlan(runId, modelCallIndex);
  if (!plan) throw new SealMutationError('provider-context', 'post-seal', 'unsealed-model-call');
  for (const producer of plan.preSealProducers) {
    if (producer.applied) assertSealMutation(producer.producerId, 'pre-seal');
  }
  for (const id of plan.postSealTransformIds) assertSealMutation(id, 'post-seal');
  const expected = getRc03SealedSystemPromptDigest(runId, modelCallIndex);
  if (expected !== undefined && sha256(stripSystemPromptCacheBoundary(systemPrompt ?? '')) !== expected) {
    throw new SealMutationError('provider-system-prompt', 'post-seal', 'content-changed');
  }
}

export function recordRc03SealPlan(
  runId: string | undefined,
  plan: CompilePlan,
  systemPromptDigest?: string,
  correlationDigest?: string,
): void {
  if (!runId) return;
  let byModelCall = sealedPlansByRun.get(runId);
  if (!byModelCall) {
    byModelCall = new Map();
    sealedPlansByRun.set(runId, byModelCall);
  }
  byModelCall.set(plan.callIndex.modelCallIndex, structuredClone(plan));
  if (systemPromptDigest) {
    let digests = sealedSystemPromptDigestsByRun.get(runId);
    if (!digests) {
      digests = new Map();
      sealedSystemPromptDigestsByRun.set(runId, digests);
    }
    digests.set(plan.callIndex.modelCallIndex, systemPromptDigest);
  }
  if (correlationDigest) {
    let digests = sealedCorrelationDigestsByRun.get(runId);
    if (!digests) {
      digests = new Map();
      sealedCorrelationDigestsByRun.set(runId, digests);
    }
    digests.set(plan.callIndex.modelCallIndex, correlationDigest);
  }
}

export function getRc03SealedSystemPromptDigest(
  runId: string | undefined,
  modelCallIndex: number,
): string | undefined {
  if (!runId) return undefined;
  return sealedSystemPromptDigestsByRun.get(runId)?.get(modelCallIndex);
}

export function getRc03SealCorrelationDigest(
  runId: string | undefined,
  modelCallIndex: number,
): string | undefined {
  if (!runId) return undefined;
  return sealedCorrelationDigestsByRun.get(runId)?.get(modelCallIndex);
}

export function getRc03SealPlan(
  runId: string | undefined,
  modelCallIndex?: number,
  attemptIndex?: number,
): CompilePlan | undefined {
  if (!runId) return undefined;
  const byModelCall = sealedPlansByRun.get(runId);
  if (!byModelCall) return undefined;
  if (modelCallIndex !== undefined) {
    const plan = byModelCall.get(modelCallIndex);
    return plan && (attemptIndex === undefined || plan.callIndex.attemptIndex === attemptIndex)
      ? structuredClone(plan) : undefined;
  }
  // Legacy callers without an index resolve the latest sealed plan of the run.
  const indexes = [...byModelCall.keys()]
    .filter(index => attemptIndex === undefined || byModelCall.get(index)?.callIndex.attemptIndex === attemptIndex)
    .sort((left, right) => right - left);
  const plan = indexes.length > 0 ? byModelCall.get(indexes[0]) : undefined;
  return plan ? structuredClone(plan) : undefined;
}

/** Normal calls and compaction share the same model-call identity sequence. */
export function nextRc03ModelCallIndex(runId: string | undefined, attemptIndex: number, requestedIndex: number): number {
  const latest = getRc03SealPlan(runId, undefined, attemptIndex);
  return Math.max(requestedIndex, modelCallHighWaterByRun.get(runId ?? '')?.get(attemptIndex) ?? 0,
    latest ? latest.callIndex.modelCallIndex + 1 : 0);
}

export function recordRc03ModelCallStarted(runId: string | undefined, attemptIndex: number, modelCallIndex: number): void {
  if (!runId) return;
  let highWater = modelCallHighWaterByRun.get(runId);
  if (!highWater) {
    highWater = new Map();
    modelCallHighWaterByRun.set(runId, highWater);
  }
  highWater.set(attemptIndex, Math.max(highWater.get(attemptIndex) ?? 0, modelCallIndex + 1));
}

export function clearRc03SealPlan(runId: string | undefined): void {
  if (!runId) return;
  sealedPlansByRun.delete(runId);
  sealedSystemPromptDigestsByRun.delete(runId);
  sealedCorrelationDigestsByRun.delete(runId);
  for (const key of messageReplacementAttempts) {
    if (key.startsWith(`${runId}|`)) messageReplacementAttempts.delete(key);
  }
}

/** End-of-run release is distinct from temporarily disabling a live turn. */
export function releaseRc03Run(runId: string | undefined): void {
  clearRc03SealPlan(runId);
  if (runId) modelCallHighWaterByRun.delete(runId);
}

/** Attempts whose transcript the active ContextEngine replaced before the seal. */
const messageReplacementAttempts = new Set<string>();

export function markRc03MessageReplacement(
  runId: string | undefined,
  attemptIndex = 0,
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!runId || !resolveRc03SealState(cfg, env).enabled) return;
  messageReplacementAttempts.add(`${runId}|${attemptIndex}`);
}

/** Next free attempt index per runId after its embedded run ended. A provider
 *  fallback re-enters the embedded runner under the same runId and must open a
 *  new attempt identity instead of restarting at 0. Bounded: oldest run evicted. */
const RC03_ATTEMPT_HIGH_WATER_LIMIT = 1024;
const nextAttemptIndexByRun = new Map<string, number>();

export function beginRc03RunAttempts(runId: string | undefined): number {
  if (!runId) return 0;
  return nextAttemptIndexByRun.get(runId) ?? 0;
}

/** Release the run's sealed plans and remember where its attempt identity ended. */
export function endRc03RunAttempts(runId: string | undefined, nextAttemptIndex: number): void {
  if (!runId) return;
  releaseRc03Run(runId);
  nextAttemptIndexByRun.delete(runId);
  nextAttemptIndexByRun.set(runId, nextAttemptIndex);
  if (nextAttemptIndexByRun.size > RC03_ATTEMPT_HIGH_WATER_LIMIT) {
    const oldest = nextAttemptIndexByRun.keys().next().value;
    if (oldest !== undefined) nextAttemptIndexByRun.delete(oldest);
  }
}

export function resetRc03SealPlansForTest(): void {
  sealedPlansByRun.clear();
  sealedSystemPromptDigestsByRun.clear();
  sealedCorrelationDigestsByRun.clear();
  modelCallHighWaterByRun.clear();
  nextAttemptIndexByRun.clear();
  systemPromptContributions.clear();
  messageReplacementAttempts.clear();
}

/** Semantic system-prompt text produced outside the Context Orchestrator
 *  (COMPASS pre-reply, role-spawn memory pack). The producer records what it
 *  emitted; the seal attributes it by content in the provider-bound prompt.
 *  In-memory only, never persisted, and recorded only while the seal is on. */
const RC03_CONTRIBUTION_LIMIT = 256;
const systemPromptContributions = new Map<string, { producerId: string; text: string }>();

export function recordRc03SystemPromptContribution(
  producerId: string,
  text: string | undefined,
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const trimmed = text?.trim();
  if (!trimmed || !resolveRc03SealState(cfg, env).enabled) return;
  const key = sha256(`${producerId}|${trimmed}`);
  systemPromptContributions.delete(key);
  systemPromptContributions.set(key, { producerId, text: trimmed });
  while (systemPromptContributions.size > RC03_CONTRIBUTION_LIMIT) {
    const oldest = systemPromptContributions.keys().next().value;
    if (oldest === undefined) break;
    systemPromptContributions.delete(oldest);
  }
}

/** Registered contributions present in the provider-bound system prompt. */
export function attributeRc03SystemPromptContributions(
  systemPrompt: string,
  alreadyProjected: ContextCandidateProjection['systemPromptContributions'] = [],
): Array<{ producerId: string; chars: number }> {
  const chars = new Map<string, number>();
  for (const { producerId, text } of systemPromptContributions.values()) {
    if (systemPrompt.includes(text)) {
      // Preserve the producer ref across calls, but do not charge text already
      // represented by this call's candidate lineage a second time.
      const represented = alreadyProjected.some((entry) =>
        producerIdForLineageSource(entry.sourceId) === producerId && entry.text.trim() === text);
      chars.set(producerId, (chars.get(producerId) ?? 0) + (represented ? 0 : text.length));
    }
  }
  return [...chars.entries()]
    .map(([producerId, total]) => ({ producerId, chars: total }))
    .sort((left, right) => left.producerId.localeCompare(right.producerId));
}

export type Rc03SealHookOptions = {
  enabled?: boolean;
  killed?: boolean;
  sessionKey?: string;
  runId?: string;
  providerId?: string;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
  /**
   * F-01: per-model-call identity. The same attempt seals one immutable bundle
   * per model call; WireReceipts of later calls correlate to their own bundle.
   */
  attemptIndex?: number;
  modelCallIndex?: number;
  /** Real producer execution results: ids of producers that actually applied
   *  content this turn. When absent, the hook derives applied ids from the
   *  projection lineage instead of marking every registered producer. */
  appliedProducerIds?: string[];
  /** A registered producer whose model call bypasses the Context Orchestrator
   *  and is sealed at the stream boundary; `chars` is its real semantic size. */
  boundaryProducer?: { id: string; chars: number };
  /** The full provider-bound system prompt at the seal. Its digest is bound so
   *  the wire boundary can detect any post-seal semantic mutation, and its
   *  bytes are attributed to registered producers. */
  systemPrompt?: string;
};

export type Rc03SealHookResult = {
  sealCoverage: 'disabled' | 'enforced';
  engaged: boolean;
  enforced: boolean;
  bundleSealed: boolean;
  contextReceiptPersisted: boolean;
  /** Unregistered producer ids (should be empty; zero-bypass enforcement). */
  unregisteredProducers: string[];
  /** The compiled plan for this sealed turn; the runner carries it to the
   *  guarded wire boundary so WireReceipt/v1 can correlate. */
  plan?: CompilePlan;
  /** Correlation digest of the immutable sealed ContextBundle. */
  bundleDigest?: string;
  /** Registered non-semantic transport transforms applied after the seal. */
  postSealTransformIds: string[];
};

/**
 * Resolve the RC-03 seal switch from real source-runtime config + env. The
 * feature flag is default-off; the enhancement kill switch always wins.
 * Never throws: malformed config/env is treated as off (fail-closed).
 */
export function resolveRc03SealState(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; killed: boolean } {
  const killed = isContextEnhancementKillSwitchEngaged(cfg, env);
  let enabled = false;
  try {
    const raw = env[RC03_SEAL_ENV]?.trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') enabled = true;
    if (!enabled && cfg && typeof cfg === 'object') {
      const record = cfg as Record<string, unknown>;
      const runtime = record.runtime && typeof record.runtime === 'object'
        ? (record.runtime as Record<string, unknown>)
        : undefined;
      const rc03 = runtime?.rc03 && typeof runtime.rc03 === 'object'
        ? (runtime.rc03 as Record<string, unknown>)
        : undefined;
      if (rc03?.seal === true) enabled = true;
    }
  } catch {
    enabled = false;
  }
  return { enabled: enabled && !killed, killed };
}

/** Both seal creation and stream enforcement use the same current config. */
export function resolveCurrentRc03SealState(cfg?: unknown): { enabled: boolean; killed: boolean; configured: boolean } {
  const current = resolveKillSwitchConfig();
  return { ...resolveRc03SealState(current ?? cfg), configured: current !== undefined || cfg !== undefined };
}

/** Map a projection lineage source id to its registered pre-seal producer.
 *
 *  F-02: the Assembler emits canonical `context-block:<source_system>:<block_type>`
 *  ids (e.g. `context-block:working-memory:working_memory`); the Context
 *  Orchestrator emits `memory-inject-pilot` / `vtoken-assembly`. All of them
 *  must resolve to registered producers so appliedProducerIdsFromLineage is a
 *  true statement about the real production run, not a shorthand-only mapping. */
function producerIdForLineageSource(sourceId: string): string | undefined {
  if (sourceId.startsWith('context-block:')) {
    const [, sourceSystem, blockType] = sourceId.split(':');
    switch (blockType) {
      case 'knowledge':
        return 'dcs-knowledge';
      case 'working_memory':
        return 'dcs-working-memory';
      case 'tool_registry':
        return 'dcs-tool-registry';
    }
    switch (sourceSystem) {
      case 'compass':
        return 'compass-ssp';
      case 'role-memory':
        return 'role-memory-injection';
      default:
        return undefined;
    }
  }
  switch (sourceId) {
    case 'cvk-message-replacement':
      return 'cvk-message-replacement';
    case 'dcs-knowledge':
    case 'knowledge':
      return 'dcs-knowledge';
    case 'working_memory':
      return 'dcs-working-memory';
    case 'tool_registry':
      return 'dcs-tool-registry';
    case 'cvk_addition':
    case 'cvk-context-engine':
      return 'cvk-system-prompt-addition';
    case 'compass':
    case 'compass-ssp':
      return 'compass-ssp';
    case 'compass-retrieval':
      return 'compass-retrieval';
    case 'role_memory':
      return 'role-memory-injection';
    case 'vtoken':
    case 'vtoken-assembly':
      return 'vtoken-packer';
    case 'memory-inject-pilot':
      return 'memory-pilot-injection';
    case 'compaction-summarizer':
      return 'compaction-summarizer';
    case 'session-start':
      return RC03_PRE_SEAL_PRODUCERS.sessionStart;
    default:
      if (sourceId.startsWith('session-start:')) return RC03_PRE_SEAL_PRODUCERS.sessionStart;
      if (sourceId.startsWith('memory-inject-pilot:')) {
        return 'memory-pilot-injection';
      }
      return undefined;
  }
}

/** Derive applied producer ids from the real projection lineage. */
export function appliedProducerIdsFromLineage(
  projection: ContextCandidateProjection,
): string[] {
  const applied = new Set<string>();
  for (const entry of projection.lineage) {
    if (entry.charsApplied <= 0) continue;
    const producerId = producerIdForLineageSource(entry.sourceId);
    // Unknown sources must reach admission instead of disappearing from the plan.
    applied.add(producerId ?? entry.sourceId);
  }
  return [...applied].sort();
}

// Candidate identities include encoded authority paths/versions and can exceed
// the receipt's 256-character bound. Retain the source label and hash the full
// identity, so refs stay bounded and do not persist private authority paths.
function candidateReceiptRef(entry: ContextCandidateProjection['lineage'][number]): string {
  const source = encodeURIComponent(entry.sourceId).slice(0, 96);
  const digest = createHash('sha256').update(entry.candidateId).digest('hex');
  return `ref:context:${source}:${digest}`;
}

function candidateDisposition(
  entry: ContextCandidateProjection['lineage'][number],
): ReceiptCandidateDisposition {
  const disposition = entry.disposition as ReceiptCandidateDisposition | undefined;
  if (
    disposition === 'applied' ||
    disposition === 'truncate' ||
    disposition === 'drop' ||
    disposition === 'skip' ||
    disposition === 'duplicate' ||
    disposition === 'pending'
  ) {
    return disposition;
  }
  return entry.charsApplied > 0 ? 'applied' : 'skip';
}

function candidateReason(
  entry: ContextCandidateProjection['lineage'][number],
): ReceiptCandidateReason {
  const reason = entry.reason as ReceiptCandidateReason | undefined;
  if (
    reason === 'collected' ||
    reason === 'applied' ||
    reason === 'duplicate' ||
    reason === 'empty' ||
    reason === 'budget-truncate' ||
    reason === 'budget-drop' ||
    reason === 'flag-off' ||
    reason === 'kill-switch' ||
    reason === 'stale-history' ||
    reason === 'skip-channel'
  ) {
    return reason;
  }
  return entry.charsApplied > 0 ? 'applied' : 'empty';
}

function candidateDecisionProjection(
  lineage: ContextCandidateProjection['lineage'],
): ReceiptCandidateDecisions {
  return {
    complete: lineage.length <= 64,
    decisions: lineage.slice(0, 64).map((entry) => ({
      ref: candidateReceiptRef(entry),
      sourceId: entry.sourceId,
      channel: entry.channel,
      disposition: candidateDisposition(entry),
      reason: candidateReason(entry),
      charsRequested: entry.charsRequested,
      charsApplied: entry.charsApplied,
    })),
  };
}

function recordSealFailure(phase: ShadowCensusFailureDiagnostic['phase'], code: ShadowCensusFailureDiagnostic['code']) {
  recordShadowCensusFailure(phase, code);
}

/**
 * Run the RC-03 seal hook at the pre-seal convergence point. Registers the
 * RC-03 producers, asserts the semantic producers that must run pre-seal were
 * registered, builds+seals the ContextBundle, and persists a ContextReceipt/v1
 * through the approved ReceiptStore. Returns an engaged flag so the caller can
 * record lineage without changing send behavior. Receipt write failures are
 * recorded in the shadow census diagnostics (fail-closed) and never change
 * send behavior.
 */
export function runRc03SealHook(
  projection: ContextCandidateProjection,
  messages: readonly unknown[],
  options: Rc03SealHookOptions = {},
): Rc03SealHookResult {
  const enabled = options.enabled === true;
  const killed = options.killed === true;
  if (!enabled || killed) {
    clearRc03SealPlan(options.runId);
    return { sealCoverage: 'disabled', engaged: false, enforced: false, bundleSealed: false, contextReceiptPersisted: false, unregisteredProducers: [], postSealTransformIds: [] };
  }
  registerRc03SealProducers();
  const boundary = options.boundaryProducer;
  const systemPrompt = options.systemPrompt ?? projection.systemPromptAddition ?? '';
  const attributed = systemPrompt && !boundary
    ? attributeRc03SystemPromptContributions(systemPrompt, projection.systemPromptContributions)
    : [];
  const appliedProducerIds = [
        ...new Set([
          ...appliedProducerIdsFromLineage(projection),
          ...(options.appliedProducerIds ?? []),
          ...(boundary ? [boundary.id] : []),
          ...attributed.map((entry) => entry.producerId),
          ...(systemPrompt && !boundary ? [RC03_PRE_SEAL_PRODUCERS.embeddedSystemPrompt] : []),
          ...(options.runId &&
          messageReplacementAttempts.has(`${options.runId}|${options.attemptIndex ?? 0}`)
            ? [RC03_PRE_SEAL_PRODUCERS.cvkMessageReplacement]
            : []),
        ]),
      ].sort();
  for (const id of appliedProducerIds) assertSealMutation(id, 'pre-seal');
  // Registered custom producers use the same plan, not a second registry.
  const preSealIds = [...new Set([...rc03PreSealProducerIds(),
    ...getSealCoverageMatrix().filter(row => row.phase === 'pre-seal').map(row => row.id)])];
  const preSealProducers = preSealIds.map((id) => {
    const registration = getSealProducer(id);
    return {
      producerId: id,
      producerVersion: registration?.version ?? 'unknown',
      applied: appliedProducerIds.includes(id),
    };
  });
  const postSealTransformIds = registeredTransportTransformIds();
  for (const id of postSealTransformIds) assertSealMutation(id, 'post-seal');

  const plan = createCompilePlan({
    sessionKey: options.sessionKey,
    runId: options.runId,
    providerId: options.providerId,
    policyDigest: RC03_SEAL_POLICY_DIGEST,
    callIndex: {
      attemptIndex: options.attemptIndex ?? 0,
      planRevision: 0,
      modelCallIndex: options.modelCallIndex ?? 0,
      wireAttemptIndex: 0,
    },
    preSealProducers,
    postSealTransformIds,
  });

  // RC-02 typed store: receipt refs are canonical ref:context: ids, never raw
  // candidate ids.
  const attributedRefs = attributed.map((entry) => `ref:context:producer:${entry.producerId}`);
  const attributedChars = attributed.reduce((total, entry) => total + entry.chars, 0);
  const selectedRefs = boundary
    ? [`ref:context:boundary:${boundary.id}:${options.modelCallIndex ?? 0}`]
    : [
        ...projection.lineage
          .filter((entry) => entry.charsApplied > 0)
          .map(candidateReceiptRef),
        ...attributedRefs,
      ];
  const omittedRefs = projection.lineage
    .filter((entry) => entry.charsApplied === 0)
    .map(candidateReceiptRef);
  const charsRequested = boundary
    ? boundary.chars
    : projection.lineage.reduce((t, e) => t + e.charsRequested, 0) + attributedChars;
  const charsApplied = boundary
    ? boundary.chars
    : projection.lineage.reduce((t, e) => t + e.charsApplied, 0) + attributedChars;

  const bundle = sealContextBundle(
    createContextBundle({
      plan,
      systemPrompt: systemPrompt ?? projection.systemPromptAddition,
      messages,
      appliedProducerIds,
      selectedRefs,
      omittedRefs,
      budgetSummary: JSON.stringify({ unit: 'chars', charsRequested, charsApplied }),
    }),
  );

  let contextReceiptPersisted: boolean;
  try {
    const store = options.database ? new ReceiptStore(options.database) : new ReceiptStore();
    const identity = {
      runtimeMode: 'source' as const,
      providerId: options.providerId ?? 'dcs',
      adapterId: 'dcs-context-engine',
      sessionKey: options.sessionKey,
      runId: options.runId,
    };
    const result = store.put(
      buildContextReceiptInput({
        plan,
        bundle,
        identity,
        correlationDigest: bundle.bundleDigest,
        selectedRefs,
        omittedRefs,
        candidateDecisions: candidateDecisionProjection(projection.lineage),
        budget: bundle.budgetSummary,
      }),
    );
    contextReceiptPersisted = result.ok === true;
    if (!result.ok) receiptLog.warn(`ContextReceipt rejected: ${result.reason}`);
  } catch (error) {
    receiptLog.warn(`ContextReceipt write failed: ${String(error).slice(0, 400)}`);
    contextReceiptPersisted = false;
  }
  if (!contextReceiptPersisted) {
    recordSealFailure('context-write', 'receipt-store-write-failed');
  }
  recordRc03SealPlan(
    options.runId,
    plan,
    sha256(stripSystemPromptCacheBoundary(systemPrompt)),
    bundle.bundleDigest,
  );

  return {
    sealCoverage: 'enforced',
    engaged: true,
    enforced: true,
    bundleSealed: bundle.sealed,
    contextReceiptPersisted,
    unregisteredProducers: [],
    plan,
    bundleDigest: bundle.bundleDigest,
    postSealTransformIds,
  };
}
