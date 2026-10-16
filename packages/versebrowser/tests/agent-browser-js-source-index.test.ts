/**
 * JS 资源索引单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/jsSourceIndex.test.ts
 * 适配点：仅 import 路径（src/background/browserControl → electron/services/agent-browser/browser-control；
 * src/shared/types → ../src/core/types）。断言逻辑保持一致。
 */
import { describe, expect, it } from 'vitest';
import { JsSourceIndex, isJavaScriptDetail, isJavaScriptMetaLike } from '../src/engine/browser-control/js-source-index';
import type { NetworkRequestDetail } from '../src/core/types';

function createJsDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: 'script-1',
    url: 'https://example.com/assets/app.js',
    method: 'GET',
    status: 200,
    mimeType: 'application/javascript',
    resourceType: 'Script',
    responseBody: "const path = '/api/search';\nfunction makeSign(){ return md5(path + timestamp + nonce); }\n",
    truncated: false,
    redacted: true,
    ...partial,
  };
}

describe('JS 源码索引', () => {
  it('只索引已采集的 JS 文本资源并计算搜索命中位置', () => {
    const index = new JsSourceIndex();

    index.upsertNetworkDetails([
      createJsDetail(),
      createJsDetail({
        id: 'json-1',
        url: 'https://example.com/api/search',
        mimeType: 'application/json',
        resourceType: 'XHR',
        responseBody: '{"ok":true}',
      }),
    ]);

    expect(index.listResources()).toEqual([
      expect.objectContaining({
        id: 'script-1',
        source: 'network',
        searchable: true,
        url: 'https://example.com/assets/app.js',
      }),
    ]);
    expect(index.search(['/api/search', 'md5'], { maxMatches: 10 }).matches).toEqual([
      expect.objectContaining({ resourceId: 'script-1', term: '/api/search', line: 1, column: 15 }),
      expect.objectContaining({ resourceId: 'script-1', term: 'md5', line: 2, column: 29 }),
    ]);
  });

  it('提取上下文时限制片段大小并对敏感赋值做兜底脱敏', () => {
    const index = new JsSourceIndex();
    index.upsertFetchedResource({
      id: 'same-origin-1',
      source: 'same-origin-fetch',
      url: 'https://example.com/assets/auth.js',
      mimeType: 'application/javascript',
      content: "const token = 'secret-token';\nconst private_key = 'pk-material';\nconst otp = '482915';\nconst pin = '7788';\nexport function sign(){ return token; }\n",
      fetchedAt: 1,
    });

    const context = index.extractContext('same-origin-1', 10, { radius: 80 });

    expect(context).toMatchObject({
      resourceId: 'same-origin-1',
      source: 'same-origin-fetch',
      snippet: expect.stringContaining('token = "[REDACTED]"'),
      redacted: true,
    });
    expect(context?.snippet).not.toContain('secret-token');
    // C96/TF-0123: private_key/otp/pin were missing from the snippet assignment list.
    for (const secret of ['pk-material', '482915', '7788']) {
      expect(context?.snippet, secret).not.toContain(secret);
    }
  });

  /**
   * snippet 是先截断到匹配窗口再脱敏的，所以闭合引号经常落在窗口外。旧正则要求「闭合引号 + 值 <=500 字符」，
   * 于是长度超过匹配窗口的密钥（JWT、长 API key 的常见长度）整段以原文进入上下文，且 redacted=false——
   * 与该模块自称的「敏感片段脱敏」和产品「密钥不进上下文」的口径都冲突。
   * 现在「引号未闭合」按「值一直到片段末尾」处理，fail closed 脱敏。
   */
  it('对超出片段窗口的长密钥也脱敏（引号未闭合时脱到片段末尾）', () => {
    for (const length of [160, 600]) {
      const secret = 'J'.repeat(length);
      const index = new JsSourceIndex();
      const resourceId = `long-${length}`;
      index.upsertFetchedResource({
        id: resourceId,
        source: 'same-origin-fetch',
        url: 'https://example.com/assets/long.js',
        content: `const token = "${secret}";\nconst after = 1;\n`,
        fetchedAt: 1,
      });

      const match = index.search(['token']).matches[0]!;
      const context = index.extractContext(resourceId, 6)!;
      expect(match.redacted, `search flag len=${length}`).toBe(true);
      expect(match.snippet, `search len=${length}`).toContain('[REDACTED]');
      expect(match.snippet, `raw run leak len=${length}`).not.toMatch(/J{20,}/);
      expect(context.snippet, `context leak len=${length}`).not.toMatch(/J{20,}/);
    }
  });
  it('JS 判定只参考 pathname、resourceType 和可信 MIME，不被 query 中的 .js 误导', () => {
    const queryLooksLikeJs = createJsDetail({
      id: 'query-js',
      url: 'https://example.com/api/search?next=/assets/app.js',
      resourceType: 'XHR',
      mimeType: 'application/json',
      responseBody: '{"sign":"not-js"}',
    });

    expect(isJavaScriptDetail(queryLooksLikeJs)).toBe(false);
    expect(isJavaScriptMetaLike(queryLooksLikeJs)).toBe(false);
    expect(
      isJavaScriptDetail(
        createJsDetail({
          url: 'https://example.com/assets/app.js?from=api',
          resourceType: 'XHR',
          mimeType: undefined,
        }),
      ),
    ).toBe(true);
    expect(
      isJavaScriptDetail(
        createJsDetail({
          url: 'https://example.com/api/module',
          resourceType: 'XHR',
          mimeType: 'text/javascript; charset=utf-8',
        }),
      ),
    ).toBe(true);
  });
});
