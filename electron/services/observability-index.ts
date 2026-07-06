import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import type {
  ObservabilityGraphNode,
  ObservabilityTrace,
  ObservabilityTraceCorrelation,
  ObservabilityTraceIndexEntry,
  ObservabilityTraceIssue,
  ObservabilityTraceQuery,
  ObservabilityTraceQueryFacet,
  ObservabilityTraceQueryResult,
  ObservabilityTraceSourceStatus,
  ObservabilityTokenUsage,
} from '../../shared/types/observability';
import { getDataDir } from '../utils/paths';
import { buildObservabilityTraceGraph } from './observability-graph';
import {
  isRecord,
  readString,
  sanitizeTraceForPersistence,
  truncatePreview,
} from './observability-redaction';

const INDEX_VERSION = 1;
const RETENTION_DAYS = 30;
const MAX_INDEX_TRACES = 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type PersistedTraceRecord = {
  version: number;
  updatedAt: number;
  entry: ObservabilityTraceIndexEntry;
  trace: ObservabilityTrace;
};

const entries = new Map<string, ObservabilityTraceIndexEntry>();
const traces = new Map<string, ObservabilityTrace>();
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();

function getIndexDir(): string {
  const override = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR?.trim();
  if (override) return override;
  if (process.env.VITEST) return join(tmpdir(), 'verse-claw-vitest-observability');
  return join(getDataDir(), 'observability');
}

function getIndexPath(): string {
  return join(getIndexDir(), 'trace-index.jsonl');
}

function emptyTokenUsage(): ObservabilityTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 };
}

function normalizeTrace(trace: ObservabilityTrace): ObservabilityTrace {
  return {
    ...trace,
    status: trace.status ?? 'completed',
    startedAt: trace.startedAt ?? Date.now(),
    updatedAt: trace.updatedAt ?? trace.endedAt ?? trace.startedAt ?? Date.now(),
    durationMs: trace.durationMs ?? Math.max(0, (trace.endedAt ?? Date.now()) - (trace.startedAt ?? Date.now())),
    spans: trace.spans ?? [],
    events: trace.events ?? [],
    tokenUsage: trace.tokenUsage ?? emptyTokenUsage(),
    metrics: trace.metrics ?? {},
    tags: trace.tags ?? [],
  };
}

function attrString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined;
  return readString(record[key]);
}

function collectFilePaths(trace: ObservabilityTrace): string[] {
  const paths = new Set<string>();
  const consider = (value: unknown) => {
    const path = readString(value);
    if (path) paths.add(path);
  };
  for (const span of trace.spans ?? []) {
    consider(attrString(span.attributes, 'path'));
    consider(attrString(span.attributes, 'filePath'));
    consider(attrString(span.attributes, 'workspaceRoot'));
    consider(attrString(span.attributes, 'workspacePath'));
    consider(attrString(span.attributes, 'cwd'));
  }
  for (const event of trace.events ?? []) {
    consider(attrString(event.attributes, 'path'));
    consider(attrString(event.attributes, 'filePath'));
    consider(attrString(event.attributes, 'workspaceRoot'));
    consider(attrString(event.attributes, 'workspacePath'));
    consider(attrString(event.attributes, 'cwd'));
  }
  return [...paths].sort();
}

function collectCorrelation(trace: ObservabilityTrace): ObservabilityTraceCorrelation {
  const filePaths = collectFilePaths(trace);
  const attrSources = [
    ...(trace.spans ?? []).map((span) => span.attributes),
    ...(trace.events ?? []).map((event) => event.attributes),
  ];
  const firstAttr = (key: string): string | undefined => {
    for (const source of attrSources) {
      const value = attrString(source, key);
      if (value) return value;
    }
    return undefined;
  };
  const taskLedgerNodeId = firstAttr('taskLedgerNodeId');
  const taskLedgerNodeIds = taskLedgerNodeId ? [taskLedgerNodeId] : undefined;
  return {
    traceId: trace.id,
    runId: trace.runId,
    sessionKey: trace.sessionKey,
    workspaceId: firstAttr('workspaceId'),
    taskLedgerNodeIds,
    clawGraphRunId: firstAttr('clawGraphRunId'),
    filePaths,
  };
}

function firstIssue(issues: ObservabilityTraceIssue[], categories: string[]): ObservabilityTraceIssue | undefined {
  return issues.find((issue) => categories.includes(issue.category));
}

function leadRole(trace: ObservabilityTrace): string | undefined {
  const orchestrator = (trace.spans ?? []).find((span) => span.kind === 'orchestrator');
  return attrString(orchestrator?.attributes, 'leadRole') ?? (trace.spans ?? []).find((span) => span.roleName)?.roleName;
}

function dominantModel(trace: ObservabilityTrace, nodes: ObservabilityGraphNode[]): string | undefined {
  return (trace.spans ?? []).find((span) => span.modelRef)?.modelRef
    ?? nodes.find((node) => node.modelRef)?.modelRef;
}

function nodeLabel(nodes: ObservabilityGraphNode[], nodeId?: string): string | undefined {
  if (!nodeId) return undefined;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  return node?.label;
}

export function buildObservabilityTraceIndexEntry(
  traceInput: ObservabilityTrace,
  options: { sourceStatus?: ObservabilityTraceSourceStatus } = {},
): { entry: ObservabilityTraceIndexEntry; trace: ObservabilityTrace } {
  const trace = normalizeTrace(sanitizeTraceForPersistence(normalizeTrace(traceInput)));
  const graph = buildObservabilityTraceGraph(trace, [], { sourceStatus: options.sourceStatus });
  const nodes = graph.graph.nodes;
  const issues = graph.graph.summary?.issues ?? [];
  const errorCount = nodes.filter((node) => node.status === 'error' || node.status === 'aborted' || node.kind === 'error').length;
  const toolCallCount = nodes.filter((node) => node.kind === 'tool' || node.phase === 'tool').length;
  const artifactCount = graph.graph.summary?.artifactNodeIds.length ?? 0;
  const warningCount = nodes.reduce((sum, node) => sum + (node.warningCount ?? 0), 0);
  const retryCount = nodes.reduce((sum, node) => sum + (node.retryCount ?? 0), 0);
  const approvalCount = nodes.filter((node) => node.kind === 'approval' || node.phase === 'approval').length;
  const slowestId = graph.graph.summary?.slowNodeIds[0];
  const firstError = firstIssue(issues, ['error-root-cause', 'command-failed', 'aborted']);
  const role = leadRole(trace);
  const entry: ObservabilityTraceIndexEntry = {
    id: trace.id,
    name: trace.name,
    status: trace.status,
    durationMs: trace.durationMs ?? 0,
    startedAt: trace.startedAt,
    updatedAt: trace.updatedAt ?? trace.endedAt ?? trace.startedAt,
    sourceStatus: graph.graph.summary?.sourceStatus ?? options.sourceStatus ?? 'live',
    sourceStatusUpdatedAt: Date.now(),
    costUsd: trace.tokenUsage.costUsd ?? 0,
    tokenCount: trace.tokenUsage.totalTokens ?? 0,
    spanCount: trace.spans.length,
    errorCount,
    toolCallCount,
    artifactCount,
    warningCount,
    retryCount,
    approvalCount,
    issueCount: issues.length,
    issues,
    firstError: truncatePreview(firstError?.detail ?? trace.error, 180),
    slowestNodeLabel: nodeLabel(nodes, slowestId),
    leadRole: role,
    agent: role,
    role,
    model: dominantModel(trace, nodes),
    sessionKey: trace.sessionKey,
    runId: trace.runId,
    hasToolCalls: toolCallCount > 0,
    hasArtifacts: artifactCount > 0,
    hasApproval: approvalCount > 0,
    hasRetries: retryCount > 0,
    hasWarnings: warningCount > 0,
    correlation: collectCorrelation(trace),
  };
  return { entry, trace };
}

function retentionCutoff(): number {
  return Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

function retainedRecords(): PersistedTraceRecord[] {
  const cutoff = retentionCutoff();
  return [...entries.values()]
    .filter((entry) => (entry.startedAt ?? entry.updatedAt) >= cutoff || entry.status === 'running')
    .sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0))
    .slice(0, MAX_INDEX_TRACES)
    .map((entry) => ({
      version: INDEX_VERSION,
      updatedAt: entry.updatedAt,
      entry,
      trace: traces.get(entry.id) ?? normalizeTrace({
        id: entry.id,
        name: entry.name,
        status: entry.status,
        startedAt: entry.startedAt ?? entry.updatedAt,
        updatedAt: entry.updatedAt,
        durationMs: entry.durationMs,
        spans: [],
        events: [],
        tokenUsage: { ...emptyTokenUsage(), totalTokens: entry.tokenCount, costUsd: entry.costUsd },
        metrics: {},
        tags: [],
      }),
    }));
}

async function writeIndex(): Promise<void> {
  const dir = getIndexDir();
  await mkdir(dir, { recursive: true });
  const records = retainedRecords();
  entries.clear();
  traces.clear();
  for (const record of records) {
    entries.set(record.entry.id, record.entry);
    traces.set(record.trace.id, record.trace);
  }
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  const path = getIndexPath();
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, body ? `${body}\n` : '', 'utf8');
  await rename(tmpPath, path);
}

function enqueueWrite(): Promise<void> {
  writeQueue = writeQueue.then(writeIndex, writeIndex).catch(() => undefined);
  return writeQueue;
}

function normalizeLoadedEntry(entry: ObservabilityTraceIndexEntry): ObservabilityTraceIndexEntry {
  const sourceStatus: ObservabilityTraceSourceStatus = entry.status === 'running' ? 'stale' : 'rehydrated';
  return {
    ...entry,
    sourceStatus,
    sourceStatusUpdatedAt: Date.now(),
    hasToolCalls: entry.hasToolCalls ?? entry.toolCallCount > 0,
    hasArtifacts: entry.hasArtifacts ?? entry.artifactCount > 0,
    hasApproval: entry.hasApproval ?? entry.approvalCount > 0,
    hasRetries: entry.hasRetries ?? entry.retryCount > 0,
    hasWarnings: entry.hasWarnings ?? entry.warningCount > 0,
    issueCount: entry.issueCount ?? entry.issues?.length ?? 0,
    issues: entry.issues ?? [],
    correlation: entry.correlation ?? { traceId: entry.id, runId: entry.runId, sessionKey: entry.sessionKey, filePaths: [] },
  };
}

export async function loadObservabilityIndex(): Promise<ObservabilityTraceIndexEntry[]> {
  if (loaded) return [...entries.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  loaded = true;
  entries.clear();
  traces.clear();
  let raw = '';
  try {
    raw = await readFile(getIndexPath(), 'utf8');
  } catch {
    return [];
  }
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as PersistedTraceRecord;
      if (record.version !== INDEX_VERSION || !record.entry?.id || !record.trace?.id) continue;
      const entry = normalizeLoadedEntry(record.entry);
      entries.set(entry.id, entry);
      traces.set(record.trace.id, normalizeTrace(record.trace));
    } catch {
      // Corrupt lines are ignored; the next write compacts the index.
    }
  }
  const retained = retainedRecords();
  if (retained.length !== entries.size) await enqueueWrite();
  return [...entries.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function persistObservabilityTraceToIndex(
  trace: ObservabilityTrace,
  options: { sourceStatus?: ObservabilityTraceSourceStatus } = {},
): Promise<ObservabilityTraceIndexEntry> {
  await loadObservabilityIndex();
  const { entry, trace: sanitizedTrace } = buildObservabilityTraceIndexEntry(trace, options);
  entries.set(entry.id, entry);
  traces.set(sanitizedTrace.id, sanitizedTrace);
  await enqueueWrite();
  return entry;
}

export async function persistObservabilityTracesToIndex(tracesInput: ObservabilityTrace[]): Promise<void> {
  for (const trace of tracesInput) {
    await persistObservabilityTraceToIndex(trace, { sourceStatus: trace.status === 'running' ? undefined : 'live' });
  }
}

export async function getIndexedObservabilityTrace(id: string): Promise<{ trace: ObservabilityTrace; entry: ObservabilityTraceIndexEntry } | null> {
  await loadObservabilityIndex();
  const trace = traces.get(id);
  const entry = entries.get(id);
  return trace && entry ? { trace, entry } : null;
}

function mergeMemoryEntries(memoryTraces: ObservabilityTrace[]): ObservabilityTraceIndexEntry[] {
  const merged = new Map(entries);
  for (const trace of memoryTraces) {
    const { entry } = buildObservabilityTraceIndexEntry(trace, { sourceStatus: trace.status === 'running' ? undefined : 'live' });
    merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

function valueMatches(value: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  return value?.toLowerCase() === expected.toLowerCase();
}

function matchesKeyword(entry: ObservabilityTraceIndexEntry, keyword: string | undefined): boolean {
  const needle = keyword?.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    entry.id,
    entry.name,
    entry.sessionKey,
    entry.runId,
    entry.leadRole,
    entry.agent,
    entry.role,
    entry.model,
    entry.firstError,
    entry.slowestNodeLabel,
    entry.sourceStatus,
    ...entry.issues.flatMap((issue) => [issue.category, issue.title, issue.detail, issue.recommendation]),
    ...(entry.correlation.filePaths ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

function matchesQuery(entry: ObservabilityTraceIndexEntry, query: ObservabilityTraceQuery): boolean {
  if (query.status && query.status !== 'all' && entry.status !== query.status) return false;
  if (query.from != null && (entry.startedAt ?? entry.updatedAt) < query.from) return false;
  if (query.to != null && (entry.startedAt ?? entry.updatedAt) > query.to) return false;
  if (!valueMatches(entry.agent, query.agent)) return false;
  if (!valueMatches(entry.role ?? entry.leadRole, query.role)) return false;
  if (!valueMatches(entry.model, query.model)) return false;
  if (!valueMatches(entry.sessionKey, query.sessionKey)) return false;
  if (!valueMatches(entry.runId, query.runId)) return false;
  if (query.hasErrors === true && entry.errorCount === 0 && entry.status !== 'error' && entry.status !== 'aborted') return false;
  if (query.hasErrors === false && (entry.errorCount > 0 || entry.status === 'error' || entry.status === 'aborted')) return false;
  if (query.hasToolCalls != null && entry.hasToolCalls !== query.hasToolCalls) return false;
  if (query.hasArtifacts != null && entry.hasArtifacts !== query.hasArtifacts) return false;
  if (query.hasApproval != null && entry.hasApproval !== query.hasApproval) return false;
  if (query.hasRetries != null && entry.hasRetries !== query.hasRetries) return false;
  if (query.hasWarnings != null && entry.hasWarnings !== query.hasWarnings) return false;
  return matchesKeyword(entry, query.keyword);
}

function facet(items: ObservabilityTraceIndexEntry[], read: (entry: ObservabilityTraceIndexEntry) => string | undefined): ObservabilityTraceQueryFacet[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = read(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([value, count]) => ({ value, count }));
}

function sortValue(entry: ObservabilityTraceIndexEntry, sortBy: NonNullable<ObservabilityTraceQuery['sortBy']>): number {
  switch (sortBy) {
    case 'durationMs':
      return entry.durationMs;
    case 'costUsd':
      return entry.costUsd;
    case 'tokenCount':
      return entry.tokenCount;
    case 'issueCount':
      return entry.issueCount;
    case 'startedAt':
      return entry.startedAt ?? 0;
    default:
      return entry.updatedAt ?? 0;
  }
}

export async function queryObservabilityTraces(
  query: ObservabilityTraceQuery = {},
  memoryTraces: ObservabilityTrace[] = [],
): Promise<ObservabilityTraceQueryResult> {
  await loadObservabilityIndex();
  const allItems = mergeMemoryEntries(memoryTraces);
  const filtered = allItems.filter((entry) => matchesQuery(entry, query));
  const sortBy = query.sortBy ?? 'updatedAt';
  const dir = query.sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => (sortValue(a, sortBy) - sortValue(b, sortBy)) * dir || a.id.localeCompare(b.id));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, query.page ?? 1);
  const start = (page - 1) * pageSize;
  return {
    generatedAt: Date.now(),
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    facets: {
      status: facet(allItems, (entry) => entry.status),
      agent: facet(allItems, (entry) => entry.agent),
      role: facet(allItems, (entry) => entry.role ?? entry.leadRole),
      model: facet(allItems, (entry) => entry.model),
      sourceStatus: facet(allItems, (entry) => entry.sourceStatus),
    },
  };
}

export async function clearObservabilityIndex(): Promise<void> {
  loaded = true;
  entries.clear();
  traces.clear();
  await mkdir(getIndexDir(), { recursive: true });
  await unlink(getIndexPath()).catch(() => undefined);
}

export function resetObservabilityIndexForTests(): void {
  loaded = false;
  entries.clear();
  traces.clear();
  writeQueue = Promise.resolve();
}

export function unsafeParseIndexRecordForTests(value: unknown): PersistedTraceRecord | null {
  if (!isRecord(value) || !isRecord(value.entry) || !isRecord(value.trace)) return null;
  return value as PersistedTraceRecord;
}
