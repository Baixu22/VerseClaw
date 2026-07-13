/**
 * 抄写自 browser-ai-assistant-master/src/background/browserControlMessageHandler.ts
 * 中的 BrowserDebuggerConnection 类及相关 helper 函数。
 *
 * 适配点（API 调用层 chrome.debugger → webContents.debugger）：
 * 1. `chrome.debugger.attach({tabId}, '1.3', cb)` → `webContents.debugger.attach('1.3')`
 * 2. `chrome.debugger.sendCommand({tabId}, method, params, cb)` → `webContents.debugger.sendCommand(method, params)`
 * 3. `chrome.debugger.detach({tabId}, cb)` → `webContents.debugger.detach()`
 * 4. `chrome.debugger.onDetach.addListener` → `webContents.debugger.on('detach', ...)`
 * 5. `chrome.debugger.onEvent.addListener` → `webContents.debugger.on('message', ...)`
 * 6. `chrome.runtime.lastError` → Electron 错误通过 Promise reject 传播
 * 7. `tabId` → `webContents.id`（保留 tabId 概念，上层逻辑改动最小）
 *
 * 逻辑结构、常量、CDP 方法白名单、dialog 处理流程原样抄写，便于后续同步上游修复。
 */

import type { WebContents } from "electron";

const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DIALOG_WAIT_TIMEOUT_MS = 60_000;

type BrowserControlDetachedReason = "canceled_by_user" | "target_closed" | "tab_removed" | "disabled_by_user" | "unknown";
type BrowserControlDialogType = "alert" | "confirm" | "prompt" | "beforeunload" | string;

interface BrowserControlDialogState {
  type: BrowserControlDialogType;
  message: string;
  defaultPrompt: string;
  openedAt: number;
}

interface BrowserControlDialogCloseState extends BrowserControlDialogState {
  result: boolean;
  userInput?: string;
}

const ALLOWED_BROWSER_CONTROL_CDP_METHODS = new Set([
  "Runtime.enable",
  "Page.enable",
  "DOM.enable",
  "Accessibility.enable",
  "Network.enable",
  "Log.enable",
  "Network.getResponseBody",
  "Accessibility.getFullAXTree",
  "DOM.resolveNode",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.getBoxModel",
  "Page.captureScreenshot",
  "Runtime.callFunctionOn",
  "Runtime.evaluate",
  "Page.navigate",
  "Page.reload",
  "Page.getNavigationHistory",
  "Page.navigateToHistoryEntry",
  "Page.getFrameTree",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
]);

/**
 * Electron 版 BrowserDebuggerConnection。
 *
 * 用 webContents.debugger 替代 chrome.debugger。
 * 保留 attach/detach/sendCommand 语义，dialog 监听通过 webContents.debugger 'message' 事件。
 */
export class BrowserDebuggerConnection {
  private currentWebContents: WebContents | undefined;
  private currentTabId: number | undefined;
  private attached = false;
  private detachListenersInstalled = false;
  private eventListenersInstalled = false;
  private readonly eventListeners = new Set<(method: string, params?: Record<string, unknown>) => void>();
  private currentDialog: BrowserControlDialogState | undefined;
  private lastClosedDialog: BrowserControlDialogCloseState | undefined;
  private dialogWaiter: ((dialog: BrowserControlDialogCloseState) => void) | undefined;

  constructor() {}

  get attachedTabId(): number | undefined {
    return this.attached ? this.currentTabId : undefined;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  getDialogHint(): string {
    const dialog = this.lastClosedDialog ?? this.currentDialog;
    if (!dialog) {
      return "";
    }

    const closed = isClosedDialog(dialog)
      ? `\n用户处理结果：${formatDialogCloseResult(dialog)}`
      : "\n用户处理结果：等待用户手动处理。";
    return `检测到网页弹窗：${dialog.type}「${dialog.message || "无内容"}」${closed}`;
  }

  addEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void {
    this.eventListeners.add(listener);
  }

  removeEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void {
    this.eventListeners.delete(listener);
  }

  async waitForOpenDialogToClose(timeoutMs = DIALOG_WAIT_TIMEOUT_MS): Promise<string> {
    if (this.lastClosedDialog) {
      const hint = `检测到网页弹窗：${this.lastClosedDialog.type}「${this.lastClosedDialog.message || "无内容"}」\n用户处理结果：${formatDialogCloseResult(this.lastClosedDialog)}`;
      this.lastClosedDialog = undefined;
      return hint;
    }

    if (!this.currentDialog) {
      return "";
    }

    const closedDialog = await new Promise<BrowserControlDialogCloseState | undefined>((resolve) => {
      const timer = setTimeout(() => {
        if (this.dialogWaiter === finish) {
          this.dialogWaiter = undefined;
        }
        resolve(undefined);
      }, timeoutMs);
      const finish = (dialog: BrowserControlDialogCloseState) => {
        clearTimeout(timer);
        if (this.dialogWaiter === finish) {
          this.dialogWaiter = undefined;
        }
        resolve(dialog);
      };
      this.dialogWaiter = finish;
    });

    if (!closedDialog) {
      throw new Error("网页弹窗等待超时，请先在页面中手动处理弹窗后再继续。");
    }

    return `检测到网页弹窗：${closedDialog.type}「${closedDialog.message || "无内容"}」\n用户处理结果：${formatDialogCloseResult(closedDialog)}`;
  }

  /**
   * 安装 detach 监听器。
   *
   * 源项目：chrome.debugger.onDetach.addListener((source, reason) => ...)
   * Electron：webContents.debugger.on('detach', (event, reason) => ...)
   */
  installDetachListener(onDetach: (tabId: number, reason: string) => void): void {
    if (this.detachListenersInstalled || !this.currentWebContents?.debugger) {
      return;
    }

    this.detachListenersInstalled = true;
    this.currentWebContents.debugger.on("detach", (_event, reason) => {
      const detachedTabId = this.currentTabId;
      this.attached = false;
      this.currentWebContents = undefined;
      this.currentTabId = undefined;
      if (detachedTabId !== undefined) {
        onDetach(detachedTabId, reason);
      }
    });
  }

  /**
   * 安装 CDP 事件监听器。
   *
   * 源项目：chrome.debugger.onEvent.addListener((source, method, params) => ...)
   * Electron：webContents.debugger.on('message', (event, method, params) => ...)
   */
  installEventListener(): void {
    if (this.eventListenersInstalled || !this.currentWebContents?.debugger) {
      return;
    }

    this.eventListenersInstalled = true;
    this.currentWebContents.debugger.on("message", (_event, method, params) => {
      const normalizedParams = params && typeof params === "object" ? params as Record<string, unknown> : undefined;
      if (method === "Page.javascriptDialogOpening") {
        this.currentDialog = {
          type: typeof normalizedParams?.type === "string" ? normalizedParams.type : "dialog",
          message: typeof normalizedParams?.message === "string" ? normalizedParams.message : "",
          defaultPrompt: typeof normalizedParams?.defaultPrompt === "string" ? normalizedParams.defaultPrompt : "",
          openedAt: Date.now(),
        };
      }
      if (method === "Page.javascriptDialogClosed" && this.currentDialog) {
        this.lastClosedDialog = {
          ...this.currentDialog,
          result: normalizedParams?.result === true,
          userInput: typeof normalizedParams?.userInput === "string" ? normalizedParams.userInput : undefined,
        };
        this.currentDialog = undefined;
        this.dialogWaiter?.(this.lastClosedDialog);
      }

      for (const listener of this.eventListeners) {
        listener(method, normalizedParams);
      }
    });
  }

  /**
   * attach 到指定 webContents。
   *
   * 源项目：chrome.debugger.attach({tabId}, '1.3', cb)
   * Electron：webContents.debugger.attach('1.3')（返回 Promise）
   */
  async attach(webContents: WebContents, shouldContinue: () => boolean = () => true): Promise<BrowserControlResponse> {
    const tabId = webContents.id;
    if (this.attached && this.currentTabId === tabId) {
      return { ok: true, attached: true, tabId, message: "浏览器控制已连接当前标签页。" };
    }

    if (this.attached) {
      await this.detach();
    }

    try {
      await webContents.debugger.attach(DEBUGGER_PROTOCOL_VERSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: normalizeDebuggerError(message) };
    }

    this.attached = true;
    this.currentWebContents = webContents;
    this.currentTabId = tabId;
    this.currentDialog = undefined;
    this.lastClosedDialog = undefined;
    // 切换 webContents 后需要重新安装监听器
    this.detachListenersInstalled = false;
    this.eventListenersInstalled = false;

    if (!shouldContinue()) {
      await this.detach();
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    const domainResult = await this.enableRequiredDomains();
    if (!domainResult.ok) {
      await this.detach();
      return domainResult;
    }

    if (!shouldContinue()) {
      await this.detach();
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    return { ok: true, attached: true, tabId, message: "浏览器控制已开启，Electron 会显示正在调试提示。" };
  }

  async detach(): Promise<void> {
    const webContents = this.currentWebContents;
    if (!this.attached || !webContents) {
      this.attached = false;
      this.currentWebContents = undefined;
      this.currentTabId = undefined;
      return;
    }

    try {
      await webContents.debugger.detach();
    } catch {
      // tab 已关闭或用户取消调试时，Electron 可能拒绝 detach；本地状态仍必须立即清理，避免留下假连接。
    } finally {
      this.attached = false;
      this.currentWebContents = undefined;
      this.currentTabId = undefined;
      this.currentDialog = undefined;
      this.lastClosedDialog = undefined;
      this.dialogWaiter = undefined;
    }
  }

  private async enableRequiredDomains(): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await this.sendCommand("Runtime.enable");
      await this.sendCommand("Page.enable");
      await this.sendCommand("DOM.enable");
      await this.sendCommand("Accessibility.enable");
      await this.sendCommand("Network.enable");
      await this.sendCommand("Log.enable");
      return { ok: true };
    } catch {
      return { ok: false, message: "浏览器调试会话初始化失败，请关闭浏览器控制后重试。" };
    }
  }

  async getFullAccessibilityTree(): Promise<unknown> {
    return this.sendCommand("Accessibility.getFullAXTree");
  }

  async resolveNodeByBackendId(backendNodeId: number): Promise<unknown> {
    return this.sendCommand("DOM.resolveNode", { backendNodeId });
  }

  async scrollIntoViewIfNeeded(objectId: string): Promise<unknown> {
    return this.sendCommand("DOM.scrollIntoViewIfNeeded", { objectId });
  }

  async getBoxModel(backendNodeId: number): Promise<unknown> {
    return this.sendCommand("DOM.getBoxModel", { backendNodeId });
  }

  async captureScreenshot(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Page.captureScreenshot", params);
  }

  async callFunctionOn(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Runtime.callFunctionOn", params);
  }

  async evaluate(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Runtime.evaluate", params);
  }

  async dispatchMouseEvent(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Input.dispatchMouseEvent", params);
  }

  async dispatchKeyEvent(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Input.dispatchKeyEvent", params);
  }

  async insertText(text: string): Promise<unknown> {
    return this.sendCommand("Input.insertText", { text });
  }

  async navigate(url: string): Promise<unknown> {
    return this.sendCommand("Page.navigate", { url });
  }

  async reload(): Promise<unknown> {
    return this.sendCommand("Page.reload");
  }

  async getNavigationHistory(): Promise<unknown> {
    return this.sendCommand("Page.getNavigationHistory");
  }

  async navigateToHistoryEntry(entryId: number): Promise<unknown> {
    return this.sendCommand("Page.navigateToHistoryEntry", { entryId });
  }

  async getFrameTree(): Promise<unknown> {
    return this.sendCommand("Page.getFrameTree");
  }

  async getResponseBody(requestId: string): Promise<{ body?: string; base64Encoded?: boolean }> {
    return this.sendCommand("Network.getResponseBody", { requestId }) as Promise<{ body?: string; base64Encoded?: boolean }>;
  }

  /**
   * 发送 CDP 命令。
   *
   * 源项目：chrome.debugger.sendCommand({tabId}, method, params, cb)
   * Electron：webContents.debugger.sendCommand(method, params)（返回 Promise）
   */
  private async sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!ALLOWED_BROWSER_CONTROL_CDP_METHODS.has(method)) {
      throw new Error("浏览器控制不允许调用该 CDP 方法。");
    }

    const webContents = this.currentWebContents;
    if (!this.attached || !webContents) {
      throw new Error("debugger 未连接");
    }

    try {
      return await webContents.debugger.sendCommand(method, params);
    } catch {
      throw new Error("浏览器调试命令执行失败，请确认当前页面仍可访问后重试。");
    }
  }
}

export type { BrowserControlDetachedReason };

/** 源项目 BrowserControlResponse 类型，attach 返回值。 */
export type BrowserControlResponse =
  | {
      ok: true;
      attached: boolean;
      tabId?: number;
      expiresAt?: number;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

function formatDialogCloseResult(dialog: BrowserControlDialogCloseState): string {
  if (dialog.type === "prompt" && dialog.result) {
    return `用户已确认并输入：${dialog.userInput ?? ""}`;
  }

  return dialog.result ? "用户已确认" : "用户已取消";
}

function isClosedDialog(dialog: BrowserControlDialogState | BrowserControlDialogCloseState): dialog is BrowserControlDialogCloseState {
  return "result" in dialog && typeof dialog.result === "boolean";
}

function normalizeDebuggerError(message = ""): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("restricted") || normalized.includes("cannot access") || normalized.includes("webui")) {
    return "当前页面属于浏览器受限页面，无法开启浏览器控制。请切换到普通网页后重试。";
  }

  if (normalized.includes("another debugger") || normalized.includes("already attached")) {
    return "当前标签页已被其他调试器占用，请关闭其他调试会话后重试。";
  }

  return "Electron 拒绝开启调试会话，请确认当前页面可被控制后重试。";
}

/**
 * 规范化 detach 原因。
 *
 * 源项目：chrome.debugger.DetachReason 枚举（canceled_by_user / target_closed）
 * Electron：webContents.debugger 'detach' 事件 reason 参数为字符串，可能值包括
 * "target_closed"、"replaced_with_devtools"、"canceled_by_user" 等。
 *
 * P1-1 加固：区分 4 种原因 + unknown，为 UI 状态同步预留可靠事件来源。
 * - canceled_by_user: 用户主动取消调试
 * - target_closed: 目标页面/标签页关闭
 * - tab_removed: 标签页被移除（Electron 映射自 target_closed / replaced）
 * - disabled_by_user: 用户通过 setEnabled 关闭开关
 * - unknown: 其他未知原因
 */
export function normalizeDetachReason(reason: string | undefined): BrowserControlDetachedReason {
  if (reason === "canceled_by_user") {
    return "canceled_by_user";
  }
  if (reason === "target_closed") {
    return "target_closed";
  }
  if (reason === "replaced_with_devtools" || reason === "tab_removed") {
    return "tab_removed";
  }
  if (reason === "disabled_by_user") {
    return "disabled_by_user";
  }
  return "unknown";
}
