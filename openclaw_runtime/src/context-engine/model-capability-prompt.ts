/**
 * Per-model-call bridge from a context-engine assemble request to the
 * ModelCapabilityProfile/v1 effective-state adapter.
 *
 * The context engine is the last runtime-owned boundary before the prompt is
 * submitted to a provider. This bridge is intentionally side-effect free: it
 * reads the tool surface already admitted for the call and delegates all
 * availability, ack, permission, memory and knowledge facts to the adapter.
 */
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  buildRuntimeEffectiveCapabilityProfile,
  type RuntimeCapabilityStateGenerationGuard,
  type RuntimeEffectiveCapabilityInput,
} from "../runtime-core/model-capability-effective-state.js";
import type { ContextEngineToolMetadata } from "./types.js";

export type ModelCapabilityPromptStateInput = Pick<
  RuntimeEffectiveCapabilityInput,
  "runtimeAck" | "grants" | "memory" | "knowledge" | "quarantine" | "runtimeStates" | "driver"
>;

export type ModelCapabilityPromptInput = {
  cfg?: OpenClawConfig;
  workspaceDir: string;
  workspaceId?: string;
  sessionId: string;
  sessionKey?: string;
  availableTools?: ReadonlySet<string>;
  activeTools?: readonly ContextEngineToolMetadata[];
  state?: ModelCapabilityPromptStateInput;
  generationGuard?: RuntimeCapabilityStateGenerationGuard;
  nowMs?: () => number;
  ttlMs?: number;
};

const EMPTY_PARAMETERS = { type: "object", properties: {} } as const;

function toolStub(name: string, metadata?: ContextEngineToolMetadata): AnyAgentTool {
  return {
    name,
    label: metadata?.label ?? name,
    description: metadata?.description ?? `Runtime tool ${name}`,
    parameters: metadata?.parameters ?? EMPTY_PARAMETERS,
    execute: async () => ({ content: [] }),
  } as unknown as AnyAgentTool;
}

function effectiveTools(input: ModelCapabilityPromptInput): AnyAgentTool[] {
  const byName = new Map<string, AnyAgentTool>();
  for (const metadata of input.activeTools ?? []) {
    byName.set(metadata.name, toolStub(metadata.name, metadata));
  }
  for (const name of input.availableTools ?? []) {
    if (!byName.has(name)) byName.set(name, toolStub(name));
  }
  return [...byName.values()];
}

function hasToolSurface(input: ModelCapabilityPromptInput): boolean {
  return input.availableTools !== undefined || input.activeTools !== undefined;
}

/**
 * Builds the bounded capability-positioning text for one model call.
 *
 * A call without a known tool surface is deliberately left without an addition
 * rather than inferring capability from static metadata. The adapter itself
 * degrades partial facts to unknown, so a non-empty addition is always
 * evidence-grounded.
 */
export async function buildModelCapabilityPromptAddition(
  input: ModelCapabilityPromptInput,
): Promise<string | undefined> {
  if (!hasToolSurface(input)) return undefined;
  const sessionKey = (input.sessionKey ?? input.sessionId).trim();
  if (!sessionKey) return undefined;
  const tools = effectiveTools(input);

  const result = await buildRuntimeEffectiveCapabilityProfile({
    workspaceId: (input.workspaceId ?? input.workspaceDir).trim(),
    workspaceDir: input.workspaceDir,
    sessionKey,
    tools,
    cfg: input.cfg ?? ({} as OpenClawConfig),
    ...(input.state ?? {}),
    ...(input.generationGuard ? { generationGuard: input.generationGuard } : {}),
    ...(input.nowMs ? { nowMs: input.nowMs } : {}),
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
  });
  const text = result.profile.promptAddition.text.trim();
  return text || undefined;
}