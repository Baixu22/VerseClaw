import {
  buildPreReplyInjection,
  loadCompassFacts,
  resolveCompassConfig,
  type PreReplyInjection,
} from "../runtime-core/memory-pre-reply-injection.js";
import {
  beginContextCandidateCollection,
  collectContextCandidate,
  createContextCandidate,
  recordContextCandidateSkip,
  type ContextCandidateCollection,
  type ContextCandidateProjection,
} from "./context-candidate.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import { recordCompassMemoryInjectionReceipt } from "./memory-injection-receipt.js";

/** Serializable queue input; applied ids are populated only by final projection. */
export type PreparedCompassContext = {
  sessionKey: string;
  injection: PreReplyInjection;
  candidateFactIds: string[];
  appliedFactIds: string[];
};

export async function prepareCompassContext(params: {
  sessionKey: string;
  userInputText: string;
  cfg: unknown;
}) {
  const config = resolveCompassConfig(params.cfg);
  const killed = isContextEnhancementKillSwitchEngaged(params.cfg);
  const facts =
    !killed && config.featureFlags.enablePreReplyRetrieval ? loadCompassFacts(params.cfg) : [];
  const disabled =
    !config.featureFlags.enableSessionStatePage && !config.featureFlags.enablePreReplyRetrieval;
  const injection: PreReplyInjection =
    killed || disabled
      ? { iFrameRefreshed: false }
      : await buildPreReplyInjection({ ...params, config, facts });
  const context: PreparedCompassContext = {
    sessionKey: params.sessionKey,
    injection,
    candidateFactIds: facts.map((fact) => fact.factId),
    appliedFactIds: [],
  };
  return { context, facts };
}

// Metadata follows the existing collection lifetime; it owns no budget or projection.
const contexts = new WeakMap<ContextCandidateCollection, PreparedCompassContext>();

export function collectCompassContext(
  turnId: string,
  context: PreparedCompassContext,
  cfg: unknown,
) {
  const collection = beginContextCandidateCollection(turnId);
  contexts.set(collection, context);
  context.appliedFactIds = [];
  const killed = isContextEnhancementKillSwitchEngaged(cfg);
  const flags = resolveCompassConfig(cfg).featureFlags;
  for (const [sourceId, text, enabled] of [
    ["compass-ssp", context.injection.sspString, flags.enableSessionStatePage],
    ["compass-retrieval", context.injection.top5FactsString, flags.enablePreReplyRetrieval],
  ] as const) {
    if (killed || !enabled || !text) {
      recordContextCandidateSkip(turnId, {
        sourceId,
        channel: "knowledge",
        target: "system_prompt",
        reason: killed ? "kill-switch" : !enabled ? "flag-off" : "empty",
      });
      continue;
    }
    collectContextCandidate(
      turnId,
      createContextCandidate({
        sourceId,
        authorityObjectId: `${sourceId}:${context.sessionKey}`,
        authorityVersion: "1",
        channel: "knowledge",
        target: "system_prompt",
        text,
      }),
    );
  }
}

export function recordCompassProjection(
  collection: ContextCandidateCollection,
  projection: ContextCandidateProjection,
) {
  const context = contexts.get(collection);
  if (!context) return;
  // Reopened tool-loop collections retain the already projected system prompt.
  // An empty new collection must not erase that prompt's fact-use attribution.
  if (!projection.lineage.some((entry) => entry.sourceId.startsWith("compass-"))) return;
  const retrieval = projection.lineage.find(
    (entry) => entry.sourceId === "compass-retrieval" && entry.reason === "applied",
  );
  // A truncated fact group cannot prove which facts survived. Only complete
  // groups contribute fact-use metrics; all partial bytes remain in lineage.
  context.appliedFactIds = retrieval ? [...(context.injection.injectedFactIds ?? [])] : [];
  if (context.appliedFactIds.length === 0) return;
  recordCompassMemoryInjectionReceipt({
    sessionKey: context.sessionKey,
    injection: { ...context.injection, injectedFactIds: context.appliedFactIds },
    candidateFacts: context.candidateFactIds.map((factId) => ({ factId })),
  });
}
