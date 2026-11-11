import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseSync } from "node:sqlite";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import {
  commitExecutionPhase,
  readExecutionPhase,
  readOpenExecutionPhases,
  recordExecutionIntent,
  settleOrphanedExecutionPhases,
} from "./store.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exec-phase-"));
});

afterEach(() => {
  closeOpenClawStateDatabase();
  rmSync(dir, { recursive: true, force: true });
});

function options() {
  return { path: join(dir, "state.sqlite") };
}

describe("TF-0718 execution-phase store", () => {
  it("migrates the prototype ledger once and retains phase plus revision on the TaskFlow row", () => {
    openOpenClawStateDatabase(options());
    closeOpenClawStateDatabase();
    const db = new DatabaseSync(options().path);
    db.exec(`CREATE TABLE execution_phases (execution_id TEXT, idempotency_key TEXT, session_key TEXT,
      run_id TEXT,task_id TEXT,tool_name TEXT,effect_class TEXT,phase TEXT,revision INTEGER,
      intent_json TEXT,recovery_json TEXT,created_at INTEGER,updated_at INTEGER);
      INSERT INTO execution_phases VALUES ('exe-old','old-key','session','run',NULL,'exec','unsafe',
        'effect_pending',7,'{"toolCallId":"old-call"}','{"needsReconciliation":true}',1,2);`);
    db.close();
    expect(readExecutionPhase("old-key", options())).toMatchObject({
      phase: "effect_pending",
      revision: 7,
      session_key: "session",
    });
    const { db: migrated } = openOpenClawStateDatabase(options());
    expect(
      migrated.prepare("SELECT name FROM sqlite_master WHERE name='execution_phases'").get(),
    ).toBeUndefined();
    expect(
      migrated
        .prepare(
          "SELECT status,execution_phase,revision FROM flow_runs WHERE flow_id='tool-execution:old-key'",
        )
        .get(),
    ).toMatchObject({ status: "running", execution_phase: "effect_pending", revision: 7 });
    closeOpenClawStateDatabase();
    expect(readExecutionPhase("old-key", options())?.revision).toBe(7);
  });
  it("records the intent before dispatch and is idempotent", () => {
    const first = recordExecutionIntent(
      {
        idempotencyKey: "k-1",
        toolName: "edit",
        effectClass: "unsafe",
        now: 1,
      },
      options(),
    );
    expect(first.duplicate).toBe(false);
    expect(first.phase).toBe("dispatched");
    const second = recordExecutionIntent(
      {
        idempotencyKey: "k-1",
        toolName: "edit",
        effectClass: "unsafe",
        now: 2,
      },
      options(),
    );
    expect(second.duplicate).toBe(true);
    expect(readExecutionPhase("k-1", options())?.phase).toBe("dispatched");
  });

  it("walks the legal phase chain with CAS revisions", () => {
    recordExecutionIntent(
      { idempotencyKey: "k-2", toolName: "edit", effectClass: "unsafe", now: 1 },
      options(),
    );
    const pending = commitExecutionPhase(
      { idempotencyKey: "k-2", from: "dispatched", to: "effect_pending", now: 2 },
      options(),
    );
    expect(pending).toEqual({ ok: true, phase: "effect_pending", revision: 1 });
    const committed = commitExecutionPhase(
      { idempotencyKey: "k-2", from: "effect_pending", to: "effect_committed", now: 3 },
      options(),
    );
    expect(committed).toEqual({ ok: true, phase: "effect_committed", revision: 2 });
    expect(readExecutionPhase("k-2", options())?.phase).toBe("effect_committed");
  });

  it("rejects a stale writer and an illegal transition", () => {
    recordExecutionIntent(
      { idempotencyKey: "k-3", toolName: "edit", effectClass: "unsafe", now: 1 },
      options(),
    );
    commitExecutionPhase(
      { idempotencyKey: "k-3", from: "dispatched", to: "effect_pending", now: 2 },
      options(),
    );
    const stale = commitExecutionPhase(
      { idempotencyKey: "k-3", from: "dispatched", to: "failed", now: 3 },
      options(),
    );
    expect(stale).toEqual({ ok: false, reason: "revision-conflict" });
    const illegal = commitExecutionPhase(
      { idempotencyKey: "k-3", from: "effect_pending", to: "verified", now: 4 },
      options(),
    );
    expect(illegal).toEqual({ ok: false, reason: "illegal-transition" });
  });

  it("is a no-op when the target phase is already committed", () => {
    recordExecutionIntent(
      { idempotencyKey: "k-4", toolName: "edit", effectClass: "safe", now: 1 },
      options(),
    );
    commitExecutionPhase(
      { idempotencyKey: "k-4", from: "dispatched", to: "effect_pending", now: 2 },
      options(),
    );
    const again = commitExecutionPhase(
      { idempotencyKey: "k-4", from: "dispatched", to: "effect_pending", now: 3 },
      options(),
    );
    expect(again.ok).toBe(true);
  });
});

describe("TF-0719 orphan settlement", () => {
  it("finishes verification committed before a restart without re-executing the tool", () => {
    recordExecutionIntent(
      { idempotencyKey: "verified", toolName: "edit", effectClass: "unsafe" },
      options(),
    );
    for (const [from, to] of [
      ["dispatched", "effect_pending"],
      ["effect_pending", "effect_committed"],
      ["effect_committed", "verified"],
    ] as const) {
      expect(commitExecutionPhase({ idempotencyKey: "verified", from, to }, options()).ok).toBe(
        true,
      );
    }
    expect(settleOrphanedExecutionPhases({ options: options() }).settled).toBe(1);
    expect(readExecutionPhase("verified", options())?.phase).toBe("terminal");
  });
  it("preserves an unstarted dispatch and marks a pending effect for reconciliation", () => {
    recordExecutionIntent(
      { idempotencyKey: "a", toolName: "edit", effectClass: "unsafe", sessionKey: "s1", now: 1 },
      options(),
    );
    recordExecutionIntent(
      { idempotencyKey: "b", toolName: "edit", effectClass: "unsafe", sessionKey: "s1", now: 1 },
      options(),
    );
    commitExecutionPhase(
      { idempotencyKey: "b", from: "dispatched", to: "effect_pending", now: 2 },
      options(),
    );

    const settled = settleOrphanedExecutionPhases({ now: 10, options: options() });
    expect(settled.settled).toBe(0);
    expect(settled.needsReconciliation).toBe(1);

    expect(readExecutionPhase("a", options())?.phase).toBe("dispatched");
    const b = readExecutionPhase("b", options());
    expect(b?.phase).toBe("effect_pending");
    expect(b?.recovery_json).toContain("needsReconciliation");
  });

  it("lists only open phases for a session", () => {
    recordExecutionIntent(
      { idempotencyKey: "c", toolName: "edit", effectClass: "safe", sessionKey: "s2", now: 1 },
      options(),
    );
    expect(readOpenExecutionPhases("s2", options()).map((row) => row.idempotency_key)).toEqual([
      "c",
    ]);
  });
});
