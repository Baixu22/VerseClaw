/**
 * Flight Recorder timeline writer (m3-timeline).
 * Append-only event log under an Evidence Pack: timeline.json.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { writeEvidenceJson } from './output.ts';
import { redactSecretsInValue } from '../security/redact-secrets.ts';
import { join } from 'node:path';
import type {
  TimelineEvent,
  TimelineEventKind,
  TimelineRecord,
} from '../contracts/index.ts';
import { EVIDENCE_PACK_SCHEMA_VERSION, PACK_FILES } from './schema.ts';
import { assertInsideRoot, EvidencePathError } from './path-guard.ts';

export type TimelineWriterOptions = {
  dir: string;
  sessionId?: string;
};

export class TimelineWriter {
  private readonly dir: string;
  private readonly sessionId?: string;
  private seq = 0;
  private startedAt = new Date().toISOString();
  private readonly events: TimelineEvent[] = [];
  private ready: Promise<void>;

  constructor(options: TimelineWriterOptions) {
    this.dir = options.dir;
    this.sessionId = options.sessionId;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.flush();
  }

  async append(
    kind: TimelineEventKind,
    name: string,
    detail?: Record<string, unknown>,
    ok?: boolean,
  ): Promise<TimelineEvent> {
    await this.ready;
    this.seq += 1;
    const event: TimelineEvent = redactSecretsInValue({
      seq: this.seq,
      at: new Date().toISOString(),
      kind,
      name,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(detail ? { detail } : {}),
      ...(ok !== undefined ? { ok } : {}),
    });
    this.events.push(event);
    await this.flush();
    return event;
  }

  async action(name: string, detail?: Record<string, unknown>, ok?: boolean): Promise<TimelineEvent> {
    return this.append('action', name, detail, ok);
  }

  async network(name: string, detail?: Record<string, unknown>, ok?: boolean): Promise<TimelineEvent> {
    return this.append('network', name, detail, ok);
  }

  async console(name: string, detail?: Record<string, unknown>, ok?: boolean): Promise<TimelineEvent> {
    return this.append('console', name, detail, ok);
  }

  async snapshot(name: string, detail?: Record<string, unknown>): Promise<TimelineEvent> {
    return this.append('snapshot', name, detail);
  }

  async mode(name: string, detail?: Record<string, unknown>): Promise<TimelineEvent> {
    return this.append('mode', name, detail);
  }

  async stop(): Promise<TimelineRecord> {
    await this.ready;
    const record = this.toRecord();
    record.endedAt = new Date().toISOString();
    await writeEvidenceJson(this.dir, this.path(), record);
    return record;
  }

  toRecord(): TimelineRecord {
    return {
      schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
      startedAt: this.startedAt,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      events: [...this.events],
    };
  }

  private path(): string {
    return assertInsideRoot(this.dir, join(this.dir, PACK_FILES.timeline), 'timeline');
  }

  private async flush(): Promise<void> {
    await writeEvidenceJson(this.dir, this.path(), this.toRecord());
  }
}

export async function readTimeline(dir: string): Promise<TimelineRecord | undefined> {
  try {
    const raw = await readFile(assertInsideRoot(dir, join(dir, PACK_FILES.timeline), 'timeline'), 'utf8');
    const parsed = JSON.parse(raw) as TimelineRecord;
    if (parsed.schemaVersion !== EVIDENCE_PACK_SCHEMA_VERSION) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (error instanceof EvidencePathError) throw error;
    return undefined;
  }
}
