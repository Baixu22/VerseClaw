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
        <motion.svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true" style={{ rotate: swing, transformOrigin: '50% 10%' }}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </motion.svg>
        <AnimatePresence initial={false}>
          {total > 0 && <motion.span key="unread" data-testid="chat-completion-unread-dot" aria-hidden="true" className="rare-notification-bell__count"
            initial={reduced ? false : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} />}
        </AnimatePresence>
      </button>
    );
  },
);
