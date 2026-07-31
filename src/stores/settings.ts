/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApi } from '@/lib/host-api';
import { resolveSupportedLanguage } from '@shared/language';
import type { WorkProviderConfig, WorkProviderId } from '@shared/types/work-provider';
import {
  DEFAULT_SETUP_PROVIDER_VERIFICATION,
  type SetupProviderVerification,
} from '@/lib/setup-provider';

type Theme = 'light' | 'dark' | 'system';
export type UiDepthMode = 'basic' | 'advanced';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  roleMemoryEnabled: boolean;
  memoryEmbeddingEnabled: boolean;
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
  sidebarWidth: number;
  devModeUnlocked: boolean;
  uiDepthMode: UiDepthMode;
  workProviders: WorkProviderConfig;

  // Setup
  setupComplete: boolean;
  /** FP-P1-01: sanitized provider verification state (no key material). */
  setupProviderVerification: SetupProviderVerification;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setRoleMemoryEnabled: (value: boolean) => void;
  setMemoryEmbeddingEnabled: (value: boolean) => void;
  setCdpRemoteControlEnabled: (value: boolean) => void;
  setCdpRemoteDebuggingPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (value: number) => void;
  setDevModeUnlocked: (value: boolean) => void;
  setUiDepthMode: (value: UiDepthMode) => void;
  setWorkProviderEnabled: (providerId: WorkProviderId, enabled: boolean) => void;
  markSetupComplete: () => void;
  setSetupProviderVerification: (verification: SetupProviderVerification) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
  startMinimized: false,
  launchAtStartup: false,
  telemetryEnabled: true,
  gatewayAutoStart: true,
  gatewayPort: 18789,
  roleMemoryEnabled: true,
  memoryEmbeddingEnabled: false,
  cdpRemoteControlEnabled: false,
  cdpRemoteDebuggingPort: 9222,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  sidebarCollapsed: false,
  sidebarWidth: 275,
  devModeUnlocked: false,
  uiDepthMode: 'basic' as UiDepthMode,
  workProviders: {} as WorkProviderConfig,
  setupComplete: false,
  setupProviderVerification: DEFAULT_SETUP_PROVIDER_VERIFICATION,
};

const clampSidebarWidth = (value: number) => Math.min(420, Math.max(220, Math.round(value)));

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApi.settings.getAll();
          const { uiDepthMode: _hostUiDepthMode, ...hostSettings } = settings as Record<string, unknown>;
          const resolvedLanguage = settings.language
            ? resolveSupportedLanguage(settings.language)
            : undefined;
          set((state) => ({
            ...state,
            ...hostSettings,
            ...(resolvedLanguage ? { language: resolvedLanguage } : {}),
            ...(typeof settings.sidebarWidth === 'number'
              ? { sidebarWidth: clampSidebarWidth(settings.sidebarWidth) }
              : {}),
          }));
          if (resolvedLanguage) {
            i18n.changeLanguage(resolvedLanguage);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApi.settings.set('theme', theme).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApi.settings.set('language', resolvedLanguage).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApi.settings.set('launchAtStartup', launchAtStartup).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApi.settings.set('telemetryEnabled', telemetryEnabled).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApi.settings.set('gatewayAutoStart', gatewayAutoStart).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApi.settings.set('gatewayPort', gatewayPort).catch(() => { });
      },
      setRoleMemoryEnabled: (roleMemoryEnabled) => {
        set({ roleMemoryEnabled });
        void hostApi.settings.set('roleMemoryEnabled', roleMemoryEnabled).catch(() => { });
      },
      setMemoryEmbeddingEnabled: (memoryEmbeddingEnabled) => {
        set({ memoryEmbeddingEnabled });
        void hostApi.settings.set('memoryEmbeddingEnabled', memoryEmbeddingEnabled).catch(() => { });
      },
      setCdpRemoteControlEnabled: (cdpRemoteControlEnabled) => {
        set({ cdpRemoteControlEnabled });
        void hostApi.settings.set('cdpRemoteControlEnabled', cdpRemoteControlEnabled).catch(() => { });
      },
      setCdpRemoteDebuggingPort: (cdpRemoteDebuggingPort) => {
        set({ cdpRemoteDebuggingPort });
        void hostApi.settings.set('cdpRemoteDebuggingPort', cdpRemoteDebuggingPort).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApi.settings.set('devModeUnlocked', devModeUnlocked).catch(() => { });
      },
      setUiDepthMode: (uiDepthMode) => set({ uiDepthMode }),
      setWorkProviderEnabled: (providerId, enabled) => {
        set((state) => {
          const workProviders = {
            ...(state.workProviders ?? {}),
            [providerId]: {
              ...(state.workProviders?.[providerId] ?? {}),
              enabled,
            },
          };
          void hostApi.settings.set('workProviders', workProviders).catch(() => { });
          return { workProviders };
        });
      },
      markSetupComplete: () => set({ setupComplete: true }),
      setSetupProviderVerification: (verification) => {
        set({ setupProviderVerification: verification });
        // Persist to the main-process store so the gateway host and support
        // bundle (FP-P1-06) see the same sanitized state.
        void hostApi.settings.set('setupProviderVerification', verification).catch(() => { });
      },
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'verse-claw-settings',
    }
  )
);
