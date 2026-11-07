import type { BrowserWindow } from 'electron';
import { HOST_EVENT_CHANNELS } from '../../shared/host-events/contract';

/** Native visibility remains authoritative when Chromium reports an active hidden renderer. */
export function registerWindowVisibility(win: BrowserWindow): void {
  const publish = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(HOST_EVENT_CHANNELS.app.windowVisibility, win.isVisible() && !win.isMinimized());
  };
  win.on('show', publish);
  win.on('hide', publish);
  win.on('minimize', publish);
  win.on('restore', publish);
  win.webContents.on('did-finish-load', publish);
  win.once('closed', () => {
    win.removeListener('show', publish);
    win.removeListener('hide', publish);
    win.removeListener('minimize', publish);
    win.removeListener('restore', publish);
    win.webContents.removeListener('did-finish-load', publish);
  });
}
