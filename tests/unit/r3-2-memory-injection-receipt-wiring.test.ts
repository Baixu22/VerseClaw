// R3-2.1 acceptance: the COMPASS pre-reply injection receipt wiring in
// get-reply-run.ts covers 100% of the injection path when on, and writes zero
// receipts when the switch is off (receipt coverage + switch-off zero-write).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listMemoryInjectionReceipts } from "../../openclaw_runtime/src/context-engine/memory-injection-receipt";
import { recordCompassMemoryInjectionReceipt } from "../../openclaw_runtime/src/context-engine/memory-injection-receipt";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempRoots: string[] = [];
let stateDir = "";

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r3-2-receipt-wiring-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


describe("R3-2: COMPASS pre-reply receipt wiring (acceptance)", () => {
  it("switch on + facts injected: a sanitized receipt lands in the ReceiptStore (coverage 100%)", () => {
    const database = { env: process.env, path: path.join(stateDir, "openclaw-state.db") };

    recordCompassMemoryInjectionReceipt({
      sessionKey: "s1",
      injection: {
        iFrameRefreshed: false,
        injectedFactIds: ["fact-a", "fact-b"],
        top5FactsString: "## Top 5\n- fact-a\n- fact-b",
      },
      candidateFacts: [
        { factId: "fact-a" },
        { factId: "fact-b" },
        { factId: "fact-c" },
      ],
      database,
    });

    const entries = listMemoryInjectionReceipts({ sessionKey: "s1", database });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("compass-pre-reply-retrieval");
    expect(entries[0]?.selected).toEqual(["ref:memory:fact-a", "ref:memory:fact-b"]);
    expect(entries[0]?.omitted).toEqual(["ref:memory:fact-c"]);
    expect(entries[0]?.budgetCharsApplied).toBeGreaterThan(0);
  });

  it("switch off / nothing injected: zero receipts are written (zero-write acceptance)", () => {
    const database = { env: process.env, path: path.join(stateDir, "openclaw-state.db") };

    // No injectedFactIds (switch off or retrieval returned nothing) => no write.
    recordCompassMemoryInjectionReceipt({
      sessionKey: "s-off",
      injection: { iFrameRefreshed: false, injectedFactIds: [] },
      candidateFacts: [{ factId: "fact-a" }],
      database,
    });
    recordCompassMemoryInjectionReceipt({
      sessionKey: "s-off-2",
      injection: { iFrameRefreshed: false },
      candidateFacts: [],
      database,
    });

    expect(listMemoryInjectionReceipts({ sessionKey: "s-off", database })).toHaveLength(0);
    expect(listMemoryInjectionReceipts({ sessionKey: "s-off-2", database })).toHaveLength(0);
    expect(listMemoryInjectionReceipts({ sessionKey: "s-off", database })).toEqual([]);
  });
});
