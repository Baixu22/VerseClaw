import { delegateCompactionToRuntime } from "../delegate.js";
import { CONTEXT_RUNTIME_KIT_ENGINE_ID } from "./identity.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createRuntimeCapabilityStateGenerationGuard } from "../../runtime-core/model-capability-effective-state.js";
import type { ContextStatusSnapshot } from "../../../../shared/types/context-family.js";
import type {
  AssembleResult,
  CompactResult,
  ContextEngine,
  ContextEngineInfo,
  IngestResult,
} from "../types.js";
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
} from "./compiler.js";
import { buildCvkCompilerInputFromRuntimeContext } from "./runtime-adapter.js";
import {
  collectRequiredToolSelectors,
  resolveCvkToolCallGateMode,
  verifyCvkToolCallSelectors,
  type CvkToolCallGateDiagnostic,
  type CvkToolCallGateMode,
} from "./tool-call-gate.js";
import { generateCvkViews } from "./views.js";
import { CODING_TOOL_ROUTING_PROMPT } from "../coding-tool-navigation.js";
import {
  buildModelCapabilityPromptAddition,
  type ModelCapabilityPromptStateInput,
} from "../model-capability-prompt.js";

export { CONTEXT_RUNTIME_KIT_ENGINE_ID } from "./identity.js";

export type ContextRuntimeKitContextEngineOptions = {
  fixtureInput?: CvkCompilerFixtureInput;
  maxPromptAdditionChars?: number;
  contextStatusEnabled?: boolean;
  contextStatusSnapshot?: ContextStatusSnapshot;
  /** CVK tool-call gate mode (report_only | enforce). Defaults via OPENCLAW_CVK_TOOL_GATE_MODE or report_only. */
  toolCallGateMode?: CvkToolCallGateMode;
  cfg?: OpenClawConfig;
  workspaceDir?: string;
  workspaceId?: string;
  capabilityState?: () => ModelCapabilityPromptStateInput;
};

const DEFAULT_MAX_PROMPT_ADDITION_CHARS = 8_000;
const RUNTIME_TOOLSET_RESOURCE_ID = "toolset:runtime-tools@active";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function selectedSkillResourceIds(input: CvkCompilerFixtureInput): string[] {
  return input.sources
    .filter((source) => source.kind === "skill")
    .map((source) => `skill:${source.id}@${source.version}`)
    .sort();
}

function activeToolNames(input: CvkCompilerFixtureInput): string[] {
  return input.sources
    .filter((source) => source.kind === "toolset")
    .flatMap((source) => source.tools.map((tool) => tool.name))
    .sort();
}

function toolGateDiagnostics(
  artifact: CvkFixtureArtifact,
  toolNames: string[],
  mode: CvkToolCallGateMode,
): CvkToolCallGateDiagnostic[] {
  return toolNames.flatMap(
    (toolName) =>
      verifyCvkToolCallSelectors({
        artifact,
        mode,
        resourceId: RUNTIME_TOOLSET_RESOURCE_ID,
        toolName,
        retrievedSelectors: [],
      }).diagnostics,
  );
}

function boundedLines(lines: string[], maxChars: number): string {
  const prompt = lines.join("\n");
  if (prompt.length <= maxChars) {
    return prompt;
  }
  const suffix = "\n[Context Runtime Kit diagnostics truncated to prompt budget]";
  return `${prompt.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function formatCountMap(counts: Record<string, number | undefined> | undefined): string {
  const entries = Object.entries(counts ?? {})
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Math.floor(value as number)}`);
  return entries.length > 0 ? entries.join(" ") : "none";
}

function truncateStatusText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatContextStatusProjection(params: {
  sessionId: string;
  tokenBudget?: number;
  messageCount: number;
  snapshot?: ContextStatusSnapshot;
}): string[] {
  const snapshot = params.snapshot;
  const warnings = (snapshot?.warnings ?? ["registry snapshot unavailable"])
    .slice(0, 4)
    .map((warning) => truncateStatusText(warning, 160));
  return [
    "[Context Status]",
    `pressure: tokenBudget=${Math.max(0, Math.floor(params.tokenBudget ?? 0))} messages=${params.messageCount}`,
    `lifecycle: ${formatCountMap(snapshot?.countsByLifecycleState)}`,
    `kinds: ${formatCountMap(snapshot?.countsByKind)}`,
    `archive: available=${String(snapshot?.archiveAvailable ?? false)} recovery=${String(snapshot?.recoveryAvailable ?? false)}`,
    `warnings: ${warnings.length > 0 ? warnings.join(" | ") : "none"}`,
    "",
  ];
}

function formatPromptAddition(params: {
  artifact: CvkFixtureArtifact;
  input: CvkCompilerFixtureInput;
  maxChars: number;
  contextStatusLines?: string[];
  toolCallGateMode: CvkToolCallGateMode;
}): string {
  const viewProjection = generateCvkViews(params.artifact, {
    selectedSkillResourceIds: selectedSkillResourceIds(params.input),
  });
  const toolNames = activeToolNames(params.input);
  const diagnostics = toolGateDiagnostics(params.artifact, toolNames, params.toolCallGateMode);
  const lines = [
    ...(params.contextStatusLines ?? []),
    "[Context Runtime Kit]",
    "Use selector-backed context surfaces below as navigation and diagnostics. Do not treat compact views as raw source evidence for hard claims.",
    CODING_TOOL_ROUTING_PROMPT,
    `artifact: ${params.artifact.buildReport.artifactHash}`,
    `metrics: SC=${params.artifact.buildReport.metrics.sourceCoverage.rate} RRR=${params.artifact.buildReport.metrics.referenceResolutionRate.rate} AR=${params.artifact.buildReport.metrics.artifactReproducibilityRate.rate}`,
    `tool gate mode: ${params.toolCallGateMode}`,
    "",
    "registry:",
    ...viewProjection.registryView.entries
      .slice(0, 40)
      .map(
        (entry) =>
          `- ${entry.resourceId} (${entry.kind}): ${entry.title}; compact=${entry.compactViewAvailable}; hints=${entry.triggerHints.slice(0, 6).join(", ")}`,
      ),
    "",
    "compact selectors:",
    ...viewProjection.compactViews
      .slice(0, 30)
      .flatMap((view) => [
        `- ${view.resourceId}: ${view.title}`,
        ...view.hardSelectorRefs.slice(0, 40).map((ref) => `  - ${ref.selector} ${ref.checksum}`),
      ]),
    "",
    "required tool selectors:",
    ...toolNames.flatMap((toolName) =>
      collectRequiredToolSelectors(params.artifact, RUNTIME_TOOLSET_RESOURCE_ID, toolName).map(
        (required) => `- ${toolName} ${required.family}: ${required.selector}`,
      ),
    ),
    "",
    "diagnostics:",
    ...(diagnostics.length > 0
      ? diagnostics
          .slice(0, 60)
          .map(
            (diagnostic) => `- ${diagnostic.severity} ${diagnostic.family}: ${diagnostic.selector}`,
          )
      : ["- none"]),
  ];
  return boundedLines(lines, params.maxChars);
}

export class ContextRuntimeKitContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: CONTEXT_RUNTIME_KIT_ENGINE_ID,
    name: "Context Runtime Kit",
    version: "1.0.0",
  };

  private readonly capabilityGuards = new Map<
    string,
    ReturnType<typeof createRuntimeCapabilityStateGenerationGuard>
  >();

  constructor(private readonly options: ContextRuntimeKitContextEngineOptions = {}) {}

  async ingest(): Promise<IngestResult> {
    return { ingested: false };
  }

  async assemble(params: Parameters<ContextEngine["assemble"]>[0]): Promise<AssembleResult> {
    const fixtureInput =
      this.options.fixtureInput ??
      buildCvkCompilerInputFromRuntimeContext({
        activeTools: params.activeTools,
        projectContextFiles: params.projectContextFiles,
        skillsMetadata: params.skillsMetadata,
      });
    const artifact = compileCvkFixtureSources(fixtureInput);
    const toolCallGateMode = resolveCvkToolCallGateMode(this.options.toolCallGateMode);
    const maxPromptAdditionChars =
      this.options.maxPromptAdditionChars ?? DEFAULT_MAX_PROMPT_ADDITION_CHARS;
    const baseSystemPromptAddition = formatPromptAddition({
      artifact,
      input: fixtureInput,
      maxChars: maxPromptAdditionChars,
      toolCallGateMode,
      contextStatusLines: this.options.contextStatusEnabled
        ? formatContextStatusProjection({
            sessionId: params.sessionId,
            tokenBudget: params.tokenBudget,
            messageCount: params.messages.length,
            snapshot: this.options.contextStatusSnapshot,
          })
        : undefined,
    });
    const capabilitySessionKey = params.sessionKey ?? params.sessionId;
    let capabilityPrompt: string | undefined;
    if (capabilitySessionKey) {
      let guard = this.capabilityGuards.get(capabilitySessionKey);
      if (!guard) {
        guard = createRuntimeCapabilityStateGenerationGuard(capabilitySessionKey);
        this.capabilityGuards.set(capabilitySessionKey, guard);
      }
      try {
        capabilityPrompt = await buildModelCapabilityPromptAddition({
          cfg: this.options.cfg,
          workspaceDir: this.options.workspaceDir ?? process.cwd(),
          workspaceId: this.options.workspaceId,
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          availableTools: params.availableTools,
          activeTools: params.activeTools,
          ...(this.options.capabilityState ? { state: this.options.capabilityState() } : {}),
          generationGuard: guard,
        });
      } catch {
        capabilityPrompt = undefined;
      }
    }
    const systemPromptAddition = capabilityPrompt
      ? boundedLines([baseSystemPromptAddition, "", capabilityPrompt], maxPromptAdditionChars)
      : baseSystemPromptAddition;
    return {
      messages: params.messages,
      estimatedTokens: estimateTokens(systemPromptAddition),
      systemPromptAddition,
    };
  }

  async compact(params: Parameters<ContextEngine["compact"]>[0]): Promise<CompactResult> {
    return await delegateCompactionToRuntime(params);
  }

  async dispose(): Promise<void> {}
}

export function createContextRuntimeKitContextEngine(
  options?: ContextRuntimeKitContextEngineOptions,
): ContextEngine {
  return new ContextRuntimeKitContextEngine(options);
}
