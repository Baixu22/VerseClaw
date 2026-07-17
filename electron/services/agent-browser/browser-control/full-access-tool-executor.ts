/**
 * 完全访问工具执行器 — 抄写自 browser-ai-assistant-master/src/background/browserControl/fullAccessToolExecutor.ts
 * 适配点：
 * 1. 去掉 ModelToolCall/ModelToolResult 依赖，改为直接返回 plain result 对象（content + 可选 isError + 可选 toolAttachments）
 * 2. 去掉 FULL_ACCESS_* 常量依赖（直接方法调用，不需要工具名分发）
 * 3. import 路径改为 ClawX 约定（@shared/agent-browser/*）
 * 4. 暴露 executeScript/fetchFromPage/getNetworkDetails/readStorage/revokeFullAccess 五个直接方法
 * 5. 核心逻辑零改动：fail-closed 授权、Runtime.evaluate 原始返回、页面 fetch 凭据保留、Network 未脱敏原文、Storage 全量读取。
 */
import type { ChatToolAttachment, NetworkRequestDetail } from '@shared/agent-browser/types';
import { formatNetworkAttachmentSummary } from '@shared/agent-browser/network-context';

export interface FullAccessResult {
  content: string;
  isError?: boolean;
  toolAttachments?: ChatToolAttachment[];
}

export interface FullAccessConnection {
  evaluate(params: Record<string, unknown>): Promise<unknown>;
}

export interface FullAccessRecorder {
  isEnabled: boolean | (() => boolean);
  getDetails(requestIds: string[], options?: { redacted?: boolean }): Promise<NetworkRequestDetail[]>;
}

export interface FullAccessContext {
  tabId?: number;
  origin?: string;
  fullAccess: boolean;
  /** Binding: only this tabId may use full-access tools. */
  expectedTabId?: number;
  /** Binding: only this origin may use full-access tools. */
  expectedOrigin?: string;
  /** Absolute expiry epoch ms; missing means session-bound until revoke. */
  expiresAt?: number;
}

export interface ExecuteScriptArgs {
  script: string;
  awaitPromise?: boolean;
}

export interface FetchFromPageArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: 'include' | 'same-origin' | 'omit';
}

export interface GetNetworkDetailsArgs {
  requestIds: string[];
}

const FULL_ACCESS_DISABLED_MESSAGE = '当前不是完全访问模式，已拒绝执行 full_access.* 工具。';
const FULL_ACCESS_FAILED_MESSAGE = '完全访问工具执行失败，请确认当前页面仍可访问后重试。';
const MAX_DETAIL_IDS = 100;

export class FullAccessToolExecutor {
  constructor(
    private readonly connection: FullAccessConnection,
    private readonly recorder: FullAccessRecorder,
    private readonly getContext: () => FullAccessContext,
    private readonly revoke: () => void,
  ) {}

  canExpose(): boolean {
    const ctx = this.getContext();
    if (!ctx.fullAccess || !this.isRecorderEnabled()) return false;
    // P4-002 A2: bind full-access to tab + origin (+ optional expiry).
    if (typeof ctx.tabId !== 'number' || typeof ctx.expectedTabId !== 'number') return false;
    if (ctx.tabId !== ctx.expectedTabId) return false;
    if (!ctx.origin || !ctx.expectedOrigin || ctx.origin !== ctx.expectedOrigin) return false;
    if (ctx.expiresAt !== undefined && ctx.expiresAt <= Date.now()) return false;
    return true;
  }

  async executeScript(args: ExecuteScriptArgs): Promise<FullAccessResult> {
    if (!this.canExpose()) {
      return { content: FULL_ACCESS_DISABLED_MESSAGE, isError: true };
    }
    const validation = normalizeExecuteScriptArguments(args);
    if (!validation.ok) {
      return { content: validation.message, isError: true };
    }
    try {
      const response = await this.connection.evaluate({
        expression: validation.script,
        awaitPromise: validation.awaitPromise,
        returnByValue: true,
      });
      return { content: stringifyRawValue(response) };
    } catch {
      return { content: FULL_ACCESS_FAILED_MESSAGE, isError: true };
    }
  }

  async fetchFromPage(args: FetchFromPageArgs): Promise<FullAccessResult> {
    if (!this.canExpose()) {
      return { content: FULL_ACCESS_DISABLED_MESSAGE, isError: true };
    }
    const validation = normalizeFetchArguments(args);
    if (!validation.ok) {
      return { content: validation.message, isError: true };
    }
    try {
      const response = await this.connection.evaluate({
        expression: createPageFetchExpression(validation.request),
        awaitPromise: true,
        returnByValue: true,
      });
      return { content: stringifyRawValue(response) };
    } catch {
      return { content: FULL_ACCESS_FAILED_MESSAGE, isError: true };
    }
  }

  async getNetworkDetails(args: GetNetworkDetailsArgs): Promise<FullAccessResult> {
    if (!this.canExpose()) {
      return { content: FULL_ACCESS_DISABLED_MESSAGE, isError: true };
    }
    const validation = normalizeRequestIds(args.requestIds);
    if (!validation.ok) {
      return { content: validation.message, isError: true };
    }
    try {
      const details = await this.recorder.getDetails(validation.requestIds, { redacted: false });
      return {
        content: stringifyRawValue(details),
        toolAttachments: [createFullAccessNetworkAttachment(details)],
      };
    } catch {
      return { content: FULL_ACCESS_FAILED_MESSAGE, isError: true };
    }
  }

  async readStorage(): Promise<FullAccessResult> {
    if (!this.canExpose()) {
      return { content: FULL_ACCESS_DISABLED_MESSAGE, isError: true };
    }
    try {
      const response = await this.connection.evaluate({
        expression: createReadStorageExpression(),
        awaitPromise: false,
        returnByValue: true,
      });
      return { content: stringifyRawValue(response) };
    } catch {
      return { content: FULL_ACCESS_FAILED_MESSAGE, isError: true };
    }
  }

  revokeFullAccess(): FullAccessResult {
    if (!this.canExpose()) {
      return { content: FULL_ACCESS_DISABLED_MESSAGE, isError: true };
    }
    this.revoke();
    return { content: '完全访问模式已撤销，浏览器自动化已回到普通模式（受限）。' };
  }

  private isRecorderEnabled(): boolean {
    return typeof this.recorder.isEnabled === 'function' ? this.recorder.isEnabled() : this.recorder.isEnabled;
  }
}

interface NormalizedFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials: 'include' | 'same-origin' | 'omit';
}

function normalizeExecuteScriptArguments(args: ExecuteScriptArgs): { ok: true; script: string; awaitPromise: boolean } | { ok: false; message: string } {
  if (typeof args.script !== 'string' || args.script.length === 0) {
    return { ok: false, message: 'full_access.execute_script 需要非空 script。' };
  }
  if (args.awaitPromise !== undefined && typeof args.awaitPromise !== 'boolean') {
    return { ok: false, message: 'awaitPromise 必须是布尔值。' };
  }
  return { ok: true, script: args.script, awaitPromise: args.awaitPromise !== false };
}

function normalizeFetchArguments(args: FetchFromPageArgs): { ok: true; request: NormalizedFetchRequest } | { ok: false; message: string } {
  if (typeof args.url !== 'string' || args.url.length === 0) {
    return { ok: false, message: 'full_access.fetch 需要非空 url。' };
  }
  if (args.method !== undefined && typeof args.method !== 'string') {
    return { ok: false, message: 'method 必须是字符串。' };
  }
  if (args.body !== undefined && typeof args.body !== 'string') {
    return { ok: false, message: 'body 必须是字符串。' };
  }
  const headers = normalizeHeaders(args.headers);
  if (!headers.ok) {
    return headers;
  }
  const credentials = args.credentials;
  if (credentials !== undefined && credentials !== 'include' && credentials !== 'same-origin' && credentials !== 'omit') {
    return { ok: false, message: 'credentials 必须是 include、same-origin 或 omit。' };
  }
  return {
    ok: true,
    request: {
      url: args.url,
      method: typeof args.method === 'string' && args.method.length > 0 ? args.method : undefined,
      headers: headers.headers,
      body: typeof args.body === 'string' ? args.body : undefined,
      credentials: credentials ?? 'include',
    },
  };
}

function normalizeHeaders(value: Record<string, string> | undefined): { ok: true; headers?: Record<string, string> } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'headers 必须是对象。' };
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== 'string') {
      return { ok: false, message: 'headers 的值必须是字符串。' };
    }
    headers[name] = headerValue;
  }
  return { ok: true, headers };
}

function normalizeRequestIds(value: unknown): { ok: true; requestIds: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DETAIL_IDS || value.some((entry) => typeof entry !== 'string' || !entry)) {
    return { ok: false, message: 'requestIds 必须是 1 到 100 个非空字符串组成的数组。' };
  }
  return { ok: true, requestIds: value };
}

function createPageFetchExpression(request: NormalizedFetchRequest): string {
  return `(() => {
    const request = ${JSON.stringify(request)};
    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: request.credentials ?? "include",
    }).then(async (response) => ({
      url: response.url,
      redirected: response.redirected,
      type: response.type,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Array.from(response.headers.entries()).map(([name, value]) => ({ name, value })),
      body: await response.text(),
    }));
  })()`;
}

function createReadStorageExpression(): string {
  return `(() => ({
    location: {
      href: location.href,
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    },
    title: document.title,
    referrer: document.referrer,
    cookie: document.cookie,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, key === null ? null : localStorage.getItem(key)];
    }).filter(([key]) => key !== null)),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index);
      return [key, key === null ? null : sessionStorage.getItem(key)];
    }).filter(([key]) => key !== null)),
  }))()`;
}

function createFullAccessNetworkAttachment(requests: NetworkRequestDetail[]): ChatToolAttachment {
  const rawRequests = requests.map((request) => ({ ...request, redacted: false }));
  return {
    id: `tool-attachment-full-access-${Date.now()}`,
    kind: 'network',
    title: 'Network 请求详情',
    summary: formatNetworkAttachmentSummary(rawRequests),
    createdAt: Date.now(),
    redacted: false,
    fullAccess: true,
    truncated: rawRequests.some((request) => request.truncated),
    requests: rawRequests,
  } as ChatToolAttachment;
}

function stringifyRawValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
