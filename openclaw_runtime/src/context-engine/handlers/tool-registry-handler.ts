import type { ContextBlock, ContextBlockSink } from "../block.js";

/**
 * DCS Stage 3 tool_registry Block handler.
 *
 * A `before_agent_start` hook produces one system-managed `tool_registry` Block
 * through `ContextBlockSink`. The Block carries `always_on=true`,
 * `token_budget=200`, `priority=7`, and the fixed `context_read` expand tool.
 *
 * The existing CVK `ContextRuntimeKitContextEngine.assemble` path is unchanged;
 * this handler is a parallel, flag-gated producer.
 */

export interface ToolRegistryEntry {
  resourceId: string;
  kind: string;
  title: string;
  purpose: string;
  category?: string;
}

export interface BuildToolRegistryBlockParams {
  sessionId: string;
  entries: ToolRegistryEntry[];
  now?: Date;
}

const TOOL_REGISTRY_TOKEN_BUDGET = 200;
const TOOL_REGISTRY_PRIORITY = 7;
const TOOL_REGISTRY_MAX_ENTRIES = 40;

export function buildToolRegistryBlock(params: BuildToolRegistryBlockParams): ContextBlock {
  const now = params.now ?? new Date();
  const entries = params.entries.slice(0, TOOL_REGISTRY_MAX_ENTRIES);
  const count = entries.length;
  const summary = `## Tools (${count} available)\n→ context_read('tool_registry') for full schema`;

  return {
    block_id: `tool-registry:${params.sessionId}`,
    block_type: "tool_registry",
    source_system: "cvk",
    session_id: params.sessionId,
    presence: {
      always_on: true,
      token_budget: TOOL_REGISTRY_TOKEN_BUDGET,
      priority: TOOL_REGISTRY_PRIORITY,
      on_demand: { expand_tool: "context_read", auto_register: true },
    },
    entities: [],
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary,
    full_content: JSON.stringify({ entries }),
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export interface HandleBeforeAgentStartToolRegistryParams {
  sessionId: string;
  entries: ToolRegistryEntry[];
  contextBlockSink?: ContextBlockSink;
  now?: Date;
}

export async function handleBeforeAgentStartToolRegistry(
  params: HandleBeforeAgentStartToolRegistryParams,
): Promise<{ accepted: boolean } | undefined> {
  if (!params.contextBlockSink) {
    return undefined;
  }
  const block = buildToolRegistryBlock({
    sessionId: params.sessionId,
    entries: params.entries,
    now: params.now,
  });
  const [result] = await params.contextBlockSink([
    { block, admission: { significance: "high", write_origin: "handler" } },
  ]);
  return result ? { accepted: result.accepted } : undefined;
}

export function formatToolRegistryInjection(block: ContextBlock | undefined): string | undefined {
  if (!block?.full_content) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(block.full_content) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) {
      return undefined;
    }
    const entries = parsed.entries.filter(isToolRegistryEntry);
    if (entries.length === 0) {
      return undefined;
    }
    return `## Tools (${entries.length} available)\n→ context_read('tool_registry') for full schema`;
  } catch {
    return undefined;
  }
}

function isToolRegistryEntry(value: unknown): value is ToolRegistryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.resourceId === "string" &&
    typeof record.title === "string"
  );
}
