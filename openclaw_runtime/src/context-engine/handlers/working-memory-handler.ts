import type { ContextBlock } from "../block.js";

export type WorkingMemorySignificance = "high" | "medium";

export interface WorkingMemoryAction {
  tool: string;
  result_summary: string;
  significance: WorkingMemorySignificance;
}

export interface HandleWorkingMemoryActionParams {
  sessionId: string;
  action: WorkingMemoryAction;
  now?: Date;
  existingBlock?: ContextBlock;
}

const MAX_WORKING_MEMORY_ACTIONS = 5;

export function handleWorkingMemoryAction(params: HandleWorkingMemoryActionParams): ContextBlock {
  const now = params.now ?? new Date();
  const actions = [...parseWorkingMemoryActions(params.existingBlock), params.action];
  const retained = trimWorkingMemoryActions(actions);
  const summary = retained.at(-1)?.result_summary ?? "Recent actions";

  return {
    block_id: `working-memory:${params.sessionId}`,
    block_type: "working_memory",
    source_system: "working-memory",
    session_id: params.sessionId,
    presence: { always_on: false, background: true },
    entities: [],
    valid_at: now,
    created_at: params.existingBlock?.created_at ?? now,
    mutability: "system_managed",
    summary,
    full_content: JSON.stringify({ actions: retained }),
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export function parseWorkingMemoryActions(
  block: ContextBlock | undefined,
): WorkingMemoryAction[] {
  if (!block?.full_content) {
    return [];
  }
  try {
    const parsed = JSON.parse(block.full_content) as { actions?: unknown };
    if (!Array.isArray(parsed.actions)) {
      return [];
    }
    return parsed.actions.filter(isWorkingMemoryAction);
  } catch {
    return [];
  }
}

function trimWorkingMemoryActions(actions: WorkingMemoryAction[]): WorkingMemoryAction[] {
  const retained = [...actions];
  while (retained.length > MAX_WORKING_MEMORY_ACTIONS) {
    const mediumIndex = retained.findIndex((action) => action.significance === "medium");
    retained.splice(mediumIndex >= 0 ? mediumIndex : 0, 1);
  }
  return retained;
}

function isWorkingMemoryAction(value: unknown): value is WorkingMemoryAction {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.tool === "string" &&
    record.tool.trim().length > 0 &&
    typeof record.result_summary === "string" &&
    record.result_summary.trim().length > 0 &&
    (record.significance === "high" || record.significance === "medium")
  );
}