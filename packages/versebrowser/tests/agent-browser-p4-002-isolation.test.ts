import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentBrowserProfilePartition,
  agentBrowserRunArtifactDir,
  agentBrowserScreenshotDir,
  isPathInsideRoot,
  resolvePathWithinRoot,
  sanitizeAgentBrowserPathSegment,
} from '../src/core/filesystem-boundary';
import {
  isBoundaryGrantUsable,
  isFullAccessContextAuthorized,
} from '../src/core/tool-authorization';
import { FullAccessToolExecutor } from '../src/engine/browser-control/full-access-tool-executor';
import {
  AgentBrowserTabManager,
  type TabManagedWindow,
} from '../src/engine/browser-control/tab-manager';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

class MockWindow {
  readonly webPreferences: Electron.WebPreferences | undefined;
  readonly webContents = { getTitle: () => 'title', getURL: () => this.loadedUrl ?? '' };
  private destroyed = false;
  private loadedUrl: string | undefined;
  constructor(options: Electron.BrowserWindowConstructorOptions) {
    this.webPreferences = options.webPreferences;
  }
  close(): void { this.destroyed = true; }
  focus(): void {}
  hide(): void {}
  isDestroyed(): boolean { return this.destroyed; }
  isMinimized(): boolean { return false; }
  isVisible(): boolean { return true; }
  async loadURL(url: string): Promise<void> { this.loadedUrl = url; }
  restore(): void {}
  setBounds(): void {}
  show(): void {}
}

function createManager(profile: string) {
  const factory = vi.fn((options: Electron.BrowserWindowConstructorOptions): TabManagedWindow => {
    return new MockWindow(options) as unknown as TabManagedWindow;
  });
  return {
    factory,
    manager: new AgentBrowserTabManager({ createWindow: factory, profile, mode: 'hidden' }),
  };
}

describe('P4-002 filesystem boundary', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('sanitizes segments and rejects traversal', () => {
    expect(sanitizeAgentBrowserPathSegment('run-1')).toBe('run-1');
    expect(() => sanitizeAgentBrowserPathSegment('../etc')).toThrow(/invalid/);
    expect(() => sanitizeAgentBrowserPathSegment('a/b')).toThrow(/invalid/);
  });

  it('keeps run/screenshot paths under agent-browser root', () => {
    root = mkdtempSync(join(tmpdir(), 'ab-p4-002-'));
    const runDir = agentBrowserRunArtifactDir(root, 'run-abc');
    const shotDir = agentBrowserScreenshotDir(root, 'sess-1');
    expect(isPathInsideRoot(join(root, 'agent-browser'), runDir)).toBe(true);
    expect(isPathInsideRoot(join(root, 'agent-browser'), shotDir)).toBe(true);
    expect(() => agentBrowserRunArtifactDir(root, '../escape')).toThrow();
    expect(() => resolvePathWithinRoot(join(root, 'agent-browser'), '..', 'outside')).toThrow(/escapes/);
  });

  it('builds profile-isolated partitions', () => {
    expect(agentBrowserProfilePartition('work')).toBe('persist:agent-browser-work');
    expect(agentBrowserProfilePartition('personal')).toBe('persist:agent-browser-personal');
    expect(() => agentBrowserProfilePartition('../x')).toThrow();
  });
});

describe('P4-002 multi-tab / multi-profile isolation', () => {
  it('does not serialize tabs across profiles and uses distinct partitions', async () => {
    const work = createManager('work');
    const personal = createManager('personal');
    const mainWork = work.factory({ show: false });
    work.factory.mockClear();
    work.manager.registerMainWindow(mainWork, 'https://work.example', 'Work');
    const mainPersonal = personal.factory({ show: false });
    personal.factory.mockClear();
    personal.manager.registerMainWindow(mainPersonal, 'https://personal.example', 'Personal');

    const pageWork = await work.manager.newPage('https://work.example/a');
    const pagePersonal = await personal.manager.newPage('https://personal.example/a');

    expect(work.manager.listPages()).toHaveLength(2);
    expect(personal.manager.listPages()).toHaveLength(2);
    // Independent session managers: each keeps its own page map / active window.
    expect(work.manager.getActivePageId()).toBe(pageWork.pageId);
    expect(personal.manager.getActivePageId()).toBe(pagePersonal.pageId);
    expect(work.manager.getActiveWindow()).not.toBe(personal.manager.getActiveWindow());
    expect(work.manager.listPages().map((p) => p.url)).toEqual([
      'https://work.example',
      'https://work.example/a',
    ]);
    expect(personal.manager.listPages().map((p) => p.url)).toEqual([
      'https://personal.example',
      'https://personal.example/a',
    ]);

    const workOpts = work.factory.mock.calls[0]?.[0] as Electron.BrowserWindowConstructorOptions;
    const personalOpts = personal.factory.mock.calls[0]?.[0] as Electron.BrowserWindowConstructorOptions;
    expect(workOpts.webPreferences?.partition).toBe('persist:agent-browser-work');
    expect(personalOpts.webPreferences?.partition).toBe('persist:agent-browser-personal');
    expect(workOpts.webPreferences?.partition).not.toBe(personalOpts.webPreferences?.partition);
  });

  it('rejects restricted schemes on newPage/navigatePage', async () => {
    const { manager, factory } = createManager('default');
    const main = factory({ show: false });
    manager.registerMainWindow(main, 'https://example.com', 'ex');
    await expect(manager.newPage('javascript:alert(1)')).rejects.toThrow();
    expect(() => manager.navigatePage('data:text/html,hi')).toThrow();
  });
});

describe('P4-002 grant tab+origin+expiry binding', () => {
  it('expires and rejects wrong tab/origin replay', () => {
    const grant = {
      id: 'g1',
      tabId: 7,
      origin: 'https://example.com',
      toolCallId: 'call-1',
      scopeKey: 'replay_send_request' + String.fromCharCode(0) + 'draft-1',
      grants: ['send_single_confirmed_replay_request_without_credentials' as const],
      selectedChoiceIds: ['send_once'],
      createdAt: Date.now(),
      expiresAt: Date.now() + 30_000,
    };
    expect(isBoundaryGrantUsable(grant, 7, 'https://example.com')).toBe(true);
    expect(isBoundaryGrantUsable(grant, 8, 'https://example.com')).toBe(false);
    expect(isBoundaryGrantUsable(grant, 7, 'https://evil.example')).toBe(false);
    expect(isBoundaryGrantUsable(grant, 7, 'https://example.com', grant.expiresAt + 1)).toBe(false);
    expect(isBoundaryGrantUsable(undefined, 7, 'https://example.com')).toBe(false);
  });

  it('full-access fails closed on tab/origin mismatch or expiry', async () => {
    const evaluate = vi.fn(async () => ({ result: { value: 1 } }));
    const denied = new FullAccessToolExecutor(
      { evaluate },
      { isEnabled: true, getDetails: vi.fn(async () => []) },
      () => ({
        tabId: 7,
        origin: 'https://example.com',
        expectedTabId: 8,
        expectedOrigin: 'https://example.com',
        fullAccess: true,
      }),
      vi.fn(),
    );
    const wrongOrigin = new FullAccessToolExecutor(
      { evaluate },
      { isEnabled: true, getDetails: vi.fn(async () => []) },
      () => ({
        tabId: 7,
        origin: 'https://example.com',
        expectedTabId: 7,
        expectedOrigin: 'https://other.example',
        fullAccess: true,
      }),
      vi.fn(),
    );
    const expired = new FullAccessToolExecutor(
      { evaluate },
      { isEnabled: true, getDetails: vi.fn(async () => []) },
      () => ({
        tabId: 7,
        origin: 'https://example.com',
        expectedTabId: 7,
        expectedOrigin: 'https://example.com',
        fullAccess: true,
        expiresAt: Date.now() - 1,
      }),
      vi.fn(),
    );
    const ok = new FullAccessToolExecutor(
      { evaluate },
      { isEnabled: true, getDetails: vi.fn(async () => []) },
      () => ({
        tabId: 7,
        origin: 'https://example.com',
        expectedTabId: 7,
        expectedOrigin: 'https://example.com',
        fullAccess: true,
        expiresAt: Date.now() + 60_000,
      }),
      vi.fn(),
    );

    expect((await denied.executeScript({ script: '1' })).isError).toBe(true);
    expect((await wrongOrigin.executeScript({ script: '1' })).isError).toBe(true);
    expect((await expired.executeScript({ script: '1' })).isError).toBe(true);
    expect((await ok.executeScript({ script: '1' })).isError).toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(1);

    expect(isFullAccessContextAuthorized({
      modeOk: true,
      tabId: 7,
      expectedTabId: 7,
      origin: 'https://example.com',
      expectedOrigin: 'https://example.com',
      expiresAt: Date.now() + 1000,
    })).toBe(true);
    expect(isFullAccessContextAuthorized({
      modeOk: true,
      tabId: 7,
      expectedTabId: 7,
      origin: 'https://example.com',
      expectedOrigin: 'https://evil.example',
    })).toBe(false);
  });
});
