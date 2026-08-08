import type { AgentMessage } from '../../agents/runtime/index.js';
import {
  type RuntimeContextProvider,
  type RuntimeContextProviderResult,
  type RuntimeRegistryDiagnostic,
} from '../../runtime-core/registries.js';
import type { RuntimeCoreJsonObject } from '../../runtime-core/types.js';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
} from './compiler.js';
import {
  generateCvkViews,
  type CvkGeneratedCompactView,
  type CvkRegistryViewEntry,
} from './views.js';

export const CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID = 'context-runtime-kit-shadow';

export type CvkShadowBudgetOmissionReason = 'budget_exceeded' | 'skill_registry_only';

export type CvkShadowBudgetReport = {
  tokenBudget?: number;
  registryTokens: number;
  compactViewTokens: number;
  retrievalPlanSelectors: number;
  omittedResources: Array<{
    resourceId: string;
    reason: CvkShadowBudgetOmissionReason;
  }>;
};

export type ContextRuntimeKitShadowProviderOptions = {
  fixtureInput: CvkCompilerFixtureInput;
  artifactFactory?: (input: CvkCompilerFixtureInput) => CvkFixtureArtifact;
  selectedSkillResourceIds?: string[];
};

export type ContextRuntimeKitShadowPilotParams = ContextRuntimeKitShadowProviderOptions & {
  config?: unknown;
  legacyMessages: AgentMessage[];
  legacyPromptText: string;
  tokenBudget?: number;
};

export type ContextRuntimeKitShadowPilotResult = {
  enabled: boolean;
  legacyMessages: AgentMessage[];
  legacyPromptText: string;
  providerResult?: RuntimeContextProviderResult;
  diagnostics: RuntimeRegistryDiagnostic[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function contextRuntimeKitShadowEnabled(config: unknown): boolean {
  const record = asRecord(config);
  const runtime = asRecord(record?.runtime) ?? asRecord(asRecord(record?.config)?.runtime);
  const contextRuntimeKit = asRecord(runtime?.contextRuntimeKit);
  return contextRuntimeKit?.shadow === true;
}

function diagnostic(params: {
  status: RuntimeRegistryDiagnostic['status'];
  reason: RuntimeRegistryDiagnostic['reason'];
  message: string;
  metadata?: RuntimeCoreJsonObject;
}): RuntimeRegistryDiagnostic {
  return {
    surface: 'context',
    providerId: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
    status: params.status,
    reason: params.reason,
    message: params.message,
    evidenceRefs: [{
      type: 'file',
      ref: 'openclaw_runtime/src/context-engine/cvk/shadow-provider.ts',
      label: 'Context Runtime Kit shadow provider',
    }],
    metadata: params.metadata,
  };
}

function compactViewTokens(compactViews: CvkGeneratedCompactView[]): number {
  return compactViews.reduce((total, view) => total + view.tokenEstimate, 0);
}

function budgetReport(params: {
  tokenBudget?: number;
  registryEntries: CvkRegistryViewEntry[];
  registryTokens: number;
  compactViews: CvkGeneratedCompactView[];
}): CvkShadowBudgetReport {
  const compactTokens = compactViewTokens(params.compactViews);
  const omittedResources = params.registryEntries.flatMap((entry) => {
    const omissions: CvkShadowBudgetReport['omittedResources'] = [];
    if (entry.kind === 'skill' && !entry.compactViewAvailable) {
      omissions.push({ resourceId: entry.resourceId, reason: 'skill_registry_only' });
    }
    if (
      params.tokenBudget !== undefined &&
      params.registryTokens + compactTokens > params.tokenBudget &&
      params.compactViews.some((view) => view.resourceId === entry.resourceId)
    ) {
      omissions.push({ resourceId: entry.resourceId, reason: 'budget_exceeded' });
    }
    return omissions;
  });

  return {
    ...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
    registryTokens: params.registryTokens,
    compactViewTokens: compactTokens,
    retrievalPlanSelectors: params.compactViews.reduce((total, view) => total + view.hardSelectorRefs.length, 0),
    omittedResources,
  };
}

function toJsonObject(value: unknown): RuntimeCoreJsonObject {
  return JSON.parse(JSON.stringify(value)) as RuntimeCoreJsonObject;
}

function successResult(params: {
  artifact: CvkFixtureArtifact;
  tokenBudget?: number;
  selectedSkillResourceIds?: string[];
  legacyMessageCount: number;
}): RuntimeContextProviderResult {
  const projection = generateCvkViews(params.artifact, {
    selectedSkillResourceIds: params.selectedSkillResourceIds,
  });
  const report = budgetReport({
    tokenBudget: params.tokenBudget,
    registryEntries: projection.registryView.entries,
    registryTokens: projection.registryView.tokenEstimate,
    compactViews: projection.compactViews,
  });
  const retrievalPlan = projection.compactViews.flatMap((view) => view.hardSelectorRefs);
  const metadata = toJsonObject({
    providerId: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
    shadowOnly: true,
    legacyAuthoritative: true,
    resourceMap: projection.registryView.entries,
    compactViews: projection.compactViews,
    budgetReport: report,
    retrievalPlan,
    legacyMessageCount: params.legacyMessageCount,
  });

  return {
    status: 'success',
    contextItems: [{
      id: `${CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID}:diagnostics`,
      kind: 'summary',
      text: 'Context Runtime Kit shadow diagnostics are available; legacy prompt text remains authoritative.',
      source: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
      priority: 'P2',
      evidenceRefs: [{
        type: 'other',
        ref: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
        label: 'Shadow diagnostics only',
      }],
      metadata: {
        shadowOnly: true,
        legacyAuthoritative: true,
      },
    }],
    diagnostics: [
      diagnostic({
        status: 'fallback',
        reason: 'legacy_authoritative',
        message: 'Context Runtime Kit shadow provider emitted diagnostics only; legacy prompt remains authoritative.',
        metadata: toJsonObject({
          shadowOnly: true,
          legacyAuthoritative: true,
          resourceCount: projection.registryView.entries.length,
          compactViewCount: projection.compactViews.length,
          budgetReport: report,
        }),
      }),
    ],
    evidenceRefs: [{
      type: 'file',
      ref: 'openclaw_runtime/src/context-engine/cvk/shadow-provider.ts',
      label: 'Context Runtime Kit shadow provider',
    }],
    metadata,
  };
}

function fallbackResult(error: unknown): RuntimeContextProviderResult {
  const message = error instanceof Error ? error.message : 'Context Runtime Kit shadow provider failed.';
  return {
    status: 'fallback',
    contextItems: [],
    diagnostics: [
      diagnostic({
        status: 'fallback',
        reason: 'provider_error',
        message,
        metadata: {
          shadowOnly: true,
          legacyAuthoritative: true,
          promptTextUnchanged: true,
        },
      }),
    ],
    evidenceRefs: [{
      type: 'other',
      ref: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
      label: 'Isolated provider failure',
      summary: message,
    }],
    metadata: {
      providerId: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
      shadowOnly: true,
      legacyAuthoritative: true,
      providerError: message,
    },
  };
}

export function createContextRuntimeKitShadowProvider(
  options: ContextRuntimeKitShadowProviderOptions,
): RuntimeContextProvider {
  const artifactFactory = options.artifactFactory ?? compileCvkFixtureSources;
  const manifest = {
    id: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
    kind: 'context' as const,
    title: 'Context Runtime Kit shadow provider',
    source: 'runtime-core' as const,
    capabilities: ['context.cvk.shadow'],
    priority: 30,
    order: 30,
    permission: {
      decision: 'allow' as const,
      capability: 'context.cvk.shadow',
      reason: 'Shadow provider emits diagnostics only.',
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ['legacy_authoritative' as const, 'provider_error' as const],
    evidenceRefs: [{ type: 'file' as const, ref: 'openclaw_runtime/src/context-engine/cvk/shadow-provider.ts' }],
    outputKinds: ['summary' as const, 'evidence' as const],
    dependsOnIndexing: false,
  };

  return {
    manifest,
    getContext(query): RuntimeContextProviderResult {
      try {
        const artifact = artifactFactory(options.fixtureInput);
        const metadata = asRecord(query.metadata);
        const legacyMessages = Array.isArray(metadata?.legacyMessages) ? metadata.legacyMessages : [];
        return successResult({
          artifact,
          tokenBudget: query.tokenBudget,
          selectedSkillResourceIds: options.selectedSkillResourceIds,
          legacyMessageCount: legacyMessages.length,
        });
      } catch (error) {
        return fallbackResult(error);
      }
    },
  };
}

export async function runContextRuntimeKitShadowPilot(
  params: ContextRuntimeKitShadowPilotParams,
): Promise<ContextRuntimeKitShadowPilotResult> {
  if (!contextRuntimeKitShadowEnabled(params.config)) {
    const diagnostics = [
      diagnostic({
        status: 'skipped',
        reason: 'flag_disabled',
        message: 'Context Runtime Kit shadow provider is disabled; legacy prompt remains authoritative.',
        metadata: {
          shadowOnly: true,
          legacyAuthoritative: true,
          promptTextUnchanged: true,
        },
      }),
    ];
    return {
      enabled: false,
      legacyMessages: params.legacyMessages,
      legacyPromptText: params.legacyPromptText,
      diagnostics,
    };
  }

  const provider = createContextRuntimeKitShadowProvider(params);
  const providerResult = await provider.getContext({
    taskId: 'context-runtime-kit-shadow',
    tokenBudget: params.tokenBudget,
    metadata: { legacyMessages: params.legacyMessages as never },
  });
  const normalizedProviderResult = Array.isArray(providerResult)
    ? {
        status: 'success' as const,
        contextItems: providerResult,
        diagnostics: [],
        evidenceRefs: [],
      }
    : providerResult;

  return {
    enabled: true,
    legacyMessages: params.legacyMessages,
    legacyPromptText: params.legacyPromptText,
    providerResult: normalizedProviderResult,
    diagnostics: normalizedProviderResult.diagnostics,
  };
}
