import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { closeTrackedSqliteHandlesUnder, requireNodeSqlite } from "./node-sqlite.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    closeTrackedSqliteHandlesUnder(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("opens, reopens and tracks a database beneath a long profile path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-path-"));
  roots.push(root);
  const directory = path.join(root, "profile-".repeat(15), "workspace-".repeat(15));
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, "agent.sqlite");
  expect(filename.length).toBeGreaterThan(260);
  const { DatabaseSync } = requireNodeSqlite();
  const writer = new DatabaseSync(filename);
  writer.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE probe (value TEXT); INSERT INTO probe VALUES ('persisted')",
  );
  writer.close();
  const reader = new DatabaseSync(filename, { readOnly: true });
  expect(reader.prepare("SELECT value FROM probe").get()?.value).toBe("persisted");
  expect(closeTrackedSqliteHandlesUnder(root)).toBe(1);
  expect(reader.isOpen).toBe(false);
  const memory = new DatabaseSync(":memory:");
  memory.exec("CREATE TABLE probe (value TEXT)");
  memory.close();
});
