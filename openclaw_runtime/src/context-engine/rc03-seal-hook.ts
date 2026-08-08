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

/** Sealed plans per run, so the guarded wire boundary can emit WireReceipt/v1
 *  correlated to the sealed ContextBundle of the same run. In-process only;
 *  cleared with the turn. */
const sealedPlansByRun = new Map<string, CompilePlan>();

export function recordRc03SealPlan(runId: string | undefined, plan: CompilePlan): void {
  if (!runId) return;
  sealedPlansByRun.set(runId, plan);
}

export function getRc03SealPlan(runId: string | undefined): CompilePlan | undefined {
  if (!runId) return undefined;
  return sealedPlansByRun.get(runId);
}

export function clearRc03SealPlan(runId: string | undefined): void {
  if (!runId) return;
  sealedPlansByRun.delete(runId);
}

export function resetRc03SealPlansForTest(): void {
  sealedPlansByRun.clear();
}

export type Rc03SealHookOptions = {
  enabled?: boolean;
  killed?: boolean;
  sessionKey?: string;
  runId?: string;
  providerId?: string;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
  /** Real producer execution results: ids of producers that actually applied
   *  content this turn. When absent, the hook derives applied ids from the
   *  projection lineage instead of marking every registered producer. */
  appliedProducerIds?: string[];
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

/** Map a projection lineage source id to its registered pre-seal producer. */
function producerIdForLineageSource(sourceId: string): string | undefined {
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
      return 'vtoken-packer';
    default:
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

  const appliedProducerIds =
    options.appliedProducerIds ?? appliedProducerIdsFromLineage(projection);
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
    callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
    preSealProducers,
    postSealTransformIds,
  });

  // RC-02 typed store: receipt refs are canonical ref:context: ids, never raw
  // candidate ids.
  const selectedRefs = projection.lineage
    .filter((entry) => entry.charsApplied > 0)
    .map((entry) => `ref:context:${entry.candidateId}`);
  const omittedRefs = projection.lineage
    .filter((entry) => entry.charsApplied === 0)
    .map((entry) => `ref:context:${entry.candidateId}`);

  const bundle = sealContextBundle(
    createContextBundle({
      plan,
      systemPrompt: projection.systemPromptAddition,
      messages,
      appliedProducerIds,
      selectedRefs,
      omittedRefs,
      budgetSummary: JSON.stringify({
        charsRequested: projection.lineage.reduce((t, e) => t + e.charsRequested, 0),
        charsApplied: projection.lineage.reduce((t, e) => t + e.charsApplied, 0),
      }),
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
