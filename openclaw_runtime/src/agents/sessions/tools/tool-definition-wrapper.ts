/**
 * Tool definition/AgentTool adapters.
 *
 * Bridges extension-style ToolDefinition objects and core runtime AgentTool objects.
 */
import type { TSchema } from "typebox";
import type { AgentTool } from "../../runtime/index.js";
import type { WriteRiskProfile } from "../../../shared/tool-registration.js";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.js";

/** Extended AgentTool that carries A1 write-risk metadata. */
export type AgentToolWithWriteRisk<TParams extends TSchema = TSchema, TDetails = unknown> =
  AgentTool<TParams, TDetails> & {
    /** A1 Stage 2: tool risk level (defaults to "readonly"). */
    risk?: "readonly" | "write" | "destructive";
    /** A1 Stage 2: static write-path declaration. */
    writeRiskProfile?: WriteRiskProfile;
  };

/** Wrap a ToolDefinition into an AgentTool for the core runtime. */
export function wrapToolDefinition<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
  TState = unknown,
>(
  definition: ToolDefinition<TParams, TDetails, TState>,
  ctxFactory?: () => ExtensionContext,
): AgentToolWithWriteRisk<TParams, TDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    // A1 Stage 2: pass through write-risk metadata so the snapshotter can
    // consume it at runtime (acceptance 2.1).
    risk: definition.risk,
    writeRiskProfile: definition.writeRiskProfile,
    execute: (toolCallId, params, signal, onUpdate) =>
      definition.execute(toolCallId, params, signal, onUpdate, ctxFactory?.() as ExtensionContext),
  };
}

/** Wrap multiple ToolDefinitions into AgentTools for the core runtime. */
export function wrapToolDefinitions(
  definitions: ToolDefinition[],
  ctxFactory?: () => ExtensionContext,
): AgentTool[] {
  return definitions.map((definition) => wrapToolDefinition(definition, ctxFactory));
}

/**
 * Synthesize a minimal ToolDefinition from an AgentTool.
 *
 * This keeps AgentSession's internal registry definition-first even when a caller
 * provides plain AgentTool overrides that do not include prompt metadata or renderers.
 *
 * Preserves A1 write-risk metadata (`risk`/`writeRiskProfile`) when present on the
 * source tool (e.g., tools produced by `wrapToolDefinition`).
 */
export function createToolDefinitionFromAgentTool(tool: AgentTool): ToolDefinition {
  // A1 Stage 2: read optional write-risk metadata if the tool carries it.
  const withRisk = tool as AgentTool & {
    risk?: ToolDefinition["risk"];
    writeRiskProfile?: ToolDefinition["writeRiskProfile"];
  };
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
    // A1 Stage 2: preserve write-risk metadata when round-tripping.
    risk: withRisk.risk,
    writeRiskProfile: withRisk.writeRiskProfile,
    execute: async (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
  };
}
