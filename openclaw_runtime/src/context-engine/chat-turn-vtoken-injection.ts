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
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord } from "../runtime-core/index.js";
import type { BlockStoreApi, ContextBlock, SourceSystem } from "./block.js";
import { dcsObservability } from "./dcs-observability.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import {
  getSharedVtokenRpcClient,
  isVtokenAssemblyEnvEnabled,
  isVtokenAssemblyEnvForcedOn,
  resolveDefaultVtokenSessionDir,
  type VtokenRpcAssembleResult,
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
  workspaceDir?: string;
  /** Pre-loaded markdown sources; when omitted, workspace bootstrap files are read. */
  markdownSources?: VtokenMarkdownSource[];
  toolSchemas?: Array<Record<string, unknown>>;
  memoryEntries?: Array<Record<string, unknown>>;
};

export type VtokenTurnAssembleResult = {
  text: string;
  assemble: VtokenRpcAssembleResult;
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
  const enabledSources = (Object.entries(DCS_SOURCE_CONFIG_KEYS) as Array<
    [keyof typeof DCS_SOURCE_CONFIG_KEYS, string]
  >)
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
 * Resolve assembly config from runtime config + env.
 * Default enabled=false (opt-in). Enable only via explicit config true or env canary.
 * Kill-switch and enhancement kill switch always win (fail-closed).
 */
export function resolveVtokenAssemblyConfig(value: unknown): VtokenAssemblyConfig {
  if (!isVtokenAssemblyEnvEnabled()) {
    return { ...DEFAULT_VTOKEN_ASSEMBLY_CONFIG, enabled: false };
  }
  if (isContextEnhancementKillSwitchEngaged(value)) {
    return { ...DEFAULT_VTOKEN_ASSEMBLY_CONFIG, enabled: false };
  }

  const runtime = runtimeConfigFrom(value);
  const vtoken = isRecord(runtime?.vtoken) ? runtime.vtoken : undefined;
  const assembly = isRecord(vtoken?.assembly) ? vtoken.assembly : undefined;

  // Opt-in: explicit config true OR env canary force-on.
  const enabled = assembly?.enabled === true || isVtokenAssemblyEnvForcedOn();
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

export function renderWorkingContextBlock(
  assemble: VtokenRpcAssembleResult,
): string {
  const prompt = (assemble.prompt ?? "").trim();
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
    `<!-- vtoken tokens_used=${assemble.tokens_used} budget=${assemble.tokens_budget} ` +
      `included=${assemble.nodes_included?.length ?? 0} evicted=${assemble.nodes_evicted?.length ?? 0} -->`,
  ];
  return lines.join("\n").trim();
}

/**
 * Ingest host sources into VT and assemble a Working Context block.
 * Returns null when disabled, out of session scope, no sources, or empty assemble.
 */
export async function assembleVtokenWorkingContext(
  input: VtokenTurnAssembleInput,
  config: VtokenAssemblyConfig,
  client: VtokenRpcClient = getSharedVtokenRpcClient(),
  log?: (message: string, context?: Record<string, unknown>) => void,
): Promise<VtokenTurnAssembleResult | null> {
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

  return client.runExclusive(async () => {
    const started = Date.now();
    const sessionDir = resolveDefaultVtokenSessionDir();
    const session =
      input.sessionKey?.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) ||
      "default";

    await client.open({
      docSources: [],
      sessionDir,
      session,
    });

    let sourcesIngested = 0;
    for (const src of markdownSources ?? []) {
      await client.ingestMarkdown(src.text, src.sourcePath);
      sourcesIngested += 1;
    }
    if (input.toolSchemas?.length) {
      await client.ingestTools(input.toolSchemas, "host");
      sourcesIngested += 1;
    }
    if (input.memoryEntries?.length) {
      await client.ingestMemory(input.memoryEntries);
      sourcesIngested += 1;
    }

    const assemble = await client.assemble({
      taskHint,
      budgetTokens: config.budgetTokens,
      renderMode: config.renderMode,
    });
    const durationMs = Date.now() - started;
    const text = renderWorkingContextBlock(assemble);
    if (!text) {
      log?.("[vtoken-assembly] empty assemble prompt", {
        tokens_used: assemble.tokens_used,
        durationMs,
      });
      return null;
    }

    log?.("[vtoken-assembly] assembled", {
      tokens_used: assemble.tokens_used,
      tokens_budget: assemble.tokens_budget,
      nodes_included: assemble.nodes_included?.length ?? 0,
      nodes_evicted: assemble.nodes_evicted?.length ?? 0,
      sourcesIngested,
      durationMs,
    });

    return { text, assemble, durationMs, sourcesIngested };
  });
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

    const assembled = await assembleVtokenWorkingContext(
      input,
      config,
      client ?? getSharedVtokenRpcClient({ requestTimeoutMs: config.timeoutMs }),
      log,
    );
    if (assembled?.text) {
      dcsObservability.recordVtokenAssembly({
        success: true,
        chars: assembled.text.length,
        tokens: assembled.assemble.tokens_used,
        sourcesIngested: assembled.sourcesIngested,
      });
      result = result ? `${result}\n\n${assembled.text}` : assembled.text;
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
  if (
    isRecord(value.vtoken) ||
    isRecord(value.memory) ||
    isRecord(value.contextBlock)
  ) {
    return value;
  }
  return value;
}

function resolvePositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
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
