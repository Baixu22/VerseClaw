import { createHash, randomUUID } from 'node:crypto';
import type {
  RemoteForgeContentReadPayload,
  RemoteForgeMergePayload,
  RemoteForgeMergeResult,
  RemoteForgeMutationPayload,
  RemoteForgePullRequestReadPayload,
  RemoteForgePullRequestReadResult,
  RemoteForgeRepositoryPayload,
} from '@shared/host-api/contract';
import {
  GIT_PATCH_ARTIFACT_SCHEMA,
  isRepositoryRelativePosixPath,
  type GitPatchArtifactV1,
  type GitPatchFileStatus,
  type RemoteForgeBranchProtection,
  type RemoteForgeCapabilityMatrix,
  type RemoteForgeCheck,
  type RemoteForgeCollection,
  type RemoteForgeCommit,
  type RemoteForgeCompleteness,
  type RemoteForgeContent,
  type RemoteForgeErrorCode,
  type RemoteForgeErrorV1,
  type RemoteForgeFile,
  type RemoteForgeMergePolicyDecision,
  type RemoteForgeMergeStrategy,
  type RemoteForgeMutationBinding,
  type RemoteForgeMutationEffect,
  type RemoteForgeMutationV1,
  type RemoteForgePullRequestDetail,
  type RemoteForgePullRequestReadV1,
  type RemoteForgeReadiness,
  type RemoteForgeReadinessReason,
  type RemoteForgeRequestTrace,
  type RemoteForgeReview,
} from '@shared/types/remote-forge';
import type { PermissionApprovalEvent, WorkspaceProfile } from '@shared/types/workspace';
import { createRemoteForgeErrorV1 } from '@shared/remote-forge/error-envelope';
import { adaptUnifiedDiffToGitPatchArtifacts } from '@shared/remote-forge/unified-diff-adapter';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
} from './permissions-api';
import { requireWorkspace } from './workspace-permissions';
import { getActiveWorkspaceProfile } from './workspaces-api';

export const REMOTE_FORGE_READ_LIMITS = Object.freeze({
  perPage: 100,
  maxPages: 5,
  maxItems: 500,
  maxResponseBytes: 1024 * 1024,
  timeoutMs: 5_000,
  maxContentPaths: 16,
  contentConcurrency: 4,
  maxDecodedContentBytes: 512 * 1024,
});

export const REMOTE_FORGE_MUTATION_LIMITS = Object.freeze({
  maxBodyChars: 20_000,
  maxTitleChars: 500,
  maxDiffHunkChars: 4_096,
  maxLabels: 20,
  maxReviewers: 20,
  maxNameChars: 100,
  maxRequestBytes: 64 * 1024,
});

export const REMOTE_FORGE_MERGE_APPROVAL_TTL_MS = 5 * 60 * 1_000;

type FetchLike = typeof fetch;
type TraceSink = (trace: RemoteForgeRequestTrace) => void;
type JsonRecord = Record<string, unknown>;

export type RemoteForgeMergePolicy = {
  allowedRepositories: readonly string[];
  agentMergeEnabled: boolean;
  version?: string;
};

export type RemoteForgeMergeAuditEvent = {
  requestId: string;
  binding: RemoteForgeMutationBinding;
  remoteSha?: string;
};

export type RemoteForgeMergeExecutionContext = {
  initiator: 'user' | 'agent';
};

export type RemoteForgeApi = Omit<CompleteHostServiceRegistry['remoteForge'], 'mergePullRequest'> & {
  mergePullRequest: (
    payload: RemoteForgeMergePayload,
    context?: RemoteForgeMergeExecutionContext,
  ) => Promise<RemoteForgeMergeResult>;
};

type RemoteForgeApprovalAdapter = {
  create: (input: {
    workspace: WorkspaceProfile;
    source: 'git';
    risk: 'dangerous';
    command: string;
    reason: string;
    requestHash: string;
    paramsPreview: string;
    paths?: string[];
  }) => Promise<PermissionApprovalEvent>;
  consume: (input: {
    id: string;
    workspaceId: string;
    source: 'git';
    command: string;
    requestHash: string;
    paths?: string[];
  }) => Promise<PermissionApprovalEvent | null>;
};

export type RemoteForgeApiOptions = {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  tokenProvider?: () => string | undefined | Promise<string | undefined>;
  traceSink?: TraceSink;
  workspaceProvider?: () => WorkspaceProfile | null | Promise<WorkspaceProfile | null>;
  approvalAdapter?: RemoteForgeApprovalAdapter;
  mergePolicyProvider?: () => RemoteForgeMergePolicy | Promise<RemoteForgeMergePolicy>;
  mergeAuditSink?: (event: RemoteForgeMergeAuditEvent) => void | Promise<void>;
};

type PageResult<T> = {
  collection: RemoteForgeCollection<T>;
  errors: RemoteForgeErrorV1[];
};

class RemoteForgeRequestError extends Error {
  constructor(readonly envelope: RemoteForgeErrorV1) {
    super(envelope.safeMessage);
  }
}

const complete = (): RemoteForgeCompleteness => ({ state: 'complete', reasons: [] });
const unavailable = (...reasons: RemoteForgeCompleteness['reasons']): RemoteForgeCompleteness => ({
  state: 'unavailable',
  reasons,
});

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function repositorySegment(value: unknown): string | undefined {
  const text = boundedString(value, 100);
  return text && /^[A-Za-z0-9_.-]+$/.test(text) && text !== '.' && text !== '..' ? text : undefined;
}

function validRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && !value.includes('\\')
    && !value.split('/').some((part) => !part || part === '.' || part === '..')
    && /^[A-Za-z0-9._/-]+$/.test(value);
}

function validateRepositoryPayload(payload: RemoteForgeRepositoryPayload): { owner: string; repository: string } {
  if (payload.provider !== 'github') throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request' }));
  const owner = repositorySegment(payload.owner);
  const repository = repositorySegment(payload.repository);
  if (!owner || !repository) throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request' }));
  return { owner, repository };
}

function statusErrorCode(status: number, rateLimited: boolean): RemoteForgeErrorCode {
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 401) return 'authentication_required';
  if (status === 403 && rateLimited) return 'rate_limited';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'upstream_unavailable';
  return 'unknown';
}

function defaultBaseUrl(): string {
  if (process.env.VERSE_CLAW_E2E === '1') {
    const override = process.env.CLAWX_REMOTE_FORGE_BASE_URL?.trim();
    if (override) return override;
  }
  return 'https://api.github.com';
}

async function readBodyWithLimit(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > REMOTE_FORGE_READ_LIMITS.maxResponseBytes) {
    throw new RemoteForgeRequestError(createRemoteForgeErrorV1({
      code: 'truncated_response',
      requestId: response.headers.get('x-github-request-id'),
    }));
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > REMOTE_FORGE_READ_LIMITS.maxResponseBytes) {
        await reader.cancel();
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({
          code: 'truncated_response',
          requestId: response.headers.get('x-github-request-id'),
        }));
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function githubFileStatus(value: unknown): GitPatchFileStatus {
  switch (value) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'renamed':
    case 'copied': return value;
    default: return 'unknown';
  }
}

function capability(authentication: RemoteForgeCapabilityMatrix['authentication']): RemoteForgeCapabilityMatrix {
  return {
    protocol: 'github-rest',
    authentication,
    pullRequestRead: 'unknown',
    commitsRead: 'unknown',
    filesRead: 'unknown',
    diffRead: 'unknown',
    checksRead: 'unknown',
    reviewsRead: 'unknown',
    contentRead: 'unknown',
    protectionRead: 'unknown',
  };
}

function capabilityFromCompleteness(value: RemoteForgeCompleteness): RemoteForgeCapabilityMatrix['pullRequestRead'] {
  if (value.state === 'complete') return 'supported';
  return value.reasons.includes('request_failed') ? 'unavailable' : 'unknown';
}

function aggregateCompleteness(values: RemoteForgeCompleteness[]): RemoteForgeCompleteness {
  const reasons = [...new Set(values.flatMap((value) => value.reasons))];
  if (values.every((value) => value.state === 'complete')) return complete();
  if (values.some((value) => value.state === 'unavailable')) return { state: 'unavailable', reasons };
  if (values.some((value) => value.state === 'truncated')) return { state: 'truncated', reasons };
  return { state: 'incomplete', reasons };
}

function normalizeDetail(raw: JsonRecord, number: number): RemoteForgePullRequestDetail {
  const head = isRecord(raw.head) ? raw.head : {};
  const base = isRecord(raw.base) ? raw.base : {};
  const user = isRecord(raw.user) ? raw.user : {};
  const merged = raw.merged === true;
  const state = merged ? 'merged' : raw.state === 'open' || raw.state === 'closed' ? raw.state : 'unknown';
  return {
    number,
    title: boundedString(raw.title, 500) ?? `Pull request #${number}`,
    state,
    url: boundedString(raw.html_url, 2_000),
    author: boundedString(user.login, 200),
    body: boundedString(raw.body, 20_000),
    draft: raw.draft === true,
    headRef: boundedString(head.ref, 500) ?? '',
    headSha: boundedString(head.sha, 100) ?? null,
    baseRef: boundedString(base.ref, 500) ?? '',
    baseSha: boundedString(base.sha, 100) ?? null,
    mergeable: typeof raw.mergeable === 'boolean' ? raw.mergeable : null,
    mergeableState: boundedString(raw.mergeable_state, 100) ?? 'unknown',
    updatedAt: boundedString(raw.updated_at, 100),
  };
}

function normalizeCommit(value: unknown): RemoteForgeCommit | undefined {
  if (!isRecord(value)) return undefined;
  const sha = boundedString(value.sha, 100);
  const commit = isRecord(value.commit) ? value.commit : {};
  const author = isRecord(commit.author) ? commit.author : {};
  const user = isRecord(value.author) ? value.author : {};
  if (!sha) return undefined;
  return {
    sha,
    message: boundedString(commit.message, 2_000) ?? '',
    author: boundedString(user.login, 200) ?? boundedString(author.name, 200),
    authoredAt: boundedString(author.date, 100),
  };
}

function normalizeFile(value: unknown): RemoteForgeFile | undefined {
  if (!isRecord(value)) return undefined;
  const path = boundedString(value.filename, 4_096);
  if (!path || !isRepositoryRelativePosixPath(path)) return undefined;
  const previousPath = boundedString(value.previous_filename, 4_096);
  return {
    path,
    ...(previousPath && isRepositoryRelativePosixPath(previousPath) ? { previousPath } : {}),
    status: githubFileStatus(value.status),
    additions: integer(value.additions),
    deletions: integer(value.deletions),
    changes: integer(value.changes),
    patchAvailable: typeof value.patch === 'string' && value.patch.length > 0,
  };
}

function normalizeCheck(value: unknown): RemoteForgeCheck | undefined {
  if (!isRecord(value)) return undefined;
  const id = String(value.id ?? '').trim();
  const name = boundedString(value.name, 500);
  if (!id || !name) return undefined;
  const status = value.status === 'queued' || value.status === 'in_progress' || value.status === 'completed'
    ? value.status
    : 'unknown';
  return {
    id,
    name,
    status,
    conclusion: boundedString(value.conclusion, 100) ?? null,
    url: boundedString(value.html_url ?? value.details_url, 2_000),
  };
}

function normalizeReview(value: unknown): RemoteForgeReview | undefined {
  if (!isRecord(value)) return undefined;
  const id = String(value.id ?? '').trim();
  if (!id) return undefined;
  const user = isRecord(value.user) ? value.user : {};
  const rawState = boundedString(value.state, 100)?.toLowerCase();
  const state = rawState === 'approved'
    || rawState === 'changes_requested'
    || rawState === 'commented'
    || rawState === 'dismissed'
    || rawState === 'pending'
    ? rawState
    : 'unknown';
  return {
    id,
    author: boundedString(user.login, 200),
    state,
    submittedAt: boundedString(value.submitted_at, 100),
    commitSha: boundedString(value.commit_id, 100),
  };
}

function normalizeProtection(value: unknown): RemoteForgeBranchProtection {
  if (!isRecord(value)) {
    return {
      state: 'unknown',
      requiredApprovals: null,
      requiredStatusChecks: [],
      requireConversationResolution: null,
      strictStatusChecks: null,
    };
  }
  const reviews = isRecord(value.required_pull_request_reviews) ? value.required_pull_request_reviews : {};
  const statusChecks = isRecord(value.required_status_checks) ? value.required_status_checks : {};
  const contexts = Array.isArray(statusChecks.contexts)
    ? statusChecks.contexts.flatMap((entry) => typeof entry === 'string' ? [entry.slice(0, 500)] : [])
    : [];
  const conversation = isRecord(value.required_conversation_resolution) ? value.required_conversation_resolution : {};
  return {
    state: 'known',
    requiredApprovals: integer(reviews.required_approving_review_count),
    requiredStatusChecks: [...new Set(contexts)].sort(),
    requireConversationResolution: typeof conversation.enabled === 'boolean' ? conversation.enabled : false,
    strictStatusChecks: typeof statusChecks.strict === 'boolean' ? statusChecks.strict : false,
  };
}

function computeReadiness(input: {
  detail: RemoteForgePullRequestDetail;
  checks: RemoteForgeCollection<RemoteForgeCheck>;
  reviews: RemoteForgeCollection<RemoteForgeReview>;
  protection: RemoteForgeBranchProtection;
  evidence: RemoteForgeCompleteness[];
}): RemoteForgeReadiness {
  const reasons: RemoteForgeReadinessReason[] = [];
  if (!input.detail.headSha) reasons.push('missing_head');
  if (input.detail.mergeable === null) reasons.push('mergeability_unknown');
  if (input.protection.state === 'unknown') reasons.push('protection_unknown');
  if (input.evidence.some((value) => value.state !== 'complete')) reasons.push('incomplete_evidence');
  if (input.detail.draft) reasons.push('draft');
  if (input.detail.mergeable === false || input.detail.mergeableState === 'dirty') reasons.push('conflict');
  if (input.detail.mergeableState === 'behind') reasons.push('behind');
  if (input.checks.items.some((check) => check.status !== 'completed' || check.conclusion == null)) reasons.push('checks_pending');
  if (input.checks.items.some((check) => check.status === 'completed'
    && check.conclusion != null
    && !['success', 'neutral', 'skipped'].includes(check.conclusion))) reasons.push('checks_failed');
  const approvedAuthors = new Set(input.reviews.items
    .filter((review) => review.state === 'approved' && review.author)
    .map((review) => review.author));
  if ((input.protection.requiredApprovals ?? 0) > approvedAuthors.size) reasons.push('approvals_missing');
  if (input.reviews.items.some((review) => review.state === 'changes_requested')) reasons.push('changes_requested');
  if (input.protection.requireConversationResolution) reasons.push('discussion_state_unknown');

  const unique = [...new Set(reasons)];
  const unknownReasons: RemoteForgeReadinessReason[] = [
    'missing_head',
    'mergeability_unknown',
    'protection_unknown',
    'incomplete_evidence',
    'discussion_state_unknown',
  ];
  const blockedReasons: RemoteForgeReadinessReason[] = [
    'draft',
    'conflict',
    'behind',
    'checks_failed',
    'approvals_missing',
    'changes_requested',
  ];
  const state = unique.some((reason) => unknownReasons.includes(reason))
    ? 'unknown'
    : unique.some((reason) => blockedReasons.includes(reason))
      ? 'blocked'
      : unique.includes('checks_pending')
        ? 'pending'
        : 'ready';
  return { state, reasons: unique, headSha: input.detail.headSha };
}

function unavailableArtifact(file: RemoteForgeFile): GitPatchArtifactV1 {
  return {
    schema: GIT_PATCH_ARTIFACT_SCHEMA,
    file: file.path,
    status: file.status,
    ...(file.status === 'renamed' || file.status === 'copied'
      ? { oldPath: file.previousPath, newPath: file.path }
      : {}),
    contentKind: 'unknown',
    hunks: [],
    completeness: 'unavailable',
    message: 'Remote patch evidence is unavailable.',
  };
}

type NormalizedMutationBase = {
  provider: 'github';
  owner: string;
  repository: string;
  number: number;
  expectedHeadSha: string;
  approvalId?: string;
};

type NormalizedMutation = NormalizedMutationBase & (
  | { action: 'review_submit'; event: 'comment' | 'approve' | 'request_changes'; body: string }
  | { action: 'line_comment_create'; path: string; side: 'LEFT' | 'RIGHT'; line: number; body: string; diffHunk?: string }
  | { action: 'comment_edit'; commentId: number; body: string }
  | { action: 'thread_reply'; commentId: number; body: string }
  | { action: 'metadata_update'; expectedUpdatedAt: string; title?: string; body?: string; labels?: string[]; reviewers?: string[] }
);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function mutationText(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength || /\0/.test(value)) return undefined;
  if (!allowEmpty && !value.trim()) return undefined;
  return value;
}

function mutationToken(value: unknown, maxLength = 256): string | undefined {
  const text = mutationText(value, maxLength);
  return text && /^[A-Za-z0-9._:-]+$/.test(text) ? text : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function mutationNames(value: unknown, maxItems: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const names = value.map((entry) => mutationText(entry, REMOTE_FORGE_MUTATION_LIMITS.maxNameChars));
  if (names.some((entry) => entry === undefined)) return undefined;
  return [...new Set(names as string[])].sort((left, right) => left.localeCompare(right));
}

function normalizeMutation(payload: RemoteForgeMutationPayload, requestId: string): NormalizedMutation {
  const raw: Record<string, unknown> = isRecord(payload as unknown)
    ? payload as unknown as Record<string, unknown>
    : {};
  const repository = validateRepositoryPayload(raw as RemoteForgeRepositoryPayload);
  const number = positiveInteger(raw.number);
  const expectedHeadSha = mutationToken(raw.expectedHeadSha, 100);
  const approvalId = raw.approvalId === undefined ? undefined : mutationToken(raw.approvalId, 256);
  if (!number || !expectedHeadSha || (raw.approvalId !== undefined && !approvalId)) {
    throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request', requestId }));
  }
  const base: NormalizedMutationBase = {
    provider: 'github',
    ...repository,
    number,
    expectedHeadSha,
    ...(approvalId ? { approvalId } : {}),
  };
  const body = mutationText(raw.body, REMOTE_FORGE_MUTATION_LIMITS.maxBodyChars);
  switch (raw.action) {
    case 'review_submit': {
      const event = raw.event === 'comment' || raw.event === 'approve' || raw.event === 'request_changes'
        ? raw.event
        : undefined;
      if (!event || body === undefined) break;
      return { ...base, action: raw.action, event, body };
    }
    case 'line_comment_create': {
      const path = mutationText(raw.path, 4_096);
      const side = raw.side === 'LEFT' || raw.side === 'RIGHT' ? raw.side : undefined;
      const line = positiveInteger(raw.line);
      const diffHunk = raw.diffHunk === undefined
        ? undefined
        : mutationText(raw.diffHunk, REMOTE_FORGE_MUTATION_LIMITS.maxDiffHunkChars);
      if (!path || !isRepositoryRelativePosixPath(path) || !side || !line || body === undefined
        || (raw.diffHunk !== undefined && diffHunk === undefined)) break;
      return { ...base, action: raw.action, path, side, line, body, ...(diffHunk ? { diffHunk } : {}) };
    }
    case 'comment_edit':
    case 'thread_reply': {
      const commentId = positiveInteger(raw.commentId);
      if (!commentId || body === undefined) break;
      return { ...base, action: raw.action, commentId, body };
    }
    case 'metadata_update': {
      const expectedUpdatedAt = mutationText(raw.expectedUpdatedAt, 100);
      const title = raw.title === undefined
        ? undefined
        : mutationText(raw.title, REMOTE_FORGE_MUTATION_LIMITS.maxTitleChars);
      const metadataBody = raw.body === undefined
        ? undefined
        : mutationText(raw.body, REMOTE_FORGE_MUTATION_LIMITS.maxBodyChars, true);
      const labels = mutationNames(raw.labels, REMOTE_FORGE_MUTATION_LIMITS.maxLabels);
      const reviewers = mutationNames(raw.reviewers, REMOTE_FORGE_MUTATION_LIMITS.maxReviewers);
      if (!expectedUpdatedAt
        || (raw.title !== undefined && title === undefined)
        || (raw.body !== undefined && metadataBody === undefined)
        || (raw.labels !== undefined && labels === undefined)
        || (raw.reviewers !== undefined && reviewers === undefined)
        || (title === undefined && metadataBody === undefined)) break;
      return {
        ...base,
        action: raw.action,
        expectedUpdatedAt,
        ...(title !== undefined ? { title } : {}),
        ...(metadataBody !== undefined ? { body: metadataBody } : {}),
        ...(labels !== undefined ? { labels } : {}),
        ...(reviewers !== undefined ? { reviewers } : {}),
      };
    }
    default:
      break;
  }
  throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request', requestId }));
}

function payloadForDigest(mutation: NormalizedMutation): Record<string, unknown> {
  const { approvalId: _approvalId, ...payload } = mutation;
  return payload;
}

function mutationBinding(mutation: NormalizedMutation): RemoteForgeMutationBinding {
  return {
    provider: 'github',
    repository: `${mutation.owner}/${mutation.repository}`,
    pullRequestNumber: mutation.number,
    action: mutation.action,
    expectedHeadSha: mutation.expectedHeadSha,
    ...(mutation.action === 'metadata_update' ? { expectedUpdatedAt: mutation.expectedUpdatedAt } : {}),
    payloadDigest: sha256(JSON.stringify(payloadForDigest(mutation))),
  };
}

function bindingHash(binding: RemoteForgeMutationBinding): string {
  return sha256(JSON.stringify(binding));
}

function mutationCommand(binding: RemoteForgeMutationBinding): string {
  return `remote-forge:${binding.action}:${binding.repository}#${binding.pullRequestNumber}@${binding.expectedHeadSha}`;
}

function mutationPaths(mutation: NormalizedMutation): string[] | undefined {
  return mutation.action === 'line_comment_create' ? [mutation.path] : undefined;
}

function errorEnvelope(error: unknown, requestId: string): RemoteForgeErrorV1 {
  return error instanceof RemoteForgeRequestError
    ? error.envelope
    : createRemoteForgeErrorV1({ code: 'internal', requestId });
}

function ambiguousWrite(error: RemoteForgeErrorV1): boolean {
  return ['network_error', 'timeout', 'upstream_unavailable', 'incomplete_response', 'truncated_response', 'unknown']
    .includes(error.code);
}

type NormalizedMerge = {
  provider: 'github';
  owner: string;
  repository: string;
  number: number;
  expectedHeadSha: string;
  strategy: RemoteForgeMergeStrategy;
  commitTitle?: string;
  commitMessage?: string;
  approvalId?: string;
  expectedReadinessDigest?: string;
  expectedPolicyDigest?: string;
};

function defaultMergePolicy(): RemoteForgeMergePolicy {
  if (process.env.VERSE_CLAW_E2E !== '1') {
    return { allowedRepositories: [], agentMergeEnabled: false, version: 'pre-canary-disabled' };
  }
  const allowedRepositories = (process.env.CLAWX_REMOTE_FORGE_SANDBOX_REPOSITORIES ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return {
    allowedRepositories,
    agentMergeEnabled: process.env.CLAWX_REMOTE_FORGE_AGENT_MERGE_ENABLED === '1',
    version: 'e2e-fixture',
  };
}

function normalizeMerge(payload: RemoteForgeMergePayload, requestId: string): NormalizedMerge {
  const raw: Record<string, unknown> = isRecord(payload as unknown)
    ? payload as unknown as Record<string, unknown>
    : {};
  const repository = validateRepositoryPayload(raw as RemoteForgeRepositoryPayload);
  const number = positiveInteger(raw.number);
  const expectedHeadSha = mutationToken(raw.expectedHeadSha, 100);
  const strategy = raw.strategy === 'merge' || raw.strategy === 'squash' || raw.strategy === 'rebase'
    ? raw.strategy
    : undefined;
  const commitTitle = raw.commitTitle === undefined
    ? undefined
    : mutationText(raw.commitTitle, REMOTE_FORGE_MUTATION_LIMITS.maxTitleChars);
  const commitMessage = raw.commitMessage === undefined
    ? undefined
    : mutationText(raw.commitMessage, REMOTE_FORGE_MUTATION_LIMITS.maxBodyChars, true);
  const approvalId = raw.approvalId === undefined ? undefined : mutationToken(raw.approvalId, 256);
  const expectedReadinessDigest = raw.expectedReadinessDigest === undefined
    ? undefined
    : mutationToken(raw.expectedReadinessDigest, 64);
  const expectedPolicyDigest = raw.expectedPolicyDigest === undefined
    ? undefined
    : mutationToken(raw.expectedPolicyDigest, 64);
  const invalidApprovalBinding = approvalId
    ? !expectedReadinessDigest || !expectedPolicyDigest
    : expectedReadinessDigest !== undefined || expectedPolicyDigest !== undefined;
  if (!number || !expectedHeadSha || !strategy
    || (raw.commitTitle !== undefined && commitTitle === undefined)
    || (raw.commitMessage !== undefined && commitMessage === undefined)
    || (raw.approvalId !== undefined && !approvalId)
    || invalidApprovalBinding) {
    throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request', requestId }));
  }
  return {
    provider: 'github',
    ...repository,
    number,
    expectedHeadSha,
    strategy,
    ...(commitTitle !== undefined ? { commitTitle } : {}),
    ...(commitMessage !== undefined ? { commitMessage } : {}),
    ...(approvalId ? { approvalId } : {}),
    ...(expectedReadinessDigest ? { expectedReadinessDigest } : {}),
    ...(expectedPolicyDigest ? { expectedPolicyDigest } : {}),
  };
}

function normalizedMergePayloadDigest(merge: NormalizedMerge): string {
  return sha256(JSON.stringify({
    provider: merge.provider,
    owner: merge.owner,
    repository: merge.repository,
    number: merge.number,
    expectedHeadSha: merge.expectedHeadSha,
    strategy: merge.strategy,
    ...(merge.commitTitle !== undefined ? { commitTitle: merge.commitTitle } : {}),
    ...(merge.commitMessage !== undefined ? { commitMessage: merge.commitMessage } : {}),
  }));
}

function normalizedPolicy(policy: RemoteForgeMergePolicy): RemoteForgeMergePolicy {
  const allowedRepositories = [...new Set(policy.allowedRepositories
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value)))]
    .sort((left, right) => left.localeCompare(right));
  return {
    allowedRepositories,
    agentMergeEnabled: policy.agentMergeEnabled === true,
    ...(policy.version ? { version: policy.version.slice(0, 100) } : {}),
  };
}

function mergePolicyDigest(policy: RemoteForgeMergePolicy): string {
  return sha256(JSON.stringify(normalizedPolicy(policy)));
}

function evaluateMergePolicy(
  policy: RemoteForgeMergePolicy,
  repository: string,
  initiator: RemoteForgeMergeExecutionContext['initiator'],
): RemoteForgeMergePolicyDecision {
  const normalized = normalizedPolicy(policy);
  const repositoryAllowed = normalized.allowedRepositories.includes(repository.toLowerCase());
  const reason = !repositoryAllowed
    ? 'repository_not_allowed'
    : initiator === 'agent' && !normalized.agentMergeEnabled
      ? 'agent_merge_disabled'
      : 'allowed';
  return {
    allowed: reason === 'allowed',
    reason,
    agentMergeEnabled: normalized.agentMergeEnabled,
    sandboxOnly: true,
  };
}

function mergeReadinessDigest(pullRequest: RemoteForgePullRequestReadV1): string {
  return sha256(JSON.stringify({
    repository: pullRequest.repository,
    headSha: pullRequest.detail.headSha,
    draft: pullRequest.detail.draft,
    mergeable: pullRequest.detail.mergeable,
    mergeableState: pullRequest.detail.mergeableState,
    readiness: pullRequest.readiness,
    completeness: pullRequest.completeness,
    checks: [...pullRequest.checks.items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, name, status, conclusion }) => ({ id, name, status, conclusion })),
    reviews: [...pullRequest.reviews.items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, author, state, commitSha }) => ({ id, author, state, commitSha })),
    protection: pullRequest.protection,
  }));
}

function mergeBinding(
  merge: NormalizedMerge,
  readinessDigest: string,
  sandboxPolicyDigest: string,
): RemoteForgeMutationBinding {
  return {
    provider: 'github',
    repository: `${merge.owner}/${merge.repository}`,
    pullRequestNumber: merge.number,
    action: 'merge',
    expectedHeadSha: merge.expectedHeadSha,
    strategy: merge.strategy,
    readinessDigest,
    sandboxPolicyDigest,
    payloadDigest: normalizedMergePayloadDigest(merge),
  };
}

function mergeReadinessError(
  pullRequest: RemoteForgePullRequestReadV1 | undefined,
  requestId: string,
): RemoteForgeErrorV1 | undefined {
  if (!pullRequest || pullRequest.completeness.state !== 'complete' || pullRequest.readiness.state === 'unknown') {
    return createRemoteForgeErrorV1({ code: 'incomplete_response', requestId });
  }
  if (pullRequest.readiness.state !== 'ready') {
    return createRemoteForgeErrorV1({ code: 'conflict', requestId });
  }
  return undefined;
}

export function createRemoteForgeApi(options: RemoteForgeApiOptions = {}): RemoteForgeApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? defaultBaseUrl();
  const traceSink = options.traceSink ?? (() => undefined);
  const tokenProvider = options.tokenProvider ?? (() => process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim());
  const workspaceProvider = options.workspaceProvider ?? getActiveWorkspaceProfile;
  const approvalAdapter = options.approvalAdapter ?? {
    create: createPermissionApproval,
    consume: consumeApprovedPermissionApproval,
  };
  const mergePolicyProvider = options.mergePolicyProvider ?? defaultMergePolicy;
  const mergeAuditSink = options.mergeAuditSink ?? ((event: RemoteForgeMergeAuditEvent) => {
    traceSink({
      requestId: event.requestId,
      operation: 'merge-audit',
      method: 'PUT',
      route: '/repos/{owner}/{repository}/pulls/{number}/merge',
      durationMs: 0,
      completeness: 'complete',
      payloadDigest: event.binding.payloadDigest,
    });
  });

  async function request(input: {
    requestId: string;
    operation: string;
    route: string;
    path: string;
    accept?: string;
    method?: RemoteForgeRequestTrace['method'];
    body?: string;
    headers?: Record<string, string>;
    payloadDigest?: string;
  }): Promise<{ response: Response; text: string }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_FORGE_READ_LIMITS.timeoutMs);
    let status: number | undefined;
    let state: RemoteForgeCompleteness['state'] = 'unavailable';
    try {
      const token = await tokenProvider();
      const method = input.method ?? 'GET';
      if (input.body && Buffer.byteLength(input.body, 'utf8') > REMOTE_FORGE_MUTATION_LIMITS.maxRequestBytes) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request', requestId: input.requestId }));
      }
      const response = await fetchImpl(new URL(input.path, baseUrl), {
        method,
        headers: {
          Accept: input.accept ?? 'application/vnd.github+json',
          'User-Agent': 'Verse-Claw-Remote-Forge',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...input.headers,
        },
        ...(input.body !== undefined ? { body: input.body } : {}),
        signal: controller.signal,
      });
      status = response.status;
      if (!response.ok) {
        const code = statusErrorCode(response.status, response.headers.get('x-ratelimit-remaining') === '0');
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({
          code,
          requestId: response.headers.get('x-github-request-id') ?? input.requestId,
          httpStatus: response.status,
        }));
      }
      const text = await readBodyWithLimit(response);
      state = 'complete';
      return { response, text };
    } catch (error) {
      if (error instanceof RemoteForgeRequestError) throw error;
      const code = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error';
      throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code, requestId: input.requestId }));
    } finally {
      clearTimeout(timeout);
      traceSink({
        requestId: input.requestId,
        operation: input.operation,
        method: input.method ?? 'GET',
        route: input.route,
        status,
        durationMs: Math.max(0, Date.now() - startedAt),
        completeness: state,
        ...(input.payloadDigest ? { payloadDigest: input.payloadDigest } : {}),
      });
    }
  }

  async function requestJson(input: Parameters<typeof request>[0]): Promise<{ response: Response; value: unknown }> {
    const result = await request(input);
    try {
      return { response: result.response, value: JSON.parse(result.text) };
    } catch {
      throw new RemoteForgeRequestError(createRemoteForgeErrorV1({
        code: 'incomplete_response',
        requestId: input.requestId,
      }));
    }
  }

  async function paginated<T>(input: {
    requestId: string;
    operation: string;
    route: string;
    path: string;
    arrayKey?: string;
    normalize: (value: unknown) => T | undefined;
    key: (value: T) => string;
  }): Promise<PageResult<T>> {
    const items = new Map<string, T>();
    const errors: RemoteForgeErrorV1[] = [];
    let sawMalformedItem = false;
    for (let page = 1; page <= REMOTE_FORGE_READ_LIMITS.maxPages; page += 1) {
      try {
        const separator = input.path.includes('?') ? '&' : '?';
        const { value } = await requestJson({
          requestId: input.requestId,
          operation: input.operation,
          route: input.route,
          path: `${input.path}${separator}per_page=${REMOTE_FORGE_READ_LIMITS.perPage}&page=${page}`,
        });
        const rawItems = input.arrayKey && isRecord(value) ? value[input.arrayKey] : value;
        if (!Array.isArray(rawItems)) {
          return {
            collection: { items: [...items.values()], completeness: { state: 'incomplete', reasons: ['malformed_response'] } },
            errors,
          };
        }
        for (const raw of rawItems) {
          const normalized = input.normalize(raw);
          if (!normalized) {
            sawMalformedItem = true;
            continue;
          }
          items.set(input.key(normalized), normalized);
          if (items.size >= REMOTE_FORGE_READ_LIMITS.maxItems) {
            return {
              collection: {
                items: [...items.values()],
                completeness: {
                  state: 'truncated',
                  reasons: sawMalformedItem ? ['item_limit', 'malformed_response'] : ['item_limit'],
                  truncatedAt: items.size,
                },
              },
              errors,
            };
          }
        }
        if (rawItems.length < REMOTE_FORGE_READ_LIMITS.perPage) {
          return {
            collection: {
              items: [...items.values()],
              completeness: sawMalformedItem
                ? { state: 'incomplete', reasons: ['malformed_response'] }
                : complete(),
            },
            errors,
          };
        }
        if (page === REMOTE_FORGE_READ_LIMITS.maxPages) {
          return {
            collection: {
              items: [...items.values()],
              completeness: {
                state: 'truncated',
                reasons: sawMalformedItem ? ['page_limit', 'malformed_response'] : ['page_limit'],
                truncatedAt: items.size,
              },
            },
            errors,
          };
        }
      } catch (error) {
        const envelope = error instanceof RemoteForgeRequestError
          ? error.envelope
          : createRemoteForgeErrorV1({ code: 'unknown', requestId: input.requestId });
        errors.push(envelope);
        return {
          collection: {
            items: [...items.values()],
            completeness: {
              state: 'incomplete',
              reasons: sawMalformedItem ? ['pagination_failed', 'malformed_response'] : ['pagination_failed'],
            },
          },
          errors,
        };
      }
    }
    return { collection: { items: [...items.values()], completeness: complete() }, errors };
  }

  async function readCapabilities(payload: RemoteForgeRepositoryPayload) {
    const requestId = `remote-forge-${randomUUID()}`;
    let matrix = capability('anonymous');
    try {
      matrix = capability((await tokenProvider()) ? 'token' : 'anonymous');
      const { owner, repository } = validateRepositoryPayload(payload);
      await requestJson({
        requestId,
        operation: 'repository-capabilities',
        route: '/repos/{owner}/{repository}',
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
      });
      return {
        success: true,
        capability: matrix,
      };
    } catch (error) {
      const envelope = error instanceof RemoteForgeRequestError
        ? error.envelope
        : createRemoteForgeErrorV1({ code: 'unknown', requestId });
      const state = envelope.code === 'authentication_required' || envelope.code === 'permission_denied'
        ? 'unauthorized'
        : envelope.code === 'not_found' ? 'unavailable' : 'unknown';
      return {
        success: false,
        capability: Object.fromEntries(Object.entries(matrix).map(([key, value]) => (
          key === 'protocol' || key === 'authentication' ? [key, value] : [key, state]
        ))) as RemoteForgeCapabilityMatrix,
        error: envelope,
      };
    }
  }

  async function readPullRequest(payload: RemoteForgePullRequestReadPayload): Promise<RemoteForgePullRequestReadResult> {
    const requestId = `remote-forge-${randomUUID()}`;
    try {
      const { owner, repository } = validateRepositoryPayload(payload);
      const number = Number.isInteger(payload.number) && payload.number > 0 ? payload.number : 0;
      if (!number) throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request', requestId }));
      const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
      const { value: detailValue } = await requestJson({
        requestId,
        operation: 'pull-request-detail',
        route: '/repos/{owner}/{repository}/pulls/{number}',
        path: `${prefix}/pulls/${number}`,
      });
      if (!isRecord(detailValue)) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }));
      }
      const detail = normalizeDetail(detailValue, number);
      const [commitsResult, filesResult, reviewsResult, checksResult, diffResult, protectionResult] = await Promise.all([
        paginated({
          requestId,
          operation: 'pull-request-commits',
          route: '/repos/{owner}/{repository}/pulls/{number}/commits',
          path: `${prefix}/pulls/${number}/commits`,
          normalize: normalizeCommit,
          key: (value) => value.sha,
        }),
        paginated({
          requestId,
          operation: 'pull-request-files',
          route: '/repos/{owner}/{repository}/pulls/{number}/files',
          path: `${prefix}/pulls/${number}/files`,
          normalize: normalizeFile,
          key: (value) => value.path,
        }),
        paginated({
          requestId,
          operation: 'pull-request-reviews',
          route: '/repos/{owner}/{repository}/pulls/{number}/reviews',
          path: `${prefix}/pulls/${number}/reviews`,
          normalize: normalizeReview,
          key: (value) => value.id,
        }),
        detail.headSha
          ? paginated({
              requestId,
              operation: 'pull-request-checks',
              route: '/repos/{owner}/{repository}/commits/{sha}/check-runs',
              path: `${prefix}/commits/${encodeURIComponent(detail.headSha)}/check-runs`,
              arrayKey: 'check_runs',
              normalize: normalizeCheck,
              key: (value) => value.id,
            })
          : Promise.resolve({
              collection: { items: [], completeness: unavailable('missing_head') } as RemoteForgeCollection<RemoteForgeCheck>,
              errors: [],
            }),
        request({
          requestId,
          operation: 'pull-request-diff',
          route: '/repos/{owner}/{repository}/pulls/{number}.diff',
          path: `${prefix}/pulls/${number}`,
          accept: 'application/vnd.github.v3.diff',
        }).then(({ text }) => ({ text, error: undefined as RemoteForgeErrorV1 | undefined }))
          .catch((error) => ({
            text: '',
            error: error instanceof RemoteForgeRequestError
              ? error.envelope
              : createRemoteForgeErrorV1({ code: 'unknown', requestId }),
          })),
        detail.baseRef
          ? requestJson({
              requestId,
              operation: 'branch-protection',
              route: '/repos/{owner}/{repository}/branches/{branch}/protection',
              path: `${prefix}/branches/${encodeURIComponent(detail.baseRef)}/protection`,
            }).then(({ value }) => ({ protection: normalizeProtection(value), error: undefined as RemoteForgeErrorV1 | undefined }))
            .catch((error) => ({
              protection: normalizeProtection(undefined),
              error: error instanceof RemoteForgeRequestError
                ? error.envelope
                : createRemoteForgeErrorV1({ code: 'unknown', requestId }),
            }))
          : Promise.resolve({ protection: normalizeProtection(undefined), error: undefined }),
      ]);

      let patchArtifacts: GitPatchArtifactV1[] = [];
      let diffCompleteness = diffResult.error ? unavailable('request_failed') : complete();
      if (!diffResult.error) {
        const adapted = adaptUnifiedDiffToGitPatchArtifacts({ patch: diffResult.text, sourceCompleteness: 'complete' });
        if (adapted.kind === 'unavailable') {
          diffCompleteness = unavailable('malformed_response');
        } else {
          patchArtifacts = adapted.artifacts;
          const artifactPaths = new Set(patchArtifacts.map((artifact) => artifact.file));
          const filePaths = new Set(filesResult.collection.items.map((file) => file.path));
          if (artifactPaths.size !== filePaths.size || [...filePaths].some((path) => !artifactPaths.has(path))) {
            diffCompleteness = { state: 'incomplete', reasons: ['diff_mismatch'] };
            patchArtifacts = filesResult.collection.items.map(unavailableArtifact);
          } else if (filesResult.collection.items.some((file) => !file.patchAvailable)) {
            diffCompleteness = { state: 'incomplete', reasons: ['missing_patch'] };
            patchArtifacts = patchArtifacts.map((artifact) => {
              const file = filesResult.collection.items.find((entry) => entry.path === artifact.file);
              return file?.patchAvailable ? artifact : unavailableArtifact(file!);
            });
          }
        }
      }

      const protectionCompleteness = protectionResult.protection.state === 'known'
        ? complete()
        : unavailable('protection_unknown');
      const evidence = [
        commitsResult.collection.completeness,
        filesResult.collection.completeness,
        reviewsResult.collection.completeness,
        checksResult.collection.completeness,
        diffCompleteness,
        protectionCompleteness,
      ];
      const readiness = computeReadiness({
        detail,
        checks: checksResult.collection,
        reviews: reviewsResult.collection,
        protection: protectionResult.protection,
        evidence,
      });
      const authentication = (await tokenProvider()) ? 'token' : 'anonymous';
      const matrix = capability(authentication);
      matrix.pullRequestRead = 'supported';
      matrix.commitsRead = capabilityFromCompleteness(commitsResult.collection.completeness);
      matrix.filesRead = capabilityFromCompleteness(filesResult.collection.completeness);
      matrix.reviewsRead = capabilityFromCompleteness(reviewsResult.collection.completeness);
      matrix.checksRead = capabilityFromCompleteness(checksResult.collection.completeness);
      matrix.diffRead = capabilityFromCompleteness(diffCompleteness);
      matrix.protectionRead = capabilityFromCompleteness(protectionCompleteness);
      matrix.contentRead = 'supported';

      const pullRequest: RemoteForgePullRequestReadV1 = {
        schema: 'RemoteForgePullRequestRead/v1',
        requestId,
        provider: 'github',
        repository: `${owner}/${repository}`,
        capability: matrix,
        detail,
        commits: commitsResult.collection,
        files: filesResult.collection,
        patchArtifacts,
        diffCompleteness,
        checks: checksResult.collection,
        reviews: reviewsResult.collection,
        protection: protectionResult.protection,
        readiness,
        completeness: aggregateCompleteness(evidence),
      };
      return {
        success: pullRequest.completeness.state === 'complete',
        pullRequest,
        ...(!pullRequest.completeness || pullRequest.completeness.state === 'complete'
          ? {}
          : {
              error: diffResult.error
                ?? protectionResult.error
                ?? commitsResult.errors[0]
                ?? filesResult.errors[0]
                ?? reviewsResult.errors[0]
                ?? checksResult.errors[0]
                ?? createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }),
            }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof RemoteForgeRequestError
          ? error.envelope
          : createRemoteForgeErrorV1({ code: 'internal', requestId }),
      };
    }
  }

  async function readOneContent(
    repository: { owner: string; repository: string },
    ref: string,
    path: string,
    requestId: string,
  ): Promise<RemoteForgeContent> {
    try {
      const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`;
      const { value } = await requestJson({
        requestId,
        operation: 'repository-content',
        route: '/repos/{owner}/{repository}/contents/{path}',
        path: `${prefix}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
      });
      if (!isRecord(value)) throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }));
      const size = typeof value.size === 'number' && Number.isFinite(value.size) ? Math.max(0, Math.floor(value.size)) : null;
      const encoding = boundedString(value.encoding, 50)?.toLowerCase();
      const providerContent = typeof value.content === 'string' ? value.content : undefined;
      if ((size ?? 0) > REMOTE_FORGE_READ_LIMITS.maxDecodedContentBytes) {
        return { path, ref, kind: 'truncated', size, completeness: { state: 'truncated', reasons: ['response_too_large'] } };
      }
      if (providerContent === undefined) {
        return { path, ref, kind: 'unavailable', size, completeness: unavailable('malformed_response') };
      }
      if (encoding !== 'base64') {
        return {
          path,
          ref,
          kind: 'base64',
          size,
          base64: Buffer.from(providerContent, 'utf8').toString('base64'),
          completeness: complete(),
        };
      }
      const rawContent = providerContent.replace(/\s/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(rawContent)) {
        return { path, ref, kind: 'unavailable', size, completeness: unavailable('malformed_response') };
      }
      const bytes = Buffer.from(rawContent, 'base64');
      if (bytes.byteLength > REMOTE_FORGE_READ_LIMITS.maxDecodedContentBytes) {
        return { path, ref, kind: 'truncated', size, completeness: { state: 'truncated', reasons: ['response_too_large'] } };
      }
      if (size != null && size !== bytes.byteLength) {
        return { path, ref, kind: 'unavailable', size, completeness: unavailable('malformed_response') };
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { path, ref, kind: 'utf8', size, text, completeness: complete() };
      } catch {
        return { path, ref, kind: 'binary', size, base64: rawContent, completeness: complete() };
      }
    } catch {
      return { path, ref, kind: 'unavailable', size: null, completeness: unavailable('request_failed') };
    }
  }

  async function readContents(payload: RemoteForgeContentReadPayload) {
    const requestId = `remote-forge-${randomUUID()}`;
    try {
      const repository = validateRepositoryPayload(payload);
      if (!validRef(payload.ref)
        || !Array.isArray(payload.paths)
        || payload.paths.length === 0
        || payload.paths.length > REMOTE_FORGE_READ_LIMITS.maxContentPaths
        || payload.paths.some((path) => !isRepositoryRelativePosixPath(path))) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'invalid_request', requestId }));
      }
      const uniquePaths = [...new Set(payload.paths)];
      const contents = new Array<RemoteForgeContent>(uniquePaths.length);
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(REMOTE_FORGE_READ_LIMITS.contentConcurrency, uniquePaths.length) },
        async () => {
          while (cursor < uniquePaths.length) {
            const index = cursor;
            cursor += 1;
            contents[index] = await readOneContent(repository, payload.ref, uniquePaths[index]!, requestId);
          }
        },
      );
      await Promise.all(workers);
      const success = contents.every((content) => content.completeness.state === 'complete');
      return {
        success,
        contents,
        ...(success ? {} : { error: createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }) }),
      };
    } catch (error) {
      return {
        success: false,
        contents: [],
        error: error instanceof RemoteForgeRequestError
          ? error.envelope
          : createRemoteForgeErrorV1({ code: 'internal', requestId }),
      };
    }
  }

  async function readMutationGuard(mutation: NormalizedMutation, requestId: string): Promise<{
    detail: RemoteForgePullRequestDetail;
    etag?: string;
  }> {
    const prefix = `/repos/${encodeURIComponent(mutation.owner)}/${encodeURIComponent(mutation.repository)}`;
    const { response, value } = await requestJson({
      requestId,
      operation: 'mutation-guard',
      route: '/repos/{owner}/{repository}/pulls/{number}',
      path: `${prefix}/pulls/${mutation.number}`,
    });
    if (!isRecord(value)) {
      throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }));
    }
    return {
      detail: normalizeDetail(value, mutation.number),
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
    };
  }

  function enforceMutationGuard(mutation: NormalizedMutation, detail: RemoteForgePullRequestDetail, requestId: string): void {
    if (!detail.headSha || detail.headSha !== mutation.expectedHeadSha) {
      throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'stale_head', requestId }));
    }
    if (mutation.action === 'metadata_update'
      && (!detail.updatedAt || detail.updatedAt !== mutation.expectedUpdatedAt)) {
      throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'conflict', requestId }));
    }
  }

  async function writeJson(input: {
    requestId: string;
    operation: string;
    route: string;
    path: string;
    method: 'POST' | 'PATCH' | 'PUT';
    body: unknown;
    payloadDigest: string;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    const serialized = JSON.stringify(input.body);
    const { value } = await requestJson({
      requestId: input.requestId,
      operation: input.operation,
      route: input.route,
      path: input.path,
      method: input.method,
      body: serialized,
      payloadDigest: input.payloadDigest,
      headers: {
        'Content-Type': 'application/json',
        ...input.headers,
      },
    });
    return value;
  }

  function commentSnapshot(mutation: NormalizedMutation) {
    if (mutation.action === 'metadata_update') return undefined;
    const snapshot = {
      headSha: mutation.expectedHeadSha,
      bodyDigest: sha256(mutation.body),
    };
    return mutation.action === 'line_comment_create'
      ? {
          ...snapshot,
          path: mutation.path,
          side: mutation.side,
          line: mutation.line,
          ...(mutation.diffHunk ? { diffHunk: mutation.diffHunk } : {}),
        }
      : snapshot;
  }

  async function executeMutation(
    mutation: NormalizedMutation,
    binding: RemoteForgeMutationBinding,
    requestId: string,
    guard: { detail: RemoteForgePullRequestDetail; etag?: string },
  ): Promise<RemoteForgeMutationV1> {
    const prefix = `/repos/${encodeURIComponent(mutation.owner)}/${encodeURIComponent(mutation.repository)}`;
    const effects: RemoteForgeMutationEffect[] = [];
    try {
      let value: unknown;
      switch (mutation.action) {
        case 'review_submit':
          value = await writeJson({
            requestId,
            operation: mutation.action,
            route: '/repos/{owner}/{repository}/pulls/{number}/reviews',
            path: `${prefix}/pulls/${mutation.number}/reviews`,
            method: 'POST',
            body: {
              commit_id: mutation.expectedHeadSha,
              event: mutation.event === 'request_changes' ? 'REQUEST_CHANGES' : mutation.event.toUpperCase(),
              body: mutation.body,
            },
            payloadDigest: binding.payloadDigest,
          });
          break;
        case 'line_comment_create':
          value = await writeJson({
            requestId,
            operation: mutation.action,
            route: '/repos/{owner}/{repository}/pulls/{number}/comments',
            path: `${prefix}/pulls/${mutation.number}/comments`,
            method: 'POST',
            body: {
              commit_id: mutation.expectedHeadSha,
              path: mutation.path,
              side: mutation.side,
              line: mutation.line,
              body: mutation.body,
            },
            payloadDigest: binding.payloadDigest,
          });
          break;
        case 'comment_edit':
          value = await writeJson({
            requestId,
            operation: mutation.action,
            route: '/repos/{owner}/{repository}/pulls/comments/{commentId}',
            path: `${prefix}/pulls/comments/${mutation.commentId}`,
            method: 'PATCH',
            body: { body: mutation.body },
            payloadDigest: binding.payloadDigest,
          });
          break;
        case 'thread_reply':
          value = await writeJson({
            requestId,
            operation: mutation.action,
            route: '/repos/{owner}/{repository}/pulls/{number}/comments/{commentId}/replies',
            path: `${prefix}/pulls/${mutation.number}/comments/${mutation.commentId}/replies`,
            method: 'POST',
            body: { body: mutation.body },
            payloadDigest: binding.payloadDigest,
          });
          break;
        case 'metadata_update':
          value = await writeJson({
            requestId,
            operation: mutation.action,
            route: '/repos/{owner}/{repository}/pulls/{number}',
            path: `${prefix}/pulls/${mutation.number}`,
            method: 'PATCH',
            body: {
              ...(mutation.title !== undefined ? { title: mutation.title } : {}),
              ...(mutation.body !== undefined ? { body: mutation.body } : {}),
            },
            payloadDigest: binding.payloadDigest,
            ...(guard.etag ? { headers: { 'If-Match': guard.etag } } : {}),
          });
          break;
      }
      if (!isRecord(value)) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }));
      }
      const remoteId = mutationText(String(value.id ?? ''), 200);
      effects.push({
        id: 'primary',
        operation: mutation.action,
        state: 'succeeded',
        ...(remoteId ? { remoteId } : {}),
      });
    } catch (error) {
      const envelope = errorEnvelope(error, requestId);
      const state = ambiguousWrite(envelope) ? 'unknown' : 'failed';
      effects.push({ id: 'primary', operation: mutation.action, state, error: envelope });
      return {
        schema: 'RemoteForgeMutation/v1',
        requestId,
        binding,
        state,
        effects,
        reconciliation: state === 'unknown'
          ? { required: true, state: 'manual_check_required', reasons: ['primary_unknown'] }
          : { required: false, state: 'not_needed', reasons: [] },
        ...(commentSnapshot(mutation) ? { commentSnapshot: commentSnapshot(mutation) } : {}),
      };
    }

    const runFollowUp = async (
      id: RemoteForgeMutationEffect['id'],
      operation: string,
      run: () => Promise<void>,
    ) => {
      try {
        await run();
        effects.push({ id, operation, state: 'succeeded' });
      } catch (error) {
        const envelope = errorEnvelope(error, requestId);
        effects.push({ id, operation, state: ambiguousWrite(envelope) ? 'unknown' : 'failed', error: envelope });
      }
    };

    if (mutation.action === 'metadata_update' && mutation.labels !== undefined) {
      await runFollowUp('labels', 'metadata_labels', async () => {
        await writeJson({
          requestId,
          operation: 'metadata-labels',
          route: '/repos/{owner}/{repository}/issues/{number}/labels',
          path: `${prefix}/issues/${mutation.number}/labels`,
          method: 'PUT',
          body: { labels: mutation.labels },
          payloadDigest: binding.payloadDigest,
        });
      });
    }
    if (mutation.action === 'metadata_update' && mutation.reviewers !== undefined) {
      await runFollowUp('reviewers', 'metadata_reviewers', async () => {
        await writeJson({
          requestId,
          operation: 'metadata-reviewers',
          route: '/repos/{owner}/{repository}/pulls/{number}/requested_reviewers',
          path: `${prefix}/pulls/${mutation.number}/requested_reviewers`,
          method: 'POST',
          body: { reviewers: mutation.reviewers },
          payloadDigest: binding.payloadDigest,
        });
      });
    }

    await runFollowUp('refresh', 'mutation_refresh', async () => {
      const refreshed = await readMutationGuard(mutation, requestId);
      if (!refreshed.detail.headSha || refreshed.detail.headSha !== mutation.expectedHeadSha) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'stale_head', requestId }));
      }
    });

    const followUpFailures = effects.filter((effect) => effect.id !== 'primary' && effect.state !== 'succeeded');
    const reasons = [...new Set(followUpFailures.map((effect) => (
      effect.id === 'refresh' ? 'refresh_failed' as const : 'follow_up_failed' as const
    )))];
    return {
      schema: 'RemoteForgeMutation/v1',
      requestId,
      binding,
      state: followUpFailures.length > 0 ? 'partial' : 'succeeded',
      effects,
      reconciliation: followUpFailures.length > 0
        ? { required: true, state: 'refresh_required', reasons }
        : { required: false, state: 'not_needed', reasons: [] },
      ...(commentSnapshot(mutation) ? { commentSnapshot: commentSnapshot(mutation) } : {}),
    };
  }

  async function mutatePullRequest(payload: RemoteForgeMutationPayload) {
    const requestId = `remote-forge-${randomUUID()}`;
    let binding: RemoteForgeMutationBinding | undefined;
    try {
      const mutation = normalizeMutation(payload, requestId);
      binding = mutationBinding(mutation);
      const requestHash = bindingHash(binding);
      const command = mutationCommand(binding);
      const paths = mutationPaths(mutation);
      const workspace = requireWorkspace(await workspaceProvider());

      if (!mutation.approvalId) {
        const guard = await readMutationGuard(mutation, requestId);
        enforceMutationGuard(mutation, guard.detail, requestId);
        const approval = await approvalAdapter.create({
          workspace,
          source: 'git',
          risk: 'dangerous',
          command,
          requestHash,
          paths,
          reason: 'Remote Forge external write requires exact one-time approval.',
          paramsPreview: `${binding.repository}#${binding.pullRequestNumber} ${binding.action} head=${binding.expectedHeadSha} digest=${binding.payloadDigest}`,
        });
        return {
          success: false,
          blocked: true,
          approvalRequired: true,
          approval,
          binding,
        };
      }

      const approved = await approvalAdapter.consume({
        id: mutation.approvalId,
        workspaceId: workspace.id,
        source: 'git',
        command,
        requestHash,
        paths,
      });
      if (!approved) {
        return {
          success: false,
          blocked: true,
          binding,
          error: createRemoteForgeErrorV1({ code: 'permission_denied', requestId }),
        };
      }

      const guard = await readMutationGuard(mutation, requestId);
      enforceMutationGuard(mutation, guard.detail, requestId);
      const result = await executeMutation(mutation, binding, requestId, guard);
      const firstFailure = result.effects.find((effect) => effect.state === 'failed' || effect.state === 'unknown');
      return {
        success: result.state === 'succeeded' || result.state === 'partial',
        binding,
        mutation: result,
        ...(firstFailure?.error ? { error: firstFailure.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        ...(binding ? { binding } : {}),
        error: errorEnvelope(error, requestId),
      };
    }
  }

  async function executeMerge(
    merge: NormalizedMerge,
    binding: RemoteForgeMutationBinding,
    requestId: string,
  ): Promise<RemoteForgeMutationV1> {
    const prefix = `/repos/${encodeURIComponent(merge.owner)}/${encodeURIComponent(merge.repository)}`;
    const effects: RemoteForgeMutationEffect[] = [];
    let remoteSha: string | undefined;
    try {
      const value = await writeJson({
        requestId,
        operation: 'merge',
        route: '/repos/{owner}/{repository}/pulls/{number}/merge',
        path: `${prefix}/pulls/${merge.number}/merge`,
        method: 'PUT',
        body: {
          sha: merge.expectedHeadSha,
          merge_method: merge.strategy,
          ...(merge.commitTitle !== undefined ? { commit_title: merge.commitTitle } : {}),
          ...(merge.commitMessage !== undefined ? { commit_message: merge.commitMessage } : {}),
        },
        payloadDigest: binding.payloadDigest,
      });
      if (!isRecord(value)) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }));
      }
      if (value.merged !== true) {
        throw new RemoteForgeRequestError(createRemoteForgeErrorV1({ code: 'conflict', requestId }));
      }
      remoteSha = mutationToken(value.sha, 100);
      effects.push({
        id: 'primary',
        operation: 'merge',
        state: 'succeeded',
        ...(remoteSha ? { remoteId: remoteSha } : {}),
      });
    } catch (error) {
      const envelope = errorEnvelope(error, requestId);
      const state = ambiguousWrite(envelope) ? 'unknown' : 'failed';
      const providerConflict = envelope.code === 'conflict' || envelope.code === 'stale_head';
      effects.push({ id: 'primary', operation: 'merge', state, error: envelope });
      return {
        schema: 'RemoteForgeMutation/v1',
        requestId,
        binding,
        state,
        effects,
        reconciliation: state === 'unknown'
          ? { required: true, state: 'manual_check_required', reasons: ['primary_unknown'] }
          : providerConflict
            ? { required: true, state: 'refresh_required', reasons: ['provider_conflict'] }
            : { required: false, state: 'not_needed', reasons: [] },
      };
    }

    const runFollowUp = async (
      id: 'refresh' | 'audit',
      operation: string,
      run: () => Promise<void>,
    ) => {
      try {
        await run();
        effects.push({ id, operation, state: 'succeeded' });
      } catch (error) {
        const envelope = errorEnvelope(error, requestId);
        effects.push({ id, operation, state: ambiguousWrite(envelope) ? 'unknown' : 'failed', error: envelope });
      }
    };

    await runFollowUp('refresh', 'merge_refresh', async () => {
      const refreshed = await readPullRequest({
        provider: 'github',
        owner: merge.owner,
        repository: merge.repository,
        number: merge.number,
      });
      if (!refreshed.pullRequest || refreshed.pullRequest.detail.state !== 'merged') {
        throw new RemoteForgeRequestError(refreshed.error
          ?? createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }));
      }
    });
    await runFollowUp('audit', 'merge_audit', async () => {
      await mergeAuditSink({ requestId, binding, ...(remoteSha ? { remoteSha } : {}) });
    });

    const followUpFailures = effects.filter((effect) => effect.id !== 'primary' && effect.state !== 'succeeded');
    const reasons = [...new Set(followUpFailures.map((effect) => (
      effect.id === 'audit' ? 'audit_failed' as const : 'refresh_failed' as const
    )))];
    return {
      schema: 'RemoteForgeMutation/v1',
      requestId,
      binding,
      state: followUpFailures.length > 0 ? 'partial' : 'succeeded',
      effects,
      reconciliation: followUpFailures.length > 0
        ? { required: true, state: 'refresh_required', reasons }
        : { required: false, state: 'not_needed', reasons: [] },
    };
  }

  async function mergePullRequest(
    payload: RemoteForgeMergePayload,
    context: RemoteForgeMergeExecutionContext = { initiator: 'user' },
  ): Promise<RemoteForgeMergeResult> {
    const requestId = `remote-forge-${randomUUID()}`;
    let binding: RemoteForgeMutationBinding | undefined;
    try {
      const merge = normalizeMerge(payload, requestId);
      const workspace = requireWorkspace(await workspaceProvider());

      if (!merge.approvalId) {
        const readResult = await readPullRequest({
          provider: 'github',
          owner: merge.owner,
          repository: merge.repository,
          number: merge.number,
        });
        const policy = await mergePolicyProvider();
        const policyDecision = evaluateMergePolicy(
          policy,
          `${merge.owner}/${merge.repository}`,
          context.initiator,
        );
        const pullRequest = readResult.pullRequest;
        const readiness = pullRequest?.readiness;
        if (!policyDecision.allowed) {
          return {
            success: false,
            blocked: true,
            policy: policyDecision,
            ...(readiness ? { readiness } : {}),
            error: createRemoteForgeErrorV1({ code: 'permission_denied', requestId }),
          };
        }
        if (!pullRequest?.detail.headSha || pullRequest.detail.headSha !== merge.expectedHeadSha) {
          return {
            success: false,
            blocked: true,
            policy: policyDecision,
            ...(readiness ? { readiness } : {}),
            error: createRemoteForgeErrorV1({ code: 'stale_head', requestId }),
          };
        }
        const readinessError = mergeReadinessError(pullRequest, requestId);
        if (readinessError) {
          return {
            success: false,
            blocked: true,
            policy: policyDecision,
            ...(readiness ? { readiness } : {}),
            error: readinessError,
          };
        }
        binding = mergeBinding(merge, mergeReadinessDigest(pullRequest), mergePolicyDigest(policy));
        const requestHash = bindingHash(binding);
        const command = mutationCommand(binding);
        const approval = await approvalAdapter.create({
          workspace,
          source: 'git',
          risk: 'dangerous',
          command,
          requestHash,
          reason: 'Remote Forge sandbox merge requires exact one-time approval.',
          paramsPreview: `${binding.repository}#${binding.pullRequestNumber} merge=${binding.strategy} head=${binding.expectedHeadSha} readiness=${binding.readinessDigest} digest=${binding.payloadDigest}`,
        });
        return {
          success: false,
          blocked: true,
          approvalRequired: true,
          approval,
          binding,
          readiness,
          policy: policyDecision,
        };
      }

      binding = mergeBinding(merge, merge.expectedReadinessDigest!, merge.expectedPolicyDigest!);
      const approved = await approvalAdapter.consume({
        id: merge.approvalId,
        workspaceId: workspace.id,
        source: 'git',
        command: mutationCommand(binding),
        requestHash: bindingHash(binding),
      });
      if (!approved || Date.now() - (approved.resolvedAt ?? approved.requestedAt) > REMOTE_FORGE_MERGE_APPROVAL_TTL_MS) {
        return {
          success: false,
          blocked: true,
          binding,
          error: createRemoteForgeErrorV1({ code: 'permission_denied', requestId }),
        };
      }

      const readResult = await readPullRequest({
        provider: 'github',
        owner: merge.owner,
        repository: merge.repository,
        number: merge.number,
      });
      const policy = await mergePolicyProvider();
      const policyDecision = evaluateMergePolicy(
        policy,
        `${merge.owner}/${merge.repository}`,
        context.initiator,
      );
      const pullRequest = readResult.pullRequest;
      const readiness = pullRequest?.readiness;
      if (!policyDecision.allowed || mergePolicyDigest(policy) !== binding.sandboxPolicyDigest) {
        return {
          success: false,
          blocked: true,
          binding,
          policy: policyDecision,
          ...(readiness ? { readiness } : {}),
          error: createRemoteForgeErrorV1({ code: 'permission_denied', requestId }),
        };
      }
      if (!pullRequest?.detail.headSha || pullRequest.detail.headSha !== merge.expectedHeadSha) {
        return {
          success: false,
          blocked: true,
          binding,
          policy: policyDecision,
          ...(readiness ? { readiness } : {}),
          error: createRemoteForgeErrorV1({ code: 'stale_head', requestId }),
        };
      }
      const readinessError = mergeReadinessError(pullRequest, requestId);
      if (readinessError || mergeReadinessDigest(pullRequest) !== binding.readinessDigest) {
        return {
          success: false,
          blocked: true,
          binding,
          policy: policyDecision,
          ...(readiness ? { readiness } : {}),
          error: readinessError ?? createRemoteForgeErrorV1({ code: 'conflict', requestId }),
        };
      }

      const result = await executeMerge(merge, binding, requestId);
      const firstFailure = result.effects.find((effect) => effect.state === 'failed' || effect.state === 'unknown');
      return {
        success: result.state === 'succeeded' || result.state === 'partial',
        binding,
        mutation: result,
        readiness,
        policy: policyDecision,
        ...(firstFailure?.error ? { error: firstFailure.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        ...(binding ? { binding } : {}),
        error: errorEnvelope(error, requestId),
      };
    }
  }

  return {
    capabilities: readCapabilities,
    readPullRequest,
    readContents,
    mutatePullRequest,
    mergePullRequest,
  };
}
