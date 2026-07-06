import { app, nativeImage, nativeTheme, type BrowserWindow, type NativeImage } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

export type IconTheme = 'light' | 'dark';

export function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

export function getSystemIconTheme(): IconTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function themedPath(lightPath: string, darkPath: string, theme: IconTheme): string {
  if (theme === 'dark' && existsSync(darkPath)) {
    return darkPath;
  }
  return lightPath;
}

function createImage(pathname: string): NativeImage | null {
  const image = nativeImage.createFromPath(pathname);
  return image.isEmpty() ? null : image;
}

export function getWindowIcon(theme = getSystemIconTheme()): NativeImage | undefined {
  if (process.platform === 'darwin') return undefined;

  const iconsDir = getIconsDir();
  const lightPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const darkPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon-dark.ico')
      : join(iconsDir, 'icon-dark.png');
  return createImage(themedPath(lightPath, darkPath, theme)) ?? undefined;
}

export function getDockIcon(theme = getSystemIconTheme()): NativeImage | null {
  const iconsDir = getIconsDir();
  return createImage(
    themedPath(join(iconsDir, 'icon.png'), join(iconsDir, 'icon-dark.png'), theme),
  );
}

export function getTrayIcon(theme = getSystemIconTheme()): NativeImage {
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    iconPath = themedPath(join(iconsDir, 'icon.ico'), join(iconsDir, 'icon-dark.ico'), theme);
  } else if (process.platform === 'darwin') {
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    iconPath = themedPath(join(iconsDir, '32x32.png'), join(iconsDir, 'icon-dark.png'), theme);
  }

  let icon = createImage(iconPath);
  if (!icon) {
    icon = createImage(join(iconsDir, 'icon.png')) ?? nativeImage.createEmpty();
  }

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  return icon;
}

export function applySystemThemeIcons(window?: BrowserWindow | null): void {
  const theme = getSystemIconTheme();
  const win = window && !window.isDestroyed() ? window : null;
  const windowIcon = getWindowIcon(theme);

  if (windowIcon && win) {
    win.setIcon(windowIcon);
  }

  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = getDockIcon(theme);
    if (dockIcon) {
      app.dock.setIcon(dockIcon);
    }
  }
}
