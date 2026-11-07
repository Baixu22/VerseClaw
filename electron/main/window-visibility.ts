import type { BrowserWindow } from 'electron';
import { HOST_EVENT_CHANNELS } from '../../shared/host-events/contract';

/** Native visibility remains authoritative when Chromium reports an active hidden renderer. */
export function registerWindowVisibility(win: BrowserWindow): void {
  const contents = win.webContents;
  const publish = () => {
    if (win.isDestroyed() || contents.isDestroyed()) return;
    contents.send(HOST_EVENT_CHANNELS.app.windowVisibility, win.isVisible() && !win.isMinimized());
  };
  win.on('show', publish);
  win.on('hide', publish);
  win.on('minimize', publish);
  win.on('restore', publish);
  contents.on('did-finish-load', publish);
  win.once('closed', () => {
    win.removeListener('show', publish);
    win.removeListener('hide', publish);
    win.removeListener('minimize', publish);
    win.removeListener('restore', publish);
    contents.removeListener('did-finish-load', publish);
  });
}
