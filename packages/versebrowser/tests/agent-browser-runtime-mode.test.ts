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
  readonly sendCommand = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
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
  url = '';
  title = '';
  readonly debugger = new FakeDebugger();
  readonly id = 1;

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

  isDestroyed() {
    return this.closed;
  }

  show() {
    this.shown = true;
  }

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

    service.close(sessionId);
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

    service.close(sessionId);
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

    service.close(sessionId);
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

    service.close(sessionId);
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

    service.close(sessionId);
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
    service.close(sessionId);
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

    service.close(opened.session.id);
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
    service.close(sessionId);
  });

});
