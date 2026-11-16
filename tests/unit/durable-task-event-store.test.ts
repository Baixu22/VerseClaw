// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendPersistentTaskEvents,
  readPersistentTaskEvents,
  readTaskEventProjection,
} from "../../shared/task-system/event-store";
import type { TaskLedgerEvent } from "../../shared/types/task-ledger";

function event(id: string): TaskLedgerEvent {
  return {
    id,
    workspaceId: "workspace",
    type: "node_created",
    actor: "user",
    payload: {
      node: {
        id,
        title: id,
        kind: "task",
        status: "todo",
        createdAt: "2026-11-07T00:00:00Z",
        updatedAt: "2026-11-07T00:00:00Z",
      },
    },
    createdAt: "2026-11-07T00:00:00Z",
  };
}
describe("existing Task Ledger transactional migration", () => {
  it("reuses the current projection and invalidates it after an appended event", () => {
    const root = mkdtempSync(join(tmpdir(), "task-projection-"));
    const file = join(root, "events.jsonl");
    let calls = 0;
    try {
      const project = (events: TaskLedgerEvent[]) => {
        calls++;
        return { ids: events.map((x) => x.id) };
      };
      appendPersistentTaskEvents(file, [event("a")]);
      expect(readTaskEventProjection(file, "view", project).ids).toEqual(["a"]);
      expect(readTaskEventProjection(file, "view", project).ids).toEqual(["a"]);
      expect(calls).toBe(1);
      appendPersistentTaskEvents(file, [event("b")]);
      expect(readTaskEventProjection(file, "view", project).ids).toEqual(["a", "b"]);
      expect(calls).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("deduplicates event-level keys while preserving new logical requests", () => {
    const root = mkdtempSync(join(tmpdir(), "task-event-keys-"));
    const file = join(root, "events.jsonl");
    try {
      const a = { ...event("first"), idempotencyKey: "key" };
      appendPersistentTaskEvents(file, [a]);
      appendPersistentTaskEvents(file, [{ ...a, id: "retry", createdAt: "2026-11-08T00:00:00Z" }]);
      expect(readPersistentTaskEvents(file)).toHaveLength(1);
      expect(() =>
        appendPersistentTaskEvents(file, [{ ...event("changed"), idempotencyKey: "key" }]),
      ).toThrow("IDEMPOTENCY_CONFLICT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("imports old IDs, leaves original bytes intact, and appends in one owner store", () => {
    const root = mkdtempSync(join(tmpdir(), "task-events-"));
    const file = join(root, "events.jsonl");
    try {
      const old = JSON.stringify(event("old")) + "\n";
      writeFileSync(file, old);
      expect(readPersistentTaskEvents(file).map((x) => x.id)).toEqual(["old"]);
      appendPersistentTaskEvents(file, [event("new")], "request");
      appendPersistentTaskEvents(file, [event("new")], "request");
      expect(readPersistentTaskEvents(file).map((x) => x.id)).toEqual(["old", "new"]);
      expect(readFileSync(file, "utf8")).toBe(old);
      appendFileSync(file, JSON.stringify(event("legacy-late")) + "\n");
      expect(readPersistentTaskEvents(file)).toHaveLength(3);
      expect(() => appendPersistentTaskEvents(file, [event("different")], "request")).toThrow(
        "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("rejects corrupt legacy history instead of presenting an empty task graph", () => {
    const root = mkdtempSync(join(tmpdir(), "task-events-"));
    const file = join(root, "events.jsonl");
    try {
      writeFileSync(file, "{broken");
      expect(() => readPersistentTaskEvents(file)).toThrow();
      writeFileSync(file, JSON.stringify(event("old")) + "\n");
      expect(readPersistentTaskEvents(file)).toHaveLength(1);
      writeFileSync(file, "");
      expect(() => readPersistentTaskEvents(file)).toThrow("LEGACY_HISTORY_CHANGED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
