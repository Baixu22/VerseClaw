/**
 * Draws a Tool UI chart as the type it declares. Plain SVG: a chat card does not
 * need a chart library, and every mark stays individually testable.
 *
 * Follows the project's data-viz method: thin marks, a 2px surface gap and ring,
 * one axis, recessive hairlines, text in text tokens rather than series colours,
 * a legend for two or more series, and values reachable three ways (selective
 * direct labels, hover/keyboard tooltip, data table). The categorical palette in
 * codex-conversation.css was validated against the chat surfaces, light and dark.
 * Three light slots sit under 3:1, so the data table is always available.
 *
 * Anything that cannot be drawn honestly degrades to the table with a notice.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { barPath, niceTicks, pieSlices, sliceGeometry } from './chart-geometry';

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

export type ChartData = {
  chartType: ChartType | 'unsupported';
  /** The type the payload asked for when it is not one we can draw. */
  requestedType?: string;
  labels: string[];
  series: Array<{ name?: string; data: Array<number | null> }>;
};

const MAX_SERIES = 8;
const MAX_PIE_SLICES = 8;
const MAX_PIE_SMALL_MULTIPLES = 4;
const MAX_MARKER_POINTS = 12;
const MAX_TIP_LABELS = 8;
const DEFAULT_WIDTH = 560;
const HEIGHT = 220;
const BAR_MAX_WIDTH = 24;
const BAR_GAP = 2;
const END_LABEL_MIN_GAP = 12;

const seriesColor = (index: number) => `var(--chart-${(index % MAX_SERIES) + 1})`;

function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function useChartFormatters() {
  const { i18n } = useTranslation('chat');
  return useMemo(() => {
    const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 });
    const full = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
    const percent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 });
    return {
      axis: (value: number) => (Math.abs(value) >= 1000 ? compact.format(value) : full.format(value)),
      value: (value: number | null) => (value == null ? '–' : full.format(value)),
      percent: (value: number) => percent.format(value),
    };
  }, [i18n.language]);
}

function ChartTooltip({
  title,
  rows,
  left,
}: {
  title: string;
  rows: Array<{ key: string; name: string; value: string; color: string; shape: 'line' | 'rect' }>;
  left: number;
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1 z-10 max-w-[240px] rounded-md border border-border bg-surface-modal px-2.5 py-1.5 text-xs shadow-md"
      style={{ left, transform: 'translateX(-50%)' }}
      data-testid="chat-chart-tooltip"
    >
      <p className="mb-1 truncate text-2xs text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-1.5">
            <span
              className={cn('shrink-0', row.shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-sm')}
              style={{ backgroundColor: row.color }}
            />
            <span className="font-medium tabular-nums text-foreground">{row.value}</span>
            <span className="min-w-0 truncate text-muted-foreground">{row.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartLegend({
  items,
  shape,
}: {
  items: Array<{ key: string; name: string; color: string; detail?: string }>;
  shape: 'line' | 'rect';
}) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground" data-testid="chat-chart-legend">
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn('shrink-0', shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-sm')}
            style={{ backgroundColor: item.color }}
          />
          <span className="min-w-0 truncate">{item.name}</span>
          {item.detail && <span className="tabular-nums text-foreground/80">{item.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (count === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.min(count - 1, (value ?? -1) + 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.max(0, (value ?? count) - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(count - 1);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };
  return { active, setActive, onKeyDown };
}

function CartesianChart({
  chartType,
  labels,
  series,
  seriesNames,
  ariaLabel,
}: {
  chartType: 'bar' | 'line' | 'area';
  labels: string[];
  series: ChartData['series'];
  seriesNames: string[];
  ariaLabel: string;
}) {
  const { ref, width } = useMeasuredWidth();
  const format = useChartFormatters();
  const { active, setActive, onKeyDown } = useActiveIndex(labels.length);

  const values = series.flatMap((entry) => entry.data).filter((value): value is number => value != null);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Bars and areas encode length from zero. A line may zoom in, unless zero is close.
  const includeZero = chartType !== 'line' || (dataMin >= 0 && dataMin < dataMax * 0.5) || dataMin <= 0;
  const ticks = niceTicks(includeZero ? Math.min(0, dataMin) : dataMin, includeZero ? Math.max(0, dataMax) : dataMax);
  const domainMin = ticks[0]!;
  const domainMax = ticks[ticks.length - 1]!;

  const showEndLabels = chartType !== 'bar' && series.length <= 4;
  const margin = { top: 12, right: showEndLabels ? 48 : 12, bottom: 24, left: 44 };
  const plotWidth = Math.max(40, width - margin.left - margin.right);
  const plotHeight = HEIGHT - margin.top - margin.bottom;
  const yOf = (value: number) => margin.top + plotHeight - ((value - domainMin) / (domainMax - domainMin)) * plotHeight;
  const baseline = yOf(Math.max(domainMin, Math.min(domainMax, 0)));
  const band = plotWidth / labels.length;
  // Lines and areas span the plot edge to edge; bars sit in the middle of their band.
  const xOf = (index: number) => (chartType === 'bar' || labels.length === 1
    ? margin.left + band * index + band / 2
    : margin.left + (plotWidth * index) / (labels.length - 1));

  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / 64))));
  const maxLabelChars = Math.max(4, Math.floor((band * labelEvery) / 6.5));
  const clip = (label: string) => (label.length > maxLabelChars ? `${label.slice(0, maxLabelChars - 1)}…` : label);

  const barGroupWidth = Math.min(band * 0.72, series.length * BAR_MAX_WIDTH + (series.length - 1) * BAR_GAP);
  const barWidth = Math.max(1, (barGroupWidth - (series.length - 1) * BAR_GAP) / series.length);
  const showTipLabels = chartType === 'bar' && series.length === 1 && labels.length <= MAX_TIP_LABELS;
  const showMarkers = labels.length <= MAX_MARKER_POINTS;

  const segmentsOf = (data: Array<number | null>) => {
    const segments: Array<Array<{ index: number; value: number }>> = [];
    let current: Array<{ index: number; value: number }> = [];
    data.forEach((value, index) => {
      if (value == null) {
        if (current.length > 0) segments.push(current);
        current = [];
      } else {
        current.push({ index, value });
      }
    });
    if (current.length > 0) segments.push(current);
    return segments;
  };

  const endLabels = showEndLabels
    ? series.flatMap((entry, seriesIndex) => {
        const lastIndex = entry.data.findLastIndex((value) => value != null);
        if (lastIndex < 0) return [];
        const value = entry.data[lastIndex]!;
        return [{ seriesIndex, x: xOf(lastIndex), y: yOf(value), value }];
      })
    : [];
  const endLabelsCollide = endLabels.some((label, index) => endLabels.some(
    (other, otherIndex) => otherIndex > index && Math.abs(other.y - label.y) < END_LABEL_MIN_GAP,
  ));

  return (
    <div ref={ref} className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
        height={HEIGHT}
        className="block max-w-full rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((value) => value ?? 0)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        data-testid="chat-chart-plot"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={yOf(tick)}
              y2={yOf(tick)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <text x={margin.left - 8} y={yOf(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
              {format.axis(tick)}
            </text>
          </g>
        ))}

        {labels.map((label, index) => (index % labelEvery === 0 ? (
          <text
            key={`${label}-${index}`}
            x={xOf(index)}
            y={HEIGHT - 8}
            textAnchor={chartType !== 'bar' && labels.length > 1 && index === 0
              ? 'start'
              : chartType !== 'bar' && labels.length > 1 && index === labels.length - 1 ? 'end' : 'middle'}
            className="fill-muted-foreground text-[11px]"
          >
            {clip(label)}
          </text>
        ) : null))}

        {chartType === 'bar' && series.map((entry, seriesIndex) => entry.data.map((value, index) => {
          if (value == null || value === 0) return null;
          const groupStart = margin.left + band * index + (band - barGroupWidth) / 2;
          const x = groupStart + seriesIndex * (barWidth + BAR_GAP);
          return (
            <path
              key={`${seriesIndex}-${index}`}
              d={barPath(x, barWidth, baseline, yOf(value))}
              fill={seriesColor(seriesIndex)}
              opacity={active == null || active === index ? 1 : 0.55}
              data-chart-mark="bar"
            />
          );
        }))}

        {chartType === 'area' && series.map((entry, seriesIndex) => segmentsOf(entry.data).map((segment, segmentIndex) => (
          <path
            key={`area-${seriesIndex}-${segmentIndex}`}
            d={[
              `M${xOf(segment[0]!.index)},${baseline}`,
              ...segment.map((point) => `L${xOf(point.index)},${yOf(point.value)}`),
              `L${xOf(segment[segment.length - 1]!.index)},${baseline}`,
              'Z',
            ].join(' ')}
            fill={seriesColor(seriesIndex)}
            fillOpacity={0.1}
            data-chart-mark="area"
          />
        )))}

        {chartType !== 'bar' && series.map((entry, seriesIndex) => segmentsOf(entry.data).map((segment, segmentIndex) => (
          <path
            key={`line-${seriesIndex}-${segmentIndex}`}
            d={segment.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${xOf(point.index)},${yOf(point.value)}`).join(' ')}
            fill="none"
            stroke={seriesColor(seriesIndex)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            data-chart-mark="line"
          />
        )))}

        {chartType !== 'bar' && active != null && (
          <line
            x1={xOf(active)}
            x2={xOf(active)}
            y1={margin.top}
            y2={margin.top + plotHeight}
            stroke="var(--chart-crosshair)"
            strokeWidth={1}
            data-chart-mark="crosshair"
          />
        )}

        {chartType !== 'bar' && series.map((entry, seriesIndex) => entry.data.map((value, index) => {
          if (value == null) return null;
          // A point between two gaps has no line through it, so it always needs a dot.
          const isolated = entry.data[index - 1] == null && entry.data[index + 1] == null;
          if (!showMarkers && !isolated && active !== index) return null;
          return (
            <circle
              key={`dot-${seriesIndex}-${index}`}
              cx={xOf(index)}
              cy={yOf(value)}
              r={4}
              fill={seriesColor(seriesIndex)}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              data-chart-mark="dot"
            />
          );
        }))}

        {showTipLabels && series[0]!.data.map((value, index) => (value == null ? null : (
          <text
            key={`tip-${index}`}
            x={xOf(index)}
            y={yOf(value)}
            dy={value >= 0 ? -5 : 13}
            textAnchor="middle"
            className="fill-foreground/70 text-[11px] tabular-nums"
          >
            {format.axis(value)}
          </text>
        )))}

        {showEndLabels && !endLabelsCollide && endLabels.map((label) => (
          <text
            key={`end-${label.seriesIndex}`}
            x={label.x + 8}
            y={label.y}
            dy="0.32em"
            className="fill-foreground/70 text-[11px] tabular-nums"
          >
            {format.axis(label.value)}
          </text>
        ))}

        {labels.map((label, index) => {
          const hitLeft = chartType === 'bar' || labels.length === 1
            ? margin.left + band * index
            : Math.max(margin.left, xOf(index) - plotWidth / (labels.length - 1) / 2);
          const hitRight = chartType === 'bar' || labels.length === 1
            ? hitLeft + band
            : Math.min(margin.left + plotWidth, xOf(index) + plotWidth / (labels.length - 1) / 2);
          return (
            <rect
              key={`hit-${label}-${index}`}
              x={hitLeft}
              y={margin.top}
              width={Math.max(0, hitRight - hitLeft)}
              height={plotHeight}
              fill="transparent"
              onPointerMove={() => setActive(index)}
              data-chart-hit={index}
            />
          );
        })}
      </svg>

      {active != null && (
        <ChartTooltip
          title={labels[active] ?? ''}
          left={Math.max(90, Math.min(width - 90, xOf(active)))}
          rows={series.map((entry, seriesIndex) => ({
            key: String(seriesIndex),
            name: seriesNames[seriesIndex] ?? '',
            value: format.value(entry.data[active] ?? null),
            color: seriesColor(seriesIndex),
            shape: chartType === 'bar' ? 'rect' as const : 'line' as const,
          }))}
        />
      )}
    </div>
  );
}

function PieChart({
  labels,
  data,
  title,
  ariaLabel,
}: {
  labels: string[];
  data: Array<number | null>;
  title?: string;
  ariaLabel: string;
}) {
  const format = useChartFormatters();
  const { active, setActive, onKeyDown } = useActiveIndex(labels.length);
  const size = 168;
  const center = size / 2;
  const radius = center - 4;
  const slices = pieSlices(data);
  const focused = active != null ? slices[active] : undefined;

  return (
    <figure className="relative flex min-w-0 flex-col items-center gap-1">
      {title && <figcaption className="max-w-full truncate text-2xs text-muted-foreground">{title}</figcaption>}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="block rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((value) => value ?? 0)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        data-testid="chat-chart-plot"
      >
        {slices.map((slice) => (slice.share <= 0 ? null : (
          <path
            key={slice.index}
            d={sliceGeometry(center, center, radius, slice.start, slice.end)}
            fill={seriesColor(slice.index)}
            stroke="var(--chart-surface)"
            strokeWidth={2}
            opacity={active == null || active === slice.index ? 1 : 0.55}
            onPointerMove={() => setActive(slice.index)}
            data-chart-mark="slice"
          />
        )))}
      </svg>
      {focused && (
        <ChartTooltip
          title={labels[focused.index] ?? ''}
          left={center}
          rows={[{
            key: 'value',
            name: format.percent(focused.share),
            value: format.value(focused.value),
            color: seriesColor(focused.index),
            shape: 'rect',
          }]}
        />
      )}
    </figure>
  );
}

function ChartDataTable({ labels, series, seriesNames }: Pick<ChartData, 'labels' | 'series'> & { seriesNames: string[] }) {
  const { t } = useTranslation('chat');
  const format = useChartFormatters();
  return (
    <div className="mt-2 max-w-full overflow-x-auto rounded-md border border-black/5 dark:border-white/5" data-testid="chat-chart-table">
      <table className="w-full text-left text-xs">
        <thead className="bg-black/[0.02] text-muted-foreground dark:bg-white/[0.03]">
          <tr>
            <th scope="col" className="px-2.5 py-1.5 font-medium">{t('toolUi.chart.category')}</th>
            {seriesNames.map((name, index) => (
              <th key={index} scope="col" className="px-2.5 py-1.5 text-right font-medium">{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, rowIndex) => (
            <tr key={rowIndex} className="border-t border-black/5 dark:border-white/5">
              <th scope="row" className="px-2.5 py-1.5 font-normal text-foreground">{label}</th>
              {series.map((entry, seriesIndex) => (
                <td key={seriesIndex} className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                  {format.value(entry.data[rowIndex] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartView({ chart }: { chart: ChartData }) {
  const { t } = useTranslation('chat');
  const format = useChartFormatters();
  const [tableOpen, setTableOpen] = useState(false);
  const { chartType, labels, series } = chart;

  const seriesNames = series.map((entry, index) => entry.name ?? t('toolUi.chart.seriesFallback', { index: index + 1 }));
  const isPie = chartType === 'pie';
  const pieIsDrawable = series.every((entry) => {
    const finite = entry.data.filter((value): value is number => value != null);
    return finite.every((value) => value >= 0) && finite.some((value) => value > 0);
  });

  let notice: string | null = null;
  if (chartType === 'unsupported') {
    notice = t('toolUi.chart.unsupportedType', { type: chart.requestedType ?? '' });
  } else if (isPie && !pieIsDrawable) {
    notice = t('toolUi.chart.pieInvalid');
  } else if (series.length > (isPie ? MAX_PIE_SMALL_MULTIPLES : MAX_SERIES) || (isPie && labels.length > MAX_PIE_SLICES)) {
    notice = t('toolUi.chart.tooMany');
  }

  const showTable = notice != null || tableOpen;
  const typeLabel = chartType === 'unsupported' ? '' : t(`toolUi.chart.types.${chartType}`);
  const ariaLabel = t('toolUi.chart.summary', { type: typeLabel, series: series.length, points: labels.length });

  return (
    <div className="chat-chart w-full" data-testid="chat-tool-ui-chart" data-chart-type={chartType}>
      {notice && (
        <p className="mb-1 text-xs text-amber-700 dark:text-amber-400" role="note" data-testid="chat-chart-notice">{notice}</p>
      )}

      {!notice && !isPie && chartType !== 'unsupported' && (
        <>
          {series.length === 1 && series[0]!.name && (
            <p className="mb-1 truncate text-xs text-muted-foreground">{series[0]!.name}</p>
          )}
          <CartesianChart
            chartType={chartType}
            labels={labels}
            series={series}
            seriesNames={seriesNames}
            ariaLabel={ariaLabel}
          />
          {series.length > 1 && (
            <ChartLegend
              shape={chartType === 'bar' ? 'rect' : 'line'}
              items={series.map((_, index) => ({ key: String(index), name: seriesNames[index]!, color: seriesColor(index) }))}
            />
          )}
        </>
      )}

      {!notice && isPie && (
        <>
          <div className="flex flex-wrap justify-center gap-4">
            {series.map((entry, index) => (
              <PieChart
                key={index}
                labels={labels}
                data={entry.data}
                title={series.length > 1 ? seriesNames[index] : undefined}
                ariaLabel={`${ariaLabel}: ${seriesNames[index]}`}
              />
            ))}
          </div>
          <ChartLegend
            shape="rect"
            items={labels.map((label, index) => {
              const total = series[0]!.data.reduce<number>((sum, value) => sum + (value ?? 0), 0);
              const value = series[0]!.data[index] ?? 0;
              return {
                key: String(index),
                name: label,
                color: seriesColor(index),
                // Direct values only when one pie owns the legend.
                detail: series.length === 1 ? format.percent(value / total) : undefined,
              };
            })}
          />
        </>
      )}

      {!notice && (
        <button
          type="button"
          className="mt-2 rounded text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={tableOpen}
          onClick={() => setTableOpen((value) => !value)}
          data-testid="chat-chart-table-toggle"
        >
          {tableOpen ? t('toolUi.chart.hideData') : t('toolUi.chart.showData')}
        </button>
      )}

      {showTable && <ChartDataTable labels={labels} series={series} seriesNames={seriesNames} />}
    </div>
  );
}
