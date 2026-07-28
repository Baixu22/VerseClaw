export const GIT_PATCH_ARTIFACT_SCHEMA = 'GitPatchArtifact/v1' as const;
export const REMOTE_FORGE_ERROR_SCHEMA = 'RemoteForgeError/v1' as const;
export const REMOTE_FORGE_PULL_REQUEST_READ_SCHEMA = 'RemoteForgePullRequestRead/v1' as const;
export const REMOTE_FORGE_MUTATION_SCHEMA = 'RemoteForgeMutation/v1' as const;

export const GIT_PATCH_FILE_STATUSES = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'unmerged',
  'unknown',
] as const;

export const GIT_PATCH_CONTENT_KINDS = ['text', 'binary', 'metadata', 'unknown'] as const;
export const GIT_PATCH_COMPLETENESS_STATES = ['complete', 'truncated', 'unavailable'] as const;
export const GIT_PATCH_LINE_KINDS = ['context', 'addition', 'deletion', 'no-newline'] as const;

export type GitPatchFileStatus = (typeof GIT_PATCH_FILE_STATUSES)[number];
export type GitPatchContentKind = (typeof GIT_PATCH_CONTENT_KINDS)[number];
export type GitPatchCompleteness = (typeof GIT_PATCH_COMPLETENESS_STATES)[number];
export type GitPatchLineKind = (typeof GIT_PATCH_LINE_KINDS)[number];

export type GitPatchLineV1 = {
  kind: GitPatchLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type GitPatchHunkV1 = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading?: string;
  lines: GitPatchLineV1[];
};

export type GitPatchLineageV1 = {
  requestId: string;
  mutationId?: string;
  journalEntryId?: string;
};

/**
 * One changed-file observation. Multi-file Git or forge responses carry an
 * ordered array of these artifacts instead of introducing another patch shape.
 */
export type GitPatchArtifactV1 = {
  schema: typeof GIT_PATCH_ARTIFACT_SCHEMA;
  file: string;
  status: GitPatchFileStatus;
  oldPath?: string;
  newPath?: string;
  contentKind: GitPatchContentKind;
  hunks: GitPatchHunkV1[];
  patch?: string;
  message?: string;
  completeness: GitPatchCompleteness;
  lineage?: GitPatchLineageV1;
};

export const REMOTE_FORGE_ERROR_CODES = [
  'invalid_request',
  'authentication_required',
  'permission_denied',
  'not_found',
  'rate_limited',
  'conflict',
  'stale_head',
  'incomplete_response',
  'truncated_response',
  'upstream_unavailable',
  'network_error',
  'timeout',
  'cancelled',
  'internal',
  'unknown',
] as const;

export type RemoteForgeErrorCode = (typeof REMOTE_FORGE_ERROR_CODES)[number];

export const REMOTE_FORGE_SAFE_MESSAGES: Record<RemoteForgeErrorCode, string> = {
  invalid_request: 'The request is invalid.',
  authentication_required: 'Authentication is required.',
  permission_denied: 'The requested operation is not permitted.',
  not_found: 'The requested resource was not found.',
  rate_limited: 'The service rate limit was reached. Retry later.',
  conflict: 'The request conflicts with the current resource state.',
  stale_head: 'The pull request head changed. Refresh before continuing.',
  incomplete_response: 'The response is incomplete and cannot be used safely.',
  truncated_response: 'The response exceeded a safety limit and was truncated.',
  upstream_unavailable: 'The remote service is unavailable. Retry later.',
  network_error: 'The remote service could not be reached. Retry later.',
  timeout: 'The remote service request timed out. Retry later.',
  cancelled: 'The request was cancelled.',
  internal: 'The operation failed safely.',
  unknown: 'The operation returned an unrecognized failure.',
};

export type RemoteForgeErrorV1 = {
  schema: typeof REMOTE_FORGE_ERROR_SCHEMA;
  code: RemoteForgeErrorCode;
  retryable: boolean;
  requestId: string;
  httpStatus?: number;
  safeMessage: string;
};

export const REMOTE_FORGE_COMPLETENESS_STATES = [
  'complete',
  'incomplete',
  'truncated',
  'unavailable',
] as const;
export type RemoteForgeCompletenessState = (typeof REMOTE_FORGE_COMPLETENESS_STATES)[number];

export const REMOTE_FORGE_INCOMPLETE_REASONS = [
  'request_failed',
  'pagination_failed',
  'page_limit',
  'item_limit',
  'response_too_large',
  'malformed_response',
  'missing_head',
  'missing_patch',
  'diff_mismatch',
  'protection_unknown',
  'mergeability_unknown',
] as const;
export type RemoteForgeIncompleteReason = (typeof REMOTE_FORGE_INCOMPLETE_REASONS)[number];

export type RemoteForgeCompleteness = {
  state: RemoteForgeCompletenessState;
  reasons: RemoteForgeIncompleteReason[];
  truncatedAt?: number;
};

export type RemoteForgeCollection<T> = {
  items: T[];
  completeness: RemoteForgeCompleteness;
};

export type RemoteForgeCapabilityState = 'supported' | 'unauthorized' | 'unavailable' | 'unknown';
export type RemoteForgeCapabilityMatrix = {
  protocol: 'github-rest';
  authentication: 'anonymous' | 'token';
  pullRequestRead: RemoteForgeCapabilityState;
  commitsRead: RemoteForgeCapabilityState;
  filesRead: RemoteForgeCapabilityState;
  diffRead: RemoteForgeCapabilityState;
  checksRead: RemoteForgeCapabilityState;
  reviewsRead: RemoteForgeCapabilityState;
  contentRead: RemoteForgeCapabilityState;
  protectionRead: RemoteForgeCapabilityState;
};

export type RemoteForgePullRequestDetail = {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged' | 'unknown';
  url?: string;
  author?: string;
  body?: string;
  draft: boolean;
  headRef: string;
  headSha: string | null;
  baseRef: string;
  baseSha: string | null;
  mergeable: boolean | null;
  mergeableState: string;
  updatedAt?: string;
};

export type RemoteForgeCommit = {
  sha: string;
  message: string;
  author?: string;
  authoredAt?: string;
};

export type RemoteForgeFile = {
  path: string;
  previousPath?: string;
  status: GitPatchFileStatus;
  additions: number;
  deletions: number;
  changes: number;
  patchAvailable: boolean;
};

export type RemoteForgeCheck = {
  id: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'unknown';
  conclusion: string | null;
  url?: string;
};

export type RemoteForgeReview = {
  id: string;
  author?: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending' | 'unknown';
  submittedAt?: string;
  commitSha?: string;
};

export type RemoteForgeBranchProtection = {
  state: 'known' | 'unknown';
  requiredApprovals: number | null;
  requiredStatusChecks: string[];
  requireConversationResolution: boolean | null;
  strictStatusChecks: boolean | null;
};

export const REMOTE_FORGE_READINESS_STATES = ['ready', 'blocked', 'pending', 'unknown'] as const;
export type RemoteForgeReadinessState = (typeof REMOTE_FORGE_READINESS_STATES)[number];
export const REMOTE_FORGE_READINESS_REASONS = [
  'draft',
  'conflict',
  'behind',
  'checks_pending',
  'checks_failed',
  'approvals_missing',
  'changes_requested',
  'discussion_state_unknown',
  'missing_head',
  'mergeability_unknown',
  'protection_unknown',
  'incomplete_evidence',
] as const;
export type RemoteForgeReadinessReason = (typeof REMOTE_FORGE_READINESS_REASONS)[number];
export type RemoteForgeReadiness = {
  state: RemoteForgeReadinessState;
  reasons: RemoteForgeReadinessReason[];
  headSha: string | null;
};

export type RemoteForgePullRequestReadV1 = {
  schema: typeof REMOTE_FORGE_PULL_REQUEST_READ_SCHEMA;
  requestId: string;
  provider: 'github';
  repository: string;
  capability: RemoteForgeCapabilityMatrix;
  detail: RemoteForgePullRequestDetail;
  commits: RemoteForgeCollection<RemoteForgeCommit>;
  files: RemoteForgeCollection<RemoteForgeFile>;
  patchArtifacts: GitPatchArtifactV1[];
  diffCompleteness: RemoteForgeCompleteness;
  checks: RemoteForgeCollection<RemoteForgeCheck>;
  reviews: RemoteForgeCollection<RemoteForgeReview>;
  protection: RemoteForgeBranchProtection;
  readiness: RemoteForgeReadiness;
  completeness: RemoteForgeCompleteness;
};

export type RemoteForgeContentKind = 'utf8' | 'binary' | 'base64' | 'truncated' | 'unavailable';
export type RemoteForgeContent = {
  path: string;
  ref: string;
  kind: RemoteForgeContentKind;
  size: number | null;
  text?: string;
  base64?: string;
  completeness: RemoteForgeCompleteness;
};

export type RemoteForgeRequestTrace = {
  requestId: string;
  operation: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  route: string;
  status?: number;
  durationMs: number;
  completeness: RemoteForgeCompletenessState;
  payloadDigest?: string;
};

export const REMOTE_FORGE_MUTATION_ACTIONS = [
  'review_submit',
  'line_comment_create',
  'comment_edit',
  'thread_reply',
  'metadata_update',
  'merge',
] as const;
export type RemoteForgeMutationAction = (typeof REMOTE_FORGE_MUTATION_ACTIONS)[number];

export const REMOTE_FORGE_MERGE_STRATEGIES = ['merge', 'squash', 'rebase'] as const;
export type RemoteForgeMergeStrategy = (typeof REMOTE_FORGE_MERGE_STRATEGIES)[number];
export type RemoteForgeMergePolicyReason = 'allowed' | 'repository_not_allowed' | 'agent_merge_disabled';
export type RemoteForgeMergePolicyDecision = {
  allowed: boolean;
  reason: RemoteForgeMergePolicyReason;
  agentMergeEnabled: boolean;
  sandboxOnly: true;
};

export type RemoteForgeMutationEffectState = 'not_attempted' | 'succeeded' | 'failed' | 'unknown';
export type RemoteForgeMutationEffect = {
  id: 'primary' | 'labels' | 'reviewers' | 'refresh' | 'audit';
  operation: string;
  state: RemoteForgeMutationEffectState;
  remoteId?: string;
  error?: RemoteForgeErrorV1;
};

export type RemoteForgeMutationBinding = {
  provider: 'github';
  repository: string;
  pullRequestNumber: number;
  action: RemoteForgeMutationAction;
  expectedHeadSha: string;
  expectedUpdatedAt?: string;
  strategy?: RemoteForgeMergeStrategy;
  readinessDigest?: string;
  sandboxPolicyDigest?: string;
  payloadDigest: string;
};

export type RemoteForgeCommentSnapshot = {
  headSha: string;
  bodyDigest: string;
  path?: string;
  side?: 'LEFT' | 'RIGHT';
  line?: number;
  diffHunk?: string;
};

export type RemoteForgeReconciliation = {
  required: boolean;
  state: 'not_needed' | 'refresh_required' | 'manual_check_required';
  reasons: Array<'primary_unknown' | 'follow_up_failed' | 'refresh_failed' | 'audit_failed' | 'provider_conflict'>;
};

export type RemoteForgeMutationV1 = {
  schema: typeof REMOTE_FORGE_MUTATION_SCHEMA;
  requestId: string;
  binding: RemoteForgeMutationBinding;
  state: 'succeeded' | 'partial' | 'failed' | 'unknown';
  effects: RemoteForgeMutationEffect[];
  reconciliation: RemoteForgeReconciliation;
  commentSnapshot?: RemoteForgeCommentSnapshot;
};

const REMOTE_FORGE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const REMOTE_FORGE_RETRYABLE_CODES = new Set<RemoteForgeErrorCode>([
  'rate_limited',
  'upstream_unavailable',
  'network_error',
  'timeout',
]);

export function remoteForgeErrorIsRetryable(code: RemoteForgeErrorCode): boolean {
  return REMOTE_FORGE_RETRYABLE_CODES.has(code);
}

export function isRemoteForgeRequestId(value: unknown): value is string {
  return typeof value === 'string' && REMOTE_FORGE_REQUEST_ID_PATTERN.test(value);
}

export function remoteForgeHttpStatusMatches(code: RemoteForgeErrorCode, status: number): boolean {
  switch (code) {
    case 'invalid_request': return status === 400 || status === 422;
    case 'authentication_required': return status === 401;
    case 'permission_denied': return status === 403;
    case 'not_found': return status === 404;
    case 'rate_limited': return status === 403 || status === 429;
    case 'conflict': return status === 409;
    case 'stale_head': return status === 409 || status === 412;
    case 'upstream_unavailable': return status >= 500 && status <= 599;
    case 'timeout': return status === 408 || status === 504;
    case 'internal': return status >= 500 && status <= 599;
    default: return false;
  }
}

export type VersionedContractDecodeError = 'unsupported_schema' | 'invalid_payload';

export type VersionedContractDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VersionedContractDecodeError; schema?: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEnumValue<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isSingleLineText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !hasControlCharacter(value);
}

function isOptionalSingleLineText(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || isSingleLineText(value, maxLength);
}

export function isRepositoryRelativePosixPath(value: unknown): value is string {
  if (!isSingleLineText(value, 4_096)
    || value.startsWith('/')
    || /^[A-Za-z]:\//.test(value)
    || value.includes('\\')) {
    return false;
  }

  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isOptionalRepositoryRelativePosixPath(value: unknown): value is string | undefined {
  return value === undefined || isRepositoryRelativePosixPath(value);
}

function isLogicalLineText(value: unknown): value is string {
  return typeof value === 'string' && !/[\r\n\0]/.test(value);
}

function isGitPatchLineV1(value: unknown): value is GitPatchLineV1 {
  if (!isRecord(value)
    || !isEnumValue(GIT_PATCH_LINE_KINDS, value.kind)
    || !isLogicalLineText(value.text)) {
    return false;
  }

  switch (value.kind) {
    case 'context':
      return isPositiveInteger(value.oldLine) && isPositiveInteger(value.newLine);
    case 'addition':
      return value.oldLine === null && isPositiveInteger(value.newLine);
    case 'deletion':
      return isPositiveInteger(value.oldLine) && value.newLine === null;
    case 'no-newline':
      return value.oldLine === null && value.newLine === null;
  }
}

function isGitPatchHunkV1(value: unknown): value is GitPatchHunkV1 {
  return isRecord(value)
    && isNonNegativeInteger(value.oldStart)
    && isNonNegativeInteger(value.oldLines)
    && isNonNegativeInteger(value.newStart)
    && isNonNegativeInteger(value.newLines)
    && isOptionalSingleLineText(value.heading, 1_000)
    && Array.isArray(value.lines)
    && value.lines.length > 0
    && value.lines.every(isGitPatchLineV1);
}

function completeHunkCountsMatch(hunk: GitPatchHunkV1): boolean {
  const observedOld = hunk.lines.filter((line) => line.kind === 'context' || line.kind === 'deletion').length;
  const observedNew = hunk.lines.filter((line) => line.kind === 'context' || line.kind === 'addition').length;
  return observedOld === hunk.oldLines && observedNew === hunk.newLines;
}

function hunkLineNumbersAreSequential(hunk: GitPatchHunkV1): boolean {
  let expectedOldLine = hunk.oldStart;
  let expectedNewLine = hunk.newStart;

  for (const line of hunk.lines) {
    switch (line.kind) {
      case 'context':
        if (line.oldLine !== expectedOldLine || line.newLine !== expectedNewLine) return false;
        expectedOldLine += 1;
        expectedNewLine += 1;
        break;
      case 'addition':
        if (line.newLine !== expectedNewLine) return false;
        expectedNewLine += 1;
        break;
      case 'deletion':
        if (line.oldLine !== expectedOldLine) return false;
        expectedOldLine += 1;
        break;
      case 'no-newline':
        break;
    }
  }

  return true;
}

function isGitPatchLineageV1(value: unknown): value is GitPatchLineageV1 {
  return isRecord(value)
    && isSingleLineText(value.requestId, 256)
    && isOptionalSingleLineText(value.mutationId, 256)
    && isOptionalSingleLineText(value.journalEntryId, 256);
}

export function isGitPatchArtifactV1(value: unknown): value is GitPatchArtifactV1 {
  if (!isRecord(value)
    || value.schema !== GIT_PATCH_ARTIFACT_SCHEMA
    || !isRepositoryRelativePosixPath(value.file)
    || !isEnumValue(GIT_PATCH_FILE_STATUSES, value.status)
    || !isOptionalRepositoryRelativePosixPath(value.oldPath)
    || !isOptionalRepositoryRelativePosixPath(value.newPath)
    || !isEnumValue(GIT_PATCH_CONTENT_KINDS, value.contentKind)
    || !isEnumValue(GIT_PATCH_COMPLETENESS_STATES, value.completeness)
    || !Array.isArray(value.hunks)
    || !value.hunks.every(isGitPatchHunkV1)
    || (value.patch !== undefined && typeof value.patch !== 'string')
    || !isOptionalSingleLineText(value.message, 2_000)
    || (value.lineage !== undefined && !isGitPatchLineageV1(value.lineage))) {
    return false;
  }

  const hunks = value.hunks as GitPatchHunkV1[];
  const messageRequired = value.completeness !== 'complete' || value.contentKind !== 'text';
  if (messageRequired && value.message === undefined) return false;
  if (!hunks.every(hunkLineNumbersAreSequential)) return false;
  if (value.contentKind !== 'text' && hunks.length > 0) return false;
  if ((value.contentKind === 'unknown' || value.status === 'unknown') && value.completeness === 'complete') {
    return false;
  }
  if (value.completeness === 'unavailable' && (hunks.length > 0 || value.patch !== undefined)) {
    return false;
  }
  if (value.contentKind === 'text' && value.completeness === 'complete') {
    if (hunks.length === 0 || !hunks.every(completeHunkCountsMatch)) return false;
  }
  if (value.status === 'renamed' || value.status === 'copied') {
    if (value.oldPath === undefined || value.newPath === undefined || value.oldPath === value.newPath) {
      return false;
    }
  }

  return true;
}

export function decodeGitPatchArtifactV1(value: unknown): VersionedContractDecodeResult<GitPatchArtifactV1> {
  if (isGitPatchArtifactV1(value)) return { ok: true, value };
  const schema = isRecord(value) && typeof value.schema === 'string' ? value.schema : undefined;
  return {
    ok: false,
    error: schema !== undefined && schema !== GIT_PATCH_ARTIFACT_SCHEMA
      ? 'unsupported_schema'
      : 'invalid_payload',
    ...(schema ? { schema } : {}),
  };
}

export function isRemoteForgeErrorV1(value: unknown): value is RemoteForgeErrorV1 {
  return isRecord(value)
    && value.schema === REMOTE_FORGE_ERROR_SCHEMA
    && isEnumValue(REMOTE_FORGE_ERROR_CODES, value.code)
    && value.retryable === remoteForgeErrorIsRetryable(value.code)
    && isRemoteForgeRequestId(value.requestId)
    && (value.httpStatus === undefined
      || (typeof value.httpStatus === 'number'
        && Number.isInteger(value.httpStatus)
        && value.httpStatus >= 100
        && value.httpStatus <= 599
        && remoteForgeHttpStatusMatches(value.code, value.httpStatus)))
    && value.safeMessage === REMOTE_FORGE_SAFE_MESSAGES[value.code];
}

export function decodeRemoteForgeErrorV1(value: unknown): VersionedContractDecodeResult<RemoteForgeErrorV1> {
  if (isRemoteForgeErrorV1(value)) return { ok: true, value };
  const schema = isRecord(value) && typeof value.schema === 'string' ? value.schema : undefined;
  return {
    ok: false,
    error: schema !== undefined && schema !== REMOTE_FORGE_ERROR_SCHEMA
      ? 'unsupported_schema'
      : 'invalid_payload',
    ...(schema ? { schema } : {}),
  };
}
