import { getExecutionWorkspaceProfile } from './project-execution-scope';
import { createSystemProjectDispatch } from './system-project-dispatch';
import { readSystemControl } from './workspaces-api';
import { existsSync, openSync, closeSync, fstatSync, readFileSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RawMessage } from '@shared/chat/types';
import type { AgentReasoningEffort } from '@shared/types/agent';
import type { GitRepositoryStatus } from '@shared/types/git';
import type { ObservabilityTrace } from '@shared/types/observability';
import type { TaskLedgerEventInput, TaskLedgerNode, TaskLedgerSessionLink, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { resolveHostOpenClawStateDir } from './knowledge-api';
import type { GatewayManager } from '../gateway/manager';
import { GatewayRpcError } from '../gateway/protocol';
import type { TerminalSessionManager } from './terminal-session-manager';
import {
  buildSessionMutationRequestDigest,
  clearSessionDeleteGate,
  findSessionDeleteGateBySession,
  listSessionMutationGates,
  persistSessionDeleteGate,
  persistSessionMutationGate,
  updateSessionDeleteGate,
  withSessionDeleteGateLock,
  type SessionDeleteGateRecord,
} from './session-delete-gate';
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
  CompressionSemanticAtom,
  SessionCompactionResult,
  SessionContextFoldProjectionPayload,
  SessionContextFoldProjectionResult,
  SessionContextFoldingStatusResult,
  SessionDeleteResult,
  SessionDelegationPayload,
  ProjectPlanDispatchPayload,
  SessionDelegationResult,
  SessionExpandSelectorResult,
  SessionHandoffSource,
  SessionRecallDiagnostic,
  SessionRecallOriginalResult,
} from '../../shared/host-api/contract';
import { appendTaskLedgerEvents, loadTaskLedgerSnapshot } from './task-ledger-service';
import { assertManagedTaskAdmission, openTaskSystem, persistentTaskChatContext } from './task-system-service';
import { projectCoordinatorProfile, projectCoordinatorScope } from '../../shared/task-system/project-coordinator';
import { routeRole } from '../../openclaw_runtime/src/agents/role-router';
import type { RoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import { createWorkspacesApi, getActiveWorkspaceProfile, readWorkspaceHandoffOperation, updateWorkspaceHandoffOperation,
  getWorkspaceRootPathById, getPersistedCoordinatorBinding, type WorkspaceCoordinatorLifecycleEvent } from './workspaces-api';
import { handoffFirstSendKey, type SessionHandoffOperation } from '@shared/types/session-handoff';
import { normalizeRunScope } from '@shared/types/identity-scope';
import { classifyDerivation } from '@shared/types/session-derivation';
import {
  executeSessionDelegation,
  hashDelegationRequest,
  type SessionDelegationDependencies,
  validateSessionDelegationPayload,
} from './session-delegation-admission';
import {
  claimSessionDelegationAdmission,
  commitSessionDelegationAdmission,
  readSessionDelegationAdmission,
} from './session-delegation-store';
import { evaluateHandoffDerivation } from '../../shared/handoff-depth';
import { readCurrentGitStatus } from './git-api';
import { getResourceTracker } from './resource-tracker';
import { getDefaultAgentBrowserService } from './agent-browser-api';
import { reclaimLongSessionOwnerResources } from './long-session-resource-reclamation';
import { getObservabilityTraceBuffer } from './observability-service';
import {
  removeSessionEntry,
  resolveSessionTranscriptPath,
  sweepSessionArtefacts,
  cleanupContextArchiveArtifacts,
  readArchiveIndex,
  removeArchiveEntry,
} from '../utils/session-files';
import { isRecord } from './payload-utils';
import {
  ContextFoldingValidationError,
  describeContextFoldingStatus,
  projectContextFoldResultForParent,
} from '../../shared/types/context-folding';
import type { SessionArchiveEntry, SessionPendingMutation } from '@shared/types/workspace';

// ponytail: serialize desktop handoff writes; use per-workspace queues if throughput requires it.
let handoffCreationTail: Promise<unknown> = Promise.resolve();

function resolveConfiguredHandoffPolicy(): { enforceDepth: boolean; maxDepth?: unknown } {
  const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
  if (!existsSync(configPath)) return { enforceDepth: false };
  const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!isRecord(parsed)) throw new Error('Handoff ancestry unavailable: invalid runtime configuration');
  const runtime = isRecord(parsed.runtime) ? parsed.runtime : undefined;
  const handoff = runtime && isRecord(runtime.handoff) ? runtime.handoff : undefined;
  if (runtime?.handoff !== undefined && (!handoff || (handoff.enabled !== undefined && typeof handoff.enabled !== 'boolean'))) {
    throw new Error('Handoff ancestry unavailable: invalid handoff configuration');
  }
  return { enforceDepth: handoff?.enabled === true, maxDepth: handoff?.maxDepth };
}

/**
 * context-folding-rlm: the runtime config as written on disk, for the flag
 * descriptor. A missing file means "default off"; an unreadable file is an
 * error, never a silent default.
 */
function readRuntimeConfigForContextFolding(): unknown {
  const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
  if (!existsSync(configPath)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!isRecord(parsed)) throw new Error('Context folding status unavailable: invalid runtime configuration');
  return parsed;
}

async function readHandoffDecision(sessionKey: string, workspaceId: string | null) {
  const snapshot = await loadTaskLedgerSnapshot(workspaceId).catch((cause: unknown) => {
    throw new Error('Handoff ancestry unavailable: Task Ledger could not be read', { cause });
  });
  if (snapshot.warnings.length) throw new Error('Handoff ancestry unavailable: Task Ledger contains unreadable events');
  return evaluateHandoffDerivation({ links: snapshot.sessionLinks, sessionKey, ...resolveConfiguredHandoffPolicy() });
}

async function readDerivationTaskIds(
  snapshot: TaskLedgerSnapshot,
  sourceSessionKey: string,
  gatewayManager?: GatewayManager,
): Promise<string[]> {
  if (snapshot.warnings.length) throw new Error('Task scope unavailable: Task Ledger contains unreadable events');
  const taskIds = new Set(snapshot.nodes.filter((node) => node.kind === 'task').map((node) => node.id));
  const links = snapshot.sessionLinks.filter((link) =>
    link.sessionKey === sourceSessionKey && link.nodeId && taskIds.has(link.nodeId),
  );
  let generation: string | null = null;
  if (links.some((link) => link.sessionGeneration)) {
    if (!gatewayManager) throw new Error('Task scope unavailable: source generation cannot be verified');
    const result = await gatewayManager.rpc<{ session?: { sessionId?: string } }>(
      'sessions.describe', { key: sourceSessionKey }, 15_000,
    );
    generation = result.session?.sessionId?.trim() || null;
    if (!generation) throw new Error('Task scope unavailable: source session generation is missing');
  }
  return [...new Set(links
    .filter((link) => !link.sessionGeneration || link.sessionGeneration === generation)
    .map((link) => link.nodeId!))];
}

function sessionDerivationEvents(link: TaskLedgerSessionLink, taskNodeIds: string[]): TaskLedgerEventInput[] {
  return [link, ...taskNodeIds.map((nodeId) => ({ ...link, id: `${link.id}:task:${nodeId}`, nodeId }))]
    .map((sessionLink) => ({
      type: 'session_linked', actor: 'system', sessionId: link.sessionKey,
      payload: { sessionLink },
    }));
}

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RECENT_TRANSCRIPT_INITIAL_READ_BYTES = 256 * 1024;
const RECENT_TRANSCRIPT_MAX_READ_BYTES = 8 * 1024 * 1024;
const RECENT_TRANSCRIPT_MAX_SCAN_LINES = 5_000;
const SUMMARY_HEAD_READ_BYTES = 64 * 1024;
const SUMMARY_TAIL_READ_BYTES = 128 * 1024;
const MAX_SESSION_SUMMARY_KEYS = 100;
// Bounded label reads must never queue behind healthy bulk history. Eight
// small head/tail reads keep the sidebar responsive while leaving CPU for
// session switching; the previous unbounded scan also flooded the event loop.
const SESSION_SUMMARY_CONCURRENCY = 8;

type SessionSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
  /** Omitted when the summary came from the bounded head/tail read. */
  messageCount?: number;
};

type TranscriptMessage = RawMessage;

type ParsedTranscriptLine = {
  type?: string;
  message?: TranscriptMessage;
};

type SessionPayload = {
  resumeOperationId?: unknown;
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
  originalWorkspaceId?: unknown;
  originalFolderId?: unknown;
  messageId?: unknown;
  /** #180: optional in-transcript fork point forwarded to sessions.fork. */
  fromLeafId?: unknown;
  /** #178: optional in-transcript boundary forwarded to sessions.compactRange. */
  toLeafId?: unknown;
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

type TranscriptSummaryFields = {
  firstUserText: string | null;
  lastTimestamp: number | null;
};

function parseTranscriptLinesFromChunk(
  chunk: string,
  hasPartialFirstLine: boolean,
  hasPartialLastLine: boolean,
): TranscriptMessage[] {
  const lines = chunk.split(/\r?\n/);
  if (hasPartialFirstLine) lines.shift();
  if (hasPartialLastLine) lines.pop();
  return lines.flatMap((line) => {
    if (!line.trim()) return [];
    const message = parseMessageLine(line);
    return message ? [message] : [];
  });
}

/**
 * Read only the head and tail of a transcript for sidebar summaries.
 *
 * The head supplies the first visible user text; the tail supplies the latest
 * message timestamp. We deliberately do not count messages here — the gateway's
 * sessions.list payload already carries messageCount, and a full-file scan just
 * to compute a secondary sort key is what made long-lived histories slow.
 */
function readTranscriptSummaryFields(transcriptPath: string): TranscriptSummaryFields {
  let fd: number | null = null;
  try {
    fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return { firstUserText: null, lastTimestamp: null };

    const headLength = Math.min(size, SUMMARY_HEAD_READ_BYTES);
    const headBuffer = Buffer.allocUnsafe(headLength);
    readSync(fd, headBuffer, 0, headLength, 0);
    const headChunk = headBuffer.toString('utf8');
    const headMessages = parseTranscriptLinesFromChunk(
      headChunk,
      false,
      headLength < size && !headChunk.endsWith('\n'),
    );

    let firstUserText: string | null = null;
    for (const message of headMessages) {
      if (message.role !== 'user') continue;
      const text = cleanSummaryUserText(extractMessageText(message.content));
      if (text && !isInternalSummaryText(text)) {
        firstUserText = text;
        break;
      }
    }

    const tailStart = Math.max(0, size - SUMMARY_TAIL_READ_BYTES);
    const tailLength = size - tailStart;
    let hasPartialFirstLine = false;
    if (tailStart > 0) {
      const boundary = Buffer.allocUnsafe(1);
      readSync(fd, boundary, 0, 1, tailStart - 1);
      hasPartialFirstLine = boundary[0] !== 0x0a;
    }
    const tailBuffer = Buffer.allocUnsafe(tailLength);
    readSync(fd, tailBuffer, 0, tailLength, tailStart);
    const tailMessages = parseTranscriptLinesFromChunk(
      tailBuffer.toString('utf8'),
      hasPartialFirstLine,
      false,
    );

    let lastTimestamp: number | null = null;
    for (let index = tailMessages.length - 1; index >= 0; index -= 1) {
      const normalizedTs = normalizeTimestamp(tailMessages[index]?.timestamp);
      if (normalizedTs != null) {
        lastTimestamp = normalizedTs;
        break;
      }
    }

    return { firstUserText, lastTimestamp };
  } catch {
    return { firstUserText: null, lastTimestamp: null };
  } finally {
    if (fd !== null) closeSync(fd);
  }
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

function parseTranscriptEntry(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getTranscriptEntryMessageId(entry: Record<string, unknown>): string | null {
  if (entry.type !== 'message') return null;
  if (typeof entry.id === 'string' && entry.id.trim()) return entry.id;
  const message = entry.message;
  if (isRecord(message) && typeof message.id === 'string' && message.id.trim()) {
    return message.id;
  }
  return null;
}

function isTranscriptMessageEntry(line: string): boolean {
  const entry = parseTranscriptEntry(line);
  return entry?.type === 'message';
}

async function truncateSessionTranscriptBeforeMessage(
  sessionKey: string,
  messageId: string,
  agentIdOverride?: string | null,
): Promise<{
  success: boolean;
  error?: string;
  sessionKey?: string;
  messageId?: string;
  truncated?: boolean;
  removedMessageCount?: number;
  retainedLineCount?: number;
}> {
  const parsed = parseSessionKey(sessionKey);
  const agentId = agentIdOverride?.trim() || parsed?.agentId || '';
  const normalizedMessageId = messageId.trim();
  if (!parsed || !agentId || !SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }
  if (!normalizedMessageId) {
    return { success: false, error: 'messageId is required' };
  }

  const fsP = await import('node:fs/promises');
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  let sessionsJson: Record<string, unknown>;
  try {
    sessionsJson = await readSessionsJson(agentId);
  } catch (error) {
    return { success: false, error: `Could not read sessions.json: ${String(error)}` };
  }

  const resolution = resolveSessionTranscriptPath(sessionsJson, sessionsDir, sessionKey);
  if (!resolution.ok) {
    return {
      success: false,
      error: resolution.failure.kind === 'not-found'
        ? 'Transcript not found'
        : `Transcript path escapes sessions dir: ${resolution.failure.resolvedPath}`,
    };
  }

  let raw: string;
  try {
    raw = await fsP.readFile(resolution.resolvedSrcPath, 'utf8');
  } catch (error) {
    return { success: false, error: `Could not read transcript: ${String(error)}` };
  }

  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const targetIndex = lines.findIndex((line) => {
    const entry = parseTranscriptEntry(line);
    return entry ? getTranscriptEntryMessageId(entry) === normalizedMessageId : false;
  });
  if (targetIndex < 0) {
    return {
      success: false,
      error: 'Message not found in transcript',
      sessionKey,
      messageId: normalizedMessageId,
      truncated: false,
    };
  }

  const retainedLines = lines.slice(0, targetIndex);
  const removedLines = lines.slice(targetIndex);
  const removedMessageCount = removedLines.filter(isTranscriptMessageEntry).length;
  const nextContent = retainedLines.length > 0 ? `${retainedLines.join('\n')}\n` : '';
  const tempPath = `${resolution.resolvedSrcPath}.truncate-${process.pid}-${Date.now()}.tmp`;
  try {
    await fsP.writeFile(tempPath, nextContent, 'utf8');
    await fsP.rename(tempPath, resolution.resolvedSrcPath);
  } catch (error) {
    try {
      await fsP.unlink(tempPath);
    } catch {
      // Ignore temp cleanup failures; the write/rename error is the useful one.
    }
    return { success: false, error: `Could not truncate transcript: ${String(error)}` };
  }

  logger.info('[session:truncate]', {
    sessionKey,
    messageId: normalizedMessageId,
    transcriptPath: resolution.resolvedSrcPath,
    removedMessageCount,
  });
  return {
    success: true,
    sessionKey,
    messageId: normalizedMessageId,
    truncated: true,
    removedMessageCount,
    retainedLineCount: retainedLines.length,
  };
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

/**
 * Area 2 §3.3: extract turn/session model override from host-api payload.
 * `null` clears the override (reset to agent default). Empty strings are
 * normalized to `null` so the runtime `sessions.patch` clears the field.
 */
function getModelRef(payload: unknown): string | null {
  const value = isRecord(payload) ? (payload as { modelRef?: unknown }).modelRef : undefined;
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  throw new Error(`Invalid modelRef: ${String(value)}`);
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

function limitText(value: string, maxLength = 4_000): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
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
  recallContext?: string,
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
    ...(recallContext
      ? [
        '## Read-only context recall',
        recallContext,
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

/** Maps a gateway manual/located compaction RPC outcome onto the host-api result. */
function mapCompactionRpcOutcome(result: Record<string, unknown>, sessionKey: string): SessionCompactionResult {
  const compactResult = isRecord(result.result) ? result.result : {};
  const compactDetails = isRecord(compactResult.details) ? compactResult.details : {};
  const compressionDetails = isRecord(compactDetails.compression) ? compactDetails.compression : {};
  const detailWarnings = [
    ...(Array.isArray(compactDetails.warnings)
      ? compactDetails.warnings.filter((item): item is string => typeof item === 'string')
      : []),
    ...(Array.isArray(compressionDetails.warnings)
      ? compressionDetails.warnings.filter((item): item is string => typeof item === 'string')
      : []),
  ];
  const success = result.ok === true;
  const pending = success && compactDetails.pending === true;
  const compacted = success && !pending && result.compacted === true;
  const nextSessionKey = typeof result.key === 'string' ? result.key : sessionKey;
  return {
    success,
    status: success ? (pending ? 'pending' : compacted ? 'compacted' : 'skipped') : 'failed',
    ...(!success && typeof result.reason === 'string' ? { error: result.reason } : {}),
    compacted,
    ...(typeof compactResult.summary === 'string' ? { summary: compactResult.summary } : {}),
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
    ...(toNumber(compactResult.tokensBefore) !== undefined ? { tokensBefore: toNumber(compactResult.tokensBefore) } : {}),
    ...(toNumber(compactResult.tokensAfter) !== undefined ? { tokensAfter: toNumber(compactResult.tokensAfter) } : {}),
    ...(typeof compactResult.firstKeptEntryId === 'string' ? { firstKeptEntryId: compactResult.firstKeptEntryId } : {}),
    sessionKey: nextSessionKey,
    ...(typeof compactResult.sessionId === 'string' ? { sessionId: compactResult.sessionId } : {}),
    ...(nextSessionKey !== sessionKey ? { rotatedSessionKey: nextSessionKey } : {}),
    warnings: [...new Set(detailWarnings)],
  };
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

const SEMANTIC_ATOM_TYPES = new Set<CompressionSemanticAtom['type']>([
  'goal',
  'latest_user_ask',
  'decision',
  'constraint',
  'failed_attempt',
  'entity',
  'next_action',
  'outcome',
  'safety_boundary',
]);

const SEMANTIC_ATOM_STATUSES = new Set<CompressionSemanticAtom['status']>([
  'verified',
  'unverified',
  'stale',
  'superseded',
]);

const SEMANTIC_ATOM_SEVERITIES = new Set<CompressionSemanticAtom['severity']>([
  'critical',
  'important',
  'nice_to_have',
]);

const SEMANTIC_ATOM_POLARITIES = new Set<CompressionSemanticAtom['polarity']>([
  'positive',
  'negative',
  'neutral',
]);

const SEMANTIC_ATOM_SOURCE_KINDS = new Set<NonNullable<CompressionSemanticAtom['source']>['kind']>([
  'summary',
  'message',
  'ledger',
  'cvk',
  'archive',
]);

const SEMANTIC_ATOM_EVIDENCE_TYPES = new Set<NonNullable<CompressionSemanticAtom['evidenceRefs'][number]>['type']>([
  'session',
  'trace',
  'file',
  'tool',
  'task_ledger',
  'clawgraph',
  'manual',
  'archive',
  'cvk',
  'other',
]);

function redactSemanticAtomText(value: string): string {
  return value
    .replace(
      /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Za-z0-9_]*)\s*[=:]\s*([^\s"',;]+)/gi,
      (_match, name: string) => `${name}=[REDACTED]`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(ghp|github_pat|gsk|xox[baprs]|xapp|pplx|npm|hf|r8)_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-+=]{18,}\b/gi, 'Bearer [REDACTED]');
}

function mapSemanticAtomEvidenceRefs(value: unknown): CompressionSemanticAtom['evidenceRefs'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const ref = typeof item.ref === 'string' ? item.ref.trim().slice(0, 300) : '';
    if (!ref) return [];
    const type = typeof item.type === 'string'
      && SEMANTIC_ATOM_EVIDENCE_TYPES.has(item.type as CompressionSemanticAtom['evidenceRefs'][number]['type'])
      ? item.type as CompressionSemanticAtom['evidenceRefs'][number]['type']
      : 'other';
    return [{
      type,
      ref,
      ...(typeof item.label === 'string' && item.label.trim()
        ? { label: item.label.trim().slice(0, 120) }
        : {}),
    }];
  }).slice(0, 8);
}

function mapSemanticAtoms(value: unknown): {
  atoms?: CompressionSemanticAtom[];
  warnings: string[];
} {
  if (!Array.isArray(value)) return { warnings: [] };
  const warnings: string[] = [];
  const atoms = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const type = typeof item.type === 'string' && SEMANTIC_ATOM_TYPES.has(item.type as CompressionSemanticAtom['type'])
      ? item.type as CompressionSemanticAtom['type']
      : undefined;
    if (!type) return [];
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim().slice(0, 120)
      : `atom-${warnings.length + 1}`;
    const textRaw = typeof item.text === 'string' ? item.text : '';
    const text = redactSemanticAtomText(textRaw.replace(/\s+/g, ' ').trim()).slice(0, 240);
    if (!text) return [];
    const severity = typeof item.severity === 'string' && SEMANTIC_ATOM_SEVERITIES.has(item.severity as CompressionSemanticAtom['severity'])
      ? item.severity as CompressionSemanticAtom['severity']
      : 'nice_to_have';
    const rawStatus = typeof item.status === 'string' && SEMANTIC_ATOM_STATUSES.has(item.status as CompressionSemanticAtom['status'])
      ? item.status as CompressionSemanticAtom['status']
      : 'unverified';
    const evidenceRefs = mapSemanticAtomEvidenceRefs(item.evidenceRefs);
    let status = rawStatus;
    if (severity === 'critical' && evidenceRefs.length === 0) {
      if (status === 'verified') status = 'unverified';
      warnings.push('critical_atom_missing_evidence');
    }
    const sourceRecord = isRecord(item.source) ? item.source : undefined;
    let source: CompressionSemanticAtom['source'] | undefined;
    if (sourceRecord) {
      const sourceKind = typeof sourceRecord.kind === 'string'
        && SEMANTIC_ATOM_SOURCE_KINDS.has(sourceRecord.kind as NonNullable<CompressionSemanticAtom['source']>['kind'])
        ? sourceRecord.kind as NonNullable<CompressionSemanticAtom['source']>['kind']
        : 'ledger';
      source = {
        kind: sourceKind,
        ref: typeof sourceRecord.ref === 'string' && sourceRecord.ref.trim()
          ? sourceRecord.ref.trim().slice(0, 240)
          : 'ledger',
      };
    }
    return [{
      id,
      type,
      canonicalIdentity: typeof item.canonicalIdentity === 'string' && item.canonicalIdentity.trim()
        ? item.canonicalIdentity.trim().slice(0, 200)
        : id,
      severity,
      confidence: typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : 0,
      scope: typeof item.scope === 'string' && item.scope.trim()
        ? item.scope.trim().slice(0, 120)
        : 'session',
      polarity: typeof item.polarity === 'string' && SEMANTIC_ATOM_POLARITIES.has(item.polarity as CompressionSemanticAtom['polarity'])
        ? item.polarity as CompressionSemanticAtom['polarity']
        : 'neutral',
      status,
      text,
      evidenceRefs,
      ...(Array.isArray(item.supersedes)
        ? { supersedes: item.supersedes.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim().slice(0, 160)).slice(0, 12) }
        : {}),
      ...(Array.isArray(item.conflicts)
        ? { conflicts: item.conflicts.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim().slice(0, 160)).slice(0, 12) }
        : {}),
      ...(typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) && item.updatedAt >= 0
        ? { updatedAt: Math.floor(item.updatedAt) }
        : {}),
      ...(source ? { source } : {}),
    } satisfies CompressionSemanticAtom];
  }).slice(0, 48);
  return {
    ...(atoms.length ? { atoms } : {}),
    warnings: [...new Set(warnings)],
  };
}

export function mapCompressionArtifact(value: unknown): CompressionArtifact | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  const quality = mapCompressionQuality(value.quality);
  if (!quality) return undefined;
  const mappedAtoms = mapSemanticAtoms(value.semanticAtoms);
  const mappedQuality: CompressionArtifactQuality = {
    ...quality,
    warnings: [...new Set([...quality.warnings, ...mappedAtoms.warnings])],
  };
  return {
    ...(value as unknown as Omit<CompressionArtifact, 'quality'>),
    schemaVersion: 1,
    ...(mappedAtoms.atoms ? { semanticAtoms: mappedAtoms.atoms } : {}),
    quality: mappedQuality,
  };
}

function mapRecallDiagnostics(value: unknown): SessionRecallDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      code: typeof item.code === 'string'
        ? item.code as SessionRecallDiagnostic['code']
        : 'read_error',
      message: typeof item.message === 'string' ? item.message : 'Recall diagnostic unavailable.',
      ...(typeof item.ref === 'string' ? { ref: item.ref } : {}),
    }));
}

function renderRecallPayload(value: unknown): string {
  if (typeof value === 'string') return limitText(value);
  if (value == null) return '';
  try {
    return limitText(JSON.stringify(value, null, 2));
  } catch {
    return compactLine(String(value), 1_000);
  }
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
    // The /loop root is what chat.send checks before it accepts an explicit
    // inputMode; Chat reads it here to decide whether to offer those modes.
    ...(typeof value.taskLedgerRootId === 'string' ? { taskLedgerRootId: value.taskLedgerRootId } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
    ...(typeof value.clawGraphRunId === 'string' ? { clawGraphRunId: value.clawGraphRunId } : {}),
    trigger: trigger as LongTaskCheckpointRecord['trigger'],
    status: typeof value.status === 'string' ? value.status : 'active',
    checkpoint: value.checkpoint as ResumeCheckpoint,
    ...(isRecord(value.archiveHandle)
      ? { archiveHandle: value.archiveHandle as LongTaskCheckpointRecord['archiveHandle'] }
      : {}),
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

async function loadSessionSummary(
  sessionKey: string,
  readSessionsJsonForAgent: (agentId: string) => Promise<Record<string, unknown>> = readSessionsJson,
): Promise<SessionSummary> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }

  try {
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJsonForAgent(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) {
      return { sessionKey, firstUserText: null, lastTimestamp: null };
    }

    const fields = readTranscriptSummaryFields(transcriptPath);
    return { sessionKey, ...fields };
  } catch {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }
}
async function loadSessionTranscriptByKey(sessionKey: string, limit: number, gateway?: Pick<GatewayManager, 'rpc'>, includeModelMetadata = true): Promise<RawMessage[] | null> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  // The live runtime owns transcript location (including isolated source state).
  // An empty runtime history is authoritative; never substitute another profile.
  if (gateway) {
    const result = await gateway.rpc<{ messages?: RawMessage[] }>('chat.history', { sessionKey, limit,
      ...(includeModelMetadata ? {} : { includeModelMetadata: false }) }, includeModelMetadata ? 10_000 : undefined);
    if (!Array.isArray(result?.messages)) throw new Error('Runtime history returned no messages array');
    return result.messages;
  }

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

async function deleteSession(sessionKey: string): Promise<SessionDeleteResult> {
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
      removeSessionEntry(sessionsJson, sessionKey);
      try {
        await fsP.writeFile(sessionsJsonPath, JSON.stringify(sessionsJson, null, 2), 'utf8');
        logger.info(`[session:delete] Entry already absent on disk; removed stale index for "${sessionKey}"`);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          partial: true,
          error: `Session files were already absent but sessions.json could not be updated: ${String(error)}`,
        };
      }
    }
    logger.warn(`[session:delete] Refusing to delete out-of-scope path for "${sessionKey}": ${resolution.failure.resolvedPath}`);
    return {
      success: false,
      error: `Resolved session path is outside the agent sessions dir: ${resolution.failure.resolvedPath}`,
    };
  }

  const { resolvedSrcPath, sessionsDirAbs, baseId } = resolution;
  logger.info(`[session:delete] file: ${resolvedSrcPath}`);
  // KS-02: coordinate derivative cleanup before transcript mutation. If any
  // derivative residual remains, keep the transcript and the operation
  // incomplete/retryable instead of reporting best-effort success.
  try {
    const { runHostSessionDerivativeCascade } = await import('./session-cascade-delete');
    const cascade = await runHostSessionDerivativeCascade(sessionKey, baseId);
    if (!cascade.success) {
        const detail = cascade.errors
        .map((entry) => `${entry.kind}:${entry.id} (${entry.error})`)
        .join('; ');
      logger.warn(`[session:delete] derivative cascade incomplete retryable=${cascade.retryable}: ${detail}`);
      return {
        success: false,
        partial: true,
        error: `Derivative cascade incomplete: ${detail}`,
        remainingPaths: [],
      };
    }
    logger.info(`[session:delete] derivative cascade removed ${cascade.removed.length} item(s)`);
  } catch (error) {
    logger.warn(`[session:delete] derivative cascade failed: ${String(error)}`);
    return {
      success: false,
      partial: true,
      error: `Derivative cascade failed: ${String(error)}`,
      remainingPaths: [],
    };
  }
  const sweep = await sweepSessionArtefacts(sessionsDirAbs, baseId);
  for (const removedPath of sweep.removed) {
    logger.info(`[session:delete] Unlinked ${removedPath}`);
  }
  for (const { path: failedPath, error } of sweep.errors) {
    logger.warn(`[session:delete] Failed to unlink ${failedPath}: ${String(error)}`);
  }
  logger.info(`[session:delete] Hard-deleted ${sweep.removed.length} file(s) for ${baseId}`);
  const archiveCleanup = await cleanupContextArchiveArtifacts({
    sessionIds: [baseId],
  });
  for (const removedPath of archiveCleanup.removed) {
    logger.info(`[session:delete] Unlinked context archive ${removedPath}`);
  }
  for (const { path: failedPath, error } of archiveCleanup.errors) {
    logger.warn(`[session:delete] Failed to unlink context archive ${failedPath}: ${error}`);
  }

  // R0-2: unlink failures must be visible. Keep the sessions.json entry so
  // the user can retry the delete instead of seeing a fake success with
  // orphaned artefacts on disk.
  const unlinkErrors = [...sweep.errors, ...archiveCleanup.errors];
  if (unlinkErrors.length > 0) {
    const remainingPaths = unlinkErrors.map(({ path }) => path);
    const detail = unlinkErrors
      .map(({ path, error }) => `${path} (${String(error)})`)
      .join('; ');
    logger.warn(`[session:delete] ${unlinkErrors.length} artefact(s) could not be unlinked for ${baseId}; keeping sessions.json entry for retry`);
    return {
      success: false,
      partial: true,
      error: `Failed to unlink ${unlinkErrors.length} session artefact(s): ${detail}`,
      remainingPaths,
    };
  }

  try {
    const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
    const json2 = JSON.parse(raw2) as Record<string, unknown>;
    removeSessionEntry(json2, sessionKey);
    await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
    logger.info(`[session:delete] Removed "${sessionKey}" from sessions.json`);
  } catch (error) {
    logger.warn(`[session:delete] Could not update sessions.json: ${String(error)}`);
    return {
      success: false,
      partial: true,
      error: `Session files were removed but sessions.json could not be updated: ${String(error)}`,
    };
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

function getArchiveIndexPath(agentId: string): string {
  return join(resolveHostOpenClawStateDir(), 'agents', agentId, 'sessions', 'sessions.archives.json');
}

function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type LifecycleMutationFailureDetails = {
  kind?: unknown;
  operationId?: unknown;
  key?: unknown;
  retryable?: unknown;
  noMutation?: unknown;
};

function isDefinitiveLifecycleMutationFailure(
  error: unknown,
  sessionKey: string,
  operationId: string,
): boolean {
  if (!(error instanceof GatewayRpcError)) return false;
  const details = error.payload.details ?? error.payload.data;
  if (!isRecord(details)) return false;
  const failure = details as LifecycleMutationFailureDetails;
  return (
    failure.kind === 'lifecycle-mutation-failure' &&
    failure.key === sessionKey &&
    failure.operationId === operationId &&
    (failure.retryable === false || failure.noMutation === true)
  );
}

/**
 * Archive a session through the runtime lifecycle owner. The caller persists
 * an operation id before the first RPC; any transport failure keeps the gate
 * open so a retry resumes the same journaled mutation.
 */
type SessionMutationResult = SessionDeleteResult & {
  sessionId?: string;
  previousSessionId?: string;
  operationId?: string;
  retryable?: boolean;
  recoveryRequired?: boolean;
};
type SessionMutationCommitted = (gate: SessionDeleteGateRecord) => Promise<SessionDeleteGateRecord>;

async function saveMutationProgress(
  gate: SessionDeleteGateRecord,
  patch: Parameters<typeof updateSessionDeleteGate>[1],
): Promise<SessionDeleteGateRecord> {
  const saved = await updateSessionDeleteGate(gate.operationId, patch);
  if (!saved) throw new Error('SESSION_MUTATION_CHANGED: pending operation is missing');
  return saved;
}

async function pinMutationWorkspace(gate: SessionDeleteGateRecord, requested?: string | null): Promise<SessionDeleteGateRecord> {
  if (gate.workspaceId !== undefined) return gate;
  const snapshot = await createWorkspacesApi().list();
  if (!snapshot.success) throw new Error(snapshot.error || 'Lifecycle workspace owner unavailable');
  const archive = await readArchiveIndex(getArchiveIndexPath(gate.agentId));
  const original = archive.entries.find(entry => entry.sessionKey === gate.sessionKey)?.originalWorkspaceId;
  const matches = snapshot.profiles.filter(profile => profile.activeSessionKey === gate.sessionKey
    || Object.hasOwn(profile.sessionStates ?? {}, gate.sessionKey)
    || Object.hasOwn(profile.coordinatorBindings ?? {}, gate.sessionKey)
    || Object.values(profile.agentBindings ?? {}).some(binding => binding.sessionKey === gate.sessionKey)
    || profile.archivedSessionKeys?.includes(gate.sessionKey)
    || (original && profile.id === original));
  const preferred = requested || original;
  const selected = preferred ? matches.find(profile => profile.id === preferred) : matches.length === 1 ? matches[0] : undefined;
  if ((preferred && !selected) || (!preferred && matches.length > 1)) {
    throw new Error('SESSION_MUTATION_SCOPE_UNRESOLVED: original workspace is missing or ambiguous');
  }
  return saveMutationProgress(gate, { workspaceId: selected?.id ?? null });
}

async function saveMutationReceipt(gate: SessionDeleteGateRecord, receipt: NonNullable<SessionDeleteGateRecord['runtimeReceipt']>) {
  if (gate.runtimeReceipt && (gate.runtimeReceipt.sessionId !== receipt.sessionId
    || gate.runtimeReceipt.previousSessionId !== receipt.previousSessionId)) {
    throw new Error('SESSION_MUTATION_GENERATION_CHANGED: Runtime receipt changed on replay');
  }
  return saveMutationProgress(gate, {
    runtimeReceipt: receipt,
    expectedSessionId: receipt.previousSessionId ?? receipt.sessionId,
  });
}

function mutationResult(gate: SessionDeleteGateRecord): SessionMutationResult {
  return {
    success: true,
    operationId: gate.operationId,
    sessionId: gate.runtimeReceipt?.sessionId,
    expectedSessionId: gate.expectedSessionId,
    ...(gate.runtimeReceipt?.previousSessionId ? { previousSessionId: gate.runtimeReceipt.previousSessionId } : {}),
    ...(gate.resourceReclamationAttempts?.length ? { resourceReclamation: gate.resourceReclamationAttempts.at(-1) } : {}),
  };
}

async function mutationFailure(gate: SessionDeleteGateRecord | undefined, error: unknown): Promise<SessionMutationResult> {
  const message = error instanceof Error ? error.message : String(error);
  let current = gate;
  if (gate) {
    // Read back progress saved by the tail before reporting its failure.
    current = await findSessionDeleteGateBySession(gate.sessionKey).catch(() => undefined);
    if (current?.operationId !== gate.operationId) current = gate;
    await updateSessionDeleteGate(gate.operationId, { tailError: message }).catch(() => undefined);
  }
  return { ...(current ? mutationResult(current) : {}), success: false, error: message,
    ...(current ? { operationId: current.operationId, retryable: true, recoveryRequired: true } : {}) };
}

async function archiveSession(
  payload: SessionPayload,
  gatewayManager: GatewayManager | undefined,
  onCommitted: SessionMutationCommitted,
): Promise<SessionMutationResult> {
  const sessionKey = getSessionKey(payload);
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  if (!gatewayManager) return { success: false, error: 'Gateway manager unavailable' };

  const label = getOptionalString(payload.label);
  const originalWorkspaceId = getOptionalString(payload.originalWorkspaceId);
  const originalFolderId = getOptionalString(payload.originalFolderId);
  let gate;
  try {
    gate = await persistSessionMutationGate({
      sessionKey,
      agentId: parsed.agentId,
      operationKind: 'archive',
      expectedOperationId: payload.resumeOperationId,
      requestDigest: buildSessionMutationRequestDigest('archive', { sessionKey }),
    });
    gate = await pinMutationWorkspace(gate, originalWorkspaceId);
    const result = await gatewayManager.rpc<Record<string, unknown>>('sessions.archive', {
      key: sessionKey,
      operationId: gate.operationId,
      ...(label ? { label } : {}),
      ...(originalWorkspaceId ? { originalWorkspaceId } : {}),
      ...(originalFolderId ? { originalFolderId } : {}),
    }, 30_000);
    if (result?.ok === false && result.operationId === gate.operationId && result.key === sessionKey) {
      if (!gate.runtimeReceipt && (result.retryable === false || result.noMutation === true)) {
        await clearSessionDeleteGate(gate.operationId);
        return { success: false, error: String(result.error ?? 'Archive was refused') };
      }
      return mutationFailure(gate, result.error ?? 'Archive was refused');
    }
    if (
      result?.ok !== true ||
      result.archived !== true ||
      result.key !== sessionKey ||
      typeof result.sessionId !== 'string' || !result.sessionId ||
      result.operationId !== gate.operationId ||
      result.journalState !== 'runtime_committed'
    ) {
      return mutationFailure(gate, 'Gateway archive returned no matching runtime_committed receipt');
    }
    gate = await saveMutationReceipt(gate, { key: sessionKey, operationId: gate.operationId,
      journalState: 'runtime_committed', sessionId: result.sessionId });
    gate = await onCommitted(gate);
    await clearSessionDeleteGate(gate.operationId);
    return mutationResult(gate);
  } catch (error) {
    // Definitive correlated refusals can release the mirror gate. Unknown or
    // retryable outcomes retain the same operationId for journal recovery.
    if (gate && !gate.runtimeReceipt && isDefinitiveLifecycleMutationFailure(error, sessionKey, gate.operationId)) {
      await clearSessionDeleteGate(gate.operationId);
      return { success: false, error: String(error) };
    }
    return mutationFailure(gate, error);
  }
}

/**
 * Restore an archived session through the runtime lifecycle owner. Runtime
 * assigns a fresh physical sessionId and re-inserts the archived snapshot, so
 * late events from the archived generation cannot mutate the restored row.
 */
async function restoreSession(
  payload: SessionPayload,
  gatewayManager: GatewayManager | undefined,
  onCommitted: SessionMutationCommitted,
): Promise<SessionMutationResult> {
  const sessionKey = getSessionKey(payload);
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  if (!gatewayManager) return { success: false, error: 'Gateway manager unavailable' };

  let gate;
  try {
    gate = await persistSessionMutationGate({
      sessionKey,
      agentId: parsed.agentId,
      operationKind: 'restore',
      expectedOperationId: payload.resumeOperationId,
      requestDigest: buildSessionMutationRequestDigest('restore', { sessionKey }),
    });
    gate = await pinMutationWorkspace(gate, getOptionalWorkspaceId(payload));
    const result = await gatewayManager.rpc<Record<string, unknown>>('sessions.restore', {
      key: sessionKey,
      operationId: gate.operationId,
    }, 30_000);
    if (result?.ok === false && result.operationId === gate.operationId && result.key === sessionKey) {
      if (!gate.runtimeReceipt && (result.retryable === false || result.noMutation === true)) {
        await clearSessionDeleteGate(gate.operationId);
        return { success: false, error: String(result.error ?? 'Restore was refused') };
      }
      return mutationFailure(gate, result.error ?? 'Restore was refused');
    }
    if (
      result?.ok !== true ||
      result.key !== sessionKey ||
      !result.entry || typeof result.entry !== 'object' ||
      typeof (result.entry as Record<string, unknown>).sessionId !== 'string' ||
      !(result.entry as { sessionId: string }).sessionId.trim() ||
      result.operationId !== gate.operationId ||
      result.journalState !== 'runtime_committed' ||
      result.restored !== true
    ) {
      return mutationFailure(gate, 'Gateway restore returned no matching runtime_committed receipt');
    }
    gate = await saveMutationReceipt(gate, { key: sessionKey, operationId: gate.operationId,
      journalState: 'runtime_committed', sessionId: (result.entry as { sessionId: string }).sessionId,
      ...(typeof result.previousSessionId === 'string' ? { previousSessionId: result.previousSessionId } : {}) });
    gate = await onCommitted(gate);
    await clearSessionDeleteGate(gate.operationId);
    return mutationResult(gate);
  } catch (error) {
    if (gate && !gate.runtimeReceipt && isDefinitiveLifecycleMutationFailure(error, sessionKey, gate.operationId)) {
      await clearSessionDeleteGate(gate.operationId);
      return { success: false, error: String(error) };
    }
    return mutationFailure(gate, error);
  }
}

/**
 * Permanently delete an archived session: run the full artefact sweep on the
 * archived transcript's base id (unlinks `.archived.jsonl`, trajectory
 * sidecars, reset snapshots) and remove the archive index entry. This is the
 * "empty recycle bin" per-item action and shares the same disk contract as
 * the live hard-delete.
 */
async function permanentDeleteSession(payload: SessionPayload): Promise<{ success: boolean; error?: string; remainingPaths?: string[] }> {
  const sessionKey = getSessionKey(payload);
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }
  const { agentId } = parsed;
  const archiveIndexPath = getArchiveIndexPath(agentId);
  logger.info(`[session:permanentDelete] key=${sessionKey} agentId=${agentId}`);

  // Keep the archive locator until every derivative is gone, including after a host crash.
  const removed = (await readArchiveIndex(archiveIndexPath)).entries.find(entry => entry.sessionKey === sessionKey);
  if (!removed) {
    return { success: false, error: `Session is not in the archive index: ${sessionKey}` };
  }

  const transcriptPath = removed.transcriptPath;
  const sessionsDirAbs = dirname(transcriptPath);
  const baseId = basename(transcriptPath).replace(/\.archived\.jsonl$/, '');
  try {
    const { runHostSessionDerivativeCascade } = await import('./session-cascade-delete');
    const cascade = await runHostSessionDerivativeCascade(sessionKey, baseId);
    if (!cascade.success) {
      const detail = cascade.errors.map((entry) => `${entry.kind}:${entry.id} (${entry.error})`).join('; ');
      return { success: false, error: `Derivative cascade incomplete: ${detail}` };
    }
  } catch (error) {
    return { success: false, error: `Derivative cascade failed: ${String(error)}` };
  }
  const sweep = await sweepSessionArtefacts(sessionsDirAbs, baseId);
  const archiveCleanup = await cleanupContextArchiveArtifacts({ sessionIds: [baseId] });
  for (const removedPath of [...sweep.removed, ...archiveCleanup.removed]) {
    logger.info(`[session:permanentDelete] Unlinked ${removedPath}`);
  }
  const cleanupErrors = [
    ...sweep.errors,
    ...archiveCleanup.errors.map(({ path: failedPath, error }) => ({ path: failedPath, error: new Error(error) })),
  ];
  for (const { path: failedPath, error } of cleanupErrors) {
    logger.warn(`[session:permanentDelete] Failed to unlink ${failedPath}: ${String(error)}`);
  }
  if (cleanupErrors.length > 0) {
    // Keep the archive index entry as the retry locator until every owned derivative is gone.
    return {
      success: false,
      error: `Some archived session files could not be removed: ${String(cleanupErrors[0].error)}`,
      remainingPaths: cleanupErrors.map(({ path: failedPath }) => failedPath),
    };
  }
  logger.info(`[session:permanentDelete] Hard-deleted ${sweep.removed.length} file(s) and ${archiveCleanup.removed.length} context archive(s) for ${baseId}`);
  const removal = await removeArchiveEntry(archiveIndexPath, sessionKey, removed.transcriptPath);
  if (!removal.removed && removal.index.entries.some(entry => entry.sessionKey === sessionKey)) {
    return { success: false, error: 'Archived generation changed; current archive entry was retained' };
  }
  return { success: true };
}

/**
 * List every archived session for an agent (or for the active agent when
 * `agentId` is omitted). The renderer uses this to populate the recycle bin
 * panel. Reads only the Verse-Claw-owned archive index — does not consult
 * sessions.json, since archived entries are deliberately absent from it.
 */
async function listArchivedSessions(payload: SessionPayload): Promise<{ success: boolean; entries: SessionArchiveEntry[]; pendingMutations?: SessionPendingMutation[] }> {
  const agentId = typeof payload.agentId === 'string' && payload.agentId.trim()
    ? payload.agentId.trim()
    : 'main';
  if (!SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, entries: [] };
  }
  const archiveIndexPath = getArchiveIndexPath(agentId);
  const index = await readArchiveIndex(archiveIndexPath);
  const pendingMutations = (await listSessionMutationGates(agentId))
    .map(({ operationId, operationKind, sessionKey, agentId, createdAt }) => ({ operationId, operationKind, sessionKey, agentId, createdAt }));
  return { success: true, entries: index.entries, pendingMutations };
}

/**
 * Empty the recycle bin for an agent: permanently delete every archived
 * session. Iterates the index entries and sweeps each one. Errors are
 * accumulated but do not abort the loop — the goal is to clear as much as
 * possible, then report the first failure.
 */
async function emptyArchive(payload: SessionPayload): Promise<{ success: boolean; error?: string }> {
  const agentId = typeof payload.agentId === 'string' && payload.agentId.trim()
    ? payload.agentId.trim()
    : 'main';
  if (!SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, error: `Invalid agentId: ${agentId}` };
  }
  const archiveIndexPath = getArchiveIndexPath(agentId);
  const index = await readArchiveIndex(archiveIndexPath);
  if (index.entries.length === 0) return { success: true };

  let firstError: string | undefined;
  for (const entry of index.entries) {
    const result = await withSessionDeleteGateLock(entry.sessionKey, async () => {
      const pending = await findSessionDeleteGateBySession(entry.sessionKey);
      if (pending) return { success: false, error: 'Session has a pending lifecycle mutation' };
      return permanentDeleteSession({ id: entry.sessionKey });
    });
    if (!result.success) firstError ??= result.error;
  }
  return firstError ? { success: false, error: firstError } : { success: true };
}

type GatewaySessionDeleteResult = {
  ok?: boolean;
  key?: string;
  deleted?: boolean;
  archived?: string[];
  sessionId?: string;
  operationId?: string;
  journalState?: string;
  error?: string;
  message?: string;
};

const sessionDeleteRequests = new Map<string, Promise<SessionDeleteResult>>();

async function deleteSessionViaRuntime(
  sessionKey: string,
  gatewayManager: GatewayManager,
  onCommitted: SessionMutationCommitted,
  expectedOperationId?: unknown,
  workspaceId?: string | null,
): Promise<SessionMutationResult> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }

  // Electron mirror gate: reuse a previously persisted operationId when the
  // previous RPC failed or its outcome is unknown. A fresh operationId is
  // generated and persisted before the first RPC for a session.
  let gate = await persistSessionDeleteGate(sessionKey, parsed.agentId, expectedOperationId);

  try {
    gate = await pinMutationWorkspace(gate, workspaceId);
    const result = await gatewayManager.rpc<GatewaySessionDeleteResult>(
      'sessions.delete',
      { key: sessionKey, operationId: gate.operationId, deleteTranscript: true },
    );

    if (result?.ok !== true) {
      const errorText =
        result && (result.error || result.message)
          ? String(result.error ?? result.message)
          : JSON.stringify(result ?? {});
      return mutationFailure(gate, errorText);
    }

    if (
      result.deleted !== true ||
      result.key !== sessionKey ||
      result.operationId !== gate.operationId ||
      result.journalState !== 'runtime_committed' ||
      typeof result.sessionId !== 'string' ||
      !result.sessionId.trim()
    ) {
      return mutationFailure(gate, 'Gateway delete returned no matching runtime_committed receipt');
    }

    if (
      gate.expectedSessionId &&
      gate.expectedSessionId !== result.sessionId
    ) {
      return mutationFailure(gate, `Gateway delete receipt belongs to session ${result.sessionId}, expected ${gate.expectedSessionId}`);
    }

    gate = await saveMutationReceipt(gate, { key: sessionKey, operationId: gate.operationId,
      journalState: 'runtime_committed', sessionId: result.sessionId });
    if (gate.localSweepCommitted !== true) {
      const sweepResult = await deleteSession(sessionKey);
      const legacyStoreAbsent = !sweepResult.success && /Could not read sessions\.json:.*ENOENT/i.test(sweepResult.error ?? '');
      if (!sweepResult.success && !legacyStoreAbsent) {
        return { ...await mutationFailure(gate, sweepResult.error ?? 'Local session sweep incomplete'),
          partial: sweepResult.partial, remainingPaths: sweepResult.remainingPaths };
      }
      gate = await saveMutationProgress(gate, {
        localSweepCommitted: true,
        ...(legacyStoreAbsent ? { localSweepSkipped: 'legacy-store-absent' } : {}),
      });
    }

    gate = await onCommitted(gate);
    await clearSessionDeleteGate(gate.operationId);
    return mutationResult(gate);
  } catch (error) {
    // RPC unknown (timeout, socket drop, reconnect): do not sweep, do not
    // release the mirror gate. The persisted operationId makes the next delete
    // a retry of the same operation.
    return mutationFailure(gate, error);
  }
}

async function deleteSessionViaRuntimeSerialized(
  sessionKey: string,
  gatewayManager: GatewayManager,
  onCommitted: SessionMutationCommitted,
  expectedOperationId?: unknown,
  workspaceId?: string | null,
): Promise<SessionDeleteResult> {
  if (expectedOperationId !== undefined && typeof expectedOperationId !== 'string') {
    throw new Error('SESSION_MUTATION_CHANGED: invalid pending operation identity');
  }
  const requestKey = JSON.stringify([sessionKey, expectedOperationId ?? null]);
  const previous = sessionDeleteRequests.get(requestKey);
  if (previous) return previous;
  const current = withSessionDeleteGateLock(
    sessionKey,
    () => deleteSessionViaRuntime(sessionKey, gatewayManager, onCommitted, expectedOperationId, workspaceId),
  );
  sessionDeleteRequests.set(requestKey, current);
  void current.then(() => {
    if (sessionDeleteRequests.get(requestKey) === current) {
      sessionDeleteRequests.delete(requestKey);
    }
  }, () => {
    if (sessionDeleteRequests.get(requestKey) === current) {
      sessionDeleteRequests.delete(requestKey);
    }
  });
  return current;
}

export function createSessionsApi(ctx: {
  gatewayManager?: GatewayManager;
  terminalManager?: TerminalSessionManager;
  coordinatorLifecycle?: (event: WorkspaceCoordinatorLifecycleEvent) => Promise<void>;
  resolveCoordinator?: CompleteHostServiceRegistry['workspaces']['resolveCoordinator'];
  selectSessionTask?: CompleteHostServiceRegistry['workspaces']['selectSessionTask'];
  gatewayRpcForDelegation?: CompleteHostServiceRegistry['gateway']['rpc'];
  getActiveWorkspaceId?: () => Promise<string | null>;
  resolveTaskScope?: SessionDelegationDependencies['resolveTaskScope'];
  delegationStore?: {
    readAdmission: typeof readSessionDelegationAdmission;
    claimAdmission: typeof claimSessionDelegationAdmission;
    commitAdmission: typeof commitSessionDelegationAdmission;
  };
} = {}): CompleteHostServiceRegistry['sessions'] {
  const delegationStopEpochs = new Map<string, number>();
  const delegationFlights = new Map<string, Promise<SessionDelegationResult>>();
  const delegationStore = ctx.delegationStore ?? {
    readAdmission: readSessionDelegationAdmission,
    claimAdmission: claimSessionDelegationAdmission,
    commitAdmission: commitSessionDelegationAdmission,
  };
  const observeCoordinatorLifecycle = async (event: WorkspaceCoordinatorLifecycleEvent, required = false) => {
    if (!ctx.coordinatorLifecycle) {
      if (required) throw new Error('Lifecycle coordinator owner unavailable');
      return;
    }
    try {
      await ctx.coordinatorLifecycle(event);
    } catch (error) {
      logger.warn('[session:coordinator-lifecycle]', { event: event.type, sessionKey: event.sessionKey, error: String(error) });
      if (required) throw error;
    }
  };
  const finishMutation: SessionMutationCommitted = async (initial) => {
    let gate = initial;
    const receipt = gate.runtimeReceipt;
    if (!receipt) throw new Error('Lifecycle Runtime receipt is missing');
    if (!gate.coordinatorCommitted) {
      const binding = gate.workspaceId ? await getPersistedCoordinatorBinding(gate.workspaceId, gate.sessionKey) : null;
      if (binding) {
        const generation = gate.operationKind === 'restore' ? receipt.previousSessionId : receipt.sessionId;
        if (binding.sessionGeneration && binding.sessionGeneration !== generation && binding.sessionGeneration !== receipt.sessionId) {
          throw new Error('SESSION_MUTATION_GENERATION_CHANGED: coordinator belongs to a different generation');
        }
        const settled = gate.operationKind === 'restore'
          ? (binding.archiveRestorePolicy === 'none' ? binding.state === 'invalid' && binding.invalidationReason === 'archive-retention-none'
            : binding.state === 'active' && binding.sessionGeneration === receipt.sessionId && !binding.invalidationReason)
          : gate.operationKind === 'delete' ? binding.state === 'invalid' && binding.invalidationReason === 'session-deleted'
            : binding.archiveRestorePolicy === 'restore' ? binding.state === 'paused' && binding.invalidationReason === 'archived-restore-requested'
              : binding.state === 'invalid' && binding.invalidationReason === 'archived-retention-none';
        if (!settled) {
          await observeCoordinatorLifecycle({ type: gate.operationKind, workspaceId: gate.workspaceId, sessionKey: gate.sessionKey }, true);
          if (gate.operationKind === 'restore' && binding.archiveRestorePolicy === 'restore') {
            const restored = await getPersistedCoordinatorBinding(gate.workspaceId!, gate.sessionKey);
            if (restored?.state !== 'active' || restored.sessionGeneration !== receipt.sessionId || restored.invalidationReason) {
              throw new Error('Coordinator restore has not confirmed the restored generation');
            }
          }
        }
      }
      gate = await saveMutationProgress(gate, { coordinatorCommitted: true });
    }
    if (gate.operationKind !== 'restore' && !gate.resourcesCommitted) {
      const tracker = getResourceTracker();
      if (gate.operationKind === 'delete') {
        const browsers = getDefaultAgentBrowserService().list();
        const ports = tracker.list().resources.filter(resource => resource.ownership === 'managed');
        const terminals = ctx.terminalManager?.listAll() ?? [];
        const scoped = [...browsers, ...ports, ...terminals].filter(item => item.sessionKey === gate.sessionKey);
        if (scoped.some(item => !gate.workspaceId || item.workspaceId !== gate.workspaceId)) {
          throw new Error('SESSION_MUTATION_SCOPE_UNRESOLVED: resource workspace does not match the original operation');
        }
      }
      const resourceReclamation = await reclaimLongSessionOwnerResources({
        action: gate.operationKind === 'delete' ? 'session-delete' : 'session-archive',
        scope: { workspaceId: gate.workspaceId ?? '', sessionKey: gate.sessionKey, expectedSessionId: receipt.sessionId },
        terminalManager: ctx.terminalManager,
        resourceTracker: {
          list: () => {
            const snapshot = tracker.list();
            return { ...snapshot, resources: snapshot.resources.filter(resource => gate.workspaceId
              && resource.workspaceId === gate.workspaceId && resource.sessionKey === gate.sessionKey) };
          },
          stopResource: async (id) => {
            const resource = tracker.list().resources.find(item => item.id === id);
            if (!resource) return { success: true, resourceId: id };
            if (!gate.workspaceId || resource.workspaceId !== gate.workspaceId || resource.sessionKey !== gate.sessionKey) {
              return { success: false, error: 'Resource ownership changed before cleanup', resourceId: id };
            }
            return tracker.stopResource(id);
          },
        },
        runtimeCleanupSettled: true,
      });
      gate = await saveMutationProgress(gate, {
        resourceReclamationAttempts: [...(gate.resourceReclamationAttempts ?? []), resourceReclamation],
        resourcesCommitted: !resourceReclamation.recoveryRequired,
        ...(resourceReclamation.owners.some(owner => owner.kind === 'terminal' && owner.outcome !== 'failed' && owner.outcome !== 'unknown')
          ? { terminalClosed: true } : {}),
      });
      if (resourceReclamation.recoveryRequired) throw new Error('Main resource cleanup requires recovery');
    }
    return gate;
  };
  const delegate = async (payload: SessionDelegationPayload): Promise<SessionDelegationResult> => {
    if ((await readSystemControl()).paused) return { success: false, status: 'rejected', error: 'SYSTEM_EXECUTION_PAUSED' };
    const validated = validateSessionDelegationPayload(payload);
    if (!validated.ok) return { success: false, status: 'rejected', error: validated.error };
    if (!ctx.gatewayManager || !ctx.resolveCoordinator || !ctx.gatewayRpcForDelegation) {
      return {
        success: false,
        status: 'rejected',
        error: 'Delegation requires the active Gateway, Workspace owner, and permission owner',
      };
    }
    const flightKey = `${validated.payload.idempotencyKey}:${hashDelegationRequest(validated.payload)}`;
    const existingFlight = delegationFlights.get(flightKey);
    if (existingFlight) return existingFlight;
    const flight = executeSessionDelegation(validated.payload, {
      readAdmission: delegationStore.readAdmission,
      claimAdmission: delegationStore.claimAdmission,
      commitAdmission: delegationStore.commitAdmission,
      resolveCoordinator: ctx.resolveCoordinator,
      getActiveWorkspaceId: ctx.getActiveWorkspaceId ?? (async () => (await getExecutionWorkspaceProfile())?.id ?? null),
      resolveTaskScope: ctx.resolveTaskScope ?? (async (input) => {
        const snapshot = await loadTaskLedgerSnapshot(input.workspaceId);
        const task = snapshot.nodes.find((node) => node.id === input.taskRef);
        return {
          sessionKey: input.sessionKey,
          workspaceId: input.workspaceId,
          generation: input.sessionGeneration,
          activeTaskNodeId: input.taskRef,
          coordinatorSessionKey: input.sessionKey,
          bindingRevision: input.bindingRevision,
          bindingState: input.bindingState,
          links: snapshot.sessionLinks,
          task: task ? {
            nodeId: task.id,
            workspaceId: input.workspaceId,
            nodeKind: task.kind,
            status: task.status,
            generation: input.sessionGeneration,
          } : null,
        };
      }),
      gatewayRpc: ctx.gatewayRpcForDelegation,
      describeSessionGeneration: async (sessionKey) => {
        const described = await ctx.gatewayManager!.rpc<{
          session?: { sessionId?: string } | null;
        }>('sessions.describe', { key: sessionKey }, 15_000);
        const sessionId = described?.session?.sessionId;
        return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
      },
      assertTaskAdmission: assertManagedTaskAdmission,
      stopEpoch: (sessionKey) => delegationStopEpochs.get(sessionKey) ?? 0,
    }).finally(() => {
      delegationFlights.delete(flightKey);
    });
    delegationFlights.set(flightKey, flight);
    return flight;
  };
  const planFlights = new Map<string, Promise<SessionDelegationResult>>();
  const dispatchPlanTask = async (p: ProjectPlanDispatchPayload, key: string): Promise<SessionDelegationResult> => {
    try {
      if ((await readSystemControl()).paused) throw new Error('SYSTEM_EXECUTION_PAUSED');
      if (!ctx.gatewayManager || !ctx.selectSessionTask || !ctx.resolveCoordinator) throw new Error('TASK_SCOPE_OWNER_UNAVAILABLE');
      const profile = await getExecutionWorkspaceProfile();
      if (!profile || profile.id !== p.workspaceId || !projectCoordinatorProfile([profile], p.sessionKey)) throw new Error('TASK_PROJECT_INACTIVE');
      const described = await ctx.gatewayManager.rpc<{session?: {sessionId?: string; hasActiveRun?: boolean; status?: string}}>('sessions.describe', {key:p.sessionKey});
      if (!p.expectedSessionGeneration || described.session?.sessionId !== p.expectedSessionGeneration) throw new Error('TASK_GENERATION_STALE');
      const stored = await delegationStore.readAdmission(key);
      if (stored && stored.phase !== 'approval-pending') {
        const receipt = stored.receipt;
        if (receipt.coordinator.workspaceId !== p.workspaceId || receipt.coordinator.sessionKey !== p.sessionKey ||
            receipt.coordinator.sessionGeneration !== p.expectedSessionGeneration || receipt.taskRef !== p.expectedChildId)
          throw new Error('TASK_DELEGATION_RECEIPT_SCOPE_MISMATCH');
        if (stored.phase === 'in-flight') return { success:false, status:'outcome-unknown', error:'Dispatch is awaiting a receipt' };
        return { success:['accepted','partial'].includes(stored.receipt.status), status:stored.receipt.status,
          receipt:{ ...stored.receipt, replayed:true }, replayed:true, error:stored.receipt.errors[0] };
      }
      if (described.session.hasActiveRun || described.session.status === 'running') throw new Error('TASK_SCOPE_WRITER_BUSY');
      const config = await ctx.gatewayManager.rpc<{config?: {runtime?: {providerBudget?: {project?: {maxTokens?: number; maxCostUsd?: number}}}}}>('config.get', {});
      const limits = config.config?.runtime?.providerBudget?.project;
      if (!(limits && [limits.maxTokens, limits.maxCostUsd].some(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) || limits.maxTokens === 0 || limits.maxCostUsd === 0)
        throw new Error('TASK_PROJECT_BUDGET_UNAVAILABLE');
      const store = await openTaskSystem(p.workspaceId);
      if (!store) throw new Error('TASK_PROJECT_PLAN_NOT_FOUND');
      let task;
      try {
        const scope = projectCoordinatorScope(profile, p.sessionKey, p.expectedSessionGeneration, store.domain.worktree);
        task = store.startNextPlanTask(scope, p.planId, p.expectedRevision, key, undefined, p.expectedChildId).contract;
      } finally { store.close(); }
      const previous = profile.coordinatorBindings?.[p.sessionKey];
      const binding = previous?.activeTaskNodeId === task.taskNodeId ? previous : (await ctx.selectSessionTask({
        workspaceId:p.workspaceId, sessionKey:p.sessionKey, taskNodeId:task.taskNodeId,
        expectedSessionGeneration:p.expectedSessionGeneration, expectedRevision:previous?.bindingRevision ?? 0,
      })).binding;
      if (!binding || binding.state !== 'active' || binding.activeTaskNodeId !== task.taskNodeId) throw new Error('TASK_SCOPE_BINDING_NOT_READY');
      const instruction = JSON.stringify({objective:task.objective,target:task.target,constraints:task.constraints,acceptance:task.acceptance});
      const registry = await ctx.gatewayManager.rpc<{roles:RoleContract[]}>('roles.list',{});
      if (!registry.roles?.length) throw new Error('TASK_PROJECT_ROLE_UNAVAILABLE');
      const route = routeRole({task:task.objective,fileHints:[task.target],availableRoles:registry.roles}).primary;
      return delegate({ workspaceId:p.workspaceId, sessionKey:p.sessionKey, agentId:binding.agentId, taskRef:task.taskNodeId,
        task:task.objective, expectedBindingRevision:binding.bindingRevision, expectedSessionGeneration:p.expectedSessionGeneration,
        idempotencyKey:key, backend:'subagent', worker:{ roleName:route.role.name, task:instruction, isolation:'shared',
          ...(route.role.permissions.filesystem === 'read' ? {writeSet:[]} : {}) },
        includeVerifier:false, approvalId:p.approvalId });
    } catch (error) { return {success:false,status:'rejected',error:error instanceof Error ? error.message : String(error)}; }
  };
  const dispatchNext: CompleteHostServiceRegistry['sessions']['dispatchPlanTask'] = async p => {
      if (!p || ![p.workspaceId,p.sessionKey,p.expectedSessionGeneration,p.planId,p.expectedChildId].every(v => typeof v === 'string' && v.trim()) || !Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 1)
        return {success:false,status:'rejected',error:'TASK_PROJECT_DISPATCH_INVALID'};
      const key = 'project-dispatch:' + createHash('sha256').update(JSON.stringify([p.workspaceId,p.sessionKey,p.expectedSessionGeneration,p.planId,p.expectedRevision,p.expectedChildId])).digest('hex');
      const current = planFlights.get(key);
      if (current) return current;
      const flight = dispatchPlanTask(p,key).finally(() => planFlights.delete(key));
      planFlights.set(key,flight);
      return flight;
    };
  return {
    delegate,
    dispatchPlanTask: dispatchNext,
    dispatchSystemProject: createSystemProjectDispatch(dispatchNext),
    delete: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const workspaceId = getOptionalWorkspaceId(payload);
      if (payload.resumeOperationId !== undefined && !ctx.gatewayManager) return { success: false, error: 'Gateway manager unavailable' };
      if (ctx.gatewayManager) {
        return deleteSessionViaRuntimeSerialized(sessionKey, ctx.gatewayManager, finishMutation, payload.resumeOperationId, workspaceId);
      }
      const result = await deleteSession(sessionKey);
      if (!result.success) return result;
      await observeCoordinatorLifecycle({ type: 'delete', workspaceId, sessionKey });
      const resourceReclamation = await reclaimLongSessionOwnerResources({
        action: 'session-delete',
        scope: { workspaceId: workspaceId ?? '', sessionKey, expectedSessionId: result.expectedSessionId ?? null },
        terminalManager: ctx.terminalManager,
        runtimeCleanupSettled: false,
      }).catch((error) => {
        logger.warn('[resource-reclamation] delete pass failed', error);
        return undefined;
      });
      if (resourceReclamation?.recoveryRequired) {
        logger.warn('[resource-reclamation] delete recovery required', {
          recoveryId: resourceReclamation.recoveryId,
          activeResidue: resourceReclamation.activeResidue,
        });
      }
      return { ...result, ...(resourceReclamation ? { resourceReclamation } : {}) };
    },
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
        ? [...new Set(body.sessionKeys.filter(
          (value): value is string => typeof value === 'string' && value.startsWith('agent:'),
        ))].slice(0, MAX_SESSION_SUMMARY_KEYS)
        : [];
      if (sessionKeys.length === 0) return { success: true, summaries: [] };

      // sessions.json is shared by every session of an agent. Without this
      // cache a 300-session sidebar issued 300 reads/parses of the same file.
      const sessionsJsonCache = new Map<string, Promise<Record<string, unknown>>>();
      const readSessionsJsonOnce = (agentId: string) => {
        let pending = sessionsJsonCache.get(agentId);
        if (!pending) {
          pending = readSessionsJson(agentId);
          sessionsJsonCache.set(agentId, pending);
        }
        return pending;
      };

      // Bound disk concurrency. The previous unbounded Promise.all could open
      // hundreds of transcripts at once and stall the main process.
      const summaries = new Array<SessionSummary>(sessionKeys.length);
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < sessionKeys.length) {
          const index = nextIndex;
          nextIndex += 1;
          summaries[index] = await loadSessionSummary(
            sessionKeys[index]!,
            readSessionsJsonOnce,
          );
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(SESSION_SUMMARY_CONCURRENCY, sessionKeys.length) },
          () => worker(),
        ),
      );

      return { success: true, summaries };
    },
    history: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const limit = getLimit(payload);

      if (typeof body.sessionKey === 'string' && body.sessionKey.trim()) {
        type Description = { session?: { sessionId?: string; model?: string; parentSessionKey?: string; spawnedBy?: string } | null };
        const needsFence = Boolean(payload.expectedSessionGeneration || payload.expectedParentSessionKey);
        let described: Description | null = null;
        if (needsFence) {
          if (!ctx.gatewayManager) return { success: false, error: 'Transcript generation unavailable' };
          described = await ctx.gatewayManager.rpc<Description>('sessions.describe', { key: body.sessionKey.trim() });
          if (!described.session?.sessionId || (payload.expectedSessionGeneration && described.session.sessionId !== payload.expectedSessionGeneration)
            || (payload.expectedParentSessionKey && classifyDerivation(described.session).parentSessionKey !== payload.expectedParentSessionKey)) {
            return { success: false, error: 'Transcript scope or generation changed' };
          }
        }
        const messages = await loadSessionTranscriptByKey(body.sessionKey.trim(), limit, ctx.gatewayManager, !needsFence);
        if (!messages) return { success: false, error: 'Transcript not found' };
        if (needsFence) {
          const after = await ctx.gatewayManager!.rpc<Description>('sessions.describe', { key: body.sessionKey.trim() });
          if (after.session?.sessionId !== described?.session?.sessionId) return { success: false, error: 'Transcript generation changed during read' };
        }
        const executed = messages.findLast((message) => message.role === 'assistant'
          && typeof (message as RawMessage & { model?: string }).model === 'string') as (RawMessage & { model?: string; provider?: string }) | undefined;
        const model = executed?.model ? [executed.provider, executed.model].filter(Boolean).join('/') : undefined;
        let workerSendReceipt: { phase: 'queued' | 'steered'; idempotencyKey: string; source: 'runtime-intervention'; queueItemId?: string } | undefined;
        if (payload.workerSendIdempotencyKey && described?.session?.sessionId && ctx.gatewayManager) {
          const key = payload.workerSendIdempotencyKey;
          const history = await ctx.gatewayManager.rpc<{ events?: Array<{ idempotencyKey?: string; status?: string; payload?: { queueItemId?: string } }> }>(
            'sessions.longTaskControlHistory', { key: body.sessionKey.trim(), limit: 200 }, 10_000);
          const event = history.events?.find((entry) => entry.idempotencyKey === `chat:${key}:queue:event`
            || entry.idempotencyKey === `chat:${key}:guide:event`);
          if (event && (event.status === 'queued' || event.status === 'steered')) workerSendReceipt = {
            phase: event.status, idempotencyKey: key, source: 'runtime-intervention',
            ...(event.payload?.queueItemId ? { queueItemId: event.payload.queueItemId } : {}),
          };
          const current = await ctx.gatewayManager.rpc<Description>('sessions.describe', { key: body.sessionKey.trim() });
          if (current.session?.sessionId !== described.session.sessionId) return { success: false, error: 'Transcript generation changed during delivery read' };
        }
        const recordedMessages = messages as Array<RawMessage & { usage?: unknown }>;
        const costs = recordedMessages.filter(message => message.role === 'assistant' || isRecord(message.usage)).map(message =>
          isRecord(message.usage) && isRecord(message.usage.cost) && typeof message.usage.cost.total === 'number'
            && Number.isFinite(message.usage.cost.total) && message.usage.cost.total >= 0 ? message.usage.cost.total : null);
        const totalCost = costs.length > 0 && costs.every(cost => cost !== null)
          ? costs.reduce((total, cost) => total + (cost ?? 0), 0) : Number.NaN;
        const costUsd = Number.isFinite(totalCost) ? totalCost : undefined;
        return { success: true, messages, ...(described?.session?.sessionId ? { sessionGeneration: described.session.sessionId } : {}), ...(model ? { model } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(workerSendReceipt ? { workerSendReceipt } : {}) };
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
    sendWorker: async (payload) => {
      if (!ctx.gatewayManager || !ctx.gatewayRpcForDelegation || !payload.message.trim() || !payload.idempotencyKey) {
        return { success: false, phase: 'rejected', error: 'Worker communication is unavailable' };
      }
      const active = await getActiveWorkspaceProfile();
      if (active?.id !== payload.workspaceId) return { success: false, phase: 'rejected', error: 'Worker workspace changed' };
      const described = await Promise.all([payload.parentSessionKey, payload.childSessionKey].map((key) =>
        ctx.gatewayManager!.rpc<{ session?: { sessionId?: string; parentSessionKey?: string; spawnedBy?: string } }>('sessions.describe', { key }, 15_000)));
      const [parent, child] = described.map((entry) => entry.session);
      if (parent?.sessionId !== payload.expectedParentGeneration || child?.sessionId !== payload.expectedChildGeneration
        || !child || classifyDerivation(child).parentSessionKey !== payload.parentSessionKey) {
        return { success: false, phase: 'rejected', error: 'Worker source or generation changed' };
      }
      try {
        const binding = await getPersistedCoordinatorBinding(payload.workspaceId, payload.childSessionKey);
        if (binding && (binding.state !== 'active' || binding.sessionGeneration !== payload.expectedChildGeneration)) {
          return { success: false, phase: 'rejected', error: 'Worker task binding is not current' };
        }
        const origin = await ctx.gatewayManager.rpc<{ delegation?: { parentSessionKey: string; parentGeneration: string; workspaceDir: string | null } | null }>(
          'taskScope.runState', { sessionKey: payload.childSessionKey, sessionGeneration: payload.expectedChildGeneration, runId: payload.idempotencyKey }, 10_000,
        );
        if (origin.delegation?.parentSessionKey !== payload.parentSessionKey || origin.delegation.parentGeneration !== payload.expectedParentGeneration) {
          return { success: false, phase: 'rejected', error: 'Worker delegation origin is unavailable' };
        }
        const result = await ctx.gatewayRpcForDelegation({ method: payload.mode === 'steer' ? 'sessions.steer' : 'sessions.send',
          expectedWorkspaceId: payload.workspaceId,
          params: { key: payload.childSessionKey, expectedSessionId: payload.expectedChildGeneration,
            workspaceId: payload.workspaceId, workspaceDir: binding?.environment.canonicalRoot ?? origin.delegation.workspaceDir ?? active.rootPath,
            requesterSessionKey: payload.parentSessionKey, expectedRequesterSessionId: payload.expectedParentGeneration,
            message: payload.message, idempotencyKey: payload.idempotencyKey }, timeoutMs: 30_000 });
        if (isRecord(result) && (result.success === false || result.ok === false)) return { success: false, phase: 'rejected', error: String(result.error ?? 'Worker send rejected') };
        if (isRecord(result) && (result.queued === true || result.steered === true)) return {
          success: true, phase: result.steered === true ? 'steered' : 'queued',
          receipt: { idempotencyKey: payload.idempotencyKey, source: 'runtime-ack' },
        };
        if (!isRecord(result) || typeof result.runId !== 'string') return { success: false, phase: 'unknown', error: 'Worker delivery is unconfirmed' };
        return { success: true, phase: 'accepted', run: normalizeRunScope({ runId: result.runId,
          scope: { workspaceId: payload.workspaceId, sessionKey: payload.childSessionKey } }) };
      } catch (error) { return { success: false,
        phase: error instanceof GatewayRpcError && ['INVALID_REQUEST', '-32600', '-32602'].includes(String(error.payload.code)) ? 'rejected' : 'unknown',
        error: error instanceof Error ? error.message : String(error) }; }
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
    patchRuntimeModel: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const modelRef = getModelRef(payload);
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable' };
      }
      const result = await ctx.gatewayManager.rpc('sessions.patch', {
        key: sessionKey,
        model: modelRef,
      }, 10_000);
      logger.info('[session:patchRuntimeModel]', { sessionKey, modelRef });
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
    recallOriginal: async (payload): Promise<SessionRecallOriginalResult> => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          ok: false,
          archiveHandle: payload.archiveHandle,
          diagnostics: [{ code: 'read_error', message: 'Gateway manager unavailable.' }],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.recallOriginal', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        archiveHandle: payload.archiveHandle,
      }, 10_000);
      return {
        success: true,
        ok: result.ok === true,
        ...(result.payload !== undefined ? { payload: result.payload } : {}),
        archiveHandle: isRecord(result.archiveHandle)
          ? result.archiveHandle as SessionRecallOriginalResult['archiveHandle']
          : payload.archiveHandle,
        diagnostics: mapRecallDiagnostics(result.diagnostics),
      };
    },
    expandSelector: async (payload): Promise<SessionExpandSelectorResult> => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          ok: false,
          resourceId: payload.resourceId,
          selector: payload.selector,
          ...(payload.checksum ? { checksum: payload.checksum } : {}),
          diagnostics: [{ code: 'read_error', message: 'Gateway manager unavailable.' }],
        };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.expandSelector', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        resourceId: payload.resourceId,
        selector: payload.selector,
        ...(payload.checksum ? { checksum: payload.checksum } : {}),
      }, 10_000);
      return {
        success: true,
        ok: result.ok === true,
        ...(typeof result.content === 'string' ? { content: result.content } : {}),
        resourceId: typeof result.resourceId === 'string' ? result.resourceId : payload.resourceId,
        selector: typeof result.selector === 'string' ? result.selector : payload.selector,
        ...(typeof result.checksum === 'string'
          ? { checksum: result.checksum }
          : payload.checksum
            ? { checksum: payload.checksum }
            : {}),
        diagnostics: mapRecallDiagnostics(result.diagnostics),
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
        ...(typeof payload.expectedSessionId === 'string' && payload.expectedSessionId.trim()
          ? { expectedSessionId: payload.expectedSessionId.trim() }
          : {}),
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
    stop: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      if (!ctx.gatewayManager) {
        return {
          success: false,
          error: 'Gateway manager unavailable',
          key: sessionKey,
          stopped: false,
        };
      }
      // Session-level stop runs the canonical stop front (queued state clear,
      // recursive subagent stop, process drain); turn-level abort stays on
      // chat.abort. Advance this epoch before awaiting so a concurrent delegate
      // can never report an accepted receipt after a stop crossed its boundary.
      delegationStopEpochs.set(sessionKey, (delegationStopEpochs.get(sessionKey) ?? 0) + 1);
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.stop', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        ...(payload.expectedSessionId ? { expectedSessionId: payload.expectedSessionId } : {}),
      }, 30_000);
      const expectedSessionId = typeof result.sessionId === 'string' && result.sessionId.trim()
        ? result.sessionId.trim()
        : null;
      const resourceReclamation = result.ok === true
        ? await reclaimLongSessionOwnerResources({
            action: 'run-cancel',
            scope: {
              workspaceId: getOptionalWorkspaceId(payload) ?? '',
              sessionKey,
              expectedSessionId,
            },
            terminalManager: ctx.terminalManager,
            runtimeCleanupSettled: true,
          }).catch((error) => {
            logger.warn('[resource-reclamation] stop pass failed', error);
            return undefined;
          })
        : undefined;
      if (resourceReclamation?.recoveryRequired) {
        logger.warn('[resource-reclamation] stop recovery required', {
          recoveryId: resourceReclamation.recoveryId,
          activeResidue: resourceReclamation.activeResidue,
        });
      }
      return {
        success: true,
        key: typeof result.key === 'string' ? result.key : sessionKey,
        stopped: result.ok === true,
        ...(expectedSessionId ? { expectedSessionId } : {}),
        ...(resourceReclamation ? { resourceReclamation } : {}),
      };
    },
    restoreCheckpoint: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const checkpointId = typeof payload.checkpointId === 'string' && payload.checkpointId.trim()
        ? payload.checkpointId.trim()
        : '';
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', key: sessionKey, checkpointId, rolledBackTo: '', mode: 'legacy_checkpoint_fallback', evidenceSummary: '' };
      }
      if (!checkpointId) {
        return { success: false, error: 'checkpointId is required', key: sessionKey, checkpointId, rolledBackTo: '', mode: 'legacy_checkpoint_fallback', evidenceSummary: '' };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.restoreCheckpoint', {
        key: sessionKey,
        ...(payload.expectedSessionId !== undefined ? { expectedSessionId: payload.expectedSessionId } : {}),
        ...(agentId ? { agentId } : {}),
        checkpointId,
      }, 30_000);
      if (result && (result as { ok?: unknown }).ok === true) {
        return {
          success: true,
          key: typeof result.key === 'string' ? result.key : sessionKey,
          checkpointId,
          rolledBackTo: typeof result.rolledBackTo === 'string' ? result.rolledBackTo : checkpointId,
          mode: result.mode === 'event_log_replay' ? 'event_log_replay' : 'legacy_checkpoint_fallback',
          evidenceSummary: typeof result.evidenceSummary === 'string' ? result.evidenceSummary : '',
        };
      }
      return {
        success: false,
        error: result && typeof (result as { error?: unknown }).error === 'string'
          ? (result as { error: string }).error
          : 'Checkpoint restore failed',
        key: sessionKey,
        checkpointId,
        rolledBackTo: '',
        mode: 'legacy_checkpoint_fallback',
        evidenceSummary: '',
      };
    },
    checkpointDiff: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const checkpointId = typeof payload.checkpointId === 'string' && payload.checkpointId.trim()
        ? payload.checkpointId.trim()
        : '';
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', key: sessionKey, checkpointId, files: [], errors: [] };
      }
      if (!checkpointId) {
        return { success: false, error: 'checkpointId is required', key: sessionKey, checkpointId, files: [], errors: [] };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.checkpointDiff', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        checkpointId,
      }, 15_000);
      if (result && (result as { ok?: unknown }).ok === true) {
        const rawFiles = Array.isArray(result.files) ? result.files : [];
        return {
          success: true,
          key: typeof result.key === 'string' ? result.key : sessionKey,
          checkpointId,
          files: rawFiles.map((file) => ({
            filePath: typeof file.filePath === 'string' ? file.filePath : '',
            status: file.status === 'created' || file.status === 'deleted' ? file.status : 'modified',
            unifiedDiff: typeof file.unifiedDiff === 'string' ? file.unifiedDiff : '',
          })),
          errors: Array.isArray(result.errors) ? result.errors.map(String) : [],
        };
      }
      return {
        success: false,
        error: result && typeof (result as { error?: unknown }).error === 'string'
          ? (result as { error: string }).error
          : 'Checkpoint diff failed',
        key: sessionKey,
        checkpointId,
        files: [],
        errors: [],
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
        ...(payload.expectedSessionId !== undefined ? { expectedSessionId: payload.expectedSessionId } : {}),
        ...(agentId ? { agentId } : {}),
        customInstructions: getManualCompactionInstructions(payload),
        force: true,
      }, 120_000);
      return mapCompactionRpcOutcome(result, sessionKey);
    },
    /**
     * #178: summarize a located stretch of the transcript, keeping the untouched
     * side verbatim. Exactly one of fromLeafId / toLeafId is supplied; the
     * gateway resolves the cut point and fails closed when it is absent,
     * off-branch, or not a valid cut point.
     */
    compactRange: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload);
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const fromLeafId = typeof body.fromLeafId === 'string' ? body.fromLeafId.trim() : '';
      const toLeafId = typeof body.toLeafId === 'string' ? body.toLeafId.trim() : '';
      if (!ctx.gatewayManager) {
        return { success: false, error: 'Gateway manager unavailable', compacted: false, status: 'failed' };
      }
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.compactRange', {
        key: sessionKey,
        ...(payload.expectedSessionId !== undefined ? { expectedSessionId: payload.expectedSessionId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(fromLeafId ? { fromLeafId } : {}),
        ...(toLeafId ? { toLeafId } : {}),
        customInstructions: getManualCompactionInstructions(payload),
      }, 120_000);
      return mapCompactionRpcOutcome(result, sessionKey);
    },
    prepareHandoff: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload) ?? parseSessionKey(sessionKey)?.agentId ?? null;
      const workspaceId = getOptionalWorkspaceId(payload);
      const warnings: string[] = [];
      const sources: SessionHandoffSource[] = [];
      let runtimeCheckpoint: ResumeCheckpoint | null = null;
      let recoveryContext = '';
      let recallContext = '';
      let recallArchiveRef: string | undefined;
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
            if (latestCheckpoint.archiveHandle) {
              recallArchiveRef = latestCheckpoint.archiveHandle.uri;
              try {
                const recall = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.recallOriginal', {
                  key: sessionKey,
                  ...(agentId ? { agentId } : {}),
                  archiveHandle: latestCheckpoint.archiveHandle,
                }, 10_000);
                const diagnostics = mapRecallDiagnostics(recall.diagnostics);
                if (recall.ok === true) {
                  recallContext = renderRecallPayload(recall.payload);
                  sources.push({
                    id: 'context_recall',
                    label: 'Context recall',
                    available: true,
                    summary: diagnostics.length
                      ? `Verified archive recall (${diagnostics.map((diagnostic) => diagnostic.code).join(', ')})`
                      : 'Verified archive recall',
                  });
                } else {
                  const codes = diagnostics.map((diagnostic) => diagnostic.code).join(', ') || 'recall_failed';
                  const warning = `Context recall unavailable: ${codes}`;
                  warnings.push(warning);
                  sources.push({
                    id: 'context_recall',
                    label: 'Context recall',
                    available: false,
                    warning,
                  });
                }
              } catch (error) {
                const warning = `Context recall unavailable: ${error instanceof Error ? error.message : String(error)}`;
                warnings.push(warning);
                sources.push({
                  id: 'context_recall',
                  label: 'Context recall',
                  available: false,
                  warning,
                });
              }
            }
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
        const transcript = await loadSessionTranscriptByKey(sessionKey, 80, ctx.gatewayManager);
        if (!transcript) throw new Error('Transcript not found');
        messages = transcript;
        const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && extractMessageText(message.content).trim());
        const recentOutput = lastAssistant ? compactLine(extractMessageText(lastAssistant.content), 1200) : '';
        sources.push({
          id: 'transcript',
          label: 'Recent transcript',
          available: true,
          summary: `${messages.length} recent message(s)${recentOutput ? `; latest assistant output (unverified): ${recentOutput}` : ''}`,
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
        ...(recallArchiveRef ? [{ type: 'other' as const, ref: recallArchiveRef, label: 'Read-only context recall archive' }] : []),
        ...traceEvidence,
      ];
      const handoffDecision = await readHandoffDecision(sessionKey, workspaceId);
      if (!handoffDecision.allow) {
        return {
          success: false,
          error: handoffDecision.error,
          warnings: [...warnings, handoffDecision.reason],
          handoffDepth: handoffDecision.depth,
          handoffMaxDepth: handoffDecision.maxDepth,
        };
      }

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
          contextRecall: Boolean(recallContext),
          recoveryCheckpointId,
          sourceCount: sources.filter((source) => source.available).length,
        },
      });

      return {
        success: true,
        checkpoint,
        draft: renderHandoffDraft(checkpoint, sources, recoveryContext, recallContext),
        sources,
        warnings,
        handoffDepth: handoffDecision.depth,
        handoffParentSessionKey: handoffDecision.parentSessionKey,
        handoffRootSessionKey: handoffDecision.rootSessionKey,
      };
    },
    createHandoff: (payload) => {
      const creation = handoffCreationTail.then(async () => {
        const sourceSessionKey = getSessionKey(payload);
        const workspaceId = getOptionalWorkspaceId(payload);
        const agentId = getOptionalAgentId(payload) ?? parseSessionKey(sourceSessionKey)?.agentId ?? 'main';
        if (typeof payload.draftInput !== 'string' || !payload.draftInput.trim()) throw new Error('Handoff draft cannot be empty');
        if (!workspaceId || !ctx.gatewayManager) throw new Error('HANDOFF_OWNER_UNAVAILABLE');
        const described = await ctx.gatewayManager.rpc<{ session?: { sessionId?: string; hasActiveRun?: boolean } }>('sessions.describe', { key: sourceSessionKey }, 15_000);
        const sourceGeneration = described.session?.sessionId;
        if (!sourceGeneration) throw new Error('HANDOFF_SOURCE_UNAVAILABLE');
        if (described.session?.hasActiveRun) throw new Error('HANDOFF_SOURCE_ACTIVE');
        const draftDigest = createHash('sha256').update(payload.draftInput).digest('hex');
        const prior = await readWorkspaceHandoffOperation({ workspaceId, sessionKey: sourceSessionKey, operationId: payload.operationId });
        let operation = prior && prior.sourceSessionKey === sourceSessionKey
          && (payload.operationId || !['sent', 'accepted'].includes(prior.phase)) ? prior : null;
        if (payload.operationId && prior && prior.sourceSessionKey !== sourceSessionKey) throw new Error('HANDOFF_OPERATION_SCOPE_MISMATCH');
        if (operation && (operation.sourceGeneration !== sourceGeneration || operation.draftDigest !== draftDigest)) {
          throw new Error('HANDOFF_SOURCE_OR_DRAFT_CHANGED');
        }
        const decision = await readHandoffDecision(sourceSessionKey, workspaceId);
        if (!decision.allow) return { success: false, error: decision.error };
        const taskNodeIds = await readDerivationTaskIds(
          await loadTaskLedgerSnapshot(workspaceId), sourceSessionKey, ctx.gatewayManager,
        );
        if (!operation) {
          const id = payload.operationId ?? randomUUID();
          if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new Error('HANDOFF_OPERATION_ID_INVALID');
          const now = new Date().toISOString();
          const intent: SessionHandoffOperation = {
            id, workspaceId, agentId, sourceSessionKey, sourceGeneration,
            sessionKey: `agent:${agentId}:session-${Date.now()}-${id.slice(0, 12)}`, sessionGeneration: null,
            draftInput: payload.draftInput, draftDigest, firstSendIdempotencyKey: handoffFirstSendKey(id),
            phase: 'creating', handoffDepth: decision.depth, handoffRootSessionKey: decision.rootSessionKey,
            parentHandoffId: decision.parentHandoffId, rootHandoffId: decision.rootHandoffId ?? id,
            createdAt: now, updatedAt: now,
          };
          operation = await updateWorkspaceHandoffOperation(workspaceId, id, (current) => {
            if (current) throw new Error('HANDOFF_OPERATION_ID_CONFLICT');
            return intent;
          });
        }
        const { sessionKey, id } = operation;
        let child = await ctx.gatewayManager.rpc<{ session?: { sessionId?: string; parentSessionKey?: string } | null }>('sessions.describe', { key: sessionKey }, 15_000);
        if (!child.session) {
          if (operation.sessionGeneration) throw new Error('HANDOFF_CHILD_GENERATION_CHANGED');
          await ctx.gatewayManager.rpc('sessions.create', { key: sessionKey, agentId, parentSessionKey: sourceSessionKey }, 30_000);
          child = await ctx.gatewayManager.rpc('sessions.describe', { key: sessionKey }, 15_000);
        }
        if (!child.session?.sessionId || child.session.parentSessionKey !== sourceSessionKey) throw new Error('HANDOFF_RUNTIME_SOURCE_MISMATCH');
        if (operation.sessionGeneration && operation.sessionGeneration !== child.session.sessionId) throw new Error('HANDOFF_CHILD_GENERATION_CHANGED');
        // Pin the runtime child before activation; interrupted activation must keep
        // its creating phase and reject a reset child when the operation resumes.
        if (!operation.sessionGeneration) {
          operation = await updateWorkspaceHandoffOperation(workspaceId, id, (current) => ({
            ...current!, sessionGeneration: child.session!.sessionId!,
          }));
        }
        const after = await ctx.gatewayManager.rpc<{ session?: { sessionId?: string; hasActiveRun?: boolean; status?: string } }>('sessions.describe', { key: sourceSessionKey }, 15_000);
        if (after.session?.sessionId !== sourceGeneration) throw new Error('HANDOFF_SOURCE_GENERATION_CHANGED');
        if (after.session.hasActiveRun || after.session.status === 'running') throw new Error('HANDOFF_SOURCE_ACTIVE');
        const lineage = {
          handoffDepth: operation.handoffDepth,
          handoffParentSessionKey: sourceSessionKey,
          handoffRootSessionKey: operation.handoffRootSessionKey,
          parentHandoffId: operation.parentHandoffId,
          rootHandoffId: operation.rootHandoffId,
        };
        // Persist lineage before activating the session. A failed workspace update can leave
        // an unused lineage record, but cannot activate an untracked session or reset depth.
        await appendTaskLedgerEvents(workspaceId, sessionDerivationEvents({
          id, sessionKey, agentId, relation: 'handoff_from', sourceSessionKey,
          sessionGeneration: child.session.sessionId,
          ...lineage, createdAt: new Date().toISOString(),
        }, taskNodeIds), `handoff:${sourceSessionKey}:${sessionKey}`);
        if (operation.phase === 'creating') {
          const ready = await ctx.gatewayManager.rpc<{ session?: { sessionId?: string; hasActiveRun?: boolean; status?: string } }>(
            'sessions.describe', { key: sourceSessionKey }, 15_000,
          );
          if (ready.session?.sessionId !== sourceGeneration) throw new Error('HANDOFF_SOURCE_GENERATION_CHANGED');
          if (ready.session.hasActiveRun || ready.session.status === 'running') throw new Error('HANDOFF_SOURCE_ACTIVE');
          const sourceBinding = await getPersistedCoordinatorBinding(workspaceId, sourceSessionKey);
          const claim = sourceBinding?.writerClaim;
          const writer = await ctx.gatewayManager.rpc<{ quiescent?: boolean }>('taskScope.runState', {
            sessionKey: sourceSessionKey, sessionGeneration: claim?.sessionGeneration ?? sourceGeneration,
            runId: claim?.run.runId ?? `handoff:${id}`, processScope: 'session',
          }, 10_000);
          if (writer.quiescent !== true) throw new Error('HANDOFF_SOURCE_WRITER_BUSY');
          await createWorkspacesApi(ctx).saveState({
            id: workspaceId, sessionKey,
            state: { activeTopicId: null, draftInput: payload.draftInput },
          });
          const { handoffManagedSessionTask } = await import('./task-system-service');
          const workspaceRoot = sourceBinding?.environment.canonicalRoot ?? await getWorkspaceRootPathById(workspaceId);
          if (workspaceRoot) handoffManagedSessionTask({ workspaceRoot, sourceSessionKey, sourceGeneration,
            sessionKey, generation: child.session.sessionId });
          // Ready enables first delivery, so activation must be confirmed by its owner.
          await observeCoordinatorLifecycle({
            type: 'handoff',
            workspaceId,
            sourceSessionKey,
            sessionKey,
            agentId,
            sessionGeneration: child.session.sessionId,
          }, true);
        }
        operation = await updateWorkspaceHandoffOperation(workspaceId, id, (current) => ({
          ...current!, sessionGeneration: child.session!.sessionId!,
          phase: current!.phase === 'creating' ? 'ready' : current!.phase,
        }));
        return { success: true, sessionKey, operation, ...lineage };
      });
      handoffCreationTail = creation.catch(() => undefined);
      return creation;
    },
    handoffOperation: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const workspaceId = getOptionalWorkspaceId(payload);
      if (!workspaceId) return { success: false, operation: null, error: 'HANDOFF_WORKSPACE_MISSING' };
      let operation = await readWorkspaceHandoffOperation({ workspaceId, sessionKey, operationId: payload.operationId });
      if (operation && payload.reconcile && ['sending', 'accepted', 'unknown'].includes(operation.phase)) {
        const current = operation;
        try {
          if (!ctx.gatewayManager) throw new Error('Gateway unavailable');
          const child = await ctx.gatewayManager.rpc<{ session?: { sessionId?: string } }>('sessions.describe', { key: current.sessionKey }, 15_000);
          if (child.session?.sessionId !== current.sessionGeneration) throw new Error('Handoff child generation changed');
          const messages = await loadSessionTranscriptByKey(current.sessionKey, 1000, ctx.gatewayManager);
          const delivered = messages?.some((message) => message.role === 'user'
            && (message as RawMessage & { idempotencyKey?: string }).idempotencyKey === `${current.firstSendIdempotencyKey}:user`);
          operation = await updateWorkspaceHandoffOperation(workspaceId, current.id, (latest) => ({
            ...latest!, phase: delivered ? 'sent' : latest!.phase === 'accepted' || latest!.phase === 'sent' ? latest!.phase : 'unknown',
            ...(delivered ? { error: null, receipt: { source: 'transcript', run: normalizeRunScope({
              runId: current.firstSendIdempotencyKey, scope: { workspaceId, sessionKey: current.sessionKey },
            }) } } : {}),
          }));
        } catch (error) {
          operation = await updateWorkspaceHandoffOperation(workspaceId, current.id, (latest) => ({
            ...latest!, phase: latest!.phase === 'sent' ? 'sent' : 'unknown', error: String(error),
          }));
        }
      }
      return { success: true, operation };
    },
    fork: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const agentId = getOptionalAgentId(payload) ?? parseSessionKey(sessionKey)?.agentId ?? null;
      const workspaceId = getOptionalWorkspaceId(payload);
      const label = isRecord(payload) && typeof (payload as SessionPayload).label === 'string'
        ? String((payload as SessionPayload).label).trim()
        : '';
      const fromLeafId =
        isRecord(payload) && typeof (payload as SessionPayload).fromLeafId === 'string'
          ? String((payload as SessionPayload).fromLeafId).trim()
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
      const taskSnapshot = await loadTaskLedgerSnapshot(workspaceId);
      await readDerivationTaskIds(taskSnapshot, sessionKey, ctx.gatewayManager);
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.fork', {
        key: sessionKey,
        ...(agentId ? { agentId } : {}),
        ...(label ? { label } : {}),
        // #180: the gateway rejects an unresolvable fromLeafId; do not strip it
        // here, or the desktop app would silently fork the tip instead.
        ...(fromLeafId ? { fromLeafId } : {}),
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
      // Re-read the generation after cloning: a reset may race with sessions.fork.
      const taskNodeIds = await readDerivationTaskIds(taskSnapshot, sourceSessionKey, ctx.gatewayManager);
      if (sourceSessionKey !== sessionKey) {
        taskNodeIds.push(...await readDerivationTaskIds(taskSnapshot, sessionKey, ctx.gatewayManager));
      }
      const entry = isRecord(result.entry) ? result.entry : undefined;
      const generation = typeof result.sessionId === 'string' ? result.sessionId.trim()
        : typeof entry?.sessionId === 'string' ? entry.sessionId.trim() : null;
      if (taskNodeIds.length && !generation) {
        return {
          success: false, sourceSessionKey, sessionKey: nextSessionKey, agentId, workspaceId,
          error: 'Task scope unavailable: fork session generation is missing',
          warnings: ['fork_task_scope_unavailable'],
        };
      }
      await appendTaskLedgerEvents(workspaceId, sessionDerivationEvents({
        id: randomUUID(), sessionKey: nextSessionKey, agentId,
        relation: 'forked_from', sourceSessionKey, sessionGeneration: generation || null,
        createdAt: new Date().toISOString(),
      }, [...new Set(taskNodeIds)]), `session-fork:${sourceSessionKey}:${nextSessionKey}`);
      if (workspaceId) await persistentTaskChatContext(workspaceId,nextSessionKey,ctx.gatewayManager,(await getWorkspaceRootPathById(workspaceId))??undefined);
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
    truncate: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
      return truncateSessionTranscriptBeforeMessage(
        sessionKey,
        messageId,
        getOptionalAgentId(payload) ?? parseSessionKey(sessionKey)?.agentId ?? null,
      );
    },
    archive: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const sessionKey = getSessionKey(payload);
      return withSessionDeleteGateLock(sessionKey, () => archiveSession({
        id: sessionKey,
        label: body.label,
        originalWorkspaceId: body.originalWorkspaceId,
        originalFolderId: body.originalFolderId,
        resumeOperationId: body.resumeOperationId,
      }, ctx.gatewayManager, finishMutation));
    },
    restore: async (payload) => withSessionDeleteGateLock(getSessionKey(payload), () =>
      restoreSession(payload, ctx.gatewayManager, finishMutation)),
    permanentDelete: async (payload) => {
      const sessionKey = getSessionKey(payload);
      const workspaceId = getOptionalWorkspaceId(payload);
      return withSessionDeleteGateLock(sessionKey, async () => {
      const pending = await findSessionDeleteGateBySession(sessionKey);
      if (pending) return { success: false, error: 'Session has a pending lifecycle mutation' };
      const result = await permanentDeleteSession({ id: sessionKey });
      if (result.success) {
        await getResourceTracker().unregisterBySession(sessionKey).catch(() => 0);
        await observeCoordinatorLifecycle({ type: 'delete', workspaceId, sessionKey });
      }
      return result;
      });
    },
    contextFoldingStatus: async (): Promise<SessionContextFoldingStatusResult> => {
      try {
        return {
          success: true,
          status: describeContextFoldingStatus({ config: readRuntimeConfigForContextFolding(), env: process.env }),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          status: describeContextFoldingStatus({ env: {} }),
        };
      }
    },
    contextFoldProjection: async (payload: SessionContextFoldProjectionPayload): Promise<SessionContextFoldProjectionResult> => {
      const body = isRecord(payload) ? payload : { result: undefined };
      const maxChars = typeof body.maxChars === 'number' ? body.maxChars : undefined;
      try {
        const { projection, chars, truncated } = projectContextFoldResultForParent(
          body.result,
          maxChars !== undefined ? { maxChars } : {},
        );
        return { success: true, ok: true, projection, chars, truncated, diagnostics: projection.diagnostics };
      } catch (error) {
        if (error instanceof ContextFoldingValidationError) {
          return {
            success: true,
            ok: false,
            diagnostics: error.issues.map((issue) => ({
              code: issue.code,
              message: issue.message,
              ...(issue.path ? { detail: { path: issue.path } } : {}),
            })),
          };
        }
        throw error;
      }
    },
    listArchived: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      return listArchivedSessions({ agentId: body.agentId });
    },
    emptyArchive: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      return emptyArchive({ agentId: body.agentId });
    },
  };
}
