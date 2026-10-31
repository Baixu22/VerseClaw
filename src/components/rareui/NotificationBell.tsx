/** Adapted from Rare UI Notification Bell. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { forwardRef, useEffect, useRef, type ComponentProps } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Badge colour = the most severe unread entry. */
export type NotificationBellTone = 'neutral' | 'warning' | 'error';
/**
 * Live ring around the bell, from real session state: a blue comet while any
 * session runs, a steady amber ring while one is waiting on the user.
 */
export type NotificationBellLive = 'idle' | 'running' | 'waiting';

export const NotificationBell = forwardRef<HTMLButtonElement, ComponentProps<'button'> & {
  count: number;
  tone?: NotificationBellTone;
  live?: NotificationBellLive;
}>(
  function NotificationBell({ count, tone = 'neutral', live = 'idle', className, ...props }, ref) {
    const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const previous = useRef(total);
    const previousLive = useRef(live);
    const swing = useMotionValue(0);
    const reduced = useReducedMotion();
    useEffect(() => {
      // Ring once for a new unread entry, or when a session starts waiting on
      // the user — the two moments that actually ask for attention.
      const grew = total > previous.current;
      const startedWaiting = live === 'waiting' && previousLive.current !== 'waiting';
      previous.current = total;
      previousLive.current = live;
      if ((!grew && !startedWaiting) || reduced) return;
      const animation = animate(swing, [0, -16, 12, -5, 0], { duration: 0.48 });
      return () => animation.stop();
    }, [total, live, reduced, swing]);
    const badge = total > 9 ? '9+' : String(total);
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        data-slot="notification-bell"
        data-live={live}
        data-tone={tone}
        className={cn('rare-notification-bell', className)}
      >
        {live !== 'idle' && (
          <span aria-hidden="true" data-testid="chat-activity-live-ring" className="rare-notification-bell__live" />
        )}
        <motion.svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true" style={{ rotate: swing, transformOrigin: '50% 10%' }}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </motion.svg>
        <AnimatePresence initial={false}>
          {total > 0 && (
            <motion.span
              key="unread"
              data-testid="chat-completion-unread-dot"
              aria-hidden="true"
              className="rare-notification-bell__count"
              initial={reduced ? false : { opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.16 }}
            >
              {/* Keyed so a changed count rolls in instead of swapping in place. */}
              <span key={badge} className="rare-notification-bell__count-digit">{badge}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    );
  },
);
