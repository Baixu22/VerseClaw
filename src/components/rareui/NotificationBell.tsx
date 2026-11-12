/** Adapted from Rare UI Notification Bell. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { forwardRef, useEffect, useRef, type ComponentProps } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Badge colour = the most severe unread entry. */
export type NotificationBellTone = 'neutral' | 'warning' | 'error';
/** Runtime activity: a swinging bell while running, an amber marker while waiting. */
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
    const expanded = props['aria-expanded'] === true || props['aria-expanded'] === 'true';
    useEffect(() => {
      const grew = total > previous.current;
      const startedWaiting = live === 'waiting' && previousLive.current !== 'waiting';
      previous.current = total;
      previousLive.current = live;
      swing.set(0);
      if (reduced || expanded) return;
      const running = live === 'running';
      if (!running && !grew && !startedWaiting) return;
      const animation = animate(swing, [0, -12, 10, -5, 0], {
        duration: 0.6,
        ease: 'easeInOut',
        repeat: running ? Infinity : 0,
        repeatDelay: 1.2,
      });
      return () => { animation.stop(); swing.set(0); };
    }, [total, live, reduced, expanded, swing]);
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
        <motion.svg data-testid="chat-activity-bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true" style={{ rotate: swing, transformOrigin: '50% 10%' }}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </motion.svg>
        {live === 'waiting' && total === 0 && (
          <span aria-hidden="true" data-testid="chat-activity-waiting" className="rare-notification-bell__waiting" />
        )}
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
