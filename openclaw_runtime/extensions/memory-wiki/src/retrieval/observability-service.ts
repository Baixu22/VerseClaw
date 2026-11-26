import { createHash, randomUUID } from "node:crypto";
import {
  defaultRetrievalPolicy,
  normalizeRetrievalPolicy,
  retrievalPolicyDigest,
  evaluateOfflineRetrievalPromotion,
  verifyOfflineRagPolicyPackage,
  type RetrievalPolicyV1,
  type RetrievalReceiptV1,
  type RetrievalResultV2,
  type RetrievalProfile,
  type RetrievalObservabilitySnapshotV1,
  type OfflinePolicyPromotionV1,
  type KnowledgePolicyPromotionPayload,
  type KnowledgePolicyRollbackPayload,
  type KnowledgeRetrievalFeedbackPayload,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import { normalizeSourceRefV2 } from "openclaw/plugin-sdk/memory-host-core";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";
import type { OpenClawConfig } from "../../api.js";
import type { ResolvedMemoryWikiConfig } from "../config.js";
import {
  createMemoryWikiReadContext,
  memoryWikiNamespaceId,
  type MemoryWikiReadIdentity,
} from "../owner-read.js";
import { getMemoryWikiPage } from "../query.js";
import type { MemoryWikiProjectionService } from "../retrieval-index.js";

const sha = (value: unknown) =>
  "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const operationId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value))
    throw new Error("Invalid retrieval operation identity");
  return value;
};
type SavedPolicy = {
  active: RetrievalPolicyV1;
  previous?: RetrievalPolicyV1;
  calibrationGenerationDigest?: string;
  previousCalibrationGenerationDigest?: string;
  operations: Array<{ id: string; digest: string; receipt: OfflinePolicyPromotionV1 }>;
};
type SavedReceipt = {
  receipt: RetrievalReceiptV1;
  feedbackIds: Array<{ id: string; action: string }>;
};

/** The plugin's existing SQLite state owner persists receipts and policy transitions. */
export function createMemoryWikiObservabilityService(options: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  projection?: MemoryWikiProjectionService;
  openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>;
}) {
  const policies = options.openKeyedStore<SavedPolicy>({
    namespace: "retrieval-policies-v1",
    maxEntries: 48,
  });
  const receipts = options.openKeyedStore<SavedReceipt>({
    namespace: "retrieval-receipts-v1",
    maxEntries: 1000,
  });
  const namespaceId = memoryWikiNamespaceId(options.config);
  let sourceEpoch = 0;
  let serial: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const job = serial.then(run);
    serial = job.catch(() => undefined);
    return job;
  };
  const scope = (identity: MemoryWikiReadIdentity) => {
    if (
      !identity.workspaceId ||
      !identity.workspaceDir ||
      !identity.sessionId ||
      !identity.agentSessionKey
    )
      throw new Error("Retrieval diagnostics require a backend-owned workspace and session");
    const context = createMemoryWikiReadContext({ ...options, identity });
    if (context.sessionId !== identity.sessionId)
      throw new Error("Retrieval session generation changed");
    return {
      context,
      ownerKey: sha([
        namespaceId,
        context.principalId,
        context.workspaceId,
        context.workspaceRootDigest,
        context.policyDigest,
      ]),
    };
  };
  const key = (owner: string, profile: RetrievalProfile) => `${owner}:${profile}`;
  const assertCurrent = (identity: MemoryWikiReadIdentity, owner: string) => {
    if (scope(identity).ownerKey !== owner) throw new Error("Retrieval owner changed");
  };
  const currentSources = async (
    receipt: RetrievalReceiptV1,
    identity: MemoryWikiReadIdentity,
    signal = AbortSignal.timeout(2000),
  ): Promise<boolean> => {
    for (const sourceRef of receipt.sources) {
      const page = await getMemoryWikiPage({
        config: options.config,
        appConfig: options.appConfig,
        lookup: sourceRef.subjectId,
        sourceRef,
        readIdentity: identity,
        fromLine: sourceRef.locator?.startLine ?? 1,
        lineCount: sourceRef.locator
          ? sourceRef.locator.endLine - sourceRef.locator.startLine + 1
          : 1,
        signal,
      });
      if (!page || page.status === "denied" || !page.ownerSnapshot) return false;
    }
    return true;
  };

  return {
    async idle(): Promise<void> {
      await serial;
    },
    pruneExpired(): Promise<void> {
      return enqueue(async () => {
        const cutoff = Date.now() - 30 * 86400000;
        for (const row of await receipts.entries()) {
          if (row.value.receipt.createdAt < cutoff) await receipts.delete(row.key);
        }
      });
    },
    async policy(
      identity: MemoryWikiReadIdentity,
      profile: RetrievalProfile,
    ): Promise<RetrievalPolicyV1> {
      const { ownerKey } = scope(identity);
      const value = await policies.lookup(key(ownerKey, profile));
      assertCurrent(identity, ownerKey);
      return value ? normalizeRetrievalPolicy(value.active) : defaultRetrievalPolicy(profile);
    },
    async record(
      identity: MemoryWikiReadIdentity,
      result: RetrievalResultV2<unknown>,
      startedAt: number,
    ): Promise<string> {
      const epoch = sourceEpoch;
      const { ownerKey, context } = scope(identity);
      const receiptId = randomUUID();
      const sources = result.results.map((row) => normalizeSourceRefV2(row.sourceRef));
      if (sources.some((source) => !source || source.namespaceId !== namespaceId))
        throw new Error("Invalid retrieval receipt source scope");
      const receipt: RetrievalReceiptV1 = {
        schema: "RetrievalReceipt/v1",
        receiptId,
        requestId: result.plan.requestId,
        planId: result.plan.planId,
        createdAt: Date.now(),
        ownerKey,
        sessionGeneration: context.sessionId,
        queryDigest: sha(result.plan.queries),
        policyVersion: result.plan.policyVersion,
        policyDigest:
          result.plan.policyDigest ??
          retrievalPolicyDigest(defaultRetrievalPolicy(result.plan.profile)),
        profile: result.plan.profile,
        status: result.status,
        effectiveProfile: result.effectiveProfile,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        sources: sources.filter((source) => source !== undefined),
        generations: structuredClone(result.plan.generations),
        stages: [...result.lanes.map((lane) => ({
          stage: lane.lane,
          elapsedMs: lane.elapsedMs,
          status: lane.status,
          candidateCount: lane.candidateCount,
        })), ...(result.stages ?? [])],
        // Provider error strings can contain prompts or URLs. Store only stable codes or a digest.
        fallbackCodes: result.fallbackReasons.map((reason) =>
          /^[a-z][a-z0-9_-]{0,95}$/.test(reason) ? reason : sha(reason),
        ),
        model: result.rerank
          ? { providerRef: result.rerank.providerRef, model: result.rerank.model }
          : null,
        usage: {
          inputTokens: result.remoteSpend ? result.remoteSpend.actualTokens : result.rerank?.inputTokens ?? null,
          outputTokens: null,
          costUsd: result.remoteSpend ? result.remoteSpend.actualCostUsd : null,
        },
        dcs: null,
        modelRuns: [],
        feedback: { attach: 0, dismiss: 0 },
      };
      // The retrieval owner already validated these pins. Reads revalidate them;
      // diagnostics must not perform a second source retrieval on the answer path.
      assertCurrent(identity, ownerKey);
      await receipts.register(receiptId, { receipt, feedbackIds: [] });
      if (sourceEpoch !== epoch) {
        await receipts.delete(receiptId);
        throw new Error("Source changed during receipt persistence");
      }
      return receiptId;
    },
    async correlate(
      identity: MemoryWikiReadIdentity,
      input: {
        requestId: string;
        runId: string;
        purpose?: "answer" | "planning" | "support";
        elapsedMs?: number;
        support?: NonNullable<RetrievalReceiptV1["modelRuns"][number]["support"]>;
        retainedEvidence: {
          schema: string;
          turnId: string;
          units: Array<{ citations: Array<{ sourceRef: unknown }> }>;
        };
        providerSpend?: {
          actualTokens: number | null;
          actualCostUsd: number | null;
          modelRefs?: string[];
        };
      },
    ): Promise<void> {
      operationId(input.requestId);
      operationId(input.runId);
      const { ownerKey, context } = scope(identity);
      if ((input.purpose !== undefined && !["answer", "planning", "support"].includes(input.purpose))
        || (input.elapsedMs !== undefined && (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0))
        || (input.support && (input.purpose !== "support" || !["answerable", "insufficient", "conflicting"].includes(input.support.answerability)
          || [input.support.supported, input.support.unsupported, input.support.uncertain].some(value => !Number.isSafeInteger(value) || value < 0))))
        throw new Error("Invalid model stage receipt");
      if (
        input.retainedEvidence?.schema !== "RetainedEvidenceManifest/v1" ||
        !Array.isArray(input.retainedEvidence.units) ||
        input.retainedEvidence.units.length > 128
      )
        throw new Error("Invalid retained evidence receipt");
      const sources = input.retainedEvidence.units.flatMap((unit) =>
        unit.citations.map((citation) => normalizeSourceRefV2(citation.sourceRef)),
      );
      if (sources.length > 256 || sources.some((source) => !source))
        throw new Error("Invalid retained source pins");
      const validUsage = (value: unknown) =>
        value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
      if (
        input.providerSpend &&
        (!validUsage(input.providerSpend.actualTokens) ||
          !validUsage(input.providerSpend.actualCostUsd))
      )
        throw new Error("Invalid measured retrieval usage");
      const retainedDigest = sha(input.retainedEvidence);
      const modelRefs = input.providerSpend?.modelRefs ?? [];
      if (
        !Array.isArray(modelRefs) ||
        modelRefs.length > 32 ||
        modelRefs.some((ref) => typeof ref !== "string" || ref.length > 256 || /[\r\n\0]/.test(ref))
      )
        throw new Error("Invalid measured model identity");
      if (!receipts.update) throw new Error("Atomic retrieval correlation unavailable");
      for (const entry of await receipts.entries()) {
        const receipt = entry.value.receipt;
        if (
          receipt.ownerKey !== ownerKey ||
          receipt.requestId !== input.requestId ||
          receipt.sessionGeneration !== context.sessionId
        )
          continue;
        const retained = sources.filter(
          (source) => source && receipt.sources.some((expected) => sha(expected) === sha(source)),
        );
        assertCurrent(identity, ownerKey);
        await receipts.update(entry.key, (row) => {
          if (!row) return undefined;
          const prior = row.receipt.modelRuns.find((run) => run.runId === input.runId);
          if (prior) {
            if (prior.retainedDigest !== retainedDigest || prior.purpose !== input.purpose
              || JSON.stringify(prior.support) !== JSON.stringify(input.support)
              || prior.actualTokens !== (input.providerSpend?.actualTokens ?? null)
              || prior.actualCostUsd !== (input.providerSpend?.actualCostUsd ?? null)
              || JSON.stringify(prior.modelRefs) !== JSON.stringify(modelRefs))
              throw new Error("Conflicting retained evidence run");
            return row;
          }
          if (row.receipt.modelRuns.length >= 16)
            throw new Error("Retrieval model correlation budget exhausted");
          const run = {
            runId: input.runId,
            modelRefs,
            retainedDigest,
            actualTokens: input.providerSpend?.actualTokens ?? null,
            actualCostUsd: input.providerSpend?.actualCostUsd ?? null,
            ...(input.purpose ? { purpose: input.purpose } : {}),
            ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
            ...(input.support ? { support: { answerability: input.support.answerability,
              supported: input.support.supported, unsupported: input.support.unsupported, uncertain: input.support.uncertain } } : {}),
          };
          const modelRuns = [...row.receipt.modelRuns, run];
          const measuredTokens = modelRuns.every((value) => value.actualTokens !== null)
            ? modelRuns.reduce((sum, value) => sum + value.actualTokens!, 0)
            : null;
          const measuredCost = modelRuns.every((value) => value.actualCostUsd !== null)
            ? modelRuns.reduce((sum, value) => sum + value.actualCostUsd!, 0)
            : null;
          return {
            ...row,
            receipt: {
              ...row.receipt,
              modelRuns,
              usage: {
                ...row.receipt.usage,
                totalModelTokens: measuredTokens,
                modelCostUsd: measuredCost,
              },
              dcs: {
                runId: input.runId,
                receiptDigest: retainedDigest,
                retainedSourceDigests: retained.map((source) => source!.sourceDigest),
              },
            },
          };
        });
      }
    },
    async feedback(
      identity: MemoryWikiReadIdentity,
      input: KnowledgeRetrievalFeedbackPayload,
    ): Promise<void> {
      operationId(input.operationId);
      operationId(input.receiptId);
      if (input.action !== "attach" && input.action !== "dismiss")
        throw new Error("Invalid retrieval feedback");
      const { ownerKey } = scope(identity);
      const current = await receipts.lookup(input.receiptId);
      if (
        !current ||
        current.receipt.ownerKey !== ownerKey ||
        !(await currentSources(current.receipt, identity))
      )
        throw new Error("Retrieval feedback source is no longer admitted");
      assertCurrent(identity, ownerKey);
      if (!receipts.update) throw new Error("Atomic retrieval feedback storage unavailable");
      await receipts.update(input.receiptId, (row) => {
        if (!row || row.receipt.ownerKey !== ownerKey)
          throw new Error("Retrieval receipt disappeared");
        const prior = row.feedbackIds.find((value) => value.id === input.operationId);
        if (prior) {
          if (prior.action !== input.action)
            throw new Error("Conflicting retrieval feedback operation");
          return row;
        }
        if (row.feedbackIds.length >= 128) throw new Error("Retrieval feedback budget exhausted");
        return {
          receipt: {
            ...row.receipt,
            feedback: {
              ...row.receipt.feedback,
              [input.action]: row.receipt.feedback[input.action] + 1,
            },
          },
          feedbackIds: [...row.feedbackIds, { id: input.operationId, action: input.action }],
        };
      });
    },
    async promote(
      identity: MemoryWikiReadIdentity,
      input: KnowledgePolicyPromotionPayload,
    ): Promise<OfflinePolicyPromotionV1> {
      if (!input.evidenceRoot || !input.evidenceManifestDigest)
        throw new Error("Pinned original evaluation package required");
      const id = operationId(input.operationId),
        { ownerKey } = scope(identity);
      const verified = await verifyOfflineRagPolicyPackage(
        input.evidenceRoot,
        input.evidenceManifestDigest,
        { manifestName: input.evidenceManifestName },
      );
      assertCurrent(identity, ownerKey);
      const candidate = normalizeRetrievalPolicy(verified.candidate);
      const storageKey = key(ownerKey, candidate.profile);
      const requestDigest = sha({ ...input, ...verified });
      if (!policies.update) throw new Error("Atomic policy publication unavailable");
      let receipt: OfflinePolicyPromotionV1 | undefined;
      await policies.update(storageKey, (saved) => {
        assertCurrent(identity, ownerKey);
        const prior = saved?.operations.find((value) => value.id === id);
        if (prior) {
          if (prior.digest !== requestDigest) throw new Error("Conflicting policy operation");
          receipt = prior.receipt;
          return saved;
        }
        const previous = saved?.active ?? defaultRetrievalPolicy(candidate.profile);
        const previousDigest = retrievalPolicyDigest(previous);
        if (verified.expectedPolicyDigest !== previousDigest)
          throw new Error("Retrieval policy changed before promotion");
        if ((saved?.operations.length ?? 0) >= 128)
          throw new Error("Policy history capacity reached");
        const reasons = evaluateOfflineRetrievalPromotion(candidate, previous, verified.evaluation);
        if (candidate.version === previous.version) reasons.push("policy-version-must-change");
        receipt = {
          schema: "OfflinePolicyPromotion/v1",
          operationId: id,
          createdAt: Date.now(),
          candidate,
          candidateDigest: retrievalPolicyDigest(candidate),
          previousDigest,
          evaluationDigest: sha(verified.evaluation),
          corpusDigest: verified.evaluation.corpusDigest,
          decision: reasons.length ? "held" : "promoted",
          reasons,
          driven_by: "agent",
        };
        return {
          active: reasons.length ? previous : candidate,
          ...(reasons.length
            ? saved?.previous
              ? { previous: saved.previous }
              : {}
            : { previous }),
          ...(reasons.length
            ? {
                calibrationGenerationDigest: saved?.calibrationGenerationDigest,
                previousCalibrationGenerationDigest: saved?.previousCalibrationGenerationDigest,
              }
            : {
                calibrationGenerationDigest: sha(
                  options.projection?.status(identity).sources ?? [],
                ),
                previousCalibrationGenerationDigest: saved?.calibrationGenerationDigest,
              }),
          operations: [...(saved?.operations ?? []), { id, digest: requestDigest, receipt }],
        };
      });
      if (!receipt) throw new Error("Policy publication did not return a receipt");
      return receipt;
    },
    async rollback(
      identity: MemoryWikiReadIdentity,
      input: KnowledgePolicyRollbackPayload,
    ): Promise<OfflinePolicyPromotionV1> {
      const id = operationId(input.operationId),
        { ownerKey } = scope(identity);
      defaultRetrievalPolicy(input.profile);
      if (!policies.update) throw new Error("Atomic policy rollback unavailable");
      let receipt: OfflinePolicyPromotionV1 | undefined;
      const requestDigest = sha(input);
      await policies.update(key(ownerKey, input.profile), (saved) => {
        assertCurrent(identity, ownerKey);
        const prior = saved?.operations.find((value) => value.id === id);
        if (prior) {
          if (prior.digest !== requestDigest) throw new Error("Conflicting policy operation");
          receipt = prior.receipt;
          return saved;
        }
        if (!saved?.previous || saved.operations.length >= 128)
          throw new Error("No retained policy rollback is available");
        const previousDigest = retrievalPolicyDigest(saved.active);
        if (input.expectedPolicyDigest !== previousDigest)
          throw new Error("Retrieval policy changed before rollback");
        receipt = {
          schema: "OfflinePolicyPromotion/v1",
          operationId: id,
          createdAt: Date.now(),
          candidate: saved.previous,
          candidateDigest: retrievalPolicyDigest(saved.previous),
          previousDigest,
          evaluationDigest: sha(input),
          corpusDigest: saved.operations.at(-1)?.receipt.corpusDigest ?? "",
          decision: "rolled-back",
          reasons: [],
          driven_by: "agent",
        };
        return {
          active: saved.previous,
          previous: saved.active,
          calibrationGenerationDigest: saved.previousCalibrationGenerationDigest,
          previousCalibrationGenerationDigest: saved.calibrationGenerationDigest,
          operations: [...saved.operations, { id, digest: requestDigest, receipt }],
        };
      });
      if (!receipt) throw new Error("Policy rollback did not return a receipt");
      return receipt;
    },
    invalidate(subjectId: string | null): Promise<void> {
      sourceEpoch += 1;
      return enqueue(async () => {
        for (const row of await receipts.entries()) {
          if (
            row.value.receipt.sources.some(
              (source) =>
                source.namespaceId === namespaceId &&
                (subjectId === null || source.subjectId === subjectId),
            )
          )
            await receipts.delete(row.key);
        }
      });
    },
    async snapshot(identity: MemoryWikiReadIdentity): Promise<RetrievalObservabilitySnapshotV1> {
      const { ownerKey } = scope(identity);
      const rows: RetrievalReceiptV1[] = [];
      const signal = AbortSignal.timeout(2000);
      const cutoff = Date.now() - 30 * 86400000;
      const entries = (await receipts.entries()).sort((a, b) => b.createdAt - a.createdAt);
      for (const entry of entries) {
        if (entry.value.receipt.ownerKey !== ownerKey) continue;
        if (rows.length >= 20) break;
        if (
          entry.value.receipt.createdAt < cutoff ||
          !(await currentSources(entry.value.receipt, identity, signal))
        ) {
          await receipts.delete(entry.key);
          continue;
        }
        if (rows.length < 20) rows.push(entry.value.receipt);
      }
      const active = [],
        promotions: OfflinePolicyPromotionV1[] = [];
      const index = options.projection?.status(identity);
      const generationDigest = sha(index?.sources ?? []);
      let calibrated = false,
        drifted = false;
      for (const profile of ["local", "quality", "research"] as const) {
        const saved = await policies.lookup(key(ownerKey, profile));
        const policy = saved?.active ?? defaultRetrievalPolicy(profile);
        if (saved?.calibrationGenerationDigest) {
          calibrated = true;
          if (saved.calibrationGenerationDigest !== generationDigest) drifted = true;
        }
        active.push({
          active: policy,
          digest: retrievalPolicyDigest(policy),
          ...(saved?.previous ? { previous: saved.previous } : {}),
        });
        promotions.push(...(saved?.operations.map((value) => value.receipt) ?? []));
      }
      assertCurrent(identity, ownerKey);
      const times = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
      const percentile = (q: number) =>
        times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * q) - 1)] : null;
      const runs = [
        ...new Map(rows.flatMap((row) => row.modelRuns).map((run) => [run.runId, run])).values(),
      ];
      return {
        schema: "RetrievalObservabilitySnapshot/v1",
        workspaceId: identity.workspaceId!,
        receipts: rows,
        policies: active,
        promotions: promotions.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
        slo: {
          schema: "RetrievalSlo/v1",
          sampleCount: rows.length,
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          fallbackCount: rows.filter((row) => row.fallbackCodes.length > 0).length,
          unknownUsageCount: rows.filter(
            (row) => row.usage.costUsd === null || row.usage.inputTokens === null,
          ).length,
          measuredCostUsd: runs.reduce((sum, run) => sum + (run.actualCostUsd ?? 0), 0),
          indexLagCount: index?.lagCount ?? null,
          deletionBacklog: index?.cleanupPendingGenerations ?? null,
          calibration: calibrated
            ? drifted || index?.lagCount || index?.cleanupPendingGenerations
              ? "drifted"
              : "current"
            : "unavailable",
        },
      };
    },
  };
}
export type MemoryWikiObservabilityService = ReturnType<
  typeof createMemoryWikiObservabilityService
>;
