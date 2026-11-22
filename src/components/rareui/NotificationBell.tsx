/** Adapted from Rare UI Notification Bell. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { forwardRef, type ComponentProps } from 'react';
import { Bell } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { OrbStatus, type OrbStatusState } from '@/components/assistant-ui/orb-status';
import { cn } from '@/lib/utils';

/** Badge colour = the most severe unread entry. */
export type NotificationBellTone = 'neutral' | 'warning' | 'error';
/** Runtime activity, drawn with the same status glyph as the session rows. */
export type NotificationBellLive = 'idle' | 'running' | 'waiting';
export type NotificationBellAttention = 'waiting' | 'success' | 'error';

/**
 * The activity control speaks the session list's language: active runs reuse
 * the row's animated status, idle unread activity shows its latest settled
 * status, and a read feed returns to the quiet bell. The corner badge counts
 * unread entries.
 */
export const NotificationBell = forwardRef<HTMLButtonElement, ComponentProps<'button'> & {
  count: number;
  tone?: NotificationBellTone;
  live?: NotificationBellLive;
  /** Latest unread event, shown when there is no active session. */
  attention?: NotificationBellAttention;
  attentionLabel?: string;
  /** Accessible name of the live orb (the row status label). */
  liveLabel?: string;
}>(
  function NotificationBell({ count, tone = 'neutral', live = 'idle', attention, attentionLabel, liveLabel, className, ...props }, ref) {
    const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const reduced = useReducedMotion();
    const badge = total > 9 ? '9+' : String(total);
    const status: OrbStatusState = live === 'waiting'
      ? 'waiting'
      : live === 'running' ? 'streaming' : attention ?? 'idle';
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        data-slot="notification-bell"
        data-live={live}
        data-status={live === 'idle' ? attention ?? 'none' : live}
        data-tone={tone}
        className={cn('rare-notification-bell', className)}
      >
        {live === 'idle' && !attention ? (
          <Bell data-testid="chat-activity-bell-icon" className="size-4" strokeWidth={1.9} aria-hidden="true" />
        ) : (
          <OrbStatus
            data-testid={live === 'idle' ? 'chat-activity-status-icon' : 'chat-activity-live-orb'}
            state={status}
            label={live === 'idle' ? attentionLabel ?? attention ?? 'status' : liveLabel ?? live}
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
