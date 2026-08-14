// R3-2.1: persist a sanitized memory-injection receipt through the approved
// ReceiptStore (typed append-only runtime_receipts). Observational: a write
// failure returns persisted=false and never throws into the send path, matching
// the RC-02 hard constraint "shadow write failure must not change send behavior".
import {
  ReceiptStore,
  type ReceiptCallIndex,
  type ReceiptIdentity,
} from "../agents/receipt-store.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import {
  buildMemoryInjectionReceiptInput,
  type MemoryInjectionReceiptSummary,
} from "./dcs-receipts.js";

export function persistMemoryInjectionReceipt(input: {
  identity: ReceiptIdentity;
  callIndex: ReceiptCallIndex;
  correlationDigest: string;
  summary: MemoryInjectionReceiptSummary;
  database?: OpenClawStateDatabaseOptions;
}): { persisted: boolean } {
  try {
    const store = new ReceiptStore(input.database ?? {});
    const result = store.put(
      buildMemoryInjectionReceiptInput({
        identity: input.identity,
        callIndex: input.callIndex,
        correlationDigest: input.correlationDigest,
        summary: input.summary,
      }),
    );
    return { persisted: result.ok === true };
  } catch {
    return { persisted: false };
  }
}

/**
 * Sanitized memory-injection receipt entry for the "本轮注入了什么" panel
 * (R3-2.2). Only refs, counts, and the producer source — never raw content.
 */
export type MemoryInjectionReceiptEntry = {
  sessionKey?: string | null;
  /** Producer source (the receipt adapter id). */
  source: string;
  selected: string[];
  omitted: string[];
  budgetCharsApplied: number;
  budgetCharsRequested: number;
  createdAt: number;
};

/**
 * Read memory-injection receipts for the panel. Observational: a read failure
 * returns [] and never throws (the panel shows the empty state).
 */
export function listMemoryInjectionReceipts(input: {
  sessionKey?: string;
  limit?: number;
  database?: OpenClawStateDatabaseOptions;
}): MemoryInjectionReceiptEntry[] {
  try {
    const store = new ReceiptStore(input.database ?? {});
    const rows = store.list({ kind: "context", limit: input.limit ?? 100 });
    return rows
      .filter((row) => row.idempotency_key.startsWith("memory:v1:"))
      .filter((row) => input.sessionKey === undefined || row.session_key === input.sessionKey)
      .map((row) => {
        let selected: string[] = [];
        let omitted: string[] = [];
        let budget: { charsApplied?: unknown; charsRequested?: unknown } = {};
        try {
          if (row.selected_json) selected = JSON.parse(row.selected_json) as string[];
          if (row.omitted_json) omitted = JSON.parse(row.omitted_json) as string[];
          if (row.budget_json) budget = JSON.parse(row.budget_json) as typeof budget;
        } catch {
          // Malformed projection: keep empty arrays/counts instead of raw bytes.
        }
        const charsApplied =
          typeof budget.charsApplied === "number" && Number.isFinite(budget.charsApplied)
            ? budget.charsApplied
            : 0;
        const charsRequested =
          typeof budget.charsRequested === "number" && Number.isFinite(budget.charsRequested)
            ? budget.charsRequested
            : 0;
        return {
          sessionKey: row.session_key,
          source: row.adapter_id ?? "unknown",
          selected,
          omitted,
          budgetCharsApplied: charsApplied,
          budgetCharsRequested: charsRequested,
          createdAt: row.created_at,
        };
      });
  } catch {
    return [];
  }
}
