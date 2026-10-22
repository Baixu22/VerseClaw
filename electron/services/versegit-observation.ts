/**
 * WP1 host observation bridge for the VerseGit module.
 *
 * This service consumes the host's existing ChatRuntimeEvent stream and emits a
 * Versioned, privacy-bounded behaviour event with repo/worktree/session/epoch identity.
 * It never executes VerseGit, never writes the user workspace, and never changes the
 * harness verdict. Unbound, stale, duplicate and partial observations remain explicit.
 */
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import { VG_FEEDBACK_SCHEMA, type VerseGitFeedbackDelivery, type VerseGitToolBasis, type VerseGitToolObservationRequest } from '../../shared/versegit-runtime-contract';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const VG_OBSERVATION_SCHEMA = 'clawx.versegit.behavior-event/v1';
export const VG_OBSERVATION_RESULT_SCHEMA = 'clawx.versegit.observation-result/v1';
export const VG_OBSERVATION_BINDING_SCHEMA = 'clawx.versegit.observation-binding/v1';
export const VG_OBSERVATION_COVERAGE_SCHEMA = 'clawx.versegit.observation-coverage/v1';
export const VG_OBSERVATION_SEAL_SCHEMA = 'clawx.versegit.observation-seal/v1';
export const VG_OBSERVATION_BATCH_SCHEMA = 'clawx.versegit.observation-batch/v1';

export const VG_BEHAVIOR_SURFACES = [
  'file.read', 'file.write', 'repo.search', 'exec', 'test', 'mcp', 'network', 'browser', 'control',
] as const;
export const VG_BEHAVIOR_EFFECTS = ['none', 'read', 'write', 'process', 'network', 'unknown'] as const;
export const VG_BEHAVIOR_STATUSES = ['started', 'succeeded', 'failed', 'cancelled', 'timed-out', 'unknown'] as const;
export const VG_COVERAGE_GRADES = ['direct', 'host-event', 'inferred', 'partial', 'unobserved', 'dropped'] as const;

export type BehaviorSurface = (typeof VG_BEHAVIOR_SURFACES)[number];
export type BehaviorEffect = (typeof VG_BEHAVIOR_EFFECTS)[number];
export type BehaviorStatus = (typeof VG_BEHAVIOR_STATUSES)[number];
export type CoverageGrade = (typeof VG_COVERAGE_GRADES)[number];

export type ObservationBinding = {
  runId: string;
  sessionKey?: string;
  traceId: string;
  requestId?: string;
  repoId: string;
  worktreeId: string;
  agentSessionId: string;
  vgSessionId: string;
  ownerId: string;
  actor: string;
  epoch: number;
  bindingId?: string;
  worktreePath?: string;
  boundAt?: number;
};

export type ObservationContext = {
  epoch?: number;
  ownerId?: string;
  requestId?: string;
  traceId?: string;
  eventId?: string;
  artifactRef?: string;
  observedAt?: number;
};

export type ObservationCoverageVector = {
  fileRead: CoverageGrade;
  fileWrite: CoverageGrade;
  search: CoverageGrade;
  shellRead: CoverageGrade;
  shellWrite: CoverageGrade;
  mcpRead: CoverageGrade;
  mcpWrite: CoverageGrade;
  network: CoverageGrade;
  browser: CoverageGrade;
  directFs: CoverageGrade;
};

export type ObservationCoverageSnapshot = {
  schema: typeof VG_OBSERVATION_COVERAGE_SCHEMA;
  runId: string;
  repoId: string;
  worktreeId: string;
  agentSessionId: string;
  vgSessionId: string;
  epoch: number;
  values: ObservationCoverageVector;
  knownGaps: string[];
  eventCount: number;
  duplicateCount: number;
  staleCount: number;
  rejectedCount: number;
  surfaceCounts: Record<BehaviorSurface, number>;
  toolEventCount: number;
  droppedCount: number;
};

export type VerseGitBehaviorEvent = {
  schema: typeof VG_OBSERVATION_SCHEMA;
  eventId: string;
  runId: string;
  traceId: string;
  requestId: string | null;
  agentSessionId: string;
  vgSessionId: string;
  repoId: string;
  worktreeId: string;
  ownerId: string;
  actor: string;
  epoch: number;
  source: 'chat-runtime' | 'tool-middleware';
  sourceEventType: string;
  surface: BehaviorSurface;
  operation: string;
  effect: BehaviorEffect;
  status: BehaviorStatus;
  coverage: CoverageGrade;
  evidence: {
    grade: 'normalized-event' | 'direct-receipt' | 'polling-inference' | 'none';
    ref: string | null;
  };
  inputDigest: string;
  outputDigest: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  reason: string | null;
  path?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  basis?: VerseGitToolBasis;
};

export type ObservationIngestResult = {
  schema: typeof VG_OBSERVATION_RESULT_SCHEMA;
  status: 'observed' | 'partial' | 'unobserved' | 'duplicate' | 'stale' | 'rejected_by_policy';
  why: string;
  event: VerseGitBehaviorEvent | null;
  dedupeKey: string | null;
  issues: string[];
  binding: {
    runId: string;
    repoId: string;
    worktreeId: string;
    agentSessionId: string;
    epoch: number;
  } | null;
  feedback?: VerseGitFeedbackDelivery;
  host_verdict: 'unchanged';
};

export type ObservationBindingResult = {
  schema: typeof VG_OBSERVATION_BINDING_SCHEMA;
  status: 'attached' | 'rejected_by_policy';
  binding: ObservationBinding | null;
  issues: string[];
  host_verdict: 'unchanged';
};

export type ObservationSealResult = {
  schema: typeof VG_OBSERVATION_SEAL_SCHEMA;
  status: 'detached' | 'stale' | 'rejected_by_policy';
  why: string;
  runId: string;
  coverage: ObservationCoverageSnapshot | null;
  sessionEnd: VerseGitBehaviorEvent | null;
  issues: string[];
  host_verdict: 'unchanged';
};

type ToolDescriptor = {
  surface: BehaviorSurface;
  operation: string;
  effect: BehaviorEffect;
  coverage: CoverageGrade;
  reason: string | null;
};

type ToolCallState = {
  descriptor: ToolDescriptor;
  startedAt: number;
};

type MappedRuntimeEvent = {
  descriptor: ToolDescriptor;
  status: BehaviorStatus;
  operation: string;
  input: unknown;
  output: unknown;
  reason: string | null;
};

type ActiveToolObservation = {
  event: VerseGitBehaviorEvent;
  toolCallId: string;
  toolName: string;
  observedAtMs: number;
  basis: VerseGitToolBasis | null;
};

export type VerseGitStaleReadFinding = {
  schema: 'clawx.versegit.stale-read-finding/v1';
  findingId: string;
  kind: 'stale-read' | 'api-drift';
  path: string;
  readEventId: string;
  writeEventId: string;
  readerSessionId: string;
  writerSessionId: string;
  readRange: { lineStart: number; lineEnd: number };
  writeRange: { lineStart: number; lineEnd: number };
  readBasisSha256: string;
  writeBeforeSha256: string | null;
  writeAfterSha256: string;
  observedAt: string;
  host_verdict: 'unchanged';
};

type ActiveSession = {
  binding: ObservationBinding;
  coverage: ObservationCoverageVector;
  knownGaps: string[];
  surfaceCounts: Record<BehaviorSurface, number>;
  eventCount: number;
  duplicateCount: number;
  staleCount: number;
  rejectedCount: number;
  seen: BoundedKeySet;
  activeCalls: Map<string, ToolCallState>;
  toolObservations: ActiveToolObservation[];
  deliveredFeedback: Set<string>;
  toolEventCount: number;
  droppedCount: number;
};

type Tombstone = {
  binding: ObservationBinding;
  detachedAt: number;
};

const DEFAULT_GAPS = [
  'shellRead is unobserved: a structured exec event cannot prove which files a process read',
  'shellWrite is inferred from process events until VerseShell supplies a filesystem receipt',
  'external MCP and browser/network effects are partially observable',
  'direct filesystem access outside host tools remains unobserved',
];
const COVERAGE_RANK: Record<CoverageGrade, number> = {
  unobserved: 0, dropped: 1, partial: 2, inferred: 3, 'host-event': 4, direct: 5,
};

class BoundedKeySet {
  private readonly values = new Set<string>();
  private readonly insertionOrder: string[] = [];
  private readonly limit: number;

  constructor(limit = 10_000) {
    this.limit = limit;
  }

  add(value: string): boolean {
    if (this.values.has(value)) return false;
    this.values.add(value);
    this.insertionOrder.push(value);
    while (this.insertionOrder.length > this.limit) {
      const oldest = this.insertionOrder.shift();
      if (oldest !== undefined) this.values.delete(oldest);
    }
    return true;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return 'null';
}

function digestOf(value: unknown): string {
  return `sha256:${sha256(stableJson(value))}`;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toIso(ts: number): string {
  return new Date(ts).toISOString();
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200
    && !/^(?:[A-Za-z]:[\\/]|\/)/u.test(value.trim());
}

function normalizeStatus(value: unknown): BehaviorStatus {
  const normalized = String(value ?? '').toLowerCase();
  if (['started', 'running', 'pending', 'in_progress', 'in-progress'].includes(normalized)) return 'started';
  if (['completed', 'complete', 'success', 'succeeded', 'ok', 'done'].includes(normalized)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(normalized)) return 'failed';
  if (['cancelled', 'canceled', 'aborted'].includes(normalized)) return 'cancelled';
  if (['timeout', 'timed-out', 'timed_out'].includes(normalized)) return 'timed-out';
  return 'unknown';
}

function toolText(name: string, args: unknown): string {
  return `${name} ${stableJson(args)}`.toLowerCase();
}

export function classifyToolSurface(toolName: string, args?: unknown): ToolDescriptor {
  const name = toolName.toLowerCase().replaceAll(' ', '_');
  const text = toolText(toolName, args);
  if (/^(?:mcp__|mcp[.:/_-])/u.test(name) || /\bmcp\b/u.test(name)) {
    return { surface: 'mcp', operation: 'call', effect: 'unknown', coverage: 'partial', reason: 'external_mcp_effect_partial' };
  }
  if (/browser|playwright|puppeteer/u.test(name)) {
    return { surface: 'browser', operation: 'interact', effect: 'network', coverage: 'partial', reason: 'browser_effect_partial' };
  }
  if (/web_fetch|webfetch|http|fetch|curl|network/u.test(name)) {
    return { surface: 'network', operation: 'fetch', effect: 'network', coverage: 'partial', reason: 'network_effect_partial' };
  }
  if (/write|edit|patch|replace|create_file|delete_file|remove_file|mkdir|rename/u.test(name)) {
    return { surface: 'file.write', operation: 'write', effect: 'write', coverage: 'host-event', reason: null };
  }
  if (/read_file|readfile|view_file|open_file|cat_file|^read$/u.test(name)) {
    return { surface: 'file.read', operation: 'read', effect: 'read', coverage: 'host-event', reason: null };
  }
  if (/search|grep|glob|find|list_files|repo_map/u.test(name)) {
    return { surface: 'repo.search', operation: 'search', effect: 'read', coverage: 'host-event', reason: null };
  }
  if (/test|vitest|jest|pytest|playwright_test/u.test(name) || /(?:pnpm|npm|yarn|bun)\s+test|cargo\s+test|pytest|vitest/u.test(text)) {
    return { surface: 'test', operation: 'execute', effect: 'process', coverage: 'host-event', reason: null };
  }
  if (/exec|shell|bash|command|terminal|process|spawn/u.test(name)) {
    return { surface: 'exec', operation: 'execute', effect: 'process', coverage: 'host-event', reason: null };
  }
  if (/control|approval|permission|session/u.test(name)) {
    return { surface: 'control', operation: 'control', effect: 'none', coverage: 'host-event', reason: null };
  }
  return { surface: 'control', operation: 'unknown', effect: 'unknown', coverage: 'unobserved', reason: 'unknown_tool_surface' };
}

function classifyStatus(event: ChatRuntimeEvent): BehaviorStatus {
  if (event.type === 'run.ended') {
    if (event.status === 'completed') return 'succeeded';
    if (event.status === 'aborted') return 'cancelled';
    return 'failed';
  }
  if (event.type === 'tool.completed') return event.isError ? 'failed' : 'succeeded';
  if (event.type === 'command.output') {
    if (typeof event.exitCode === 'number') return event.exitCode === 0 ? 'succeeded' : 'failed';
    return normalizeStatus(event.status ?? event.phase);
  }
  if (event.type === 'patch.completed') return 'succeeded';
  if (event.type === 'approval.updated') return normalizeStatus(event.phase ?? event.status);
  if (event.type === 'run.started' || event.type === 'tool.started' || event.type === 'tool.updated') return 'started';
  return 'unknown';
}

function mapRuntimeEvent(event: ChatRuntimeEvent): MappedRuntimeEvent | null {
  switch (event.type) {
    case 'tool.started':
      return {
        descriptor: classifyToolSurface(event.name, event.args), status: 'started', operation: classifyToolSurface(event.name, event.args).operation,
        input: event.args, output: null, reason: null,
      };
    case 'tool.updated':
      return {
        descriptor: classifyToolSurface(event.name), status: 'started', operation: classifyToolSurface(event.name).operation,
        input: null, output: event.partialResult, reason: 'partial_tool_update',
      };
    case 'tool.completed': {
      const descriptor = classifyToolSurface(event.name);
      return { descriptor, status: classifyStatus(event), operation: descriptor.operation, input: null, output: event.result, reason: null };
    }
    case 'command.output': {
      const descriptor = classifyToolSurface(event.name ?? event.title ?? 'command', { title: event.title, cwd: event.cwd });
      return { descriptor, status: classifyStatus(event), operation: descriptor.operation, input: { cwd: event.cwd, title: event.title }, output: event.output, reason: null };
    }
    case 'patch.completed':
      return {
        descriptor: { surface: 'file.write', operation: 'patch', effect: 'write', coverage: 'host-event', reason: null },
        status: 'succeeded', operation: 'patch', input: { title: event.title },
        output: { added: event.added, modified: event.modified, deleted: event.deleted, summary: event.summary }, reason: null,
      };
    case 'approval.updated':
      return {
        descriptor: { surface: 'control', operation: 'approval', effect: 'none', coverage: 'host-event', reason: null },
        status: classifyStatus(event), operation: 'approval', input: { title: event.title, kind: event.kind },
        output: { phase: event.phase, status: event.status, message: event.message }, reason: event.message ?? null,
      };
    case 'run.started':
      return {
        descriptor: { surface: 'control', operation: 'session.start', effect: 'none', coverage: 'host-event', reason: null },
        status: 'started', operation: 'session.start', input: null, output: null, reason: null,
      };
    case 'run.ended':
      return {
        descriptor: { surface: 'control', operation: 'session.end', effect: 'none', coverage: 'host-event', reason: null },
        status: classifyStatus(event), operation: 'session.end', input: null, output: { status: event.status, stopReason: event.stopReason }, reason: event.error ?? null,
      };
    default:
      return null;
  }
}

function emptyCoverage(): ObservationCoverageVector {
  return {
    fileRead: 'unobserved', fileWrite: 'unobserved', search: 'unobserved',
    shellRead: 'unobserved', shellWrite: 'unobserved', mcpRead: 'unobserved', mcpWrite: 'unobserved',
    network: 'unobserved', browser: 'unobserved', directFs: 'unobserved',
  };
}

function emptySurfaceCounts(): Record<BehaviorSurface, number> {
  return {
    'file.read': 0, 'file.write': 0, 'repo.search': 0, exec: 0, test: 0, mcp: 0,
    network: 0, browser: 0, control: 0,
  };
}

function raiseCoverage(current: CoverageGrade, next: CoverageGrade): CoverageGrade {
  return COVERAGE_RANK[next] > COVERAGE_RANK[current] ? next : current;
}

function applyCoverage(coverage: ObservationCoverageVector, descriptor: ToolDescriptor): void {
  switch (descriptor.surface) {
    case 'file.read': coverage.fileRead = raiseCoverage(coverage.fileRead, descriptor.coverage); break;
    case 'file.write': coverage.fileWrite = raiseCoverage(coverage.fileWrite, descriptor.coverage); break;
    case 'repo.search': coverage.search = raiseCoverage(coverage.search, descriptor.coverage); break;
    case 'exec':
    case 'test':
      coverage.shellWrite = raiseCoverage(coverage.shellWrite, 'inferred');
      break;
    case 'mcp':
      coverage.mcpRead = raiseCoverage(coverage.mcpRead, 'partial');
      coverage.mcpWrite = raiseCoverage(coverage.mcpWrite, 'partial');
      break;
    case 'network': coverage.network = raiseCoverage(coverage.network, 'partial'); break;
    case 'browser': coverage.browser = raiseCoverage(coverage.browser, 'partial'); break;
    case 'control': break;
  }
}

function toSnapshot(session: ActiveSession): ObservationCoverageSnapshot {
  return {
    schema: VG_OBSERVATION_COVERAGE_SCHEMA,
    runId: session.binding.runId,
    repoId: session.binding.repoId,
    worktreeId: session.binding.worktreeId,
    agentSessionId: session.binding.agentSessionId,
    vgSessionId: session.binding.vgSessionId,
    epoch: session.binding.epoch,
    values: { ...session.coverage },
    knownGaps: [...session.knownGaps],
    eventCount: session.eventCount,
    duplicateCount: session.duplicateCount,
    staleCount: session.staleCount,
    rejectedCount: session.rejectedCount,
    surfaceCounts: { ...session.surfaceCounts },
    toolEventCount: session.toolEventCount,
    droppedCount: session.droppedCount,
  };
}

function resultFor(
  status: ObservationIngestResult['status'],
  why: string,
  issues: string[] = [],
  binding: ActiveSession | null = null,
  event: VerseGitBehaviorEvent | null = null,
  dedupeKey: string | null = null,
): ObservationIngestResult {
  return {
    schema: VG_OBSERVATION_RESULT_SCHEMA,
    status,
    why,
    event,
    dedupeKey,
    issues,
    binding: binding ? {
      runId: binding.binding.runId,
      repoId: binding.binding.repoId,
      worktreeId: binding.binding.worktreeId,
      agentSessionId: binding.binding.agentSessionId,
      epoch: binding.binding.epoch,
    } : null,
    host_verdict: 'unchanged',
  };
}

function eventKey(event: ChatRuntimeEvent, context: ObservationContext): string {
  if (context.eventId) return `event:${context.eventId}`;
  if (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed') {
    return `${event.runId}:${event.type}:${event.toolCallId}:${event.seq ?? digestOf((event as { result?: unknown; partialResult?: unknown }).result ?? (event as { partialResult?: unknown }).partialResult)}`;
  }
  if (event.type === 'command.output') {
    return `${event.runId}:${event.type}:${event.toolCallId ?? event.itemId ?? event.name ?? 'command'}:${event.seq ?? digestOf({ output: event.output, status: event.status, exitCode: event.exitCode })}`;
  }
  if (event.type === 'patch.completed') {
    return `${event.runId}:${event.type}:${event.toolCallId ?? event.itemId ?? 'patch'}:${event.seq ?? digestOf(event)}`;
  }
  return `${event.runId}:${event.type}:${event.seq ?? digestOf(event)}`;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function normalizeObservedPath(rootPath: string, cwd: string, observedPath: string): string | null {
  try {
    const root = realpathSync(rootPath);
    const canonicalCwd = realpathSync(cwd);
    if (!isWithinRoot(root, canonicalCwd)) return null;
    const candidate = resolve(canonicalCwd, observedPath);
    const existing = existsSync(candidate) ? candidate : null;
    const canonicalCandidate = existing
      ? realpathSync(existing)
      : resolve(realpathSync(dirname(candidate)), basename(candidate));
    if (!isWithinRoot(root, canonicalCandidate)) return null;
    const rel = relative(root, canonicalCandidate);
    if (!rel) return null;
    return rel.replaceAll('\\', '/');
  } catch {
    return null;
  }
}

function rangesOverlap(
  left: { lineStart: number; lineEnd: number },
  right: { lineStart: number; lineEnd: number },
): boolean {
  return left.lineStart <= right.lineEnd && right.lineStart <= left.lineEnd;
}

function isApiDriftPath(path: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|py)$/u.test(path.toLowerCase());
}

function validateBinding(binding: ObservationBinding): string[] {
  const issues: string[] = [];
  for (const [field, value] of Object.entries({
    runId: binding.runId, traceId: binding.traceId, repoId: binding.repoId, worktreeId: binding.worktreeId,
    agentSessionId: binding.agentSessionId, vgSessionId: binding.vgSessionId, ownerId: binding.ownerId, actor: binding.actor,
  })) {
    if (!isOpaqueId(value)) issues.push(`${field} must be a non-empty opaque identifier, not a filesystem path`);
  }
  if (!Number.isInteger(binding.epoch) || binding.epoch < 1) issues.push('epoch must be a positive integer');
  if (binding.sessionKey !== undefined && !isOpaqueId(binding.sessionKey)) issues.push('sessionKey must be a non-empty opaque identifier');
  if (binding.requestId !== undefined && !isOpaqueId(binding.requestId)) issues.push('requestId must be a non-empty opaque identifier');
  if (binding.bindingId !== undefined && !isOpaqueId(binding.bindingId)) issues.push('bindingId must be a non-empty opaque identifier');
  if (binding.worktreePath !== undefined && !isAbsolute(binding.worktreePath)) issues.push('worktreePath must be an absolute host path when present');
  return issues;
}

export class VerseGitObservationBridge {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly tombstones = new Map<string, Tombstone>();
  private readonly tombstoneOrder: string[] = [];
  private readonly options: { maxSeenKeys?: number; maxTombstones?: number; maxToolRecords?: number };

  constructor(options: { maxSeenKeys?: number; maxTombstones?: number; maxToolRecords?: number } = {}) {
    this.options = options;
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  bind(binding: ObservationBinding): ObservationBindingResult {
    const issues = validateBinding(binding);
    if (this.sessions.has(binding.runId)) issues.push('runId is already active');
    const prior = this.tombstones.get(binding.runId);
    if (prior && binding.epoch <= prior.binding.epoch) issues.push('epoch must increase when a runId is rebound');
    for (const active of this.sessions.values()) {
      if (active.binding.agentSessionId === binding.agentSessionId
        && active.binding.epoch === binding.epoch
        && active.binding.runId !== binding.runId) {
        issues.push('agentSessionId/epoch is already bound to another run');
      }
    }
    if (issues.length > 0) {
      return { schema: VG_OBSERVATION_BINDING_SCHEMA, status: 'rejected_by_policy', binding: null, issues, host_verdict: 'unchanged' };
    }
    const session: ActiveSession = {
      binding: { ...binding, boundAt: binding.boundAt ?? Date.now() },
      coverage: emptyCoverage(),
      knownGaps: [...DEFAULT_GAPS],
      surfaceCounts: emptySurfaceCounts(),
      eventCount: 0,
      duplicateCount: 0,
      staleCount: 0,
      rejectedCount: 0,
      seen: new BoundedKeySet(this.options.maxSeenKeys),
      activeCalls: new Map(),
      toolObservations: [],
      deliveredFeedback: new Set(),
      toolEventCount: 0,
      droppedCount: 0,
    };
    this.sessions.set(binding.runId, session);
    return {
      schema: VG_OBSERVATION_BINDING_SCHEMA,
      status: 'attached',
      binding: session.binding,
      issues: [],
      host_verdict: 'unchanged',
    };
  }

  ingest(event: ChatRuntimeEvent, context: ObservationContext = {}): ObservationIngestResult {
    const runId = optionalString((event as { runId?: unknown }).runId);
    if (!runId) return resultFor('rejected_by_policy', 'runtime event has no runId', ['missing_run_id']);
    const session = this.sessions.get(runId);
    if (!session) {
      const tombstone = this.tombstones.get(runId);
      if (tombstone) {
        const contextEpoch = context.epoch ?? tombstone.binding.epoch;
        return contextEpoch <= tombstone.binding.epoch
          ? resultFor('stale', 'event arrived after session detach', ['late_event_after_detach'])
          : resultFor('rejected_by_policy', 'event epoch has no active binding', ['unknown_session_epoch']);
      }
      return resultFor('rejected_by_policy', 'event run is not bound to a repo/worktree/session owner', ['unknown_owner']);
    }
    if (context.epoch !== undefined && context.epoch < session.binding.epoch) {
      session.staleCount += 1;
      return resultFor('stale', 'event epoch is older than the active session', ['stale_epoch'], session);
    }
    if (context.epoch !== undefined && context.epoch > session.binding.epoch) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'event epoch is newer than the active session', ['unknown_session_epoch'], session);
    }
    if (context.ownerId !== undefined && context.ownerId !== session.binding.ownerId) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'event owner does not match the bound owner', ['identity_mismatch'], session);
    }
    if (event.sessionKey && session.binding.sessionKey && event.sessionKey !== session.binding.sessionKey) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'event sessionKey does not match the bound session', ['identity_mismatch'], session);
    }

    const key = eventKey(event, context);
    if (!session.seen.add(key)) {
      session.duplicateCount += 1;
      return resultFor('duplicate', 'event was already applied', ['duplicate_event'], session, null, key);
    }
    const mapped = mapRuntimeEvent(event);
    if (!mapped) {
      session.knownGaps.push(`unsupported runtime event: ${event.type}`);
      return resultFor('unobserved', 'runtime event has no declared VG behaviour mapping', ['unsupported_runtime_event'], session, null, key);
    }

    const observedAt = context.observedAt ?? event.ts ?? Date.now();
    const issues: string[] = [];
    let startedAt = observedAt;
    let endedAt: number | null = null;
    let coverage = mapped.descriptor.coverage;
    if (event.type === 'tool.completed') {
      const call = session.activeCalls.get(event.toolCallId);
      if (call) {
        mapped.descriptor = call.descriptor;
        mapped.operation = call.descriptor.operation;
        startedAt = call.startedAt;
        endedAt = observedAt;
        session.activeCalls.delete(event.toolCallId);
      } else {
        issues.push('missing_tool_start_event');
        endedAt = observedAt;
        coverage = coverage === 'host-event' ? 'partial' : coverage;
      }
    } else if (event.type === 'tool.started') {
      session.activeCalls.set(event.toolCallId, { descriptor: mapped.descriptor, startedAt: observedAt });
    } else if (mapped.status !== 'started') {
      endedAt = observedAt;
    }

    const dedupeHash = sha256(key);
    const behaviorEvent: VerseGitBehaviorEvent = {
      schema: VG_OBSERVATION_SCHEMA,
      eventId: `vge_${dedupeHash.slice(0, 24)}`,
      runId,
      traceId: context.traceId ?? session.binding.traceId,
      requestId: context.requestId ?? session.binding.requestId ?? null,
      agentSessionId: session.binding.agentSessionId,
      vgSessionId: session.binding.vgSessionId,
      repoId: session.binding.repoId,
      worktreeId: session.binding.worktreeId,
      ownerId: session.binding.ownerId,
      actor: session.binding.actor,
      epoch: session.binding.epoch,
      source: 'chat-runtime',
      sourceEventType: event.type,
      surface: mapped.descriptor.surface,
      operation: mapped.operation,
      effect: mapped.descriptor.effect,
      status: mapped.status,
      coverage,
      evidence: { grade: 'normalized-event', ref: context.artifactRef ?? null },
      inputDigest: digestOf(mapped.input),
      outputDigest: digestOf(mapped.output),
      startedAt: toIso(startedAt),
      endedAt: endedAt === null ? null : toIso(endedAt),
      durationMs: endedAt === null ? null : Math.max(0, endedAt - startedAt),
      reason: mapped.reason ?? issues[0] ?? null,
    };
    applyCoverage(session.coverage, { ...mapped.descriptor, coverage });
    session.surfaceCounts[mapped.descriptor.surface] += 1;
    session.eventCount += 1;
    const status = coverage === 'unobserved'
      ? 'unobserved'
      : coverage === 'partial' || issues.length > 0
        ? 'partial'
        : 'observed';
    return resultFor(status, issues.length > 0 ? 'event emitted with declared coverage gaps' : 'event emitted', issues, session, behaviorEvent, key);
  }

  ingestToolObservation(
    request: VerseGitToolObservationRequest,
    context: ObservationContext = {},
  ): ObservationIngestResult {
    if (request.schema !== 'clawx.versegit.tool-observation-request/v1') {
      return resultFor('rejected_by_policy', 'tool observation schema mismatch', ['schema_mismatch']);
    }
    const runId = optionalString(request.childRunId);
    if (!runId) return resultFor('rejected_by_policy', 'tool observation has no childRunId', ['missing_run_id']);
    const session = this.sessions.get(runId);
    if (!session) {
      const tombstone = this.tombstones.get(runId);
      if (tombstone) {
        return context.epoch === undefined || context.epoch <= tombstone.binding.epoch
          ? resultFor('stale', 'tool observation arrived after session detach', ['late_tool_observation_after_detach'])
          : resultFor('rejected_by_policy', 'tool observation epoch has no active binding', ['unknown_session_epoch']);
      }
      return resultFor('rejected_by_policy', 'tool observation run is not bound', ['unknown_owner']);
    }
    if (context.epoch !== undefined && context.epoch < session.binding.epoch) {
      session.staleCount += 1;
      return resultFor('stale', 'tool observation epoch is older than the active session', ['stale_epoch'], session);
    }
    if ((context.epoch !== undefined && context.epoch !== session.binding.epoch)
      || request.epoch !== session.binding.epoch) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'tool observation epoch does not match the active session', ['identity_mismatch'], session);
    }
    if ((context.ownerId !== undefined && context.ownerId !== session.binding.ownerId)
      || request.ownerId !== session.binding.ownerId) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'tool observation owner does not match the active session', ['identity_mismatch'], session);
    }
    if (!session.binding.bindingId || request.bindingId !== session.binding.bindingId) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'tool observation binding does not match the active session', ['binding_mismatch'], session);
    }
    if (!isOpaqueId(request.toolCallId) || !isOpaqueId(request.toolName)) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'tool call identity is invalid', ['invalid_tool_identity'], session);
    }
    if (!isSha256(request.inputDigest.replace(/^sha256:/u, '')) || !isSha256(request.outputDigest.replace(/^sha256:/u, ''))) {
      session.rejectedCount += 1;
      return resultFor('rejected_by_policy', 'tool observation digest is invalid', ['invalid_digest'], session);
    }

    const key = `tool:${request.toolCallId}:${request.inputDigest}:${request.outputDigest}`;
    if (!session.seen.add(key)) {
      session.duplicateCount += 1;
      return resultFor('duplicate', 'tool observation was already applied', ['duplicate_tool_observation'], session, null, key);
    }

    const descriptor = classifyToolSurface(request.toolName, request.args);
    const observedAtMsRaw = Date.parse(request.observedAt);
    const observedAtMs = Number.isFinite(observedAtMsRaw) ? observedAtMsRaw : context.observedAt ?? Date.now();
    const issues: string[] = [];
    let coverage = descriptor.coverage;
    let path: string | null = null;
    let lineStart: number | null = null;
    let lineEnd: number | null = null;
    const basis = request.basis ?? null;

    if (descriptor.surface === 'file.read' || descriptor.surface === 'file.write') {
      if (!session.binding.worktreePath) {
        issues.push('worktree_path_unavailable');
        coverage = 'partial';
      } else {
        const argPath = optionalString(request.args.path ?? request.args.file_path);
        const basisPath = basis ? optionalString(basis.path) : null;
        const normalizedArgPath = argPath
          ? normalizeObservedPath(session.binding.worktreePath, request.cwd, argPath)
          : null;
        const normalizedBasisPath = basisPath
          ? normalizeObservedPath(session.binding.worktreePath, request.cwd, basisPath)
          : null;
        path = normalizedBasisPath ?? normalizedArgPath;
        if (!path) {
          issues.push('path_outside_bound_worktree');
          coverage = 'partial';
        }
        if (normalizedArgPath && normalizedBasisPath && normalizedArgPath !== normalizedBasisPath) {
          issues.push('path_scope_mismatch');
          coverage = 'partial';
        }
      }
      if (!basis) {
        issues.push('basis_missing');
        coverage = 'partial';
      } else {
        const expectedKind = descriptor.surface === 'file.read' ? 'read' : ['write', 'edit'];
        if (expectedKind === 'read' ? basis.kind !== 'read' : !expectedKind.includes(basis.kind)) {
          issues.push('basis_kind_mismatch');
          coverage = 'partial';
        }
        if (!Number.isInteger(basis.lineStart) || !Number.isInteger(basis.lineEnd)
          || basis.lineStart < 1 || basis.lineEnd < basis.lineStart) {
          issues.push('basis_range_invalid');
          coverage = 'partial';
        } else {
          lineStart = basis.lineStart;
          lineEnd = basis.lineEnd;
        }
        if (basis.kind === 'read') {
          if (!isSha256(basis.fileSha256) || !isSha256(basis.rangeSha256)) {
            issues.push('read_basis_digest_missing');
            coverage = 'partial';
          }
        } else if (!isSha256(basis.afterSha256)) {
          issues.push('write_basis_digest_missing');
          coverage = 'partial';
        }
      }
      if (request.status !== 'succeeded') {
        issues.push('tool_not_succeeded');
        coverage = 'partial';
      } else if (issues.length === 0 && basis && path) {
        coverage = 'direct';
      }
    } else if (basis) {
      issues.push('basis_on_non_file_tool');
      coverage = 'partial';
    }

    const dedupeHash = sha256(key);
    const behaviorEvent: VerseGitBehaviorEvent = {
      schema: VG_OBSERVATION_SCHEMA,
      eventId: `vge_${dedupeHash.slice(0, 24)}`,
      runId,
      traceId: context.traceId ?? session.binding.traceId,
      requestId: context.requestId ?? session.binding.requestId ?? null,
      agentSessionId: session.binding.agentSessionId,
      vgSessionId: session.binding.vgSessionId,
      repoId: session.binding.repoId,
      worktreeId: session.binding.worktreeId,
      ownerId: session.binding.ownerId,
      actor: session.binding.actor,
      epoch: session.binding.epoch,
      source: 'tool-middleware',
      sourceEventType: 'tool.result',
      surface: descriptor.surface,
      operation: descriptor.operation,
      effect: descriptor.effect,
      status: request.status,
      coverage,
      evidence: { grade: basis ? 'direct-receipt' : 'normalized-event', ref: null },
      inputDigest: request.inputDigest,
      outputDigest: request.outputDigest,
      startedAt: toIso(observedAtMs),
      endedAt: toIso(observedAtMs),
      durationMs: 0,
      reason: issues[0] ?? descriptor.reason,
      ...(path ? { path } : {}),
      ...(lineStart !== null ? { lineStart } : {}),
      ...(lineEnd !== null ? { lineEnd } : {}),
      ...(basis ? { basis } : {}),
    };

    session.eventCount += 1;
    session.toolEventCount += 1;
    session.surfaceCounts[descriptor.surface] += 1;
    if (request.status === 'succeeded') {
      applyCoverage(session.coverage, { ...descriptor, coverage });
    }
    session.toolObservations.push({
      event: behaviorEvent,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      observedAtMs,
      basis,
    });
    const maxToolRecords = this.options.maxToolRecords ?? 2_000;
    while (session.toolObservations.length > maxToolRecords) {
      session.toolObservations.shift();
      session.droppedCount += 1;
    }
    if (session.droppedCount > 0) {
      const gap = `bounded_tool_observation_queue_dropped:${session.droppedCount}`;
      if (!session.knownGaps.includes(gap)) session.knownGaps.push(gap);
    }
    const status = coverage === 'unobserved'
      ? 'unobserved'
      : coverage === 'partial' || issues.length > 0
        ? 'partial'
        : 'observed';
    let feedback: VerseGitFeedbackDelivery | undefined;
    if (request.status === 'succeeded' && descriptor.surface === 'file.write' && path) {
      const finding = this.staleReadFindings().find(
        (candidate) => candidate.writeEventId === behaviorEvent.eventId,
      );
      if (finding && !session.deliveredFeedback.has(finding.findingId)) {
        session.deliveredFeedback.add(finding.findingId);
        feedback = {
          schema: VG_FEEDBACK_SCHEMA,
          evidenceId: finding.findingId,
          message: `[VerseGit risk evidence_id=${finding.findingId} binding_id=${session.binding.bindingId} child_run_id=${runId} tool_call_id=${request.toolCallId} coverage=${coverage} basis=sha256:${finding.readBasisSha256} candidate=none] ${finding.kind}: ${finding.path}:${finding.readRange.lineStart}-${finding.readRange.lineEnd} was read before a different session wrote ${finding.writeRange.lineStart}-${finding.writeRange.lineEnd}. Re-read current content before relying on the earlier basis. host_verdict=unchanged.`,
          coverage,
          basisDigest: `sha256:${finding.readBasisSha256}`,
          candidateId: null,
          path: finding.path,
          lineStart: finding.readRange.lineStart,
          lineEnd: finding.readRange.lineEnd,
        };
      }
    }
    const result = resultFor(
      status,
      issues.length > 0 ? 'tool observation emitted with declared basis gaps' : 'tool observation emitted',
      issues,
      session,
      behaviorEvent,
      key,
    );
    return feedback ? { ...result, feedback } : result;
  }

  recentToolObservations(runId?: string, limit = 200): Array<{
    runId: string;
    event: VerseGitBehaviorEvent;
    toolCallId: string;
    toolName: string;
    basis: VerseGitToolBasis | null;
  }> {
    const sessions = runId ? [this.sessions.get(runId)].filter(Boolean) as ActiveSession[] : [...this.sessions.values()];
    return sessions
      .flatMap((session) => session.toolObservations.map((record) => ({
        runId: session.binding.runId,
        event: { ...record.event },
        toolCallId: record.toolCallId,
        toolName: record.toolName,
        basis: record.basis ? { ...record.basis } : null,
      })))
      .sort((left, right) => left.event.startedAt.localeCompare(right.event.startedAt))
      .slice(-Math.max(1, limit));
  }

  staleReadFindings(limit = 200): VerseGitStaleReadFinding[] {
    const records = [...this.sessions.values()].flatMap((session) => session.toolObservations);
    const findings: VerseGitStaleReadFinding[] = [];
    for (const read of records) {
      if (read.event.surface !== 'file.read' || read.event.status !== 'succeeded') continue;
      const readBasis = read.basis;
      if (!readBasis || !isSha256(readBasis.fileSha256) || !read.event.path
        || typeof read.event.lineStart !== 'number' || typeof read.event.lineEnd !== 'number') continue;
      for (const write of records) {
        if (write.event.surface !== 'file.write' || write.event.status !== 'succeeded') continue;
        if (write.event.path !== read.event.path || write.observedAtMs <= read.observedAtMs) continue;
        if (write.event.agentSessionId === read.event.agentSessionId) continue;
        const writeBasis = write.basis;
        if (!writeBasis || !isSha256(writeBasis.afterSha256)) continue;
        if (typeof write.event.lineStart !== 'number' || typeof write.event.lineEnd !== 'number') continue;
        if (!rangesOverlap(
          { lineStart: read.event.lineStart, lineEnd: read.event.lineEnd },
          { lineStart: write.event.lineStart, lineEnd: write.event.lineEnd },
        )) continue;
        const refreshed = records.some((candidate) =>
          candidate.event.surface === 'file.read'
          && candidate.event.status === 'succeeded'
          && candidate.event.agentSessionId === read.event.agentSessionId
          && candidate.event.path === read.event.path
          && candidate.observedAtMs > write.observedAtMs
          && candidate.basis?.fileSha256 === writeBasis.afterSha256
        );
        if (refreshed) continue;
        findings.push({
          schema: 'clawx.versegit.stale-read-finding/v1',
          findingId: `vgf_${sha256(`${read.event.eventId}:${write.event.eventId}`).slice(0, 24)}`,
          kind: isApiDriftPath(read.event.path) ? 'api-drift' : 'stale-read',
          path: read.event.path,
          readEventId: read.event.eventId,
          writeEventId: write.event.eventId,
          readerSessionId: read.event.agentSessionId,
          writerSessionId: write.event.agentSessionId,
          readRange: { lineStart: read.event.lineStart, lineEnd: read.event.lineEnd },
          writeRange: { lineStart: write.event.lineStart, lineEnd: write.event.lineEnd },
          readBasisSha256: readBasis.fileSha256,
          writeBeforeSha256: writeBasis.beforeSha256 ?? null,
          writeAfterSha256: writeBasis.afterSha256,
          observedAt: write.event.endedAt ?? write.event.startedAt,
          host_verdict: 'unchanged',
        });
      }
    }
    return [...new Map(findings.map((finding) => [finding.findingId, finding])).values()]
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .slice(0, Math.max(1, limit));
  }

  snapshot(runId: string): ObservationCoverageSnapshot | null {
    const session = this.sessions.get(runId);
    return session ? toSnapshot(session) : null;
  }

  detach(runId: string, options: { epoch?: number; ownerId?: string; reason?: string; at?: number } = {}): ObservationSealResult {
    const session = this.sessions.get(runId);
    if (!session) {
      const tombstone = this.tombstones.get(runId);
      if (tombstone) {
        return {
          schema: VG_OBSERVATION_SEAL_SCHEMA, status: 'stale', why: 'session was already detached',
          runId, coverage: null, sessionEnd: null, issues: ['duplicate_detach'], host_verdict: 'unchanged',
        };
      }
      return {
        schema: VG_OBSERVATION_SEAL_SCHEMA, status: 'rejected_by_policy', why: 'session is not bound',
        runId, coverage: null, sessionEnd: null, issues: ['unknown_owner'], host_verdict: 'unchanged',
      };
    }
    if (options.epoch !== undefined && options.epoch < session.binding.epoch) {
      session.staleCount += 1;
      return {
        schema: VG_OBSERVATION_SEAL_SCHEMA, status: 'stale', why: 'detach epoch is older than the active session',
        runId, coverage: null, sessionEnd: null, issues: ['stale_epoch'], host_verdict: 'unchanged',
      };
    }
    if (options.epoch !== undefined && options.epoch !== session.binding.epoch) {
      session.rejectedCount += 1;
      return {
        schema: VG_OBSERVATION_SEAL_SCHEMA, status: 'rejected_by_policy', why: 'detach epoch does not match the active session',
        runId, coverage: null, sessionEnd: null, issues: ['identity_mismatch'], host_verdict: 'unchanged',
      };
    }
    if (options.ownerId !== undefined && options.ownerId !== session.binding.ownerId) {
      session.rejectedCount += 1;
      return {
        schema: VG_OBSERVATION_SEAL_SCHEMA, status: 'rejected_by_policy', why: 'detach owner does not match the bound owner',
        runId, coverage: null, sessionEnd: null, issues: ['identity_mismatch'], host_verdict: 'unchanged',
      };
    }
    const at = options.at ?? Date.now();
    const coverage = toSnapshot(session);
    const inputDigest = digestOf(session.binding);
    const outputDigest = digestOf({ coverage, reason: options.reason ?? 'session_detached' });
    const sessionEnd: VerseGitBehaviorEvent = {
      schema: VG_OBSERVATION_SCHEMA,
      eventId: `vge_${sha256(`${runId}:session.end:${session.binding.epoch}`).slice(0, 24)}`,
      runId,
      traceId: session.binding.traceId,
      requestId: session.binding.requestId ?? null,
      agentSessionId: session.binding.agentSessionId,
      vgSessionId: session.binding.vgSessionId,
      repoId: session.binding.repoId,
      worktreeId: session.binding.worktreeId,
      ownerId: session.binding.ownerId,
      actor: session.binding.actor,
      epoch: session.binding.epoch,
      source: 'chat-runtime',
      sourceEventType: 'session.detach',
      surface: 'control',
      operation: 'session.end',
      effect: 'none',
      status: 'succeeded',
      coverage: 'host-event',
      evidence: { grade: 'normalized-event', ref: null },
      inputDigest,
      outputDigest,
      startedAt: toIso(session.binding.boundAt ?? at),
      endedAt: toIso(at),
      durationMs: Math.max(0, at - (session.binding.boundAt ?? at)),
      reason: options.reason ?? 'session_detached',
    };
    this.sessions.delete(runId);
    this.tombstones.set(runId, { binding: session.binding, detachedAt: at });
    this.tombstoneOrder.push(runId);
    while (this.tombstoneOrder.length > (this.options.maxTombstones ?? 1024)) {
      const oldest = this.tombstoneOrder.shift();
      if (oldest !== undefined) this.tombstones.delete(oldest);
    }
    return {
      schema: VG_OBSERVATION_SEAL_SCHEMA,
      status: 'detached',
      why: 'session observations sealed before host cleanup',
      runId,
      coverage,
      sessionEnd,
      issues: [],
      host_verdict: 'unchanged',
    };
  }

}