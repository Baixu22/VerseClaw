import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { NotificationBell } from './NotificationBell';
import { useCompletionActivityStore } from './completion-activity-store';
import { useChatStore } from '@/stores/chat';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Header activity control shared by the persistent sidebar and the chat data owner. */
export function CompletionActivityMenu() {
  const { t } = useTranslation('chat');
  const activities = useCompletionActivityStore((state) => state.activities);
  const requestNavigation = useCompletionActivityStore((state) => state.requestNavigation);
  const sessionLabels = useChatStore((state) => state.sessionLabels);
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const switchSession = useChatStore((state) => state.switchSession);
  const navigate = useNavigate();
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const unreadCount = activities.filter((entry) => !readIds.has(entry.id)).length;

  return (
    <DropdownMenu.Root onOpenChange={(open) => {
      if (open) setReadIds(new Set([...readIds, ...activities.map((entry) => entry.id)]));
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu.Trigger asChild>
            <NotificationBell
              count={unreadCount}
              className="no-drag"
              data-testid="chat-completion-bell"
              aria-label={t('completionActivity.label', { count: unreadCount })}
            />
          </DropdownMenu.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('completionActivity.title')}</TooltipContent>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="rare-completion-menu z-50 rounded-lg border border-border bg-surface-modal p-2 shadow-lg"
          data-testid="chat-completion-menu"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-foreground">
            {t('completionActivity.title')}
          </DropdownMenu.Label>
          {activities.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('completionActivity.empty')}</p>
          ) : activities.map((entry) => {
            const label = sessionLabels[entry.sessionKey]
              || sessions.find((session) => session.key === entry.sessionKey)?.displayName
              || t('completionActivity.completed');
            return (
              <DropdownMenu.Item
                key={entry.id}
                data-testid="chat-completion-item"
                data-completed-at={entry.completedAt}
                className="rare-completion-menu__item cursor-pointer rounded-md outline-none"
                onSelect={() => {
                  requestNavigation(entry);
                  if (entry.sessionKey !== currentSessionKey) {
                    switchSession(entry.sessionKey);
                    navigate('/');
                  }
                }}
              >
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />
                <span className="min-w-0 flex-1 text-xs">
                  <span className="block truncate font-medium text-foreground">{label}</span>
                  <span className="rare-completion-menu__preview mt-1 leading-5 text-muted-foreground">
                    {entry.preview || t('completionActivity.completed')}
                  </span>
                  {entry.completedAt > 0 && (
                    <time className="mt-1 block text-2xs text-muted-foreground" dateTime={new Date(entry.completedAt).toISOString()}>
                      {new Date(entry.completedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  )}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
