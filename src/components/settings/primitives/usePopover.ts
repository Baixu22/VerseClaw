/**
 * Popover positioning hook — ported verbatim (behaviour-wise) from
 *   FakeCoding-main/web/src/components/settings/usePopover.ts
 *
 * Renders the floating layer via portal to document.body so it is never
 * clipped by an ancestor's `overflow: hidden` (in ClawX that is
 * .codex-settings-page__surface / __panel / __scroll and .sp-card).
 *
 * Anchors the layer to a trigger ref using fixed positioning, with vertical
 * auto-flip when there isn't enough room below, and repositions on scroll /
 * resize / content mutation. `align="right"` keeps the layer's right edge
 * aligned with the trigger's right edge (matches the official dropdown).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export type PopoverPlacement = 'bottom' | 'top';

export function usePopover<T extends HTMLElement>({
  align = 'right',
  gap = 2,
  minWidth = 0,
  fixedWidth = 0,
}: {
  align?: 'left' | 'right';
  gap?: number;
  minWidth?: number;
  fixedWidth?: number;
} = {}) {
  const triggerRef = useRef<T | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  const [placement, setPlacement] = useState<PopoverPlacement>('bottom');

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    const layer = layerRef.current;
    if (!trigger || !layer) return;
    const r = trigger.getBoundingClientRect();
    const lw = fixedWidth || layer.offsetWidth;
    const lh = layer.offsetHeight;
    const vh = window.innerHeight;
    const vw = document.documentElement.clientWidth;
    const margin = 8;

    // vertical: prefer bottom, flip to top if not enough room
    let top = r.bottom + gap;
    let next: PopoverPlacement = 'bottom';
    if (top + lh + margin > vh && r.top - gap - lh - margin >= 0) {
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
      width: fixedWidth || undefined,
      minWidth: minWidth || undefined,
      zIndex: 1000,
      visibility: 'visible',
    });
  }, [align, fixedWidth, gap, minWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    const onResize = () => measure();
    const ro = new ResizeObserver(() => measure());
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    if (triggerRef.current) ro.observe(triggerRef.current);
    if (layerRef.current) ro.observe(layerRef.current);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
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
  refs,
}: {
  open: boolean;
  onDismiss: () => void;
  refs: Array<{ current: HTMLElement | null }>;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      dismissRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
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
