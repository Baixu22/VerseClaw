/**
 * 提取规则校验 — 抄写自 browser-ai-assistant-master/src/shared/extractionRules/validation.ts
 * 零修改核心逻辑，仅调整 import 路径。
 * 在无 DOM 环境（Main 进程）下使用保守语法检查；在有 DOM 环境（页面/测试）下使用原生 API 校验。
 */
import type { ExtractionSelectorType } from '../types';

export interface ExtractionRuleDraft {
  alias: string;
  urlPattern: string;
  selectorsText: string;
}

export type ExtractionRuleValidationResult = { ok: true } | { ok: false; message: string };

export function validateExtractionRuleDraft(draft: ExtractionRuleDraft): ExtractionRuleValidationResult {
  const urlPattern = draft.urlPattern.trim();
  if (!urlPattern) {
    return { ok: false, message: 'URL 正则不能为空' };
  }

  try {
    new RegExp(urlPattern);
  } catch {
    return { ok: false, message: 'URL 正则格式不正确' };
  }

  const selectors = getSelectorLines(draft.selectorsText);
  if (selectors.length === 0) {
    return { ok: false, message: '请至少填写一条 CSS 或 XPath' };
  }

  for (const [index, selector] of selectors.entries()) {
    if (!isValidExtractionSelector(selector)) {
      return { ok: false, message: `第 ${index + 1} 行 CSS/XPath 格式不正确` };
    }
  }

  return { ok: true };
}

export function validateExtractionSelector(selectorText: string, selectorType?: ExtractionSelectorType): ExtractionRuleValidationResult {
  const selectors = getSelectorLines(selectorText);
  if (selectors.length === 0) {
    return { ok: false, message: '请至少填写一条 CSS 或 XPath' };
  }

  for (const [index, selector] of selectors.entries()) {
    if (!isValidExtractionSelector(selector, selectorType)) {
      return { ok: false, message: `第 ${index + 1} 行 CSS/XPath 格式不正确` };
    }
  }

  return { ok: true };
}

export function getSelectorLines(selectorsText: string): string[] {
  return selectorsText
    .split(/\r?\n/)
    .map((selector) => selector.trim())
    .filter(Boolean);
}

function isValidExtractionSelector(selector: string, selectorType?: ExtractionSelectorType): boolean {
  if (selectorType === 'css') {
    return isValidCssSelector(selector);
  }
  if (selectorType === 'xpath') {
    return isValidXPath(selector);
  }
  return isValidCssSelector(selector) || isValidXPath(selector);
}

function isValidCssSelector(selector: string): boolean {
  try {
    const doc = (globalThis as { document?: { createDocumentFragment(): { querySelector(sel: string): unknown } } }).document;
    if (typeof doc !== 'undefined') {
      doc.createDocumentFragment().querySelector(selector);
      return true;
    }
    return isConservativelyValidCssSelector(selector);
  } catch {
    return false;
  }
}

function isValidXPath(selector: string): boolean {
  try {
    const doc = (globalThis as { document?: { evaluate(...args: unknown[]): unknown } }).document;
    const XPathResultCtor = (globalThis as { XPathResult?: { ORDERED_NODE_SNAPSHOT_TYPE: number } }).XPathResult;
    if (typeof doc !== 'undefined' && typeof XPathResultCtor !== 'undefined') {
      doc.evaluate(selector, doc, null, XPathResultCtor.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return true;
    }
    return /^(\/|\.\/|\()/.test(selector) && hasBalancedSelectorDelimiters(selector);
  } catch {
    return false;
  }
}

function hasBalancedSelectorDelimiters(selector: string): boolean {
  const stack: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const pairs: Record<string, string> = {
    ']': '[',
    ')': '(',
  };

  for (const char of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '[' || char === '(') {
      stack.push(char);
      continue;
    }
    if (char === ']' || char === ')') {
      if (stack.pop() !== pairs[char]) {
        return false;
      }
    }
  }

  return !quote && stack.length === 0;
}

function isConservativelyValidCssSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!hasBalancedSelectorDelimiters(trimmed)) {
    return false;
  }
  if (trimmed.startsWith('/') || /^[>+~]/.test(trimmed) || /[>+~]\s*$/.test(trimmed)) {
    return false;
  }
  return !trimmed.includes(',,');
}
