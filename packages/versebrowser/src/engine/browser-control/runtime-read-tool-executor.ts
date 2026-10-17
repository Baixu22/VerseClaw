/**
 * 运行时只读工具执行器 — 抄写自 browser-ai-assistant-master/src/background/browserControl/runtimeReadToolExecutor.ts
 * 适配点：
 * 1. 去掉 ModelToolCall/ModelToolResult 依赖，改为直接返回 plain result 对象（content + 可选 isError）
 * 2. 保留 ToolAuthorizationContext 依赖（fail-closed 安全语义必须在 executor 内部）
 * 3. import 路径改为 ClawX 约定（../core/tool-authorization）
 * 保留上游实现：固定 Runtime.evaluate 模板、路径白名单、敏感值脱敏、结果截断。
 * 4. TF-0105 接线到薄驱动时发现两处口径问题并修正（都不改页面模板，只改 Node 侧汇总）：
 *    ① 外层脱敏遍历把「页内已经是类型化树」的载荷当成裸数据再限深一次，默认 maxDepth
 *       下 payload 会被折叠成 `[Object]`（等于默认参数不可用）；现按类型化树的层数换算
 *       外层深度。② 页内自己的 `truncated: true` / accessor `skipped` 不会让头部
 *       `Truncated` 变 true，读出来会骗人；现汇总进去。
 */
import type { ToolAuthorizationContext } from '../../core/tool-authorization.ts';
import { isSensitiveNetworkName } from '../../security/redact-secrets.ts';

export interface RuntimeReadConnection {
  evaluate(params: Record<string, unknown>): Promise<unknown>;
}

interface RuntimeReadSummary {
  redacted: boolean;
  truncated: boolean;
  value: unknown;
}

const RUNTIME_READ_DISABLED_MESSAGE = '运行时只读分析未授权，无法执行 runtime.* 工具。请先显式开启运行时只读分析。';
const RUNTIME_READ_FAILED_MESSAGE = '运行时只读分析失败，请确认当前页面仍可访问后重试。';
const DEFAULT_OBJECT_DEPTH = 2;
const DEFAULT_ENTRY_LIMIT = 12;
const DEFAULT_RESULT_BUDGET = 12_000;
const MAX_STRING_LENGTH = 800;
/**
 * TF-0105: the inspect-globals template already returns a **typed tree**
 * (`{type, entries: [[key, node], …]}`), so the Node-side redaction pass needs
 * ~3 levels per page-level step (`node → entries → pair → node`) plus the
 * per-path envelope (`[{path, exists, value}]`). Handing it the raw `maxDepth`
 * collapsed the payload to `[Object]` before a single key was visible — and
 * before the redaction pass could reach the keys at all.
 */
const TYPED_TREE_LEVELS_PER_DEPTH = 3;
const INSPECT_ENVELOPE_LEVELS = 3;
// TF-0105/C96: this check runs on the Node side and delegates to the repository's canonical name
// check. Measured 2026-10-14: vb_runtime_read on window.__VAULT__ = { private_key, otp, pin }
// returned those values verbatim (only sid was redacted) while still reporting redacted: true;
// `otp`/`pin` are part of the canonical check now.
function isSensitiveRuntimeKey(name: string): boolean {
  return isSensitiveNetworkName(name);
}
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\b(cookie|authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|session|csrf|xsrf|private[-_]?key|otp|pin)\b\s*[:=]\s*["']?[^"'\s;,}]{3,}/gi,
];
const DANGEROUS_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'eval',
  'function',
  'document',
  'cookie',
  'localstorage',
  'sessionstorage',
  'indexeddb',
  'fetch',
  'xmlhttprequest',
  'websocket',
]);

export interface RuntimeReadResult {
  content: string;
  isError?: boolean;
  /**
   * TF-0105: machine-readable copy of the summary header flags, so a caller does
   * not have to parse the title block to know whether the read was redacted or
   * cut short.
   */
  redacted?: boolean;
  truncated?: boolean;
}

export interface InspectGlobalsArgs {
  paths: string[];
  maxDepth?: number;
  limit?: number;
}

export interface SearchModulesArgs {
  keywords: string[];
  limit?: number;
  radius?: number;
}

export interface DescribeFunctionArgs {
  path: string;
  keywords?: string[];
  radius?: number;
}

export class RuntimeReadToolExecutor {
  private readonly connection: RuntimeReadConnection;
  private readonly getAuthorizationContext: () => ToolAuthorizationContext;

  constructor(
    connection: RuntimeReadConnection,
    getAuthorizationContext: () => ToolAuthorizationContext,
  ) {
    this.connection = connection;
    this.getAuthorizationContext = getAuthorizationContext;
  }

  async inspectGlobals(args: InspectGlobalsArgs): Promise<RuntimeReadResult> {
    const authorization = this.getAuthorizationContext();
    if (authorization.mode !== 'runtime_readonly' && authorization.mode !== 'controlled_enhanced') {
      return { content: RUNTIME_READ_DISABLED_MESSAGE, isError: true };
    }
    const validation = validateInspectGlobalsArgs(args);
    if (!validation.ok) {
      return { content: validation.message, isError: true };
    }
    try {
      return this.toResult(await this.executeInspectGlobals(validation.args));
    } catch {
      return { content: RUNTIME_READ_FAILED_MESSAGE, isError: true };
    }
  }

  async searchModules(args: SearchModulesArgs): Promise<RuntimeReadResult> {
    const authorization = this.getAuthorizationContext();
    if (authorization.mode !== 'runtime_readonly' && authorization.mode !== 'controlled_enhanced') {
      return { content: RUNTIME_READ_DISABLED_MESSAGE, isError: true };
    }
    const validation = validateSearchModulesArgs(args);
    if (!validation.ok) {
      return { content: validation.message, isError: true };
    }
    try {
      return this.toResult(await this.executeSearchModules(validation.args));
    } catch {
      return { content: RUNTIME_READ_FAILED_MESSAGE, isError: true };
    }
  }

  async describeFunction(args: DescribeFunctionArgs): Promise<RuntimeReadResult> {
    const authorization = this.getAuthorizationContext();
    if (authorization.mode !== 'runtime_readonly' && authorization.mode !== 'controlled_enhanced') {
      return { content: RUNTIME_READ_DISABLED_MESSAGE, isError: true };
    }
    const validation = validateDescribeFunctionArgs(args);
    if (!validation.ok) {
      return { content: validation.message, isError: true };
    }
    try {
      return this.toResult(await this.executeDescribeFunction(validation.args));
    } catch {
      return { content: RUNTIME_READ_FAILED_MESSAGE, isError: true };
    }
  }

  /** Content plus the summary flags, so callers get both text and booleans. */
  private toResult(executed: { content: string; summary: RuntimeReadSummary }): RuntimeReadResult {
    return {
      content: executed.content,
      redacted: executed.summary.redacted,
      truncated: executed.summary.truncated,
    };
  }

  private async executeInspectGlobals(args: NormalizedInspectGlobalsArgs): Promise<{ content: string; summary: RuntimeReadSummary }> {
    const expression = createInspectGlobalsExpression(args.paths.map((path) => path.segments), args.maxDepth, args.limit);
    const response = await this.connection.evaluate({
      expression,
      awaitPromise: false,
      returnByValue: true,
      timeout: 3000,
    });
    const value = extractRuntimeValue(response);
    const summary = summarizeRuntimeValue(value, inspectOuterDepth(args.maxDepth), args.limit);
    return { content: formatRuntimeToolContent('运行时全局摘要', summary), summary };
  }

  private async executeSearchModules(args: NormalizedSearchModulesArgs): Promise<{ content: string; summary: RuntimeReadSummary }> {
    const expression = createSearchModulesExpression(args.keywords, args.limit, args.radius);
    const response = await this.connection.evaluate({
      expression,
      awaitPromise: false,
      returnByValue: true,
      timeout: 3000,
    });
    const value = extractRuntimeValue(response);
    const summary = summarizeRuntimeValue(value, 3, args.limit);
    return { content: formatRuntimeToolContent('运行时模块搜索摘要', summary), summary };
  }

  private async executeDescribeFunction(args: NormalizedDescribeFunctionArgs): Promise<{ content: string; summary: RuntimeReadSummary }> {
    const expression = createDescribeFunctionExpression(args.path.segments, args.keywords, args.radius);
    const response = await this.connection.evaluate({
      expression,
      awaitPromise: false,
      returnByValue: true,
      timeout: 3000,
    });
    const value = extractRuntimeValue(response);
    const summary = summarizeRuntimeValue(value, 2, DEFAULT_ENTRY_LIMIT);
    return { content: formatRuntimeToolContent('运行时函数摘要', summary), summary };
  }
}

interface NormalizedPath {
  raw: string;
  segments: string[];
}

interface NormalizedInspectGlobalsArgs {
  paths: NormalizedPath[];
  maxDepth: number;
  limit: number;
  radius: number;
}

interface NormalizedSearchModulesArgs {
  keywords: string[];
  maxDepth: number;
  limit: number;
  radius: number;
}

interface NormalizedDescribeFunctionArgs {
  path: NormalizedPath;
  keywords: string[];
  maxDepth: number;
  limit: number;
  radius: number;
}

function validateInspectGlobalsArgs(args: InspectGlobalsArgs): { ok: true; args: NormalizedInspectGlobalsArgs } | { ok: false; message: string } {
  const paths = normalizePaths(args.paths, 10);
  if (!paths.ok) {
    return paths;
  }
  return {
    ok: true,
    args: {
      paths: paths.paths,
      maxDepth: normalizeInteger(args.maxDepth, DEFAULT_OBJECT_DEPTH, 1, 4),
      limit: normalizeInteger(args.limit, DEFAULT_ENTRY_LIMIT, 1, 30),
      radius: 160,
    },
  };
}

function validateSearchModulesArgs(args: SearchModulesArgs): { ok: true; args: NormalizedSearchModulesArgs } | { ok: false; message: string } {
  const keywords = normalizeKeywords(args.keywords, 10);
  if (!keywords.ok) {
    return keywords;
  }
  return {
    ok: true,
    args: {
      keywords: keywords.keywords,
      maxDepth: DEFAULT_OBJECT_DEPTH,
      limit: normalizeInteger(args.limit, 10, 1, 20),
      radius: normalizeInteger(args.radius, 160, 40, 500),
    },
  };
}

function validateDescribeFunctionArgs(args: DescribeFunctionArgs): { ok: true; args: NormalizedDescribeFunctionArgs } | { ok: false; message: string } {
  const path = normalizePath(args.path);
  if (!path.ok) {
    return path;
  }
  const keywords = args.keywords === undefined
    ? { ok: true as const, keywords: [] }
    : normalizeKeywords(args.keywords, 10);
  if (!keywords.ok) {
    return keywords;
  }
  return {
    ok: true,
    args: {
      path: path.path,
      keywords: keywords.keywords,
      maxDepth: DEFAULT_OBJECT_DEPTH,
      limit: DEFAULT_ENTRY_LIMIT,
      radius: normalizeInteger(args.radius, 300, 80, 1000),
    },
  };
}

function normalizePaths(value: unknown, maxItems: number): { ok: true; paths: NormalizedPath[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    return { ok: false, message: `paths 必须包含 1 到 ${maxItems} 个路径。` };
  }

  const paths: NormalizedPath[] = [];
  for (const item of value) {
    const path = normalizePath(item);
    if (!path.ok) {
      return path;
    }
    paths.push(path.path);
  }
  return { ok: true, paths };
}

function normalizePath(value: unknown): { ok: true; path: NormalizedPath } | { ok: false; message: string } {
  if (typeof value !== 'string') {
    return { ok: false, message: '运行时路径必须是字符串。' };
  }
  const raw = value.trim();
  if (!raw || raw.length > 200) {
    return { ok: false, message: '运行时路径不能为空且长度不能超过 200。' };
  }
  if (!/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(raw)) {
    return { ok: false, message: '运行时路径只允许安全的点号路径，不能传入 JavaScript 表达式。' };
  }
  // 用户常按浏览器控制台习惯书写 window/globalThis 前缀；执行固定模板时统一剥离，避免暴露任意表达式入口。
  const segments = raw.split('.').filter((segment, index) => !(index === 0 && (segment === 'window' || segment === 'globalThis')));
  if (!segments.length) {
    return { ok: false, message: '运行时路径不能只指向 window 或 globalThis。' };
  }
  if (segments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return { ok: false, message: '运行时路径包含高风险字段，已拒绝执行。' };
  }
  return { ok: true, path: { raw, segments } };
}

function normalizeKeywords(value: unknown, maxItems: number): { ok: true; keywords: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    return { ok: false, message: `keywords 必须包含 1 到 ${maxItems} 个关键词。` };
  }
  const keywords = Array.from(new Set(value.map((item) => typeof item === 'string' ? item.trim() : ''))).filter(Boolean);
  if (!keywords.length || keywords.some((keyword) => keyword.length > 80)) {
    return { ok: false, message: '关键词不能为空且单个长度不能超过 80。' };
  }
  return { ok: true, keywords };
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function createInspectGlobalsExpression(paths: string[][], maxDepth: number, limit: number): string {
  return `(() => {
    const paths = ${JSON.stringify(paths)};
    const maxDepth = ${JSON.stringify(maxDepth)};
    const limit = ${JSON.stringify(limit)};
    const safeKeys = (value) => {
      try {
        return Object.keys(value).slice(0, limit);
      } catch {
        return [];
      }
    };
    const safeDescriptor = (value, key) => {
      try {
        return Object.getOwnPropertyDescriptor(Object(value), key);
      } catch {
        return undefined;
      }
    };
    const safeReadDataProperty = (value, key) => {
      const descriptor = safeDescriptor(value, key);
      if (!descriptor) return { ok: false, skipped: false };
      if (!("value" in descriptor)) return { ok: false, skipped: true };
      return { ok: true, value: descriptor.value };
    };
    const safeFunctionSource = (value) => {
      try {
        return Function.prototype.toString.call(value).slice(0, 800);
      } catch {
        return "[Function source unavailable]";
      }
    };
    const safeFunctionMeta = (value) => {
      const name = safeReadDataProperty(value, "name");
      const length = safeReadDataProperty(value, "length");
      return {
        name: typeof name.value === "string" ? name.value : "",
        length: typeof length.value === "number" ? length.value : 0,
        source: safeFunctionSource(value)
      };
    };
    const readPath = (segments) => {
      let current = globalThis;
      for (const segment of segments) {
        if (current == null) return { exists: false };
        const next = safeReadDataProperty(current, segment);
        if (next.skipped) return { exists: true, value: { type: "accessor", skipped: true, reason: "Accessor skipped" } };
        if (!next.ok) return { exists: false };
        current = next.value;
      }
      return { exists: true, value: summarize(current, 0) };
    };
    const summarize = (value, depth) => {
      const type = typeof value;
      if (value == null || type === "number" || type === "boolean" || type === "bigint") return { type, value: String(value) };
      if (type === "string") return { type, value: value.slice(0, 800), truncated: value.length > 800 };
      if (type === "function") return { type, ...safeFunctionMeta(value) };
      if (depth >= maxDepth) return { type: Array.isArray(value) ? "array" : "object", truncated: true };
      const keys = safeKeys(value);
      const entries = keys.map((key) => {
        const child = safeReadDataProperty(value, key);
        if (child.skipped) return [key, { type: "accessor", skipped: true, reason: "Accessor skipped" }];
        if (!child.ok) return [key, { type: "unknown", skipped: true, reason: "Property unavailable" }];
        return [key, summarize(child.value, depth + 1)];
      });
      return { type: Array.isArray(value) ? "array" : "object", entries, truncated: keys.length >= limit };
    };
    return paths.map((segments) => ({ path: segments.join("."), ...readPath(segments) }));
  })()`;
}

function createSearchModulesExpression(keywords: string[], limit: number, radius: number): string {
  return `(() => {
    const keywords = ${JSON.stringify(keywords.map((keyword) => keyword.toLowerCase()))};
    const limit = ${JSON.stringify(limit)};
    const radius = ${JSON.stringify(radius)};
    const results = [];
    const safeKeys = (value, max) => {
      try {
        return Object.keys(value).slice(0, max);
      } catch {
        return [];
      }
    };
    const safeReadDataProperty = (value, key) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
        if (!descriptor || !("value" in descriptor)) return { ok: false };
        return { ok: true, value: descriptor.value };
      } catch {
        return { ok: false };
      }
    };
    const safeToString = (value, fallback = "") => {
      try {
        return String(value);
      } catch {
        return fallback;
      }
    };
    const safeFunctionSource = (value) => {
      try {
        return Function.prototype.toString.call(value);
      } catch {
        return "";
      }
    };
    const pushMatch = (source, id, exportKey, text) => {
      if (results.length >= limit || typeof text !== "string") return;
      const lower = text.toLowerCase();
      const keyword = keywords.find((item) => lower.includes(item));
      if (!keyword) return;
      const index = lower.indexOf(keyword);
      results.push({
        source,
        id: String(id),
        exportKey: exportKey || "",
        keyword,
        snippet: text.slice(Math.max(0, index - radius), Math.min(text.length, index + keyword.length + radius)),
        truncated: text.length > radius * 2 + keyword.length
      });
    };
    const inspectExports = (source, id, exportsValue) => {
      if (!exportsValue || results.length >= limit) return;
      if (typeof exportsValue === "function") pushMatch(source, id, "default", safeFunctionSource(exportsValue));
      if (typeof exportsValue !== "object" && typeof exportsValue !== "function") return;
      for (const key of safeKeys(exportsValue, 50)) {
        const exported = safeReadDataProperty(exportsValue, key);
        if (!exported.ok) continue;
        const value = exported.value;
        const text = typeof value === "function" ? safeFunctionSource(value) : key + ":" + safeToString(value).slice(0, 500);
        pushMatch(source, id, key, text);
        if (results.length >= limit) return;
      }
    };
    const webpackRequire = safeReadDataProperty(globalThis, "__webpack_require__").value;
    const webpackCache = safeReadDataProperty(webpackRequire, "c").value;
    if (webpackRequire && webpackCache) {
      for (const id of safeKeys(webpackCache, 2000)) {
        const moduleValue = safeReadDataProperty(webpackCache, id).value;
        inspectExports("__webpack_require__.c", id, moduleValue && safeReadDataProperty(moduleValue, "exports").value);
        if (results.length >= limit) break;
      }
    }
    for (const key of safeKeys(globalThis, 2000).filter((item) => /webpack/i.test(item)).slice(0, 20)) {
      const chunk = safeReadDataProperty(globalThis, key).value;
      if (!Array.isArray(chunk)) continue;
      for (const item of chunk.slice(0, 100)) {
        const modules = Array.isArray(item) ? item[1] : undefined;
        if (!modules || typeof modules !== "object") continue;
        for (const id of safeKeys(modules, 500)) {
          const moduleFactory = safeReadDataProperty(modules, id);
          if (moduleFactory.ok) {
            pushMatch(key, id, "", safeFunctionSource(moduleFactory.value));
          }
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }
    return { results, truncated: results.length >= limit };
  })()`;
}

function createDescribeFunctionExpression(path: string[], keywords: string[], radius: number): string {
  return `(() => {
    const path = ${JSON.stringify(path)};
    const keywords = ${JSON.stringify(keywords.map((keyword) => keyword.toLowerCase()))};
    const radius = ${JSON.stringify(radius)};
    const safeReadDataProperty = (value, key) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
        if (!descriptor) return { ok: false, skipped: false };
        if (!("value" in descriptor)) return { ok: false, skipped: true };
        return { ok: true, value: descriptor.value };
      } catch {
        return { ok: false, skipped: false };
      }
    };
    let current = globalThis;
    for (const segment of path) {
      if (current == null) return { exists: false, message: "路径不存在" };
      const next = safeReadDataProperty(current, segment);
      if (next.skipped) return { exists: true, type: "accessor", message: "目标是 accessor，已跳过读取" };
      if (!next.ok) return { exists: false, message: "路径不存在" };
      current = next.value;
    }
    if (typeof current !== "function") return { exists: true, type: typeof current, message: "目标不是函数" };
    let source = "";
    try {
      source = Function.prototype.toString.call(current);
    } catch {
      return { exists: true, type: "function", message: "函数源码不可读取" };
    }
    const lower = source.toLowerCase();
    const keyword = keywords.find((item) => lower.includes(item));
    const center = keyword ? lower.indexOf(keyword) : 0;
    const start = Math.max(0, center - radius);
    const end = Math.min(source.length, center + (keyword ? keyword.length : 0) + radius);
    const name = safeReadDataProperty(current, "name");
    const length = safeReadDataProperty(current, "length");
    return {
      exists: true,
      type: "function",
      name: typeof name.value === "string" ? name.value : "",
      length: typeof length.value === "number" ? length.value : 0,
      keyword: keyword || "",
      source: source.slice(start, end),
      truncated: source.length > end - start
    };
  })()`;
}

function extractRuntimeValue(response: unknown): unknown {
  if (!response || typeof response !== 'object') {
    return undefined;
  }
  const result = (response as { result?: { value?: unknown } }).result;
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  return result?.value;
}

function summarizeRuntimeValue(value: unknown, maxDepth: number, limit: number): RuntimeReadSummary {
  let redacted = false;
  let truncated = false;
  const seen = new WeakSet<object>();
  const summarize = (source: unknown, key = '', depth = 0): unknown => {
    if (isSensitiveRuntimeKey(key)) {
      redacted = true;
      return '[REDACTED]';
    }
    if (source === null || source === undefined || typeof source === 'number' || typeof source === 'boolean') {
      return source;
    }
    if (typeof source === 'bigint') {
      return source.toString();
    }
    if (typeof source === 'string') {
      const text = redactRuntimeString(source);
      if (text !== source) {
        redacted = true;
      }
      if (text.length > MAX_STRING_LENGTH) {
        truncated = true;
        return `${text.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`;
      }
      return text;
    }
    if (typeof source !== 'object') {
      return String(source);
    }
    if (Array.isArray(source) && source.length === 2 && typeof source[0] === 'string') {
      return [source[0], summarize(source[1], source[0], depth + 1)];
    }
    if (seen.has(source)) {
      truncated = true;
      return '[Circular]';
    }
    if (depth >= maxDepth) {
      truncated = true;
      return Array.isArray(source) ? '[Array]' : '[Object]';
    }
    seen.add(source);
    const entries = Array.isArray(source) ? source.slice(0, limit).map((item, index) => [String(index), item]) : Object.entries(source).slice(0, limit);
    if ((Array.isArray(source) ? source.length : Object.keys(source).length) > limit) {
      truncated = true;
    }
    return Object.fromEntries(entries.map(([entryKey, entryValue]) => [entryKey, summarize(entryValue, entryKey, depth + 1)]));
  };

  const summarized = summarize(value);
  // TF-0105: the page template marks its own cuts inline (`truncated: true` on a
  // typed node, `skipped: true` on an accessor). The Node-side pass cannot see
  // those as a size overflow, so fold them into the header — a header that says
  // `Truncated: false` must not hide a page-side cut.
  truncated = truncated || reportsRuntimeTruncation(value);
  const json = JSON.stringify(summarized, null, 2);
  if (json === undefined) {
    return { redacted, truncated, value: undefined };
  }
  if (json.length <= DEFAULT_RESULT_BUDGET) {
    return { redacted, truncated, value: summarized };
  }
  truncated = true;
  return {
    redacted,
    truncated,
    value: `${json.slice(0, DEFAULT_RESULT_BUDGET)}\n...[TRUNCATED]`,
  };
}

/**
 * TF-0105: outer depth budget for the inspect-globals envelope. See
 * `TYPED_TREE_LEVELS_PER_DEPTH` — the payload is a typed tree, not raw data.
 */
function inspectOuterDepth(maxDepth: number): number {
  return maxDepth * TYPED_TREE_LEVELS_PER_DEPTH + INSPECT_ENVELOPE_LEVELS;
}

/**
 * TF-0105: does the page-side payload itself declare a cut? Scans the (already
 * materialised, JSON-transferred) envelope for the template's own markers.
 */
function reportsRuntimeTruncation(value: unknown, depth = 0): boolean {
  if (depth > 64 || value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => reportsRuntimeTruncation(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  if (record.truncated === true) {
    return true;
  }
  return Object.values(record).some((item) => reportsRuntimeTruncation(item, depth + 1));
}

function redactRuntimeString(source: string): string {
  if (isSensitiveRuntimeKey(source)) {
    return '[REDACTED]';
  }

  let text = source;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

function formatRuntimeToolContent(title: string, summary: RuntimeReadSummary): string {
  const valueText = summary.value === undefined
    ? ''
    : typeof summary.value === 'string'
      ? summary.value
      : JSON.stringify(summary.value, null, 2);
  return [
    title,
    `Redacted: ${summary.redacted ? 'true' : 'false'}`,
    `Truncated: ${summary.truncated ? 'true' : 'false'}`,
    '',
    valueText || '未读取到可用运行时摘要。',
  ].join('\n');
}
