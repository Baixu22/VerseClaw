import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TaskLedgerEvent } from "../types/task-ledger.js";

function stableEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableEventPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "createdAt" && key !== "updatedAt")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, stableEventPayload(val)]),
  );
}
function eventMeaning(event: TaskLedgerEvent, savedLinkId?: string) {
  const link = event.payload.sessionLink;
  return {
    type: event.type,
    actor: event.actor,
    taskId: event.taskId ?? event.payload.nodeId ?? event.payload.node?.id ?? null,
    sessionId: event.sessionId ?? null,
    payload: stableEventPayload(savedLinkId && link
      ? { ...event.payload, sessionLink: { ...link, id: savedLinkId } }
      : event.payload),
  };
}

export function sameTaskEventMeaning(left: TaskLedgerEvent, right: TaskLedgerEvent): boolean {
  return JSON.stringify(eventMeaning(left)) === JSON.stringify(eventMeaning(right));
}

/** Transactional storage for the existing Task Ledger event format. */
export function withTaskEvents<T>(legacyPath: string, operation: (db: DatabaseSync) => T): T {
  mkdirSync(dirname(legacyPath), { recursive: true });
  const db = new DatabaseSync(join(dirname(legacyPath), "events.sqlite3"));
  db.exec(
    "PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS imports(path TEXT PRIMARY KEY,bytes INTEGER NOT NULL,hash TEXT NOT NULL);",
  );
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS events_idempotency ON events(json_extract(json,'$.idempotencyKey'));",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      if (existsSync(legacyPath)) {
        const prior = db.prepare("SELECT bytes,hash FROM imports WHERE path=?").get(legacyPath) as
          | { bytes: number; hash: string }
          | undefined;
        const size = statSync(legacyPath).size;
        if (!prior || size !== prior.bytes) {
          const raw = readFileSync(legacyPath);
          const hash = createHash("sha256").update(raw).digest("hex");
          if (
            prior &&
            (size < prior.bytes ||
              createHash("sha256").update(raw.subarray(0, prior.bytes)).digest("hex") !==
                prior.hash)
          )
            throw new Error("TASK_LEGACY_HISTORY_CHANGED");
          const tail = raw.subarray(prior?.bytes ?? 0).toString("utf8");
          for (const line of tail.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as TaskLedgerEvent;
            if (!event.id || !event.workspaceId || !event.type || !event.payload)
              throw new Error("TASK_LEGACY_EVENT_INVALID");
            const old = db.prepare("SELECT json FROM events WHERE id=?").get(event.id) as
              | { json: string }
              | undefined;
            const json = JSON.stringify(event);
            if (old && old.json !== json) throw new Error("TASK_LEGACY_EVENT_CONFLICT");
            db.prepare("INSERT OR IGNORE INTO events(id,json) VALUES(?,?)").run(event.id, json);
          }
          db.prepare("INSERT OR REPLACE INTO imports VALUES(?,?,?)").run(
            legacyPath,
            raw.length,
            hash,
          );
        }
      }
      const result = operation(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function readPersistentTaskEvents(path: string): TaskLedgerEvent[] {
  return withTaskEvents(path, (db) =>
    (db.prepare("SELECT json FROM events ORDER BY seq").all() as Array<{ json: string }>).map(
      (r) => JSON.parse(r.json) as TaskLedgerEvent,
    ),
  );
}

/** Disposable projection cache; the event sequence remains the authority. */
export function readTaskEventProjection<T>(
  path: string,
  key: string,
  project: (events: TaskLedgerEvent[]) => T,
): T {
  return withTaskEvents(path, (db) => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS projections(key TEXT PRIMARY KEY,sequence INTEGER NOT NULL,json TEXT NOT NULL)",
    );
    const sequence = Number(
      (
        db.prepare("SELECT coalesce(max(seq),0) AS sequence FROM events").get() as {
          sequence: number;
        }
      ).sequence,
    );
    const cached = db.prepare("SELECT sequence,json FROM projections WHERE key=?").get(key) as
      | { sequence: number; json: string }
      | undefined;
    if (cached?.sequence === sequence) {
      try {
        return JSON.parse(cached.json) as T;
      } catch {
        /* Rebuild only the disposable projection. */
      }
    }
    const events = (
      db.prepare("SELECT json FROM events ORDER BY seq").all() as Array<{ json: string }>
    ).map((row) => JSON.parse(row.json) as TaskLedgerEvent);
    const result = project(events);
    db.prepare("INSERT OR REPLACE INTO projections VALUES(?,?,?)").run(
      key,
      sequence,
      JSON.stringify(result),
    );
    return result;
  });
}

export function appendPersistentTaskEvents(
  path: string,
  events: TaskLedgerEvent[],
  batchKey?: string | null,
): void {
  withTaskEvents(path, (db) => {
    if (batchKey) {
      const prior = db.prepare("SELECT hash FROM batches WHERE id=?").get(batchKey) as
        | { hash: string }
        | undefined;
      const [first] = events;
      // The public single-link command generates a new ID on every invocation.
      // Use its persisted ID for comparison, including batches from old builds.
      const savedLink = prior && events.length === 1 && first.type === "session_linked" &&
        first.actor === "user" && first.payload.sessionLink
        ? db.prepare(`SELECT json_extract(json,'$.payload.sessionLink.id') AS id FROM events
            WHERE json_extract(json,'$.idempotencyKey')=? AND json_extract(json,'$.type')='session_linked'
              AND json_extract(json,'$.actor')='user' ORDER BY seq LIMIT 1`).get(batchKey) as { id: string } | undefined
        : undefined;
      const hash = createHash("sha256")
        .update(JSON.stringify(events.map(event => eventMeaning(event, savedLink?.id))))
        .digest("hex");
      if (prior) {
        if (prior.hash !== hash) throw new Error("TASK_EVENT_IDEMPOTENCY_CONFLICT");
        return;
      }
      db.prepare("INSERT INTO batches VALUES(?,?)").run(batchKey, hash);
    }
    for (const event of events) {
      if (!batchKey && event.idempotencyKey) {
        const previous = db
          .prepare("SELECT json FROM events WHERE json_extract(json,'$.idempotencyKey')=?")
          .all(event.idempotencyKey) as Array<{ json: string }>;
        if (previous.length) {
          if (
            !previous.some(
              (row) =>
                JSON.stringify(eventMeaning(JSON.parse(row.json) as TaskLedgerEvent)) ===
                JSON.stringify(eventMeaning(event)),
            )
          )
            throw new Error("TASK_EVENT_IDEMPOTENCY_CONFLICT");
          continue;
        }
      }
      const old = db.prepare("SELECT json FROM events WHERE id=?").get(event.id) as
        | { json: string }
        | undefined;
      if (old) {
        if (old.json !== JSON.stringify(event)) throw new Error("TASK_EVENT_ID_CONFLICT");
        continue;
      }
      db.prepare("INSERT INTO events(id,json) VALUES(?,?)").run(event.id, JSON.stringify(event));
    }
  });
}
