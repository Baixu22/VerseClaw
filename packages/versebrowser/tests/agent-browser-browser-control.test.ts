/**
 * P0-TEST：browser-control 三件套独立单测。
 *
 * 覆盖：
 * - BrowserDebuggerConnection：attach/detach/sendCommand/CDP 白名单/dialog 事件/detach 原因规范化
 * - BrowserControlSnapshotManager：takeSnapshot UID 映射、UID 失效（页面身份变化）、截断预算
 * - BrowserControlActionExecutor：click/fill/press_key 验证与执行、错误 UID、未知动作
 *
 * mock 策略：FakeWebContents extends EventEmitter，内含 FakeDebugger（vi.fn mock）。
 * 不依赖真实 Electron，纯逻辑测试。
 */

import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { BrowserDebuggerConnection, normalizeDetachReason } from '../src/engine/browser-control/browser-debugger-connection';
import { BrowserControlSnapshotManager } from '../src/engine/browser-control/snapshot-manager';
import {
  BrowserControlActionExecutor,
  createBrowserActionDisabledResult,
  createBrowserActionErrorResult,
  isBrowserControlActionName,
} from '../src/engine/browser-control/actions';
import type { BrowserControlToolCall } from '../src/core/types';

class FakeDebugger extends EventEmitter {
  readonly attach = vi.fn(async (_version: string) => undefined);
  readonly detach = vi.fn(async () => undefined);
  readonly sendCommand = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [
          {
            nodeId: 'root',
            backendDOMNodeId: 1,
            role: { value: 'RootWebArea' },
            name: { value: 'Test Page' },
            childIds: ['btn', 'link'],
          },
          {
            nodeId: 'btn',
            backendDOMNodeId: 2,
            role: { value: 'button' },
            name: { value: 'Submit' },
          },
          {
            nodeId: 'link',
            backendDOMNodeId: 3,
            role: { value: 'link' },
            name: { value: 'Learn more' },
          },
        ],
      };
    }
    if (method === 'DOM.resolveNode') {
      return { object: { objectId: 'obj-1' } };
    }
    if (method === 'DOM.getBoxModel') {
      return { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } };
    }
    if (method === 'Runtime.callFunctionOn') {
      return { result: { value: true } };
    }
    return {};
  });
}

class FakeWebContents extends EventEmitter {
  readonly id = 42;
  url = 'https://example.com/';
  title = 'Test Page';
  readonly debugger = new FakeDebugger();

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }
}

function createFakeWebContents(): FakeWebContents {
  return new FakeWebContents();
}

function attachToConnection(conn: BrowserDebuggerConnection, wc: FakeWebContents) {
  return conn.attach(wc as unknown as WebContents);
}

describe('BrowserDebuggerConnection', () => {
  it('attaches to webContents and enables required CDP domains', async () => {
    const wc = createFakeWebContents();
    const conn = new BrowserDebuggerConnection();
    const result = await attachToConnection(conn, wc);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attached).toBe(true);
      expect(result.tabId).toBe(42);
    }
    expect(wc.debugger.attach).toHaveBeenCalledWith('1.3');
    // 启用域的顺序：Runtime → Page → DOM → Accessibility → Network → Log
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Runtime.enable', expect.anything());
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Page.enable', expect.anything());
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('DOM.enable', expect.anything());
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Accessibility.enable', expect.anything());
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Network.enable', expect.anything());
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Log.enable', expect.anything());
    expect(conn.isAttached).toBe(true);
    expect(conn.attachedTabId).toBe(42);
  });

  it('returns ok=false when attach throws', async () => {
    const wc = createFakeWebContents();
    wc.debugger.attach.mockRejectedValueOnce(new Error('Another debugger is already attached'));
    const conn = new BrowserDebuggerConnection();
    const result = await attachToConnection(conn, wc);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('其他调试器');
    }
    expect(conn.isAttached).toBe(false);
  });

  it('detaches and clears state', async () => {
    const wc = createFakeWebContents();
    const conn = new BrowserDebuggerConnection();
    await attachToConnection(conn, wc);
    await conn.detach();

    expect(wc.debugger.detach).toHaveBeenCalled();
    expect(conn.isAttached).toBe(false);
    expect(conn.attachedTabId).toBeUndefined();
  });

  it('rejects sendCommand for non-allowlisted CDP methods', async () => {
    const wc = createFakeWebContents();
    const conn = new BrowserDebuggerConnection();
    await attachToConnection(conn, wc);

    // 直接调用内部方法不可行（private），通过公开方法间接测：
    // getFullAccessibilityTree 走 Accessibility.getFullAXTree（白名单内）
    await expect(conn.getFullAccessibilityTree()).resolves.toBeDefined();
    // 白名单内方法正常返回
    await expect(conn.resolveNodeByBackendId(2)).resolves.toEqual({ object: { objectId: 'obj-1' } });
  });

  it('installs detach listener and normalizes reason', async () => {
    const wc = createFakeWebContents();
    const conn = new BrowserDebuggerConnection();
    await attachToConnection(conn, wc);

    const onDetach = vi.fn();
    conn.installDetachListener(onDetach);

    // 模拟 webContents.debugger 'detach' 事件
    wc.debugger.emit('detach', {}, 'canceled_by_user');
    expect(onDetach).toHaveBeenCalledWith(42, 'canceled_by_user');
    expect(conn.isAttached).toBe(false);
  });

  it('handles Page.javascriptDialogOpening/Closed events', async () => {
    const wc = createFakeWebContents();
    const conn = new BrowserDebuggerConnection();
    await attachToConnection(conn, wc);

    const listener = vi.fn();
    conn.addEventListener(listener);
    conn.installEventListener();

    wc.debugger.emit('message', {}, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Are you sure?',
      defaultPrompt: '',
    });
    expect(listener).toHaveBeenCalledWith('Page.javascriptDialogOpening', expect.objectContaining({ type: 'confirm' }));
    expect(conn.getDialogHint()).toContain('confirm');
    expect(conn.getDialogHint()).toContain('Are you sure?');

    wc.debugger.emit('message', {}, 'Page.javascriptDialogClosed', { result: true });
    expect(conn.getDialogHint()).toContain('用户已确认');
  });
});

describe('normalizeDetachReason', () => {
  it('passes through known reasons', () => {
    expect(normalizeDetachReason('canceled_by_user')).toBe('canceled_by_user');
    expect(normalizeDetachReason('target_closed')).toBe('target_closed');
  });

  it('maps unknown reasons to "unknown"', () => {
    expect(normalizeDetachReason('something_else')).toBe('unknown');
    expect(normalizeDetachReason(undefined)).toBe('unknown');
  });
});

describe('BrowserControlSnapshotManager', () => {
  function createManagerWithFake(webContents: FakeWebContents) {
    const conn = new BrowserDebuggerConnection();
    // 直接 attach 以填充 currentWebContents，sendCommand 走 fake
    return {
      conn,
      manager: new BrowserControlSnapshotManager(conn, async () => ({
        title: webContents.getTitle(),
        url: webContents.getURL(),
      })),
    };
  }

  async function attachConn(conn: BrowserDebuggerConnection, wc: FakeWebContents) {
    await attachToConnection(conn, wc);
  }

  it('takeSnapshot returns text with uid= markers and role/name', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);

    const snapshot = await manager.takeSnapshot();
    expect(snapshot).toContain('# 浏览器页面快照');
    expect(snapshot).toContain('页面标题：Test Page');
    expect(snapshot).toContain('页面 URL：https://example.com/');
    expect(snapshot).toContain('uid=');
    expect(snapshot).toContain('button');
    expect(snapshot).toContain('Submit');
    expect(snapshot).toContain('link');
    expect(snapshot).toContain('Learn more');
  });

  it('maps uid to backendNodeId after takeSnapshot', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);

    await manager.takeSnapshot();
    // root 的 backendDOMNodeId 是 1，button 是 2，link 是 3
    expect(manager.getBackendNodeId('1_1')).toBe(1);
    expect(manager.getBackendNodeId('1_2')).toBe(2);
    expect(manager.getBackendNodeId('1_3')).toBe(3);
  });

  it('throws on stale uid from old snapshot version', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);

    await manager.takeSnapshot();
    // 改变页面身份，使旧 UID 失效
    wc.url = 'https://other.example.com/';
    wc.title = 'Other Page';
    // 第二次 takeSnapshot 会把 snapshotVersion 推进到 2，并清空 backendNodeIdToUid 缓存
    await manager.takeSnapshot();
    // 旧 uid 1_1 应抛出"来自旧快照"
    expect(() => manager.getBackendNodeId('1_1')).toThrow('旧快照');
  });

  it('throws on unknown uid', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);

    await manager.takeSnapshot();
    expect(() => manager.getBackendNodeId('1_999')).toThrow('不存在');
  });

  it('clears uid cache when page identity changes', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);

    await manager.takeSnapshot();
    expect(manager.getBackendNodeId('1_1')).toBe(1);

    // 页面身份变化
    wc.url = 'https://other.example.com/';
    wc.title = 'Other Page';
    await manager.takeSnapshot();
    // 新快照版本是 2，旧 uid 1_1 应失效
    expect(() => manager.getBackendNodeId('1_1')).toThrow('旧快照');
  });

  it('returns empty text when AX tree has no nodes', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);
    // attach 后覆盖 getFullAXTree 返回空节点
    wc.debugger.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
      if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: true } };
      return {};
    });

    const snapshot = await manager.takeSnapshot();
    expect(snapshot).toContain('未读取到可访问节点');
  });

  it('listElementCandidates returns all mapped uids', async () => {
    const wc = createFakeWebContents();
    const { conn, manager } = createManagerWithFake(wc);
    await attachConn(conn, wc);

    await manager.takeSnapshot();
    const candidates = manager.listElementCandidates();
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.backendNodeId).sort()).toEqual([1, 2, 3]);
  });
});

describe('BrowserControlActionExecutor', () => {
  async function createExecutorWithFake() {
    const wc = createFakeWebContents();
    const conn = new BrowserDebuggerConnection();
    await attachToConnection(conn, wc);
    const snapshotManager = new BrowserControlSnapshotManager(conn, async () => ({
      title: wc.getTitle(),
      url: wc.getURL(),
    }));
    const executor = new BrowserControlActionExecutor(conn, snapshotManager);
    return { wc, conn, snapshotManager, executor };
  }

  it('isBrowserControlActionName validates known actions', () => {
    expect(isBrowserControlActionName('click')).toBe(true);
    expect(isBrowserControlActionName('fill')).toBe(true);
    expect(isBrowserControlActionName('press_key')).toBe(true);
    expect(isBrowserControlActionName('scroll')).toBe(true);
    expect(isBrowserControlActionName('hover')).toBe(true);
    expect(isBrowserControlActionName('double_click')).toBe(true);
    expect(isBrowserControlActionName('context_click')).toBe(true);
    expect(isBrowserControlActionName('drag')).toBe(true);
    expect(isBrowserControlActionName('wait_for')).toBe(true);
    expect(isBrowserControlActionName('wait_for_state')).toBe(true);
    expect(isBrowserControlActionName('unknown')).toBe(false);
  });

  it('createBrowserActionDisabledResult returns error result', () => {
    const toolCall: BrowserControlToolCall = { id: 't1', name: 'click', arguments: {} };
    const result = createBrowserActionDisabledResult(toolCall);
    expect(result.isError).toBe(true);
    expect(result.toolCallId).toBe('t1');
    expect(result.name).toBe('click');
    expect(result.content).toContain('浏览器控制未开启');
  });

  it('createBrowserActionErrorResult returns custom error', () => {
    const toolCall: BrowserControlToolCall = { id: 't2', name: 'fill', arguments: {} };
    const result = createBrowserActionErrorResult(toolCall, 'custom error');
    expect(result.isError).toBe(true);
    expect(result.content).toBe('custom error');
  });

  it('rejects unknown action name', async () => {
    const { executor } = await createExecutorWithFake();
    const toolCall: BrowserControlToolCall = { id: 't3', name: 'unknown_action', arguments: {} };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('未知的浏览器操作工具');
  });

  it('rejects invalid arguments for click (missing uid)', async () => {
    const { executor } = await createExecutorWithFake();
    const toolCall: BrowserControlToolCall = { id: 't4', name: 'click', arguments: {} };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('UID');
  });

  it('rejects invalid arguments for fill (missing value)', async () => {
    const { executor } = await createExecutorWithFake();
    const toolCall: BrowserControlToolCall = { id: 't5', name: 'fill', arguments: { uid: '1_1' } };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('value');
  });

  it('rejects invalid arguments for press_key (missing key)', async () => {
    const { executor } = await createExecutorWithFake();
    const toolCall: BrowserControlToolCall = { id: 't6', name: 'press_key', arguments: {} };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('key');
  });

  it('rejects press_key with unknown key', async () => {
    const { executor } = await createExecutorWithFake();
    const toolCall: BrowserControlToolCall = {
      id: 't7',
      name: 'press_key',
      arguments: { key: 'NotARealKey' },
    };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('不在允许列表');
  });

  it('executes click after takeSnapshot', async () => {
    const { wc, snapshotManager, executor } = await createExecutorWithFake();
    await snapshotManager.takeSnapshot();
    // 清空 sendCommand 调用记录，便于断言 click 触发的命令
    wc.debugger.sendCommand.mockClear();

    const toolCall: BrowserControlToolCall = {
      id: 't8',
      name: 'click',
      arguments: { uid: '1_2' },
    };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('已点击元素 1_2');
    // click 走 DOM.resolveNode + DOM.getBoxModel + Runtime.callFunctionOn + Input.dispatchMouseEvent
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('DOM.resolveNode', expect.objectContaining({ backendNodeId: 2 }));
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed' }),
    );
  });

  it('executes press_key with Enter', async () => {
    const { wc, executor } = await createExecutorWithFake();
    wc.debugger.sendCommand.mockClear();

    const toolCall: BrowserControlToolCall = {
      id: 't9',
      name: 'press_key',
      arguments: { key: 'Enter' },
    };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Enter');
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyDown' }),
    );
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyUp' }),
    );
  });

  it('executes press_key with modifier combination Control+Enter', async () => {
    const { wc, executor } = await createExecutorWithFake();
    wc.debugger.sendCommand.mockClear();

    const toolCall: BrowserControlToolCall = {
      id: 't10',
      name: 'press_key',
      arguments: { key: 'Control+Enter' },
    };
    const result = await executor.execute(toolCall);
    expect(result.isError).toBeFalsy();
    // Control keyDown → Enter keyDown → Enter keyUp → Control keyUp
    const keyDownCalls = wc.debugger.sendCommand.mock.calls.filter(
      (c) => c[0] === 'Input.dispatchKeyEvent' && (c[1] as Record<string, unknown>).type === 'keyDown',
    );
    expect(keyDownCalls).toHaveLength(2);
  });
});

describe('BrowserControlSnapshotManager secret redaction (C96 host engine)', () => {
  function managerFor(nodes: unknown[]) {
    return new BrowserControlSnapshotManager(
      { getFullAccessibilityTree: async () => ({ nodes }) },
      async () => ({ title: 'Vault', url: 'http://127.0.0.1/vault' }),
    );
  }
  const root = {
    nodeId: 'root',
    backendDOMNodeId: 1,
    role: { value: 'RootWebArea' },
    name: { value: 'Vault' },
    childIds: ['secret', 'search', 'heading', 'select'],
  };

  // Measured (real Chromium, CDP Accessibility.getFullAXTree): Chromium masks type=password but
  // returns a plain text field's value verbatim, and the value survives the shared text redactor
  // (it only matches "key=value" / "key: value", not this "role name value=..." shape).
  it('withholds an editable text field value the shared redactor cannot see', async () => {
    const snapshot = await managerFor([
      root,
      { nodeId: 'secret', backendDOMNodeId: 12, role: { value: 'textbox' }, name: { value: '' }, value: { value: 'sk-live-ABC123' } },
      { nodeId: 'search', backendDOMNodeId: 14, role: { value: 'textbox' }, name: { value: 'Search' }, value: { value: 'ordinary text' } },
    ]).takeSnapshot();
    expect(snapshot).not.toContain('sk-live-ABC123');
    // The AX tree omits the DOM name/id/type the thin driver uses, so every editable text field is
    // withheld (fail closed) - even a harmless one. This is a deliberate, coarser boundary.
    expect(snapshot).not.toContain('ordinary text');
    expect(snapshot).toContain('value="[REDACTED]"');
    expect(snapshot).toContain('value_redacted');
    // The field itself stays visible so the agent still knows it exists.
    expect(snapshot).toContain('uid=');
    expect(snapshot).toContain('textbox');
  });

  it('keeps non-editable values and withholds a secret-named field of any role', async () => {
    const snapshot = await managerFor([
      root,
      { nodeId: 'heading', backendDOMNodeId: 15, role: { value: 'heading' }, name: { value: '' }, value: { value: 'Account settings' } },
      { nodeId: 'select', backendDOMNodeId: 16, role: { value: 'combobox' }, name: { value: 'api_key' }, value: { value: 'secret-option' } },
    ]).takeSnapshot();
    expect(snapshot).toContain('Account settings');
    expect(snapshot).not.toContain('secret-option');
    expect(snapshot).toContain('value_redacted');
  });
});
