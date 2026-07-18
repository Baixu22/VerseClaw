/**
 * Settings Page
 * Application configuration
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  ReceiptText,
  Sun,
  Moon,
  Monitor,
  Palette,
  RefreshCw,
  ExternalLink,
  Copy,
  FileText,
  RadioTower,
  MousePointerClick,
  Camera,
  MoveDown,
  ScanSearch,
  ShieldCheck,
  FolderOpen,
  Trash2,
  Cpu,
  Bot,
  Network,
  Puzzle,
  Server,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { SettingsSectionLoading } from './sections/SettingsSectionLoading';
import { toUserMessage } from '@/lib/error-message';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  trackUiEvent,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { hostApi, type OpenClawDoctorResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { recoverFromDynamicImportLoadError } from '@/lib/dynamic-import-recovery';
import type { SandboxNetworkPolicy, SandboxProviderId, SandboxProviderStatus } from '@shared/types/sandbox';
import type { KnowledgeWatchedDirectoryConfig } from '@shared/host-api/contract';
import { resolveSettingsSection, type SettingsSectionId } from './route-config';
import type { SettingsPresentation } from './SettingsRoute';

function getE2ESectionDelayMs(): number {
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2eSkipSetup') !== '1') return 0;
  const delay = Number(params.get('e2eSettingsSectionDelayMs'));
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 30_000) : 0;
}

function createPreloadableLazy<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const load = () => {
    if (!pending) {
      const modulePromise = loader();
      const delayMs = getE2ESectionDelayMs();
      pending = (delayMs > 0
        ? Promise.all([
            modulePromise,
            new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)),
          ]).then(([module]) => module)
        : modulePromise).catch((error) => {
          pending = null;
          recoverFromDynamicImportLoadError(error);
          throw error;
        });
    }
    return pending;
  };
  return { Component: lazy(load), preload: () => { void load(); } };
}

const settingsModels = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Models').then((m) => ({ default: m.Models })));
const settingsAgents = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Agents').then((m) => ({ default: m.Agents })));
const settingsChannels = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Channels').then((m) => ({ default: m.Channels })));
const settingsSkills = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Skills').then((m) => ({ default: m.Skills })));
const settingsBilling = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Billing').then((m) => ({ default: m.Billing })));
const settingsProjectRules = createPreloadableLazy<Record<string, never>>(() => import('@/components/settings/ProjectRulesCenter').then((m) => ({ default: m.ProjectRulesCenter as ComponentType<Record<string, never>> })));
const settingsAgentDev = createPreloadableLazy<Record<string, never>>(() => import('@/components/settings/AgentDevWorkbenchPanel').then((m) => ({ default: m.AgentDevWorkbenchPanel as ComponentType<Record<string, never>> })));
const settingsDcsProdFlags = createPreloadableLazy<Record<string, never>>(() => import('@/components/settings/DcsProdFlagsPanel').then((m) => ({ default: m.DcsProdFlagsPanel as ComponentType<Record<string, never>> })));
const settingsStorage = createPreloadableLazy<Record<string, never>>(() => import('./sections/StorageCleanerSection').then((m) => ({ default: m.StorageCleanerSection as ComponentType<Record<string, never>> })));

const SettingsModelsLazy = settingsModels.Component;
const SettingsAgentsLazy = settingsAgents.Component;
const SettingsChannelsLazy = settingsChannels.Component;
const SettingsSkillsLazy = settingsSkills.Component;
const SettingsBillingLazy = settingsBilling.Component;
const ProjectRulesCenterLazy = settingsProjectRules.Component;
const AgentDevWorkbenchPanelLazy = settingsAgentDev.Component;
const DcsProdFlagsPanelLazy = settingsDcsProdFlags.Component;
const StorageCleanerSectionLazy = settingsStorage.Component;
type ControlUiInfo = {
  port: number;
  hasToken: boolean;
};

function preloadSettingsSection(section: SettingsSectionId) {
  switch (section) {
    case 'models': settingsModels.preload(); break;
    case 'agents': settingsAgents.preload(); break;
    case 'channels': settingsChannels.preload(); break;
    case 'skills': settingsSkills.preload(); break;
    case 'billing': settingsBilling.preload(); break;
    case 'system': settingsProjectRules.preload(); break;
    case 'developer': settingsAgentDev.preload(); settingsDcsProdFlags.preload(); break;
    case 'storage': settingsStorage.preload(); break;
    default: break;
  }
}

function SettingsPageShell({ children, presentation }: { children: ReactNode; presentation: SettingsPresentation }) {
  return (
    <div
      data-testid="settings-page"
      data-presentation={presentation}
      className={cn(
        'flex flex-col overflow-hidden',
        presentation === 'drawer'
          ? 'settings-drawer-shell h-full bg-transparent'
          : '-m-6 h-[calc(100vh-2.5rem)] bg-background',
      )}
    >
      <div className={cn(
        'flex h-full w-full flex-col',
        presentation === 'drawer' ? 'px-5 py-5 sm:px-6' : 'mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-10',
      )}>
        {children}
      </div>
    </div>
  );
}

export function Settings({ presentation = 'page' }: { presentation?: SettingsPresentation }) {
  const { t, i18n } = useTranslation('settings');
  const location = useLocation();
  const navigate = useNavigate();
  const currentSection = resolveSettingsSection(location.pathname);
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    launchAtStartup,
    setLaunchAtStartup,
    gatewayAutoStart,
    setGatewayAutoStart,
    roleMemoryEnabled,
    setRoleMemoryEnabled,
    memoryEmbeddingEnabled,
    setMemoryEmbeddingEnabled,
    cdpRemoteControlEnabled,
    cdpRemoteDebuggingPort,
    setCdpRemoteControlEnabled,
    setCdpRemoteDebuggingPort,
    proxyEnabled,
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    setProxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    devModeUnlocked,
    setDevModeUnlocked,
    telemetryEnabled,
    setTelemetryEnabled,
    uiDepthMode,
    setUiDepthMode,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const [currentVersion, setCurrentVersion] = useState('0.0.0');
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [remoteControlStatus, setRemoteControlStatus] = useState<Awaited<ReturnType<typeof hostApi.remoteControl.status>> | null>(null);
  const [remoteControlInspect, setRemoteControlInspect] = useState<Awaited<ReturnType<typeof hostApi.remoteControl.inspect>> | null>(null);
  const [remoteControlTargetId, setRemoteControlTargetId] = useState('');
  const [remoteControlPageInfo, setRemoteControlPageInfo] = useState<Awaited<ReturnType<typeof hostApi.remoteControl.pageInfo>> | null>(null);
  const [remoteControlScreenshot, setRemoteControlScreenshot] = useState<Awaited<ReturnType<typeof hostApi.remoteControl.screenshot>> | null>(null);
  const [cdpEnabledDraft, setCdpEnabledDraft] = useState(false);
  const [cdpPortDraft, setCdpPortDraft] = useState('9222');
  const [savingCdp, setSavingCdp] = useState(false);
  const [inspectingCdp, setInspectingCdp] = useState(false);
  const [remoteAction, setRemoteAction] = useState<string | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<Awaited<ReturnType<typeof hostApi.sandbox.status>> | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);

  const isWindows = window.electron.platform === 'win32';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');

  useEffect(() => {
    if (currentSection !== 'general') return;
    let cancelled = false;
    void hostApi.app.version()
      .then((version) => {
        if (!cancelled) setCurrentVersion(version);
      })
      .catch(() => {
        if (!cancelled) setCurrentVersion('0.0.0');
      });
    return () => {
      cancelled = true;
    };
  }, [currentSection]);
  const [doctorRunningMode, setDoctorRunningMode] = useState<'diagnose' | 'fix' | null>(null);
  const [doctorResult, setDoctorResult] = useState<OpenClawDoctorResult | null>(null);
  const [watchedDirectories, setWatchedDirectories] = useState<KnowledgeWatchedDirectoryConfig[]>([]);
  const [watchedDirectoryPath, setWatchedDirectoryPath] = useState('');
  const [watchedDirectoryPatterns, setWatchedDirectoryPatterns] = useState('**/*.md');
  const [watchedIngestNewFiles, setWatchedIngestNewFiles] = useState(true);
  const [watchedRequiresReview, setWatchedRequiresReview] = useState(true);
  const [watchedAutoCompile, setWatchedAutoCompile] = useState(true);
  const [watchedLoading, setWatchedLoading] = useState(false);
  const handleShowLogs = async () => {
    try {
      const logs = await hostApi.logs.recent(100);
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApi.logs.dir();
      if (logDir) {
        await hostApi.shell.showItemInFolder(logDir);
      }
    } catch {
      // ignore
    }
  };

  const refreshWatchedDirectories = useCallback(async () => {
    try {
      setWatchedDirectories(await hostApi.knowledge.listWatchedDirectories());
    } catch (error) {
      toast.error(t('knowledgeHub.watched.loadFailed', { error: toUserMessage(error) || String(error) }));
    }
  }, [t]);

  useEffect(() => {
    if (currentSection !== 'system') return;
    void refreshWatchedDirectories();
  }, [currentSection, refreshWatchedDirectories]);

  const handlePickWatchedDirectory = useCallback(async () => {
    try {
      const result = await hostApi.dialog.open({
        title: t('knowledgeHub.watched.pickTitle'),
        properties: ['openDirectory'],
      });
      if (!result.canceled && result.filePaths?.[0]) {
        setWatchedDirectoryPath(result.filePaths[0]);
      }
    } catch (error) {
      toast.error(t('knowledgeHub.watched.pickFailed', { error: toUserMessage(error) || String(error) }));
    }
  }, [t]);

  const handleAddWatchedDirectory = useCallback(async () => {
    const path = watchedDirectoryPath.trim();
    const patterns = watchedDirectoryPatterns
      .split(',')
      .map((pattern) => pattern.trim())
      .filter(Boolean);
    if (!path) {
      toast.error(t('knowledgeHub.watched.pathRequired'));
      return;
    }
    if (patterns.length === 0) {
      toast.error(t('knowledgeHub.watched.patternRequired'));
      return;
    }
    setWatchedLoading(true);
    try {
      const result = await hostApi.knowledge.addWatchedDirectory({
        id: '',
        path,
        patterns,
        enabled: true,
        ingestNewFiles: watchedIngestNewFiles,
        requiresReview: watchedRequiresReview,
        autoCompile: watchedAutoCompile,
      });
      if (!result.success) {
        throw new Error(result.error || t('knowledgeHub.watched.addFailed'));
      }
      setWatchedDirectoryPath('');
      setWatchedDirectoryPatterns('**/*.md');
      setWatchedIngestNewFiles(true);
      setWatchedRequiresReview(true);
      setWatchedAutoCompile(true);
      await refreshWatchedDirectories();
      toast.success(t('knowledgeHub.watched.added'));
    } catch (error) {
      toast.error(t('knowledgeHub.watched.addFailedWithError', { error: toUserMessage(error) || String(error) }));
    } finally {
      setWatchedLoading(false);
    }
  }, [
    refreshWatchedDirectories,
    t,
    watchedAutoCompile,
    watchedDirectoryPath,
    watchedDirectoryPatterns,
    watchedIngestNewFiles,
    watchedRequiresReview,
  ]);

  const handleUpdateWatchedDirectory = useCallback(async (
    id: string,
    updates: Partial<KnowledgeWatchedDirectoryConfig>,
  ) => {
    try {
      const result = await hostApi.knowledge.updateWatchedDirectory(id, updates);
      if (!result.success) {
        throw new Error(result.error || t('knowledgeHub.watched.updateFailed'));
      }
      await refreshWatchedDirectories();
    } catch (error) {
      toast.error(t('knowledgeHub.watched.updateFailedWithError', { error: toUserMessage(error) || String(error) }));
    }
  }, [refreshWatchedDirectories, t]);

  const handleRemoveWatchedDirectory = useCallback(async (id: string) => {
    try {
      const result = await hostApi.knowledge.removeWatchedDirectory(id);
      if (!result.success) {
        throw new Error(result.error || t('knowledgeHub.watched.removeFailed'));
      }
      await refreshWatchedDirectories();
      toast.success(t('knowledgeHub.watched.removed'));
    } catch (error) {
      toast.error(t('knowledgeHub.watched.removeFailedWithError', { error: toUserMessage(error) || String(error) }));
    }
  }, [refreshWatchedDirectories, t]);

  const handleRunOpenClawDoctor = async (mode: 'diagnose' | 'fix') => {
    setDoctorRunningMode(mode);
    try {
      const result = await hostApi.app.openClawDoctor(mode);
      setDoctorResult(result);
      if (result.success) {
        toast.success(mode === 'fix' ? t('developer.doctorFixSucceeded') : t('developer.doctorSucceeded'));
      } else {
        toast.error(result.error || (mode === 'fix' ? t('developer.doctorFixFailed') : t('developer.doctorFailed')));
      }
    } catch (error) {
      const message = toUserMessage(error) || (mode === 'fix' ? t('developer.doctorFixRunFailed') : t('developer.doctorRunFailed'));
      toast.error(message);
      setDoctorResult({
        mode,
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        command: 'openclaw doctor',
        cwd: '',
        durationMs: 0,
        error: message,
      });
    } finally {
      setDoctorRunningMode(null);
    }
  };

  const handleCopyDoctorOutput = async () => {
    if (!doctorResult) return;
    const payload = [
      `command: ${doctorResult.command}`,
      `cwd: ${doctorResult.cwd}`,
      `exitCode: ${doctorResult.exitCode ?? 'null'}`,
      `durationMs: ${doctorResult.durationMs}`,
      '',
      '[stdout]',
      doctorResult.stdout.trim() || '(empty)',
      '',
      '[stderr]',
      doctorResult.stderr.trim() || '(empty)',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(payload);
      toast.success(t('developer.doctorCopied'));
    } catch (error) {
      toast.error(`Failed to copy doctor output: ${String(error)}`);
    }
  };



  const refreshControlUiInfo = async () => {
    try {
      // Meta-only: never request token plaintext into Renderer state.
      const result = await hostApi.gateway.controlUi({ open: false });
      if (result.success && typeof result.port === 'number') {
        setControlUiInfo({
          port: result.port,
          hasToken: result.hasToken === true,
        });
      }
    } catch {
      // Ignore refresh errors
    }
  };

  const refreshRemoteControlStatus = async () => {
    try {
      const result = await hostApi.remoteControl.status();
      setRemoteControlStatus(result);
    } catch {
      setRemoteControlStatus(null);
    }
  };

  const handleInspectRemoteControl = async () => {
    setInspectingCdp(true);
    try {
      const result = await hostApi.remoteControl.inspect();
      setRemoteControlInspect(result);
      const preferredTarget = result.targets.find((target) => (
        target.title === 'ClawX' || target.url?.includes('localhost:5173')
      )) ?? result.targets.find((target) => target.type === 'page') ?? result.targets[0];
      if (preferredTarget?.id) {
        setRemoteControlTargetId(preferredTarget.id);
      }
      if (result.success) {
        toast.success(t('remoteControl.toast.connected', { count: result.targets.length }));
      } else {
        toast.error(result.error || t('remoteControl.toast.connectFailed'));
      }
    } catch (error) {
      toast.error(t('remoteControl.toast.connectFailedWithError', { error: toUserMessage(error) }));
    } finally {
      setInspectingCdp(false);
    }
  };

  const remoteTargetPayload = () => (
    remoteControlTargetId ? { targetId: remoteControlTargetId } : undefined
  );

  const runRemoteAction = async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
    setRemoteAction(label);
    try {
      return await action();
    } catch (error) {
      toast.error(t('remoteControl.toast.actionFailed', { action: label, error: toUserMessage(error) }));
      return null;
    } finally {
      setRemoteAction(null);
    }
  };

  const handleRemotePageInfo = async () => {
    const result = await runRemoteAction(t('remoteControl.actions.pageInfo'), () => hostApi.remoteControl.pageInfo(remoteTargetPayload()));
    if (!result) return;
    setRemoteControlPageInfo(result);
    if (result.success) {
      toast.success(t('remoteControl.toast.pageInfoRefreshed'));
    } else {
      toast.error(result.error || t('remoteControl.toast.pageInfoFailed'));
    }
  };

  const handleRemoteScroll = async (deltaY: number) => {
    const result = await runRemoteAction(t('remoteControl.actions.scroll'), () => hostApi.remoteControl.scroll({
      ...remoteTargetPayload(),
      deltaY,
    }));
    if (result?.success) {
      await handleRemotePageInfo();
    } else if (result) {
      toast.error(result.error || t('remoteControl.toast.scrollFailed'));
    }
  };

  const handleRemoteClickCenter = async () => {
    const info = remoteControlPageInfo?.success ? remoteControlPageInfo : await hostApi.remoteControl.pageInfo(remoteTargetPayload());
    const x = Math.round((info.viewport?.width ?? 1000) / 2);
    const y = Math.round((info.viewport?.height ?? 700) / 2);
    const result = await runRemoteAction(t('remoteControl.actions.click'), () => hostApi.remoteControl.click({
      ...remoteTargetPayload(),
      x,
      y,
    }));
    if (result?.success) {
      toast.success(t('remoteControl.toast.clickedCenter', { x, y }));
    } else if (result) {
      toast.error(result.error || t('remoteControl.toast.clickFailed'));
    }
  };

  const handleRemoteScreenshot = async () => {
    const result = await runRemoteAction(t('remoteControl.actions.screenshot'), () => hostApi.remoteControl.screenshot({
      ...remoteTargetPayload(),
      fullPage: true,
      format: 'png',
    }));
    if (!result) return;
    setRemoteControlScreenshot(result);
    if (result.success) {
      toast.success(t('remoteControl.toast.screenshotReady'));
    } else {
      toast.error(result.error || t('remoteControl.toast.screenshotFailed'));
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.hasToken) return;
    try {
      // Main writes clipboard; Renderer never sees the secret.
      await hostApi.gateway.copyGatewayToken();
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (currentSection !== 'developer' || !showCliTools) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await hostApi.openclaw.getCliCommand();
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || 'OpenClaw CLI unavailable');
        }
      } catch (error) {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      }
    })();

    return () => { cancelled = true; };
  }, [currentSection, devModeUnlocked, showCliTools]);

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(`Failed to copy command: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (currentSection !== 'developer') return;
    const unsubscribe = hostEvents.onOpenClawCliInstalled((installedPath) => {
      toast.success(`openclaw CLI installed at ${installedPath}`);
    });
    return () => { unsubscribe?.(); };
  }, [currentSection]);

  useEffect(() => {
    if (currentSection !== 'developer' || !devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    const unsubscribe = subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    });
    return unsubscribe;
  }, [currentSection, devModeUnlocked]);

  useEffect(() => {
    setProxyEnabledDraft(proxyEnabled);
  }, [proxyEnabled]);

  useEffect(() => {
    setCdpEnabledDraft(cdpRemoteControlEnabled);
  }, [cdpRemoteControlEnabled]);

  useEffect(() => {
    setCdpPortDraft(String(cdpRemoteDebuggingPort || 9222));
  }, [cdpRemoteDebuggingPort]);

  useEffect(() => {
    if (currentSection !== 'system') return;
    void refreshRemoteControlStatus();
  }, [cdpRemoteControlEnabled, cdpRemoteDebuggingPort, currentSection]);

  const refreshSandboxStatus = useCallback(async () => {
    setSandboxLoading(true);
    try {
      setSandboxStatus(await hostApi.sandbox.status());
    } catch (error) {
      toast.error(`${t('sandbox.loadFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSandboxLoading(false);
    }
  }, [t]);

  const updateSandboxProfile = async (patch: {
    providerId?: SandboxProviderId;
    networkPolicy?: SandboxNetworkPolicy;
  }) => {
    setSandboxLoading(true);
    try {
      await hostApi.sandbox.updateProfile({
        id: 'default',
        name: t('sandbox.defaultProfileName'),
        providerId: patch.providerId ?? sandboxStatus?.requestedProviderId ?? 'policy-light',
        networkPolicy: patch.networkPolicy ?? sandboxStatus?.networkPolicy ?? 'disabled',
      });
      setSandboxStatus(await hostApi.sandbox.status());
      toast.success(t('sandbox.profileSaved'));
    } catch (error) {
      toast.error(`${t('sandbox.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSandboxLoading(false);
    }
  };

  useEffect(() => {
    if (currentSection !== 'developer' || !devModeUnlocked) return;
    void refreshSandboxStatus();
  }, [currentSection, devModeUnlocked, refreshSandboxStatus]);

  useEffect(() => {
    setProxyServerDraft(proxyServer);
  }, [proxyServer]);

  useEffect(() => {
    setProxyHttpServerDraft(proxyHttpServer);
  }, [proxyHttpServer]);

  useEffect(() => {
    setProxyHttpsServerDraft(proxyHttpsServer);
  }, [proxyHttpsServer]);

  useEffect(() => {
    setProxyAllServerDraft(proxyAllServer);
  }, [proxyAllServer]);

  useEffect(() => {
    setProxyBypassRulesDraft(proxyBypassRules);
  }, [proxyBypassRules]);

  const proxySettingsDirty = useMemo(() => {
    return (
      proxyEnabledDraft !== proxyEnabled
      || proxyServerDraft.trim() !== proxyServer
      || proxyHttpServerDraft.trim() !== proxyHttpServer
      || proxyHttpsServerDraft.trim() !== proxyHttpsServer
      || proxyAllServerDraft.trim() !== proxyAllServer
      || proxyBypassRulesDraft.trim() !== proxyBypassRules
    );
  }, [
    proxyAllServer,
    proxyAllServerDraft,
    proxyBypassRules,
    proxyBypassRulesDraft,
    proxyEnabled,
    proxyEnabledDraft,
    proxyHttpServer,
    proxyHttpServerDraft,
    proxyHttpsServer,
    proxyHttpsServerDraft,
    proxyServer,
    proxyServerDraft,
  ]);

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();
      await hostApi.settings.setMany({
        proxyEnabled: proxyEnabledDraft,
        proxyServer: normalizedProxyServer,
        proxyHttpServer: normalizedHttpServer,
        proxyHttpsServer: normalizedHttpsServer,
        proxyAllServer: normalizedAllServer,
        proxyBypassRules: normalizedBypassRules,
      });

      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxyEnabled(proxyEnabledDraft);

      toast.success(t('gateway.proxySaved'));
      trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
    } catch (error) {
      toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingProxy(false);
    }
  };

  const handleSaveCdpSettings = async () => {
    const port = Number(cdpPortDraft);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      toast.error(t('remoteControl.toast.invalidPort'));
      return;
    }
    setSavingCdp(true);
    try {
      await hostApi.settings.setMany({
        cdpRemoteControlEnabled: cdpEnabledDraft,
        cdpRemoteDebuggingPort: port,
      });
      setCdpRemoteControlEnabled(cdpEnabledDraft);
      setCdpRemoteDebuggingPort(port);
      await refreshRemoteControlStatus();
      toast.success(t('remoteControl.toast.saved'));
    } catch (error) {
      toast.error(t('remoteControl.toast.saveFailed', { error: toUserMessage(error) }));
    } finally {
      setSavingCdp(false);
    }
  };

  const remoteControlSection = (
    <div className="space-y-4 rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-5" data-testid="settings-remote-control-section">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-foreground/70" />
            <Label className="text-sm font-medium text-foreground">{t('remoteControl.title')}</Label>
            <Badge variant={remoteControlStatus?.effectiveEnabled ? 'secondary' : 'outline'} className="rounded-full">
              {remoteControlStatus?.effectiveEnabled ? t('remoteControl.status.effective') : t('remoteControl.status.inactive')}
            </Badge>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            {t('remoteControl.description')}
          </p>
        </div>
        <Switch
          checked={cdpEnabledDraft}
          onCheckedChange={setCdpEnabledDraft}
          data-testid="settings-cdp-toggle"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <Label htmlFor="cdp-port" className="text-meta text-foreground/80">{t('remoteControl.port')}</Label>
          <Input
            id="cdp-port"
            value={cdpPortDraft}
            onChange={(event) => setCdpPortDraft(event.target.value)}
            className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
            inputMode="numeric"
            data-testid="settings-cdp-port"
          />
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>{t('remoteControl.configEndpoint', { port: cdpPortDraft || '9222' })}</p>
          <p>{t('remoteControl.currentEndpoint', { endpoint: remoteControlStatus?.endpoint || '-' })}</p>
          {remoteControlStatus?.envOverride && (
            <p className="text-amber-600 dark:text-amber-300">{t('remoteControl.envOverride')}</p>
          )}
          {remoteControlStatus?.restartRequired && (
            <p className="text-amber-600 dark:text-amber-300">{t('remoteControl.restartRequired')}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => void handleSaveCdpSettings()}
          disabled={savingCdp}
          className="rounded-xl h-10 px-5 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', savingCdp && 'animate-spin')} />
          {savingCdp ? t('common:status.saving') : t('common:actions.save')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void refreshRemoteControlStatus()}
          className="rounded-xl h-10 px-4 hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('remoteControl.actions.refreshStatus')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void handleInspectRemoteControl()}
          disabled={inspectingCdp}
          data-testid="settings-cdp-inspect"
          className="rounded-xl h-10 px-4 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <RadioTower className={cn('h-4 w-4 mr-2', inspectingCdp && 'animate-pulse')} />
          {inspectingCdp ? t('remoteControl.actions.connecting') : t('remoteControl.actions.connectDebug')}
        </Button>
      </div>
      {remoteControlInspect && (
        <div className="rounded-xl bg-black/5 dark:bg-white/5 p-3 text-xs text-muted-foreground space-y-2">
          <div className="grid gap-1 font-mono">
            <p>{t('remoteControl.inspect.result', { result: remoteControlInspect.success ? t('remoteControl.inspect.success') : t('remoteControl.inspect.failure') })}</p>
            <p>Browser：{remoteControlInspect.browser || '-'}</p>
            <p>Protocol：{remoteControlInspect.protocolVersion || '-'}</p>
            <p>WebSocket：{remoteControlInspect.webSocketDebuggerUrl || '-'}</p>
            {!remoteControlInspect.success && remoteControlInspect.error && (
              <p className="text-destructive">{remoteControlInspect.error}</p>
            )}
          </div>
          {remoteControlInspect.targets.length > 0 && (
            <div className="space-y-1">
              <p className="text-foreground/80">{t('remoteControl.inspect.targets')}</p>
              {remoteControlInspect.targets.slice(0, 5).map((target) => (
                <button
                  key={target.id || target.webSocketDebuggerUrl || target.url}
                  type="button"
                  onClick={() => target.id && setRemoteControlTargetId(target.id)}
                  className={cn(
                    'block w-full rounded-lg px-3 py-2 text-left transition-colors',
                    remoteControlTargetId === target.id
                      ? 'bg-primary/10 text-foreground ring-1 ring-primary/20'
                      : 'bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10',
                  )}
                >
                  <p className="text-foreground truncate">{target.title || target.type || 'Untitled'}</p>
                  <p className="font-mono truncate">{target.url || '-'}</p>
                </button>
              ))}
            </div>
          )}
          {remoteControlInspect.targets.length > 0 && (
            <div className="space-y-3 border-t border-black/5 pt-3 dark:border-white/5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemotePageInfo()}
                  disabled={remoteAction !== null}
                  className="h-8 rounded-full px-3"
                >
                  <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                  {t('remoteControl.actions.pageInfo')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemoteScroll(560)}
                  disabled={remoteAction !== null}
                  className="h-8 rounded-full px-3"
                >
                  <MoveDown className="mr-1.5 h-3.5 w-3.5" />
                  {t('remoteControl.actions.scrollDown')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemoteClickCenter()}
                  disabled={remoteAction !== null}
                  className="h-8 rounded-full px-3"
                >
                  <MousePointerClick className="mr-1.5 h-3.5 w-3.5" />
                  {t('remoteControl.actions.clickCenter')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemoteScreenshot()}
                  disabled={remoteAction !== null}
                  data-testid="settings-cdp-screenshot"
                  className="h-8 rounded-full px-3"
                >
                  <Camera className="mr-1.5 h-3.5 w-3.5" />
                  {t('remoteControl.actions.screenshot')}
                </Button>
                {remoteAction && (
                  <span className="text-xs text-muted-foreground">{t('remoteControl.actions.running', { action: remoteAction })}</span>
                )}
              </div>
              {remoteControlPageInfo && (
                <div className="rounded-lg bg-black/5 px-3 py-2 font-mono dark:bg-white/5">
                  <p className={remoteControlPageInfo.success ? 'text-foreground' : 'text-destructive'}>
                    {remoteControlPageInfo.success ? (remoteControlPageInfo.title || 'Untitled') : remoteControlPageInfo.error}
                  </p>
                  {remoteControlPageInfo.success && (
                    <>
                      <p className="truncate">{remoteControlPageInfo.url || '-'}</p>
                      <p>
                        viewport {remoteControlPageInfo.viewport?.width ?? '-'}x{remoteControlPageInfo.viewport?.height ?? '-'}
                        {' / '}
                        scroll {remoteControlPageInfo.scroll?.y ?? 0}/{remoteControlPageInfo.scroll?.height ?? '-'}
                      </p>
                    </>
                  )}
                </div>
              )}
              {remoteControlScreenshot?.success && remoteControlScreenshot.dataUrl && (
                <div className="overflow-hidden rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5">
                  <img
                    src={remoteControlScreenshot.dataUrl}
                    alt={t('remoteControl.screenshotAlt')}
                    className="max-h-72 w-full object-contain"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const legacySandboxRuntimeSection = (
    <div className="space-y-4 rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-5" data-testid="settings-sandbox-runtime-section">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-foreground/70" />
            <Label className="text-sm font-medium text-foreground">{t('sandbox.title')}</Label>
            <Badge variant={sandboxStatus?.runtimeLevel === 'strong' ? 'secondary' : 'outline'} className="rounded-full">
              {sandboxStatus?.runtimeLevel === 'strong'
                ? t('sandbox.runtimeLevels.strong')
                : sandboxStatus?.runtimeLevel === 'light'
                  ? t('sandbox.runtimeLevels.light')
                  : t('sandbox.runtimeLevels.policy')}
            </Badge>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            {t('sandbox.description')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refreshSandboxStatus()}
          disabled={sandboxLoading}
          className="rounded-xl h-9 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', sandboxLoading && 'animate-spin')} />
          {t('sandbox.refresh')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] p-3">
          <p className="text-tiny text-muted-foreground">Provider</p>
          <p className="mt-1 truncate text-sm text-foreground">{sandboxStatus?.provider.label ?? t('sandbox.loading')}</p>
        </div>
        <div className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] p-3">
          <p className="text-tiny text-muted-foreground">{t('sandbox.permissionMode')}</p>
          <p className="mt-1 font-mono text-sm text-foreground">{sandboxStatus?.permissionMode ?? '-'}</p>
        </div>
        <div className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] p-3">
          <p className="text-tiny text-muted-foreground">Workspace Access</p>
          <p className="mt-1 font-mono text-sm text-foreground">
            {sandboxStatus?.openClawConfig.agents.defaults.sandbox.workspaceAccess ?? '-'}
          </p>
        </div>
        <div className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] p-3">
          <p className="text-tiny text-muted-foreground">{t('sandbox.networkPolicy')}</p>
          <p className="mt-1 font-mono text-sm text-foreground">{sandboxStatus?.networkPolicy ?? 'disabled'}</p>
        </div>
      </div>

      {sandboxStatus?.warnings.length ? (
        <div className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          {sandboxStatus.warnings.map((warning: string) => (
            <p key={warning} className="text-xs text-amber-900 dark:text-amber-200">{warning}</p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {sandboxStatus?.providers.map((provider: SandboxProviderStatus) => (
          <div key={provider.id} className="rounded-xl border border-black/5 dark:border-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-foreground">{provider.label}</p>
              <Badge variant={provider.available ? 'secondary' : 'outline'} className="rounded-full text-2xs">
                {provider.available ? t('sandbox.available') : t('sandbox.unavailable')}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{provider.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );

  void legacySandboxRuntimeSection;

  const sandboxProviderOptions = sandboxStatus?.providers ?? [];
  const sandboxDockerChecks = [
    { key: 'cli', ok: sandboxStatus?.docker?.cli ?? false },
    { key: 'daemon', ok: sandboxStatus?.docker?.daemon ?? false },
    { key: 'image', ok: sandboxStatus?.docker?.image ?? false },
  ] as const;
  const sandboxExecPolicy = sandboxStatus
    ? `${sandboxStatus.execPolicy.host}/${sandboxStatus.execPolicy.security}/${sandboxStatus.execPolicy.ask}`
    : '-';

  const sandboxRuntimeSection = (
    <div className="space-y-4 rounded-lg border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]" data-testid="settings-sandbox-runtime-section">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-foreground/70" />
            <Label className="text-sm font-medium text-foreground">{t('sandbox.title')}</Label>
            <Badge variant={sandboxStatus?.runtimeLevel === 'strong' ? 'secondary' : 'outline'} className="rounded-full" data-testid="settings-sandbox-runtime-level">
              {sandboxStatus ? t(`sandbox.runtimeLevels.${sandboxStatus.runtimeLevel}`) : t('sandbox.loading')}
            </Badge>
            {sandboxStatus?.degraded && (
              <Badge variant="outline" className="rounded-full border-amber-500/30 text-amber-700 dark:text-amber-300" data-testid="settings-sandbox-degraded">
                {t('sandbox.degraded')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            {t('sandbox.description')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {sandboxStatus?.degraded && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void updateSandboxProfile({ providerId: 'policy-light' })}
              disabled={sandboxLoading}
              className="h-9 rounded-lg border-black/10 bg-transparent px-3 dark:border-white/10"
              data-testid="settings-sandbox-fallback-policy-light"
            >
              {t('sandbox.fallbackToPolicy')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshSandboxStatus()}
            disabled={sandboxLoading}
            className="h-9 rounded-lg border-black/10 bg-transparent px-3 dark:border-white/10"
            data-testid="settings-sandbox-refresh"
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', sandboxLoading && 'animate-spin')} />
            {t('sandbox.refresh')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('sandbox.requestedProvider')}</Label>
          <Select
            value={sandboxStatus?.requestedProviderId ?? 'policy-light'}
            onValueChange={(value) => void updateSandboxProfile({ providerId: value as SandboxProviderId })}
            disabled={sandboxLoading}
          >
            <SelectTrigger className="h-9 rounded-lg border-black/10 bg-background dark:border-white/10" data-testid="settings-sandbox-provider-select">
              <SelectValue placeholder={t('sandbox.requestedProvider')} />
            </SelectTrigger>
            <SelectContent>
              {sandboxProviderOptions.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('sandbox.networkPolicy')}</Label>
          <Select
            value={sandboxStatus?.networkPolicy ?? 'disabled'}
            onValueChange={(value) => void updateSandboxProfile({ networkPolicy: value as SandboxNetworkPolicy })}
            disabled={sandboxLoading}
          >
            <SelectTrigger className="h-9 rounded-lg border-black/10 bg-background dark:border-white/10" data-testid="settings-sandbox-network-select">
              <SelectValue placeholder={t('sandbox.networkPolicy')} />
            </SelectTrigger>
            <SelectContent>
              {(['disabled', 'approvalRequired', 'enabled'] as SandboxNetworkPolicy[]).map((policy) => (
                <SelectItem key={policy} value={policy}>
                  {t(`sandbox.networkPolicies.${policy}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['degraded', t('sandbox.degraded'), sandboxStatus ? (sandboxStatus.degraded ? t('sandbox.degradedYes') : t('sandbox.degradedNo')) : '-'],
          ['requestedProviderId', t('sandbox.requestedProvider'), sandboxStatus?.requestedProviderId ?? '-'],
          ['effectiveProviderId', t('sandbox.effectiveProvider'), sandboxStatus?.effectiveProviderId ?? '-'],
          ['permissionMode', t('sandbox.permissionMode'), sandboxStatus?.permissionMode ?? '-'],
          ['workspaceAccess', t('sandbox.workspaceAccess'), sandboxStatus?.workspaceAccess ?? '-'],
          ['execPolicy', t('sandbox.execPolicy'), sandboxExecPolicy],
          ['networkPolicy', t('sandbox.networkPolicy'), sandboxStatus?.networkPolicy ?? '-'],
          ['openClawMode', t('sandbox.openClawMode'), sandboxStatus?.openClawConfig.agents.defaults.sandbox.mode ?? '-'],
          ['updatedAt', t('sandbox.updatedAt'), sandboxStatus ? new Date(sandboxStatus.updatedAt).toLocaleTimeString() : '-'],
        ].map(([key, label, value]) => (
          <div key={key} className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]" data-testid={`settings-sandbox-field-${key}`}>
            <p className="text-tiny text-muted-foreground">{label}</p>
            <p className="mt-1 truncate font-mono text-sm text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {sandboxStatus?.degradeReason && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200" data-testid="settings-sandbox-degrade-reason">
          {sandboxStatus.degradeReason}
        </div>
      )}

      {sandboxStatus?.warnings.length ? (
        <div className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          {sandboxStatus.warnings.map((warning: string) => (
            <p key={warning} className="text-xs text-amber-900 dark:text-amber-200">{warning}</p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.5fr)]">
        <div className="grid gap-2 sm:grid-cols-2">
          {sandboxProviderOptions.map((provider: SandboxProviderStatus) => (
            <div key={provider.id} className="rounded-lg border border-black/5 p-3 dark:border-white/5" data-testid={`settings-sandbox-provider-${provider.id}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-foreground">{provider.label}</p>
                <Badge variant={provider.available ? 'secondary' : 'outline'} className="rounded-full text-2xs">
                  {provider.available ? t('sandbox.available') : t('sandbox.unavailable')}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{provider.reason}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-black/5 p-3 dark:border-white/5" data-testid="settings-sandbox-docker-checks">
          <p className="text-xs font-medium text-foreground">{t('sandbox.dockerChecks')}</p>
          <div className="mt-2 space-y-2">
            {sandboxDockerChecks.map((check) => (
              <div key={check.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{t(`sandbox.docker.${check.key}`)}</span>
                <Badge variant={check.ok ? 'secondary' : 'outline'} className="rounded-full text-2xs">
                  {check.ok ? t('sandbox.ok') : t('sandbox.missing')}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const telemetryStats = useMemo(() => {
    let errorCount = 0;
    let slowCount = 0;
    for (const entry of telemetryEntries) {
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        errorCount += 1;
      }
      const durationMs = typeof entry.payload.durationMs === 'number'
        ? entry.payload.durationMs
        : Number.NaN;
      if (Number.isFinite(durationMs) && durationMs >= 800) {
        slowCount += 1;
      }
    }
    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<string, {
      event: string;
      count: number;
      errorCount: number;
      slowCount: number;
      totalDuration: number;
      timedCount: number;
      lastTs: string;
    }>();

    for (const entry of telemetryEntries) {
      const current = map.get(entry.event) ?? {
        event: entry.event,
        count: 0,
        errorCount: 0,
        slowCount: 0,
        totalDuration: 0,
        timedCount: 0,
        lastTs: entry.ts,
      };

      current.count += 1;
      current.lastTs = entry.ts;

      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        current.errorCount += 1;
      }

      const durationMs = typeof entry.payload.durationMs === 'number'
        ? entry.payload.durationMs
        : Number.NaN;
      if (Number.isFinite(durationMs)) {
        current.totalDuration += durationMs;
        current.timedCount += 1;
        if (durationMs >= 800) {
          current.slowCount += 1;
        }
      }

      map.set(entry.event, current);
    }

    return [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [telemetryEntries]);

  const handleCopyTelemetry = async () => {
    try {
      const serialized = telemetryEntries.map((entry) => JSON.stringify(entry)).join('\n');
      await navigator.clipboard.writeText(serialized);
      toast.success(t('developer.telemetryCopied'));
    } catch (error) {
      toast.error(`${t('common:status.error')}: ${String(error)}`);
    }
  };

  const handleClearTelemetry = () => {
    clearUiTelemetry();
    setTelemetryEntries([]);
    toast.success(t('developer.telemetryCleared'));
  };

  const handleLanguageChange = (nextLanguage: string) => {
    if (nextLanguage === language) return;
    const translateNext = i18n.getFixedT(nextLanguage, 'settings');
    setLanguage(nextLanguage);
    toast.success(translateNext('appearance.menuLanguageUpdated'));
  };

  const sectionMeta = {
    general: {
      title: t('navigation.general.title'),
      description: t('navigation.general.description'),
    },
    models: {
      title: t('navigation.models.title'),
      description: t('navigation.models.description'),
    },
    agents: {
      title: t('navigation.agents.title'),
      description: t('navigation.agents.description'),
    },
    channels: {
      title: t('navigation.channels.title'),
      description: t('navigation.channels.description'),
    },
    skills: {
      title: t('navigation.skills.title'),
      description: t('navigation.skills.description'),
    },
    system: {
      title: t('navigation.system.title'),
      description: t('navigation.system.description'),
    },
    developer: {
      title: t('navigation.developer.title'),
      description: t('navigation.developer.description'),
    },
    billing: {
      title: t('navigation.billing.title'),
      description: t('navigation.billing.description'),
    },
    storage: {
      title: t('navigation.storage.title'),
      description: t('navigation.storage.description'),
    },
  } satisfies Record<Exclude<SettingsSectionId, 'overview'>, { title: string; description: string }>;

  const settingsSections = [
    {
      id: 'general',
      to: '/settings/general',
      icon: <Palette className="h-5 w-5" />,
      ...sectionMeta.general,
      testId: 'settings-nav-general',
    },
    {
      id: 'models',
      to: '/settings/models',
      icon: <Cpu className="h-5 w-5" />,
      ...sectionMeta.models,
      testId: 'settings-nav-models',
    },
    {
      id: 'agents',
      to: '/settings/agents',
      icon: <Bot className="h-5 w-5" />,
      ...sectionMeta.agents,
      testId: 'settings-nav-agents',
    },
    {
      id: 'skills',
      to: '/settings/skills',
      icon: <Puzzle className="h-5 w-5" />,
      ...sectionMeta.skills,
      testId: 'settings-nav-skills',
    },
    {
      id: 'channels',
      to: '/settings/channels',
      icon: <Network className="h-5 w-5" />,
      ...sectionMeta.channels,
      testId: 'settings-nav-channels',
    },
    {
      id: 'system',
      to: '/settings/system',
      icon: <Server className="h-5 w-5" />,
      ...sectionMeta.system,
      testId: 'settings-nav-system',
    },
    {
      id: 'developer',
      to: '/settings/developer',
      icon: <Wrench className="h-5 w-5" />,
      ...sectionMeta.developer,
      testId: 'settings-nav-developer',
    },
    {
      id: 'billing',
      to: '/settings/billing',
      icon: <ReceiptText className="h-5 w-5" />,
      ...sectionMeta.billing,
      testId: 'settings-nav-billing',
    },
    {
      id: 'storage',
      to: '/settings/storage',
      icon: <Trash2 className="h-5 w-5" />,
      ...sectionMeta.storage,
      testId: 'settings-nav-storage',
    },
  ] as const;
  const settingsSectionGroups = [
    {
      id: 'configuration',
      title: t('navigation.groups.configuration'),
      sections: settingsSections.filter((section) => ['models', 'agents', 'skills', 'channels'].includes(section.id)),
    },
    {
      id: 'experience',
      title: t('navigation.groups.experience'),
      sections: settingsSections.filter((section) => ['general'].includes(section.id)),
    },
    {
      id: 'operations',
      title: t('navigation.groups.operations'),
      sections: settingsSections.filter((section) => ['billing', 'system', 'developer', 'storage'].includes(section.id)),
    },
  ] as const;

  const pageTitle = currentSection === 'overview'
    ? t('title')
    : sectionMeta[currentSection].title;
  const pageSubtitle = currentSection === 'overview'
    ? t('subtitle')
    : sectionMeta[currentSection].description;
  const pageTitleTestId = currentSection === 'models'
    ? 'models-page-title'
    : currentSection === 'billing'
      ? 'billing-page-title'
      : undefined;

  return (
    <SettingsPageShell presentation={presentation}>

        {/* Header */}
        <div className={cn(
          'flex shrink-0 flex-col justify-between gap-3 border-b border-border md:flex-row md:items-start',
          presentation === 'drawer' ? 'mb-4 pb-4' : 'mb-6 pb-5',
          presentation === 'drawer' && currentSection === 'overview' && 'hidden',
        )}>
          <div>
            {presentation === 'page' && currentSection !== 'overview' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/settings')}
                data-testid="settings-back-button"
                className="mb-4 h-8 border-black/10 bg-transparent px-2.5 text-xs dark:border-white/10"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('navigation.back')}
              </Button>
            )}
            <h1 className={cn(
              'font-serif font-normal tracking-tight text-foreground',
              presentation === 'drawer'
                ? 'mb-1 text-xl font-semibold'
                : currentSection === 'overview' ? 'mb-1.5 text-3xl' : 'mb-1 text-2xl',
            )}
              data-testid={pageTitleTestId}
            >
              {pageTitle}
            </h1>
            <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
              {pageSubtitle}
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div className={cn(
          '-mr-2 min-h-0 flex-1 overflow-y-auto pb-10 pr-2',
          presentation === 'drawer' ? 'space-y-6' : 'space-y-8',
        )}>
          {currentSection === 'overview' && (
            <div data-testid="settings-overview" className="space-y-6">
              {settingsSectionGroups.map((group) => (
                <section key={group.id} className="space-y-3">
                  <h2 className="text-sm font-semibold text-foreground/70">
                    {group.title}
                  </h2>
                  <div className="grid overflow-hidden rounded-lg border border-border md:grid-cols-2">
                    {group.sections.map((section) => (
                      <Card
                        key={section.id}
                        className="group rounded-none border-0 border-b border-border bg-surface-modal shadow-none transition-colors last:border-b-0 hover:bg-black/[0.03] md:odd:border-r dark:hover:bg-white/[0.05]"
                      >
                        <Link
                          to={section.to}
                          data-testid={presentation === 'drawer' ? undefined : section.testId}
                          onPointerEnter={() => preloadSettingsSection(section.id)}
                          onFocus={() => preloadSettingsSection(section.id)}
                          className="flex min-h-20 h-full items-center gap-3 px-4 py-3"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black/5 text-foreground/80 dark:bg-white/10 [&_svg]:h-4 [&_svg]:w-4">
                            {section.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">{section.title}</span>
                            <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{section.description}</span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* Appearance */}
          {currentSection === 'general' && (
          <div>
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('appearance.title')}
            </h2>
            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-medium text-foreground/80">{t('appearance.theme')}</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={theme === 'light' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-black/10 dark:border-white/10", theme === 'light' ? "bg-black/5 dark:bg-white/10 text-foreground" : "bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5")}
                    onClick={() => setTheme('light')}
                  >
                    <Sun className="h-4 w-4 mr-2" />
                    {t('appearance.light')}
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-black/10 dark:border-white/10", theme === 'dark' ? "bg-black/5 dark:bg-white/10 text-foreground" : "bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5")}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon className="h-4 w-4 mr-2" />
                    {t('appearance.dark')}
                  </Button>
                  <Button
                    variant={theme === 'system' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-black/10 dark:border-white/10", theme === 'system' ? "bg-black/5 dark:bg-white/10 text-foreground" : "bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5")}
                    onClick={() => setTheme('system')}
                  >
                    <Monitor className="h-4 w-4 mr-2" />
                    {t('appearance.system')}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-sm font-medium text-foreground/80">{t('appearance.language')}</Label>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <Button
                      key={lang.code}
                      variant={language === lang.code ? 'secondary' : 'outline'}
                      className={cn("rounded-full px-5 h-10 border-black/10 dark:border-white/10", language === lang.code ? "bg-black/5 dark:bg-white/10 text-foreground" : "bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5")}
                      onClick={() => handleLanguageChange(lang.code)}
                    >
                      {lang.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium text-foreground/80">{t('appearance.uiDepthMode.title')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">
                    {t('appearance.uiDepthMode.description')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2" data-testid="settings-ui-depth-mode">
                  <Button
                    variant={uiDepthMode === 'basic' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-black/10 dark:border-white/10", uiDepthMode === 'basic' ? "bg-black/5 dark:bg-white/10 text-foreground" : "bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5")}
                    onClick={() => setUiDepthMode('basic')}
                    data-testid="settings-ui-depth-basic"
                  >
                    {t('appearance.uiDepthMode.basic')}
                  </Button>
                  <Button
                    variant={uiDepthMode === 'advanced' ? 'secondary' : 'outline'}
                    className={cn("rounded-full px-5 h-10 border-black/10 dark:border-white/10", uiDepthMode === 'advanced' ? "bg-black/5 dark:bg-white/10 text-foreground" : "bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5")}
                    onClick={() => setUiDepthMode('advanced')}
                    data-testid="settings-ui-depth-advanced"
                  >
                    {t('appearance.uiDepthMode.advanced')}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-foreground/80">{t('appearance.launchAtStartup')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">
                    {t('appearance.launchAtStartupDesc')}
                  </p>
                </div>
                <Switch
                  checked={launchAtStartup}
                  onCheckedChange={setLaunchAtStartup}
                />
              </div>
            </div>
          </div>
          )}

          {currentSection === 'models' && (
            <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
              <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><SettingsModelsLazy embedded /></div>
            </Suspense>
          )}

          {currentSection === 'agents' && (
            <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
              <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><SettingsAgentsLazy embedded /></div>
            </Suspense>
          )}

          {currentSection === 'skills' && (
            <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
              <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><SettingsSkillsLazy embedded /></div>
            </Suspense>
          )}

          {currentSection === 'channels' && (
            <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
              <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><SettingsChannelsLazy embedded /></div>
            </Suspense>
          )}

          {currentSection === 'system' && (
            <>
          <Separator className="bg-black/5 dark:bg-white/5" />

          {/* Gateway */}
          <div>
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('gateway.title')}
            </h2>
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium text-foreground">{t('gateway.status')}</Label>
                  <p className="text-meta text-muted-foreground mt-1 font-mono">
                    port: {gatewayStatus.port || '-'}
                    {gatewayStatus.pid ? ` · pid: ${gatewayStatus.pid}` : ''}
                    {gatewayStatus.gatewayReady === false ? ' · runtime: starting' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-meta font-medium border",
                    gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false ? "bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20" :
                      gatewayStatus.state === 'running' ? "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20" :
                        gatewayStatus.state === 'error' ? "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20" :
                          "bg-black/5 dark:bg-white/5 text-muted-foreground border-transparent"
                  )}>
                    <div className={cn("w-1.5 h-1.5 rounded-full",
                      gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false ? "bg-green-500" :
                        gatewayStatus.state === 'running' ? "bg-red-500" :
                          gatewayStatus.state === 'error' ? "bg-red-500" : "bg-muted-foreground"
                    )} />
                    {gatewayStatus.state === 'running' && gatewayStatus.gatewayReady === false ? 'starting' : gatewayStatus.state}
                  </div>
                  <Button variant="outline" size="sm" onClick={restartGateway} className="rounded-full h-8 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5">
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    {t('common:actions.restart')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleShowLogs} className="rounded-full h-8 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    {t('gateway.logs')}
                  </Button>
                </div>
              </div>

              {showLogs && (
                <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium text-sm">{t('gateway.appLogs')}</p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={handleOpenLogDir}>
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        {t('gateway.openFolder')}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setShowLogs(false)}>
                        {t('common:actions.close')}
                      </Button>
                    </div>
                  </div>
                  <pre className="text-xs text-muted-foreground bg-surface-input p-4 rounded-xl max-h-60 overflow-auto whitespace-pre-wrap font-mono border border-black/5 dark:border-white/5 shadow-inner">
                    {logContent || t('chat:noLogs')}
                  </pre>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-foreground">{t('gateway.autoStart')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">
                    {t('gateway.autoStartDesc')}
                  </p>
                </div>
                <Switch
                  checked={gatewayAutoStart}
                  onCheckedChange={setGatewayAutoStart}
                />
              </div>

              <div
                className="rounded-lg border border-black/10 bg-surface-modal p-5 shadow-none dark:border-white/10"
                data-testid="settings-role-memory-section"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-foreground/70" />
                      <Label className="text-sm font-medium text-foreground">{t('roleMemory.title')}</Label>
                      <Badge variant={roleMemoryEnabled ? 'secondary' : 'outline'} className="rounded-full text-2xs">
                        {roleMemoryEnabled ? t('roleMemory.enabled') : t('roleMemory.disabled')}
                      </Badge>
                    </div>
                    <p className="mt-1 max-w-2xl text-meta text-muted-foreground">
                      {t('roleMemory.description')}
                    </p>
                    <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
                      {t('roleMemory.disableEffect')}
                    </p>
                  </div>
                  <Switch
                    checked={roleMemoryEnabled}
                    onCheckedChange={setRoleMemoryEnabled}
                    data-testid="settings-role-memory-toggle"
                  />
                </div>
              </div>

              <div
                className="rounded-lg border border-black/10 bg-surface-modal p-5 shadow-none dark:border-white/10"
                data-testid="settings-memory-embedding-section"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ScanSearch className="h-4 w-4 text-foreground/70" />
                      <Label className="text-sm font-medium text-foreground">{t('memoryEmbedding.title')}</Label>
                      <Badge variant={memoryEmbeddingEnabled ? 'secondary' : 'outline'} className="rounded-full text-2xs">
                        {memoryEmbeddingEnabled ? t('memoryEmbedding.enabled') : t('memoryEmbedding.disabled')}
                      </Badge>
                    </div>
                    <p className="mt-1 max-w-2xl text-meta text-muted-foreground">
                      {t('memoryEmbedding.description')}
                    </p>
                    <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
                      {t('memoryEmbedding.disableEffect')}
                    </p>
                  </div>
                  <Switch
                    checked={memoryEmbeddingEnabled}
                    onCheckedChange={setMemoryEmbeddingEnabled}
                    data-testid="settings-memory-embedding-toggle"
                  />
                </div>
              </div>

              {remoteControlSection}
              <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
                <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><ProjectRulesCenterLazy /></div>
              </Suspense>
              <div className="rounded-lg border border-black/10 bg-surface-modal p-5 shadow-none dark:border-white/10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-medium text-foreground">
                      {t('knowledgeHub.watched.title')}
                    </h3>
                    <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
                      {t('knowledgeHub.watched.description')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 rounded-full border-black/10 bg-transparent px-3 dark:border-white/10"
                    onClick={() => void refreshWatchedDirectories()}
                    disabled={watchedLoading}
                    data-testid="settings-knowledge-watch-refresh"
                  >
                    <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', watchedLoading && 'animate-spin')} />
                    {t('common:actions.refresh')}
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {watchedDirectories.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-black/10 bg-surface-input px-4 py-5 text-sm text-muted-foreground dark:border-white/10">
                      {t('knowledgeHub.watched.empty')}
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="settings-knowledge-watch-list">
                      {watchedDirectories.map((directory) => (
                        <div
                          key={directory.id}
                          className="flex flex-col gap-3 rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between"
                          data-testid="settings-knowledge-watch-item"
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate font-mono text-xs text-foreground">
                                {directory.path}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                {directory.enabled ? t('knowledgeHub.watched.enabled') : t('knowledgeHub.watched.disabled')}
                              </Badge>
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                {directory.requiresReview ? t('knowledgeHub.watched.reviewFirst') : t('knowledgeHub.watched.directIngest')}
                              </Badge>
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                {directory.autoCompile ? t('knowledgeHub.watched.autoCompile') : t('knowledgeHub.watched.compileOff')}
                              </Badge>
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                {directory.patterns.join(', ')}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                              {t('knowledgeHub.watched.enabled')}
                              <Switch
                                checked={directory.enabled}
                                onCheckedChange={(enabled) => void handleUpdateWatchedDirectory(directory.id, { enabled })}
                                data-testid="settings-knowledge-watch-enabled"
                              />
                            </Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 rounded-full px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleRemoveWatchedDirectory(directory.id)}
                              data-testid="settings-knowledge-watch-remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="sr-only">{t('common:actions.delete')}</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-3 rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor="knowledge-watch-path" className="text-xs font-medium text-muted-foreground">
                      {t('knowledgeHub.watched.path')}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="knowledge-watch-path"
                        value={watchedDirectoryPath}
                        onChange={(event) => setWatchedDirectoryPath(event.target.value)}
                        placeholder={t('knowledgeHub.watched.pathPlaceholder')}
                        className="h-9 bg-transparent"
                        data-testid="settings-knowledge-watch-path"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 shrink-0 rounded-lg border-black/10 bg-transparent dark:border-white/10"
                        onClick={() => void handlePickWatchedDirectory()}
                        data-testid="settings-knowledge-watch-pick"
                      >
                        <FolderOpen className="h-4 w-4" />
                        <span className="sr-only">{t('knowledgeHub.watched.pick')}</span>
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="knowledge-watch-patterns" className="text-xs font-medium text-muted-foreground">
                      {t('knowledgeHub.watched.patterns')}
                    </Label>
                    <Input
                      id="knowledge-watch-patterns"
                      value={watchedDirectoryPatterns}
                      onChange={(event) => setWatchedDirectoryPatterns(event.target.value)}
                      className="h-9 bg-transparent font-mono text-xs"
                      data-testid="settings-knowledge-watch-patterns"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      className="h-9 w-full rounded-lg px-4 lg:w-auto"
                      onClick={() => void handleAddWatchedDirectory()}
                      disabled={watchedLoading}
                      data-testid="settings-knowledge-watch-add"
                    >
                      {t('knowledgeHub.watched.add')}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-3 lg:col-span-3">
                    <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Switch
                        checked={watchedIngestNewFiles}
                        onCheckedChange={setWatchedIngestNewFiles}
                        data-testid="settings-knowledge-watch-ingest"
                      />
                      {t('knowledgeHub.watched.ingestNewFiles')}
                    </Label>
                    <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Switch
                        checked={watchedRequiresReview}
                        onCheckedChange={setWatchedRequiresReview}
                        data-testid="settings-knowledge-watch-review"
                      />
                      {t('knowledgeHub.watched.requiresReview')}
                    </Label>
                    <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Switch
                        checked={watchedAutoCompile}
                        onCheckedChange={setWatchedAutoCompile}
                        data-testid="settings-knowledge-watch-compile"
                      />
                      {t('knowledgeHub.watched.autoCompile')}
                    </Label>
                  </div>
                </div>
              </div>
              {devModeUnlocked && sandboxRuntimeSection}

            </div>
          </div>
            </>
          )}


          {/* Developer */}
          {currentSection === 'billing' && (
            <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
              <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><SettingsBillingLazy embedded /></div>
            </Suspense>
          )}

          {currentSection === 'developer' && (
            <>
              <Separator className="bg-black/5 dark:bg-white/5" />
              <div data-testid="settings-developer-section">
                <h2 data-testid="settings-developer-title" className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
                  {t('developer.title')}
                </h2>
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium text-foreground">{t('advanced.devMode')}</Label>
                      <p className="text-meta text-muted-foreground mt-1">
                        {t('advanced.devModeDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={devModeUnlocked}
                      onCheckedChange={setDevModeUnlocked}
                      data-testid="settings-dev-mode-switch"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium text-foreground">{t('advanced.telemetry')}</Label>
                      <p className="text-meta text-muted-foreground mt-1">
                        {t('advanced.telemetryDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={telemetryEnabled}
                      onCheckedChange={setTelemetryEnabled}
                    />
                  </div>

                  {devModeUnlocked && (
                    <>
                  {/* Gateway Proxy */}
                  <div className="space-y-4" data-testid="settings-proxy-section">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium text-foreground/80">Gateway Proxy</Label>
                        <p className="text-meta text-muted-foreground">
                          {t('gateway.proxyDesc')}
                        </p>
                      </div>
                      <Switch
                        checked={proxyEnabledDraft}
                        onCheckedChange={setProxyEnabledDraft}
                        data-testid="settings-proxy-toggle"
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <Button
                        variant="outline"
                        onClick={handleSaveProxySettings}
                        disabled={savingProxy || !proxySettingsDirty}
                        data-testid="settings-proxy-save-button"
                        className="rounded-xl h-10 px-5 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <RefreshCw className={`h-4 w-4 mr-2${savingProxy ? ' animate-spin' : ''}`} />
                        {savingProxy ? t('common:status.saving') : t('common:actions.save')}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {t('gateway.proxyRestartNote')}
                      </p>
                    </div>

                    {proxyEnabledDraft && (
                      <div className="space-y-4 pt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="proxy-server" className="text-meta text-foreground/80">{t('gateway.proxyServer')}</Label>
                            <Input
                              id="proxy-server"
                              value={proxyServerDraft}
                              onChange={(event) => setProxyServerDraft(event.target.value)}
                              placeholder="http://127.0.0.1:7890"
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">
                              {t('gateway.proxyServerHelp')}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-http-server" className="text-meta text-foreground/80">{t('gateway.proxyHttpServer')}</Label>
                            <Input
                              id="proxy-http-server"
                              value={proxyHttpServerDraft}
                              onChange={(event) => setProxyHttpServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">
                              {t('gateway.proxyHttpServerHelp')}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-https-server" className="text-meta text-foreground/80">{t('gateway.proxyHttpsServer')}</Label>
                            <Input
                              id="proxy-https-server"
                              value={proxyHttpsServerDraft}
                              onChange={(event) => setProxyHttpsServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">
                              {t('gateway.proxyHttpsServerHelp')}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-all-server" className="text-meta text-foreground/80">{t('gateway.proxyAllServer')}</Label>
                            <Input
                              id="proxy-all-server"
                              value={proxyAllServerDraft}
                              onChange={(event) => setProxyAllServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'socks5://127.0.0.1:7891'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">
                              {t('gateway.proxyAllServerHelp')}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-bypass" className="text-meta text-foreground/80">{t('gateway.proxyBypass')}</Label>
                          <Input
                            id="proxy-bypass"
                            value={proxyBypassRulesDraft}
                            onChange={(event) => setProxyBypassRulesDraft(event.target.value)}
                            placeholder="<local>;localhost;127.0.0.1;::1"
                            className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                          />
                          <p className="text-tiny text-muted-foreground">
                            {t('gateway.proxyBypassHelp')}
                          </p>
                        </div>

                      </div>
                    )}
                  </div>
                  <div className="space-y-4 pt-4">
                    <Label className="text-sm font-medium text-foreground/80">{t('developer.gatewayToken')}</Label>
                    <p className="text-meta text-muted-foreground">
                      {t('developer.gatewayTokenDesc')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        data-testid="settings-developer-gateway-token"
                        readOnly
                        value={controlUiInfo?.hasToken ? '••••••••••••••••' : ''}
                        placeholder={t('developer.tokenUnavailable')}
                        className="font-mono text-meta h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent flex-1 min-w-[200px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refreshControlUiInfo}
                        disabled={!devModeUnlocked}
                        className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t('common:actions.load')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCopyGatewayToken}
                        disabled={!controlUiInfo?.hasToken}
                        className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>

                  <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
                    <div className="space-y-4 animate-in fade-in duration-150 motion-reduce:animate-none">
                      <DcsProdFlagsPanelLazy />
                      <AgentDevWorkbenchPanelLazy />
                    </div>
                  </Suspense>

                  {showCliTools && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-foreground">{t('developer.cli')}</Label>
                      <p className="text-meta text-muted-foreground">
                        {t('developer.cliDesc')}
                      </p>
                      {isWindows && (
                        <p className="text-xs text-muted-foreground">
                          {t('developer.cliPowershell')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Input
                          readOnly
                          value={openclawCliCommand}
                          placeholder={openclawCliError || t('developer.cmdUnavailable')}
                          className="font-mono text-meta h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent flex-1 min-w-[200px]"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyCliCommand}
                          disabled={!openclawCliCommand}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium text-foreground">{t('developer.doctor')}</Label>
                        <p className="text-meta text-muted-foreground mt-1">
                          {t('developer.doctorDesc')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('diagnose')}
                          disabled={doctorRunningMode !== null}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2${doctorRunningMode === 'diagnose' ? ' animate-spin' : ''}`} />
                          {doctorRunningMode === 'diagnose' ? t('common:status.running') : t('developer.runDoctor')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('fix')}
                          disabled={doctorRunningMode !== null}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2${doctorRunningMode === 'fix' ? ' animate-spin' : ''}`} />
                          {doctorRunningMode === 'fix' ? t('common:status.running') : t('developer.runDoctorFix')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyDoctorOutput}
                          disabled={!doctorResult}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>

                    {doctorResult && (
                      <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 p-5 bg-black/5 dark:bg-white/5">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant={doctorResult.success ? 'secondary' : 'destructive'} className="rounded-full px-3 py-1">
                            {doctorResult.mode === 'fix'
                              ? (doctorResult.success ? t('developer.doctorFixOk') : t('developer.doctorFixIssue'))
                              : (doctorResult.success ? t('developer.doctorOk') : t('developer.doctorIssue'))}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorExitCode')}: {doctorResult.exitCode ?? 'null'}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorDuration')}: {Math.round(doctorResult.durationMs)}ms
                          </Badge>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground font-mono break-all">
                          <p>{t('developer.doctorCommand')}: {doctorResult.command}</p>
                          <p>{t('developer.doctorWorkingDir')}: {doctorResult.cwd || '-'}</p>
                          {doctorResult.error && <p>{t('developer.doctorError')}: {doctorResult.error}</p>}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground/80">{t('developer.doctorStdout')}</p>
                            <pre className="max-h-72 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-3 text-tiny font-mono whitespace-pre-wrap break-words">
                              {doctorResult.stdout.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground/80">{t('developer.doctorStderr')}</p>
                            <pre className="max-h-72 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-3 text-tiny font-mono whitespace-pre-wrap break-words">
                              {doctorResult.stderr.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium text-foreground">{t('developer.telemetryViewer')}</Label>
                        <p className="text-meta text-muted-foreground mt-1">
                          {t('developer.telemetryViewerDesc')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTelemetryViewer((prev) => !prev)}
                        className="rounded-full px-5 h-9 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        {showTelemetryViewer
                          ? t('common:actions.hide')
                          : t('common:actions.show')}
                      </Button>
                    </div>

                    {showTelemetryViewer && (
                      <div className="space-y-4 rounded-2xl border border-black/10 dark:border-white/10 p-5 bg-black/5 dark:bg-white/5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="rounded-full px-3 py-1 bg-surface-modal border border-black/5 dark:border-white/5">{t('developer.telemetryTotal')}: {telemetryStats.total}</Badge>
                          <Badge variant={telemetryStats.errorCount > 0 ? 'destructive' : 'secondary'} className={cn("rounded-full px-3 py-1", telemetryStats.errorCount === 0 && "bg-surface-modal border border-black/5 dark:border-white/5")}>
                            {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                          </Badge>
                          <Badge variant={telemetryStats.slowCount > 0 ? 'secondary' : 'outline'} className={cn("rounded-full px-3 py-1", telemetryStats.slowCount === 0 && "bg-surface-modal border border-black/5 dark:border-white/5")}>
                            {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                          </Badge>
                          <div className="ml-auto flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={handleCopyTelemetry} className="rounded-full h-8 px-4 bg-surface-modal border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/10">
                              <Copy className="h-3.5 w-3.5 mr-1.5" />
                              {t('common:actions.copy')}
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={handleClearTelemetry} className="rounded-full h-8 px-4 bg-surface-modal border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/10">
                              {t('common:actions.clear')}
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-80 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-modal shadow-inner">
                          {telemetryByEvent.length > 0 && (
                            <div className="border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-3">
                              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                                {t('developer.telemetryAggregated')}
                              </p>
                              <div className="space-y-1.5 text-xs">
                                {telemetryByEvent.map((item) => (
                                  <div
                                    key={item.event}
                                    className="grid grid-cols-[minmax(0,1.6fr)_0.7fr_0.9fr_0.8fr_1fr] gap-2 rounded-lg border border-black/5 dark:border-white/5 bg-surface-modal px-3 py-2"
                                  >
                                    <span className="truncate font-medium" title={item.event}>{item.event}</span>
                                    <span className="text-muted-foreground">n={item.count}</span>
                                    <span className="text-muted-foreground">
                                      avg={item.timedCount > 0 ? Math.round(item.totalDuration / item.timedCount) : 0}ms
                                    </span>
                                    <span className="text-muted-foreground">slow={item.slowCount}</span>
                                    <span className="text-muted-foreground">err={item.errorCount}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="space-y-2 p-3 font-mono text-xs">
                            {telemetryEntries.length === 0 ? (
                              <div className="text-muted-foreground text-center py-4">{t('developer.telemetryEmpty')}</div>
                            ) : (
                              telemetryEntries
                                .slice()
                                .reverse()
                                .map((entry) => (
                                  <div key={entry.id} className="rounded-lg border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-3">
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                      <span className="font-semibold text-foreground">{entry.event}</span>
                                      <span className="text-muted-foreground text-tiny">{entry.ts}</span>
                                    </div>
                                    <pre className="whitespace-pre-wrap text-tiny text-muted-foreground overflow-x-auto">
                                      {JSON.stringify({ count: entry.count, ...entry.payload }, null, 2)}
                                    </pre>
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {currentSection === 'storage' && (
            <>
              <Separator className="bg-black/5 dark:bg-white/5" />
              <div data-testid="settings-storage-section">
                <h2 data-testid="settings-storage-title" className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
                  {t('storage.title')}
                </h2>
                <Suspense fallback={<SettingsSectionLoading label={t('loading.section')} />}>
                  <div className="animate-in fade-in duration-150 motion-reduce:animate-none"><StorageCleanerSectionLazy /></div>
                </Suspense>
              </div>
            </>
          )}

          {currentSection === 'general' && (
            <>
          <Separator className="bg-black/5 dark:bg-white/5" />

          {/* About */}
          <div>
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('about.title')}
            </h2>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground font-semibold">{t('about.appName')}</strong> - {t('about.tagline')}
              </p>
              <p>{t('about.basedOn')}</p>
              <p>{t('about.version', { version: currentVersion })}</p>
              <div className="flex gap-4 pt-3">
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  onClick={() => window.electron.openExternal('https://claw-x.com')}
                >
                  {t('about.docs')}
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/Verse-Claw')}
                >
                  {t('about.github')}
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  onClick={() => window.electron.openExternal('https://icnnp7d0dymg.feishu.cn/wiki/UyfOwQ2cAiJIP6kqUW8cte5Bnlc')}
                >
                  {t('about.faq')}
                </Button>
              </div>
            </div>
          </div>
            </>
          )}

        </div>
      </SettingsPageShell>
  );
}

export default Settings;
