// R3-2.2 read-path coverage: recordCompassMemoryInjectionReceipt writes a
// sanitized receipt through the approved ReceiptStore, and
// listMemoryInjectionReceipts projects it back to the panel shape (refs, counts,
// source, budget) — never raw content. Exercised against a real temp state DB so
// the ReceiptStore.list({ kind: "context" }) reader and the memory:v1: filter
// are covered end to end.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listMemoryInjectionReceipts,
  recordCompassMemoryInjectionReceipt,
} from "./memory-injection-receipt.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import type { PreReplyInjection } from "../runtime-core/memory-pre-reply-injection.js";

const tempRoots: string[] = [];
let databasePath = "";

function dbOptions() {
  return { env: process.env, path: databasePath };
}

function injection(overrides: Partial<PreReplyInjection> = {}): PreReplyInjection {
  return {
    iFrameRefreshed: false,
    injectedFactIds: ["fact-a", "fact-b"],
    top5FactsString: "x".repeat(120),
    ...overrides,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r32-injection-receipt-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  vi.stubEnv("OPENCLAW_HOME", path.join(root, "home"));
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", path.join(root, "openclaw.json"));
  databasePath = path.join(stateDir, "openclaw-state.db");
});

afterEach(() => {
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("listMemoryInjectionReceipts", () => {
  it("projects a recorded receipt to the sanitized panel shape", () => {
    const persisted = recordCompassMemoryInjectionReceipt({
      sessionKey: "session-1",
      injection: injection(),
      // fact-c is a candidate that was NOT injected -> omitted ref.
      candidateFacts: [{ factId: "fact-a" }, { factId: "fact-b" }, { factId: "fact-c" }],
      database: dbOptions(),
    });
    expect(persisted.persisted).toBe(true);

    const rows = listMemoryInjectionReceipts({ sessionKey: "session-1", database: dbOptions() });
    expect(rows).toHaveLength(1);
    const [entry] = rows;
    expect(entry.source).toBe("compass-pre-reply-retrieval");
    expect(entry.sessionKey).toBe("session-1");
    // Sanitized to ref:memory:* refs; no raw fact text.
    expect(entry.selected).toEqual(["ref:memory:fact-a", "ref:memory:fact-b"]);
    expect(entry.omitted).toEqual(["ref:memory:fact-c"]);
    expect(entry.budgetCharsApplied).toBe(120);
    expect(entry.budgetCharsRequested).toBe(120);
    expect(entry.createdAt).toBeGreaterThan(0);
  });

  it("returns nothing when no facts were injected (default-off round)", () => {
    const persisted = recordCompassMemoryInjectionReceipt({
      sessionKey: "session-2",
      injection: injection({ injectedFactIds: [] }),
      candidateFacts: [{ factId: "fact-a" }],
      database: dbOptions(),
    });
    expect(persisted.persisted).toBe(false);

    const rows = listMemoryInjectionReceipts({ sessionKey: "session-2", database: dbOptions() });
    expect(rows).toEqual([]);
  });

  it("filters receipts by session key", () => {
    recordCompassMemoryInjectionReceipt({
      sessionKey: "session-a",
      injection: injection({ injectedFactIds: ["only-a"] }),
      candidateFacts: [{ factId: "only-a" }],
      database: dbOptions(),
    });
    recordCompassMemoryInjectionReceipt({
      sessionKey: "session-b",
      injection: injection({ injectedFactIds: ["only-b"] }),
      candidateFacts: [{ factId: "only-b" }],
      database: dbOptions(),
    });

    const onlyA = listMemoryInjectionReceipts({ sessionKey: "session-a", database: dbOptions() });
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0]?.selected).toEqual(["ref:memory:only-a"]);

    const all = listMemoryInjectionReceipts({ database: dbOptions() });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
