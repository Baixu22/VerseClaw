import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * Reusable sidebar row hover surface — official `.sidebar-item` recipe.
 *
 * Copied from the FakeCoding reference app
 * (FakeCoding-main/web/src/components/SidebarRow.tsx); only `clsx` was swapped
 * for ClawX's `cn`. Styles live in src/styles/codex-sidebar.css.
 *
 * LIVE CDP (2026-07-25, ChatGPT.exe/Codex sidebar):
 *   - rest: transparent; hover AND selected: `--token-list-hover-background`
 *     = rgba(255,255,255,0.08) — identical for project rows and thread rows
 *   - height 30px with the product navigation's restrained 8px radius
 *   - trailing actions fade in on row hover / focus-within
 *
 * Workspace rows and session rows must share this surface so their hover
 * treatment can never drift apart again; row-specific layout stays in the
 * consumer's own class (`task-row`, `project-row-wrap`).
 */
export type SidebarRowProps = {
  /** Persistent selected state — same flat 8% wash as hover (official). */
  selected?: boolean;
  /** Row-type specialization class, e.g. `task-row` / `project-row-wrap`. */
  className?: string;
  /** Trailing hover-revealed controls (pin/archive, ⋯/new-session…). */
  actions?: ReactNode;
  /** Extra class for the actions container (`task-hover-actions`, …). */
  actionsClassName?: string;
  rowRef?: Ref<HTMLDivElement>;
  hookKey?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className'>;

export function SidebarRow({
  selected,
  className,
  actions,
  actionsClassName,
  rowRef,
  hookKey,
  children,
  ...rest
}: SidebarRowProps) {
  return (
    <div ref={rowRef} data-hook-key={hookKey} data-hook-selected={selected ? 'true' : undefined} className={cn('sidebar-row', selected && 'selected', className)} {...rest}>
      {children}
      {actions != null && (
        <div className={cn('sidebar-row__actions', actionsClassName)}>{actions}</div>
      )}
    </div>
  );
}
