/**
 * JS 源码工具执行器 — 抄写自 browser-ai-assistant-master/src/background/browserControl/jsSourceToolExecutor.ts
 * 适配点：
 * 1. 去掉 ModelToolCall/ModelToolResult 依赖，改为直接返回 plain result 对象
 * 2. 去掉 BoundaryGrantContext 依赖，allowSameOriginFetch 由 service 层授权后传入
 * 3. import 路径改为 ClawX 约定（@shared/agent-browser/*, ./js-source-index, ./same-origin-js-fetcher）
 * 核心逻辑零改动：refreshNetworkResources、listResources、searchSources、extractContext、fetchSameOriginResources。
 */
import type {
  JsSourceContext,
  JsSourceFetchFailure,
  JsSourceMatch,
  JsSourceResource,
  NetworkRequestDetail,
  NetworkRequestMeta,
} from '@shared/agent-browser/types';
import { truncateText } from '@shared/agent-browser/text';
import { JsSourceIndex, isJavaScriptDetail, isJavaScriptMetaLike } from './js-source-index';
import type { JsSourceIndex as JsSourceIndexType } from './js-source-index';
import { SameOriginJsFetcher, type SameOriginJsFetchResult } from './same-origin-js-fetcher';
import type { NetworkRequestFilter } from './network-recorder';

interface JsSourceRecorderLike {
  isEnabled: boolean | (() => boolean);
  listRequests(filter?: NetworkRequestFilter): NetworkRequestMeta[];
  getDetails(requestIds: string[]): Promise<NetworkRequestDetail[]>;
}

export interface JsSourceToolExecutorOptions {
  recorder: JsSourceRecorderLike;
  getCurrentPageUrl: () => Promise<string>;
  fetcher?: Pick<SameOriginJsFetcher, 'fetch'>;
}

export interface JsListResourcesResult {
  resources: JsSourceResource[];
  content: string;
}

export interface JsSearchSourcesArgs {
  keywords: string[];
  urls?: string[];
  limit?: number;
  allowSameOriginFetch?: boolean;
}

export interface JsSearchSourcesResult {
  resources: JsSourceResource[];
  matches: JsSourceMatch[];
  failedFetches: JsSourceFetchFailure[];
  truncated: boolean;
  content: string;
}

export interface JsExtractContextArgs {
  resourceId: string;
  position: number;
}

export interface JsExtractContextResult {
  resources: JsSourceResource[];
  contexts: JsSourceContext[];
  truncated: boolean;
  content: string;
}

const JS_SOURCE_DISABLED_MESSAGE = 'JS 源码检索依赖 Network 采集，请先开启浏览器控制。';
const KEYWORDS_INVALID_MESSAGE = 'keywords 必须是包含 1 到 20 个非空字符串的数组。';
const RESOURCE_ID_INVALID_MESSAGE = 'resourceId 必须是非空字符串。';
const POSITION_INVALID_MESSAGE = 'position 必须是大于等于 0 的有限数字。';
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 200;
const MAX_URLS = 20;
const MAX_URL_LENGTH = 2048;
const MAX_RESOURCE_IDS = 100;
const DEFAULT_RESOURCE_LIMIT = 100;
const DEFAULT_MATCH_LIMIT = 50;

export class JsSourceToolExecutor {
  private readonly index = new JsSourceIndex();
  private readonly fetcher: Pick<SameOriginJsFetcher, 'fetch'>;

  constructor(private readonly options: JsSourceToolExecutorOptions) {
    this.fetcher = options.fetcher ?? new SameOriginJsFetcher();
  }

  clear(): void {
    this.index.clear();
  }

  getIndex(): JsSourceIndexType {
    return this.index;
  }

  async refreshResourcesForAnalysis(): Promise<void> {
    await this.refreshNetworkResources();
  }

  async listResources(): Promise<JsListResourcesResult> {
    if (!this.isEnabled()) {
      return { resources: [], content: JS_SOURCE_DISABLED_MESSAGE };
    }
    await this.refreshNetworkResources();
    const resources = this.index.listResources();
    return { resources, content: formatResourceList(resources) };
  }

  async searchSources(args: JsSearchSourcesArgs): Promise<JsSearchSourcesResult> {
    if (!this.isEnabled()) {
      return { resources: [], matches: [], failedFetches: [], truncated: false, content: JS_SOURCE_DISABLED_MESSAGE };
    }
    const keywords = normalizeKeywords(args.keywords);
    if (!keywords.ok) {
      return { resources: [], matches: [], failedFetches: [], truncated: false, content: keywords.message };
    }

    await this.refreshNetworkResources();
    const urls = normalizeStringArray(args.urls, MAX_URLS, MAX_URL_LENGTH);
    const canFetch = args.allowSameOriginFetch === true;
    const failedFetches = canFetch
      ? await this.fetchSameOriginResources(urls)
      : createSameOriginFetchBoundaryFailures(urls);
    const result = this.index.search(keywords.keywords, { maxMatches: normalizeLimit(args.limit, DEFAULT_MATCH_LIMIT) });
    return {
      resources: this.index.listResources(),
      matches: result.matches,
      failedFetches,
      truncated: result.truncated,
      content: formatSearchResult(result.matches, failedFetches, result.truncated),
    };
  }

  async extractContext(args: JsExtractContextArgs): Promise<JsExtractContextResult> {
    if (!this.isEnabled()) {
      return { resources: [], contexts: [], truncated: false, content: JS_SOURCE_DISABLED_MESSAGE };
    }
    const resourceId = normalizeOptionalString(args.resourceId, 256);
    if (!resourceId) {
      return { resources: [], contexts: [], truncated: false, content: RESOURCE_ID_INVALID_MESSAGE };
    }
    if (typeof args.position !== 'number' || !Number.isFinite(args.position) || args.position < 0) {
      return { resources: [], contexts: [], truncated: false, content: POSITION_INVALID_MESSAGE };
    }

    await this.refreshNetworkResources();
    const context = this.index.extractContext(resourceId, args.position);
    if (!context) {
      const resources = this.index.listResources();
      return { resources, contexts: [], truncated: false, content: '未找到指定 JS 资源或位置。' };
    }

    return {
      resources: this.index.listResources().filter((resource) => resource.id === resourceId),
      contexts: [context],
      truncated: context.truncated,
      content: formatContexts([context]),
    };
  }

  async searchForNetworkCompatibility(args: { keywords?: string[]; urlIncludes?: string }): Promise<{ content: string; resources: JsSourceResource[]; matches: JsSourceMatch[]; truncated: boolean }> {
    if (this.isEnabled()) {
      await this.refreshNetworkResources();
    }
    const keywords = normalizeKeywords(args.keywords ?? []);
    const urlIncludes = normalizeOptionalString(args.urlIncludes, MAX_KEYWORD_LENGTH);
    const terms = keywords.ok && keywords.keywords.length ? keywords.keywords : [];
    if (urlIncludes) {
      terms.push(urlIncludes);
    }
    const fallbackTerms = terms.length ? terms : ['sign', 'signature', 'encrypt', 'crypto', 'md5', 'sha', 'aes', 'nonce', 'timestamp', 'token'];
    const result = this.index.search(fallbackTerms, { maxMatches: DEFAULT_MATCH_LIMIT });
    return {
      content: formatSearchResult(result.matches, [], result.truncated),
      resources: this.index.listResources(),
      matches: result.matches,
      truncated: result.truncated,
    };
  }

  private async refreshNetworkResources(): Promise<void> {
    const listedRequests = this.options.recorder.listRequests({ limit: DEFAULT_RESOURCE_LIMIT });
    const metas = Array.isArray(listedRequests) ? listedRequests.filter(isJavaScriptMeta) : [];
    if (metas.length === 0) {
      // 兼容阶段一旧入口：无 JS 资源时仍走一次详情读取，保持既有 mock/调用口径稳定。
      await this.options.recorder.getDetails([]);
      return;
    }
    const details = await this.options.recorder.getDetails(metas.slice(0, MAX_RESOURCE_IDS).map((request) => request.id));
    this.index.upsertNetworkDetails(details.filter(isJavaScriptDetail));
  }

  private async fetchSameOriginResources(urls: string[]): Promise<JsSourceFetchFailure[]> {
    const pageUrl = await this.options.getCurrentPageUrl();
    const failures: JsSourceFetchFailure[] = [];
    for (const url of urls) {
      const result: SameOriginJsFetchResult = await this.fetcher.fetch(url, pageUrl);
      if (result.ok) {
        this.index.upsertFetchedResource(result.resource);
      } else {
        failures.push({ url: result.url, message: result.message });
      }
    }
    return failures;
  }

  private isEnabled(): boolean {
    return typeof this.options.recorder.isEnabled === 'function' ? this.options.recorder.isEnabled() : this.options.recorder.isEnabled;
  }
}

function formatResourceList(resources: JsSourceResource[]): string {
  if (resources.length === 0) {
    return '当前未找到可检索的 JS 资源。';
  }
  return resources
    .map((resource, index) =>
      `${index + 1}. id=${resource.id} | ${resource.source} | ${resource.mimeType ?? 'unknown'} | ${resource.size} chars | ${resource.url}`,
    )
    .join('\n');
}

function formatSearchResult(matches: JsSourceMatch[], failures: JsSourceFetchFailure[], truncated: boolean): string {
  const sections: string[] = [];
  if (matches.length) {
    sections.push([
      `找到 ${matches.length} 个 JS 源码命中${truncated ? '（结果已截断）' : ''}：`,
      ...matches.map((match) => `- ${match.source} ${match.resourceId}:${match.line}:${match.column} ${match.url} 命中 ${match.term}: ${match.snippet}`),
    ].join('\n'));
  } else {
    sections.push('未找到匹配的 JS 源码片段。');
  }
  if (failures.length) {
    sections.push(['同源补位失败：', ...failures.map((failure) => `- ${failure.url}: ${failure.message}`)].join('\n'));
  }
  return sections.join('\n\n');
}

function formatContexts(contexts: JsSourceContext[]): string {
  return contexts
    .map((context) => [
      `JS 上下文：${context.resourceId}:${context.line}:${context.column}`,
      `来源：${context.source}`,
      `URL：${context.url}`,
      context.truncated ? 'Truncated: true' : 'Truncated: false',
      '',
      context.snippet,
    ].join('\n'))
    .join('\n\n');
}

function createSameOriginFetchBoundaryFailures(urls: string[]): JsSourceFetchFailure[] {
  return urls.map((url) => ({
    url,
    message: '需要 allowSameOriginFetch=true 才会读取同源 JS。',
  }));
}

function normalizeKeywords(value: unknown): { ok: true; keywords: string[] } | { ok: false; message: string } {
  const keywords = normalizeStringArray(value, MAX_KEYWORDS, MAX_KEYWORD_LENGTH);
  if (keywords.length === 0) {
    return { ok: false, message: KEYWORDS_INVALID_MESSAGE };
  }
  return { ok: true, keywords };
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => normalizeOptionalString(item, maxLength)).filter((item): item is string => Boolean(item)))).slice(0, maxItems);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? truncateText(trimmed, maxLength).text : undefined;
}

function normalizeLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), DEFAULT_MATCH_LIMIT);
}

function isJavaScriptMeta(meta: NetworkRequestMeta): boolean {
  return isJavaScriptMetaLike(meta);
}
