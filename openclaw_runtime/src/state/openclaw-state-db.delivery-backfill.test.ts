import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  afterSnapshot: undefined as (() => void) | undefined,
  backfillSnapshots: [] as Array<{ retry_count: number; entry_json: string }>,
}));
vi.mock("../infra/node-sqlite.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../infra/node-sqlite.js")>();
  const sqlite = original.requireNodeSqlite();
  class ObservedDatabase extends sqlite.DatabaseSync {
    override prepare(sql: string) {
      const statement = super.prepare(sql);
      if (sql.includes("SELECT queue_name, id, entry_json") && control.afterSnapshot) {
        const all = statement.all.bind(statement);
        statement.all = (...args: Array<SQLInputValue | Record<string, SQLInputValue>>) => {
          const rows = Reflect.apply(all, statement, args) as ReturnType<typeof all>;
          const afterSnapshot = control.afterSnapshot;
          control.afterSnapshot = undefined;
          afterSnapshot?.();
          return rows;
        };
      }
      if (sql.includes("UPDATE delivery_queue_entries") && sql.includes("COALESCE")) {
        const run = statement.run.bind(statement);
        statement.run = (...args: Array<SQLInputValue | Record<string, SQLInputValue>>) => {
          const result = Reflect.apply(run, statement, args) as ReturnType<typeof run>;
          const row = super
            .prepare(`
            SELECT retry_count, entry_json FROM delivery_queue_entries
            WHERE queue_name = 'outbound' AND id = 'race'
          `)
            .get() as { retry_count: number; entry_json: string } | undefined;
          if (row) control.backfillSnapshots.push(row);
          return result;
        };
      }
      return statement;
    }
  }
  return { ...original, requireNodeSqlite: () => ({ ...sqlite, DatabaseSync: ObservedDatabase }) };
});

import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from "./openclaw-state-db.js";

const roots: string[] = [];
afterEach(() => {
  control.afterSnapshot = undefined;
  control.backfillSnapshots.length = 0;
  closeOpenClawStateDatabase();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("delivery queue startup backfill", () => {
  it("does not reset a budget committed after the backfill snapshot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-backfill-race-"));
    roots.push(root);
    const databasePath = path.join(root, "openclaw.sqlite");
    const old = { id: "race", enqueuedAt: 1, retryCount: 0 };
    const current = {
      ...old,
      retryCount: 1,
      activeSendProcessId: process.pid,
      recoveryAdmission: { attempts: 1 },
    };
    const database = openOpenClawStateDatabase({ path: databasePath, env: {} });
    database.db
      .prepare(`
      INSERT INTO delivery_queue_entries
        (queue_name, id, status, entry_json, retry_count, enqueued_at, updated_at)
      VALUES ('outbound', 'race', 'pending', ?, 0, 1, 1)
    `)
      .run(JSON.stringify(old));
    closeOpenClawStateDatabase();
    control.afterSnapshot = () => {
      const writer = new DatabaseSync(databasePath);
      try {
        writer
          .prepare(`
          UPDATE delivery_queue_entries SET entry_json = ?, retry_count = 1, updated_at = 2
          WHERE queue_name = 'outbound' AND id = 'race'
        `)
          .run(JSON.stringify(current));
      } finally {
        writer.close();
      }
    };
    const reopened = openOpenClawStateDatabase({ path: databasePath, env: {} });
    const row = reopened.db
      .prepare(`
      SELECT retry_count, entry_json FROM delivery_queue_entries
      WHERE queue_name = 'outbound' AND id = 'race'
    `)
      .get() as { retry_count: number; entry_json: string };
    expect(JSON.parse(row.entry_json)).toEqual(current);
    expect(row.retry_count).toBe(1);
    expect(control.afterSnapshot).toBeUndefined();
    expect(control.backfillSnapshots.length).toBeGreaterThan(0);
    expect(control.backfillSnapshots.every((snapshot) => snapshot.retry_count === 1)).toBe(true);
  });
});
