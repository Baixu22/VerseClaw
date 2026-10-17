/**
 * 页面文本提取器 — 抄写自 browser-ai-assistant-master/src/content/extractPageText.ts
 * 适配点：
 * 1. SRC 在 content script 中直接访问 DOM；ClawX 在 Main 进程中通过 CDP Runtime.evaluate 在页面上下文执行
 * 2. 将 SRC 的 extractPageText 函数及其所有 helper 序列化为自包含 IIFE 表达式字符串，注入页面执行
 * 3. 核心逻辑零改动：URL 匹配、CSS/XPath 选择器提取、可见文本过滤、回退、截断
 * 4. normalizeText/truncateText/getSelectorLines 在表达式内部内联实现，不依赖外部 import
 */
import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from '../../core/types.ts';
import { isNavigationReadError } from '../navigation-errors.ts';
import type { AgentBrowserExtractPageTextPayload } from '../../types/host-api.ts';

export interface ExtractPageTextInput {
  metadata?: boolean;
  url: string;
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback?: boolean;
  structured?: boolean;
  rows?: AgentBrowserExtractPageTextPayload['rows'];
}

export interface ExtractPageTextResult {
  text: string;
  sourceUrl?: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
}

export interface PageTextExtractorConnection {
  evaluate(params: Record<string, unknown>): Promise<unknown>;
}

const DEFAULT_MAX_LENGTH = 100_000;

export class PageTextExtractor {
  private readonly connection: PageTextExtractorConnection;

  constructor(connection: PageTextExtractorConnection) {
    this.connection = connection;
  }

  async extract(input: ExtractPageTextInput): Promise<ExtractPageTextResult> {
    const maxLength = input.maxLength ?? DEFAULT_MAX_LENGTH;
    const expression = createExtractionExpression({
      url: input.url,
      rules: input.rules,
      maxLength,
      extractMode: input.extractMode ?? 'text',
      selectorType: input.selectorType,
      allowFallback: input.allowFallback ?? true,
      structured: input.structured,
      rows: input.rows,
      metadata: input.metadata,
    });

    // Reads may cross a navigation. Keep one recovery deadline and never turn
    // an absent document into an empty successful extraction.
    const deadline = Date.now() + 1000;
    let lastError: unknown;
    for (;;) {
      if (lastError && Date.now() >= deadline) throw lastError;
      try {
        const response = await this.connection.evaluate({
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        return parseExtractionResponse(response);
      } catch (error) {
        if (!isNavigationReadError(error) || Date.now() >= deadline) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
      }
    }
  }
}

interface ExtractionExpressionInput {
  metadata?: boolean;
  rows?: AgentBrowserExtractPageTextPayload['rows'];
  url: string;
  rules: ExtractionRule[];
  maxLength: number;
  extractMode: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback: boolean;
  structured?: boolean;
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
  // ANOM-01 / TF-0106: 逐文本节点收集时，只有**块容器边界**或 BR 元素才需要分隔符。
  // 旧实现对每个文本节点先 normalizeText 再用 ' ' 连接，等于在**每个**内联元素边界
  // 都插入一个空格，把 "minimization)</b>" 读成 "minimization )"、把
  // "unlink(path);" 读成 "unlink (path) ;" —— 引用与代码 token 都被改写了。
  // 判定规则：文本节点归属最近的块级祖先（block container）；同容器内直接拼接原始
  // 文本（原始空白原样保留，最后统一归一），跨容器或遇到 BR 才补一个空格。
  const chunks = [];
  const structure = [];
  let pendingBreak = false;
  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? '';
      if (!raw || shouldSkipNode(node)) {
        return;
      }
      const container = nearestBlockContainer(node);
      const previous = chunks.length > 0 ? chunks[chunks.length - 1] : null;
      if (!previous || pendingBreak || previous.container !== container) {
        chunks.push({ container, text: raw });
      } else {
        previous.text += raw;
      }
      pendingBreak = false;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || shouldSkipNode(node)) {
      return;
    }
    if (node.tagName === 'BR') {
      pendingBreak = true;
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
  };
  visit(root);
  // 块间补一个空格；块内文本的原始空白原样保留，最后统一归一。
  if (input.structured) {
    for (const chunk of chunks) {
      const text = normalizeText(chunk.text);
      if (!text) continue;
      const element = chunk.container;
      const tag = element?.tagName?.toLowerCase() ?? 'text';
      let listLevel = 0;
      if (tag === 'li') for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'OL' || parent.tagName === 'UL') listLevel++;
      }
      const links = element ? Array.from(element.querySelectorAll('a[href]')).filter(link => !shouldSkipNode(link) && nearestBlockContainer(link) === element).map(link => ({ text: normalizeText(link.textContent ?? ''), href: link.href })) : [];
      structure.push({ type: /^h[1-6]$/.test(tag) ? 'heading' : tag === 'li' ? 'list-item' : 'paragraph',
        ...(tag === 'li' ? { listType: element.parentElement?.tagName === 'OL' ? 'ordered' : 'unordered', listLevel } : {}),
        ...( /^h[1-6]$/.test(tag) ? { level: Number(tag[1]) } : {}), text, ...(links.length ? { links } : {}) });
    }
    return JSON.stringify(structure);
  }
  return normalizeText(chunks.map((chunk) => chunk.text).join(' '));
}
/** 块级显示类型 —— 这些元素的内容在视觉上换行，需要分隔符。 */
const BLOCK_DISPLAYS = new Set([
  'block',
  'flow-root',
  'list-item',
  'table',
  'table-row',
  'table-cell',
  'table-caption',
  'flex',
  'grid',
]);
const blockDisplayCache = new WeakMap();
const blockContainerCache = new WeakMap();
function isBlockLevelElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const cached = blockDisplayCache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const result = BLOCK_DISPLAYS.has(window.getComputedStyle(element).display);
  blockDisplayCache.set(element, result);
  return result;
}
/** 最近的块级祖先；没有则返回 null（同 null 视为同一容器）。 */
function nearestBlockContainer(node) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const start = element;
  if (!element) {
    return null;
  }
  const cached = blockContainerCache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const chain = [];
  let found = null;
  while (element) {
    if (isBlockLevelElement(element)) {
      found = element;
      break;
    }
    chain.push(element);
    element = element.parentElement;
  }
  blockContainerCache.set(start, found);
  for (const item of chain) {
    blockContainerCache.set(item, found);
  }
  return found;
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
  if (!document.documentElement || (extractMode === 'text' && !document.body)) {
    throw new Error('E_PAGE_NOT_READY: document body unavailable; wait for the destination page');
  }
  const allowFallback = input.allowFallback ?? true;
  const matchedRule = [...input.rules].sort((l, r) => l.sortOrder - r.sortOrder).find((rule) => matchUrl(rule.urlPattern, input.url));
  if (input.metadata) {
    if (input.rows || input.structured || extractMode !== 'text' || matchedRule) throw new Error('E_ARG: metadata is a separate document-only mode');
    const field = (selector, attribute) => {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length !== 1) return { status: nodes.length ? 'ambiguous' : 'missing' };
      const value = attribute ? nodes[0].getAttribute(attribute) : nodes[0].textContent;
      return value === null ? { status: 'missing' } : { status: 'present', value };
    };
    const canonical = field('link[rel="canonical"]', 'href');
    if (canonical.status === 'present') {
      try { canonical.value = new URL(canonical.value, document.baseURI).href; }
      catch { canonical.status = 'invalid'; delete canonical.value; }
    }
    const openGraph = Array.from(document.querySelectorAll('meta[property^="og:"]')).slice(0, 40).map(node => ({ property: node.getAttribute('property'), content: node.getAttribute('content') }));
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10).map(node => {
      const raw = node.textContent ?? '';
      if (raw.length > 20000) return { status: 'truncated' };
      try { return { status: 'parsed', value: JSON.parse(raw) }; } catch { return { status: 'invalid' }; }
    });
    const links = Array.from(document.querySelectorAll('a[href]')).filter(node => !shouldSkipNode(node)).slice(0, 100).map(node => ({ text: extractVisibleTextFromNode(node), href: node.href }));
    const record = { kind: 'page-declared-metadata', title: field('title'), description: field('meta[name="description"]', 'content'),
      language: document.documentElement.hasAttribute('lang') ? { status: 'present', value: document.documentElement.lang } : { status: 'missing' }, canonical, openGraph, jsonLd, links };
    let truncated = document.querySelectorAll('meta[property^="og:"]').length > 40 || document.querySelectorAll('script[type="application/ld+json"]').length > 10 || document.querySelectorAll('a[href]').length > 100 || jsonLd.some(item => item.status === 'truncated');
    while (JSON.stringify([record]).length > input.maxLength && (links.length || jsonLd.length || openGraph.length)) {
      if (links.length) links.pop(); else if (jsonLd.length) jsonLd.pop(); else openGraph.pop();
      truncated = true;
    }
    if (JSON.stringify([record]).length > input.maxLength) throw new Error('E_OUTPUT_BUDGET: metadata fields exceed budget');
    return { text: JSON.stringify([record]), sourceUrl: document.URL, truncated, usedFallback: false };
  }
  if (input.rows) {
    const spec = input.rows;
    if (input.structured || extractMode !== 'text' || input.selectorType !== 'css') throw new Error('E_ARG: rows requires CSS text mode without structured');
    if (typeof spec.selector !== 'string' || !spec.selector.trim() || !spec.fields || typeof spec.fields !== 'object' || Array.isArray(spec.fields)) throw new Error('E_ARG: rows requires selector and field mapping');
    const fields = Object.entries(spec.fields);
    const limit = spec.limit ?? 20;
    if (!fields.length || fields.length > 20 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('E_ARG: at most20 fields and limit1..100');
    let root = document.body;
    if (matchedRule) {
      const scopes = document.querySelectorAll(matchedRule.selectorsText);
      if (scopes.length !== 1) throw new Error('E_SCOPE: row scope must be unique');
      root = scopes[0];
    }
    for (const [key, field] of fields) {
      if (!key || !field || typeof field !== 'object' || (field.selector !== undefined && typeof field.selector !== 'string') || (field.attribute !== undefined && typeof field.attribute !== 'string')) throw new Error('E_ARG: invalid field mapping');
      if (field.selector) root.querySelectorAll(field.selector);
    }
    const nodes = root.querySelectorAll(spec.selector);
    const records = [];
    let truncated = nodes.length > limit;
    for (const row of Array.from(nodes).slice(0, limit)) {
      const cells = Object.create(null);
      for (const [key, field] of fields) {
        const matches = field.selector ? row.querySelectorAll(field.selector) : [row];
        if (matches.length !== 1) { cells[key] = { status: matches.length ? 'ambiguous' : 'missing' }; continue; }
        const element = matches[0];

        // Field-name keyword list kept byte-identical to readFieldState in
        // src/engine/interactive-snapshot.ts: both run as page-context copies and that one must stay
        // self-contained (elementHandle.evaluate serializes it standalone).
        const secret = element.matches('input[type=password]') || /pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|otp|pin|session|sid|csrf|xsrf/i.test([key, element.id, element.getAttribute('name'), element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('title')].filter(Boolean).join(' '));
        const value = field.attribute ? element.getAttribute(field.attribute) : extractVisibleTextFromNode(element);
        cells[key] = value === null ? { status: 'missing' } : secret ? { status: 'redacted' } : { status: 'present', value: field.attribute === 'href' && value ? new URL(value, document.baseURI).href : value };
      }
      if (JSON.stringify([...records, cells]).length > input.maxLength) { truncated = true; break; }
      records.push(cells);
    }
    if (nodes.length && !records.length) throw new Error('E_OUTPUT_BUDGET: row exceeds budget; narrow fields');
    return { text: JSON.stringify(records), sourceUrl: document.URL, truncated, usedFallback: false };
  }
  if (input.structured) {
    if (extractMode !== 'text') throw new Error('E_ARG: structured output requires text extraction');
    let root = document.body;
    if (matchedRule) {
      if (input.selectorType !== 'css') throw new Error('E_ARG: structured region requires CSS');
      const selectors = getSelectorLines(matchedRule.selectorsText);
      if (selectors.length !== 1) throw new Error('E_ARG: structured region requires one selector');
      const nodes = document.querySelectorAll(selectors[0]);
      if (nodes.length !== 1) throw new Error('E_ARG: structured region must match exactly one element');
      root = nodes[0];
    }
    const blocks = JSON.parse(extractVisibleTextFromNode(root) || '[]');
    const kept = [];
    let truncated = false;
    for (const block of blocks) {
      if (JSON.stringify([...kept, block]).length > input.maxLength) { truncated = true; break; }
      kept.push(block);
    }
    if (input.maxLength < 2 || (blocks.length && !kept.length)) throw new Error('E_OUTPUT_BUDGET: first structural block exceeds budget; narrow the region or increase maxChars');
    return { text: JSON.stringify(kept), sourceUrl: document.URL, truncated, usedFallback: !matchedRule, matchedRuleId: matchedRule?.id };
  }
  const extractedContent = matchedRule ? extractBySelectors(matchedRule.selectorsText, extractMode, input.selectorType) : '';
  const usedFallback = allowFallback && extractedContent.trim().length === 0;
  const rawContent = usedFallback ? extractGlobalContent(extractMode) : extractedContent;
  const normalizedContent = extractMode === 'text' ? normalizeText(rawContent) : rawContent;
  const truncated = truncateText(normalizedContent, input.maxLength ?? Number.POSITIVE_INFINITY);
  return {
    text: truncated.text,
    sourceUrl: document.URL,
    truncated: truncated.truncated,
    usedFallback,
    matchedRuleId: matchedRule?.id,
  };
}
`;

function parseExtractionResponse(response: unknown): ExtractPageTextResult {
  const exception = (response as { exceptionDetails?: { text?: string; exception?: { description?: string } } } | null)?.exceptionDetails;
  if (exception) {
    throw new Error(exception.exception?.description ?? exception.text ?? 'Page text evaluation failed');
  }
  const value = extractCdpValue(response);
  if (typeof value !== 'string') throw new Error('E_EXTRACTION_RESULT: missing serialized page result');
  let parsed: ExtractPageTextResult;
  try {
    parsed = JSON.parse(value) as ExtractPageTextResult;
  } catch {
    throw new Error('E_EXTRACTION_RESULT: invalid serialized page result');
  }
  if (!parsed || typeof parsed.text !== 'string' || typeof parsed.truncated !== 'boolean' || typeof parsed.usedFallback !== 'boolean' ||
      (parsed.matchedRuleId !== undefined && typeof parsed.matchedRuleId !== 'string')) throw new Error('E_EXTRACTION_RESULT: incomplete or invalid extraction fields');
  if (parsed.sourceUrl !== undefined && typeof parsed.sourceUrl !== 'string') throw new Error('E_EXTRACTION_RESULT: invalid source URL');
  return { text: parsed.text, truncated: parsed.truncated, usedFallback: parsed.usedFallback, matchedRuleId: parsed.matchedRuleId,
    ...(parsed.sourceUrl !== undefined ? { sourceUrl: parsed.sourceUrl } : {}) };
}

function extractCdpValue(response: unknown): unknown {
  if (!response || typeof response !== 'object') {
    return undefined;
  }
  const result = (response as { result?: { value?: unknown } }).result;
  return result?.value;
}
