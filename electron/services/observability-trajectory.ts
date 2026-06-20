import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ObservabilityTrace } from '../../shared/types/observability';
import { getTranscriptPathForSessionKey } from '../utils/token-usage';

type TrajectoryEventLike = {
  traceSchema?: unknown;
  schemaVersion?: unknown;
  traceId?: unknown;
  sessionId?: unknown;
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

const MAX_TRAJECTORY_READ_BYTES = 2 * 1024 * 1024;
const MAX_TRAJECTORY_EVENTS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function runtimePathBesideSession(sessionFilePath: string): string {
  return sessionFilePath.endsWith('.jsonl')
    ? `${sessionFilePath.slice(0, -'.jsonl'.length)}.trajectory.jsonl`
    : `${sessionFilePath}.trajectory.jsonl`;
}

function pointerPathBesideSession(sessionFilePath: string): string {
  return sessionFilePath.endsWith('.jsonl')
    ? `${sessionFilePath.slice(0, -'.jsonl'.length)}.trajectory-path.json`
    : `${sessionFilePath}.trajectory-path.json`;
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

async function readPointerRuntimeFile(sessionFilePath: string): Promise<string | null> {
  const pointerText = await readSmallTextFile(pointerPathBesideSession(sessionFilePath));
  if (!pointerText) return null;
  try {
    const parsed = JSON.parse(pointerText) as Record<string, unknown>;
    if (parsed.traceSchema !== 'openclaw-trajectory-pointer') return null;
    return readString(parsed.runtimeFile) ?? null;
  } catch {
    return null;
  }
}

function parseTrajectoryEvents(text: string, trace: ObservabilityTrace): TrajectoryEventLike[] {
  const events: TrajectoryEventLike[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as TrajectoryEventLike;
      if (!isRecord(parsed) || parsed.traceSchema !== 'openclaw-trajectory') continue;
      const runId = readString(parsed.runId);
      const sessionKey = readString(parsed.sessionKey);
      const traceId = readString(parsed.traceId);
      if (trace.runId && runId && runId !== trace.runId) continue;
      if (trace.sessionKey && sessionKey && sessionKey !== trace.sessionKey) continue;
      if (!trace.runId && !trace.sessionKey && traceId && traceId !== trace.id) continue;
      events.push(parsed);
    } catch {
      continue;
    }
  }
  events.sort((a, b) => {
    const ats = typeof a.ts === 'string' ? Date.parse(a.ts) : 0;
    const bts = typeof b.ts === 'string' ? Date.parse(b.ts) : 0;
    if (ats !== bts) return ats - bts;
    const as = typeof a.seq === 'number' ? a.seq : 0;
    const bs = typeof b.seq === 'number' ? b.seq : 0;
    return as - bs;
  });
  return events.slice(-MAX_TRAJECTORY_EVENTS);
}

export async function readTrajectoryEventsForTrace(trace: ObservabilityTrace): Promise<TrajectoryEventLike[]> {
  if (!trace.sessionKey) return [];
  const { filePath, sessionId } = getTranscriptPathForSessionKey(trace.sessionKey);
  const candidatePaths = new Set<string>([
    runtimePathBesideSession(filePath),
    join(dirname(filePath), `${sessionId}.trajectory.jsonl`),
  ]);
  const pointerRuntimeFile = await readPointerRuntimeFile(filePath);
  if (pointerRuntimeFile) candidatePaths.add(pointerRuntimeFile);

  const allEvents: TrajectoryEventLike[] = [];
  for (const candidate of candidatePaths) {
    const text = await readSmallTextFile(candidate);
    if (!text) continue;
    allEvents.push(...parseTrajectoryEvents(text, trace));
  }
  allEvents.sort((a, b) => {
    const ats = typeof a.ts === 'string' ? Date.parse(a.ts) : 0;
    const bts = typeof b.ts === 'string' ? Date.parse(b.ts) : 0;
    return ats - bts;
  });
  return allEvents.slice(-MAX_TRAJECTORY_EVENTS);
}
