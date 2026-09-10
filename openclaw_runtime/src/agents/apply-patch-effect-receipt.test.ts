/**
 * S1: apply_patch → RC-04 effect receipt correlation.
 *
 * The assertions that matter here are about what the receipt is *not*: it is not
 * an authorization (no approval decision is written), it is not a second journal
 * (`domainExecutor` names the one that is), and it is not a gate (a store that
 * fails must not fail the write). The one behavioural gate is negative too — no
 * journal evidence means no receipt, which is how "the write journal is off"
 * turns into "no correlation record" without a second flag existing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildApplyPatchEffectReceipt,
  effectOutcomeForBatchState,
  joinArtifactRefs,
  recordApplyPatchEffectReceipt,
  __setEffectReceiptSink,
  type EffectReceiptJournalView,
  type EffectReceiptSink,
} from "./apply-patch-effect-receipt.js";
import type { ApplyPatchSummary } from "./apply-patch-types.js";

function summary(over: Partial<ApplyPatchSummary> = {}): ApplyPatchSummary {
  return { added: [], modified: [], deleted: [], ...over };
}

function journal(over: Partial<EffectReceiptJournalView> = {}): EffectReceiptJournalView {
  return {
    batchId: "batch-1",
    batchState: "committed",
    undoable: true,
    snapshots: [{ journalEntryId: "write-journal:sess-a:1" }],
    ...over,
  };
}

function recordingSink() {
  const calls: Array<Record<string, unknown>> = [];
  const sink: EffectReceiptSink = {
    record: (input) => {
      calls.push(input as Record<string, unknown>);
      return { ok: true };
    },
  };
  return { sink, calls };
}

describe("apply_patch effect receipt: outcome mapping", () => {
  it("maps each terminal batch state and refuses to speak for a prepared one", () => {
    expect(effectOutcomeForBatchState("committed")).toBe("applied");
    expect(effectOutcomeForBatchState("rolled_back")).toBe("not_applied");
    // recovery_required is deliberately not "applied": RC-04 parks an unknown
    // outcome in needs_reconciliation and never auto-replays it.
    expect(effectOutcomeForBatchState("recovery_required")).toBe("unknown");
    // Nothing has happened yet, so there is no effect to receipt.
    expect(effectOutcomeForBatchState("prepared")).toBeNull();
  });
});

describe("apply_patch effect receipt: shape", () => {
  it("names the write journal as the executor and carries no approval decision", () => {
    const receipt = buildApplyPatchEffectReceipt({
      journal: journal(),
      summary: summary({ modified: ["a.ts"] }),
    });
    expect(receipt).toMatchObject({
      idempotencyKey: "apply_patch:batch-1",
      domainExecutor: "clawx-write-journal",
      outcome: "applied",
      journalRef: "write-journal:sess-a:1",
      recoverability: "undo_write",
    });
    // No preview means no approval id, and no approvalDecision field at all: an
    // unapproved write must not be recorded as an approved one.
    expect(receipt).not.toHaveProperty("approvalId");
    expect(receipt).not.toHaveProperty("approvalDecision");
    expect(receipt?.proposal.previewDigest).toBeNull();
  });

  it("ties the receipt to the preview that authorised the commit", () => {
    const receipt = buildApplyPatchEffectReceipt({
      journal: journal({
        preview: { previewId: "vsp_abc", changeSummaryDigest: `sha256:${"a".repeat(64)}` },
      }),
      summary: summary({ modified: ["a.ts"] }),
    });
    expect(receipt?.approvalId).toBe("vsp_abc");
    // The digest survives in the receipt, so the binding outlives the bounded
    // in-process preview store the gate itself reads from.
    expect(receipt?.proposal.previewDigest).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("sorts the proposal path lists so the stored digest is order-independent", () => {
    const one = buildApplyPatchEffectReceipt({
      journal: journal(),
      summary: summary({ modified: ["b.ts", "a.ts"], added: ["z.ts", "c.ts"] }),
    });
    const other = buildApplyPatchEffectReceipt({
      journal: journal(),
      summary: summary({ modified: ["a.ts", "b.ts"], added: ["c.ts", "z.ts"] }),
    });
    expect(one?.proposal).toEqual(other?.proposal);
    expect(one?.proposal.modified).toEqual(["a.ts", "b.ts"]);
  });

  it("records an incomplete rollback as recoverable through its recovery ref", () => {
    const receipt = buildApplyPatchEffectReceipt({
      journal: journal({ batchState: "recovery_required", undoable: true }),
      summary: summary(),
      recoveryRef: "write-journal:sess-a:1",
    });
    expect(receipt?.outcome).toBe("unknown");
    expect(receipt?.recoverability).toBe("recovery_required:write-journal:sess-a:1");
  });

  it("says none rather than undo_write when the batch is not undoable", () => {
    const receipt = buildApplyPatchEffectReceipt({
      journal: journal({ batchState: "rolled_back", undoable: false }),
      summary: summary(),
    });
    expect(receipt?.outcome).toBe("not_applied");
    expect(receipt?.recoverability).toBe("none");
  });

  it("produces nothing for a batch that never left prepared", () => {
    expect(
      buildApplyPatchEffectReceipt({
        journal: journal({ batchState: "prepared" }),
        summary: summary(),
      }),
    ).toBeNull();
  });
});

describe("apply_patch effect receipt: diff artifact association (AC-3)", () => {
  const handle = (seed: string) => `result://sha256/${seed.repeat(64).slice(0, 64)}`;

  it("joins handles into the single artifact_ref column and annotates truncation", () => {
    expect(joinArtifactRefs([])).toBeUndefined();
    expect(joinArtifactRefs([handle("a")])).toBe(handle("a"));
    expect(joinArtifactRefs([handle("a"), handle("b")])).toBe(`${handle("a")},${handle("b")}`);
    // Six 73-char handles do not fit in 512 chars; the count of the dropped ones is
    // written down rather than silently lost, so a clipped ref is distinguishable
    // from a complete one.
    const many = ["a", "b", "c", "d", "e", "f", "g"].map(handle);
    const joined = joinArtifactRefs(many) ?? "";
    expect(joined.length).toBeLessThanOrEqual(512 + 4);
    expect(joined).toMatch(/,\+\d+$/u);
    expect(joined.split(",").filter((part) => part.startsWith("result://")).length).toBeLessThan(
      many.length,
    );
  });

  it("puts the readable prefix on the row and the whole set under the digest", () => {
    const receipt = buildApplyPatchEffectReceipt({
      journal: journal({
        preview: {
          previewId: "vsp_art",
          changeSummaryDigest: `sha256:${"a".repeat(64)}`,
          diffArtifacts: [handle("2"), handle("1")],
        },
      }),
      summary: summary({ modified: ["a.ts"] }),
    });
    expect(receipt?.artifactRef).toBe(`${handle("2")},${handle("1")}`);
    // Sorted in the proposal so the digest does not depend on report order.
    expect(receipt?.proposal.diffArtifacts).toEqual([handle("1"), handle("2")]);
    // approval id + change summary digest + the diffs they stand for, one record.
    expect(receipt?.approvalId).toBe("vsp_art");
    expect(receipt?.proposal.previewDigest).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("omits artifact_ref entirely when no diff was archived", () => {
    const noPreview = buildApplyPatchEffectReceipt({
      journal: (() => {
        const { preview: _dropped, ...rest } = journal();
        return rest;
      })(),
      summary: summary({ modified: ["a.ts"] }),
    });
    expect(noPreview).not.toHaveProperty("artifactRef");
    expect(noPreview?.proposal.diffArtifacts).toEqual([]);

    const previewWithoutArtifacts = buildApplyPatchEffectReceipt({
      journal: journal({
        preview: { previewId: "vsp_bare", changeSummaryDigest: `sha256:${"b".repeat(64)}` },
      }),
      summary: summary({ modified: ["a.ts"] }),
    });
    expect(previewWithoutArtifacts).not.toHaveProperty("artifactRef");
  });
});

describe("apply_patch effect receipt: wiring and fail-open", () => {
  beforeEach(() => {
    __setEffectReceiptSink(undefined);
  });

  it("writes exactly one receipt when the batch produced journal evidence", async () => {
    const { sink, calls } = recordingSink();
    __setEffectReceiptSink(sink);
    await recordApplyPatchEffectReceipt({
      journal: journal(),
      summary: summary({ modified: ["a.ts"] }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      idempotencyKey: "apply_patch:batch-1",
      domainExecutor: "clawx-write-journal",
      outcome: "applied",
    });
  });

  it("writes nothing when there is no journal evidence", async () => {
    // This is the whole gate. `createJournalEntries` returns [] whenever
    // runtime.coding.writeJournal.enabled is off, so journalEvidence is undefined
    // and no receipt exists — no second flag is involved, and the rollback is the
    // one already catalogued for that flag.
    const { sink, calls } = recordingSink();
    __setEffectReceiptSink(sink);
    await recordApplyPatchEffectReceipt({ journal: undefined, summary: summary() });
    expect(calls).toEqual([]);
  });

  it("swallows a store that throws, because a receipt must never fail a write", async () => {
    __setEffectReceiptSink({
      record: () => {
        throw new Error("state db is locked");
      },
    });
    await expect(
      recordApplyPatchEffectReceipt({ journal: journal(), summary: summary() }),
    ).resolves.toBeUndefined();
  });
});
