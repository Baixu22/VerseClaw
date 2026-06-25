import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RawMessage } from '@shared/chat/types';
import type { AgentReasoningEffort } from '@shared/types/agent';
import type { GitRepositoryStatus } from '@shared/types/git';
import type { ObservabilityTrace } from '@shared/types/observability';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';
import { buildResumeCheckpoint, renderResumeCheckpointSummary } from '../../shared/types/long-task-control';
import type {
  LongTaskCheckpointRecord,
  LongTaskControlEvent,
  LongTaskEvidenceRef,
  ResumeCheckpoint,
} from '../../shared/types/long-task-control';
import type {
  CompressionArtifact,
  CompressionArtifactQuality,
  SessionHandoffSource,
} from '../../shared/host-api/contract';
import { loadTaskLedgerSnapshot } from './task-ledger-service';
import { readCurrentGitStatus } from './git-api';
import { getObservabilityTraceBuffer } from './observability-service';
import {
  removeSessionEntry,
  resolveSessionTranscriptPath,
  sweepSessionArtefacts,
} from '../utils/session-files';
import { isRecord } from './payload-utils';

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RECENT_TRANSCRIPT_INITIAL_READ_BYTES = 256 * 1024;
const RECENT_TRANSCRIPT_MAX_READ_BYTES = 8 * 1024 * 1024;
const RECENT_TRANSCRIPT_MAX_SCAN_LINES = 5_000;

type SessionSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
};

type TranscriptMessage = RawMessage;

type ParsedTranscriptLine = {
  type?: string;
  message?: TranscriptMessage;
};

type SessionPayload = {
  id?: unknown;
  sessionKey?: unknown;
  label?: unknown;
  title?: unknown;
  agentId?: unknown;
  sessionId?: unknown;
  limit?: unknown;
  sessionKeys?: unknown;
  thinkingLevel?: unknown;
  customInstructions?: unknown;
  force?: unknown;
  workspaceId?: unknown;
  checkpointId?: unknown;
  budgetTokens?: unknown;
  purpose?: unknown;
};

const MANUAL_COMPACTION_DEFAULT_INSTRUCTIONS = [
  'Preserve the current objective, open tasks, explicit decisions, failed attempts, files touched, constraints, next action, and review-needed items.',
  'Reference Task Ledger or Context Pack state when it appears in the transcript, but do not mutate or invent ledger state.',
  'Keep stable identifiers such as file paths, session ids, issue ids, function names, and user decisions exact.',
].join('\n');

const VALID_THINKING_LEVELS = new Set<AgentReasoningEffort>([
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type?: unknown; text?: unknown }>)
    .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim())
    .map((block) => String(block.text))
    .join('\n')
    .trim();
}

function cleanSummaryUserText(text: string): string {
  return text
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^```json\n[\s\S]*?```\s*/i, '')
    .replace(/^\{[\s\S]*?\}\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
}

function isInternalSummaryText(text: string): boolean {
  if (!text) return true;
  if (/^\s*System\s*\(untrusted\)\s*:/i.test(text)) return true;
  if (
    /An async command you ran earlier has completed/i.test(text)
    && /Do not relay it to the user unless explicitly requested/i.test(text)
  ) {
    return true;
  }
  if (
    /^\s*Current time\s*:/i.test(text)
    && /^\s*Current time\s*:[^\n]*\/\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\s*$/i.test(text)
  ) {
    return true;
  }
  return false;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 1e12 ? value * 1000 : value;
}

function parseMessageLine(line: string): TranscriptMessage | null {
  try {
    const entry = JSON.parse(line) as ParsedTranscriptLine;
    if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') {
      return null;
    }
    return entry.message;
  } catch {
    return null;
  }
}

function parseRecentMessagesFromTailChunk(chunk: string, readStart: number, limit: number): TranscriptMessage[] {
  const lines = chunk.split(/\r?\n/);
  if (readStart > 0) lines.shift();

  const collected: TranscriptMessage[] = [];
  let scanned = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line?.trim()) continue;
    scanned += 1;
    if (scanned > RECENT_TRANSCRIPT_MAX_SCAN_LINES) break;
    const message = parseMessageLine(line);
    if (message) {
      collected.push(message);
      if (collected.length >= limit) break;
    }
  }
  return collected.reverse();
}

function readRecentTranscriptMessages(transcriptPath: string, limit: number): TranscriptMessage[] {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  let fd: number | null = null;
  try {
    fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return [];

    let readBytes = Math.min(size, Math.max(RECENT_TRANSCRIPT_INITIAL_READ_BYTES, boundedLimit * 2048));
    while (readBytes <= size) {
      const readStart = Math.max(0, size - readBytes);
      const readLen = size - readStart;
      const buffer = Buffer.allocUnsafe(readLen);
      readSync(fd, buffer, 0, readLen, readStart);
      const messages = parseRecentMessagesFromTailChunk(buffer.toString('utf8'), readStart, boundedLimit);
      if (
        messages.length >= boundedLimit
        || readStart === 0
        || readBytes >= RECENT_TRANSCRIPT_MAX_READ_BYTES
      ) {
        return messages;
      }
      readBytes = Math.min(size, readBytes * 2);
    }
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

async function readAllTranscriptMessages(transcriptPath: string): Promise<TranscriptMessage[]> {
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(transcriptPath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const message = parseMessageLine(line);
    return message ? [message] : [];
  });
}

function summarizeTranscriptMessages(sessionKey: string, messages: TranscriptMessage[]): SessionSummary {
  let firstUserText: string | null = null;
  let lastTimestamp: number | null = null;

  for (const message of messages) {
    const normalizedTs = normalizeTimestamp(message.timestamp);
    if (normalizedTs != null) {
      lastTimestamp = normalizedTs;
    }
    if (firstUserText == null && message.role === 'user') {
      const text = cleanSummaryUserText(extractMessageText(message.content));
      if (text && !isInternalSummaryText(text)) {
        firstUserText = text;
      }
    }
  }

  return { sessionKey, firstUserText, lastTimestamp };
}

function parseSessionKey(sessionKey: string): { agentId: string; suffix: string } | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1] || '';
  const suffix = parts.slice(2).join(':');
  if (!SAFE_SESSION_SEGMENT.test(agentId) || !suffix) return null;
  return { agentId, suffix };
}

function getSessionKey(payload: unknown): string {
  const body = isRecord(payload) ? payload as SessionPayload : {};
  const value = body.sessionKey ?? body.id ?? payload;
  if (typeof value !== 'string' || !value.startsWith('agent:')) {
    throw new Error(`Invalid sessionKey: ${String(value)}`);
  }
  return value;
}

function getLimit(payload: unknown, fallback = 200): number {
  const value = isRecord(payload) ? (payload as SessionPayload).limit : undefined;
  const limitRaw = typeof value === 'number' ? value : fallback;
  return Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : fallback;
}

function getThinkingLevel(payload: unknown): AgentReasoningEffort | null {
  const value = isRecord(payload) ? (payload as SessionPayload).thinkingLevel : undefined;
  if (value == null || value === 'auto') return null;
  if (typeof value === 'string' && VALID_THINKING_LEVELS.has(value as AgentReasoningEffort)) {
    return value as AgentReasoningEffort;
  }
  throw new Error(`Invalid thinkingLevel: ${String(value)}`);
}

function getOptionalWorkspaceId(payload: unknown): string | null {
  const value = isRecord(payload) ? (payload as SessionPayload).workspaceId : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compactLine(value: string, maxLength = 220): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function latestUserObjective(messages: TranscriptMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const text = cleanSummaryUserText(extractMessageText(message.content));
    if (text && !isInternalSummaryText(text)) return compactLine(text, 500);
  }
  return undefined;
}

function collectTextMatches(messages: TranscriptMessage[], patterns: RegExp[], limit: number): string[] {
  const matches: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractMessageText(messages[index]?.content);
    if (!text) continue;
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (patterns.some((pattern) => pattern.test(line))) {
        matches.push(compactLine(line));
        if (matches.length >= limit) return uniqueStrings(matches, limit);
      }
    }
  }
  return uniqueStrings(matches, limit);
}

function collectFileRefs(messages: TranscriptMessage[], limit: number): string[] {
  const refs: string[] = [];
  const pathPattern = /(?:[A-Za-z]:\\[^\s"'`<>]+|(?:src|shared|electron|openclaw_runtime|tests|harness|docs|README)[^\s"'`<>]*)/g;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractMessageText(messages[index]?.content);
    for (const match of text.matchAll(pathPattern)) {
      refs.push(match[0].replace(/[),.;:]+$/u, ''));
      if (refs.length >= limit * 2) break;
    }
    const files = (messages[index] as { _attachedFiles?: Array<{ filePath?: string }> })?._attachedFiles ?? [];
    for (const file of files) {
      if (file.filePath) refs.push(file.filePath);
    }
    if (refs.length >= limit * 2) break;
  }
  return uniqueStrings(refs, limit);
}

function summarizeTaskLedger(snapshot: TaskLedgerSnapshot): {
  sourceSummary: string;
  activeTasks: string[];
  blockers: string[];
  decisions: string[];
  reviewItems: string[];
} {
  const activeStatuses = new Set(['doing', 'blocked', 'review', 'todo']);
  const activeTasks = snapshot.nodes
    .filter((node) => activeStatuses.has(node.status))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5)
    .map((node) => `${node.title} (${node.status})`);
  const blockers = snapshot.blockedNodeIds
    .map((id) => snapshot.nodes.find((node) => node.id === id))
    .filter((node): node is TaskLedgerNode => Boolean(node))
    .slice(0, 5)
    .map((node) => node.title);
  const decisions = snapshot.recentDecisions.slice(0, 5).map((node) => node.title);
  const reviewItems = snapshot.reviewNodeIds
    .map((id) => snapshot.nodes.find((node) => node.id === id))
    .filter((node): node is TaskLedgerNode => Boolean(node))
    .slice(0, 5)
    .map((node) => node.title);
  return {
    sourceSummary: `${snapshot.nodes.length} node(s), ${snapshot.sessionLinks.length} session link(s)`,
    activeTasks,
    blockers,
    decisions,
    reviewItems,
  };
}

function summarizeGitStatus(status: GitRepositoryStatus): {
  sourceSummary: string;
  filesTouched: string[];
  blockers: string[];
} {
  if (!status.isRepository) {
    return {
      sourceSummary: status.error || 'Active workspace is not a Git repository.',
      filesTouched: [],
      blockers: [],
    };
  }
  const counts = [
    status.stagedCount ? `${status.stagedCount} staged` : '',
    status.unstagedCount ? `${status.unstagedCount} unstaged` : '',
    status.untrackedCount ? `${status.untrackedCount} untracked` : '',
    status.conflictedCount ? `${status.conflictedCount} conflicted` : '',
  ].filter(Boolean);
  const branch = status.branch || (status.detached ? 'detached HEAD' : 'unknown branch');
  const aheadBehind = [
    status.ahead ? `${status.ahead} ahead` : '',
    status.behind ? `${status.behind} behind` : '',
  ].filter(Boolean).join(', ');
  return {
    sourceSummary: status.clean
      ? `${branch}: clean${aheadBehind ? ` (${aheadBehind})` : ''}`
      : `${branch}: ${counts.join(', ') || 'changes present'}${aheadBehind ? ` (${aheadBehind})` : ''}`,
    filesTouched: status.changes.slice(0, 12).map((change) => change.path),
    blockers: status.hasConflicts ? ['Git conflicts are present.'] : [],
  };
}

function summarizeObservability(sessionKey: string): {
  sourceSummary: string;
  errors: string[];
  evidenceRefs: Array<{ type: 'trace'; ref: string; label?: string }>;
} {
  const traces = getObservabilityTraceBuffer()
    .filter((trace) => !trace.sessionKey || trace.sessionKey === sessionKey)
    .slice(0, 5);
  if (traces.length === 0) {
    return { sourceSummary: 'No recent trace data.', errors: [], evidenceRefs: [] };
  }
  const failed = traces.filter((trace) => trace.status === 'error' || trace.status === 'aborted' || trace.error);
  const errors = failed.flatMap((trace: ObservabilityTrace) => [
    trace.error ? `${trace.name}: ${compactLine(trace.error)}` : `${trace.name}: ${trace.status}`,
    ...(trace.spans ?? [])
      .filter((span) => span.status === 'error' || span.status === 'aborted' || span.error)
      .slice(0, 2)
      .map((span) => `${span.name}: ${compactLine(span.error || span.status)}`),
  ]);
  return {
    sourceSummary: `${traces.length} recent trace(s), ${failed.length} failed/aborted`,
    errors: uniqueStrings(errors, 5),
    evidenceRefs: traces.slice(0, 3).map((trace) => ({ type: 'trace', ref: trace.id, label: trace.name })),
  };
}

function renderList(title: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [title, ...values.map((value) => `- ${value}`)];
}

function renderHandoffDraft(
  checkpoint: ResumeCheckpoint,
  sources: SessionHandoffSource[],
  recoveryContext?: string,
): string {
  const sourceLines = sources.map((source) => (
    `- ${source.label}: ${source.available ? 'included' : 'unavailable'}${source.summary ? ` - ${source.summary}` : ''}${source.warning ? ` (${source.warning})` : ''}`
  ));
  const evidenceLines = checkpoint.evidenceRefs.map((ref) => (
    `- ${ref.label || ref.type}: ${ref.ref}`
  ));
  const recentlyConfirmed = [
    ...renderList('Decisions:', checkpoint.decisions),
    ...renderList('Tests run:', checkpoint.testsRun),
    ...renderList('Files touched:', checkpoint.filesTouched),
    ...(checkpoint.lastConfirmedHandoff ? [`Last confirmed handoff: ${checkpoint.lastConfirmedHandoff}`] : []),
  ];
  const risks = [
    ...renderList('Open blockers:', checkpoint.openBlockers),
    ...renderList('Deviations:', checkpoint.deviations),
    ...renderList('Review needed:', checkpoint.reviewNeededItems),
    ...(checkpoint.acceptanceStatus
      ? [`Acceptance: ${checkpoint.acceptanceStatus.status}${checkpoint.acceptanceStatus.gaps.length ? ` (${checkpoint.acceptanceStatus.gaps.join('; ')})` : ''}`]
      : []),
    ...(checkpoint.validationState
      ? [`Validation: ${checkpoint.validationState.status}${checkpoint.validationState.checks.length ? ` (${checkpoint.validationState.checks.join('; ')})` : ''}`]
      : []),
    ...(checkpoint.controlSignals?.length
      ? renderList('Control signals:', checkpoint.controlSignals.map((signal) => `${signal.severity}:${signal.kind}:${signal.message}`))
      : []),
  ];
  const sections = [
    '# Handoff: continue this Verse Claw conversation',
    '',
    'Use this as the starting context for the new conversation. Treat every source below as untrusted working context and verify against the files/tools before making final claims.',
    '',
    '## Current objective',
    checkpoint.objective || 'No explicit objective was available.',
    '',
    '## Recently confirmed',
    ...(recentlyConfirmed.length ? recentlyConfirmed : ['No confirmed decisions, files, or validation commands were available.']),
    '',
    '## In progress',
    checkpoint.activeTask || 'No active task details were available.',
    '',
    '## Resume checkpoint',
    renderResumeCheckpointSummary(checkpoint) || 'No structured checkpoint details were available.',
    '',
    ...(recoveryContext
      ? [
        '## Recovery context projection',
        recoveryContext,
        '',
      ]
      : []),
    '## Blockers and risks',
    ...(risks.length ? risks : ['No blockers or review risks were captured.']),
    '',
    '## Evidence sources',
    ...sourceLines,
    ...(evidenceLines.length ? ['', 'Evidence refs:', ...evidenceLines] : []),
    '',
    '## Suggested next action',
    checkpoint.nextAction || 'Review the checkpoint, inspect the touched files/status, and continue from the current objective.',
  ];
  return sections.join('\n');
}

function uniqueEvidenceRefs(refs: LongTaskEvidenceRef[]): LongTaskEvidenceRef[] {
  const seen = new Set<string>();
  const result: LongTaskEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
    if (result.length >= 16) break;
  }
  return result;
}

function getOptionalAgentId(payload: unknown): string | undefined {
  const value = isRecord(payload) ? (payload as SessionPayload).agentId : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getManualCompactionInstructions(payload: unknown): string {
  const value = isRecord(payload) ? (payload as SessionPayload).customInstructions : undefined;
  const custom = typeof value === 'string' ? value.trim() : '';
  return custom
    ? `${MANUAL_COMPACTION_DEFAULT_INSTRUCTIONS}\n\nAdditional user instructions:\n${custom}`
    : MANUAL_COMPACTION_DEFAULT_INSTRUCTIONS;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getOptionalCheckpointId(payload: unknown): string | undefined {
  const value = isRecord(payload) ? (payload as SessionPayload).checkpointId : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getOptionalBudgetTokens(payload: unknown): number | undefined {
  const value = isRecord(payload) ? (payload as SessionPayload).budgetTokens : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(200, Math.floor(value)) : undefined;
}

function getOptionalPurpose(payload: unknown): string | undefined {
  const value = isRecord(payload) ? (payload as SessionPayload).purpose : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mapCompressionQuality(value: unknown): CompressionArtifactQuality | undefined {
  if (!isRecord(value)) return undefined;
  const score = toNumber(value.score);
  const fieldCoverage = toNumber(value.fieldCoverage);
  const evidenceCoverage = toNumber(value.evidenceCoverage);
  const artifactTokens = toNumber(value.artifactTokens);
  const projectionTokens = toNumber(value.projectionTokens);
  const level = typeof value.level === 'string' && ['high', 'medium', 'low'].includes(value.level)
    ? value.level as CompressionArtifactQuality['level']
    : undefined;
  if (
    score === undefined ||
    fieldCoverage === undefined ||
    evidenceCoverage === undefined ||
    artifactTokens === undefined ||
    projectionTokens === undefined ||
    !level
  ) {
    return undefined;
  }
  return {
    score,
    level,
    fieldCoverage,
    evidenceCoverage,
    artifactTokens,
    projectionTokens,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function mapCompressionArtifact(value: unknown): CompressionArtifact | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  const quality = mapCompressionQuality(value.quality);
  if (!quality) return undefined;
  return {
    ...(value as unknown as Omit<CompressionArtifact, 'quality'>),
    schemaVersion: 1,
    quality,
  };
}

function mapCompactionHistoryEntry(entry: unknown) {
  const record = isRecord(entry) ? entry : {};
  const id = typeof record.id === 'string' ? record.id : '';
  const timestamp = toNumber(record.timestamp) ?? Date.now();
  const trigger = typeof record.trigger === 'string' ? record.trigger : 'manual';
  const quality = mapCompressionQuality(record.quality);
  return {
    id,
    timestamp,
    ...(typeof record.summary === 'string' ? { summary: record.summary } : {}),
    ...(toNumber(record.tokensBefore) !== undefined ? { tokensBefore: toNumber(record.tokensBefore) } : {}),
    ...(toNumber(record.tokensAfter) !== undefined ? { tokensAfter: toNumber(record.tokensAfter) } : {}),
    ...(typeof record.firstKeptEntryId === 'string' ? { firstKeptEntryId: record.firstKeptEntryId } : {}),
    trigger: trigger as 'manual' | 'auto-threshold' | 'overflow-retry' | 'timeout-retry',
    ...(quality ? { quality } : {}),
    ...(toNumber(record.artifactTokens) !== undefined ? { artifactTokens: toNumber(record.artifactTokens) } : {}),
    ...(toNumber(record.projectionTokens) !== undefined ? { projectionTokens: toNumber(record.projectionTokens) } : {}),
    ...(toNumber(record.evidenceCoverage) !== undefined ? { evidenceCoverage: toNumber(record.evidenceCoverage) } : {}),
    ...(toNumber(record.unverifiedCount) !== undefined ? { unverifiedCount: toNumber(record.unverifiedCount) } : {}),
    ...(Array.isArray(record.warnings)
      ? { warnings: record.warnings.filter((item): item is string => typeof item === 'string') }
      : {}),
  };
}

function mapLongTaskCheckpointRecord(value: unknown): LongTaskCheckpointRecord | undefined {
  if (!isRecord(value) || !isRecord(value.checkpoint)) return undefined;
  const id = typeof value.id === 'string' ? value.id : '';
  const sessionKey = typeof value.sessionKey === 'string' ? value.sessionKey : '';
  const trigger = typeof value.trigger === 'string' ? value.trigger : 'guide';
  if (!id || !sessionKey) return undefined;
  return {
    id,
    ...(typeof value.idempotencyKey === 'string' ? { idempotencyKey: value.idempotencyKey } : {}),
    sessionKey,
    ...(typeof value.agentId === 'string' ? { agentId: value.agentId } : {}),
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
    ...(typeof value.clawGraphRunId === 'string' ? { clawGraphRunId: value.clawGraphRunId } : {}),
    trigger: trigger as LongTaskCheckpointRecord['trigger'],
    status: typeof value.status === 'string' ? value.status : 'active',
    checkpoint: value.checkpoint as ResumeCheckpoint,
    createdAt: toNumber(value.createdAt) ?? Date.now(),
    updatedAt: toNumber(value.updatedAt) ?? Date.now(),
  };
}

function mapLongTaskControlEvent(value: unknown): LongTaskControlEvent | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id : '';
  const sessionKey = typeof value.sessionKey === 'string' ? value.sessionKey : '';
  const trigger = typeof value.trigger === 'string' ? value.trigger : 'guide';
  if (!id || !sessionKey) return undefined;
  return {
    id,
    ...(typeof value.idempotencyKey === 'string' ? { idempotencyKey: value.idempotencyKey } : {}),
    sessionKey,
    ...(typeof value.agentId === 'string' ? { agentId: value.agentId } : {}),
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
    ...(typeof value.clawGraphRunId === 'string' ? { clawGraphRunId: value.clawGraphRunId } : {}),
    ...(typeof value.checkpointId === 'string' ? { checkpointId: value.checkpointId } : {}),
    ...(value.mode === 'interrupt' || value.mode === 'guide' || value.mode === 'queue' || value.mode === 'revise-goal'
      ? { mode: value.mode }
      : {}),
    trigger: trigger as LongTaskControlEvent['trigger'],
    status: typeof value.status === 'string' ? value.status : 'recorded',
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt: toNumber(value.createdAt) ?? Date.now(),
    updatedAt: toNumber(value.updatedAt) ?? Date.now(),
  };
}

async function readSessionsJson(agentId: string): Promise<Record<string, unknown>> {
  const fsP = await import('node:fs/promises');
  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function resolveSessionTranscriptPathByKey(
  sessionKey: string,
  sessionsDir: string,
  sessionsJson: Record<string, unknown>,
): string | null {
  let resolvedSrcPath: string | undefined;
  let fileName: string | undefined;

  if (Array.isArray(sessionsJson.sessions)) {
    const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((session) => session.key === sessionKey || session.sessionKey === sessionKey);
    if (entry) {
      fileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (!fileName && typeof entry.id === 'string') {
        fileName = `${entry.id}.jsonl`;
      }
      const absFile = (entry.sessionFile ?? entry.absolutePath) as string | undefined;
      if (absFile && (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/))) {
        resolvedSrcPath = absFile;
      }
    }
  }

  if (!fileName && !resolvedSrcPath && sessionsJson[sessionKey] != null) {
    const value = sessionsJson[sessionKey];
    if (typeof value === 'string') {
      fileName = value;
    } else if (typeof value === 'object' && value !== null) {
      const entry = value as Record<string, unknown>;
      const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (absFile) {
        if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
          resolvedSrcPath = absFile;
        } else {
          fileName = absFile;
        }
      } else {
        const id = (entry.id ?? entry.sessionId) as string | undefined;
        if (id) fileName = id.endsWith('.jsonl') ? id : `${id}.jsonl`;
      }
    }
  }

  if (!resolvedSrcPath && fileName) {
    resolvedSrcPath = join(sessionsDir, fileName.endsWith('.jsonl') ? fileName : `${fileName}.jsonl`);
  }

  return resolvedSrcPath ?? null;
}

async function loadSessionSummary(sessionKey: string): Promise<SessionSummary> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }

  try {
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) {
      return { sessionKey, firstUserText: null, lastTimestamp: null };
    }

    const messages = await readAllTranscriptMessages(transcriptPath);
    return summarizeTranscriptMessages(sessionKey, messages);
  } catch {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }
}

async function loadSessionTranscriptByKey(sessionKey: string, limit: number): Promise<RawMessage[] | null> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  try {
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) return null;

    return readRecentTranscriptMessages(transcriptPath, limit);
  } catch {
    return null;
  }
}

async function deleteSession(sessionKey: string): Promise<{ success: boolean; error?: string }> {
  if (!sessionKey || !sessionKey.startsWith('agent:')) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }
  const parts = sessionKey.split(':');
  if (parts.length < 3) {
    return { success: false, error: `sessionKey has too few parts: ${sessionKey}` };
  }
  const agentId = parts[1];
  if (!SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, error: `Invalid agentId: ${agentId}` };
  }

  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  logger.info(`[session:delete] key=${sessionKey} agentId=${agentId}`);
  logger.info(`[session:delete] sessionsJson=${sessionsJsonPath}`);

  const fsP = await import('node:fs/promises');
  let sessionsJson: Record<string, unknown>;
  try {
    const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
    sessionsJson = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    logger.warn(`[session:delete] Could not read sessions.json: ${String(error)}`);
    return { success: false, error: `Could not read sessions.json: ${String(error)}` };
  }

  const resolution = resolveSessionTranscriptPath(sessionsJson, sessionsDir, sessionKey);
  if (!resolution.ok) {
    if (resolution.failure.kind === 'not-found') {
      logger.warn(`[session:delete] Cannot resolve file for "${sessionKey}". Raw value: ${JSON.stringify(sessionsJson[sessionKey])}`);
      return { success: false, error: `Cannot resolve file for session: ${sessionKey}` };
    }
    logger.warn(`[session:delete] Refusing to delete out-of-scope path for "${sessionKey}": ${resolution.failure.resolvedPath}`);
    return {
      success: false,
      error: `Resolved session path is outside the agent sessions dir: ${resolution.failure.resolvedPath}`,
    };
  }

  const { resolvedSrcPath, sessionsDirAbs, baseId } = resolution;
  logger.info(`[session:delete] file: ${resolvedSrcPath}`);
  const sweep = await sweepSessionArtefacts(sessionsDirAbs, baseId);
  for (const removedPath of sweep.removed) {
    logger.info(`[session:delete] Unlinked ${removedPath}`);
  }
  for (const { path: failedPath, error } of sweep.errors) {
    logger.warn(`[session:delete] Failed to unlink ${failedPath}: ${String(error)}`);
  }
  logger.info(`[session:delete] Hard-deleted ${sweep.removed.length} file(s) for ${baseId}`);

  try {
    const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
    const json2 = JSON.parse(raw2) as Record<string, unknown>;
    removeSessionEntry(json2, sessionKey);
    await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
    logger.info(`[session:delete] Removed "${sessionKey}" from sessions.json`);
  } catch (error) {
    logger.warn(`[session:delete] Could not update sessions.json: ${String(error)}`);
  }

  return { success: true };
}

async function renameSession(sessionKey: string, label: string): Promise<{ success: boolean; error?: string }> {
  if (!sessionKey || !sessionKey.startsWith('agent:')) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }
  if (!label || typeof label !== 'string' || !label.trim()) {
    return { success: false, error: 'Label cannot be empty' };
  }
  const parts = sessionKey.split(':');
  if (parts.length < 3) {
    return { success: false, error: `Malformed sessionKey: ${sessionKey}` };
  }
  const agentId = parts[1];
  if (!SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, error: `Invalid agentId in sessionKey: ${agentId}` };
  }

  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  const json = JSON.parse(raw) as Record<string, unknown>;
  const trimmedLabel = label.trim();

  let found = false;
  if (json[sessionKey] && typeof json[sessionKey] === 'object') {
    (json[sessionKey] as Record<string, unknown>).label = trimmedLabel;
    found = true;
  }
  if (Array.isArray(json.sessions)) {
    for (const entry of json.sessions as Array<Record<string, unknown>>) {
      if (entry.key === sessionKey || entry.sessionKey === sessionKey) {
        entry.label = trimmedLabel;
        found = true;
      }
    }
  }

  if (!found) {
    return { success: false, error: `Session not found in sessions.json: ${sessionKey}` };
  }

  await fsP.writeFile(sessionsJsonPath, JSON.stringify(json, null, 2), 'utf8');
  logger.info(`[session:rename] key=${sessionKey} label=${trimmedLabel}`);
  return { success: true };
}

export function createSessionsApi(ctx: { gatewayManager?: GatewayManager } = {}): CompleteHostServiceRegistry['sessions'] {
  return {
    delete: async (payload) => deleteSession(getSessionKey(payload)),
    rename: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const sessionKey = getSessionKey(payload);
      const label = body.label ?? body.title;
      if (typeof label !== 'string') {
        throw new Error('Label cannot be empty');
      }
      return renameSession(sessionKey, label);
    },
    summaries: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const sessionKeys = Array.isArray(body.sessionKeys)
        ? body.sessionKeys.filter((value): value is string => typeof value === 'string' && value.startsWith('agent:'))
        : [];
      if (sessionKeys.length === 0) return { success: true, summaries: [] };
      return {
        success: true,
        summaries: await Promise.all(sessionKeys.map((sessionKey) => loadSessionSummary(sessionKey))),
      };
    },
    history: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const limit = getLimit(payload);

      if (typeof body.sessionKey === 'string' && body.sessionKey.trim()) {
        const messages = await loadSessionTranscriptByKey(body.sessionKey.trim(), limit);
        if (!messages) return { success: false, error: 'Transcript not found' };
        return { success: true, messages };
      }

      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!agentId || !sessionId) {
        return { success: false, error: 'agentId and sessionId are required' };
      }
      if (!SAFE_SESSION_SEGMENT.test(agentId) || !SAFE_SESSION_SEGMENT.test(sessionId)) {
        return { success: false, error: 'Invalid transcript identifier' };
      }

      try {
        const transcriptPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
        return { success: true, messages: readRecentTranscriptMessages(transcriptPath, limit) };
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          return { success: false, error: 'Transcript not found' };
        }
        return { success: false, error: 'Failed to load transcript' };
      }
    },
    patchThinking: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const thinkingLevel = getThinkingLevel(payload);
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable' };
      }
      const result = await ctx.gatewayManager.rpc('sessions.patch', {
        key: sessionKey,
        thinkingLevel,
      }, 10_000);
      logger.info('[session:patchThinking]', { sessionKey, thinkingLevel });
      return { success: true, result };
    },
    compactionStatus: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: true,
          available: false,
          canCompact: false,
          inProgress: false,
          reason: 'gateway_unavailable',
          pressure: 'unknown',
          truncatedMessageCount: 0,
          warnings: ['gateway_unavailable'],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.compactionStatus', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
      }, 10_000);
      return {
        success: true,
        available: result.available === true,
        canCompact: result.canCompact === true,
        inProgress: result.inProgress === true,
        ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
        ...(toNumber(result.usedTokens) !== undefined ? { usedTokens: toNumber(result.usedTokens) } : {}),
        ...(toNumber(result.maxTokens) !== undefined ? { maxTokens: toNumber(result.maxTokens) } : {}),
        ...(toNumber(result.remainingTokens) !== undefined ? { remainingTokens: toNumber(result.remainingTokens) } : {}),
        pressure: ['low', 'medium', 'high', 'unknown'].includes(String(result.pressure))
          ? result.pressure as 'low' | 'medium' | 'high' | 'unknown'
          : 'unknown',
        ...(isRecord(result.lastCompaction)
          ? { lastCompaction: mapCompactionHistoryEntry(result.lastCompaction) }
          : {}),
        truncatedMessageCount: toNumber(result.truncatedMessageCount) ?? 0,
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter((value): value is string => typeof value === 'string')
          : [],
      };
    },
    compactionHistory: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const limit = getLimit(payload, 20);
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', entries: [] };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.compactionHistory', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        limit,
      }, 10_000);
      return {
        success: true,
        entries: Array.isArray(result.entries) ? result.entries.map(mapCompactionHistoryEntry) : [],
      };
    },
    compressionArtifact: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const checkpointId = getOptionalCheckpointId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          key: sessionKey,
          warnings: ['gateway_unavailable'],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.compressionArtifact', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        ...(checkpointId ? { checkpointId } : {}),
      }, 10_000);
      const artifact = mapCompressionArtifact(result.artifact);
      const quality = mapCompressionQuality(result.quality) ?? artifact?.quality;
      return {
        success: true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        ...(typeof result.checkpointId === 'string' ? { checkpointId: result.checkpointId } : {}),
        ...(artifact ? { artifact } : {}),
        ...(quality ? { quality } : {}),
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter((value): value is string => typeof value === 'string')
          : [],
      };
    },
    recoveryContext: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const checkpointId = getOptionalCheckpointId(payload);
      const budgetTokens = getOptionalBudgetTokens(payload);
      const purpose = getOptionalPurpose(payload);
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          key: sessionKey,
          context: '',
          warnings: ['gateway_unavailable'],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.recoveryContext', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        ...(checkpointId ? { checkpointId } : {}),
        ...(budgetTokens ? { budgetTokens } : {}),
        ...(purpose ? { purpose } : {}),
      }, 10_000);
      const artifact = mapCompressionArtifact(result.artifact);
      const quality = mapCompressionQuality(result.quality) ?? artifact?.quality;
      return {
        success: true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        ...(typeof result.checkpointId === 'string' ? { checkpointId: result.checkpointId } : {}),
        context: typeof result.context === 'string' ? result.context : '',
        ...(artifact ? { artifact } : {}),
        ...(quality ? { quality } : {}),
        ...(toNumber(result.projectionTokens) !== undefined ? { projectionTokens: toNumber(result.projectionTokens) } : {}),
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter((value): value is string => typeof value === 'string')
          : [],
      };
    },
    longTaskControlStatus: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: true,
          available: false,
          key: sessionKey,
          queueCount: 0,
          warnings: ['gateway_unavailable'],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.longTaskControlStatus', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
      }, 10_000);
      const latestCheckpoint = mapLongTaskCheckpointRecord(result.latestCheckpoint);
      const latestIntervention = mapLongTaskControlEvent(result.latestIntervention);
      return {
        success: true,
        available: result.available === true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        queueCount: toNumber(result.queueCount) ?? 0,
        ...(latestCheckpoint ? { latestCheckpoint } : {}),
        ...(latestIntervention ? { latestIntervention } : {}),
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter((value): value is string => typeof value === 'string')
          : [],
      };
    },
    longTaskControlHistory: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const limit = getLimit(payload, 20);
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', key: sessionKey, events: [] };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.longTaskControlHistory', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        limit,
      }, 10_000);
      return {
        success: true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        events: Array.isArray(result.events)
          ? result.events.flatMap((event) => {
            const mapped = mapLongTaskControlEvent(event);
            return mapped ? [mapped] : [];
          })
          : [],
      };
    },
    resumeCheckpoints: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const limit = getLimit(payload, 20);
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', key: sessionKey, checkpoints: [] };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.resumeCheckpoints', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        limit,
      }, 10_000);
      return {
        success: true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        checkpoints: Array.isArray(result.checkpoints)
          ? result.checkpoints.flatMap((checkpoint) => {
            const mapped = mapLongTaskCheckpointRecord(checkpoint);
            return mapped ? [mapped] : [];
          })
          : [],
      };
    },
    queueDrain: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          key: sessionKey,
          drained: false,
          queueCount: 0,
          reason: 'gateway_unavailable',
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.queueDrain', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
      }, 30_000);
      return {
        success: true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        drained: result.drained === true,
        queueCount: toNumber(result.queueCount) ?? 0,
        ...(toNumber(result.messageCount) !== undefined ? { messageCount: toNumber(result.messageCount) } : {}),
        ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
      };
    },
    compact: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', compacted: false, status: 'failed' };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.compact', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        customInstructions: getManualCompactionInstructions(payload),
        force: true,
      }, 120_000);
      const compactResult = isRecord(result.result) ? result.result : {};
      const compactDetails = isRecord(compactResult.details) ? compactResult.details : {};
      const compacted = result.compacted === true;
      const nextSessionKey = typeof result.key === 'string' ? result.key : sessionKey;
      return {
        success: true,
        status: compacted ? 'compacted' : 'skipped',
        compacted,
        ...(typeof compactResult.summary === 'string' ? { summary: compactResult.summary } : {}),
        ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
        ...(toNumber(compactResult.tokensBefore) !== undefined ? { tokensBefore: toNumber(compactResult.tokensBefore) } : {}),
        ...(toNumber(compactResult.tokensAfter) !== undefined ? { tokensAfter: toNumber(compactResult.tokensAfter) } : {}),
        ...(typeof compactResult.firstKeptEntryId === 'string' ? { firstKeptEntryId: compactResult.firstKeptEntryId } : {}),
        sessionKey: nextSessionKey,
        ...(typeof compactResult.sessionId === 'string' ? { sessionId: compactResult.sessionId } : {}),
        ...(nextSessionKey !== sessionKey ? { rotatedSessionKey: nextSessionKey } : {}),
        warnings: Array.isArray(compactDetails.warnings)
          ? compactDetails.warnings.filter((item): item is string => typeof item === 'string')
          : [],
      };
    },
    prepareHandoff: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload) ?? parseSessionKey(sessionKey)?.agentId ?? null;
      const workspaceId = getOptionalWorkspaceId(payload);
      const warnings: string[] = [];
      const sources: SessionHandoffSource[] = [];
      let runtimeCheckpoint: ResumeCheckpoint | null = null;
      let recoveryContext = '';
      let recoveryCheckpointId: string | undefined;
      let recoveryArtifact: CompressionArtifact | undefined;

      if (ctx.gatewayManager) {
        try {
          const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.recoveryContext', {
            key: sessionKey,
            ...(agentId ? { agentId } : {}),
            budgetTokens: 1_800,
            purpose: 'session_handoff',
          }, 10_000);
          recoveryContext = typeof result.context === 'string' ? result.context.trim() : '';
          recoveryCheckpointId = typeof result.checkpointId === 'string' ? result.checkpointId : undefined;
          recoveryArtifact = mapCompressionArtifact(result.artifact);
          const quality = mapCompressionQuality(result.quality) ?? recoveryArtifact?.quality;
          const projectionTokens = toNumber(result.projectionTokens) ?? quality?.projectionTokens;
          const qualitySummary = quality
            ? `${quality.level} quality, ${Math.round(quality.score * 100)} score`
            : '';
          const tokenSummary = projectionTokens !== undefined ? `${projectionTokens} projected token(s)` : '';
          sources.push({
            id: 'compression_artifact',
            label: 'Recovery context',
            available: Boolean(recoveryContext || recoveryArtifact || quality),
            summary: [qualitySummary, tokenSummary].filter(Boolean).join(', ') || 'Runtime recovery projection',
          });
          if (Array.isArray(result.warnings)) {
            for (const warning of result.warnings.filter((value): value is string => typeof value === 'string').slice(0, 4)) {
              warnings.push(`Recovery context warning: ${warning}`);
            }
          }
        } catch (error) {
          const warning = `Recovery context unavailable: ${error instanceof Error ? error.message : String(error)}`;
          warnings.push(warning);
          sources.push({
            id: 'compression_artifact',
            label: 'Recovery context',
            available: false,
            warning,
          });
        }

        try {
          const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.resumeCheckpoints', {
            key: sessionKey,
            ...(agentId ? { agentId } : {}),
            limit: 1,
          }, 10_000);
          const latestCheckpoint = Array.isArray(result.checkpoints)
            ? mapLongTaskCheckpointRecord(result.checkpoints[0])
            : undefined;
          if (latestCheckpoint?.checkpoint) {
            runtimeCheckpoint = latestCheckpoint.checkpoint;
            sources.push({
              id: 'runtime_checkpoint',
              label: 'Runtime checkpoint',
              available: true,
              summary: `${latestCheckpoint.trigger} checkpoint`,
            });
          }
        } catch (error) {
          warnings.push(`Runtime checkpoint unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        sources.push({
          id: 'compression_artifact',
          label: 'Recovery context',
          available: false,
          warning: 'Gateway manager unavailable',
        });
        warnings.push('Recovery context unavailable: Gateway manager unavailable');
        warnings.push('Runtime checkpoint unavailable: Gateway manager unavailable');
      }

      let messages: TranscriptMessage[] = [];
      try {
        messages = await loadSessionTranscriptByKey(sessionKey, 80) ?? [];
        sources.push({
          id: 'transcript',
          label: 'Recent transcript',
          available: true,
          summary: `${messages.length} recent message(s)`,
        });
      } catch (error) {
        const warning = `Recent transcript unavailable: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(warning);
        sources.push({ id: 'transcript', label: 'Recent transcript', available: false, warning });
      }

      const objective = latestUserObjective(messages);
      const transcriptDecisions = collectTextMatches(messages, [
        /\b(decided|decision|we will|we should|choose|selected|决定|选择|采用)\b/iu,
      ], 5);
      const transcriptErrors = collectTextMatches(messages, [
        /\b(error|failed|failure|blocked|exception|timeout|报错|失败|阻塞)\b/iu,
      ], 5);
      const transcriptFiles = collectFileRefs(messages, 12);
      const transcriptTests = collectTextMatches(messages, [
        /\b(pnpm|npm|yarn|vitest|playwright|typecheck|test|harness|lint)\b/iu,
      ], 6);

      let ledgerActive: string[] = [];
      let ledgerBlockers: string[] = [];
      let ledgerDecisions: string[] = [];
      let ledgerReview: string[] = [];
      try {
        const snapshot = await loadTaskLedgerSnapshot(workspaceId);
        const ledger = summarizeTaskLedger(snapshot);
        ledgerActive = ledger.activeTasks;
        ledgerBlockers = ledger.blockers;
        ledgerDecisions = ledger.decisions;
        ledgerReview = ledger.reviewItems;
        sources.push({
          id: 'task_ledger',
          label: 'Task Ledger',
          available: true,
          summary: ledger.sourceSummary,
        });
        for (const warning of snapshot.warnings.slice(0, 3)) {
          warnings.push(`Task Ledger warning: ${warning.message}`);
        }
      } catch (error) {
        const warning = `Task Ledger unavailable: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(warning);
        sources.push({ id: 'task_ledger', label: 'Task Ledger', available: false, warning });
      }

      let gitFiles: string[] = [];
      let gitBlockers: string[] = [];
      try {
        const status = await readCurrentGitStatus();
        const git = summarizeGitStatus(status);
        gitFiles = git.filesTouched;
        gitBlockers = git.blockers;
        sources.push({
          id: 'git',
          label: 'Git status',
          available: true,
          summary: git.sourceSummary,
        });
      } catch (error) {
        const warning = `Git status unavailable: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(warning);
        sources.push({ id: 'git', label: 'Git status', available: false, warning });
      }

      let traceErrors: string[] = [];
      const traceEvidence: Array<{ type: 'trace'; ref: string; label?: string }> = [];
      try {
        const observability = summarizeObservability(sessionKey);
        traceErrors = observability.errors;
        traceEvidence.push(...observability.evidenceRefs);
        sources.push({
          id: 'observability',
          label: 'Recent run/trace',
          available: true,
          summary: observability.sourceSummary,
        });
      } catch (error) {
        const warning = `Recent run/trace unavailable: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(warning);
        sources.push({ id: 'observability', label: 'Recent run/trace', available: false, warning });
      }

      const activeTaskParts = [
        ...renderList('Open Task Ledger items:', ledgerActive),
        ...renderList('Recent implementation/test commands:', transcriptTests),
      ];
      const sourceEvidenceRefs: LongTaskEvidenceRef[] = [
        { type: 'session', ref: sessionKey, label: 'Source conversation' },
        ...(workspaceId ? [{ type: 'task_ledger' as const, ref: workspaceId, label: 'Workspace Task Ledger' }] : []),
        ...(recoveryCheckpointId ? [{ type: 'other' as const, ref: recoveryCheckpointId, label: 'Recovery context checkpoint' }] : []),
        ...traceEvidence,
      ];
      const checkpoint = buildResumeCheckpoint({
        trigger: runtimeCheckpoint?.trigger ?? 'session_rotation',
        id: runtimeCheckpoint?.id,
        sessionKey: runtimeCheckpoint?.sessionKey ?? sessionKey,
        agentId: runtimeCheckpoint?.agentId ?? agentId,
        workspaceId: runtimeCheckpoint?.workspaceId ?? workspaceId,
        objective: runtimeCheckpoint?.objective ?? objective ?? ledgerActive[0] ?? undefined,
        activeNodeId: runtimeCheckpoint?.activeNodeId,
        activeTask: (runtimeCheckpoint?.activeTask ?? activeTaskParts.join('\n')) || undefined,
        lastConfirmedHandoff: runtimeCheckpoint?.lastConfirmedHandoff,
        openBlockers: uniqueStrings([
          ...(runtimeCheckpoint?.openBlockers ?? []),
          ...ledgerBlockers,
          ...gitBlockers,
          ...traceErrors,
          ...transcriptErrors,
        ], 10),
        decisions: uniqueStrings([
          ...(runtimeCheckpoint?.decisions ?? []),
          ...ledgerDecisions,
          ...transcriptDecisions,
        ], 10),
        deviations: runtimeCheckpoint?.deviations ?? [],
        filesTouched: uniqueStrings([
          ...(runtimeCheckpoint?.filesTouched ?? []),
          ...gitFiles,
          ...transcriptFiles,
        ], 16),
        testsRun: uniqueStrings([...(runtimeCheckpoint?.testsRun ?? []), ...transcriptTests], 12),
        nextAction: runtimeCheckpoint?.nextAction ?? 'Review this handoff draft, inspect the current workspace status, and continue the task in this new session.',
        reviewNeededItems: uniqueStrings([...(runtimeCheckpoint?.reviewNeededItems ?? []), ...ledgerReview], 8),
        evidenceRefs: uniqueEvidenceRefs([...(runtimeCheckpoint?.evidenceRefs ?? []), ...sourceEvidenceRefs]),
        metadata: {
          ...(runtimeCheckpoint?.metadata ?? {}),
          source: runtimeCheckpoint ? 'clawx-session-handoff-ecosystem' : 'clawx-session-handoff-mvp',
          runtimeCheckpoint: Boolean(runtimeCheckpoint),
          recoveryContext: Boolean(recoveryContext),
          recoveryCheckpointId,
          sourceCount: sources.filter((source) => source.available).length,
        },
      });

      return {
        success: true,
        checkpoint,
        draft: renderHandoffDraft(checkpoint, sources, recoveryContext),
        sources,
        warnings,
      };
    },
    fork: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload) ?? parseSessionKey(sessionKey)?.agentId ?? null;
      const workspaceId = getOptionalWorkspaceId(payload);
      const label = isRecord(payload) && typeof (payload as SessionPayload).label === 'string'
        ? String((payload as SessionPayload).label).trim()
        : '';
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          sourceSessionKey: sessionKey,
          agentId,
          workspaceId,
          forkedFromParent: false,
          warnings: ['gateway_unavailable'],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.fork', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        ...(label ? { label } : {}),
      }, 30_000);
      const nextSessionKey = typeof result.key === 'string' ? result.key : undefined;
      const sourceSessionKey = typeof result.sourceKey === 'string' ? result.sourceKey : sessionKey;
      if (!nextSessionKey) {
        return {
          success: false,
          error: 'Gateway did not return a forked session key',
          sourceSessionKey,
          agentId,
          workspaceId,
          forkedFromParent: result.forkedFromParent === true,
        };
      }
      return {
        success: true,
        sourceSessionKey,
        sessionKey: nextSessionKey,
        agentId,
        workspaceId,
        forkedFromParent: result.forkedFromParent === true,
        warnings: [],
      };
    },
  };
}
