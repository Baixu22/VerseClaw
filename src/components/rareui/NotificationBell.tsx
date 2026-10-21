/** Adapted from Rare UI Notification Bell. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { forwardRef, useEffect, useRef, type ComponentProps } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

export const NotificationBell = forwardRef<HTMLButtonElement, ComponentProps<'button'> & { count: number }>(
  function NotificationBell({ count, className, ...props }, ref) {
    const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const previous = useRef(total);
    const swing = useMotionValue(0);
    const reduced = useReducedMotion();
    useEffect(() => {
      const changed = total > previous.current;
      previous.current = total;
      if (!changed || reduced) return;
      const animation = animate(swing, [0, -16, 12, -5, 0], { duration: 0.48 });
      return () => animation.stop();
    }, [total, reduced, swing]);
    return (
      <button ref={ref} type="button" {...props} data-slot="notification-bell" className={cn('rare-notification-bell', className)}>
        <motion.svg viewBox="0 0 18 18" fill="currentColor" width="18" height="18" aria-hidden="true" style={{ rotate: swing, transformOrigin: '50% 12%' }}>
          <path fillOpacity=".65" d="M3.5 6.5C3.5 3.46 5.96 1 9 1s5.5 2.46 5.5 5.5v4.25c0 .69.56 1.25 1.25 1.25a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1 0-1.5c.69 0 1.25-.56 1.25-1.25V6.5Z" />
          <path d="M6.5 14.5h5a2.5 2.5 0 0 1-5 0Z" />
        </motion.svg>
        <AnimatePresence initial={false}>
          {total > 0 && <motion.span key={total} aria-hidden="true" className="rare-notification-bell__count"
            initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
            {total > 99 ? '99+' : total}
          </motion.span>}
        </AnimatePresence>
      </button>
    );
  },
);
