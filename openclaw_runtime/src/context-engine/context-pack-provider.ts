// ContextPack shadow provider (SPEC Task 4 / ALIGNMENT 校正4+6): exposes the
// context.understand capability on the existing provider registry, strictly
// shadowOnly — diagnostics/evidence only, legacy prompt assembly stays authoritative.
// Follows the agent-map/symbol shadow provider pattern (options-injected data source).
import type {
  ContextItem,
  EvidenceRef,
  RuntimeContextProvider,
  RuntimeContextProviderExtras,
  RuntimeContextProviderQuery,
  RuntimeContextProviderResult,
  RuntimeCoreJsonObject,
  RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";
import type { ContextPack } from "./fact-types.js";
import { createMaterializer, type Materializer } from "./factstore/materialize.js";
import { openFactStore } from "./factstore/store.js";
import { buildContextPack, DEFAULT_PACK_BUDGET_CHARS } from "./views/pack/context-pack-view.js";
import { formatContextPackMarkdown } from "./views/pack/markdown.js";

export const CONTEXT_PACK_CONTEXT_PROVIDER_ID = "context-pack-shadow";

export type ContextPackContextProviderOptions = {
  /** Override the pack source (tests / alternative stores). Defaults to the FactStore pipeline. */
  buildPack?: (
    query: RuntimeContextProviderQuery,
    extras?: RuntimeContextProviderExtras,
  ) => ContextPack | undefined | Promise<ContextPack | undefined>;
  /**
   * Grading switch (ALIGNMENT 校正6). Factory default stays "shadow"; the production
   * composition (register-rebuild-providers) passes "authoritative" — the flip was
   * approved at rebuild Task I on the shadow-comparison dossier, with this option as
   * the documented kill switch back to shadow.
   */
  authority?: "authoritative" | "shadow";
};

const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: CONTEXT_PACK_CONTEXT_PROVIDER_ID,
  label: "ContextPack shadow provider",
};

const SHADOW_METADATA = {
  shadowOnly: true,
  legacyAuthoritative: true,
  noPromptAuthority: true,
  noToolAuthority: true,
  noRuntimeAuthority: true,
} as const;

export function createContextPackContextProvider(
  options: ContextPackContextProviderOptions = {},
): RuntimeContextProvider {
  const authoritative = options.authority === "authoritative";
  const manifest = {
    id: CONTEXT_PACK_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "ContextPack shadow provider",
    description:
      "FactStore-backed ContextPack (evidence + declared gaps + edit-readiness) exposed as shadow diagnostics only.",
    source: "runtime-core" as const,
    capabilities: ["context.understand"],
    priority: 28,
    order: 28,
    permission: {
      decision: "allow" as const,
      capability: "context.understand",
      reason: "Readonly diagnostics/evidence only; legacy prompt assembly remains authoritative.",
    },
    enabledByDefault: authoritative,
    shadowOnly: !authoritative,
    fallbackReasons: ["legacy_authoritative" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/views/pack/context-pack-view.ts",
      },
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/context-pack-provider.ts",
      },
    ],
    outputKinds: ["summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: { ...SHADOW_METADATA, shadowOnly: !authoritative, legacyAuthoritative: !authoritative },
  };

  const buildPack = options.buildPack ?? defaultBuildPack();

  return {
    manifest,
    async getContext(query, extras): Promise<RuntimeContextProviderResult> {
      let pack: ContextPack | undefined;
      try {
        pack = await buildPack(query, extras);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return providerResult({
          status: "error",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "error",
              reason: "provider_error",
              message,
              metadata: { ...SHADOW_METADATA, providerFailureIsolated: true },
            }),
          ],
          metadata: { providerId: manifest.id, ...SHADOW_METADATA, contextItemCount: 0 },
          manifestEvidenceRefs: manifest.evidenceRefs,
        });
      }

      if (!pack) {
        return providerResult({
          status: "fallback",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "skipped",
              reason: "no_result",
              message: "No workspace/goal available to build a ContextPack for this query.",
              metadata: { ...SHADOW_METADATA },
            }),
          ],
          metadata: { providerId: manifest.id, ...SHADOW_METADATA, contextItemCount: 0 },
          manifestEvidenceRefs: manifest.evidenceRefs,
        });
      }

      const contextItems = contextPackItems(pack);
      return providerResult({
        status: "success",
        contextItems,
        diagnostics: [
          diagnostic({
            status: "fallback",
            reason: "legacy_authoritative",
            message: "ContextPack output is exposed as shadow diagnostics/evidence only.",
            metadata: {
              ...SHADOW_METADATA,
              answerable: pack.answerable,
              confidence: pack.confidence,
              editReadiness: pack.editReadiness,
              snippetCount: pack.snippets.length,
              ownerCount: pack.ownerChain.length,
              missingEvidenceCount: pack.missingEvidence.length,
              usedChars: pack.usedChars,
              budgetChars: pack.budgetChars,
            },
          }),
        ],
        metadata: {
          providerId: manifest.id,
          ...SHADOW_METADATA,
          contextItemCount: contextItems.length,
          answerable: pack.answerable,
          editReadiness: pack.editReadiness,
        },
        manifestEvidenceRefs: manifest.evidenceRefs,
      });
    },
  };
}

/** Default pipeline: per-workspace FactStore + materializer, lazily cached. */
function defaultBuildPack(): NonNullable<ContextPackContextProviderOptions["buildPack"]> {
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
    for (const file of query.activeFiles ?? []) {
      materializer.onFileTouched(file);
    }
    return buildContextPack(store, materializer, {
      query: goal,
      activeFiles: query.activeFiles,
      budgetChars: query.tokenBudget ? Math.max(2_000, query.tokenBudget * 4) : DEFAULT_PACK_BUDGET_CHARS,
    });
  };
}

function contextPackItems(pack: ContextPack): ContextItem[] {
  const summary: ContextItem = {
    id: `${CONTEXT_PACK_CONTEXT_PROVIDER_ID}:pack:${pack.projectId}`,
    kind: "summary",
    text: formatContextPackMarkdown(pack),
    source: `context-pack:${pack.repoRoot}`,
    priority: "P2",
    evidenceRefs: [PROVIDER_EVIDENCE_REF],
    metadata: {
      providerId: CONTEXT_PACK_CONTEXT_PROVIDER_ID,
      ...SHADOW_METADATA,
      answerable: pack.answerable,
      confidence: pack.confidence,
      editReadiness: pack.editReadiness,
      mode: pack.mode,
      usedChars: pack.usedChars,
      budgetChars: pack.budgetChars,
    },
  };
  const snippetItems = pack.snippets.map((snippet, index): ContextItem => ({
    id: `${CONTEXT_PACK_CONTEXT_PROVIDER_ID}:snippet:${index + 1}`,
    kind: "evidence",
    text: `${snippet.filePath}:${snippet.startLine}-${snippet.endLine} [${snippet.expansionLevel}] ${snippet.reason}`,
    source: `context-pack:${snippet.filePath}:${snippet.startLine}`,
    priority: index === 0 ? "P1" : "P2",
    evidenceRefs: [
      PROVIDER_EVIDENCE_REF,
      { type: "file", ref: snippet.filePath, label: `L${snippet.startLine}-${snippet.endLine}` },
    ],
    metadata: {
      providerId: CONTEXT_PACK_CONTEXT_PROVIDER_ID,
      ...SHADOW_METADATA,
      score: snippet.score,
      role: snippet.role,
      expansionLevel: snippet.expansionLevel,
      elidedLineCount: snippet.elidedLineCount,
    },
  }));
  return [summary, ...snippetItems];
}

function providerResult(params: {
  status: RuntimeContextProviderResult["status"];
  contextItems: ContextItem[];
  diagnostics: RuntimeRegistryDiagnostic[];
  metadata: RuntimeCoreJsonObject;
  manifestEvidenceRefs: EvidenceRef[];
}): RuntimeContextProviderResult {
  return {
    status: params.status,
    contextItems: params.contextItems,
    diagnostics: params.diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      ...params.manifestEvidenceRefs,
      PROVIDER_EVIDENCE_REF,
      ...params.contextItems.flatMap((item) => item.evidenceRefs),
      ...params.diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: params.metadata,
  };
}

function diagnostic(params: {
  status: RuntimeRegistryDiagnostic["status"];
  reason: RuntimeRegistryDiagnostic["reason"];
  message: string;
  metadata?: RuntimeCoreJsonObject;
}): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: CONTEXT_PACK_CONTEXT_PROVIDER_ID,
    status: params.status,
    reason: params.reason,
    message: params.message,
    evidenceRefs: [PROVIDER_EVIDENCE_REF],
    metadata: params.metadata,
  };
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}:${ref.label ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [ref];
  });
}
