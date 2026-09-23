import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from "./openclaw-state-db.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A second process holds an exclusive write lock on a not-yet-WAL database
 *  for `holdMs`, then releases it; resolves once the lock is taken. */
function holdExclusiveLock(databasePath: string, holdMs: number) {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA journal_mode = DELETE; CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER);");
    db.exec("BEGIN EXCLUSIVE; INSERT INTO lock_probe VALUES (1);");
    process.stdout.write("locked\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2]));
    db.exec("COMMIT;");
    db.close();
  `;
  const child = spawn(process.execPath, ["-e", script, databasePath, String(holdMs)], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("locked")) resolve();
    });
    child.on("exit", () => reject(new Error("lock holder exited before locking")));
  });
  return { locked, exited };
}

describe("openOpenClawStateDatabase under a concurrent writer", () => {
  it("waits for another process's write lock instead of failing the WAL switch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-state-busy-"));
    tempRoots.push(root);
    const databasePath = path.join(root, "openclaw-state.db");
    const holder = holdExclusiveLock(databasePath, 800);
    await holder.locked;
    const started = Date.now();
    const database = openOpenClawStateDatabase({ path: databasePath, env: {} });
    expect(database.db.isOpen).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(await holder.exited).toBe(0);
  }, 20_000);
});
