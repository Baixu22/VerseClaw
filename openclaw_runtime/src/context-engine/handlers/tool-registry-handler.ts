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


export type ToolRegistryToolLike = {
  name?: string;
  label?: string;
  description?: string;
  displaySummary?: string;
  parameters?: unknown;
  risk?: string;
};

/**
 * Map production agent tools into ToolRegistryEntry[] for the tool_registry Block.
 * Uses name as resourceId, label/title heuristics for title, and description/displaySummary
 * (with a short schema property list) for purpose. Drops tools without a usable name.
 */
export function mapToolsToToolRegistryEntries(
  tools: ReadonlyArray<ToolRegistryToolLike> | undefined | null,
): ToolRegistryEntry[] {
  if (!tools || tools.length === 0) {
    return [];
  }
  const entries: ToolRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const title =
      (typeof tool.label === "string" && tool.label.trim()) ||
      humanizeToolName(name);
    const purpose = summarizeToolPurpose(tool);
    const category = typeof tool.risk === "string" && tool.risk.trim() ? tool.risk.trim() : undefined;
    entries.push({
      resourceId: name,
      kind: "toolset",
      title,
      purpose,
      ...(category ? { category } : {}),
    });
  }
  return entries;
}

function humanizeToolName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function summarizeToolPurpose(tool: ToolRegistryToolLike): string {
  const description =
    (typeof tool.description === "string" && tool.description.trim()) ||
    (typeof tool.displaySummary === "string" && tool.displaySummary.trim()) ||
    "";
  const schemaHint = summarizeSchemaProperties(tool.parameters);
  if (description && schemaHint) {
    return truncatePurpose(`${description} [${schemaHint}]`);
  }
  if (description) {
    return truncatePurpose(description);
  }
  if (schemaHint) {
    return truncatePurpose(`params: ${schemaHint}`);
  }
  return tool.name?.trim() || "tool";
}

function summarizeSchemaProperties(parameters: unknown): string | undefined {
  if (!parameters || typeof parameters !== "object") {
    return undefined;
  }
  const record = parameters as Record<string, unknown>;
  const props = record.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return undefined;
  }
  const keys = Object.keys(props as Record<string, unknown>).slice(0, 8);
  if (keys.length === 0) {
    return undefined;
  }
  return keys.join(", ");
}

function truncatePurpose(value: string, max = 200): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}?`;
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
