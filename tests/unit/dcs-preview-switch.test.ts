// @vitest-environment node
/**
 * FP-P1-03: DCS Coding Preview switch — service-level coverage.
 *
 * Prerequisite gating, combo composition (exclusions stay excluded), one-ack
 * apply semantics, and kill-path honesty (rejected flags → failed, not applied).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  settingWrites: [] as Array<[string, unknown]>,
  config: {} as Record<string, unknown>,
  configWrites: [] as Record<string, unknown>[],
  accounts: [] as Array<Record<string, unknown>>,
  activeWorkspace: null as Record<string, unknown> | null,
  generation: '9',
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: vi.fn(async () => state.settings),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    state.settingWrites.push([key, value]);
    state.settings[key] = value;
  }),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: vi.fn(async () => state.config),
  writeOpenClawConfig: vi.fn(async (config: Record<string, unknown>) => {
    state.configWrites.push(JSON.parse(JSON.stringify(config)));
    state.config = config;
  }),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => state.activeWorkspace),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: vi.fn(async () => state.accounts),
}));

vi.mock('@electron/gateway/generation', () => ({
  getCurrentGatewayGeneration: vi.fn(() => state.generation),
}));

import {
  getDcsPreviewState,
  resolveDcsPreviewPrereqs,
  setDcsPreview,
} from '@electron/services/dcs-prod-flags-api';
import { DCS_PREVIEW_COMBO_FLAG_IDS } from '@shared/dcs/prod-flags-control';
import type { GatewayManager } from '@electron/gateway/manager';

const COMBO_STORE_KEYS = [
  'dcsContextViewToolsEnabled',
  'dcsWorkingMemoryEnabled',
  'dcsToolRegistryEnabled',
  'dcsStaleWriteGuardEnabled',
];

function completeAck(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gatewayGeneration: state.generation,
    childPid: 4242,
    effectiveFlags: {
      'dcs.contextViewTools.enabled': true,
      'runtime.contextBlock.working_memory.enabled': true,
      'runtime.contextBlock.tool_registry.enabled': true,
      'runtime.coding.staleWriteGuard.enabled': true,
    },
    configSource: { path: 'C:/state/openclaw.json', exists: true, origin: 'state-dir' },
    runtimeBuildOrConfigHash: 'abc123',
    turnEffectProbe: { wouldChangeTurn: true, killSwitchEngaged: false, activeSurfaces: ['wm'] },
    degradedReason: null,
    ...overrides,
  };
}

function gatewayManager(overrides: Partial<Record<'state', string>> & { rpc?: () => Promise<unknown> } = {}): GatewayManager {
  return {
    getStatus: () => ({ state: overrides.state ?? 'running' }),
    restart: vi.fn(async () => undefined),
    rpc: vi.fn(overrides.rpc ?? (async () => completeAck())),
  } as unknown as GatewayManager;
}

function satisfyPrereqs() {
  state.settings.setupProviderVerification = {
    status: 'verified', accountId: 'a', vendorId: 'custom', model: 'm', checkedAt: 'now',
  };
  state.activeWorkspace = { id: 'ws', rootPath: 'C:/proj', permissionMode: 'acceptEdits' };
}

beforeEach(() => {
  state.settings = {};
  state.settingWrites = [];
  state.config = {};
  state.configWrites = [];
  state.accounts = [];
  state.activeWorkspace = null;
  process.env.VERSE_CLAW_E2E = '1'; // default restart off unless explicit
  delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
  delete process.env.OPENCLAW_DCS_CONTEXT_TOOLS;
});

describe('FP-P1-03 combo definition', () => {
  it('is exactly the declared first-product set — exclusions stay excluded', () => {
    expect([...DCS_PREVIEW_COMBO_FLAG_IDS]).toEqual([
      'context-view-tools',
      'working-memory',
      'tool-registry',
      'stale-write-guard',
    ]);
    for (const excluded of ['routing-memo-shadow', 'sekb-experience-shadow', 'symbol-lease']) {
      expect(DCS_PREVIEW_COMBO_FLAG_IDS).not.toContain(excluded);
    }
  });
});

describe('FP-P1-03 prerequisites', () => {
  it('clean install → all three missing', async () => {
    expect(await resolveDcsPreviewPrereqs()).toEqual([
      'providerVerified',
      'workspaceSelected',
      'permissionChosen',
    ]);
  });

  it('setup-verified provider + explicitly chosen workspace → none missing', async () => {
    satisfyPrereqs();
    expect(await resolveDcsPreviewPrereqs()).toEqual([]);
  });

  it('the auto-created default workspace does NOT count as a user choice', async () => {
    state.settings.setupProviderVerification = {
      status: 'verified', accountId: 'a', vendorId: 'custom', model: 'm', checkedAt: 'now',
    };
    state.activeWorkspace = { id: 'default', rootPath: 'C:/users/x/.openclaw/workspace', permissionMode: 'readOnly' };
    expect(await resolveDcsPreviewPrereqs()).toEqual(['workspaceSelected', 'permissionChosen']);
  });

  it('a Settings-validated provider account also satisfies providerVerified', async () => {
    state.activeWorkspace = { id: 'ws', rootPath: 'C:/proj', permissionMode: 'readOnly' };
    state.accounts = [{ id: 'a', metadata: { validation: { status: 'valid', checkedAt: 'now', source: 'settings' } } }];
    expect(await resolveDcsPreviewPrereqs()).toEqual([]);
  });
});

describe('FP-P1-03 setDcsPreview', () => {
  it('refuses to enable with missing prerequisites and writes NOTHING', async () => {
    const result = await setDcsPreview({ enabled: true }, gatewayManager());
    expect(result.success).toBe(false);
    expect(result.status).toBe('error');
    expect(result.missingPrereqs).toContain('providerVerified');
    expect(state.settingWrites).toHaveLength(0);
    expect(state.configWrites).toHaveLength(0);
  });

  it('enable writes all four combo flags (store + config + env) and nothing else', async () => {
    satisfyPrereqs();
    const result = await setDcsPreview({ enabled: true, restartGateway: false }, gatewayManager());
    expect(result.success).toBe(true);
    expect(result.status).toBe('pending-restart'); // no restart requested ⇒ honest state
    expect(state.settingWrites.map(([key]) => key).sort()).toEqual([...COMBO_STORE_KEYS].sort());
    // Config leaves for the three config-kind flags:
    const written = JSON.stringify(state.config);
    expect(written).toContain('working-memory');
    expect(written).toContain('tool-registry');
    expect(written).toContain('staleWriteGuard');
    // Env mirror for the env-kind flag:
    expect(process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS).toBe('1');
    // Exclusions untouched:
    expect(written).not.toContain('routingMemo');
    expect(written).not.toContain('experienceShadow');
    expect(written).not.toContain('symbolLease');
  });

  it('disable needs no prerequisites (kill path must never be blocked)', async () => {
    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = '1';
    const result = await setDcsPreview({ enabled: false, restartGateway: false }, gatewayManager());
    expect(result.success).toBe(true);
    expect(state.settingWrites.map(([, value]) => value).every((value) => value === false)).toBe(true);
    expect(process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS).toBeUndefined();
  });

  it('applied only via a complete current-generation child ack covering the combo', async () => {
    satisfyPrereqs();
    let requested: Record<string, boolean> | undefined;
    const manager = gatewayManager({
      rpc: async () => completeAck(),
    });
    (manager.rpc as ReturnType<typeof vi.fn>).mockImplementation(
      async (_method: string, params: { requestedFlags?: Record<string, boolean> }) => {
        requested = params?.requestedFlags;
        return completeAck();
      },
    );
    const result = await setDcsPreview({ enabled: true, restartGateway: true }, manager);
    expect(result.status).toBe('applied');
    expect(result.ackTrail).toEqual([
      'saved', 'pending-restart', 'restarting', 'runtime-acknowledged', 'applied',
    ]);
    // One ack covers every combo flag:
    expect(Object.keys(requested ?? {}).sort()).toEqual([
      'OPENCLAW_DCS_CONTEXT_VIEW_TOOLS',
      'runtime.coding.staleWriteGuard.enabled',
      'runtime.contextBlock.tool-registry.enabled',
      'runtime.contextBlock.working-memory.enabled',
    ].sort());
  });

  it('kill switch rejection reports failed/flag-rejected, never applied', async () => {
    satisfyPrereqs();
    const manager = gatewayManager({
      rpc: async () => completeAck({
        effectiveFlags: {
          'dcs.contextViewTools.enabled': false,
          'runtime.contextBlock.working_memory.enabled': false,
          'runtime.contextBlock.tool_registry.enabled': false,
          'runtime.coding.staleWriteGuard.enabled': false,
        },
        turnEffectProbe: { wouldChangeTurn: false, killSwitchEngaged: true, activeSurfaces: [] },
        rejectedFlags: [
          { id: 'runtime.contextBlock.working_memory.enabled', requested: true, effective: false, reason: 'kill-switch' },
        ],
      }),
    });
    const result = await setDcsPreview({ enabled: true, restartGateway: true }, manager);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('flag-rejected');
  });
});

describe('FP-P1-03 getDcsPreviewState', () => {
  it('off / partial / on are derived from the combo store keys', async () => {
    expect((await getDcsPreviewState()).enabled).toBe(false);
    state.settings.dcsContextViewToolsEnabled = true;
    const partial = await getDcsPreviewState();
    expect(partial.enabled).toBe(false);
    expect(partial.partial).toBe(true);
    for (const key of COMBO_STORE_KEYS) state.settings[key] = true;
    const on = await getDcsPreviewState();
    expect(on.enabled).toBe(true);
    expect(on.partial).toBe(false);
  });
});
