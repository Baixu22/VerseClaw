// Impact provider (ALIGNMENT 校正4: impact → context.impact capability).
// Grading per 校正6: factory default "shadow"; the Task I flip passes
// authority:"authoritative" at the composition point (register-rebuild-providers),
// which also unbound the codegraph plugin. authority:"shadow" is the kill switch.
import type {
  ContextItem,
  EvidenceRef,
  RuntimeContextProvider,
  RuntimeContextProviderQuery,
  RuntimeContextProviderResult,
  RuntimeCoreJsonObject,
  RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";
import { gradingMetadata, type GradingMetadata } from "./provider-grading.js";
import { resolveWorkspaceFactService } from "./factstore/workspace-fact-service.js";
import { analyzeImpact, type ImpactAnalysis } from "./views/impact/impact-view.js";

export const IMPACT_CONTEXT_PROVIDER_ID = "impact-shadow";

export type ImpactContextProviderOptions = {
  /** Override the analysis source (tests). Defaults to the FactStore pipeline. */
  analyze?: (query: RuntimeContextProviderQuery) => ImpactAnalysis | undefined | Promise<ImpactAnalysis | undefined>;
  /** Grading switch (校正6): factory default "shadow"; production composition flips to authoritative (Task I). */
  authority?: "authoritative" | "shadow";
};

// Historical stable identifier (predates the Task I flip); not a grading claim.
const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: IMPACT_CONTEXT_PROVIDER_ID,
  label: "Impact context provider",
};

export function createImpactContextProvider(options: ImpactContextProviderOptions = {}): RuntimeContextProvider {
  const authoritative = options.authority === "authoritative";
  const grading = gradingMetadata(authoritative);
  const manifest = {
    id: IMPACT_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "Impact context provider",
    description: authoritative
      ? "FactStore-backed blast-radius analysis (callers/callees/impacted files)."
      : "FactStore-backed blast-radius analysis (callers/callees/impacted files) as shadow diagnostics only.",
    source: "runtime-core" as const,
    capabilities: ["context.impact"],
    priority: 26,
    order: 26,
    permission: {
      decision: "allow" as const,
      capability: "context.impact",
      reason: authoritative
        ? "Authoritative provider for context.impact (rebuild Task I flip); readonly FactStore evidence."
        : "Readonly diagnostics/evidence only; legacy prompt assembly remains authoritative.",
    },
    enabledByDefault: authoritative,
    shadowOnly: !authoritative,
    fallbackReasons: authoritative
      ? ["no_result" as const, "provider_error" as const]
      : ["legacy_authoritative" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      { type: "file" as const, ref: "openclaw_runtime/src/context-engine/views/impact/impact-view.ts" },
      { type: "file" as const, ref: "openclaw_runtime/src/context-engine/impact-provider.ts" },
    ],
    outputKinds: ["summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: { ...grading },
  };

  const analyze = options.analyze ?? defaultAnalyze();

  return {
    manifest,
    async getContext(query): Promise<RuntimeContextProviderResult> {
      let analysis: ImpactAnalysis | undefined;
      try {
        analysis = await analyze(query);
      } catch (error) {
        return result("error", [], [
          diagnostic(grading, "error", "provider_error", error instanceof Error ? error.message : String(error)),
        ], { providerId: manifest.id, ...grading });
      }
      if (!analysis) {
        return result("fallback", [], [
          diagnostic(grading, "skipped", "no_result", "No workspace/goal available for impact analysis."),
        ], { providerId: manifest.id, ...grading });
      }
      const items = impactItems(analysis, grading);
      const analysisCounts = {
        target: analysis.target,
        callerCount: analysis.callers.length,
        calleeCount: analysis.callees.length,
        impactedFileCount: analysis.impactedFiles.length,
        riskLevel: analysis.riskLevel,
      };
      // Shadow mode declares the legacy system authoritative on every success;
      // authoritative mode has nothing to hand off to, so no fallback diagnostic.
      const diagnostics = authoritative
        ? []
        : [
            diagnostic(grading, "fallback", "legacy_authoritative", "Impact output is exposed as shadow diagnostics/evidence only.", analysisCounts),
          ];
      return result("success", items, diagnostics, {
        providerId: manifest.id,
        ...grading,
        contextItemCount: items.length,
        ...analysisCounts,
      });
    },
  };
}

function defaultAnalyze(): NonNullable<ImpactContextProviderOptions["analyze"]> {
  return (query) => {
    const workspace = query.workspace;
    const goal = query.goal?.trim();
    if (!workspace || !goal) return undefined;
    const service = resolveWorkspaceFactService(workspace);
    if (query.activeFiles && query.activeFiles.length > 0) {
      service.materializer.ensureFacts({ paths: query.activeFiles });
    }
    return analyzeImpact(service.store, service.repoRoot, goal);
  };
}

function impactItems(analysis: ImpactAnalysis, grading: GradingMetadata): ContextItem[] {
  const summaryLines = [
    `Impact of ${analysis.target}: risk=${analysis.riskLevel}`,
    `- matched: ${analysis.matchedSymbols.map((symbol) => `${symbol.name}@${symbol.filePath}`).join(", ") || "none"}`,
    `- callers (${analysis.callers.length}): ${analysis.callers.map((caller) => caller.name).slice(0, 8).join(", ")}`,
    `- impacted files (${analysis.impactedFiles.length}): ${analysis.impactedFiles.slice(0, 8).join(", ")}`,
  ];
  const summary: ContextItem = {
    id: `${IMPACT_CONTEXT_PROVIDER_ID}:summary`,
    kind: "summary",
    text: summaryLines.join("\n"),
    source: `impact:${analysis.target}`,
    priority: "P2",
    evidenceRefs: [PROVIDER_EVIDENCE_REF],
    metadata: {
      providerId: IMPACT_CONTEXT_PROVIDER_ID,
      ...grading,
      riskLevel: analysis.riskLevel,
      impactedFileCount: analysis.impactedFiles.length,
    },
  };
  const callerItems = analysis.callers.slice(0, 12).map((caller, index): ContextItem => ({
    id: `${IMPACT_CONTEXT_PROVIDER_ID}:caller:${index + 1}`,
    kind: "evidence",
    text: `${caller.name} (${caller.kind}) ${caller.filePath}:${caller.startLine} calls ${caller.via} [depth ${caller.depth}]`,
    source: `impact:caller:${caller.filePath}:${caller.startLine}`,
    priority: caller.depth === 1 ? "P1" : "P2",
    evidenceRefs: [PROVIDER_EVIDENCE_REF, { type: "file", ref: caller.filePath, label: `L${caller.startLine}` }],
    metadata: { providerId: IMPACT_CONTEXT_PROVIDER_ID, ...grading, depth: caller.depth },
  }));
  return [summary, ...callerItems];
}

function result(
  status: RuntimeContextProviderResult["status"],
  contextItems: ContextItem[],
  diagnostics: RuntimeRegistryDiagnostic[],
  metadata: RuntimeCoreJsonObject,
): RuntimeContextProviderResult {
  return {
    status,
    contextItems,
    diagnostics,
    evidenceRefs: [PROVIDER_EVIDENCE_REF, ...contextItems.flatMap((item) => item.evidenceRefs)],
    metadata,
  };
}

function diagnostic(
  grading: GradingMetadata,
  status: RuntimeRegistryDiagnostic["status"],
  reason: RuntimeRegistryDiagnostic["reason"],
  message: string,
  metadata?: RuntimeCoreJsonObject,
): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: IMPACT_CONTEXT_PROVIDER_ID,
    status,
    reason,
    message,
    evidenceRefs: [PROVIDER_EVIDENCE_REF],
    metadata: { ...grading, ...metadata },
  };
}
