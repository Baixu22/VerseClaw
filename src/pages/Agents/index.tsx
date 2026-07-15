import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  Info,
  ListChecks,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import RoleProfileEditor from '@/components/agents/RoleProfileEditor';
import RolesOrchestrationPanel from '@/components/agents/RolesOrchestrationPanel';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { AgentAvatarEditor } from '@/components/agents/AgentAvatarEditor';
import type { AgentRoleProfile } from '@shared/types/agent';
import { DEFAULT_ROLE_PROFILE } from '@shared/types/agent';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { hostApi, type ChannelGroupItem } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import type {
  CapabilityPublicationEntry,
  CapabilityPublicationQuery,
  CapabilityPublicationResult,
} from '@shared/host-api/contract';
import {
  addPublicationToIds,
  buildCapabilityRows,
  calculateCapabilityDraftDiff,
  filterCapabilityRows,
  removePublicationFromIds,
  sortCapabilityRows,
  splitCapabilityIdList,
  summarizeCapabilityDiagnostics,
  type CapabilityKindFilter,
  type CapabilityPublicationRow,
  type CapabilityStateFilter,
} from '@/lib/capability-publication-view-model';
import {
  buildRuntimeProviderOptions,
  splitModelRef,
  type RuntimeProviderOption,
} from '@/lib/model-options';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

export function Agents({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const lastGatewayStateRef = useRef(gatewayStatus.state);
  const {
    agents,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(() => agents.length > 0);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [settingsModalAgent, setSettingsModalAgent] = useState<AgentSummary | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  const fetchChannelAccounts = useCallback(async () => {
    try {
      const response = await hostApi.channels.accounts();
      setChannelGroups(response.channels || []);
    } catch {
      // Keep the last rendered snapshot when channel account refresh fails.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([fetchAgents(), fetchChannelAccounts(), refreshProviderSnapshot()]).finally(() => {
      if (mounted) {
        setHasCompletedInitialLoad(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [fetchAgents, fetchChannelAccounts, refreshProviderSnapshot]);

  useEffect(() => {
    const unsubscribe = hostEvents.onGatewayChannelStatus(() => {
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannelAccounts]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchChannelAccounts();
    }
  }, [fetchChannelAccounts, gatewayStatus.state]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );

  const visibleAgents = agents;
  const visibleChannelGroups = channelGroups;
  const isUsingStableValue = loading && hasCompletedInitialLoad;
  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannelAccounts()]);
  };

  if (loading && !hasCompletedInitialLoad) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center',
        embedded ? 'min-h-64' : '-m-6 min-h-[calc(100vh-2.5rem)] dark:bg-background',
      )}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      data-testid="agents-page"
      className={cn(
        'flex flex-col',
        embedded ? 'w-full' : '-m-6 h-[calc(100vh-2.5rem)] overflow-hidden dark:bg-background',
      )}
    >
      <div className={cn(
        'w-full flex flex-col',
        embedded ? 'min-h-0' : 'max-w-5xl mx-auto h-full p-10 pt-16',
      )}>
        <div className={cn(
          'flex flex-col md:flex-row md:items-start shrink-0 gap-4',
          embedded ? 'mb-6 justify-end' : 'mb-12 justify-between',
        )}>
          {!embedded && (
            <div>
              <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">
                {t('title')}
              </h1>
              <p className="text-subtitle text-foreground/70 font-medium">{t('subtitle')}</p>
            </div>
          )}
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', isUsingStableValue && 'animate-spin')} />
              {t('refresh')}
            </Button>
            <Button
              data-testid="agents-add-button"
              onClick={() => setShowAddDialog(true)}
              className="h-9 text-meta font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('addAgent')}
            </Button>
          </div>
        </div>

        <div className={cn(
          embedded ? 'min-h-0' : 'flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2',
        )}>
          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          <div className="space-y-3">
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                channelGroups={visibleChannelGroups}
                onOpenSettings={() => {
                  setSettingsModalAgent(agent);
                  setActiveAgentId(agent.id);
                }}
                onDelete={() => setAgentToDelete(agent)}
              />
            ))}
          </div>

          <RolesOrchestrationPanel agents={agents} />
        </div>
      </div>

      <AddAgentDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onCreate={async (name, options) => {
          await createAgent(name, options);
          setShowAddDialog(false);
          toast.success(t('toast.agentCreated'));
        }}
      />

      {(activeAgent || settingsModalAgent) && (
        <AgentSettingsModal
          open={!!activeAgent}
          agent={(activeAgent || settingsModalAgent)!}
          channelGroups={visibleChannelGroups}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          try {
            await deleteAgent(agentToDelete.id);
            const deletedId = agentToDelete.id;
            setAgentToDelete(null);
            if (activeAgentId === deletedId) {
              setActiveAgentId(null);
            }
            toast.success(t('toast.agentDeleted'));
          } catch (error) {
            toast.error(t('toast.agentDeleteFailed', { error: String(error) }));
          }
        }}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

function AgentCard({
  agent,
  channelGroups,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const boundChannelAccounts = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => {
        const channelName = CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType;
        const accountLabel =
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId;
        return `${channelName} · ${accountLabel}`;
      }),
  );
  const channelsText = boundChannelAccounts.length > 0
    ? boundChannelAccounts.join(', ')
    : t('none');

  return (
    <div
      className={cn(
        'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5',
        agent.isDefault && 'bg-black/[0.04] dark:bg-white/[0.06]'
      )}
    >
      <AgentAvatar agentId={agent.id} name={agent.name} avatar={agent.avatar} size={46} className="mb-3 shadow-sm" />
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">{agent.name}</h2>
            {agent.isDefault && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 font-mono text-2xs font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
              >
                <Check className="h-3 w-3" />
                {t('defaultBadge')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!agent.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                onClick={onDelete}
                title={t('deleteAgent')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              data-testid={`agent-settings-${agent.id}`}
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all',
                !agent.isDefault && 'opacity-0 group-hover:opacity-100',
              )}
              onClick={onOpenSettings}
              title={t('settings')}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('modelLine', {
            model: agent.modelDisplay,
            suffix: agent.inheritedModel ? ` (${t('inherited')})` : '',
          })}
        </p>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('channelsLine', { channels: channelsText })}
        </p>
      </div>
    </div>
  );
}

const inputClasses = 'h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
// The shadcn-style `SelectTrigger` already provides the height /
// rounded / focus-ring treatment. We only add a couple of typography
// helpers here so the trigger visually matches the surrounding input
// fields in the same dialog (font-mono, text-meta) and supports
// proper dark theme colors (bg-foreground/5 instead of bg-white/5).
const selectTriggerClasses = 'h-[44px] w-full rounded-xl font-mono text-meta bg-foreground/[0.04] dark:bg-white/[0.05] border-black/10 dark:border-white/10 focus:ring-2 focus:ring-primary/30 focus:border-primary/50 px-4 text-foreground shadow-sm transition-all';
const labelClasses = 'text-sm text-foreground/80 font-bold';

type AgentsT = ReturnType<typeof useTranslation>['t'];

function idsToText(ids: string[]): string {
  return ids.join('\n');
}

function publicationStateLabel(t: AgentsT, state: CapabilityPublicationEntry['state']): string {
  return t(`identityTools.publication.state.${state}`, { defaultValue: state });
}

function publicationKindLabel(t: AgentsT, kind: CapabilityPublicationEntry['kind']): string {
  return t(`identityTools.publication.kind.${kind}`, { defaultValue: kind });
}

function rowKey(row: CapabilityPublicationRow): string {
  return `${row.publication.kind}:${row.canonicalId}`;
}

function compactList(values?: string[]): string {
  return values && values.length > 0 ? values.join(', ') : '-';
}

function CapabilityPublicationWorkbench({
  agent,
  baselineSkillIds,
  baselineMcpServerIds,
  draftSkillIds,
  draftMcpServerIds,
  onDraftSkillIdsChange,
  onDraftMcpServerIdsChange,
  onApplyChanges,
  onDiscardChanges,
  saving,
  disabled,
}: {
  agent: AgentSummary;
  baselineSkillIds: string[];
  baselineMcpServerIds: string[];
  draftSkillIds: string[];
  draftMcpServerIds: string[];
  onDraftSkillIdsChange: (ids: string[]) => void;
  onDraftMcpServerIdsChange: (ids: string[]) => void;
  onApplyChanges: () => Promise<void>;
  onDiscardChanges: () => void;
  saving: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('agents');
  const [result, setResult] = useState<CapabilityPublicationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<CapabilityKindFilter>('all');
  const [stateFilter, setStateFilter] = useState<CapabilityStateFilter>('all');
  const [onlySelected, setOnlySelected] = useState(false);
  const [onlyDiagnostics, setOnlyDiagnostics] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [mcpToolNames, setMcpToolNames] = useState<Record<string, string[]>>({});
  const [mcpRuntimeMessage, setMcpRuntimeMessage] = useState<Record<string, string>>({});

  const trimmedRoleName = roleName.trim();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: CapabilityPublicationQuery = {
        agentId: agent.id,
        workspaceId: agent.workspace,
        includeDiagnostics: true,
        includeCandidates: true,
        includeToolCatalog: 'warmOnly',
        ...(trimmedRoleName ? { roleName: trimmedRoleName } : {}),
      };
      const next = await hostApi.capabilities.publications(query);
      setResult(next);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [agent.id, agent.workspace, trimmedRoleName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: CapabilityPublicationQuery = {
      agentId: agent.id,
      workspaceId: agent.workspace,
      includeDiagnostics: true,
      includeCandidates: true,
      includeToolCatalog: 'warmOnly',
      ...(trimmedRoleName ? { roleName: trimmedRoleName } : {}),
    };
    void hostApi.capabilities.publications(query)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setResult(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.workspace, trimmedRoleName]);

  const publications = result?.publications ?? [];
  const rows = useMemo(() => buildCapabilityRows({
    publications,
    baselineSkillIds,
    draftSkillIds,
    baselineMcpServerIds,
    draftMcpServerIds,
  }), [baselineMcpServerIds, baselineSkillIds, draftMcpServerIds, draftSkillIds, publications]);
  const visibleRows = useMemo(() => sortCapabilityRows(filterCapabilityRows(rows, {
    query: search,
    kind: kindFilter,
    state: stateFilter,
    onlySelected,
    onlyDiagnostics,
    onlyChanged,
  })), [kindFilter, onlyChanged, onlyDiagnostics, onlySelected, rows, search, stateFilter]);
  const diff = useMemo(() => calculateCapabilityDraftDiff({
    publications,
    baselineSkillIds,
    draftSkillIds,
    baselineMcpServerIds,
    draftMcpServerIds,
  }), [baselineMcpServerIds, baselineSkillIds, draftMcpServerIds, draftSkillIds]);
  const diagnostics = summarizeCapabilityDiagnostics(result);
  const selectedRow = selectedRowKey ? rows.find((row) => rowKey(row) === selectedRowKey) ?? null : null;
  const publishedCount = publications.filter((entry) => entry.state === 'published').length;
  const selectedCount = draftSkillIds.length + draftMcpServerIds.length;
  const fallback = result?.source === 'local-fallback'
    || result?.diagnostics.some((entry) => entry.code === 'runtimeUnavailable');

  const updateRowSelection = (row: CapabilityPublicationRow) => {
    if (row.blocked && !row.selected) return;
    if (row.publication.kind === 'skill') {
      onDraftSkillIdsChange(row.selected
        ? removePublicationFromIds(draftSkillIds, row.publication)
        : addPublicationToIds(draftSkillIds, row.publication));
      return;
    }
    onDraftMcpServerIdsChange(row.selected
      ? removePublicationFromIds(draftMcpServerIds, row.publication)
      : addPublicationToIds(draftMcpServerIds, row.publication));
  };

  const runMcpHeartbeat = async (row: CapabilityPublicationRow) => {
    const serverId = row.publication.serverId ?? row.publication.sourceId;
    setMcpBusy(`heartbeat:${serverId}`);
    try {
      const outcome = await hostApi.mcp.heartbeat({ serverId });
      const message = outcome.message || outcome.error || outcome.status || '-';
      setMcpRuntimeMessage((prev) => ({ ...prev, [serverId]: message }));
      if (outcome.success) toast.success(message);
      else toast.error(message);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMcpBusy(null);
    }
  };

  const runMcpListTools = async (row: CapabilityPublicationRow) => {
    const serverId = row.publication.serverId ?? row.publication.sourceId;
    setMcpBusy(`tools:${serverId}`);
    try {
      const outcome = await hostApi.mcp.listTools({ serverId });
      setMcpToolNames((prev) => ({ ...prev, [serverId]: outcome.tools.map((tool) => tool.name) }));
      const message = outcome.message || t('identityTools.publication.detail.toolsLoaded', { count: outcome.tools.length });
      setMcpRuntimeMessage((prev) => ({ ...prev, [serverId]: message }));
      if (outcome.success) toast.success(message);
      else toast.error(outcome.error || message);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMcpBusy(null);
    }
  };

  const runMcpReload = async () => {
    setMcpBusy('reload');
    try {
      const outcome = await hostApi.mcp.reloadRuntime({ agentId: agent.id, workspaceId: agent.workspace });
      const message = outcome.message || t('identityTools.publication.detail.runtimeReloaded');
      if (outcome.success) toast.success(message);
      else toast.error(outcome.error || message);
      setMcpRuntimeMessage((prev) => ({ ...prev, __reload: message }));
      await refresh();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMcpBusy(null);
    }
  };

  return (
    <div
      data-testid="agent-capability-workbench"
      className="space-y-4 rounded-2xl border border-black/10 bg-transparent p-4 dark:border-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{t('identityTools.publication.workbenchTitle')}</h4>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {fallback
              ? t('identityTools.publication.sourceFallback')
              : t('identityTools.publication.sourceRuntime')}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {agent.id} · {agent.workspace}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-8 w-8 rounded-full"
            title={t('identityTools.publication.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ['selected', selectedCount],
          ['published', publishedCount],
          ['add', diff.totalAdds],
          ['remove', diff.totalRemoves],
          ['diagnostics', diagnostics.total],
        ].map(([key, value]) => (
          <div key={key} className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
            <p className="text-[10px] font-medium uppercase text-muted-foreground">{t(`identityTools.publication.metric.${key}`)}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {t('identityTools.publication.loadFailed', { error })}
        </div>
      )}
      {!error && (diagnostics.blocked > 0 || diagnostics.warnings > 0) && (
        <div className="rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {t('identityTools.publication.diagnosticSummary', {
            blocked: diagnostics.blocked,
            warnings: diagnostics.warnings,
          })}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('identityTools.publication.searchPlaceholder')}
            className="h-9 rounded-full bg-black/5 pl-9 text-sm dark:bg-white/5"
          />
        </div>
        <Input
          value={roleName}
          onChange={(event) => setRoleName(event.target.value)}
          placeholder={t('identityTools.publication.rolePreviewPlaceholder')}
          className="h-9 rounded-full bg-black/5 text-sm dark:bg-white/5"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'skill', 'mcp'] as CapabilityKindFilter[]).map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={kindFilter === kind ? 'secondary' : 'outline'}
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => setKindFilter(kind)}
          >
            {kind === 'all' ? t('identityTools.publication.filter.all') : publicationKindLabel(t, kind)}
          </Button>
        ))}
        <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as CapabilityStateFilter)}>
          <SelectTrigger className="h-8 w-[150px] rounded-full bg-transparent text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('identityTools.publication.filter.anyState')}</SelectItem>
            {(['published', 'available', 'disabled', 'blocked', 'missing', 'runtimeUnavailable'] as CapabilityPublicationEntry['state'][]).map((state) => (
              <SelectItem key={state} value={state}>{publicationStateLabel(t, state)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {[
          ['selected', onlySelected, setOnlySelected],
          ['diagnostics', onlyDiagnostics, setOnlyDiagnostics],
          ['changed', onlyChanged, setOnlyChanged],
        ].map(([key, value, setter]) => (
          <Button
            key={key as string}
            type="button"
            size="sm"
            variant={value ? 'secondary' : 'outline'}
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => (setter as (next: boolean) => void)(!(value as boolean))}
          >
            {t(`identityTools.publication.filter.${key}`)}
          </Button>
        ))}
      </div>

      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {visibleRows.length === 0 ? (
          <p className="rounded-xl bg-black/5 px-3 py-6 text-center text-xs text-muted-foreground dark:bg-white/5">
            {t('identityTools.publication.empty')}
          </p>
        ) : visibleRows.map((row) => {
          const entry = row.publication;
          const blockedAdd = row.blocked && !row.selected;
          return (
            <div
              key={rowKey(row)}
              data-testid={`agent-capability-row-${entry.kind}-${row.canonicalId}`}
              className={cn(
                'grid gap-3 rounded-xl bg-black/5 px-3 py-2.5 transition-colors dark:bg-white/5 md:grid-cols-[1fr_auto]',
                row.change !== 'none' && 'ring-1 ring-primary/30',
              )}
            >
              <button
                type="button"
                className="min-w-0 text-left"
                onClick={() => setSelectedRowKey(rowKey(row))}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.kind === 'skill' ? <Wrench className="h-3.5 w-3.5 text-muted-foreground" /> : <Server className="h-3.5 w-3.5 text-muted-foreground" />}
                  <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                  <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                    {publicationKindLabel(t, entry.kind)}
                  </Badge>
                  <Badge variant={row.blocked ? 'destructive' : row.published ? 'secondary' : 'outline'} className="rounded-full px-2 py-0 text-[10px]">
                    {publicationStateLabel(t, entry.state)}
                  </Badge>
                  {row.change !== 'none' && (
                    <Badge variant={row.change === 'add' ? 'success' : 'warning'} className="rounded-full px-2 py-0 text-[10px]">
                      {t(`identityTools.publication.change.${row.change}`)}
                    </Badge>
                  )}
                  {row.diagnosticLevel !== 'none' && (
                    <Badge variant={row.diagnosticLevel === 'blocked' ? 'destructive' : 'warning'} className="rounded-full px-2 py-0 text-[10px]">
                      {t(`identityTools.publication.diagnosticLevel.${row.diagnosticLevel}`)}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {row.canonicalId} · {entry.scope ?? '-'} · {entry.source ?? '-'} · {entry.useModes.join(', ') || '-'}
                </p>
              </button>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setSelectedRowKey(rowKey(row))}
                  aria-label={t('identityTools.publication.detail.open')}
                >
                  <Info className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={row.selected ? 'outline' : 'secondary'}
                  size="sm"
                  disabled={disabled || blockedAdd}
                  onClick={() => updateRowSelection(row)}
                  className="h-8 rounded-full px-3 text-xs"
                >
                  {blockedAdd ? (
                    <>
                      <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                      {t('identityTools.publication.blocked')}
                    </>
                  ) : row.selected ? (
                    <>
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      {t('identityTools.publication.remove')}
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      {t('identityTools.publication.add')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {diff.changed
            ? t('identityTools.publication.pendingSummary', { adds: diff.totalAdds, removes: diff.totalRemoves })
            : t('identityTools.publication.noPendingChanges')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!diff.changed || saving || disabled}
            className="h-8 rounded-full px-3 text-xs"
            onClick={onDiscardChanges}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t('identityTools.publication.discard')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!diff.changed || saving || disabled}
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => void onApplyChanges()}
          >
            {saving ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            {t('identityTools.publication.apply')}
          </Button>
        </div>
      </div>

      <Sheet open={!!selectedRow} onOpenChange={(open) => !open && setSelectedRowKey(null)}>
        <SheetContent
          side="right"
          className="z-[80] flex w-full flex-col bg-surface-modal p-0 sm:max-w-[560px]"
        >
          {selectedRow && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-black/10 px-6 py-5 dark:border-white/10">
                <SheetTitle className="truncate text-xl font-serif font-normal tracking-tight">
                  {selectedRow.publication.name}
                </SheetTitle>
                <SheetDescription className="mt-1 truncate font-mono text-xs">
                  {selectedRow.publication.id}
                </SheetDescription>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="rounded-full">{publicationKindLabel(t, selectedRow.publication.kind)}</Badge>
                  <Badge variant="outline" className="rounded-full">{publicationStateLabel(t, selectedRow.publication.state)}</Badge>
                  <Badge variant="outline" className="rounded-full">{selectedRow.publication.runtime.status}</Badge>
                  {selectedRow.change !== 'none' && <Badge variant="warning" className="rounded-full">{t(`identityTools.publication.change.${selectedRow.change}`)}</Badge>}
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">{t('identityTools.publication.detail.exposure')}</p>
                    <p className="mt-2 font-mono text-xs text-foreground">
                      {[
                        `${t('identityTools.publication.detail.exposureAgents')}=${compactList(selectedRow.publication.exposure.agentIds)}`,
                        `${t('identityTools.publication.detail.exposureWorkspaces')}=${compactList(selectedRow.publication.exposure.workspaceIds)}`,
                        `${t('identityTools.publication.detail.exposureRoles')}=${compactList(selectedRow.publication.exposure.roleNames)}`,
                      ].join(' · ')}
                    </p>
                  </div>
                  <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">{t('identityTools.publication.detail.runtime')}</p>
                    <p className="mt-2 font-mono text-xs text-foreground">
                      {selectedRow.publication.runtime.status} · {selectedRow.publication.runtime.method ?? '-'} · {selectedRow.publication.runtime.source ?? '-'}
                    </p>
                  </div>
                </div>
                {selectedRow.publication.runtime.message && (
                  <div className="rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    {selectedRow.publication.runtime.message}
                  </div>
                )}
                <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">{t('identityTools.publication.detail.useModes')}</p>
                  <p className="mt-2 font-mono text-xs text-foreground">{selectedRow.publication.useModes.join(', ') || '-'}</p>
                </div>
                <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">{t('identityTools.publication.detail.diagnostics')}</p>
                  {selectedRow.publication.diagnostics.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">{t('identityTools.publication.detail.none')}</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {selectedRow.publication.diagnostics.map((diagnostic) => (
                        <div key={`${diagnostic.code}:${diagnostic.message}`} className="rounded-lg bg-background/60 px-3 py-2">
                          <p className="text-xs font-medium text-foreground">{diagnostic.code}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{diagnostic.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">{t('identityTools.publication.detail.reasons')}</p>
                  <p className="mt-2 font-mono text-xs text-foreground">{selectedRow.publication.reasons.join(', ') || '-'}</p>
                </div>
                {selectedRow.publication.kind === 'mcp' && (
                  <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{t('identityTools.publication.detail.mcpRuntime')}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={mcpBusy === 'reload'}
                        onClick={() => void runMcpReload()}
                      >
                        <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', mcpBusy === 'reload' && 'animate-spin')} />
                        {t('identityTools.publication.detail.reload')}
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={mcpBusy === `heartbeat:${selectedRow.publication.serverId ?? selectedRow.publication.sourceId}`}
                        onClick={() => void runMcpHeartbeat(selectedRow)}
                      >
                        <Activity className="mr-1.5 h-3.5 w-3.5" />
                        {t('identityTools.publication.detail.heartbeat')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={mcpBusy === `tools:${selectedRow.publication.serverId ?? selectedRow.publication.sourceId}`}
                        onClick={() => void runMcpListTools(selectedRow)}
                      >
                        <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                        {t('identityTools.publication.detail.listTools')}
                      </Button>
                    </div>
                    {mcpRuntimeMessage[selectedRow.publication.serverId ?? selectedRow.publication.sourceId] && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {mcpRuntimeMessage[selectedRow.publication.serverId ?? selectedRow.publication.sourceId]}
                      </p>
                    )}
                    {(selectedRow.publication.toolNames?.length || mcpToolNames[selectedRow.publication.serverId ?? selectedRow.publication.sourceId]?.length) ? (
                      <div className="mt-3 space-y-1">
                        {(mcpToolNames[selectedRow.publication.serverId ?? selectedRow.publication.sourceId] ?? selectedRow.publication.toolNames ?? []).map((toolName) => (
                          <div key={toolName} className="rounded-lg bg-black/5 px-3 py-1.5 font-mono text-xs dark:bg-white/5">
                            {toolName}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[20px] h-[20px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[20px] h-[20px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[20px] h-[20px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[20px] h-[20px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[20px] h-[20px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[20px] h-[20px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[20px] h-[20px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[20px] h-[20px] dark:invert" />;
    default:
      return <span className="text-xl leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function AddAgentDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, options: { inheritWorkspace: boolean }) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [inheritWorkspace, setInheritWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setName('');
      setInheritWorkspace(false);
      setSaving(false);
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), { inheritWorkspace });
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent asChild className="w-[calc(100%-2rem)] max-w-md rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <Card data-testid="add-agent-dialog">
        <CardHeader className="pb-2">
          <DialogTitle asChild>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('createDialog.title')}
            </CardTitle>
          </DialogTitle>
          <DialogDescription asChild>
            <CardDescription className="text-sm mt-1 text-foreground/70">
              {t('createDialog.description')}
            </CardDescription>
          </DialogDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 p-6">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={inputClasses}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="inherit-workspace" className={labelClasses}>{t('createDialog.inheritWorkspaceLabel')}</Label>
              <p className="text-meta text-foreground/60">{t('createDialog.inheritWorkspaceDescription')}</p>
            </div>
            <Switch
              id="inherit-workspace"
              checked={inheritWorkspace}
              onCheckedChange={setInheritWorkspace}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim()}
              className="h-9 text-meta font-medium rounded-full px-4 shadow-none"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      </DialogContent>
    </Dialog>
  );
}

function AgentSettingsModal({
  open,
  agent,
  channelGroups,
  onClose,
}: {
  open: boolean;
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const { updateAgent, updateAgentAvatar, resetAgentAvatar, defaultModelRef } = useAgentsStore();
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [soulMd, setSoulMd] = useState('');
  const [baselineSkillIds, setBaselineSkillIds] = useState<string[]>([]);
  const [baselineMcpServerIds, setBaselineMcpServerIds] = useState<string[]>([]);
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [draftMcpServerIds, setDraftMcpServerIds] = useState<string[]>([]);
  const [bootstrapPath, setBootstrapPath] = useState('');
  const [loadingSoul, setLoadingSoul] = useState(false);
  const [savingSoul, setSavingSoul] = useState(false);
  const [savingCapabilities, setSavingCapabilities] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // Phase 1: Structured role editor state
  const [roleProfile, setRoleProfile] = useState<AgentRoleProfile>({ ...DEFAULT_ROLE_PROFILE });
  const [soulEditorTab, setSoulEditorTab] = useState<'structured' | 'advanced'>('structured');

  // Phase 2: Bootstrap file editors
  const [agentsMd, setAgentsMd] = useState('');
  const [toolsMd, setToolsMd] = useState('');
  const [userMd, setUserMd] = useState('');
  const [identityMd, setIdentityMd] = useState('');
  const [heartbeatMd, setHeartbeatMd] = useState('');
  const [showBootstrapFiles, setShowBootstrapFiles] = useState(false);
  const [showAdvancedCapabilityIds, setShowAdvancedCapabilityIds] = useState(false);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSoul(true);
    void hostApi.agents.getBootstrap(agent.id)
      .then((result) => {
        if (cancelled) return;
        const nextSkillIds = result.defaultSkillIds ?? [];
        const nextMcpServerIds = result.defaultMcpServerIds ?? [];
        setSoulMd(result.soulMd ?? '');
        setBootstrapPath(result.bootstrapPath ?? '');
        setBaselineSkillIds(nextSkillIds);
        setBaselineMcpServerIds(nextMcpServerIds);
        setDraftSkillIds(nextSkillIds);
        setDraftMcpServerIds(nextMcpServerIds);
        // Phase 1: role profile
        if (result.roleProfile) {
          setRoleProfile({ ...DEFAULT_ROLE_PROFILE, ...(result.roleProfile as AgentRoleProfile) });
        } else {
          setRoleProfile({ ...DEFAULT_ROLE_PROFILE, displayName: agent.name });
        }
        // Phase 2: bootstrap files
        setAgentsMd(result.agentsMd ?? '');
        setToolsMd(result.toolsMd ?? '');
        setUserMd(result.userMd ?? '');
        setIdentityMd(result.identityMd ?? '');
        setHeartbeatMd(result.heartbeatMd ?? '');
      })
      .catch((error) => {
        if (!cancelled) toast.error(t('identityTools.toast.loadFailed', { error: String(error) }));
      })
      .finally(() => {
        if (!cancelled) setLoadingSoul(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.name, t]);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setShowModelModal(false);
      setShowCloseConfirm(false);
      setName(agent.name);
    }
  }

  const hasNameChanges = name.trim() !== agent.name;
  const capabilityDiff = calculateCapabilityDraftDiff({
    baselineSkillIds,
    draftSkillIds,
    baselineMcpServerIds,
    draftMcpServerIds,
  });
  const configuredSkillIds = draftSkillIds;
  const configuredMcpServerIds = draftMcpServerIds;

  const handleRequestClose = () => {
    if (savingName || savingCapabilities || hasNameChanges || capabilityDiff.changed) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveSoul = async () => {
    setSavingSoul(true);
    try {
      const updatePayload: Record<string, unknown> = {
        id: agent.id,
        defaultSkillIds: configuredSkillIds,
        defaultMcpServerIds: configuredMcpServerIds,
      };

      if (soulEditorTab === 'structured') {
        updatePayload.roleProfile = roleProfile;
      } else {
        updatePayload.soulMd = soulMd;
      }

      // Include bootstrap files if they were loaded
      if (showBootstrapFiles) {
        updatePayload.agentsMd = agentsMd;
        updatePayload.toolsMd = toolsMd;
        updatePayload.userMd = userMd;
        updatePayload.identityMd = identityMd;
        updatePayload.heartbeatMd = heartbeatMd;
      }

      const result = await hostApi.agents.updateBootstrap(updatePayload as Parameters<typeof hostApi.agents.updateBootstrap>[0]);
      const nextSkillIds = result.defaultSkillIds ?? configuredSkillIds;
      const nextMcpServerIds = result.defaultMcpServerIds ?? configuredMcpServerIds;
      setSoulMd(result.soulMd ?? soulMd);
      setBootstrapPath(result.bootstrapPath ?? bootstrapPath);
      setBaselineSkillIds(nextSkillIds);
      setBaselineMcpServerIds(nextMcpServerIds);
      setDraftSkillIds(nextSkillIds);
      setDraftMcpServerIds(nextMcpServerIds);
      toast.success(t('identityTools.toast.saved'));
    } catch (error) {
      toast.error(t('identityTools.toast.saveFailed', { error: String(error) }));
    } finally {
      setSavingSoul(false);
    }
  };

  const handleApplyCapabilityChanges = async () => {
    if (!capabilityDiff.changed) return;
    setSavingCapabilities(true);
    try {
      const result = await hostApi.agents.updateBootstrap({
        id: agent.id,
        defaultSkillIds: draftSkillIds,
        defaultMcpServerIds: draftMcpServerIds,
      });
      const nextSkillIds = result.defaultSkillIds ?? draftSkillIds;
      const nextMcpServerIds = result.defaultMcpServerIds ?? draftMcpServerIds;
      setBaselineSkillIds(nextSkillIds);
      setBaselineMcpServerIds(nextMcpServerIds);
      setDraftSkillIds(nextSkillIds);
      setDraftMcpServerIds(nextMcpServerIds);
      toast.success(t('identityTools.publication.toast.saved'));
    } catch (error) {
      toast.error(t('identityTools.publication.toast.saveFailed', { error: String(error) }));
    } finally {
      setSavingCapabilities(false);
    }
  };

  const handleDiscardCapabilityChanges = () => {
    setDraftSkillIds(baselineSkillIds);
    setDraftMcpServerIds(baselineMcpServerIds);
  };

  const assignedChannels = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => ({
        channelType: group.channelType as ChannelType,
        accountId: account.accountId,
        name:
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId,
        error: account.lastError,
      })),
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleRequestClose()}>
      <DialogContent asChild className="w-[calc(100%-2rem)] max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <DialogTitle asChild>
              <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                {t('settingsDialog.title', { name: agent.name })}
              </CardTitle>
            </DialogTitle>
            <DialogDescription asChild>
              <CardDescription className="text-sm mt-1 text-foreground/70">
                {t('settingsDialog.description')}
              </CardDescription>
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          <div className="space-y-4">
            <div className="space-y-2.5">
              <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={agent.isDefault}
                  className={inputClasses}
                />
                {!agent.isDefault && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !name.trim() || name.trim() === agent.name}
                    className="h-[44px] text-meta font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                  >
                    {savingName ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      t('common:actions.save')
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4">
                <p className="text-tiny uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('settingsDialog.agentIdLabel')}
                </p>
                <p className="font-mono text-meta text-foreground">{agent.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModelModal(true)}
                className="space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4 text-left hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              >
                <p className="text-tiny uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                  {t('settingsDialog.modelLabel')}
                </p>
                <p className="text-sm text-foreground">
                  {agent.modelDisplay}
                  {agent.inheritedModel ? ` (${t('inherited')})` : ''}
                </p>
                <p className="font-mono text-xs text-foreground/70 break-all">
                  {agent.modelRef || defaultModelRef || '-'}
                </p>
              </button>
            </div>
          </div>

          <AgentAvatarEditor
            agent={agent}
            saving={savingAvatar}
            onSave={async (preset) => {
              setSavingAvatar(true);
              try {
                await updateAgentAvatar(agent.id, preset);
                toast.success(t('avatar.saved'));
              } catch (error) {
                toast.error(t('avatar.saveFailed', { error: String(error) }));
              } finally {
                setSavingAvatar(false);
              }
            }}
            onReset={async () => {
              setSavingAvatar(true);
              try {
                await resetAgentAvatar(agent.id);
                toast.success(t('avatar.resetDone'));
              } catch (error) {
                toast.error(t('avatar.resetFailed', { error: String(error) }));
              } finally {
                setSavingAvatar(false);
              }
            }}
          />

          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                {t('identityTools.title')}
              </h3>
              <p className="text-sm text-foreground/70 mt-1">
                {t('identityTools.description')}
              </p>
            </div>
            <CapabilityPublicationWorkbench
              agent={agent}
              baselineSkillIds={baselineSkillIds}
              baselineMcpServerIds={baselineMcpServerIds}
              draftSkillIds={draftSkillIds}
              draftMcpServerIds={draftMcpServerIds}
              onDraftSkillIdsChange={setDraftSkillIds}
              onDraftMcpServerIdsChange={setDraftMcpServerIds}
              onApplyChanges={handleApplyCapabilityChanges}
              onDiscardChanges={handleDiscardCapabilityChanges}
              saving={savingCapabilities}
              disabled={loadingSoul}
            />
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowAdvancedCapabilityIds(!showAdvancedCapabilityIds)}
                className="flex items-center gap-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showAdvancedCapabilityIds ? 'rotate-0' : '-rotate-90'}`} />
                {t('identityTools.publication.advancedIds')}
              </button>
              {showAdvancedCapabilityIds && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="agent-default-skills" className={labelClasses}>{t('identityTools.defaultSkillIds')}</Label>
                    <Textarea
                      id="agent-default-skills"
                      value={idsToText(draftSkillIds)}
                      onChange={(event) => setDraftSkillIds(splitCapabilityIdList(event.target.value))}
                      placeholder={t('identityTools.defaultSkillIdsPlaceholder')}
                      className="min-h-[88px] resize-y rounded-2xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-xs leading-relaxed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-default-mcp" className={labelClasses}>{t('identityTools.defaultMcpIds')}</Label>
                    <Textarea
                      id="agent-default-mcp"
                      value={idsToText(draftMcpServerIds)}
                      onChange={(event) => setDraftMcpServerIds(splitCapabilityIdList(event.target.value))}
                      placeholder={t('identityTools.defaultMcpIdsPlaceholder')}
                      className="min-h-[88px] resize-y rounded-2xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-xs leading-relaxed"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className={labelClasses}>{t('identityTools.agentRole')}</Label>
                  <p className="mt-1 text-xs text-muted-foreground font-mono break-all">
                    {bootstrapPath || t('identityTools.bootstrapPathPending')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void handleSaveSoul()}
                  disabled={savingSoul || savingCapabilities || loadingSoul}
                  className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                >
                  {savingSoul ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('identityTools.saveRole')}
                </Button>
              </div>

              <Tabs value={soulEditorTab} onValueChange={(v) => setSoulEditorTab(v as 'structured' | 'advanced')}>
                <TabsList className="w-full rounded-xl bg-black/5 dark:bg-white/5 p-1">
                  <TabsTrigger value="structured" className="rounded-lg flex-1 data-[state=active]:bg-white dark:data-[state=active]:bg-black/30">{t('identityTools.structuredTab')}</TabsTrigger>
                  <TabsTrigger value="advanced" className="rounded-lg flex-1 data-[state=active]:bg-white dark:data-[state=active]:bg-black/30">{t('identityTools.advancedTab')}</TabsTrigger>
                </TabsList>
                <TabsContent value="structured" className="mt-4">
                  <RoleProfileEditor
                    profile={roleProfile}
                    onChange={setRoleProfile}
                    disabled={loadingSoul}
                  />
                </TabsContent>
                <TabsContent value="advanced" className="mt-4">
                  <Textarea
                    id="agent-soul-md"
                    value={soulMd}
                    onChange={(event) => setSoulMd(event.target.value)}
                    placeholder={loadingSoul ? t('common:status.loading') : t('identityTools.soulPlaceholder')}
                    className="min-h-[180px] resize-y rounded-2xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-xs leading-relaxed"
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Phase 2: Bootstrap files accordion */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowBootstrapFiles(!showBootstrapFiles)}
                className="flex items-center gap-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showBootstrapFiles ? 'rotate-0' : '-rotate-90'}`} />
                {t('identityTools.bootstrapFiles', { files: ['AGENTS', 'TOOLS', 'USER', 'IDENTITY', 'HEARTBEAT'].join(', ') })}
              </button>
              {showBootstrapFiles && (
                <div className="space-y-3 pl-1">
                  {([
                    { label: 'AGENTS.md', desc: t('identityTools.bootstrapDescriptions.agents'), value: agentsMd, setter: setAgentsMd },
                    { label: 'TOOLS.md', desc: t('identityTools.bootstrapDescriptions.tools'), value: toolsMd, setter: setToolsMd },
                    { label: 'USER.md', desc: t('identityTools.bootstrapDescriptions.user'), value: userMd, setter: setUserMd },
                    { label: 'IDENTITY.md', desc: t('identityTools.bootstrapDescriptions.identity'), value: identityMd, setter: setIdentityMd },
                    { label: 'HEARTBEAT.md', desc: t('identityTools.bootstrapDescriptions.heartbeat'), value: heartbeatMd, setter: setHeartbeatMd },
                  ] as const).map(({ label, desc, value, setter }) => (
                    <div key={label} className="space-y-1.5">
                      <p className="text-xs font-medium text-foreground/60">{label} — {desc}</p>
                      <Textarea
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        className="min-h-[60px] rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-xs leading-relaxed resize-y"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                  {t('settingsDialog.channelsTitle')}
                </h3>
                <p className="text-sm text-foreground/70 mt-1">{t('settingsDialog.channelsDescription')}</p>
              </div>
            </div>

            {assignedChannels.length === 0 && agent.channelTypes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-sm text-muted-foreground">
                {t('settingsDialog.noChannels')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div key={`${channel.channelType}-${channel.accountId}`} className="flex items-center justify-between rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                        <ChannelLogo type={channel.channelType} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{channel.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {CHANNEL_NAMES[channel.channelType]} · {channel.accountId === 'default' ? t('settingsDialog.mainAccount') : channel.accountId}
                        </p>
                        {channel.error && (
                          <p className="text-xs text-destructive mt-1">{channel.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0" />
                  </div>
                ))}
                {assignedChannels.length === 0 && agent.channelTypes.length > 0 && (
                  <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-sm text-muted-foreground">
                    {t('settingsDialog.channelsManagedInChannels')}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </DialogContent>
      <AgentModelModal
        open={showModelModal}
        agent={agent}
        onClose={() => setShowModelModal(false)}
      />
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          setName(agent.name);
          handleDiscardCapabilityChanges();
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </Dialog>
  );
}

function AgentModelModal({
  open,
  agent,
  onClose,
}: {
  open: boolean;
  agent: AgentSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const { updateAgentModel, defaultModelRef } = useAgentsStore();
  const [selectedRuntimeProviderKey, setSelectedRuntimeProviderKey] = useState('');
  const [modelIdInput, setModelIdInput] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  const runtimeProviderOptions = useMemo<RuntimeProviderOption[]>(
    () => buildRuntimeProviderOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
    ),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );

  useEffect(() => {
    const override = splitModelRef(agent.overrideModelRef);
    if (override) {
      setSelectedRuntimeProviderKey(override.providerKey);
      setModelIdInput(override.modelId);
      return;
    }

    const effective = splitModelRef(agent.modelRef || defaultModelRef);
    if (effective) {
      setSelectedRuntimeProviderKey(effective.providerKey);
      setModelIdInput(effective.modelId);
      return;
    }

    setSelectedRuntimeProviderKey(runtimeProviderOptions[0]?.runtimeProviderKey || '');
    setModelIdInput('');
  }, [agent.modelRef, agent.overrideModelRef, defaultModelRef, runtimeProviderOptions]);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setSavingModel(false);
      setShowCloseConfirm(false);
    }
  }

  const selectedProvider = runtimeProviderOptions.find((option) => option.runtimeProviderKey === selectedRuntimeProviderKey) || null;
  const trimmedModelId = modelIdInput.trim();
  const nextModelRef = selectedRuntimeProviderKey && trimmedModelId
    ? `${selectedRuntimeProviderKey}/${trimmedModelId}`
    : '';
  const normalizedDefaultModelRef = (defaultModelRef || '').trim();
  const isUsingDefaultModelInForm = Boolean(normalizedDefaultModelRef) && nextModelRef === normalizedDefaultModelRef;
  const currentOverrideModelRef = (agent.overrideModelRef || '').trim();
  const desiredOverrideModelRef = nextModelRef && nextModelRef !== normalizedDefaultModelRef
    ? nextModelRef
    : null;
  const modelChanged = (desiredOverrideModelRef || '') !== currentOverrideModelRef;

  const handleRequestClose = () => {
    if (savingModel || modelChanged) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveModel = async () => {
    if (!selectedRuntimeProviderKey) {
      toast.error(t('toast.agentModelProviderRequired'));
      return;
    }
    if (!trimmedModelId) {
      toast.error(t('toast.agentModelIdRequired'));
      return;
    }
    if (!modelChanged) return;
    if (!nextModelRef.includes('/')) {
      toast.error(t('toast.agentModelInvalid'));
      return;
    }

    setSavingModel(true);
    try {
      await updateAgentModel(agent.id, desiredOverrideModelRef);
      toast.success(desiredOverrideModelRef ? t('toast.agentModelUpdated') : t('toast.agentModelReset'));
      onClose();
    } catch (error) {
      toast.error(t('toast.agentModelUpdateFailed', { error: String(error) }));
    } finally {
      setSavingModel(false);
    }
  };

  const handleUseDefaultModel = () => {
    const parsedDefault = splitModelRef(normalizedDefaultModelRef);
    if (!parsedDefault) {
      setSelectedRuntimeProviderKey('');
      setModelIdInput('');
      return;
    }
    setSelectedRuntimeProviderKey(parsedDefault.providerKey);
    setModelIdInput(parsedDefault.modelId);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleRequestClose()}>
      <DialogContent asChild className="z-[60] w-[calc(100%-2rem)] max-w-xl rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <DialogTitle asChild>
              <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                {t('settingsDialog.modelLabel')}
              </CardTitle>
            </DialogTitle>
            <DialogDescription asChild>
              <CardDescription className="text-sm mt-1 text-foreground/70">
                {t('settingsDialog.modelOverrideDescription', { defaultModel: defaultModelRef || '-' })}
              </CardDescription>
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="agent-model-provider" className="text-xs text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
            <Select
              value={selectedRuntimeProviderKey || '__placeholder__'}
              onValueChange={(value) => {
                if (value === '__placeholder__') return;
                const nextProvider = value;
                setSelectedRuntimeProviderKey(nextProvider);
                if (!modelIdInput.trim()) {
                  const option = runtimeProviderOptions.find((candidate) => candidate.runtimeProviderKey === nextProvider);
                  setModelIdInput(option?.configuredModelId || '');
                }
              }}
            >
              <SelectTrigger id="agent-model-provider" className={selectTriggerClasses}>
                <SelectValue placeholder={t('settingsDialog.modelProviderPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__placeholder__" disabled>
                  {t('settingsDialog.modelProviderPlaceholder')}
                </SelectItem>
                {runtimeProviderOptions.map((option) => (
                  <SelectItem key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-model-id" className="text-xs text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
            <Input
              id="agent-model-id"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              placeholder={selectedProvider?.modelIdPlaceholder || selectedProvider?.configuredModelId || t('settingsDialog.modelIdPlaceholder')}
              className={inputClasses}
            />
          </div>
          {!!nextModelRef && (
            <p className="text-xs font-mono text-foreground/70 break-all">
              {t('settingsDialog.modelPreview')}: {nextModelRef}
            </p>
          )}
          {runtimeProviderOptions.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('settingsDialog.modelProviderEmpty')}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleUseDefaultModel}
              disabled={savingModel || !normalizedDefaultModelRef || isUsingDefaultModelInForm}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('settingsDialog.useDefaultModel')}
            </Button>
            <Button
              variant="outline"
              onClick={handleRequestClose}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSaveModel()}
              disabled={savingModel || !selectedRuntimeProviderKey || !trimmedModelId || !modelChanged}
              className="h-9 text-meta font-medium rounded-full px-4 shadow-none"
            >
              {savingModel ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      </DialogContent>
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </Dialog>
  );
}

export default Agents;
