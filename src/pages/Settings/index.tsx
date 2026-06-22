/**
 * Settings Page
 * Application configuration
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
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
  PanelsTopLeft,
  ScanSearch,
  Check,
  ShieldCheck,
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
import { useUpdateStore } from '@/stores/update';
import { useWorkspacesStore } from '@/stores/workspaces';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { ProjectRulesCenter } from '@/components/settings/ProjectRulesCenter';
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
import type { SandboxNetworkPolicy, SandboxProviderId, SandboxProviderStatus } from '@shared/types/sandbox';
import type { WorkModeCapabilitySkill, WorkModeId, WorkModeKit } from '@shared/types/work-mode';
import {
  normalizeWorkModeKits,
  resolveDefaultWorkMode,
  resolveWorkModeKitCapabilities,
  resolveWorkModePreset,
  WORK_MODE_IDS,
  WORK_MODE_KIT_DEFINITIONS,
  WORK_MODE_KIT_IDS,
  WORK_MODE_PRESETS,
} from '@shared/types/work-mode';

const WorkHeatGraphLazy = lazy(() =>
  import('@/components/assistant-render/WorkHeatGraph').then((m) => ({ default: m.WorkHeatGraph })),
);
const SettingsBillingLazy = lazy(() => import('@/pages/Billing').then((m) => ({ default: m.Billing })));
type ControlUiInfo = {
  url: string;
  token: string;
  port: number;
};

type SettingsSectionId = 'overview' | 'general' | 'work-modes' | 'system' | 'developer' | 'billing';

const SETTINGS_SECTION_SEGMENTS: Record<Exclude<SettingsSectionId, 'overview'>, string> = {
  general: 'general',
  'work-modes': 'work-modes',
  system: 'system',
  developer: 'developer',
  billing: 'billing',
};

function resolveSettingsSection(pathname: string): SettingsSectionId {
  const normalized = pathname.replace(/\/+$/, '');
  const segment = normalized.split('/').filter(Boolean)[1];
  if (!segment) return 'overview';

  const match = Object.entries(SETTINGS_SECTION_SEGMENTS)
    .find(([, value]) => value === segment);
  return match ? (match[0] as SettingsSectionId) : 'overview';
}

function SettingsPageShell({ children }: { children: ReactNode }) {
  return (
    <div data-testid="settings-page" className="flex h-[calc(100vh-2.5rem)] -m-6 flex-col overflow-hidden dark:bg-background">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col p-10 pt-12">
        {children}
      </div>
    </div>
  );
}

export function Settings() {
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
    autoCheckUpdate,
    setAutoCheckUpdate,
    devModeUnlocked,
    setDevModeUnlocked,
    telemetryEnabled,
    setTelemetryEnabled,
    workModeToolBundles,
    workModeKits,
    setWorkModeKits,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const saveWorkspaceState = useWorkspacesStore((s) => s.saveWorkspaceState);
  const currentVersion = useUpdateStore((state) => state.currentVersion);
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
  const [workModeSkills, setWorkModeSkills] = useState<WorkModeCapabilitySkill[]>([]);
  const [installingWorkModeSkill, setInstallingWorkModeSkill] = useState<string | null>(null);
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
  const [doctorRunningMode, setDoctorRunningMode] = useState<'diagnose' | 'fix' | null>(null);
  const [doctorResult, setDoctorResult] = useState<OpenClawDoctorResult | null>(null);

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
      const result = await hostApi.gateway.controlUi();
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
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
    if (!controlUiInfo?.token) return;
    try {
      await navigator.clipboard.writeText(controlUiInfo.token);
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (!showCliTools) return;
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
  }, [devModeUnlocked, showCliTools]);

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
    const unsubscribe = hostEvents.onOpenClawCliInstalled((installedPath) => {
      toast.success(`openclaw CLI installed at ${installedPath}`);
    });
    return () => { unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
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
  }, [devModeUnlocked]);

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
    void refreshRemoteControlStatus();
  }, [cdpRemoteControlEnabled, cdpRemoteDebuggingPort]);

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
    if (!devModeUnlocked) return;
    void refreshSandboxStatus();
  }, [devModeUnlocked, refreshSandboxStatus]);

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

  const activeSessionKey = activeWorkspace?.activeSessionKey;
  const activeSessionState = activeSessionKey ? activeWorkspace?.sessionStates?.[activeSessionKey] : undefined;
  const activeWorkMode = activeSessionState?.workMode
    ?? activeWorkspace?.state?.workMode
    ?? resolveDefaultWorkMode(activeWorkspace?.permissionMode);
  const workModeRuntimeAvailable = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;

  useEffect(() => {
    let cancelled = false;
    hostApi.skills.local()
      .then((result) => {
        if (cancelled) return;
        setWorkModeSkills(Array.isArray(result.skills) ? result.skills : []);
      })
      .catch(() => {
        if (!cancelled) setWorkModeSkills([]);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSettingsWorkModeChange = async (mode: WorkModeId) => {
    if (!activeWorkspace?.id || !activeSessionKey) {
      toast.error(t('workModes.noWorkspace'));
      return;
    }
    await saveWorkspaceState({
      id: activeWorkspace.id,
      activeSessionKey,
      sessionKey: activeSessionKey,
      state: { workMode: mode },
    });
    toast.success(t('workModes.modeSaved'));
  };

  const handleToggleWorkModeKit = (mode: WorkModeId, kit: WorkModeKit) => {
    const preset = WORK_MODE_PRESETS[mode];
    const currentPreset = resolveWorkModePreset(mode, undefined, workModeToolBundles, workModeKits);
    const current = normalizeWorkModeKits(workModeKits?.[mode], currentPreset.kits ?? preset.kits);
    const next = current.includes(kit)
      ? current.filter((item) => item !== kit)
      : [...current, kit];
    setWorkModeKits(mode, next);
  };

  const refreshWorkModeSkills = async () => {
    const result = await hostApi.skills.local();
    setWorkModeSkills(Array.isArray(result.skills) ? result.skills : []);
  };

  const handleInstallWorkModeSkill = async (slug: string) => {
    setInstallingWorkModeSkill(slug);
    try {
      const result = await hostApi.skills.clawhubInstall({ slug });
      if (!result.success) {
        throw new Error(result.error || 'Install failed');
      }
      await refreshWorkModeSkills();
      toast.success(t('workModes.skillInstalled', { slug }));
    } catch (error) {
      toast.error(t('workModes.skillInstallFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setInstallingWorkModeSkill(null);
    }
  };

  const sectionMeta = {
    general: {
      title: t('navigation.general.title'),
      description: t('navigation.general.description'),
    },
    'work-modes': {
      title: t('navigation.workModes.title'),
      description: t('navigation.workModes.description'),
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
      id: 'work-modes',
      to: '/settings/work-modes',
      icon: <Briefcase className="h-5 w-5" />,
      ...sectionMeta['work-modes'],
      testId: 'settings-nav-work-modes',
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
  ] as const;

  const pageTitle = currentSection === 'overview'
    ? t('title')
    : sectionMeta[currentSection].title;
  const pageSubtitle = currentSection === 'overview'
    ? t('subtitle')
    : sectionMeta[currentSection].description;

  return (
    <SettingsPageShell>

        {/* Header */}
        <div className="mb-10 flex shrink-0 flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            {currentSection !== 'overview' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/settings')}
                data-testid="settings-back-button"
                className="mb-5 h-9 rounded-lg border-black/10 bg-transparent px-3 text-sm dark:border-white/10"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('navigation.back')}
              </Button>
            )}
            <h1 className={cn(
              'font-serif font-normal tracking-tight text-foreground',
              currentSection === 'overview' ? 'mb-3 text-5xl md:text-6xl' : 'mb-2 text-4xl md:text-5xl',
            )}>
              {pageTitle}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">
              {pageSubtitle}
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2 space-y-12">
          {currentSection === 'overview' && (
            <>
              <Suspense fallback={null}>
                <WorkHeatGraphLazy />
              </Suspense>

              <div data-testid="settings-overview" className="grid gap-4 md:grid-cols-2">
                {settingsSections.map((section) => (
                  <Card
                    key={section.id}
                    className="group rounded-lg border-black/10 bg-surface-modal shadow-none transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.05]"
                  >
                    <Link
                      to={section.to}
                      data-testid={section.testId}
                      className="flex h-full items-start gap-4 p-5"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/5 text-foreground/80 dark:bg-white/10">
                        {section.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-medium text-foreground">{section.title}</span>
                        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{section.description}</span>
                      </span>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </Card>
                ))}
              </div>
            </>
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

          {currentSection === 'work-modes' && (
            <>
          <Separator className="bg-black/5 dark:bg-white/5" />

          {/* Work Modes */}
          <div data-testid="settings-work-modes-section">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('workModes.title')}
            </h2>
            <div className="space-y-6">
              <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PanelsTopLeft className="h-4 w-4 text-foreground/70" />
                      <Label className="text-sm font-medium text-foreground">{t('workModes.currentMode')}</Label>
                    </div>
                    <p className="mt-1 max-w-2xl text-meta text-muted-foreground">
                      {t('workModes.currentModeDesc')}
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-full">
                    {activeWorkspace?.name || t('workModes.noWorkspaceBadge')}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {WORK_MODE_IDS.map((mode) => {
                    const preset = WORK_MODE_PRESETS[mode];
                    const selected = activeWorkMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        data-testid={`settings-work-mode-${mode}`}
                        onClick={() => void handleSettingsWorkModeChange(mode)}
                        disabled={!activeWorkspace?.id}
                        className={cn(
                          'min-h-24 rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                          selected
                            ? 'border-primary/30 bg-black/5 text-foreground dark:bg-white/10'
                            : 'border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{t(preset.labelKey, { ns: 'chat' })}</span>
                            <span className="mt-1 block text-tiny leading-4 text-muted-foreground">
                              {t(preset.descriptionKey, { ns: 'chat' })}
                            </span>
                          </span>
                          {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-foreground">{t('workModes.kitsTitle')}</Label>
                  <p className="mt-1 max-w-2xl text-meta text-muted-foreground">
                    {t('workModes.kitsDesc')}
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {WORK_MODE_IDS.map((mode) => {
                    const preset = WORK_MODE_PRESETS[mode];
                    const resolvedPreset = resolveWorkModePreset(mode, undefined, workModeToolBundles, workModeKits);
                    const selectedKits = normalizeWorkModeKits(workModeKits?.[mode], resolvedPreset.kits);
                    return (
                      <div
                        key={mode}
                        className="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]"
                        data-testid={`settings-work-mode-kits-${mode}`}
                      >
                        <div className="mb-3">
                          <p className="text-sm font-medium text-foreground">{t(preset.labelKey, { ns: 'chat' })}</p>
                          <p className="text-tiny text-muted-foreground">{t('workModes.selectedCount', { count: selectedKits.length })}</p>
                        </div>
                        <div className="grid gap-2">
                          {WORK_MODE_KIT_IDS.map((kit) => {
                            const enabled = selectedKits.includes(kit);
                            const definition = WORK_MODE_KIT_DEFINITIONS[kit];
                            const [capability] = resolveWorkModeKitCapabilities([kit], workModeSkills, workModeRuntimeAvailable);
                            return (
                              <div
                                key={kit}
                                className={cn(
                                  'rounded-lg border p-2 transition-colors',
                                  enabled
                                    ? 'border-primary/30 bg-background/70'
                                    : 'border-black/10 bg-transparent dark:border-white/10',
                                )}
                              >
                                <div className="flex items-start gap-2">
                                  <button
                                    type="button"
                                    data-testid={`settings-work-mode-kit-${mode}-${kit}`}
                                    onClick={() => handleToggleWorkModeKit(mode, kit)}
                                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                                  >
                                    <span className={cn(
                                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                      enabled
                                        ? 'border-primary/40 bg-black/5 text-primary dark:bg-white/10'
                                        : 'border-black/20 text-transparent dark:border-white/20',
                                    )}
                                    >
                                      <Check className="h-3 w-3" />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-xs font-medium text-foreground">
                                        {t(definition.labelKey)}
                                      </span>
                                      <span className="mt-0.5 block text-tiny leading-4 text-muted-foreground">
                                        {t(definition.descriptionKey)}
                                      </span>
                                    </span>
                                  </button>
                                  {enabled && capability && (
                                    <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                                      {t(`workModes.capability.${capability.status}`)}
                                    </Badge>
                                  )}
                                </div>
                                {enabled && capability?.status === 'missingSkill' && capability.missingSkillSlugs.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                                    {capability.missingSkillSlugs.map((slug) => (
                                      <Button
                                        key={slug}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        data-testid={`settings-work-mode-install-${slug}`}
                                        disabled={installingWorkModeSkill === slug}
                                        className="h-7 rounded-full px-2 text-tiny"
                                        onClick={() => void handleInstallWorkModeSkill(slug)}
                                      >
                                        {installingWorkModeSkill === slug
                                          ? t('workModes.installingSkill', { slug })
                                          : t('workModes.installSkill', { slug })}
                                      </Button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
            </>
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

              {remoteControlSection}
              <ProjectRulesCenter />
              {devModeUnlocked && sandboxRuntimeSection}

            </div>
          </div>
            </>
          )}


          {/* Developer */}
          {currentSection === 'billing' && (
            <SettingsBillingLazy embedded />
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
                        value={controlUiInfo?.token || ''}
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
                        disabled={!controlUiInfo?.token}
                        className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>

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

          {currentSection === 'general' && (
            <>
          <Separator className="bg-black/5 dark:bg-white/5" />

          {/* Updates */}
          <div>
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('updates.title')}
            </h2>
            <div className="space-y-6">
              <UpdateSettings />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-foreground">{t('updates.autoCheck')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">
                    {t('updates.autoCheckDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoCheckUpdate}
                  onCheckedChange={setAutoCheckUpdate}
                />
              </div>
            </div>
          </div>

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
                  onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/ClawX')}
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
