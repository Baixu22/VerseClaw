/**
 * Production Working Context assembly via Verse Token (VT).
 *
 * Role: consume host sources (workspace bootstrap md, optional tool schemas /
 * memory entries) → UnifiedStore ingest* → assemble(task_hint, budget) →
 * append a `## Working Context` block to extraSystemPrompt.
 *
 * Does NOT replace md/jsonl storage, BlockStore, compaction, or business
 * memory stores. VT is the packing/assembly layer for Working Context.
 *
 * Default: OFF (opt-in / canary). Enable via:
 *   - runtime.vtoken.assembly.enabled=true
 *   - env VERSE_VTOKEN_ASSEMBLY_ENABLED=1 (canary force-on)
 * Kill-switch (instant):
 *   - env VERSE_VTOKEN_ASSEMBLY_ENABLED=0
 *   - runtime.vtoken.assembly.enabled=false
 *   - VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH=1 / runtime.contextEnhancement.killSwitch
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord } from "../runtime-core/index.js";
import type { BlockStoreApi, ContextBlock, SourceSystem } from "./block.js";
import { dcsObservability } from "./dcs-observability.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import {
  getSharedVtokenRpcClient,
  type VtokenPackCandidate,
  type VtokenRpcPackResult,
  type VtokenRpcClient,
} from "./vtoken-rpc-client.js";

export type VtokenRenderMode = "compact" | "dense" | "verbose";

export type VtokenAssemblyConfig = {
  /** Product default OFF (opt-in). Explicit true enables canary injection. */
  enabled: boolean;
  budgetTokens: number;
  renderMode: VtokenRenderMode;
  sessions: "all" | "main-only";
  timeoutMs: number;
  /** Max bootstrap files to ingest per turn. */
  maxSourceFiles: number;
  /** Max chars per source file when ingesting. */
  maxSourceChars: number;
};

export const DEFAULT_VTOKEN_ASSEMBLY_CONFIG: VtokenAssemblyConfig = {
  enabled: false,
  budgetTokens: 600,
  renderMode: "compact",
  sessions: "all",
  timeoutMs: 12_000,
  maxSourceFiles: 12,
  maxSourceChars: 24_000,
};

export type VtokenMarkdownSource = {
  sourcePath: string;
  text: string;
};

export type VtokenTurnAssembleInput = {
  sessionKey?: string;
  taskHint: string;
  /** Explicit packing allowance resolved by Context Orchestrator. */
  allowanceTokens: number;
  workspaceDir?: string;
  /** Pre-loaded markdown sources; when omitted, workspace bootstrap files are read. */
  markdownSources?: VtokenMarkdownSource[];
  toolSchemas?: Array<Record<string, unknown>>;
  memoryEntries?: Array<Record<string, unknown>>;
  /** FP-P1-182: paths the system prompt already renders in full; do not re-pack. */
  alreadyRenderedSourcePaths?: readonly string[];
  /** FP-P1-182: tool names the system prompt already renders in `## Tooling`. */
  alreadyRenderedToolNames?: readonly string[];
};

export type VtokenTurnPackResult = {
  text: string;
  pack: VtokenRpcPackResult;
  durationMs: number;
  sourcesIngested: number;
};

const DCS_SOURCE_CONFIG_KEYS = {
  "working-memory": "working-memory",
  compass: "compass",
  "role-memory": "role-memory",
} as const satisfies Partial<Record<SourceSystem, string>>;

/**
 * Project existing DCS blocks into VT memory inputs without creating another
 * authority. Only sources whose canonical DCS feature flag is enabled are
 * readable, so VT cannot bypass the DCS control plane.
 */
export async function loadVtokenDcsMemoryEntries(
  store: Pick<BlockStoreApi, "query"> | undefined,
  sessionId: string | undefined,
  cfg: unknown,
): Promise<Array<Record<string, unknown>>> {
  if (!store || !sessionId?.trim()) return [];
  const contextBlock = resolveContextBlockConfig(cfg);
  const enabledSources = (
    Object.entries(DCS_SOURCE_CONFIG_KEYS) as Array<[keyof typeof DCS_SOURCE_CONFIG_KEYS, string]>
  )
    .filter(([, configKey]) => {
      const sourceConfig = contextBlock?.[configKey];
      return isRecord(sourceConfig) && sourceConfig.enabled === true;
    })
    .map(([source]) => source);
  if (enabledSources.length === 0) return [];

  const blocks = await store.query({
    requester_session_id: sessionId,
    session_id: sessionId,
    include_global: true,
    source_systems: enabledSources,
    block_types: ["working_memory", "knowledge"],
    limit: 24,
  });
  return blocks.map(contextBlockToVtokenMemory);
}

function contextBlockToVtokenMemory(block: ContextBlock): Record<string, unknown> {
  const content = (block.full_content?.trim() || block.summary.trim()).slice(0, 8_000);
  return {
    id: `dcs.${block.source_system}.${block.block_id}`,
    content,
    tags: [
      "dcs",
      block.block_type,
      block.source_system,
      ...(block.presence.priority != null && block.presence.priority <= 2 ? ["blocker"] : []),
    ],
  };
}

function resolveContextBlockConfig(value: unknown): Record<string, unknown> | undefined {
  const runtime = runtimeConfigFrom(value);
  return isRecord(runtime?.contextBlock) ? runtime.contextBlock : undefined;
}

/**
 * TF-0496 decision: VToken is RETIRED.
 *
 * A predeclared paired A/B on real provider usage (30 pairs, 0 provider errors)
 * measured a 4.35% mean input-token reduction (611.6 -> 585.0 tokens,
 * 95% CI [19.8, 34.0]) with non-inferior quality. That is below the predeclared
 * 10% materiality bar, so the capability is retired rather than kept or left
 * permanently default-off. See docs/dev/vtoken-retirement-decision.md.
 *
 * Retirement is unconditional: neither runtime config nor environment can
 * re-enable the production injection path.
 */
export const VTOKEN_RETIRED = true;

export function resolveVtokenAssemblyConfig(value: unknown): VtokenAssemblyConfig {
  // Retired: the injection path can no longer be enabled from config or env.
  // The kill switch is still consulted so an engaged switch is reported the
  // same way it always was.
  if (isContextEnhancementKillSwitchEngaged(value)) {
    return { ...DEFAULT_VTOKEN_ASSEMBLY_CONFIG, enabled: false };
  }

  const runtime = runtimeConfigFrom(value);
  const vtoken = isRecord(runtime?.vtoken) ? runtime.vtoken : undefined;
  const assembly = isRecord(vtoken?.assembly) ? vtoken.assembly : undefined;

  const enabled = false;
  const budgetTokens = resolvePositiveInt(
    assembly?.budgetTokens,
    DEFAULT_VTOKEN_ASSEMBLY_CONFIG.budgetTokens,
    64,
    32_000,
  );
  const renderMode = resolveRenderMode(assembly?.renderMode);
  const sessions = resolveSessions(assembly?.sessions);
  const timeoutMs = resolvePositiveInt(
    assembly?.timeoutMs,
    DEFAULT_VTOKEN_ASSEMBLY_CONFIG.timeoutMs,
    1_000,
    60_000,
  );
  const maxSourceFiles = resolvePositiveInt(
    assembly?.maxSourceFiles,
    DEFAULT_VTOKEN_ASSEMBLY_CONFIG.maxSourceFiles,
    1,
    40,
  );
  const maxSourceChars = resolvePositiveInt(
    assembly?.maxSourceChars,
    DEFAULT_VTOKEN_ASSEMBLY_CONFIG.maxSourceChars,
    1_000,
    200_000,
  );

  return {
    enabled,
    budgetTokens,
    renderMode,
    sessions,
    timeoutMs,
    maxSourceFiles,
    maxSourceChars,
  };
}

export function shouldAssembleVtokenWorkingContext(
  config: VtokenAssemblyConfig,
  sessionKey?: string,
): boolean {
  // Retired (TF-0496): no configuration can request Working Context assembly.
  if (VTOKEN_RETIRED) return false;
  if (!config.enabled) return false;
  if (config.sessions === "main-only") {
    if (!sessionKey) return false;
    if (!/^(agent|cron):[^:]+:main$/.test(sessionKey)) return false;
  }
  return true;
}

/** Bootstrap-style filenames preferred for Working Context packing. */
const PREFERRED_BOOTSTRAP_NAMES = [
  "AGENTS.md",
  "TOOLS.md",
  "MEMORY.md",
  "BOOTSTRAP.md",
  "USER.md",
  "SOUL.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
] as const;

/**
 * Load workspace bootstrap markdown as VT ingest sources.
 * Keeps md on disk as the source of truth — only reads content for packing.
 */
export async function loadWorkspaceMarkdownSources(
  workspaceDir: string,
  limits: { maxSourceFiles: number; maxSourceChars: number },
): Promise<VtokenMarkdownSource[]> {
  const sources: VtokenMarkdownSource[] = [];
  const seen = new Set<string>();

  for (const name of PREFERRED_BOOTSTRAP_NAMES) {
    if (sources.length >= limits.maxSourceFiles) break;
    const filePath = path.join(workspaceDir, name);
    if (seen.has(filePath)) continue;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const text = raw.trim();
      if (!text) continue;
      seen.add(filePath);
      sources.push({
        sourcePath: name,
        text:
          text.length > limits.maxSourceChars
            ? `${text.slice(0, limits.maxSourceChars)}\n...[truncated for vtoken ingest]`
            : text,
      });
    } catch {
      // missing file — skip
    }
  }

  return sources;
}

export function renderWorkingContextBlock(pack: VtokenRpcPackResult): string {
  const prompt = (pack.prompt ?? "").trim();
  if (!prompt) return "";
  const lines = [
    "",
    "## Working Context",
    "",
    "Task-relevant working context assembled by Verse Token from workspace sources",
    "(markdown / tools / memory outputs). Prefer this packed view under budget;",
    "source files remain authoritative on disk.",
    "",
    prompt,
    "",
    `<!-- vtoken estimated_tokens=${pack.estimatedTokens} estimate_method=${pack.estimateMethod} ` +
      `allowance=${pack.allowanceTokens} included=${pack.nodes_included?.length ?? 0} ` +
      `evicted=${pack.nodes_evicted?.length ?? 0} -->`,
  ];
  return lines.join("\n").trim();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function packCandidateId(kind: VtokenPackCandidate["kind"], value: unknown): string {
  const digest = createHash("sha256").update(stableJson(value), "utf8").digest("hex");
  return `vtoken-pack:${kind}:${digest}`;
}

/** Normalize and deduplicate the exact candidate set handed to the pure packer. */
export function createVtokenPackCandidates(input: {
  markdownSources: VtokenMarkdownSource[];
  toolSchemas?: Array<Record<string, unknown>>;
  memoryEntries?: Array<Record<string, unknown>>;
  /**
   * FP-P1-182: source paths the system prompt already renders in `# Project Context`.
   *
   * The same bootstrap files are handed to both the prompt builder and VToken, so
   * VToken re-packed their content into `## Working Context` as a compressed view of
   * text the model already had in full: zero incremental information, and the model
   * has to arbitrate between the two. Skipping them keeps VToken's real value -- the
   * sources the prompt does NOT carry.
   */
  alreadyRenderedSourcePaths?: readonly string[];
  /** Tool names the system prompt already renders in `## Tooling`. */
  alreadyRenderedToolNames?: readonly string[];
}): VtokenPackCandidate[] {
  const renderedPaths = new Set(input.alreadyRenderedSourcePaths ?? []);
  const renderedTools = new Set(input.alreadyRenderedToolNames ?? []);
  const candidates: VtokenPackCandidate[] = [
    ...input.markdownSources
      .filter((source) => !renderedPaths.has(source.sourcePath))
      .map((source) => ({
      candidateId: packCandidateId("markdown", source),
      kind: "markdown" as const,
      sourcePath: source.sourcePath,
      text: source.text,
    })),
    ...(input.toolSchemas ?? [])
      .filter((toolSchema) => {
        const name = typeof toolSchema.name === "string" ? toolSchema.name : "";
        return name === "" || !renderedTools.has(name);
      })
      .map((toolSchema) => ({
      candidateId: packCandidateId("tool_schema", { serverName: "host", toolSchema }),
      kind: "tool_schema" as const,
      serverName: "host",
      toolSchema,
    })),
    ...(input.memoryEntries ?? []).map((entry) => ({
      candidateId: packCandidateId("memory", entry),
      kind: "memory" as const,
      entry,
    })),
  ];
  return [...new Map(candidates.map((candidate) => [candidate.candidateId, candidate])).values()];
}

/**
 * Ingest host sources into VT and assemble a Working Context block.
 * Returns null when disabled, out of session scope, no sources, or empty assemble.
 */
export async function packVtokenWorkingContext(
  input: VtokenTurnAssembleInput,
  config: VtokenAssemblyConfig,
  client: VtokenRpcClient = getSharedVtokenRpcClient(),
  log?: (message: string, context?: Record<string, unknown>) => void,
): Promise<VtokenTurnPackResult | null> {
  if (!shouldAssembleVtokenWorkingContext(config, input.sessionKey)) {
    return null;
  }

  const taskHint = (input.taskHint ?? "").trim() || "general assistance";
  let markdownSources = input.markdownSources;
  if (!markdownSources?.length && input.workspaceDir) {
    markdownSources = await loadWorkspaceMarkdownSources(input.workspaceDir, {
      maxSourceFiles: config.maxSourceFiles,
      maxSourceChars: config.maxSourceChars,
    });
  }

  markdownSources = (markdownSources ?? [])
    .slice(0, config.maxSourceFiles)
    .map((source) => ({
      sourcePath: source.sourcePath,
      text:
        source.text.length > config.maxSourceChars
          ? `${source.text.slice(0, config.maxSourceChars)}\n...[truncated for vtoken ingest]`
          : source.text,
    }))
    .filter((source) => source.text.trim().length > 0);

  const hasSources =
    markdownSources.length > 0 ||
    Boolean(input.toolSchemas?.length) ||
    Boolean(input.memoryEntries?.length);
  if (!hasSources) {
    log?.("[vtoken-assembly] no sources to ingest; skipping");
    return null;
  }

  const candidates = createVtokenPackCandidates({
    markdownSources,
    toolSchemas: input.toolSchemas,
    memoryEntries: input.memoryEntries,
    ...(input.alreadyRenderedSourcePaths
      ? { alreadyRenderedSourcePaths: input.alreadyRenderedSourcePaths }
      : {}),
    ...(input.alreadyRenderedToolNames
      ? { alreadyRenderedToolNames: input.alreadyRenderedToolNames }
      : {}),
  });
  const started = Date.now();
  const pack = await client.pack({
    taskHint,
    allowanceTokens: input.allowanceTokens,
    renderMode: config.renderMode,
    candidates,
  });
  const durationMs = Date.now() - started;
  const text = renderWorkingContextBlock(pack);
  if (!text) {
    log?.("[vtoken-pack] empty pack prompt", {
      estimated_tokens: pack.estimatedTokens,
      estimate_method: pack.estimateMethod,
      durationMs,
    });
    return null;
  }

  log?.("[vtoken-pack] packed", {
    estimated_tokens: pack.estimatedTokens,
    estimate_method: pack.estimateMethod,
    allowance_tokens: pack.allowanceTokens,
    nodes_included: pack.nodes_included?.length ?? 0,
    nodes_evicted: pack.nodes_evicted?.length ?? 0,
    sourcesIngested: candidates.length,
    durationMs,
  });

  return { text, pack, durationMs, sourcesIngested: candidates.length };
}

/**
 * Gateway wiring: append VT Working Context to extraSystemPrompt when enabled.
 * Failures are suppressed so a VT outage never blocks the agent turn.
 */
export async function computeVtokenExtraSystemPrompt(
  extraSystemPrompt: string | undefined,
  cfg: unknown,
  input: VtokenTurnAssembleInput,
  log?: (message: string, context?: Record<string, unknown>) => void,
  client?: VtokenRpcClient,
): Promise<string | undefined> {
  let result = extraSystemPrompt;
  try {
    const config = resolveVtokenAssemblyConfig(cfg);
    if (!config.enabled) return result;

    const packed = await packVtokenWorkingContext(
      input,
      config,
      client ?? getSharedVtokenRpcClient({ requestTimeoutMs: config.timeoutMs }),
      log,
    );
    if (packed?.text) {
      dcsObservability.recordVtokenAssembly({
        success: true,
        chars: packed.text.length,
        estimatedTokens: packed.pack.estimatedTokens,
        sourcesIngested: packed.sourcesIngested,
      });
      result = result ? `${result}\n\n${packed.text}` : packed.text;
    }
  } catch (err) {
    dcsObservability.recordVtokenAssembly({ success: false });
    log?.("[vtoken-assembly] suppressed error; continuing without VT context", {
      err: String(err),
    });
  }
  return result;
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.runtime)) return value.runtime;
  // Already a runtime section
  if (isRecord(value.vtoken) || isRecord(value.memory) || isRecord(value.contextBlock)) {
    return value;
  }
  return value;
}

function resolvePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min || n > max) return fallback;
  return n;
}

function resolveRenderMode(value: unknown): VtokenRenderMode {
  if (value === "dense" || value === "verbose" || value === "compact") {
    return value;
  }
  return DEFAULT_VTOKEN_ASSEMBLY_CONFIG.renderMode;
}

function resolveSessions(value: unknown): "all" | "main-only" {
  if (value === "main-only" || value === "all") return value;
  return DEFAULT_VTOKEN_ASSEMBLY_CONFIG.sessions;
}
