/**
 * Context folding contracts: ContextHandle/v1, ContextExpandRequest/Result/v1,
 * ContextFoldRequest/Result/v1.
 *
 * Pure vocabulary and normalizers. No I/O, no registry, no authority. A handle
 * is a scoped read reference; it never grants tools, writes, memory, or
 * cross-scope access (context-folding-boundary R2/R3). Hashing is injected so
 * this module stays renderer-safe; Main and the runtime pass their own sha256.
 */
import type { RunId, SessionKey, WorkspaceId } from './identity-scope.js';

export const CONTEXT_HANDLE_SCHEMA = 'ContextHandle/v1' as const;
export const CONTEXT_EXPAND_REQUEST_SCHEMA = 'ContextExpandRequest/v1' as const;
export const CONTEXT_EXPAND_RESULT_SCHEMA = 'ContextExpandResult/v1' as const;
export const CONTEXT_FOLD_REQUEST_SCHEMA = 'ContextFoldRequest/v1' as const;
export const CONTEXT_FOLD_RESULT_SCHEMA = 'ContextFoldResult/v1' as const;

/** Config leaf and env override. Default off; rollback is disable-only. */
export const CONTEXT_FOLDING_FLAG_PATH = 'runtime.contextBlock.contextFolding.enabled' as const;
export const CONTEXT_FOLDING_ENV = 'VERSE_CONTEXT_FOLDING' as const;
export const CONTEXT_FOLDING_ROLLBACK = 'disable-only' as const;

/** Pre-registered hard limits. Changing one is a contract change, not a tuning knob. */
export const CONTEXT_FOLDING_LIMITS = {
  expandMaxChars: 20_000,
  expandDefaultChars: 12_000,
  expandMaxBytes: 65_536,
  searchMaxMatches: 20,
  searchContextLines: 2,
  foldResultMaxChars: 8_000,
  rawChildTranscriptMaxChars: 8_000,
  maxRecursiveDepth: 1,
  foldTimeoutMaxMs: 15 * 60_000,
  foldTimeoutDefaultMs: 10 * 60_000,
  foldInputRefsMax: 32,
  foldAllowedToolsMax: 32,
  resourceIdMaxChars: 512,
  objectiveMaxChars: 4_000,
  labelMaxChars: 200,
} as const;

export const CONTEXT_FOLDING_ERROR_CODES = [
  'feature_disabled',
  'invalid_request',
  'invalid_handle',
  'invalid_handle_id',
  'invalid_result',
  'workspace_mismatch',
  'session_mismatch',
  'stale_checksum',
  'missing_resource',
  'ambiguous_selector',
  'expired',
  'expansion_not_allowed',
  'limit_exceeded',
  'owner_unavailable',
  'child_identity_mismatch',
  'duplicate_delivery',
  'unknown_delivery',
  'timeout',
  'cancelled',
  'partial',
  'raw_transcript_rejected',
  'recursion_depth_exceeded',
  'tool_not_allowed',
  'scope_violation',
] as const;
export type ContextFoldingErrorCode = (typeof CONTEXT_FOLDING_ERROR_CODES)[number];

export const CONTEXT_HANDLE_OWNERS = [
  'block-store',
  'context-archive',
  'workspace-file',
  'transcript',
  'compression-artifact',
  'tool-output',
] as const;
export type ContextHandleOwner = (typeof CONTEXT_HANDLE_OWNERS)[number];

export const CONTEXT_EXPAND_MODES = ['excerpt', 'search', 'aggregate'] as const;
export type ContextExpandMode = (typeof CONTEXT_EXPAND_MODES)[number];

export const CONTEXT_FOLD_STATUSES = ['completed', 'partial', 'failed', 'timeout', 'cancelled', 'unknown'] as const;
export type ContextFoldStatus = (typeof CONTEXT_FOLD_STATUSES)[number];

export const CONTEXT_EVIDENCE_KINDS = ['excerpt', 'search', 'aggregate', 'file', 'test', 'run', 'tool'] as const;
export type ContextEvidenceKind = (typeof CONTEXT_EVIDENCE_KINDS)[number];

export type ContextFoldingValidationIssue = {
  code: ContextFoldingErrorCode;
  message: string;
  path?: string;
};

export class ContextFoldingValidationError extends Error {
  readonly issues: ContextFoldingValidationIssue[];

  constructor(message: string, issues: ContextFoldingValidationIssue[] = [{ code: 'invalid_request', message }]) {
    super(message);
    this.name = 'ContextFoldingValidationError';
    this.issues = issues;
  }
}

export type ContextDiagnostic = {
  code: ContextFoldingErrorCode;
  message: string;
  detail?: Record<string, unknown>;
};

export type ContextHashFn = (text: string) => string;

export type ContextScope = {
  workspaceId: WorkspaceId;
  sessionId: string;
  sessionKey?: SessionKey;
};

export type ContextSelector =
  | { kind: 'full' }
  | { kind: 'lines'; startLine: number; endLine: number }
  | { kind: 'chars'; offset: number; length: number };

export type ContextFreshnessStatus = 'fresh' | 'stale' | 'unknown';

export type ContextFreshness = {
  status: ContextFreshnessStatus;
  verifiedAt: string;
  revision: string;
  ttlMs?: number;
};

export type ContextAllowedExpansion = {
  modes: ContextExpandMode[];
  maxChars: number;
  maxBytes: number;
};

export type ContextHandle = {
  schemaVersion: typeof CONTEXT_HANDLE_SCHEMA;
  handleId: string;
  owner: ContextHandleOwner;
  scope: ContextScope;
  resourceId: string;
  selector: ContextSelector;
  checksum: string;
  freshness: ContextFreshness;
  estimatedChars: number;
  allowedExpansion: ContextAllowedExpansion;
  revision: string;
  label?: string;
  /** Parent handle id when this handle was re-scoped for a child session. */
  derivedFrom?: string;
};

export type ContextRequesterIdentity = {
  workspaceId: WorkspaceId;
  sessionId: string;
  sessionKey?: SessionKey;
  runId?: RunId;
  actor: 'parent' | 'child' | 'host';
  depth: 0 | 1;
};

export type ContextEvidenceRef = {
  handleId: string;
  resourceId: string;
  selector: string;
  checksum: string;
  kind: ContextEvidenceKind;
  label?: string;
};

export type ContextExpandRequest = {
  schemaVersion: typeof CONTEXT_EXPAND_REQUEST_SCHEMA;
  handle: ContextHandle;
  mode: ContextExpandMode;
  maxChars: number;
  maxBytes: number;
  query?: string;
  range?: ContextSelector;
  requester: ContextRequesterIdentity;
  now?: string;
};

export type ContextExpandAggregate = {
  chars: number;
  bytes: number;
  lines: number;
  matches?: number;
  checksum: string;
};

export type ContextExpandResult = {
  schemaVersion: typeof CONTEXT_EXPAND_RESULT_SCHEMA;
  ok: boolean;
  handleId: string;
  mode: ContextExpandMode;
  content?: string;
  aggregate?: ContextExpandAggregate;
  truncated: boolean;
  charCount: number;
  byteCount: number;
  resolvedSelector: ContextSelector;
  resolvedSelectorText: string;
  evidenceRefs: ContextEvidenceRef[];
  freshness: ContextFreshness;
  diagnostics: ContextDiagnostic[];
};

export type ContextFoldOutputSchema =
  | { kind: 'json-object'; required: string[]; description?: string }
  | { kind: 'text'; description?: string };

export type ContextFoldTaskScope = {
  workspaceId: WorkspaceId;
  workspaceRoot?: string;
  allowedPaths?: string[];
};

export type ContextParentRunIdentity = {
  workspaceId: WorkspaceId;
  sessionId: string;
  sessionKey?: SessionKey;
  runId?: RunId;
  depth: 0;
};

export type ContextFoldRequest = {
  schemaVersion: typeof CONTEXT_FOLD_REQUEST_SCHEMA;
  foldId: string;
  objective: string;
  taskScope: ContextFoldTaskScope;
  inputRefs: ContextHandle[];
  allowedTools: string[];
  outputSchema: ContextFoldOutputSchema;
  maxResultChars: number;
  tokenBudget: number;
  timeoutMs: number;
  parentRunIdentity: ContextParentRunIdentity;
};

export type ContextFoldUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs: number;
};

export type ContextFoldFailedAttempt = {
  tool: string;
  reason: string;
  at?: string;
};

export type ContextFoldResult = {
  schemaVersion: typeof CONTEXT_FOLD_RESULT_SCHEMA;
  foldId: string;
  childSessionKey: string;
  childRunId: string;
  status: ContextFoldStatus;
  summary: string;
  structuredOutput: Record<string, unknown> | null;
  evidenceRefs: ContextEvidenceRef[];
  unresolvedClaims: string[];
  blockers: string[];
  failedAttempts: ContextFoldFailedAttempt[];
  inputRefs: string[];
  outputChars: number;
  usage: ContextFoldUsage;
  diagnostics: ContextDiagnostic[];
  /** Raw child transcript characters that reached the parent. The projection keeps this at 0. */
  rawChildTranscriptChars: number;
  recursionDepth: number;
  deliveryId: string;
  deliveredAt?: string;
  drivenBy: 'agent';
  actor: string;
};

export type ContextFoldDeliveryOutcome = 'accepted' | 'duplicate' | 'unknown';

export type ContextFoldingFlagState = {
  enabled: boolean;
  source: 'env' | 'config' | 'default';
};

export type ContextFoldingStatus = ContextFoldingFlagState & {
  flagPath: typeof CONTEXT_FOLDING_FLAG_PATH;
  env: typeof CONTEXT_FOLDING_ENV;
  rollback: typeof CONTEXT_FOLDING_ROLLBACK;
  limits: typeof CONTEXT_FOLDING_LIMITS;
};

/** Keys that would carry a child transcript back into the parent. Always rejected. */
export const CONTEXT_FOLD_FORBIDDEN_RESULT_KEYS = [
  'transcript',
  'rawTranscript',
  'childTranscript',
  'messages',
  'toolLog',
  'toolOutputs',
] as const;

const CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HANDLE_ID_PATTERN = /^cfh_[0-9a-f]{32}$/;
const FOLD_ID_PATTERN = /^cff_[0-9a-f]{32}$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
/** C0 controls (except \t \n \r) and DEL never belong in an identifier, label or summary. */
function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function fail(code: ContextFoldingErrorCode, message: string, path?: string): never {
  throw new ContextFoldingValidationError(message, [{ code, message, ...(path ? { path } : {}) }]);
}

function asRecord(value: unknown, label: string, code: ContextFoldingErrorCode = 'invalid_request'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`, label);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxChars: number, code: ContextFoldingErrorCode = 'invalid_request'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, `${label} must be a non-empty string`, label);
  }
  if (value.length > maxChars) {
    fail('limit_exceeded', `${label} exceeds ${maxChars} chars`, label);
  }
  if (hasControlChars(value)) {
    fail(code, `${label} contains control characters`, label);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxChars: number): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label, maxChars);
}

function integer(value: unknown, label: string, min: number, max: number, code: ContextFoldingErrorCode = 'invalid_request'): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(code, `${label} must be an integer in [${min}, ${max}]`, label);
  }
  return value as number;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('invalid_request', `${label} must be a finite non-negative number`, label);
  }
  return value;
}

function isoDate(value: unknown, label: string): string {
  const raw = text(value, label, 64);
  if (Number.isNaN(new Date(raw).getTime())) {
    fail('invalid_request', `${label} must be an ISO date`, label);
  }
  return raw;
}

function stringList(value: unknown, label: string, maxItems: number, maxChars: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('invalid_request', `${label} must be an array`, label);
  if (value.length > maxItems) fail('limit_exceeded', `${label} exceeds ${maxItems} entries`, label);
  return value.map((item, index) => text(item, `${label}[${index}]`, maxChars));
}

function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[], code: ContextFoldingErrorCode = 'invalid_request'): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(code, `${label} must be one of ${allowed.join('|')}`, label);
  }
  return value as T;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((accumulator, key) => {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) accumulator[key] = stableValue(item);
      return accumulator;
    }, {});
}

export function stableStringifyContextFolding(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hexDigest(hash: ContextHashFn, textValue: string, label: string): string {
  const digest = hash(textValue).trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    fail('invalid_request', `${label} hash function must return a sha256 hex digest`);
  }
  return digest;
}

export function contextChecksum(hash: ContextHashFn, content: string): string {
  return `sha256:${hexDigest(hash, content, 'checksum')}`;
}

export function normalizeContextChecksum(value: unknown, label = 'checksum'): string {
  const raw = text(value, label, 80, 'invalid_handle').toLowerCase();
  if (!CHECKSUM_PATTERN.test(raw)) fail('invalid_handle', `${label} must look like sha256:<64 hex>`, label);
  return raw;
}

export function normalizeContextSelector(value: unknown, label = 'selector'): ContextSelector {
  const record = asRecord(value, label, 'invalid_handle');
  const kind = oneOf(record.kind, `${label}.kind`, ['full', 'lines', 'chars'] as const, 'invalid_handle');
  if (kind === 'full') return { kind: 'full' };
  if (kind === 'lines') {
    const startLine = integer(record.startLine, `${label}.startLine`, 1, 10_000_000, 'invalid_handle');
    const endLine = integer(record.endLine, `${label}.endLine`, startLine, 10_000_000, 'invalid_handle');
    return { kind: 'lines', startLine, endLine };
  }
  return {
    kind: 'chars',
    offset: integer(record.offset, `${label}.offset`, 0, 1_000_000_000, 'invalid_handle'),
    length: integer(record.length, `${label}.length`, 1, 1_000_000_000, 'invalid_handle'),
  };
}

export function selectorToText(selector: ContextSelector): string {
  if (selector.kind === 'full') return 'full';
  if (selector.kind === 'lines') return `L${selector.startLine}-L${selector.endLine}`;
  return `C${selector.offset}+${selector.length}`;
}

export function normalizeContextScope(value: unknown, label = 'scope'): ContextScope {
  const record = asRecord(value, label, 'invalid_handle');
  if (record.workspaceId === undefined && record.sessionKey !== undefined) {
    fail('workspace_mismatch', `${label}.workspaceId is required; a session is never a workspace fallback`, label);
  }
  const sessionKey = optionalText(record.sessionKey, `${label}.sessionKey`, 512);
  return {
    workspaceId: text(record.workspaceId, `${label}.workspaceId`, 1024, 'invalid_handle') as WorkspaceId,
    sessionId: text(record.sessionId, `${label}.sessionId`, 512, 'invalid_handle'),
    ...(sessionKey ? { sessionKey: sessionKey as SessionKey } : {}),
  };
}

export function normalizeContextFreshness(value: unknown, label = 'freshness'): ContextFreshness {
  const record = asRecord(value, label, 'invalid_handle');
  const ttlMs = record.ttlMs === undefined ? undefined : integer(record.ttlMs, `${label}.ttlMs`, 1, 365 * 24 * 60 * 60_000, 'invalid_handle');
  return {
    status: oneOf(record.status, `${label}.status`, ['fresh', 'stale', 'unknown'] as const, 'invalid_handle'),
    verifiedAt: isoDate(record.verifiedAt, `${label}.verifiedAt`),
    revision: text(record.revision, `${label}.revision`, 256, 'invalid_handle'),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
  };
}

export function isContextFreshnessExpired(freshness: ContextFreshness, nowIso: string): boolean {
  if (freshness.ttlMs === undefined) return false;
  const verified = new Date(freshness.verifiedAt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(verified) || Number.isNaN(now)) return true;
  return now - verified > freshness.ttlMs;
}

export function normalizeContextAllowedExpansion(value: unknown, label = 'allowedExpansion'): ContextAllowedExpansion {
  if (value === undefined) {
    return {
      modes: [...CONTEXT_EXPAND_MODES],
      maxChars: CONTEXT_FOLDING_LIMITS.expandDefaultChars,
      maxBytes: CONTEXT_FOLDING_LIMITS.expandMaxBytes,
    };
  }
  const record = asRecord(value, label, 'invalid_handle');
  const modesRaw = record.modes === undefined ? [...CONTEXT_EXPAND_MODES] : record.modes;
  if (!Array.isArray(modesRaw) || modesRaw.length === 0) fail('invalid_handle', `${label}.modes must be a non-empty array`, label);
  const modes = [...new Set(modesRaw.map((mode) => oneOf(mode, `${label}.modes[]`, CONTEXT_EXPAND_MODES, 'invalid_handle')))];
  return {
    modes,
    maxChars: record.maxChars === undefined
      ? CONTEXT_FOLDING_LIMITS.expandDefaultChars
      : integer(record.maxChars, `${label}.maxChars`, 1, CONTEXT_FOLDING_LIMITS.expandMaxChars, 'limit_exceeded'),
    maxBytes: record.maxBytes === undefined
      ? CONTEXT_FOLDING_LIMITS.expandMaxBytes
      : integer(record.maxBytes, `${label}.maxBytes`, 1, CONTEXT_FOLDING_LIMITS.expandMaxBytes, 'limit_exceeded'),
  };
}

export type ContextHandleIdentity = Pick<ContextHandle, 'owner' | 'resourceId' | 'selector' | 'checksum' | 'revision'> & {
  scope: Pick<ContextScope, 'workspaceId' | 'sessionId'>;
};

/** Deterministic: the same owner resource, scope, selector, checksum and revision always yield the same id. */
export function computeContextHandleId(identity: ContextHandleIdentity, hash: ContextHashFn): string {
  const material = stableStringifyContextFolding({
    schema: CONTEXT_HANDLE_SCHEMA,
    owner: identity.owner,
    scope: { workspaceId: identity.scope.workspaceId, sessionId: identity.scope.sessionId },
    resourceId: identity.resourceId,
    selector: identity.selector,
    checksum: identity.checksum,
    revision: identity.revision,
  });
  return `cfh_${hexDigest(hash, material, 'handleId').slice(0, 32)}`;
}

export type CreateContextHandleInput = {
  owner: ContextHandleOwner;
  scope: ContextScope;
  resourceId: string;
  selector?: ContextSelector;
  checksum?: string;
  content?: string;
  revision: string;
  estimatedChars?: number;
  allowedExpansion?: Partial<ContextAllowedExpansion>;
  freshness?: Partial<ContextFreshness>;
  label?: string;
  derivedFrom?: string;
};

export function createContextHandle(input: CreateContextHandleInput, deps: { hash: ContextHashFn; now?: string }): ContextHandle {
  if (input.checksum === undefined && input.content === undefined) {
    fail('invalid_handle', 'createContextHandle needs a checksum or the resolved content');
  }
  const checksum = input.checksum !== undefined
    ? normalizeContextChecksum(input.checksum)
    : contextChecksum(deps.hash, input.content as string);
  const estimatedChars = input.estimatedChars ?? (input.content !== undefined ? input.content.length : undefined);
  const now = deps.now ?? new Date().toISOString();
  const ttlMs = input.freshness?.ttlMs;
  const candidate = {
    schemaVersion: CONTEXT_HANDLE_SCHEMA,
    handleId: 'cfh_00000000000000000000000000000000',
    owner: input.owner,
    scope: input.scope,
    resourceId: input.resourceId,
    selector: input.selector ?? { kind: 'full' },
    checksum,
    freshness: {
      status: input.freshness?.status ?? 'fresh',
      verifiedAt: input.freshness?.verifiedAt ?? now,
      revision: input.freshness?.revision ?? input.revision,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
    },
    estimatedChars: estimatedChars ?? 0,
    allowedExpansion: {
      modes: input.allowedExpansion?.modes ?? [...CONTEXT_EXPAND_MODES],
      maxChars: input.allowedExpansion?.maxChars ?? CONTEXT_FOLDING_LIMITS.expandDefaultChars,
      maxBytes: input.allowedExpansion?.maxBytes ?? CONTEXT_FOLDING_LIMITS.expandMaxBytes,
    },
    revision: input.revision,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.derivedFrom !== undefined ? { derivedFrom: input.derivedFrom } : {}),
  };
  const normalized = normalizeContextHandle(candidate);
  return { ...normalized, handleId: computeContextHandleId(normalized, deps.hash) };
}

/**
 * Structural validation. When a hash function is supplied the handle id is
 * recomputed and a mismatch fails closed (`invalid_handle_id`).
 */
export function normalizeContextHandle(value: unknown, deps: { hash?: ContextHashFn } = {}): ContextHandle {
  const record = asRecord(value, 'handle', 'invalid_handle');
  if (record.schemaVersion !== CONTEXT_HANDLE_SCHEMA) fail('invalid_handle', `handle.schemaVersion must be ${CONTEXT_HANDLE_SCHEMA}`, 'handle.schemaVersion');
  const handleId = text(record.handleId, 'handle.handleId', 64, 'invalid_handle');
  if (!HANDLE_ID_PATTERN.test(handleId)) fail('invalid_handle_id', 'handle.handleId must look like cfh_<32 hex>', 'handle.handleId');
  const label = optionalText(record.label, 'handle.label', CONTEXT_FOLDING_LIMITS.labelMaxChars);
  const derivedFrom = optionalText(record.derivedFrom, 'handle.derivedFrom', 64);
  if (derivedFrom && !HANDLE_ID_PATTERN.test(derivedFrom)) fail('invalid_handle', 'handle.derivedFrom must be a handle id', 'handle.derivedFrom');
  const handle: ContextHandle = {
    schemaVersion: CONTEXT_HANDLE_SCHEMA,
    handleId,
    owner: oneOf(record.owner, 'handle.owner', CONTEXT_HANDLE_OWNERS, 'invalid_handle'),
    scope: normalizeContextScope(record.scope, 'handle.scope'),
    resourceId: text(record.resourceId, 'handle.resourceId', CONTEXT_FOLDING_LIMITS.resourceIdMaxChars, 'invalid_handle'),
    selector: normalizeContextSelector(record.selector, 'handle.selector'),
    checksum: normalizeContextChecksum(record.checksum, 'handle.checksum'),
    freshness: normalizeContextFreshness(record.freshness, 'handle.freshness'),
    estimatedChars: integer(record.estimatedChars, 'handle.estimatedChars', 0, 1_000_000_000, 'invalid_handle'),
    allowedExpansion: normalizeContextAllowedExpansion(record.allowedExpansion, 'handle.allowedExpansion'),
    revision: text(record.revision, 'handle.revision', 256, 'invalid_handle'),
    ...(label ? { label } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
  };
  if (deps.hash) {
    const expected = computeContextHandleId(handle, deps.hash);
    if (expected !== handle.handleId) {
      fail('invalid_handle_id', 'handle.handleId does not match its owner, scope, selector, checksum and revision', 'handle.handleId');
    }
  }
  return handle;
}

export function normalizeContextRequesterIdentity(value: unknown, label = 'requester'): ContextRequesterIdentity {
  const record = asRecord(value, label);
  if (record.workspaceId === undefined) {
    fail('workspace_mismatch', `${label}.workspaceId is required; a session is never a workspace fallback`, label);
  }
  const sessionKey = optionalText(record.sessionKey, `${label}.sessionKey`, 512);
  const runId = optionalText(record.runId, `${label}.runId`, 512);
  const depth = integer(record.depth, `${label}.depth`, 0, CONTEXT_FOLDING_LIMITS.maxRecursiveDepth, 'recursion_depth_exceeded') as 0 | 1;
  return {
    workspaceId: text(record.workspaceId, `${label}.workspaceId`, 1024) as WorkspaceId,
    sessionId: text(record.sessionId, `${label}.sessionId`, 512),
    ...(sessionKey ? { sessionKey: sessionKey as SessionKey } : {}),
    ...(runId ? { runId: runId as RunId } : {}),
    actor: oneOf(record.actor, `${label}.actor`, ['parent', 'child', 'host'] as const),
    depth,
  };
}

/** Scope is checked before any owner read. A mismatch is a visible diagnostic, never a fallback. */
export function checkContextHandleScope(handle: ContextHandle, requester: ContextRequesterIdentity): ContextDiagnostic | null {
  if (handle.scope.workspaceId !== requester.workspaceId) {
    return {
      code: 'workspace_mismatch',
      message: 'Context handle belongs to another workspace.',
      detail: { handleId: handle.handleId },
    };
  }
  if (handle.scope.sessionId !== requester.sessionId) {
    return {
      code: 'session_mismatch',
      message: 'Context handle belongs to another session.',
      detail: { handleId: handle.handleId },
    };
  }
  return null;
}

/** A child never reuses the parent's handle bytes; it receives a derived, child-scoped handle. */
export function rescopeContextHandleForChild(
  handle: ContextHandle,
  child: { sessionId: string; sessionKey?: SessionKey },
  deps: { hash: ContextHashFn },
): ContextHandle {
  const scope: ContextScope = {
    workspaceId: handle.scope.workspaceId,
    sessionId: text(child.sessionId, 'child.sessionId', 512),
    ...(child.sessionKey ? { sessionKey: child.sessionKey } : {}),
  };
  const next: ContextHandle = { ...handle, scope, derivedFrom: handle.handleId };
  return { ...next, handleId: computeContextHandleId(next, deps.hash) };
}

export function normalizeContextEvidenceRef(value: unknown, label = 'evidenceRef'): ContextEvidenceRef {
  const record = asRecord(value, label, 'invalid_result');
  const handleId = text(record.handleId, `${label}.handleId`, 64, 'invalid_result');
  if (!HANDLE_ID_PATTERN.test(handleId)) fail('invalid_result', `${label}.handleId must be a handle id`, label);
  const labelText = optionalText(record.label, `${label}.label`, CONTEXT_FOLDING_LIMITS.labelMaxChars);
  return {
    handleId,
    resourceId: text(record.resourceId, `${label}.resourceId`, CONTEXT_FOLDING_LIMITS.resourceIdMaxChars, 'invalid_result'),
    selector: text(record.selector, `${label}.selector`, 128, 'invalid_result'),
    checksum: normalizeContextChecksum(record.checksum, `${label}.checksum`),
    kind: oneOf(record.kind, `${label}.kind`, CONTEXT_EVIDENCE_KINDS, 'invalid_result'),
    ...(labelText ? { label: labelText } : {}),
  };
}

export function evidenceRefForHandle(handle: ContextHandle, kind: ContextEvidenceKind, selector?: ContextSelector, label?: string): ContextEvidenceRef {
  return {
    handleId: handle.handleId,
    resourceId: handle.resourceId,
    selector: selectorToText(selector ?? handle.selector),
    checksum: handle.checksum,
    kind,
    ...(label !== undefined ? { label } : {}),
  };
}

export function normalizeContextExpandRequest(value: unknown, deps: { hash?: ContextHashFn } = {}): ContextExpandRequest {
  const record = asRecord(value, 'expandRequest');
  if (record.schemaVersion !== CONTEXT_EXPAND_REQUEST_SCHEMA) fail('invalid_request', `expandRequest.schemaVersion must be ${CONTEXT_EXPAND_REQUEST_SCHEMA}`, 'expandRequest.schemaVersion');
  const handle = normalizeContextHandle(record.handle, deps);
  const mode = oneOf(record.mode, 'expandRequest.mode', CONTEXT_EXPAND_MODES);
  const maxChars = record.maxChars === undefined
    ? Math.min(handle.allowedExpansion.maxChars, CONTEXT_FOLDING_LIMITS.expandDefaultChars)
    : integer(record.maxChars, 'expandRequest.maxChars', 1, CONTEXT_FOLDING_LIMITS.expandMaxChars, 'limit_exceeded');
  const maxBytes = record.maxBytes === undefined
    ? Math.min(handle.allowedExpansion.maxBytes, CONTEXT_FOLDING_LIMITS.expandMaxBytes)
    : integer(record.maxBytes, 'expandRequest.maxBytes', 1, CONTEXT_FOLDING_LIMITS.expandMaxBytes, 'limit_exceeded');
  const query = optionalText(record.query, 'expandRequest.query', 512);
  if (mode === 'search' && !query) fail('invalid_request', 'expandRequest.query is required for search', 'expandRequest.query');
  const range = record.range === undefined ? undefined : normalizeContextSelector(record.range, 'expandRequest.range');
  const now = record.now === undefined ? undefined : isoDate(record.now, 'expandRequest.now');
  return {
    schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA,
    handle,
    mode,
    maxChars,
    maxBytes,
    ...(query ? { query } : {}),
    ...(range ? { range } : {}),
    requester: normalizeContextRequesterIdentity(record.requester, 'expandRequest.requester'),
    ...(now ? { now } : {}),
  };
}

export function normalizeContextDiagnostic(value: unknown, label = 'diagnostic'): ContextDiagnostic {
  const record = asRecord(value, label, 'invalid_result');
  const detail = record.detail === undefined ? undefined : asRecord(record.detail, `${label}.detail`, 'invalid_result');
  return {
    code: oneOf(record.code, `${label}.code`, CONTEXT_FOLDING_ERROR_CODES, 'invalid_result'),
    message: text(record.message, `${label}.message`, 2_000, 'invalid_result'),
    ...(detail ? { detail } : {}),
  };
}

export function normalizeContextExpandResult(value: unknown): ContextExpandResult {
  const record = asRecord(value, 'expandResult', 'invalid_result');
  if (record.schemaVersion !== CONTEXT_EXPAND_RESULT_SCHEMA) fail('invalid_result', `expandResult.schemaVersion must be ${CONTEXT_EXPAND_RESULT_SCHEMA}`, 'expandResult.schemaVersion');
  if (typeof record.ok !== 'boolean') fail('invalid_result', 'expandResult.ok must be a boolean', 'expandResult.ok');
  if (typeof record.truncated !== 'boolean') fail('invalid_result', 'expandResult.truncated must be a boolean', 'expandResult.truncated');
  const handleId = text(record.handleId, 'expandResult.handleId', 64, 'invalid_result');
  if (!HANDLE_ID_PATTERN.test(handleId)) fail('invalid_result', 'expandResult.handleId must be a handle id', 'expandResult.handleId');
  const content = record.content === undefined
    ? undefined
    : (typeof record.content === 'string' ? record.content : fail('invalid_result', 'expandResult.content must be a string', 'expandResult.content'));
  const charCount = integer(record.charCount, 'expandResult.charCount', 0, CONTEXT_FOLDING_LIMITS.expandMaxChars, 'limit_exceeded');
  const byteCount = integer(record.byteCount, 'expandResult.byteCount', 0, CONTEXT_FOLDING_LIMITS.expandMaxBytes, 'limit_exceeded');
  if (content !== undefined && content.length !== charCount) fail('invalid_result', 'expandResult.charCount must equal content length', 'expandResult.charCount');
  let aggregate: ContextExpandAggregate | undefined;
  if (record.aggregate !== undefined) {
    const aggregateRecord = asRecord(record.aggregate, 'expandResult.aggregate', 'invalid_result');
    const matches = aggregateRecord.matches === undefined ? undefined : integer(aggregateRecord.matches, 'expandResult.aggregate.matches', 0, 1_000_000_000, 'invalid_result');
    aggregate = {
      chars: integer(aggregateRecord.chars, 'expandResult.aggregate.chars', 0, 1_000_000_000, 'invalid_result'),
      bytes: integer(aggregateRecord.bytes, 'expandResult.aggregate.bytes', 0, 1_000_000_000, 'invalid_result'),
      lines: integer(aggregateRecord.lines, 'expandResult.aggregate.lines', 0, 1_000_000_000, 'invalid_result'),
      ...(matches !== undefined ? { matches } : {}),
      checksum: normalizeContextChecksum(aggregateRecord.checksum, 'expandResult.aggregate.checksum'),
    };
  }
  const diagnostics = (Array.isArray(record.diagnostics) ? record.diagnostics : []).map((item, index) => normalizeContextDiagnostic(item, `expandResult.diagnostics[${index}]`));
  if (!record.ok && diagnostics.length === 0) fail('invalid_result', 'a failed expansion must carry at least one diagnostic', 'expandResult.diagnostics');
  const resolvedSelector = normalizeContextSelector(record.resolvedSelector, 'expandResult.resolvedSelector');
  return {
    schemaVersion: CONTEXT_EXPAND_RESULT_SCHEMA,
    ok: record.ok,
    handleId,
    mode: oneOf(record.mode, 'expandResult.mode', CONTEXT_EXPAND_MODES, 'invalid_result'),
    ...(content !== undefined ? { content } : {}),
    ...(aggregate ? { aggregate } : {}),
    truncated: record.truncated,
    charCount,
    byteCount,
    resolvedSelector,
    resolvedSelectorText: selectorToText(resolvedSelector),
    evidenceRefs: (Array.isArray(record.evidenceRefs) ? record.evidenceRefs : []).map((item, index) => normalizeContextEvidenceRef(item, `expandResult.evidenceRefs[${index}]`)),
    freshness: normalizeContextFreshness(record.freshness, 'expandResult.freshness'),
    diagnostics,
  };
}

export function createContextExpandFailure(params: {
  handle: ContextHandle;
  mode: ContextExpandMode;
  diagnostics: ContextDiagnostic[];
  freshness?: ContextFreshness;
}): ContextExpandResult {
  if (params.diagnostics.length === 0) fail('invalid_result', 'a failed expansion must carry at least one diagnostic');
  return {
    schemaVersion: CONTEXT_EXPAND_RESULT_SCHEMA,
    ok: false,
    handleId: params.handle.handleId,
    mode: params.mode,
    truncated: false,
    charCount: 0,
    byteCount: 0,
    resolvedSelector: params.handle.selector,
    resolvedSelectorText: selectorToText(params.handle.selector),
    evidenceRefs: [],
    freshness: params.freshness ?? params.handle.freshness,
    diagnostics: params.diagnostics,
  };
}

export function normalizeContextFoldOutputSchema(value: unknown, label = 'outputSchema'): ContextFoldOutputSchema {
  const record = asRecord(value, label);
  const kind = oneOf(record.kind, `${label}.kind`, ['json-object', 'text'] as const);
  const description = optionalText(record.description, `${label}.description`, 1_000);
  if (kind === 'text') return { kind, ...(description ? { description } : {}) };
  const required = stringList(record.required, `${label}.required`, 64, 128);
  return { kind, required, ...(description ? { description } : {}) };
}

export type ContextFoldIdentity = Omit<ContextFoldRequest, 'schemaVersion' | 'foldId' | 'inputRefs'> & { inputRefs: string[] };

export function computeContextFoldId(identity: ContextFoldIdentity, hash: ContextHashFn): string {
  const material = stableStringifyContextFolding({
    schema: CONTEXT_FOLD_REQUEST_SCHEMA,
    objective: identity.objective,
    taskScope: identity.taskScope,
    inputRefs: [...identity.inputRefs].sort(),
    allowedTools: [...identity.allowedTools].sort(),
    outputSchema: identity.outputSchema,
    maxResultChars: identity.maxResultChars,
    tokenBudget: identity.tokenBudget,
    timeoutMs: identity.timeoutMs,
    parentRunIdentity: {
      workspaceId: identity.parentRunIdentity.workspaceId,
      sessionId: identity.parentRunIdentity.sessionId,
      ...(identity.parentRunIdentity.runId ? { runId: identity.parentRunIdentity.runId } : {}),
    },
  });
  return `cff_${hexDigest(hash, material, 'foldId').slice(0, 32)}`;
}

export function normalizeContextParentRunIdentity(value: unknown, label = 'parentRunIdentity'): ContextParentRunIdentity {
  const record = asRecord(value, label);
  if (record.workspaceId === undefined) {
    fail('workspace_mismatch', `${label}.workspaceId is required; a session is never a workspace fallback`, label);
  }
  if (record.depth !== 0) fail('recursion_depth_exceeded', `${label}.depth must be 0: a child may not fold a grandchild`, `${label}.depth`);
  const sessionKey = optionalText(record.sessionKey, `${label}.sessionKey`, 512);
  const runId = optionalText(record.runId, `${label}.runId`, 512);
  return {
    workspaceId: text(record.workspaceId, `${label}.workspaceId`, 1024) as WorkspaceId,
    sessionId: text(record.sessionId, `${label}.sessionId`, 512),
    ...(sessionKey ? { sessionKey: sessionKey as SessionKey } : {}),
    ...(runId ? { runId: runId as RunId } : {}),
    depth: 0,
  };
}

/**
 * A fold request is validated as a whole: scope, tools, budgets and the
 * parent's own handles. The fold id is recomputed when a hash is supplied.
 */
export function normalizeContextFoldRequest(value: unknown, deps: { hash?: ContextHashFn } = {}): ContextFoldRequest {
  const record = asRecord(value, 'foldRequest');
  if (record.schemaVersion !== CONTEXT_FOLD_REQUEST_SCHEMA) fail('invalid_request', `foldRequest.schemaVersion must be ${CONTEXT_FOLD_REQUEST_SCHEMA}`, 'foldRequest.schemaVersion');
  const taskScopeRecord = asRecord(record.taskScope, 'foldRequest.taskScope');
  if (taskScopeRecord.workspaceId === undefined) fail('workspace_mismatch', 'foldRequest.taskScope.workspaceId is required', 'foldRequest.taskScope');
  const workspaceRoot = optionalText(taskScopeRecord.workspaceRoot, 'foldRequest.taskScope.workspaceRoot', 4_096);
  const allowedPaths = taskScopeRecord.allowedPaths === undefined ? undefined : stringList(taskScopeRecord.allowedPaths, 'foldRequest.taskScope.allowedPaths', 256, 4_096);
  const taskScope: ContextFoldTaskScope = {
    workspaceId: text(taskScopeRecord.workspaceId, 'foldRequest.taskScope.workspaceId', 1024) as WorkspaceId,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(allowedPaths ? { allowedPaths } : {}),
  };
  const parentRunIdentity = normalizeContextParentRunIdentity(record.parentRunIdentity, 'foldRequest.parentRunIdentity');
  if (parentRunIdentity.workspaceId !== taskScope.workspaceId) {
    fail('workspace_mismatch', 'foldRequest.taskScope.workspaceId must equal the parent run workspace', 'foldRequest.taskScope.workspaceId');
  }
  if (!Array.isArray(record.inputRefs)) fail('invalid_request', 'foldRequest.inputRefs must be an array', 'foldRequest.inputRefs');
  if (record.inputRefs.length > CONTEXT_FOLDING_LIMITS.foldInputRefsMax) fail('limit_exceeded', `foldRequest.inputRefs exceeds ${CONTEXT_FOLDING_LIMITS.foldInputRefsMax}`, 'foldRequest.inputRefs');
  const inputRefs = record.inputRefs.map((item, index) => {
    const handle = normalizeContextHandle(item, deps);
    if (handle.scope.workspaceId !== taskScope.workspaceId) {
      fail('workspace_mismatch', `foldRequest.inputRefs[${index}] belongs to another workspace`, `foldRequest.inputRefs[${index}]`);
    }
    if (handle.scope.sessionId !== parentRunIdentity.sessionId) {
      fail('session_mismatch', `foldRequest.inputRefs[${index}] is not owned by the parent session`, `foldRequest.inputRefs[${index}]`);
    }
    return handle;
  });
  const seen = new Set<string>();
  for (const handle of inputRefs) {
    if (seen.has(handle.handleId)) fail('invalid_request', `foldRequest.inputRefs repeats ${handle.handleId}`, 'foldRequest.inputRefs');
    seen.add(handle.handleId);
  }
  const allowedToolsRaw = stringList(record.allowedTools, 'foldRequest.allowedTools', CONTEXT_FOLDING_LIMITS.foldAllowedToolsMax, 64);
  if (allowedToolsRaw.length === 0) fail('tool_not_allowed', 'foldRequest.allowedTools must name at least one tool; there is no implicit inheritance', 'foldRequest.allowedTools');
  const allowedTools = [...new Set(allowedToolsRaw.map((tool, index) => {
    if (!TOOL_NAME_PATTERN.test(tool)) fail('tool_not_allowed', `foldRequest.allowedTools[${index}] must be an explicit tool name (no wildcards)`, `foldRequest.allowedTools[${index}]`);
    return tool;
  }))];
  const foldIdentity: ContextFoldIdentity = {
    objective: text(record.objective, 'foldRequest.objective', CONTEXT_FOLDING_LIMITS.objectiveMaxChars),
    taskScope,
    inputRefs: inputRefs.map((handle) => handle.handleId),
    allowedTools,
    outputSchema: normalizeContextFoldOutputSchema(record.outputSchema, 'foldRequest.outputSchema'),
    maxResultChars: integer(record.maxResultChars, 'foldRequest.maxResultChars', 1, CONTEXT_FOLDING_LIMITS.foldResultMaxChars, 'limit_exceeded'),
    tokenBudget: integer(record.tokenBudget, 'foldRequest.tokenBudget', 1, 100_000_000, 'limit_exceeded'),
    timeoutMs: integer(record.timeoutMs, 'foldRequest.timeoutMs', 1, CONTEXT_FOLDING_LIMITS.foldTimeoutMaxMs, 'limit_exceeded'),
    parentRunIdentity,
  };
  const foldId = text(record.foldId, 'foldRequest.foldId', 64);
  if (!FOLD_ID_PATTERN.test(foldId)) fail('invalid_request', 'foldRequest.foldId must look like cff_<32 hex>', 'foldRequest.foldId');
  if (deps.hash && computeContextFoldId(foldIdentity, deps.hash) !== foldId) {
    fail('invalid_request', 'foldRequest.foldId does not match the request body', 'foldRequest.foldId');
  }
  return {
    schemaVersion: CONTEXT_FOLD_REQUEST_SCHEMA,
    foldId,
    ...foldIdentity,
    inputRefs,
  };
}

export function createContextFoldRequest(
  input: Omit<ContextFoldRequest, 'schemaVersion' | 'foldId'>,
  deps: { hash: ContextHashFn },
): ContextFoldRequest {
  // Normalize first so the id is derived from the canonical body (deduplicated
  // tools, validated scope), then re-validate with the hash so handle ids and
  // the fold id are both proven against that body.
  const draft = normalizeContextFoldRequest({
    schemaVersion: CONTEXT_FOLD_REQUEST_SCHEMA,
    foldId: 'cff_00000000000000000000000000000000',
    ...input,
  });
  const foldId = computeContextFoldId({ ...draft, inputRefs: draft.inputRefs.map((handle) => handle.handleId) }, deps.hash);
  return normalizeContextFoldRequest({ ...draft, foldId }, deps);
}

function normalizeContextFoldUsage(value: unknown, label = 'usage'): ContextFoldUsage {
  const record = asRecord(value, label, 'invalid_result');
  const inputTokens = optionalNumber(record.inputTokens, `${label}.inputTokens`);
  const outputTokens = optionalNumber(record.outputTokens, `${label}.outputTokens`);
  const totalTokens = optionalNumber(record.totalTokens, `${label}.totalTokens`);
  const costUsd = optionalNumber(record.costUsd, `${label}.costUsd`);
  if (typeof record.latencyMs !== 'number' || !Number.isFinite(record.latencyMs) || record.latencyMs < 0) {
    fail('invalid_result', `${label}.latencyMs is required`, `${label}.latencyMs`);
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    latencyMs: record.latencyMs,
  };
}

function normalizeFailedAttempt(value: unknown, label: string): ContextFoldFailedAttempt {
  const record = asRecord(value, label, 'invalid_result');
  const at = record.at === undefined ? undefined : isoDate(record.at, `${label}.at`);
  return {
    tool: text(record.tool, `${label}.tool`, 64, 'invalid_result'),
    reason: text(record.reason, `${label}.reason`, 1_000, 'invalid_result'),
    ...(at ? { at } : {}),
  };
}

export function measureContextFoldOutputChars(summary: string, structuredOutput: Record<string, unknown> | null): number {
  return summary.length + (structuredOutput === null ? 0 : stableStringifyContextFolding(structuredOutput).length);
}

/**
 * Validates a child's folded result. Required: child identity, evidence refs,
 * unresolved claims, blockers, failed attempts and usage. A transcript-shaped
 * key is rejected outright, and a non-terminal failure must explain itself.
 */
export function normalizeContextFoldResult(value: unknown): ContextFoldResult {
  const record = asRecord(value, 'foldResult', 'invalid_result');
  for (const key of CONTEXT_FOLD_FORBIDDEN_RESULT_KEYS) {
    if (key in record) fail('raw_transcript_rejected', `foldResult.${key} would inject a child transcript into the parent`, `foldResult.${key}`);
  }
  if (record.schemaVersion !== CONTEXT_FOLD_RESULT_SCHEMA) fail('invalid_result', `foldResult.schemaVersion must be ${CONTEXT_FOLD_RESULT_SCHEMA}`, 'foldResult.schemaVersion');
  const foldId = text(record.foldId, 'foldResult.foldId', 64, 'invalid_result');
  if (!FOLD_ID_PATTERN.test(foldId)) fail('invalid_result', 'foldResult.foldId must look like cff_<32 hex>', 'foldResult.foldId');
  const childSessionKey = text(record.childSessionKey, 'foldResult.childSessionKey', 512, 'child_identity_mismatch');
  const childRunId = text(record.childRunId, 'foldResult.childRunId', 512, 'child_identity_mismatch');
  const status = oneOf(record.status, 'foldResult.status', CONTEXT_FOLD_STATUSES, 'invalid_result');
  if (typeof record.summary !== 'string') fail('invalid_result', 'foldResult.summary must be a string', 'foldResult.summary');
  const summary: string = record.summary;
  if (hasControlChars(summary)) fail('invalid_result', 'foldResult.summary contains control characters', 'foldResult.summary');
  let structuredOutput: Record<string, unknown> | null = null;
  if (record.structuredOutput !== null && record.structuredOutput !== undefined) {
    structuredOutput = asRecord(record.structuredOutput, 'foldResult.structuredOutput', 'invalid_result');
    for (const key of CONTEXT_FOLD_FORBIDDEN_RESULT_KEYS) {
      if (key in structuredOutput) fail('raw_transcript_rejected', `foldResult.structuredOutput.${key} would inject a child transcript into the parent`, `foldResult.structuredOutput.${key}`);
    }
  }
  // Presence is not enough: an explicit (possibly empty) array is the claim.
  if (!Array.isArray(record.unresolvedClaims)) fail('invalid_result', 'foldResult.unresolvedClaims must be an array (an empty list is an explicit claim)', 'foldResult.unresolvedClaims');
  if (!Array.isArray(record.blockers)) fail('invalid_result', 'foldResult.blockers must be an array', 'foldResult.blockers');
  if (!Array.isArray(record.failedAttempts)) fail('invalid_result', 'foldResult.failedAttempts must be an array', 'foldResult.failedAttempts');
  if (!Array.isArray(record.evidenceRefs)) fail('invalid_result', 'foldResult.evidenceRefs must be an array', 'foldResult.evidenceRefs');
  const evidenceRefs = record.evidenceRefs.map((item, index) => normalizeContextEvidenceRef(item, `foldResult.evidenceRefs[${index}]`));
  const unresolvedClaims = stringList(record.unresolvedClaims, 'foldResult.unresolvedClaims', 128, 1_000);
  const blockers = stringList(record.blockers, 'foldResult.blockers', 128, 1_000);
  const failedAttempts = record.failedAttempts.map((item, index) => normalizeFailedAttempt(item, `foldResult.failedAttempts[${index}]`));
  const inputRefs = stringList(record.inputRefs, 'foldResult.inputRefs', CONTEXT_FOLDING_LIMITS.foldInputRefsMax, 64).map((handleId, index) => {
    if (!HANDLE_ID_PATTERN.test(handleId)) fail('invalid_result', `foldResult.inputRefs[${index}] must be a handle id`, `foldResult.inputRefs[${index}]`);
    return handleId;
  });
  const diagnostics = (Array.isArray(record.diagnostics) ? record.diagnostics : []).map((item, index) => normalizeContextDiagnostic(item, `foldResult.diagnostics[${index}]`));
  const outputChars = measureContextFoldOutputChars(summary, structuredOutput);
  if (outputChars > CONTEXT_FOLDING_LIMITS.foldResultMaxChars) {
    fail('limit_exceeded', `foldResult output is ${outputChars} chars; the parent accepts at most ${CONTEXT_FOLDING_LIMITS.foldResultMaxChars}`, 'foldResult.outputChars');
  }
  if (record.outputChars !== undefined && record.outputChars !== outputChars) {
    fail('invalid_result', `foldResult.outputChars (${String(record.outputChars)}) does not match the measured ${outputChars}`, 'foldResult.outputChars');
  }
  const rawChildTranscriptChars = integer(record.rawChildTranscriptChars ?? 0, 'foldResult.rawChildTranscriptChars', 0, CONTEXT_FOLDING_LIMITS.rawChildTranscriptMaxChars, 'raw_transcript_rejected');
  const recursionDepth = integer(record.recursionDepth ?? 1, 'foldResult.recursionDepth', 0, CONTEXT_FOLDING_LIMITS.maxRecursiveDepth, 'recursion_depth_exceeded');
  if (status === 'completed' && evidenceRefs.length === 0) {
    fail('invalid_result', 'a completed fold must carry at least one evidence ref', 'foldResult.evidenceRefs');
  }
  if (status !== 'completed' && blockers.length === 0 && failedAttempts.length === 0 && diagnostics.length === 0 && unresolvedClaims.length === 0) {
    fail('invalid_result', `a ${status} fold must explain itself through blockers, failedAttempts, diagnostics or unresolvedClaims`, 'foldResult.status');
  }
  if (record.drivenBy !== 'agent') fail('invalid_result', 'foldResult.drivenBy must be "agent"', 'foldResult.drivenBy');
  const deliveredAt = record.deliveredAt === undefined ? undefined : isoDate(record.deliveredAt, 'foldResult.deliveredAt');
  return {
    schemaVersion: CONTEXT_FOLD_RESULT_SCHEMA,
    foldId,
    childSessionKey,
    childRunId,
    status,
    summary,
    structuredOutput,
    evidenceRefs,
    unresolvedClaims,
    blockers,
    failedAttempts,
    inputRefs,
    outputChars,
    usage: normalizeContextFoldUsage(record.usage, 'foldResult.usage'),
    diagnostics,
    rawChildTranscriptChars,
    recursionDepth,
    deliveryId: text(record.deliveryId, 'foldResult.deliveryId', 128, 'invalid_result'),
    ...(deliveredAt ? { deliveredAt } : {}),
    drivenBy: 'agent',
    actor: text(record.actor, 'foldResult.actor', 200, 'invalid_result'),
  };
}

export type ContextFoldProjection = {
  projection: ContextFoldResult;
  chars: number;
  truncated: boolean;
};

/**
 * What the parent is allowed to see: the normalized result cut to its budget,
 * with a raw-transcript count pinned at zero. Detail is fetched again through a
 * bounded expand, never through the projection.
 */
export function projectContextFoldResultForParent(value: unknown, options: { maxChars?: number } = {}): ContextFoldProjection {
  const result = normalizeContextFoldResult(value);
  const budget = integer(options.maxChars ?? CONTEXT_FOLDING_LIMITS.foldResultMaxChars, 'maxChars', 1, CONTEXT_FOLDING_LIMITS.foldResultMaxChars, 'limit_exceeded');
  let summary = result.summary;
  let structuredOutput = result.structuredOutput;
  let truncated = false;
  const diagnostics = [...result.diagnostics];
  if (measureContextFoldOutputChars(summary, structuredOutput) > budget) {
    truncated = true;
    const structuredChars = structuredOutput === null ? 0 : stableStringifyContextFolding(structuredOutput).length;
    if (structuredChars > budget) {
      structuredOutput = null;
      diagnostics.push({ code: 'limit_exceeded', message: 'structuredOutput dropped from the parent projection; expand the child evidence refs for detail.' });
    }
    const remaining = budget - (structuredOutput === null ? 0 : stableStringifyContextFolding(structuredOutput).length);
    summary = summary.slice(0, Math.max(0, remaining));
    diagnostics.push({ code: 'limit_exceeded', message: `summary truncated to ${summary.length} chars for the parent projection.` });
  }
  const projection: ContextFoldResult = {
    ...result,
    summary,
    structuredOutput,
    outputChars: measureContextFoldOutputChars(summary, structuredOutput),
    diagnostics,
    rawChildTranscriptChars: 0,
  };
  return { projection, chars: projection.outputChars, truncated };
}

/** In-memory delivery ledger: one accepted delivery per child run; replays and strangers are named. */
export function createContextFoldDeliveryLedger(): {
  expect: (foldId: string, childRunId: string) => void;
  accept: (delivery: { foldId: string; childRunId: string; deliveryId: string }) => ContextFoldDeliveryOutcome;
  snapshot: () => Array<{ foldId: string; childRunId: string; deliveryId: string | null }>;
} {
  const expected = new Map<string, { foldId: string; deliveryId: string | null }>();
  return {
    expect(foldId, childRunId) {
      expected.set(childRunId, { foldId, deliveryId: null });
    },
    accept(delivery) {
      const entry = expected.get(delivery.childRunId);
      if (!entry || entry.foldId !== delivery.foldId) return 'unknown';
      if (entry.deliveryId !== null) return 'duplicate';
      entry.deliveryId = delivery.deliveryId;
      return 'accepted';
    },
    snapshot() {
      return [...expected.entries()].map(([childRunId, entry]) => ({ foldId: entry.foldId, childRunId, deliveryId: entry.deliveryId }));
    },
  };
}

function readConfigLeaf(config: unknown): boolean | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const record = config as Record<string, unknown>;
  const runtime = (record.runtime && typeof record.runtime === 'object' ? record.runtime : record) as Record<string, unknown>;
  const contextBlock = runtime.contextBlock;
  if (!contextBlock || typeof contextBlock !== 'object') return undefined;
  const leaf = (contextBlock as Record<string, unknown>).contextFolding;
  if (!leaf || typeof leaf !== 'object') return undefined;
  const enabled = (leaf as Record<string, unknown>).enabled;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

/**
 * Default off. An explicit env value wins over config in either direction so a
 * disable-only rollback never has to touch the config file.
 */
export function resolveContextFoldingEnabled(input: {
  config?: unknown;
  env?: Record<string, string | undefined>;
} = {}): ContextFoldingFlagState {
  const raw = input.env?.[CONTEXT_FOLDING_ENV];
  if (raw != null && raw.trim() !== '') {
    const value = raw.trim().toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return { enabled: true, source: 'env' };
    return { enabled: false, source: 'env' };
  }
  const leaf = readConfigLeaf(input.config);
  if (leaf !== undefined) return { enabled: leaf, source: 'config' };
  return { enabled: false, source: 'default' };
}

export function describeContextFoldingStatus(input: {
  config?: unknown;
  env?: Record<string, string | undefined>;
} = {}): ContextFoldingStatus {
  return {
    ...resolveContextFoldingEnabled(input),
    flagPath: CONTEXT_FOLDING_FLAG_PATH,
    env: CONTEXT_FOLDING_ENV,
    rollback: CONTEXT_FOLDING_ROLLBACK,
    limits: CONTEXT_FOLDING_LIMITS,
  };
}
