import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  ObservabilitySpan,
  ObservabilitySpanKind,
  ObservabilityTrace,
  ObservabilityTraceEvent,
  ObservabilityTraceStatus,
  ObservabilityTokenUsage,
} from '../../shared/types/observability';
import { extractSessionIdFromTranscriptFileName, getOpenClawUsageDirs } from '../utils/token-usage';
import { persistObservabilityTraceToIndex } from './observability-index';
import { isRecord, readNumber, readString, truncatePreview } from './observability-redaction';

type SessionCandidate = {
  agentId: string;
  sessionId: string;
  filePath: string;
  mtimeMs: number;
};

type TrajectoryEventLike = {
  traceSchema?: unknown;
  traceId?: unknown;
  sessionKey?: unknown;
  runId?: unknown;
  type?: unknown;
  ts?: unknown;
  seq?: unknown;
  provider?: unknown;
  modelId?: unknown;
  modelApi?: unknown;
  data?: unknown;
};

type TranscriptMessageLike = {
  role: string;
  timestamp: number;
  content?: unknown;
  idempotencyKey?: string;
  toolCallId?: string;
  toolName?: string;
  usage?: unknown;
};

const MAX_SESSION_FILES = 40;
const MAX_TRAJECTORY_READ_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS_PER_TRACE = 300;
const TRANSCRIPT_RUN_WINDOW_MARGIN_MS = 5_000;
const EMPTY_TOKEN_USAGE: ObservabilityTokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costUsd: 0,
};

function stableIdPart(value: string): string {
  return value.replace(/[^a-z0-9_.:-]+/giu, '-').slice(0, 96) || 'event';
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function readTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trajectoryPathBesideTranscript(filePath: string): string {
  return filePath.endsWith('.jsonl')
    ? `${filePath.slice(0, -'.jsonl'.length)}.trajectory.jsonl`
    : `${filePath}.trajectory.jsonl`;
}

function trajectoryPointerBesideTranscript(filePath: string): string {
  return filePath.endsWith('.jsonl')
    ? `${filePath.slice(0, -'.jsonl'.length)}.trajectory-path.json`
    : `${filePath}.trajectory-path.json`;
}

async function readSmallTextFile(filePath: string): Promise<string | null> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size <= 0) return null;
    if (fileStat.size > MAX_TRAJECTORY_READ_BYTES) {
      const handle = await import('node:fs/promises').then((fs) => fs.open(filePath, 'r'));
      try {
        const buffer = Buffer.alloc(MAX_TRAJECTORY_READ_BYTES);
        const result = await handle.read(buffer, 0, MAX_TRAJECTORY_READ_BYTES, Math.max(0, fileStat.size - MAX_TRAJECTORY_READ_BYTES));
        return buffer.subarray(0, result.bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    }
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readPointerRuntimeFile(transcriptPath: string): Promise<string | null> {
  const pointerText = await readSmallTextFile(trajectoryPointerBesideTranscript(transcriptPath));
  if (!pointerText) return null;
  try {
    const parsed = JSON.parse(pointerText) as Record<string, unknown>;
    if (parsed.traceSchema !== 'openclaw-trajectory-pointer') return null;
    return readString(parsed.runtimeFile) ?? null;
  } catch {
    return null;
  }
}

function isTranscriptFileName(fileName: string): boolean {
  return fileName.endsWith('.jsonl')
    && !fileName.endsWith('.trajectory.jsonl')
    && !fileName.endsWith('.deleted.jsonl')
    && !fileName.includes('.jsonl.reset.');
}

async function listRecentSessionCandidates(): Promise<SessionCandidate[]> {
  const candidates: SessionCandidate[] = [];
  const seen = new Set<string>();
  for (const root of getOpenClawUsageDirs()) {
    const agentsDir = join(root, 'agents');
    let agentEntries: Dirent[];
    try {
      agentEntries = await readdir(agentsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const agentEntry of agentEntries) {
      if (!agentEntry.isDirectory()) continue;
      const agentId = agentEntry.name.trim();
      if (!agentId) continue;
      const sessionsDir = join(agentsDir, agentId, 'sessions');
      let sessionEntries: string[];
      try {
        sessionEntries = await readdir(sessionsDir);
      } catch {
        continue;
      }
      for (const fileName of sessionEntries) {
        if (!isTranscriptFileName(fileName)) continue;
        const sessionId = extractSessionIdFromTranscriptFileName(fileName);
        if (!sessionId) continue;
        const filePath = join(sessionsDir, fileName);
        const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) continue;
          candidates.push({ agentId, sessionId, filePath, mtimeMs: fileStat.mtimeMs });
        } catch {
          continue;
        }
      }
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSION_FILES);
}

async function readTrajectoryFiles(candidate: SessionCandidate): Promise<TrajectoryEventLike[]> {
  const paths = new Set<string>([
    trajectoryPathBesideTranscript(candidate.filePath),
    join(dirname(candidate.filePath), `${candidate.sessionId}.trajectory.jsonl`),
  ]);
  const pointerRuntimeFile = await readPointerRuntimeFile(candidate.filePath);
  if (pointerRuntimeFile) paths.add(pointerRuntimeFile);

  const events: TrajectoryEventLike[] = [];
  for (const filePath of paths) {
    const text = await readSmallTextFile(filePath);
    if (!text) continue;
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as TrajectoryEventLike;
        if (!isRecord(parsed) || parsed.traceSchema !== 'openclaw-trajectory') continue;
        events.push(parsed);
      } catch {
        continue;
      }
    }
  }
  events.sort((a, b) => {
    const ats = readTimestamp(a.ts) ?? 0;
    const bts = readTimestamp(b.ts) ?? 0;
    if (ats !== bts) return ats - bts;
    return (readNumber(a.seq) ?? 0) - (readNumber(b.seq) ?? 0);
  });
  return events;
}

function eventGroupKey(event: TrajectoryEventLike, candidate: SessionCandidate): string {
  return readString(event.runId)
    ?? readString(event.traceId)
    ?? `${candidate.agentId}:${candidate.sessionId}`;
}

function labelFromType(type: string): string {
  return type
    .split('.')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Runtime Event';
}

function trajectoryLabel(event: TrajectoryEventLike): string {
  const type = readString(event.type) ?? 'runtime.event';
  const data = isRecord(event.data) ? event.data : {};
  if (type.includes('model')) {
    const model = readString(event.modelId) ?? readString(event.modelApi);
    if (model) return model;
  }
  return readString(data.name)
    ?? readString(data.toolName)
    ?? readString(data.command)
    ?? readString(data.path)
    ?? readString(data.filePath)
    ?? labelFromType(type);
}

function spanKindForTrajectoryType(type: string): ObservabilitySpanKind {
  if (type.includes('model')) return 'model';
  if (
    type.includes('tool')
    || type.includes('command')
    || type.includes('patch')
    || type.includes('file')
    || type.includes('exec')
    || type.includes('edit')
  ) {
    return 'tool';
  }
  if (type.includes('context')) return 'context-pack';
  if (type.includes('memory')) return 'memory';
  if (type.includes('approval')) return 'security-intercept';
  return 'custom';
}

function statusForTrajectoryType(type: string): ObservabilityTraceStatus {
  if (/error|failed|failure|warning/iu.test(type)) return 'error';
  if (/abort|cancel/iu.test(type)) return 'aborted';
  return 'completed';
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return undefined;
}

function cleanPathCandidate(value: string): string | undefined {
  const cleaned = value.trim().replace(/^["'`]+/u, '').replace(/["'`.,;]+$/u, '');
  return cleaned ? cleaned : undefined;
}

function extractWorkspacePathFromText(value: unknown): string | undefined {
  const text = readString(value);
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/\bworkspace\s+(?:root|path)\s*:\s*(.+)$/iu)
      ?? line.match(/\bcwd\s*:\s*(.+)$/iu);
    if (!match?.[1]) continue;
    const candidate = cleanPathCandidate(match[1]);
    if (candidate) return candidate;
  }
  return undefined;
}

function extractWorkspacePathFromData(data: Record<string, unknown>): string | undefined {
  return firstString(
    data.workspaceRoot,
    data.workspacePath,
    data.cwd,
    extractWorkspacePathFromText(data.prompt),
    extractWorkspacePathFromText(data.input),
    extractWorkspacePathFromText(data.task),
    extractWorkspacePathFromText(data.content),
    extractWorkspacePathFromText(data.message),
  );
}

function attributesForTrajectoryEvent(event: TrajectoryEventLike): Record<string, unknown> {
  const data = isRecord(event.data) ? event.data : {};
  const workspacePath = extractWorkspacePathFromData(data);
  const attrs: Record<string, unknown> = {
    provider: event.provider,
    modelId: event.modelId,
    modelApi: event.modelApi,
    runId: event.runId,
    sessionKey: event.sessionKey,
    path: firstString(data.path, data.filePath),
    filePath: firstString(data.filePath, data.path),
    workspaceRoot: workspacePath,
    workspacePath,
    cwd: data.cwd,
    command: data.command,
    exitCode: data.exitCode,
  };
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value != null && value !== ''));
}

function tokenUsageFromTrajectoryEvent(event: TrajectoryEventLike): ObservabilityTokenUsage | undefined {
  const data = isRecord(event.data) ? event.data : {};
  return tokenUsageFromRecord(isRecord(data.usage) ? data.usage : data);
}

function tokenUsageFromRecord(usage: Record<string, unknown>): ObservabilityTokenUsage | undefined {
  const input = readNumber(usage.inputTokens) ?? readNumber(usage.input) ?? readNumber(usage.promptTokens) ?? 0;
  const output = readNumber(usage.outputTokens) ?? readNumber(usage.output) ?? readNumber(usage.completionTokens) ?? 0;
  const cacheRead = readNumber(usage.cacheReadTokens) ?? readNumber(usage.cacheRead) ?? 0;
  const cacheWrite = readNumber(usage.cacheWriteTokens) ?? readNumber(usage.cacheWrite) ?? 0;
  const totalTokens = readNumber(usage.totalTokens) ?? readNumber(usage.total) ?? input + output + cacheRead + cacheWrite;
  const costUsd = readNumber(usage.costUsd) ?? readNumber(usage.cost) ?? 0;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && totalTokens === 0 && costUsd === 0) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite, totalTokens, costUsd };
}

function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(contentText).filter(Boolean).join('\n') || undefined;
  }
  if (!isRecord(value)) return undefined;
  return firstString(value.text, value.content, value.message, value.summary, value.output, value.result, value.partialJson);
}

function collectToolCalls(value: unknown): Array<{ id?: string; name: string; arguments?: unknown }> {
  if (Array.isArray(value)) return value.flatMap(collectToolCalls);
  if (!isRecord(value)) return [];
  const type = readString(value.type);
  const name = readString(value.name);
  if (type === 'toolCall' && name) {
    return [{
      id: readString(value.id),
      name,
      arguments: value.arguments,
    }];
  }
  return [];
}

function transcriptAttributes(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const text = contentText(content);
  const args = isRecord(content) && isRecord(content.arguments) ? content.arguments : {};
  const workspacePath = firstString(
    extra.workspaceRoot,
    extra.workspacePath,
    args.workdir,
    args.cwd,
    extractWorkspacePathFromText(text),
  );
  const attrs = {
    ...extra,
    path: firstString(extra.path, args.path, args.filePath),
    filePath: firstString(extra.filePath, args.filePath, args.path),
    workspaceRoot: workspacePath,
    workspacePath,
    cwd: firstString(extra.cwd, args.cwd, args.workdir),
    command: firstString(extra.command, args.command),
  };
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value != null && value !== ''));
}

async function readTranscriptMessages(filePath: string): Promise<TranscriptMessageLike[]> {
  const text = await readSmallTextFile(filePath);
  if (!text) return [];
  const messages: TranscriptMessageLike[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type !== 'message' || !isRecord(parsed.message)) continue;
      const role = readString(parsed.message.role);
      if (!role) continue;
      const timestamp = readTimestamp(parsed.timestamp);
      if (timestamp == null) continue;
      messages.push({
        role,
        timestamp,
        content: parsed.message.content,
        idempotencyKey: readString(parsed.idempotencyKey) ?? readString(parsed.message.idempotencyKey),
        toolCallId: readString(parsed.message.toolCallId),
        toolName: readString(parsed.message.toolName),
        usage: parsed.message.usage,
      });
    } catch {
      continue;
    }
  }
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

function selectedTranscriptMessagesForGroup(
  transcriptMessages: TranscriptMessageLike[],
  events: TrajectoryEventLike[],
): TranscriptMessageLike[] {
  if (transcriptMessages.length === 0 || events.length === 0) return [];
  const timestamps = events.map((event) => readTimestamp(event.ts)).filter((value): value is number => value != null);
  if (timestamps.length === 0) return [];
  const runId = events.map((event) => readString(event.runId)).find(Boolean);
  const workspacePaths = new Set(
    events
      .map((event) => (isRecord(event.data) ? extractWorkspacePathFromData(event.data) : undefined))
      .filter((value): value is string => Boolean(value)),
  );
  const start = Math.min(...timestamps) - TRANSCRIPT_RUN_WINDOW_MARGIN_MS;
  const end = Math.max(...timestamps) + TRANSCRIPT_RUN_WINDOW_MARGIN_MS;
  const candidates = transcriptMessages.filter((message) => message.timestamp >= start && message.timestamp <= end);
  const segmentStart = candidates.find((message) => (
    message.role === 'user'
    && runId
    && message.idempotencyKey?.startsWith(`${runId}:`)
  )) ?? candidates.find((message) => (
    message.role === 'user'
    && workspacePaths.size > 0
    && workspacePaths.has(extractWorkspacePathFromText(contentText(message.content)) ?? '')
  ));
  if (!segmentStart) return candidates;
  const nextUser = transcriptMessages.find((message) => (
    message.timestamp > segmentStart.timestamp
    && message.role === 'user'
  ));
  const segmentEnd = Math.min(end, nextUser?.timestamp ?? Number.POSITIVE_INFINITY);
  return candidates.filter((message) => message.timestamp >= segmentStart.timestamp && message.timestamp < segmentEnd);
}

function addTokenUsage(left: ObservabilityTokenUsage, right: ObservabilityTokenUsage | undefined): ObservabilityTokenUsage {
  if (!right) return left;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

function buildSpan(
  traceId: string,
  event: TrajectoryEventLike,
  index: number,
  startedAt: number,
): ObservabilitySpan {
  const type = readString(event.type) ?? 'runtime.event';
  const data = isRecord(event.data) ? event.data : {};
  const timestamp = readTimestamp(event.ts) ?? startedAt + index;
  const status = statusForTrajectoryType(type);
  const tokenUsage = tokenUsageFromTrajectoryEvent(event);
  return {
    id: `trajectory:${stableIdPart(readString(event.seq) ?? `${type}:${index}`)}`,
    traceId,
    name: trajectoryLabel(event),
    kind: spanKindForTrajectoryType(type),
    status,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    modelRef: readString(event.modelId) ?? readString(event.modelApi),
    input: data.prompt ?? data.input ?? data.args ? truncatePreview(data.prompt ?? data.input ?? data.args, 20_000) : undefined,
    output: data.summary ?? data.output ?? data.result ?? data.message ? truncatePreview(data.summary ?? data.output ?? data.result ?? data.message, 20_000) : undefined,
    error: truncatePreview(data.error ?? data.warning),
    tokenUsage,
    metrics: {},
    attributes: attributesForTrajectoryEvent(event),
  };
}

function buildTranscriptSpans(
  traceId: string,
  messages: TranscriptMessageLike[],
): ObservabilitySpan[] {
  const spans: ObservabilitySpan[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      spans.push({
        id: `transcript:user:${index}`,
        traceId,
        name: 'User Prompt',
        kind: 'custom',
        status: 'completed',
        startedAt: message.timestamp,
        endedAt: message.timestamp,
        durationMs: 0,
        input: contentText(message.content),
        metrics: {},
        attributes: transcriptAttributes(message.content),
      });
      return;
    }

    if (message.role === 'assistant') {
      const toolCalls = collectToolCalls(message.content);
      if (toolCalls.length > 0) {
        for (const [toolIndex, toolCall] of toolCalls.entries()) {
          spans.push({
            id: `transcript:tool-call:${index}:${toolIndex}`,
            traceId,
            name: toolCall.name,
            kind: 'tool',
            status: 'completed',
            startedAt: message.timestamp,
            endedAt: message.timestamp,
            durationMs: 0,
            input: toolCall.arguments ? truncatePreview(toolCall.arguments, 20_000) : undefined,
            tokenUsage: isRecord(message.usage) ? tokenUsageFromRecord(message.usage) : undefined,
            metrics: {},
            attributes: transcriptAttributes({ arguments: toolCall.arguments }, {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            }),
          });
        }
        return;
      }

      const text = contentText(message.content);
      if (text) {
        spans.push({
          id: `transcript:assistant-final:${index}`,
          traceId,
          name: 'Assistant Final',
          kind: 'custom',
          status: 'completed',
          startedAt: message.timestamp,
          endedAt: message.timestamp,
          durationMs: 0,
          output: text,
          tokenUsage: isRecord(message.usage) ? tokenUsageFromRecord(message.usage) : undefined,
          metrics: {},
          attributes: transcriptAttributes(message.content),
        });
      }
      return;
    }

    if (message.role === 'toolResult') {
      const toolName = message.toolName ?? message.toolCallId ?? 'tool';
      spans.push({
        id: `transcript:tool-result:${index}`,
        traceId,
        name: `Tool Result: ${toolName}`,
        kind: 'tool',
        status: 'completed',
        startedAt: message.timestamp,
        endedAt: message.timestamp,
        durationMs: 0,
        output: contentText(message.content),
        metrics: {},
        attributes: transcriptAttributes(message.content, {
          toolCallId: message.toolCallId,
          toolName,
        }),
      });
    }
  });
  return spans;
}

function buildTraceEvent(
  traceId: string,
  event: TrajectoryEventLike,
  index: number,
  startedAt: number,
): ObservabilityTraceEvent {
  const type = readString(event.type) ?? 'runtime.event';
  const timestamp = readTimestamp(event.ts) ?? startedAt + index;
  return {
    id: `trajectory-event:${stableIdPart(readString(event.seq) ?? `${type}:${index}`)}`,
    traceId,
    spanId: `trajectory:${stableIdPart(readString(event.seq) ?? `${type}:${index}`)}`,
    type,
    name: labelFromType(type),
    timestamp,
    attributes: attributesForTrajectoryEvent(event),
  };
}

function buildTraceFromTrajectoryGroup(
  candidate: SessionCandidate,
  groupKey: string,
  eventsInput: TrajectoryEventLike[],
  transcriptMessagesInput: TranscriptMessageLike[] = [],
): ObservabilityTrace | null {
  const events = eventsInput.slice(-MAX_EVENTS_PER_TRACE);
  if (events.length === 0) return null;
  const first = events[0];
  const last = events[events.length - 1];
  const runId = events.map((event) => readString(event.runId)).find(Boolean);
  const sourceTraceId = readString(first.traceId);
  const traceId = sourceTraceId
    ? (runId ? `${sourceTraceId}:${stableIdPart(runId)}` : sourceTraceId)
    : `trajectory:${candidate.agentId}:${candidate.sessionId}:${digest(`${candidate.filePath}:${groupKey}`)}`;
  const startedAt = readTimestamp(first.ts) ?? candidate.mtimeMs;
  const endedAt = readTimestamp(last.ts) ?? startedAt;
  const sessionKey = events.map((event) => readString(event.sessionKey)).find(Boolean) ?? `agent:${candidate.agentId}:${candidate.sessionId}`;
  const statuses = events.map((event) => statusForTrajectoryType(readString(event.type) ?? 'runtime.event'));
  const status: ObservabilityTraceStatus = statuses.includes('error')
    ? 'error'
    : statuses.includes('aborted')
      ? 'aborted'
      : 'completed';
  const transcriptMessages = selectedTranscriptMessagesForGroup(transcriptMessagesInput, events);
  const spans = [
    ...events.map((event, index) => buildSpan(traceId, event, index, startedAt)),
    ...buildTranscriptSpans(traceId, transcriptMessages),
  ].sort((a, b) => a.startedAt - b.startedAt);
  const traceEvents = events.map((event, index) => buildTraceEvent(traceId, event, index, startedAt));
  const tokenUsage = spans.reduce((usage, span) => addTokenUsage(usage, span.tokenUsage), { ...EMPTY_TOKEN_USAGE });
  const task = events
    .map((event) => (isRecord(event.data) ? firstString(event.data.prompt, event.data.task, event.data.summary) : undefined))
    .find(Boolean);

  return {
    id: traceId,
    name: `Runtime trajectory ${basename(candidate.filePath)}`,
    runId,
    sessionKey,
    task,
    mode: 'runtime-trajectory',
    status,
    startedAt,
    endedAt,
    updatedAt: endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    spans,
    events: traceEvents,
    tokenUsage,
    metrics: { trajectoryEvents: events.length },
    tags: ['runtime', 'trajectory'],
    error: status === 'error'
      ? events.map((event) => isRecord(event.data) ? firstString(event.data.error, event.data.warning) : undefined).find(Boolean)
      : undefined,
  };
}

export async function refreshObservabilityTrajectoryIndex(): Promise<number> {
  let indexed = 0;
  for (const candidate of await listRecentSessionCandidates()) {
    const events = await readTrajectoryFiles(candidate);
    if (events.length === 0) continue;
    const transcriptMessages = await readTranscriptMessages(candidate.filePath);
    const groups = new Map<string, TrajectoryEventLike[]>();
    for (const event of events) {
      const key = eventGroupKey(event, candidate);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    for (const [groupKey, groupEvents] of groups) {
      const trace = buildTraceFromTrajectoryGroup(candidate, groupKey, groupEvents, transcriptMessages);
      if (!trace) continue;
      await persistObservabilityTraceToIndex(trace, { sourceStatus: 'partial' });
      indexed += 1;
    }
  }
  return indexed;
}
