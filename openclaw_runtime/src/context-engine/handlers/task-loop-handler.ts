/**
 * DCS Stage 2 task-loop handler.
 *
 * Converts a task_phase_change event into a system-managed task_state Block
 * write through ContextBlockSink/BlockStore. Does not access SQLite directly,
 * format prompts, or create a second state store.
 *
 * The handler produces exactly one task_state Block per true phase transition,
 * containing a HandoffPack with { objective, current_phase, recent_actions,
 * parent_session_id }.
 */
import type { RuntimeTaskStatus } from "../../runtime-core/types.js";
import type {
  ContextBlock,
  ContextBlockSink,
  HandoffPack,
} from "../block.js";
import type { BlockStoreApi } from "../block.js";
import { parseHandoffPack } from "../block-store.js";
import type { WorkingMemoryAction } from "./working-memory-handler.js";
import { parseWorkingMemoryActions } from "./working-memory-handler.js";

export interface TaskPhaseChangeEvent {
  sessionId: string;
  taskId: string;
  fromStatus: RuntimeTaskStatus;
  toStatus: RuntimeTaskStatus;
}

export interface HandleTaskPhaseChangeParams {
  event: TaskPhaseChangeEvent;
  objective: string;
  parentSessionId?: string;
  workingMemoryStore?: Pick<BlockStoreApi, "query">;
  contextBlockSink?: ContextBlockSink;
  now?: Date;
}

/**
 * Handle a task_phase_change event by producing a system-managed task_state
 * Block write. The Block contains a HandoffPack with the current phase,
 * objective, recent actions (from persisted working-memory), and parent
 * session id.
 *
 * Returns the write result, or undefined if no sink is available.
 */
export async function handleTaskPhaseChange(
  params: HandleTaskPhaseChangeParams,
): Promise<{ accepted: boolean } | undefined> {
  const sink = params.contextBlockSink;
  if (!sink) {
    return undefined;
  }

  const now = params.now ?? new Date();
  const sessionId = params.event.sessionId;

  // Gather recent actions from persisted working-memory Blocks
  const recentActions = await gatherRecentActions(
    sessionId,
    params.workingMemoryStore,
  );

  const handoffPack: HandoffPack = {
    objective: params.objective.slice(0, 2000),
    current_phase: params.event.toStatus,
    recent_actions: recentActions.slice(0, 5),
    parent_session_id: params.parentSessionId ?? sessionId,
  };

  const block: ContextBlock = {
    block_id: `task-state:${sessionId}:${params.event.taskId}`,
    block_type: "task_state",
    source_system: "task-loop",
    session_id: sessionId,
    presence: { always_on: false, on_demand: { expand_tool: "context_read", auto_register: false } },
    entities: [],
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: `Phase: ${params.event.toStatus}`,
    full_content: JSON.stringify(handoffPack),
    compression_depth: 0,
    entity_extraction_status: "empty",
  };

  const results = await sink([
    {
      block,
      admission: { significance: "high", write_origin: "handler" },
    },
  ]);
  const result = results[0];
  return result ? { accepted: result.accepted } : undefined;
}

/**
 * Gather recent high/medium working-memory actions for the HandoffPack.
 * Reads only from accepted, persisted working-memory Blocks.
 */
async function gatherRecentActions(
  sessionId: string,
  store?: Pick<BlockStoreApi, "query">,
): Promise<WorkingMemoryAction[]> {
  if (!store) {
    return [];
  }
  const blocks = await store.query({
    requester_session_id: sessionId,
    session_id: sessionId,
    block_types: ["working_memory"],
    source_systems: ["working-memory"],
    limit: 1,
  });
  const actions = parseWorkingMemoryActions(blocks[0]);
  return actions.filter((a) => a.significance === "high" || a.significance === "medium");
}

/**
 * Determine whether a phase transition is terminal (should trigger SEKB
 * trajectory capture).
 */
export function isTerminalPhase(status: RuntimeTaskStatus): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Fixed context_read instruction injected as prependContext for child sessions.
 * Contains no HandoffPack JSON, Block ids, transcript excerpt, or raw tool output.
 */
export const CHILD_CONTEXT_READ_INSTRUCTION =
  "Before starting your task, use the context_read tool to read your task_state Block for your objective, current phase, recent actions, and parent session context.";

/**
 * Build a HandoffPack for a child session from the parent's current state.
 * Gathers recent actions from the parent's persisted working-memory, then
 * builds a HandoffPack with the parent as the parent_session_id.
 */
export async function buildChildHandoffFromParent(params: {
  parentSessionKey: string;
  objective: string;
  currentPhase: RuntimeTaskStatus;
  workingMemoryStore?: Pick<BlockStoreApi, "query">;
}): Promise<HandoffPack> {
  const recentActions = await gatherRecentActions(
    params.parentSessionKey,
    params.workingMemoryStore,
  );
  return buildChildHandoffPack({
    objective: params.objective,
    currentPhase: params.currentPhase,
    recentActions,
    parentSessionId: params.parentSessionKey,
  });
}

/**
 * Build a HandoffPack for a child session. The parent writes this to the
 * child session key before spawning the child.
 */
export function buildChildHandoffPack(params: {
  objective: string;
  currentPhase: RuntimeTaskStatus;
  recentActions: WorkingMemoryAction[];
  parentSessionId: string;
}): HandoffPack {
  return {
    objective: params.objective.slice(0, 2000),
    current_phase: params.currentPhase,
    recent_actions: params.recentActions
      .filter((a) => a.significance === "high" || a.significance === "medium")
      .slice(0, 5),
    parent_session_id: params.parentSessionId,
  };
}

/**
 * Write a child task_state Block before spawn. The child session key is the
 * target. The parent session id is the writer.
 */
export async function writeChildHandoffPack(params: {
  childSessionKey: string;
  handoffPack: HandoffPack;
  contextBlockSink?: ContextBlockSink;
  now?: Date;
}): Promise<{ accepted: boolean } | undefined> {
  const sink = params.contextBlockSink;
  if (!sink) {
    return undefined;
  }
  const now = params.now ?? new Date();
  const block: ContextBlock = {
    block_id: `task-state:${params.childSessionKey}`,
    block_type: "task_state",
    source_system: "task-loop",
    session_id: params.childSessionKey,
    presence: { always_on: false, on_demand: { expand_tool: "context_read", auto_register: false } },
    entities: [],
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: `Phase: ${params.handoffPack.current_phase}`,
    full_content: JSON.stringify(params.handoffPack),
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
  const results = await sink([
    {
      block,
      admission: { significance: "high", write_origin: "handler" },
    },
  ]);
  const result = results[0];
  return result ? { accepted: result.accepted } : undefined;
}

/**
 * Restore child state from BlockStore during before_agent_start.
 * Reads only the child session's current task_state Block.
 */
export async function restoreChildState(params: {
  childSessionKey: string;
  store: Pick<BlockStoreApi, "query">;
}): Promise<HandoffPack | undefined> {
  const blocks = await params.store.query({
    requester_session_id: params.childSessionKey,
    session_id: params.childSessionKey,
    block_types: ["task_state"],
    source_systems: ["task-loop"],
    limit: 1,
  });
  const block = blocks[0];
  if (!block?.full_content) {
    return undefined;
  }
  return parseHandoffPack(block.full_content);
}
