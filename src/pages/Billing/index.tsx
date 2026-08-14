import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import * as HeatGraph from 'heat-graph';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Coins,
  CreditCard,
  Database,
  FileClock,
  Files,
  Gauge,
  Layers3,
  ListChecks,
  ReceiptText,
  RefreshCw,
  Server,
  Sigma,
  Table2,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FeedbackState } from '@/components/common/FeedbackState';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useGatewayStore } from '@/stores/gateway';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { computeCacheHitRate, isHiddenUsageSource, promptTokensForUsage } from '@shared/types/usage';
import type { UsageAggregateDimension, UsageAggregateSummary } from '@shared/host-api/contract';
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

const HEAT_GRAPH_COLORS = [
  'var(--billing-heatgraph-level-0)',
  'var(--billing-heatgraph-level-1)',
  'var(--billing-heatgraph-level-2)',
  'var(--billing-heatgraph-level-3)',
  'var(--billing-heatgraph-level-4)',
];

const DIMENSION_ROW_CAP = 12;

type FetchState = {
  status: 'idle' | 'loading' | 'done';
  data: UsageHistoryEntry[];
  stableData: UsageHistoryEntry[];
};

type FetchAction =
  | { type: 'start' }
  | { type: 'done'; data: UsageHistoryEntry[] }
  | { type: 'failed' };

type AggregateState = {
  status: 'idle' | 'loading' | 'done';
  data: UsageAggregateSummary | null;
};

type DailyBucket = {
  key: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  count: number;
  promptTokens: number;
  cacheHitRate: number | null;
};

type HeatmapBucket = {
  key: string;
  label: string;
  totalTokens: number;
  count: number;
};

type DimensionRow = {
  key: string;
  label: string;
  records: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  cacheHitRate: number | null;
};

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
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        count: 0,
        promptTokens: 0,
        cacheHitRate: null,
      };
      current.inputTokens += entry.inputTokens;
      current.outputTokens += entry.outputTokens;
      current.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
      current.cacheReadTokens += entry.cacheReadTokens;
      current.totalTokens += entry.totalTokens;
      current.costUsd += typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0;
      current.promptTokens += promptTokensForUsage(entry);
      current.count += 1;
      grouped.set(key, current);
    }
    return Array.from(grouped.values())
      .map((bucket) => finalizeDailyBucket(bucket))
      .sort((left, right) => left.key.localeCompare(right.key));
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
      cacheReadTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      count: 0,
      promptTokens: 0,
      cacheHitRate: null,
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
    bucket.cacheReadTokens += entry.cacheReadTokens;
    bucket.totalTokens += entry.totalTokens;
    bucket.costUsd += typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0;
    bucket.promptTokens += promptTokensForUsage(entry);
    bucket.count += 1;
  }

  return Array.from(buckets.values()).map((bucket) => finalizeDailyBucket(bucket));
}

function finalizeDailyBucket(bucket: DailyBucket): DailyBucket {
  return {
    ...bucket,
    cacheHitRate: bucket.promptTokens > 0 ? bucket.cacheReadTokens / bucket.promptTokens : null,
  };
}

function BillingKpi({
  icon,
  tone = 'default',
  label,
  value,
  detail,
  testId,
}: {
  icon: ReactNode;
  tone?: IconTone;
  label: string;
  value: string;
  detail: string;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10" data-testid={testId}>
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
        'overflow-x-auto rounded-lg border p-4 shadow-none sm:p-5',
        '[--heat-cell:10px] [--heat-gap:3px] sm:[--heat-cell:12px] lg:[--heat-cell:13px]',
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
          className="grid gap-x-2 gap-y-2 sm:gap-x-3"
          style={{
            gridTemplateColumns: 'minmax(32px,auto) auto',
            gridTemplateRows: '20px auto',
          }}
        >
          <div />
          <div
            className="relative h-5 text-[11px] font-medium text-[#57606a] dark:text-[#8b949e]"
            style={{ width: `calc(${weekCount} * var(--heat-cell) + ${Math.max(0, weekCount - 1)} * var(--heat-gap))` }}
          >
            <HeatGraph.MonthLabels>
              {({ label }: { label: { column: number; month: number } }) => {
                if (label.column === 0) return null;
                return (
                  <span
                    className="absolute top-0 whitespace-nowrap"
                    style={{ left: `calc(${label.column} * (var(--heat-cell) + var(--heat-gap)))` }}
                  >
                    {formatMonthLabel(label.month, locale)}
                  </span>
                );
              }}
            </HeatGraph.MonthLabels>
          </div>
          <div
            className="grid text-[11px] font-medium text-[#57606a] dark:text-[#8b949e]"
            style={{
              gridTemplateRows: 'repeat(7, var(--heat-cell))',
              rowGap: 'var(--heat-gap)',
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
            className="gap-[var(--heat-gap)]"
            style={{
              gridTemplateColumns: `repeat(${weekCount}, var(--heat-cell))`,
              gridTemplateRows: 'repeat(7, var(--heat-cell))',
            }}
          >
            {({ cell }: { cell: { date: Date; count: number } }) => {
              const dateKey = dayKey(cell.date);
              const bucket = bucketByDate.get(dateKey);
              const label = bucket?.label ?? formatDayLabel(cell.date);
              return (
                <HeatGraph.Cell
                  className="aspect-square w-[var(--heat-cell)] rounded-[2px] outline-none transition-[filter,transform,box-shadow] duration-100 hover:relative hover:z-10 hover:brightness-110 hover:ring-2 hover:ring-foreground/30 focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:transform-none"
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
        <div className="mt-4 flex items-center justify-end gap-2 text-xs text-[#57606a] dark:text-[#8b949e]">
          <span>{lessLabel}</span>
          <div className="flex gap-[var(--heat-gap)]">
            <HeatGraph.Legend>
              {() => <HeatGraph.LegendLevel className="aspect-square w-[var(--heat-cell)] rounded-[2px]" />}
            </HeatGraph.Legend>
          </div>
          <span>{moreLabel}</span>
        </div>
      </HeatGraph.Root>
    </div>
  );
}

function formatHitRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

function formatAxisCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

function chartTooltipStyle() {
  return {
    background: 'hsl(var(--surface-modal))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.5rem',
    fontSize: '0.75rem',
  } as const;
}

function toDailyBucketFromAggregate(dimension: UsageAggregateDimension & { date: string }): DailyBucket {
  const [year, month, day] = dimension.date.split('-').map((part) => Number(part));
  const label = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? formatDayLabel(new Date(year, month - 1, day))
    : dimension.date;
  return {
    key: dimension.date,
    label,
    inputTokens: dimension.inputTokens,
    outputTokens: dimension.outputTokens,
    cacheTokens: dimension.cacheReadTokens + dimension.cacheWriteTokens,
    cacheReadTokens: dimension.cacheReadTokens,
    totalTokens: dimension.totalTokens,
    costUsd: dimension.costUsd,
    count: dimension.records,
    promptTokens: dimension.promptTokens,
    cacheHitRate: dimension.cacheHitRate,
  };
}

function buildDimensionRows(
  entries: UsageHistoryEntry[],
  dimension: 'model' | 'agent',
  cap = DIMENSION_ROW_CAP,
): DimensionRow[] {
  const grouped = new Map<string, DimensionRow>();
  for (const entry of entries) {
    if (!isTokenizedUsageEntry(entry)) continue;
    const label = dimension === 'model'
      ? (entry.model?.trim() || 'Unknown')
      : (entry.agentId?.trim() || 'Unknown');
    const current = grouped.get(label) ?? {
      key: label,
      label,
      records: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      cacheHitRate: null,
    };
    current.records += 1;
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.cacheReadTokens += entry.cacheReadTokens;
    current.cacheWriteTokens += entry.cacheWriteTokens;
    current.totalTokens += entry.totalTokens;
    current.costUsd += typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0;
    grouped.set(label, current);
  }

  return Array.from(grouped.values())
    .map((row) => {
      const promptTokens = row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens;
      return {
        ...row,
        cacheHitRate: promptTokens > 0 ? row.cacheReadTokens / promptTokens : null,
      };
    })
    .sort((left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label))
    .slice(0, cap);
}

function toDimensionRows(dimensions: UsageAggregateDimension[]): DimensionRow[] {
  return dimensions.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    records: dimension.records,
    inputTokens: dimension.inputTokens,
    outputTokens: dimension.outputTokens,
    cacheReadTokens: dimension.cacheReadTokens,
    cacheWriteTokens: dimension.cacheWriteTokens,
    totalTokens: dimension.totalTokens,
    costUsd: dimension.costUsd,
    cacheHitRate: dimension.cacheHitRate,
  }));
}

function DailyCostChart({
  buckets,
  emptyLabel,
}: {
  buckets: DailyBucket[];
  emptyLabel: string;
}) {
  const hasData = buckets.some((bucket) => bucket.costUsd > 0);

  if (buckets.length === 0) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] p-6 dark:border-white/10 dark:bg-white/[0.03]">
        <FeedbackState state="empty" title={emptyLabel} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10" data-testid="billing-cost-chart">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={buckets} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="billing-cost-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--usage-output))" stopOpacity={0.28} />
              <stop offset="100%" stopColor="hsl(var(--usage-output))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
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
            width={62}
            tickFormatter={(value: number) => formatAxisCurrency(value)}
          />
          <Tooltip
            contentStyle={chartTooltipStyle()}
            labelStyle={{ fontWeight: 600, marginBottom: '0.25rem' }}
            formatter={(value: unknown) => [formatCurrency(Number(value))]}
            labelFormatter={(label: unknown) => String(label)}
          />
          <Area
            type="monotone"
            dataKey="costUsd"
            stroke="hsl(var(--usage-output))"
            strokeWidth={2}
            fill="url(#billing-cost-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {!hasData && <p className="mt-3 text-center text-xs text-muted-foreground">{emptyLabel}</p>}
    </div>
  );
}

function CacheHitRateChart({
  buckets,
  averageHitRate,
  emptyLabel,
}: {
  buckets: DailyBucket[];
  averageHitRate: number | null;
  emptyLabel: string;
}) {
  const data = buckets.map((bucket) => ({
    ...bucket,
    hitRate: bucket.cacheHitRate === null ? null : Math.round(bucket.cacheHitRate * 10_000) / 100,
  }));
  const hasData = data.some((bucket) => bucket.hitRate !== null);
  const averagePercent = averageHitRate === null ? null : Math.round(averageHitRate * 10_000) / 100;

  if (buckets.length === 0) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-black/[0.02] p-6 dark:border-white/10 dark:bg-white/[0.03]">
        <FeedbackState state="empty" title={emptyLabel} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10" data-testid="billing-hit-rate-chart">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => formatHitRate(value)}
          />
          <Tooltip
            contentStyle={chartTooltipStyle()}
            labelStyle={{ fontWeight: 600, marginBottom: '0.25rem' }}
            formatter={(value: unknown) => [formatHitRate(Number(value))]}
            labelFormatter={(label: unknown) => String(label)}
          />
          {averagePercent !== null && (
            <ReferenceLine
              y={averagePercent / 100}
              stroke="hsl(var(--usage-cache))"
              strokeDasharray="4 4"
            />
          )}
          <Line
            type="monotone"
            dataKey="hitRate"
            stroke="hsl(var(--usage-cache))"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {!hasData && <p className="mt-3 text-center text-xs text-muted-foreground">{emptyLabel}</p>}
    </div>
  );
}

function DimensionTable({
  testId,
  title,
  rows,
  labels,
  emptyLabel,
}: {
  testId: string;
  title: string;
  rows: DimensionRow[];
  labels: {
    name: string;
    records: string;
    tokens: string;
    input: string;
    output: string;
    cacheRead: string;
    hitRate: string;
    cost: string;
  };
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-black/10 p-6 text-center text-sm text-muted-foreground dark:border-white/10">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-surface-modal dark:border-white/10" data-testid={testId}>
      <div className="border-b border-black/5 px-4 py-3 dark:border-white/10">
        <p className="font-serif text-lg font-normal tracking-tight text-foreground">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-black/5 text-[11px] uppercase tracking-wide text-muted-foreground dark:border-white/10">
              <th className="px-4 py-2 font-medium">{labels.name}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.records}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.tokens}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.input}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.output}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.cacheRead}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.hitRate}</th>
              <th className="px-4 py-2 text-right font-medium">{labels.cost}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/10">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <td className="max-w-[180px] truncate whitespace-nowrap px-4 py-2.5 font-medium text-foreground" title={row.label}>
                  {row.label}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatTokenCount(row.records)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-foreground">{formatTokenCount(row.totalTokens)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatTokenCount(row.inputTokens)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatTokenCount(row.outputTokens)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">{formatTokenCount(row.cacheReadTokens)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-usage-cache">{formatHitRate(row.cacheHitRate)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-foreground">
                  {row.costUsd > 0 ? formatCurrency(row.costUsd) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

  const [aggregateState, setAggregateState] = useState<AggregateState>({ status: 'idle', data: null });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => hostApi.usage.aggregateSummary({ window: usageWindow }))
      .then((summary) => {
        if (!cancelled) setAggregateState({ status: 'done', data: summary });
      })
      .catch(() => {
        if (!cancelled) setAggregateState({ status: 'done', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayStatus.connectedAt, gatewayStatus.pid, gatewayStatus.state, usageRefreshNonce, usageWindow]);

  const aggregate = aggregateState.data;
  const aggregateAvailable = aggregate !== null && aggregate.window === usageWindow;

  const visibleUsageHistory = resolveVisibleUsageHistory(fetchState.data, fetchState.stableData, {
    preferStableOnEmpty: fetchState.status === 'loading',
  });
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const billableUsageHistory = filteredUsageHistory.filter(isTokenizedUsageEntry);
  const clientDailyBuckets = buildDailyBuckets(billableUsageHistory, usageWindow);
  const heatmapBuckets = buildHeatmapBuckets(visibleUsageHistory.filter(isTokenizedUsageEntry), 365);
  const modelGroups = groupUsageHistory(billableUsageHistory, 'model');

  const clientTotalTokens = billableUsageHistory.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const clientTotalCost = billableUsageHistory.reduce((sum, entry) => (
    sum + (typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0)
  ), 0);
  const clientCacheReadTokens = billableUsageHistory.reduce((sum, entry) => sum + entry.cacheReadTokens, 0);
  const clientCacheWriteTokens = billableUsageHistory.reduce((sum, entry) => sum + entry.cacheWriteTokens, 0);
  const clientPromptTokens = billableUsageHistory.reduce((sum, entry) => sum + promptTokensForUsage(entry), 0);
  const clientCacheHitRate = clientPromptTokens > 0 ? clientCacheReadTokens / clientPromptTokens : null;

  const totalTokens = aggregateAvailable ? aggregate.totalTokens : clientTotalTokens;
  const totalCost = aggregateAvailable ? aggregate.costUsd : clientTotalCost;
  const cacheReadTokens = aggregateAvailable ? aggregate.cacheReadTokens : clientCacheReadTokens;
  const cacheWriteTokens = aggregateAvailable ? aggregate.cacheWriteTokens : clientCacheWriteTokens;
  const promptTokens = aggregateAvailable ? aggregate.promptTokens : clientPromptTokens;
  const cacheHitRate = aggregateAvailable ? aggregate.cacheHitRate : clientCacheHitRate;

  const totalRecords = filteredUsageHistory.length;
  const displayTotalRecords = aggregateAvailable ? aggregate.entriesInWindow : totalRecords;
  const billableRecords = aggregateAvailable ? aggregate.billableEntries : billableUsageHistory.length;
  const unavailableRecords = aggregateAvailable
    ? aggregate.missingEntries + aggregate.errorEntries
    : filteredUsageHistory.filter((entry) => !isAvailableUsageEntry(entry)).length;
  const errorRecords = aggregateAvailable
    ? aggregate.errorEntries
    : filteredUsageHistory.filter((entry) => entry.usageStatus === 'error').length;
  const activeModels = aggregateAvailable
    ? aggregate.models.length
    : new Set(billableUsageHistory.map((entry) => entry.model).filter(Boolean)).size;
  const latestTimestamp = aggregateAvailable
    ? aggregate.latestTimestamp
    : getLatestTimestamp(filteredUsageHistory);
  const usageLoading = fetchState.status === 'loading' && visibleUsageHistory.length === 0;
  const hasNoData = !usageLoading && fetchState.status === 'done' && totalRecords === 0;
  const usageRefreshing = fetchState.status === 'loading' && visibleUsageHistory.length > 0;

  const dailyBuckets = aggregateAvailable
    ? aggregate.days.map(toDailyBucketFromAggregate)
    : clientDailyBuckets;

  const peakBucket = dailyBuckets.reduce<DailyBucket | null>((current, bucket) => {
    if (!current || bucket.totalTokens > current.totalTokens) return bucket;
    return current;
  }, null);

  const tableModelRows = aggregateAvailable
    ? toDimensionRows(aggregate.models)
    : buildDimensionRows(billableUsageHistory, 'model');
  const tableAgentRows = aggregateAvailable
    ? toDimensionRows(aggregate.agents)
    : buildDimensionRows(billableUsageHistory, 'agent');

  const recentEntries = filteredUsageHistory
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 6);

  const billingHeader = (
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
  );

  const billingBody = (scrollClass: string) => (
    <div className={cn('min-h-0 flex-1 pr-2 -mr-2 pb-10', scrollClass)}>
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
              {t('dashboard:billing.kpi.records', { count: displayTotalRecords })}
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

              <div className="grid gap-3 md:grid-cols-4">
                <BillingKpi
                  icon={<Gauge className="h-4 w-4" />}
                  tone="cache"
                  label={t('dashboard:billing.kpi.cacheHitRate')}
                  value={formatHitRate(cacheHitRate)}
                  detail={t('dashboard:billing.kpi.hitRateDetail')}
                  testId="billing-kpi-hit-rate"
                />
                <BillingKpi
                  icon={<Database className="h-4 w-4" />}
                  label={t('dashboard:billing.kpi.cacheReadTokens')}
                  value={formatTokenCount(cacheReadTokens)}
                  detail={t('dashboard:billing.kpi.cacheReadDetail')}
                  testId="billing-kpi-cache-read"
                />
                <BillingKpi
                  icon={<FileClock className="h-4 w-4" />}
                  label={t('dashboard:billing.kpi.cacheWriteTokens')}
                  value={formatTokenCount(cacheWriteTokens)}
                  detail={t('dashboard:billing.kpi.cacheWriteDetail')}
                  testId="billing-kpi-cache-write"
                />
                <BillingKpi
                  icon={<Sigma className="h-4 w-4" />}
                  tone="input"
                  label={t('dashboard:billing.kpi.promptTokens')}
                  value={formatTokenCount(promptTokens)}
                  detail={t('dashboard:billing.kpi.promptDetail')}
                  testId="billing-kpi-prompt"
                />
              </div>

              <p
                className="text-tiny text-muted-foreground"
                data-testid="billing-estimate-note"
              >
                {t('dashboard:billing.estimateNote')}
              </p>

              <p
                className="text-tiny text-muted-foreground"
                data-testid="billing-aggregate-note"
              >
                {aggregateAvailable
                  ? t('dashboard:billing.aggregateNote', { files: aggregate.scannedFiles })
                  : t('dashboard:billing.aggregateNoteFallback')}
              </p>

              <div
                className="grid gap-4 rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="billing-data-quality"
              >
                <BillingSignal
                  icon={<Database className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.scanned')}
                  value={formatTokenCount(displayTotalRecords)}
                />
                <BillingSignal
                  icon={<Files className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.scannedFiles')}
                  value={aggregateAvailable ? formatTokenCount(aggregate.scannedFiles) : '—'}
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
                  icon={<Gauge className="h-4 w-4" />}
                  label={t('dashboard:billing.dataQuality.cacheRead')}
                  value={formatTokenCount(cacheReadTokens)}
                  tone="cache"
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
                  icon={<TrendingUp />}
                  tone="output"
                  title={t('dashboard:billing.costChart.title')}
                  description={t('dashboard:billing.costChart.description')}
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <DailyCostChart buckets={dailyBuckets} emptyLabel={t('dashboard:billing.empty')} />
                  <CacheHitRateChart
                    buckets={dailyBuckets}
                    averageHitRate={cacheHitRate}
                    emptyLabel={t('dashboard:billing.noHitRateData')}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeader
                  icon={<CalendarDays />}
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
                  icon={<Table2 />}
                  title={t('dashboard:billing.tableSection.title')}
                  description={t('dashboard:billing.tableSection.description')}
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <DimensionTable
                    testId="billing-model-table"
                    title={t('dashboard:billing.modelTable.title')}
                    rows={tableModelRows}
                    labels={{
                      name: t('dashboard:billing.table.name'),
                      records: t('dashboard:billing.table.records'),
                      tokens: t('dashboard:billing.table.tokens'),
                      input: t('dashboard:billing.table.input'),
                      output: t('dashboard:billing.table.output'),
                      cacheRead: t('dashboard:billing.table.cacheRead'),
                      hitRate: t('dashboard:billing.table.hitRate'),
                      cost: t('dashboard:billing.table.cost'),
                    }}
                    emptyLabel={t('dashboard:billing.empty')}
                  />
                  <DimensionTable
                    testId="billing-agent-table"
                    title={t('dashboard:billing.agentTable.title')}
                    rows={tableAgentRows}
                    labels={{
                      name: t('dashboard:billing.table.name'),
                      records: t('dashboard:billing.table.records'),
                      tokens: t('dashboard:billing.table.tokens'),
                      input: t('dashboard:billing.table.input'),
                      output: t('dashboard:billing.table.output'),
                      cacheRead: t('dashboard:billing.table.cacheRead'),
                      hitRate: t('dashboard:billing.table.hitRate'),
                      cost: t('dashboard:billing.table.cost'),
                    }}
                    emptyLabel={t('dashboard:billing.empty')}
                  />
                </div>
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
                        const entryHitRate = computeCacheHitRate(entry);
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
                                    {entryHitRate !== null && (
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-usage-cache" />
                                        {t('dashboard:billing.recent.cacheHit', { value: formatHitRate(entryHitRate) })}
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
  );

  if (embedded) {
    return (
      <div data-testid="billing-page" className="flex min-h-0 flex-col overflow-hidden dark:bg-background">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-0">
          {billingHeader}
          {billingBody('overflow-visible')}
        </div>
      </div>
    );
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

        {billingBody('overflow-y-auto')}
      </div>
    </div>
  );
}

export default Billing;
