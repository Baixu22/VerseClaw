import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  captureMock,
  getSettingMock,
  setSettingMock,
  loggerDebugMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  captureMock: vi.fn(),
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function PostHogMock() {
    return {
      capture: captureMock,
    };
  }),
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: loggerDebugMock,
    error: loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.2.1',
  },
}));

vi.mock('node-machine-id', () => ({
  machineIdSync: () => 'machine-id-1',
}));

describe('main telemetry capture', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSettingMock.mockImplementation(async (key: string) => {
      switch (key) {
        case 'telemetryEnabled':
          return true;
        case 'machineId':
          return 'existing-machine-id';
        case 'hasReportedInstall':
          return true;
        default:
          return undefined;
      }
    });
    setSettingMock.mockResolvedValue(undefined);
    captureMock.mockReturnValue(undefined);
  });

  it('initializes the client and enriches captured events with app metadata', async () => {
    const { captureTelemetryEvent, initTelemetry } = await import('@electron/utils/telemetry');
    await initTelemetry();
    captureTelemetryEvent('agent_run_completed', { durationMs: 42 });

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenNthCalledWith(1, {
      distinctId: 'existing-machine-id',
      event: 'app_opened',
      properties: expect.objectContaining({ $app_version: '0.2.1' }),
    });
    expect(captureMock).toHaveBeenNthCalledWith(2, {
      distinctId: 'existing-machine-id',
      event: 'agent_run_completed',
      properties: expect.objectContaining({
        $app_version: '0.2.1',
        durationMs: 42,
      }),
    });
    expect(loggerDebugMock).toHaveBeenCalledWith('Reported app_opened event');
  });
});
