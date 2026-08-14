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
