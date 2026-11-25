/**
 * 请求重放沙箱执行器单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/replayToolExecutor.test.ts
 * 适配点：
 * 1. import 路径改为 ClawX 约定
 * 2. 去掉 ModelToolCall/createToolCall，直接调用 executor.prepareRequest/sendRequest/compareResponses
 * 3. scopeKey 创建改为 createBoundaryGrantScopeKey({ name, arguments }) 形式
 * 4. prepareRequest 是同步方法（无 fetch），不需要 await
 */
import { describe, expect, it, vi } from 'vitest';
import { ReplayToolExecutor } from '../src/engine/browser-control/replay-tool-executor';
import { REPLAY_SEND_REQUEST_TOOL_NAME } from '../src/core/tool-registry';
import type { NetworkRequestDetail, NetworkRequestMeta } from '../src/core/types';
import type { BoundaryGrantContext } from '../src/core/tool-authorization';
import { createBoundaryGrantScopeKey } from '../src/core/tool-authorization';

function createMeta(overrides: Partial<NetworkRequestMeta> = {}): NetworkRequestMeta {
  return {
    id: 'req-1',
    url: 'https://example.com/api/items?page=1',
    method: 'GET',
    status: 200,
    requestHeaders: [{ name: 'Accept', value: 'application/json' }],
    ...overrides,
  };
}

function createGrant(overrides: Partial<BoundaryGrantContext> = {}): BoundaryGrantContext {
  const scopeKey = overrides.scopeKey ?? createBoundaryGrantScopeKey({
    name: REPLAY_SEND_REQUEST_TOOL_NAME,
    arguments: { draftId: 'draft-placeholder' },
  });
  return {
    id: 'grant-1',
    tabId: 7,
    origin: 'https://example.com',
    toolCallId: 'call-boundary',
    scopeKey,
    grants: ['send_single_confirmed_replay_request_without_credentials'],
    selectedChoiceIds: ['send_once'],
    createdAt: Date.now(),
    expiresAt: Date.now() + 30000,
    ...overrides,
  };
}

function createExecutor(options: {
  meta?: NetworkRequestMeta;
  grant?: BoundaryGrantContext;
  getGrant?: () => BoundaryGrantContext | undefined;
  fetcher?: typeof fetch;
  origin?: string;
  enabled?: boolean;
} = {}): ReplayToolExecutor {
  const meta = options.meta ?? createMeta();
  const recorder = {
    isEnabled: options.enabled ?? true,
    getRawRequestMeta: vi.fn((requestId: string) => (requestId === meta.id ? meta : undefined)),
    getDetails: vi.fn(async (): Promise<NetworkRequestDetail[]> => [{
      ...meta,
      responseBody: '{"ok":true}',
      truncated: false,
      redacted: false,
    }]),
  };
  const fetcher = options.fetcher ?? vi.fn(async () => new Response('{"ok":true}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

  return new ReplayToolExecutor(
    recorder,
    fetcher,
    () => ({ tabId: 7, origin: options.origin ?? 'https://example.com', enhanced: true, grant: options.getGrant?.() ?? options.grant }),
  );
}

function prepareDraft(executor: ReplayToolExecutor): string {
  const result = executor.prepareRequest({ requestId: 'req-1' });
  expect(result.isError).toBeUndefined();
  const match = result.content.match(/draftId：(\S+)/);
  expect(match?.[1]).toBeTruthy();
  return match![1];
}

describe('请求重放沙箱执行器', () => {
  it.each(['query', 'json', 'form', 'text', 'header'] as const)('rejects credential names in %s before preparing a replay', (format) => {
    const fetcher = vi.fn(async () => new Response(null)) as unknown as typeof fetch;
    const makeMeta = (fields: Record<string, string>): NetworkRequestMeta => {
      if (format === 'query') return createMeta({ url: `https://example.com/api/items?${new URLSearchParams(fields)}` });
      if (format === 'header') return createMeta({ requestHeaders: Object.entries(fields).map(([name, value]) => ({ name, value })) });
      return createMeta({ method: 'POST',
        requestHeaders: [{ name: 'Content-Type', value: format === 'json' ? 'application/json' : format === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain' }],
        requestBody: format === 'json' ? JSON.stringify({ entries: [fields] }) : new URLSearchParams(fields).toString(),
      });
    };
    for (const key of ['private_key', 'auth_token', 'client_secret', 'x-session-id', 'otp', 'pin', 'credentials']) {
      expect(createExecutor({ meta: makeMeta({ [key]: 'fixture-value' }), fetcher }).prepareRequest({ requestId: 'req-1' }), key).toMatchObject({ isError: true });
    }
    const ordinary = { shipping: 'ground', mapping: 'fixture', sessionId: 'row-1', passThrough: 'enabled', author: 'fixture', page: '2' };
    expect(createExecutor({ meta: makeMeta(ordinary), fetcher }).prepareRequest({ requestId: 'req-1' }).isError).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('claims a draft before dispatch so concurrent sends have one network effect', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const approval: { grant?: BoundaryGrantContext } = {};
    const executor = createExecutor({ fetcher: fetcher as typeof fetch, getGrant: () => approval.grant });
    const draftId = prepareDraft(executor);
    approval.grant = createGrant({ scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }) });
    const first = executor.sendRequest({ draftId });
    try {
      expect((await executor.sendRequest({ draftId })).isError).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { finish(new Response('{}')); await first; }
    expect((await executor.sendRequest({ draftId })).isError).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['connection reset', 'AbortError'])('keeps a %s send consumed when the outcome is unknown', async (failure) => {
    const fetcher = vi.fn(async () => { throw Object.assign(new Error(failure), { name: failure }); });
    const approval: { grant?: BoundaryGrantContext } = {};
    const executor = createExecutor({ fetcher: fetcher as typeof fetch, getGrant: () => approval.grant });
    const draftId = prepareDraft(executor);
    approval.grant = createGrant({ scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }) });
    await expect(executor.sendRequest({ draftId })).rejects.toThrow(failure);
    expect((await executor.sendRequest({ draftId })).isError).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ tabId: 8 }, { origin: 'https://other.example' }, { expiresAt: 0 }])('rejects a mismatched or expired grant %j', async (override) => {
    const fetcher = vi.fn(async () => new Response('{}'));
    const approval: { grant?: BoundaryGrantContext } = {};
    const executor = createExecutor({ fetcher: fetcher as typeof fetch, getGrant: () => approval.grant });
    const draftId = prepareDraft(executor);
    approval.grant = createGrant({ ...override, scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }) });
    expect((await executor.sendRequest({ draftId })).isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prepare 只生成草案且未确认时不能发送', async () => {
    const fetcher = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const executor = createExecutor({ fetcher });

    const draftId = prepareDraft(executor);
    const sendResult = await executor.sendRequest({ draftId });

    expect(sendResult).toMatchObject({
      isError: true,
      content: '发送请求重放前必须先通过用户边界确认。',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('拒绝非 JSON 文本 body 里的凭据键名', () => {
    // C96/TF-0123: the free-text body rule used to omit private_key / authorization / cookie /
    // otp / pin, so a text/plain body carrying one of them was accepted for replay (measured
    // 2026-10-14) while token= / credential= were refused.
    for (const key of ['private_key', 'authorization', 'cookie', 'otp', 'pin']) {
      expect(
        createExecutor({ meta: createMeta({ method: 'POST', requestBody: `${key}=VALUE`,
          requestHeaders: [{ name: 'Content-Type', value: 'text/plain' }] }) }).prepareRequest({ requestId: 'req-1' }),
        key,
      ).toMatchObject({ isError: true });
    }
    // An ordinary body is still accepted (no over-refusal).
    expect(
      createExecutor({ meta: createMeta({ method: 'POST', requestBody: 'page=2&q=hello',
        requestHeaders: [{ name: 'Content-Type', value: 'text/plain' }] }) }).prepareRequest({ requestId: 'req-1' }),
    ).not.toMatchObject({ isError: true });
  });

  it('拒绝危险 method、敏感 header 和跨当前 origin 目标', () => {
    expect(createExecutor({ meta: createMeta({ method: 'DELETE' }) }).prepareRequest({ requestId: 'req-1' })).toMatchObject({
      isError: true,
      content: '请求重放沙箱 v1 只允许 GET、HEAD 和受限 POST。',
    });
    expect(createExecutor({ meta: createMeta({ requestHeaders: [{ name: 'Authorization', value: 'Bearer secret' }] }) }).prepareRequest({ requestId: 'req-1' })).toMatchObject({
      isError: true,
      content: '请求包含敏感 Header，受控增强模式下拒绝重放。',
    });
    expect(createExecutor({ meta: createMeta({ url: 'https://other.example/api' }) }).prepareRequest({ requestId: 'req-1' })).toMatchObject({
      isError: true,
      content: '请求重放 v1 只允许当前受控页面同源目标。',
    });
    expect(createExecutor({ meta: createMeta({ requestHeaders: [{ name: 'x-api-key', value: 'secret' }] }) }).prepareRequest({ requestId: 'req-1' })).toMatchObject({
      isError: true,
      content: '请求包含敏感 Header，受控增强模式下拒绝重放。',
    });
    expect(createExecutor({ meta: createMeta({ url: 'https://example.com/api?token=secret' }) }).prepareRequest({ requestId: 'req-1' })).toMatchObject({
      isError: true,
      content: '请求重放沙箱拒绝包含敏感 query 字段的请求。',
    });
    expect(createExecutor({
      meta: createMeta({
        method: 'POST',
        requestHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        requestBody: '{"password":"123456"}',
      }),
    }).prepareRequest({ requestId: 'req-1' })).toMatchObject({
      isError: true,
      content: '请求重放沙箱拒绝包含敏感 body 字段的请求。',
    });
  });

  it('授权后发送请求必须由 background fetch 且不携带凭据', async () => {
    const fetcher = vi.fn(async () => new Response('{"token":"secret","ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-trace-id': 'abc' },
    })) as unknown as typeof fetch;
    const grant: { current?: BoundaryGrantContext } = {};
    const executor = createExecutor({ fetcher, getGrant: () => approval.grant.current });

    const draftId = prepareDraft(executor);
    grant.current = createGrant({ scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }) });
    const sendResult = await executor.sendRequest({ draftId });

    expect(sendResult.isError).toBeUndefined();
    expect(sendResult.content).toContain('请求重放已完成');
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/api/items?page=1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
      }),
    );
    expect(sendResult.content).not.toContain('secret');
  });

  it('free-text responses go through the shared redactor instead of URLSearchParams', async () => {
    // C96/TF-0123: a text/plain body used to come back mangled, with the credential intact
    // (`Authorization%3A+Bearer+<token>=%5BREDACTED%5D`), and the MCP envelope did not cover it.
    const secret = 'sk-live-abcdefghijklmnop';
    const fetcher = vi.fn(async () => new Response(`Authorization: Bearer ${secret}`, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })) as unknown as typeof fetch;
    const grant: { current?: BoundaryGrantContext } = {};
    const executor = createExecutor({ fetcher, getGrant: () => approval.grant.current });
    const draftId = prepareDraft(executor);
    grant.current = createGrant({ scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }) });
    const sendResult = await executor.sendRequest({ draftId });

    expect(sendResult.isError).toBeUndefined();
    expect(String(sendResult.content)).not.toContain(secret);
    expect(String(sendResult.content)).not.toContain('%3A');
    expect(String(sendResult.content)).toContain('Authorization: [REDACTED]');
  });

  it('发送时保留重复 Header 且只跟随一次同源重定向', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Headers;
      if (String(url).endsWith('/api/items?page=1')) {
        expect(headers.get('x-repeat')).toBe('one, two');
        return new Response(null, {
          status: 302,
          headers: { location: '/api/redirected' },
        });
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const grant: { current?: BoundaryGrantContext } = {};
    const executor = createExecutor({
      fetcher,
      getGrant: () => approval.grant.current,
      meta: createMeta({
        requestHeaders: [
          { name: 'x-repeat', value: 'one' },
          { name: 'x-repeat', value: 'two' },
        ],
      }),
    });

    const draftId = prepareDraft(executor);
    grant.current = createGrant({ scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }) });
    const sendResult = await executor.sendRequest({ draftId });

    expect(sendResult.isError).toBeUndefined();
    expect(sendResult.content).toContain('- 重定向：是');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('https://example.com/api/redirected', expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
    }));
  });
});
