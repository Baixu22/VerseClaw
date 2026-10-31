import { AlertTriangle, BellDot, Check, ShieldAlert } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { NotificationBell, type NotificationBellLive, type NotificationBellTone } from './NotificationBell';
import { useCompletionActivityStore } from './completion-activity-store';
import type { CompletionActivityNudge } from './completion-activity-store';
import {
  formatElapsed,
  groupConsecutiveBySession,
  type CompletionActivity,
  type LiveSessionActivity,
} from './completion-activity';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';

const EMPTY_LIVE: LiveSessionActivity[] = [];
/** Gap between the bell and the panel it opens. */
const PANEL_GAP_PX = 6;
/** Nudge statuses that are machine words, not something to show as a preview. */
const MACHINE_STATUSES = new Set(['completed', 'error', 'approval']);

function relativeTime(t: TFunction<'chat'>, at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t('sidebar.searchRelativeNow');
  if (minutes < 60) return t('sidebar.searchRelativeMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('sidebar.searchRelativeHours', { count: hours });
  return t('sidebar.searchRelativeDays', { count: Math.floor(hours / 24) });
}

function NudgeIcon({ kind }: { kind: CompletionActivityNudge['kind'] }) {
  if (kind === 'action-required') return <ShieldAlert className="rare-activity-entry__icon text-amber-700 dark:text-amber-400" />;
  if (kind === 'error') return <AlertTriangle className="rare-activity-entry__icon text-red-700 dark:text-red-400" />;
  return <Check className="rare-activity-entry__icon text-green-700 dark:text-green-400" />;
}

/**
 * Header activity control shared by the persistent sidebar and the chat data
 * owner: what is running right now, what just finished, and what needs you.
 */
export const CompletionActivityMenu = memo(function CompletionActivityMenu({
  liveSessions = EMPTY_LIVE,
}: {
  liveSessions?: LiveSessionActivity[];
}) {
  const { t } = useTranslation('chat');
  const activities = useCompletionActivityStore((state) => state.activities);
  const nudges = useCompletionActivityStore((state) => state.nudges);
  const requestNavigation = useCompletionActivityStore((state) => state.requestNavigation);
  const sessionLabels = useChatStore((state) => state.sessionLabels);
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const switchSession = useChatStore((state) => state.switchSession);
  const desktopNotificationsEnabled = useSettingsStore((state) => state.desktopNotificationsEnabled);
  const setDesktopNotificationsEnabled = useSettingsStore((state) => state.setDesktopNotificationsEnabled);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 52, width: 240 });
  /** Entries the user has seen: everything listed when the panel last closed. */
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  /** Entries that were unread when the panel opened — marked inside it. */
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const attentionEntries = useMemo<CompletionActivityNudge[]>(() => {
    const live = nudges.map((entry) => ({ ...entry }));
    const known = new Set(live.map((entry) => entry.id));
    for (const activity of activities) {
      const id = activity.runId ? `run:${activity.runId}:${activity.kind}` : activity.id;
      if (known.has(id)) continue;
      live.push({
        id,
        sessionKey: activity.sessionKey,
        kind: activity.kind,
        status: activity.preview || '',
        occurredAt: activity.completedAt,
      });
    }
    return live.sort((left, right) => right.occurredAt - left.occurredAt).slice(0, 8);
  }, [activities, nudges]);
  const unreadEntries = useMemo(
    () => attentionEntries.filter((entry) => !readIds.has(entry.id)),
    [attentionEntries, readIds],
  );
  // While the panel is open its entries are being read, so the badge stands
  // down; closing the panel records them as read.
  const unreadCount = open ? 0 : unreadEntries.length;
  const groups = useMemo(() => groupConsecutiveBySession(attentionEntries), [attentionEntries]);
  const tone: NotificationBellTone = open
    ? 'neutral'
    : unreadEntries.some((entry) => entry.kind === 'error')
      ? 'error'
      : unreadEntries.some((entry) => entry.kind === 'action-required') ? 'warning' : 'neutral';
  const live: NotificationBellLive = liveSessions.some((session) => session.state === 'waiting')
    ? 'waiting'
    : liveSessions.length > 0 ? 'running' : 'idle';
  const runningCount = liveSessions.length;
  const summary = [
    runningCount > 0 ? t('completionActivity.summaryRunning', { count: runningCount }) : null,
    unreadCount > 0 ? t('completionActivity.summaryUnread', { count: unreadCount }) : null,
  ].filter(Boolean).join(' · ');

  const labelOf = (sessionKey: string) => sessionLabels[sessionKey]
    || sessions.find((session) => session.key === sessionKey)?.displayName
    || t('completionActivity.untitledSession');

  const activityFor = (entry: CompletionActivityNudge): CompletionActivity | undefined => (
    activities.find((item) => item.sessionKey === entry.sessionKey && item.runId != null && entry.id === `run:${item.runId}:${item.kind}`)
    ?? activities.find((item) => item.id === entry.id)
    ?? activities.find((item) => item.sessionKey === entry.sessionKey && item.kind === entry.kind)
  );

  const positionMenu = (): Partial<{ left: number; top: number; width: number }> => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const sidebar = triggerRef.current?.closest('[data-testid="sidebar"]')?.getBoundingClientRect();
    if (!trigger || !sidebar) return {};
    return {
      left: sidebar.left + 8,
      top: trigger.bottom + PANEL_GAP_PX,
      width: Math.min(344, Math.max(240, sidebar.width - 16)),
    };
  };

  /** Everything the panel listed has been seen, including entries that arrived while it was open. */
  const closePanel = useCallback(() => {
    setReadIds((current) => new Set([...current, ...attentionEntries.map((entry) => entry.id)]));
    setOpen(false);
  }, [attentionEntries]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel();
        triggerRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closePanel, open]);

  // One clock for elapsed and relative times, ticking only while the panel is
  // open (it is set to the current time by the click that opens it).
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      closePanel();
      return;
    }
    flushSync(() => setMenuPosition((current) => ({ ...current, ...positionMenu() })));
    setFreshIds(new Set(unreadEntries.map((entry) => entry.id)));
    setNow(Date.now());
    setOpen(true);
  };

  const goToSession = (sessionKey: string) => {
    if (sessionKey !== currentSessionKey) switchSession(sessionKey);
    navigate('/');
    closePanel();
  };

  const openNudge = (entry: CompletionActivityNudge) => {
    const activity = activities.find((item) => item.sessionKey === entry.sessionKey && (
      (entry.id.startsWith('run:') && item.runId && entry.id.includes(item.runId))
      || item.kind === (entry.kind === 'action-required' ? undefined : entry.kind)
    ));
    if (activity) requestNavigation(activity);
    goToSession(entry.sessionKey);
  };

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : index <= 0 ? items.length - 1 : index - 1;
    items[next]?.focus();
  };

  return (
    <span ref={triggerRef} className="rare-completion-menu__anchor no-drag">
      <Tooltip>
        <TooltipTrigger asChild>
          <NotificationBell
            count={unreadCount}
            tone={tone}
            live={live}
            data-testid="chat-completion-bell"
            aria-label={runningCount > 0
              ? t('completionActivity.labelLive', { count: unreadCount, running: runningCount })
              : t('completionActivity.label', { count: unreadCount })}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggleOpen}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{summary || t('completionActivity.title')}</TooltipContent>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          tabIndex={-1}
          aria-label={t('completionActivity.title')}
          data-testid="chat-completion-menu"
          className="rare-completion-menu rare-activity-panel fixed z-[80]"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
          onKeyDown={onPanelKeyDown}
        >
          <div className="rare-activity-panel__head">
            <span className="rare-activity-panel__title">{t('completionActivity.title')}</span>
          </div>
          <div className="rare-activity-panel__body">
            {liveSessions.length > 0 && (
              <section
                role="group"
                aria-label={t('completionActivity.liveTitle')}
                data-testid="chat-activity-live"
                className="rare-activity-section"
              >
                <div className="rare-activity-section__label">
                  <span>{t('completionActivity.liveTitle')}</span>
                  <span className="rare-activity-section__count">{liveSessions.length}</span>
                </div>
                {liveSessions.map((session) => {
                  const stateLabel = t(`completionActivity.live.${session.state}`);
                  return (
                    <button
                      key={session.sessionKey}
                      type="button"
                      role="menuitem"
                      data-testid="chat-activity-live-item"
                      data-state={session.state}
                      className="rare-activity-live"
                      onClick={() => goToSession(session.sessionKey)}
                    >
                      <OrbStatus
                        state={session.state === 'waiting' ? 'waiting' : 'streaming'}
                        label={stateLabel}
                        className="size-4 shrink-0"
                      />
                      <span className="rare-activity-live__title">{session.label}</span>
                      <span className="rare-activity-live__meta">
                        {session.state === 'running' && session.startedAt != null
                          ? <time aria-label={stateLabel}>{formatElapsed(now - session.startedAt)}</time>
                          : stateLabel}
                      </span>
                    </button>
                  );
                })}
              </section>
            )}
            {groups.length > 0 ? (
              <section role="group" aria-label={t('completionActivity.recentTitle')} className="rare-activity-section">
                <div className="rare-activity-section__label">
                  <span>{t('completionActivity.recentTitle')}</span>
                </div>
                {groups.map((group) => (
                  <div key={group.entries[0].id} className="rare-activity-group">
                    <div className="rare-activity-group__head">{labelOf(group.sessionKey)}</div>
                    {group.entries.map((entry) => {
                      const preview = entry.status && !MACHINE_STATUSES.has(entry.status)
                        ? entry.status
                        : activityFor(entry)?.preview || t(`completionActivity.kind.${entry.kind}`);
                      const fresh = freshIds.has(entry.id) || !readIds.has(entry.id);
                      return (
                        <button
                          type="button"
                          role="menuitem"
                          key={entry.id}
                          data-testid="chat-completion-item"
                          data-kind={entry.kind}
                          data-completed-at={entry.occurredAt}
                          data-fresh={fresh ? 'true' : undefined}
                          className="rare-completion-menu__item rare-activity-entry"
                          onClick={() => openNudge(entry)}
                        >
                          <NudgeIcon kind={entry.kind} />
                          <span className="rare-activity-entry__body">
                            <span className="rare-completion-menu__preview rare-activity-entry__preview">{preview}</span>
                            <span className="rare-activity-entry__meta">
                              {entry.kind !== 'completed' && (
                                <span className="rare-activity-entry__kind" data-kind={entry.kind}>
                                  {t(`completionActivity.kind.${entry.kind}`)}
                                </span>
                              )}
                              {entry.occurredAt > 0 && (
                                <time
                                  dateTime={new Date(entry.occurredAt).toISOString()}
                                  title={new Date(entry.occurredAt).toLocaleString()}
                                >
                                  {relativeTime(t, entry.occurredAt, now)}
                                </time>
                              )}
                            </span>
                          </span>
                          {fresh && (
                            <span className="rare-activity-entry__fresh" role="img" aria-label={t('completionActivity.fresh')} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            ) : liveSessions.length === 0 && (
              <div className="rare-activity-empty" data-testid="chat-activity-empty">
                <BellDot className="rare-activity-empty__icon" aria-hidden="true" />
                <span className="rare-activity-empty__title">{t('completionActivity.emptyTitle')}</span>
                <span className="rare-activity-empty__desc">{t('completionActivity.empty')}</span>
              </div>
            )}
          </div>
          <div className="rare-activity-panel__foot">
            <span className="rare-activity-panel__foot-text">
              <span className="rare-activity-panel__foot-state" data-testid="chat-completion-desktop-state">
                {desktopNotificationsEnabled ? t('completionActivity.desktopOn') : t('completionActivity.desktopOff')}
              </span>
              <span className="rare-activity-panel__foot-desc">{t('completionActivity.desktopDescription')}</span>
            </span>
            <Switch
              data-testid="chat-completion-desktop-toggle"
              checked={desktopNotificationsEnabled}
              onCheckedChange={setDesktopNotificationsEnabled}
              aria-label={t('completionActivity.desktopToggle')}
            />
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
});
