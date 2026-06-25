/**
 * Cron Page
 * Manage scheduled tasks
 */
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  Plus,
  Clock,
  Play,
  Trash2,
  RefreshCw,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  Timer,
  History,
  Pause,
  Bot,
  ShieldCheck,
  RadioTower,
  Database,
  Send,
  Globe2,
  ClipboardCheck,
  KeyRound,
  ListChecks,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  hostApi,
  type ChannelTargetOption,
  type DeliveryChannelAccount,
  type DeliveryChannelGroup,
} from '@/lib/host-api';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { formatRelativeTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CronJob, CronJobCreateInput, ScheduleType } from '@/types/cron';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { isGatewayStopped } from '@/lib/gateway-status';
import { DEFAULT_CRON_BROWSER_AUTOMATION } from '@shared/cron-browser-automation';
import type {
  CronBrowserAutomationAuthPersistence,
  CronBrowserAutomationMode,
  CronBrowserAutomationSensitiveActionPolicy,
  CronBrowserAutomationTemplate,
} from '@shared/types/cron';
import type {
  AgentBrowserProfileEntry,
  AgentBrowserValidateResult,
  BrowserAutomationRunResult,
} from '@shared/host-api/contract';
import type { RawMessage } from '@shared/chat/types';

// Common cron schedule presets
const schedulePresets: { key: string; value: string; type: ScheduleType }[] = [
  { key: 'everyMinute', value: '* * * * *', type: 'interval' },
  { key: 'every5Min', value: '*/5 * * * *', type: 'interval' },
  { key: 'every15Min', value: '*/15 * * * *', type: 'interval' },
  { key: 'everyHour', value: '0 * * * *', type: 'interval' },
  { key: 'daily9am', value: '0 9 * * *', type: 'daily' },
  { key: 'daily6pm', value: '0 18 * * *', type: 'daily' },
  { key: 'weeklyMon', value: '0 9 * * 1', type: 'weekly' },
  { key: 'monthly1st', value: '0 9 1 * *', type: 'monthly' },
];

const browserAutomationTemplates: CronBrowserAutomationTemplate[] = ['checkIn', 'monitor', 'publishDraft', 'custom'];

function splitAllowedDomains(value: string): string[] | undefined {
  const domains = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return domains.length > 0 ? Array.from(new Set(domains)) : undefined;
}

function firstUrlDomain(value: string): string | undefined {
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return undefined;
  }
}

function summarizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const record = block as { text?: unknown; type?: unknown; name?: unknown; input?: unknown };
        if (typeof record.text === 'string') return record.text;
        if (typeof record.name === 'string') return `[${record.name}]`;
        if (typeof record.type === 'string') return `[${record.type}]`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

type BrowserAutomationArtifact = BrowserAutomationRunResult['evidence']['artifacts'][number];
type BrowserAutomationDiagnosticKind = 'screenshot' | 'snapshot' | 'console' | 'errors' | 'network';
type BrowserAutomationDiagnosticCard = {
  kind: BrowserAutomationDiagnosticKind;
  artifact?: BrowserAutomationArtifact;
  detail?: string;
};

const browserAutomationDiagnosticKinds: BrowserAutomationDiagnosticKind[] = [
  'screenshot',
  'snapshot',
  'console',
  'errors',
  'network',
];

function latestBrowserArtifact(
  run: BrowserAutomationRunResult,
  kind: BrowserAutomationDiagnosticKind,
): BrowserAutomationArtifact | undefined {
  for (let index = run.evidence.artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = run.evidence.artifacts[index];
    if (artifact?.kind === kind) return artifact;
  }
  return undefined;
}

function browserDiagnosticDetail(
  run: BrowserAutomationRunResult,
  kind: BrowserAutomationDiagnosticKind,
  artifact?: BrowserAutomationArtifact,
): string | undefined {
  if (kind === 'console') return run.consoleErrors?.[0] ?? artifact?.path ?? artifact?.label;
  if (kind === 'errors') return run.error ?? run.consoleErrors?.[0] ?? artifact?.path ?? artifact?.label;
  if (kind === 'network') return run.networkErrors?.[0] ?? artifact?.path ?? artifact?.label;
  if (kind === 'snapshot') return run.evidence.textSample ?? artifact?.path ?? artifact?.label;
  return artifact?.path ?? artifact?.label;
}

function BrowserAutomationEvidenceCards({ run }: { run: BrowserAutomationRunResult }) {
  const { t } = useTranslation('cron');
  const cards = browserAutomationDiagnosticKinds.reduce<BrowserAutomationDiagnosticCard[]>((items, kind) => {
    const artifact = latestBrowserArtifact(run, kind);
    const detail = browserDiagnosticDetail(run, kind, artifact);
    if (!artifact && !detail) return items;
    items.push({
      kind,
      ...(artifact ? { artifact } : {}),
      ...(detail ? { detail } : {}),
    });
    return items;
  }, []);

  if (cards.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">{t('details.diagnosticEvidence')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map(({ kind, artifact, detail }) => (
          <div
            key={kind}
            className="min-w-0 rounded-lg border border-black/10 bg-black/5 p-2 text-xs dark:border-white/10 dark:bg-white/5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{t(`details.diagnosticKinds.${kind}` as const)}</span>
              {artifact?.mimeType ? (
                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] text-muted-foreground dark:bg-white/10">
                  {artifact.mimeType}
                </span>
              ) : null}
            </div>
            {detail ? (
              <p className="mt-1 max-h-12 overflow-hidden break-words font-mono text-[11px] text-muted-foreground">
                {detail}
              </p>
            ) : null}
            {artifact?.path ? (
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">
                {artifact.path}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// Parse cron schedule to human-readable format
// Handles both plain cron strings and Gateway CronSchedule objects:
//   { kind: "cron", expr: "...", tz?: "..." }
//   { kind: "every", everyMs: number }
//   { kind: "at", at: "..." }
function parseCronSchedule(schedule: unknown, t: TFunction<'cron'>): string {
  // Handle Gateway CronSchedule object format
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; tz?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') {
      return parseCronExpr(s.expr, t);
    }
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return t('schedule.everySeconds', { count: Math.round(ms / 1000) });
      if (ms < 3_600_000) return t('schedule.everyMinutes', { count: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('schedule.everyHours', { count: Math.round(ms / 3_600_000) });
      return t('schedule.everyDays', { count: Math.round(ms / 86_400_000) });
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try {
        return t('schedule.onceAt', { time: new Date(s.at).toLocaleString() });
      } catch {
        return t('schedule.onceAt', { time: s.at });
      }
    }
    return String(schedule);
  }

  // Handle plain cron string
  if (typeof schedule === 'string') {
    return parseCronExpr(schedule, t);
  }

  return String(schedule ?? t('schedule.unknown'));
}

// Parse a plain cron expression string to human-readable text
function parseCronExpr(cron: string, t: TFunction<'cron'>): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return t(`presets.${preset.key}` as const);

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (minute === '*' && hour === '*') return t('presets.everyMinute');
  if (minute.startsWith('*/')) return t('schedule.everyMinutes', { count: Number(minute.slice(2)) });
  if (hour === '*' && minute === '0') return t('presets.everyHour');
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    return t('schedule.weeklyAt', { day: dayOfWeek, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (dayOfMonth !== '*') {
    return t('schedule.monthlyAtDay', { day: dayOfMonth, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (hour !== '*') {
    return t('schedule.dailyAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  }

  return cron;
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * 1') {
    next.setSeconds(0, 0);
    next.setHours(9, 0, 0, 0);
    const day = next.getDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    next.setDate(next.getDate() + daysUntilMonday);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }

  return null;
}

function isKnownChannelType(value: string): value is ChannelType {
  return value in CHANNEL_NAMES;
}

function getChannelDisplayName(value: string): string {
  return isKnownChannelType(value) ? CHANNEL_NAMES[value] : value;
}

function getDeliveryAccountDisplayName(account: DeliveryChannelAccount, t: TFunction): string {
  return account.accountId === 'default' && account.name === account.accountId
    ? t('channels:account.mainAccount')
    : account.name;
}

const TESTED_CRON_DELIVERY_CHANNELS = new Set<string>(['feishu', 'telegram', 'qqbot', 'wecom', 'wechat']);

function isSupportedCronDeliveryChannel(channelType: string): boolean {
  return TESTED_CRON_DELIVERY_CHANNELS.has(channelType);
}

interface SelectFieldProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  children: ReactNode;
}

function SelectField({
  id,
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  triggerClassName,
  children,
}: SelectFieldProps) {
  // shadcn-style Select: hide the value when the user picked the
  // empty / placeholder option (Radix requires a non-empty `value`
  // to drive the controlled component).
  const effectiveValue = value && value.length > 0 ? value : '__placeholder__';
  return (
    <Select
      value={effectiveValue}
      onValueChange={(next) => {
        if (next === '__placeholder__') return;
        onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className={cn(
          'h-[44px] rounded-xl border-black/10 dark:border-white/10 bg-transparent text-meta pr-10',
          triggerClassName,
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {/* Hidden placeholder so the user can clear the field. */}
        {placeholder ? (
          <SelectItem value="__placeholder__" disabled>
            {placeholder}
          </SelectItem>
        ) : null}
        {children}
      </SelectContent>
    </Select>
  );
}

// Create/Edit Task Dialog
interface TaskDialogProps {
  open: boolean;
  job?: CronJob;
  configuredChannels: DeliveryChannelGroup[];
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

function getInitialCronSchedule(job?: CronJob): string {
  const schedule = job?.schedule;
  if (!schedule) return '0 9 * * *';
  if (typeof schedule === 'string') return schedule;
  if (typeof schedule === 'object' && 'expr' in schedule && typeof (schedule as { expr: string }).expr === 'string') {
    return (schedule as { expr: string }).expr;
  }
  return '0 9 * * *';
}

function TaskDialog({ open, job, configuredChannels, onClose, onSave }: TaskDialogProps) {
  const { t } = useTranslation('cron');
  const [saving, setSaving] = useState(false);
  const agents = useAgentsStore((s) => s.agents);

  const [name, setName] = useState(job?.name || '');
  const initialBrowserAutomation = job?.browserAutomation;
  const [taskKind, setTaskKind] = useState<CronJob['taskKind']>(job?.taskKind === 'browserAutomation' ? 'browserAutomation' : 'agentTurn');
  const [message, setMessage] = useState(job?.message || '');
  const [browserUrl, setBrowserUrl] = useState(initialBrowserAutomation?.url || '');
  const [browserObjective, setBrowserObjective] = useState(initialBrowserAutomation?.objective || job?.message || '');
  const [browserSuccessCondition, setBrowserSuccessCondition] = useState(initialBrowserAutomation?.successCondition || '');
  const [browserFailureCondition, setBrowserFailureCondition] = useState(initialBrowserAutomation?.failureCondition || '');
  const [browserTemplate, setBrowserTemplate] = useState<CronBrowserAutomationTemplate>(
    initialBrowserAutomation?.template ?? DEFAULT_CRON_BROWSER_AUTOMATION.template,
  );
  const [browserProfile, setBrowserProfile] = useState(initialBrowserAutomation?.profile || 'default');
  const [browserAuthStateName, setBrowserAuthStateName] = useState(initialBrowserAutomation?.authStateName || '');
  const [browserAuthPersistence, setBrowserAuthPersistence] = useState<CronBrowserAutomationAuthPersistence>(
    initialBrowserAutomation?.authPersistence ?? DEFAULT_CRON_BROWSER_AUTOMATION.authPersistence,
  );
  const [browserMode, setBrowserMode] = useState<CronBrowserAutomationMode>(
    initialBrowserAutomation?.mode ?? DEFAULT_CRON_BROWSER_AUTOMATION.mode,
  );
  const [browserAllowedDomains, setBrowserAllowedDomains] = useState(
    initialBrowserAutomation?.allowedDomains?.join(', ') || '',
  );
  const [browserSensitiveActionPolicy, setBrowserSensitiveActionPolicy] = useState<CronBrowserAutomationSensitiveActionPolicy>(
    initialBrowserAutomation?.sensitiveActionPolicy ?? DEFAULT_CRON_BROWSER_AUTOMATION.sensitiveActionPolicy,
  );
  const [browserRetryOnTransientFailure, setBrowserRetryOnTransientFailure] = useState(
    initialBrowserAutomation?.retryOnTransientFailure ?? DEFAULT_CRON_BROWSER_AUTOMATION.retryOnTransientFailure,
  );
  const [browserDiagnostics, setBrowserDiagnostics] = useState({
    ...DEFAULT_CRON_BROWSER_AUTOMATION.diagnostics,
    ...initialBrowserAutomation?.diagnostics,
  });
  const [browserProfiles, setBrowserProfiles] = useState<AgentBrowserProfileEntry[]>([]);
  const [loadingBrowserProfiles, setLoadingBrowserProfiles] = useState(false);
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [profileLabel, setProfileLabel] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [validatingBrowser, setValidatingBrowser] = useState(false);
  const [validationResult, setValidationResult] = useState<AgentBrowserValidateResult | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState(job?.agentId || useChatStore.getState().currentAgentId);
  const [schedule, setSchedule] = useState(getInitialCronSchedule(job));
  const [customSchedule, setCustomSchedule] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [deliveryMode, setDeliveryMode] = useState<'none' | 'announce'>(job?.delivery?.mode === 'announce' ? 'announce' : 'none');
  const [deliveryChannel, setDeliveryChannel] = useState(job?.delivery?.channel || '');
  const [deliveryTarget, setDeliveryTarget] = useState(job?.delivery?.to || '');
  const [selectedDeliveryAccountId, setSelectedDeliveryAccountId] = useState(job?.delivery?.accountId || '');
  const [channelTargetOptions, setChannelTargetOptions] = useState<ChannelTargetOption[]>([]);
  const [loadingChannelTargets, setLoadingChannelTargets] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSaving(false);
      const nextBrowserAutomation = job?.browserAutomation;
      setName(job?.name || '');
      setTaskKind(job?.taskKind === 'browserAutomation' ? 'browserAutomation' : 'agentTurn');
      setMessage(job?.message || '');
      setBrowserUrl(nextBrowserAutomation?.url || '');
      setBrowserObjective(nextBrowserAutomation?.objective || job?.message || '');
      setBrowserSuccessCondition(nextBrowserAutomation?.successCondition || '');
      setBrowserFailureCondition(nextBrowserAutomation?.failureCondition || '');
      setBrowserTemplate(nextBrowserAutomation?.template ?? DEFAULT_CRON_BROWSER_AUTOMATION.template);
      setBrowserProfile(nextBrowserAutomation?.profile || 'default');
      setBrowserAuthStateName(nextBrowserAutomation?.authStateName || '');
      setBrowserAuthPersistence(nextBrowserAutomation?.authPersistence ?? DEFAULT_CRON_BROWSER_AUTOMATION.authPersistence);
      setBrowserMode(nextBrowserAutomation?.mode ?? DEFAULT_CRON_BROWSER_AUTOMATION.mode);
      setBrowserAllowedDomains(nextBrowserAutomation?.allowedDomains?.join(', ') || '');
      setBrowserSensitiveActionPolicy(nextBrowserAutomation?.sensitiveActionPolicy ?? DEFAULT_CRON_BROWSER_AUTOMATION.sensitiveActionPolicy);
      setBrowserRetryOnTransientFailure(nextBrowserAutomation?.retryOnTransientFailure ?? DEFAULT_CRON_BROWSER_AUTOMATION.retryOnTransientFailure);
      setBrowserDiagnostics({
        ...DEFAULT_CRON_BROWSER_AUTOMATION.diagnostics,
        ...nextBrowserAutomation?.diagnostics,
      });
      setBrowserProfiles([]);
      setLoadingBrowserProfiles(false);
      setShowProfileManager(false);
      setProfileLabel('');
      setProfileDescription('');
      setSavingProfile(false);
      setValidatingBrowser(false);
      setValidationResult(null);
      setSelectedAgentId(job?.agentId || useChatStore.getState().currentAgentId);
      setSchedule(getInitialCronSchedule(job));
      setCustomSchedule('');
      setUseCustom(false);
      setEnabled(job?.enabled ?? true);
      setDeliveryMode(job?.delivery?.mode === 'announce' ? 'announce' : 'none');
      setDeliveryChannel(job?.delivery?.channel || '');
      setDeliveryTarget(job?.delivery?.to || '');
      setSelectedDeliveryAccountId(job?.delivery?.accountId || '');
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
    }
  }
  const schedulePreview = estimateNextRun(useCustom ? customSchedule : schedule);
  const selectableChannels = configuredChannels.filter((group) => isSupportedCronDeliveryChannel(group.channelType));
  const availableChannels = selectableChannels.some((group) => group.channelType === deliveryChannel)
    ? selectableChannels
    : (
      deliveryChannel && isSupportedCronDeliveryChannel(deliveryChannel)
        ? [...selectableChannels, configuredChannels.find((group) => group.channelType === deliveryChannel) || { channelType: deliveryChannel, defaultAccountId: 'default', accounts: [] }]
        : selectableChannels
    );
  const effectiveDeliveryChannel = deliveryChannel
    || (deliveryMode === 'announce' ? (availableChannels[0]?.channelType || '') : '');
  const unsupportedDeliveryChannel = !!effectiveDeliveryChannel && !isSupportedCronDeliveryChannel(effectiveDeliveryChannel);
  const selectedChannel = availableChannels.find((group) => group.channelType === effectiveDeliveryChannel);
  const deliveryAccountOptions = (selectedChannel?.accounts ?? []).map((account) => ({
    accountId: account.accountId,
    displayName: getDeliveryAccountDisplayName(account, t),
  }));
  const hasCurrentDeliveryTarget = !!deliveryTarget;
  const currentDeliveryTargetOption = hasCurrentDeliveryTarget
    ? {
      value: deliveryTarget,
      label: `${t('dialog.currentTarget')} (${deliveryTarget})`,
      kind: 'user' as const,
    }
    : null;
  const effectiveDeliveryAccountId = selectedDeliveryAccountId
    || selectedChannel?.defaultAccountId
    || deliveryAccountOptions[0]?.accountId
    || '';
  const showsAccountSelector = (selectedChannel?.accounts.length ?? 0) > 0;
  const selectedResolvedAccountId = effectiveDeliveryAccountId || undefined;
  const availableTargetOptions = currentDeliveryTargetOption
    ? [currentDeliveryTargetOption, ...channelTargetOptions.filter((option) => option.value !== deliveryTarget)]
    : channelTargetOptions;
  const selectedBrowserProfile = browserProfiles.find((entry) => entry.profile === browserProfile.trim());

  const loadBrowserProfiles = useCallback(async () => {
    setLoadingBrowserProfiles(true);
    try {
      const result = await hostApi.agentBrowser.profiles();
      if (!result.success) {
        throw new Error(result.error || 'Failed to load browser profiles');
      }
      setBrowserProfiles(result.profiles || []);
    } catch (loadError) {
      console.warn('Failed to load browser profiles:', loadError);
      setBrowserProfiles([]);
    } finally {
      setLoadingBrowserProfiles(false);
    }
  }, []);

  useEffect(() => {
    if (!open || taskKind !== 'browserAutomation') return;
    void loadBrowserProfiles();
  }, [loadBrowserProfiles, open, taskKind]);

  useEffect(() => {
    if (deliveryMode !== 'announce') {
      setSelectedDeliveryAccountId('');
      return;
    }

    if (!selectedDeliveryAccountId && selectedChannel?.defaultAccountId) {
      setSelectedDeliveryAccountId(selectedChannel.defaultAccountId);
    }
  }, [deliveryMode, selectedChannel?.defaultAccountId, selectedDeliveryAccountId]);

  useEffect(() => {
    if (deliveryMode !== 'announce' || !effectiveDeliveryChannel || unsupportedDeliveryChannel) {
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      return;
    }

    if (showsAccountSelector && !selectedResolvedAccountId) {
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      return;
    }

    let cancelled = false;
    setLoadingChannelTargets(true);
    void hostApi.channels.targets({
      channelType: effectiveDeliveryChannel,
      accountId: selectedResolvedAccountId,
    }).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        throw new Error(result.error || 'Failed to load channel targets');
      }
      setChannelTargetOptions(result.targets || []);
    }).catch((error) => {
      if (!cancelled) {
        console.warn('Failed to load channel targets:', error);
        setChannelTargetOptions([]);
      }
    }).finally(() => {
      if (!cancelled) {
        setLoadingChannelTargets(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [deliveryMode, effectiveDeliveryChannel, selectedResolvedAccountId, showsAccountSelector, unsupportedDeliveryChannel]);

  const handleValidateBrowserTask = async () => {
    if (!browserUrl.trim()) {
      toast.error(t('toast.browserUrlRequired'));
      return;
    }
    if (!/^https?:\/\//i.test(browserUrl.trim())) {
      toast.error(t('toast.browserUrlInvalid'));
      return;
    }
    setValidatingBrowser(true);
    setValidationResult(null);
    try {
      const allowedDomains = splitAllowedDomains(browserAllowedDomains);
      const result = await hostApi.agentBrowser.validate({
        url: browserUrl.trim(),
        profile: browserProfile.trim() || 'default',
        ...(browserAuthStateName.trim() ? { authStateName: browserAuthStateName.trim() } : {}),
        authPersistence: browserAuthPersistence,
        mode: browserMode,
        connectionMode: 'managed',
        expectedDomains: allowedDomains ?? (firstUrlDomain(browserUrl) ? [firstUrlDomain(browserUrl)!] : undefined),
        diagnostics: browserDiagnostics,
      });
      setValidationResult(result);
      if (result.ok) {
        toast.success(t('toast.browserValidationPassed'));
      } else {
        toast.error(t('toast.browserValidationFailed', { error: result.error || t('assurance.unknown') }));
      }
    } catch (validateError) {
      const result = {
        success: true as const,
        ok: false,
        error: validateError instanceof Error ? validateError.message : String(validateError),
      };
      setValidationResult(result);
      toast.error(t('toast.browserValidationFailed', { error: result.error }));
    } finally {
      setValidatingBrowser(false);
    }
  };

  const handleSaveBrowserProfile = async () => {
    if (!browserProfile.trim()) {
      toast.error(t('toast.browserProfileRequired'));
      return;
    }
    setSavingProfile(true);
    try {
      const result = await hostApi.agentBrowser.saveProfile({
        profile: browserProfile.trim(),
        label: profileLabel.trim() || undefined,
        description: profileDescription.trim() || undefined,
        authStateName: browserAuthStateName.trim() || undefined,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to save browser profile');
      }
      setBrowserProfile(result.profile.profile);
      setBrowserAuthStateName(result.profile.authStateName || '');
      await loadBrowserProfiles();
      toast.success(t('toast.browserProfileSaved'));
    } catch (saveError) {
      toast.error(t('toast.browserProfileSaveFailed', { error: saveError instanceof Error ? saveError.message : String(saveError) }));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    const isBrowserAutomation = taskKind === 'browserAutomation';
    if (!isBrowserAutomation && !message.trim()) {
      toast.error(t('toast.messageRequired'));
      return;
    }
    if (isBrowserAutomation) {
      if (!browserUrl.trim()) {
        toast.error(t('toast.browserUrlRequired'));
        return;
      }
      if (!/^https?:\/\//i.test(browserUrl.trim())) {
        toast.error(t('toast.browserUrlInvalid'));
        return;
      }
      if (!browserObjective.trim()) {
        toast.error(t('toast.browserObjectiveRequired'));
        return;
      }
    }

    const finalSchedule = useCustom ? customSchedule : schedule;
    if (!finalSchedule.trim()) {
      toast.error(t('toast.scheduleRequired'));
      return;
    }

    setSaving(true);
    try {
      const finalDelivery = deliveryMode === 'announce'
        ? {
          mode: 'announce' as const,
          channel: effectiveDeliveryChannel.trim(),
          ...(selectedResolvedAccountId
            ? { accountId: effectiveDeliveryAccountId }
            : {}),
          to: deliveryTarget.trim(),
        }
        : { mode: 'none' as const };

      if (finalDelivery.mode === 'announce') {
        if (!finalDelivery.channel) {
          toast.error(t('toast.channelRequired'));
          return;
        }
        if (!isSupportedCronDeliveryChannel(finalDelivery.channel)) {
          toast.error(t('toast.deliveryChannelUnsupported', { channel: getChannelDisplayName(finalDelivery.channel) }));
          return;
        }
        if (!finalDelivery.to) {
          toast.error(t('toast.deliveryTargetRequired'));
          return;
        }
      }

      await onSave({
        name: name.trim(),
        message: isBrowserAutomation ? browserObjective.trim() : message.trim(),
        taskKind,
        ...(isBrowserAutomation
          ? {
            browserAutomation: {
              url: browserUrl.trim(),
              objective: browserObjective.trim(),
              ...(browserSuccessCondition.trim() ? { successCondition: browserSuccessCondition.trim() } : {}),
              ...(browserFailureCondition.trim() ? { failureCondition: browserFailureCondition.trim() } : {}),
              template: browserTemplate,
              profile: browserProfile.trim() || 'default',
              ...(browserAuthStateName.trim() ? { authStateName: browserAuthStateName.trim() } : {}),
              authPersistence: browserAuthPersistence,
              mode: browserMode,
              ...(splitAllowedDomains(browserAllowedDomains)
                ? { allowedDomains: splitAllowedDomains(browserAllowedDomains) }
                : {}),
              sensitiveActionPolicy: browserSensitiveActionPolicy,
              retryOnTransientFailure: browserRetryOnTransientFailure,
              diagnostics: browserDiagnostics,
            },
            toolsAllow: ['agent_browser'],
          }
          : {}),
        schedule: finalSchedule,
        delivery: finalDelivery,
        enabled,
        agentId: selectedAgentId,
      });
      onClose();
      toast.success(job ? t('toast.updated') : t('toast.created'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent asChild className="w-[calc(100%-2rem)] max-w-lg max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <Card data-testid="cron-task-dialog">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <DialogTitle asChild>
              <CardTitle className="text-2xl font-serif font-normal">{job ? t('dialog.editTitle') : t('dialog.createTitle')}</CardTitle>
            </DialogTitle>
            <DialogDescription asChild>
              <CardDescription className="text-sm mt-1 text-foreground/70">{t('dialog.description')}</CardDescription>
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          {/* Name */}
          <div className="space-y-2.5">
            <Label htmlFor="name" className="text-sm text-foreground/80 font-bold">{t('dialog.taskName')}</Label>
            <Input
              id="name"
              placeholder={t('dialog.taskNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
            />
          </div>

          {/* Task type */}
          <div className="space-y-2.5">
            <Label className="text-sm text-foreground/80 font-bold">{t('dialog.taskType')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                data-testid="cron-task-type-agent"
                variant={taskKind !== 'browserAutomation' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTaskKind('agentTurn')}
                className={cn(
                  'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                  taskKind !== 'browserAutomation'
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                    : 'bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                )}
              >
                <div>
                  <div className="text-meta font-semibold">{t('dialog.taskTypeAgent')}</div>
                  <div className="text-tiny opacity-80">{t('dialog.taskTypeAgentDesc')}</div>
                </div>
              </Button>
              <Button
                type="button"
                data-testid="cron-task-type-browser"
                variant={taskKind === 'browserAutomation' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTaskKind('browserAutomation')}
                className={cn(
                  'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                  taskKind === 'browserAutomation'
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                    : 'bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                )}
              >
                <div>
                  <div className="text-meta font-semibold">{t('dialog.taskTypeBrowser')}</div>
                  <div className="text-tiny opacity-80">{t('dialog.taskTypeBrowserDesc')}</div>
                </div>
              </Button>
            </div>
          </div>

          {taskKind === 'browserAutomation' ? (
            <div className="space-y-4 rounded-2xl border border-black/5 dark:border-white/5 bg-transparent p-4 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="browser-url" className="text-sm text-foreground/80 font-bold">{t('dialog.browserUrl')}</Label>
                <Input
                  id="browser-url"
                  data-testid="cron-browser-url"
                  placeholder={t('dialog.browserUrlPlaceholder')}
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                  className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="browser-objective" className="text-sm text-foreground/80 font-bold">{t('dialog.browserObjective')}</Label>
                <Textarea
                  id="browser-objective"
                  data-testid="cron-browser-objective"
                  placeholder={t('dialog.browserObjectivePlaceholder')}
                  value={browserObjective}
                  onChange={(e) => setBrowserObjective(e.target.value)}
                  rows={3}
                  className="rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40 resize-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="browser-success-condition" className="text-meta text-foreground/80 font-bold">{t('dialog.browserSuccessCondition')}</Label>
                  <Textarea
                    id="browser-success-condition"
                    data-testid="cron-browser-success-condition"
                    placeholder={t('dialog.browserSuccessConditionPlaceholder')}
                    value={browserSuccessCondition}
                    onChange={(e) => setBrowserSuccessCondition(e.target.value)}
                    rows={2}
                    className="rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40 resize-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="browser-failure-condition" className="text-meta text-foreground/80 font-bold">{t('dialog.browserFailureCondition')}</Label>
                  <Textarea
                    id="browser-failure-condition"
                    data-testid="cron-browser-failure-condition"
                    placeholder={t('dialog.browserFailureConditionPlaceholder')}
                    value={browserFailureCondition}
                    onChange={(e) => setBrowserFailureCondition(e.target.value)}
                    rows={2}
                    className="rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40 resize-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="browser-template" className="text-meta text-foreground/80 font-bold">{t('dialog.browserTemplate')}</Label>
                  <SelectField
                    id="browser-template"
                    value={browserTemplate}
                    onValueChange={(value) => setBrowserTemplate(value as CronBrowserAutomationTemplate)}
                  >
                    {browserAutomationTemplates.map((template) => (
                      <SelectItem key={template} value={template}>
                        {t(`dialog.browserTemplates.${template}` as const)}
                      </SelectItem>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="browser-mode" className="text-meta text-foreground/80 font-bold">{t('dialog.browserMode')}</Label>
                  <SelectField
                    id="browser-mode"
                    value={browserMode}
                    onValueChange={(value) => setBrowserMode(value as CronBrowserAutomationMode)}
                  >
                    <SelectItem value="headless">{t('dialog.browserModes.headless')}</SelectItem>
                    <SelectItem value="visible">{t('dialog.browserModes.visible')}</SelectItem>
                  </SelectField>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="browser-profile" className="text-meta text-foreground/80 font-bold">{t('dialog.browserProfile')}</Label>
                  <Input
                    id="browser-profile"
                    data-testid="cron-browser-profile"
                    value={browserProfile}
                    onChange={(e) => setBrowserProfile(e.target.value)}
                    placeholder={t('dialog.browserProfilePlaceholder')}
                    className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                  />
                  {selectedBrowserProfile?.label && (
                    <p className="text-xs text-muted-foreground">{selectedBrowserProfile.label}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="browser-auth-state" className="text-meta text-foreground/80 font-bold">{t('dialog.browserAuthStateName')}</Label>
                  <Input
                    id="browser-auth-state"
                    value={browserAuthStateName}
                    onChange={(e) => setBrowserAuthStateName(e.target.value)}
                    placeholder={t('dialog.browserAuthStateNamePlaceholder')}
                    className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="browser-profile-select" className="text-meta text-foreground/80 font-bold">{t('dialog.browserSavedProfiles')}</Label>
                  <SelectField
                    id="browser-profile-select"
                    value={browserProfile}
                    onValueChange={(value) => {
                      const profile = browserProfiles.find((entry) => entry.profile === value);
                      setBrowserProfile(value);
                      if (profile?.authStateName) setBrowserAuthStateName(profile.authStateName);
                    }}
                    disabled={loadingBrowserProfiles || browserProfiles.length === 0}
                    placeholder={loadingBrowserProfiles ? t('dialog.loadingProfiles') : t('dialog.noSavedProfiles')}
                  >
                    {browserProfiles.map((profile) => (
                      <SelectItem key={profile.profile} value={profile.profile}>
                        {profile.label ? `${profile.label} (${profile.profile})` : profile.profile}
                      </SelectItem>
                    ))}
                  </SelectField>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setProfileLabel(selectedBrowserProfile?.label || browserProfile);
                    setProfileDescription(selectedBrowserProfile?.description || '');
                    setShowProfileManager(true);
                  }}
                  className="h-[44px] rounded-xl border-black/10 dark:border-white/10 bg-transparent text-meta"
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  {t('dialog.profileManager')}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="browser-auth-persistence" className="text-meta text-foreground/80 font-bold">{t('dialog.browserAuthPersistence')}</Label>
                  <SelectField
                    id="browser-auth-persistence"
                    value={browserAuthPersistence}
                    onValueChange={(value) => setBrowserAuthPersistence(value as CronBrowserAutomationAuthPersistence)}
                  >
                    <SelectItem value="session-name">{t('dialog.browserAuthPersistenceModes.sessionName')}</SelectItem>
                    <SelectItem value="profile">{t('dialog.browserAuthPersistenceModes.profile')}</SelectItem>
                    <SelectItem value="off">{t('dialog.browserAuthPersistenceModes.off')}</SelectItem>
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="browser-sensitive-policy" className="text-meta text-foreground/80 font-bold">{t('dialog.browserSensitiveActionPolicy')}</Label>
                  <SelectField
                    id="browser-sensitive-policy"
                    value={browserSensitiveActionPolicy}
                    onValueChange={(value) => setBrowserSensitiveActionPolicy(value as CronBrowserAutomationSensitiveActionPolicy)}
                  >
                    <SelectItem value="draft-only">{t('dialog.browserSensitivePolicies.draftOnly')}</SelectItem>
                    <SelectItem value="auto-submit">{t('dialog.browserSensitivePolicies.autoSubmit')}</SelectItem>
                  </SelectField>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="browser-allowed-domains" className="text-meta text-foreground/80 font-bold">{t('dialog.browserAllowedDomains')}</Label>
                <Input
                  id="browser-allowed-domains"
                  value={browserAllowedDomains}
                  onChange={(e) => setBrowserAllowedDomains(e.target.value)}
                  placeholder={t('dialog.browserAllowedDomainsPlaceholder')}
                  className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                />
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t('dialog.browserRetryOnTransientFailure')}</p>
                  <p className="text-xs text-muted-foreground">{t('dialog.browserRetryOnTransientFailureDesc')}</p>
                </div>
                <Switch
                  checked={browserRetryOnTransientFailure}
                  onCheckedChange={setBrowserRetryOnTransientFailure}
                  aria-label={t('dialog.browserRetryOnTransientFailure')}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-meta text-foreground/80 font-bold">{t('dialog.browserDiagnostics')}</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(['snapshot', 'console', 'errors', 'network', 'screenshot'] as const).map((key) => (
                    <label key={key} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 text-xs text-foreground/80">
                      <span>{t(`dialog.browserDiagnosticOptions.${key}` as const)}</span>
                      <Switch
                        checked={browserDiagnostics[key] === true}
                        onCheckedChange={(checked) => setBrowserDiagnostics((current) => ({ ...current, [key]: checked }))}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-black/10 dark:border-white/10 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t('dialog.browserValidateTitle')}</p>
                    <p className="text-xs text-muted-foreground">{t('dialog.browserValidateDescription')}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleValidateBrowserTask}
                    disabled={validatingBrowser}
                    data-testid="cron-browser-validate"
                    className="h-9 rounded-full border-black/10 dark:border-white/10 bg-transparent text-meta"
                  >
                    {validatingBrowser ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ClipboardCheck className="h-4 w-4 mr-2" />
                    )}
                    {validatingBrowser ? t('dialog.validatingBrowser') : t('dialog.validateBrowserOnce')}
                  </Button>
                </div>
                {validationResult && (
                  <div
                    data-testid="cron-browser-validation-result"
                    className={cn(
                      'rounded-lg border p-3 text-xs',
                      validationResult.ok
                        ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                        : 'border-destructive/20 bg-destructive/10 text-destructive',
                    )}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {validationResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      <span>{validationResult.ok ? t('dialog.validationPassed') : t('dialog.validationFailed')}</span>
                    </div>
                    {validationResult.title || validationResult.url ? (
                      <p className="mt-2 break-words text-foreground/80">
                        {[validationResult.title, validationResult.url].filter(Boolean).join(' - ')}
                      </p>
                    ) : null}
                    {validationResult.error ? <p className="mt-2 break-words">{validationResult.error}</p> : null}
                    {validationResult.textSample ? (
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-foreground/70">{validationResult.textSample}</p>
                    ) : null}
                    {validationResult.screenshotDataUrl ? (
                      <img
                        src={validationResult.screenshotDataUrl}
                        alt={t('dialog.validationScreenshotAlt')}
                        className="mt-3 max-h-32 rounded-md border border-black/10 dark:border-white/10 object-contain"
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <Label htmlFor="message" className="text-sm text-foreground/80 font-bold">{t('dialog.message')}</Label>
              <Textarea
                id="message"
                placeholder={t('dialog.messagePlaceholder')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40 resize-none"
              />
            </div>
          )}

          {/* Agent */}
          <div className="space-y-2.5">
            <Label htmlFor="agent" className="text-sm text-foreground/80 font-bold">{t('dialog.agent')}</Label>
            <SelectField
              id="agent"
              value={selectedAgentId}
              onValueChange={(value) => {
                setSelectedAgentId(value);
              }}
              className="h-[44px] rounded-xl border-black/10 dark:border-white/10 bg-transparent text-meta"
            >
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectField>
          </div>

          {/* Schedule */}
          <div className="space-y-2.5">
            <Label className="text-sm text-foreground/80 font-bold">{t('dialog.schedule')}</Label>
            {!useCustom ? (
              <div className="grid grid-cols-2 gap-2">
                {schedulePresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={schedule === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSchedule(preset.value)}
                    className={cn(
                      "justify-start h-10 rounded-xl font-medium text-meta transition-all",
                      schedule === preset.value
                        ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm border-transparent"
                        : "bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground"
                    )}
                  >
                    <Timer className="h-4 w-4 mr-2 opacity-70" />
                    {t(`presets.${preset.key}` as const)}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                placeholder={t('dialog.cronPlaceholder')}
                value={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.value)}
                className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
              />
            )}
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground/80 font-medium">
                {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUseCustom(!useCustom)}
                className="text-xs h-7 px-2 text-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-lg"
              >
                {useCustom ? t('dialog.usePresets') : t('dialog.useCustomCron')}
              </Button>
            </div>
          </div>

          {/* Delivery */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm text-foreground/80 font-bold">{t('dialog.deliveryTitle')}</Label>
              <p className="text-xs text-muted-foreground">{t('dialog.deliveryDescription')}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={deliveryMode === 'none' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDeliveryMode('none')}
                className={cn(
                  'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                  deliveryMode === 'none'
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                    : 'bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                )}
              >
                <div>
                  <div className="text-meta font-semibold">{t('dialog.deliveryModeNone')}</div>
                  <div className="text-tiny opacity-80">{t('dialog.deliveryModeNoneDesc')}</div>
                </div>
              </Button>
              <Button
                type="button"
                variant={deliveryMode === 'announce' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDeliveryMode('announce')}
                className={cn(
                  'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                  deliveryMode === 'announce'
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                    : 'bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                )}
              >
                <div>
                  <div className="text-meta font-semibold">{t('dialog.deliveryModeAnnounce')}</div>
                  <div className="text-tiny opacity-80">{t('dialog.deliveryModeAnnounceDesc')}</div>
                </div>
              </Button>
            </div>

            {deliveryMode === 'announce' && (
              <div className="space-y-3 rounded-2xl border border-black/5 dark:border-white/5 bg-transparent p-4 shadow-sm">
                <div className="space-y-2">
                  <Label htmlFor="delivery-channel" className="text-meta text-foreground/80 font-bold">
                    {t('dialog.deliveryChannel')}
                  </Label>
                  <SelectField
                    id="delivery-channel"
                    value={effectiveDeliveryChannel}
                    onValueChange={(value) => {
                      setDeliveryChannel(value);
                      setSelectedDeliveryAccountId('');
                      setDeliveryTarget('');
                    }}
                    placeholder={t('dialog.selectChannel')}
                  >
                    {availableChannels.map((group) => (
                      <SelectItem key={group.channelType} value={group.channelType}>
                        {!isSupportedCronDeliveryChannel(group.channelType)
                          ? `${getChannelDisplayName(group.channelType)} (${t('dialog.channelUnsupportedTag')})`
                          : getChannelDisplayName(group.channelType)}
                      </SelectItem>
                    ))}
                  </SelectField>
                  {availableChannels.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('dialog.noChannels')}</p>
                  )}
                  {unsupportedDeliveryChannel && (
                    <p className="text-xs text-destructive">{t('dialog.deliveryChannelUnsupported', { channel: getChannelDisplayName(effectiveDeliveryChannel) })}</p>
                  )}
                  {selectedChannel && (
                    <p className="text-xs text-muted-foreground">
                      {t('dialog.deliveryDefaultAccountHint', { account: selectedChannel.defaultAccountId })}
                    </p>
                  )}
                </div>

                {showsAccountSelector && (
                  <div className="space-y-2">
                    <Label htmlFor="delivery-account" className="text-meta text-foreground/80 font-bold">
                      {t('dialog.deliveryAccount')}
                    </Label>
                    <SelectField
                      id="delivery-account"
                      value={effectiveDeliveryAccountId}
                      onValueChange={(value) => {
                        setSelectedDeliveryAccountId(value);
                        setDeliveryTarget('');
                      }}
                      disabled={deliveryAccountOptions.length === 0}
                      placeholder={t('dialog.selectDeliveryAccount')}
                    >
                      {deliveryAccountOptions.map((option) => (
                        <SelectItem key={option.accountId} value={option.accountId}>
                          {option.displayName}
                        </SelectItem>
                      ))}
                    </SelectField>
                    <p className="text-xs text-muted-foreground">{t('dialog.deliveryAccountDesc')}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="delivery-target-select" className="text-meta text-foreground/80 font-bold">
                    {t('dialog.deliveryTarget')}
                  </Label>
                  <SelectField
                    id="delivery-target-select"
                    value={deliveryTarget}
                    onValueChange={(value) => setDeliveryTarget(value)}
                    disabled={loadingChannelTargets || availableTargetOptions.length === 0}
                    placeholder={loadingChannelTargets ? t('dialog.loadingTargets') : t('dialog.selectDeliveryTarget')}
                  >
                    {availableTargetOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectField>
                  <p className="text-xs text-muted-foreground">
                    {availableTargetOptions.length > 0
                      ? t('dialog.deliveryTargetDescAuto')
                      : t('dialog.noDeliveryTargets', { channel: getChannelDisplayName(effectiveDeliveryChannel) })}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between bg-transparent p-4 rounded-2xl shadow-sm border border-black/5 dark:border-white/5">
            <div>
              <Label className="text-sm text-foreground/80 font-bold">{t('dialog.enableImmediately')}</Label>
              <p className="text-meta text-muted-foreground mt-0.5">
                {t('dialog.enableImmediatelyDesc')}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={onClose} className="rounded-full px-6 h-[42px] text-meta font-semibold border-black/20 dark:border-white/20 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground shadow-sm">
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving} className="rounded-full px-6 h-[42px] text-meta font-semibold shadow-sm border border-transparent transition-all">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('common:status.saving', 'Saving...')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {job ? t('dialog.saveChanges') : t('dialog.createTitle')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      </DialogContent>
    </Dialog>
    <Dialog open={showProfileManager} onOpenChange={setShowProfileManager}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl rounded-3xl border-0 bg-surface-modal p-6 shadow-2xl">
        <DialogTitle className="text-xl font-serif font-normal">{t('dialog.profileManager')}</DialogTitle>
        <DialogDescription className="text-sm text-foreground/70">{t('dialog.profileManagerDescription')}</DialogDescription>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="browser-profile-label" className="text-meta text-foreground/80 font-bold">{t('dialog.profileLabel')}</Label>
              <Input
                id="browser-profile-label"
                value={profileLabel}
                onChange={(event) => setProfileLabel(event.target.value)}
                placeholder={browserProfile || 'default'}
                className="h-[44px] rounded-xl bg-transparent text-meta"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-meta text-foreground/80 font-bold">{t('dialog.browserProfile')}</Label>
              <Input value={browserProfile || 'default'} readOnly className="h-[44px] rounded-xl bg-transparent font-mono text-meta" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="browser-profile-description" className="text-meta text-foreground/80 font-bold">{t('dialog.profileDescription')}</Label>
            <Textarea
              id="browser-profile-description"
              value={profileDescription}
              onChange={(event) => setProfileDescription(event.target.value)}
              rows={2}
              placeholder={t('dialog.profileDescriptionPlaceholder')}
              className="rounded-xl bg-transparent text-meta"
            />
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-black/10 dark:border-white/10 p-3">
            {browserProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dialog.noSavedProfiles')}</p>
            ) : (
              browserProfiles.map((profile) => (
                <button
                  key={profile.profile}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => {
                    setBrowserProfile(profile.profile);
                    setBrowserAuthStateName(profile.authStateName || '');
                    setProfileLabel(profile.label || profile.profile);
                    setProfileDescription(profile.description || '');
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground">{profile.label || profile.profile}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {profile.profile}
                      {profile.authStateName ? ` / ${profile.authStateName}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {profile.activeSessions ? t('dialog.activeSessions', { count: profile.activeSessions }) : profile.source}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowProfileManager(false)}
              className="rounded-full px-5"
            >
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleSaveBrowserProfile}
              disabled={savingProfile}
              data-testid="cron-browser-save-profile"
              className="rounded-full px-5"
            >
              {savingProfile ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
              {t('dialog.saveProfile')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

// Job Card Component
interface CronRunDetailsDialogProps {
  job?: CronJob;
  messages: RawMessage[];
  browserAutomationRuns: BrowserAutomationRunResult[];
  loading: boolean;
  error?: string;
  onClose: () => void;
}

function CronRunDetailsDialog({
  job,
  messages,
  browserAutomationRuns,
  loading,
  error,
  onClose,
}: CronRunDetailsDialogProps) {
  const { t } = useTranslation('cron');
  const browserAutomation = job?.browserAutomation;
  return (
    <Dialog open={!!job} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl rounded-3xl border-0 bg-surface-modal p-6 shadow-2xl">
        <DialogTitle className="flex items-center gap-2 text-xl font-serif font-normal">
          <ListChecks className="h-5 w-5" />
          {t('details.title')}
        </DialogTitle>
        <DialogDescription className="text-sm text-foreground/70">
          {job ? t('details.description', { name: job.name }) : ''}
        </DialogDescription>
        {job && (
          <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3 text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <p className="font-semibold text-muted-foreground">{t('details.url')}</p>
              <p className="mt-1 truncate font-mono text-foreground">{browserAutomation?.url || '-'}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-muted-foreground">{t('details.profile')}</p>
              <p className="mt-1 truncate font-mono text-foreground">{browserAutomation?.profile || 'default'}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-muted-foreground">{t('details.template')}</p>
              <p className="mt-1 truncate text-foreground">
                {browserAutomation?.template ? t(`dialog.browserTemplates.${browserAutomation.template}` as const) : '-'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-muted-foreground">{t('details.lastRun')}</p>
              <p className="mt-1 truncate text-foreground">
                {job.lastRun ? `${formatRelativeTime(job.lastRun.time)} / ${job.lastRun.success ? t('details.success') : t('details.failed')}` : '-'}
              </p>
            </div>
          </div>
        )}
        <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-xl border border-black/10 dark:border-white/10 p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('details.loading')}
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : messages.length === 0 && browserAutomationRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('details.empty')}</p>
          ) : (
            <div className="space-y-3">
              {browserAutomationRuns.map((run) => (
                <div
                  key={run.runId}
                  data-testid="cron-browser-run-result"
                  className={cn(
                    'rounded-lg border p-3 text-sm',
                    run.status === 'success'
                      ? 'border-green-500/20 bg-green-500/10'
                      : 'border-destructive/20 bg-destructive/10',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-foreground">
                      {t('details.structuredResult')} · {run.status}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(run.endedAt).toLocaleString()}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <span className="truncate">{t('details.loginState')}: {run.loginState}</span>
                    <span className="truncate">{t('details.finalUrl')}: {run.finalUrl || '-'}</span>
                    <span className="truncate">{t('details.artifacts')}: {run.evidence.artifacts.length}</span>
                    <span className="truncate">
                      {t('details.steps')}: {run.steps.filter((step) => step.status === 'passed').length}/{run.steps.length}
                    </span>
                  </div>
                  {run.error ? <p className="mt-2 text-xs text-destructive">{run.error}</p> : null}
                  {run.steps.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {run.steps.map((step) => (
                        <div key={step.id} className="flex items-start gap-2 text-xs">
                          <span className={cn(
                            'mt-1 h-2 w-2 shrink-0 rounded-full',
                            step.status === 'passed'
                              ? 'bg-green-500'
                              : step.status === 'failed'
                                ? 'bg-destructive'
                                : 'bg-muted-foreground',
                          )} />
                          <span className="min-w-0">
                            <span className="font-medium">{step.label}</span>
                            {step.detail ? <span className="text-muted-foreground"> — {step.detail}</span> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <BrowserAutomationEvidenceCards run={run} />
                  {run.evidence.artifacts.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground">{t('details.artifacts')}</p>
                      {run.evidence.artifacts.map((artifact) => (
                        <div key={artifact.id} className="truncate rounded bg-black/5 px-2 py-1 font-mono text-[11px] dark:bg-white/5">
                          {artifact.kind}: {artifact.path || artifact.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {messages.map((message, index) => (
                <div
                  key={message.id || `${message.role}-${index}`}
                  className={cn(
                    'rounded-lg border p-3 text-sm',
                    message.isError
                      ? 'border-destructive/20 bg-destructive/10 text-destructive'
                      : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="font-semibold">{message.role}</span>
                    {message.timestamp ? <span>{new Date(message.timestamp).toLocaleString()}</span> : null}
                  </div>
                  <p className="whitespace-pre-wrap break-words leading-6">{summarizeMessageContent(message.content)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CronJobCardProps {
  job: CronJob;
  deliveryAccountName?: string;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
  onDetails: () => void;
}

function CronJobCard({ job, deliveryAccountName, onToggle, onEdit, onDelete, onTrigger, onDetails }: CronJobCardProps) {
  const { t } = useTranslation('cron');
  const [triggering, setTriggering] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const agentName = agents.find((a) => a.id === job.agentId)?.name ?? job.agentId;
  const isBrowserAutomation = job.taskKind === 'browserAutomation';

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
      toast.success(t('toast.triggered'));
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDetails();
  };

  const deliveryChannel = typeof job.delivery?.channel === 'string' ? job.delivery.channel : '';
  const deliveryLabel = deliveryChannel ? getChannelDisplayName(deliveryChannel) : '';
  const deliveryIcon = deliveryChannel && isKnownChannelType(deliveryChannel)
    ? CHANNEL_ICONS[deliveryChannel]
    : null;
  const sourceLabel = job.source === 'config-fallback' ? t('assurance.sourceFallback') : t('assurance.sourceGateway');
  const runtimeTarget = job.runtime?.sessionTarget === 'isolated'
    ? t('assurance.isolatedRun')
    : (job.runtime?.sessionTarget || t('assurance.unknown'));
  const wakeLabel = job.runtime?.wakeMode === 'next-heartbeat'
    ? t('assurance.nextHeartbeat')
    : (job.runtime?.wakeMode || t('assurance.unknown'));
  const resultLabel = job.delivery?.mode === 'announce' && deliveryChannel
    ? t('assurance.externalDelivery')
    : t('assurance.inAppResult');
  const deliveryTargetLabel = deliveryAccountName || job.delivery?.to || '';

  return (
    <div
      data-testid={`cron-job-card-${job.id}`}
      className="group grid min-h-[224px] grid-rows-[auto_1fr_auto] gap-3 rounded-lg border border-border/70 bg-background/45 p-4 transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer overflow-hidden"
      onClick={onEdit}
    >
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3">
        <div className="h-9 w-9 shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-border/60 rounded-md">
            {isBrowserAutomation ? (
              <Globe2 className={cn("h-5 w-5", job.enabled ? "text-foreground" : "text-muted-foreground")} />
            ) : (
              <Clock className={cn("h-5 w-5", job.enabled ? "text-foreground" : "text-muted-foreground")} />
            )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 data-testid={`cron-job-card-title-${job.id}`} className="min-w-0 truncate text-sm font-semibold text-foreground leading-5">{job.name}</h3>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none",
                job.enabled
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              )}
              title={job.enabled ? t('stats.active') : t('stats.paused')}
            >
              {job.enabled ? t('stats.active') : t('stats.paused')}
            </span>
            {isBrowserAutomation && (
              <span className="shrink-0 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-blue-700 dark:text-blue-400">
                {t('card.browserAutomation')}
              </span>
            )}
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{parseCronSchedule(job.schedule, t)}</span>
          </p>
        </div>

        <div data-testid={`cron-job-card-switch-${job.id}`} className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <Switch
            checked={job.enabled}
            onCheckedChange={onToggle}
          />
        </div>
      </div>

      <div className="min-w-0 space-y-3 pl-12">
        <div className="flex min-w-0 items-start gap-2">
          <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground line-clamp-2 leading-5">
            {isBrowserAutomation && job.browserAutomation
              ? `${job.browserAutomation.url} - ${job.browserAutomation.objective}`
              : job.message}
          </p>
        </div>

        <div data-testid={`cron-job-card-meta-${job.id}`} className="grid min-w-0 grid-cols-1 gap-2 text-xs text-muted-foreground/80 sm:grid-cols-2">
          {job.delivery?.mode === 'announce' && deliveryChannel && (
            <span className="flex min-w-0 items-center gap-1.5">
              {deliveryIcon}
              <span className="shrink-0">{deliveryLabel}</span>
              {deliveryTargetLabel ? <span className="min-w-0 truncate">{deliveryTargetLabel}</span> : null}
            </span>
          )}

          {job.lastRun && (
            <span className="flex min-w-0 items-center gap-1.5">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('card.last')}: {formatRelativeTime(job.lastRun.time)}</span>
              {job.lastRun.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
              )}
            </span>
          )}

          {job.nextRun && job.enabled && (
            <span className="flex min-w-0 items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('card.next')}: {new Date(job.nextRun).toLocaleString()}</span>
            </span>
          )}

          <span className="flex min-w-0 items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{agentName}</span>
          </span>

          <span className="flex min-w-0 items-center gap-1.5">
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{sourceLabel}</span>
          </span>

          <span className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{runtimeTarget}</span>
          </span>
        </div>

        {job.lastRun && !job.lastRun.success && job.lastRun.error && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{job.lastRun.error}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <RadioTower className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{wakeLabel}</span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
          <span className="truncate">{resultLabel}</span>
        </div>
        <div className="flex shrink-0 justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
          {isBrowserAutomation && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDetails}
              className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors"
              aria-label={t('card.runDetails')}
              title={t('card.runDetails')}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleTrigger}
            disabled={triggering}
            className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors"
            aria-label={t('card.runNow')}
            title={t('card.runNow')}
          >
            {triggering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
            aria-label={t('common:actions.delete', 'Delete')}
            title={t('common:actions.delete', 'Delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<{ id: string } | null>(null);
  const [configuredChannels, setConfiguredChannels] = useState<DeliveryChannelGroup[]>([]);
  const [detailsJob, setDetailsJob] = useState<CronJob | undefined>();
  const [detailsMessages, setDetailsMessages] = useState<RawMessage[]>([]);
  const [detailsBrowserRuns, setDetailsBrowserRuns] = useState<BrowserAutomationRunResult[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | undefined>();

  const isGatewayRunning = gatewayStatus.state === 'running';
  const showGatewayUnavailableWarning = isGatewayStopped(gatewayStatus);

  const fetchConfiguredChannels = useCallback(async () => {
    try {
      const response = await hostApi.channels.accounts();
      if (!response.success) {
        throw new Error(response.error || 'Failed to load delivery channels');
      }
      setConfiguredChannels(response.channels || []);
    } catch (fetchError) {
      console.warn('Failed to load delivery channels:', fetchError);
      setConfiguredChannels([]);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    void fetchConfiguredChannels();
  }, [fetchConfiguredChannels]);

  useEffect(() => {
    if (!detailsJob) return;
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(undefined);
    setDetailsMessages([]);
    setDetailsBrowserRuns([]);
    const sessionKey = `agent:${detailsJob.agentId}:cron:${detailsJob.id}`;
    void hostApi.cron.sessionHistory({ sessionKey, limit: 20 })
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result === 'object' && 'success' in result && result.success === false) {
          throw new Error('error' in result && typeof result.error === 'string' ? result.error : 'Failed to load run details');
        }
        setDetailsMessages((result.messages || []) as RawMessage[]);
        setDetailsBrowserRuns(result.browserAutomationRuns || []);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetailsError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailsJob]);

  // Statistics
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const activeJobs = safeJobs.filter((j) => j.enabled);
  const pausedJobs = safeJobs.filter((j) => !j.enabled);
  const failedJobs = safeJobs.filter((j) => j.lastRun && !j.lastRun.success);
  const fallbackJobs = safeJobs.filter((j) => j.source === 'config-fallback');
  const externalDeliveryJobs = safeJobs.filter((j) => j.delivery?.mode === 'announce');
  const gatewayAssuranceLabel = isGatewayRunning
    ? t('assurance.gatewayConnected')
    : (fallbackJobs.length > 0 ? t('assurance.readOnlyFallback') : t('assurance.gatewayOffline'));

  const handleSave = useCallback(async (input: CronJobCreateInput) => {
    if (editingJob) {
      await updateJob(editingJob.id, input);
    } else {
      await createJob(input);
    }
  }, [editingJob, createJob, updateJob]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await toggleJob(id, enabled);
      toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
    } catch {
      toast.error(t('toast.failedUpdate'));
    }
  }, [toggleJob, t]);



  if (loading) {
    return (
      <div data-testid="cron-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="cron-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 pt-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-serif text-foreground mb-2 font-normal tracking-tight">
              {t('title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => {
                void fetchJobs();
                void fetchConfiguredChannels();
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
            <Button
              data-testid="cron-new-task-button"
              onClick={() => {
                setEditingJob(undefined);
                setShowDialog(true);
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-meta font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('newTask')}
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-8 min-h-0 -mr-2">
          {/* Gateway Warning */}
          {showGatewayUnavailableWarning && (
            <div className="mb-4 p-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          <div data-testid="cron-assurance-panel" className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('assurance.scheduler')}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground">{gatewayAssuranceLabel}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <RadioTower className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('assurance.wake')}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground">{t('assurance.nextHeartbeat')}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('assurance.source')}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground">
                {fallbackJobs.length > 0
                  ? t('assurance.fallbackCount', { count: fallbackJobs.length })
                  : t('assurance.gatewaySnapshot')}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Send className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('assurance.delivery')}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground">
                {t('assurance.deliverySummary', {
                  external: externalDeliveryJobs.length,
                  local: safeJobs.length - externalDeliveryJobs.length,
                })}
              </p>
            </div>
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[104px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2 min-w-0">
                <p className="text-stat font-serif text-foreground">{safeJobs.length}</p>
                <p className="truncate text-sm font-medium text-muted-foreground">{t('stats.total')}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[104px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Play className="h-5 w-5 text-green-600 dark:text-green-500 ml-0.5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2 min-w-0">
                <p className="text-stat font-serif text-foreground">{activeJobs.length}</p>
                <p className="truncate text-sm font-medium text-muted-foreground">{t('stats.active')}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[104px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Pause className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2 min-w-0">
                <p className="text-stat font-serif text-foreground">{pausedJobs.length}</p>
                <p className="truncate text-sm font-medium text-muted-foreground">{t('stats.paused')}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[104px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2 min-w-0">
                <p className="text-stat font-serif text-foreground">{failedJobs.length}</p>
                <p className="truncate text-sm font-medium text-muted-foreground">{t('stats.failed')}</p>
              </div>
            </div>
          </div>

          {/* Jobs List */}
          {safeJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-lg border border-transparent border-dashed">
              <Clock className="h-10 w-10 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2 text-foreground">{t('empty.title')}</h3>
              <p className="text-sm text-center mb-6 max-w-md">
                {t('empty.description')}
              </p>
              <Button
                onClick={() => {
                  setEditingJob(undefined);
                  setShowDialog(true);
                }}
                disabled={!isGatewayRunning}
                className="rounded-full px-6 h-10"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('empty.create')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {safeJobs.map((job) => {
                const channelGroup = configuredChannels.find((group) => group.channelType === job.delivery?.channel);
                const account = channelGroup?.accounts.find((item) => item.accountId === job.delivery?.accountId);
                const deliveryAccountName = account ? getDeliveryAccountDisplayName(account, t) : undefined;
                return (
                <CronJobCard
                  key={job.id}
                  job={job}
                  deliveryAccountName={deliveryAccountName}
                  onToggle={(enabled) => handleToggle(job.id, enabled)}
                  onEdit={() => {
                    setEditingJob(job);
                    setShowDialog(true);
                  }}
                  onDelete={() => setJobToDelete({ id: job.id })}
                  onTrigger={() => triggerJob(job.id)}
                  onDetails={() => setDetailsJob(job)}
                />
                );
              })}
            </div>
          )}

        </div>
      </div>

      {/* Create/Edit Dialog */}
      <TaskDialog
        open={showDialog}
        job={editingJob}
        configuredChannels={configuredChannels}
        onClose={() => {
          setShowDialog(false);
        }}
        onSave={handleSave}
      />

      <CronRunDetailsDialog
        job={detailsJob}
        messages={detailsMessages}
        browserAutomationRuns={detailsBrowserRuns}
        loading={detailsLoading}
        error={detailsError}
        onClose={() => setDetailsJob(undefined)}
      />

      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (jobToDelete) {
            await deleteJob(jobToDelete.id);
            setJobToDelete(null);
            toast.success(t('toast.deleted'));
          }
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

export default Cron;
