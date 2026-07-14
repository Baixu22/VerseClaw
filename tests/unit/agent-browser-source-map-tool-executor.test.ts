/**
 * Source Map 工具执行器单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/sourceMapToolExecutor.test.ts
 * 适配点：
 * 1. import 路径改为 ClawX 约定
 * 2. 去掉 ModelToolCall/createToolCall，直接调用 executor.listCandidates/resolveLocation/extractOriginalContext
 * 3. 去掉 toolAttachments 断言，改为直接校验返回的 plain result 对象（candidates/resolvedLocations/originalContexts/failures/content）
 * 4. 去掉 BoundaryGrantContext 测试（allowSameOriginFetch 由 service 层授权后直接传入）
 * 5. 错误场景断言 content 字段（执行器不再返回 isError）
 */
import { describe, expect, it, vi } from 'vitest';
import { JsSourceIndex } from '../../electron/services/agent-browser/browser-control/js-source-index';
import { SourceMapToolExecutor } from '../../electron/services/agent-browser/browser-control/source-map-tool-executor';
import type { NetworkRequestDetail } from '@shared/agent-browser/types';
import type { SameOriginSourceMapFetchResult } from '../../electron/services/agent-browser/browser-control/same-origin-source-map-fetcher';

function createJsDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: 'script-1',
    url: 'https://example.com/assets/app.js',
    method: 'GET',
    status: 200,
    mimeType: 'application/javascript',
    resourceType: 'Script',
    responseBody: 'function sign(){return token}\n//# sourceMappingURL=app.js.map',
    responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
    truncated: false,
    redacted: true,
    ...partial,
  };
}

function createSimpleSourceMap(sourceContent = "const token = 'secret-token';\nexport function sign(){ return token; }\n"): string {
  return JSON.stringify({
    version: 3,
    file: 'app.js',
    sources: ['src/app.ts'],
    sourcesContent: [sourceContent],
    names: [],
    mappings: 'AAAA',
  });
}

function createExecutor(
  detail: NetworkRequestDetail,
  fetchResult?: SameOriginSourceMapFetchResult,
  extraDetails: NetworkRequestDetail[] = [],
  pageUrl = 'https://example.com/page',
) {
  const index = new JsSourceIndex();
  const details = [detail, ...extraDetails];
  const recorder = {
    isEnabled: true,
    listRequests: vi.fn(() => details),
    getDetails: vi.fn(async (requestIds: string[]) => requestIds.length === 0 ? details : details.filter((item) => requestIds.includes(item.id))),
  };
  const fetch = vi.fn(async () => fetchResult ?? {
    ok: true as const,
    url: 'https://example.com/assets/app.js.map',
    content: createSimpleSourceMap(),
    mimeType: 'application/json',
    fetchedAt: 1,
  });
  const executor = new SourceMapToolExecutor({
    recorder,
    jsSourceIndex: index,
    getCurrentPageUrl: vi.fn(async () => pageUrl),
    fetcher: { fetch },
  });
  return { executor, recorder, fetch };
}

describe('Source Map 工具执行器', () => {
  it('列出 Source Map 候选并按需读取同源 map', async () => {
    const { executor, fetch } = createExecutor(createJsDetail());

    const result = await executor.listCandidates({ allowSameOriginFetch: true });

    expect(fetch).toHaveBeenCalledWith('https://example.com/assets/app.js.map', 'https://example.com/page');
    expect(result.content).toContain('script-1');
    expect(result.candidates).toEqual([expect.objectContaining({ status: 'available', parsed: true })]);
  });

  it('候选列表工具正文不直接输出完整 Source Map URL', async () => {
    const detail = createJsDetail({
      responseBody: 'function sign(){return token}\n//# sourceMappingURL=app.js.map?token=secret',
    });
    const { executor } = createExecutor(detail);

    const result = await executor.listCandidates({});

    expect(result.content).toContain('外部 Source Map');
    expect(result.content).not.toContain('app.js.map?token=secret');
  });

  it('解析 bundle 位置并从 sourcesContent 提取脱敏后的原始源码片段', async () => {
    const { executor } = createExecutor(createJsDetail());

    const result = await executor.extractOriginalContext({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
      radius: 100,
    });

    expect(result.content).toContain('src/app.ts');
    expect(result.originalContexts).toEqual([
      expect.objectContaining({
        source: expect.stringContaining('src/app.ts'),
        snippet: expect.stringContaining('[已脱敏]'),
        redacted: true,
      }),
    ]);
    expect(result.content).not.toContain('secret-token');
  });

  it('响应头 SourceMap 优先于源码注释候选', async () => {
    const detail = createJsDetail({
      responseHeaders: [{ name: 'SourceMap', value: '/maps/header.js.map' }],
    });
    const { executor, fetch } = createExecutor(detail);

    await executor.resolveLocation({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
    });

    expect(fetch).toHaveBeenCalledWith('https://example.com/maps/header.js.map', 'https://example.com/page');
  });

  it('支持 inline data URL Source Map 且不执行同源 fetch', async () => {
    const inlineMap = Buffer.from(createSimpleSourceMap('export const ok = true;\n')).toString('base64');
    const detail = createJsDetail({
      responseBody: `const ok=true;\n//# sourceMappingURL=data:application/json;base64,${inlineMap}`,
    });
    const { executor, fetch } = createExecutor(detail);

    const result = await executor.resolveLocation({
      resourceId: 'script-1',
      line: 1,
      column: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([expect.objectContaining({ inline: true, parsed: true })]);
    expect(result.resolvedLocations).toEqual([expect.objectContaining({ source: expect.stringContaining('src/app.ts') })]);
  });

  it('map 不含 sourcesContent 时返回明确中文原因', async () => {
    const mapWithoutContent = JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['src/app.ts'],
      names: [],
      mappings: 'AAAA',
    });
    const { executor } = createExecutor(createJsDetail(), {
      ok: true,
      url: 'https://example.com/assets/app.js.map',
      content: mapWithoutContent,
      mimeType: 'application/json',
      fetchedAt: 1,
    });

    const result = await executor.extractOriginalContext({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
    });

    expect(result.content).toContain('Source Map 不包含 sourcesContent');
    expect(result.originalContexts).toEqual([expect.objectContaining({ hasSourceContent: false })]);
  });

  it('外部读取失败时复用已采集的同源 Source Map 响应体', async () => {
    const mapDetail = createJsDetail({
      id: 'map-1',
      url: 'https://example.com/assets/app.js.map',
      mimeType: 'application/json',
      resourceType: 'Other',
      responseBody: createSimpleSourceMap('export const fallbackOk = true;\n'),
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    });
    const { executor, recorder, fetch } = createExecutor(createJsDetail(), {
      ok: false,
      url: 'https://example.com/assets/app.js.map',
      message: 'Source Map 请求被浏览器拒绝。',
    }, [mapDetail]);

    const result = await executor.resolveLocation({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
    });

    expect(fetch).toHaveBeenCalled();
    expect(recorder.listRequests).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual([expect.objectContaining({
      status: 'available',
      parsed: true,
      message: expect.stringContaining('已复用 Network 已采集的同源 Source Map 响应'),
    })]);
    expect(result.resolvedLocations).toEqual([expect.objectContaining({ source: expect.stringContaining('src/app.ts') })]);
    expect(result.failures).toEqual([]);
  });

  it('Source Map 回退详情仍拒绝非法状态、失败请求、非法 MIME、截断、超大和无效 JSON', async () => {
    const invalidDetails: NetworkRequestDetail[] = [
      createJsDetail({
        id: 'map-404',
        url: 'https://example.com/assets/app.js.map',
        status: 404,
        mimeType: 'application/json',
        resourceType: 'Other',
        responseBody: createSimpleSourceMap(),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      }),
      createJsDetail({
        id: 'map-500',
        url: 'https://example.com/assets/app.js.map',
        status: 500,
        mimeType: 'application/json',
        resourceType: 'Other',
        responseBody: createSimpleSourceMap(),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      }),
      createJsDetail({
        id: 'map-failed',
        url: 'https://example.com/assets/app.js.map',
        failed: true,
        mimeType: 'application/json',
        resourceType: 'Other',
        responseBody: createSimpleSourceMap(),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      }),
      createJsDetail({
        id: 'map-invalid-mime',
        url: 'https://example.com/assets/app.js.map',
        mimeType: 'image/png',
        resourceType: 'Other',
        responseBody: createSimpleSourceMap(),
        responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
      }),
      createJsDetail({
        id: 'map-truncated',
        url: 'https://example.com/assets/app.js.map',
        mimeType: 'application/json',
        resourceType: 'Other',
        responseBody: createSimpleSourceMap(),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        truncated: true,
      }),
      createJsDetail({
        id: 'map-too-large',
        url: 'https://example.com/assets/app.js.map',
        mimeType: 'application/json',
        resourceType: 'Other',
        responseBody: 'x'.repeat(1_000_001),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      }),
      createJsDetail({
        id: 'map-invalid-json',
        url: 'https://example.com/assets/app.js.map',
        mimeType: 'application/json',
        resourceType: 'Other',
        responseBody: '{',
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      }),
    ];
    const { executor } = createExecutor(createJsDetail(), {
      ok: false,
      url: 'https://example.com/assets/app.js.map',
      message: 'Source Map 请求被浏览器拒绝。',
    }, invalidDetails);

    const result = await executor.resolveLocation({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
    });

    expect(result.content).toContain('Source Map 请求被浏览器拒绝。');
    expect(result.candidates).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect(result.resolvedLocations).toEqual([expect.objectContaining({ message: 'Source Map 请求被浏览器拒绝。' })]);
  });

  it('Source Map 回退详情仍拒绝与当前页面不同源的同 URL 缓存', async () => {
    const mapDetail = createJsDetail({
      id: 'map-cross-origin-page',
      url: 'https://example.com/assets/app.js.map',
      mimeType: 'application/json',
      resourceType: 'Other',
      responseBody: createSimpleSourceMap(),
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    });
    const { executor } = createExecutor(createJsDetail(), {
      ok: false,
      url: 'https://example.com/assets/app.js.map',
      message: 'Source Map 请求被浏览器拒绝。',
    }, [mapDetail], 'https://other.example/page');

    const result = await executor.resolveLocation({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
    });

    expect(result.candidates).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect(result.resolvedLocations).toEqual([expect.objectContaining({ message: 'Source Map 请求被浏览器拒绝。' })]);
  });

  it('提取原始上下文时始终将结果标记为已脱敏', async () => {
    const { executor } = createExecutor(createJsDetail());

    const result = await executor.extractOriginalContext({
      resourceId: 'script-1',
      line: 1,
      column: 1,
      allowSameOriginFetch: true,
    });

    expect(result.originalContexts).toEqual([expect.objectContaining({ redacted: true })]);
  });

  it('当 JS 资源已截断时会提示 sourceMappingURL 可能不准确', async () => {
    const { executor } = createExecutor(createJsDetail({
      truncated: true,
      responseBody: 'function sign(){return token}\n//# sourceMappingURL=app.js.map',
    }));

    const result = await executor.listCandidates({});

    expect(result.candidates).toEqual([expect.objectContaining({ message: expect.stringContaining('JS 资源已截断，sourceMappingURL 可能不准确。') })]);
  });

  it('未启用 recorder 或参数非法时返回中文错误内容', async () => {
    const index = new JsSourceIndex();
    const executor = new SourceMapToolExecutor({
      recorder: {
        isEnabled: false,
        listRequests: vi.fn(),
        getDetails: vi.fn(),
      },
      jsSourceIndex: index,
      getCurrentPageUrl: vi.fn(async () => 'https://example.com/page'),
      fetcher: { fetch: vi.fn() },
    });

    const disabledResult = await executor.listCandidates({});
    expect(disabledResult.content).toBe('Source Map 解析依赖 Network 采集，请先开启浏览器控制。');
    expect(disabledResult.candidates).toEqual([]);

    const enabledExecutor = createExecutor(createJsDetail()).executor;
    const invalidResult = await enabledExecutor.resolveLocation({
      resourceId: 'script-1',
      line: 0,
      column: 1,
    });
    expect(invalidResult.content).toBe('line 和 column 必须是大于等于 1 的有限数字。');
    expect(invalidResult.resolvedLocations).toEqual([]);
  });
});
