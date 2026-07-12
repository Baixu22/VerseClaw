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

export interface AssembleRequest {
  session_id: string;
  hint_entities?: string[];
  role_name?: string;
  /** DCS v1.6.1 addendum 4: config-aware mainKey for session classification. */
  mainKey?: string;
}

export type LegacyHandlerId = "compass" | "role_memory";

export const DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS = {
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

export interface AssemblerResult<TExistingOutput = unknown> {
  output: TExistingOutput;
  selected_handlers: LegacyHandlerId[];
  compass?: PreReplyInjection;
  role_memory?: ContextPack;
}

export interface AssemblerDependencies {
  buildCompass: typeof buildPreReplyInjection;
  buildRoleMemory: typeof buildContextPack;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
  /** DCS Stage 4: sink for writing knowledge Blocks after legacy builder calls. */
  contextBlockSink?: ContextBlockSink;
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
    };
  }

  async assemble<TExistingOutput>(
    request: AssembleRequest,
    inputs: AssemblerLegacyInputs<TExistingOutput>,
    flags: ContextBlockFeatureFlags = DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
  ): Promise<AssemblerResult<TExistingOutput>> {
    const resolvedFlags = {
      ...DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
      ...flags,
    };
    const eligibleHandlers = new Set(selectHandlers(request));
    const result: AssemblerResult<TExistingOutput> = {
      output: inputs.existing_output,
      selected_handlers: [],
    };

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

    if (resolvedFlags["runtime.contextBlock.working_memory.enabled"]) {
      result.output = (await this.#appendWorkingMemory(request, result.output)) as TExistingOutput;
    }

    if (resolvedFlags["runtime.contextBlock.tool_registry.enabled"]) {
      result.output = (await this.#appendToolRegistry(request, result.output)) as TExistingOutput;
    }

    // DCS Stage 4: knowledge Block injection (compass for main, role-memory for subagent).
    if (
      resolvedFlags["runtime.contextBlock.compass.enabled"] ||
      resolvedFlags["runtime.contextBlock.role_memory.enabled"]
    ) {
      result.output = (await this.#appendKnowledge(
        request,
        result.output,
        eligibleHandlers,
        resolvedFlags,
      )) as TExistingOutput;
    }

    return result;
  }

  async #appendWorkingMemory<TExistingOutput>(
    request: AssembleRequest,
    output: TExistingOutput,
  ): Promise<TExistingOutput> {
    const store = this.#dependencies.workingMemoryStore;
    if (!store || !Array.isArray(output)) {
      return output;
    }
    if (hasRecentActionsHeading(output)) {
      // DCS v1.6.1 addendum 2: exactly-once — a prior injection point already
      // projected the window into this call's context; never accumulate a second.
      return output;
    }
    const blocks = await store.query({
      requester_session_id: request.session_id,
      session_id: request.session_id,
      block_types: ["working_memory"],
      source_systems: ["working-memory"],
      limit: 1,
    });
    const injection = formatWorkingMemoryInjection(blocks[0]);
    if (!injection) {
      return output;
    }
    return [...output, { role: "user", content: injection }] as TExistingOutput;
  }

  async #appendToolRegistry<TExistingOutput>(
    request: AssembleRequest,
    output: TExistingOutput,
  ): Promise<TExistingOutput> {
    const store = this.#dependencies.workingMemoryStore;
    if (!store || !Array.isArray(output)) {
      return output;
    }
    if (hasToolsHeading(output)) {
      // DCS v1.6.1 addendum 2: exactly-once — a prior injection point already
      // projected the tool registry into this call's context; never accumulate.
      return output;
    }
    const blocks = await store.query({
      requester_session_id: request.session_id,
      session_id: request.session_id,
      block_types: ["tool_registry"],
      source_systems: ["cvk"],
      limit: 1,
    });
    const injection = formatToolRegistryInjection(blocks[0]);
    if (!injection) {
      return output;
    }
    return [...output, { role: "user", content: injection }] as TExistingOutput;
  }

  /**
   * DCS Stage 4: knowledge Block injection.
   *
   * Session-type-aware query — main sessions query compass Blocks, subagent
   * sessions query role-memory Blocks (ANTI-3). Exactly-once guard via
   * `## Knowledge` heading (addendum 2).
   */
  async #appendKnowledge<TExistingOutput>(
    request: AssembleRequest,
    output: TExistingOutput,
    eligibleHandlers: Set<LegacyHandlerId>,
    flags: ContextBlockFeatureFlags,
  ): Promise<TExistingOutput> {
    const store = this.#dependencies.workingMemoryStore;
    if (!store || !Array.isArray(output)) {
      return output;
    }
    if (hasKnowledgeHeading(output)) {
      // DCS v1.6.1 addendum 2: exactly-once.
      return output;
    }
    // ANTI-3: main → compass only; subagent → role-memory only.
    // Flags must also be ON — a flag-off source must never be injected.
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
    const blocks = await store.query({
      requester_session_id: request.session_id,
      session_id: request.session_id,
      block_types: ["knowledge"],
      source_systems: sourceSystems,
      limit: 1,
    });
    const injection = formatKnowledgeInjection(blocks[0]);
    if (!injection) {
      return output;
    }
    return [...output, { role: "user", content: injection }] as TExistingOutput;
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
