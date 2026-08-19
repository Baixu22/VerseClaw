/**
 * P3/P4 UFTK: unified coding audit sink.
 *
 * P3 introduced a single in-memory audit stream so exec approval, exec, and
 * side-effect records share one append-only surface with the mutation/rollback
 * events that FileTransactionService returns.
 *
 * P4 keeps this interface as the only audit-sink boundary. JSONL + SQLite are
 * implemented behind this interface (see audit-log.ts / audit-index.ts); there
 * must be no second audit sink, queue, or journal in coding-runtime.
 */
import type {
  AuditPage,
  AuditQuery,
  CodingAuditEvent,
} from "../../../../shared/coding-runtime/types.js";

export interface CodingAuditSink {
  /**
   * Append one validated event. Implementations may enqueue writes and return
   * before the bytes are durable; callers that need durability must call
   * `flush` (P4 contract).
   */
  write(event: CodingAuditEvent): void | Promise<void>;
  /** Drain pending writes. Optional for P3 in-memory sinks. */
  flush?(): Promise<void>;
  /** Drain and release resources. Optional for P3 in-memory sinks. */
  close?(): Promise<void>;
}

export interface CodingAuditQuerySink extends CodingAuditSink {
  query(
    sessionId: string,
    query: AuditQuery,
  ): Promise<AuditPage<CodingAuditEvent>>;
}

export class InMemoryCodingAuditSink implements CodingAuditSink {
  readonly #events: CodingAuditEvent[] = [];

  write(event: CodingAuditEvent): void {
    this.#events.push(event);
  }

  query(sessionId: string, query: AuditQuery = {}): AuditPage<CodingAuditEvent> {
    const limit = query.limit ?? 100;
    const fromMs = query.fromMs ?? 0;
    const toMs = query.toMs ?? Number.POSITIVE_INFINITY;
    const items = this.#events.filter((event) => {
      if (event.sessionId !== sessionId) return false;
      if (event.timestamp < fromMs || event.timestamp > toMs) return false;
      if (query.toolName && event.toolName !== query.toolName) return false;
      if (query.path && event.path !== query.path) return false;
      return true;
    });
    const page = items.slice(0, limit);
    return {
      items: page,
      ...(items.length > limit
        ? { nextCursor: `${page.length}:${page[page.length - 1]?.eventId ?? ""}` }
        : {}),
    };
  }

  clear(): void {
    this.#events.length = 0;
  }

  get size(): number {
    return this.#events.length;
  }
}

let globalSink: CodingAuditSink = new InMemoryCodingAuditSink();

export function getCodingAuditSink(): CodingAuditSink {
  return globalSink;
}

export function setCodingAuditSink(sink: CodingAuditSink): void {
  globalSink = sink;
}

/** Test seam: restore the process-shared default and clear its events. */
export function resetCodingAuditSinkForTest(): void {
  const sink = new InMemoryCodingAuditSink();
  globalSink = sink;
}
