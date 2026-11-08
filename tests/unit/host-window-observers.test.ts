// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { made, options, failure } = vi.hoisted(() => ({ made: [] as Array<unknown>, options: [] as BrowserWindowConstructorOptions[], failure: { load: false } }));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return { ipcMain: {}, BrowserWindow: class {
    id = options.length + 10;
    dead = false;
    webContents: EventEmitter & { id: number; url: string; session: unknown; getURL: () => string; isDestroyed: () => boolean };
    constructor(settings: BrowserWindowConstructorOptions) {
      options.push(settings); made.push(this);
      this.webContents = Object.assign(new Emitter(), { id: this.id, url: '', session: settings.webPreferences?.session,
        getURL: () => this.webContents.url, isDestroyed: () => this.dead });
    }
    isDestroyed() { return this.dead; }
    async loadURL(url: string) { if (failure.load) throw new Error('load failed'); this.webContents.url = url; }
    destroy() { this.dead = true; this.webContents.emit('destroyed'); }
  } };
});
import { initializeHostWindowAuthorization, createHostReadObserverWindow } from '../../electron/main/ipc/host-window-observers';
import { assertAuthorizedHostSender } from '../../electron/main/ipc/host-invoke-security';
import { createHostInvokeDispatcher } from '../../electron/main/ipc/host-invoke';
const primary = { isDestroyed: () => false,
  webContents: Object.assign(new EventEmitter(), { id: 1, session: {}, getURL: () => 'file:///app/index.html?bootTheme=light' }) };
beforeEach(() => { made.length = 0; options.length = 0; failure.load = false;
  initializeHostWindowAuthorization(primary as unknown as BrowserWindow, '/app/preload.js'); });
describe('Main-owned read observer windows', () => {
  it('constructs the owned entry and preload with an explicit read-only action list', async () => {
    const auth = initializeHostWindowAuthorization(primary as unknown as BrowserWindow, '/app/preload.js');
    expect(assertAuthorizedHostSender({ sender: { id: 999 } }, auth)).not.toBeNull();
    const child = await createHostReadObserverWindow();
    expect(options[0].webPreferences).toMatchObject({ preload: '/app/preload.js', session: primary.webContents.session, nodeIntegration: false, contextIsolation: true });
    const event = { sender: child.webContents, senderFrame: { url: child.webContents.getURL() } };
    const status = vi.fn(async () => ({ clean: true })), stage = vi.fn();
    const dispatch = createHostInvokeDispatcher({ git: { status, stage } } as never, { senderAuth: auth });
    await expect(dispatch({ id: 'read', module: 'git', action: 'status' }, event)).resolves.toMatchObject({ ok: true });
    await expect(dispatch({ id: 'write', module: 'git', action: 'stage', payload: { paths: ['a'] } }, event)).resolves.toMatchObject({ ok: false });
    expect(stage).not.toHaveBeenCalled(); child.destroy();
    expect(auth.allowedWebContentsIds.has(child.webContents.id)).toBe(false); expect(auth.observerConstraints?.size).toBe(0);
    expect(auth.allowedWebContentsIds.has(1)).toBe(true);
  });
  it('checks the exact app entry on each request and revokes observers with their primary owner', async () => {
    const auth = initializeHostWindowAuthorization(primary as unknown as BrowserWindow, '/app/preload.js'); const child = await createHostReadObserverWindow();
    for (const url of ['https://example.test/', 'file:///app/index.html.evil', 'about:blank']) {
      expect(assertAuthorizedHostSender({ sender: child.webContents, senderFrame: { url } }, auth)).not.toBeNull();
    }
    expect(assertAuthorizedHostSender({ sender: child.webContents, senderFrame: { url: 'file:///app/index.html?view=read#/' } }, auth)).toBeNull();
    primary.webContents.emit('destroyed'); expect(auth.allowedWebContentsIds.size).toBe(0);
    expect(child.webContents.listenerCount('destroyed')).toBe(0); child.destroy();
  });
  it('releases authorization and the window when navigation fails during creation', async () => {
    const auth = initializeHostWindowAuthorization(primary as unknown as BrowserWindow, '/app/preload.js');
    failure.load = true; await expect(createHostReadObserverWindow()).rejects.toThrow('load failed');
    expect(auth.allowedWebContentsIds.size).toBe(1); expect(auth.observerConstraints?.size).toBe(0);
    expect((made[0] as BrowserWindow).isDestroyed()).toBe(true);
  });
});
