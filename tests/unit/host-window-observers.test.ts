// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeHostWindowAuthorization, registerHostReadObserver } from '../../electron/main/ipc/host-window-observers';
import { assertAuthorizedHostSender } from '../../electron/main/ipc/host-invoke-security';
import { createHostInvokeDispatcher } from '../../electron/main/ipc/host-invoke';
vi.mock('electron', () => ({ ipcMain: {} }));
const session = {};
function window(id: number, url = 'file:///app/index.html?bootTheme=light') {
  const contents = Object.assign(new EventEmitter(), { id, session, url,
    getURL: () => contents.url, isDestroyed: () => false,
    getLastWebPreferences: () => ({ preload: '/app/preload.js', contextIsolation: true, nodeIntegration: false }) });
  return { isDestroyed: () => false, webContents: contents };
}
const primary = window(1);
beforeEach(() => initializeHostWindowAuthorization(primary as unknown as BrowserWindow));
describe('Main-owned read observer windows', () => {
  it('permits only explicit read actions and revokes the handle on destruction', async () => {
    const auth = initializeHostWindowAuthorization(primary as unknown as BrowserWindow);
    const child = window(2); const event = { sender: child.webContents, senderFrame: { url: child.webContents.url } };
    expect(assertAuthorizedHostSender(event, auth)).not.toBeNull();
    const release = registerHostReadObserver(child as unknown as BrowserWindow);
    expect(registerHostReadObserver(child as unknown as BrowserWindow)).toBe(release);
    const status = vi.fn(async () => ({ clean: true })), stage = vi.fn();
    const dispatch = createHostInvokeDispatcher({ git: { status, stage } } as never, { senderAuth: auth });
    await expect(dispatch({ id: 'read', module: 'git', action: 'status' }, event)).resolves.toMatchObject({ ok: true });
    await expect(dispatch({ id: 'write', module: 'git', action: 'stage', payload: { paths: ['a'] } }, event)).resolves.toMatchObject({ ok: false });
    expect(stage).not.toHaveBeenCalled(); child.webContents.emit('destroyed');
    expect(auth.allowedWebContentsIds.has(2)).toBe(false); expect(auth.observerConstraints?.has(2)).toBe(false);
    release(); expect(auth.allowedWebContentsIds.has(1)).toBe(true);
  });
  it('rejects remote pages, foreign preload or partition, and unsafe renderer preferences', () => {
    for (const kind of ['url','preload','session','integration']) {
      const child = window(2);
      if (kind === 'url') child.webContents.url = 'https://example.test/';
      if (kind === 'session') child.webContents.session = {};
      if (kind === 'preload') child.webContents.getLastWebPreferences = () => ({ preload: '/other.js', contextIsolation: true, nodeIntegration: false });
      if (kind === 'integration') child.webContents.getLastWebPreferences = () => ({ preload: '/app/preload.js', contextIsolation: true, nodeIntegration: true });
      expect(() => registerHostReadObserver(child as unknown as BrowserWindow)).toThrow('owned app entry');
    }
  });
  it('checks the exact entry on every request and revokes observers with their primary owner', () => {
    const auth = initializeHostWindowAuthorization(primary as unknown as BrowserWindow); const child = window(2);
    registerHostReadObserver(child as unknown as BrowserWindow);
    expect(assertAuthorizedHostSender({ sender: child.webContents, senderFrame: { url: 'file:///app/index.html.evil' } }, auth)).not.toBeNull();
    expect(assertAuthorizedHostSender({ sender: child.webContents, senderFrame: { url: 'file:///app/index.html?view=read#/' } }, auth)).toBeNull();
    primary.webContents.emit('destroyed'); expect(auth.allowedWebContentsIds.size).toBe(0);
    expect(child.webContents.listenerCount('destroyed')).toBe(0);
  });
});
