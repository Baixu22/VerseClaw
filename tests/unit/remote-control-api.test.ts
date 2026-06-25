import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllSettingsMock, launchState } = vi.hoisted(() => ({
  getAllSettingsMock: vi.fn(),
  launchState: {
    effectivePort: null as number | null,
    effectiveEnabled: false,
    envOverride: false,
    endpoint: null as string | null,
  },
}));

const { wsSentMessages, FakeWebSocket } = vi.hoisted(() => {
  const sent: unknown[] = [];
  class MockWebSocket {
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(public url: string) {
      setTimeout(() => this.emit('open'), 0);
    }

    once(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    send(value: string) {
      const message = JSON.parse(value);
      sent.push(message);
      setTimeout(() => {
        let result: unknown = {};
        if (message.method === 'Runtime.evaluate') {
          result = {
            result: {
              value: message.params?.expression?.includes('getBoundingClientRect')
                ? { x: 40, y: 50 }
                : { title: 'Verse Claw', url: 'app://verse-claw' },
            },
          };
        } else if (message.method === 'Page.captureScreenshot') {
          result = { data: 'abc' };
        }
        this.emit('message', JSON.stringify({ id: message.id, result }));
      }, 0);
    }

    close() {
      this.emit('close');
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  }
  return { wsSentMessages: sent, FakeWebSocket: MockWebSocket };
});

vi.mock('@electron/utils/store', () => ({
  getAllSettings: (...args: unknown[]) => getAllSettingsMock(...args),
}));

vi.mock('@electron/utils/remote-control', () => ({
  getRemoteControlLaunchState: () => launchState,
  normalizeRemoteDebuggingPort: (value: unknown) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 9222;
  },
}));

vi.mock('ws', () => ({ default: FakeWebSocket }));

describe('remote control api', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    wsSentMessages.length = 0;
  });

  it('reports restart-required when saved CDP config differs from current process', async () => {
    getAllSettingsMock.mockResolvedValue({
      cdpRemoteControlEnabled: true,
      cdpRemoteDebuggingPort: 9333,
    });
    launchState.effectiveEnabled = false;
    launchState.effectivePort = null;
    launchState.envOverride = false;
    launchState.endpoint = null;

    const { createRemoteControlApi } = await import('@electron/services/remote-control-api');

    await expect(createRemoteControlApi().status()).resolves.toMatchObject({
      success: true,
      configuredEnabled: true,
      configuredPort: 9333,
      effectiveEnabled: false,
      effectivePort: null,
      restartRequired: true,
    });
  });

  it('reports env override and active endpoint', async () => {
    getAllSettingsMock.mockResolvedValue({
      cdpRemoteControlEnabled: false,
      cdpRemoteDebuggingPort: 9222,
    });
    launchState.effectiveEnabled = true;
    launchState.effectivePort = 9444;
    launchState.envOverride = true;
    launchState.endpoint = 'http://127.0.0.1:9444/json/version';

    const { createRemoteControlApi } = await import('@electron/services/remote-control-api');

    await expect(createRemoteControlApi().status()).resolves.toMatchObject({
      success: true,
      configuredEnabled: false,
      effectiveEnabled: true,
      effectivePort: 9444,
      endpoint: 'http://127.0.0.1:9444/json/version',
      envOverride: true,
      restartRequired: true,
    });
  });

  it('inspects the active CDP endpoint and returns page targets', async () => {
    launchState.effectiveEnabled = true;
    launchState.effectivePort = 9222;
    launchState.envOverride = false;
    launchState.endpoint = 'http://127.0.0.1:9222/json/version';
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.endsWith('/json/version')) {
          return {
            Browser: 'Electron/38.0.0',
            'Protocol-Version': '1.3',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
          };
        }
        return [
          {
            id: 'page-1',
            type: 'page',
            title: 'Verse Claw',
            url: 'app://verse-claw/index.html',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
          },
        ];
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { createRemoteControlApi } = await import('@electron/services/remote-control-api');

    await expect(createRemoteControlApi().inspect()).resolves.toMatchObject({
      success: true,
      browser: 'Electron/38.0.0',
      protocolVersion: '1.3',
      targets: [{ id: 'page-1', title: 'Verse Claw' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9222/json/version');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9222/json/list');
  });

  it('reports inspect failure when CDP is not active', async () => {
    launchState.effectiveEnabled = false;
    launchState.effectivePort = null;
    launchState.envOverride = false;
    launchState.endpoint = null;

    const { createRemoteControlApi } = await import('@electron/services/remote-control-api');

    await expect(createRemoteControlApi().inspect()).resolves.toMatchObject({
      success: false,
      targets: [],
      error: 'Electron CDP 调试端口当前未生效，请启用后重启 Verse Claw',
    });
  });

  it('captures screenshots through the page CDP target', async () => {
    launchState.effectiveEnabled = true;
    launchState.effectivePort = 9222;
    launchState.envOverride = false;
    launchState.endpoint = 'http://127.0.0.1:9222/json/version';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/json/list')
        ? [{
          id: 'page-1',
          type: 'page',
          title: 'Verse Claw',
          url: 'app://verse-claw',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
        }]
        : {},
    })));

    const { createRemoteControlApi } = await import('@electron/services/remote-control-api');
    const result = await createRemoteControlApi().screenshot({ targetId: 'page-1', fullPage: true });

    expect(result).toMatchObject({
      success: true,
      dataUrl: 'data:image/png;base64,abc',
      format: 'png',
    });
    expect(wsSentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'Page.enable' }),
      expect.objectContaining({ method: 'Page.captureScreenshot' }),
    ]));
  });

  it('clicks selector center and scrolls through CDP', async () => {
    launchState.effectiveEnabled = true;
    launchState.effectivePort = 9222;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{
        id: 'page-1',
        type: 'page',
        title: 'Verse Claw',
        url: 'app://verse-claw',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
      }],
    })));

    const { createRemoteControlApi } = await import('@electron/services/remote-control-api');
    await expect(createRemoteControlApi().click({ targetId: 'page-1', selector: '#save' })).resolves.toMatchObject({ success: true });
    await expect(createRemoteControlApi().scroll({ targetId: 'page-1', deltaY: 320 })).resolves.toMatchObject({ success: true });

    expect(wsSentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'Input.dispatchMouseEvent' }),
      expect.objectContaining({ method: 'Runtime.evaluate' }),
    ]));
  });
});
