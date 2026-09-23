// RC-03 production wiring: the seal hook is called from the pre-seal semantic
// producer convergence point (finalizeContextOrchestratorTurn). It enforces that
// every DCS semantic producer was registered before the bundle is sealed
// (zero-bypass), builds the immutable ContextBundle, seals it, and persists a
// ContextReceipt/v1 when the RC-03 flag is on. Gated by a feature flag
// (default-off) and the existing enhancement kill switch; when off, it is a
// no-op and the legacy path is byte-identical.
import { ReceiptStore } from '../agents/receipt-store.js';
import {
  recordShadowCensusFailure,
  type ShadowCensusFailureDiagnostic,
} from '../agents/shadow-census.js';
import { createContextBundle, sealContextBundle } from './context-bundle.js';
import { buildContextReceiptInput } from './dcs-receipts.js';
import { createCompilePlan, type CompilePlan } from './compile-plan.js';
import { isContextEnhancementKillSwitchEngaged } from './enhancement-kill-switch.js';
import {
  assertSealProducersRegistered,
  getSealProducer,
} from './seal-registry.js';
import {
  rc03PreSealProducerIds,
  registerRc03SealProducers,
} from './rc03-producers.js';
import type { ContextCandidateProjection } from './context-candidate.js';

export const RC03_SEAL_FLAG = 'rc03.seal';
export const RC03_SEAL_ENV = 'OPENCLAW_RC03_SEAL';
/** Compile-plan policy digest: sha256("rc03-seal-policy-v1"). */
export const RC03_SEAL_POLICY_DIGEST =
  '49ae4fddce0451f75ab207a392c8b51394d39abc9998027a705b29a677ffced1';

/** Sealed plans per run and model call, so the guarded wire boundary can emit
 *  WireReceipt/v1 correlated to the sealed ContextBundle of the same run and
 *  model call. In-process only; cleared with the turn. */
const sealedPlansByRun = new Map<string, Map<number, CompilePlan>>();

export function recordRc03SealPlan(runId: string | undefined, plan: CompilePlan): void {
  if (!runId) return;
  let byModelCall = sealedPlansByRun.get(runId);
  if (!byModelCall) {
    byModelCall = new Map();
    sealedPlansByRun.set(runId, byModelCall);
  }
  byModelCall.set(plan.callIndex.modelCallIndex, plan);
}

export function getRc03SealPlan(
  runId: string | undefined,
  modelCallIndex?: number,
): CompilePlan | undefined {
  if (!runId) return undefined;
  const byModelCall = sealedPlansByRun.get(runId);
  if (!byModelCall) return undefined;
  if (modelCallIndex !== undefined) {
    return byModelCall.get(modelCallIndex);
  }
  // Legacy callers without an index resolve the latest sealed plan of the run.
  const indexes = [...byModelCall.keys()].sort((left, right) => right - left);
  return indexes.length > 0 ? byModelCall.get(indexes[0]) : undefined;
}

export function clearRc03SealPlan(runId: string | undefined): void {
  if (!runId) return;
  sealedPlansByRun.delete(runId);
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
  clearRc03SealPlan(runId);
  nextAttemptIndexByRun.delete(runId);
  nextAttemptIndexByRun.set(runId, nextAttemptIndex);
  if (nextAttemptIndexByRun.size > RC03_ATTEMPT_HIGH_WATER_LIMIT) {
    const oldest = nextAttemptIndexByRun.keys().next().value;
    if (oldest !== undefined) nextAttemptIndexByRun.delete(oldest);
  }
}

export function resetRc03SealPlansForTest(): void {
  sealedPlansByRun.clear();
  nextAttemptIndexByRun.clear();
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
};

export type Rc03SealHookResult = {
  engaged: boolean;
  enforced: boolean;
  bundleSealed: boolean;
  contextReceiptPersisted: boolean;
  /** Unregistered producer ids (should be empty; zero-bypass enforcement). */
  unregisteredProducers: string[];
  /** The compiled plan for this sealed turn; the runner carries it to the
   *  guarded wire boundary so WireReceipt/v1 can correlate. */
  plan?: CompilePlan;
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
      return 'compass-ssp';
    case 'role_memory':
      return 'role-memory-injection';
    case 'vtoken':
    case 'vtoken-assembly':
      return 'vtoken-packer';
    case 'memory-inject-pilot':
      return 'memory-pilot-injection';
    case 'compaction-summarizer':
      return 'compaction-summarizer';
    default:
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
    if (producerId) applied.add(producerId);
  }
  return [...applied].sort();
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
    return { engaged: false, enforced: false, bundleSealed: false, contextReceiptPersisted: false, unregisteredProducers: [], postSealTransformIds: [] };
  }
  registerRc03SealProducers();
  // Zero-bypass enforcement: every registered pre-seal producer must be present.
  const unregisteredProducers = assertSealProducersRegistered(rc03PreSealProducerIds());

  const boundary = options.boundaryProducer;
  const appliedProducerIds = boundary
    ? [boundary.id]
    : (options.appliedProducerIds ?? appliedProducerIdsFromLineage(projection));
  const preSealProducers = rc03PreSealProducerIds().map((id) => {
    const registration = getSealProducer(id);
    return {
      producerId: id,
      producerVersion: registration?.version ?? 'unknown',
      applied: appliedProducerIds.includes(id),
    };
  });
  const postSealTransformIds = ['transport-wire-serialization'];

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
  const selectedRefs = boundary
    ? [`ref:context:boundary:${boundary.id}:${options.modelCallIndex ?? 0}`]
    : projection.lineage
        .filter((entry) => entry.charsApplied > 0)
        .map((entry) => `ref:context:${entry.candidateId}`);
  const omittedRefs = projection.lineage
    .filter((entry) => entry.charsApplied === 0)
    .map((entry) => `ref:context:${entry.candidateId}`);
  const charsRequested = boundary
    ? boundary.chars
    : projection.lineage.reduce((t, e) => t + e.charsRequested, 0);
  const charsApplied = boundary
    ? boundary.chars
    : projection.lineage.reduce((t, e) => t + e.charsApplied, 0);

  const bundle = sealContextBundle(
    createContextBundle({
      plan,
      systemPrompt: projection.systemPromptAddition,
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
        budget: bundle.budgetSummary,
      }),
    );
    contextReceiptPersisted = result.ok === true;
  } catch {
    contextReceiptPersisted = false;
  }
  if (!contextReceiptPersisted) {
    recordSealFailure('context-write', 'receipt-store-write-failed');
  }
  recordRc03SealPlan(options.runId, plan);

  return {
    engaged: true,
    enforced: unregisteredProducers.length === 0,
    bundleSealed: bundle.sealed,
    contextReceiptPersisted,
    unregisteredProducers,
    plan,
    postSealTransformIds,
  };
}
