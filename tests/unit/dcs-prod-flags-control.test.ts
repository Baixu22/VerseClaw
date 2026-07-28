import { describe, expect, it } from 'vitest';
import { DEFAULT_SENSITIVE_CAPTURE_POLICY } from '@shared/privacy/sensitive-capture-policy';
import {
  asBooleanFlag,
  getConfigPathValue,
  getWritableFlagSpec,
  isWritableFlagId,
  listWritableFlagSpecs,
  setConfigPathValue,
} from '@shared/dcs/prod-flags-control';
import { applyDcsProdFlagsToGatewayEnv } from '../../electron/utils/dcs-prod-flags-env';
import type { AppSettings } from '../../electron/utils/store';

function baseSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: 'system',
    language: 'en',
    startMinimized: false,
    launchAtStartup: false,
    telemetryEnabled: true,
    machineId: '',
    hasReportedInstall: false,
    gatewayAutoStart: true,
    gatewayPort: 18789,
    roleMemoryEnabled: true,
    memoryEmbeddingEnabled: false,
    gatewayToken: 'test',
    cdpRemoteControlEnabled: false,
    cdpRemoteDebuggingPort: 9222,
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '',
    sidebarCollapsed: false,
    devModeUnlocked: false,
    dcsContextViewToolsEnabled: false,
    dcsWorkingMemoryEnabled: false,
    dcsToolRegistryEnabled: false,
    dcsStaleWriteGuardEnabled: false,
    dcsSymbolLeaseEnabled: false,
    dcsRoutingMemoShadowEnabled: false,
    dcsSekbExperienceShadowEnabled: false,
    selectedBundles: [],
    enabledSkills: [],
    disabledSkills: [],
    workProviders: {},
    promptCacheRiskLedger: [],
    sensitiveCapturePolicy: DEFAULT_SENSITIVE_CAPTURE_POLICY,
    ...over,
  };
}

describe('dcs prod flags control plane', () => {
  it('lists only allowlisted writable specs with default off', () => {
    const specs = listWritableFlagSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(1);
    expect(specs.every((s) => s.defaultEnabled === false)).toBe(true);
    expect(isWritableFlagId('context-view-tools')).toBe(true);
    expect(isWritableFlagId('working-memory')).toBe(true);
    expect(isWritableFlagId('tool-registry')).toBe(true);
    expect(isWritableFlagId('patch-flow')).toBe(false);
    expect(getWritableFlagSpec('context-view-tools')?.controlKind).toBe('env');
    expect(getWritableFlagSpec('working-memory')?.targetKey).toBe(
      'runtime.contextBlock.working-memory.enabled',
    );
    expect(getWritableFlagSpec('tool-registry')?.targetKey).toBe(
      'runtime.contextBlock.tool-registry.enabled',
    );
    expect(getWritableFlagSpec('stale-write-guard')?.controlKind).toBe('config');
  });

  it('setConfigPathValue can write working-memory kebab path', () => {
    const next = setConfigPathValue({}, 'runtime.contextBlock.working-memory.enabled', true);
    expect(getConfigPathValue(next, 'runtime.contextBlock.working-memory.enabled')).toBe(true);
  });

  it('setConfigPathValue can write tool-registry kebab path', () => {
    const next = setConfigPathValue({}, 'runtime.contextBlock.tool-registry.enabled', true);
    expect(getConfigPathValue(next, 'runtime.contextBlock.tool-registry.enabled')).toBe(true);
  });
  it('get/set config path does not mutate source and preserves siblings', () => {
    const root = { runtime: { coding: { other: 1 } }, keep: true };
    const next = setConfigPathValue(root, 'runtime.coding.staleWriteGuard.enabled', true);
    expect(root).toEqual({ runtime: { coding: { other: 1 } }, keep: true });
    expect(getConfigPathValue(next, 'runtime.coding.staleWriteGuard.enabled')).toBe(true);
    expect(getConfigPathValue(next, 'runtime.coding.other')).toBe(1);
    expect(next.keep).toBe(true);
  });

  it('asBooleanFlag parses common env forms', () => {
    expect(asBooleanFlag('1')).toBe(true);
    expect(asBooleanFlag('true')).toBe(true);
    expect(asBooleanFlag('0')).toBe(false);
    expect(asBooleanFlag(undefined, false)).toBe(false);
  });

  it('applyDcsProdFlagsToGatewayEnv injects view tools when settings enabled', () => {
    const env = applyDcsProdFlagsToGatewayEnv(
      { FOO: '1' },
      baseSettings({ dcsContextViewToolsEnabled: true }),
    );
    expect(env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS).toBe('1');
    expect(env.OPENCLAW_DCS_CONTEXT_TOOLS).toBe('1');
    expect(env.FOO).toBe('1');
  });

  it('applyDcsProdFlagsToGatewayEnv leaves view tools unset when disabled', () => {
    const env = applyDcsProdFlagsToGatewayEnv(
      { OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: '1' },
      baseSettings({ dcsContextViewToolsEnabled: false }),
    );
    expect(env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS).toBeUndefined();
  });

  it('explicit env kill wins over settings enable', () => {
    const prev = process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = '0';
    try {
      const env = applyDcsProdFlagsToGatewayEnv(
        {},
        baseSettings({ dcsContextViewToolsEnabled: true }),
      );
      expect(env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS).toBe('0');
    } finally {
      if (prev === undefined) delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
      else process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = prev;
    }
  });

  it('P2-04 observability snapshot shape includes budget and write metric keys', () => {
    const mock = {
      schema: 'dcs-prod-observability/v1' as const,
      killSwitchEngaged: false,
      killSwitchEnv: 'VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH',
      viewToolsEnvEngaged: false,
      enabledWritableFlagIds: [] as string[],
      metricKeys: {
        writeSide: ['coding.write.falseBlockRate'],
        waveSide: [] as string[],
        shadowSide: [] as string[],
        budgetSide: ['dcs.injection.budgetOverflows'],
      },
      sources: [] as string[],
      note: 'test',
    };
    expect(mock.schema).toBe('dcs-prod-observability/v1');
    expect(mock.metricKeys.writeSide[0]).toContain('falseBlockRate');
    expect(mock.metricKeys.budgetSide[0]).toContain('budget');
  });
});
