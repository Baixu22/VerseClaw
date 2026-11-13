/** Adapted from Rare UI Notification Bell. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { forwardRef, type ComponentProps } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { cn } from '@/lib/utils';

/** Badge colour = the most severe unread entry. */
export type NotificationBellTone = 'neutral' | 'warning' | 'error';
/** Runtime activity, drawn with the same status glyph as the session rows. */
export type NotificationBellLive = 'idle' | 'running' | 'waiting';

/**
 * The activity control speaks the session list's language: while a
 * conversation runs (or waits for you) the bell gives way to the very orb that
 * conversation's row shows, so "something is running" never has a second,
 * private vocabulary (a swinging icon, a corner dot). At rest it is a quiet
 * bell, and unread activity is a small count in the corner.
 */
export const NotificationBell = forwardRef<HTMLButtonElement, ComponentProps<'button'> & {
  count: number;
  tone?: NotificationBellTone;
  live?: NotificationBellLive;
  /** Accessible name of the live orb (the row status label). */
  liveLabel?: string;
}>(
  function NotificationBell({ count, tone = 'neutral', live = 'idle', liveLabel, className, ...props }, ref) {
    const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const reduced = useReducedMotion();
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
        {live === 'idle' ? (
          <svg data-testid="chat-activity-bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        ) : (
          <OrbStatus
            data-testid="chat-activity-live-orb"
            state={live === 'waiting' ? 'waiting' : 'streaming'}
            label={liveLabel ?? live}
            className="rare-notification-bell__orb size-4"
          />
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
