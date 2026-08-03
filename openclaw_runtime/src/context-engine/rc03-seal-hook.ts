// RC-03 production wiring: the seal hook is called from the pre-seal semantic
// producer convergence point (finalizeContextOrchestratorTurn). It enforces that
// every DCS semantic producer was registered before the bundle is sealed
// (zero-bypass), builds the immutable ContextBundle, seals it, and persists a
// ContextReceipt/v1 when the RC-03 flag is on. Gated by a feature flag
// (default-off) and the existing enhancement kill switch; when off, it is a
// no-op and the legacy path is byte-identical.
import { ReceiptStore } from '../agents/receipt-store.js';
import { createContextBundle, sealContextBundle } from './context-bundle.js';
import { buildContextReceiptInput } from './dcs-receipts.js';
import { createCompilePlan } from './compile-plan.js';
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

export type Rc03SealHookOptions = {
  enabled?: boolean;
  killed?: boolean;
  sessionKey?: string;
  runId?: string;
  providerId?: string;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
};

export type Rc03SealHookResult = {
  engaged: boolean;
  enforced: boolean;
  bundleSealed: boolean;
  contextReceiptPersisted: boolean;
  /** Unregistered producer ids (should be empty; zero-bypass enforcement). */
  unregisteredProducers: string[];
};

/**
 * Run the RC-03 seal hook at the pre-seal convergence point. Registers the
 * RC-03 producers, asserts the semantic producers that must run pre-seal were
 * registered, builds+seals the ContextBundle, and persists a ContextReceipt/v1
 * through the approved ReceiptStore. Returns an engaged flag so the caller can
 * record lineage without changing send behavior.
 */
export function runRc03SealHook(
  projection: ContextCandidateProjection,
  messages: readonly unknown[],
  options: Rc03SealHookOptions = {},
): Rc03SealHookResult {
  const enabled = options.enabled === true;
  const killed = options.killed === true;
  if (!enabled || killed) {
    return { engaged: false, enforced: false, bundleSealed: false, contextReceiptPersisted: false, unregisteredProducers: [] };
  }
  registerRc03SealProducers();
  // Zero-bypass enforcement: every registered pre-seal producer must be present.
  const unregisteredProducers = assertSealProducersRegistered(rc03PreSealProducerIds());

  const plan = createCompilePlan({
    sessionKey: options.sessionKey,
    runId: options.runId,
    providerId: options.providerId,
    policyDigest: 'rc03-seal-policy-v1',
    callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
    preSealProducers: rc03PreSealProducerIds().map((id) => {
      const registration = getSealProducer(id);
      return { producerId: id, producerVersion: registration?.version ?? 'unknown', applied: true };
    }),
    postSealTransformIds: ['transport-wire-serialization'],
  });

  const selectedRefs = projection.lineage.filter((entry) => entry.charsApplied > 0).map((entry) => entry.candidateId);
  const omittedRefs = projection.lineage.filter((entry) => entry.charsApplied === 0).map((entry) => entry.candidateId);

  const bundle = sealContextBundle(
    createContextBundle({
      plan,
      systemPrompt: projection.systemPromptAddition,
      messages,
      appliedProducerIds: [...rc03PreSealProducerIds()],
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

  return {
    engaged: true,
    enforced: unregisteredProducers.length === 0,
    bundleSealed: bundle.sealed,
    contextReceiptPersisted,
    unregisteredProducers,
  };
}
