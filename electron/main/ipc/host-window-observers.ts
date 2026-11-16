import { BrowserWindow } from 'electron';
import { hostEntryUrl, type HostSenderAuthorization } from './host-invoke-security';

const allowedWebContentsIds = new Set<number>();
const observerConstraints = new Map<number, { entry: string; actions: ReadonlySet<string> }>();
const observers = new Map<number, () => void>();
let primary: BrowserWindow | undefined;
let detachPrimary: (() => void) | undefined;
let primaryPreload = '';

/** The normal primary window retains its existing Host privileges. */
export function initializeHostWindowAuthorization(window: BrowserWindow, preload: string): HostSenderAuthorization {
  detachPrimary?.();
  for (const close of [...observers.values()]) close();
  allowedWebContentsIds.clear(); primary = window; primaryPreload = preload;
  allowedWebContentsIds.add(window.webContents.id);
  const destroyed = () => {
    if (primary !== window) return;
    for (const close of [...observers.values()]) close();
    allowedWebContentsIds.clear(); primary = undefined;
  };
  window.webContents.once('destroyed', destroyed);
  detachPrimary = () => window.webContents.removeListener('destroyed', destroyed);
  return { allowedWebContentsIds, observerConstraints };
}

/** Main creates the observer with owned parameters; renderer code has no factory route. */
export async function createHostReadObserverWindow(): Promise<BrowserWindow> {
  const owner = primary;
  if (!owner || owner.isDestroyed() || !primaryPreload) throw new Error('Host observer owner unavailable');
  const url = owner.webContents.getURL(); const entry = hostEntryUrl(url);
  if (!entry) throw new Error('Host observer entry unavailable');
  const window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: {
    preload: primaryPreload, session: owner.webContents.session, nodeIntegration: false, contextIsolation: true, sandbox: false,
  } });
  const contents = window.webContents;
  const id = contents.id;
  observerConstraints.set(id, { entry, actions: new Set(['git.status', 'efficiency.getState']) });
  allowedWebContentsIds.add(id);
  const close = () => {
    if (observers.get(id) !== close) return;
    observers.delete(id); observerConstraints.delete(id); allowedWebContentsIds.delete(id);
    contents.removeListener('destroyed', close);
  };
  observers.set(id, close); contents.once('destroyed', close);
  try {
    await window.loadURL(url);
    if (primary !== owner || window.isDestroyed()) throw new Error('Host observer owner changed during creation');
    return window;
  } catch (error) { close(); if (!window.isDestroyed()) window.destroy(); throw error; }
}
