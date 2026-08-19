/**
 * P4 UFTK: JSONL coding audit log.
 *
 * The JSONL file is the append-only audit event stream. Old records are never
 * rewritten; each event is one line of JSON. The SQLite index is a rebuildable
 * projection (see audit-index.ts), never the audit fact authority.
 *
 * The log directory must live under the existing OpenClaw state/log directory
 * (`resolveStateDir()/logs/coding-audit`) so it is never captured by exec
 * side-effect snapshots or workspace git checkpoints.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertCodingAuditEvent,
  isCodingAuditEvent,
  validateCodingAuditEvent,
} from "../../../../shared/coding-runtime/schema.js";
import type {
  AuditPage,
  AuditQuery,
  CodingAuditEvent,
} from "../../../../shared/coding-runtime/types.js";
import { resolveStateDir } from "../../config/paths.js";
import type {
  CodingAuditQuerySink,
  CodingAuditSink,
} from "./audit-sink.js";
import {
  CodingAuditSqliteIndex,
  type CodingAuditSqliteIndexOptions,
} from "./audit-index.js";

export const CODING_AUDIT_JSONL_FILENAME = "coding-audit.jsonl";
export const CODING_AUDIT_SQLITE_FILENAME = "coding-audit.sqlite";

export type CodingAuditLogOptions = {
  /** Optional explicit log directory. Defaults to <openclaw-state>/logs/coding-audit. */
  logDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Warning sink for corrupt JSONL lines and degraded SQLite index writes. */
  warn?: (message: string) => void;
};

export function resolveCodingAuditLogDir(options: CodingAuditLogOptions = {}): string {
  if (options.logDir?.trim()) {
    return path.resolve(options.logDir);
  }
  return path.join(resolveStateDir(options.env), "logs", "coding-audit");
}

export function resolveCodingAuditJsonlPath(options: CodingAuditLogOptions = {}): string {
  return path.join(resolveCodingAuditLogDir(options), CODING_AUDIT_JSONL_FILENAME);
}

export function resolveCodingAuditSqlitePath(options: CodingAuditLogOptions = {}): string {
  return path.join(resolveCodingAuditLogDir(options), CODING_AUDIT_SQLITE_FILENAME);
}

export type JsonlCodingAuditStoreOptions = CodingAuditLogOptions & {
  filePath?: string;
};

export type JsonlAuditReadResult = {
  events: CodingAuditEvent[];
  corruptLines: number;
  warnings: string[];
};

/**
 * Append-only JSONL audit event store. This is the authoritative audit event
 * stream for replay and for SQLite index rebuilds.
 */
export class JsonlCodingAuditStore {
  readonly filePath: string;

  constructor(options: JsonlCodingAuditStoreOptions = {}) {
    this.filePath = options.filePath
      ? path.resolve(options.filePath)
      : resolveCodingAuditJsonlPath(options);
  }

  async appendLine(line: string): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.appendFile(this.filePath, line, { encoding: "utf8", mode: 0o600 });
  }

  async appendLines(lines: readonly string[]): Promise<void> {
    if (lines.length === 0) return;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.appendFile(this.filePath, lines.join(""), { encoding: "utf8", mode: 0o600 });
  }

  async readEvents(): Promise<JsonlAuditReadResult> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === "ENOENT") {
        return { events: [], corruptLines: 0, warnings: [] };
      }
      throw caught;
    }

    const events: CodingAuditEvent[] = [];
    const warnings: string[] = [];
    let corruptLines = 0;
    let lineNumber = 0;
    for (const rawLine of raw.split(/\r?\n/)) {
      lineNumber += 1;
      const line = rawLine.trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        corruptLines += 1;
        warnings.push(`coding-audit: skipping invalid JSON line ${lineNumber} in ${this.filePath}`);
        continue;
      }
      if (!isCodingAuditEvent(parsed)) {
        const validation = validateCodingAuditEvent(parsed);
        const detail = validation.errors
          .slice(0, 3)
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ");
        corruptLines += 1;
        warnings.push(
          `coding-audit: skipping invalid audit event line ${lineNumber} in ${this.filePath}: ${detail || "schema validation failed"}`,
        );
        continue;
      }
      events.push(parsed);
    }
    return { events, corruptLines, warnings };
  }

  async countEvents(): Promise<number> {
    const { events } = await this.readEvents();
    return events.length;
  }
}

export type PersistentCodingAuditSinkOptions = CodingAuditLogOptions & {
  jsonlPath?: string;
  sqlitePath?: string;
  sqlite?: Partial<CodingAuditSqliteIndexOptions>;
};

/**
 * P4 unified durable audit sink. It implements the `audit-sink.ts` interface;
 * JSONL and SQLite are the only durable storage behind this interface.
 *
 * Write policy: each event is validated synchronously (fail-closed) and then
 * enqueued asynchronously so audit writes do not block the calling tool. Call
 * `flush` before reading/querying or before shutdown; `close` drains the queue
 * and releases the SQLite handle. If a JSONL append fails, the error is kept
 * and `flush`/`close` reject so callers get an explicit signal instead of a
 * silent gap. SQLite index write failures are non-fatal warnings because the
 * index is rebuildable from JSONL.
 */
export class PersistentCodingAuditSink implements CodingAuditQuerySink {
  readonly #jsonl: JsonlCodingAuditStore;
  readonly #index: CodingAuditSqliteIndex;
  readonly #warn: (message: string) => void;
  #tail: Promise<void> = Promise.resolve();
  #lastAppendError: unknown;
  #closed = false;

  constructor(options: PersistentCodingAuditSinkOptions = {}) {
    const jsonlPath = options.jsonlPath
      ? path.resolve(options.jsonlPath)
      : resolveCodingAuditJsonlPath(options);
    const sqlitePath = options.sqlitePath
      ? path.resolve(options.sqlitePath)
      : resolveCodingAuditSqlitePath(options);
    this.#warn = options.warn ?? ((message) => console.warn(message));
    this.#jsonl = new JsonlCodingAuditStore({ ...options, filePath: jsonlPath });
    this.#index = new CodingAuditSqliteIndex({
      filePath: sqlitePath,
      env: options.env,
      ...options.sqlite,
    });
    this.#index.open();
  }

  get jsonlPath(): string {
    return this.#jsonl.filePath;
  }

  get sqlitePath(): string {
    return this.#index.filePath;
  }

  write(event: CodingAuditEvent): void {
    assertCodingAuditEvent(event);
    if (this.#closed) {
      throw new Error("coding audit sink is closed");
    }
    const line = `${JSON.stringify(event)}\n`;
    this.#tail = this.#tail
      .then(async () => {
        await this.#jsonl.appendLine(line);
        try {
          this.#index.insertEvent(event);
        } catch (caught) {
          // SQLite is a rebuildable projection; JSONL remains the audit fact.
          this.#warn(
            `coding-audit: sqlite index write failed for ${event.eventId}: ${
              caught instanceof Error ? caught.message : String(caught)
            }`,
          );
        }
      })
      .catch((caught: unknown) => {
        this.#lastAppendError = caught;
        this.#warn(
          `coding-audit: jsonl append failed for ${event.eventId}: ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        );
      });
  }

  async flush(): Promise<void> {
    const tail = this.#tail;
    await tail;
    if (this.#lastAppendError !== undefined) {
      const failure = this.#lastAppendError;
      this.#lastAppendError = undefined;
      throw failure;
    }
  }

  async query(
    sessionId: string,
    query: AuditQuery,
  ): Promise<AuditPage<CodingAuditEvent>> {
    await this.flush();
    if (this.#index.count() === 0) {
      const { events } = await this.#jsonl.readEvents();
      if (events.length > 0) {
        await this.#index.rebuildFromEvents(events);
      }
    }
    return this.#index.query(sessionId, query);
  }

  async rebuildIndexFromJsonl(): Promise<number> {
    await this.flush();
    const { events } = await this.#jsonl.readEvents();
    return this.#index.rebuildFromEvents(events);
  }

  async close(): Promise<void> {
    await this.flush();
    this.#closed = true;
    this.#index.close();
  }

  isClosedForTesting(): boolean {
    return this.#closed;
  }

  async closeForTest(): Promise<void> {
    await this.close();
  }
}

const persistentSinkCache = new Map<string, PersistentCodingAuditSink>();

function persistentSinkKey(options: PersistentCodingAuditSinkOptions): string {
  const jsonlPath = options.jsonlPath
    ? path.resolve(options.jsonlPath)
    : resolveCodingAuditJsonlPath(options);
  const sqlitePath = options.sqlitePath
    ? path.resolve(options.sqlitePath)
    : resolveCodingAuditSqlitePath(options);
  return `${jsonlPath}\n${sqlitePath}`;
}

/** Get or create the process-shared durable audit sink for a path pair. */
export function getOrCreatePersistentCodingAuditSink(
  options: PersistentCodingAuditSinkOptions = {},
): PersistentCodingAuditSink {
  const key = persistentSinkKey(options);
  const existing = persistentSinkCache.get(key);
  if (existing && !existing.isClosedForTesting()) {
    return existing;
  }
  const created = new PersistentCodingAuditSink(options);
  persistentSinkCache.set(key, created);
  return created;
}

/** Test seam: close and clear cached durable sinks. */
export async function resetPersistentCodingAuditSinksForTest(): Promise<void> {
  for (const sink of persistentSinkCache.values()) {
    await sink.closeForTest();
  }
  persistentSinkCache.clear();
}

// Keep the generic sink type exported for FTS / ExecAuditor callers.
export type { CodingAuditQuerySink, CodingAuditSink };
