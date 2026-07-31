/**
 * Shared types for the Verse Token (vtoken) Working Context assembly bridge.
 *
 * VT is a foundation library hosted as a long-lived Python worker.
 * It does NOT replace DCS ContextBlock / BlockStore / compaction / memory stores.
 * Opt-in production assembly can inject ## Working Context on agent turns (default OFF).
 * The host-api bridge is also default OFF and remains available for diagnostics / smoke.
 */


export type VtokenRenderMode = 'compact' | 'dense' | 'verbose';

export type VtokenSlotBreakdown = Record<
  string,
  { tokens?: number; nodes?: number; [key: string]: unknown }
>;

/** Mirror of Python AssembleResult fields returned by vt.assemble. */
export type VtokenAssembleResult = {
  prompt: string;
  tokens_used: number;
  tokens_budget: number;
  slot_breakdown: VtokenSlotBreakdown;
  nodes_included: string[];
  nodes_evicted: string[];
  dedup_count: number;
};

export type VtokenStoreStats = {
  doc_nodes: number;
  doc_edges: number;
  mem_nodes: number;
  parts_by_type: Record<string, number>;
};

export type VtokenPingResult = {
  success: boolean;
  disabled?: boolean;
  error?: string;
  ok?: boolean;
  version?: string;
  opened?: boolean;
  workerPid?: number | null;
  enabled?: boolean;
  running?: boolean;
};

export type VtokenOpenPayload = {
  docSources?: string[];
  /** Optional MemStore session (not required for P0 doc-only assemble). */
  sessionDir?: string;
  session?: string;
};

export type VtokenOpenResult = {
  success: boolean;
  disabled?: boolean;
  error?: string;
  ok?: boolean;
  doc_sources?: string[];
  session?: string | null;
  stats?: VtokenStoreStats;
};

export type VtokenIngestPathPayload = {
  path: string;
  sourceType?: 'auto' | 'md' | 'json' | string;
};

export type VtokenIngestMarkdownPayload = {
  text: string;
  sourcePath?: string;
};

export type VtokenIngestToolsPayload = {
  schemas: Array<Record<string, unknown>>;
  serverName?: string;
};

export type VtokenIngestMemoryPayload = {
  entries: Array<{ id?: string; content?: string; tags?: string[]; [key: string]: unknown }>;
};

export type VtokenIngestResult = {
  success: boolean;
  disabled?: boolean;
  error?: string;
  ok?: boolean;
  nodes_added?: number;
  stats?: VtokenStoreStats;
};

export type VtokenAssemblePayload = {
  taskHint: string;
  budgetTokens?: number;
  renderMode?: VtokenRenderMode;
  /** Advanced: raw SlotConfig map; omit for DEFAULT_SLOTS. */
  slots?: Record<string, unknown>;
};

export type VtokenAssembleHostResult = {
  success: boolean;
  disabled?: boolean;
  error?: string;
  ok?: boolean;
  result?: VtokenAssembleResult;
  durationMs?: number;
};

export type VtokenStatsResult = {
  success: boolean;
  disabled?: boolean;
  error?: string;
  ok?: boolean;
  stats?: VtokenStoreStats;
};

export type VtokenCloseResult = {
  success: boolean;
  disabled?: boolean;
  error?: string;
  ok?: boolean;
};

export type VtokenSetEnabledPayload = { enabled: boolean };

export type VtokenSetEnabledResult = {
  success: boolean;
  enabled: boolean;
};

export type VtokenStatusResult = {
  success: boolean;
  disabled?: boolean;
  enabled: boolean;
  running: boolean;
  workerPid: number | null;
  opened: boolean;
  version?: string;
  lastAssemble?: {
    tokens_used: number;
    tokens_budget: number;
    nodes_included: number;
    nodes_evicted: number;
    durationMs: number;
    at: string;
  } | null;
  packageRoot?: string | null;
  error?: string;
};
