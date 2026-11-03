// @vitest-environment node
/**
 * context-folding-rlm / TF-0691 (CF-01): frozen contracts.
 *
 * Pure contract tests for ContextHandle/v1, ContextExpandRequest/Result/v1 and
 * ContextFoldRequest/v1: round-trip, deterministic ids, checksum/scope/owner/
 * freshness validation, and fail-closed negatives for stale, missing,
 * ambiguous, expired, cross-session and cross-workspace references.
 *
 * driven_by: agent; actor: claude-fable-5.1/context-folding-rlm
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkspaceId } from '../../shared/types/identity-scope';
import {
  CONTEXT_EXPAND_REQUEST_SCHEMA,
  CONTEXT_EXPAND_RESULT_SCHEMA,
  CONTEXT_FOLD_REQUEST_SCHEMA,
  CONTEXT_FOLDING_ENV,
  CONTEXT_FOLDING_ERROR_CODES,
  CONTEXT_FOLDING_FLAG_PATH,
  CONTEXT_FOLDING_LIMITS,
  CONTEXT_HANDLE_SCHEMA,
  ContextFoldingValidationError,
  checkContextHandleScope,
  computeContextFoldId,
  computeContextHandleId,
  contextChecksum,
  createContextExpandFailure,
  createContextFoldRequest,
  createContextHandle,
  describeContextFoldingStatus,
  evidenceRefForHandle,
  isContextFreshnessExpired,
  normalizeContextExpandRequest,
  normalizeContextExpandResult,
  normalizeContextFoldRequest,
  normalizeContextHandle,
  normalizeContextScope,
  rescopeContextHandleForChild,
  resolveContextFoldingEnabled,
  selectorToText,
  stableStringifyContextFolding,
  type ContextHandle,
  type ContextRequesterIdentity,
} from '../../shared/types/context-folding';
import {
  isContextFoldingEnabled,
  resolveContextFoldingFlagState,
} from '../../openclaw_runtime/src/context-engine/context-folding/flags';

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const WS_A = 'ws-a' as WorkspaceId;
const WS_B = 'ws-b' as WorkspaceId;
const NOW = '2026-11-03T00:00:00.000Z';
const CONTENT = 'def complete_task(self, task_id):\n    task.revision += 1\n';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContextFoldingValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error('expected a ContextFoldingValidationError');
}

function parentHandle(overrides: Partial<Parameters<typeof createContextHandle>[0]> = {}): ContextHandle {
  return createContextHandle({
    owner: 'workspace-file',
    scope: { workspaceId: WS_A, sessionId: 'sess-parent' },
    resourceId: 'src/taskboard.py',
    selector: { kind: 'lines', startLine: 26, endLine: 36 },
    content: CONTENT,
    revision: 'rev-1',
    ...overrides,
  }, { hash, now: NOW });
}

const parentRequester: ContextRequesterIdentity = {
  workspaceId: WS_A,
  sessionId: 'sess-parent',
  actor: 'parent',
  depth: 0,
};

describe('ContextHandle/v1', () => {
  it('round-trips through JSON and re-validates its deterministic id', () => {
    const handle = parentHandle();
    expect(handle.schemaVersion).toBe(CONTEXT_HANDLE_SCHEMA);
    expect(handle.handleId).toMatch(/^cfh_[0-9a-f]{32}$/);
    expect(handle.checksum).toBe(contextChecksum(hash, CONTENT));
    expect(handle.estimatedChars).toBe(CONTENT.length);
    expect(handle.freshness).toEqual({ status: 'fresh', verifiedAt: NOW, revision: 'rev-1' });
    expect(handle.allowedExpansion).toEqual({
      modes: ['excerpt', 'search', 'aggregate'],
      maxChars: CONTEXT_FOLDING_LIMITS.expandDefaultChars,
      maxBytes: CONTEXT_FOLDING_LIMITS.expandMaxBytes,
    });
    const restored = normalizeContextHandle(JSON.parse(JSON.stringify(handle)), { hash });
    expect(restored).toEqual(handle);
    expect(stableStringifyContextFolding(restored)).toBe(stableStringifyContextFolding(handle));
  });

  it('derives the same id for the same owner resource and a different id for any identity change', () => {
    const a = parentHandle();
    const b = parentHandle();
    expect(a.handleId).toBe(b.handleId);
    expect(computeContextHandleId(a, hash)).toBe(a.handleId);
    expect(parentHandle({ revision: 'rev-2' }).handleId).not.toBe(a.handleId);
    expect(parentHandle({ content: `${CONTENT}\n` }).handleId).not.toBe(a.handleId);
    expect(parentHandle({ selector: { kind: 'full' } }).handleId).not.toBe(a.handleId);
    expect(parentHandle({ scope: { workspaceId: WS_A, sessionId: 'sess-other' } }).handleId).not.toBe(a.handleId);
    expect(parentHandle({ scope: { workspaceId: WS_B, sessionId: 'sess-parent' } }).handleId).not.toBe(a.handleId);
    expect(parentHandle({ owner: 'tool-output' }).handleId).not.toBe(a.handleId);
    // The label is presentation, not identity.
    expect(parentHandle({ label: 'taskboard' }).handleId).toBe(a.handleId);
  });

  it('fails closed when the id, checksum, owner, selector or scope is forged', () => {
    const handle = parentHandle();
    expect(codeOf(() => normalizeContextHandle({ ...handle, handleId: 'cfh_00000000000000000000000000000000' }, { hash }))).toBe('invalid_handle_id');
    expect(codeOf(() => normalizeContextHandle({ ...handle, handleId: 'not-a-handle' }))).toBe('invalid_handle_id');
    expect(codeOf(() => normalizeContextHandle({ ...handle, checksum: 'md5:abc' }))).toBe('invalid_handle');
    expect(codeOf(() => normalizeContextHandle({ ...handle, owner: 'anything' }))).toBe('invalid_handle');
    expect(codeOf(() => normalizeContextHandle({ ...handle, selector: { kind: 'lines', startLine: 10, endLine: 2 } }))).toBe('invalid_handle');
    expect(codeOf(() => normalizeContextHandle({ ...handle, scope: { sessionId: 'sess-parent' } }))).toBe('invalid_handle');
    expect(codeOf(() => normalizeContextHandle({ ...handle, scope: { sessionKey: 'agent:main', sessionId: 'sess-parent' } }))).toBe('workspace_mismatch');
    expect(codeOf(() => normalizeContextHandle({ ...handle, freshness: { ...handle.freshness, status: 'maybe' } }))).toBe('invalid_handle');
    expect(codeOf(() => normalizeContextHandle({ ...handle, allowedExpansion: { modes: ['excerpt'], maxChars: CONTEXT_FOLDING_LIMITS.expandMaxChars + 1 } }))).toBe('limit_exceeded');
    expect(codeOf(() => normalizeContextHandle({ ...handle, resourceId: 'a\u0000b' }))).toBe('invalid_handle');
    expect(codeOf(() => createContextHandle({ owner: 'workspace-file', scope: handle.scope, resourceId: 'x', revision: 'r' }, { hash }))).toBe('invalid_handle');
  });

  it('never falls back from a session to a workspace', () => {
    expect(codeOf(() => normalizeContextScope({ sessionId: 'sess', sessionKey: 'agent:main' }))).toBe('workspace_mismatch');
    expect(codeOf(() => normalizeContextScope({ sessionId: 'sess' }))).toBe('invalid_handle');
    expect(normalizeContextScope({ workspaceId: 'ws-a', sessionId: 'sess', sessionKey: 'agent:main' })).toEqual({
      workspaceId: 'ws-a',
      sessionId: 'sess',
      sessionKey: 'agent:main',
    });
  });

  it('rejects cross-session and cross-workspace use with a named diagnostic', () => {
    const handle = parentHandle();
    expect(checkContextHandleScope(handle, parentRequester)).toBeNull();
    expect(checkContextHandleScope(handle, { ...parentRequester, sessionId: 'sess-stranger' })?.code).toBe('session_mismatch');
    expect(checkContextHandleScope(handle, { ...parentRequester, workspaceId: WS_B })?.code).toBe('workspace_mismatch');
    // Workspace is checked before session: a foreign workspace is never reported as a mere session issue.
    expect(checkContextHandleScope(handle, { ...parentRequester, workspaceId: WS_B, sessionId: 'sess-stranger' })?.code).toBe('workspace_mismatch');
  });

  it('re-scopes a handle for a child with a new id, a lineage pointer and the same evidence identity', () => {
    const handle = parentHandle();
    const child = rescopeContextHandleForChild(handle, { sessionId: 'sess-child' }, { hash });
    expect(child.handleId).not.toBe(handle.handleId);
    expect(child.derivedFrom).toBe(handle.handleId);
    expect(child.scope).toEqual({ workspaceId: WS_A, sessionId: 'sess-child' });
    expect(child.checksum).toBe(handle.checksum);
    expect(child.resourceId).toBe(handle.resourceId);
    expect(normalizeContextHandle(child, { hash })).toEqual(child);
    expect(checkContextHandleScope(child, { ...parentRequester, sessionId: 'sess-child', actor: 'child', depth: 1 })).toBeNull();
    expect(checkContextHandleScope(child, parentRequester)?.code).toBe('session_mismatch');
    expect(checkContextHandleScope(handle, { ...parentRequester, sessionId: 'sess-child', actor: 'child', depth: 1 })?.code).toBe('session_mismatch');
  });

  it('tracks freshness: stale and unknown are visible states, and a ttl expires', () => {
    const stale = parentHandle({ freshness: { status: 'stale' } });
    expect(stale.freshness.status).toBe('stale');
    const ttl = parentHandle({ freshness: { ttlMs: 1_000 } });
    expect(isContextFreshnessExpired(ttl.freshness, '2026-11-03T00:00:00.500Z')).toBe(false);
    expect(isContextFreshnessExpired(ttl.freshness, '2026-11-03T00:00:01.001Z')).toBe(true);
    expect(isContextFreshnessExpired(parentHandle().freshness, '2030-01-01T00:00:00.000Z')).toBe(false);
    expect(isContextFreshnessExpired({ ...ttl.freshness, verifiedAt: 'garbage' }, NOW)).toBe(true);
  });

  it('renders selectors and evidence refs deterministically', () => {
    expect(selectorToText({ kind: 'full' })).toBe('full');
    expect(selectorToText({ kind: 'lines', startLine: 3, endLine: 9 })).toBe('L3-L9');
    expect(selectorToText({ kind: 'chars', offset: 10, length: 40 })).toBe('C10+40');
    const handle = parentHandle();
    expect(evidenceRefForHandle(handle, 'excerpt')).toEqual({
      handleId: handle.handleId,
      resourceId: 'src/taskboard.py',
      selector: 'L26-L36',
      checksum: handle.checksum,
      kind: 'excerpt',
    });
  });
});

describe('ContextExpandRequest/Result/v1', () => {
  it('normalizes a bounded request within the handle and the hard limits', () => {
    const handle = parentHandle({ allowedExpansion: { maxChars: 500 } });
    const request = normalizeContextExpandRequest({
      schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA,
      handle,
      mode: 'excerpt',
      requester: parentRequester,
    }, { hash });
    expect(request.maxChars).toBe(500);
    expect(request.maxBytes).toBe(CONTEXT_FOLDING_LIMITS.expandMaxBytes);
    expect(request.requester).toEqual(parentRequester);
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle, mode: 'excerpt', maxChars: CONTEXT_FOLDING_LIMITS.expandMaxChars + 1, requester: parentRequester }))).toBe('limit_exceeded');
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle, mode: 'excerpt', maxBytes: CONTEXT_FOLDING_LIMITS.expandMaxBytes + 1, requester: parentRequester }))).toBe('limit_exceeded');
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle, mode: 'search', requester: parentRequester }))).toBe('invalid_request');
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle, mode: 'excerpt' }))).toBe('invalid_request');
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle, mode: 'excerpt', requester: { ...parentRequester, depth: 2 } }))).toBe('recursion_depth_exceeded');
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle, mode: 'excerpt', requester: { sessionId: 'sess-parent', actor: 'parent', depth: 0 } }))).toBe('workspace_mismatch');
    expect(codeOf(() => normalizeContextExpandRequest({ schemaVersion: CONTEXT_EXPAND_REQUEST_SCHEMA, handle: { ...handle, handleId: 'cfh_11111111111111111111111111111111' }, mode: 'excerpt', requester: parentRequester }, { hash }))).toBe('invalid_handle_id');
  });

  it('keeps stale, missing, ambiguous and expired references as explicit failures', () => {
    const handle = parentHandle();
    for (const code of ['stale_checksum', 'missing_resource', 'ambiguous_selector', 'expired', 'session_mismatch', 'workspace_mismatch'] as const) {
      const failure = createContextExpandFailure({ handle, mode: 'excerpt', diagnostics: [{ code, message: `${code} for test` }] });
      expect(failure.ok).toBe(false);
      expect(failure.charCount).toBe(0);
      expect(failure.evidenceRefs).toEqual([]);
      expect(normalizeContextExpandResult(JSON.parse(JSON.stringify(failure)))).toEqual(failure);
    }
    expect(codeOf(() => createContextExpandFailure({ handle, mode: 'excerpt', diagnostics: [] }))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextExpandResult({
      schemaVersion: CONTEXT_EXPAND_RESULT_SCHEMA,
      ok: false,
      handleId: handle.handleId,
      mode: 'excerpt',
      truncated: false,
      charCount: 0,
      byteCount: 0,
      resolvedSelector: { kind: 'full' },
      evidenceRefs: [],
      freshness: handle.freshness,
      diagnostics: [],
    }))).toBe('invalid_result');
  });

  it('refuses a result whose declared size disagrees with its content or exceeds the limits', () => {
    const handle = parentHandle();
    const base = {
      schemaVersion: CONTEXT_EXPAND_RESULT_SCHEMA,
      ok: true,
      handleId: handle.handleId,
      mode: 'excerpt',
      content: 'abc',
      truncated: false,
      charCount: 3,
      byteCount: 3,
      resolvedSelector: { kind: 'chars', offset: 0, length: 3 },
      evidenceRefs: [evidenceRefForHandle(handle, 'excerpt', { kind: 'chars', offset: 0, length: 3 })],
      freshness: handle.freshness,
      diagnostics: [],
    };
    const ok = normalizeContextExpandResult(base);
    expect(ok.resolvedSelectorText).toBe('C0+3');
    expect(ok.evidenceRefs[0]?.selector).toBe('C0+3');
    expect(codeOf(() => normalizeContextExpandResult({ ...base, charCount: 4 }))).toBe('invalid_result');
    expect(codeOf(() => normalizeContextExpandResult({ ...base, content: 'x'.repeat(CONTEXT_FOLDING_LIMITS.expandMaxChars + 1), charCount: CONTEXT_FOLDING_LIMITS.expandMaxChars + 1 }))).toBe('limit_exceeded');
    expect(codeOf(() => normalizeContextExpandResult({ ...base, byteCount: CONTEXT_FOLDING_LIMITS.expandMaxBytes + 1 }))).toBe('limit_exceeded');
    expect(codeOf(() => normalizeContextExpandResult({ ...base, evidenceRefs: [{ ...base.evidenceRefs[0], checksum: 'sha1:abc' }] }))).toBe('invalid_handle');
  });
});

describe('ContextFoldRequest/v1', () => {
  const baseInput = () => {
    const handle = parentHandle();
    return {
      objective: 'Find why repeated completion bumps revision and report the defect site.',
      taskScope: { workspaceId: WS_A, workspaceRoot: 'D:/tmp/cf-ws' },
      inputRefs: [handle],
      allowedTools: ['context_expand', 'exec'],
      outputSchema: { kind: 'json-object' as const, required: ['defectLocation'] },
      maxResultChars: 4_000,
      tokenBudget: 20_000,
      timeoutMs: 60_000,
      parentRunIdentity: { workspaceId: WS_A, sessionId: 'sess-parent', depth: 0 as const },
    };
  };

  it('creates a deterministic fold id that is bound to the request body', () => {
    const a = createContextFoldRequest(baseInput(), { hash });
    const b = createContextFoldRequest(baseInput(), { hash });
    expect(a.schemaVersion).toBe(CONTEXT_FOLD_REQUEST_SCHEMA);
    expect(a.foldId).toMatch(/^cff_[0-9a-f]{32}$/);
    expect(a.foldId).toBe(b.foldId);
    expect(computeContextFoldId({ ...a, inputRefs: a.inputRefs.map((handle) => handle.handleId) }, hash)).toBe(a.foldId);
    expect(createContextFoldRequest({ ...baseInput(), objective: 'different objective' }, { hash }).foldId).not.toBe(a.foldId);
    expect(normalizeContextFoldRequest(JSON.parse(JSON.stringify(a)), { hash })).toEqual(a);
    expect(codeOf(() => normalizeContextFoldRequest({ ...a, foldId: 'cff_00000000000000000000000000000000' }, { hash }))).toBe('invalid_request');
    expect(codeOf(() => normalizeContextFoldRequest({ ...a, maxResultChars: 3_999 }, { hash }))).toBe('invalid_request');
  });

  it('only accepts the parent\'s own handles, explicit tools, bounded budgets and depth 0', () => {
    const foreignSession = parentHandle({ scope: { workspaceId: WS_A, sessionId: 'sess-other' } });
    const foreignWorkspace = parentHandle({ scope: { workspaceId: WS_B, sessionId: 'sess-parent' } });
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), inputRefs: [foreignSession] }, { hash }))).toBe('session_mismatch');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), inputRefs: [foreignWorkspace] }, { hash }))).toBe('workspace_mismatch');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), taskScope: { workspaceId: WS_B } }, { hash }))).toBe('workspace_mismatch');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), inputRefs: [parentHandle(), parentHandle()] }, { hash }))).toBe('invalid_request');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), allowedTools: [] }, { hash }))).toBe('tool_not_allowed');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), allowedTools: ['*'] }, { hash }))).toBe('tool_not_allowed');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), allowedTools: ['context_*'] }, { hash }))).toBe('tool_not_allowed');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), maxResultChars: CONTEXT_FOLDING_LIMITS.foldResultMaxChars + 1 }, { hash }))).toBe('limit_exceeded');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), timeoutMs: CONTEXT_FOLDING_LIMITS.foldTimeoutMaxMs + 1 }, { hash }))).toBe('limit_exceeded');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), tokenBudget: 0 }, { hash }))).toBe('limit_exceeded');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), parentRunIdentity: { workspaceId: WS_A, sessionId: 'sess-parent', depth: 1 } as never }, { hash }))).toBe('recursion_depth_exceeded');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), parentRunIdentity: { sessionId: 'sess-parent', depth: 0 } as never }, { hash }))).toBe('workspace_mismatch');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), objective: 'x'.repeat(CONTEXT_FOLDING_LIMITS.objectiveMaxChars + 1) }, { hash }))).toBe('limit_exceeded');
    expect(codeOf(() => createContextFoldRequest({ ...baseInput(), inputRefs: Array.from({ length: CONTEXT_FOLDING_LIMITS.foldInputRefsMax + 1 }, (_, index) => parentHandle({ resourceId: `file-${index}` })) }, { hash }))).toBe('limit_exceeded');
  });

  it('deduplicates allowed tools and keeps text output schemas', () => {
    const request = createContextFoldRequest({ ...baseInput(), allowedTools: ['exec', 'exec', 'context_expand'], outputSchema: { kind: 'text' } }, { hash });
    expect(request.allowedTools).toEqual(['exec', 'context_expand']);
    expect(request.outputSchema).toEqual({ kind: 'text' });
  });
});

describe('feature flag and vocabulary', () => {
  it('is off by default and only an explicit truthy value turns it on; an explicit env value overrides config', () => {
    expect(resolveContextFoldingEnabled()).toEqual({ enabled: false, source: 'default' });
    expect(resolveContextFoldingEnabled({ config: {}, env: {} })).toEqual({ enabled: false, source: 'default' });
    expect(resolveContextFoldingEnabled({ config: { runtime: { contextBlock: { contextFolding: { enabled: true } } } }, env: {} })).toEqual({ enabled: true, source: 'config' });
    expect(resolveContextFoldingEnabled({ config: { contextBlock: { contextFolding: { enabled: true } } }, env: {} })).toEqual({ enabled: true, source: 'config' });
    expect(resolveContextFoldingEnabled({ config: { runtime: { contextBlock: { contextFolding: { enabled: 'yes' } } } }, env: {} })).toEqual({ enabled: false, source: 'default' });
    expect(resolveContextFoldingEnabled({ config: {}, env: { [CONTEXT_FOLDING_ENV]: '1' } })).toEqual({ enabled: true, source: 'env' });
    expect(resolveContextFoldingEnabled({ config: {}, env: { [CONTEXT_FOLDING_ENV]: 'on' } })).toEqual({ enabled: true, source: 'env' });
    expect(resolveContextFoldingEnabled({ config: { runtime: { contextBlock: { contextFolding: { enabled: true } } } }, env: { [CONTEXT_FOLDING_ENV]: '0' } })).toEqual({ enabled: false, source: 'env' });
    expect(resolveContextFoldingEnabled({ config: {}, env: { [CONTEXT_FOLDING_ENV]: 'maybe' } })).toEqual({ enabled: false, source: 'env' });
    expect(resolveContextFoldingEnabled({ config: {}, env: { [CONTEXT_FOLDING_ENV]: '   ' } })).toEqual({ enabled: false, source: 'default' });
    expect(isContextFoldingEnabled({}, {})).toBe(false);
    expect(isContextFoldingEnabled(undefined, {})).toBe(false);
    expect(isContextFoldingEnabled({ runtime: { contextBlock: { contextFolding: { enabled: true } } } }, {})).toBe(true);
    expect(resolveContextFoldingFlagState({}, { [CONTEXT_FOLDING_ENV]: 'true' })).toEqual({ enabled: true, source: 'env' });
  });

  it('describes a disable-only rollback with the frozen limits', () => {
    const status = describeContextFoldingStatus({ config: {}, env: {} });
    expect(status).toMatchObject({
      enabled: false,
      source: 'default',
      flagPath: CONTEXT_FOLDING_FLAG_PATH,
      env: CONTEXT_FOLDING_ENV,
      rollback: 'disable-only',
    });
    expect(status.limits).toBe(CONTEXT_FOLDING_LIMITS);
    expect(CONTEXT_FOLDING_FLAG_PATH).toBe('runtime.contextBlock.contextFolding.enabled');
    expect(CONTEXT_FOLDING_LIMITS.rawChildTranscriptMaxChars).toBe(8_000);
    expect(CONTEXT_FOLDING_LIMITS.maxRecursiveDepth).toBe(1);
    expect(CONTEXT_FOLDING_LIMITS.foldResultMaxChars).toBe(8_000);
  });

  it('freezes the error vocabulary every negative case reports through', () => {
    expect([...CONTEXT_FOLDING_ERROR_CODES]).toEqual(expect.arrayContaining([
      'stale_checksum', 'missing_resource', 'ambiguous_selector', 'expired',
      'session_mismatch', 'workspace_mismatch', 'duplicate_delivery', 'unknown_delivery',
      'timeout', 'cancelled', 'partial', 'raw_transcript_rejected', 'recursion_depth_exceeded',
    ]));
    expect(new Set(CONTEXT_FOLDING_ERROR_CODES).size).toBe(CONTEXT_FOLDING_ERROR_CODES.length);
  });

  it('serializes with a stable key order', () => {
    expect(stableStringifyContextFolding({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
});
