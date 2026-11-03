// Shared codec for the existing Main/runtime Task Ledger journal.
import { createHash } from 'node:crypto';
import type { TaskLedgerEvent, TaskLedgerOperationReceipt, TaskLedgerWarning } from './types/task-ledger.js';

export type TaskLedgerReadResult = { events: TaskLedgerEvent[]; warnings: TaskLedgerWarning[] };

export type CommittedOperation = Omit<TaskLedgerOperationReceipt, 'replayed'>;
type TaskLedgerLogRead = TaskLedgerReadResult & { operations: Map<string, CommittedOperation>; eventLines: string[] };
type TaskLedgerCommitFrame = {
  schema: 'TaskLedgerCommit/v1';
  events: TaskLedgerEvent[];
  operation: CommittedOperation | null;
  checksum: string;
};

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).filter(key => row[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(',')}}`;
}

export function taskLedgerDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidEventShape(value: unknown): value is TaskLedgerEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.workspaceId === 'string'
    && typeof value.type === 'string'
    && typeof value.actor === 'string'
    && typeof value.createdAt === 'string'
    && isRecord(value.payload);
}

export function parseTaskLedgerJournal(raw: string): TaskLedgerLogRead {
  const events: TaskLedgerEvent[] = [];
  const eventLines: string[] = [];
  const warnings: TaskLedgerWarning[] = [];
  const operations = new Map<string, CommittedOperation>();
  // Keep standalone record bytes (including a CR) for the existing DCS
  // revision digest. JSON.parse accepts trailing record whitespace.
  raw.split(/\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && parsed.schema === 'TaskLedgerCommit/v1') {
        const frame = parsed as unknown as TaskLedgerCommitFrame;
        if (!Array.isArray(frame.events) || !frame.events.every(hasValidEventShape)
          || frame.checksum !== taskLedgerDigest({ events: frame.events, operation: frame.operation })) {
          throw new Error('Incomplete or damaged Task Ledger commit frame');
        }
        if (frame.operation) {
          const prior = operations.get(frame.operation.operationId);
          if (prior) {
            if (stableJson(prior) !== stableJson(frame.operation)) throw new Error('Conflicting operation records');
            return;
          }
          if (frame.operation.revision !== events.length + frame.events.length
            || stableJson(frame.operation.eventIds) !== stableJson(frame.events.map(event => event.id))) {
            throw new Error('Task Ledger operation revision or event membership mismatch');
          }
          operations.set(frame.operation.operationId, frame.operation);
        }
        events.push(...frame.events);
        eventLines.push(...frame.events.map(event => JSON.stringify(event)));
        return;
      }
      if (!hasValidEventShape(parsed)) {
        warnings.push({ type: 'invalid_event', line: index + 1, message: 'Task ledger event is missing required fields.' });
        return;
      }
      events.push(parsed);
      eventLines.push(line);
    } catch (error) {
      warnings.push({
        type: 'invalid_jsonl',
        line: index + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { events, warnings, operations, eventLines };
}

export function serializeTaskLedgerCommit(events: TaskLedgerEvent[], operation: CommittedOperation | null): string {
  // Manual metadata can contain structured-cloned Date values. Hash exactly
  // the JSON representation that replay will read, including toJSON output.
  const content = JSON.parse(JSON.stringify({ events, operation })) as { events: TaskLedgerEvent[]; operation: CommittedOperation | null };
  return JSON.stringify({ schema: 'TaskLedgerCommit/v1', ...content, checksum: taskLedgerDigest(content) });
}
