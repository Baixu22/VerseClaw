import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  captureMock,
  disableMock,
  shutdownMock,
  getSettingMock,
  setSettingMock,
  loggerDebugMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  captureMock: vi.fn(),
  disableMock: vi.fn(),
  shutdownMock: vi.fn(),
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function PostHogMock() {
    return {
      capture: captureMock,
      disable: disableMock,
      shutdown: shutdownMock,
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
    disableMock.mockResolvedValue(undefined);
    shutdownMock.mockResolvedValue(undefined);
    vi.stubEnv('VERSE_CLAW_POSTHOG_API_KEY', 'phc_synthetic_test');
    vi.stubEnv('VERSE_CLAW_POSTHOG_HOST', 'https://telemetry.invalid');
  });

  it('stops accepting events and shuts down the client after opt-out', async () => {
    const { applyTelemetrySettingChange, captureTelemetryEvent, initTelemetry } = await import('@electron/utils/telemetry');
    await initTelemetry();
    captureMock.mockClear();

    await applyTelemetrySettingChange(false);
    captureTelemetryEvent('after_opt_out');

    await vi.waitFor(() => expect(shutdownMock).toHaveBeenCalledTimes(1));
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('can re-enable without duplicating the client lifecycle', async () => {
    const { applyTelemetrySettingChange, captureTelemetryEvent, initTelemetry } = await import('@electron/utils/telemetry');
    await initTelemetry();
    await applyTelemetrySettingChange(false);
    await applyTelemetrySettingChange(true);
    captureTelemetryEvent('after_re_enable');

    expect(captureMock).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'after_re_enable' }));
    await vi.waitFor(() => expect(shutdownMock).toHaveBeenCalledTimes(1));
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
