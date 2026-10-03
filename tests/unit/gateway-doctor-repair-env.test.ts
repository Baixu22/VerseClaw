import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFork, mockExistsSync } = vi.hoisted(() => ({
  mockFork: vi.fn(),
  mockExistsSync: vi.fn(() => true),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  utilityProcess: { fork: mockFork },
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  default: { existsSync: mockExistsSync },
}));

vi.mock('../../electron/utils/paths', () => ({
  getActiveOpenClawDir: () => '/tmp/openclaw',
  getActiveOpenClawEntryPath: () => '/tmp/openclaw/entry.js',
}));

vi.mock('../../electron/utils/uv-env', () => ({
  getUvMirrorEnv: async () => ({}),
}));

vi.mock('../../electron/utils/uv-setup', () => ({
  isPythonReady: async () => true,
  setupManagedPython: async () => undefined,
}));

vi.mock('../../electron/utils/channel-config', () => ({
  readOpenClawConfig: async () => ({}),
  // One configured channel keeps skipChannels false, so the inherited
  // OPENCLAW_SKIP_CHANNELS / CLAWDBOT_SKIP_CHANNELS fallback is what gets used.
  listConfiguredChannelsFromConfig: async () => ['qqbot'],
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

class MockUtilityChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('runOpenClawDoctorRepair fork environment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockFork.mockImplementation(() => {
      const child = new MockUtilityChild();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    });
  });

  it('never hands utilityProcess.fork a non-string env value', async () => {
    const { runOpenClawDoctorRepair } = await import('../../electron/gateway/supervisor');
    const previousOpenClaw = process.env.OPENCLAW_SKIP_CHANNELS;
    const previousClawdbot = process.env.CLAWDBOT_SKIP_CHANNELS;
    delete process.env.OPENCLAW_SKIP_CHANNELS;
    delete process.env.CLAWDBOT_SKIP_CHANNELS;

    try {
      await runOpenClawDoctorRepair();

      expect(mockFork).toHaveBeenCalledTimes(1);
      const options = mockFork.mock.calls[0][2] as { env: Record<string, unknown> };

      // Electron's utilityProcess.fork rejects undefined env values with
      // "TypeError: Invalid value for env". That crash used to replace the real
      // "Invalid config at <path>" diagnostic, so doctor repair must always pass
      // strings even when the inherited variable is unset.
      expect(Object.entries(options.env).filter(([, value]) => typeof value !== 'string')).toEqual([]);
      expect(options.env.OPENCLAW_SKIP_CHANNELS).toBe('');
      expect(options.env.CLAWDBOT_SKIP_CHANNELS).toBe('');
    } finally {
      if (previousOpenClaw === undefined) delete process.env.OPENCLAW_SKIP_CHANNELS;
      else process.env.OPENCLAW_SKIP_CHANNELS = previousOpenClaw;
      if (previousClawdbot === undefined) delete process.env.CLAWDBOT_SKIP_CHANNELS;
      else process.env.CLAWDBOT_SKIP_CHANNELS = previousClawdbot;
    }
  });
});
