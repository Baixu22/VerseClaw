import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SketchBlock } from '@/components/loading/StructuralSketch';
import { cn } from '@/lib/utils';
import { getLoadingPolicy, type LoadingSurfaceId } from './loading-policy';
import { useDelayedVisibility, usePrefersReducedMotion } from './use-delayed-visibility';

const EXIT_MS = 180;
const MAX_REGIONS = 16;
const PAD = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';

type ProgressiveLoadingSurfaceProps = {
  surfaceId: LoadingSurfaceId;
  loading: boolean;
  label: string;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
};

type QuietLoadingSurfaceProps = {
  surfaceId: LoadingSurfaceId;
  loading: boolean;
  label: string;
  skeleton: ReactNode;
  children?: ReactNode;
  className?: string;
};

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function radiusOf(element: HTMLElement, width: number, height: number): number {
  const value = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
  return Number.isFinite(value) ? Math.min(value, width / 2, height / 2) : 0;
}

function buildOverlay(
  svg: SVGSVGElement,
  surface: HTMLElement,
  patternId: string,
  buildMs: number,
): void {
  const surfaceRect = surface.getBoundingClientRect();
  if (surfaceRect.width < 4 || surfaceRect.height < 4) return;
  const regions = Array.from(surface.querySelectorAll<HTMLElement>('[data-structural-region]'))
    .slice(0, MAX_REGIONS)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 4 && rect.height >= 4;
    });
  // Only a region this canvas actually outlines may hide its own border.
  surface.querySelectorAll<HTMLElement>('[data-structure-drawn]').forEach((element) => element.removeAttribute('data-structure-drawn'));
  regions.forEach((element) => element.setAttribute('data-structure-drawn', ''));

  svg.replaceChildren();
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${surfaceRect.width + PAD * 2} ${surfaceRect.height + PAD * 2}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.dataset.regionCount = String(regions.length);
  svg.dataset.bounds = `${Math.round(surfaceRect.width)}x${Math.round(surfaceRect.height)}`;
  svg.dataset.durationMs = String(Math.round(buildMs));

  const defs = svgElement('defs');
  const pattern = svgElement('pattern', {
    id: patternId,
    width: 14,
    height: 14,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.append(svgElement('circle', {
    class: 'progressive-loading-dot',
    cx: 1.2,
    cy: 1.2,
    r: 0.75,
  }));
  defs.append(pattern);
  svg.append(defs);

  const layer = svgElement('g', { class: 'progressive-loading-structure' });
  const drawMs = Math.max(320, buildMs * 0.6);
  const surfaceDiagonal = Math.max(1, surfaceRect.width + surfaceRect.height);
  regions.forEach((element, index) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left - surfaceRect.left;
    const y = rect.top - surfaceRect.top;
    const radius = radiusOf(element, rect.width, rect.height);
    // The outline wavefront travels from the surface's top-left corner.
    const delay = Math.round(Math.min(((x + y) / surfaceDiagonal) * buildMs * 0.45, buildMs * 0.45));
    const group = svgElement('g', {
      'data-structure-index': index,
      style: `--structure-delay:${delay}ms;--structure-duration:${Math.round(drawMs)}ms`,
    });
    group.append(
      svgElement('rect', {
        class: 'progressive-loading-region-fill',
        x,
        y,
        width: rect.width,
        height: rect.height,
        rx: radius,
      }),
      svgElement('rect', {
        class: 'progressive-loading-region-outline',
        x,
        y,
        width: rect.width,
        height: rect.height,
        rx: radius,
        pathLength: 1,
      }),
      svgElement('rect', {
        class: 'progressive-loading-region-dots',
        x,
        y,
        width: rect.width,
        height: rect.height,
        rx: radius,
        fill: `url(#${patternId})`,
      }),
    );

    const markerX = x + Math.min(12, rect.width / 2);
    const markerY = y + Math.min(12, rect.height / 2);
    group.append(svgElement('circle', {
      class: index === 0
        ? 'progressive-loading-marker progressive-loading-marker--primary'
        : 'progressive-loading-marker',
      cx: markerX,
      cy: markerY,
      r: index === 0 ? 2.4 : 1.7,
    }));

    if (index === 0 && rect.width > 240) {
      group.append(
        svgElement('path', {
          class: 'progressive-loading-ruler',
          d: `M ${x} ${Math.max(0, y - 7)} H ${x + rect.width}`,
        }),
      );
      const label = svgElement('text', {
        class: 'progressive-loading-label',
        x: x + rect.width / 2,
        y: Math.max(7, y - 11),
        'text-anchor': 'middle',
      });
      label.textContent = `${Math.round(rect.width)} px`;
      group.append(label);
    }

    layer.append(group);
  });
  svg.append(layer);
}

function StructuralOverlay({
  surfaceRef,
  surfaceId,
  buildMs,
  visible,
}: {
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  surfaceId: LoadingSurfaceId;
  buildMs: number;
  visible: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const patternId = `progressive-loading-dots-${useId().replace(/:/g, '')}`;

  useLayoutEffect(() => {
    if (!visible) return;
    const surface = surfaceRef.current;
    const svg = svgRef.current;
    if (!surface || !svg) return;

    let frame = 0;
    const rebuild = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        buildOverlay(svg, surface, patternId, buildMs);
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(rebuild);
    observer?.observe(surface);
    const mutation = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
        if (records.some((record) => !svg.contains(record.target))) rebuild();
      });
    mutation?.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    rebuild();

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutation?.disconnect();
    };
  }, [buildMs, patternId, surfaceId, surfaceRef, visible]);

  return (
    <svg
      ref={svgRef}
      className="progressive-loading-canvas"
      data-structural-canvas
      aria-hidden="true"
    />
  );
}

export function ProgressiveLoadingSurface({
  surfaceId,
  loading,
  label,
  skeleton,
  children,
  className,
}: ProgressiveLoadingSurfaceProps) {
  const policy = getLoadingPolicy(surfaceId);
  const skeletonRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const active = policy.strategy === 'structural' && loading;

  useEffect(() => {
    if (!active) {
      const timer = window.setTimeout(() => setShown(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setShown(true), policy.delayMs);
    return () => window.clearTimeout(timer);
  }, [active, policy.delayMs]);

  useEffect(() => {
    if (loading || !shown) return;
    const timer = window.setTimeout(() => setShown(false), reducedMotion ? 0 : EXIT_MS + 80);
    return () => window.clearTimeout(timer);
  }, [loading, reducedMotion, shown]);

  const leaving = shown && !loading;
  const renderLayer = loading || shown;

  return (
    <div
      className={cn('progressive-loading-surface', className)}
      data-structural-surface={surfaceId}
      data-state={leaving ? 'leaving' : shown ? 'visible' : 'idle'}
      aria-busy={loading || leaving}
    >
      {shown ? <span className="sr-only" role="status">{label}</span> : null}
      <div className="progressive-loading-grid">
        <div
          className="progressive-loading-content"
          data-content-state={!loading ? 'entering' : 'pending'}
        >
          {children}
        </div>
        {renderLayer ? (
          <div
            ref={skeletonRef}
            className="progressive-loading-skeleton"
            data-structural-skeleton
            data-state={leaving ? 'leaving' : shown ? 'visible' : 'pending'}
            aria-hidden={!shown}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && leaving) setShown(false);
            }}
          >
            {skeleton}
            {shown ? (
              <StructuralOverlay
                surfaceRef={skeletonRef}
                surfaceId={surfaceId}
                buildMs={policy.buildMs ?? 720}
                visible={!leaving}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function QuietLoadingSurface({
  surfaceId,
  loading,
  label,
  skeleton,
  children,
  className,
}: QuietLoadingSurfaceProps) {
  const policy = getLoadingPolicy(surfaceId);
  const visible = useDelayedVisibility(loading, policy.delayMs);

  return (
    <div
      className={cn('progressive-loading-surface', className)}
      data-quiet-surface={surfaceId}
      data-state={visible ? 'visible' : 'idle'}
      aria-busy={loading}
    >
      {visible ? <span className="sr-only" role="status">{label}</span> : null}
      <div className="progressive-loading-grid">
        <div className={cn('progressive-loading-content', loading && 'invisible')}>{children}</div>
        {loading ? (
          <div
            data-structural-sketch-root
            className={cn(
              'progressive-loading-skeleton progressive-loading-skeleton--quiet',
              !visible && 'invisible',
            )}
            aria-hidden={!visible}
          >
            {skeleton}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SkeletonRows({
  rows = 4,
  rowClassName,
  className,
}: {
  rows?: number;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)} data-testid="quiet-skeleton-rows">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            'rounded-xl border border-border/60 bg-surface-modal p-4',
            rowClassName,
          )}
        >
          <SketchBlock className="h-3 w-1/3" />
          <SketchBlock className="mt-3 h-3 w-4/5" />
          <SketchBlock className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}
