import { AlertTriangle, Check, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useCompletionActivityStore } from './completion-activity-store';
import type { CompletionActivityNudge } from './completion-activity-store';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';

function NudgeIcon({ kind }: { kind: CompletionActivityNudge['kind'] }) {
  if (kind === 'action-required') return <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />;
  if (kind === 'error') return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" />;
  return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />;
}

/** Header attention control shared by the persistent sidebar and the chat data owner. */
export function CompletionActivityMenu() {
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
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
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
  const unreadCount = attentionEntries.filter((entry) => !readIds.has(entry.id)).length;

  const positionMenu = (): Partial<{ left: number; top: number; width: number }> => {
    const sidebar = triggerRef.current?.closest('[data-testid="sidebar"]')?.getBoundingClientRect();
    if (!sidebar) return {};
    const width = Math.min(336, Math.max(240, sidebar.width - 16));
    return {
      left: sidebar.left + 8,
      top: sidebar.top + 52,
      width,
    };
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      flushSync(() => setMenuPosition((current) => ({ ...current, ...positionMenu() })));
    }
    setOpen(!open);
    if (!open) setReadIds(new Set([...readIds, ...attentionEntries.map((entry) => entry.id)]));
  };

  const openNudge = (entry: CompletionActivityNudge) => {
    const activity = activities.find((item) => item.sessionKey === entry.sessionKey && (
      (entry.id.startsWith('run:') && item.runId && entry.id.includes(item.runId))
      || item.kind === (entry.kind === 'action-required' ? undefined : entry.kind)
    ));
    if (activity) requestNavigation(activity);
    if (entry.sessionKey !== currentSessionKey) {
      switchSession(entry.sessionKey);
      navigate('/');
    }
    setOpen(false);
  };

  return (
    <span ref={triggerRef} className="rare-completion-menu__anchor no-drag">
      <Tooltip>
        <TooltipTrigger asChild>
          <NotificationBell
            count={unreadCount}
            data-testid="chat-completion-bell"
            aria-label={t('completionActivity.label', { count: unreadCount })}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggleOpen}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('completionActivity.title')}</TooltipContent>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label={t('completionActivity.title')}
          data-testid="chat-completion-menu"
          className="rare-completion-menu fixed z-[80] rounded-lg border border-border bg-surface-modal p-2 shadow-lg"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-2 pb-2 pt-1">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">{t('completionActivity.title')}</div>
              <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">
                {t('completionActivity.desktopDescription')}
              </p>
            </div>
            <Switch
              data-testid="chat-completion-desktop-toggle"
              checked={desktopNotificationsEnabled}
              onCheckedChange={setDesktopNotificationsEnabled}
              aria-label={t('completionActivity.desktopToggle')}
            />
          </div>
          <div className="mt-0.5 px-2 pb-1 text-2xs text-muted-foreground" data-testid="chat-completion-desktop-state">
            {desktopNotificationsEnabled ? t('completionActivity.desktopOn') : t('completionActivity.desktopOff')}
          </div>
          {attentionEntries.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('completionActivity.empty')}</p>
          ) : attentionEntries.map((entry) => {
            const activity = activities.find((item) => item.sessionKey === entry.sessionKey && item.kind === entry.kind);
            const label = sessionLabels[entry.sessionKey]
              || sessions.find((session) => session.key === entry.sessionKey)?.displayName
              || t('completionActivity.completed');
            return (
              <button
                type="button"
                role="menuitem"
                key={entry.id}
                data-testid="chat-completion-item"
                data-kind={entry.kind}
                data-completed-at={entry.occurredAt}
                className="rare-completion-menu__item w-full cursor-pointer rounded-md text-left outline-none hover:bg-[var(--color-background-row-hover)] focus-visible:bg-[var(--color-background-row-hover)]"
                onClick={() => openNudge(entry)}
              >
                <NudgeIcon kind={entry.kind} />
                <span className="min-w-0 flex-1 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">{label}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {t(`completionActivity.kind.${entry.kind}`)}
                    </span>
                  </span>
                  <span className="rare-completion-menu__preview mt-1 leading-5 text-muted-foreground">
                    {entry.status || activity?.preview || t('completionActivity.completed')}
                  </span>
                  {entry.occurredAt > 0 && (
                    <time className="mt-1 block text-2xs text-muted-foreground" dateTime={new Date(entry.occurredAt).toISOString()}>
                      {new Date(entry.occurredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  )}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
}
