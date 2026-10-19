import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  closeAllConnectionsMock,
  getAllSettingsMock,
  setElectronProxyEnabledMock,
  setProxyMock,
} = vi.hoisted(() => ({
  closeAllConnectionsMock: vi.fn(),
  getAllSettingsMock: vi.fn(),
  setElectronProxyEnabledMock: vi.fn(),
  setProxyMock: vi.fn(),
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      closeAllConnections: closeAllConnectionsMock,
      setProxy: setProxyMock,
    },
  },
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: getAllSettingsMock,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn() },
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  setElectronProxyEnabled: setElectronProxyEnabledMock,
}));

import { applyProxySettings } from '@electron/main/proxy';

beforeEach(() => {
  vi.clearAllMocks();
  closeAllConnectionsMock.mockResolvedValue(undefined);
  setProxyMock.mockResolvedValue(undefined);
});

describe('Main proxy transport routing', () => {
  it('keeps direct traffic on the pooled transport', async () => {
    await applyProxySettings({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(setProxyMock).toHaveBeenCalledWith({ mode: 'direct' });
    expect(setElectronProxyEnabledMock).toHaveBeenCalledWith(false);
  });

  it('selects Electron net.fetch when fixed proxy routing is active', async () => {
    await applyProxySettings({
      proxyEnabled: true,
      proxyServer: '127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    });

    expect(setProxyMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fixed_servers' }));
    expect(setElectronProxyEnabledMock).toHaveBeenCalledWith(true);
  });
});