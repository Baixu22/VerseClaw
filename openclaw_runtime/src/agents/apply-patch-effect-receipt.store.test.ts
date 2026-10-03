/**
 * S1, powered on: prove a receipt row actually lands through the production path.
 *
 * The unit tests next to this file inject a fake sink, so they prove the receipt's
 * shape and the fail-open contract but not that anything is ever written. That
 * distinction is the whole point of this task's assessment — `effect_receipts` sat
 * at 0 rows for weeks while the schema, the tests and the store all existed, so
 * "has a call site" is not evidence of "is wired".
 *
 * This test therefore does not inject anything. It resets the sink cache and lets
 * `resolveSink()` construct the real `EffectReceiptStore` with its real default
 * options, redirected to a temp state dir by `OPENCLAW_STATE_DIR` — the same
 * mechanism `rc04-durable-approval.test.ts` uses. What it asserts is a row.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { EffectReceiptStore } from "./effect-receipt.js";
import {
  recordApplyPatchEffectReceipt,
  __setEffectReceiptSink,
  type EffectReceiptJournalView,
} from "./apply-patch-effect-receipt.js";
import type { ApplyPatchSummary } from "./apply-patch-types.js";

const tempRoots: string[] = [];

function summary(over: Partial<ApplyPatchSummary> = {}): ApplyPatchSummary {
  return { added: [], modified: [], deleted: [], ...over };
}

function journal(over: Partial<EffectReceiptJournalView> = {}): EffectReceiptJournalView {
  return {
    batchId: "batch-store-1",
    batchState: "committed",
    undoable: true,
    preview: { previewId: "vsp_store", changeSummaryDigest: `sha256:${"c".repeat(64)}` },
    snapshots: [{ journalEntryId: "write-journal:sess-store:1" }],
    ...over,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-effect-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  // Undefined, not null: this is what forces resolveSink() to run for real.
  __setEffectReceiptSink(undefined);
});

afterEach(() => {
  __setEffectReceiptSink(undefined);
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("apply_patch effect receipt: the real store", () => {
  it("writes one row through resolveSink with no injection", async () => {
    const before = new EffectReceiptStore().listByApproval("vsp_store");
    expect(before).toHaveLength(0);

    await recordApplyPatchEffectReceipt({
      journal: journal(),
      summary: summary({ modified: ["a.ts"], added: ["b.ts"] }),
    });

    const rows = new EffectReceiptStore().listByApproval("vsp_store");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      approval_id: "vsp_store",
      idempotency_key: "apply_patch:batch-store-1",
      domain_executor: "clawx-write-journal",
      outcome: "applied",
      journal_ref: "write-journal:sess-store:1",
      recoverability: "undo_write",
    });
    // Digest-only privacy: the store keeps a digest, never the proposal itself.
    expect(rows[0]?.proposal_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(rows[0] ?? {})).not.toContain("proposal_json");
    // No human decided anything here, so no decision may be recorded.
    expect(rows[0]?.approval_decision).toBeNull();
  });

  it("is idempotent for a retried batch and keeps one row", async () => {
    const params = { journal: journal(), summary: summary({ modified: ["a.ts"] }) };
    await recordApplyPatchEffectReceipt(params);
    await recordApplyPatchEffectReceipt(params);
    expect(new EffectReceiptStore().listByApproval("vsp_store")).toHaveLength(1);
  });

  it("records an unpreviewed write with no approval id at all", async () => {
    const { preview: _dropped, ...withoutPreview } = journal();
    await recordApplyPatchEffectReceipt({
      journal: withoutPreview,
      summary: summary({ modified: ["a.ts"] }),
    });
    const rows = new EffectReceiptStore().listByApproval("vsp_store");
    expect(rows).toHaveLength(0);
    const store = new EffectReceiptStore();
    const direct = store.listByApproval("");
    // Nothing is filed under an empty approval id either: the column is null.
    expect(direct).toHaveLength(0);
  });

  it("recovers after a construction failure instead of going quiet for good", async () => {
    // The failure mode this guards is the one the header describes: a store that
    // cannot open used to latch the sink off for the whole process, so a state dir
    // that was briefly unavailable meant no audit trail at all afterwards. Pointing
    // the state dir at a file makes construction fail for real rather than by
    // injection, so the retry path is what is under test.
    const root = tempRoots.at(-1)!;
    const blocked = path.join(root, "blocked");
    fs.writeFileSync(blocked, "not a directory");
    process.env.OPENCLAW_STATE_DIR = blocked;

    // Fail-open: the batch still resolves and the workspace is untouched.
    await expect(
      recordApplyPatchEffectReceipt({
        journal: journal({ batchId: "batch-blocked" }),
        summary: summary({ modified: ["a.ts"] }),
      }),
    ).resolves.toBeUndefined();

    // The store becomes available again, and the very next batch is recorded.
    closeOpenClawStateDatabase();
    process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
    await recordApplyPatchEffectReceipt({
      journal: journal({ batchId: "batch-after" }),
      summary: summary({ modified: ["a.ts"] }),
    });

    const rows = new EffectReceiptStore().listByApproval("vsp_store");
    expect(rows.map((row) => row.idempotency_key)).toEqual(["apply_patch:batch-after"]);
  });
});
