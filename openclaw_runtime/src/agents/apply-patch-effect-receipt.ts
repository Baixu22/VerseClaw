/**
 * S1: correlate one apply_patch batch with the RC-04 effect receipt store.
 *
 * Why this is not a second store. VS-P3-01's preview store is a bounded
 * process-local Map: right for a hot-path commit gate, useless as an audit
 * record — it holds 32 entries, has no state machine, no idempotency key, no
 * expiry and does not survive a restart. RC-04 already owns the durable half
 * (`effect_receipts`: idempotency key, digest-only privacy, append-only,
 * identical-content vs content-conflict), and `effect-receipt.ts` says in its own
 * header that it "explains and correlates domain-journal outcomes; it never
 * authorizes replay" — written for exactly a domain journal like
 * `tools/write-journal.ts`. So the two are not competitors: the Map is the gate's
 * cache, the receipt is the record.
 *
 * Two properties this module must keep, both inherited rather than invented:
 *
 * - **No new flag.** A receipt is written only when the batch produced journal
 *   evidence, and `createJournalEntries` returns `[]` whenever
 *   `runtime.coding.writeJournal.enabled` is off. No journal, nothing to
 *   correlate, no receipt — and the rollback is the one already documented for
 *   that flag in `shared/dcs/prod-flags-catalog.ts`.
 * - **Fail-open.** `write-journal.ts` states that journal failures never block the
 *   write path; a correlation record is strictly weaker than the journal, so it
 *   must never block one either. Every failure here is swallowed.
 */
import type { ApplyPatchSummary } from "./apply-patch-types.js";
// Type-only, so it is erased at build time and introduces no module cycle — the
// same arrangement `apply-patch-preflight-support.ts` already uses for this union.
import type { PatchBatchState } from "./apply-patch-preflight.js";

/** The subset of journal evidence a receipt needs, so the caller can pass a plain view. */
export type EffectReceiptJournalView = {
  batchId: string;
  batchState: PatchBatchState;
  undoable: boolean;
  preview?: {
    previewId: string;
    changeSummaryDigest: string;
    /** AC-3: the diff artifacts this approval and change summary stand for. */
    diffArtifacts?: readonly string[];
  };
  snapshots: ReadonlyArray<{ journalEntryId: string }>;
};

/** RC-04 outcome vocabulary, restated so this module does not import the store for a type. */
export type ApplyPatchEffectOutcome = "applied" | "not_applied" | "unknown";

export type ApplyPatchEffectReceipt = {
  idempotencyKey: string;
  approvalId?: string;
  proposal: Record<string, unknown>;
  domainExecutor: "clawx-write-journal";
  outcome: ApplyPatchEffectOutcome;
  artifactRef?: string;
  journalRef?: string;
  recoverability: string;
};

/** RC-04's artifact_ref is one column, so several handles are joined under a bound. */
const MAX_ARTIFACT_REF_CHARS = 512;

/**
 * Join the preview's diff artifact handles into the single `artifact_ref` column.
 *
 * Truncation is annotated rather than silent: `+N` says how many handles did not
 * fit, so a reader can tell a complete reference from a clipped one. The full,
 * untruncated list still goes into `proposal`, which the store digests — so the
 * receipt commits to every handle even when the readable column shows a prefix.
 */
export function joinArtifactRefs(handles: readonly string[]): string | undefined {
  if (handles.length === 0) return undefined;
  const kept: string[] = [];
  let length = 0;
  for (const handle of handles) {
    const next = length === 0 ? handle.length : length + 1 + handle.length;
    if (next > MAX_ARTIFACT_REF_CHARS) break;
    kept.push(handle);
    length = next;
  }
  if (kept.length === 0) return `+${handles.length}`;
  const hidden = handles.length - kept.length;
  return hidden > 0 ? `${kept.join(",")},+${hidden}` : kept.join(",");
}

/**
 * `prepared` yields no receipt: nothing has happened yet, and a receipt for a
 * batch that never reached the mutation loop would assert an effect that does not
 * exist. `recovery_required` maps to `unknown` rather than `applied` — RC-04
 * parks an unknown outcome in `needs_reconciliation` and never auto-replays it,
 * which is the correct handling for a batch whose rollback did not complete.
 */
export function effectOutcomeForBatchState(
  state: PatchBatchState,
): ApplyPatchEffectOutcome | null {
  switch (state) {
    case "committed":
      return "applied";
    case "rolled_back":
      return "not_applied";
    case "recovery_required":
      return "unknown";
    default:
      return null;
  }
}

/**
 * Build the receipt for one batch, or null when the batch does not warrant one.
 *
 * `proposal` is only ever hashed by the store (`effectProposalDigest`), so it
 * carries the change shape and never file contents. The preview's own digest goes
 * in as a field so a later reader can tie the receipt back to the preview that
 * authorised the write, without the raw preview record having to survive.
 */
export function buildApplyPatchEffectReceipt(params: {
  journal: EffectReceiptJournalView;
  summary: ApplyPatchSummary;
  recoveryRef?: string;
}): ApplyPatchEffectReceipt | null {
  const outcome = effectOutcomeForBatchState(params.journal.batchState);
  if (!outcome) return null;
  const preview = params.journal.preview;
  const journalRef = params.journal.snapshots[0]?.journalEntryId;
  const artifacts = preview?.diffArtifacts ?? [];
  const artifactRef = joinArtifactRefs(artifacts);
  return {
    idempotencyKey: `apply_patch:${params.journal.batchId}`,
    ...(preview ? { approvalId: preview.previewId } : {}),
    proposal: {
      batchId: params.journal.batchId,
      added: [...params.summary.added].toSorted(),
      modified: [...params.summary.modified].toSorted(),
      deleted: [...params.summary.deleted].toSorted(),
      previewDigest: preview?.changeSummaryDigest ?? null,
      // Every handle, untruncated: the digest commits to the full set even when
      // artifact_ref only has room for a prefix.
      diffArtifacts: [...artifacts].toSorted(),
      snapshotCount: params.journal.snapshots.length,
    },
    domainExecutor: "clawx-write-journal",
    outcome,
    ...(artifactRef ? { artifactRef } : {}),
    ...(journalRef ? { journalRef } : {}),
    recoverability: recoverabilityFor(params),
  };
}

function recoverabilityFor(params: {
  journal: EffectReceiptJournalView;
  recoveryRef?: string;
}): string {
  if (params.recoveryRef) return `recovery_required:${params.recoveryRef}`;
  return params.journal.undoable ? "undo_write" : "none";
}

/** Narrow view of the store, so tests do not need SQLite and the import stays lazy. */
export type EffectReceiptSink = {
  record: (input: {
    idempotencyKey: string;
    approvalId?: string;
    proposal: Record<string, unknown>;
    domainExecutor: string;
    outcome: ApplyPatchEffectOutcome;
    artifactRef?: string;
    journalRef?: string;
    recoverability: string;
  }) => unknown;
};

let cachedSink: EffectReceiptSink | undefined;
/** Bounds the warning below to one line per interval, so a broken store cannot flood. */
let lastSinkWarningMs = 0;
const SINK_WARNING_INTERVAL_MS = 60_000;

/**
 * Resolve the real store on first use, and keep trying after a failure.
 *
 * Imported lazily on purpose: the generic apply_patch write path should not pull
 * SQLite and kysely into its module graph for a record it may never write, and a
 * store that cannot open must not turn into a write-path failure.
 *
 * A failure is deliberately *not* cached. `EffectReceiptStore`'s constructor is
 * not lazy — it touches SQLite through `ensureEffectReceiptsShape` — so a failure
 * can be transient: a state dir not yet created, a briefly locked database. A
 * sticky failure would promote one transient fault into an audit trail that is
 * silently empty for the rest of the process, which is the accountability failure
 * OWASP's logging guidance names directly ("enable processes to detect whether
 * logging has stopped"). Retrying costs nothing measurable: ESM caches the module,
 * so a second attempt only re-runs an idempotent schema check.
 */
async function resolveSink(): Promise<EffectReceiptSink | null> {
  if (cachedSink !== undefined) return cachedSink;
  try {
    const { EffectReceiptStore } = await import("./effect-receipt.js");
    cachedSink = new EffectReceiptStore() as EffectReceiptSink;
    return cachedSink;
  } catch (error) {
    // The same guidance requires the failure be visible while still not blocking
    // the write. One rate-limited line is the minimum that satisfies both.
    const now = Date.now();
    if (now - lastSinkWarningMs >= SINK_WARNING_INTERVAL_MS) {
      lastSinkWarningMs = now;
      console.warn(
        `[apply-patch] effect receipt store unavailable; no audit receipt for this batch: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
}

/** Test seam. Pass undefined to force the next call to resolve the real store. */
export function __setEffectReceiptSink(sink: EffectReceiptSink | undefined): void {
  cachedSink = sink;
  lastSinkWarningMs = 0;
}

/**
 * Record the batch's correlation receipt.
 *
 * Awaited by the caller rather than fired and forgotten: the insert is a local
 * SQLite write on a path that has already done file I/O, and an audit record that
 * can be lost to a process exit is not worth having. It resolves in every case —
 * a store that cannot open, or an insert that throws, is swallowed here, because
 * correlation is strictly weaker than the journal it explains.
 */
export async function recordApplyPatchEffectReceipt(params: {
  journal: EffectReceiptJournalView | undefined;
  summary: ApplyPatchSummary;
  recoveryRef?: string;
}): Promise<void> {
  if (!params.journal) return;
  const receipt = buildApplyPatchEffectReceipt({
    journal: params.journal,
    summary: params.summary,
    ...(params.recoveryRef ? { recoveryRef: params.recoveryRef } : {}),
  });
  if (!receipt) return;
  try {
    const sink = await resolveSink();
    sink?.record(receipt);
  } catch {
    // Fail-open, matching write-journal.ts: journal failures never block a write.
  }
}
