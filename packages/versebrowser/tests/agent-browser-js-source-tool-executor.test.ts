/**
 * JS 源码工具执行器单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/jsSourceToolExecutor.test.ts
 * 适配点：
 * 1. import 路径改为 ClawX 约定
 * 2. 去掉 ModelToolCall/createToolCall，直接调用 executor.listResources/searchSources/extractContext
 * 3. 去掉 toolAttachments 断言，改为直接校验返回的 plain result 对象（resources/matches/contexts/failedFetches/content）
 * 4. 去掉 BoundaryGrantContext 测试（allowSameOriginFetch 由 service 层授权后直接传入）
 * 5. 错误场景断言 content 字段（执行器不再返回 isError）
 */
import { describe, expect, it, vi } from 'vitest';
import { JsSourceToolExecutor } from '../src/engine/browser-control/js-source-tool-executor';
import type { NetworkRequestDetail } from '../src/core/types';

function createJsDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: 'script-1',
    url: 'https://example.com/assets/app.js',
    method: 'GET',
    status: 200,
    mimeType: 'application/javascript',
    resourceType: 'Script',
    responseBody: "function makeSign(){ return md5('/api/search' + timestamp); }",
    truncated: false,
    redacted: true,
    ...partial,
  };
}

describe('JS 源码工具执行器', () => {
  it('列出、搜索并提取已采集 JS 资源', async () => {
    const executor = new JsSourceToolExecutor({
      recorder: {
        isEnabled: true,
        listRequests: vi.fn(() => [createJsDetail()]),
        getDetails: vi.fn(async () => [createJsDetail()]),
      },
      getCurrentPageUrl: vi.fn(async () => 'https://example.com/page'),
      fetcher: { fetch: vi.fn() },
    });

    const listResult = await executor.listResources();
    expect(listResult.content).toContain('script-1');
    expect(listResult.resources).toEqual([expect.objectContaining({ id: 'script-1', source: 'network' })]);

    const searchResult = await executor.searchSources({ keywords: ['/api/search', 'md5'] });
    expect(searchResult.content).toContain('makeSign');
    expect(searchResult.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceId: 'script-1' })]),
    );
    expect(searchResult.matches.length).toBe(2);

    const extractResult = await executor.extractContext({ resourceId: 'script-1', position: 20 });
    expect(extractResult.content).toContain('makeSign');
    expect(extractResult.contexts).toEqual([
      expect.objectContaining({ resourceId: 'script-1' }),
    ]);
  });

  it('搜索时按需执行同源补位，部分失败不阻断成功资源', async () => {
    const executor = new JsSourceToolExecutor({
      recorder: {
        isEnabled: true,
        listRequests: vi.fn(() => []),
        getDetails: vi.fn(async () => []),
      },
      getCurrentPageUrl: vi.fn(async () => 'https://example.com/page'),
      fetcher: {
        fetch: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            resource: {
              id: 'same-origin-app',
              source: 'same-origin-fetch',
              url: 'https://example.com/app.js',
              mimeType: 'application/javascript',
              content: "const api = '/api/search';",
              fetchedAt: 1,
            },
          })
          .mockResolvedValueOnce({ ok: false, url: 'https://example.com/missing.js', message: '同源 JS 补位读取失败。' }),
      },
    });

    const result = await executor.searchSources({
      keywords: ['/api/search'],
      urls: ['https://example.com/app.js', 'https://example.com/missing.js'],
      allowSameOriginFetch: true,
    });

    expect(result.content).toContain('same-origin-fetch');
    expect(result.failedFetches).toEqual([
      expect.objectContaining({ message: '同源 JS 补位读取失败。' }),
    ]);
    expect(result.resources.map((r) => r.id)).toContain('same-origin-app');
  });

  /**
   * listResources() 返回的 id 是 `same-origin-js:<url>`，URL 上限 2048，所以合法 id 可以远超 256 字符。
   * 过去 extractContext 把入参 resourceId 截断到 256——刚列出的资源用它的 id 反查必然落空，只回一句
   * 「未找到指定 JS 资源或位置」。标识符要么原样接受、要么显式报错，不能静默截短。
   */
  it('用 listResources 返回的长 id 仍能提取上下文', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(300) + '.js';
    const executor = new JsSourceToolExecutor({
      recorder: { isEnabled: true, listRequests: vi.fn(() => []), getDetails: vi.fn(async () => []) },
      getCurrentPageUrl: vi.fn(async () => 'https://example.com/page'),
      fetcher: {
        fetch: vi.fn(async (url: string) => ({
          ok: true as const,
          resource: {
            id: 'same-origin-js:' + url,
            source: 'same-origin-fetch' as const,
            url,
            mimeType: 'application/javascript',
            content: 'const longUrlMarker = 1;',
            fetchedAt: 1,
          },
        })),
      },
    });

    await executor.searchSources({ keywords: ['longUrlMarker'], urls: [longUrl], allowSameOriginFetch: true });
    const listed = (await executor.listResources()).resources;
    const id = listed[0]!.id;
    expect(id.length).toBeGreaterThan(256);

    const extracted = await executor.extractContext({ resourceId: id, position: 0 });
    expect(extracted.contexts).toHaveLength(1);
    expect(extracted.content).toContain('longUrlMarker');

    // 超界仍是显式报错，而不是静默的「未找到」。
    const tooLong = await executor.extractContext({ resourceId: 'x'.repeat(4097), position: 0 });
    expect(tooLong.content).toBe('resourceId 必须是非空字符串。');
  });
  it('未启用 Network recorder 或参数非法时返回中文错误内容', async () => {
    const recorder = {
      isEnabled: false,
      listRequests: vi.fn(),
      getDetails: vi.fn(),
    };
    const executor = new JsSourceToolExecutor({
      recorder,
      getCurrentPageUrl: vi.fn(async () => 'https://example.com/page'),
      fetcher: { fetch: vi.fn() },
    });

    const disabledResult = await executor.searchSources({ keywords: ['sign'] });
    expect(disabledResult.content).toBe('JS 源码检索依赖 Network 采集，请先开启浏览器控制。');
    expect(disabledResult.matches).toEqual([]);

    recorder.isEnabled = true;
    const invalidKeywordsResult = await executor.searchSources({ keywords: [] });
    expect(invalidKeywordsResult.content).toBe('keywords 必须是包含 1 到 20 个非空字符串的数组。');
    expect(invalidKeywordsResult.matches).toEqual([]);
  });
});
