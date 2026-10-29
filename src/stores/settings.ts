/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { changeLanguageWithResources } from '@/i18n';
import { hostApi } from '@/lib/host-api';
import { OPENCLAW_GATEWAY_PORT } from '@shared/gateway-endpoint';
import { resolveSupportedLanguage } from '@shared/language';
import type { WorkProviderConfig, WorkProviderId } from '@shared/types/work-provider';
import {
  DEFAULT_SETUP_PROVIDER_VERIFICATION,
  type SetupProviderVerification,
} from '@/lib/setup-provider';

type Theme = 'light' | 'dark' | 'system';
export type UiDepthMode = 'basic' | 'advanced';
export type SessionActivityAutoExpand = 'active' | 'attention' | 'never';
export type SessionActivityRetentionMinutes = 0 | 5 | 15;

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
  /**
   * Keep a finished turn's process disclosure open.
   *
   * Defaults to OFF. It used to default to on, which made `defaultExpanded`
   * permanently true for every completed turn — the whole process block
   * (thinking, execution graph, tool detail, terminals, diffs) stayed unfolded
   * forever and pushed the prompt that started the turn far off screen. Folding
   * by default is what makes a turn read as prompt → one line → answer; anyone
   * who preferred the old always-open behaviour can switch it back in
   * Settings → Session & Recovery.
   */
  runActivityKeepExpandedOnComplete: boolean;
  uiDepthMode: UiDepthMode;
  workProviders: WorkProviderConfig;
  sessionActivityPanelEnabled: boolean;
  sessionActivityAutoExpand: SessionActivityAutoExpand;
  sessionActivityShowGit: boolean;
  sessionActivityShowCommands: boolean;
  sessionRecoveryNotificationsEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  sessionActivityRetentionMinutes: SessionActivityRetentionMinutes;

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
  setRunActivityKeepExpandedOnComplete: (value: boolean) => void;
  setUiDepthMode: (value: UiDepthMode) => void;
  setWorkProviderEnabled: (providerId: WorkProviderId, enabled: boolean) => void;
  setSessionActivityPanelEnabled: (value: boolean) => void;
  setSessionActivityAutoExpand: (value: SessionActivityAutoExpand) => void;
  setSessionActivityShowGit: (value: boolean) => void;
  setSessionActivityShowCommands: (value: boolean) => void;
  setSessionRecoveryNotificationsEnabled: (value: boolean) => void;
  setDesktopNotificationsEnabled: (value: boolean) => void;
  setSessionActivityRetentionMinutes: (value: SessionActivityRetentionMinutes) => void;
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
  gatewayPort: OPENCLAW_GATEWAY_PORT,
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
  runActivityKeepExpandedOnComplete: false,
  uiDepthMode: 'basic' as UiDepthMode,
  workProviders: {} as WorkProviderConfig,
  sessionActivityPanelEnabled: true,
  sessionActivityAutoExpand: 'active' as SessionActivityAutoExpand,
  sessionActivityShowGit: true,
  sessionActivityShowCommands: true,
  sessionRecoveryNotificationsEnabled: true,
  desktopNotificationsEnabled: true,
  sessionActivityRetentionMinutes: 5 as SessionActivityRetentionMinutes,
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
            void changeLanguageWithResources(resolvedLanguage);
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
        void changeLanguageWithResources(resolvedLanguage);
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
      setRunActivityKeepExpandedOnComplete: (runActivityKeepExpandedOnComplete) => {
        set({ runActivityKeepExpandedOnComplete });
        void hostApi.settings.set('runActivityKeepExpandedOnComplete', runActivityKeepExpandedOnComplete).catch(() => { });
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
      setSessionActivityPanelEnabled: (value) => {
        set({ sessionActivityPanelEnabled: value });
        void hostApi.settings.set('sessionActivityPanelEnabled', value).catch(() => { });
      },
      setSessionActivityAutoExpand: (value) => {
        set({ sessionActivityAutoExpand: value });
        void hostApi.settings.set('sessionActivityAutoExpand', value).catch(() => { });
      },
      setSessionActivityShowGit: (value) => {
        set({ sessionActivityShowGit: value });
        void hostApi.settings.set('sessionActivityShowGit', value).catch(() => { });
      },
      setSessionActivityShowCommands: (value) => {
        set({ sessionActivityShowCommands: value });
        void hostApi.settings.set('sessionActivityShowCommands', value).catch(() => { });
      },
      setSessionRecoveryNotificationsEnabled: (value) => {
        set({ sessionRecoveryNotificationsEnabled: value });
        void hostApi.settings.set('sessionRecoveryNotificationsEnabled', value).catch(() => { });
      },
      setDesktopNotificationsEnabled: (value) => {
        set({ desktopNotificationsEnabled: value });
        void hostApi.settings.set('desktopNotificationsEnabled', value).catch(() => { });
      },
      setSessionActivityRetentionMinutes: (value) => {
        set({ sessionActivityRetentionMinutes: value });
        void hostApi.settings.set('sessionActivityRetentionMinutes', value).catch(() => { });
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
