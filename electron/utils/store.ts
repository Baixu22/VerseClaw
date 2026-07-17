/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import { app } from 'electron';
import { resolveSupportedLanguage } from '@shared/language';
import type { PromptCacheRiskEvent } from '@shared/types/workspace';
import type { WorkProviderConfig } from '@shared/types/work-provider';

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

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];
  workProviders: WorkProviderConfig;
  promptCacheRiskLedger: PromptCacheRiskEvent[];
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
    gatewayPort: 18789,
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

    // Presets
    selectedBundles: ['productivity', 'developer'],
    enabledSkills: [],
    disabledSkills: [],
    workProviders: {},
    promptCacheRiskLedger: [],
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
