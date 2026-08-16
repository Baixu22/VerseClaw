/**
 * System prompt report builder.
 *
 * Session metadata uses this report to account for prompt size, bootstrap file
 * injection, skills, and tool schema footprint without storing raw prompt text.
 */
import { createHash } from "node:crypto";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { buildBootstrapInjectionStats } from "./bootstrap-budget.js";
import type { EmbeddedContextFile } from "./embedded-agent-helpers.js";
import type { RuntimeIntensityPolicy } from "./intensity-policy.js";
import type { AgentTool } from "./runtime/index.js";
import type { PromptMode } from "./system-prompt.types.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

type ToolReportEntry = SessionSystemPromptReport["tools"]["entries"][number];

const toolReportEntryCache = new WeakMap<AgentTool, ToolReportEntry>();
const toolSchemaStatsCache = new WeakMap<
  object,
  Pick<ToolReportEntry, "propertiesCount" | "schemaChars" | "schemaHash">
>();

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function extractBetween(input: string, startMarker: string, endMarker: string): string {
  const start = input.indexOf(startMarker);
  if (start === -1) {
    return "";
  }
  const end = input.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? input.slice(start) : input.slice(start, end);
}

function parseSkillBlocks(skillsPrompt: string): Array<{ name: string; blockChars: number }> {
  const prompt = skillsPrompt.trim();
  if (!prompt) {
    return [];
  }
  const blocks = Array.from(prompt.matchAll(/<skill>[\s\S]*?<\/skill>/gi)).map(
    (match) => match[0] ?? "",
  );
  return blocks
    .map((block) => {
      const name = block.match(/<name>\s*([^<]+?)\s*<\/name>/i)?.[1]?.trim() || "(unknown)";
      return { name, blockChars: block.length };
    })
    .filter((b) => b.blockChars > 0);
}

function buildToolSchemaStats(
  parameters: AgentTool["parameters"],
): Pick<ToolReportEntry, "propertiesCount" | "schemaChars" | "schemaHash"> {
  if (!parameters || typeof parameters !== "object") {
    return { schemaChars: 0, schemaHash: sha256(""), propertiesCount: null };
  }
  const cached = toolSchemaStatsCache.get(parameters);
  if (cached) {
    return cached;
  }
  let schemaJson;
  try {
    schemaJson = JSON.stringify(parameters);
  } catch {
    schemaJson = "";
  }
  const stats = {
    schemaChars: schemaJson.length,
    schemaHash: sha256(schemaJson),
    propertiesCount: (() => {
      const schema = parameters as Record<string, unknown>;
      const props = typeof schema.properties === "object" ? schema.properties : null;
      if (!props || typeof props !== "object") {
        return null;
      }
      return Object.keys(props as Record<string, unknown>).length;
    })(),
  };
  // Tool parameter objects are reused across runs; cache their stable size/hash
  // so report generation stays cheap during frequent prompt rebuilds.
  toolSchemaStatsCache.set(parameters, stats);
  return stats;
}

function buildToolsEntries(tools: AgentTool[]): SessionSystemPromptReport["tools"]["entries"] {
  return tools.map((tool) => {
    const cached = toolReportEntryCache.get(tool);
    if (cached) {
      return cached;
    }
    const name = tool.name;
    const summary = tool.description?.trim() || tool.label?.trim() || "";
    const summaryChars = summary.length;
    const schemaStats = buildToolSchemaStats(tool.parameters);
    const entry = { name, summaryChars, summaryHash: sha256(summary), ...schemaStats };
    toolReportEntryCache.set(tool, entry);
    return entry;
  });
}

function measureRenderedProjectContextChars(systemPrompt: string): number {
  return extractBetween(systemPrompt, "\n# Project Context\n", "\n## Silent Replies\n").length;
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function estimateSavedTokens(chars: number | undefined): number {
  return Math.ceil(normalizeNonNegativeInteger(chars) / 4);
}

function buildRuntimeIntensityReport(
  params:
    | {
        policy: RuntimeIntensityPolicy;
        promptMode: PromptMode;
        skillsIncluded?: number;
        skillsTotal?: number;
        toolResultMaxChars?: number;
        estimatedSavedChars?: number;
        requestedReasoning?: string;
        effectiveReasoning?: string;
        requestedIntensity?: string;
        effectiveIntensity?: string;
        intensitySource?: "explicit" | "legacy-thinking-level";
        couplingMode?: "linked-v1";
        policyAdherence?: "full" | "prompt-only";
      }
    | undefined,
): SessionSystemPromptReport["runtimeIntensity"] | undefined {
  if (!params) {
    return undefined;
  }
  const estimatedSavedChars = normalizeNonNegativeInteger(params.estimatedSavedChars);
  return {
    level: params.policy.level,
    policyId: params.policy.policyId,
    promptMode: params.promptMode,
    skillsMode: params.policy.skills.mode,
    shellOutputMode: params.policy.shellOutput.mode,
    ...(params.policy.shellOutput.mode === "compact-preferred"
      ? { shellOutputRecovery: params.policy.shellOutput.recovery }
      : {}),
    skillsIncluded: normalizeNonNegativeInteger(params.skillsIncluded),
    skillsTotal: normalizeNonNegativeInteger(params.skillsTotal),
    toolResultMaxChars: normalizeNonNegativeInteger(params.toolResultMaxChars),
    estimatedSavedChars,
    estimatedSavedTokens: estimateSavedTokens(estimatedSavedChars),
    ...(params.requestedReasoning !== undefined
      ? { requestedReasoning: params.requestedReasoning }
      : {}),
    ...(params.effectiveReasoning !== undefined
      ? { effectiveReasoning: params.effectiveReasoning }
      : {}),
    ...(params.requestedIntensity !== undefined
      ? { requestedIntensity: params.requestedIntensity }
      : {}),
    ...(params.effectiveIntensity !== undefined
      ? { effectiveIntensity: params.effectiveIntensity }
      : {}),
    ...(params.intensitySource ? { intensitySource: params.intensitySource } : {}),
    ...(params.couplingMode ? { couplingMode: params.couplingMode } : {}),
    ...(params.policyAdherence ? { policyAdherence: params.policyAdherence } : {}),
  };
}

/** Builds the stored report for a rendered system prompt and its inputs. */
export function buildSystemPromptReport(params: {
  source: SessionSystemPromptReport["source"];
  generatedAt: number;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  workspaceDir?: string;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars?: number;
  bootstrapTruncation?: SessionSystemPromptReport["bootstrapTruncation"];
  sandbox?: SessionSystemPromptReport["sandbox"];
  systemPrompt: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  skillsPrompt: string;
  tools: AgentTool[];
  currentTurn?: SessionSystemPromptReport["currentTurn"];
  runtimeIntensity?: Parameters<typeof buildRuntimeIntensityReport>[0];
}): SessionSystemPromptReport {
  const systemPromptChars = params.systemPrompt.length;
  const projectContextChars = measureRenderedProjectContextChars(params.systemPrompt);
  const toolsEntries = buildToolsEntries(params.tools);
  const toolsListChars = toolsEntries.reduce((sum, t) => sum + t.summaryChars, 0);
  const toolsSchemaChars = toolsEntries.reduce((sum, t) => sum + (t.schemaChars ?? 0), 0);
  const skillsEntries = parseSkillBlocks(params.skillsPrompt);

  return {
    source: params.source,
    generatedAt: params.generatedAt,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir: params.workspaceDir,
    bootstrapMaxChars: params.bootstrapMaxChars,
    bootstrapTotalMaxChars: params.bootstrapTotalMaxChars,
    ...(params.bootstrapTruncation ? { bootstrapTruncation: params.bootstrapTruncation } : {}),
    sandbox: params.sandbox,
    systemPrompt: {
      chars: systemPromptChars,
      hash: sha256(params.systemPrompt),
      projectContextChars,
      nonProjectContextChars: Math.max(0, systemPromptChars - projectContextChars),
    },
    ...(params.currentTurn ? { currentTurn: params.currentTurn } : {}),
    ...(params.runtimeIntensity
      ? { runtimeIntensity: buildRuntimeIntensityReport(params.runtimeIntensity) }
      : {}),
    injectedWorkspaceFiles: buildBootstrapInjectionStats({
      bootstrapFiles: params.bootstrapFiles,
      injectedFiles: params.injectedFiles,
    }),
    skills: {
      promptChars: params.skillsPrompt.length,
      hash: sha256(params.skillsPrompt),
      entries: skillsEntries,
    },
    tools: {
      listChars: toolsListChars,
      schemaChars: toolsSchemaChars,
      definitionChars: toolsListChars + toolsSchemaChars,
      entries: toolsEntries,
    },
  };
}
