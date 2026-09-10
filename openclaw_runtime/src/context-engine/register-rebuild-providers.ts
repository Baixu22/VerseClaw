// Reuse + verify providers and the capability routing composition
// (SPEC Task 7 / ALIGNMENT 校正4): the six intent verbs land as capability strings on
// the existing RuntimeContextProviderRegistry — no new facade class.
// Grading (校正6 + Task I decision): the four NEW rebuild views register
// authoritative by default — the flip was approved on the shadow-comparison dossier
// (G parity supersets, F three-way symbol equality, E/H gate evidence) with a
// per-provider authority:"shadow" kill switch. The two pre-existing shadow providers
// (agent-map/symbol) keep their own legacy grading: their authority transition belongs
// to the runtime-convergence track and its 93-test interface contract.
// NOTE (acceptance review 2026-07-14, reaffirmed 2026-09-07 M2 closeout): this
// composition point has no production caller yet — wiring the composed registry
// into the default runtime belongs to the runtime-convergence track (W0-W5).
// Until that wiring lands, the flip is effective only where this function is
// invoked (tests, future runtime bootstrap).
// API-only module (per TF-0115 / M2 closeout): intentionally not wired under the
// §D1 production roots in the current tree; §D1.2 per-symbol scan reports exit 1
// (no production call sites) for `registerRebuildContextProviders` and
// `registerRebuildShadowProviders`. This file is kept under src/ as the SDK door
// for the runtime-convergence wire-up. Do not move it to experiments/ — the
// runtime-convergence track is the documented owner for the eventual binding.
import {
  RuntimeContextProviderRegistry,
  type ContextItem,
  type EvidenceRef,
  type RuntimeContextProvider,
  type RuntimeContextProviderQuery,
  type RuntimeContextProviderResult,
  type RuntimeCoreJsonObject,
  type RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";
import { createAgentMapContextProvider } from "./agent-map-context-provider.js";
import { createContextPackContextProvider } from "./context-pack-provider.js";
import { createImpactContextProvider } from "./impact-provider.js";
import { createRuntimeMemoryContextProvider } from "./memory-context-provider.js";
import { createSymbolContextProvider } from "./symbol-context-provider.js";
import { gradingMetadata, type GradingMetadata } from "./provider-grading.js";
import { createMaterializer, type Materializer } from "./factstore/materialize.js";
import { openFactStore, type FactStore } from "./factstore/store.js";
import { createWorkspaceFactStoreBridge } from "./views/factstore-bridge.js";
import { buildQueryContext } from "./views/retrieval/query-context.js";
import { retrieveHybrid } from "./views/retrieval/hybrid-retriever.js";
import { buildReuseCandidateReport } from "./views/reuse-detector.js";
import type { ReuseCandidateReport } from "./fact-types.js";
import { reviewDiff, type DiffReview } from "./views/verify/review-diff-view.js";

export const REUSE_CONTEXT_PROVIDER_ID = "reuse-shadow";
export const VERIFY_CONTEXT_PROVIDER_ID = "verify-shadow";

interface WorkspacePipelines {
  store: FactStore;
  materializer: Materializer;
}

function workspacePipelineCache(): (workspaceRoot: string) => WorkspacePipelines {
  const cache = new Map<string, WorkspacePipelines>();
  return (workspaceRoot) => {
    const existing = cache.get(workspaceRoot);
    if (existing) return existing;
    const store = openFactStore(workspaceRoot);
    const pipelines = { store, materializer: createMaterializer(store, workspaceRoot) };
    cache.set(workspaceRoot, pipelines);
    return pipelines;
  };
}

// ── reuse provider (capability context.reuse) ──────────────────────

export type ReuseContextProviderOptions = {
  buildReport?: (query: RuntimeContextProviderQuery) => ReuseCandidateReport | undefined;
  /** Grading switch (校正6): factory default "shadow"; production composition flips to authoritative (Task I). */
  authority?: "authoritative" | "shadow";
};

export function createReuseContextProvider(options: ReuseContextProviderOptions = {}): RuntimeContextProvider {
  const pipelines = workspacePipelineCache();
  const buildReport =
    options.buildReport ??
    ((query: RuntimeContextProviderQuery): ReuseCandidateReport | undefined => {
      const workspace = query.workspace;
      const goal = query.goal?.trim();
      if (!workspace || !goal) return undefined;
      const { store, materializer } = pipelines(workspace);
      if (query.activeFiles?.length) materializer.ensureFacts({ paths: query.activeFiles });
      const repoRoot = materializer.repoRoot;
      const retrieval = retrieveHybrid(store, repoRoot, buildQueryContext(goal), { limit: 24 });
      const hitFiles = [...new Set(retrieval.hits.map((hit) => hit.chunk.filePath))];
      const symbols = hitFiles.flatMap((filePath) => store.getSymbolsByFile(repoRoot, filePath));
      const chunks = hitFiles.flatMap((filePath) => store.getChunksByFile(repoRoot, filePath));
      const edges = [
        ...store.getEdgesByKind(repoRoot, "calls"),
        ...store.getEdgesByKind(repoRoot, "imports"),
        ...store.getEdgesByKind(repoRoot, "tested_by"),
      ];
      const owners = hitFiles.slice(0, 5).map((filePath) => ({
        filePath,
        score: 1,
        reasons: ["retrieval hit"],
        symbols: store.getSymbolsByFile(repoRoot, filePath).filter((symbol) => symbol.kind !== "file"),
      }));
      return buildReuseCandidateReport({ query: goal, hits: retrieval.hits, owners, symbols, edges, chunks });
    });

  return makeGradedProvider({
    authority: options.authority,
    id: REUSE_CONTEXT_PROVIDER_ID,
    title: "Reuse context provider",
    description: "FactStore-backed reuse candidates (existing helpers before new code)",
    capability: "context.reuse",
    priority: 24,
    evidenceFile: "openclaw_runtime/src/context-engine/views/reuse-detector.ts",
    getPayload: (query) => {
      const report = buildReport(query);
      if (!report) return undefined;
      return {
        summaryText: [
          `Reuse decision for "${report.query}": ${report.decision} (confidence ${report.confidence}, duplicate risk ${report.duplicateRisk})`,
          ...report.candidates.slice(0, 5).map(
            (candidate) =>
              `- ${candidate.symbolName ?? candidate.filePath} @ ${candidate.filePath} score=${candidate.score.toFixed(2)} [${candidate.kind}]`,
          ),
        ].join("\n"),
        metadata: {
          decision: report.decision,
          confidence: report.confidence,
          duplicateRisk: report.duplicateRisk,
          candidateCount: report.candidates.length,
          reuseGuardStatus: report.reuseGuard.status,
        },
      };
    },
  });
}

// ── verify provider (capability context.verify) ────────────────────

export type VerifyContextProviderOptions = {
  review?: (query: RuntimeContextProviderQuery) => DiffReview | undefined;
  /** Grading switch (校正6): factory default "shadow"; production composition flips to authoritative (Task I). */
  authority?: "authoritative" | "shadow";
};

export function createVerifyContextProvider(options: VerifyContextProviderOptions = {}): RuntimeContextProvider {
  const pipelines = workspacePipelineCache();
  const review =
    options.review ??
    ((query: RuntimeContextProviderQuery): DiffReview | undefined => {
      const workspace = query.workspace;
      if (!workspace) return undefined;
      const metadata = (query.metadata ?? {}) as Record<string, unknown>;
      const diff = typeof metadata.diff === "string" ? metadata.diff : undefined;
      const changedFiles = Array.isArray(metadata.changedFiles)
        ? metadata.changedFiles.filter((entry): entry is string => typeof entry === "string")
        : query.activeFiles;
      if (!diff && (!changedFiles || changedFiles.length === 0)) return undefined;
      const { store, materializer } = pipelines(workspace);
      if (changedFiles?.length) materializer.ensureFacts({ paths: changedFiles });
      return reviewDiff(store, materializer.repoRoot, { diff, changedFiles });
    });

  return makeGradedProvider({
    authority: options.authority,
    id: VERIFY_CONTEXT_PROVIDER_ID,
    title: "Verify context provider",
    description: "FactStore-backed diff review (related tests + blast radius)",
    capability: "context.verify",
    priority: 22,
    evidenceFile: "openclaw_runtime/src/context-engine/views/verify/review-diff-view.ts",
    getPayload: (query) => {
      const result = review(query);
      if (!result) return undefined;
      return {
        summaryText: [
          `Diff review: ${result.changedFiles.length} changed file(s), risk=${result.riskLevel}`,
          `- related tests: ${result.relatedTests.join(", ") || "none found"}`,
          `- impacted files: ${result.impactedFiles.slice(0, 8).join(", ") || "none"}`,
          ...result.findings.map((finding) => `- finding: ${finding}`),
        ].join("\n"),
        metadata: {
          changedFileCount: result.changedFiles.length,
          relatedTestCount: result.relatedTests.length,
          riskLevel: result.riskLevel,
          findingCount: result.findings.length,
        },
      };
    },
  });
}

// ── capability routing composition ─────────────────────────────────

export interface RebuildProviderRegistration {
  registry: RuntimeContextProviderRegistry;
  registered: string[];
}

export interface RegisterRebuildProvidersOptions {
  /** Grading for the four NEW rebuild views. Default "authoritative" (Task I flip). */
  authority?: "authoritative" | "shadow";
}

/**
 * Registers the rebuild's providers (plus the existing memory provider for the
 * remember verb) on a RuntimeContextProviderRegistry. Capability → provider resolution
 * is the registry's listByCapability — the six intent verbs route without a facade:
 * understand→context.understand, locate→context.symbol, impact→context.impact,
 * reuse→context.reuse, verify→context.verify, remember→context.memory (existing system).
 *
 * The four new views (context-pack/impact/reuse/verify) default to authoritative —
 * approved at Task I on the shadow dossier; pass authority:"shadow" to re-shadow.
 * agent-map/symbol stay on their legacy shadow grading (runtime-convergence track).
 */
export function registerRebuildContextProviders(
  registry: RuntimeContextProviderRegistry = new RuntimeContextProviderRegistry(),
  options: RegisterRebuildProvidersOptions = {},
): RebuildProviderRegistration {
  const authority = options.authority ?? "authoritative";
  const bridgeFor = createWorkspaceFactStoreBridge();
  const providers: RuntimeContextProvider[] = [
    createContextPackContextProvider({ authority }),
    createSymbolContextProvider({
      getOverviews: (query) =>
        query.workspace ? bridgeFor(query.workspace).symbolOverviews({ activeFiles: query.activeFiles }) : undefined,
    }),
    createImpactContextProvider({ authority }),
    createReuseContextProvider({ authority }),
    createVerifyContextProvider({ authority }),
    createAgentMapContextProvider({
      getResult: (query) =>
        query.workspace
          ? bridgeFor(query.workspace).agentMapResult({ activeFiles: query.activeFiles, tokenBudget: query.tokenBudget })
          : undefined,
    }),
    createMemoryContextProviderForRemember(),
  ];
  const registered: string[] = [];
  for (const provider of providers) {
    const result = registry.register(provider);
    if (result.status === "registered") registered.push(provider.manifest.id);
  }
  return { registry, registered };
}

/** Shadow-mode composition (pre-flip behavior; kill switch and test harness). */
export function registerRebuildShadowProviders(
  registry: RuntimeContextProviderRegistry = new RuntimeContextProviderRegistry(),
): RebuildProviderRegistration {
  return registerRebuildContextProviders(registry, { authority: "shadow" });
}

// ── shared graded provider skeleton (shadow ↔ authoritative) ───────

/** remember verb: the existing runtime-memory provider IS the system (校正4, 不新建). */
function createMemoryContextProviderForRemember(): RuntimeContextProvider {
  return createRuntimeMemoryContextProvider();
}

interface GradedProviderSpec {
  authority?: "authoritative" | "shadow";
  id: string;
  title: string;
  /** Grading-neutral summary; the shadow suffix is appended in shadow mode. */
  description: string;
  capability: string;
  priority: number;
  evidenceFile: string;
  getPayload: (
    query: RuntimeContextProviderQuery,
  ) => { summaryText: string; metadata: RuntimeCoreJsonObject } | undefined;
}

function makeGradedProvider(spec: GradedProviderSpec): RuntimeContextProvider {
  const authoritative = spec.authority === "authoritative";
  const grading = gradingMetadata(authoritative);
  const providerRef: EvidenceRef = { type: "other", ref: spec.id, label: spec.title };
  const manifest = {
    id: spec.id,
    kind: "context" as const,
    title: spec.title,
    description: authoritative ? `${spec.description}.` : `${spec.description} as shadow diagnostics only.`,
    source: "runtime-core" as const,
    capabilities: [spec.capability],
    priority: spec.priority,
    order: spec.priority,
    permission: {
      decision: "allow" as const,
      capability: spec.capability,
      reason: authoritative
        ? `Authoritative provider for ${spec.capability} (rebuild Task I flip); readonly FactStore evidence.`
        : "Readonly diagnostics/evidence only; legacy prompt assembly remains authoritative.",
    },
    enabledByDefault: authoritative,
    shadowOnly: !authoritative,
    fallbackReasons: authoritative
      ? ["no_result" as const, "provider_error" as const]
      : ["legacy_authoritative" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [{ type: "file" as const, ref: spec.evidenceFile }],
    outputKinds: ["summary" as const],
    dependsOnIndexing: false,
    metadata: { ...grading },
  };

  return {
    manifest,
    async getContext(query): Promise<RuntimeContextProviderResult> {
      let payload: { summaryText: string; metadata: RuntimeCoreJsonObject } | undefined;
      try {
        payload = spec.getPayload(query);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return gradedResult(spec.id, providerRef, grading, "error", [], [
          gradedDiagnostic(spec.id, providerRef, grading, "error", "provider_error", message),
        ]);
      }
      if (!payload) {
        return gradedResult(spec.id, providerRef, grading, "fallback", [], [
          gradedDiagnostic(spec.id, providerRef, grading, "skipped", "no_result", "No workspace/goal available for this query."),
        ]);
      }
      const item: ContextItem = {
        id: `${spec.id}:summary`,
        kind: "summary",
        text: payload.summaryText,
        source: spec.id,
        priority: "P2",
        evidenceRefs: [providerRef],
        metadata: { providerId: spec.id, ...grading, ...payload.metadata },
      };
      // Shadow mode declares the legacy system authoritative on every success;
      // authoritative mode has nothing to hand off to, so no fallback diagnostic.
      const diagnostics = authoritative
        ? []
        : [
            gradedDiagnostic(
              spec.id,
              providerRef,
              grading,
              "fallback",
              "legacy_authoritative",
              `${spec.title} output is exposed as shadow diagnostics/evidence only.`,
              payload.metadata,
            ),
          ];
      return gradedResult(spec.id, providerRef, grading, "success", [item], diagnostics);
    },
  };
}

function gradedResult(
  providerId: string,
  providerRef: EvidenceRef,
  grading: GradingMetadata,
  status: RuntimeContextProviderResult["status"],
  contextItems: ContextItem[],
  diagnostics: RuntimeRegistryDiagnostic[],
): RuntimeContextProviderResult {
  return {
    status,
    contextItems,
    diagnostics,
    evidenceRefs: [providerRef, ...contextItems.flatMap((item) => item.evidenceRefs)],
    metadata: { providerId, ...grading, contextItemCount: contextItems.length },
  };
}

function gradedDiagnostic(
  providerId: string,
  providerRef: EvidenceRef,
  grading: GradingMetadata,
  status: RuntimeRegistryDiagnostic["status"],
  reason: RuntimeRegistryDiagnostic["reason"],
  message: string,
  metadata?: RuntimeCoreJsonObject,
): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId,
    status,
    reason,
    message,
    evidenceRefs: [providerRef],
    metadata: { ...grading, ...metadata },
  };
}
