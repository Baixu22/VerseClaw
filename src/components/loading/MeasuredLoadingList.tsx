import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { getLoadingPolicy, type LoadingSurfaceId } from './loading-policy';
import { usePrefersReducedMotion } from './use-delayed-visibility';

const GROUP_MS = 220;
const TRACE_MS = 340;
const ROW_STAGGER_MS = 80;
// The sketch radiates from the card's top-left corner: the wavefront is the
// normalized diagonal distance, so nothing starts before the corner it grew from.
const WAVE_MS = 320;
const WAVE_BASE_MS = 60;
type Bounds = { x: number; y: number; width: number; height: number; radius: number };
type Part = Bounds & { name: string; shape?: string };
type Geometry = { width: number; height: number; radius: number; parts: Part[]; chips: Bounds[]; actions: Bounds[]; status?: Bounds };
type TraceVars = CSSProperties & { '--trace-delay': string; '--trace-duration': string };

function traceStyle(delay: number, duration = TRACE_MS): TraceVars {
  return { '--trace-delay': `${delay}ms`, '--trace-duration': `${duration}ms` };
}

/** Diagonal wavefront from the top-left corner, in milliseconds. */
function wave(box: { x: number; y: number }, width: number, height: number, span = WAVE_MS): number {
  const diagonal = Math.max(1, width + height);
  return Math.round(((Math.max(0, box.x) + Math.max(0, box.y)) / diagonal) * span);
}

function ComponentConstruction({ rootRef, resolved, active }: { rootRef: RefObject<HTMLDivElement | null>; resolved: boolean; active: boolean }) {
  const id = useId().replace(/:/g, '');
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const card = root?.querySelector<HTMLElement>('[data-build-root]');
    if (!root || !card) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const origin = root.getBoundingClientRect();
        if (origin.width < 4 || origin.height < 4) return;
        const bounds = (element: Element): Bounds => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left - origin.left, y: rect.top - origin.top,
            width: rect.width, height: rect.height,
            radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
          };
        };
        const status = card.querySelector('[data-build-status]');
        setGeometry({
          width: origin.width, height: origin.height, radius: bounds(card).radius,
          parts: Array.from(card.querySelectorAll<HTMLElement>('[data-build-part]')).map((part) => ({
            ...bounds(part), name: part.dataset.buildPart!, shape: part.dataset.buildShape,
          })).filter((part) => part.width > 0 && part.height > 0),
          chips: Array.from(card.querySelectorAll('[data-build-chip]')).map(bounds),
          actions: Array.from(card.querySelectorAll('[data-build-action]')).map(bounds),
          status: status ? bounds(status) : undefined,
        });
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    card.querySelectorAll('[data-build-part]').forEach((part) => observer?.observe(part));
    measure();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [resolved, rootRef]);

  if (!geometry) return null;
  const { width, height, radius, parts, chips, actions, status } = geometry;
  const icon = parts.find((part) => part.name === 'icon');
  const title = parts.find((part) => part.name === 'title');
  const action = parts.find((part) => part.name === 'actions');
  if (!icon || !title) return null;
  const baseline = title.y + title.height / 2;
  const rect = (box: Bounds, delay: number, duration = TRACE_MS) => <rect className="component-construction-trace" pathLength="1" style={traceStyle(delay, duration)} x={box.x} y={box.y} width={box.width} height={box.height} rx={Math.min(box.radius, box.height / 2, box.width / 2)} />;
  const corners = (box: Bounds, delay: number) => <path className="component-construction-trace" pathLength="1" style={traceStyle(delay, 220)} d={`M${box.x},${box.y + 4}v-4h4 M${box.x + box.width - 4},${box.y}h4v4 M${box.x + box.width},${box.y + box.height - 4}v4h-4 M${box.x + 4},${box.y + box.height}h-4v-4`} />;
  // A solid tracing mask reveals the dashed line without changing its dash rhythm.
  const tracedPath = (d: string, className: string, key: string, delay: number, duration = TRACE_MS) => (
    <g style={traceStyle(delay, duration)}>
      <defs>
        <mask id={`build-trace-${id}-${key}`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <path className="component-construction-trace" pathLength="1" d={d} fill="none" stroke="white" strokeWidth="3" />
        </mask>
      </defs>
      <path className={className} d={d} mask={`url(#build-trace-${id}-${key})`} />
    </g>
  );
  const guides = [
    { key: 'ticks-top', box: { x: 17, y: 5 }, d: `M17,11V5 M${width - 17},11V5` },
    { key: 'ruler-top', box: { x: 17, y: 8 }, d: `M17,8H${width - 17}` },
    { key: 'ticks-left', box: { x: 5, y: 17 }, d: `M11,17H5 M11,${height - 17}H5` },
    { key: 'ruler-left', box: { x: 8, y: 17 }, d: `M8,17V${height - 17}` },
    { key: 'divider', box: { x: icon.x + icon.width + 8, y: 17 }, d: `M${icon.x + icon.width + 8},17V${height - 17}` },
    { key: 'baseline', box: { x: title.x, y: baseline }, d: `M${title.x},${baseline}H${action ? action.x + action.width : width - 17}` },
  ];

  return (
    <svg className="component-construction" data-structural-canvas data-region-count={parts.length} data-bounds={`${Math.round(width)}x${Math.round(height)}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <pattern id={`build-dots-${id}`} width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" className="component-construction-dot" /></pattern>
        <clipPath id={`build-clip-${id}`}><rect x="1" y="1" width={width - 2} height={height - 2} rx={radius} /></clipPath>
      </defs>
      <g clipPath={`url(#build-clip-${id})`}>
        <g className="component-construction-field">
          <rect className="component-construction-dots" x="1" y="1" width={width - 2} height={height - 2} rx={radius} fill={`url(#build-dots-${id})`} />
          <rect className="component-construction-frame" x="0.7" y="0.7" width={width - 1.4} height={height - 1.4} rx={radius} pathLength="1" />
          {guides.map((guide) => tracedPath(guide.d, 'component-construction-guide', guide.key, wave(guide.box, width, height, 220), 300))}
          <g className="component-construction-label" style={traceStyle(480, 220)}>
            <text x={width / 2} y="11" textAnchor="middle">{Math.round(width)} × {Math.round(height)}</text>
            <text x="10" y={height / 2} textAnchor="middle" transform={`rotate(-90 10 ${height / 2})`}>{Math.round(height)}</text>
          </g>
          <g className="component-construction-node" style={traceStyle(360, 220)}>
            {[{ x: 17, y: 3 }, { x: width - 17, y: 3 }, { x: 17, y: height - 3 }, { x: width - 17, y: height - 3 }].map((point, index) => <rect key={index} x={point.x - 2} y={point.y - 2} width="4" height="4" />)}
          </g>
        </g>
        {parts.map((part) => {
          const start = wave(part, width, height) + WAVE_BASE_MS;
          return (
            <g key={part.name} className="component-construction-part" data-build-part={part.name}>
              {part.name === 'icon' || part.shape === 'box' ? (
                <g className="component-construction-outline">{rect(part, start)}</g>
              ) : part.name === 'meta' ? (
                chips.length ? <g className="component-construction-outline">{chips.map((chip, index) => <g key={index}>{rect(chip, wave(chip, width, height) + WAVE_BASE_MS)}</g>)}</g> : tracedPath(`M${part.x},${part.y + part.height / 2}H${part.x + part.width}`, 'component-construction-text-line', part.name, start)
              ) : part.name === 'actions' ? (
                <g className="component-construction-outline">{actions.length ? actions.map((box, index) => <g key={index}>{rect(box, wave(box, width, height) + WAVE_BASE_MS)}</g>) : rect(part, start)}</g>
              ) : (
                tracedPath(`M${part.x},${part.y + part.height / 2}H${part.x + part.width}`, 'component-construction-text-line', part.name, start)
              )}
              {part.name === 'icon' && (
                <>
                  {tracedPath(`M${part.x},${part.y + part.height + 5}h${part.width} M${part.x},${part.y + part.height + 2}v6 M${part.x + part.width},${part.y + part.height + 2}v6`, 'component-construction-guide', 'icon-ruler', start + 140, 260)}
                  <text className="component-construction-label" style={traceStyle(start + 200, 260)} x={part.x + part.width / 2} y={part.y + part.height + 16} textAnchor="middle">{Math.round(part.width)} × {Math.round(part.height)}</text>
                </>
              )}
              {part.name === 'title' && status && <g className="component-construction-outline">{rect(status, wave(status, width, height) + WAVE_BASE_MS)}</g>}
              {['icon', 'title', 'actions'].includes(part.name) && <g className="component-construction-node">{corners(part, start + TRACE_MS + 60)}</g>}
              {part.name === 'detail' && <g className="component-construction-node" style={traceStyle(start + TRACE_MS + 60)}><circle cx={part.x} cy={part.y + part.height / 2} r="1.8" /><circle cx={part.x + part.width} cy={part.y + part.height / 2} r="1.8" /></g>}
            </g>
          );
        })}
        {active && <circle className="component-construction-active" cx={title.x + title.width} cy={baseline} r="2.4" />}
      </g>
    </svg>
  );
}

function LoadingRow({ children, skeleton, state, active, showStructure, index }: { children?: ReactNode; skeleton?: ReactNode; state: 'pending' | 'revealing' | 'complete'; active: boolean; showStructure: boolean; index: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={rootRef}
      className="component-build-row"
      data-build-state={state}
      style={{ '--build-row-delay': `${Math.min(index, 5) * ROW_STAGGER_MS}ms` } as CSSProperties}
    >
      {children ? <div className="component-build-content" inert={state === 'pending'}>{children}</div> : skeleton}
      {showStructure && state !== 'complete' && <ComponentConstruction rootRef={rootRef} resolved={!!children} active={active} />}
    </div>
  );
}

export function MeasuredLoadingList({ loading, label, rows, skeletonRows, surfaceId, className, listClassName = 'space-y-3', emptyState }: {
  loading: boolean;
  label: string;
  rows: ReactNode[];
  skeletonRows: ReactNode[];
  surfaceId: LoadingSurfaceId;
  className?: string;
  listClassName?: string;
  emptyState?: ReactNode;
}) {
  const policy = getLoadingPolicy(surfaceId);
  const reducedMotion = usePrefersReducedMotion();
  const [shown, setShown] = useState(false);
  const [group, setGroup] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => { setShown(true); setGroup(0); }, policy.delayMs);
    return () => window.clearTimeout(timer);
  }, [loading, policy.delayMs]);

  useEffect(() => {
    if (loading || !shown) return;
    if (reducedMotion || rows.length === 0) {
      const timer = window.setTimeout(() => setShown(false), 0);
      return () => window.clearTimeout(timer);
    }
    const groupCount = Math.min(3, rows.length);
    const timers = Array.from({ length: groupCount }, (_, index) => window.setTimeout(() => setGroup(index + 1), index * GROUP_MS));
    timers.push(window.setTimeout(() => { setShown(false); setGroup(0); }, groupCount * GROUP_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [loading, reducedMotion, rows.length, shown]);

  const constructing = shown && (loading || (!reducedMotion && rows.length > 0));
  const currentGroup = !loading && constructing ? Math.max(1, group) : 0;
  const groupCount = Math.min(3, rows.length);
  const firstPendingIndex = rows.length ? Math.ceil(currentGroup * rows.length / groupCount) : 0;

  return (
    <div className={cn('progressive-loading-surface measured-loading-surface', className)} data-structural-surface={surfaceId} data-state={constructing ? loading ? 'visible' : 'partial' : 'idle'} data-reveal-group={currentGroup} aria-busy={loading}>
      {loading && shown && <span className="sr-only" role="status">{label}</span>}
      {!loading && rows.length === 0 ? emptyState : (
        <div className={cn(listClassName, loading && !shown && 'invisible progressive-loading-hold')}>
          {(loading ? skeletonRows : rows).map((row, index) => {
            const rowGroup = Math.floor(index * groupCount / rows.length) + 1;
            const state = loading ? 'pending' : !constructing || rowGroup < currentGroup ? 'complete' : rowGroup === currentGroup ? 'revealing' : 'pending';
            return <LoadingRow key={index} index={index} skeleton={loading ? row : undefined} state={state} active={shown && index === firstPendingIndex} showStructure={constructing}>{!loading ? row : undefined}</LoadingRow>;
          })}
        </div>
      )}
    </div>
  );
}
