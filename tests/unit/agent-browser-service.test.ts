import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserService } from '@electron/services/agent-browser-service';
import { createAgentBrowserApi } from '@electron/services/agent-browser-api';

vi.mock('@electron/services/sensitive-capture-gate', () => ({
  assertSensitiveCaptureAllowed: vi.fn(async (channel: string) => ({
    allowed: true,
    code: 'allow',
    reason: 'test-allow',
    channel,
  })),
}));


/**
 * 模拟 Electron webContents.debugger。
 *
 * - attach(version) / detach() / sendCommand(method, params) 均为 vitest mock，
 *   默认 sendCommand 返回 Accessibility.getFullAXTree 的最小 fixture。
 * - on('detach' | 'message', ...) 走 EventEmitter，测试可手动 emit。
 */
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

type FakeBeforeRequestDetails = {
  url: string;
  webContentsId?: number;
  resourceType: string;
};

class FakeWebRequest {
  private listener?: (details: FakeBeforeRequestDetails, callback: (result: { cancel?: boolean }) => void) => void;

  onBeforeRequest(listener: (details: FakeBeforeRequestDetails, callback: (result: { cancel?: boolean }) => void) => void) {
    this.listener = listener;
  }

  async request(url: string, resourceType: string, webContentsId?: number): Promise<{ cancel?: boolean }> {
    if (!this.listener) return { cancel: false };
    return await new Promise((resolve) => this.listener?.({ url, resourceType, webContentsId }, resolve));
  }
}

class FakeSession {
  readonly webRequest = new FakeWebRequest();
  resolvedEndpoints = [{ address: '93.184.216.34', family: 'ipv4' as const }];
  readonly resolveHost = vi.fn(async () => ({ endpoints: this.resolvedEndpoints }));
}

class FakeWebContents extends EventEmitter {
  readonly id = 41;
  readonly session = new FakeSession();
  url = '';
  title = '';
  scripts: string[] = [];
  readonly debugger = new FakeDebugger();
  private windowOpenHandler?: (details: { url: string }) => { action: 'allow' | 'deny' };

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }) {
    this.windowOpenHandler = handler;
  }

  openPopup(url: string): { action: 'allow' | 'deny' } {
    return this.windowOpenHandler?.({ url }) ?? { action: 'allow' };
  }

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  async executeJavaScript(script: string) {
    this.scripts.push(script);
    if (script.includes('document.body')) return 'sample text';
    if (script.includes('document.querySelector(selector)')) return true;
    if (script.includes('eval(')) return { ok: true };
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
    const decision = await this.webContents.session.webRequest.request(url, 'mainFrame', this.webContents.id);
    if (decision.cancel) throw new Error('ERR_BLOCKED_BY_CLIENT');
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

describe('agent browser service', () => {
  it('applies supervised request guards to navigation redirects and subresources', async () => {
    const window = new FakeWindow();
    const service = new AgentBrowserService({ createWindow: () => window as never });
    const guard = vi.fn(async (url: string, options: {
      enforceApprovedDomains: boolean;
      lookupAddresses?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
    }) => {
      const hostname = new URL(url).hostname;
      if (hostname === '127.0.0.1') {
        throw Object.assign(new Error('private network denied'), { code: 'PRIVATE_NETWORK_DENIED' });
      }
      const addresses = await options.lookupAddresses?.(hostname);
      if (addresses?.some(({ address }) => address === '10.0.0.8')) {
        throw Object.assign(new Error('private network denied'), { code: 'PRIVATE_NETWORK_DENIED' });
      }
      if (options.enforceApprovedDomains && hostname !== 'example.com') {
        throw Object.assign(new Error('domain not approved'), { code: 'DOMAIN_NOT_APPROVED' });
      }
    });

    const opened = await service.openSupervised({ url: 'https://example.com', mode: 'headless' }, guard);
    expect(opened.session.url).toBe('https://example.com/');
    expect(guard).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ enforceApprovedDomains: true }),
    );

    await expect(window.webContents.session.webRequest.request(
      'https://other.example.net/redirect',
      'mainFrame',
      window.webContents.id,
    )).resolves.toEqual({ cancel: true });
    expect(() => service.assertSupervisedRequestSafe(opened.session.id)).toThrow('domain not approved');

    const secondWindow = new FakeWindow();
    const secondService = new AgentBrowserService({ createWindow: () => secondWindow as never });
    const second = await secondService.openSupervised({ url: 'https://example.com', mode: 'headless' }, guard);
    await expect(secondWindow.webContents.session.webRequest.request(
      'http://127.0.0.1/metadata',
      'xhr',
      secondWindow.webContents.id,
    )).resolves.toEqual({ cancel: true });
    expect(() => secondService.assertSupervisedRequestSafe(second.session.id)).toThrow('private network denied');
    expect(guard).toHaveBeenLastCalledWith(
      'http://127.0.0.1/metadata',
      expect.objectContaining({ enforceApprovedDomains: false }),
    );

    const reboundWindow = new FakeWindow();
    const reboundService = new AgentBrowserService({ createWindow: () => reboundWindow as never });
    const rebound = await reboundService.openSupervised({ url: 'https://example.com', mode: 'headless' }, guard);
    reboundWindow.webContents.session.resolvedEndpoints = [{ address: '10.0.0.8', family: 'ipv4' }];
    await expect(reboundWindow.webContents.session.webRequest.request(
      'https://cdn.example.net/app.js',
      'script',
      reboundWindow.webContents.id,
    )).resolves.toEqual({ cancel: true });
    expect(() => reboundService.assertSupervisedRequestSafe(rebound.session.id)).toThrow('private network denied');
    expect(reboundWindow.webContents.session.resolveHost).toHaveBeenCalledWith('cdn.example.net');

    const workerWindow = new FakeWindow();
    const workerService = new AgentBrowserService({ createWindow: () => workerWindow as never });
    const worker = await workerService.openSupervised({ url: 'https://example.com', mode: 'headless' }, guard);
    await expect(workerWindow.webContents.session.webRequest.request(
      'http://127.0.0.1/service-worker-fetch',
      'xhr',
    )).resolves.toEqual({ cancel: true });
    expect(() => workerService.assertSupervisedRequestSafe(worker.session.id)).toThrow('private network denied');

    const popupWindow = new FakeWindow();
    const popupService = new AgentBrowserService({ createWindow: () => popupWindow as never });
    const popupSession = await popupService.openSupervised({ url: 'https://example.com', mode: 'headless' }, guard);
    const sensitivePopupUrl = 'https://example.com/popup?token=must-not-persist';
    expect(popupWindow.webContents.openPopup(sensitivePopupUrl)).toEqual({ action: 'deny' });
    let popupError: unknown;
    try {
      popupService.assertSupervisedRequestSafe(popupSession.session.id);
    } catch (error) {
      popupError = error;
    }
    expect(popupError).toMatchObject({
      code: 'POPUP_NAVIGATION_DENIED',
      message: 'Supervised browser task popup navigation is denied',
    });
    expect(String(popupError)).not.toContain(sensitivePopupUrl);
  });

  it('prefers the bundled agent-browser CLI runner when available', async () => {
    const createWindow = vi.fn(() => {
      throw new Error('BrowserWindow fallback should not be used');
    });
    const runner = {
      isAvailable: vi.fn(() => true),
      open: vi.fn(async () => ({ url: 'https://example.com/', title: 'CLI page' })),
      navigate: vi.fn(async () => ({ url: 'https://vercel.com/', title: 'Vercel' })),
      waitForSelector: vi.fn(async () => ({ title: 'Ready' })),
      click: vi.fn(async () => ({ title: 'Clicked' })),
      type: vi.fn(async () => ({ title: 'Typed' })),
      evaluate: vi.fn(async () => ({ session: { title: 'Evaluated' }, value: 42 })),
      screenshot: vi.fn(async () => ({ session: { title: 'Shot' }, dataUrl: 'data:image/png;base64,cli' })),
      command: vi.fn(async () => ({
        session: { title: 'Snapshot' },
        data: { tree: [] },
        stdout: '{"success":true,"data":{"tree":[]}}',
        stderr: '',
        command: ['--json', 'snapshot'],
      })),
      textSample: vi.fn(async () => 'cli text'),
      close: vi.fn(async () => undefined),
    };
    const service = new AgentBrowserService({
      cliRunner: runner,
      createWindow: createWindow as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({
      url: 'example.com',
      profile: 'Work',
      workspaceId: 'workspace-demo',
      sessionKey: 'agent:main:main',
      agentId: 'main',
    });

    expect(createWindow).not.toHaveBeenCalled();
    expect(runner.open).toHaveBeenCalledWith({
      session: expect.objectContaining({
        id: opened.session.id,
        profile: 'work',
        authPersistence: 'session-name',
        authStateName: 'work',
        connection: { mode: 'managed' },
        workspaceId: 'workspace-demo',
        sessionKey: 'agent:main:main',
        agentId: 'main',
      }),
      url: 'https://example.com/',
      width: 1280,
      height: 900,
    });
    expect(opened).toMatchObject({
      session: {
        profile: 'work',
        mode: 'headless',
        authPersistence: 'session-name',
        authStateName: 'work',
        connection: { mode: 'managed' },
        url: 'https://example.com/',
        title: 'CLI page',
        workspaceId: 'workspace-demo',
        sessionKey: 'agent:main:main',
        agentId: 'main',
      },
      textSample: 'cli text',
    });

    await expect(service.navigate({ sessionId: opened.session.id, url: 'vercel.com' }))
      .resolves.toMatchObject({ title: 'Vercel' });
    await expect(service.click({ sessionId: opened.session.id, selector: '#submit' }))
      .resolves.toMatchObject({ title: 'Clicked' });
    await expect(service.type({ sessionId: opened.session.id, selector: '#name', text: 'Ada', clear: false }))
      .resolves.toMatchObject({ title: 'Typed' });
    await expect(service.evaluate({ sessionId: opened.session.id, expression: '21 * 2' }))
      .resolves.toMatchObject({ session: { title: 'Evaluated' }, value: 42 });
    await expect(service.screenshot({ sessionId: opened.session.id }))
      .resolves.toMatchObject({ dataUrl: 'data:image/png;base64,cli', format: 'png' });
    await expect(service.command({ sessionId: opened.session.id, args: ['snapshot', '-i'] }))
      .resolves.toMatchObject({
        session: { title: 'Snapshot' },
        data: { tree: [] },
        command: ['--json', 'snapshot'],
      });
    expect(runner.command).toHaveBeenCalledWith({
      session: expect.objectContaining({
        id: opened.session.id,
        authPersistence: 'session-name',
        authStateName: 'work',
      }),
      args: ['snapshot', '-i'],
      globalOptions: undefined,
      timeoutMs: undefined,
      maxOutput: undefined,
    });
    await expect(service.command({ sessionId: opened.session.id, args: ['snapshot', '--session', 'other'] }))
      .rejects.toThrow('managed CLI flag');
    await expect(service.command({ sessionId: opened.session.id, args: ['snapshot'], globalOptions: ['--auto-connect'] }))
      .rejects.toThrow('managed CLI flag');
    await expect(service.command({ args: ['snapshot'], connectionMode: 'auto-connect' }))
      .rejects.toThrow('allowExternalBrowser=true');
    await expect(service.command({ args: ['profiles'], profile: 'Work', mode: 'visible' }))
      .resolves.toMatchObject({
        session: {
          profile: 'work',
          mode: 'visible',
          authPersistence: 'session-name',
          authStateName: 'work',
          connection: { mode: 'managed' },
        },
      });
    expect(runner.command).toHaveBeenLastCalledWith({
      session: expect.objectContaining({
        profile: 'work',
        mode: 'visible',
        authPersistence: 'session-name',
        authStateName: 'work',
      }),
      args: ['profiles'],
      globalOptions: undefined,
      timeoutMs: undefined,
      maxOutput: undefined,
    });
    await expect(service.command({
      args: ['snapshot'],
      profile: 'Mail',
      authStateName: 'gmail-account',
      connectionMode: 'auto-connect',
      allowExternalBrowser: true,
    })).resolves.toMatchObject({
      session: {
        profile: 'mail',
        authStateName: 'gmail-account',
        connection: { mode: 'auto-connect' },
      },
    });
    expect(runner.command).toHaveBeenLastCalledWith({
      session: expect.objectContaining({
        profile: 'mail',
        authStateName: 'gmail-account',
        connection: { mode: 'auto-connect' },
      }),
      args: ['snapshot'],
      globalOptions: undefined,
      timeoutMs: undefined,
      maxOutput: undefined,
    });

    service.close(opened.session.id);
    expect(runner.close).toHaveBeenCalledWith(expect.objectContaining({ id: opened.session.id }));
  });

  it('preserves the creation-time external connection when CLI metadata claims managed', async () => {
    const runner = {
      isAvailable: vi.fn(() => true),
      open: vi.fn(async () => ({ connection: { mode: 'managed' as const } })),
      textSample: vi.fn(async () => undefined),
    };
    const service = new AgentBrowserService({
      cliRunner: runner as never,
      createWindow: vi.fn(() => { throw new Error('should not create window'); }) as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({
      connectionMode: 'auto-connect',
      allowExternalBrowser: true,
    });

    expect(opened.session.connection).toEqual({ mode: 'auto-connect' });
    expect(service.list()[0]?.connection).toEqual({ mode: 'auto-connect' });
  });

  it('drives a hidden BrowserWindow session', async () => {
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      createWindow: (options) => {
        expect(options.show).toBe(false);
        expect(options.webPreferences?.partition).toBe('persist:agent-browser-work');
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({
      url: 'example.com',
      profile: 'Work',
      mode: 'headless',
    });

    expect(opened.session).toMatchObject({
      profile: 'work',
      mode: 'headless',
      url: 'https://example.com/',
      title: 'Loaded page',
    });
    expect(opened.textSample).toBe('sample text');

    await expect(service.click({ sessionId: opened.session.id, selector: '#submit' }))
      .resolves.toMatchObject({ id: opened.session.id });
    await expect(service.type({ sessionId: opened.session.id, selector: '#name', text: 'Ada' }))
      .resolves.toMatchObject({ id: opened.session.id });
    await expect(service.evaluate({ sessionId: opened.session.id, expression: '({ ok: true })' }))
      .resolves.toMatchObject({ value: { ok: true } });
    await expect(service.screenshot({ sessionId: opened.session.id }))
      .resolves.toMatchObject({ dataUrl: 'data:image/png;base64,abc', format: 'png' });

    expect(service.list()).toHaveLength(1);
    service.close(opened.session.id);
    expect(windows[0].closed).toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it('drives browser-control CDP actions (takeSnapshot/clickByUid/fillByUid/pressKey)', async () => {
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      createWindow: () => {
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({ url: 'example.com', profile: 'Work', mode: 'headless', runtimeMode: 'controlled_enhanced' });
    const sessionId = opened.session.id;
    service.setEnabled(true);
    const dbg = windows[0].webContents.debugger;

    // takeSnapshot: 首次调用触发 attach + 启用域 + getFullAXTree
    const snap = await service.takeSnapshot({ sessionId });
    expect(snap.snapshot).toContain('uid=');
    expect(snap.snapshot).toContain('button');
    expect(snap.snapshot).toContain('Submit');
    expect(dbg.attach).toHaveBeenCalledTimes(1);
    expect(dbg.sendCommand).toHaveBeenCalledWith('Accessibility.getFullAXTree', expect.anything());

    // 从快照中提取 button 的 uid
    const uidMatch = snap.snapshot.match(/uid=(\d+_\d+)/);
    expect(uidMatch).not.toBeNull();
    const buttonUid = uidMatch![1];

    // clickByUid: 走 DOM.resolveNode + getBoxModel + callFunctionOn + dispatchMouseEvent
    await expect(service.clickByUid({ sessionId, uid: buttonUid })).resolves.toMatchObject({ id: sessionId });
    expect(dbg.sendCommand).toHaveBeenCalledWith('DOM.resolveNode', { backendNodeId: expect.any(Number) });

    // fillByUid: 走 getElementInfo + fillTextInput
    await expect(service.fillByUid({ sessionId, uid: buttonUid, value: 'Ada' })).resolves.toMatchObject({ id: sessionId });

    // pressKey: 走 dispatchKeyEvent
    await expect(service.pressKey({ sessionId, key: 'Enter' })).resolves.toMatchObject({ id: sessionId });
    expect(dbg.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyDown' }),
    );

    // 错误 UID 应抛出
    await expect(service.clickByUid({ sessionId, uid: 'stale_uid' })).rejects.toThrow();

    // close 清理 debugger 连接
    service.close(sessionId);
    expect(dbg.detach).toHaveBeenCalled();
  });

  it('rejects browser-control actions on the agent-browser-cli engine', async () => {
    const runner = {
      isAvailable: vi.fn(() => true),
      open: vi.fn(async () => ({ url: 'https://example.com/', title: 'CLI page' })),
      navigate: vi.fn(async () => ({ url: 'https://example.com/', title: 'CLI page' })),
      waitForSelector: vi.fn(async () => ({ title: 'Ready' })),
      click: vi.fn(async () => ({ title: 'Clicked' })),
      type: vi.fn(async () => ({ title: 'Typed' })),
      evaluate: vi.fn(async () => ({ session: { title: 'Evaluated' }, value: 42 })),
      screenshot: vi.fn(async () => ({ session: { title: 'Shot' }, dataUrl: 'data:image/png;base64,cli' })),
      command: vi.fn(async () => ({
        session: { title: 'Snapshot' },
        data: { tree: [] },
        stdout: '{"success":true}',
        stderr: '',
        command: ['--json', 'snapshot'],
      })),
      textSample: vi.fn(async () => 'cli text'),
      close: vi.fn(async () => undefined),
    };
    const service = new AgentBrowserService({
      cliRunner: runner,
      createWindow: vi.fn(() => { throw new Error('should not create window'); }) as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({ url: 'example.com', profile: 'Work' });
    const sessionId = opened.session.id;
    service.setEnabled(true);

    await expect(service.takeSnapshot({ sessionId })).rejects.toThrow('browser-window engine');
    await expect(service.clickByUid({ sessionId, uid: '1_1' })).rejects.toThrow('browser-window engine');
    await expect(service.fillByUid({ sessionId, uid: '1_1', value: 'x' })).rejects.toThrow('browser-window engine');
    await expect(service.pressKey({ sessionId, key: 'Enter' })).rejects.toThrow('browser-window engine');
    service.close(sessionId);
  });

  it('lists and saves reusable browser profiles', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'agent-browser-profiles-'));
    try {
      await mkdir(join(userDataPath, 'agent-browser', 'profiles', 'work'), { recursive: true });
      const service = new AgentBrowserService({
        userDataPath,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(service.listProfiles()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ profile: 'default', authStateName: 'default' }),
        expect.objectContaining({ profile: 'work', source: 'profile-dir' }),
      ]));

      await expect(service.saveProfile({
        profile: 'Work Mail',
        label: 'Work Mail',
        description: 'Gmail login',
        authStateName: 'gmail-main',
      })).resolves.toMatchObject({
        profile: 'work-mail',
        label: 'Work Mail',
        description: 'Gmail login',
        authStateName: 'gmail-main',
        source: 'metadata',
      });

      await expect(service.listProfiles()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          profile: 'work-mail',
          label: 'Work Mail',
          authStateName: 'gmail-main',
        }),
      ]));
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('validates a browser task and cleans up the temporary session', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'agent-browser-validate-'));
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      userDataPath,
      createWindow: () => {
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    try {
      const result = await service.validate({
        url: 'https://example.com/check-in',
        expectedDomains: ['example.com'],
        diagnostics: { snapshot: true, screenshot: true },
      });

      expect(result).toMatchObject({
        success: true,
        ok: true,
        url: 'https://example.com/check-in',
        title: 'Loaded page',
        textSample: 'sample text',
        screenshotDataUrl: 'data:image/png;base64,abc',
        runResult: {
          schemaVersion: 1,
          status: 'success',
          finalUrl: 'https://example.com/check-in',
          loginState: 'unknown',
        },
      });
      expect(result.diagnostics).toHaveProperty('snapshot');
      expect(result.runResult?.steps.map((step) => step.id)).toEqual(expect.arrayContaining(['open', 'domain', 'snapshot', 'screenshot']));
      expect(result.runResult?.evidence.artifacts.map((artifact) => artifact.kind)).toEqual(expect.arrayContaining(['snapshot', 'screenshot']));
      const manifestPath = join(userDataPath, 'agent-browser', 'run-artifacts', result.runResult!.runId, 'manifest.json');
      await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"schemaVersion": 1');
      expect(windows[0].closed).toBe(true);
      expect(service.list()).toHaveLength(0);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('records a caller-provided canonical runId verbatim with a dir-safe artifact path', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'agent-browser-validate-runid-'));
    const service = new AgentBrowserService({
      userDataPath,
      createWindow: () => new FakeWindow() as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    try {
      const result = await service.validate({
        url: 'https://example.com/check-in',
        runId: 'cron:job-1:1720000000000',
        expectedDomains: ['example.com'],
        diagnostics: { snapshot: true },
      });

      expect(result.ok).toBe(true);
      // R5-1: logical runId is the caller's canonical id, not a freshly minted UUID.
      expect(result.runResult?.runId).toBe('cron:job-1:1720000000000');
      // The artifact directory uses a deterministic dir-safe projection (colons
      // are illegal in Windows path segments); manifest.json keeps the raw id.
      const manifestPath = join(userDataPath, 'agent-browser', 'run-artifacts', 'cron-job-1-1720000000000', 'manifest.json');
      await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"runId": "cron:job-1:1720000000000"');
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('rejects traversal-shaped external runIds instead of minting a new id', async () => {
    const service = new AgentBrowserService({
      createWindow: () => new FakeWindow() as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(service.validate({ url: 'https://example.com/', runId: '../escape' }))
      .rejects.toThrow(/runId is invalid/);
    await expect(service.validate({ url: 'https://example.com/', runId: 'a\\b' }))
      .rejects.toThrow(/runId is invalid/);
  });

  it('returns validation failures without keeping the session open', async () => {
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      createWindow: () => {
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.validate({
      url: 'https://evil.example/',
      expectedDomains: ['example.com'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('outside allowed domains');
    expect(windows[0].closed).toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it('exposes the service through the host api adapter', async () => {
    const service = {
      open: vi.fn(async () => ({ session: { id: 's1' }, textSample: 'ok' })),
      list: vi.fn(() => [{ id: 's1' }]),
      listProfiles: vi.fn(async () => [{ profile: 'default', source: 'metadata' }]),
      saveProfile: vi.fn(async () => ({ profile: 'work', source: 'metadata' })),
      validate: vi.fn(async () => ({ success: true, ok: true, title: 'Ready' })),
      navigate: vi.fn(async () => ({ id: 's1' })),
      waitForSelector: vi.fn(async () => ({ id: 's1' })),
      click: vi.fn(async () => ({ id: 's1' })),
      type: vi.fn(async () => ({ id: 's1' })),
      evaluate: vi.fn(async () => ({ session: { id: 's1' }, value: 1 })),
      screenshot: vi.fn(async () => ({ session: { id: 's1' }, dataUrl: 'data:image/png;base64,abc', format: 'png' as const })),
      command: vi.fn(async () => ({
        session: { id: 's1' },
        data: { ok: true },
        stdout: '{"success":true,"data":{"ok":true}}',
        stderr: '',
        command: ['--json', 'snapshot'],
      })),
      close: vi.fn(),
      isEnabled: vi.fn(() => true),
      setEnabled: vi.fn((enabled: boolean) => ({ enabled })),
    };

    const api = createAgentBrowserApi(service as never);

    await expect(api.open({ url: 'https://example.com' })).resolves.toMatchObject({
      success: true,
      session: { id: 's1' },
    });
    expect(api.status()).toMatchObject({ success: true, sessions: [{ id: 's1' }] });
    await expect(api.profiles()).resolves.toMatchObject({
      success: true,
      profiles: [{ profile: 'default' }],
    });
    await expect(api.saveProfile({ profile: 'Work' })).resolves.toMatchObject({
      success: true,
      profile: { profile: 'work' },
    });
    await expect(api.validate({ url: 'https://example.com' })).resolves.toMatchObject({
      success: true,
      ok: true,
      title: 'Ready',
    });
    await expect(api.evaluate({ sessionId: 's1', expression: '1' })).resolves.toMatchObject({
      success: true,
      value: 1,
    });
    await expect(api.command({ sessionId: 's1', args: ['snapshot'] })).resolves.toMatchObject({
      success: true,
      data: { ok: true },
    });
    expect(api.close({ sessionId: 's1' })).toEqual({ success: true });
    expect(service.command).toHaveBeenCalledWith({ sessionId: 's1', args: ['snapshot'] });
    expect(service.saveProfile).toHaveBeenCalledWith({ profile: 'Work' });
    expect(service.validate).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(service.close).toHaveBeenCalledWith('s1');
  });
});
