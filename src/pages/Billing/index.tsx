import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import * as HeatGraph from 'heat-graph';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Coins,
  CreditCard,
  Database,
  FileClock,
  Grid3X3,
  Layers3,
  ListChecks,
  ReceiptText,
  RefreshCw,
  Server,
  Sigma,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FeedbackState } from '@/components/common/FeedbackState';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGatewayStore } from '@/stores/gateway';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  resolveStableUsageHistory,
  resolveVisibleUsageHistory,
  type UsageGroup,
  type UsageHistoryEntry,
  type UsageWindow,
} from '@/pages/Models/usage-history';

const USAGE_REFRESH_INTERVAL_MS = 15_000;
const USAGE_FETCH_RETRY_DELAY_MS = 1200;
const USAGE_FETCH_MAX_ATTEMPTS = 3;

const HIDDEN_USAGE_MARKERS = ['gateway-injected', 'delivery-mirror'];
const HEAT_GRAPH_COLORS = [
  'var(--billing-heatgraph-level-0)',
  'var(--billing-heatgraph-level-1)',
  'var(--billing-heatgraph-level-2)',
  'var(--billing-heatgraph-level-3)',
  'var(--billing-heatgraph-level-4)',
];

type FetchState = {
  status: 'idle' | 'loading' | 'done';
  data: UsageHistoryEntry[];
  stableData: UsageHistoryEntry[];
};

type FetchAction =
  | { type: 'start' }
  | { type: 'done'; data: UsageHistoryEntry[] }
  | { type: 'failed' };

type DailyBucket = {
  key: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  count: number;
};

type HeatmapBucket = {
  key: string;
  label: string;
  totalTokens: number;
  count: number;
};

function isHiddenUsageSource(source?: string): boolean {
  if (!source) return false;
  const normalizedSource = source.trim().toLowerCase();
  return HIDDEN_USAGE_MARKERS.some((marker) => normalizedSource.includes(marker));
}

function shouldHideUsageEntry(entry: UsageHistoryEntry): boolean {
  return isHiddenUsageSource(entry.provider) || isHiddenUsageSource(entry.model);
}

function isAvailableUsageEntry(entry: UsageHistoryEntry): boolean {
  return entry.usageStatus === undefined || entry.usageStatus === 'available';
}

function isTokenizedUsageEntry(entry: UsageHistoryEntry): boolean {
  return isAvailableUsageEntry(entry) && entry.totalTokens > 0;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard' }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1 ? 2 : 5,
  }).format(value);
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatMonthLabel(month: number, locale?: string): string {
  const date = new Date(2026, month, 1);
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
}

function formatWeekdayLabel(dayOfWeek: number, locale?: string): string {
  const sunday = new Date(2026, 0, 4 + dayOfWeek);
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(sunday);
}

function getSundayAlignedWeekCount(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  startDate.setDate(startDate.getDate() - startDate.getDay());
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  return Math.max(1, Math.ceil(days / 7));
}

function buildHeatmapBuckets(entries: UsageHistoryEntry[], dayCount = 365): HeatmapBucket[] {
  const now = new Date();
  const buckets = new Map<string, HeatmapBucket>();
  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    const key = dayKey(date);
    buckets.set(key, {
      key,
      label: formatDayLabel(date),
      totalTokens: 0,
      count: 0,
    });
  }

  for (const entry of entries) {
    const date = new Date(entry.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = buckets.get(dayKey(date));
    if (!bucket) continue;
    bucket.totalTokens += entry.totalTokens;
    bucket.count += 1;
  }

  return Array.from(buckets.values());
}

function getLatestTimestamp(entries: UsageHistoryEntry[]): string | null {
  const latest = entries
    .map((entry) => Date.parse(entry.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => right - left)[0];

  return latest === undefined ? null : new Date(latest).toISOString();
}

function getUsageStatusKey(entry: UsageHistoryEntry): 'available' | 'missing' | 'error' {
  if (isAvailableUsageEntry(entry)) return 'available';
  return entry.usageStatus === 'error' ? 'error' : 'missing';
}

function getUsageStatusClass(entry: UsageHistoryEntry): string {
  const status = getUsageStatusKey(entry);
  if (status === 'error') {
    return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400';
  }
  if (status === 'missing') {
    return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
  }
  return 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400';
}

type IconTone = 'default' | 'input' | 'output' | 'cache' | 'success' | 'warning' | 'danger';

function getIconToneClass(tone: IconTone): string {
  switch (tone) {
    case 'input':
      return 'border-usage-input/20 bg-usage-input/10 text-usage-input';
    case 'output':
    case 'success':
      return 'border-usage-output/20 bg-usage-output/10 text-usage-output';
    case 'cache':
    case 'warning':
      return 'border-usage-cache/25 bg-usage-cache/15 text-yellow-700 dark:text-usage-cache';
    case 'danger':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400';
    default:
      return 'border-black/10 bg-black/5 text-foreground/70 dark:border-white/10 dark:bg-white/10 dark:text-foreground/75';
  }
}

function IconFrame({
  children,
  tone = 'default',
  size = 'md',
  className,
}: {
  children: ReactNode;
  tone?: IconTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border',
        size === 'sm' && 'h-8 w-8 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
        size === 'md' && 'h-9 w-9 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
        size === 'lg' && 'h-11 w-11 rounded-xl [&_svg]:h-5 [&_svg]:w-5',
        getIconToneClass(tone),
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function buildDailyBuckets(entries: UsageHistoryEntry[], window: UsageWindow): DailyBucket[] {
  if (window === 'all') {
    const grouped = new Map<string, DailyBucket>();
    for (const entry of entries) {
      const date = new Date(entry.timestamp);
      if (Number.isNaN(date.getTime())) continue;
      const key = dayKey(date);
      const current = grouped.get(key) ?? {
        key,
        label: formatDayLabel(date),
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        count: 0,
      };
      current.inputTokens += entry.inputTokens;
      current.outputTokens += entry.outputTokens;
      current.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
      current.totalTokens += entry.totalTokens;
      current.costUsd += typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0;
      current.count += 1;
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort((left, right) => left.key.localeCompare(right.key));
  }

  const dayCount = window === '7d' ? 7 : 30;
  const now = new Date();
  const buckets = new Map<string, DailyBucket>();
  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    const key = dayKey(date);
    buckets.set(key, {
      key,
      label: formatDayLabel(date),
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      count: 0,
    });
  }

  for (const entry of entries) {
    const date = new Date(entry.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = buckets.get(dayKey(date));
    if (!bucket) continue;
    bucket.inputTokens += entry.inputTokens;
    bucket.outputTokens += entry.outputTokens;
    bucket.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
    bucket.totalTokens += entry.totalTokens;
    bucket.costUsd += typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0;
    bucket.count += 1;
  }

  return Array.from(buckets.values());
}

function BillingKpi({
  icon,
  tone = 'default',
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  tone?: IconTone;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 truncate font-serif text-3xl font-normal tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <IconFrame tone={tone}>{icon}</IconFrame>
      </div>
    </div>
  );
}

function BillingSignal({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: IconTone;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <IconFrame tone={tone} size="sm">{icon}</IconFrame>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  tone = 'default',
}: {
  icon: ReactNode;
  title: string;
  description: string;
  tone?: IconTone;
}) {
  return (
    <div className="flex items-start gap-3">
      <IconFrame tone={tone} className="mt-0.5">{icon}</IconFrame>
      <div className="min-w-0">
        <h2 className="font-serif text-3xl font-normal tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CompleteUsageChart({
  buckets,
  emptyLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
  peakLabel,
}: {
  buckets: DailyBucket[];
  emptyLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
  tokensLabel?: string;
  peakLabel?: string;
}) {
  const hasData = buckets.some((bucket) => bucket.totalTokens > 0);

  if (buckets.length === 0) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] p-6 dark:border-white/10 dark:bg-white/[0.03]">
        <FeedbackState state="empty" title={emptyLabel} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10" data-testid="billing-token-chart">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-xs font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-usage-input" />{inputLabel}</span>
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-usage-output" />{outputLabel}</span>
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-usage-cache" />{cacheLabel}</span>
        </div>
        {hasData && peakLabel && <Badge variant="outline" className="rounded-full">{peakLabel}</Badge>}
        {!hasData && <Badge variant="outline" className="rounded-full">{emptyLabel}</Badge>}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={buckets} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatTokenCount}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--surface-modal))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
              fontSize: '0.75rem',
            }}
            labelStyle={{ fontWeight: 600, marginBottom: '0.25rem' }}
            formatter={(_value: unknown, name: unknown) => [
              formatTokenCount(Number(_value)),
              String(name) === 'inputTokens' ? inputLabel : String(name) === 'outputTokens' ? outputLabel : cacheLabel,
            ]}
            labelFormatter={(label: unknown) => String(label)}
          />
          <Bar
            dataKey="cacheTokens"
            stackId="tokens"
            fill="hsl(var(--usage-cache))"
            radius={0}
            isAnimationActive={false}
          />
          <Bar
            dataKey="outputTokens"
            stackId="tokens"
            fill="hsl(var(--usage-output))"
            radius={0}
            isAnimationActive={false}
          />
          <Bar
            dataKey="inputTokens"
            stackId="tokens"
            fill="hsl(var(--usage-input))"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ModelRankChart({
  groups,
  emptyLabel,
}: {
  groups: UsageGroup[];
  emptyLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-black/10 p-6 text-center text-sm text-muted-foreground dark:border-white/10">
        {emptyLabel}
      </div>
    );
  }

  const chartData = groups.map((group) => ({
    name: group.label,
    totalTokens: group.totalTokens,
    inputTokens: group.inputTokens,
    outputTokens: group.outputTokens,
    cacheTokens: group.cacheTokens,
  }));

  return (
    <div className="rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10" data-testid="billing-model-chart">
      <ResponsiveContainer width="100%" height={Math.max(200, groups.length * 48)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatTokenCount}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}
            tickLine={false}
            axisLine={false}
            width={140}
            tickFormatter={(value: string) => {
              const maxLen = 20;
              return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
            }}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--surface-modal))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
              fontSize: '0.75rem',
            }}
            labelStyle={{ fontWeight: 600, marginBottom: '0.25rem' }}
            formatter={(value: unknown) => [formatTokenCount(Number(value))]}
          />
          <Bar dataKey="cacheTokens" stackId="tokens" fill="hsl(var(--usage-cache))" isAnimationActive={false} />
          <Bar dataKey="outputTokens" stackId="tokens" fill="hsl(var(--usage-output))" isAnimationActive={false} />
          <Bar dataKey="inputTokens" stackId="tokens" fill="hsl(var(--usage-input))" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function UsageHeatmap({
  buckets,
  tokensLabel,
  lessLabel,
  moreLabel,
  locale,
}: {
  buckets: HeatmapBucket[];
  tokensLabel: string;
  lessLabel: string;
  moreLabel: string;
  locale?: string;
}) {
  const bucketByDate = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const data = buckets.map((bucket) => ({ date: bucket.key, count: bucket.totalTokens }));
  const start = buckets[0]?.key;
  const end = buckets[buckets.length - 1]?.key;
  const weekCount = getSundayAlignedWeekCount(start, end);

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border p-5 shadow-none',
        'border-[#d0d7de] bg-white text-[#24292f] dark:border-[#30363d] dark:bg-[#0d1117] dark:text-white',
        '[--billing-heatgraph-level-0:#ebedf0] [--billing-heatgraph-level-1:#9be9a8] [--billing-heatgraph-level-2:#40c463] [--billing-heatgraph-level-3:#30a14e] [--billing-heatgraph-level-4:#216e39]',
        'dark:[--billing-heatgraph-level-0:#161b22] dark:[--billing-heatgraph-level-1:#0e4429] dark:[--billing-heatgraph-level-2:#006d32] dark:[--billing-heatgraph-level-3:#26a641] dark:[--billing-heatgraph-level-4:#39d353]',
      )}
      data-testid="billing-usage-heatmap"
    >
      <HeatGraph.Root
        data={data}
        start={start}
        end={end}
        weekStart="sunday"
        colorScale={HEAT_GRAPH_COLORS}
        className="min-w-max"
      >
        <div
          className="grid gap-x-3 gap-y-2"
          style={{
            gridTemplateColumns: '40px auto',
            gridTemplateRows: '20px auto',
          }}
        >
          <div />
          <div
            className="relative h-5 text-xs font-semibold text-[#24292f] dark:text-white"
            style={{ width: `${weekCount * 12 + Math.max(0, weekCount - 1) * 3}px` }}
          >
            <HeatGraph.MonthLabels>
              {({ label }: { label: { column: number; month: number; year: number } }) => {
                if (label.column === 0) return null;
                return (
                  <span
                    className="absolute top-0 whitespace-nowrap"
                    style={{ left: `${label.column * 15}px` }}
                  >
                    {formatMonthLabel(label.month, locale)}
                  </span>
                );
              }}
            </HeatGraph.MonthLabels>
          </div>
          <div
            className="grid text-sm font-semibold leading-3 text-[#24292f] dark:text-white"
            style={{
              gridTemplateRows: 'repeat(7, 12px)',
              rowGap: '3px',
            }}
          >
            <HeatGraph.DayLabels>
              {({ label }: { label: { row: number; dayOfWeek: number } }) => {
                const showLabel = label.dayOfWeek === 1 || label.dayOfWeek === 3 || label.dayOfWeek === 5;
                return (
                  <span
                    className="self-center whitespace-nowrap"
                    style={{ gridRow: label.row + 1 }}
                  >
                    {showLabel ? formatWeekdayLabel(label.dayOfWeek, locale) : ''}
                  </span>
                );
              }}
            </HeatGraph.DayLabels>
          </div>
          <HeatGraph.Grid
            className="gap-[3px]"
            style={{
              gridTemplateColumns: `repeat(${weekCount}, 12px)`,
              gridTemplateRows: 'repeat(7, 12px)',
            }}
          >
            {({ cell }: { cell: { date: Date; count: number } }) => {
              const dateKey = dayKey(cell.date);
              const bucket = bucketByDate.get(dateKey);
              const label = bucket?.label ?? formatDayLabel(cell.date);
              return (
                <HeatGraph.Cell
                  className="h-3 w-3 rounded-[2px]"
                  title={`${label}: ${formatTokenCount(cell.count)} ${tokensLabel}`}
                  data-billing-usage-date={dateKey}
                  data-billing-usage-records={bucket?.count ?? 0}
                  data-billing-usage-tokens={cell.count}
                  data-testid="billing-usage-heatmap-day"
                />
              );
            }}
          </HeatGraph.Grid>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-[#57606a] dark:text-[#8b949e]">
          <span>{lessLabel}</span>
          <div className="flex gap-[3px]">
            <HeatGraph.Legend>
              {() => <HeatGraph.LegendLevel className="h-3 w-3 rounded-[2px]" />}
            </HeatGraph.Legend>
          </div>
          <span>{moreLabel}</span>
        </div>
      </HeatGraph.Root>
    </div>
  );
}

export function Billing({ embedded }: { embedded?: boolean } = {}) {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('30d');
  const [usageRefreshNonce, setUsageRefreshNonce] = useState(0);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenerationRef = useRef(0);

  const [fetchState, dispatchFetch] = useReducer(
    (state: FetchState, action: FetchAction): FetchState => {
      switch (action.type) {
        case 'start':
          return { ...state, status: 'loading' };
        case 'done':
          return {
            status: 'done',
            data: action.data,
            stableData: resolveStableUsageHistory(state.stableData, action.data),
          };
        case 'failed':
          return { ...state, status: 'done' };
        default:
          return state;
      }
    },
    { status: 'idle', data: [], stableData: [] },
  );

  useEffect(() => {
    let cancelled = false;
    const generation = fetchGenerationRef.current + 1;
    fetchGenerationRef.current = generation;

    const fetchUsage = async (attempt: number) => {
      if (cancelled || fetchGenerationRef.current !== generation) return;
      dispatchFetch({ type: 'start' });
      try {
        const entries = await hostApi.usage.recentTokenHistory(800);
        if (cancelled || fetchGenerationRef.current !== generation) return;
        const normalized = Array.isArray(entries) ? entries : [];
        dispatchFetch({ type: 'done', data: normalized.filter((entry) => !shouldHideUsageEntry(entry)) });
      } catch {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        if (attempt < USAGE_FETCH_MAX_ATTEMPTS) {
          fetchTimerRef.current = setTimeout(() => void fetchUsage(attempt + 1), USAGE_FETCH_RETRY_DELAY_MS);
          return;
        }
        dispatchFetch({ type: 'failed' });
      }
    };

    void fetchUsage(1);
    const interval = window.setInterval(() => void fetchUsage(1), USAGE_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [gatewayStatus.connectedAt, gatewayStatus.pid, gatewayStatus.state, usageRefreshNonce]);

  const visibleUsageHistory = resolveVisibleUsageHistory(fetchState.data, fetchState.stableData, {
    preferStableOnEmpty: fetchState.status === 'loading',
  });
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const billableUsageHistory = filteredUsageHistory.filter(isTokenizedUsageEntry);
  const dailyBuckets = buildDailyBuckets(billableUsageHistory, usageWindow);
  const heatmapBuckets = buildHeatmapBuckets(visibleUsageHistory.filter(isTokenizedUsageEntry), 365);
  const modelGroups = groupUsageHistory(billableUsageHistory, 'model');

  const totalTokens = billableUsageHistory.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const totalCost = billableUsageHistory.reduce((sum, entry) => (
    sum + (typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0)
  ), 0);
  const totalRecords = filteredUsageHistory.length;
  const billableRecords = billableUsageHistory.length;
  const unavailableRecords = filteredUsageHistory.filter((entry) => !isAvailableUsageEntry(entry)).length;
  const errorRecords = filteredUsageHistory.filter((entry) => entry.usageStatus === 'error').length;
  const activeModels = new Set(billableUsageHistory.map((entry) => entry.model).filter(Boolean)).size;
  const latestTimestamp = getLatestTimestamp(filteredUsageHistory);
  const usageLoading = fetchState.status === 'loading' && visibleUsageHistory.length === 0;
  const hasNoData = !usageLoading && fetchState.status === 'done' && totalRecords === 0;
  const usageRefreshing = fetchState.status === 'loading' && visibleUsageHistory.length > 0;
  const peakBucket = dailyBuckets.reduce<DailyBucket | null>((current, bucket) => {
    if (!current || bucket.totalTokens > current.totalTokens) return bucket;
    return current;
  }, null);

  const recentEntries = filteredUsageHistory
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 6);

  const billingContent = (
    <div
      data-testid="billing-page"
      className={cn(
        'flex flex-col overflow-hidden dark:bg-background',
        embedded ? 'min-h-0' : 'h-[calc(100vh-2.5rem)] -m-6',
      )}
    >
      <div className={cn('mx-auto flex h-full w-full max-w-6xl flex-col', embedded ? 'p-0' : 'p-10 pt-12')}>
        {embedded ? (
          <div className="mb-5 flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 rounded-full border-black/10 bg-transparent [&_svg]:shrink-0 dark:border-white/10">
                <Database className="h-3.5 w-3.5" />
                {t('dashboard:billing.transcriptSource')}
              </Badge>
              <Badge variant={isGatewayRunning ? 'secondary' : 'outline'} className="gap-1.5 rounded-full [&_svg]:shrink-0">
                <Server className="h-3.5 w-3.5" />
                {isGatewayRunning ? t('dashboard:billing.gatewayLive') : t('dashboard:billing.gatewayOffline')}
              </Badge>
              {usageRefreshing && (
                <Badge variant="outline" className="gap-1.5 rounded-full border-black/10 bg-transparent [&_svg]:shrink-0 dark:border-white/10">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t('dashboard:billing.refreshing')}
                </Badge>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                asChild
                variant="outline"
                data-testid="billing-back-to-models"
                className="h-10 rounded-lg border-black/10 bg-transparent px-4 dark:border-white/10"
              >
                <Link to="/settings/models">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('dashboard:billing.backToModels')}
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUsageRefreshNonce((value) => value + 1)}
                className="h-10 rounded-lg border-black/10 bg-transparent px-4 dark:border-white/10"
              >
                <RefreshCw className={cn('mr-2 h-4 w-4', fetchState.status === 'loading' && 'animate-spin')} />
                {t('common:actions.refresh')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mb-8 flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <IconFrame tone="output" size="lg">
                  <ReceiptText />
                </IconFrame>
                <h1 data-testid="billing-page-title" className="font-serif text-5xl font-normal tracking-tight text-foreground md:text-6xl">
                  {t('dashboard:billing.title')}
                </h1>
              </div>
              <p className="max-w-3xl text-subtitle font-medium text-foreground/70">
                {t('dashboard:billing.subtitle')}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1.5 rounded-full border-black/10 bg-transparent [&_svg]:shrink-0 dark:border-white/10">
                  <Database className="h-3.5 w-3.5" />
                  {t('dashboard:billing.transcriptSource')}
                </Badge>
                <Badge variant={isGatewayRunning ? 'secondary' : 'outline'} className="gap-1.5 rounded-full [&_svg]:shrink-0">
                  <Server className="h-3.5 w-3.5" />
                  {isGatewayRunning ? t('dashboard:billing.gatewayLive') : t('dashboard:billing.gatewayOffline')}
                </Badge>
                {usageRefreshing && (
                  <Badge variant="outline" className="gap-1.5 rounded-full border-black/10 bg-transparent [&_svg]:shrink-0 dark:border-white/10">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    {t('dashboard:billing.refreshing')}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                asChild
                variant="outline"
                data-testid="billing-back-to-models"
                className="h-10 rounded-lg border-black/10 bg-transparent px-4 dark:border-white/10"
              >
                <Link to="/settings/models">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('dashboard:billing.backToModels')}
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUsageRefreshNonce((value) => value + 1)}
                className="h-10 rounded-lg border-black/10 bg-transparent px-4 dark:border-white/10"
              >
                <RefreshCw className={cn('mr-2 h-4 w-4', fetchState.status === 'loading' && 'animate-spin')} />
                {t('common:actions.refresh')}
              </Button>
            </div>
          </div>
        )}

        <div className={cn('min-h-0 flex-1 pr-2 -mr-2 pb-10', embedded ? 'overflow-visible' : 'overflow-y-auto')}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-black/10 bg-transparent p-1 dark:border-white/10" data-testid="billing-window-controls">
              {(['7d', '30d', 'all'] as UsageWindow[]).map((windowValue) => (
                <Button
                  key={windowValue}
                  type="button"
                  variant={usageWindow === windowValue ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setUsageWindow(windowValue)}
                  className={cn(
                    'rounded-md',
                    usageWindow === windowValue ? 'bg-black/5 text-foreground dark:bg-white/10' : 'text-muted-foreground',
                  )}
                >
                  {t(`dashboard:billing.window.${windowValue}`)}
                </Button>
              ))}
            </div>
            <Badge variant="outline" className="rounded-full border-black/10 bg-transparent dark:border-white/10">
              {t('dashboard:billing.kpi.records', { count: totalRecords })}
            </Badge>
          </div>

          {usageLoading ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]">
              <FeedbackState state="loading" title={t('dashboard:billing.loading')} />
            </div>
          ) : hasNoData ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] p-8 dark:border-white/10 dark:bg-white/[0.03]" data-testid="billing-empty">
              <div className="max-w-md text-center">
                <Coins className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
                <p className="text-base font-medium text-foreground">{t('dashboard:billing.noData')}</p>
                <p className="mt-3 text-sm text-muted-foreground">{t('dashboard:billing.noDataHint')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-4">
                <BillingKpi
                  icon={<Sigma className="h-4 w-4" />}
                  tone="input"
                  label={t('dashboard:billing.kpi.tokens')}
                  value={formatTokenCount(totalTokens)}
                  detail={t('dashboard:billing.kpi.recordsWithUsage', { count: billableRecords })}
                />
                <BillingKpi
                  icon={<Coins className="h-4 w-4" />}
                  tone="output"
                  label={t('dashboard:billing.kpi.cost')}
                  value={formatCurrency(totalCost)}
                  detail={t('dashboard:billing.kpi.estimated')}
                />
                <BillingKpi
                  icon={<Server className="h-4 w-4" />}
                  label={t('dashboard:billing.kpi.models')}
                  value={formatTokenCount(activeModels)}
                  detail={t('dashboard:billing.kpi.activeModels')}
                />
                <BillingKpi
                  icon={<CreditCard className="h-4 w-4" />}
                  tone="cache"
                  label={t('dashboard:billing.kpi.averageCost')}
                  value={formatCurrency(billableRecords > 0 ? totalCost / billableRecords : 0)}
                  detail={t('dashboard:billing.kpi.perRecord')}
                />
              </div>

              <div
                className="grid gap-4 rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-4"
                data-testid="billing-data-quality"
              >
                <BillingSignal
                  icon={<Database className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.scanned')}
                  value={formatTokenCount(totalRecords)}
                />
                <BillingSignal
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.billable')}
                  value={formatTokenCount(billableRecords)}
                  tone="success"
                />
                <BillingSignal
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.unavailable')}
                  value={errorRecords > 0
                    ? t('dashboard:billing.dataQuality.unavailableWithErrors', {
                      unavailable: unavailableRecords,
                      errors: errorRecords,
                    })
                    : formatTokenCount(unavailableRecords)}
                  tone={unavailableRecords > 0 ? 'warning' : 'default'}
                />
                <BillingSignal
                  icon={<FileClock className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.latest')}
                  value={latestTimestamp ? formatTimestamp(latestTimestamp) : t('dashboard:billing.empty')}
                  tone="cache"
                />
              </div>

              <section className="space-y-3">
                <SectionHeader
                  icon={<BarChart3 />}
                  tone="input"
                  title={t('dashboard:billing.chart.title')}
                  description={t('dashboard:billing.chart.description')}
                />
                <CompleteUsageChart
                  buckets={dailyBuckets}
                  emptyLabel={t('dashboard:billing.empty')}
                  inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                  outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                  cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                  tokensLabel={t('dashboard:billing.tokensSuffix')}
                  peakLabel={peakBucket && peakBucket.totalTokens > 0
                    ? t('dashboard:billing.chart.peakDay', {
                      day: peakBucket.label,
                      tokens: formatTokenCount(peakBucket.totalTokens),
                    })
                    : undefined}
                />
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<Grid3X3 />}
                  tone="cache"
                  title={t('dashboard:billing.heatmap.title')}
                  description={t('dashboard:billing.heatmap.description')}
                />
                <UsageHeatmap
                  buckets={heatmapBuckets}
                  tokensLabel={t('dashboard:billing.tokensSuffix')}
                  lessLabel={t('dashboard:billing.heatmap.less')}
                  moreLabel={t('dashboard:billing.heatmap.more')}
                  locale={i18n.language}
                />
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<Layers3 />}
                  tone="output"
                  title={t('dashboard:billing.modelChart.title')}
                  description={t('dashboard:billing.modelChart.description')}
                />
                <ModelRankChart groups={modelGroups} emptyLabel={t('dashboard:billing.empty')} />
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<ListChecks />}
                  title={t('dashboard:billing.recent.title')}
                  description={t('dashboard:billing.recent.description')}
                />
                <div className="overflow-hidden rounded-lg border border-black/10 bg-surface-modal dark:border-white/10" data-testid="billing-recent-list">
                  {recentEntries.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">{t('dashboard:billing.empty')}</div>
                  ) : (
                    <div className="divide-y divide-black/5 dark:divide-white/10">
                      {recentEntries.map((entry) => {
                        const statusKey = getUsageStatusKey(entry);
                        const costAvailable = typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd);
                        return (
                          <div key={`${entry.sessionId}-${entry.timestamp}`} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                                </p>
                                <Badge variant="outline" className={cn('rounded-full text-[10px]', getUsageStatusClass(entry))}>
                                  {t(`dashboard:billing.status.${statusKey}`)}
                                </Badge>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {[entry.provider, entry.agentId, entry.sessionId].filter(Boolean).join(' - ')}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-muted-foreground">
                                {isAvailableUsageEntry(entry) ? (
                                  <>
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full bg-usage-input" />
                                      {t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full bg-usage-output" />
                                      {t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}
                                    </span>
                                    {(entry.cacheReadTokens > 0 || entry.cacheWriteTokens > 0) && (
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-usage-cache" />
                                        {t('dashboard:recentTokenHistory.cacheShort')} {formatTokenCount(entry.cacheReadTokens + entry.cacheWriteTokens)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span>
                                    {statusKey === 'missing'
                                      ? t('dashboard:recentTokenHistory.noUsage')
                                      : t('dashboard:recentTokenHistory.usageParseError')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground md:justify-end">
                              <span>{formatTokenCount(entry.totalTokens)} {t('dashboard:billing.tokensSuffix')}</span>
                              {costAvailable && <span>{formatCurrency(entry.costUsd ?? 0)}</span>}
                              <span>{formatTimestamp(entry.timestamp)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  if (embedded) {
    return billingContent;
  }
  return (
    <div data-testid="billing-page" className="flex h-[calc(100vh-2.5rem)] -m-6 flex-col overflow-hidden dark:bg-background">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-10 pt-12">
        <div className="mb-8 flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <IconFrame tone="output" size="lg">
                <ReceiptText />
              </IconFrame>
              <h1 data-testid="billing-page-title" className="font-serif text-5xl font-normal tracking-tight text-foreground md:text-6xl">
                {t('dashboard:billing.title')}
              </h1>
            </div>
            <p className="max-w-3xl text-subtitle font-medium text-foreground/70">
              {t('dashboard:billing.subtitle')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 rounded-full border-black/10 bg-transparent [&_svg]:shrink-0 dark:border-white/10">
                <Database className="h-3.5 w-3.5" />
                {t('dashboard:billing.transcriptSource')}
              </Badge>
              <Badge variant={isGatewayRunning ? 'secondary' : 'outline'} className="gap-1.5 rounded-full [&_svg]:shrink-0">
                <Server className="h-3.5 w-3.5" />
                {isGatewayRunning ? t('dashboard:billing.gatewayLive') : t('dashboard:billing.gatewayOffline')}
              </Badge>
              {usageRefreshing && (
                <Badge variant="outline" className="gap-1.5 rounded-full border-black/10 bg-transparent [&_svg]:shrink-0 dark:border-white/10">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t('dashboard:billing.refreshing')}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              asChild
              variant="outline"
              data-testid="billing-back-to-models"
              className="h-10 rounded-lg border-black/10 bg-transparent px-4 dark:border-white/10"
            >
              <Link to="/settings/models">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('dashboard:billing.backToModels')}
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUsageRefreshNonce((value) => value + 1)}
              className="h-10 rounded-lg border-black/10 bg-transparent px-4 dark:border-white/10"
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', fetchState.status === 'loading' && 'animate-spin')} />
              {t('common:actions.refresh')}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-2 -mr-2 pb-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-black/10 bg-transparent p-1 dark:border-white/10" data-testid="billing-window-controls">
              {(['7d', '30d', 'all'] as UsageWindow[]).map((windowValue) => (
                <Button
                  key={windowValue}
                  type="button"
                  variant={usageWindow === windowValue ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setUsageWindow(windowValue)}
                  className={cn(
                    'rounded-md',
                    usageWindow === windowValue ? 'bg-black/5 text-foreground dark:bg-white/10' : 'text-muted-foreground',
                  )}
                >
                  {t(`dashboard:billing.window.${windowValue}`)}
                </Button>
              ))}
            </div>
            <Badge variant="outline" className="rounded-full border-black/10 bg-transparent dark:border-white/10">
              {t('dashboard:billing.kpi.records', { count: totalRecords })}
            </Badge>
          </div>

          {usageLoading ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]">
              <FeedbackState state="loading" title={t('dashboard:billing.loading')} />
            </div>
          ) : hasNoData ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] p-8 dark:border-white/10 dark:bg-white/[0.03]" data-testid="billing-empty">
              <div className="max-w-md text-center">
                <Coins className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
                <p className="text-base font-medium text-foreground">{t('dashboard:billing.noData')}</p>
                <p className="mt-3 text-sm text-muted-foreground">{t('dashboard:billing.noDataHint')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-4">
                <BillingKpi
                  icon={<Sigma className="h-4 w-4" />}
                  tone="input"
                  label={t('dashboard:billing.kpi.tokens')}
                  value={formatTokenCount(totalTokens)}
                  detail={t('dashboard:billing.kpi.recordsWithUsage', { count: billableRecords })}
                />
                <BillingKpi
                  icon={<Coins className="h-4 w-4" />}
                  tone="output"
                  label={t('dashboard:billing.kpi.cost')}
                  value={formatCurrency(totalCost)}
                  detail={t('dashboard:billing.kpi.estimated')}
                />
                <BillingKpi
                  icon={<Server className="h-4 w-4" />}
                  label={t('dashboard:billing.kpi.models')}
                  value={formatTokenCount(activeModels)}
                  detail={t('dashboard:billing.kpi.activeModels')}
                />
                <BillingKpi
                  icon={<CreditCard className="h-4 w-4" />}
                  tone="cache"
                  label={t('dashboard:billing.kpi.averageCost')}
                  value={formatCurrency(billableRecords > 0 ? totalCost / billableRecords : 0)}
                  detail={t('dashboard:billing.kpi.perRecord')}
                />
              </div>

              <div
                className="grid gap-4 rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-4"
                data-testid="billing-data-quality"
              >
                <BillingSignal
                  icon={<Database className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.scanned')}
                  value={formatTokenCount(totalRecords)}
                />
                <BillingSignal
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.billable')}
                  value={formatTokenCount(billableRecords)}
                  tone="success"
                />
                <BillingSignal
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.unavailable')}
                  value={errorRecords > 0
                    ? t('dashboard:billing.dataQuality.unavailableWithErrors', {
                      unavailable: unavailableRecords,
                      errors: errorRecords,
                    })
                    : formatTokenCount(unavailableRecords)}
                  tone={unavailableRecords > 0 ? 'warning' : 'default'}
                />
                <BillingSignal
                  icon={<FileClock className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.latest')}
                  value={latestTimestamp ? formatTimestamp(latestTimestamp) : t('dashboard:billing.empty')}
                  tone="cache"
                />
              </div>

              <section className="space-y-3">
                <SectionHeader
                  icon={<BarChart3 />}
                  tone="input"
                  title={t('dashboard:billing.chart.title')}
                  description={t('dashboard:billing.chart.description')}
                />
                <CompleteUsageChart
                  buckets={dailyBuckets}
                  emptyLabel={t('dashboard:billing.empty')}
                  inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                  outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                  cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                  tokensLabel={t('dashboard:billing.tokensSuffix')}
                  peakLabel={peakBucket && peakBucket.totalTokens > 0
                    ? t('dashboard:billing.chart.peakDay', {
                      day: peakBucket.label,
                      tokens: formatTokenCount(peakBucket.totalTokens),
                    })
                    : undefined}
                />
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<Grid3X3 />}
                  tone="cache"
                  title={t('dashboard:billing.heatmap.title')}
                  description={t('dashboard:billing.heatmap.description')}
                />
                <UsageHeatmap
                  buckets={heatmapBuckets}
                  tokensLabel={t('dashboard:billing.tokensSuffix')}
                  lessLabel={t('dashboard:billing.heatmap.less')}
                  moreLabel={t('dashboard:billing.heatmap.more')}
                  locale={i18n.language}
                />
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<Layers3 />}
                  tone="output"
                  title={t('dashboard:billing.modelChart.title')}
                  description={t('dashboard:billing.modelChart.description')}
                />
                <ModelRankChart groups={modelGroups} emptyLabel={t('dashboard:billing.empty')} />
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<ListChecks />}
                  title={t('dashboard:billing.recent.title')}
                  description={t('dashboard:billing.recent.description')}
                />
                <div className="overflow-hidden rounded-lg border border-black/10 bg-surface-modal dark:border-white/10" data-testid="billing-recent-list">
                  {recentEntries.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">{t('dashboard:billing.empty')}</div>
                  ) : (
                    <div className="divide-y divide-black/5 dark:divide-white/10">
                      {recentEntries.map((entry) => {
                        const statusKey = getUsageStatusKey(entry);
                        const costAvailable = typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd);
                        return (
                          <div key={`${entry.sessionId}-${entry.timestamp}`} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                                </p>
                                <Badge variant="outline" className={cn('rounded-full text-[10px]', getUsageStatusClass(entry))}>
                                  {t(`dashboard:billing.status.${statusKey}`)}
                                </Badge>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {[entry.provider, entry.agentId, entry.sessionId].filter(Boolean).join(' - ')}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-muted-foreground">
                                {isAvailableUsageEntry(entry) ? (
                                  <>
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full bg-usage-input" />
                                      {t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full bg-usage-output" />
                                      {t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}
                                    </span>
                                    {(entry.cacheReadTokens > 0 || entry.cacheWriteTokens > 0) && (
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-usage-cache" />
                                        {t('dashboard:recentTokenHistory.cacheShort')} {formatTokenCount(entry.cacheReadTokens + entry.cacheWriteTokens)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span>
                                    {statusKey === 'missing'
                                      ? t('dashboard:recentTokenHistory.noUsage')
                                      : t('dashboard:recentTokenHistory.usageParseError')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground md:justify-end">
                              <span>{formatTokenCount(entry.totalTokens)} {t('dashboard:billing.tokensSuffix')}</span>
                              {costAvailable && <span>{formatCurrency(entry.costUsd ?? 0)}</span>}
                              <span>{formatTimestamp(entry.timestamp)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Billing;
