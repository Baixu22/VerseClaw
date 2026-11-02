import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSystemNotificationsApiWithDependencies,
  normalizeSystemNotificationRoute,
} from '../../electron/services/system-notifications-api';

const notifications = vi.hoisted(() => ({ shown: [] as Array<{ title: string; body: string; silent: boolean; onClick: () => void }> }));
let enabled = true;
let supported = true;

function fakeWindow() {
  const send = vi.fn();
  const setWindowButtonPosition = vi.fn();
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isMaximized: () => false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    setWindowButtonPosition,
    webContents: { isDestroyed: () => false, send },
  } as never;
  return { win, send, setWindowButtonPosition };
}

function apiFor(win: ReturnType<typeof fakeWindow>['win']) {
  return createSystemNotificationsApiWithDependencies(win, {
    isEnabled: async () => enabled,
    isSupported: () => supported,
    show: (payload) => { notifications.shown.push(payload); },
  });
}

beforeEach(() => {
  notifications.shown = [];
  enabled = true;
  supported = true;
});

describe('system notification boundary', () => {
  it('applies the sidebar traffic-light position through the registered window service', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const { win, setWindowButtonPosition } = fakeWindow();
    apiFor(win).syncTrafficLightPosition({ sidebarCollapsed: true });
    expect(setWindowButtonPosition).toHaveBeenCalledWith({ x: 8, y: 8 });
    platform.mockRestore();
  });

  it('fails closed when the preference is off', async () => {
    enabled = false;
    const { win } = fakeWindow();
    const result = await apiFor(win).notify({
      id: 'run:1', title: 'done', body: 'ready', attention: 'completion',
    });
    expect(result).toMatchObject({ success: true, delivered: false, reason: 'disabled' });
    expect(notifications.shown).toHaveLength(0);
  });

  it('rejects invalid copy and delivers normalized attention notifications', async () => {
    const { win } = fakeWindow();
    const api = apiFor(win);
    expect(await api.notify({ id: 'bad', title: '', body: ' ', attention: 'error' }))
      .toMatchObject({ success: false, delivered: false, reason: 'invalid-payload' });
    const result = await api.notify({
      id: 'run:1',
      title: '  Done   now ',
      body: ' Conversation\n is ready ',
      attention: 'action-required',
    });
    expect(result).toMatchObject({ success: true, delivered: true });
    expect(notifications.shown[0]).toMatchObject({
      title: 'Done now',
      body: 'Conversation is ready',
      silent: false,
    });
  });

  it('only accepts in-app routes and ignores unsupported hosts', async () => {
    expect(normalizeSystemNotificationRoute('/settings')).toBe('/settings');
    expect(normalizeSystemNotificationRoute('https://example.com')).toBeUndefined();
    expect(normalizeSystemNotificationRoute('//evil.example')).toBeUndefined();
    supported = false;
    const { win } = fakeWindow();
    expect(await apiFor(win).notify({
      id: 'run:2', title: 'done', body: 'ready', attention: 'completion',
    })).toMatchObject({ success: true, delivered: false, reason: 'unsupported' });
  });

  it('focuses and navigates only through the validated internal route on click', async () => {
    const { win, send } = fakeWindow();
    await apiFor(win).notify({
      id: 'run:3',
      title: 'Approval needed',
      body: 'Review the request',
      attention: 'action-required',
      route: '/?session=agent%3Amain%3Amain',
    });
    notifications.shown[0].onClick();
    expect(send).toHaveBeenCalledWith('navigate', '/?session=agent%3Amain%3Amain');
  });
});
