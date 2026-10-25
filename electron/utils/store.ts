/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import { app } from 'electron';
import { OPENCLAW_GATEWAY_PORT } from '@shared/gateway-endpoint';
import { resolveSupportedLanguage } from '@shared/language';
import type { PromptCacheRiskEvent } from '@shared/types/workspace';
import type { StoredSessionDelegationAdmission } from '../services/session-delegation-admission';
import type { WorkProviderConfig } from '@shared/types/work-provider';
import type { SensitiveCapturePolicy } from '@shared/privacy/sensitive-capture-policy';
import { DEFAULT_SENSITIVE_CAPTURE_POLICY, normalizeSensitiveCapturePolicy } from '@shared/privacy/sensitive-capture-policy';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;

const LEGACY_SETTING_KEYS = [
  'workModeToolBundles',
  'workModeKits',
  'workModePromptModeOverrides',
  'updateChannel',
  'autoCheckUpdate',
  'autoDownloadUpdate',
  'skippedVersions',
] as const;

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `verse-claw-${randomBytes(16).toString('hex')}`;
}

const GATEWAY_TOKEN_ENC_PREFIX = 'enc:safeStorage-v1:';

type GatewayTokenCrypto = {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

let gatewayTokenCrypto: GatewayTokenCrypto | null | undefined;

async function resolveGatewayTokenCrypto(): Promise<GatewayTokenCrypto | null> {
  if (gatewayTokenCrypto !== undefined) return gatewayTokenCrypto;
  try {
    const electron = await import('electron');
    if (electron.safeStorage?.isEncryptionAvailable?.()) {
      gatewayTokenCrypto = electron.safeStorage;
      return gatewayTokenCrypto;
    }
  } catch {
    // non-Electron contexts leave the token unsealed.
  }
  gatewayTokenCrypto = null;
  return null;
}

function isEncryptedGatewayToken(value: string): boolean {
  return typeof value === 'string' && value.startsWith(GATEWAY_TOKEN_ENC_PREFIX);
}

async function sealGatewayToken(plain: string): Promise<string> {
  const crypto = await resolveGatewayTokenCrypto();
  if (!crypto?.isEncryptionAvailable()) return plain;
  return GATEWAY_TOKEN_ENC_PREFIX + crypto.encryptString(plain).toString('base64');
}

async function openGatewayToken(value: string): Promise<string> {
  if (!isEncryptedGatewayToken(value)) return value;
  const crypto = await resolveGatewayTokenCrypto();
  if (!crypto?.isEncryptionAvailable()) {
    throw new Error('Encrypted gateway token present but OS encryption is unavailable');
  }
  const b64 = value.slice(GATEWAY_TOKEN_ENC_PREFIX.length);
  return crypto.decryptString(Buffer.from(b64, 'base64'));
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  machineId: string;
  hasReportedInstall: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  roleMemoryEnabled: boolean;
  memoryEmbeddingEnabled: boolean;
  gatewayToken: string;
  cdpRemoteControlEnabled: boolean;
  cdpRemoteDebuggingPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  runActivityKeepExpandedOnComplete: boolean;

  /**
   * P2 #161: whether the Main-process runtime efficiency sampler runs.
   * Default true to preserve the pre-existing always-on behaviour; turning it
   * off stops the timer entirely (zero interval work, no pending handle).
   */
  efficiencySamplingEnabled: boolean;

  /**
   * FP-P1-01: sanitized Setup provider verification state (no key material).
   * Consumed by the Setup completion gate, the chat first-send gate, and the
   * FP-P1-06 support bundle (provider type + verification status, never keys).
   */
  setupProviderVerification: {
    status: 'unverified' | 'verified' | 'skipped';
    accountId?: string;
    vendorId?: string;
    model?: string;
    checkedAt?: string;
  };

  /**
   * DCS production controls. Workspace Context is baseline-on; other advanced flags remain opt-in.
   * Env-class flags are injected into gateway forkEnv; config-class flags also
   * write ~/.openclaw/openclaw.json and rely on config-sync whole-key runtime.
   */
  dcsContextViewToolsEnabled: boolean;
  dcsWorkingMemoryEnabled: boolean;
  dcsToolRegistryEnabled: boolean;
  dcsStaleWriteGuardEnabled: boolean;
  dcsSymbolLeaseEnabled: boolean;
  dcsRoutingMemoShadowEnabled: boolean;
  dcsSekbExperienceShadowEnabled: boolean;

  /**
   * FP-P1-09: DCS flag-ack tuning overrides. 0 (default) = use the measured
   * defaults in electron/services/dcs-flag-ack.ts. Values are clamped there.
   */
  dcsFlagAckTimeoutMs: number;
  dcsFlagAckPollInitialMs: number;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];
  workProviders: WorkProviderConfig;
  sessionActivityPanelEnabled: boolean;
  sessionActivityAutoExpand: 'active' | 'attention' | 'never';
  sessionActivityShowGit: boolean;
  sessionActivityShowCommands: boolean;
  sessionRecoveryNotificationsEnabled: boolean;
  sessionActivityRetentionMinutes: 0 | 5 | 15;
  promptCacheRiskLedger: PromptCacheRiskEvent[];
  sessionDelegationAdmissions?: StoredSessionDelegationAdmission[];
  // Privacy / sensitive capture (P7-003)
  sensitiveCapturePolicy: SensitiveCapturePolicy;
}

/**
 * Default settings
 */
function getSystemLocale(): string {
  const preferredLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  return preferredLanguages[0]
    || (typeof app.getLocale === 'function' ? app.getLocale() : '')
    || Intl.DateTimeFormat().resolvedOptions().locale
    || 'en';
}

function createDefaultSettings(): AppSettings {
  return {
    // General
    theme: 'system',
    language: resolveSupportedLanguage(getSystemLocale()),
    startMinimized: false,
    launchAtStartup: false,
    telemetryEnabled: true,
    machineId: '',
    hasReportedInstall: false,

    // Gateway
    gatewayAutoStart: true,
    gatewayPort: OPENCLAW_GATEWAY_PORT,
    roleMemoryEnabled: true,
    memoryEmbeddingEnabled: false,
    gatewayToken: generateToken(),
    cdpRemoteControlEnabled: false,
    cdpRemoteDebuggingPort: 9222,
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',

    // UI State
    sidebarCollapsed: false,
    devModeUnlocked: false,
    runActivityKeepExpandedOnComplete: true,
    efficiencySamplingEnabled: true,
    setupProviderVerification: { status: 'unverified' },

    // DCS controls (Workspace Context is baseline-on; advanced flags fail closed)
    dcsContextViewToolsEnabled: false,
    dcsWorkingMemoryEnabled: true,
    dcsToolRegistryEnabled: true,
    dcsStaleWriteGuardEnabled: false,
    dcsSymbolLeaseEnabled: false,
    dcsRoutingMemoShadowEnabled: false,
    dcsSekbExperienceShadowEnabled: false,
    dcsFlagAckTimeoutMs: 0,
    dcsFlagAckPollInitialMs: 0,

    // Presets
    selectedBundles: ['productivity', 'developer'],
    enabledSkills: [],
    disabledSkills: [],
    workProviders: {},
    sessionActivityPanelEnabled: true,
    sessionActivityAutoExpand: 'active',
    sessionActivityShowGit: true,
    sessionActivityShowCommands: true,
    sessionRecoveryNotificationsEnabled: true,
    sessionActivityRetentionMinutes: 5,
    promptCacheRiskLedger: [],
    sensitiveCapturePolicy: DEFAULT_SENSITIVE_CAPTURE_POLICY,
  };
}

function omitLegacySettings(settings: Record<string, unknown>): AppSettings {
  const sanitized = { ...settings };
  for (const key of LEGACY_SETTING_KEYS) {
    delete sanitized[key];
  }
  return sanitized as unknown as AppSettings;
}

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults: createDefaultSettings(),
    });
  }
  return settingsStoreInstance;
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  const value = store.get(key);
  if (key === 'gatewayToken' && typeof value === 'string') {
    return (await openGatewayToken(value)) as AppSettings[K];
  }
  return value;
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const store = await getSettingsStore();
  if (key === 'gatewayToken' && typeof value === 'string') {
    store.set(key, (await sealGatewayToken(value)) as AppSettings[K]);
    return;
  }
  store.set(key, value);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return omitLegacySettings(store.store);
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  const store = await getSettingsStore();
  store.clear();
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(omitLegacySettings(store.store), null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    const store = await getSettingsStore();
    store.set(omitLegacySettings(settings));
  } catch {
    throw new Error('Invalid settings JSON');
  }
}

/**
 * Load normalized sensitive capture policy for Main-process gates.
 */
export async function getSensitiveCapturePolicy(): Promise<SensitiveCapturePolicy> {
  const raw = await getSetting('sensitiveCapturePolicy');
  return normalizeSensitiveCapturePolicy(raw ?? DEFAULT_SENSITIVE_CAPTURE_POLICY);
}

export async function setSensitiveCapturePolicy(
  policy: SensitiveCapturePolicy,
): Promise<SensitiveCapturePolicy> {
  const normalized = normalizeSensitiveCapturePolicy(policy);
  await setSetting('sensitiveCapturePolicy', normalized);
  return normalized;
}
