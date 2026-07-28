import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import type {
  CodeReviewCreateTaskLedgerNodePayload,
  CodeReviewRunPayload,
} from '@shared/host-api/contract';
import type {
  CodeReviewDiffStats,
  CodeReviewFinding,
  CodeReviewRun,
  CodeReviewSeverity,
  CodeReviewTarget,
  CodeReviewTargetSummary,
} from '@shared/types/code-review';
import type { GitPatchArtifactV1, RemoteForgeErrorCode, RemoteForgeErrorV1 } from '@shared/types/remote-forge';
import { adaptUnifiedDiffToGitPatchArtifacts } from '@shared/remote-forge/unified-diff-adapter';
import { createRemoteForgeErrorV1 } from '@shared/remote-forge/error-envelope';
import type {
  ObservabilityTokenUsage,
  ObservabilityTrace,
} from '@shared/types/observability';
import type {
  TaskLedgerEvidenceRef,
  TaskLedgerNode,
} from '@shared/types/task-ledger';
import type { WorkspaceProfile } from '@shared/types/workspace';
import { isRecord } from './payload-utils';
import { readCurrentGitStatus } from './git-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { isPathInsideWorkspace, requireWorkspace } from './workspace-permissions';
import { appendTaskLedgerEvents } from './task-ledger-service';
import { upsertObservabilityTrace } from './observability-service';
import { redactSecrets } from '@openclaw/runtime-redaction';

type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type RepoContext = {
  workspace: WorkspaceProfile;
  workspaceRoot: string;
  repoRoot: string;
};

type ReviewDiffBundle = {
  target: CodeReviewTargetSummary;
  patch: string;
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
  files: string[];
  stats: CodeReviewDiffStats;
  evidenceRefs: TaskLedgerEvidenceRef[];
};

type RuntimeReviewOutput = {
  modelRunId?: string;
  sessionKey?: string;
  text?: string;
};

const MAX_PATCH_CHARS = 120_000;
const DEFAULT_REVIEW_TIMEOUT_MS = 120_000;
const SEVERITY_ORDER: Record<CodeReviewSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const reviewRuns = new Map<string, CodeReviewRun>();

class CodeReviewSafeError extends Error {
  constructor(readonly envelope: RemoteForgeErrorV1) {
    super(envelope.safeMessage);
  }
}

function safeReviewError(code: RemoteForgeErrorCode, requestId: string): CodeReviewSafeError {
  return new CodeReviewSafeError(createRemoteForgeErrorV1({ code, requestId }));
}

function trimOutput(value: string, limit = MAX_PATCH_CHARS): {
  text: string;
  adapterText: string;
  truncated: boolean;
} {
  if (value.length <= limit) return { text: value, adapterText: value, truncated: false };
  const adapterText = value.slice(0, limit);
  return { text: `${adapterText}\n[patch truncated]`, adapterText, truncated: true };
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyTokenUsage(): ObservabilityTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 };
}

function git(args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolveResult) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const exitCode = error && typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : error ? 1 : 0;
      resolveResult({
        exitCode,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
      });
    });
  });
}

async function requireRepoContext(): Promise<RepoContext> {
  const workspace = requireWorkspace(await getActiveWorkspaceProfile());
  const workspaceRoot = resolve(workspace.rootPath);
  const repo = await git(['rev-parse', '--show-toplevel'], workspaceRoot);
  if (repo.exitCode !== 0 || !repo.stdout.trim()) {
    throw new Error(repo.stderr.trim() || 'Active workspace is not a Git repository');
  }
  const repoRoot = resolve(repo.stdout.trim());
  return { workspace, workspaceRoot, repoRoot };
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveRepoPath(ctx: RepoContext, rawPath: string): { absolutePath: string; gitPath: string } {
  const absolutePath = resolve(isAbsolute(rawPath) ? rawPath : join(ctx.repoRoot, rawPath));
  if (!isPathInsideWorkspace(absolutePath, ctx.workspaceRoot)) {
    throw new Error('Code review path must stay inside the active workspace');
  }
  return {
    absolutePath,
    gitPath: toPosixPath(relative(ctx.repoRoot, absolutePath)),
  };
}

function syntheticUntrackedPatch(gitPath: string, content: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const body = lines.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    body,
  ].filter((line, index) => index < 5 || line.length > 0).join('\n');
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function diffStatsFromPatch(patch: string, truncated: boolean): CodeReviewDiffStats {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split(/\r?\n/)) {
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffMatch?.[2]) files.add(diffMatch[2]);
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }

  return {
    files: files.size,
    additions,
    deletions,
    patchBytes: Buffer.byteLength(patch, 'utf8'),
    truncated,
  };
}

function projectReviewPatch(
  patch: string,
  truncated: boolean,
  requestId: string,
): { patchArtifacts: GitPatchArtifactV1[]; patchArtifactError?: RemoteForgeErrorV1 } {
  if (!patch.trim()) return { patchArtifacts: [] };
  const adapted = adaptUnifiedDiffToGitPatchArtifacts({
    patch,
    sourceCompleteness: truncated ? 'truncated' : 'complete',
  });
  if (adapted.kind === 'unavailable') {
    return {
      patchArtifacts: [],
      patchArtifactError: createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }),
    };
  }
  const unavailable = adapted.artifacts.find((artifact) => artifact.completeness === 'unavailable');
  return {
    patchArtifacts: adapted.artifacts,
    ...(unavailable?.message
      ? { patchArtifactError: createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }) }
      : {}),
  };
}

function filesFromArtifacts(artifacts: GitPatchArtifactV1[]): string[] {
  return [...new Set(artifacts.map((artifact) => artifact.file))]
    .sort((left, right) => left.localeCompare(right));
}

function evidenceRefsForFiles(files: string[]): TaskLedgerEvidenceRef[] {
  return files.slice(0, 30).map((file) => ({
    type: 'file',
    ref: file,
    label: file,
  }));
}

async function collectUncommittedDiff(ctx: RepoContext, requestId: string): Promise<ReviewDiffBundle> {
  const status = await readCurrentGitStatus();
  const staged = await git(['diff', '--cached'], ctx.workspaceRoot);
  const unstaged = await git(['diff'], ctx.workspaceRoot);
  if (staged.exitCode !== 0) throw new Error(staged.stderr.trim() || 'Failed to read staged diff');
  if (unstaged.exitCode !== 0) throw new Error(unstaged.stderr.trim() || 'Failed to read unstaged diff');

  const untrackedPatches: string[] = [];
  for (const change of status.changes.filter((entry) => entry.untracked)) {
    const path = resolveRepoPath(ctx, change.path);
    const content = await readTextFile(path.absolutePath);
    untrackedPatches.push(syntheticUntrackedPatch(path.gitPath, content));
  }

  const rawPatch = [staged.stdout, unstaged.stdout, ...untrackedPatches]
    .map((entry) => entry.trimEnd())
    .filter(Boolean)
    .join('\n');
  const limited = trimOutput(rawPatch);
  const projection = projectReviewPatch(limited.adapterText, limited.truncated, requestId);
  const files = filesFromArtifacts(projection.patchArtifacts);
  return {
    target: { kind: 'uncommitted', label: 'Uncommitted changes' },
    patch: limited.text,
    ...projection,
    files,
    stats: diffStatsFromPatch(limited.text, limited.truncated),
    evidenceRefs: evidenceRefsForFiles(files),
  };
}

async function collectBaseBranchDiff(ctx: RepoContext, baseBranch: string, requestId: string): Promise<ReviewDiffBundle> {
  const base = normalizeString(baseBranch);
  if (!base) throw new Error('Base branch is required');
  const head = await git(['rev-parse', '--verify', 'HEAD'], ctx.workspaceRoot);
  const mergeBase = await git(['merge-base', 'HEAD', base], ctx.workspaceRoot);
  if (head.exitCode !== 0 || !head.stdout.trim()) throw new Error(head.stderr.trim() || 'Failed to resolve HEAD');
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout.trim()) {
    throw new Error(mergeBase.stderr.trim() || `Failed to resolve merge-base with ${base}`);
  }
  const baseCommit = mergeBase.stdout.trim();
  const headCommit = head.stdout.trim();
  const diff = await git(['diff', `${baseCommit}...HEAD`], ctx.workspaceRoot);
  if (diff.exitCode !== 0) throw new Error(diff.stderr.trim() || `Failed to diff against ${base}`);
  const limited = trimOutput(diff.stdout);
  const projection = projectReviewPatch(limited.adapterText, limited.truncated, requestId);
  const files = filesFromArtifacts(projection.patchArtifacts);
  return {
    target: { kind: 'baseBranch', baseBranch: base, label: base, baseCommit, headCommit },
    patch: limited.text,
    ...projection,
    files,
    stats: diffStatsFromPatch(limited.text, limited.truncated),
    evidenceRefs: evidenceRefsForFiles(files),
  };
}

async function collectCommitDiff(ctx: RepoContext, commit: string, requestId: string): Promise<ReviewDiffBundle> {
  const input = normalizeString(commit);
  if (!input) throw new Error('Commit is required');
  const resolved = await git(['rev-parse', '--verify', `${input}^{commit}`], ctx.workspaceRoot);
  if (resolved.exitCode !== 0 || !resolved.stdout.trim()) {
    throw new Error(resolved.stderr.trim() || `Failed to resolve commit ${input}`);
  }
  const resolvedCommit = resolved.stdout.trim();
  const show = await git(['show', '--format=', '--patch', resolvedCommit], ctx.workspaceRoot);
  if (show.exitCode !== 0) throw new Error(show.stderr.trim() || `Failed to read commit ${input}`);
  const limited = trimOutput(show.stdout);
  const projection = projectReviewPatch(limited.adapterText, limited.truncated, requestId);
  const files = filesFromArtifacts(projection.patchArtifacts);
  return {
    target: { kind: 'commit', commit: input, label: input, resolvedCommit },
    patch: limited.text,
    ...projection,
    files,
    stats: diffStatsFromPatch(limited.text, limited.truncated),
    evidenceRefs: evidenceRefsForFiles(files),
  };
}

export async function collectCodeReviewDiffForTarget(
  target: CodeReviewTarget,
  requestId = `code-review-${randomUUID()}`,
): Promise<ReviewDiffBundle> {
  const ctx = await requireRepoContext();
  if (target.kind === 'baseBranch') return collectBaseBranchDiff(ctx, target.baseBranch, requestId);
  if (target.kind === 'commit') return collectCommitDiff(ctx, target.commit, requestId);
  return collectUncommittedDiff(ctx, requestId);
}

function buildReviewPrompt(bundle: ReviewDiffBundle, focus?: string): string {
  const focusText = normalizeString(focus);
  const promptPatch = redactSecrets(bundle.patch);
  return [
    'You are reviewing a Git diff for Verse Claw.',
    'This is a read-only code review. Do not suggest applying patches, staging, committing, or editing files directly.',
    'Return only JSON with this exact shape:',
    '{"summary":"short review summary","findings":[{"severity":"critical|high|medium|low|info","file":"path/from/diff","line":123,"reason":"why this is a bug or risk","suggestedFix":"specific fix guidance"}]}',
    'Use severity based on user impact and regression risk. Prefer no findings over speculative findings.',
    focusText ? `Review focus: ${focusText}` : 'Review focus: correctness, regressions, missing tests, and maintainability risks.',
    `Target: ${bundle.target.label}`,
    `Changed files: ${bundle.files.join(', ') || 'none'}`,
    'Diff:',
    '```diff',
    promptPatch,
    '```',
  ].join('\n');
}

function extractAssistantTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (isRecord(entry) && typeof entry.text === 'string') return entry.text;
    return '';
  }).filter(Boolean).join('\n');
}

function extractLatestAssistantText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== 'assistant') continue;
    const text = extractAssistantTextFromContent(message.content);
    if (text.trim()) return text;
  }
  return undefined;
}

function jsonCandidateFromText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function normalizeSeverity(value: unknown): CodeReviewSeverity {
  const text = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (text === 'critical' || text === 'high' || text === 'medium' || text === 'low' || text === 'info') return text;
  return 'medium';
}

function normalizeLine(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const line = Math.floor(value);
  return line > 0 ? line : undefined;
}

export function sortCodeReviewFindings(findings: CodeReviewFinding[]): CodeReviewFinding[] {
  return [...findings].sort((left, right) => {
    const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severity !== 0) return severity;
    const file = left.file.localeCompare(right.file);
    if (file !== 0) return file;
    return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
  });
}

export function parseCodeReviewFindings(text: string, changedFiles: string[]): { summary: string; findings: CodeReviewFinding[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidateFromText(text));
  } catch (error) {
    throw new Error(`Review response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) throw new Error('Review response must be a JSON object');
  const changedFileSet = new Set(changedFiles);
  const fallbackFile = changedFiles[0] ?? 'unknown';
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = rawFindings.flatMap((entry, index): CodeReviewFinding[] => {
    if (!isRecord(entry)) return [];
    const rawFile = normalizeString(entry.file);
    const file = rawFile && changedFileSet.has(rawFile) ? rawFile : fallbackFile;
    const reason = normalizeString(entry.reason) ?? normalizeString(entry.body) ?? normalizeString(entry.title);
    const suggestedFix = normalizeString(entry.suggestedFix) ?? normalizeString(entry.suggested_fix);
    if (!reason || !suggestedFix) return [];
    return [{
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `finding-${index + 1}`,
      severity: normalizeSeverity(entry.severity),
      file,
      line: rawFile && changedFileSet.has(rawFile) ? normalizeLine(entry.line) : undefined,
      reason,
      suggestedFix,
    }];
  });
  return {
    summary: normalizeString(parsed.summary) ?? 'Review completed.',
    findings: sortCodeReviewFindings(findings),
  };
}

async function runModelReview(
  gatewayManager: GatewayManager,
  runId: string,
  bundle: ReviewDiffBundle,
  focus: string | undefined,
  timeoutMs: number,
): Promise<RuntimeReviewOutput> {
  const deltas: string[] = [];
  let modelRunId: string | undefined;
  const sessionKey = `agent:main:code-review-${runId.slice(0, 8)}`;
  const onRuntimeEvent = (event: ChatRuntimeEvent) => {
    if (event.runId !== modelRunId) return;
    if (event.type === 'assistant.delta') deltas.push(event.text ?? event.delta ?? '');
  };

  gatewayManager.on('chat:runtime-event', onRuntimeEvent);
  try {
    const accepted = await gatewayManager.rpc<Record<string, unknown>>('agent', {
      sessionKey,
      message: buildReviewPrompt(bundle, focus),
      deliver: false,
      idempotencyKey: runId,
      modelRun: true,
      promptMode: 'none',
      disableMessageTool: true,
      bestEffortDeliver: false,
      cleanupBundleMcpOnRunEnd: true,
      label: 'Code Review Center',
      timeout: Math.ceil(timeoutMs / 1000),
    }, timeoutMs);
    modelRunId = typeof accepted?.runId === 'string' ? accepted.runId : undefined;
    const resolvedSessionKey = typeof accepted?.sessionKey === 'string' ? accepted.sessionKey : sessionKey;
    if (!modelRunId) throw new Error('Runtime did not accept the code review run');

    const wait = await gatewayManager.rpc<Record<string, unknown>>('agent.wait', {
      runId: modelRunId,
      timeoutMs,
    }, timeoutMs + 5_000);
    if (wait?.status === 'timeout' || wait?.status === 'pending') {
      throw new Error('Code review run timed out');
    }
    if (wait?.status === 'error') {
      throw new Error(typeof wait.error === 'string' ? wait.error : 'Code review run failed');
    }

    const streamedText = deltas.join('').trim();
    if (streamedText) return { modelRunId, sessionKey: resolvedSessionKey, text: streamedText };

    const history = await gatewayManager.rpc<Record<string, unknown>>('chat.history', {
      sessionKey: resolvedSessionKey,
      limit: 20,
      maxChars: 200_000,
    }, 30_000).catch(() => undefined);
    return {
      modelRunId,
      sessionKey: resolvedSessionKey,
      text: extractLatestAssistantText(history?.messages),
    };
  } finally {
    gatewayManager.off('chat:runtime-event', onRuntimeEvent);
  }
}

function recordReviewTrace(review: CodeReviewRun): void {
  const startedAt = Date.parse(review.startedAt) || Date.now();
  const endedAt = Date.parse(review.endedAt) || Date.now();
  const trace: ObservabilityTrace = {
    id: review.traceId ?? `trace_${review.runId}`,
    name: 'Code Review Center',
    runId: review.modelRunId ?? review.runId,
    sessionKey: review.sessionKey,
    task: 'code-review',
    mode: 'review',
    status: review.status === 'error' ? 'error' : 'completed',
    startedAt,
    endedAt,
    updatedAt: endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    spans: [{
      id: `span_${review.runId}`,
      traceId: review.traceId ?? `trace_${review.runId}`,
      name: 'Normalize review findings',
      kind: 'verifier',
      status: review.status === 'error' ? 'error' : 'completed',
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      attributes: {
        targetKind: review.target.kind,
        files: review.diffStats.files,
        findings: review.findings.length,
        readonly: true,
      },
      error: review.error?.safeMessage,
    }],
    events: [{
      id: `event_${review.runId}`,
      traceId: review.traceId ?? `trace_${review.runId}`,
      spanId: `span_${review.runId}`,
      type: review.status === 'error' ? 'review.error' : 'review.completed',
      name: review.status === 'error' ? 'Review failed' : 'Review completed',
      timestamp: endedAt,
      attributes: {
        severityCounts: review.findings.reduce<Record<string, number>>((acc, finding) => {
          acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
          return acc;
        }, {}),
      },
    }],
    tokenUsage: emptyTokenUsage(),
    metrics: {
      findings: review.findings.length,
      files: review.diffStats.files,
    },
    tags: ['code-review', 'review-center', review.target.kind],
    error: review.error?.safeMessage,
  };
  upsertObservabilityTrace(trace);
}

function nodePriorityForFinding(finding?: CodeReviewFinding): TaskLedgerNode['priority'] {
  if (!finding) return 'normal';
  return finding.severity === 'critical' || finding.severity === 'high' ? 'high' : 'normal';
}

function ledgerDescription(review: CodeReviewRun, finding?: CodeReviewFinding): string {
  if (!finding) {
    return [
      review.summary,
      '',
      `Target: ${review.target.label}`,
      `Findings: ${review.findings.length}`,
    ].join('\n');
  }
  return [
    finding.reason,
    '',
    `Suggested fix: ${finding.suggestedFix}`,
    `Target: ${review.target.label}`,
  ].join('\n');
}

async function createLedgerReviewNode(payload: CodeReviewCreateTaskLedgerNodePayload) {
  const review = reviewRuns.get(payload.runId);
  if (!review) throw new Error(`Unknown code review run: ${payload.runId}`);
  const finding = payload.findingId
    ? review.findings.find((entry) => entry.id === payload.findingId)
    : undefined;
  if (payload.findingId && !finding) throw new Error(`Unknown code review finding: ${payload.findingId}`);

  const nodeId = randomUUID();
  const title = finding
    ? `[${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ''}`
    : `Code review: ${review.target.label}`;
  const evidenceRefs = finding
    ? [{ type: 'file' as const, ref: finding.line ? `${finding.file}:${finding.line}` : finding.file, label: finding.file }]
    : review.evidenceRefs;
  const node: TaskLedgerNode = {
    id: nodeId,
    title,
    kind: 'review',
    parentId: null,
    status: 'review',
    owner: 'user',
    priority: nodePriorityForFinding(finding),
    tags: ['code-review', review.target.kind, finding?.severity].filter(Boolean) as string[],
    description: ledgerDescription(review, finding),
    evidenceRefs,
    metadata: {
      source: 'codeReviewCenter',
      runId: review.runId,
      findingId: finding?.id ?? null,
      severity: finding?.severity ?? null,
      target: review.target,
      readonly: true,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
  };
  const snapshot = await appendTaskLedgerEvents(payload.workspaceId, [{
    type: 'node_created',
    actor: 'user',
    taskId: node.id,
    payload: { node },
  }], `code-review:${review.runId}:${finding?.id ?? 'run'}`);
  return { success: true, nodeId, snapshot };
}

function completedReview(params: {
  runId: string;
  bundle: ReviewDiffBundle;
  focus?: string;
  startedAt: string;
  output?: RuntimeReviewOutput;
  summary: string;
  findings: CodeReviewFinding[];
}): CodeReviewRun {
  const endedAt = nowIso();
  return {
    runId: params.runId,
    readonly: true,
    status: 'completed',
    target: params.bundle.target,
    focus: normalizeString(params.focus),
    summary: params.summary,
    diffStats: params.bundle.stats,
    patchArtifacts: params.bundle.patchArtifacts,
    patchArtifactError: params.bundle.patchArtifactError,
    findings: params.findings,
    evidenceRefs: params.bundle.evidenceRefs,
    startedAt: params.startedAt,
    endedAt,
    modelRunId: params.output?.modelRunId,
    sessionKey: params.output?.sessionKey,
    traceId: `trace_${params.runId}`,
  };
}

function failedReview(params: {
  runId: string;
  bundle?: ReviewDiffBundle;
  target: CodeReviewTarget;
  focus?: string;
  startedAt: string;
  error: RemoteForgeErrorV1;
}): CodeReviewRun {
  const endedAt = nowIso();
  return {
    runId: params.runId,
    readonly: true,
    status: 'error',
    target: params.bundle?.target ?? { ...params.target, label: params.target.kind },
    focus: normalizeString(params.focus),
    summary: params.error.safeMessage,
    diffStats: params.bundle?.stats ?? { files: 0, additions: 0, deletions: 0, patchBytes: 0, truncated: false },
    patchArtifacts: params.bundle?.patchArtifacts ?? [],
    patchArtifactError: params.bundle?.patchArtifactError,
    findings: [],
    evidenceRefs: params.bundle?.evidenceRefs ?? [],
    startedAt: params.startedAt,
    endedAt,
    traceId: `trace_${params.runId}`,
    error: params.error,
  };
}

export function createCodeReviewApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['codeReview'] {
  return {
    run: async (payload: CodeReviewRunPayload) => {
      const startedAt = nowIso();
      const runId = `code-review-${randomUUID()}`;
      let bundle: ReviewDiffBundle | undefined;
      try {
        bundle = await collectCodeReviewDiffForTarget(payload.target, runId);
        if (!bundle.patch.trim()) {
          const review = completedReview({
            runId,
            bundle,
            focus: payload.focus,
            startedAt,
            summary: 'No changes found for this review target.',
            findings: [],
          });
          reviewRuns.set(runId, review);
          recordReviewTrace(review);
          return { success: true, review };
        }
        if (bundle.patchArtifactError) {
          throw new CodeReviewSafeError(bundle.patchArtifactError);
        }
        if (bundle.stats.truncated) {
          throw safeReviewError('truncated_response', runId);
        }

        const output = await runModelReview(
          gatewayManager,
          runId,
          bundle,
          payload.focus,
          typeof payload.timeoutMs === 'number' && Number.isFinite(payload.timeoutMs)
            ? Math.max(5_000, Math.floor(payload.timeoutMs))
            : DEFAULT_REVIEW_TIMEOUT_MS,
        );
        if (!output.text?.trim()) throw safeReviewError('incomplete_response', runId);
        const parsed = parseCodeReviewFindings(output.text, bundle.files);
        const review = completedReview({
          runId,
          bundle,
          focus: payload.focus,
          startedAt,
          output,
          summary: parsed.summary,
          findings: parsed.findings,
        });
        reviewRuns.set(runId, review);
        recordReviewTrace(review);
        return { success: true, review };
      } catch (error) {
        const review = failedReview({
          runId,
          bundle,
          target: payload.target,
          focus: payload.focus,
          startedAt,
          error: error instanceof CodeReviewSafeError
            ? error.envelope
            : createRemoteForgeErrorV1({
                code: error instanceof Error && /timed out/i.test(error.message) ? 'timeout' : 'internal',
                requestId: runId,
              }),
        });
        reviewRuns.set(runId, review);
        recordReviewTrace(review);
        return { success: false, error: review.error, review };
      }
    },

    createTaskLedgerNode: async (payload) => createLedgerReviewNode(payload),
  };
}
