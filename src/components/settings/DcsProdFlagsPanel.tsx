import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, EyeOff, RefreshCw, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';
import {
  DCS_PROD_FLAGS,
  type DcsProdFlagEntry,
  type DcsProdFlagRisk,
} from '@shared/dcs/prod-flags-catalog';
import {
  getWritableFlagSpec,
  type DcsPreviewSetResult,
  type DcsPreviewState,
  type DcsProdFlagApplyStatus,
  type DcsProdFlagSetResult,
  type DcsProdFlagStateRow,
  type DcsProdFlagsSnapshot,
  type DcsProdObservabilitySnapshot,
} from '@shared/dcs/prod-flags-control';

/**
 * FP-P1-03: effectiveFlags keys (child ack, snake/env-normalized spelling) for
 * the preview combo, in display order.
 */
const PREVIEW_EFFECTIVE_KEYS = [
  'dcs.contextViewTools.enabled',
  'runtime.contextBlock.working_memory.enabled',
  'runtime.contextBlock.tool_registry.enabled',
  'runtime.coding.staleWriteGuard.enabled',
] as const;

const VIEW_TOOLS_FLAG_ID = 'context-view-tools';
const VIEW_TOOL_NAMES = [
  'context_understand',
  'context_impact',
  'context_reuse',
  'context_verify',
] as const;

/**
 * R7-1 T4: the three memory switches R3-2 catalogued as unavailable
 * (R3-1 audit: persist rejected by E-1, injectPilot unwired, role-memory
 * fake-surface). Only these get the memory-channel boundary note.
 */
const MEMORY_FLAG_IDS = [
  'runtime-memory-persist',
  'runtime-memory-inject-pilot',
  'role-memory',
] as const;

function riskTone(risk: DcsProdFlagRisk): string {
  switch (risk) {
    case 'baseline-on':
      return 'border-emerald-500/20 text-emerald-700 dark:text-emerald-400';
    case 'shadow-only':
      return 'border-sky-500/20 text-sky-700 dark:text-sky-400';
    case 'api-only':
    case 'request-only':
      return 'border-violet-500/20 text-violet-700 dark:text-violet-400';
    case 'opt-in':
    default:
      return 'border-amber-500/30 text-amber-700 dark:text-amber-400';
  }
}

function statusTone(status: DcsProdFlagApplyStatus | undefined): string {
  switch (status) {
    // FP-P0-04: only a child-acknowledged flag earns the "confirmed" tone.
    case 'applied':
      return 'border-emerald-500/20 text-emerald-700 dark:text-emerald-400';
    case 'runtime-acknowledged':
      return 'border-sky-500/25 text-sky-700 dark:text-sky-400';
    case 'saved':
    case 'restarting':
    case 'pending-restart':
      return 'border-amber-500/30 text-amber-700 dark:text-amber-400';
    case 'failed':
    case 'error':
      return 'border-red-500/30 text-red-700 dark:text-red-400';
    case 'unsupported':
    case 'read-only':
    default:
      return 'border-black/10 text-muted-foreground dark:border-white/15';
  }
}

/**
 * FP-P0-04: render the acknowledgement outcome of the last toggle.
 *
 * Shows the state trail, the child's identity (pid + generation), whether the
 * flags would actually change a turn, and an actionable hint when the set did not
 * reach `applied`. Deliberately verbose: "applied" without this evidence is the
 * failure mode this task exists to remove.
 */
function AckDetail({
  result,
  onRequery,
  requerying,
}: {
  result: DcsProdFlagSetResult;
  onRequery?: () => void;
  requerying?: boolean;
}) {
  const { t } = useTranslation('settings');
  const ack = result.runtimeAck;
  // FP-P1-09: ack-timeout is a retryable state — offer a re-check that does not
  // rewrite the flag or restart the gateway.
  const canRequery = Boolean(onRequery) && result.failureReason === 'ack-timeout';
  return (
    <div
      className="space-y-1.5 rounded-lg border border-black/10 bg-surface-modal px-3 py-2.5 dark:border-white/10"
      data-testid="settings-dcs-flag-ack-detail"
      data-ack-state={result.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn('text-tiny font-normal', statusTone(result.status))}
          data-testid="settings-dcs-flag-ack-state"
        >
          {t(`developer.dcsProdFlags.status.${result.status}`)}
        </Badge>
        {result.ackTrail?.length ? (
          <span className="text-tiny text-muted-foreground" data-testid="settings-dcs-flag-ack-trail">
            {result.ackTrail.join(' → ')}
          </span>
        ) : null}
      </div>
      {result.operatorHintKey ? (
        <p className="text-meta text-muted-foreground" data-testid="settings-dcs-flag-ack-hint">
          {t(result.operatorHintKey)}
        </p>
      ) : null}
      {canRequery ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-tiny"
          data-testid="settings-dcs-flag-ack-requery"
          disabled={requerying}
          onClick={onRequery}
        >
          {requerying
            ? t('developer.dcsProdFlags.requerying')
            : t('developer.dcsProdFlags.requeryAck')}
        </Button>
      ) : null}
      {ack ? (
        <p className="text-tiny text-muted-foreground" data-testid="settings-dcs-flag-ack-child">
          pid {ack.childPid} · generation {ack.gatewayGeneration} · hash{' '}
          {ack.runtimeBuildOrConfigHash} · turnEffect{' '}
          {String(ack.turnEffectProbe.wouldChangeTurn)}
          {ack.degradedReason ? ` · degraded ${ack.degradedReason}` : ''}
        </p>
      ) : null}
      {result.ackMissingFields?.length ? (
        <p className="text-tiny text-muted-foreground" data-testid="settings-dcs-flag-ack-missing">
          missing: {result.ackMissingFields.join(', ')}
        </p>
      ) : null}
      {ack?.rejectedFlags?.length ? (
        <ul className="text-tiny text-muted-foreground" data-testid="settings-dcs-flag-ack-rejected">
          {ack.rejectedFlags.map((rejected) => (
            <li key={rejected.id}>
              {rejected.id}: requested {String(rejected.requested)} → effective{' '}
              {String(rejected.effective)} ({rejected.reason})
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FlagRow({
  entry,
  state,
  selected,
  onSelect,
}: {
  entry: DcsProdFlagEntry;
  state?: DcsProdFlagStateRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`settings-dcs-prod-flag-${entry.id}`}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-black/15 bg-black/5 dark:border-white/20 dark:bg-white/10'
          : 'border-black/10 bg-surface-modal hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{entry.key}</span>
        <Badge variant="outline" className={cn('text-tiny font-normal', riskTone(entry.risk))}>
          {t(`developer.dcsProdFlags.risk.${entry.risk}`)}
        </Badge>
        <Badge variant="outline" className="text-tiny font-normal text-muted-foreground">
          {entry.wave}
        </Badge>
        {state?.writable ? (
          <Badge
            variant="outline"
            className={cn('text-tiny font-normal', statusTone(state.status))}
            data-testid={`settings-dcs-prod-flag-status-${entry.id}`}
          >
            {t(`developer.dcsProdFlags.status.${state.status}`)}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-meta text-muted-foreground">
        {t('developer.dcsProdFlags.defaultLabel')}: {entry.defaultDisplay}
        {state?.writable
          ? ` · ${state.enabled ? t('developer.dcsProdFlags.on') : t('developer.dcsProdFlags.off')}`
          : ''}
      </p>
    </button>
  );
}

function ViewToolsDiscoverBanner({
  enabled,
  busy,
  onEnable,
  onFocusFlag,
}: {
  enabled: boolean | null;
  busy: boolean;
  onEnable: () => void;
  onFocusFlag: () => void;
}) {
  const { t } = useTranslation('settings');
  if (enabled === null) return null;

  if (enabled) {
    return (
      <div
        className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 dark:border-emerald-500/30"
        data-testid="settings-dcs-view-tools-discover-banner"
        data-state="enabled"
      >
        <p className="text-sm font-medium text-foreground">
          {t('developer.dcsProdFlags.viewToolsDiscover.enabledTitle')}
        </p>
        <p className="mt-1 text-meta text-muted-foreground">
          {t('developer.dcsProdFlags.viewToolsDiscover.enabledBody', {
            tools: VIEW_TOOL_NAMES.join(', '),
          })}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30"
      data-testid="settings-dcs-view-tools-discover-banner"
      data-state="disabled"
    >
      <div className="flex min-w-0 items-start gap-2">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t('developer.dcsProdFlags.viewToolsDiscover.disabledTitle')}
          </p>
          <p className="text-meta text-muted-foreground">
            {t('developer.dcsProdFlags.viewToolsDiscover.disabledBody', {
              tools: VIEW_TOOL_NAMES.join(', '),
            })}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onFocusFlag}
          data-testid="settings-dcs-view-tools-discover-focus"
        >
          {t('developer.dcsProdFlags.viewToolsDiscover.focusSwitch')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={onEnable}
          data-testid="settings-dcs-view-tools-discover-enable"
        >
          {t('developer.dcsProdFlags.viewToolsDiscover.enableCta')}
        </Button>
      </div>
    </div>
  );
}

/**
 * FP-P1-03: the single "DCS Coding Preview" product entry.
 *
 * One switch composing the first-product capability combo. Enabling is refused
 * while prerequisites (verified provider / selected workspace+permission) are
 * missing; after a flip the child acknowledgement and the per-flag effective
 * values are displayed — `applied` never comes from the write alone, and a kill
 * switch shows as killed, not applied.
 */
function DcsPreviewCard() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<DcsPreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<DcsPreviewSetResult | null>(null);

  const loadState = useCallback(async () => {
    try {
      setState(await hostApi.dcsProdFlags.getPreview());
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const missing = state?.missingPrereqs ?? [];
  const blocked = missing.length > 0 && !state?.enabled;
  const killSwitchEngaged =
    lastResult?.runtimeAck?.turnEffectProbe?.killSwitchEngaged === true;

  const onToggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      // The preview switch's contract is "runtime confirmed", so it always
      // restarts the gateway and waits for the child ack (also under E2E).
      const result = await hostApi.dcsProdFlags.setPreview({ enabled, restartGateway: true });
      setLastResult(result);
      if (!result.success) {
        toast.error(result.error || t('developer.dcsPreview.setFailed'));
      } else if (result.status === 'applied') {
        toast.success(t(enabled ? 'developer.dcsPreview.appliedOn' : 'developer.dcsPreview.appliedOff'));
      } else if (result.operatorHintKey) {
        toast.message(t(result.operatorHintKey));
      }
      await loadState();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-3 rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10"
      data-testid="settings-dcs-preview-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-sm font-medium text-foreground">
            {t('developer.dcsPreview.title')}
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">
            {t('developer.dcsPreview.description')}
          </p>
        </div>
        <Switch
          data-testid="settings-dcs-preview-switch"
          checked={state?.enabled === true}
          disabled={busy || blocked || !state}
          onCheckedChange={(checked) => void onToggle(checked)}
        />
      </div>

      {state?.partial && (
        <p className="text-tiny text-yellow-700 dark:text-yellow-400" data-testid="settings-dcs-preview-partial">
          {t('developer.dcsPreview.partial')}
        </p>
      )}

      {blocked && (
        <div
          className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-tiny"
          data-testid="settings-dcs-preview-prereqs"
        >
          <p className="font-medium text-yellow-800 dark:text-yellow-300">
            {t('developer.dcsPreview.prereqTitle')}
          </p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {missing.map((prereq) => (
              <li key={prereq} data-testid={`settings-dcs-preview-missing-${prereq}`}>
                {t(`developer.dcsPreview.prereqs.${prereq}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastResult && (
        <div className="space-y-1.5" data-testid="settings-dcs-preview-ack" data-ack-state={lastResult.status}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn('text-tiny font-normal', statusTone(lastResult.status))}
              data-testid="settings-dcs-preview-ack-state"
            >
              {killSwitchEngaged && lastResult.status !== 'applied'
                ? t('developer.dcsPreview.killed')
                : t(`developer.dcsProdFlags.status.${lastResult.status}`)}
            </Badge>
            {lastResult.ackTrail?.length ? (
              <span className="text-tiny text-muted-foreground" data-testid="settings-dcs-preview-ack-trail">
                {lastResult.ackTrail.join(' → ')}
              </span>
            ) : null}
          </div>
          {killSwitchEngaged && (
            <p className="text-tiny text-red-700 dark:text-red-400" data-testid="settings-dcs-preview-killswitch">
              {t('developer.dcsPreview.killSwitchNote')}
            </p>
          )}
          {lastResult.runtimeAck ? (
            <ul className="text-tiny text-muted-foreground" data-testid="settings-dcs-preview-effective">
              {PREVIEW_EFFECTIVE_KEYS.map((key) => (
                <li key={key} data-testid={`settings-dcs-preview-effective-${key}`}>
                  {key}: {String(lastResult.runtimeAck?.effectiveFlags?.[key])}
                  {/* FP-P1-10: say WHY. A bare `false` cannot distinguish
                      "nobody set it" from "kill forced it off". */}
                  {lastResult.runtimeAck?.flagAttribution?.[key] ? (
                    <span
                      className="ml-1 opacity-70"
                      data-testid={`settings-dcs-preview-origin-${key}`}
                      title={lastResult.runtimeAck.flagAttribution[key]?.key ?? undefined}
                    >
                      ({t(`developer.dcsPreview.origin.${lastResult.runtimeAck.flagAttribution[key]!.origin}`)})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {lastResult.operatorHintKey ? (
            <p className="text-meta text-muted-foreground">{t(lastResult.operatorHintKey)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function DcsProdFlagsPanel() {
  const { t } = useTranslation('settings');
  const [selectedId, setSelectedId] = useState(DCS_PROD_FLAGS[0]?.id ?? '');
  const [snapshot, setSnapshot] = useState<DcsProdFlagsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // FP-P0-04: last toggle's acknowledgement outcome, keyed by flag id.
  const [lastAck, setLastAck] = useState<Record<string, DcsProdFlagSetResult>>({});
  // FP-P1-09: ack re-query (no rewrite, no restart) in flight for this flag.
  const [requeryingId, setRequeryingId] = useState<string | null>(null);

  // FP-P1-09: re-check the child ack after an ack-timeout without flipping the
  // flag again. Merges the fresh outcome into the displayed AckDetail.
  const onRequeryAck = useCallback(async (id: string) => {
    setRequeryingId(id);
    try {
      const result = await hostApi.dcsProdFlags.requeryAck();
      setLastAck((prev) => {
        const previous = prev[id];
        if (!previous) return prev;
        return {
          ...prev,
          [id]: {
            ...previous,
            status: result.status,
            ackTrail: result.ackTrail ?? previous.ackTrail,
            runtimeAck: result.runtimeAck ?? previous.runtimeAck,
            ackMissingFields: result.ackMissingFields,
            failureReason: result.failureReason,
            operatorHintKey: result.operatorHintKey,
            gatewayGeneration: result.gatewayGeneration ?? previous.gatewayGeneration,
            ackWaitMs: result.ackWaitMs,
          },
        };
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setRequeryingId(null);
    }
  }, []);

  const selected = useMemo(
    () => DCS_PROD_FLAGS.find((f) => f.id === selectedId) ?? DCS_PROD_FLAGS[0],
    [selectedId],
  );

  const stateById = useMemo(() => {
    const map = new Map<string, DcsProdFlagStateRow>();
    for (const row of snapshot?.flags ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [snapshot]);

  const selectedState = selected ? stateById.get(selected.id) : undefined;
  // R7-1 T4: reuse the R3-2 unavailableReason field (no new state shape) and
  // scope the memory-channel boundary note to the three memory switches.
  const selectedUnavailableReason = selected
    ? getWritableFlagSpec(selected.id)?.unavailableReason
    : undefined;
  const showMemoryBoundary = MEMORY_FLAG_IDS.some((id) => id === selected?.id);
  const viewToolsState = stateById.get(VIEW_TOOLS_FLAG_ID);
  const viewToolsEnabled = viewToolsState ? viewToolsState.enabled : null;
  const observability: DcsProdObservabilitySnapshot | undefined = snapshot?.observability;

  const loadFlags = useCallback(async () => {
    setLoading(true);
    try {
      const next = await hostApi.dcsProdFlags.getFlags();
      setSnapshot(next);
    } catch (error) {
      toast.error(
        t('developer.dcsProdFlags.loadFailed', {
          error: toUserMessage(error) || String(error),
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  const onToggle = useCallback(
    async (id: string, enabled: boolean) => {
      setBusyId(id);
      try {
        const result = await hostApi.dcsProdFlags.setFlag({
          id,
          enabled,
        });
        setLastAck((prev) => ({ ...prev, [id]: result }));
        if (!result.success) {
          toast.error(
            result.error ||
              t('developer.dcsProdFlags.toggleFailed', { id }),
          );
          await loadFlags();
          return;
        }
        // FP-P0-04: never claim success from the write alone. Only a child ack
        // (status 'applied') earns the success toast; every other state gets the
        // actionable hint the control plane returned.
        if (result.status !== 'applied') {
          toast.message(
            result.operatorHintKey
              ? t(result.operatorHintKey)
              : t('developer.dcsProdFlags.pendingRestartToast'),
          );
        } else {
          toast.success(
            enabled
              ? t('developer.dcsProdFlags.enabledToast', { id })
              : t('developer.dcsProdFlags.disabledToast', { id }),
          );
        }
        if (id === VIEW_TOOLS_FLAG_ID && enabled) {
          toast.message(t('developer.dcsProdFlags.viewToolsDiscover.afterEnableHint'));
        }
        await loadFlags();
      } catch (error) {
        toast.error(
          t('developer.dcsProdFlags.toggleFailedDetail', {
            error: toUserMessage(error) || String(error),
          }),
        );
        await loadFlags();
      } finally {
        setBusyId(null);
      }
    },
    [loadFlags, t],
  );

  const focusViewToolsFlag = useCallback(() => {
    setSelectedId(VIEW_TOOLS_FLAG_ID);
  }, []);

  return (
    <div
      className="space-y-4 rounded-lg border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
      data-testid="settings-dcs-prod-flags"
    >
      {/* FP-P1-03: single product entry for the first-product capability combo. */}
      <DcsPreviewCard />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Shield className="h-4 w-4" />
            {t('developer.dcsProdFlags.title')}
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">
            {t('developer.dcsProdFlags.description')}
          </p>
          <p
            className="mt-2 text-tiny text-muted-foreground"
            data-testid="settings-dcs-prod-flags-layer-role"
          >
            {t('developer.contextLayers.dcsTitle')}
          </p>
          <p
            className="mt-1 text-tiny text-muted-foreground"
            data-testid="settings-dcs-task-loop-note"
          >
            {t('developer.dcsProdFlags.taskLoopNote')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="w-fit border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
            data-testid="settings-dcs-prod-flags-mode"
          >
            {t('developer.dcsProdFlags.modeOptIn')}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void loadFlags()}
            data-testid="settings-dcs-prod-flags-refresh"
          >
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('developer.dcsProdFlags.refresh')}
          </Button>
        </div>
      </div>

      <ViewToolsDiscoverBanner
        enabled={viewToolsEnabled}
        busy={busyId === VIEW_TOOLS_FLAG_ID || loading}
        onEnable={() => void onToggle(VIEW_TOOLS_FLAG_ID, true)}
        onFocusFlag={focusViewToolsFlag}
      />

      {observability ? (
        <div
          className="space-y-2 rounded-lg border border-black/10 bg-surface-modal p-3 dark:border-white/10"
          data-testid="settings-dcs-observability-panel"
        >
          <p className="text-sm font-medium text-foreground">
            {t('developer.dcsProdFlags.observability.title')}
          </p>
          <div className="flex flex-wrap gap-2 text-tiny">
            <Badge
              variant="outline"
              className={cn(
                'font-normal',
                observability.killSwitchEngaged
                  ? 'border-red-500/30 text-red-700 dark:text-red-400'
                  : 'border-emerald-500/20 text-emerald-700 dark:text-emerald-400',
              )}
              data-testid="settings-dcs-observability-kill"
            >
              {observability.killSwitchEngaged
                ? t('developer.dcsProdFlags.observability.killOn')
                : t('developer.dcsProdFlags.observability.killOff')}
            </Badge>
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
              data-testid="settings-dcs-observability-view-env"
            >
              {observability.viewToolsEnvEngaged
                ? t('developer.dcsProdFlags.observability.viewEnvOn')
                : t('developer.dcsProdFlags.observability.viewEnvOff')}
            </Badge>
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
              data-testid="settings-dcs-observability-enabled-count"
            >
              {t('developer.dcsProdFlags.observability.enabledCount', {
                count: observability.enabledWritableFlagIds.length,
              })}
            </Badge>
          </div>
          {observability.enabledWritableFlagIds.length > 0 ? (
            <p className="text-tiny text-muted-foreground" data-testid="settings-dcs-observability-enabled-list">
              {observability.enabledWritableFlagIds.join(', ')}
            </p>
          ) : null}
          <p className="text-tiny text-muted-foreground" data-testid="settings-dcs-observability-note">
            {t('developer.dcsProdFlags.observability.note')}
          </p>
          <details className="text-tiny text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground/80">
              {t('developer.dcsProdFlags.observability.metricKeys')}
            </summary>
            <ul className="mt-1 list-inside list-disc space-y-0.5" data-testid="settings-dcs-observability-metric-keys">
              {observability.metricKeys.budgetSide.map((k) => (
                <li key={k}>
                  <code>{k}</code>
                </li>
              ))}
              {observability.metricKeys.writeSide.slice(0, 4).map((k) => (
                <li key={k}>
                  <code>{k}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2" data-testid="settings-dcs-prod-flags-list">
          {DCS_PROD_FLAGS.map((entry) => (
            <FlagRow
              key={entry.id}
              entry={entry}
              state={stateById.get(entry.id)}
              selected={entry.id === selected?.id}
              onSelect={() => setSelectedId(entry.id)}
            />
          ))}
        </div>

        {selected && (
          <div
            className="space-y-3 rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10"
            data-testid="settings-dcs-prod-flags-detail"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <BookOpen className="h-4 w-4" />
              {selected.key}
            </div>

            {selectedUnavailableReason ? (
              <p
                className="text-tiny text-amber-700 dark:text-amber-400"
                data-testid="settings-dcs-prod-flag-unavailable-reason"
              >
                {t('developer.dcsProdFlags.unavailableReasonLabel')}: {selectedUnavailableReason}
              </p>
            ) : null}

            {showMemoryBoundary ? (
              <p
                className="text-tiny text-muted-foreground"
                data-testid="settings-dcs-prod-flag-memory-boundary"
              >
                {t('developer.dcsProdFlags.memoryBoundaryNote')}
              </p>
            ) : null}

            {selected.id === VIEW_TOOLS_FLAG_ID ? (
              <p
                className="text-meta text-muted-foreground"
                data-testid="settings-dcs-view-tools-detail-hint"
              >
                {selectedState?.enabled
                  ? t('developer.dcsProdFlags.viewToolsDiscover.detailEnabled')
                  : t('developer.dcsProdFlags.viewToolsDiscover.detailDisabled', {
                      tools: VIEW_TOOL_NAMES.join(', '),
                    })}
              </p>
            ) : null}

            {selectedState?.writable ? (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
                data-testid="settings-dcs-prod-flags-toggle-row"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {t('developer.dcsProdFlags.toggleLabel')}
                  </p>
                  <p className="text-tiny text-muted-foreground">
                    {t(`developer.dcsProdFlags.status.${selectedState.status}`)}
                    {selectedState.message ? ` — ${selectedState.message}` : ''}
                  </p>
                </div>
                <Switch
                  checked={selectedState.enabled}
                  disabled={busyId === selected.id || loading}
                  onCheckedChange={(checked) => void onToggle(selected.id, checked)}
                  data-testid={`settings-dcs-prod-flag-switch-${selected.id}`}
                />
              </div>
            ) : (
              <p
                className="text-tiny text-muted-foreground"
                data-testid="settings-dcs-prod-flags-readonly-hint"
              >
                {t('developer.dcsProdFlags.readOnlyNote')}
              </p>
            )}

            {selected && lastAck[selected.id] ? (
              <AckDetail
                result={lastAck[selected.id]!}
                requerying={requeryingId === selected.id}
                onRequery={() => void onRequeryAck(selected.id)}
              />
            ) : null}

            <div className="space-y-2 text-meta text-muted-foreground">
              <p>
                <span className="font-medium text-foreground/80">
                  {t('developer.dcsProdFlags.defaultLabel')}:{' '}
                </span>
                {selected.defaultDisplay}
              </p>
              <p>
                <span className="font-medium text-foreground/80">
                  {t('developer.dcsProdFlags.enableLabel')}:{' '}
                </span>
                {selectedState?.writable
                  ? t('developer.dcsProdFlags.enableViaSettings')
                  : selected.enable}
              </p>
              <p>
                <span className="font-medium text-foreground/80">
                  {t('developer.dcsProdFlags.rollbackLabel')}:{' '}
                </span>
                {selectedState?.writable
                  ? t('developer.dcsProdFlags.rollbackViaSettings')
                  : selected.rollback}
              </p>
              <p>
                <span className="font-medium text-foreground/80">
                  {t('developer.dcsProdFlags.riskLabel')}:{' '}
                </span>
                {selected.riskNote}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
