export const GIT_PATCH_ARTIFACT_SCHEMA = 'GitPatchArtifact/v1' as const;
export const REMOTE_FORGE_ERROR_SCHEMA = 'RemoteForgeError/v1' as const;

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

export type RemoteForgeErrorV1 = {
  schema: typeof REMOTE_FORGE_ERROR_SCHEMA;
  code: RemoteForgeErrorCode;
  retryable: boolean;
  requestId: string;
  httpStatus?: number;
  safeMessage: string;
};

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

function isSingleLineText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isOptionalSingleLineText(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || isSingleLineText(value, maxLength);
}

function isRepositoryRelativePosixPath(value: unknown): value is string {
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
    && typeof value.retryable === 'boolean'
    && isSingleLineText(value.requestId, 256)
    && (value.httpStatus === undefined
      || (typeof value.httpStatus === 'number'
        && Number.isInteger(value.httpStatus)
        && value.httpStatus >= 100
        && value.httpStatus <= 599))
    && isSingleLineText(value.safeMessage, 1_000);
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
