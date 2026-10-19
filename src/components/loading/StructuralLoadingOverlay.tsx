import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type StructuralPhase = 'frame' | 'nodes' | 'trace';

type Region = {
  line: SVGElement;
  fill: SVGElement;
  marker: SVGElement;
  start: number;
};

type StructuralLoadingOverlayProps = Omit<ComponentProps<'div'>, 'children'> & {
  children: ReactNode;
  loading?: boolean;
  label: string;
  regionSelector?: string;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 14;
const MAX_REGIONS = 16;
const HOLD_PHASES = [0.16, 0.28, 0.34] as const;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const span = (value: number, start: number, end: number) => clamp((value - start) / (end - start));
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function radiusOf(element: HTMLElement, width: number, height: number) {
  const value = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
  return Number.isFinite(value) ? Math.min(value, width / 2, height / 2) : 0;
}

function regionCandidates(root: HTMLElement, selector?: string) {
  if (selector) return Array.from(root.querySelectorAll<HTMLElement>(selector));
  const declared = Array.from(root.querySelectorAll<HTMLElement>('[data-structural-region]'));
  return declared.length > 0
    ? declared
    : Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
}

/**
 * Purely measured loading overlay. It never owns the success state: the caller
 * unmounts it only after the real data/module has resolved.
 */
export function StructuralLoadingOverlay({
  children,
  loading = true,
  label,
  regionSelector,
  className,
  ...props
}: StructuralLoadingOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const geometryFrameRef = useRef(0);
  const regionsRef = useRef<Region[]>([]);
  const phaseRef = useRef<StructuralPhase>('frame');
  const startedAtRef = useRef(0);
  const holdAtRef = useRef<number>(HOLD_PHASES[0]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !loading) return;
    const root = host.querySelector<HTMLElement>('[data-structural-root]') ?? host;
    const overlay = host.querySelector<HTMLElement>('.structural-loading-overlay') ?? null;
    const canvas = overlay?.querySelector<SVGSVGElement>('.structural-loading-canvas') ?? null;
    const dots = overlay?.querySelector<HTMLElement>('.structural-loading-dots') ?? null;
    const scan = overlay?.querySelector<HTMLElement>('.structural-loading-scan') ?? null;
    if (!overlay || !canvas || !dots || !scan) return;
    const hostElement = host;
    const overlayElement = overlay;
    const canvasElement = canvas;
    const dotsElement = dots;
    const scanElement = scan;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          if (records.some((record) => !overlayElement.contains(record.target))) queueGeometry();
        });
    mutationObserver?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => queueGeometry());
    resizeObserver?.observe(hostElement);
    resizeObserver?.observe(root);

    function queueGeometry() {
      cancelAnimationFrame(geometryFrameRef.current);
      geometryFrameRef.current = requestAnimationFrame(() => {
        if (!loading) return;
        measure();
      });
    }

    function measure() {
      const rootRect = root.getBoundingClientRect();
      const hostRect = hostElement.getBoundingClientRect();
      if (rootRect.width < 4 || rootRect.height < 4) return;
      const rootX = rootRect.left - hostRect.left;
      const rootY = rootRect.top - hostRect.top;
      canvasElement.style.left = `${rootX - PAD}px`;
      canvasElement.style.top = `${rootY - PAD}px`;
      canvasElement.style.width = `${rootRect.width + PAD * 2}px`;
      canvasElement.style.height = `${rootRect.height + PAD * 2}px`;
      canvasElement.setAttribute('viewBox', `${-PAD} ${-PAD} ${rootRect.width + PAD * 2} ${rootRect.height + PAD * 2}`);
      canvasElement.setAttribute('preserveAspectRatio', 'none');
      canvasElement.replaceChildren();
      dotsElement.style.left = `${rootX}px`;
      dotsElement.style.top = `${rootY}px`;
      dotsElement.style.width = `${rootRect.width}px`;
      dotsElement.style.height = `${rootRect.height}px`;
      dotsElement.style.borderRadius = `${radiusOf(root, rootRect.width, rootRect.height)}px`;

      const measureLayer = svgElement('g');
      measureLayer.dataset.layer = 'measure';
      const rootLine = svgElement('rect', {
        class: 'structural-loading-root',
        x: 0,
        y: 0,
        width: rootRect.width,
        height: rootRect.height,
        rx: radiusOf(root, rootRect.width, rootRect.height),
        pathLength: 1,
      });
      measureLayer.append(
        rootLine,
        svgElement('path', {
          class: 'structural-loading-ruler',
          d: `M 0 ${-8} H ${rootRect.width}`,
        }),
        svgElement('path', {
          class: 'structural-loading-ruler',
          d: `M ${-8} 0 V ${rootRect.height}`,
        }),
      );
      const widthText = svgElement('text', {
        x: rootRect.width / 2,
        y: -11,
        'text-anchor': 'middle',
        class: 'structural-loading-label',
      });
      widthText.textContent = `${Math.round(rootRect.width)} × ${Math.round(rootRect.height)}`;
      measureLayer.append(widthText);
      canvasElement.append(measureLayer);

      const regionLayer = svgElement('g');
      regionLayer.dataset.layer = 'regions';
      const regions: Region[] = [];
      const visible = regionCandidates(root, regionSelector)
        .slice(0, MAX_REGIONS)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width >= 4 && rect.height >= 4;
        });
      visible.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left - rootRect.left;
        const y = rect.top - rootRect.top;
        const radius = radiusOf(element, rect.width, rect.height);
        const fill = svgElement('rect', {
          class: 'structural-loading-fill',
          x,
          y,
          width: rect.width,
          height: rect.height,
          rx: radius,
        });
        fill.style.opacity = '0';
        const line = svgElement('rect', {
          class: 'structural-loading-region',
          x,
          y,
          width: rect.width,
          height: rect.height,
          rx: radius,
          pathLength: 1,
        });
        line.style.opacity = '0';
        const marker = svgElement('circle', {
          class: index === 0 ? 'structural-loading-marker structural-loading-marker--primary' : 'structural-loading-marker',
          cx: x + rect.width / 2,
          cy: y + rect.height / 2,
          r: index === 0 ? 2.2 : 1.6,
        });
        marker.style.opacity = '0';
        regionLayer.append(fill, line, marker);
        regions.push({
          fill,
          line,
          marker,
          start: 0.24 + index * 0.026,
        });
      });
      canvasElement.append(regionLayer);
      regionsRef.current = regions;
      overlayElement.dataset.regionCount = String(regions.length);
      overlayElement.dataset.bounds = `${Math.round(rootRect.width)}x${Math.round(rootRect.height)}`;

      if (reduceMotion) {
        render(1, false);
        overlayElement.dataset.phase = 'trace';
        phaseRef.current = 'trace';
        return;
      }
      if (startedAtRef.current === 0) startedAtRef.current = performance.now();
      render(currentProgress(performance.now()), true);
    }

    function currentProgress(now: number) {
      if (startedAtRef.current === 0) return 0;
      // The visual timeline saturates quickly, then waits without pretending to
      // know request progress. A late ready() starts a separate short reveal.
      return Math.min(holdAtRef.current, (now - startedAtRef.current) / 900 * holdAtRef.current);
    }

    function render(progress: number, animate: boolean) {
      const measureLayer = canvasElement.querySelector<SVGGElement>('[data-layer="measure"]');
      const regionLayer = canvasElement.querySelector<SVGGElement>('[data-layer="regions"]');
      if (!measureLayer || !regionLayer) return;
      const phase: StructuralPhase = progress < HOLD_PHASES[0] ? 'frame' : progress < HOLD_PHASES[1] ? 'nodes' : 'trace';
      phaseRef.current = phase;
      overlayElement.dataset.phase = phase;
      measureLayer.style.opacity = String(animate ? 1 - span(progress, 0.14, 0.28) : 1);
      dotsElement.style.opacity = String(animate ? 0.42 * easeOutCubic(span(progress, 0.03, 0.2)) : 0.3);
      const scanValue = animate ? span(progress, 0.06, 0.22) : 1;
      scanElement.style.opacity = String(scanValue > 0 && scanValue < 1 ? 0.8 * Math.sin(Math.PI * scanValue) : 0);
      scanElement.style.transform = `translateY(${Math.round(root.getBoundingClientRect().height * scanValue)}px)`;
      regionLayer.style.opacity = '1';
      regionsRef.current.forEach(({ line, fill, marker, start }) => {
        const draw = easeOutCubic(span(progress, start, start + 0.1));
        line.style.strokeDashoffset = String(animate ? 1 - draw : 0);
        line.style.opacity = '0.85';
        fill.style.opacity = '0.1';
        marker.style.opacity = String(animate ? draw : 1);
      });
    }

    function tick(now: number) {
      if (!loading) return;
      const progress = currentProgress(now);
      render(progress, true);
      if (progress >= holdAtRef.current - 0.0001) {
        overlayElement.dataset.waiting = 'true';
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    }
    if (reduceMotion) {
      measure();
    } else {
      measure();
      tick(performance.now());
    }

    return () => {
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(geometryFrameRef.current);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      regionsRef.current = [];
      startedAtRef.current = 0;
    };
  }, [loading, regionSelector]);

  return (
    <div
      ref={hostRef}
      data-testid="structural-loading-overlay"
      data-state={loading ? 'loading' : 'ready'}
      data-phase={phaseRef.current}
      aria-busy={loading}
      aria-label={label}
      className={cn('relative isolate', className)}
      {...props}
    >
      <div data-structural-root className="relative isolate min-h-full">
        {loading ? (
          <div className="structural-loading-overlay" aria-hidden="true">
            <div className="structural-loading-dots" />
            <div className="structural-loading-scan" />
            <svg className="structural-loading-canvas" aria-hidden="true" />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}


