/**
 * Popover positioning hook — ported verbatim (behaviour-wise) from
 *   FakeCoding-main/web/src/components/settings/usePopover.ts
 *
 * Positions a floating layer rendered in the app overlay host so scrollable
 * ancestors cannot clip it. Uses fixed positioning, vertical auto-flip and
 * remeasures on scroll, resize and content changes. `align="right"` keeps the
 * layer's right edge aligned with its trigger.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export type PopoverPlacement = 'bottom' | 'top';

export function usePopover<T extends HTMLElement>({
  align = 'right',
  gap = 2,
  minWidth = 0,
  fixedWidth = 0,
  fitViewport = false,
  preferredSide = 'bottom',
}: {
  align?: 'left' | 'right';
  gap?: number;
  minWidth?: number;
  fixedWidth?: number;
  fitViewport?: boolean;
  preferredSide?: PopoverPlacement;
} = {}) {
  const triggerRef = useRef<T | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 'auto',
    right: 'auto',
    visibility: 'hidden',
  });
  const [placement, setPlacement] = useState<PopoverPlacement>('bottom');

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    const layer = layerRef.current;
    if (!trigger || !layer) return;
    const r = trigger.getBoundingClientRect();
    const lw = fixedWidth || layer.offsetWidth;
    const borderY = Math.max(0, layer.offsetHeight - layer.clientHeight);
    const lh = fitViewport ? Math.max(layer.scrollHeight + borderY, layer.offsetHeight) : layer.offsetHeight;
    const vh = window.innerHeight;
    const vw = document.documentElement.clientWidth;
    const margin = 8;
    const availableBelow = Math.max(0, vh - r.bottom - gap - margin);
    const availableAbove = Math.max(0, r.top - gap - margin);

    // Prefer the side that shows the whole menu; constrain it only when neither side fits.
    let top = r.bottom + gap;
    let next: PopoverPlacement = 'bottom';
    let maxHeight: number | undefined;
    if (fitViewport) {
      if ((preferredSide === 'top' && (lh <= availableAbove || availableAbove > availableBelow))
        || (lh > availableBelow && (lh <= availableAbove || availableAbove > availableBelow))) {
        next = 'top';
        if (lh > availableAbove) {
          const clamped = Math.floor(availableAbove);
          top = r.top - gap - clamped;
          maxHeight = clamped;
        } else {
          top = r.top - gap - lh;
        }
      } else if (lh > availableBelow) {
        maxHeight = Math.floor(availableBelow);
      }
    } else if (top + lh + margin > vh && r.top - gap - lh - margin >= 0) {
      top = r.top - gap - lh;
      next = 'top';
    }
    setPlacement(next);

    // horizontal
    let left: number;
    if (align === 'right') {
      left = r.right - lw;
      if (left + lw + margin > vw) left = vw - lw - margin;
      if (left < margin) left = margin;
    } else {
      left = r.left;
      if (left + lw + margin > vw) left = vw - lw - margin;
      if (left < margin) left = margin;
    }

    setStyle({
      position: 'fixed',
      top: Math.round(top),
      left: Math.round(left),
      bottom: 'auto',
      right: 'auto',
      width: fixedWidth || undefined,
      minWidth: minWidth || undefined,
      maxHeight,
      zIndex: 1000,
      visibility: 'visible',
    });
  }, [align, fitViewport, fixedWidth, gap, minWidth, preferredSide]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    const onResize = () => measure();
    const ro = new ResizeObserver(() => measure());
    const mo = new MutationObserver(() => measure());
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    if (triggerRef.current) ro.observe(triggerRef.current);
    if (layerRef.current) {
      ro.observe(layerRef.current);
      mo.observe(layerRef.current, { childList: true, subtree: true });
    }
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      mo.disconnect();
    };
  }, [open, measure]);

  return { triggerRef, layerRef, open, setOpen, style, placement };
}

/**
 * Dismiss-on-outside-click / Escape wiring. The source repeated this effect
 * inside every control; it is factored out here so each control cannot drift.
 */
export function useDismissOnOutside({
  open,
  onDismiss,
  onEscape,
  refs,
}: {
  open: boolean;
  onDismiss: () => void;
  onEscape?: () => void;
  refs: Array<{ current: HTMLElement | null }>;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      dismissRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (escapeRef.current) escapeRef.current();
        else dismissRef.current();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...refs]);
}
