/** Adapted from Rare UI Hook Sidebar. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Where a hook leaves its rail (`from`) and the row it turns into (`y`). */
type HookGeometry = { x: number; from: number; y: number };

/** Unscoped rows keep the original rail: hugging the list's left edge. */
const EDGE_RAIL_X = 2;
/** Corner radius of the turn into the row. */
const HOOK_RADIUS = 6;

function sameGeometry(left: HookGeometry | null, right: HookGeometry | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x && left.from === right.from && left.y === right.y;
}

/**
 * One command shape for every hook — move, drop, turn, run — so the motion
 * path can morph between any two of them as the selection travels.
 */
function hookPath(hook: HookGeometry | null, stub: number): string {
  const { x, from, y } = hook ?? { x: EDGE_RAIL_X, from: 0, y: HOOK_RADIUS };
  const turn = Math.max(0, y - HOOK_RADIUS);
  return `M${x} ${Math.min(from, turn)} V${turn} Q${x} ${y} ${x + HOOK_RADIUS} ${y} H${x + HOOK_RADIUS + stub}`;
}

/**
 * Adds the travelling hook to existing rows, retaining their actions and semantics.
 *
 * Rows opt in with `data-hook-key`. A row inside a `[data-hook-scope]` whose
 * header is marked `data-hook-origin` (the sidebar's project row) BRANCHES out
 * of that header: the line drops from under the header's leading icon and turns
 * into the row, so the current session reads as a branch of its project. Rows
 * without a scope keep the original rail down the list's left edge.
 * Groups with their own relationship connectors opt out with `data-hook-static`;
 * their enclosing project also avoids a rail crossing those controls.
 */
export function HookSidebar({ children, activeKey, className }: {
  children: ReactNode;
  activeKey?: string | null;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hoverKey = useRef<string | null>(null);
  const [position, setPosition] = useState<{ active: HookGeometry | null; hover: HookGeometry | null }>({ active: null, hover: null });
  const reduced = useReducedMotion();
  const measure = useCallback(() => {
    const container = root.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-hook-key]')];
    const visibleRows = rows.filter((row) => row.getBoundingClientRect().height > 0 && !row.closest('[aria-hidden="true"]'));
    const active = visibleRows.find((row) => row.dataset.hookKey === activeKey)
      ?? visibleRows.find((row) => row.dataset.hookSelected === 'true');
    const hovered = visibleRows.find((row) => row.dataset.hookKey === hoverKey.current);
    const geometry = (row?: HTMLElement): HookGeometry | null => {
      if (!row || row.closest('[data-hook-static]')) return null;
      const rect = row.getBoundingClientRect();
      const y = rect.top - box.top + row.offsetHeight / 2;
      const scope = row.closest<HTMLElement>('[data-hook-scope]');
      if (scope?.querySelector('[data-hook-static]')) return null;
      const origin = scope && container.contains(scope)
        ? scope.querySelector<HTMLElement>('[data-hook-origin]')
        : null;
      if (!scope || !origin || origin.contains(row)) return { x: EDGE_RAIL_X, from: 0, y };
      const icon = origin.querySelector('svg')?.getBoundingClientRect();
      const x = icon ? icon.left - box.left + icon.width / 2 : EDGE_RAIL_X;
      // The origin is a sticky header, so its own rect follows the scroll. The
      // scope it heads is not sticky: its top is where the header sits in flow.
      const from = scope.getBoundingClientRect().top - box.top + origin.offsetHeight + 2;
      return { x: Math.round(x * 2) / 2, from, y };
    };
    const next = { active: geometry(active), hover: geometry(hovered) };
    setPosition((previous) => (
      sameGeometry(previous.active, next.active) && sameGeometry(previous.hover, next.hover) ? previous : next
    ));
  }, [activeKey]);

  useLayoutEffect(() => { measure(); });
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    const mutation = new MutationObserver(measure);
    mutation.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hook-key', 'data-hook-selected', 'data-hook-static', 'aria-hidden'] });
    return () => { resize.disconnect(); mutation.disconnect(); };
  }, [measure]);

  const point = (event: React.SyntheticEvent) => {
    const row = (event.target as Element).closest<HTMLElement>('[data-hook-key]');
    const next = row?.dataset.hookKey ?? null;
    if (next === hoverKey.current) return;
    hoverKey.current = next;
    measure();
  };
  const clear = () => { hoverKey.current = null; measure(); };
  const showHover = position.hover != null && !sameGeometry(position.hover, position.active);
  // A hovered row on the selection's own rail branches off that rail: only the
  // stretch past the selection (if any) is drawn, never a dashed line traced
  // over the solid one. Rows on another rail (another project) drop from it.
  const sharesRail = position.hover != null && position.active != null
    && position.hover.x === position.active.x && position.hover.from === position.active.from;
  const ghost = sharesRail && position.hover && position.active
    ? { ...position.hover, from: position.active.y }
    : position.hover;
  const transition = { duration: reduced ? 0 : 0.18, ease: [0.2, 0.82, 0.25, 1] as const };

  return (
    <div ref={root} data-slot="hook-sidebar" className={cn('rare-hook-sidebar', className)}
      onPointerMove={point} onPointerLeave={clear} onFocusCapture={point}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) clear(); }}>
      <svg aria-hidden="true" className="rare-hook-sidebar__rail">
        <motion.path data-slot="hook-sidebar-hover" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3"
          strokeLinecap="round" className="rare-hook-sidebar__ghost" initial={false}
          animate={{ d: hookPath(ghost ?? position.active, 3), opacity: showHover ? 1 : 0 }}
          transition={transition} />
        <motion.path data-slot="hook-sidebar-active" fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round" className="rare-hook-sidebar__active" initial={false}
          animate={{ d: hookPath(position.active, 4), opacity: position.active == null ? 0 : 1 }}
          transition={transition} />
      </svg>
      {children}
    </div>
  );
}
