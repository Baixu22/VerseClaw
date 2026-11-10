---
title: openclaw_runtime/src/context-engine/assembler.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T05:05:56.255Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/context-engine/assembler.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import {
  buildContextPack,
  type ContextPackInput,
} from "../memory/context-pack.js";
import type { ContextPack } from "../memory/types.js";
import {
  buildPreReplyInjection,
  type PreReplyInjection,
} from "../runtime-core/memory-pre-reply-injection.js";
import {
  isMainSessionKey,
  isSubagentSessionKey,
} from "../sessions/session-key-utils.js";
import type { BlockStoreApi, ContextBlock, ContextBlockSink, SourceSystem } from "./block.js";
import {
  formatKnowledgeInjection,
  handleCompassKnowledge,
} from "./handlers/compass-handler.js";
import { handleRoleMemoryKnowledge } from "./handlers/role-memory-handler.js";
import { formatToolRegistryInjection } from "./handlers/tool-registry-handler.js";
import { parseWorkingMemoryActions } from "./handlers/working-memory-handler.js";
import { dcsObservability } from "./dcs-observability.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import { resolveKillSwitchConfig } from "./kill-switch-config-source.js";
import { isWorkingMemoryRegatherEnabled } from "./working-memory-regather.js";
import {
  collectContextCandidate,
  createContextCandidate,
  recordContextCandidateSkip,
} from "./context-candidate.js";
import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  getEffectiveTurnInjectionCharBudget,
  type TurnInjectionChannel,
  type TurnInjectionLedger,
} from "./turn-injection-budget.js";
import {
  applyInjectionBudget,
  createInjectionBudget,
  type InjectionBudgetState,
} from "./injection-budget.js";
import { applyContextLadder, type PressureMode } from "./context-ladder.js";
import {
  hydrateLifecycleBlock,
  type LifecycleBlock,
} from "./block-lifecycle.js";

export interface AssembleRequest {
  session_id: string;
  hint_entities?: string[];
  role_name?: string;
  /** DCS v1.6.1 addendum 4: config-aware mainKey for session classification. */
  mainKey?: string;
  /**
   * FP-P0-02: request-level runtime config so the enhancement kill switch can
   * see the *config* form (`runtime.contextEnhancement.killSwitch`), not just the
   * env form. Deliberately per-request rather than a constructor snapshot: the
   * Assembler is long-lived and a snapshot would go stale after a config write,
   * making the config kill switch silently ineffective.
   *
   * Omitting it degrades to env-only kill, which is why every production caller
   * must pass it (see the call-site table in FP-P0-02).
   */
  cfg?: unknown;
  /**
   * FP-P0-05: identifier of the agent turn this assemble() belongs to. When set,
   * DCS injections charge the turn-wide shared budget instead of a private
   * per-assemble one, so all injection sources appear on the same account.
   */
  turnId?: string;
  /** UAS-02: collect candidates and leave final projection to Context Orchestrator. */
  deferProjection?: boolean;
  /**
   * F-01: channels already projected into this attempt's transcript by an
   * earlier model call. A deferred projection for the *next* model call must
   * not collect them again (exactly-once per attempt).
   *
   * T-B6 (TF-0126): working_memory produces new Blocks as the tool loop runs,
   * so it is treated differently from the exactly-once channels: when the
   * working-memory regather gate (OPENCLAW_WORKING_MEMORY_REGATHER) is on,
   * the caller (embedded-agent-runner/extensions.ts) keeps it OUT of this
   * list on later model calls, and unchanged content is deduplicated by
   * candidate dedupKey (contentDigest) rather than by a channel-level skip —
   * channels that produced new Blocks since the last call are queried again.
   * Channels that remain on this list are neither queried nor injected; with
   * the regather gate on the skip decision itself is recorded into lineage
   * (disposition "skip", reason "skip-channel") so audits can see it. Gate
   * off: legacy behavior, byte-identical (no regather, no skip lineage).
   */
  skipChannels?: TurnInjectionChannel[];
  /**
   * Internal context-ladder policy supplied by the production DCS factory.
   * Omitted keeps the low-level assembler byte-identical for legacy callers;
   * enabled runs the ladder once over this session's blocks and uses only its
   * active blocks for DCS injections.
   */
  contextLadder?: {
    enabled: true;
    tokenBudget: number;
    mode?: PressureMode;
    heatThreshold?: number;
  };
}

export type LegacyHandlerId = "compass" | "role_memory";

export const DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS = {
  "runtime.contextBlock.compass.enabled": false,
  "runtime.contextBlock.role_memory.enabled": false,
  "runtime.contextBlock.working_memory.enabled": true,
  "runtime.contextBlock.tool_registry.enabled": true,
} as const;

export const DISABLED_CONTEXT_BLOCK_FEATURE_FLAGS = {
  "runtime.contextBlock.compass.enabled": false,
  "runtime.contextBlock.role_memory.enabled": false,
  "runtime.contextBlock.working_memory.enabled": false,
  "runtime.contextBlock.tool_registry.enabled": false,
} as const;

export type ContextBlockFeatureFlagName =
  keyof typeof DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS;

export type ContextBlockFeatureFlags = Partial<Record<ContextBlockFeatureFlagName, boolean>>;

/** Canonical (kebab) source systems that own a context-block feature flag today. */
export type FlaggedContextBlockSourceSystem = Extract<
  SourceSystem,
  "compass" | "role-memory" | "working-memory" | "cvk"
>;

const CONTEXT_BLOCK_FLAG_NAME_BY_SOURCE_SYSTEM: Record<
  FlaggedContextBlockSourceSystem,
  ContextBlockFeatureFlagName
> = {
  compass: "runtime.contextBlock.compass.enabled",
  "role-memory": "runtime.contextBlock.role_memory.enabled",
  "working-memory": "runtime.contextBlock.working_memory.enabled",
  cvk: "runtime.contextBlock.tool_registry.enabled",
};

/**
 * DCS v1.6.1 addendum 6: combined character budget for CVK systemPromptAddition
 * and DCS transformContext injection points. This constant declares the ceiling;
 * cross-injection-point dynamic trimming is deferred per addendum 6.
 */
export const KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000;

/**
 * DCS v1.6.1 addendum 1: the only sanctioned mapping between canonical kebab
 * source-system names ([P1] flag form) and the assembler-internal snake flag keys.
 */
export function contextBlockFlagNameForSourceSystem(
  sourceSystem: FlaggedContextBlockSourceSystem,
): ContextBlockFeatureFlagName {
  return CONTEXT_BLOCK_FLAG_NAME_BY_SOURCE_SYSTEM[sourceSystem];
}

export interface AssemblerLegacyInputs<TExistingOutput = unknown> {
  existing_output: TExistingOutput;
  compass?: Omit<Parameters<typeof buildPreReplyInjection>[0], "sessionKey">;
  role_memory?: ContextPackInput;
}

/**
 * #184: which budget ceiling actually governed this assemble, and why. Present
 * so a caller that forgot `turnId` can see that it degraded to the smaller
 * per-assemble pool instead of silently truncating at a different limit.
 */
export type AssemblerInjectionBudget = {
  mode: "turn-ledger" | "per-assemble-fallback";
  totalChars: number;
  turnBudgetChars: number;
  fallbackReason?: "missing-turn-id";
};

export interface AssemblerResult<TExistingOutput = unknown> {
  output: TExistingOutput;
  selected_handlers: LegacyHandlerId[];
  compass?: PreReplyInjection;
  role_memory?: ContextPack;
  injection_budget?: AssemblerInjectionBudget;
  context_ladder?: {
    mode: PressureMode;
    activeBlocks: number;
    archivedBlocks: number;
  };
  context_ladder_error?: string;
}

export interface AssemblerDependencies {
  buildCompass: typeof buildPreReplyInjection;
  buildRoleMemory: typeof buildContextPack;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
  /** DCS Stage 4: sink for writing knowledge Blocks after legacy builder calls. */
  contextBlockSink?: ContextBlockSink;
  /** Explicit context-ladder executor; injectable for fail-closed tests. */
  applyContextLadder: typeof applyContextLadder;
}

function chargeAssemblerInjection(
  budget: InjectionBudgetState,
  turnLedger: TurnInjectionLedger | undefined,
  channel: TurnInjectionChannel,
  text: string,
) {
  return turnLedger
    ? chargeTurnInjection(turnLedger, channel, text)
    : applyInjectionBudget(budget, text, channel);
}

function contextBlockAuthorityVersion(block: ContextBlock): string {
  const validAt =
    block.valid_at instanceof Date ? block.valid_at.toISOString() : String(block.valid_at);
  return `${validAt}:compression-${block.compression_depth}`;
}

function contextBlockSourceId(block: ContextBlock): string {
  return `context-block:${block.source_system}:${block.block_type}`;
}

function collectContextBlockCandidate(params: {
  turnId: string;
  block: ContextBlock;
  channel: TurnInjectionChannel;
  text: string;
}): void {
  collectContextCandidate(
    params.turnId,
    createContextCandidate({
      authorityObjectId: params.block.block_id,
      authorityVersion: contextBlockAuthorityVersion(params.block),
      sourceId: contextBlockSourceId(params.block),
      channel: params.channel,
      target: "message",
      text: params.text,
    }),
  );
}

function recordContextBlockDecision(params: {
  turnId: string;
  sourceId: string;
  channel: TurnInjectionChannel;
  reason: "empty" | "flag-off" | "kill-switch" | "skip-channel";
}): void {
  recordContextCandidateSkip(params.turnId, {
    sourceId: params.sourceId,
    channel: params.channel,
    target: "message",
    reason: params.reason,
  });
}

/**
 * FP-P0-02: resolve the config the kill switch evaluates for one assemble().
 *
 * An explicit `request.cfg` wins (callers that already hold a fresh config, and
 * tests). Otherwise read the on-disk config through the mtime-keyed source so a
 * config-form kill engaged mid-session takes effect on the next turn rather than
 * being pinned to whatever was true when the Assembler was constructed.
 */
export function resolveAssembleKillSwitchConfig(request: AssembleRequest): unknown {
  return request.cfg !== undefined ? request.cfg : resolveKillSwitchConfig();
}

export function selectHandlers(request: AssembleRequest): LegacyHandlerId[] {
  if (isMainSessionKey(request.session_id, request.mainKey)) {
    return ["compass"];
  }
  if (isSubagentSessionKey(request.session_id)) {
    return ["role_memory"];
  }
  return [];
}

export class Assembler {
  readonly #dependencies: AssemblerDependencies;

  constructor(dependencies: Partial<AssemblerDependencies> = {}) {
    this.#dependencies = {
      buildCompass: dependencies.buildCompass ?? buildPreReplyInjection,
      buildRoleMemory: dependencies.buildRoleMemory ?? buildContextPack,
      ...(dependencies.workingMemoryStore
        ? { workingMemoryStore: dependencies.workingMemoryStore }
        : {}),
      ...(dependencies.contextBlockSink
        ? { contextBlockSink: dependencies.contextBlockSink }
        : {}),
      applyContextLadder: dependencies.applyContextLadder ?? applyContextLadder,
    };
  }

  async assemble<TExistingOutput>(
    request: AssembleRequest,
    inputs: AssemblerLegacyInputs<TExistingOutput>,
    flags: ContextBlockFeatureFlags = DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
  ): Promise<AssemblerResult<TExistingOutput>> {
    // Master kill switch forces all context-block enhancements off (fail-closed).
    // FP-P0-02: `request.cfg` is forwarded so the config-form kill switch is a
    // real switch, not an empty one. An unparseable cfg makes the helper throw
    // internally and return true (fail-closed), which is the intended behavior.
    const killCfg = resolveAssembleKillSwitchConfig(request);
    const killed = isContextEnhancementKillSwitchEngaged(killCfg);
    const resolvedFlags = killed
      ? { ...DISABLED_CONTEXT_BLOCK_FEATURE_FLAGS }
      : {
          ...DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
          ...flags,
        };
    const eligibleHandlers = new Set(selectHandlers(request));
    const result: AssemblerResult<TExistingOutput> = {
      output: inputs.existing_output,
      selected_handlers: [],
    };
    const deferProjection = request.deferProjection === true;
    if (deferProjection && !request.turnId) {
      return result;
    }
    if (deferProjection) {
      const knowledgeEnabled =
        (eligibleHandlers.has("compass") &&
          resolvedFlags["runtime.contextBlock.compass.enabled"]) ||
        (eligibleHandlers.has("role_memory") &&
          resolvedFlags["runtime.contextBlock.role_memory.enabled"]);
      const skipReason = killed ? "kill-switch" : "flag-off";
      if (!knowledgeEnabled) {
        recordContextBlockDecision({
          turnId: request.turnId!,
          sourceId: "context-block:knowledge",
          channel: "knowledge",
          reason: skipReason,
        });
      }
      if (!resolvedFlags["runtime.contextBlock.working_memory.enabled"]) {
        recordContextBlockDecision({
          turnId: request.turnId!,
          sourceId: "context-block:working-memory:working_memory",
          channel: "working_memory",
          reason: skipReason,
        });
      }
      if (!resolvedFlags["runtime.contextBlock.tool_registry.enabled"]) {
        recordContextBlockDecision({
          turnId: request.turnId!,
          sourceId: "context-block:cvk:tool_registry",
          channel: "tool_registry",
          reason: skipReason,
        });
      }
    }
    // TASK-P2-03: one shared budget for all DCS transformContext injections.
    // FP-P0-05: when the caller supplies a `turnId`, the DCS channels charge the
    // turn-wide ledger that VToken / memory-pilot / CVK also charge, so the
    // accounting sums to the turn's real prompt growth. Without a turnId we fall
    // back to a per-assemble budget (the pre-FP-P0-05 behavior) rather than
    // silently sharing state between unrelated turns.
    const turnLedger = request.turnId
      ? beginTurnInjectionBudget({ turnId: request.turnId, killed })
      : undefined;
    const turnBudgetChars = getEffectiveTurnInjectionCharBudget();
    let injectionBudget: InjectionBudgetState;
    if (turnLedger) {
      injectionBudget = turnLedger.budget;
      result.injection_budget = {
        mode: "turn-ledger",
        totalChars: turnLedger.budget.total,
        turnBudgetChars,
      };
    } else {
      // #184: the pre-FP-P0-05 fallback ceiling is 3x smaller than the turn
      // budget. Falling back is deliberate (unrelated turns must not share
      // ledger state), but it must not be silent: a caller that forgot
      // `turnId` would otherwise truncate at 2000 chars while every budget
      // report still looked normal.
      injectionBudget = createInjectionBudget(KNOWLEDGE_INJECTION_CHAR_BUDGET);
      dcsObservability.recordInjectionBudgetFallback({
        effectiveLimit: injectionBudget.total,
        turnLimit: turnBudgetChars,
        scope: "assembler",
      });
      result.injection_budget = {
        mode: "per-assemble-fallback",
        totalChars: injectionBudget.total,
        turnBudgetChars,
        fallbackReason: "missing-turn-id",
      };
    }

    let ladderBlocks: readonly LifecycleBlock[] | undefined;
    if (request.contextLadder?.enabled === true) {
      const store = this.#dependencies.workingMemoryStore;
      if (store && Array.isArray(inputs.existing_output)) {
        try {
          const blocks = await store.query({
            requester_session_id: request.session_id,
            session_id: request.session_id,
            limit: 100,
          });
          const ladder = this.#dependencies.applyContextLadder({
            blocks: blocks.map(hydrateLifecycleBlock),
            tokenBudget: request.contextLadder.tokenBudget,
            mode: request.contextLadder.mode,
            heatThreshold: request.contextLadder.heatThreshold,
          });
          ladderBlocks = ladder.activeBlocks;
          result.context_ladder = {
            mode: ladder.mode,
            activeBlocks: ladder.activeBlocks.length,
            archivedBlocks: ladder.archivedBlocks.length,
          };
        } catch (error) {
          result.context_ladder_error =
            error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (
      eligibleHandlers.has("compass") &&
      resolvedFlags["runtime.contextBlock.compass.enabled"] &&
      inputs.compass
    ) {
      result.compass = await this.#dependencies.buildCompass({
        sessionKey: request.session_id,
        ...inputs.compass,
      });
      result.selected_handlers.push("compass");
      // DCS Stage 4: produce knowledge Block from compass output.
      const sink = this.#dependencies.contextBlockSink;
      if (sink && result.compass) {
        try {
          await handleCompassKnowledge({
            sessionId: request.session_id,
            injection: result.compass,
            contextBlockSink: sink,
          });
        } catch {
          // Best-effort write; failure does not block assembly.
        }
      }
    }

    if (
      eligibleHandlers.has("role_memory") &&
      resolvedFlags["runtime.contextBlock.role_memory.enabled"] &&
      inputs.role_memory
    ) {
      result.role_memory = this.#dependencies.buildRoleMemory(inputs.role_memory);
      result.selected_handlers.push("role_memory");
      // DCS Stage 4: produce knowledge Block from role-memory output.
      const sink = this.#dependencies.contextBlockSink;
      if (sink && result.role_memory) {
        try {
          await handleRoleMemoryKnowledge({
            sessionId: request.session_id,
            pack: result.role_memory,
            contextBlockSink: sink,
          });
        } catch {
          // Best-effort write; failure does not block assembly.
        }
      }
    }

    // DCS Stage 4: knowledge Block injection (compass for main, role-memory for subagent).
    // FP-P2-06: DCS projection order is the frozen turn-ledger precedence, not
    // the historical handler order. Later channels are therefore the first to
    // degrade when this shared pool runs out.
    if (
      resolvedFlags["runtime.contextBlock.compass.enabled"] ||
      resolvedFlags["runtime.contextBlock.role_memory.enabled"]
    ) {
      result.output = (await this.#appendKnowledge(
        request,
        result.output,
        eligibleHandlers,
        resolvedFlags,
        injectionBudget,
        turnLedger,
        killCfg,
        ladderBlocks,
      )) as TExistingOutput;
    }

    if (resolvedFlags["runtime.contextBlock.working_memory.enabled"]) {
      result.output = (await this.#appendWorkingMemory(
        request,
        result.output,
        injectionBudget,
        turnLedger,
        killCfg,
        ladderBlocks,
      )) as TExistingOutput;
    }

    if (resolvedFlags["runtime.contextBlock.tool_registry.enabled"]) {
      result.output = (await this.#appendToolRegistry(
        request,
        result.output,
        injectionBudget,
        turnLedger,
        killCfg,
        ladderBlocks,
      )) as TExistingOutput;
    }

    return result;
  }

  /**
   * T-B6 (TF-0126): channel-level skips used to be invisible in lineage — the
   * transformer returned without recording anything, so audits could not see
   * why a channel stayed silent on a model call. With the working-memory
   * regather gate on, record the skip decision. Gate off: record nothing —
   * pre-T-B6 behavior stays byte-identical (requirement-5 / AC-5).
   */
  #recordChannelSkip(
    request: AssembleRequest,
    channel: TurnInjectionChannel,
    sourceId: string,
    killCfg: unknown,
  ): void {
    if (!request.deferProjection || !request.turnId) return;
    if (!isWorkingMemoryRegatherEnabled(killCfg, process.env)) return;
    recordContextBlockDecision({
      turnId: request.turnId,
      sourceId,
      channel,
      reason: "skip-channel",
    });
  }

  async #appendWorkingMemory<TExistingOutput>(
    request: AssembleRequest,
    output: TExistingOutput,
    budget: InjectionBudgetState,
    turnLedger: TurnInjectionLedger | undefined,
    killCfg: unknown,
    ladderBlocks: readonly LifecycleBlock[] | undefined,
  ): Promise<TExistingOutput> {
    if (request.skipChannels?.includes("working_memory")) {
      this.#recordChannelSkip(
        request,
        "working_memory",
        "context-block:working-memory:working_memory",
        killCfg,
      );
      return output;
    }
    const store = this.#dependencies.workingMemoryStore;
    if (!store || !Array.isArray(output)) {
      if (request.deferProjection && request.turnId) {
        recordContextBlockDecision({
          turnId: request.turnId,
          sourceId: "context-block:working-memory:working_memory",
          channel: "working_memory",
          reason: "empty",
        });
      }
      return output;
    }
    // FP-P0-02: the kill switch must cut the BlockStore *query* too, not only the
    // injection. assemble() already zeroes the flags when killed, so this is a
    // second fail-closed fence for any future direct caller.
    if (isContextEnhancementKillSwitchEngaged(killCfg)) {
      return output;
    }
    if (!request.deferProjection && hasRecentActionsHeading(output)) {
      // DCS v1.6.1 addendum 2: exactly-once — a prior injection point already
      // projected the window into this call's context; never accumulate a second.
      dcsObservability.recordDcsTransformContextInjection({ chars: 0, suppressed: true });
      return output;
    }
    const block = ladderBlocks
      ? ladderBlocks.find(
          (candidate) =>
            candidate.block_type === "working_memory" &&
            candidate.source_system === "working-memory",
        )
      : (
          await store.query({
            requester_session_id: request.session_id,
            session_id: request.session_id,
            block_types: ["working_memory"],
            source_systems: ["working-memory"],
            limit: 1,
          })
        )[0];
    const injection = formatWorkingMemoryInjection(block);
    if (!injection) {
      if (request.deferProjection && request.turnId) {
        recordContextBlockDecision({
          turnId: request.turnId,
          sourceId: block
            ? contextBlockSourceId(block)
            : "context-block:working-memory:working_memory",
          channel: "working_memory",
          reason: "empty",
        });
      }
      if (!request.deferProjection) {
        dcsObservability.recordDcsTransformContextInjection({ chars: 0 });
      }
      return output;
    }
    if (request.deferProjection && request.turnId && block) {
      collectContextBlockCandidate({
        turnId: request.turnId,
        block,
        channel: "working_memory",
        text: injection,
      });
      return output;
    }
    const applied = chargeAssemblerInjection(
      budget,
      turnLedger,
      "working_memory",
      injection,
    );
    if (!applied.text) {
      dcsObservability.recordDcsTransformContextInjection({ chars: 0 });
      return output;
    }
    dcsObservability.recordDcsTransformContextInjection({ chars: applied.charsApplied });
    return [...output, { role: "user", content: applied.text }] as TExistingOutput;
  }

  async #appendToolRegistry<TExistingOutput>(
    request: AssembleRequest,
    output: TExistingOutput,
    budget: InjectionBudgetState,
    turnLedger: TurnInjectionLedger | undefined,
    killCfg: unknown,
    ladderBlocks: readonly LifecycleBlock[] | undefined,
  ): Promise<TExistingOutput> {
    if (request.skipChannels?.includes("tool_registry")) {
      this.#recordChannelSkip(request, "tool_registry", "context-block:cvk:tool_registry", killCfg);
      return output;
    }
    const store = this.#dependencies.workingMemoryStore;
    if (!store || !Array.isArray(output)) {
      if (request.deferProjection && request.turnId) {
        recordContextBlockDecision({
          turnId: request.turnId,
          sourceId: "context-block:cvk:tool_registry",
          channel: "tool_registry",
          reason: "empty",
        });
      }
      return output;
    }
    // FP-P0-02: same fail-closed fence on the tool-registry query segment.
    if (isContextEnhancementKillSwitchEngaged(killCfg)) {
      return output;
    }
    if (!request.deferProjection && hasToolsHeading(output)) {
      // DCS v1.6.1 addendum 2: exactly-once — a prior injection point already
      // projected the tool registry into this call's context; never accumulate.
      dcsObservability.recordDcsTransformContextInjection({ chars: 0, suppressed: true });
      return output;
    }
    const block = ladderBlocks
      ? ladderBlocks.find(
          (candidate) =>
            candidate.block_type === "tool_registry" &&
            candidate.source_system === "cvk",
        )
      : (
          await store.query({
            requester_session_id: request.session_id,
            session_id: request.session_id,
            block_types: ["tool_registry"],
            source_systems: ["cvk"],
            limit: 1,
          })
        )[0];
    const injection = formatToolRegistryInjection(block);
    if (!injection) {
      if (request.deferProjection && request.turnId) {
        recordContextBlockDecision({
          turnId: request.turnId,
          sourceId: block ? contextBlockSourceId(block) : "context-block:cvk:tool_registry",
          channel: "tool_registry",
          reason: "empty",
        });
      }
      if (!request.deferProjection) {
        dcsObservability.recordDcsTransformContextInjection({ chars: 0 });
      }
      return output;
    }
    if (request.deferProjection && request.turnId && block) {
      collectContextBlockCandidate({
        turnId: request.turnId,
        block,
        channel: "tool_registry",
        text: injection,
      });
      return output;
    }
    const applied = chargeAssemblerInjection(
      budget,
      turnLedger,
      "tool_registry",
      injection,
    );
    if (!applied.text) {
      dcsObservability.recordDcsTransformContextInjection({ chars: 0 });
      return output;
    }
    dcsObservability.recordDcsTransformContextInjection({ chars: applied.charsApplied });
    return [...output, { role: "user", content: applied.text }] as TExistingOutput;
  }

  /**
   * DCS Stage 4: knowledge Block injection.
   *
   * Session-type-aware query 鈥?main sessions query compass Blocks, subagent
   * sessions query role-memory Blocks (ANTI-3). Exactly-once guard via
   * `## Knowledge` heading (addendum 2).
   */
  async #appendKnowledge<TExistingOutput>(
    request: AssembleRequest,
    output: TExistingOutput,
    eligibleHandlers: Set<LegacyHandlerId>,
    flags: ContextBlockFeatureFlags,
    budget: InjectionBudgetState,
    turnLedger: TurnInjectionLedger | undefined,
    killCfg: unknown,
    ladderBlocks: readonly LifecycleBlock[] | undefined,
  ): Promise<TExistingOutput> {
    if (request.skipChannels?.includes("knowledge")) {
      this.#recordChannelSkip(request, "knowledge", "context-block:knowledge", killCfg);
      return output;
    }
    const store = this.#dependencies.workingMemoryStore;
    if (!store || !Array.isArray(output)) {
      if (request.deferProjection && request.turnId) {
        recordContextBlockDecision({
          turnId: request.turnId,
          sourceId: "context-block:knowledge",
          channel: "knowledge",
          reason: "empty",
        });
      }
      return output;
    }
    // FP-P0-02: same fail-closed fence on the knowledge query segment.
    if (isContextEnhancementKillSwitchEngaged(killCfg)) {
      return output;
    }
    if (!request.deferProjection && hasKnowledgeHeading(output)) {
      // DCS v1.6.1 addendum 2: exactly-once.
      dcsObservability.recordDcsTransformContextInjection({ chars: 0, suppressed: true });
      return output;
    }
    // ANTI-3: main -> compass only; subagent -> role-memory only.
    // Flags must also be ON - a flag-off source must never be injected.
    const sourceSystems: SourceSystem[] = [];
    if (eligibleHandlers.has("compass") && flags["runtime.contextBlock.compass.enabled"]) {
      sourceSystems.push("compass");
    }
    if (eligibleHandlers.has("role_memory") && flags["runtime.contextBlock.role_memory.enabled"]) {
      sourceSystems.push("role-memory");
    }
    if (sourceSystems.length === 0) {
      return output;
    }
    const block = ladderBlocks
      ? ladderBlocks.find(
          (candidate) =>
            candidate.block_type === "knowledge" &&
            sourceSystems.includes(candidate.source_system),
        )
      : (
          await store.query({
            requester_session_id: request.session_id,
            session_id: request.session_id,
            block_types: ["knowledge"],
            source_systems: sourceSystems,
            limit: 1,
          })
        )[0];
    const injection = formatKnowledgeInjection(block);
    if (!injection) {
      if (request.deferProjection && request.turnId) {
        recordContextBlockDecision({
          turnId: request.turnId,
          sourceId: block ? contextBlockSourceId(block) : "context-block:knowledge",
          channel: "knowledge",
          reason: "empty",
        });
      }
      if (!request.deferProjection) {
        dcsObservability.recordDcsTransformContextInjection({ chars: 0 });
      }
      return output;
    }
    if (request.deferProjection && request.turnId && block) {
      collectContextBlockCandidate({
        turnId: request.turnId,
        block,
        channel: "knowledge",
        text: injection,
      });
      return output;
    }
    const applied = chargeAssemblerInjection(budget, turnLedger, "knowledge", injection);
    if (!applied.text) {
      dcsObservability.recordDcsTransformContextInjection({ chars: 0 });
      return output;
    }
    dcsObservability.recordDcsTransformContextInjection({ chars: applied.charsApplied });
    return [...output, { role: "user", content: applied.text }] as TExistingOutput;
  }
}

const RECENT_ACTIONS_HEADING_PATTERN = /^## Recent Actions$/m;
const TOOLS_HEADING_PATTERN = /^## Tools \(\d+ available\)$/m;
const KNOWLEDGE_HEADING_PATTERN = /^## Knowledge$/m;

function hasRecentActionsHeading(output: readonly unknown[]): boolean {
  return output.some((message) => {
    const content = (message as { content?: unknown } | undefined)?.content;
    return typeof content === "string" && RECENT_ACTIONS_HEADING_PATTERN.test(content);
  });
}

function hasToolsHeading(output: readonly unknown[]): boolean {
  return output.some((message) => {
    const content = (message as { content?: unknown } | undefined)?.content;
    return typeof content === "string" && TOOLS_HEADING_PATTERN.test(content);
  });
}

function hasKnowledgeHeading(output: readonly unknown[]): boolean {
  return output.some((message) => {
    const content = (message as { content?: unknown } | undefined)?.content;
    return typeof content === "string" && KNOWLEDGE_HEADING_PATTERN.test(content);
  });
}

export function formatWorkingMemoryInjection(block: ContextBlock | undefined): string | undefined {
  const actions = parseWorkingMemoryActions(block);
  if (actions.length === 0) {
    return undefined;
  }
  return [
    "## Recent Actions",
    ...actions.map(
      (action) => `- ${action.tool}: ${action.result_summary} (${action.significance})`,
    ),
  ].join("\n");
}

~~~
