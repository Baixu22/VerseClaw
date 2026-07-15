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
}

export interface BlockAdmissionContext {
  significance?: "high" | "medium" | "low";
  confirmed?: boolean;
  confidence?: number;
  verification_status?: string;
  audn_state?: string;
  hint_entities?: string[];
  write_origin?: "context_write" | "handler";
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

export interface BlockStoreApi {
  upsert(
    block: ContextBlock,
    admission?: BlockAdmissionContext,
  ): Promise<BlockWriteResult>;
  query(params: BlockQuery): Promise<ContextBlock[]>;
  queryByEntity(params: BlockEntityQuery): Promise<ContextBlock[]>;
  invalidate(block_id: string): Promise<void>;
  stats(source_system?: SourceSystem): Promise<BlockStoreStats>;
}
