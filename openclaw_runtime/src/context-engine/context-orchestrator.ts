/**
 * Context Orchestrator — single production entry for memory/context enhancement.
 *
 * TF-0002: unifies chat-turn memory inject (role/runtime memory) and Verse Token
 * Working Context assembly behind one fail-closed API. Production paths must
 * call {@link computeContextExtraSystemPrompt} only; low-level injectors remain
 * internal implementation details.
 *
 * Composition order (stable):
 *   base extraSystemPrompt
 *     → memory inject pilot (## Memory Context) when enabled
 *     → VToken assembly (## Working Context) when enabled
 *     → caller may still append unrelated system sections (e.g. Runtime Intensity)
 *
 * Flag off / kill switch: zero injection, zero side effects on the turn
 * (best-effort; errors never abort the agent turn).
 */
import { isRecord } from "../runtime-core/index.js";
import type { RuntimeContextProvider } from "../runtime-core/index.js";
import { computeMemoryExtraSystemPrompt } from "./chat-turn-memory-injection.js";
import {
  computeVtokenExtraSystemPrompt,
  type VtokenMarkdownSource,
} from "./chat-turn-vtoken-injection.js";
import type { VtokenRpcClient } from "./vtoken-rpc-client.js";
import { dcsObservability } from "./dcs-observability.js";
import {
  isContextEnhancementKillSwitchEngaged,
} from "./enhancement-kill-switch.js";
import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  skipTurnInjection,
  type TurnInjectionChannel,
  type TurnInjectionLedger,
} from "./turn-injection-budget.js";

export type ContextOrchestratorStage = "memory" | "vtoken";

export type ContextOrchestratorSource = {
  id: string;
  stage: ContextOrchestratorStage;
  enabled: boolean;
  applied: boolean;
  chars: number;
  tokens?: number;
  reason?: string;
};

export type ContextOrchestratorLineage = {
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  requestId?: string;
  workspaceDir?: string;
  killSwitchEngaged: boolean;
  stagesRequested: ContextOrchestratorStage[];
  sources: ContextOrchestratorSource[];
  budget: {
    memoryTokenBudget?: number;
    vtokenBudgetTokens?: number;
  };
  totalCharsAdded: number;
  durationMs: number;
  error?: string;
};

export type ContextOrchestratorInput = {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  requestId?: string;
  workspaceDir?: string;
  /** Task / user prompt hint for VToken assemble. */
  taskHint?: string;
  markdownSources?: VtokenMarkdownSource[];
  toolSchemas?: Array<Record<string, unknown>>;
  memoryEntries?: Array<Record<string, unknown>>;
  /**
   * Lazy memory provider factory. Only invoked when the memory stage is
   * requested and the inject pilot flag is enabled.
   */
  memoryProviderFactory?: () => readonly RuntimeContextProvider[];
  /** Optional VT RPC client (tests / shared worker). */
  vtokenClient?: VtokenRpcClient;
  /**
   * FP-P0-05: turn identifier. When supplied, memory-pilot and VToken charge the
   * turn-wide shared injection budget (the same ledger the DCS Assembler and the
   * CVK addition charge) instead of growing the prompt off the books.
   */
  turnId?: string;
};

export type ContextOrchestratorOptions = {
  /** Default: both stages. */
  stages?: ContextOrchestratorStage[];
  log?: (message: string, context?: Record<string, unknown>) => void;
};

export type ContextOrchestratorResult = {
  extraSystemPrompt: string | undefined;
  lineage: ContextOrchestratorLineage;
};

const DEFAULT_STAGES: ContextOrchestratorStage[] = ["memory", "vtoken"];

let lastLineage: ContextOrchestratorLineage | null = null;

export function getLastContextOrchestratorLineage(): ContextOrchestratorLineage | null {
  return lastLineage ? structuredClone(lastLineage) : null;
}

export function resetContextOrchestratorLineageForTests(): void {
  lastLineage = null;
}

function resolveStages(
  stages: ContextOrchestratorStage[] | undefined,
): ContextOrchestratorStage[] {
  if (!stages || stages.length === 0) return [...DEFAULT_STAGES];
  const out: ContextOrchestratorStage[] = [];
  for (const stage of stages) {
    if ((stage === "memory" || stage === "vtoken") && !out.includes(stage)) {
      out.push(stage);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_STAGES];
}

function resolveMemoryBudget(cfg: unknown): number | undefined {
  try {
    const runtime = isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
    const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
    const injectPilot = isRecord(memory?.injectPilot) ? memory.injectPilot : undefined;
    const budget = injectPilot?.totalTokenBudget;
    return typeof budget === "number" && Number.isFinite(budget) ? budget : undefined;
  } catch {
    return undefined;
  }
}

function resolveVtokenBudget(cfg: unknown): number | undefined {
  try {
    const runtime = isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
    const vtoken = isRecord(runtime?.vtoken) ? runtime.vtoken : undefined;
    const assembly = isRecord(vtoken?.assembly) ? vtoken.assembly : undefined;
    const budget = assembly?.budgetTokens;
    return typeof budget === "number" && Number.isFinite(budget) ? budget : undefined;
  } catch {
    return undefined;
  }
}

function isMemoryPilotEnabled(cfg: unknown): boolean {
  try {
    const runtime = isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
    const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
    const injectPilot = isRecord(memory?.injectPilot) ? memory.injectPilot : undefined;
    return injectPilot?.enabled === true;
  } catch {
    return false;
  }
}

function isVtokenAssemblyEnabled(cfg: unknown): boolean {
  try {
    // Delegate to the same resolve path VToken uses: only explicit true / env canary.
    const runtime = isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
    const vtoken = isRecord(runtime?.vtoken) ? runtime.vtoken : undefined;
    const assembly = isRecord(vtoken?.assembly) ? vtoken.assembly : undefined;
    if (assembly?.enabled === true) return true;
    const env = (process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED ?? "").trim().toLowerCase();
    if (env === "0" || env === "false" || env === "no" || env === "off") return false;
    if (env === "1" || env === "true" || env === "yes" || env === "on") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Single production entry: compose memory + VToken enhancements onto extraSystemPrompt.
 * Never throws into the agent turn.
 */
/**
 * FP-P0-05: charge the segment a stage just appended against the turn ledger.
 *
 * The injectors grow `extraSystemPrompt` by appending, so the segment is the tail
 * past `beforeLen`. Charging it may truncate or drop it; the granted text is spliced
 * back so the prompt and the ledger cannot disagree. With no ledger the text is
 * returned untouched (pre-FP-P0-05 behavior).
 */
function chargeAppendedSegment(
  ledger: TurnInjectionLedger | undefined,
  channel: TurnInjectionChannel,
  text: string | undefined,
  beforeLen: number,
): { text: string | undefined; charsApplied: number; reason?: string } {
  const grown = (text?.length ?? 0) - beforeLen;
  if (!text || grown <= 0) {
    if (ledger) skipTurnInjection(ledger, channel);
    return { text, charsApplied: 0 };
  }
  if (!ledger) {
    return { text, charsApplied: grown };
  }
  const head = text.slice(0, beforeLen);
  const segment = text.slice(beforeLen);
  const charged = chargeTurnInjection(ledger, channel, segment);
  if (!charged.text) {
    return {
      text: head.length > 0 ? head : undefined,
      charsApplied: 0,
      reason: "budget-drop",
    };
  }
  return {
    text: `${head}${charged.text}`,
    charsApplied: charged.charsApplied,
    ...(charged.truncated ? { reason: "budget-truncate" } : {}),
  };
}

export async function computeContextExtraSystemPrompt(
  extraSystemPrompt: string | undefined,
  cfg: unknown,
  input: ContextOrchestratorInput = {},
  options: ContextOrchestratorOptions = {},
): Promise<ContextOrchestratorResult> {
  const started = Date.now();
  const stagesRequested = resolveStages(options.stages);
  const log = options.log;
  const lineage: ContextOrchestratorLineage = {
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    runId: input.runId,
    requestId: input.requestId,
    workspaceDir: input.workspaceDir,
    killSwitchEngaged: false,
    stagesRequested,
    sources: [],
    budget: {
      memoryTokenBudget: resolveMemoryBudget(cfg),
      vtokenBudgetTokens: resolveVtokenBudget(cfg),
    },
    totalCharsAdded: 0,
    durationMs: 0,
  };

  let result = extraSystemPrompt;
  const baseLen = result?.length ?? 0;
  // FP-P0-05: join the turn-wide ledger when the caller identified the turn.
  // Without a turnId the stages behave exactly as before (unbudgeted), so this
  // never changes behavior for callers that have not been wired yet.
  const turnLedger = input.turnId
    ? beginTurnInjectionBudget({
        turnId: input.turnId,
        killed: isContextEnhancementKillSwitchEngaged(cfg),
      })
    : undefined;

  try {
    if (isContextEnhancementKillSwitchEngaged(cfg)) {
      lineage.killSwitchEngaged = true;
      for (const stage of stagesRequested) {
        lineage.sources.push({
          id: stage === "memory" ? "memory-inject-pilot" : "vtoken-assembly",
          stage,
          enabled: false,
          applied: false,
          chars: 0,
          reason: "enhancement-kill-switch",
        });
      }
      dcsObservability.recordContextOrchestrator({
        killSwitch: true,
        stages: stagesRequested.length,
        charsAdded: 0,
      });
      lineage.durationMs = Date.now() - started;
      lastLineage = lineage;
      return { extraSystemPrompt: result, lineage };
    }

    if (stagesRequested.includes("memory")) {
      const enabled = isMemoryPilotEnabled(cfg);
      const before = result?.length ?? 0;
      if (!enabled) {
        lineage.sources.push({
          id: "memory-inject-pilot",
          stage: "memory",
          enabled: false,
          applied: false,
          chars: 0,
          reason: "flag-off",
        });
      } else if (!input.memoryProviderFactory) {
        lineage.sources.push({
          id: "memory-inject-pilot",
          stage: "memory",
          enabled: true,
          applied: false,
          chars: 0,
          reason: "no-provider-factory",
        });
      } else {
        result = await computeMemoryExtraSystemPrompt(
          result,
          cfg,
          input.sessionKey,
          input.memoryProviderFactory,
          log,
        );
        // FP-P0-05: charge the appended segment against the turn-wide budget and
        // keep only what the budget granted, so the ledger matches the prompt.
        const charged = chargeAppendedSegment(turnLedger, "memory_pilot", result, before);
        result = charged.text;
        const chars = charged.charsApplied;
        lineage.sources.push({
          id: "memory-inject-pilot",
          stage: "memory",
          enabled: true,
          applied: chars > 0,
          chars,
          tokens: lineage.budget.memoryTokenBudget,
          reason: charged.reason ?? (chars > 0 ? "applied" : "no-items"),
        });
      }
    }

    if (stagesRequested.includes("vtoken")) {
      const enabled = isVtokenAssemblyEnabled(cfg);
      const before = result?.length ?? 0;
      if (!enabled) {
        lineage.sources.push({
          id: "vtoken-assembly",
          stage: "vtoken",
          enabled: false,
          applied: false,
          chars: 0,
          reason: "flag-off",
        });
      } else {
        result = await computeVtokenExtraSystemPrompt(
          result,
          cfg,
          {
            sessionKey: input.sessionKey,
            taskHint: input.taskHint ?? "",
            workspaceDir: input.workspaceDir,
            markdownSources: input.markdownSources,
            toolSchemas: input.toolSchemas,
            memoryEntries: input.memoryEntries,
          },
          log,
          input.vtokenClient,
        );
        // FP-P0-05: same shared-budget charge for the VToken segment. VToken's own
        // `budgetTokens` governs internal packing; this governs prompt growth.
        const charged = chargeAppendedSegment(turnLedger, "vtoken", result, before);
        result = charged.text;
        const chars = charged.charsApplied;
        lineage.sources.push({
          id: "vtoken-assembly",
          stage: "vtoken",
          enabled: true,
          applied: chars > 0,
          chars,
          tokens: lineage.budget.vtokenBudgetTokens,
          reason: charged.reason ?? (chars > 0 ? "applied" : "empty-or-skipped"),
        });
      }
    }

    lineage.totalCharsAdded = Math.max(0, (result?.length ?? 0) - baseLen);
    dcsObservability.recordContextOrchestrator({
      killSwitch: false,
      stages: stagesRequested.length,
      charsAdded: lineage.totalCharsAdded,
    });
  } catch (err) {
    lineage.error = String(err);
    log?.("[context-orchestrator] suppressed error; continuing without enhancement", {
      err: String(err),
    });
    dcsObservability.recordContextOrchestrator({
      killSwitch: false,
      stages: stagesRequested.length,
      charsAdded: 0,
      error: true,
    });
    // Fail-closed: return original prompt on unexpected errors.
    result = extraSystemPrompt;
    lineage.totalCharsAdded = 0;
  }

  lineage.durationMs = Date.now() - started;
  lastLineage = lineage;
  return { extraSystemPrompt: result, lineage };
}
