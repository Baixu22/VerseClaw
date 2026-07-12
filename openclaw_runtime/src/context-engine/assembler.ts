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
import type { BlockStoreApi, ContextBlock, SourceSystem } from "./block.js";
import { parseWorkingMemoryActions } from "./handlers/working-memory-handler.js";

export interface AssembleRequest {
  session_id: string;
  hint_entities?: string[];
  role_name?: string;
}

export type LegacyHandlerId = "compass" | "role_memory";

export const DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS = {
  "runtime.contextBlock.compass.enabled": false,
  "runtime.contextBlock.role_memory.enabled": false,
  "runtime.contextBlock.working_memory.enabled": false,
} as const;

export type ContextBlockFeatureFlagName =
  keyof typeof DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS;

export type ContextBlockFeatureFlags = Partial<Record<ContextBlockFeatureFlagName, boolean>>;

/** Canonical (kebab) source systems that own a context-block feature flag today. */
export type FlaggedContextBlockSourceSystem = Extract<
  SourceSystem,
  "compass" | "role-memory" | "working-memory"
>;

const CONTEXT_BLOCK_FLAG_NAME_BY_SOURCE_SYSTEM: Record<
  FlaggedContextBlockSourceSystem,
  ContextBlockFeatureFlagName
> = {
  compass: "runtime.contextBlock.compass.enabled",
  "role-memory": "runtime.contextBlock.role_memory.enabled",
  "working-memory": "runtime.contextBlock.working_memory.enabled",
};

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
}

export function selectHandlers(request: AssembleRequest): LegacyHandlerId[] {
  if (isMainSessionKey(request.session_id)) {
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
    }

    if (
      eligibleHandlers.has("role_memory") &&
      resolvedFlags["runtime.contextBlock.role_memory.enabled"] &&
      inputs.role_memory
    ) {
      result.role_memory = this.#dependencies.buildRoleMemory(inputs.role_memory);
      result.selected_handlers.push("role_memory");
    }

    if (resolvedFlags["runtime.contextBlock.working_memory.enabled"]) {
      result.output = (await this.#appendWorkingMemory(request, result.output)) as TExistingOutput;
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
}

const RECENT_ACTIONS_HEADING_PATTERN = /^## Recent Actions$/m;

function hasRecentActionsHeading(output: readonly unknown[]): boolean {
  return output.some((message) => {
    const content = (message as { content?: unknown } | undefined)?.content;
    return typeof content === "string" && RECENT_ACTIONS_HEADING_PATTERN.test(content);
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