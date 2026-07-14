/**
 * 提取规则校验单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/shared/extractionRuleValidation.test.ts
 * 适配点：import 路径改为 ClawX 约定。
 * 在 node 环境下运行（无 DOM），验证保守语法检查回退逻辑。
 */
import { describe, expect, it } from 'vitest';
import { validateExtractionRuleDraft } from '@shared/agent-browser/extraction-rules/validation';

describe('提取规则校验', () => {
  it('拒绝非法 URL 正则', () => {
    const result = validateExtractionRuleDraft({
      alias: '',
      urlPattern: '[',
      selectorsText: 'main',
    });

    expect(result).toEqual({
      ok: false,
      message: 'URL 正则格式不正确',
    });
  });

  it('拒绝空 CSS 或 XPath', () => {
    const result = validateExtractionRuleDraft({
      alias: '',
      urlPattern: 'https://example.com/.*',
      selectorsText: '  \n',
    });

    expect(result).toEqual({
      ok: false,
      message: '请至少填写一条 CSS 或 XPath',
    });
  });

  it('拒绝既不是合法 CSS 也不是合法 XPath 的选择器行', () => {
    const result = validateExtractionRuleDraft({
      alias: '',
      urlPattern: 'https://example.com/.*',
      selectorsText: '[',
    });

    expect(result).toEqual({
      ok: false,
      message: '第 1 行 CSS/XPath 格式不正确',
    });
  });

  it('允许合法 CSS 或合法 XPath', () => {
    expect(
      validateExtractionRuleDraft({
        alias: '',
        urlPattern: 'https://example.com/.*',
        selectorsText: "main\n//*[@id='content']",
      }),
    ).toEqual({ ok: true });
  });
});
