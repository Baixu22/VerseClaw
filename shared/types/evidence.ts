/**
 * Canonical EvidenceRef type — the single source of truth for evidence reference schema.
 *
 * Context: Round 2 design (Blocker 2 resolution). The codebase previously had 7
 * different EvidenceRef types (TaskLedgerEvidenceRef, MissionEvidenceRef,
 * MemoryEvidenceRef, LongTaskEvidenceRef, ClawGraphEvidenceRef,
 * LocalControlPlaneEvidenceRef, CompressionEvidenceRef), each with slightly
 * different `type` enums and optional fields.
 *
 * This canonical type is the **superset** — the union of all `type` values and
 * optional fields across those 7 types. Existing area-specific types are NOT
 * migrated (additive-only); they remain in their respective modules for
 * backward compatibility. New code (A4 DecisionQualityReport, A2/A3/A6
 * Round-2 additions) MUST use this canonical type.
 *
 * Ownership: This file is the schema owner. No area-specific module may define
 * a competing `EvidenceRef` type. Existing types are grandfathered but any new
 * evidence ref type must be added here.
 *
 * See: docs/runtime-design/development-manual.md §1.1 (Shared Foundation Modules)
 */

/** Union of all evidence source types across the codebase. */
export type EvidenceRefType =
  | 'session'
  | 'trace'
  | 'file'
  | 'memory'
  | 'manual'
  | 'tool'
  | 'other'
  // Mission-specific
  | 'task_loop'
  | 'clawgraph'
  | 'task_ledger'
  // Memory-specific
  | 'memory_search'
  | 'memory_md'
  | 'qmd'
  | 'dream'
  // ClawGraph-specific
  | 'subagent';

/**
 * Canonical evidence reference. Carries the superset of optional fields so any
 * existing area-specific EvidenceRef can be projected into this shape without
 * data loss.
 *
 * Field semantics:
 * - `type`: the source category of the evidence
 * - `ref`: the opaque identifier within that category (e.g., file path, trace id)
 * - `label?`: human-readable display name
 * - `summary?`: short description of what the evidence says
 * - `excerpt?`: verbatim excerpt from the source (memory-specific)
 * - `metadata?`: structured key-value pairs (LCP-specific, sanitized)
 */
export type EvidenceRef = {
  type: EvidenceRefType;
  ref: string;
  label?: string;
  summary?: string;
  excerpt?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Type guard: does an unknown value look like an EvidenceRef?
 * Used by LCP sanitization and A4 evaluator input validation.
 */
export function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && typeof obj.ref === 'string';
}
