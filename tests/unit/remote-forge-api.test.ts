import { describe, expect, it, vi } from 'vitest';
import {
  createRemoteForgeApi,
  REMOTE_FORGE_MERGE_APPROVAL_TTL_MS,
  type RemoteForgeApiOptions,
  REMOTE_FORGE_READ_LIMITS,
} from '@electron/services/remote-forge-api';
import type { RemoteForgeRequestTrace } from '@shared/types/remote-forge';
import type { PermissionApprovalEvent, WorkspaceProfile } from '@shared/types/workspace';

const baseUrl = 'https://remote-forge.invalid';

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'x-github-request-id': 'fixture-request', ...headers },
  });
}

function text(value: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(value, {
    status,
    headers: { 'content-type': 'text/plain', 'x-github-request-id': 'fixture-request', ...headers },
  });
}

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;

const detail = {
  number: 7,
  title: 'Bounded forge read',
  state: 'open',
  draft: false,
  head: { ref: 'feature/forge', sha: 'head-sha-7' },
  base: { ref: 'main', sha: 'base-sha-1' },
  user: { login: 'octocat' },
  mergeable: true,
  mergeable_state: 'clean',
  updated_at: '2026-07-28T00:00:00Z',
};

const file = {
  filename: 'src/read.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1 +1 @@\n-old\n+new',
};

const unifiedDiff = [
  'diff --git a/src/read.ts b/src/read.ts',
  'index 3367afd..3e75765 100644',
  '--- a/src/read.ts',
  '+++ b/src/read.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n');

function defaultResponse(url: URL, init: RequestInit): Response {
  const accept = new Headers(init.headers).get('accept');
  if (url.pathname === '/repos/acme/demo') return json({ id: 1, full_name: 'acme/demo' });
  if (url.pathname === '/repos/acme/demo/pulls/7' && accept?.includes('diff')) return text(unifiedDiff);
  if (url.pathname === '/repos/acme/demo/pulls/7') return json(detail);
  if (url.pathname.endsWith('/pulls/7/commits')) {
    return json([{ sha: 'commit-1', commit: { message: 'Change', author: { name: 'A', date: '2026-07-28T00:00:00Z' } } }]);
  }
  if (url.pathname.endsWith('/pulls/7/files')) return json([file]);
  if (url.pathname.endsWith('/pulls/7/reviews')) {
    return json([{ id: 1, state: 'APPROVED', user: { login: 'reviewer' }, commit_id: 'head-sha-7' }]);
  }
  if (url.pathname.endsWith('/commits/head-sha-7/check-runs')) {
    return json({ check_runs: [{ id: 1, name: 'test', status: 'completed', conclusion: 'success' }] });
  }
  if (url.pathname.endsWith('/branches/main/protection')) {
    return json({
      required_pull_request_reviews: { required_approving_review_count: 1 },
      required_status_checks: { contexts: ['test'], strict: true },
      required_conversation_resolution: { enabled: false },
    });
  }
  throw new Error(`Unhandled fixture route: ${url.pathname}${url.search}`);
}

function fixtureFetch(handler?: FetchHandler) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return await handler?.(url, init) ?? defaultResponse(url, init);
  }) as unknown as typeof fetch;
}

function createApi(fetchImpl: typeof fetch, traceSink?: (trace: RemoteForgeRequestTrace) => void) {
  return createRemoteForgeApi({
    baseUrl,
    fetchImpl,
    tokenProvider: () => 'fixture-token',
    traceSink,
  });
}

function workspace(): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: 'C:/project',
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

function approvalHarness() {
  const approvals = new Map<string, PermissionApprovalEvent>();
  let nextId = 1;
  const adapter: NonNullable<RemoteForgeApiOptions['approvalAdapter']> = {
    create: async (input) => {
      const event: PermissionApprovalEvent = {
        id: `approval-${nextId++}`,
        workspaceId: input.workspace.id,
        sessionKey: input.workspace.activeSessionKey,
        mode: input.workspace.permissionMode,
        source: input.source,
        requestedAt: Date.now(),
        status: 'pending',
        risk: input.risk,
        command: input.command,
        requestHash: input.requestHash,
        paramsPreview: input.paramsPreview,
        paths: input.paths,
        reason: input.reason,
      };
      approvals.set(event.id, event);
      return event;
    },
    consume: async (input) => {
      const event = approvals.get(input.id);
      if (!event
        || event.status !== 'approved'
        || event.workspaceId !== input.workspaceId
        || event.source !== input.source
        || event.command !== input.command
        || event.requestHash !== input.requestHash
        || JSON.stringify(event.paths ?? []) !== JSON.stringify(input.paths ?? [])) return null;
      approvals.set(event.id, { ...event, status: 'expired', resolvedAt: Date.now() });
      return event;
    },
  };
  return {
    adapter,
    approve(id: string, resolvedAt = Date.now()) {
      const event = approvals.get(id);
      if (!event) throw new Error(`Unknown approval ${id}`);
      approvals.set(id, { ...event, status: 'approved', resolvedAt });
    },
    get(id: string) {
      return approvals.get(id);
    },
  };
}

function createMutationApi(
  fetchImpl: typeof fetch,
  approvals: ReturnType<typeof approvalHarness>,
  traceSink?: (trace: RemoteForgeRequestTrace) => void,
) {
  return createRemoteForgeApi({
    baseUrl,
    fetchImpl,
    tokenProvider: () => 'fixture-token',
    traceSink,
    workspaceProvider: () => workspace(),
    approvalAdapter: approvals.adapter,
  });
}

function createMergeApi(
  fetchImpl: typeof fetch,
  approvals: ReturnType<typeof approvalHarness>,
  options: Pick<RemoteForgeApiOptions, 'mergePolicyProvider' | 'mergeAuditSink' | 'traceSink'> = {},
) {
  return createRemoteForgeApi({
    baseUrl,
    fetchImpl,
    tokenProvider: () => 'fixture-token',
    workspaceProvider: () => workspace(),
    approvalAdapter: approvals.adapter,
    mergePolicyProvider: options.mergePolicyProvider ?? (() => ({
      allowedRepositories: ['acme/demo'],
      agentMergeEnabled: false,
      version: 'fixture-v1',
    })),
    mergeAuditSink: options.mergeAuditSink,
    traceSink: options.traceSink,
  });
}

const pullRequestPayload = { provider: 'github' as const, owner: 'acme', repository: 'demo', number: 7 };
const mergePayload = {
  ...pullRequestPayload,
  expectedHeadSha: 'head-sha-7',
  strategy: 'squash' as const,
};

describe('Remote Forge Main read adapter', () => {
  it('does not infer endpoint permissions from repository visibility alone', async () => {
    const result = await createApi(fixtureFetch()).capabilities({
      provider: 'github',
      owner: 'acme',
      repository: 'demo',
    });

    expect(result).toMatchObject({
      success: true,
      capability: {
        protocol: 'github-rest',
        authentication: 'token',
        pullRequestRead: 'unknown',
        protectionRead: 'unknown',
      },
    });
  });

  it('deduplicates paginated collections and remains complete when all pages succeed', async () => {
    const commits = Array.from({ length: 100 }, (_, index) => ({
      sha: `commit-${index}`,
      commit: { message: `Commit ${index}`, author: { name: 'A' } },
    }));
    const fetchImpl = fixtureFetch((url) => {
      if (!url.pathname.endsWith('/pulls/7/commits')) return undefined;
      if (url.searchParams.get('page') === '1') return json(commits);
      return json([
        { sha: 'commit-99', commit: { message: 'Updated duplicate', author: { name: 'B' } } },
        { sha: 'commit-100', commit: { message: 'Final', author: { name: 'C' } } },
      ]);
    });

    const result = await createApi(fetchImpl).readPullRequest(pullRequestPayload);

    expect(result.success).toBe(true);
    expect(result.pullRequest?.commits.completeness).toEqual({ state: 'complete', reasons: [] });
    expect(result.pullRequest?.commits.items).toHaveLength(101);
    expect(result.pullRequest?.commits.items.find((entry) => entry.sha === 'commit-99')?.message).toBe('Updated duplicate');
    expect(result.pullRequest?.readiness.state).toBe('ready');
  });

  it('preserves partial items and fails closed when a later page fails', async () => {
    const commits = Array.from({ length: 100 }, (_, index) => ({
      sha: `commit-${index}`,
      commit: { message: `Commit ${index}`, author: { name: 'A' } },
    }));
    const fetchImpl = fixtureFetch((url) => {
      if (!url.pathname.endsWith('/pulls/7/commits')) return undefined;
      return url.searchParams.get('page') === '1'
        ? json(commits)
        : json({ message: 'upstream body must not escape' }, 502);
    });

    const result = await createApi(fetchImpl).readPullRequest(pullRequestPayload);

    expect(result.success).toBe(false);
    expect(result.pullRequest?.commits.items).toHaveLength(100);
    expect(result.pullRequest?.commits.completeness).toEqual({ state: 'incomplete', reasons: ['pagination_failed'] });
    expect(result.pullRequest?.readiness).toMatchObject({ state: 'unknown', reasons: expect.arrayContaining(['incomplete_evidence']) });
    expect(JSON.stringify(result)).not.toContain('upstream body must not escape');
  });

  it('marks missing head and unknown protection as unknown readiness', async () => {
    const missingHeadFetch = fixtureFetch((url, init) => {
      if (url.pathname === '/repos/acme/demo/pulls/7' && !new Headers(init.headers).get('accept')?.includes('diff')) {
        return json({ ...detail, head: { ref: 'feature/forge', sha: null } });
      }
      return undefined;
    });
    const missingHead = await createApi(missingHeadFetch).readPullRequest(pullRequestPayload);
    expect(missingHead.pullRequest?.readiness).toMatchObject({
      state: 'unknown',
      reasons: expect.arrayContaining(['missing_head', 'incomplete_evidence']),
    });
    expect((missingHeadFetch as ReturnType<typeof vi.fn>).mock.calls.some(([input]) => String(input).includes('/check-runs'))).toBe(false);

    const unknownProtection = await createApi(fixtureFetch((url) => (
      url.pathname.endsWith('/branches/main/protection') ? json({ message: 'forbidden' }, 403) : undefined
    ))).readPullRequest(pullRequestPayload);
    expect(unknownProtection.pullRequest?.protection.state).toBe('unknown');
    expect(unknownProtection.pullRequest?.readiness).toMatchObject({
      state: 'unknown',
      reasons: expect.arrayContaining(['protection_unknown']),
    });
  });

  it('does not silently complete malformed collections, missing patches, or diff drift', async () => {
    const malformed = await createApi(fixtureFetch((url) => (
      url.pathname.endsWith('/pulls/7/files') ? json([file, { filename: 'C:\\private\\secret.ts' }]) : undefined
    ))).readPullRequest(pullRequestPayload);
    expect(malformed.pullRequest?.files.completeness).toEqual({ state: 'incomplete', reasons: ['malformed_response'] });
    expect(malformed.pullRequest?.readiness.state).toBe('unknown');

    const missingPatch = await createApi(fixtureFetch((url) => (
      url.pathname.endsWith('/pulls/7/files') ? json([{ ...file, patch: undefined }]) : undefined
    ))).readPullRequest(pullRequestPayload);
    expect(missingPatch.pullRequest?.diffCompleteness).toEqual({ state: 'incomplete', reasons: ['missing_patch'] });
    expect(missingPatch.pullRequest?.patchArtifacts[0]).toMatchObject({ completeness: 'unavailable' });

    const mismatch = await createApi(fixtureFetch((url, init) => {
      if (url.pathname === '/repos/acme/demo/pulls/7' && new Headers(init.headers).get('accept')?.includes('diff')) {
        return text(unifiedDiff.replaceAll('src/read.ts', 'src/other.ts'));
      }
      return undefined;
    })).readPullRequest(pullRequestPayload);
    expect(mismatch.pullRequest?.diffCompleteness).toEqual({ state: 'incomplete', reasons: ['diff_mismatch'] });
    expect(mismatch.pullRequest?.patchArtifacts[0]).toMatchObject({ file: 'src/read.ts', completeness: 'unavailable' });
  });

  it('bounds oversized bodies and never exposes response content in errors', async () => {
    const secretBody = 'Authorization: Bearer real-secret repository source';
    const result = await createApi(fixtureFetch((url, init) => {
      if (url.pathname === '/repos/acme/demo/pulls/7' && new Headers(init.headers).get('accept')?.includes('diff')) {
        return text(secretBody, 200, { 'content-length': String(REMOTE_FORGE_READ_LIMITS.maxResponseBytes + 1) });
      }
      return undefined;
    })).readPullRequest(pullRequestPayload);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('truncated_response');
    expect(result.pullRequest?.diffCompleteness).toEqual({ state: 'unavailable', reasons: ['request_failed'] });
    expect(JSON.stringify(result)).not.toContain(secretBody);
  });

  it('limits content concurrency and distinguishes UTF-8, binary, provider encoding, truncation, and malformed payloads', async () => {
    let active = 0;
    let maxActive = 0;
    const values: Record<string, { content: string; encoding: string; size: number }> = {
      'text.ts': { content: Buffer.from('const value = 1;').toString('base64'), encoding: 'base64', size: 16 },
      'binary.bin': { content: Buffer.from([0xff]).toString('base64'), encoding: 'base64', size: 1 },
      'provider.txt': { content: 'provider-value', encoding: 'utf-8', size: 14 },
      'empty.txt': { content: '', encoding: 'base64', size: 0 },
      'malformed.txt': { content: 'not-base64!', encoding: 'base64', size: 4 },
      'large.txt': { content: 'YQ==', encoding: 'base64', size: REMOTE_FORGE_READ_LIMITS.maxDecodedContentBytes + 1 },
    };
    const fetchImpl = fixtureFetch(async (url) => {
      if (!url.pathname.includes('/contents/')) return undefined;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '');
      return json(values[path]);
    });

    const result = await createApi(fetchImpl).readContents({
      provider: 'github',
      owner: 'acme',
      repository: 'demo',
      ref: 'head-sha-7',
      paths: Object.keys(values),
    });

    expect(maxActive).toBe(REMOTE_FORGE_READ_LIMITS.contentConcurrency);
    expect(result.success).toBe(false);
    expect(result.contents.map((entry) => [entry.path, entry.kind])).toEqual([
      ['text.ts', 'utf8'],
      ['binary.bin', 'binary'],
      ['provider.txt', 'base64'],
      ['empty.txt', 'utf8'],
      ['malformed.txt', 'unavailable'],
      ['large.txt', 'truncated'],
    ]);
    expect(result.contents[0]?.text).toBe('const value = 1;');
    expect(result.contents[2]?.base64).toBe(Buffer.from('provider-value').toString('base64'));
  });

  it('rejects unsafe paths before transport and emits sanitized request traces', async () => {
    const traces: RemoteForgeRequestTrace[] = [];
    const fetchImpl = fixtureFetch();
    const api = createApi(fetchImpl, (trace) => traces.push(trace));

    const invalid = await api.readContents({
      provider: 'github',
      owner: 'acme',
      repository: 'demo',
      ref: 'head-sha-7',
      paths: ['C:/private/repository.ts'],
    });
    expect(invalid).toMatchObject({ success: false, contents: [], error: { code: 'invalid_request' } });
    expect(fetchImpl).not.toHaveBeenCalled();

    await api.readPullRequest(pullRequestPayload);
    const serialized = JSON.stringify(traces);
    expect(serialized).not.toMatch(/fixture-token|Authorization|acme|demo|src\/read|remote-forge\.invalid/i);
    expect(traces.every((trace) => trace.route.startsWith('/repos/{owner}/{repository}'))).toBe(true);
    const authorizationHeaders = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => (
      new Headers((init as RequestInit).headers).get('authorization')
    ));
    expect(authorizationHeaders).toContain('Bearer fixture-token');
  });

  it('requires an exact one-time approval before submitting a review', async () => {
    const traces: RemoteForgeRequestTrace[] = [];
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      if (url.pathname.endsWith('/pulls/7/reviews') && init.method === 'POST') return json({ id: 501 });
      return undefined;
    });
    const api = createMutationApi(fetchImpl, approvals, (trace) => traces.push(trace));
    const reviewBody = 'Review body must not enter approval previews or traces.';
    const payload = {
      ...pullRequestPayload,
      action: 'review_submit' as const,
      event: 'comment' as const,
      expectedHeadSha: 'head-sha-7',
      body: reviewBody,
    };

    const blocked = await api.mutatePullRequest(payload);
    expect(blocked).toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
      binding: { action: 'review_submit', payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (init as RequestInit).method === 'POST')).toBe(false);
    expect(blocked.approval?.paramsPreview).not.toContain(reviewBody);

    approvals.approve(blocked.approval!.id);
    const published = await api.mutatePullRequest({ ...payload, approvalId: blocked.approval!.id });
    expect(published).toMatchObject({
      success: true,
      mutation: {
        state: 'succeeded',
        effects: [
          { id: 'primary', state: 'succeeded', remoteId: '501' },
          { id: 'refresh', state: 'succeeded' },
        ],
        reconciliation: { required: false },
      },
    });
    expect(JSON.stringify(published.mutation)).not.toContain(reviewBody);
    expect(JSON.stringify(traces)).not.toContain(reviewBody);
    expect(traces.find((trace) => trace.method === 'POST')).toMatchObject({
      route: '/repos/{owner}/{repository}/pulls/{number}/reviews',
      payloadDigest: blocked.binding?.payloadDigest,
    });

    const replay = await api.mutatePullRequest({ ...payload, approvalId: blocked.approval!.id });
    expect(replay).toMatchObject({ success: false, blocked: true, error: { code: 'permission_denied' } });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST')).toHaveLength(1);
  });

  it('consumes approval before failing closed on stale head or metadata version', async () => {
    let currentDetail = detail;
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      if (url.pathname === '/repos/acme/demo/pulls/7' && (init.method ?? 'GET') === 'GET'
        && !new Headers(init.headers).get('accept')?.includes('diff')) return json(currentDetail);
      if ((init.method ?? 'GET') !== 'GET') return json({ id: 700 });
      return undefined;
    });
    const api = createMutationApi(fetchImpl, approvals);
    const linePayload = {
      ...pullRequestPayload,
      action: 'line_comment_create' as const,
      expectedHeadSha: 'head-sha-7',
      path: 'src/read.ts',
      side: 'RIGHT' as const,
      line: 1,
      body: 'Line note',
      diffHunk: '@@ -1 +1 @@\n-old\n+new',
    };
    const lineBlocked = await api.mutatePullRequest(linePayload);
    approvals.approve(lineBlocked.approval!.id);
    currentDetail = { ...detail, head: { ...detail.head, sha: 'head-sha-8' } };
    const staleHead = await api.mutatePullRequest({ ...linePayload, approvalId: lineBlocked.approval!.id });
    expect(staleHead).toMatchObject({ success: false, error: { code: 'stale_head' } });
    expect(approvals.get(lineBlocked.approval!.id)?.status).toBe('expired');

    currentDetail = detail;
    const metadataPayload = {
      ...pullRequestPayload,
      action: 'metadata_update' as const,
      expectedHeadSha: 'head-sha-7',
      expectedUpdatedAt: detail.updated_at,
      title: 'Updated title',
    };
    const metadataBlocked = await api.mutatePullRequest(metadataPayload);
    approvals.approve(metadataBlocked.approval!.id);
    currentDetail = { ...detail, updated_at: '2026-07-28T00:01:00Z' };
    const staleVersion = await api.mutatePullRequest({ ...metadataPayload, approvalId: metadataBlocked.approval!.id });
    expect(staleVersion).toMatchObject({ success: false, error: { code: 'conflict' } });
    expect(approvals.get(metadataBlocked.approval!.id)?.status).toBe('expired');
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => ['POST', 'PATCH', 'PUT'].includes(String((init as RequestInit).method)))).toBe(false);
  });

  it('rejects action or payload drift without using the approved write', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => (
      (init.method ?? 'GET') !== 'GET' ? json({ id: 800 }) : undefined
    ));
    const api = createMutationApi(fetchImpl, approvals);
    const payload = {
      ...pullRequestPayload,
      action: 'thread_reply' as const,
      expectedHeadSha: 'head-sha-7',
      commentId: 44,
      body: 'Original reply',
    };
    const blocked = await api.mutatePullRequest(payload);
    approvals.approve(blocked.approval!.id);

    const bodyDrift = await api.mutatePullRequest({ ...payload, body: 'Changed reply', approvalId: blocked.approval!.id });
    expect(bodyDrift).toMatchObject({ success: false, blocked: true, error: { code: 'permission_denied' } });
    const actionDrift = await api.mutatePullRequest({
      ...pullRequestPayload,
      action: 'comment_edit',
      expectedHeadSha: 'head-sha-7',
      commentId: 44,
      body: 'Original reply',
      approvalId: blocked.approval!.id,
    });
    expect(actionDrift).toMatchObject({ success: false, blocked: true, error: { code: 'permission_denied' } });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (
      ['POST', 'PATCH', 'PUT'].includes(String((init as RequestInit).method))
    ))).toBe(false);
  });

  it.each([
    {
      name: 'line comment',
      payload: { action: 'line_comment_create' as const, path: 'src/read.ts', side: 'RIGHT' as const, line: 1, body: 'Line body', diffHunk: '@@ -1 +1 @@' },
      route: '/pulls/7/comments',
      method: 'POST',
    },
    {
      name: 'comment edit',
      payload: { action: 'comment_edit' as const, commentId: 20, body: 'Edited body' },
      route: '/pulls/comments/20',
      method: 'PATCH',
    },
    {
      name: 'thread reply',
      payload: { action: 'thread_reply' as const, commentId: 20, body: 'Reply body' },
      route: '/pulls/7/comments/20/replies',
      method: 'POST',
    },
  ])('executes $name only after approval and returns digest-only comment lineage', async ({ payload, route, method }) => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => (
      url.pathname.endsWith(route) && init.method === method ? json({ id: 900 }) : undefined
    ));
    const api = createMutationApi(fetchImpl, approvals);
    const input = { ...pullRequestPayload, ...payload, expectedHeadSha: 'head-sha-7' };
    const blocked = await api.mutatePullRequest(input);
    approvals.approve(blocked.approval!.id);
    const result = await api.mutatePullRequest({ ...input, approvalId: blocked.approval!.id });
    expect(result).toMatchObject({ success: true, mutation: { state: 'succeeded', commentSnapshot: { headSha: 'head-sha-7' } } });
    expect(result.mutation?.commentSnapshot?.bodyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.mutation)).not.toContain(payload.body);
  });

  it('returns partial success when metadata primary succeeds but follow-ups need reconciliation', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      if (url.pathname === '/repos/acme/demo/pulls/7' && init.method === 'PATCH') return json({ id: 7, ...detail, title: 'Updated title' });
      if (url.pathname.endsWith('/issues/7/labels') && init.method === 'PUT') return json({ message: 'hidden upstream detail' }, 502);
      if (url.pathname.endsWith('/requested_reviewers') && init.method === 'POST') return json({ requested_reviewers: [{ login: 'reviewer' }] });
      return undefined;
    });
    const api = createMutationApi(fetchImpl, approvals);
    const payload = {
      ...pullRequestPayload,
      action: 'metadata_update' as const,
      expectedHeadSha: 'head-sha-7',
      expectedUpdatedAt: detail.updated_at,
      title: 'Updated title',
      labels: ['reviewed'],
      reviewers: ['reviewer'],
    };
    const blocked = await api.mutatePullRequest(payload);
    approvals.approve(blocked.approval!.id);
    const result = await api.mutatePullRequest({ ...payload, approvalId: blocked.approval!.id });

    expect(result.success).toBe(true);
    expect(result.mutation?.state).toBe('partial');
    expect(result.mutation?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'primary', state: 'succeeded' }),
      expect.objectContaining({ id: 'labels', state: 'unknown', error: expect.objectContaining({ code: 'upstream_unavailable' }) }),
      expect.objectContaining({ id: 'reviewers', state: 'succeeded' }),
      expect.objectContaining({ id: 'refresh', state: 'succeeded' }),
    ]));
    expect(result.mutation?.reconciliation).toEqual({
      required: true,
      state: 'refresh_required',
      reasons: ['follow_up_failed'],
    });
    expect(JSON.stringify(result)).not.toContain('hidden upstream detail');
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit).method === 'PATCH')).toHaveLength(1);
  });

  it.each([
    { status: 403, headers: {}, code: 'permission_denied', state: 'failed' },
    { status: 403, headers: { 'x-ratelimit-remaining': '0' }, code: 'rate_limited', state: 'failed' },
  ])('maps a rejected primary write to $code without leaking the response', async ({ status, headers, code, state }) => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => (
      url.pathname.endsWith('/pulls/7/reviews') && init.method === 'POST'
        ? json({ message: 'Authorization Bearer hidden-response' }, status, headers)
        : undefined
    ));
    const api = createMutationApi(fetchImpl, approvals);
    const payload = {
      ...pullRequestPayload,
      action: 'review_submit' as const,
      event: 'approve' as const,
      expectedHeadSha: 'head-sha-7',
      body: 'Approved',
    };
    const blocked = await api.mutatePullRequest(payload);
    approvals.approve(blocked.approval!.id);
    const result = await api.mutatePullRequest({ ...payload, approvalId: blocked.approval!.id });
    expect(result).toMatchObject({ success: false, mutation: { state, effects: [{ error: { code } }] } });
    expect(JSON.stringify(result)).not.toContain('hidden-response');
  });

  it('marks an ambiguous primary network failure unknown and refuses approval replay', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      if (url.pathname.endsWith('/pulls/7/reviews') && init.method === 'POST') throw new TypeError('private host and body');
      return undefined;
    });
    const api = createMutationApi(fetchImpl, approvals);
    const payload = {
      ...pullRequestPayload,
      action: 'review_submit' as const,
      event: 'comment' as const,
      expectedHeadSha: 'head-sha-7',
      body: 'Potentially delivered review',
    };
    const blocked = await api.mutatePullRequest(payload);
    approvals.approve(blocked.approval!.id);
    const result = await api.mutatePullRequest({ ...payload, approvalId: blocked.approval!.id });
    expect(result).toMatchObject({
      success: false,
      mutation: {
        state: 'unknown',
        effects: [{ id: 'primary', state: 'unknown', error: { code: 'network_error' } }],
        reconciliation: { required: true, state: 'manual_check_required', reasons: ['primary_unknown'] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private host and body');
    const replay = await api.mutatePullRequest({ ...payload, approvalId: blocked.approval!.id });
    expect(replay).toMatchObject({ success: false, error: { code: 'permission_denied' } });
  });

  it('re-reads readiness around exact approval and performs one expected-head sandbox merge', async () => {
    let merged = false;
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      const accept = new Headers(init.headers).get('accept');
      if (url.pathname === '/repos/acme/demo/pulls/7' && (init.method ?? 'GET') === 'GET' && !accept?.includes('diff')) {
        return json(merged ? { ...detail, state: 'closed', merged: true } : detail);
      }
      if (url.pathname === '/repos/acme/demo/pulls/7/merge' && init.method === 'PUT') {
        merged = true;
        return json({ merged: true, sha: 'merge-sha-1' });
      }
      return undefined;
    });
    const api = createMergeApi(fetchImpl, approvals);

    const blocked = await api.mergePullRequest(mergePayload);
    expect(blocked).toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
      readiness: { state: 'ready' },
      policy: { allowed: true, sandboxOnly: true, agentMergeEnabled: false },
      binding: {
        action: 'merge',
        strategy: 'squash',
        readinessDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        sandboxPolicyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(false);

    approvals.approve(blocked.approval!.id);
    const result = await api.mergePullRequest({
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });
    expect(result).toMatchObject({
      success: true,
      mutation: {
        state: 'succeeded',
        effects: [
          { id: 'primary', operation: 'merge', state: 'succeeded', remoteId: 'merge-sha-1' },
          { id: 'refresh', state: 'succeeded' },
          { id: 'audit', state: 'succeeded' },
        ],
        reconciliation: { required: false },
      },
    });
    const mergeCalls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.filter(([input, init]) => (
      new URL(input instanceof Request ? input.url : input.toString()).pathname.endsWith('/merge')
      && (init as RequestInit).method === 'PUT'
    ));
    expect(mergeCalls).toHaveLength(1);
    expect(JSON.parse(String((mergeCalls[0]?.[1] as RequestInit).body))).toEqual({
      sha: 'head-sha-7',
      merge_method: 'squash',
    });
    const replay = await api.mergePullRequest({
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });
    expect(replay).toMatchObject({ success: false, blocked: true, error: { code: 'permission_denied' } });
    expect(mergeCalls).toHaveLength(1);
  });

  it.each([
    ['draft', (url: URL, init: RequestInit) => (
      url.pathname === '/repos/acme/demo/pulls/7' && !new Headers(init.headers).get('accept')?.includes('diff')
        ? json({ ...detail, draft: true }) : undefined
    )],
    ['conflict', (url: URL, init: RequestInit) => (
      url.pathname === '/repos/acme/demo/pulls/7' && !new Headers(init.headers).get('accept')?.includes('diff')
        ? json({ ...detail, mergeable: false, mergeable_state: 'dirty' }) : undefined
    )],
    ['behind', (url: URL, init: RequestInit) => (
      url.pathname === '/repos/acme/demo/pulls/7' && !new Headers(init.headers).get('accept')?.includes('diff')
        ? json({ ...detail, mergeable_state: 'behind' }) : undefined
    )],
    ['checks pending', (url: URL) => url.pathname.endsWith('/check-runs')
      ? json({ check_runs: [{ id: 1, name: 'test', status: 'in_progress', conclusion: null }] }) : undefined],
    ['checks failed', (url: URL) => url.pathname.endsWith('/check-runs')
      ? json({ check_runs: [{ id: 1, name: 'test', status: 'completed', conclusion: 'failure' }] }) : undefined],
    ['incomplete evidence', (url: URL) => url.pathname.endsWith('/branches/main/protection')
      ? json({ message: 'unavailable' }, 502) : undefined],
  ] as Array<[string, FetchHandler]>)('blocks %s before approval or merge transport', async (_name, handler) => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch(handler);
    const result = await createMergeApi(fetchImpl, approvals).mergePullRequest(mergePayload);
    expect(result).toMatchObject({ success: false, blocked: true });
    expect(result.approvalRequired).not.toBe(true);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(false);
  });

  it('enforces the sandbox allowlist and keeps Agent merge default-off', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch();
    const deniedRepository = createMergeApi(fetchImpl, approvals, {
      mergePolicyProvider: () => ({ allowedRepositories: ['safe/disposable'], agentMergeEnabled: false }),
    });
    expect(await deniedRepository.mergePullRequest(mergePayload)).toMatchObject({
      success: false,
      blocked: true,
      policy: { reason: 'repository_not_allowed', allowed: false },
      error: { code: 'permission_denied' },
    });

    const agentDisabled = createMergeApi(fetchImpl, approvals);
    expect(await agentDisabled.mergePullRequest(mergePayload, { initiator: 'agent' })).toMatchObject({
      success: false,
      blocked: true,
      policy: { reason: 'agent_merge_disabled', allowed: false, agentMergeEnabled: false },
      error: { code: 'permission_denied' },
    });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(false);
  });

  it('consumes approval before rejecting head, readiness, or sandbox-policy drift', async () => {
    let currentHead = 'head-sha-7';
    let checkName = 'test';
    let policyVersion = 'fixture-v1';
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      const accept = new Headers(init.headers).get('accept');
      if (url.pathname === '/repos/acme/demo/pulls/7' && (init.method ?? 'GET') === 'GET' && !accept?.includes('diff')) {
        return json({ ...detail, head: { ...detail.head, sha: currentHead } });
      }
      if (url.pathname.endsWith('/check-runs')) {
        return json({ check_runs: [{ id: 1, name: checkName, status: 'completed', conclusion: 'success' }] });
      }
      return undefined;
    });
    const api = createMergeApi(fetchImpl, approvals, {
      mergePolicyProvider: () => ({ allowedRepositories: ['acme/demo'], agentMergeEnabled: false, version: policyVersion }),
    });
    const approve = async () => {
      const blocked = await api.mergePullRequest(mergePayload);
      approvals.approve(blocked.approval!.id);
      return blocked;
    };
    const retry = (blocked: Awaited<ReturnType<typeof api.mergePullRequest>>) => api.mergePullRequest({
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });

    const headApproval = await approve();
    currentHead = 'head-sha-8';
    expect(await retry(headApproval)).toMatchObject({ success: false, error: { code: 'stale_head' } });
    expect(approvals.get(headApproval.approval!.id)?.status).toBe('expired');

    currentHead = 'head-sha-7';
    const readinessApproval = await approve();
    checkName = 'renamed-check';
    expect(await retry(readinessApproval)).toMatchObject({ success: false, error: { code: 'conflict' } });
    expect(approvals.get(readinessApproval.approval!.id)?.status).toBe('expired');

    checkName = 'test';
    const policyApproval = await approve();
    policyVersion = 'fixture-v2';
    expect(await retry(policyApproval)).toMatchObject({ success: false, error: { code: 'permission_denied' } });
    expect(approvals.get(policyApproval.approval!.id)?.status).toBe('expired');
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(false);
  });

  it.each([
    ['strategy', { strategy: 'rebase' as const }],
    ['payload', { commitTitle: 'Changed after approval' }],
  ])('rejects %s drift against the approved merge binding', async (_name, patch) => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch();
    const api = createMergeApi(fetchImpl, approvals);
    const blocked = await api.mergePullRequest(mergePayload);
    approvals.approve(blocked.approval!.id);
    const result = await api.mergePullRequest({
      ...mergePayload,
      ...patch,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });
    expect(result).toMatchObject({ success: false, blocked: true, error: { code: 'permission_denied' } });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(false);
  });

  it('consumes and rejects an expired merge approval before re-reading or writing', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch();
    const api = createMergeApi(fetchImpl, approvals);
    const blocked = await api.mergePullRequest(mergePayload);
    approvals.approve(blocked.approval!.id, Date.now() - REMOTE_FORGE_MERGE_APPROVAL_TTL_MS - 1);
    const readsBeforeRetry = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;
    const result = await api.mergePullRequest({
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });
    expect(result).toMatchObject({ success: false, blocked: true, error: { code: 'permission_denied' } });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(readsBeforeRetry);
    expect(approvals.get(blocked.approval!.id)?.status).toBe('expired');
  });

  it('maps provider merge conflict to stable refresh-required reconciliation', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => (
      url.pathname.endsWith('/pulls/7/merge') && init.method === 'PUT'
        ? json({ merged: false, message: 'private provider detail' }, 409)
        : undefined
    ));
    const api = createMergeApi(fetchImpl, approvals);
    const blocked = await api.mergePullRequest(mergePayload);
    approvals.approve(blocked.approval!.id);
    const result = await api.mergePullRequest({
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });
    expect(result).toMatchObject({
      success: false,
      mutation: {
        state: 'failed',
        effects: [{ id: 'primary', state: 'failed', error: { code: 'conflict' } }],
        reconciliation: { required: true, state: 'refresh_required', reasons: ['provider_conflict'] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private provider detail');
  });

  it('keeps successful merge primary effect while audit follow-up requires reconciliation', async () => {
    let merged = false;
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      const accept = new Headers(init.headers).get('accept');
      if (url.pathname === '/repos/acme/demo/pulls/7' && (init.method ?? 'GET') === 'GET' && !accept?.includes('diff')) {
        return json(merged ? { ...detail, state: 'closed', merged: true } : detail);
      }
      if (url.pathname.endsWith('/pulls/7/merge') && init.method === 'PUT') {
        merged = true;
        return json({ merged: true, sha: 'merge-sha-2' });
      }
      return undefined;
    });
    const api = createMergeApi(fetchImpl, approvals, {
      mergeAuditSink: async () => { throw new Error('private audit failure'); },
    });
    const blocked = await api.mergePullRequest(mergePayload);
    approvals.approve(blocked.approval!.id);
    const result = await api.mergePullRequest({
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest,
    });
    expect(result).toMatchObject({
      success: true,
      mutation: {
        state: 'partial',
        effects: [
          { id: 'primary', state: 'succeeded' },
          { id: 'refresh', state: 'succeeded' },
          { id: 'audit', state: 'failed', error: { code: 'internal' } },
        ],
        reconciliation: { required: true, state: 'refresh_required', reasons: ['audit_failed'] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private audit failure');
  });

  it('marks an ambiguous merge write unknown and prevents replay', async () => {
    const approvals = approvalHarness();
    const fetchImpl = fixtureFetch((url, init) => {
      if (url.pathname.endsWith('/pulls/7/merge') && init.method === 'PUT') throw new TypeError('private merge network');
      return undefined;
    });
    const api = createMergeApi(fetchImpl, approvals);
    const blocked = await api.mergePullRequest(mergePayload);
    approvals.approve(blocked.approval!.id);
    const approvedPayload = {
      ...mergePayload,
      approvalId: blocked.approval!.id,
      expectedReadinessDigest: blocked.binding!.readinessDigest!,
      expectedPolicyDigest: blocked.binding!.sandboxPolicyDigest!,
    };
    const result = await api.mergePullRequest(approvedPayload);
    expect(result).toMatchObject({
      success: false,
      mutation: {
        state: 'unknown',
        effects: [{ id: 'primary', state: 'unknown', error: { code: 'network_error' } }],
        reconciliation: { required: true, state: 'manual_check_required', reasons: ['primary_unknown'] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private merge network');
    expect(await api.mergePullRequest(approvedPayload)).toMatchObject({
      success: false,
      error: { code: 'permission_denied' },
    });
  });
});
