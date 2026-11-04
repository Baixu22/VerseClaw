import {
  collectCompassContext,
  recordCompassProjection,
  type PreparedCompassContext,
} from "./compass-context.js";
/**
 * Context Orchestrator — single production entry for memory/context enhancement.
 *
 * TF-0002/UAS-02: unifies Memory, Verse Token, DCS context-block, and CVK prompt
 * additions behind one fail-closed arbitration authority. Production sources
 * emit ContextCandidate/v1; this module owns final ordering, deduplication,
 * budgeting, projection, and lineage.
 *
 * Candidate precedence (stable):
 *   knowledge → working memory → tool registry → CVK → VToken → Memory pilot
 *
 * Flag off / kill switch: zero injection, zero side effects on the turn
 * (best-effort; errors never abort the agent turn).
 */
import { isRecord } from "../runtime-core/index.js";
import type { RuntimeContextProvider } from "../runtime-core/index.js";
import type { AgentMessage } from "../agents/runtime/index.js";
import { computeMemoryExtraSystemPrompt } from "./chat-turn-memory-injection.js";
import {
  computeVtokenExtraSystemPrompt,
  resolveVtokenAssemblyConfig,
  type VtokenMarkdownSource,
} from "./chat-turn-vtoken-injection.js";
import type { VtokenRpcClient } from "./vtoken-rpc-client.js";
import { dcsObservability } from "./dcs-observability.js";
import {
  beginContextCandidateCollection,
  collectContextCandidate,
  createContextCandidate,
  endContextCandidateCollection,
  getContextCandidateCollection,
  projectContextCandidates,
  recordContextCandidateSkip,
  type ContextCandidate,
  type ContextCandidateCollection,
  type ContextCandidateDiagnostics,
  type ContextCandidateLineage,
  type ContextCandidateProjection,
  type ContextCandidateTarget,
} from "./context-candidate.js";
import { recordContextFinalSnapshot } from "./context-final-snapshot.js";
import type { PromptContributionAdmission } from "./prompt-contribution-authority.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import { applySessionStartInjection } from "./session-start-injection.js";
import {
  appendDiscardAttributionRecords,
  buildCandidateDiscardRecords,
} from "./discard-attribution.js";
import type {
  SessionStartInjectionPlan,
  SessionStartInjectionRequest,
} from "../../../shared/types/session-start-injection.js";
import {
  runRc03SealHook,
  resolveCurrentRc03SealState,
  recordRc03SystemPromptContribution,
  clearRc03SealPlan,
  type Rc03SealHookResult,
} from "./rc03-seal-hook.js";
import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  endTurnInjectionBudget,
  observeTurnSystemPromptBase,
  recordManagedSystemChars,
  recordPostOrchestratorChange,
  recordPostOrchestratorContribution,
  reserveTurnInjectionCapacity,
  skipTurnInjection,
  summarizeTurnInjection,
  type TurnInjectionChannel,
  type TurnInjectionLedger,
} from "./turn-injection-budget.js";
import { KNOWLEDGE_INJECTION_CHAR_BUDGET } from "./assembler.js";

/**
 * FP-P2-06. The three DCS projections are charged across several phases of one
 * turn — `knowledge` and `tool_registry` during assembly, and `working_memory`
 * again after every tool result — while the lower-precedence `cvk_addition`
 * charges once, in the final candidate projection. Without a hold, that single
 * CVK charge consumes the whole remaining budget and the later, higher-precedence
 * `working_memory` charges are dropped, which inverts the frozen channel
 * ownership declared by `TURN_INJECTION_PRECEDENCE`.
 *
 * `harness/specs/tasks/remote-forge-controlled-preview.md:204`: "A DCS-enabled
 * attempt reserves the existing 2000-character DCS capacity in the same ledger
 * before CVK is charged so earlier execution timing cannot invert the frozen
 * channel ownership." That capacity is `KNOWLEDGE_INJECTION_CHAR_BUDGET`.
 *
 * The hold covers all three channels, not only the ones that have charged so
 * far. Reserving just the observed ones is wrong: `working_memory` has not
 * charged yet at this point, and `capacityReservedForHigherPrecedence` would
 * then deduct the hold from working_memory's own limit (knowledge sits earlier
 * in the precedence table), starving the channel the hold exists to protect.
 */
const DCS_PROJECTION_CHANNELS: readonly TurnInjectionChannel[] = [
  "knowledge",
  "working_memory",
  "tool_registry",
];

export type ContextOrchestratorStage = "memory" | "vtoken";

/** P5 additive native-model capability declarations. */
export type NativeContextCapabilities = {
  nativeMemory?: boolean;
  nativeContextGating?: boolean;
};

export type NativeContextNegotiation = {
  nativeMemory: boolean;
  nativeContextGating: boolean;
  memoryPilotDisabled: boolean;
  vtokenDisabled: boolean;
};

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
  unbudgeted: boolean;
  turnId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  requestId?: string;
  workspaceDir?: string;
  killSwitchEngaged: boolean;
  stagesRequested: ContextOrchestratorStage[];
  sources: ContextOrchestratorSource[];
  candidates?: ContextCandidateLineage[];
  candidateDiagnostics?: ContextCandidateDiagnostics;
  budget: {
    memoryTokenBudget?: number;
    vtokenBudgetTokens?: number;
  };
  totalCharsAdded: number;
  durationMs: number;
  error?: string;
  /** Present only when a native capability declaration was received. */
  nativeContext?: NativeContextNegotiation;
  /**
   * A2b: the start-of-session plan this turn was decided on, with per-source
   * requested/applied/dropped and reasons. Absent when no request was made.
   */
  sessionStart?: SessionStartInjectionPlan;
  /** A2b: why the session_start channel produced nothing (absent = it applied). */
  sessionStartSkipReason?: "flag-off" | "kill-switch" | "empty";
};

export type ContextOrchestratorInput = {
  compassContext?: PreparedCompassContext;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  /** Stable logical task scope for memory retrieval; never infer it from runId. */
  taskId?: string;
  requestId?: string;
  workspaceDir?: string;
  /** Task / user prompt hint for VToken assemble. */
  taskHint?: string;
  /**
   * #183: the caller's persona-derived role name for role-memory lookup. Omit
   * when the agent has no persona role; the provider resolver then applies its
   * documented "main" fallback (the orchestrator never invents one).
   */
  roleName?: string;
  markdownSources?: VtokenMarkdownSource[];
  toolSchemas?: Array<Record<string, unknown>>;
  memoryEntries?: Array<Record<string, unknown>>;
  /** FP-P1-182: paths the system prompt already renders in full. */
  alreadyRenderedSourcePaths?: readonly string[];
  /** FP-P1-182: tool names the system prompt already renders in `## Tooling`. */
  alreadyRenderedToolNames?: readonly string[];
  /** Lazy VToken memory projection; invoked only after flag and kill-switch gates pass. */
  memoryEntriesFactory?: () => Promise<Array<Record<string, unknown>>>;
  /**
   * Lazy memory provider factory. Only invoked when the memory stage is
   * requested and the inject pilot flag is enabled.
   */
  memoryProviderFactory?: () => readonly RuntimeContextProvider[];
  /** Provider ids selected for the memory pilot, used to keep lineage/receipts honest. */
  memoryProviderIds?: readonly string[];
  /** Optional VT RPC client (tests / shared worker). */
  vtokenClient?: VtokenRpcClient;
  /**
   * P5 additive model capability declaration. Absent declarations leave the
   * existing memory/vtoken flag decisions byte-for-byte unchanged.
   */
  nativeContextCapabilities?: NativeContextCapabilities;
  /**
   * FP-P0-05: turn identifier. When supplied, memory-pilot and VToken charge the
   * turn-wide shared injection budget (the same ledger the DCS Assembler and the
   * CVK addition charge) instead of growing the prompt off the books.
   */
  turnId?: string;
  /**
   * UAS-02 production mode: collect source output as ContextCandidate/v1 and
   * leave final ordering, deduplication, budgeting, and projection to the
   * provider-boundary Orchestrator pass.
   */
  deferProjection?: boolean;
  /**
   * A2b: start-of-session context to route through the candidate protocol.
   * Honoured only in the deferred (candidate) mode, where the turn ledger and
   * the orchestrator projection exist; other callers keep their exact behaviour.
   */
  sessionStart?: SessionStartInjectionRequest;
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

/** Compose the real post-orchestrator component without spending or widening the managed limit. */
export function composePostOrchestratorPrompt(params: {
  turnId?: string;
  basePrompt?: string;
  additions: readonly { sourceId: string; text?: string }[];
  applied?: boolean;
}): { prompt: string; unbudgeted: boolean; postOrchestratorChars: number } {
  const included = (text: string | undefined): text is string => typeof text === "string" && text.trim().length > 0;
  let prompt = included(params.basePrompt) ? params.basePrompt : "";
  let postOrchestratorChars = 0;
  const ledger = params.turnId ? beginTurnInjectionBudget({ turnId: params.turnId }) : undefined;
  for (const { sourceId, text } of params.additions) {
    const written = included(text) ? (prompt ? `\n\n${text}` : text) : "";
    prompt += written;
    postOrchestratorChars += written.length;
    if (ledger) recordPostOrchestratorContribution(ledger, sourceId, params.applied === false ? 0 : written.length);
  }
  return { prompt, unbudgeted: !params.turnId,
    postOrchestratorChars: params.applied === false ? 0 : postOrchestratorChars };
}

/** Same setter used by the embedded runner, with accounting after successful application. */
export function createTrackedSystemPromptSetter(params: {
  turnId: string;
  basePrompt: string;
  apply: (prompt: string) => void;
}): (prompt: string) => void {
  const ledger = beginTurnInjectionBudget({ turnId: params.turnId });
  let current = params.basePrompt;
  observeTurnSystemPromptBase(ledger, current);
  return next => {
    params.apply(next);
    recordPostOrchestratorChange(ledger, current, next, "system_prompt");
    current = next;
  };
}

export function recordPostOrchestratorMessageChange(turnId: string, before: string, after: string): void {
  recordPostOrchestratorChange(beginTurnInjectionBudget({ turnId }), before, after, "message");
}

function resolveMemoryLineageSourceId(providerIds: readonly string[] | undefined): string {
  const ids = [...new Set((providerIds ?? []).map((id) => id.trim()).filter(Boolean))].toSorted();
  return ids.length > 0 ? `memory-inject-pilot:${ids.join("+")}` : "memory-inject-pilot";
}

const DEFAULT_STAGES: ContextOrchestratorStage[] = ["memory", "vtoken"];

let lastLineage: ContextOrchestratorLineage | null = null;
const lineageByTurn = new Map<string, ContextOrchestratorLineage>();
const nativeNegotiationByTurn = new Map<string, NativeContextNegotiation>();

function rememberLineage(lineage: ContextOrchestratorLineage): void {
  lastLineage = lineage;
  if (lineage.turnId) lineageByTurn.set(lineage.turnId, lineage);
}

function rememberNativeNegotiation(
  turnId: string | undefined,
  negotiation: NativeContextNegotiation,
): void {
  if (turnId) nativeNegotiationByTurn.set(turnId, negotiation);
}

function gateBlockStoreInjectionForNativeContext(turnId: string): void {
  const negotiation = nativeNegotiationByTurn.get(turnId);
  if (!negotiation?.nativeContextGating) return;
  const collection = getContextCandidateCollection(turnId);
  if (!collection || collection.diagnostics.finalized) return;
  const blockedChannels = new Set<TurnInjectionChannel>([
    "knowledge",
    "working_memory",
    "tool_registry",
  ]);
  const keptCandidates: typeof collection.candidates = [];
  const keptLineageIndexes: typeof collection.candidateLineageIndexes = [];
  for (let index = 0; index < collection.candidates.length; index += 1) {
    const candidate = collection.candidates[index];
    if (candidate && blockedChannels.has(candidate.channel)) {
      const lineage = collection.lineage[collection.candidateLineageIndexes[index] ?? -1];
      if (lineage) {
        lineage.disposition = "skip";
        lineage.charsRequested = 0;
        lineage.charsApplied = 0;
        lineage.reason = "flag-off";
        lineage.novelty = undefined;
      }
      continue;
    }
    keptCandidates.push(candidate);
    keptLineageIndexes.push(collection.candidateLineageIndexes[index] ?? -1);
  }
  collection.candidates = keptCandidates;
  collection.candidateLineageIndexes = keptLineageIndexes;
}

export function getLastContextOrchestratorLineage(): ContextOrchestratorLineage | null {
  return lastLineage ? structuredClone(lastLineage) : null;
}

export function resetContextOrchestratorLineageForTests(): void {
  lastLineage = null;
  lineageByTurn.clear();
  nativeNegotiationByTurn.clear();
}

export type ContextOrchestratorCandidateInput = Omit<
  ContextCandidate,
  "schema" | "candidateId" | "dedupKey" | "authority"
> & {
  authorityObjectId: string;
  authorityVersion: string;
};

export function collectContextOrchestratorCandidate(
  turnId: string,
  input: ContextOrchestratorCandidateInput,
  admission?: PromptContributionAdmission,
): ContextCandidateLineage {
  return collectContextCandidate(turnId, createContextCandidate(input), admission);
}

export function recordContextOrchestratorSourceDecision(
  turnId: string,
  input: {
    sourceId: string;
    channel: TurnInjectionChannel;
    target: ContextCandidateTarget;
    reason: "empty" | "flag-off" | "kill-switch" | "skip-channel";
  },
): ContextCandidateLineage {
  return recordContextCandidateSkip(turnId, input);
}

export function getContextOrchestratorCollection(
  turnId: string,
): ContextCandidateCollection | undefined {
  return getContextCandidateCollection(turnId);
}

export function finalizeContextOrchestratorTurn(params: {
  turnId: string;
  messages: AgentMessage[];
  sessionKey?: string;
  runId?: string;
  providerId?: string;
  /** Real source-runtime config used to resolve the RC-03 seal switch when
   *  rc03Seal.enabled is not explicitly given (default-off + kill switch). */
  cfg?: unknown;
  /**
   * F-01: per-model-call identity. The same attempt can seal several immutable
   * ContextBundles (one per model call); the runner increments modelCallIndex
   * at each model-call boundary so receipts and WireReceipts correlate exactly.
   */
  attemptIndex?: number;
  modelCallIndex?: number;
  /** RC-03: the full provider-bound system prompt this model call sends. */
  systemPrompt?: string;
  /**
   * F-01: seal only when a real model-call projection exists. The
   * before_agent_start pass finalizes for the system prompt but its empty
   * message list is never sent; sealing it would mint a bundle/receipt that
   * never reached the provider. Defaults to true.
   */
  seal?: boolean;
  rc03Seal?: {
    enabled?: boolean;
    database?: { env?: NodeJS.ProcessEnv; path?: string };
  };
  /**
   * T-B6 (TF-0126): dedupKeys injected by earlier model calls of this
   * attempt, forwarded to candidate finalization so re-collected
   * working_memory content that did not change deduplicates instead of
   * re-injecting. Undefined keeps legacy behavior.
   */
  priorDedupKeys?: ReadonlySet<string>;
  /**
   * FP-P2-06: true when the attempt has at least one DCS context-block
   * projection enabled. The DCS capacity is then held in the ledger before any
   * lower-precedence charge can consume it. Undefined/false keeps the
   * pre-existing budget behaviour byte for byte, so callers that are not a
   * DCS-enabled attempt (and unit tests that project candidates directly) are
   * unaffected.
   */
  dcsProjectionEnabled?: boolean;
}): {
  messages: AgentMessage[];
  projection: ContextCandidateProjection;
} {
  const wasFinalized = getContextCandidateCollection(params.turnId)?.diagnostics.finalized === true;
  gateBlockStoreInjectionForNativeContext(params.turnId);
  const ledger = beginTurnInjectionBudget({ turnId: params.turnId });
  if (params.dcsProjectionEnabled === true) {
    reserveTurnInjectionCapacity(ledger, DCS_PROJECTION_CHANNELS, KNOWLEDGE_INJECTION_CHAR_BUDGET);
  }
  const projected = projectContextCandidates({
    turnId: params.turnId,
    ledger,
    messages: params.messages,
    priorDedupKeys: params.priorDedupKeys,
  });
  const managedSystemChars = projected.projection.lineage
    .filter(entry => entry.target === "system_prompt")
    .reduce((sum, entry) => sum + entry.charsApplied, 0);
  if (!wasFinalized) recordManagedSystemChars(ledger, managedSystemChars);
  const systemAddition = projected.projection.systemPromptAddition;
  if (systemAddition) {
    const joiningChars = systemAddition.length - managedSystemChars +
      (params.systemPrompt?.endsWith(`\n\n${systemAddition}`) ? 2 : 0);
    recordPostOrchestratorContribution(ledger,
      `projection-joining:${params.attemptIndex ?? 0}:${params.modelCallIndex ?? 0}`, joiningChars);
  }
  // The first projection precedes the model-call seal. Register the charged
  // text, so a later reopened collection still attributes the actual prompt.
  for (const contribution of projected.projection.systemPromptContributions ?? []) {
    if (contribution.sourceId === "compass-ssp" || contribution.sourceId === "compass-retrieval") {
      recordRc03SystemPromptContribution(contribution.sourceId, contribution.text, params.cfg);
    }
  }
  // RC-03 production wiring: at the pre-seal semantic producer convergence
  // point, run the seal hook when the RC-03 flag is on (explicit override or
  // resolved from the real source-runtime config). It enforces that all
  // DCS semantic producers are registered (zero-bypass), seals the immutable
  // ContextBundle, and persists a ContextReceipt/v1. When off, this is a no-op
  // and the legacy path is byte-identical.
  const rc03State = resolveCurrentRc03SealState(params.cfg);
  const rc03Enabled =
    params.seal !== false &&
    !rc03State.killed &&
    (params.rc03Seal?.enabled === true || rc03State.enabled);
  let sealResult: Rc03SealHookResult | undefined;
  if (rc03Enabled) {
    sealResult = runRc03SealHook(projected.projection, projected.messages, {
      enabled: true,
      killed: rc03State.killed,
      sessionKey: params.sessionKey,
      runId: params.runId,
      providerId: params.providerId,
      attemptIndex: params.attemptIndex,
      modelCallIndex: params.modelCallIndex,
      systemPrompt: params.systemPrompt,
      database: params.rc03Seal?.database,
    });
  } else if (params.seal !== false) {
    clearRc03SealPlan(params.runId);
  }
  if (params.seal !== false) {
    const providerSystemPrompt = params.systemPrompt ?? projected.projection.systemPromptAddition;
    recordContextFinalSnapshot({
      turnId: params.turnId,
      sessionKey: params.sessionKey,
      runId: params.runId,
      providerId: params.providerId,
      attemptIndex: params.attemptIndex,
      modelCallIndex: params.modelCallIndex,
      systemPrompt: providerSystemPrompt,
      messages: projected.messages,
      projection: projected.projection,
      budget: summarizeTurnInjection(ledger),
      rc03PlanId: sealResult?.plan?.planId,
      bundleDigest: sealResult?.bundleDigest,
    });
  }
  const collection = getContextCandidateCollection(params.turnId);
  const turnLineage = lineageByTurn.get(params.turnId);
  if (collection && !wasFinalized) recordCompassProjection(collection, projected.projection);
  if (turnLineage && collection) {
    turnLineage.candidates = collection.lineage;
    turnLineage.candidateDiagnostics = collection.diagnostics;
    turnLineage.totalCharsAdded = collection.diagnostics.charsApplied;
    for (const source of turnLineage.sources) {
      const entries = collection.lineage.filter((entry) => entry.sourceId === source.id);
      if (entries.length === 0) continue;
      source.chars = entries.reduce((total, entry) => total + entry.charsApplied, 0);
      source.applied = source.chars > 0;
      source.reason =
        entries.find((entry) => entry.charsApplied > 0)?.reason ??
        entries.at(-1)?.reason ??
        source.reason;
    }
    if (!wasFinalized) {
      dcsObservability.recordContextOrchestrator({
        killSwitch: turnLineage.killSwitchEngaged,
        stages: turnLineage.stagesRequested.length,
        charsAdded: turnLineage.totalCharsAdded,
        ...(turnLineage.error ? { error: true } : {}),
      });
    }
    lastLineage = turnLineage;
  }
  // TF-0644: the candidate table dies with the attempt, so write the rows that
  // carry the turn identity before this collection is replaced or ended. This is
  // attribution only: every decision above already happened.
  if (!wasFinalized) {
    appendDiscardAttributionRecords({
      records: buildCandidateDiscardRecords({
        lineage: projected.projection.lineage,
        identity: {
          turnId: params.turnId,
          ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
          ...(turnLineage?.sessionId ? { sessionId: turnLineage.sessionId } : {}),
          ...(params.attemptIndex !== undefined ? { attemptIndex: params.attemptIndex } : {}),
          ...(params.modelCallIndex !== undefined ? { modelCallIndex: params.modelCallIndex } : {}),
        },
        at: new Date().toISOString(),
      }),
    });
  }

  return { messages: projected.messages, projection: projected.projection };
}

export function endContextOrchestratorTurn(turnId: string): ContextCandidateCollection | undefined {
  lineageByTurn.delete(turnId);
  nativeNegotiationByTurn.delete(turnId);
  return endContextCandidateCollection(turnId);
}

/** CLI and native harnesses lack embedded assembly hooks; use the same candidate owner. */
export function projectStandaloneCompassContext(params: {
  turnId: string;
  context?: PreparedCompassContext;
  cfg?: unknown;
}): string | undefined {
  if (!params.context) return undefined;
  beginTurnInjectionBudget({
    turnId: params.turnId,
    killed: isContextEnhancementKillSwitchEngaged(params.cfg),
  });
  try {
    collectCompassContext(params.turnId, params.context, params.cfg);
    return finalizeContextOrchestratorTurn({
      turnId: params.turnId,
      messages: [],
      seal: false,
    }).projection.systemPromptAddition;
  } finally {
    endContextOrchestratorTurn(params.turnId);
    endTurnInjectionBudget(params.turnId);
  }
}

function resolveStages(stages: ContextOrchestratorStage[] | undefined): ContextOrchestratorStage[] {
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
    const runtime =
      isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
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
    const runtime =
      isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
    const vtoken = isRecord(runtime?.vtoken) ? runtime.vtoken : undefined;
    const assembly = isRecord(vtoken?.assembly) ? vtoken.assembly : undefined;
    const budget = assembly?.budgetTokens;
    return typeof budget === "number" && Number.isFinite(budget) ? budget : undefined;
  } catch {
    return undefined;
  }
}

function capabilityFromConfig(cfg: unknown): NativeContextCapabilities | undefined {
  try {
    if (!isRecord(cfg)) return undefined;
    const runtime = isRecord(cfg.runtime) ? cfg.runtime : undefined;
    const candidates = [
      cfg.capabilities,
      runtime?.capabilities,
      isRecord(runtime?.model) ? runtime.model.capabilities : undefined,
      cfg.model && isRecord(cfg.model) ? cfg.model.capabilities : undefined,
      cfg.models && isRecord(cfg.models) ? cfg.models.capabilities : undefined,
    ];
    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      if (
        typeof candidate.nativeMemory !== "boolean" &&
        typeof candidate.nativeContextGating !== "boolean"
      ) {
        continue;
      }
      return {
        ...(typeof candidate.nativeMemory === "boolean"
          ? { nativeMemory: candidate.nativeMemory }
          : {}),
        ...(typeof candidate.nativeContextGating === "boolean"
          ? { nativeContextGating: candidate.nativeContextGating }
          : {}),
      };
    }
  } catch {
    // fail-closed: no declaration means current behavior.
  }
  return undefined;
}

/**
 * P5 hd-double-compression-contract negotiation. Input declarations win over
 * config-shaped capability declarations; absence returns all-off negotiation.
 */
export function resolveNativeContextNegotiation(
  cfg: unknown,
  input?: NativeContextCapabilities,
): NativeContextNegotiation {
  const declared = input ?? capabilityFromConfig(cfg);
  const nativeMemory = declared?.nativeMemory === true;
  const nativeContextGating = declared?.nativeContextGating === true;
  return {
    nativeMemory,
    nativeContextGating,
    memoryPilotDisabled: nativeMemory || nativeContextGating,
    vtokenDisabled: nativeMemory || nativeContextGating,
  };
}

function isMemoryPilotEnabled(cfg: unknown): boolean {
  try {
    const runtime =
      isRecord(cfg) && isRecord(cfg.runtime) ? cfg.runtime : isRecord(cfg) ? cfg : undefined;
    const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
    const injectPilot = isRecord(memory?.injectPilot) ? memory.injectPilot : undefined;
    return injectPilot?.enabled === true;
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
  recordManagedSystemChars(ledger, charged.charsApplied);
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
  const nativeContext = resolveNativeContextNegotiation(cfg, input.nativeContextCapabilities);
  const hasNativeDeclaration = nativeContext.nativeMemory || nativeContext.nativeContextGating;
  rememberNativeNegotiation(input.turnId, nativeContext);
  const lineage: ContextOrchestratorLineage = {
    unbudgeted: !input.turnId,
    turnId: input.turnId,
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
    ...(hasNativeDeclaration ? { nativeContext } : {}),
  };

  const deferProjection = input.deferProjection === true && input.turnId !== undefined;
  if (input.deferProjection === true && !input.turnId) {
    lineage.error = "deferred context projection requires turnId";
    lineage.durationMs = Date.now() - started;
    rememberLineage(lineage);
    return { extraSystemPrompt, lineage };
  }
  const candidateCollection = deferProjection
    ? beginContextCandidateCollection(input.turnId!)
    : undefined;
  if (candidateCollection) {
    lineage.candidates = candidateCollection.lineage;
    lineage.candidateDiagnostics = candidateCollection.diagnostics;
  }

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
  const memorySourceId = resolveMemoryLineageSourceId(input.memoryProviderIds);
  if (deferProjection && input.compassContext) {
    collectCompassContext(input.turnId!, input.compassContext, cfg);
  }

  try {
    if (isContextEnhancementKillSwitchEngaged(cfg)) {
      lineage.killSwitchEngaged = true;
      for (const stage of stagesRequested) {
        if (deferProjection) {
          recordContextOrchestratorSourceDecision(input.turnId!, {
            sourceId: stage === "memory" ? memorySourceId : "vtoken-assembly",
            channel: stage === "memory" ? "memory_pilot" : "vtoken",
            target: "system_prompt",
            reason: "kill-switch",
          });
        }
        lineage.sources.push({
          id: stage === "memory" ? memorySourceId : "vtoken-assembly",
          stage,
          enabled: false,
          applied: false,
          chars: 0,
          reason: "enhancement-kill-switch",
        });
      }
      if (!deferProjection) {
        dcsObservability.recordContextOrchestrator({
          killSwitch: true,
          stages: stagesRequested.length,
          charsAdded: 0,
        });
      }
      if (input.sessionStart) {
        lineage.sessionStartSkipReason = "kill-switch";
        if (deferProjection) {
          recordContextOrchestratorSourceDecision(input.turnId!, {
            sourceId: "session-start",
            channel: "session_start",
            target: "system_prompt",
            reason: "kill-switch",
          });
        }
      }
      lineage.durationMs = Date.now() - started;
      rememberLineage(lineage);
      return { extraSystemPrompt: result, lineage };
    }

    // A2b: start-of-session context enters the same candidate collection as every
    // other source, so it is deduplicated, charged, budgeted, and projected in
    // one place. Flag off records a skip decision and stays byte-identical.
    if (input.sessionStart && deferProjection) {
      const sessionStart = applySessionStartInjection({
        turnId: input.turnId!,
        request: input.sessionStart,
        cfg,
      });
      if (sessionStart.plan) {
        lineage.sessionStart = sessionStart.plan;
      }
      if (sessionStart.applied) {
        delete lineage.sessionStartSkipReason;
      } else if (sessionStart.reason !== "applied") {
        lineage.sessionStartSkipReason = sessionStart.reason;
      }
    } else if (input.sessionStart) {
      // Without a turn id there is no ledger to charge and no collection to
      // deduplicate against, so the request is refused rather than spliced.
      lineage.sessionStartSkipReason = "flag-off";
    }

    if (stagesRequested.includes("memory")) {
      const enabled = !nativeContext.memoryPilotDisabled && isMemoryPilotEnabled(cfg);
      const before = result?.length ?? 0;
      if (!enabled) {
        if (deferProjection) {
          recordContextOrchestratorSourceDecision(input.turnId!, {
            sourceId: memorySourceId,
            channel: "memory_pilot",
            target: "system_prompt",
            reason: "flag-off",
          });
        }
        lineage.sources.push({
          id: memorySourceId,
          stage: "memory",
          enabled: false,
          applied: false,
          chars: 0,
          reason: "flag-off",
        });
      } else if (!input.memoryProviderFactory) {
        if (deferProjection) {
          recordContextOrchestratorSourceDecision(input.turnId!, {
            sourceId: memorySourceId,
            channel: "memory_pilot",
            target: "system_prompt",
            reason: "empty",
          });
        }
        lineage.sources.push({
          id: memorySourceId,
          stage: "memory",
          enabled: true,
          applied: false,
          chars: 0,
          reason: "no-provider-factory",
        });
      } else {
        const computed = await computeMemoryExtraSystemPrompt(
          deferProjection ? undefined : result,
          cfg,
          input.sessionKey,
          input.memoryProviderFactory,
          log,
          {
            workspace: input.workspaceDir,
            taskId: input.taskId,
            ...(input.roleName ? { roleName: input.roleName } : {}),
            // #182: COMPASS retrieval already selected these fact ids for this
            // turn and renders them on the `knowledge` channel, which charges
            // the budget first. Re-injecting the same facts as `memory_pilot`
            // items would spend bytes on content the model already has.
            dedupeFactIds: input.compassContext?.injection.injectedFactIds,
          },
        );
        if (deferProjection) {
          const text = computed?.trim();
          if (text) {
            collectContextOrchestratorCandidate(input.turnId!, {
              authorityObjectId: memorySourceId,
              authorityVersion: String(lineage.budget.memoryTokenBudget ?? "default"),
              sourceId: memorySourceId,
              channel: "memory_pilot",
              target: "system_prompt",
              text,
            });
          } else {
            recordContextOrchestratorSourceDecision(input.turnId!, {
              sourceId: memorySourceId,
              channel: "memory_pilot",
              target: "system_prompt",
              reason: "empty",
            });
          }
          const chars = text?.length ?? 0;
          lineage.sources.push({
            id: memorySourceId,
            stage: "memory",
            enabled: true,
            applied: false,
            chars,
            tokens: lineage.budget.memoryTokenBudget,
            reason: chars > 0 ? "candidate-collected" : "no-items",
          });
          result = extraSystemPrompt;
        } else {
          result = computed;
          // FP-P0-05: charge the appended segment against the turn-wide budget and
          // keep only what the budget granted, so the ledger matches the prompt.
          const charged = chargeAppendedSegment(turnLedger, "memory_pilot", result, before);
          result = charged.text;
          const chars = charged.charsApplied;
          lineage.sources.push({
            id: memorySourceId,
            stage: "memory",
            enabled: true,
            applied: chars > 0,
            chars,
            tokens: lineage.budget.memoryTokenBudget,
            reason: charged.reason ?? (chars > 0 ? "applied" : "no-items"),
          });
        }
      }
    }

    if (stagesRequested.includes("vtoken")) {
      const vtokenConfig = resolveVtokenAssemblyConfig(cfg);
      const enabled = !nativeContext.vtokenDisabled && vtokenConfig.enabled;
      lineage.budget.vtokenBudgetTokens = vtokenConfig.budgetTokens;
      const before = result?.length ?? 0;
      if (!enabled) {
        if (deferProjection) {
          recordContextOrchestratorSourceDecision(input.turnId!, {
            sourceId: "vtoken-assembly",
            channel: "vtoken",
            target: "system_prompt",
            reason: "flag-off",
          });
        }
        lineage.sources.push({
          id: "vtoken-assembly",
          stage: "vtoken",
          enabled: false,
          applied: false,
          chars: 0,
          reason: "flag-off",
        });
      } else {
        const memoryEntries =
          input.memoryEntries ??
          (input.memoryEntriesFactory ? await input.memoryEntriesFactory() : undefined);
        const computed = await computeVtokenExtraSystemPrompt(
          deferProjection ? undefined : result,
          cfg,
          {
            sessionKey: input.sessionKey,
            taskHint: input.taskHint ?? "",
            allowanceTokens: vtokenConfig.budgetTokens,
            workspaceDir: input.workspaceDir,
            markdownSources: input.markdownSources,
            toolSchemas: input.toolSchemas,
            memoryEntries,
            alreadyRenderedSourcePaths: input.alreadyRenderedSourcePaths,
            alreadyRenderedToolNames: input.alreadyRenderedToolNames,
          },
          log,
          input.vtokenClient,
        );
        if (deferProjection) {
          const text = computed?.trim();
          if (text) {
            collectContextOrchestratorCandidate(input.turnId!, {
              authorityObjectId: "vtoken-assembly",
              authorityVersion: String(lineage.budget.vtokenBudgetTokens ?? "default"),
              sourceId: "vtoken-assembly",
              channel: "vtoken",
              target: "system_prompt",
              text,
            });
          } else {
            recordContextOrchestratorSourceDecision(input.turnId!, {
              sourceId: "vtoken-assembly",
              channel: "vtoken",
              target: "system_prompt",
              reason: "empty",
            });
          }
          const chars = text?.length ?? 0;
          lineage.sources.push({
            id: "vtoken-assembly",
            stage: "vtoken",
            enabled: true,
            applied: false,
            chars,
            tokens: lineage.budget.vtokenBudgetTokens,
            reason: chars > 0 ? "candidate-collected" : "empty-or-skipped",
          });
          result = extraSystemPrompt;
        } else {
          result = computed;
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
    }

    lineage.totalCharsAdded = Math.max(0, (result?.length ?? 0) - baseLen);
    if (!deferProjection) {
      dcsObservability.recordContextOrchestrator({
        killSwitch: false,
        stages: stagesRequested.length,
        charsAdded: lineage.totalCharsAdded,
      });
    }
  } catch (err) {
    lineage.error = String(err);
    log?.("[context-orchestrator] suppressed error; continuing without enhancement", {
      err: String(err),
    });
    if (!deferProjection) {
      dcsObservability.recordContextOrchestrator({
        killSwitch: false,
        stages: stagesRequested.length,
        charsAdded: 0,
        error: true,
      });
    }
    // Fail-closed: return original prompt on unexpected errors.
    result = extraSystemPrompt;
    lineage.totalCharsAdded = 0;
  }

  lineage.durationMs = Date.now() - started;
  rememberLineage(lineage);
  return { extraSystemPrompt: result, lineage };
}
