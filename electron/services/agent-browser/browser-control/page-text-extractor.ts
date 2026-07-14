/**
 * 页面文本提取器 — 抄写自 browser-ai-assistant-master/src/content/extractPageText.ts
 * 适配点：
 * 1. SRC 在 content script 中直接访问 DOM；ClawX 在 Main 进程中通过 CDP Runtime.evaluate 在页面上下文执行
 * 2. 将 SRC 的 extractPageText 函数及其所有 helper 序列化为自包含 IIFE 表达式字符串，注入页面执行
 * 3. 核心逻辑零改动：URL 匹配、CSS/XPath 选择器提取、可见文本过滤、回退、截断
 * 4. normalizeText/truncateText/getSelectorLines 在表达式内部内联实现，不依赖外部 import
 */
import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from '@shared/agent-browser/types';

export interface ExtractPageTextInput {
  url: string;
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback?: boolean;
}

export interface ExtractPageTextResult {
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
}

export interface PageTextExtractorConnection {
  evaluate(params: Record<string, unknown>): Promise<unknown>;
}

const DEFAULT_MAX_LENGTH = 100_000;

export class PageTextExtractor {
  constructor(private readonly connection: PageTextExtractorConnection) {}

  async extract(input: ExtractPageTextInput): Promise<ExtractPageTextResult> {
    const maxLength = input.maxLength ?? DEFAULT_MAX_LENGTH;
    const expression = createExtractionExpression({
      url: input.url,
      rules: input.rules,
      maxLength,
      extractMode: input.extractMode ?? 'text',
      selectorType: input.selectorType,
      allowFallback: input.allowFallback ?? true,
    });

    const response = await this.connection.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    return parseExtractionResponse(response);
  }
}

interface ExtractionExpressionInput {
  url: string;
  rules: ExtractionRule[];
  maxLength: number;
  extractMode: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback: boolean;
}

function createExtractionExpression(input: ExtractionExpressionInput): string {
  const serializedInput = JSON.stringify(input);
  return `(() => {
  const input = ${serializedInput};
  ${EXTRACTION_LOGIC}
  return JSON.stringify(extractPageText(input));
})()`;
}

/**
 * 内联的提取逻辑，在页面上下文中执行。
 * 抄写自 SRC extractPageText.ts 的全部 helper，不依赖外部 import。
 */
const EXTRACTION_LOGIC = `
function normalizeText(value) {
  return value.replace(/\\s+/g, ' ').trim();
}
function truncateText(value, maxLength) {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxLength), truncated: true };
}
function getSelectorLines(selectorsText) {
  return selectorsText.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
}
function matchUrl(pattern, url) {
  try {
    return new RegExp(pattern).test(url);
  } catch {
    return false;
  }
}
function extractBySelectors(selectorsText, extractMode, selectorType) {
  const selectors = getSelectorLines(selectorsText);
  const parts = [];
  for (const selector of selectors) {
    const selectorText = selectorType === 'css'
      ? extractByCss(selector, extractMode)
      : selectorType === 'xpath'
        ? extractByXPath(selector, extractMode)
        : extractByCss(selector, extractMode) || extractByXPath(selector, extractMode);
    if (selectorText) {
      parts.push(selectorText);
    }
  }
  return extractMode === 'text' ? normalizeText(parts.join(' ')) : parts.join('\\n');
}
function extractByCss(selector, extractMode) {
  try {
    const nodes = Array.from(document.querySelectorAll(selector));
    return extractNodes(nodes, extractMode);
  } catch {
    return '';
  }
}
function extractByXPath(xpath, extractMode) {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const nodes = [];
    for (let index = 0; index < result.snapshotLength; index += 1) {
      const node = result.snapshotItem(index);
      if (node) {
        nodes.push(node);
      }
    }
    return extractNodes(nodes, extractMode);
  } catch {
    return '';
  }
}
function extractNodes(nodes, extractMode) {
  if (extractMode === 'text') {
    return normalizeText(nodes.map((node) => extractVisibleTextFromNode(node)).join(' '));
  }
  return nodes.map(serializeNodeContent).filter((c) => c !== '').join('\\n');
}
function extractGlobalContent(extractMode) {
  if (extractMode === 'all') {
    return document.documentElement.outerHTML;
  }
  return extractVisibleTextFromNode(document.body);
}
function serializeNodeContent(node) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node.outerHTML.trim();
  }
  return node.textContent ?? '';
}
function extractVisibleTextFromNode(root) {
  if (shouldSkipNode(root)) {
    return '';
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    if (!shouldSkipNode(currentNode)) {
      const text = normalizeText(currentNode.textContent ?? '');
      if (text) {
        parts.push(text);
      }
    }
    currentNode = walker.nextNode();
  }
  return normalizeText(parts.join(' '));
}
function shouldSkipNode(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) {
    return true;
  }
  if (!document.body.contains(element)) {
    return true;
  }
  return Boolean(element.closest("script, style, template, noscript, [hidden], [aria-hidden='true']")) || isElementHidden(element);
}
function isElementHidden(element) {
  const style = window.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}
function extractPageText(input) {
  const extractMode = input.extractMode ?? 'text';
  const allowFallback = input.allowFallback ?? true;
  const matchedRule = [...input.rules].sort((l, r) => l.sortOrder - r.sortOrder).find((rule) => matchUrl(rule.urlPattern, input.url));
  const extractedContent = matchedRule ? extractBySelectors(matchedRule.selectorsText, extractMode, input.selectorType) : '';
  const usedFallback = allowFallback && extractedContent.trim().length === 0;
  const rawContent = usedFallback ? extractGlobalContent(extractMode) : extractedContent;
  const normalizedContent = extractMode === 'text' ? normalizeText(rawContent) : rawContent;
  const truncated = truncateText(normalizedContent, input.maxLength ?? Number.POSITIVE_INFINITY);
  return {
    text: truncated.text,
    truncated: truncated.truncated,
    usedFallback,
    matchedRuleId: matchedRule?.id,
  };
}
`;

function parseExtractionResponse(response: unknown): ExtractPageTextResult {
  const value = extractCdpValue(response);
  if (typeof value !== 'string') {
    return { text: '', truncated: false, usedFallback: false };
  }
  try {
    const parsed = JSON.parse(value) as ExtractPageTextResult;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      truncated: Boolean(parsed.truncated),
      usedFallback: Boolean(parsed.usedFallback),
      matchedRuleId: typeof parsed.matchedRuleId === 'string' ? parsed.matchedRuleId : undefined,
    };
  } catch {
    return { text: '', truncated: false, usedFallback: false };
  }
}

function extractCdpValue(response: unknown): unknown {
  if (!response || typeof response !== 'object') {
    return undefined;
  }
  const result = (response as { result?: { value?: unknown } }).result;
  return result?.value;
}
