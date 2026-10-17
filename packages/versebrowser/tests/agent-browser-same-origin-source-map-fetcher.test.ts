/**
 * 同源 Source Map 读取器单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/sameOriginSourceMapFetcher.test.ts
 * 适配点：仅 import 路径（src/background/browserControl → electron/services/agent-browser/browser-control）。断言逻辑保持一致。
 */
import { describe, expect, it, vi } from 'vitest';
import { SameOriginSourceMapFetcher } from '../src/engine/browser-control/same-origin-source-map-fetcher';

function createResponse(input: {
  ok?: boolean;
  status?: number;
  url?: string;
  contentType?: string;
  contentLength?: string;
  body?: string;
  type?: ResponseType;
}): Response {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    url: input.url ?? 'https://example.com/app.js.map',
    type: input.type ?? 'basic',
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') {
          return input.contentType ?? 'application/json';
        }
        if (name.toLowerCase() === 'content-length') {
          return input.contentLength ?? null;
        }
        return null;
      },
    },
    text: async () => input.body ?? '{"version":3}',
  } as Response;
}

function createStreamResponse(input: {
  headers?: HeadersInit;
  body?: string;
  streamError?: Error;
  textError?: Error;
}): Response {
  const body = input.streamError
    ? new ReadableStream({
      pull() {
        throw input.streamError;
      },
    })
    : input.body ?? '{"version":3}';
  const response = new Response(body, {
    status: 200,
    headers: input.headers ?? {
      'Content-Type': 'application/json',
    },
  });
  if (input.textError) {
    Object.defineProperty(response, 'body', { value: undefined });
    response.text = vi.fn(async () => {
      throw input.textError;
    }) as unknown as typeof response.text;
  }
  Object.defineProperty(response, 'url', { value: 'https://example.com/app.js.map' });
  return response;
}

describe('同源 Source Map 读取器', () => {
  it('按同源规则读取 map 且不携带凭据', async () => {
    const fetcherMock = vi.fn(async () => createResponse({ body: '{"version":3}' }));
    const fetcher = new SameOriginSourceMapFetcher(fetcherMock as unknown as typeof fetch);

    const result = await fetcher.fetch('/app.js.map', 'https://example.com/page');

    expect(result).toMatchObject({ ok: true, url: 'https://example.com/app.js.map', content: '{"version":3}' });
    expect(fetcherMock).toHaveBeenCalledWith('https://example.com/app.js.map', expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
    }));
  });

  it('接受浏览器已自动解压的 gzip Source Map 响应', async () => {
    const fetcherMock = vi.fn(async () => createStreamResponse({
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
      },
      body: '{"version":3,"file":"app.js","sources":[],"names":[],"mappings":""}',
    }));
    const fetcher = new SameOriginSourceMapFetcher(fetcherMock as unknown as typeof fetch);

    await expect(fetcher.fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: true,
      content: expect.stringContaining('"version":3'),
    });
  });

  it('拒绝跨域 URL 和跨域重定向', async () => {
    const fetcher = new SameOriginSourceMapFetcher(vi.fn(async () => createResponse({ url: 'https://cdn.example.net/app.js.map' })) as unknown as typeof fetch);

    await expect(fetcher.fetch('https://evil.example/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 只允许读取当前页面同源资源。',
    });
    await expect(fetcher.fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 读取拒绝跨域重定向。',
    });
  });

  it('拒绝非法 MIME 和超大小响应', async () => {
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createResponse({ contentType: 'image/png' })) as unknown as typeof fetch)
      .fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 只接受 JSON 或 map 文本资源。',
    });
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createResponse({ contentLength: '1000001' })) as unknown as typeof fetch)
      .fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 响应超过大小上限。',
    });
  });

  it('只允许 .map 路径上的文本响应，不接受 octet-stream 或普通脚本文本', async () => {
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createResponse({ contentType: 'text/plain' })) as unknown as typeof fetch)
      .fetch('/app.js', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 只接受 JSON 或 map 文本资源。',
    });
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createResponse({ contentType: 'application/octet-stream' })) as unknown as typeof fetch)
      .fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 只接受 JSON 或 map 文本资源。',
    });
  });

  it('区分请求失败、超时、状态码失败和响应体读取失败', async () => {
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch).fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 请求被浏览器拒绝。',
    });

    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as typeof fetch).fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 读取超时。',
    });

    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createResponse({ ok: false, status: 404 })) as unknown as typeof fetch)
      .fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 读取失败，HTTP 状态码 404。',
    });

    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createStreamResponse({
      textError: new Error('body locked'),
    })) as unknown as typeof fetch).fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 响应体读取失败。',
    });
  });

  it('流式响应体读取阶段超时时仍返回超时摘要', async () => {
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => createStreamResponse({
      streamError: new DOMException('The operation was aborted.', 'AbortError'),
    })) as unknown as typeof fetch).fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({
      ok: false,
      message: 'Source Map 读取超时。',
    });
  });
  /**
   * 早退路径（重定向 / 非同源 / 非 2xx / MIME 不符 / content-length 过大）在读取前就返回，超限时又只
   * releaseLock——两者都没有取消 body，而调用方的 abort 定时器已在同一个 finally 里清除，未读字节与
   * 连接被弃置到 GC。真实 bundle 的 map 常超 1MB，超限就是常态。
   */
  it('取消它不会读取的响应体，而不是把它弃置', async () => {
    const makeRecordingResponse = (opts: { status?: number; contentType?: string; chunks?: Uint8Array[] }) => {
      const events: string[] = [];
      let index = 0;
      const chunks = opts.chunks ?? [new TextEncoder().encode('{"version":3}')];
      const reader = {
        async read() { events.push('read'); if (index >= chunks.length) return { done: true, value: undefined }; return { done: false, value: chunks[index++]! }; },
        releaseLock() { events.push('releaseLock'); },
        async cancel() { events.push('reader.cancel'); },
      };
      const status = opts.status ?? 200;
      const response = {
        ok: status >= 200 && status < 300,
        status,
        url: 'https://example.com/app.js.map',
        type: 'basic',
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (opts.contentType ?? 'application/json') : null) },
        body: { getReader: () => reader, async cancel() { events.push('body.cancel'); } },
      } as unknown as Response;
      return { response, events };
    };

    const oversized = makeRecordingResponse({ chunks: [new Uint8Array(600_000), new Uint8Array(600_000)] });
    await expect(new SameOriginSourceMapFetcher(vi.fn(async () => oversized.response) as unknown as typeof fetch)
      .fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({ ok: false, message: 'Source Map 响应超过大小上限。' });
    expect(oversized.events, '超限必须取消读取器').toContain('reader.cancel');

    const cases: Array<[string, { status?: number; contentType?: string }]> = [['非 2xx', { status: 404 }], ['MIME 不符', { contentType: 'image/png' }], ['重定向', { status: 302 }]];
    for (const [label, opts] of cases) {
      const probe = makeRecordingResponse(opts);
      await expect(new SameOriginSourceMapFetcher(vi.fn(async () => probe.response) as unknown as typeof fetch)
        .fetch('/app.js.map', 'https://example.com/page')).resolves.toMatchObject({ ok: false });
      expect(probe.events, label).toContain('body.cancel');
      expect(probe.events, label).not.toContain('read');
    }
  });

});
