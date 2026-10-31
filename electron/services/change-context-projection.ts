import { createHash } from 'node:crypto';
import type { RawMessage } from '@shared/chat/types';
import type { TurnIdentity } from '@shared/types/context-control-plane/artifacts';
import type {
  ChangeContextComparison,
  ChangeContextComparisonRequest,
  ChangeContextDiffEntry,
  ChangeContextDiffProjection,
  ChangeContextIdentity,
  ChangeContextIssue,
  ChangeContextRevisionRef,
  ChangeContextState,
  ChangeContextTranscriptSeqBounds,
} from '@shared/types/change-context';
import type { GitPatchArtifactV1 } from '@shared/types/remote-forge';
import { adaptUnifiedDiffToGitPatchArtifacts } from '@shared/remote-forge/unified-diff-adapter';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import {
  collectCodeReviewDiffForTarget,
  collectCodeReviewWorktreeDiffAgainstCommit,
} from './code-review-api';
import { resolveGitCommitAtOrBefore } from './git-api';

export type ChangeContextComparisonFacts = {
  comparison: ChangeContextComparison;
  diff: ChangeContextDiffProjection;
  identity?: Pick<ChangeContextIdentity, 'runId' | 'turn'>;
};

export type ChangeContextRuntimeTurnFacts = {
  runId: string | null;
  turn: TurnIdentity | null;
  runtimeTurnId: string | null;
  transcriptSeq: ChangeContextTranscriptSeqBounds | null;
  transcriptDigest: string | null;
  startedAt: string;
};

export type ChangeContextSourceReader = {
  read(input: {
    workspaceId: string | null;
    sessionKey: string;
    comparison: ChangeContextComparisonRequest;
    resolvedAt: string;
    requestId: string;
  }): Promise<ChangeContextComparisonFacts>;
};

export type ChangeContextSourceReaderOptions = {
  gatewayManager?: Pick<GatewayManager, 'rpc'>;
  checkpointDiff?: CompleteHostServiceRegistry['sessions']['checkpointDiff'];
  readRuntimeTurn?: (sessionKey: string) => Promise<ChangeContextRuntimeTurnFacts | null>;
  collectReviewDiff?: typeof collectCodeReviewDiffForTarget;
  collectWorktreeDiffAgainstCommit?: typeof collectCodeReviewWorktreeDiffAgainstCommit;
  resolveCommitAtOrBefore?: typeof resolveGitCommitAtOrBefore;
};

type ReviewBundleLike = {
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: { safeMessage?: string };
  stats: {
    files: number;
    additions: number;
    deletions: number;
    patchBytes: number;
    truncated: boolean;
  };
};

const STATE_SEVERITY: Record<ChangeContextState, number> = {
  available: 0,
  partial: 1,
  truncated: 2,
  stale: 3,
  removed: 4,
  unavailable: 5,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function createIssue(
  code: ChangeContextIssue['code'],
  message: string,
  source?: ChangeContextIssue['source'],
  revision?: ChangeContextRevisionRef | null,
): ChangeContextIssue {
  return {
    code,
    message,
    ...(source ? { source } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function sourceForComparison(mode: ChangeContextComparisonRequest['mode']): ChangeContextIssue['source'] {
  switch (mode) {
    case 'merge-base':
    case 'last-commit':
      return 'git';
    case 'last-turn':
      return 'transcript';
    case 'checkpoint':
      return 'checkpoint';
  }
}

function combineStates(...states: ChangeContextState[]): ChangeContextState {
  return states.reduce<ChangeContextState>(
    (worst, state) => (STATE_SEVERITY[state] > STATE_SEVERITY[worst] ? state : worst),
    'available',
  );
}

function mapArtifactChangeKind(status: GitPatchArtifactV1['status']): ChangeContextDiffEntry['changeKind'] {
  switch (status) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'modified':
      return 'modified';
    case 'renamed':
    case 'copied':
      return 'renamed';
    default:
      return 'unknown';
  }
}

function artifactEntries(artifacts: GitPatchArtifactV1[]): ChangeContextDiffEntry[] {
  return artifacts.map((artifact) => ({
    path: artifact.newPath ?? artifact.file,
    ...(artifact.oldPath ? { previousPath: artifact.oldPath } : {}),
    changeKind: mapArtifactChangeKind(artifact.status),
    additions: null,
    deletions: null,
    patchDigest: artifact.patch ? sha256(artifact.patch) : null,
    contentState: artifact.completeness === 'unavailable' ? 'unavailable' : 'available',
  }));
}

function diffFromReviewBundle(bundle: ReviewBundleLike): ChangeContextDiffProjection {
  const issues: ChangeContextIssue[] = [];
  if (bundle.patchArtifactError) {
    issues.push(createIssue(
      'source_partial',
      bundle.patchArtifactError.safeMessage ?? 'The diff could not be fully converted into review patch artifacts.',
      'git',
    ));
  }
  return {
    state: bundle.stats.truncated ? 'truncated' : issues.length > 0 ? 'partial' : 'available',
    files: artifactEntries(bundle.patchArtifacts),
    patchArtifacts: bundle.patchArtifacts,
    stats: {
      files: bundle.stats.files,
      additions: bundle.stats.additions,
      deletions: bundle.stats.deletions,
      patchBytes: bundle.stats.patchBytes,
    },
    truncated: bundle.stats.truncated,
    issues,
  };
}

function countPatchStats(patch: string): { additions: number; deletions: number; patchBytes: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions, patchBytes: Buffer.byteLength(patch, 'utf8') };
}

function diffFromCheckpointFiles(
  files: Array<{ filePath: string; status: 'modified' | 'created' | 'deleted'; unifiedDiff: string }>,
  errors: string[],
): ChangeContextDiffProjection {
  const patch = files.map((file) => file.unifiedDiff).filter(Boolean).join('\n');
  const adapted = patch.trim()
    ? adaptUnifiedDiffToGitPatchArtifacts({ patch, sourceCompleteness: 'complete' })
    : { kind: 'available' as const, artifacts: [] as GitPatchArtifactV1[] };
  const patchArtifacts = adapted.kind === 'unavailable' ? [] : adapted.artifacts;
  const issues: ChangeContextIssue[] = errors.map((message) => createIssue('source_partial', message, 'checkpoint'));
  if (adapted.kind === 'unavailable') {
    issues.push(createIssue('source_partial', 'Checkpoint diff could not be converted into patch artifacts.', 'checkpoint'));
  }
  const entries = artifactEntries(patchArtifacts);
  const fallbackEntries = entries.length > 0
    ? entries
    : files.map((file) => {
      const stats = countPatchStats(file.unifiedDiff);
      return {
        path: file.filePath,
        changeKind: file.status === 'created' ? 'added' as const : file.status === 'deleted' ? 'deleted' as const : 'modified' as const,
        additions: stats.additions,
        deletions: stats.deletions,
        patchDigest: file.unifiedDiff ? sha256(file.unifiedDiff) : null,
        contentState: file.unifiedDiff ? 'available' as const : 'unavailable' as const,
      };
    });
  const totals = patchArtifacts.length > 0
    ? {
        files: patchArtifacts.length,
        additions: countPatchStats(patch).additions,
        deletions: countPatchStats(patch).deletions,
      }
    : {
        files: files.length,
        additions: files.reduce((sum, file) => sum + countPatchStats(file.unifiedDiff).additions, 0),
        deletions: files.reduce((sum, file) => sum + countPatchStats(file.unifiedDiff).deletions, 0),
      };
  return {
    state: issues.length > 0 ? 'partial' : 'available',
    files: fallbackEntries,
    patchArtifacts,
    stats: {
      ...totals,
      patchBytes: Buffer.byteLength(patch, 'utf8'),
    },
    truncated: false,
    issues,
  };
}

function unavailableDiff(message: string, source: ChangeContextIssue['source']): ChangeContextDiffProjection {
  return {
    state: 'unavailable',
    files: [],
    patchArtifacts: [],
    stats: null,
    truncated: false,
    issues: [createIssue('source_unavailable', message, source)],
  };
}

function unavailableFacts(input: {
  mode: ChangeContextComparisonRequest['mode'];
  resolvedAt: string;
  message: string;
  source: ChangeContextIssue['source'];
}): ChangeContextComparisonFacts {
  const issue = createIssue('source_unavailable', input.message, input.source);
  return {
    comparison: {
      mode: input.mode,
      state: 'unavailable',
      base: null,
      candidate: null,
      resolvedAt: input.resolvedAt,
      issues: [issue],
    },
    diff: unavailableDiff(input.message, input.source),
  };
}

function reviewFacts(input: {
  mode: ChangeContextComparisonRequest['mode'];
  resolvedAt: string;
  bundle: ReviewBundleLike;
  base: ChangeContextRevisionRef | null;
  candidate: ChangeContextRevisionRef | null;
  extraIssues?: ChangeContextIssue[];
  identity?: ChangeContextComparisonFacts['identity'];
}): ChangeContextComparisonFacts {
  const diff = diffFromReviewBundle(input.bundle);
  const extraIssues = input.extraIssues ?? [];
  const state = combineStates(diff.state, extraIssues.length > 0 ? 'partial' : 'available', input.base ? 'available' : 'partial', input.candidate ? 'available' : 'partial');
  const issues = [...diff.issues, ...extraIssues];
  return {
    comparison: {
      mode: input.mode,
      state,
      base: input.base,
      candidate: input.candidate,
      resolvedAt: input.resolvedAt,
      issues,
    },
    diff: {
      ...diff,
      state: combineStates(diff.state, state),
      issues,
    },
    ...(input.identity ? { identity: input.identity } : {}),
  };
}

function gitCommitRevision(commit: string | null | undefined): ChangeContextRevisionRef | null {
  const value = readString(commit);
  return value ? { kind: 'git-commit', commit: value, treeDigest: null } : null;
}

function gitWorktreeRevision(input: {
  workspaceId: string | null;
  headCommit: string | null;
  worktreeDigest: string | null;
}): ChangeContextRevisionRef {
  return {
    kind: 'git-worktree',
    workspaceId: input.workspaceId,
    headCommit: input.headCommit,
    worktreeDigest: input.worktreeDigest,
  };
}

function readMessageTimestamp(message: RawMessage): number | null {
  if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) return message.timestamp;
  const record = message as unknown as Record<string, unknown>;
  const raw = record.timestamp;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readMessageMeta(message: RawMessage): Record<string, unknown> {
  const record = message as unknown as Record<string, unknown>;
  return isRecord(record.__openclaw) ? record.__openclaw : {};
}

function readRuntimeMetaValue(messages: RawMessage[], keys: string[]): unknown {
  for (const message of messages) {
    const record = message as unknown as Record<string, unknown>;
    const candidates = [record, readMessageMeta(message), isRecord(record.details) ? record.details : null];
    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const key of keys) {
        if (candidate[key] !== undefined) return candidate[key];
      }
    }
  }
  return undefined;
}

export function readRuntimeTurnFacts(
  sessionKey: string,
  messages: RawMessage[],
): ChangeContextRuntimeTurnFacts | null {
  let startIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      startIndex = index;
      break;
    }
  }
  if (startIndex < 0) return null;
  const turnMessages = messages.slice(startIndex);
  const startedAtMs = readMessageTimestamp(turnMessages[0]);
  if (startedAtMs === null) return null;
  const seqs = turnMessages
    .map((message) => readNumber(readMessageMeta(message).seq))
    .filter((value): value is number => value !== null);
  const transcriptSeq = seqs.length === turnMessages.length
    ? { start: seqs[0], end: seqs[seqs.length - 1] }
    : null;
  const runId = readString(readRuntimeMetaValue(turnMessages, ['runId', 'run_id']));
  const runtimeTurnId = readString(readRuntimeMetaValue(turnMessages, ['turnId', 'turn_id']));
  const attemptIndex = readNumber(readRuntimeMetaValue(turnMessages, ['attemptIndex', 'attempt_index']));
  const modelCallIndex = readNumber(readRuntimeMetaValue(turnMessages, ['modelCallIndex', 'model_call_index']));
  const turn = runId && attemptIndex !== null && modelCallIndex !== null
    ? { sessionKey, runId, attemptIndex, modelCallIndex }
    : null;
  const digestInput = turnMessages.map((message) => ({
    id: message.id ?? null,
    role: message.role,
    timestamp: message.timestamp ?? null,
    seq: readNumber(readMessageMeta(message).seq),
  }));
  return {
    runId,
    turn,
    runtimeTurnId,
    transcriptSeq,
    transcriptDigest: sha256(JSON.stringify(digestInput)),
    startedAt: new Date(startedAtMs).toISOString(),
  };
}

async function readRuntimeTurnFromGateway(
  gatewayManager: Pick<GatewayManager, 'rpc'>,
  sessionKey: string,
): Promise<ChangeContextRuntimeTurnFacts | null> {
  const result = await gatewayManager.rpc<{ messages?: RawMessage[] }>(
    'chat.history',
    { sessionKey, limit: 200 },
    10_000,
  );
  if (!Array.isArray(result?.messages)) throw new Error('Runtime history returned no messages array');
  return readRuntimeTurnFacts(sessionKey, result.messages);
}

export function createDefaultChangeContextSourceReader(
  options: ChangeContextSourceReaderOptions,
): ChangeContextSourceReader {
  const collectReviewDiff = options.collectReviewDiff ?? collectCodeReviewDiffForTarget;
  const collectWorktreeDiffAgainstCommit =
    options.collectWorktreeDiffAgainstCommit ?? collectCodeReviewWorktreeDiffAgainstCommit;
  const resolveCommitAtOrBefore = options.resolveCommitAtOrBefore ?? resolveGitCommitAtOrBefore;
  const readRuntimeTurn = options.readRuntimeTurn
    ?? (options.gatewayManager
      ? (sessionKey: string) => readRuntimeTurnFromGateway(options.gatewayManager!, sessionKey)
      : undefined);

  return {
    read: async (input) => {
      const { comparison, resolvedAt } = input;
      const mode = comparison.mode;
      try {
        if (comparison.mode === 'merge-base') {
          const bundle = await collectReviewDiff(
            { kind: 'baseBranch', baseBranch: comparison.baseRef },
            input.requestId,
          );
          return reviewFacts({
            mode: comparison.mode,
            resolvedAt,
            bundle,
            base: gitCommitRevision(bundle.target.baseCommit),
            candidate: gitCommitRevision(bundle.target.headCommit),
          });
        }

        if (comparison.mode === 'last-commit') {
          const bundle = await collectReviewDiff(
            { kind: 'commit', commit: comparison.commit },
            input.requestId,
          );
          const base = gitCommitRevision(bundle.target.baseCommit);
          return reviewFacts({
            mode: comparison.mode,
            resolvedAt,
            bundle,
            base,
            candidate: gitCommitRevision(bundle.target.resolvedCommit),
            extraIssues: base
              ? []
              : [createIssue('digest_missing', 'The commit has no resolvable parent commit.', 'git')],
          });
        }

        if (comparison.mode === 'last-turn') {
          if (!readRuntimeTurn) {
            return unavailableFacts({
              mode: comparison.mode,
              resolvedAt,
              message: 'Session runtime turn facts are unavailable.',
              source: 'transcript',
            });
          }
          const runtimeTurn = await readRuntimeTurn(input.sessionKey);
          if (!runtimeTurn) {
            return unavailableFacts({
              mode: comparison.mode,
              resolvedAt,
              message: 'No completed runtime turn was available for this session.',
              source: 'transcript',
            });
          }
          const baseCommit = await resolveCommitAtOrBefore(runtimeTurn.startedAt);
          if (!baseCommit) {
            return unavailableFacts({
              mode: comparison.mode,
              resolvedAt,
              message: 'No Git commit is available at or before the selected turn start.',
              source: 'git',
            });
          }
          const bundle = await collectWorktreeDiffAgainstCommit(baseCommit, input.requestId);
          return reviewFacts({
            mode: comparison.mode,
            resolvedAt,
            bundle,
            base: gitCommitRevision(baseCommit),
            candidate: gitWorktreeRevision({
              workspaceId: input.workspaceId,
              headCommit: bundle.target.headCommit ?? null,
              worktreeDigest: null,
            }),
            extraIssues: runtimeTurn.transcriptSeq
              ? []
              : [createIssue('digest_missing', 'Transcript sequence bounds were unavailable for the selected turn.', 'transcript')],
            identity: {
              runId: runtimeTurn.runId,
              turn: runtimeTurn.turn,
            },
          });
        }

        if (comparison.mode === 'checkpoint') {
          if (!options.checkpointDiff) {
            return unavailableFacts({
              mode: comparison.mode,
              resolvedAt,
              message: 'Session checkpoint diff owner is unavailable.',
              source: 'checkpoint',
            });
          }
          const checkpoint = await options.checkpointDiff({
            sessionKey: input.sessionKey,
            checkpointId: comparison.checkpointId,
          });
          if (!checkpoint.success) {
            return unavailableFacts({
              mode: comparison.mode,
              resolvedAt,
              message: checkpoint.error ?? 'Checkpoint diff is unavailable.',
              source: 'checkpoint',
            });
          }
          const diff = diffFromCheckpointFiles(checkpoint.files, checkpoint.errors);
          const checkpointDigest = sha256(JSON.stringify(checkpoint.files));
          const base: ChangeContextRevisionRef = {
            kind: 'checkpoint',
            checkpointId: comparison.checkpointId,
            checkpointDigest,
          };
          const headCommit = await resolveCommitAtOrBefore(resolvedAt).catch(() => null);
          const candidate = gitWorktreeRevision({
            workspaceId: input.workspaceId,
            headCommit,
            worktreeDigest: null,
          });
          const state = combineStates(diff.state, 'available');
          return {
            comparison: {
              mode: comparison.mode,
              state,
              base,
              candidate,
              resolvedAt,
              issues: diff.issues,
            },
            diff,
          };
        }

        return unavailableFacts({
          mode,
          resolvedAt,
          message: 'Unsupported comparison mode.',
          source: sourceForComparison(mode),
        });
      } catch (error) {
        return unavailableFacts({
          mode,
          resolvedAt,
          message: error instanceof Error ? error.message : String(error),
          source: sourceForComparison(mode),
        });
      }
    },
  };
}
