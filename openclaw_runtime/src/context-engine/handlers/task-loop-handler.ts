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
  EntitySnapshot,
  HandoffPack,
} from "../block.js";
import { ENTITY_SNAPSHOT_CAP } from "../block.js";
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
 * B-3: gather a structured entity snapshot for a HandoffPack, derived from the
 * write-set and recent high-significance actions, optionally merged with
 * external sources (FactStore symbols / SEKB decisions — see
 * `buildChildHandoffFromParent`).
 *
 *   - `files`   — the write-set paths (bounded).
 *   - `symbols` — identifier-like tokens extracted from action summaries
 *                 (camelCase/PascalCase words and dotted paths), merged with
 *                 any externally-supplied symbol names.
 *   - `decisions` — condition → action pairs distilled from high-significance
 *                 actions, merged with externally-supplied decisions
 *                 (deduplicated by condition+action).
 *
 * The snapshot is a *retrieval pointer* for the restore side, not context text.
 */
export function gatherEntitySnapshot(params: {
  writeSet?: readonly string[];
  recentActions?: readonly WorkingMemoryAction[];
  /** B-3 v2: externally extracted symbols (e.g. FactStore), merged with derived. */
  symbols?: readonly string[];
  /** B-3 v2: externally sourced decisions (e.g. SEKB principles), merged with derived. */
  decisions?: ReadonlyArray<EntitySnapshot["decisions"][number]>;
}): EntitySnapshot | undefined {
  const files = (params.writeSet ?? [])
    .filter((file) => typeof file === "string" && file.trim().length > 0)
    .slice(0, ENTITY_SNAPSHOT_CAP);
  const derivedSymbols = new Set<string>();
  for (const action of params.recentActions ?? []) {
    for (const token of identifierTokens(action.result_summary)) {
      derivedSymbols.add(token);
      if (derivedSymbols.size >= ENTITY_SNAPSHOT_CAP) break;
    }
    if (derivedSymbols.size >= ENTITY_SNAPSHOT_CAP) break;
  }
  const symbols = new Set<string>(derivedSymbols);
  for (const symbol of params.symbols ?? []) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) continue;
    symbols.add(symbol.trim().slice(0, 512));
    if (symbols.size >= ENTITY_SNAPSHOT_CAP) break;
  }
  const derivedDecisions = (params.recentActions ?? [])
    .filter((action) => action.significance === "high")
    .map((action) => ({
      condition: `${action.tool} succeeded`,
      action: action.result_summary,
    }));
  const decisionKeys = new Set<string>();
  const decisions: EntitySnapshot["decisions"] = [];
  for (const decision of [...derivedDecisions, ...(params.decisions ?? [])]) {
    if (!decision || typeof decision.condition !== "string" || typeof decision.action !== "string") {
      continue;
    }
    const key = `${decision.condition.slice(0, 100)}::${decision.action.slice(0, 100)}`;
    if (decisionKeys.has(key)) continue;
    decisionKeys.add(key);
    decisions.push({ condition: decision.condition, action: decision.action });
    if (decisions.length >= ENTITY_SNAPSHOT_CAP) break;
  }
  if (files.length === 0 && symbols.size === 0 && decisions.length === 0) {
    return undefined;
  }
  return {
    files: [...files],
    symbols: [...symbols],
    decisions,
  };
}

/**
 * Extract identifier-like tokens from a summary: dotted paths (e.g.
 * `src/auth/middleware.ts`) and camelCase/PascalCase words. Deterministic,
 * no external deps.
 */
function identifierTokens(summary: string): string[] {
  const out = new Set<string>();
  // Dotted / slashed paths, then camelCase words.
  const pathPattern = /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|go|rs|java|css|md|vue|svelte)\b/g;
  for (const match of summary.matchAll(pathPattern)) {
    out.add(match[0].slice(0, 200));
  }
  const wordPattern = /\b[A-Z][a-zA-Z0-9]{2,}\b|\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]+\b/g;
  for (const match of summary.matchAll(wordPattern)) {
    out.add(match[0].slice(0, 100));
  }
  return [...out];
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

  const entitySnapshot = gatherEntitySnapshot({ recentActions });
  const handoffPack: HandoffPack = {
    objective: params.objective.slice(0, 2000),
    current_phase: params.event.toStatus,
    recent_actions: recentActions.slice(0, 5),
    parent_session_id: params.parentSessionId ?? sessionId,
    ...(entitySnapshot ? { entity_snapshot: entitySnapshot } : {}),
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
 * B-3 v2: externally extract symbols for a workspace's files via the FactStore
 * bridge. Returns the bounded symbol names (camelCase identifiers), or an empty
 * list when no workspace/bridge is available or the store has nothing for the
 * files. Callers must wrap this in try/catch — FactStore materialization is
 * best-effort and must never break a handoff write.
 */
export function gatherWorkspaceSymbols(params: {
  workspaceDir?: string;
  files: readonly string[];
  bridgeFactory?: (workspaceRoot: string) => { symbolOverviews(query: { activeFiles?: string[] }): Array<{ symbols: Array<{ name: string }> }> };
}): string[] {
  if (!params.workspaceDir || params.files.length === 0 || !params.bridgeFactory) {
    return [];
  }
  try {
    const overviews = params.bridgeFactory(params.workspaceDir).symbolOverviews({
      activeFiles: [...params.files],
    });
    const out: string[] = [];
    for (const overview of overviews ?? []) {
      for (const symbol of overview.symbols ?? []) {
        if (typeof symbol?.name !== "string" || symbol.name.trim().length === 0) continue;
        out.push(symbol.name.trim().slice(0, 200));
        if (out.length >= ENTITY_SNAPSHOT_CAP) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * B-3 v2: externally gather distilled decisions from the SEKB knowledge store —
 * active principles ordered by adoption (most-adopted first), bounded. Returns
 * an empty list when no store is available. Callers must wrap in try/catch.
 */
export function gatherSekbDecisions(params: {
  store?: { query_principles(filters: { status: "active" }): Array<{ condition: string; action: string; adoption_count: number }> };
}): EntitySnapshot["decisions"] {
  if (!params.store) {
    return [];
  }
  try {
    const principles = params.store.query_principles({ status: "active" }) ?? [];
    return principles
      .sort((a, b) => (b.adoption_count ?? 0) - (a.adoption_count ?? 0))
      .slice(0, ENTITY_SNAPSHOT_CAP)
      .filter((principle) => typeof principle?.condition === "string" && typeof principle?.action === "string")
      .map((principle) => ({
        condition: principle.condition.slice(0, 200),
        action: principle.action.slice(0, 500),
      }));
  } catch {
    return [];
  }
}

/**
 * Build a HandoffPack for a child session from the parent's current state.
 * Gathers recent actions from the parent's persisted working-memory, then
 * builds a HandoffPack with the parent as the parent_session_id.
 *
 * B-3 v2: when `workspaceDir` and a `bridgeFactory` are supplied, symbols for
 * the write-set files are pulled from the FactStore and merged into the entity
 * snapshot; when a `sekbStore` is supplied, the most-adopted active principles
 * are merged as decisions. Both are best-effort and failure-safe.
 */
export async function buildChildHandoffFromParent(params: {
  parentSessionKey: string;
  objective: string;
  currentPhase: RuntimeTaskStatus;
  workingMemoryStore?: Pick<BlockStoreApi, "query">;
  /** C4-3: optional write-set coordinate forwarded into the child pack. */
  writeSet?: string[];
  /** B-3 v2: workspace root used to resolve FactStore symbols (optional). */
  workspaceDir?: string;
  /** B-3 v2: FactStore bridge factory for symbol extraction (optional). */
  bridgeFactory?: (workspaceRoot: string) => { symbolOverviews(query: { activeFiles?: string[] }): Array<{ symbols: Array<{ name: string }> }> };
  /** B-3 v2: SEKB knowledge store for distilled decisions (optional). */
  sekbStore?: { query_principles(filters: { status: "active" }): Array<{ condition: string; action: string; adoption_count: number }> };
}): Promise<HandoffPack> {
  const recentActions = await gatherRecentActions(
    params.parentSessionKey,
    params.workingMemoryStore,
  );
  const files = (params.writeSet ?? []).slice(0, ENTITY_SNAPSHOT_CAP);
  const symbols = gatherWorkspaceSymbols({
    workspaceDir: params.workspaceDir,
    files,
    bridgeFactory: params.bridgeFactory,
  });
  const decisions = gatherSekbDecisions({ store: params.sekbStore });
  return buildChildHandoffPack({
    objective: params.objective,
    currentPhase: params.currentPhase,
    recentActions,
    parentSessionId: params.parentSessionKey,
    writeSet: params.writeSet,
    symbols,
    decisions,
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
  /** C4-3/C3: optional write-set coordinate (empty/absent = no constraint). */
  writeSet?: string[];
  /** C4-3: worktree id when isolation=worktree. */
  worktreeId?: string;
  /** Optional worktree root for diagnostics. */
  worktreeRoot?: string;
  /** C4-4: isolation mode (default shared when omitted). */
  isolation?: "shared" | "worktree";
  /** B-3 v2: externally extracted symbols merged into the entity snapshot. */
  symbols?: readonly string[];
  /** B-3 v2: externally sourced decisions merged into the entity snapshot. */
  decisions?: ReadonlyArray<EntitySnapshot["decisions"][number]>;
}): HandoffPack {
  const entitySnapshot = gatherEntitySnapshot({
    writeSet: params.writeSet,
    recentActions: params.recentActions,
    symbols: params.symbols,
    decisions: params.decisions,
  });
  return {
    objective: params.objective.slice(0, 2000),
    current_phase: params.currentPhase,
    recent_actions: params.recentActions
      .filter((a) => a.significance === "high" || a.significance === "medium")
      .slice(0, 5),
    parent_session_id: params.parentSessionId,
    ...(params.writeSet !== undefined ? { writeSet: [...params.writeSet] } : {}),
    ...(params.worktreeId ? { worktreeId: params.worktreeId } : {}),
    ...(params.worktreeRoot ? { worktreeRoot: params.worktreeRoot } : {}),
    ...(params.isolation ? { isolation: params.isolation } : {}),
    ...(entitySnapshot ? { entity_snapshot: entitySnapshot } : {}),
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
