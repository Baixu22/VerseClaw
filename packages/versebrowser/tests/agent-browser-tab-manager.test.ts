/**
 * P1-7 tab-manager 单测。
 *
 * 覆盖 tab 增删切换、受限 URL 拒绝、懒清理、边界条件。
 * 对标 SRC tests/unit/background/browserControlMessageHandler.test.ts 中的
 * controlledTabIds 相关测试，适配 Map<pageId, entry> 模式。
 */

import { describe, expect, it, vi } from "vitest";
import {
  AgentBrowserTabManager,
  type TabManagedWindow,
} from "../src/engine/browser-control/tab-manager";

/** 创建 mock 窗口工厂。 */
function createMockWindowFactory() {
  const created: MockWindow[] = [];
  const factory = vi.fn((options: Electron.BrowserWindowConstructorOptions): TabManagedWindow => {
    const mock = new MockWindow(options);
    created.push(mock);
    return mock as unknown as TabManagedWindow;
  });
  return { factory, created };
}

/** mock 窗口实现。 */
class MockWindow {
  readonly webContents: { getTitle: () => string };
  private destroyed = false;
  private shown = false;
  private loadedUrl: string | undefined;
  private readonly showOption: boolean;

  constructor(options: Electron.BrowserWindowConstructorOptions) {
    this.showOption = options.show ?? false;
    this.webContents = {
      getTitle: () => "Mock Page Title",
    };
  }

  close(): void {
    this.destroyed = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  focus(): void {}
  hide(): void {}
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isMinimized(): boolean {
    return false;
  }
  isVisible(): boolean {
    return this.shown;
  }
  async loadURL(url: string): Promise<void> {
    this.loadedUrl = url;
  }
  restore(): void {}
  setBounds(): void {}
  show(): void {
    this.shown = true;
  }
  get loadedUrlValue(): string | undefined {
    return this.loadedUrl;
  }
  get wasShown(): boolean {
    return this.showOption;
  }
}

describe("AgentBrowserTabManager", () => {
  it("registerMainWindow 注册首页并设置活动页", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mockWindow = factory({ show: true });
    factory.mockClear();

    const pageId = manager.registerMainWindow(mockWindow, "https://example.com", "Example");

    expect(pageId).toBe("0");
    expect(manager.getActivePageId()).toBe("0");
    expect(manager.size).toBe(1);
    expect(manager.listPages()).toEqual([
      { pageId: "0", index: 0, url: "https://example.com", title: "Example", active: true },
    ]);
  });

  it("newPage 创建新标签页并切换活动页", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    factory.mockClear();
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    const result = await manager.newPage("https://second.com");

    expect(result.pageId).toBe("page-1");
    expect(manager.getActivePageId()).toBe("page-1");
    expect(manager.size).toBe(2);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][0].show).toBe(true);
  });

  it("newPage background=true 不切换活动页", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    factory.mockClear();
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    await manager.newPage("https://second.com", true);

    expect(manager.getActivePageId()).toBe("0");
    expect(manager.size).toBe(2);
  });

  it("newPage 不带 URL 创建空白页", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    factory.mockClear();
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    const result = await manager.newPage();

    expect(result.pageId).toBe("page-1");
    const pages = manager.listPages();
    expect(pages[1].url).toBe("");
  });

  it("newPage 受限 URL 抛出错误", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    await expect(manager.newPage("chrome://settings")).rejects.toThrow("受限页面");
    await expect(manager.newPage("chrome-extension://abc/foo")).rejects.toThrow("受限页面");
    await expect(manager.newPage("file:///etc/passwd")).rejects.toThrow("受限页面");
    expect(manager.size).toBe(1);
  });

  it("selectPage 切换活动页", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    manager.selectPage("0");
    expect(manager.getActivePageId()).toBe("0");
  });

  it("selectPage 不存在的 pageId 抛出错误", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    expect(() => manager.selectPage("nonexistent")).toThrow("不存在");
  });

  it("closePage 关闭活动页并切换到剩余页面", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");
    // 活动页是 page-1
    expect(manager.getActivePageId()).toBe("page-1");

    const result = manager.closePage();

    expect(result.closedPageId).toBe("page-1");
    expect(result.switchedTo).toBe("0");
    expect(manager.getActivePageId()).toBe("0");
    expect(manager.size).toBe(1);
  });

  it("closePage 关闭非活动页不影响活动页", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");
    await manager.newPage("https://third.com");
    // 活动页是 page-2

    const result = manager.closePage("page-1");

    expect(result.closedPageId).toBe("page-1");
    expect(result.switchedTo).toBeUndefined();
    expect(manager.getActivePageId()).toBe("page-2");
    expect(manager.size).toBe(2);
  });

  it("closePage 最后一个页面抛出错误", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    expect(() => manager.closePage()).toThrow("最后一个标签页");
  });

  it("closePage 重新索引剩余页面", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");
    await manager.newPage("https://third.com");

    // 关闭中间的 page-1
    manager.closePage("page-1");

    const pages = manager.listPages();
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.index)).toEqual([0, 1]);
    expect(pages.map((p) => p.pageId)).toEqual(["0", "page-2"]);
  });

  it("navigatePage 校验 URL 并返回窗口和条目", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    const result = manager.navigatePage("https://new-url.com");

    expect(result.entry.pageId).toBe("0");
    expect(result.window).toBe(mainWindow);
  });

  it("navigatePage 受限 URL 抛出错误", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    expect(() => manager.navigatePage("chrome://settings")).toThrow("受限页面");
    expect(() => manager.navigatePage("about:blank")).toThrow("受限页面");
  });

  it("navigatePage 指定非活动 pageId", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");
    // 活动页是 page-1，但导航 page-0

    const result = manager.navigatePage("https://new-url.com", "0");

    expect(result.entry.pageId).toBe("0");
  });

  it("navigatePage 不存在的 pageId 抛出错误", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    expect(() => manager.navigatePage("https://example.com", "nonexistent")).toThrow("不存在");
  });

  it("listPages 按 index 排序并标记活动页", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");
    await manager.newPage("https://third.com", true); // background

    const pages = manager.listPages();

    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(pages.map((p) => p.active)).toEqual([false, true, false]);
    expect(pages[1].active).toBe(true); // page-1 是活动页
  });

  it("listPages 懒清理已销毁的窗口", async () => {
    const { factory, created } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    // 先创建主窗口（pushed to created[0]）
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");
    // created[1] 是 newPage 创建的第二个窗口
    const secondMock = created[1] as unknown as MockWindow;

    // 销毁第二个窗口
    secondMock.close();
    expect(secondMock.isDestroyed()).toBe(true);

    const pages = manager.listPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].pageId).toBe("0");
  });

  it("updatePageInfo 更新页面 URL 和标题", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    manager.updatePageInfo("0", { url: "https://updated.com", title: "Updated Title" });

    const pages = manager.listPages();
    expect(pages[0].url).toBe("https://updated.com");
    expect(pages[0].title).toBe("Updated Title");
  });

  it("updatePageInfo 不存在的 pageId 静默忽略", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    expect(() => manager.updatePageInfo("nonexistent", { url: "https://x.com" })).not.toThrow();
  });

  it("clear 清理所有页面引用", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");

    manager.clear();

    expect(manager.size).toBe(0);
    expect(manager.getActivePageId()).toBeUndefined();
    expect(manager.listPages()).toEqual([]);
  });

  it("getActiveWindow 返回当前活动窗口", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    expect(manager.getActiveWindow()).toBe(mainWindow);

    const result = await manager.newPage("https://second.com");
    expect(manager.getActiveWindow()).toBe(result.window);
  });

  it("getActiveWindow 无活动页时返回 undefined", () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });

    expect(manager.getActiveWindow()).toBeUndefined();
  });

  it("getPageEntry 返回指定页面条目", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");
    await manager.newPage("https://second.com");

    const entry = manager.getPageEntry("page-1");
    expect(entry).toBeDefined();
    expect(entry?.url).toBe("https://second.com");
    expect(entry?.index).toBe(1);
  });

  it("多轮 newPage/closePage 后 pageId 计数器持续递增", async () => {
    const { factory } = createMockWindowFactory();
    const manager = new AgentBrowserTabManager({
      createWindow: factory,
      profile: "default",
      mode: "visible",
    });
    const mainWindow = factory({ show: true });
    manager.registerMainWindow(mainWindow, "https://example.com", "Example");

    const r1 = await manager.newPage("https://second.com");
    manager.closePage(r1.pageId);

    const r2 = await manager.newPage("https://third.com");

    // pageId 计数器不重置，避免复用
    expect(r1.pageId).toBe("page-1");
    expect(r2.pageId).toBe("page-2");
    expect(manager.size).toBe(2);
  });
});
