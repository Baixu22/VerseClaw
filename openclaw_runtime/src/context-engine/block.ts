import type { RuntimeTaskStatus } from "../runtime-core/types.js";

export type BlockType =
  | "persona"
  | "task_state"
  | "working_memory"
  | "tool_registry"
  | "knowledge"
  | "experience"
  | "environment"
  | "notes";

export type SourceSystem =
  | "role-contract"
  | "compass"
  | "role-memory"
  | "sekb"
  | "cvk"
  | "task-loop"
  | "working-memory"
  // "codegraph" is a retired producer id (context-engine rebuild Task I); kept for stored-block compatibility.
  | "codegraph"
  | "agent-map"
  | "agent-notes";

export interface BlockPresence {
  always_on: boolean;
  token_budget?: number;
  priority?: number;
  on_demand?: {
    expand_tool: string;
    auto_register: boolean;
  };
  background?: boolean;
  /** C6 lifecycle overlay persisted via presence_json (archive not discard). */
  lifecycle_state?: "active" | "archived";
  archived_at?: string;
  heat?: number;
}

export type BlockMutability = "system_managed" | "agent_writable";

export type EntityExtractionStatus = "pending" | "failed" | "empty" | "success";

export type BlockFallbackMode = "vector_only";

export interface ContextBlock {
  block_id: string;
  block_type: BlockType;
  source_system: SourceSystem;
  session_id?: string;
  presence: BlockPresence;
  entities: string[];
  valid_at: Date;
  invalid_at?: Date;
  created_at?: Date;
  role_scope?: string[];
  mutability: BlockMutability;
  summary: string;
  full_content?: string;
  compression_depth: 0 | 1;
  entity_extraction_status: EntityExtractionStatus;
  fallback_mode?: BlockFallbackMode;
}

export interface HandoffPack {
  objective: string;
  current_phase: RuntimeTaskStatus;
  recent_actions: Array<{
    tool: string;
    result_summary: string;
    significance: "high" | "medium";
  }>;
  parent_session_id: string;
  /** C4-3: optional write-set coordinate (compatible with C3 empty semantics). */
  writeSet?: string[];
  /** C4-3: worktree id when isolation=worktree. */
  worktreeId?: string;
  /** Optional absolute/relative worktree root for diagnostics. */
  worktreeRoot?: string;
  /** C4-4: isolation mode (default shared when omitted). */
  isolation?: "shared" | "worktree";
  /**
   * B-3: structured entity snapshot carried across the session boundary.
   * Used as a *retrieval pointer* on restore (e.g. to seed context_understand
   * pre-fetch), not injected verbatim into the child prompt.
   */
  entity_snapshot?: EntitySnapshot;
}

/**
 * B-3: entity snapshot attached to a HandoffPack. Each list is capped at 20
 * entries so the snapshot stays bounded; the restore side only needs enough
 * identifiers to re-anchor the child, not the full corpus.
 */
export interface EntitySnapshot {
  /** Files the parent touched (paths, derived from the write-set when present). */
  files: string[];
  /** Symbol names the parent worked with (name-only identifiers). */
  symbols: string[];
  /** Distilled decisions: condition → action pairs from high-significance work. */
  decisions: Array<{
    condition: string;
    action: string;
  }>;
}

export const ENTITY_SNAPSHOT_CAP = 20;

export interface BlockAdmissionContext {
  significance?: "high" | "medium" | "low";
  confirmed?: boolean;
  confidence?: number;
  verification_status?: string;
  audn_state?: string;
  hint_entities?: string[];
  write_origin?: "context_write" | "handler";
  /** P3-002: resolved confirm integrity (never summary-elevated high_trust alone). */
  integrity?: "advisory" | "confirmed" | "high_trust";
  session_id?: string;
  provenance_source?: string;
  high_trust_eligible?: boolean;
}

export interface BlockWriteResult {
  accepted: boolean;
  reason?: string;
}

export interface ContextBlockWrite {
  block: ContextBlock;
  admission?: BlockAdmissionContext;
}

export type ContextBlockSink = (
  writes: readonly ContextBlockWrite[],
) => Promise<readonly BlockWriteResult[]>;
export interface BlockQuery {
  requester_session_id: string;
  session_id?: string;
  include_global?: boolean;
  block_types?: BlockType[];
  source_systems?: SourceSystem[];
  role_scope?: string;
  valid_at?: Date;
  presence_filter?: "always_on" | "on_demand" | "background";
  limit?: number;
}

export interface BlockEntityQuery extends BlockQuery {
  entities: string[];
}

export interface BlockStoreStats {
  source_system?: SourceSystem;
  total_blocks: number;
  valid_blocks: number;
  entity_extraction_status: Record<EntityExtractionStatus, number>;
  admission_rejections: number;
  authorization_rejections: number;
}

export interface BlockDeleteResult {
  deleted: number;
  remaining: number;
}

export interface BlockStoreApi {
  upsert(
    block: ContextBlock,
    admission?: BlockAdmissionContext,
  ): Promise<BlockWriteResult>;
  query(params: BlockQuery): Promise<ContextBlock[]>;
  queryByEntity(params: BlockEntityQuery): Promise<ContextBlock[]>;
  invalidate(block_id: string): Promise<void>;
  /** KS-02 owner API: enumerate every row owned by a source ref or session id. */
  enumerateBySource(sourceRef: string): Promise<ContextBlock[]>;
  enumerateBySession(sessionId: string): Promise<ContextBlock[]>;
  /** KS-02 owner API: hard-delete one block plus its entity map rows. */
  deleteBlock(blockId: string): Promise<number>;
  /** KS-02 owner API: hard-delete all blocks for a session and verify residual count. */
  deleteBySession(sessionId: string): Promise<BlockDeleteResult>;
  /** KS-02 owner API: invalidate all currently-valid blocks for a session. */
  invalidateBySession(sessionId: string): Promise<number>;
  stats(source_system?: SourceSystem): Promise<BlockStoreStats>;
}
