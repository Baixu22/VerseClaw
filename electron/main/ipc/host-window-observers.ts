import type { BrowserWindow, WebContents, WebPreferences } from 'electron';
import { hostEntryUrl, type HostSenderAuthorization } from './host-invoke-security';

const allowedWebContentsIds = new Set<number>();
const observerConstraints = new Map<number, { entry: string; actions: ReadonlySet<string> }>();
const observers = new Map<number, () => void>();
let primary: BrowserWindow | undefined;
let detachPrimary: (() => void) | undefined;
function preferencesFor(contents: WebContents): WebPreferences | undefined {
  return (contents as WebContents & { getLastWebPreferences?: () => WebPreferences }).getLastWebPreferences?.();
}

/** The normal primary window retains its existing Host privileges. */
export function initializeHostWindowAuthorization(window: BrowserWindow): HostSenderAuthorization {
  detachPrimary?.();
  for (const close of [...observers.values()]) close();
  allowedWebContentsIds.clear(); primary = window;
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

/** Main explicitly owns observer windows; renderer code has no registration route. */
export function registerHostReadObserver(window: BrowserWindow): () => void {
  if (!primary || primary.isDestroyed() || window.isDestroyed() || window === primary) throw new Error('Host observer owner unavailable');
  const contents = window.webContents;
  const entry = hostEntryUrl(primary.webContents.getURL());
  const preferences = preferencesFor(contents);
  if (!entry || hostEntryUrl(contents.getURL()) !== entry || contents.session !== primary.webContents.session
    || !preferences?.preload || preferences.preload !== preferencesFor(primary.webContents)?.preload
    || preferences.nodeIntegration || !preferences.contextIsolation) throw new Error('Host observer must use the owned app entry and preload');
  const id = contents.id; const existing = observers.get(id);
  if (existing) return existing;
  observerConstraints.set(id, { entry, actions: new Set(['git.status', 'efficiency.getState']) });
  allowedWebContentsIds.add(id);
  const close = () => {
    if (observers.get(id) !== close) return;
    observers.delete(id); observerConstraints.delete(id); allowedWebContentsIds.delete(id);
    contents.removeListener('destroyed', close);
  };
  observers.set(id, close); contents.once('destroyed', close); return close;
}
