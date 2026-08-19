/**
 * P4 UFTK: SQLite audit index.
 *
 * The SQLite index is a rebuildable query projection over the append-only
 * JSONL audit stream. It must never become an authority that cannot be
 * rebuilt from JSONL; if the SQLite file is deleted, `query` or
 * `rebuildFromEvents` restores it from JSONL.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  AuditPage,
  AuditQuery,
  CodingAuditEvent,
} from "../../../../shared/coding-runtime/types.js";
import { requireNodeSqlite } from "../../infra/node-sqlite.js";
import { resolveStateDir } from "../../config/paths.js";

export type CodingAuditSqliteIndexOptions = {
  filePath?: string;
  env?: NodeJS.ProcessEnv;
  logDir?: string;
};

const CODING_AUDIT_SQLITE_FILENAME = "coding-audit.sqlite";

type CodingAuditRow = {
  seq: number | bigint;
  event_json: string;
};

export class CodingAuditSqliteIndex {
  readonly filePath: string;
  #db: DatabaseSync | undefined;

  constructor(options: CodingAuditSqliteIndexOptions = {}) {
    this.filePath = options.filePath
      ? path.resolve(options.filePath)
      : path.join(
          resolveStateDir(options.env),
          "logs",
          "coding-audit",
          CODING_AUDIT_SQLITE_FILENAME,
        );
  }

  open(): void {
    if (this.#db) return;
    const sqlite = requireNodeSqlite();
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#db = new sqlite.DatabaseSync(this.filePath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS coding_audit_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        path TEXT NOT NULL,
        command_redacted TEXT,
        command_hash TEXT,
        timestamp_ms INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_coding_audit_session_time
        ON coding_audit_events(session_id, timestamp_ms, seq);
      CREATE INDEX IF NOT EXISTS idx_coding_audit_tool
        ON coding_audit_events(tool_name, seq);
      CREATE INDEX IF NOT EXISTS idx_coding_audit_path
        ON coding_audit_events(path, seq);
      CREATE INDEX IF NOT EXISTS idx_coding_audit_command_redacted
        ON coding_audit_events(command_redacted, seq);
      CREATE INDEX IF NOT EXISTS idx_coding_audit_command_hash
        ON coding_audit_events(command_hash, seq);
    `);
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  get isOpen(): boolean {
    return this.#db !== undefined;
  }

  #requireDb(): DatabaseSync {
    if (!this.#db) {
      throw new Error("coding audit sqlite index is not open");
    }
    return this.#db;
  }

  insertEvent(event: CodingAuditEvent): void {
    const db = this.#requireDb();
    const commandRedacted =
      event.eventType === "coding.exec.v1"
        ? (event as CodingAuditEvent & { commandRedacted?: string }).commandRedacted ?? null
        : null;
    const commandHash =
      event.eventType === "coding.exec.v1"
        ? (event as CodingAuditEvent & { commandHash?: string }).commandHash ?? null
        : null;
    db.prepare(
      `INSERT OR REPLACE INTO coding_audit_events (
        event_id, event_type, session_id, request_id, tool_name, path,
        command_redacted, command_hash, timestamp_ms, event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      event.eventType,
      event.sessionId,
      event.requestId,
      event.toolName,
      event.path,
      commandRedacted,
      commandHash,
      event.timestamp,
      JSON.stringify(event),
    );
  }

  count(): number {
    const db = this.#requireDb();
    const row = db.prepare("SELECT COUNT(*) AS n FROM coding_audit_events").get() as
      | { n?: number | bigint }
      | undefined;
    return Number(row?.n ?? 0);
  }

  async rebuildFromEvents(events: readonly CodingAuditEvent[]): Promise<number> {
    const db = this.#requireDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM coding_audit_events");
      const insert = db.prepare(
        `INSERT OR REPLACE INTO coding_audit_events (
          event_id, event_type, session_id, request_id, tool_name, path,
          command_redacted, command_hash, timestamp_ms, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of events) {
        const commandRedacted =
          event.eventType === "coding.exec.v1"
            ? (event as CodingAuditEvent & { commandRedacted?: string }).commandRedacted ?? null
            : null;
        const commandHash =
          event.eventType === "coding.exec.v1"
            ? (event as CodingAuditEvent & { commandHash?: string }).commandHash ?? null
            : null;
        insert.run(
          event.eventId,
          event.eventType,
          event.sessionId,
          event.requestId,
          event.toolName,
          event.path,
          commandRedacted,
          commandHash,
          event.timestamp,
          JSON.stringify(event),
        );
      }
      db.exec("COMMIT");
      return events.length;
    } catch (caught) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Rollback failure means the transaction already ended.
      }
      throw caught;
    }
  }

  query(sessionId: string, query: AuditQuery): AuditPage<CodingAuditEvent> {
    const db = this.#requireDb();
    const limit = Math.max(1, Math.floor(query.limit ?? 100));
    const fromMs = query.fromMs ?? 0;
    const toMs = query.toMs ?? Number.MAX_SAFE_INTEGER;
    const conditions: string[] = ["session_id = ?"];
    const params: Array<string | number> = [sessionId];
    conditions.push("timestamp_ms >= ?");
    params.push(fromMs);
    conditions.push("timestamp_ms <= ?");
    params.push(toMs);
    if (query.toolName) {
      conditions.push("tool_name = ?");
      params.push(query.toolName);
    }
    if (query.path) {
      conditions.push("path = ?");
      params.push(query.path);
    }
    if (query.command) {
      conditions.push("instr(command_redacted, ?) > 0");
      params.push(query.command);
    }
    if (query.cursor) {
      const parsed = Number.parseInt(query.cursor, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        conditions.push("seq > ?");
        params.push(parsed);
      }
    }
    const where = conditions.join(" AND ");
    const rows = db
      .prepare(
        `SELECT seq, event_json FROM coding_audit_events
         WHERE ${where}
         ORDER BY timestamp_ms ASC, seq ASC
         LIMIT ?`,
      )
      .all(...params, limit + 1) as unknown as CodingAuditRow[];
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const items = page.map((row) => JSON.parse(row.event_json) as CodingAuditEvent);
    return {
      items,
      ...(hasMore
        ? { nextCursor: String(page[page.length - 1]?.seq ?? "") }
        : {}),
    };
  }
}
