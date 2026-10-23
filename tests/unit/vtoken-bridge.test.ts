// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = {
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue('/tmp/vtoken-test'),
    getAppPath: vi.fn().mockReturnValue(process.cwd()),
  },
};

vi.mock('electron', () => electronMock);

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../electron/utils/uv-setup', () => ({
  checkUvInstalled: vi.fn().mockResolvedValue(true),
  isPythonReady: vi.fn().mockResolvedValue(true),
  setupManagedPython: vi.fn().mockResolvedValue(undefined),
}));

describe('vtoken-bridge', () => {
  const prevEnv = process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
  const prevAssembly = process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
  });

  afterEach(async () => {
    const mod = await import('../../electron/services/vtoken-bridge');
    mod.resetVtokenBridgeForTests();
    if (prevEnv === undefined) delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    else process.env.VERSE_VTOKEN_BRIDGE_ENABLED = prevEnv;
    if (prevAssembly === undefined) delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    else process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = prevAssembly;
  });

  it('defaults to disabled (opt-in) and does not claim running worker', async () => {
    const mod = await import('../../electron/services/vtoken-bridge');
    expect(mod.isVtokenBridgeEnabled()).toBe(false);
    const status = await mod.vtokenGetStatus();
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
    expect(status.success).toBe(true);
  });

  it('ignores env canary VERSE_VTOKEN_BRIDGE_ENABLED=1 because the bridge is retired', async () => {
    process.env.VERSE_VTOKEN_BRIDGE_ENABLED = '1';
    const mod = await import('../../electron/services/vtoken-bridge');
    expect(mod.VTOKEN_BRIDGE_RETIRED).toBe(true);
    expect(mod.readVtokenBridgeEnabledFromEnv()).toBe(false);
    expect(mod.isVtokenBridgeEnabled()).toBe(false);
  });

  it('reads kill-switch from env', async () => {
    process.env.VERSE_VTOKEN_BRIDGE_ENABLED = '0';
    const mod = await import('../../electron/services/vtoken-bridge');
    expect(mod.readVtokenBridgeEnabledFromEnv()).toBe(false);
    expect(mod.isVtokenBridgeEnabled()).toBe(false);
  });

  it('returns disabled payload without spawning when flag is off', async () => {
    process.env.VERSE_VTOKEN_BRIDGE_ENABLED = '0';
    const mod = await import('../../electron/services/vtoken-bridge');
    const ping = await mod.vtokenPing();
    expect(ping.success).toBe(false);
    expect(ping.disabled).toBe(true);
    const assemble = await mod.vtokenAssemble({ taskHint: 'x', budgetTokens: 100 });
    expect(assemble.success).toBe(false);
    expect(assemble.disabled).toBe(true);
  });

  it('refuses to enable because the bridge is retired', async () => {
    const mod = await import('../../electron/services/vtoken-bridge');
    expect(mod.vtokenSetEnabled({ enabled: true })).toEqual({ success: true, enabled: false });
    expect(mod.isVtokenBridgeEnabled()).toBe(false);
    expect(mod.vtokenSetEnabled({ enabled: false })).toEqual({ success: true, enabled: false });
    expect(mod.isVtokenBridgeEnabled()).toBe(false);
  });

  it('resolves package root in dev layout', async () => {
    const mod = await import('../../electron/services/vtoken-bridge');
    const root = mod.resolveVtokenPackageRoot();
    expect(root).toBeTruthy();
    expect(root?.replace(/\\/g, '/')).toMatch(/packages\/vtoken$/);
    const py = mod.resolveVtokenPythonPath();
    expect(py?.replace(/\\/g, '/')).toMatch(/packages\/vtoken\/src$/);
  });
});
