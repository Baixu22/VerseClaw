/**
 * 页面文本提取器单元测试 — 适配自 SRC extractPageText.test.ts
 * 适配点：
 * 1. SRC 在 content script 中直接操作 DOM；ClawX 通过 CDP Runtime.evaluate 注入表达式
 * 2. 本测试 mock connection.evaluate，验证表达式构建与响应解析，不测试实际 DOM 提取（属集成测试范畴）
 * 3. 实际 DOM 提取逻辑（URL 匹配、CSS/XPath、可见文本过滤、回退、截断）零改动内联到表达式中，由 SRC 测试覆盖
 */
import { describe, expect, it, vi } from 'vitest';
import { PageTextExtractor, type ExtractPageTextResult } from '../../electron/services/agent-browser/browser-control/page-text-extractor';
import type { ExtractionRule } from '@shared/agent-browser/types';

function createRule(partial: Partial<ExtractionRule> = {}): ExtractionRule {
  return {
    id: 'rule-1',
    alias: '',
    urlPattern: 'https://example.com/.*',
    selectorsText: 'main',
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function mockEvaluate(result: ExtractPageTextResult) {
  return vi.fn(async (_params: Record<string, unknown>) => ({
    result: { value: JSON.stringify(result) },
  }));
}

describe('页面文本提取器', () => {
  it('构建包含规则与 URL 的提取表达式并通过 CDP 执行', async () => {
    const evaluate = mockEvaluate({ text: '正文内容', truncated: false, usedFallback: false, matchedRuleId: 'rule-1' });
    const extractor = new PageTextExtractor({ evaluate });

    const result = await extractor.extract({
      url: 'https://example.com/article',
      rules: [createRule({ selectorsText: 'main' })],
      maxLength: 100,
    });

    expect(result).toEqual({ text: '正文内容', truncated: false, usedFallback: false, matchedRuleId: 'rule-1' });
    const params = evaluate.mock.calls[0]?.[0];
    if (!params) throw new Error('Expected evaluate call');
    expect(params.awaitPromise).toBe(true);
    expect(params.returnByValue).toBe(true);
    expect(params.expression).toContain('https://example.com/article');
    expect(params.expression).toContain('"selectorsText":"main"');
    expect(params.expression).toContain('"maxLength":100');
    expect(params.expression).toContain('extractPageText');
  });

  it('默认使用 text 提取模式与 100000 字符上限', async () => {
    const evaluate = mockEvaluate({ text: '内容', truncated: false, usedFallback: true });
    const extractor = new PageTextExtractor({ evaluate });

    await extractor.extract({
      url: 'https://example.com/page',
      rules: [],
    });

    const params = evaluate.mock.calls[0]?.[0];
    if (!params) throw new Error('Expected evaluate call');
    expect(params.expression).toContain('"extractMode":"text"');
    expect(params.expression).toContain('"maxLength":100000');
    expect(params.expression).toContain('"allowFallback":true');
  });

  it('支持 all 提取模式与自定义 selectorType', async () => {
    const evaluate = mockEvaluate({ text: '<main>HTML</main>', truncated: false, usedFallback: false });
    const extractor = new PageTextExtractor({ evaluate });

    await extractor.extract({
      url: 'https://example.com/page',
      rules: [createRule()],
      extractMode: 'all',
      selectorType: 'css',
      allowFallback: false,
    });

    const params = evaluate.mock.calls[0]?.[0];
    if (!params) throw new Error('Expected evaluate call');
    expect(params.expression).toContain('"extractMode":"all"');
    expect(params.expression).toContain('"selectorType":"css"');
    expect(params.expression).toContain('"allowFallback":false');
  });

  it('CDP 返回非字符串值时返回空结果', async () => {
    const evaluate = vi.fn(async () => ({ result: { value: null } }));
    const extractor = new PageTextExtractor({ evaluate });

    const result = await extractor.extract({ url: 'https://example.com', rules: [] });

    expect(result).toEqual({ text: '', truncated: false, usedFallback: false });
  });

  it('CDP 返回非法 JSON 字符串时返回空结果', async () => {
    const evaluate = vi.fn(async () => ({ result: { value: 'not json' } }));
    const extractor = new PageTextExtractor({ evaluate });

    const result = await extractor.extract({ url: 'https://example.com', rules: [] });

    expect(result).toEqual({ text: '', truncated: false, usedFallback: false });
  });

  it('多条规则按 sortOrder 排序后注入表达式', async () => {
    const evaluate = mockEvaluate({ text: '优先正文', truncated: false, usedFallback: false, matchedRuleId: 'rule-first' });
    const extractor = new PageTextExtractor({ evaluate });

    await extractor.extract({
      url: 'https://example.com/article',
      rules: [
        createRule({ id: 'rule-late', selectorsText: 'main', sortOrder: 20 }),
        createRule({ id: 'rule-first', selectorsText: 'article', sortOrder: 10 }),
      ],
    });

    const params = evaluate.mock.calls[0]?.[0];
    if (!params) throw new Error('Expected evaluate call');
    expect(params.expression).toContain('"id":"rule-late"');
    expect(params.expression).toContain('"id":"rule-first"');
    expect(params.expression).toContain('"sortOrder":20');
    expect(params.expression).toContain('"sortOrder":10');
  });
});
