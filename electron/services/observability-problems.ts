import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ObservabilityTraceIndexEntry,
  ObservabilityTraceIssue,
  ObservabilityTraceIssueSeverity,
} from '../../shared/types/observability';
import { truncatePreview } from './observability-redaction';

const PROBLEM_SCHEMA = 'ObservabilityProblemManifest/v1';
const EVIDENCE_SCHEMA = 'ObservabilityProblemEvidence/v1';
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVIDENCE_ITEMS = 32;

export type ObservabilityProblemState = 'pending' | 'open' | 'mitigated' | 'closed';

export type ObservabilityProblemEvidence = {
  sourceEventId: string;
  traceId: string;
  observedAt: number;
  severity: ObservabilityTraceIssueSeverity;
  category: ObservabilityTraceIssue['category'];
  title: string;
  detail?: string;
  refs: string[];
};

export type ObservabilityProblemTimelineEntry = {
  at: number;
  state: ObservabilityProblemState;
  event: 'observed' | 'state-transition' | 'reopened';
  sourceEventIds: string[];
};

export type ObservabilityProblemCandidate = {
  problemId: string;
  signature: string;
  fingerprint: string;
  state: ObservabilityProblemState;
  severity: ObservabilityTraceIssueSeverity;
  category: ObservabilityTraceIssue['category'];
  title: string;
  model?: string;
  provider?: string;
  toolName?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  distinctTraceCount: number;
  sourceEventIds: string[];
  evidence: ObservabilityProblemEvidence[];
  timeline: ObservabilityProblemTimelineEntry[];
};

export type ObservabilityProblemSnapshot = {
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  scannedTraces: number;
  scannedIssues: number;
  deduplicatedIssues: number;
  promotedProblems: number;
  pendingSignatures: number;
  problems: ObservabilityProblemCandidate[];
};

export type ObservabilityProblemStateOverride = {
  state: ObservabilityProblemState;
  rootCause?: string;
  prevention?: string;
  resolution?: string;
};

export type ObservabilityProblemManifest = {
  schema: typeof PROBLEM_SCHEMA;
  generatedAt: string;
  driven_by: 'agent';
  actor: string;
  problemId: string;
  signature: string;
  fingerprint: string;
  state: ObservabilityProblemState;
  severity: ObservabilityTraceIssueSeverity;
  category: ObservabilityTraceIssue['category'];
  title: string;
  model?: string;
  provider?: string;
  toolName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  distinctTraceCount: number;
  sourceEventIds: string[];
  evidenceRefs: string[];
  rootCause?: string;
  prevention?: string;
  resolution?: string;
  timeline: ObservabilityProblemTimelineEntry[];
  redaction: 'bounded-and-reference-only';
};

export type ObservabilityProblemExportResult = {
  outputDir: string;
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  scannedTraces: number;
  scannedIssues: number;
  deduplicatedIssues: number;
  promotedProblems: number;
  pendingSignatures: number;
  artifacts: Array<{ problemId: string; directory: string; state: ObservabilityProblemState }>;
};

const SEVERITY_RANK: Record<ObservabilityTraceIssueSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

function severityMax(
  left: ObservabilityTraceIssueSeverity,
  right: ObservabilityTraceIssueSeverity,
): ObservabilityTraceIssueSeverity {
  return SEVERITY_RANK[left] >= SEVERITY_RANK[right] ? left : right;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function hashSignature(value: Record<string, string | undefined>): string {
  return createHash('sha256')
    .update(JSON.stringify({
      category: value.category,
      title: value.title,
      model: value.model,
      provider: value.provider,
      toolName: value.toolName,
    }))
    .digest('hex');
}

function toolNameFromIssue(issue: ObservabilityTraceIssue): string | undefined {
  const match = issue.evidence
    ?.join(' ')
    .match(/\b(?:tool|command)[:\s]+([A-Za-z0-9_.-]{1,80})/iu);
  return match?.[1]?.toLowerCase();
}

function evidenceRefs(entry: ObservabilityTraceIndexEntry, issue: ObservabilityTraceIssue): string[] {
  const refs = [
    `trace:${entry.id}`,
    ...(entry.runId ? [`run:${entry.runId}`] : []),
    ...(entry.correlation?.filePaths ?? []).slice(0, 4).map((path) => `file:${path}`),
    ...(issue.evidence ?? []).slice(0, 5).map((value) => truncatePreview(value, 180)).filter((value): value is string => Boolean(value)),
  ];
  return [...new Set(refs)].slice(0, 12);
}

function problemIdentity(entry: ObservabilityTraceIndexEntry, issue: ObservabilityTraceIssue): {
  fingerprint: string;
  signature: string;
  toolName?: string;
} {
  const toolName = toolNameFromIssue(issue);
  const fingerprint = hashSignature({
    category: issue.category,
    title: normalizeText(issue.title),
    model: normalizeText(entry.model),
    provider: normalizeText(entry.agent),
    toolName,
  });
  return {
    fingerprint,
    signature: `${issue.category}:${fingerprint}`,
    toolName,
  };
}

function promoteProblem(occurrenceCount: number, severity: ObservabilityTraceIssueSeverity): ObservabilityProblemState {
  if (severity === 'critical') return 'open';
  return occurrenceCount >= 2 ? 'open' : 'pending';
}

/**
 * Derive bounded cross-run Problems from the existing trace index. The input is
 * the already-sanitized index projection, so this function never needs raw
 * runtime logs or a second observability store.
 */
export function buildObservabilityProblemSnapshot(
  entries: readonly ObservabilityTraceIndexEntry[],
  options: { now?: number; windowMs?: number } = {},
): ObservabilityProblemSnapshot {
  const generatedAt = typeof options.now === 'number' && Number.isFinite(options.now)
    ? options.now
    : Date.now();
  const windowMs = typeof options.windowMs === 'number' && Number.isFinite(options.windowMs)
    ? Math.max(0, options.windowMs)
    : DEFAULT_WINDOW_MS;
  const windowStart = generatedAt - windowMs;
  const seenSourceEventIds = new Set<string>();
  const bySignature = new Map<string, ObservabilityProblemCandidate>();
  let scannedIssues = 0;

  for (const entry of entries) {
    const observedAt = Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : entry.startedAt ?? 0;
    if (observedAt < windowStart || observedAt > generatedAt) continue;

    for (const issue of entry.issues ?? []) {
      scannedIssues += 1;
      if (seenSourceEventIds.has(issue.id)) continue;
      seenSourceEventIds.add(issue.id);

      const identity = problemIdentity(entry, issue);
      let candidate = bySignature.get(identity.signature);
      if (!candidate) {
        candidate = {
          problemId: `problem:${identity.signature.slice(0, 32)}`,
          signature: identity.signature,
          fingerprint: identity.fingerprint,
          state: 'pending',
          severity: issue.severity,
          category: issue.category,
          title: issue.title,
          model: entry.model,
          provider: entry.agent,
          toolName: identity.toolName,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          occurrenceCount: 0,
          distinctTraceCount: 0,
          sourceEventIds: [],
          evidence: [],
          timeline: [],
        };
        bySignature.set(identity.signature, candidate);
      }

      const traceIds = new Set(candidate.evidence.map((evidence) => evidence.traceId));
      const firstDiagnosticInTrace = !traceIds.has(entry.id);
      candidate.occurrenceCount += firstDiagnosticInTrace ? 1 : 0;
      candidate.firstSeenAt = Math.min(candidate.firstSeenAt, observedAt);
      candidate.lastSeenAt = Math.max(candidate.lastSeenAt, observedAt);
      candidate.severity = severityMax(candidate.severity, issue.severity);
      candidate.sourceEventIds.push(issue.id);
      candidate.evidence.push({
        sourceEventId: issue.id,
        traceId: entry.id,
        observedAt,
        severity: issue.severity,
        category: issue.category,
        title: truncatePreview(issue.title, 180) ?? issue.title,
        ...(issue.detail ? { detail: truncatePreview(issue.detail, 280) } : {}),
        refs: evidenceRefs(entry, issue),
      });
      candidate.evidence = candidate.evidence.slice(-MAX_EVIDENCE_ITEMS);
      candidate.distinctTraceCount = traceIds.add(entry.id).size;
      candidate.timeline.push({
        at: observedAt,
        state: 'pending',
        event: 'observed',
        sourceEventIds: [issue.id],
      });
    }
  }

  const problems = [...bySignature.values()].map((candidate) => {
    const state = promoteProblem(candidate.occurrenceCount, candidate.severity);
    return {
      ...candidate,
      state,
      sourceEventIds: [...new Set(candidate.sourceEventIds)],
      evidence: candidate.evidence.toSorted((left, right) => right.observedAt - left.observedAt),
      timeline: candidate.timeline.toSorted((left, right) => left.at - right.at),
    };
  }).toSorted((left, right) => (
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
    || right.lastSeenAt - left.lastSeenAt
    || left.problemId.localeCompare(right.problemId)
  ));

  return {
    generatedAt,
    windowStart,
    windowEnd: generatedAt,
    scannedTraces: entries.length,
    scannedIssues,
    deduplicatedIssues: seenSourceEventIds.size,
    promotedProblems: problems.filter((problem) => problem.state !== 'pending').length,
    pendingSignatures: problems.filter((problem) => problem.state === 'pending').length,
    problems,
  };
}

function safeDirectoryName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/gu, '-').slice(0, 120);
}

function evidenceRefsForManifest(candidate: ObservabilityProblemCandidate): string[] {
  return [...new Set(candidate.evidence.flatMap((evidence) => evidence.refs))].slice(0, 64);
}

async function readPreviousManifest(path: string): Promise<ObservabilityProblemManifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<ObservabilityProblemManifest>;
    if (parsed.schema !== PROBLEM_SCHEMA || typeof parsed.problemId !== 'string') return undefined;
    return parsed as ObservabilityProblemManifest;
  } catch {
    return undefined;
  }
}

function mergeTimeline(
  previous: ObservabilityProblemManifest | undefined,
  candidate: ObservabilityProblemCandidate,
  state: ObservabilityProblemState,
  stateChanged: boolean,
): ObservabilityProblemTimelineEntry[] {
  const previousTimeline = previous?.timeline ?? [];
  const previousSourceIds = new Set(previous?.sourceEventIds ?? []);
  const observed = candidate.evidence
    .filter((evidence) => !previousSourceIds.has(evidence.sourceEventId))
    .map((evidence) => ({
      at: evidence.observedAt,
      state,
      event: 'observed' as const,
      sourceEventIds: [evidence.sourceEventId],
    }));
  const reopened = previous?.state === 'closed' && candidate.occurrenceCount > 0
    ? [{ at: candidate.lastSeenAt, state: 'open' as const, event: 'reopened' as const, sourceEventIds: [] }]
    : [];
  const transition = stateChanged
    ? [{ at: candidate.lastSeenAt, state, event: 'state-transition' as const, sourceEventIds: [] }]
    : [];
  return [...previousTimeline, ...observed, ...reopened, ...transition]
    .toSorted((left, right) => left.at - right.at)
    .slice(-128);
}

function buildResolutionMarkdown(manifest: ObservabilityProblemManifest): string {
  const evidence = manifest.evidenceRefs.length > 0
    ? manifest.evidenceRefs.map((ref) => `- ${ref}`).join('\n')
    : '- No bounded evidence refs were available.';
  return [
    `# ${manifest.title}`,
    '',
    `- Problem: \`${manifest.problemId}\``,
    `- Signature: \`${manifest.signature}\``,
    `- State: \`${manifest.state}\``,
    `- Severity: \`${manifest.severity}\``,
    `- Category: \`${manifest.category}\``,
    `- Occurrences: ${manifest.occurrenceCount} across ${manifest.distinctTraceCount} trace(s)`,
    `- First seen: ${manifest.firstSeenAt}`,
    `- Last seen: ${manifest.lastSeenAt}`,
    `- Driven by: \`${manifest.driven_by}\` / \`${manifest.actor}\``,
    '',
    '## Root cause',
    manifest.rootCause ?? 'Not established from bounded evidence.',
    '',
    '## Prevention',
    manifest.prevention ?? 'No prevention action recorded.',
    '',
    '## Resolution',
    manifest.resolution ?? 'No resolution recorded.',
    '',
    '## Evidence',
    evidence,
    '',
    '## Timeline',
    ...manifest.timeline.map((entry) => `- ${new Date(entry.at).toISOString()} ${entry.event} -> ${entry.state}${entry.sourceEventIds.length ? ` (${entry.sourceEventIds.join(', ')})` : ''}`),
    '',
  ].join('\n');
}

/**
 * Idempotently export promoted Problems as manifest/evidence/resolution
 * artifacts. Repeated imports derive from the trace index rather than adding a
 * second occurrence counter.
 */
export async function exportObservabilityProblemArtifacts(input: {
  entries: readonly ObservabilityTraceIndexEntry[];
  outputDir: string;
  now?: number;
  windowMs?: number;
  actor?: string;
  stateOverrides?: Record<string, ObservabilityProblemStateOverride>;
}): Promise<ObservabilityProblemExportResult> {
  const snapshot = buildObservabilityProblemSnapshot(input.entries, {
    now: input.now,
    windowMs: input.windowMs,
  });
  const actor = input.actor?.trim() || 'codex-observability-agent';
  await mkdir(input.outputDir, { recursive: true });
  const artifacts: ObservabilityProblemExportResult['artifacts'] = [];

  for (const candidate of snapshot.problems) {
    if (candidate.state === 'pending') continue;
    const directory = join(input.outputDir, safeDirectoryName(candidate.problemId));
    await mkdir(directory, { recursive: true });
    const manifestPath = join(directory, 'manifest.json');
    const previous = await readPreviousManifest(manifestPath);
    const override = input.stateOverrides?.[candidate.problemId] ?? input.stateOverrides?.[candidate.signature];
    const previousLastSeenAt = previous ? Date.parse(previous.lastSeenAt) : Number.NaN;
    const hasNewOccurrence = Number.isFinite(previousLastSeenAt) && candidate.lastSeenAt > previousLastSeenAt;
    const state = override?.state
      ?? (previous?.state === 'closed' && hasNewOccurrence ? 'open' : previous?.state)
      ?? candidate.state;
    const stateChanged = Boolean(previous && previous.state !== state);
    const timeline = mergeTimeline(previous, candidate, state, stateChanged);
    const manifest: ObservabilityProblemManifest = {
      schema: PROBLEM_SCHEMA,
      generatedAt: new Date(snapshot.generatedAt).toISOString(),
      driven_by: 'agent',
      actor,
      problemId: candidate.problemId,
      signature: candidate.signature,
      fingerprint: candidate.fingerprint,
      state,
      severity: candidate.severity,
      category: candidate.category,
      title: candidate.title,
      ...(candidate.model ? { model: candidate.model } : {}),
      ...(candidate.provider ? { provider: candidate.provider } : {}),
      ...(candidate.toolName ? { toolName: candidate.toolName } : {}),
      firstSeenAt: new Date(candidate.firstSeenAt).toISOString(),
      lastSeenAt: new Date(candidate.lastSeenAt).toISOString(),
      occurrenceCount: candidate.occurrenceCount,
      distinctTraceCount: candidate.distinctTraceCount,
      sourceEventIds: candidate.sourceEventIds,
      evidenceRefs: evidenceRefsForManifest(candidate),
      ...(override?.rootCause ?? previous?.rootCause ? { rootCause: override?.rootCause ?? previous?.rootCause } : {}),
      ...(override?.prevention ?? previous?.prevention ? { prevention: override?.prevention ?? previous?.prevention } : {}),
      ...(override?.resolution ?? previous?.resolution ? { resolution: override?.resolution ?? previous?.resolution } : {}),
      timeline,
      redaction: 'bounded-and-reference-only',
    };
    const evidence = {
      schema: EVIDENCE_SCHEMA,
      generatedAt: manifest.generatedAt,
      problemId: candidate.problemId,
      signature: candidate.signature,
      driven_by: 'agent',
      actor,
      evidence: candidate.evidence,
      sourceEventIds: candidate.sourceEventIds,
      redaction: 'bounded-and-reference-only',
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(join(directory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await writeFile(join(directory, 'resolution.md'), buildResolutionMarkdown(manifest), 'utf8');
    artifacts.push({ problemId: candidate.problemId, directory, state });
  }

  return {
    outputDir: input.outputDir,
    generatedAt: snapshot.generatedAt,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    scannedTraces: snapshot.scannedTraces,
    scannedIssues: snapshot.scannedIssues,
    deduplicatedIssues: snapshot.deduplicatedIssues,
    promotedProblems: snapshot.promotedProblems,
    pendingSignatures: snapshot.pendingSignatures,
    artifacts,
  };
}