/** Adapted from Rare UI Hook Sidebar. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Adds the travelling hook to existing rows, retaining their actions and semantics. */
export function HookSidebar({ children, activeKey, className }: {
  children: ReactNode;
  activeKey?: string | null;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hoverKey = useRef<string | null>(null);
  const [position, setPosition] = useState<{ active: number | null; hover: number | null }>({ active: null, hover: null });
  const reduced = useReducedMotion();
  const measure = useCallback(() => {
    const container = root.current;
    if (!container) return;
    const rows = [...container.querySelectorAll<HTMLElement>('[data-hook-key]')];
    const visibleRows = rows.filter((row) => row.getBoundingClientRect().height > 0 && !row.closest('[aria-hidden="true"]'));
    const active = visibleRows.find((row) => row.dataset.hookKey === activeKey)
      ?? visibleRows.find((row) => row.dataset.hookSelected === 'true');
    const hovered = visibleRows.find((row) => row.dataset.hookKey === hoverKey.current);
    const center = (row?: HTMLElement) => row ? row.getBoundingClientRect().top - container.getBoundingClientRect().top + row.offsetHeight / 2 : null;
    const next = { active: center(active), hover: center(hovered) };
    setPosition((previous) => previous.active === next.active && previous.hover === next.hover ? previous : next);
  }, [activeKey]);

  useLayoutEffect(() => { measure(); });
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    const mutation = new MutationObserver(measure);
    mutation.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hook-key', 'data-hook-selected', 'aria-hidden'] });
    return () => { resize.disconnect(); mutation.disconnect(); };
  }, [measure]);

  const point = (event: React.SyntheticEvent) => {
    const row = (event.target as Element).closest<HTMLElement>('[data-hook-key]');
    hoverKey.current = row?.dataset.hookKey ?? null;
    measure();
  };
  const clear = () => { hoverKey.current = null; measure(); };
  const rail = (y: number | null, from: number) => `M2 ${Math.min(from, Math.max(0, (y ?? 6) - 6))} V${Math.max(0, (y ?? 6) - 6)} Q2 ${y ?? 6} 8 ${y ?? 6} H13`;

  return (
    <div ref={root} data-slot="hook-sidebar" className={cn('rare-hook-sidebar', className)}
      onPointerMove={point} onPointerLeave={clear} onFocusCapture={point}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) clear(); }}>
      <svg aria-hidden="true" className="rare-hook-sidebar__rail">
        <motion.path fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3"
          className="text-foreground/25" initial={false}
          animate={{ d: rail(position.hover, position.active ?? 0), opacity: position.hover != null && position.hover !== position.active ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }} />
        <motion.path data-slot="hook-sidebar-active" fill="none" stroke="currentColor" strokeWidth="1.3"
          className="text-foreground/65" initial={false}
          animate={{ d: rail(position.active, 0), opacity: position.active == null ? 0 : 1 }}
          transition={{ duration: reduced ? 0 : 0.16 }} />
      </svg>
      {children}
    </div>
  );
}
