/**
 * P1-7：多标签页受控管理器。
 *
 * 抄写自 browser-ai-assistant-master/src/background/browserControlMessageHandler.ts
 * 中的 controlledTabIds 模式（Set<number>），适配 Electron BrowserWindow。
 *
 * 适配要点：
 * - SRC 使用 chrome.tabs API（一个窗口内多个 tab）；ClawX 使用 Electron BrowserWindow，
 *   每个"标签页"对应一个独立的 BrowserWindow（多窗口 tab 模式）。
 * - SRC 的 controlledTabIds 是 Set<number>（Chrome tabId）；ClawX 使用 Map<pageId, entry>
 *   以支持更丰富的页面元数据（url/title/index）。
 * - 主窗口（session.open 创建）注册为 pageId="0" 的首页；后续 newPage 创建额外窗口。
 * - 切换页面时由 service 层负责清理旧 UID（clearSnapshotCache）和重建 control state。
 * - CLI 引擎不支持多 tab，仅 browser-window 引擎可用。
 * - JS 弹窗处理（60s 手动等待、不自动确认）已在 browser-debugger-connection.ts 实现，
 *   tab-manager 不重复实现。
 */

import type { BrowserWindow } from 'electron';
import { isBrowserControlRestrictedUrl } from '@shared/agent-browser/browser-control';

/**
 * BrowserWindow 的最小可用子集，与 agent-browser-service.ts 中的 AgentBrowserWindow 结构兼容。
 * 使用独立类型定义以保持模块独立性，TypeScript 结构类型系统确保兼容性。
 */
export type TabManagedWindow = Pick<
  BrowserWindow,
  | 'close'
  | 'focus'
  | 'hide'
  | 'isDestroyed'
  | 'isMinimized'
  | 'isVisible'
  | 'loadURL'
  | 'restore'
  | 'setBounds'
  | 'show'
  | 'webContents'
>;

/** 标签页注册表条目。 */
export interface AgentBrowserTabEntry {
  pageId: string;
  index: number;
  window: TabManagedWindow;
  url: string;
  title: string;
}

/** 标签页对外信息（不含 window 引用，可安全传递给 renderer）。 */
export interface AgentBrowserTabInfo {
  pageId: string;
  index: number;
  url: string;
  title: string;
  active: boolean;
}

/** createWindow 工厂签名，与 agent-browser-service.ts 一致。 */
export type TabCreateWindow = (options: Electron.BrowserWindowConstructorOptions) => TabManagedWindow;

export interface AgentBrowserTabManagerOptions {
  createWindow: TabCreateWindow;
  profile: string;
  mode: 'visible' | 'hidden';
  /** 默认窗口宽度。 */
  width?: number;
  /** 默认窗口高度。 */
  height?: number;
}

/** closePage 结果。 */
export interface AgentBrowserClosePageResult {
  closedPageId: string;
  remaining: AgentBrowserTabInfo[];
  /** 如果关闭的是活动页，切换到的目标 pageId。 */
  switchedTo?: string;
}

/**
 * 多标签页受控管理器。
 *
 * 维护 session 内的 pages: Map<pageId, AgentBrowserTabEntry>，
 * 追踪 activePageId，提供 newPage/listPages/selectPage/closePage/navigatePage 操作。
 *
 * 不持有 debugger/snapshot/network 状态——这些由 AgentBrowserService 按 session 管理，
 * 切换页面时由 service 负责清理旧 UID 和重建 control state。
 */
export class AgentBrowserTabManager {
  private readonly pages = new Map<string, AgentBrowserTabEntry>();
  private readonly createWindow: TabCreateWindow;
  private readonly profile: string;
  private readonly mode: 'visible' | 'hidden';
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;
  private activePageId: string | undefined;
  private nextPageCounter = 1;

  constructor(options: AgentBrowserTabManagerOptions) {
    this.createWindow = options.createWindow;
    this.profile = options.profile;
    this.mode = options.mode;
    this.defaultWidth = options.width ?? 1280;
    this.defaultHeight = options.height ?? 800;
  }

  /**
   * 注册主窗口（由 session.open 创建）为首页。
   * pageId 固定为 "0"，index 固定为 0。
   * 仅在 session 初始化时调用一次。
   */
  registerMainWindow(window: TabManagedWindow, url: string, title: string): string {
    const pageId = '0';
    this.pages.set(pageId, { pageId, index: 0, window, url, title });
    this.activePageId = pageId;
    this.nextPageCounter = 1;
    return pageId;
  }

  /** 当前活动页面 ID。 */
  getActivePageId(): string | undefined {
    return this.activePageId;
  }

  /** 当前活动页面对应的窗口。 */
  getActiveWindow(): TabManagedWindow | undefined {
    if (!this.activePageId) return undefined;
    return this.pages.get(this.activePageId)?.window;
  }

  /** 获取指定页面的窗口。 */
  getPageWindow(pageId: string): TabManagedWindow | undefined {
    return this.pages.get(pageId)?.window;
  }

  /** 获取指定页面条目。 */
  getPageEntry(pageId: string): AgentBrowserTabEntry | undefined {
    return this.pages.get(pageId);
  }

  /** 标签页数量。 */
  get size(): number {
    return this.pages.size;
  }

  /**
   * 列出所有标签页信息（按 index 排序）。
   * 自动清理已销毁的窗口。
   */
  listPages(): AgentBrowserTabInfo[] {
    this.pruneDestroyedPages();
    return [...this.pages.values()]
      .sort((a, b) => a.index - b.index)
      .map((entry) => ({
        pageId: entry.pageId,
        index: entry.index,
        url: entry.url,
        title: entry.title,
        active: entry.pageId === this.activePageId,
      }));
  }

  /**
   * 创建新标签页。
   *
   * @param url 可选初始 URL，会校验受限页面
   * @param background 是否后台创建（不切换活动页、不显示窗口）
   * @returns 新页面的 pageId 和 window
   */
  async newPage(url?: string, background?: boolean): Promise<{ pageId: string; window: TabManagedWindow }> {
    if (url) {
      if (isBrowserControlRestrictedUrl(url)) {
        throw new Error('目标 URL 属于浏览器受限页面，无法在新标签页打开。');
      }
    }
    const pageId = `page-${this.nextPageCounter++}`;
    const window = this.createWindow({
      show: this.mode === 'visible' && !background,
      width: this.defaultWidth,
      height: this.defaultHeight,
      title: 'Agent Browser',
      webPreferences: {
        contextIsolation: true,
        javascript: true,
        nodeIntegration: false,
        partition: `persist:agent-browser-${this.profile}`,
        sandbox: true,
      },
    });
    if (url) {
      await window.loadURL(url);
    }
    const title = window.webContents.getTitle() ?? '';
    this.pages.set(pageId, {
      pageId,
      index: this.pages.size,
      window,
      url: url ?? '',
      title,
    });
    if (!background) {
      this.activePageId = pageId;
    }
    return { pageId, window };
  }

  /**
   * 选择（切换到）指定标签页。
   *
   * @param pageId 目标页面 ID
   * @returns 切换后的活动窗口
   * @throws 如果 pageId 不存在
   */
  selectPage(pageId: string): TabManagedWindow {
    const entry = this.pages.get(pageId);
    if (!entry) {
      throw new Error(`标签页 ${pageId} 不存在。`);
    }
    this.activePageId = pageId;
    return entry.window;
  }

  /**
   * 关闭指定标签页（默认关闭活动页）。
   *
   * - 不允许关闭最后一个标签页（需使用 session close）
   * - 如果关闭的是活动页，自动切换到剩余的第一个页面
   * - 重新索引剩余页面
   *
   * @param pageId 可选目标页面 ID，默认为活动页
   * @returns 关闭结果（含剩余页面列表和可能的切换目标）
   */
  closePage(pageId?: string): AgentBrowserClosePageResult {
    const targetId = pageId ?? this.activePageId;
    if (!targetId) {
      throw new Error('当前没有可关闭的标签页。');
    }
    const entry = this.pages.get(targetId);
    if (!entry) {
      throw new Error(`标签页 ${targetId} 不存在。`);
    }
    if (this.pages.size <= 1) {
      throw new Error('最后一个标签页不能通过 closePage 关闭，请使用 session close。');
    }
    this.pages.delete(targetId);
    try {
      entry.window.close();
    } catch {
      // best-effort: 窗口可能已销毁
    }
    // 重新索引剩余页面
    const remaining = [...this.pages.values()].sort((a, b) => a.index - b.index);
    remaining.forEach((e, i) => {
      e.index = i;
    });
    // 如果关闭的是活动页，切换到剩余的第一个页面
    let switchedTo: string | undefined;
    if (this.activePageId === targetId) {
      const next = remaining[0];
      this.activePageId = next?.pageId;
      switchedTo = next?.pageId;
    }
    return {
      closedPageId: targetId,
      remaining: this.listPages(),
      switchedTo,
    };
  }

  /**
   * 导航指定页面到新 URL（仅校验 + 返回窗口，不执行 loadURL）。
   *
   * 实际的 loadURL + waitForWebContents 由 service 层负责，
   * 因为需要先设置 wait promise 再调用 loadURL 以避免竞态。
   *
   * @param url 目标 URL
   * @param pageId 可选目标页面 ID，默认为活动页
   * @returns 目标窗口和条目
   * @throws 如果 URL 受限或 pageId 不存在
   */
  navigatePage(url: string, pageId?: string): { window: TabManagedWindow; entry: AgentBrowserTabEntry } {
    if (isBrowserControlRestrictedUrl(url)) {
      throw new Error('目标 URL 属于浏览器受限页面，无法导航。');
    }
    const targetId = pageId ?? this.activePageId;
    if (!targetId) {
      throw new Error('当前没有活动标签页。');
    }
    const entry = this.pages.get(targetId);
    if (!entry) {
      throw new Error(`标签页 ${targetId} 不存在。`);
    }
    return { window: entry.window, entry };
  }

  /**
   * 更新页面信息（导航或标题变化后由 service 调用）。
   */
  updatePageInfo(pageId: string, updates: { url?: string; title?: string }): void {
    const entry = this.pages.get(pageId);
    if (!entry) return;
    if (updates.url !== undefined) entry.url = updates.url;
    if (updates.title !== undefined) entry.title = updates.title;
  }

  /** 清理所有页面引用（不关闭窗口，由 session close 负责）。 */
  clear(): void {
    this.pages.clear();
    this.activePageId = undefined;
    this.nextPageCounter = 1;
  }

  /**
   * 清理已销毁的窗口（懒清理）。
   * 对标 SRC getControlledPages 中的 lazy pruning。
   */
  private pruneDestroyedPages(): void {
    const destroyed: string[] = [];
    for (const [pageId, entry] of this.pages) {
      try {
        if (entry.window.isDestroyed()) {
          destroyed.push(pageId);
        }
      } catch {
        destroyed.push(pageId);
      }
    }
    if (destroyed.length === 0) return;
    for (const pageId of destroyed) {
      this.pages.delete(pageId);
    }
    // 重新索引
    const remaining = [...this.pages.values()].sort((a, b) => a.index - b.index);
    remaining.forEach((e, i) => {
      e.index = i;
    });
    // 如果活动页被清理，切换到第一个剩余页面
    if (this.activePageId && destroyed.includes(this.activePageId)) {
      this.activePageId = remaining[0]?.pageId;
    }
  }
}
