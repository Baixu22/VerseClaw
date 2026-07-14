// Impact shadow provider (ALIGNMENT 校正4: impact → context.impact capability).
// shadowOnly per 校正6 — codegraph extension remains authoritative until Task I.
import type {
  ContextItem,
  EvidenceRef,
  RuntimeContextProvider,
  RuntimeContextProviderQuery,
  RuntimeContextProviderResult,
  RuntimeCoreJsonObject,
  RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";
import { createMaterializer, type Materializer } from "./factstore/materialize.js";
import { openFactStore } from "./factstore/store.js";
import { analyzeImpact, type ImpactAnalysis } from "./views/impact/impact-view.js";

export const IMPACT_CONTEXT_PROVIDER_ID = "impact-shadow";

export type ImpactContextProviderOptions = {
  /** Override the analysis source (tests). Defaults to the FactStore pipeline. */
  analyze?: (query: RuntimeContextProviderQuery) => ImpactAnalysis | undefined | Promise<ImpactAnalysis | undefined>;
  /** Grading switch (校正6): factory default "shadow"; production composition flips to authoritative (Task I). */
  authority?: "authoritative" | "shadow";
};

const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: IMPACT_CONTEXT_PROVIDER_ID,
  label: "Impact shadow provider",
};

const SHADOW_METADATA = {
  shadowOnly: true,
  legacyAuthoritative: true,
  noPromptAuthority: true,
  noToolAuthority: true,
  noRuntimeAuthority: true,
} as const;

export function createImpactContextProvider(options: ImpactContextProviderOptions = {}): RuntimeContextProvider {
  const authoritative = options.authority === "authoritative";
  const manifest = {
    id: IMPACT_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "Impact shadow provider",
    description: "FactStore-backed blast-radius analysis (callers/callees/impacted files) as shadow diagnostics only.",
    source: "runtime-core" as const,
    capabilities: ["context.impact"],
    priority: 26,
    order: 26,
    permission: {
      decision: "allow" as const,
      capability: "context.impact",
      reason: "Readonly diagnostics/evidence only; vendored codegraph remains authoritative until Task I.",
    },
    enabledByDefault: authoritative,
    shadowOnly: !authoritative,
    fallbackReasons: ["legacy_authoritative" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      { type: "file" as const, ref: "openclaw_runtime/src/context-engine/views/impact/impact-view.ts" },
      { type: "file" as const, ref: "openclaw_runtime/src/context-engine/impact-provider.ts" },
    ],
    outputKinds: ["summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: { ...SHADOW_METADATA, shadowOnly: !authoritative, legacyAuthoritative: !authoritative },
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
          diagnostic("error", "provider_error", error instanceof Error ? error.message : String(error)),
        ], { providerId: manifest.id, ...SHADOW_METADATA });
      }
      if (!analysis) {
        return result("fallback", [], [
          diagnostic("skipped", "no_result", "No workspace/goal available for impact analysis."),
        ], { providerId: manifest.id, ...SHADOW_METADATA });
      }
      const items = impactItems(analysis);
      return result("success", items, [
        diagnostic("fallback", "legacy_authoritative", "Impact output is exposed as shadow diagnostics/evidence only.", {
          target: analysis.target,
          callerCount: analysis.callers.length,
          calleeCount: analysis.callees.length,
          impactedFileCount: analysis.impactedFiles.length,
          riskLevel: analysis.riskLevel,
        }),
      ], {
        providerId: manifest.id,
        ...SHADOW_METADATA,
        contextItemCount: items.length,
        riskLevel: analysis.riskLevel,
      });
    },
  };
}

function defaultAnalyze(): NonNullable<ImpactContextProviderOptions["analyze"]> {
  const materializers = new Map<string, Materializer>();
  return (query) => {
    const workspace = query.workspace;
    const goal = query.goal?.trim();
    if (!workspace || !goal) return undefined;
    const store = openFactStore(workspace);
    let materializer = materializers.get(workspace);
    if (!materializer) {
      materializer = createMaterializer(store, workspace);
      materializers.set(workspace, materializer);
    }
    if (query.activeFiles && query.activeFiles.length > 0) {
      materializer.ensureFacts({ paths: query.activeFiles });
    }
    return analyzeImpact(store, workspace, goal);
  };
}

function impactItems(analysis: ImpactAnalysis): ContextItem[] {
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
      ...SHADOW_METADATA,
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
    metadata: { providerId: IMPACT_CONTEXT_PROVIDER_ID, ...SHADOW_METADATA, depth: caller.depth },
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
    metadata: { ...SHADOW_METADATA, ...metadata },
  };
}
