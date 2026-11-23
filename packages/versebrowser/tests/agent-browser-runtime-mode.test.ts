/**
 * P0-3 新增：runtime-mode 运行态模式单测。
 *
 * 覆盖：
 * - mode 不持久化（open 默认 normal_restricted）
 * - normal_restricted 下 takeSnapshot/clickByUid/fillByUid/pressKey 被拒
 * - requestModeUpgrade 升级后动作可用
 * - 过期自动回退 normal_restricted
 * - 降级回 normal_restricted 清理 grant context
 * - respondBoundaryChoice 对不存在会话返回 false
 *
 * mock 策略沿用 agent-browser-service.test.ts 的 FakeWindow/FakeWebContents 模式。
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AgentBrowserService } from '../src/engine/service';

class FakeDebugger extends EventEmitter {
  readonly attach = vi.fn(async (_version: string) => undefined);
  readonly detach = vi.fn(async () => undefined);
  readonly sendCommand = vi.fn(async (method: string, _params?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [
          {
            nodeId: 'root',
            backendDOMNodeId: 1,
            role: { value: 'RootWebArea' },
            name: { value: 'Test Page' },
            childIds: ['btn'],
          },
          {
            nodeId: 'btn',
            backendDOMNodeId: 2,
            role: { value: 'button' },
            name: { value: 'Submit' },
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
  static nextId = 1;
  setWebRTCIPHandlingPolicy() {}
  url = '';
  title = '';
  readonly debugger = new FakeDebugger();
  readonly id = FakeWebContents.nextId++;

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  async executeJavaScript() {
    return true;
  }

  async capturePage() {
    return { toDataURL: () => 'data:image/png;base64,abc' };
  }
}

class FakeWindow {
  readonly webContents = new FakeWebContents();
  closed = false;
  shown = false;

  async loadURL(url: string) {
    this.webContents.url = url;
    this.webContents.title = 'Loaded page';
    queueMicrotask(() => {
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
    });
  }

  close() {
    this.closed = true;
  }

  destroy() {
    this.closed = true;
    this.webContents.emit('destroyed');
  }

  isDestroyed() {
    return this.closed;
  }

  show() {
    this.shown = true;
  }

  hide() { this.shown = false; }
  isVisible() { return this.shown; }
  isMinimized() { return false; }
  restore() {}
  focus() {}

  setBounds() {}
}

function createService(): { service: AgentBrowserService; windows: FakeWindow[] } {
  const windows: FakeWindow[] = [];
  const service = new AgentBrowserService({
    createWindow: () => {
      const win = new FakeWindow();
      windows.push(win);
      return win as never;
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { service, windows };
}

describe('agent browser runtime mode', () => {
  it('binds full access to the approved origin and requires reapproval after leaving it', async () => {
    const { service, windows } = createService();
    const { session } = await service.open({ url: 'https://approved.example/a', mode: 'headless' });
    service.setEnabled(true);
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      await service.navigate({ sessionId: session.id, url: 'https://approved.example/b' });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBeUndefined();
      await service.navigate({ sessionId: session.id, url: 'https://other.example/' });
      const before = windows[0].webContents.debugger.sendCommand.mock.calls.length;
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
      expect(windows[0].webContents.debugger.sendCommand.mock.calls).toHaveLength(before);
      await service.navigate({ sessionId: session.id, url: 'https://approved.example/a' });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBeUndefined();
    } finally { await service.close(session.id); }
  });

  it('does not transfer approval to a new tab, back to the old tab, or after closing an approved tab', async () => {
    const { service } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless' });
    service.setEnabled(true);
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      const pages = await service.newPage({ sessionId: session.id, url: 'https://approved.example/second' });
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
      await service.selectPage({ sessionId: session.id, pageId: '0' });
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
      await service.selectPage({ sessionId: session.id, pageId: pages.activePageId! });
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBeUndefined();
      await service.closePage({ sessionId: session.id, pageId: pages.activePageId! });
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
    } finally { await service.close(session.id); }
  });

  it('does not mint full access from the open payload or debugger reattachment', async () => {
    const { service } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless', runtimeMode: 'full_access' });
    service.setEnabled(true);
    try {
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      service.setEnabled(false);
      service.setEnabled(true);
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBeUndefined();
      await service.navigate({ sessionId: session.id, url: 'https://other.example/' });
      service.setEnabled(false);
      service.setEnabled(true);
      await service.takeSnapshot({ sessionId: session.id });
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
    } finally { await service.close(session.id); }
  });

  it('revokes the origin binding on browser-driven navigation before the next service call', async () => {
    const { service, windows } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless' });
    service.setEnabled(true);
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      windows[0].webContents.emit('did-start-navigation', {}, 'https://other.example/', false, true);
      expect((await service.fullAccessReadStorage({ sessionId: session.id })).isError).toBe(true);
    } finally { await service.close(session.id); }
  });

  it('uses the same approval binding for unredacted network data', async () => {
    const { service, windows } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless' });
    service.setEnabled(true);
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      windows[0].webContents.debugger.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'private-request', request: { url: 'https://approved.example/api?token=fixture-secret', method: 'GET', headers: { Authorization: 'Bearer fixture-secret' } },
      });
      const approved = await service.networkGetRequestDetails({ sessionId: session.id, requestIds: ['private-request'], redacted: false });
      expect(JSON.stringify(approved)).toContain('fixture-secret');
      await service.navigate({ sessionId: session.id, url: 'https://other.example/' });
      const denied = await service.networkGetRequestDetails({ sessionId: session.id, requestIds: ['private-request'], redacted: false });
      expect(JSON.stringify(denied)).not.toContain('fixture-secret');
    } finally { await service.close(session.id); }
  });

  it('redacts a pending network wait when another origin supplies the matching request', async () => {
    const { service, windows } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless' });
    service.setEnabled(true);
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      const waiting = service.networkWaitForRequests({ sessionId: session.id, redacted: false, filter: { urlIncludes: '/pending', timeoutMs: 500 } });
      await service.navigate({ sessionId: session.id, url: 'https://other.example/' });
      windows[0].webContents.debugger.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'pending-request', request: { url: 'https://other.example/pending?token=pending-fixture-secret', method: 'GET', headers: { Authorization: 'Bearer pending-fixture-secret' } },
      });
      const result = await waiting;
      expect(result.requests).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('pending-fixture-secret');
    } finally {
      await service.close(session.id);
    }
  });

  it.each(['networkGetRequestDetails', 'fullAccessGetNetworkDetails'] as const)('keeps %s bound to the original approval while its body read is pending', async (method) => {
    const { service, windows } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless' });
    service.setEnabled(true);
    let releaseBody: ((body: unknown) => void) | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      await service.takeSnapshot({ sessionId: session.id });
      const debuggerApi = windows[0].webContents.debugger;
      debuggerApi.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'pending-body', request: { url: 'https://approved.example/body', method: 'GET', headers: { Authorization: 'Bearer pending-fixture-secret' } },
      });
      debuggerApi.sendCommand.mockImplementationOnce(() => new Promise(resolve => { releaseBody = resolve; }));
      pending = service[method]({ sessionId: session.id, requestIds: ['pending-body'], redacted: false });
      await vi.waitFor(() => expect(releaseBody).toBeTypeOf('function'));
      await service.navigate({ sessionId: session.id, url: 'https://other.example/' });
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      releaseBody!({ body: '{"token":"pending-fixture-secret"}' });
      const result = await pending;
      expect(JSON.stringify(result)).not.toContain('pending-fixture-secret');
      if (method === 'fullAccessGetNetworkDetails') expect(result).toMatchObject({ isError: true });
    } finally {
      releaseBody?.({ body: '' });
      await pending;
      await service.close(session.id);
    }
  });

  it.each(['navigation', 'renewal', 'revocation', 'expiry', 'disable', 'reattachment', 'debugger-detach'] as const)('withholds a pending storage result after approval %s', async (change) => {
    const { service, windows } = createService();
    const { session } = await service.open({ url: 'https://approved.example/', mode: 'headless' });
    service.setEnabled(true);
    let releaseValue: ((value: unknown) => void) | undefined;
    let pending: Promise<unknown> | undefined;
    let restoreClock: (() => void) | undefined;
    try {
      await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true, expiresInMs: 10_000 });
      await service.takeSnapshot({ sessionId: session.id });
      windows[0].webContents.debugger.sendCommand.mockImplementationOnce(() => new Promise(resolve => { releaseValue = resolve; }));
      pending = service.fullAccessReadStorage({ sessionId: session.id });
      await vi.waitFor(() => expect(releaseValue).toBeTypeOf('function'));
      if (change === 'navigation') await service.navigate({ sessionId: session.id, url: 'https://other.example/' });
      if (change === 'renewal') await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'full_access', userApproval: true });
      if (change === 'revocation') await service.requestModeUpgrade({ sessionId: session.id, targetMode: 'normal_restricted', userApproval: true });
      if (change === 'expiry') {
        const now = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
        restoreClock = () => clock.mockRestore();
      }
      if (change === 'disable' || change === 'reattachment') service.setEnabled(false);
      if (change === 'reattachment') {
        service.setEnabled(true);
        await service.takeSnapshot({ sessionId: session.id });
      }
      if (change === 'debugger-detach') {
        windows[0].webContents.debugger.emit('detach', {}, 'canceled_by_user');
        await service.takeSnapshot({ sessionId: session.id });
      }
      releaseValue!({ result: { value: { token: 'pending-fixture-secret' } } });
      const result = await pending;
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).not.toContain('pending-fixture-secret');
    } finally {
      releaseValue?.({ result: { value: {} } });
      await pending;
      restoreClock?.();
      await service.close(session.id);
    }
  });

  it('open 默认 normal_restricted 模式', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test' });
    expect(opened.session.runtimeMode).toBe('normal_restricted');
  });

  it('normal_restricted 下 takeSnapshot/clickByUid/fillByUid/pressKey 被拒', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless' });
    const sessionId = opened.session.id;
    service.setEnabled(true);

    await expect(service.takeSnapshot({ sessionId })).rejects.toThrow('runtime mode upgrade');
    await expect(service.clickByUid({ sessionId, uid: '1_2' })).rejects.toThrow('runtime mode upgrade');
    await expect(service.fillByUid({ sessionId, uid: '1_2', value: 'x' })).rejects.toThrow('runtime mode upgrade');
    await expect(service.pressKey({ sessionId, key: 'Enter' })).rejects.toThrow('runtime mode upgrade');

    await service.close(sessionId);
  });

  it('requestModeUpgrade 升级到 controlled_enhanced 后动作可用', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless' });
    const sessionId = opened.session.id;
    service.setEnabled(true);

    const upgraded = await service.requestModeUpgrade({
      sessionId,
      targetMode: 'controlled_enhanced',
      reason: 'test',
      userApproval: true,
    });
    expect(upgraded.runtimeMode).toBe('controlled_enhanced');
    expect(upgraded.session.runtimeMode).toBe('controlled_enhanced');

    // takeSnapshot 现在应该可用
    const snap = await service.takeSnapshot({ sessionId });
    expect(snap.snapshot).toContain('uid=');

    // clickByUid 也应该可用
    await expect(service.clickByUid({ sessionId, uid: '1_2' })).resolves.toMatchObject({ id: sessionId });

    await service.close(sessionId);
  });

  it('requestModeUpgrade 升级到 full_access 后动作可用', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless' });
    const sessionId = opened.session.id;
    service.setEnabled(true);

    await service.requestModeUpgrade({
      sessionId,
      targetMode: 'full_access',
      userApproval: true,
    });

    const snap = await service.takeSnapshot({ sessionId });
    expect(snap.snapshot).toContain('uid=');

    await service.close(sessionId);
  });

  it('requestModeUpgrade 带 expiresInMs 过期后自动回退 normal_restricted', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless' });
    const sessionId = opened.session.id;
    service.setEnabled(true);

    // 在升级前启用 fake timers，确保 requestModeUpgrade 内的 Date.now() 也用 fake 时间
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      // 升级，过期时间设为 10 秒（被 clamp 到最小 10000ms）
      await service.requestModeUpgrade({
        sessionId,
        targetMode: 'controlled_enhanced',
        expiresInMs: 10_000,
        userApproval: true,
      });

      // 时间推进 30 秒，超过 10 秒过期时间
      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));

      // 此时已过期，takeSnapshot 应该再次被拒
      await expect(service.takeSnapshot({ sessionId })).rejects.toThrow('runtime mode upgrade');
    } finally {
      vi.useRealTimers();
    }

    await service.close(sessionId);
  });

  it('降级回 normal_restricted 清理过期时间', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless' });
    const sessionId = opened.session.id;
    service.setEnabled(true);

    await service.requestModeUpgrade({
      sessionId,
      targetMode: 'controlled_enhanced',
      expiresInMs: 60_000,
      userApproval: true,
    });

    // 降级
    const downgraded = await service.requestModeUpgrade({
      sessionId,
      targetMode: 'normal_restricted',
    });
    expect(downgraded.runtimeMode).toBe('normal_restricted');

    // 降级后动作再次被拒
    await expect(service.takeSnapshot({ sessionId })).rejects.toThrow('runtime mode upgrade');

    await service.close(sessionId);
  });

  it('respondBoundaryChoice 对不存在会话返回 false', () => {
    const { service } = createService();
    const accepted = service.respondBoundaryChoice('non-existent', 'req-1', { selectedChoiceIds: [] });
    expect(accepted).toBe(false);
  });

  it('setBoundaryChoiceNotifier 注册回调可被调用', async () => {
    const { service } = createService();
    let notified = false;
    service.setBoundaryChoiceNotifier(() => {
      notified = true;
    });

    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless', runtimeMode: 'controlled_enhanced' });
    const sessionId = opened.session.id;

    // getBrowserControl 会创建 boundaryExecutor，但只有调用 execute 才会触发 notify
    // 这里只验证 setBoundaryChoiceNotifier 不抛错
    expect(notified).toBe(false);

    // 清理 notifier
    service.setBoundaryChoiceNotifier(undefined);
    await service.close(sessionId);
  });

  it('open 时指定 runtimeMode=controlled_enhanced 生效', async () => {
    const { service } = createService();
    const opened = await service.open({
      url: 'example.com',
      profile: 'Test',
      mode: 'headless',
      runtimeMode: 'controlled_enhanced',
    });
    expect(opened.session.runtimeMode).toBe('controlled_enhanced');
    service.setEnabled(true);

    // 直接 takeSnapshot 可用，无需再 requestModeUpgrade
    const snap = await service.takeSnapshot({ sessionId: opened.session.id });
    expect(snap.snapshot).toContain('uid=');

    await service.close(opened.session.id);
  });

  it('requestModeUpgrade without userApproval is rejected (approval gate)', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Test', mode: 'headless' });
    const sessionId = opened.session.id;
    service.setEnabled(true);
    await expect(service.requestModeUpgrade({
      sessionId,
      targetMode: 'controlled_enhanced',
    })).rejects.toThrow('userApproval');
    // downgrade does not require approval
    await expect(service.requestModeUpgrade({
      sessionId,
      targetMode: 'normal_restricted',
    })).resolves.toMatchObject({ runtimeMode: 'normal_restricted' });
    await service.close(sessionId);
  });

});
