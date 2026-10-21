/** Adapted from Rare UI Delete Button. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { useState, type ComponentProps } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** The caller owns confirmation and effects; this trigger never claims deletion. */
export function DeleteButton({ className, open = false, ...props }: ComponentProps<'button'> & { open?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const reduced = useReducedMotion();
  return (
    <button type="button" {...props} data-slot="delete-button" data-state={open ? 'open' : 'closed'}
      className={cn('rare-delete-button', className)}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocus={(event) => { setHovered(true); props.onFocus?.(event); }}
      onBlur={(event) => { setHovered(false); props.onBlur?.(event); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <motion.g initial={false} animate={{ rotate: (open || hovered) && !reduced ? -30 : 0 }} style={{ transformOrigin: '4px 7px' }} transition={{ duration: 0.16 }}>
          <path d="M3 7h18M9 7V4h6v3" />
        </motion.g>
        <path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}
