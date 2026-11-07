import type { ChatRuntimeEvent } from '../../../shared/chat-runtime-events';
import { extractToolResultMedia } from '@/pages/Chat/conversation-resources';
import {
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  extractRawFilePaths,
  getMessageText,
  makeAttachedFile,
} from './helpers';
import type { AttachedFileMeta, ChatRuntimeRunState } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function cloneRunState(runId: string, event: ChatRuntimeEvent): ChatRuntimeRunState {
  return {
    runId,
    sessionKey: event.sessionKey,
    status: event.type === 'run.ended' ? event.status : 'running',
    startedAt: event.type === 'run.started' ? event.startedAt : undefined,
    endedAt: event.type === 'run.ended' ? event.endedAt : undefined,
    assistantText: '',
    thinkingText: '',
    events: [],
  };
}

function stableRuntimeFingerprint(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stableRuntimeFingerprint).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableRuntimeFingerprint(child)}`)
    .join(',')}}`;
}

function sameRuntimeEvent(left: ChatRuntimeEvent | undefined, right: ChatRuntimeEvent): boolean {
  if (!left) return false;
  if (left.runId !== right.runId || left.type !== right.type) return false;
  if (typeof left.seq === 'number' && typeof right.seq === 'number') {
    return left.seq === right.seq;
  }
  if (left.type === 'tool.started') {
    return right.type === left.type && right.toolCallId === left.toolCallId;
  }
  if (left.type === 'tool.updated') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && stableRuntimeFingerprint(right.partialResult) === stableRuntimeFingerprint(left.partialResult);
  }
  if (left.type === 'tool.completed') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && right.isError === left.isError
      && stableRuntimeFingerprint(right.result) === stableRuntimeFingerprint(left.result)
      && stableRuntimeFingerprint(right.meta) === stableRuntimeFingerprint(left.meta);
  }
  if (left.type === 'command.output') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && right.itemId === left.itemId
      && right.phase === left.phase
      && right.output === left.output;
  }
  if (left.type === 'patch.completed') {
    return right.type === left.type && right.toolCallId === left.toolCallId && right.summary === left.summary;
  }
  if (left.type === 'approval.updated') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && right.status === left.status
      && right.phase === left.phase
      && right.message === left.message;
  }
  if (left.type === 'assistant.delta') {
    return right.type === left.type && typeof right.text === 'string'
      && right.text === left.text && right.replace === left.replace;
  }
  if (left.type === 'thinking.delta') {
    return right.type === left.type && typeof right.text === 'string' && right.text === left.text;
  }
  if (left.type === 'run.started') return right.type === left.type;
  if (left.type === 'run.ended') return right.type === left.type && right.status === left.status && right.endedAt === left.endedAt;
  return false;
}

export function applyRuntimeEventToRuns(
  currentRuns: Record<string, ChatRuntimeRunState>,
  event: ChatRuntimeEvent,
): Record<string, ChatRuntimeRunState> {
  const existing = currentRuns[event.runId] ?? cloneRunState(event.runId, event);
  const last = existing.events.at(-1);
  if (sameRuntimeEvent(last, event)) return currentRuns;
  // Terminal ownership is monotonic: delayed streaming or start notifications
  // cannot reopen a run whose owner already published its result.
  if (currentRuns[event.runId]?.status !== undefined && existing.status !== 'running'
    && (event.type === 'run.started' || event.type === 'assistant.delta' || event.type === 'thinking.delta')) return currentRuns;
  if (typeof event.seq === 'number' && Number.isFinite(event.seq)) {
    const previous = existing.events.findLast(item => typeof item.seq === 'number' && Number.isFinite(item.seq));
    if (previous?.seq !== undefined && event.seq <= previous.seq) return currentRuns;
  }
  const nextRun: ChatRuntimeRunState = {
    ...existing,
    sessionKey: event.sessionKey ?? existing.sessionKey,
    events: [...existing.events, event],
  };

  switch (event.type) {
    case 'run.started':
      nextRun.status = 'running';
      nextRun.startedAt = event.startedAt ?? nextRun.startedAt;
      nextRun.endedAt = undefined;
      break;
    case 'run.ended':
      nextRun.status = event.status;
      nextRun.endedAt = event.endedAt ?? event.ts ?? Date.now();
      break;
    case 'assistant.delta': {
      if (event.replace || typeof event.text === 'string') nextRun.assistantText = event.text ?? event.delta ?? '';
      else nextRun.assistantText += event.delta ?? '';
      break;
    }
    case 'thinking.delta': {
      if (typeof event.text === 'string') nextRun.thinkingText = event.text;
      else nextRun.thinkingText += event.delta ?? '';
      break;
    }
    default:
      break;
  }

  return {
    ...currentRuns,
    [event.runId]: nextRun,
  };
}

function collectRuntimeResultTexts(result: unknown): string[] {
  const texts: string[] = [];
  if (typeof result === 'string' && result.trim()) {
    texts.push(result);
  }
  if (Array.isArray(result)) {
    const text = getMessageText(result);
    if (text.trim()) texts.push(text);
  }
  const record = asRecord(result);
  if (!record) return texts;

  const candidates = [record.content, record.output, record.summary, record.error, record.stdout, record.stderr];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      texts.push(candidate);
      continue;
    }
    const text = getMessageText(candidate);
    if (text.trim()) texts.push(text);
  }

  return texts;
}

export function extractToolCompletedFiles(event: ChatRuntimeEvent, turnStartMs?: number): AttachedFileMeta[] {
  if (event.type !== 'tool.completed') return [];

  const files: AttachedFileMeta[] = extractImagesAsAttachedFiles(event.result)
    .filter((file) => !file.mimeType.startsWith('image/'))
    .map((file) => (file.source ? file : { ...file, source: 'tool-result' as const }));

  // Audio and video from any tool the turn ran, declared or found in its output.
  const resultRecord = asRecord(event.result);
  files.push(...extractToolResultMedia({
    content: resultRecord?.content ?? event.result,
    details: resultRecord?.details ?? event.result,
    producedAfter: turnStartMs,
  }));

  const seenPaths = new Set(files.map((file) => file.filePath).filter(Boolean));
  for (const text of collectRuntimeResultTexts(event.result)) {
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));
    for (const ref of mediaRefs) {
      if (seenPaths.has(ref.filePath)) continue;
      const file = makeAttachedFile(ref, 'tool-result');
      seenPaths.add(ref.filePath);
      files.push(file);
    }
    for (const ref of extractRawFilePaths(text)) {
      if (ref.mimeType.startsWith('image/')) continue;
      if (mediaRefPaths.has(ref.filePath) || seenPaths.has(ref.filePath)) continue;
      const file = makeAttachedFile(ref, 'tool-result');
      seenPaths.add(ref.filePath);
      files.push(file);
    }
  }

  return files;
}
