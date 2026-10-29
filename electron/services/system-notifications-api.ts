import { Notification, type BrowserWindow } from 'electron';
import { getSetting } from '../utils/store';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

const MAX_TITLE = 80;
const MAX_BODY = 240;
const VALID_ATTENTION = new Set(['completion', 'error', 'action-required']);

export function normalizeSystemNotificationRoute(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const route = value.trim();
  return route.startsWith('//') ? undefined : /^\/[A-Za-z0-9/?#=&._~%+-]*$/u.test(route) ? route : undefined;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, max) : '';
}

function focusWindow(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * System-level attention notifications. This is the only renderer-to-OS
 * notification path: the renderer describes intent, Main validates it, checks
 * the persisted switch, and owns click-to-focus/navigation.
 */
type SystemNotificationsDependencies = {
  isSupported: () => boolean;
  isEnabled: () => Promise<boolean>;
  show: (payload: {
    title: string;
    body: string;
    silent: boolean;
    onClick: () => void;
  }) => void;
};

/**
 * Testable native notification boundary. Production uses Electron's
 * Notification through the default dependencies below; tests inject a fake
 * emitter without bypassing validation or the persisted preference.
 */
export function createSystemNotificationsApiWithDependencies(
  mainWindow: BrowserWindow,
  dependencies: SystemNotificationsDependencies,
): CompleteHostServiceRegistry['window'] {
  return {
    syncTrafficLightPosition: () => {},
    notify: async (payload) => {
      const enabled = await dependencies.isEnabled().catch(() => false);
      if (!enabled) return { success: true, delivered: false, reason: 'disabled' };
      if (!dependencies.isSupported()) {
        return { success: true, delivered: false, reason: 'unsupported' };
      }
      const route = normalizeSystemNotificationRoute(payload.route);
      const title = cleanText(payload?.title, MAX_TITLE);
      const body = cleanText(payload?.body, MAX_BODY);
      const attention = VALID_ATTENTION.has(payload?.attention) ? payload.attention : 'completion';
      if (!title || !body) {
        return { success: false, delivered: false, reason: 'invalid-payload', error: 'title and body are required' };
      }
      dependencies.show({
        title,
        body,
        silent: attention === 'completion',
        onClick: () => {
          focusWindow(mainWindow);
          if (route && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('navigate', route);
          }
        },
      });
      return { success: true, delivered: true };
    },
    minimize: () => { mainWindow.minimize(); },
    maximize: () => {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    },
    close: () => { mainWindow.close(); },
    isMaximized: () => mainWindow.isMaximized(),
  };
}

export function createSystemNotificationsApi(
  mainWindow: BrowserWindow,
): CompleteHostServiceRegistry['window'] {
  return createSystemNotificationsApiWithDependencies(mainWindow, {
    isSupported: () => Notification.isSupported(),
    isEnabled: () => getSetting('desktopNotificationsEnabled'),
    show: ({ title, body, silent, onClick }) => {
      const notification = new Notification({ title, body, silent });
      notification.on('click', onClick);
      notification.show();
    },
  });
}
