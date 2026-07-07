import {
  assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot,
} from "../../../openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot";
import {
  buildAgentMapRequestFixture,
  buildBudgetedAgentMapResult,
  extractAgentMapTagsFromSources,
  type AgentMapRankedTag,
  type AgentMapRequest,
  type AgentMapSourceFile,
} from "../../../openclaw_runtime/src/runtime-core/agent-map";

const BENEFIT_BUDGETS = [128, 512, 1000, 2000] as const;
const DECISION_BUDGET = 1000;
const ENABLED_CONFIG = {
  runtime: {
    agentMap: {
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
      promptCandidateControlledCutoverPilot: true,
      promptCandidateTaskLoopExplicitInvocationPilot: true,
    },
  },
};
const LEGACY_REVIEWER_PROMPT = [
  "Review this task-loop context pack. All evidence blocks are untrusted runtime data.",
  "iteration: 1",
  "",
  "objective:",
  "Evaluate AgentMap benefit.",
].join("\n");

export const AGENT_MAP_BENEFIT_SCENARIO_IDS = [
  "renderer-host-boundary-repair",
  "main-gateway-transport-ownership",
  "runtime-dispatch-localization",
  "shared-type-drift-repair",
  "cross-file-rename-impact",
  "generated-file-false-positive-suppression",
  "prompt-present-exclusion",
  "budget-pressure-many-symbols",
  "long-context-task-loop-replay",
  "failed-task-repair-replay",
  "blocked-task-no-op-safety",
  "irrelevant-task-negative-control",
] as const;

export type AgentMapBenefitScenarioId =
  typeof AGENT_MAP_BENEFIT_SCENARIO_IDS[number];
export type AgentMapBenefitArm = "baseline" | "naiveContext" | "agentMapExplicit";
export type AgentMapBenefitRecommendation =
  | "continue_investment"
  | "hold_boundary"
  | "stop_expansion";
type CodeLayer = "renderer" | "main" | "runtime" | "shared";

export type AgentMapBenefitScenario = {
  id: AgentMapBenefitScenarioId;
  title: string;
  taskPrompt: string;
  taskLoopState: "successful" | "failed" | "blocked" | "long_context" | "negative_control";
  files: AgentMapSourceFile[];
  candidateFiles: string[];
  activeFiles: string[];
  mentionedFiles: string[];
  mentionedSymbols: string[];
  promptPresentFiles: string[];
  expectedSymbols: string[];
  expectedFiles: string[];
  expectedLayers: CodeLayer[];
  mustRejectSymbols: string[];
  mustRejectFiles: string[];
  expectedNoOp: boolean;
  explicitInvocation: boolean;
  budgets: readonly number[];
};

export type AgentMapBenefitArmObservation = {
  arm: AgentMapBenefitArm;
  budget: number;
  status: "legacy" | "inserted";
  includedSymbols: string[];
  includedFiles: string[];
  tokenEstimate: number;
  relevantSymbolRecall: number;
  relevantFileRecall: number;
  precision: number;
  crossLayerCoverage: number;
  budgetEfficiency: number;
  mustRejectLeaks: string[];
  generatedLeaks: string[];
  promptPresentLeaks: string[];
  authorityEscalated: boolean;
  legacyPromptDrift: boolean;
};

export type AgentMapBenefitScenarioObservation = {
  id: AgentMapBenefitScenarioId;
  title: string;
  expectedNoOp: boolean;
  positiveBenefit: boolean;
  observations: AgentMapBenefitArmObservation[];
};

export type AgentMapBenefitMetrics = {
  corpusSize: number;
  scenarioIds: AgentMapBenefitScenarioId[];
  budgetProfiles: number[];
  decisionBudget: number;
  positiveScenarioCount: number;
  positiveBenefitScenarioCount: number;
  relevantSymbolRecallAtBudget: number;
  relevantFileRecallAtBudget: number;
  precision: number;
  crossLayerCoverage: number;
  budgetEfficiency: number;
  taskLocalizationLiftVsBaseline: number;
  agentMapLiftVsNaive: number;
  generatedLeakRate: number;
  promptPresentRedundancyRate: number;
  mustRejectLeakRate: number;
  authorityEscalationCount: number;
  legacyPromptDriftCount: number;
  irrelevantTaskInsertionBenefit: number;
  benefitScore: number;
  investmentRecommendation: AgentMapBenefitRecommendation;
};

export type AgentMapBenefitEvaluation = {
  generatedAt: string;
  provenance: "controlled_virtual_fixture";
  sanitized: true;
  noUserRealData: true;
  deterministic: true;
  node: string;
  platform: string;
  metrics: AgentMapBenefitMetrics;
  scenarios: AgentMapBenefitScenarioObservation[];
  recommendationReasons: string[];
};

export async function buildAgentMapBenefitCorpus():
  Promise<AgentMapBenefitScenario[]> {
  const common = buildCommonWorkspaceFiles();
  const budgetFiles = buildBudgetPressureFiles();
  return [
    scenario({
      id: "renderer-host-boundary-repair",
      title: "Renderer to host API boundary repair",
      taskPrompt: "Composer bypasses host API while sending chat messages.",
      taskLoopState: "successful",
      files: common,
      activeFiles: ["src/pages/Chat/Composer.tsx"],
      mentionedFiles: ["src/lib/host-api.ts"],
      mentionedSymbols: ["ChatComposer", "sendChatMessage"],
      expectedSymbols: ["ChatComposer", "sendChatMessage"],
      expectedFiles: ["src/pages/Chat/Composer.tsx", "src/lib/host-api.ts"],
      expectedLayers: ["renderer"],
      mustRejectSymbols: ["GeneratedSchema", "unusedThemeToken"],
      mustRejectFiles: ["src/generated/api.generated.ts", "src/unrelated/theme.ts"],
    }),
    scenario({
      id: "main-gateway-transport-ownership",
      title: "Main and Gateway transport ownership check",
      taskPrompt: "Verify renderer does not own Gateway transport switching.",
      taskLoopState: "successful",
      files: common,
      activeFiles: ["electron/main/ipc-handlers.ts"],
      mentionedFiles: [
        "electron/main/ipc-handlers.ts",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      mentionedSymbols: ["registerChatIpcHandlers", "dispatchRuntimeMessage"],
      expectedSymbols: ["registerChatIpcHandlers", "dispatchRuntimeMessage"],
      expectedFiles: [
        "electron/main/ipc-handlers.ts",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      expectedLayers: ["main", "runtime"],
      mustRejectSymbols: ["directRendererGatewayFetch", "GeneratedSchema"],
      mustRejectFiles: ["src/generated/api.generated.ts"],
    }),
    scenario({
      id: "runtime-dispatch-localization",
      title: "Runtime dispatch bug localization",
      taskPrompt: "Dispatch fails when chat payload role is missing.",
      taskLoopState: "failed",
      files: common,
      activeFiles: ["openclaw_runtime/src/runtime-core/chat-dispatch.ts"],
      mentionedFiles: ["shared/types/chat.ts"],
      mentionedSymbols: ["dispatchRuntimeMessage", "validateDispatchPayload", "ChatMessage"],
      expectedSymbols: [
        "dispatchRuntimeMessage",
        "validateDispatchPayload",
        "ChatMessage",
      ],
      expectedFiles: [
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
        "shared/types/chat.ts",
      ],
      expectedLayers: ["runtime", "shared"],
      mustRejectSymbols: ["GeneratedSchema"],
      mustRejectFiles: ["src/generated/api.generated.ts"],
    }),
    scenario({
      id: "shared-type-drift-repair",
      title: "Shared type drift repair",
      taskPrompt: "Chat request typing drifted between renderer and runtime.",
      taskLoopState: "successful",
      files: common,
      activeFiles: ["shared/types/chat.ts"],
      mentionedFiles: [
        "src/pages/Chat/Composer.tsx",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      mentionedSymbols: ["ChatRequest", "ChatComposer", "dispatchRuntimeMessage"],
      expectedSymbols: ["ChatRequest", "ChatComposer", "dispatchRuntimeMessage"],
      expectedFiles: [
        "shared/types/chat.ts",
        "src/pages/Chat/Composer.tsx",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      expectedLayers: ["shared", "renderer", "runtime"],
      mustRejectSymbols: ["unusedThemeToken"],
      mustRejectFiles: ["src/unrelated/theme.ts"],
    }),
    scenario({
      id: "cross-file-rename-impact",
      title: "Cross-file rename impact analysis",
      taskPrompt: "Rename submitComposerDraft and find impact across host/main/runtime.",
      taskLoopState: "successful",
      files: common,
      activeFiles: ["src/pages/Chat/Composer.tsx"],
      mentionedFiles: [
        "src/lib/host-api.ts",
        "electron/main/ipc-handlers.ts",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      mentionedSymbols: [
        "submitComposerDraft",
        "sendChatMessage",
        "handleSendChatMessage",
        "routeRuntimeMessage",
      ],
      expectedSymbols: [
        "submitComposerDraft",
        "sendChatMessage",
        "handleSendChatMessage",
        "routeRuntimeMessage",
      ],
      expectedFiles: [
        "src/pages/Chat/Composer.tsx",
        "src/lib/host-api.ts",
        "electron/main/ipc-handlers.ts",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      expectedLayers: ["renderer", "main", "runtime"],
      mustRejectSymbols: ["GeneratedSchema", "legacyComposerFixture"],
      mustRejectFiles: ["src/generated/api.generated.ts", "src/tests/legacy-fixture.ts"],
    }),
    scenario({
      id: "generated-file-false-positive-suppression",
      title: "Generated file false-positive suppression",
      taskPrompt: "Schema lookup mentions generated names but real code lives in live resolver.",
      taskLoopState: "successful",
      files: common,
      activeFiles: ["src/live/schema-resolver.ts"],
      mentionedFiles: ["src/generated/api.generated.ts", "src/live/schema-resolver.ts"],
      mentionedSymbols: ["RealSchemaResolver", "GeneratedSchema"],
      expectedSymbols: ["RealSchemaResolver"],
      expectedFiles: ["src/live/schema-resolver.ts"],
      expectedLayers: ["renderer"],
      mustRejectSymbols: ["GeneratedSchema", "GeneratedClient"],
      mustRejectFiles: ["src/generated/api.generated.ts"],
    }),
    scenario({
      id: "prompt-present-exclusion",
      title: "Prompt-present exclusion",
      taskPrompt: "Composer is already in prompt; find the host/runtime symbols only.",
      taskLoopState: "successful",
      files: common,
      activeFiles: ["src/pages/Chat/Composer.tsx"],
      mentionedFiles: ["src/lib/host-api.ts", "openclaw_runtime/src/runtime-core/chat-dispatch.ts"],
      mentionedSymbols: ["ChatComposer", "sendChatMessage", "dispatchRuntimeMessage"],
      promptPresentFiles: ["src/pages/Chat/Composer.tsx"],
      expectedSymbols: ["sendChatMessage", "dispatchRuntimeMessage"],
      expectedFiles: ["src/lib/host-api.ts", "openclaw_runtime/src/runtime-core/chat-dispatch.ts"],
      expectedLayers: ["renderer", "runtime"],
      mustRejectSymbols: ["ChatComposer", "submitComposerDraft"],
      mustRejectFiles: ["src/pages/Chat/Composer.tsx"],
    }),
    scenario({
      id: "budget-pressure-many-symbols",
      title: "Budget pressure with many symbols",
      taskPrompt: "Many nearby symbols exist; keep the dispatch-critical symbols.",
      taskLoopState: "long_context",
      files: [...common, ...budgetFiles],
      activeFiles: ["src/budget/feature-00.ts"],
      mentionedFiles: [
        "src/budget/feature-03.ts",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      mentionedSymbols: [
        "BudgetTarget03",
        "BudgetTarget07",
        "dispatchRuntimeMessage",
      ],
      expectedSymbols: ["BudgetTarget03", "dispatchRuntimeMessage"],
      expectedFiles: [
        "src/budget/feature-03.ts",
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      ],
      expectedLayers: ["runtime"],
      mustRejectSymbols: ["BudgetDistractor17", "GeneratedSchema"],
      mustRejectFiles: ["src/generated/api.generated.ts"],
    }),
    scenario({
      id: "long-context-task-loop-replay",
      title: "Long context task-loop replay",
      taskPrompt: "Long context contains old plans; current objective is runtime dispatch.",
      taskLoopState: "long_context",
      files: common,
      activeFiles: ["openclaw_runtime/src/runtime-core/chat-dispatch.ts"],
      mentionedFiles: ["src/lib/host-api.ts", "shared/types/chat.ts"],
      mentionedSymbols: ["dispatchRuntimeMessage", "sendChatMessage", "ChatMessage"],
      expectedSymbols: ["dispatchRuntimeMessage", "sendChatMessage", "ChatMessage"],
      expectedFiles: [
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
        "src/lib/host-api.ts",
        "shared/types/chat.ts",
      ],
      expectedLayers: ["runtime", "renderer", "shared"],
      mustRejectSymbols: ["legacyComposerFixture"],
      mustRejectFiles: ["src/tests/legacy-fixture.ts"],
    }),
    scenario({
      id: "failed-task-repair-replay",
      title: "Failed task repair replay",
      taskPrompt: "Previous validation failed in IPC handler; localize repair evidence.",
      taskLoopState: "failed",
      files: common,
      activeFiles: ["electron/main/ipc-handlers.ts"],
      mentionedFiles: ["src/lib/host-api.ts", "shared/types/chat.ts"],
      mentionedSymbols: ["handleSendChatMessage", "HostApiClient", "ChatRequest"],
      expectedSymbols: ["handleSendChatMessage", "HostApiClient", "ChatRequest"],
      expectedFiles: [
        "electron/main/ipc-handlers.ts",
        "src/lib/host-api.ts",
        "shared/types/chat.ts",
      ],
      expectedLayers: ["main", "renderer", "shared"],
      mustRejectSymbols: ["directRendererGatewayFetch"],
      mustRejectFiles: ["src/pages/Chat/unsafe-gateway.ts"],
    }),
    scenario({
      id: "blocked-task-no-op-safety",
      title: "Blocked task no-op safety",
      taskPrompt: "Task is blocked on approval but explicit analysis requests code map.",
      taskLoopState: "blocked",
      files: common,
      activeFiles: ["src/lib/host-api.ts"],
      mentionedFiles: ["electron/main/ipc-handlers.ts"],
      mentionedSymbols: ["sendChatMessage", "registerChatIpcHandlers"],
      expectedSymbols: ["sendChatMessage", "registerChatIpcHandlers"],
      expectedFiles: ["src/lib/host-api.ts", "electron/main/ipc-handlers.ts"],
      expectedLayers: ["renderer", "main"],
      mustRejectSymbols: ["AuthorizationSecretFixture"],
      mustRejectFiles: ["src/secrets/local-secret.ts"],
    }),
    scenario({
      id: "irrelevant-task-negative-control",
      title: "Irrelevant task negative control",
      taskPrompt: "Update release notes copy; code localization should not claim benefit.",
      taskLoopState: "negative_control",
      files: common,
      activeFiles: ["docs/release-notes.ts"],
      mentionedFiles: [],
      mentionedSymbols: [],
      expectedSymbols: [],
      expectedFiles: [],
      expectedLayers: [],
      mustRejectSymbols: ["dispatchRuntimeMessage", "sendChatMessage", "GeneratedSchema"],
      mustRejectFiles: [
        "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
        "src/generated/api.generated.ts",
      ],
      expectedNoOp: true,
      explicitInvocation: false,
    }),
  ];
}

export async function evaluateAgentMapBenefit(): Promise<AgentMapBenefitEvaluation> {
  const scenarios = await buildAgentMapBenefitCorpus();
  const scenarioObservations: AgentMapBenefitScenarioObservation[] = [];

  for (const item of scenarios) {
    const observations = [];
    for (const budget of item.budgets) {
      observations.push(await runBaselineArm(item, budget));
      observations.push(await runNaiveContextArm(item, budget));
      observations.push(await runAgentMapExplicitArm(item, budget));
    }
    const decision = observationsForBudget(observations, DECISION_BUDGET);
    const baseline = decision.find((entry) => entry.arm === "baseline")!;
    const agentMap = decision.find((entry) => entry.arm === "agentMapExplicit")!;
    const positiveBenefit = !item.expectedNoOp &&
      item.expectedSymbols.length > 0 &&
      agentMap.relevantSymbolRecall > baseline.relevantSymbolRecall;
    scenarioObservations.push({
      id: item.id,
      title: item.title,
      expectedNoOp: item.expectedNoOp,
      positiveBenefit,
      observations,
    });
  }

  const metrics = summarizeBenefitMetrics(scenarios, scenarioObservations);
  return {
    generatedAt: new Date(0).toISOString(),
    provenance: "controlled_virtual_fixture",
    sanitized: true,
    noUserRealData: true,
    deterministic: true,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    metrics,
    scenarios: scenarioObservations,
    recommendationReasons: recommendationReasons(metrics),
  };
}

function scenario(params: Omit<
  AgentMapBenefitScenario,
  "budgets" | "candidateFiles" | "promptPresentFiles" | "expectedNoOp" | "explicitInvocation"
> & {
  budgets?: readonly number[];
  candidateFiles?: string[];
  promptPresentFiles?: string[];
  expectedNoOp?: boolean;
  explicitInvocation?: boolean;
}): AgentMapBenefitScenario {
  const candidateFiles = params.candidateFiles ?? uniqueStrings([
    ...params.activeFiles,
    ...params.mentionedFiles,
    ...params.expectedFiles,
  ]);
  return {
    budgets: BENEFIT_BUDGETS,
    candidateFiles,
    promptPresentFiles: [],
    expectedNoOp: false,
    explicitInvocation: true,
    ...params,
  };
}

async function runBaselineArm(
  item: AgentMapBenefitScenario,
  budget: number,
): Promise<AgentMapBenefitArmObservation> {
  return buildObservation(item, {
    arm: "baseline",
    budget,
    status: "legacy",
    rankedTags: [],
    tokenEstimate: 0,
    authorityEscalated: false,
    legacyPromptDrift: false,
  });
}

async function runNaiveContextArm(
  item: AgentMapBenefitScenario,
  budget: number,
): Promise<AgentMapBenefitArmObservation> {
  const selected = new Set([
    ...item.activeFiles,
    ...item.mentionedFiles,
  ]);
  const selectedFiles = item.files.filter((file) => selected.has(file.file));
  const tags = await extractAgentMapTagsFromSources({
    files: selectedFiles,
    refreshPolicy: "force",
  });
  const rankedTags = tags
    .filter((tag) => tag.kind === "definition")
    .map((tag, index): AgentMapRankedTag => ({
      tag,
      rank: index + 1,
      score: 1,
      reasons: [],
      tokenEstimate: estimateNaiveTagTokens(tag.name),
      renderedBlock: tag.snippet ?? tag.signature ?? tag.name,
      evidenceRefs: tag.evidenceRefs,
    }));
  const included: AgentMapRankedTag[] = [];
  let tokenEstimate = 0;
  for (const rankedTag of rankedTags) {
    const nextEstimate = tokenEstimate + (rankedTag.tokenEstimate ?? 0);
    if (nextEstimate > budget) {
      break;
    }
    included.push(rankedTag);
    tokenEstimate = nextEstimate;
  }

  return buildObservation(item, {
    arm: "naiveContext",
    budget,
    status: included.length > 0 ? "inserted" : "legacy",
    rankedTags: included,
    tokenEstimate,
    authorityEscalated: false,
    legacyPromptDrift: false,
  });
}

async function runAgentMapExplicitArm(
  item: AgentMapBenefitScenario,
  budget: number,
): Promise<AgentMapBenefitArmObservation> {
  const request: AgentMapRequest = buildAgentMapRequestFixture({
    activeFiles: item.activeFiles,
    candidateFiles: item.candidateFiles,
    mentionedFiles: item.mentionedFiles,
    mentionedSymbols: item.mentionedSymbols,
    promptPresentFiles: item.promptPresentFiles,
    tokenBudget: budget,
    refreshPolicy: "force",
  });
  const result = await buildBudgetedAgentMapResult({
    request,
    files: item.files,
    contextLines: 0,
  });
  const legacyReviewerPrompt = legacyPromptForScenario(item);
  const pilot = assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot({
    legacyReviewerPrompt,
    explicitInvocation: item.explicitInvocation,
    result,
    config: ENABLED_CONFIG,
    tokenBudget: budget,
    promptPresentFiles: item.promptPresentFiles,
    generatedAt: 1,
  });
  const promptPresent = new Set(item.promptPresentFiles.map(normalizePath));
  const rankedTags = pilot.status === "inserted"
    ? result.includedSymbols.filter((rankedTag) =>
      !promptPresent.has(normalizePath(rankedTag.tag.file)) &&
      pilot.reviewerPrompt.includes(rankedTag.tag.name)
    )
    : [];

  return buildObservation(item, {
    arm: "agentMapExplicit",
    budget,
    status: pilot.status,
    rankedTags,
    tokenEstimate: pilot.status === "inserted" ? pilot.candidate.tokenEstimate : 0,
    authorityEscalated:
      pilot.candidate.insertedIntoDefaultPrompt ||
      pilot.candidate.insertedIntoDefaultTaskLoopReviewerPrompt ||
      pilot.candidate.insertedIntoGateway ||
      pilot.candidate.insertedIntoModelMessages ||
      pilot.candidate.insertedIntoProviderTransport ||
      pilot.candidate.insertedIntoCheckpointPayload ||
      pilot.candidate.insertedIntoLifecyclePayload ||
      pilot.candidate.persisted,
    legacyPromptDrift: pilot.status === "legacy" &&
      (pilot.reviewerPrompt !== legacyReviewerPrompt ||
        pilot.metadata.legacyReviewerPromptByteIdentical !== true),
  });
}

function buildObservation(
  item: AgentMapBenefitScenario,
  params: {
    arm: AgentMapBenefitArm;
    budget: number;
    status: "legacy" | "inserted";
    rankedTags: AgentMapRankedTag[];
    tokenEstimate: number;
    authorityEscalated: boolean;
    legacyPromptDrift: boolean;
  },
): AgentMapBenefitArmObservation {
  const includedSymbols = uniqueStrings(params.rankedTags.map((entry) => entry.tag.name));
  const includedFiles = uniqueStrings(params.rankedTags.map((entry) => entry.tag.file));
  const expectedSymbolSet = new Set(item.expectedSymbols);
  const expectedFileSet = new Set(item.expectedFiles.map(normalizePath));
  const relevantSymbols = includedSymbols.filter((symbol) =>
    expectedSymbolSet.has(symbol)
  );
  const precisionRelevantSymbols = includedSymbols.filter((symbol) =>
    expectedSymbolSet.has(symbol) ||
    params.rankedTags.some((entry) =>
      entry.tag.name === symbol &&
      expectedFileSet.has(normalizePath(entry.tag.file))
    )
  );
  const relevantFiles = includedFiles.filter((file) =>
    expectedFileSet.has(normalizePath(file))
  );
  const mustRejectSymbolSet = new Set(item.mustRejectSymbols);
  const mustRejectFileSet = new Set(item.mustRejectFiles.map(normalizePath));
  const mustRejectLeaks = uniqueStrings([
    ...includedSymbols.filter((symbol) => mustRejectSymbolSet.has(symbol)),
    ...includedFiles.filter((file) => mustRejectFileSet.has(normalizePath(file))),
  ]);
  const generatedLeaks = includedFiles.filter((file) => isGeneratedFile(file));
  const promptPresentSet = new Set(item.promptPresentFiles.map(normalizePath));
  const promptPresentLeaks = includedFiles.filter((file) =>
    promptPresentSet.has(normalizePath(file))
  );
  const expectedLayers = new Set(item.expectedLayers);
  const coveredLayers = new Set(
    relevantFiles.map(layerForFile).filter((layer): layer is CodeLayer =>
      layer !== undefined && expectedLayers.has(layer)
    ),
  );

  return {
    arm: params.arm,
    budget: params.budget,
    status: params.status,
    includedSymbols,
    includedFiles,
    tokenEstimate: params.tokenEstimate,
    relevantSymbolRecall: ratio(relevantSymbols.length, item.expectedSymbols.length),
    relevantFileRecall: ratio(relevantFiles.length, item.expectedFiles.length),
    precision: includedSymbols.length === 0
      ? item.expectedSymbols.length === 0 ? 1 : 0
      : precisionRelevantSymbols.length / includedSymbols.length,
    crossLayerCoverage: ratio(coveredLayers.size, item.expectedLayers.length),
    budgetEfficiency: params.tokenEstimate > 0
      ? relevantSymbols.length / (params.tokenEstimate / 1000)
      : 0,
    mustRejectLeaks,
    generatedLeaks,
    promptPresentLeaks,
    authorityEscalated: params.authorityEscalated,
    legacyPromptDrift: params.legacyPromptDrift,
  };
}

function summarizeBenefitMetrics(
  scenarios: AgentMapBenefitScenario[],
  observations: AgentMapBenefitScenarioObservation[],
): AgentMapBenefitMetrics {
  const decisionRows = observations.map((entry) => ({
    scenario: scenarios.find((scenarioItem) => scenarioItem.id === entry.id)!,
    baseline: decisionObservation(entry, "baseline"),
    naive: decisionObservation(entry, "naiveContext"),
    agentMap: decisionObservation(entry, "agentMapExplicit"),
  }));
  const positiveRows = decisionRows.filter((entry) => !entry.scenario.expectedNoOp);
  const agentRows = decisionRows.map((entry) => entry.agentMap);
  const positiveAgentRows = positiveRows.map((entry) => entry.agentMap);
  const positiveBenefitScenarioCount = observations.filter((entry) =>
    entry.positiveBenefit
  ).length;
  const generatedScenarioCount = decisionRows.filter((entry) =>
    entry.scenario.mustRejectFiles.some(isGeneratedFile)
  ).length;
  const promptPresentScenarioCount = decisionRows.filter((entry) =>
    entry.scenario.promptPresentFiles.length > 0
  ).length;
  const irrelevantRow = decisionRows.find((entry) =>
    entry.scenario.expectedNoOp
  );
  const naiveMustRejectRate = rate(decisionRows, (entry) =>
    entry.naive.mustRejectLeaks.length > 0
  );
  const agentMustRejectRate = rate(decisionRows, (entry) =>
    entry.agentMap.mustRejectLeaks.length > 0
  );
  const relevantSymbolRecallAtBudget = average(
    positiveAgentRows.map((entry) => entry.relevantSymbolRecall),
  );
  const precision = average(positiveAgentRows.map((entry) => entry.precision));
  const generatedLeakRate = generatedScenarioCount === 0
    ? 0
    : decisionRows.filter((entry) =>
      entry.scenario.mustRejectFiles.some(isGeneratedFile) &&
      entry.agentMap.generatedLeaks.length > 0
    ).length / generatedScenarioCount;
  const promptPresentRedundancyRate = promptPresentScenarioCount === 0
    ? 0
    : decisionRows.filter((entry) =>
      entry.scenario.promptPresentFiles.length > 0 &&
      entry.agentMap.promptPresentLeaks.length > 0
    ).length / promptPresentScenarioCount;
  const authorityEscalationCount = agentRows.filter((entry) =>
    entry.authorityEscalated
  ).length;
  const legacyPromptDriftCount = agentRows.filter((entry) =>
    entry.legacyPromptDrift
  ).length;
  const taskLocalizationLiftVsBaseline = average(
    positiveRows.map((entry) =>
      entry.agentMap.relevantSymbolRecall - entry.baseline.relevantSymbolRecall
    ),
  );
  const agentMapLiftVsNaive = (precision -
    average(positiveRows.map((entry) => entry.naive.precision))) +
    (naiveMustRejectRate - agentMustRejectRate);
  const benefitScore = scoreBenefit({
    relevantSymbolRecallAtBudget,
    precision,
    mustRejectLeakRate: agentMustRejectRate,
    authorityEscalationCount,
    positiveBenefitScenarioCount,
    generatedLeakRate,
    promptPresentRedundancyRate,
    irrelevantTaskInsertionBenefit: irrelevantBenefit(irrelevantRow?.agentMap),
  });
  return {
    corpusSize: scenarios.length,
    scenarioIds: scenarios.map((entry) => entry.id),
    budgetProfiles: [...BENEFIT_BUDGETS],
    decisionBudget: DECISION_BUDGET,
    positiveScenarioCount: positiveRows.length,
    positiveBenefitScenarioCount,
    relevantSymbolRecallAtBudget,
    relevantFileRecallAtBudget: average(
      positiveAgentRows.map((entry) => entry.relevantFileRecall),
    ),
    precision,
    crossLayerCoverage: average(
      positiveAgentRows.map((entry) => entry.crossLayerCoverage),
    ),
    budgetEfficiency: average(
      positiveAgentRows.map((entry) => entry.budgetEfficiency),
    ),
    taskLocalizationLiftVsBaseline,
    agentMapLiftVsNaive,
    generatedLeakRate,
    promptPresentRedundancyRate,
    mustRejectLeakRate: agentMustRejectRate,
    authorityEscalationCount,
    legacyPromptDriftCount,
    irrelevantTaskInsertionBenefit: irrelevantBenefit(irrelevantRow?.agentMap),
    benefitScore,
    investmentRecommendation: recommendation({
      relevantSymbolRecallAtBudget,
      precision,
      mustRejectLeakRate: agentMustRejectRate,
      authorityEscalationCount,
      positiveBenefitScenarioCount,
      generatedLeakRate,
      promptPresentRedundancyRate,
      agentMapLiftVsNaive,
    }),
  };
}

function scoreBenefit(input: {
  relevantSymbolRecallAtBudget: number;
  precision: number;
  mustRejectLeakRate: number;
  authorityEscalationCount: number;
  positiveBenefitScenarioCount: number;
  generatedLeakRate: number;
  promptPresentRedundancyRate: number;
  irrelevantTaskInsertionBenefit: number;
}): number {
  if (
    input.mustRejectLeakRate > 0 ||
    input.authorityEscalationCount > 0 ||
    input.generatedLeakRate > 0 ||
    input.promptPresentRedundancyRate > 0 ||
    input.irrelevantTaskInsertionBenefit > 0
  ) {
    return 0;
  }
  const recallScore = Math.min(35, input.relevantSymbolRecallAtBudget * 35);
  const precisionScore = Math.min(30, input.precision * 30);
  const scenarioScore = Math.min(25, (input.positiveBenefitScenarioCount / 8) * 25);
  return Math.round(recallScore + precisionScore + scenarioScore + 10);
}

function recommendation(input: {
  relevantSymbolRecallAtBudget: number;
  precision: number;
  mustRejectLeakRate: number;
  authorityEscalationCount: number;
  positiveBenefitScenarioCount: number;
  generatedLeakRate: number;
  promptPresentRedundancyRate: number;
  agentMapLiftVsNaive: number;
}): AgentMapBenefitRecommendation {
  if (
    input.mustRejectLeakRate > 0 ||
    input.authorityEscalationCount > 0 ||
    input.generatedLeakRate > 0 ||
    input.promptPresentRedundancyRate > 0 ||
    input.agentMapLiftVsNaive <= 0.05
  ) {
    return "stop_expansion";
  }
  if (
    input.relevantSymbolRecallAtBudget >= 0.75 &&
    input.precision >= 0.70 &&
    input.positiveBenefitScenarioCount >= 8
  ) {
    return "continue_investment";
  }
  return "hold_boundary";
}

function recommendationReasons(metrics: AgentMapBenefitMetrics): string[] {
  return [
    `AgentMap recall at budget ${metrics.decisionBudget}: ${formatRate(metrics.relevantSymbolRecallAtBudget)}.`,
    `AgentMap precision at budget ${metrics.decisionBudget}: ${formatRate(metrics.precision)}.`,
    `Positive benefit scenarios: ${metrics.positiveBenefitScenarioCount}/${metrics.corpusSize}.`,
    `AgentMap lift vs naive: ${metrics.agentMapLiftVsNaive.toFixed(3)}.`,
    `Risk rates generated=${metrics.generatedLeakRate}, promptPresent=${metrics.promptPresentRedundancyRate}, mustReject=${metrics.mustRejectLeakRate}.`,
  ];
}

function decisionObservation(
  entry: AgentMapBenefitScenarioObservation,
  arm: AgentMapBenefitArm,
): AgentMapBenefitArmObservation {
  return entry.observations.find((observation) =>
    observation.arm === arm && observation.budget === DECISION_BUDGET
  )!;
}

function observationsForBudget(
  observations: AgentMapBenefitArmObservation[],
  budget: number,
): AgentMapBenefitArmObservation[] {
  return observations.filter((entry) => entry.budget === budget);
}

function legacyPromptForScenario(item: AgentMapBenefitScenario): string {
  const context = item.taskLoopState === "long_context"
    ? "\nprior context ".repeat(200)
    : "";
  return [
    LEGACY_REVIEWER_PROMPT,
    "",
    `scenario: ${item.id}`,
    `task: ${item.taskPrompt}`,
    context,
  ].join("\n");
}

function buildCommonWorkspaceFiles(): AgentMapSourceFile[] {
  return [
    {
      file: "src/pages/Chat/Composer.tsx",
      content: [
        "import type { ChatRequest } from '../../shared/types/chat';",
        "import { sendChatMessage } from '../../lib/host-api';",
        "export function ChatComposer(props: { draft: string }) { return props.draft; }",
        "export function submitComposerDraft(request: ChatRequest) { return sendChatMessage(request); }",
        "export function useComposerHotkeys() { return submitComposerDraft; }",
      ].join("\n"),
    },
    {
      file: "src/lib/host-api.ts",
      content: [
        "import type { ChatRequest, ChatMessage } from '../shared/types/chat';",
        "export interface HostApiClient { send(input: ChatRequest): Promise<ChatMessage>; }",
        "export function getHostApiClient(): HostApiClient { return { send: async (input) => ({ id: input.id, role: 'assistant', content: input.content }) }; }",
        "export function sendChatMessage(request: ChatRequest) { return getHostApiClient().send(request); }",
      ].join("\n"),
    },
    {
      file: "electron/main/ipc-handlers.ts",
      content: [
        "import type { ChatRequest } from '../../shared/types/chat';",
        "import { dispatchRuntimeMessage } from '../../openclaw_runtime/src/runtime-core/chat-dispatch';",
        "export function registerChatIpcHandlers() { return handleSendChatMessage; }",
        "export function handleSendChatMessage(request: ChatRequest) { return dispatchRuntimeMessage(request); }",
      ].join("\n"),
    },
    {
      file: "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
      content: [
        "import type { ChatRequest, ChatMessage } from '../../../shared/types/chat';",
        "export function validateDispatchPayload(request: ChatRequest) { return request.role !== undefined; }",
        "export function routeRuntimeMessage(request: ChatRequest) { return request.content; }",
        "export function dispatchRuntimeMessage(request: ChatRequest): ChatMessage { validateDispatchPayload(request); return { id: request.id, role: request.role, content: routeRuntimeMessage(request) }; }",
      ].join("\n"),
    },
    {
      file: "shared/types/chat.ts",
      content: [
        "export type ChatRole = 'user' | 'assistant';",
        "export interface ChatMessage { id: string; role: ChatRole; content: string; }",
        "export interface ChatRequest { id: string; role: ChatRole; content: string; }",
      ].join("\n"),
    },
    {
      file: "src/generated/api.generated.ts",
      content: [
        "export interface GeneratedSchema { raw: string; }",
        "export function GeneratedClient(input: GeneratedSchema) { return input.raw; }",
      ].join("\n"),
    },
    {
      file: "src/live/schema-resolver.ts",
      content: [
        "export interface LiveSchemaInput { raw: string; }",
        "export function RealSchemaResolver(input: LiveSchemaInput) { return input.raw.trim(); }",
      ].join("\n"),
    },
    {
      file: "src/pages/Chat/unsafe-gateway.ts",
      content: "export function directRendererGatewayFetch() { return fetch('http://127.0.0.1:18789/session'); }",
    },
    {
      file: "src/unrelated/theme.ts",
      content: "export const unusedThemeToken = 'violet';",
    },
    {
      file: "src/tests/legacy-fixture.ts",
      content: "export function legacyComposerFixture() { return 'old'; }",
    },
    {
      file: "src/secrets/local-secret.ts",
      content: "export const AuthorizationSecretFixture = 'secret';",
    },
    {
      file: "docs/release-notes.ts",
      content: "export const releaseNoteCopy = 'Polish the release notes.';",
    },
  ];
}

function buildBudgetPressureFiles(): AgentMapSourceFile[] {
  return Array.from({ length: 20 }, (_, index) => ({
    file: `src/budget/feature-${String(index).padStart(2, "0")}.ts`,
    content: [
      `export function BudgetTarget${String(index).padStart(2, "0")}() { return ${index}; }`,
      `export function BudgetDistractor${String(index).padStart(2, "0")}() { return BudgetTarget${String(index).padStart(2, "0")}(); }`,
    ].join("\n"),
  }));
}

function estimateNaiveTagTokens(name: string): number {
  return Math.max(24, Math.ceil(name.length / 4) + 24);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.length === 0
    ? 0
    : items.filter(predicate).length / items.length;
}

function irrelevantBenefit(
  observation: AgentMapBenefitArmObservation | undefined,
): number {
  if (!observation || observation.status === "legacy") {
    return 0;
  }
  return observation.precision > 0 ? observation.precision : 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "");
}

function isGeneratedFile(file: string): boolean {
  return /\.generated\.[tj]sx?$/u.test(normalizePath(file)) ||
    normalizePath(file).includes("/generated/");
}

function layerForFile(file: string): CodeLayer | undefined {
  const normalized = normalizePath(file);
  if (normalized.startsWith("src/")) return "renderer";
  if (normalized.startsWith("electron/")) return "main";
  if (normalized.startsWith("openclaw_runtime/")) return "runtime";
  if (normalized.startsWith("shared/")) return "shared";
  return undefined;
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
