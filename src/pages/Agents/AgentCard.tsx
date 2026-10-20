import type { ComponentProps, ReactNode } from 'react';
import { Check, Settings2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ChannelGroupItem } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';
import { CHANNEL_NAMES, type ChannelType } from '@/types/channel';

// The waiting ghost and the resolved card share every layout-bearing element.
export function AgentCardFrame({
  avatar, identity, model, channels, actions, isDefault = false, className, ...props
}: ComponentProps<'div'> & {
  avatar: ReactNode;
  identity: ReactNode;
  model: ReactNode;
  channels: ReactNode;
  actions: ReactNode;
  isDefault?: boolean;
}) {
  return (
    <div
      {...props}
      data-build-root
      className={cn(
        'agent-card group relative flex min-h-[118px] items-start gap-4 overflow-hidden rounded-2xl border border-transparent bg-transparent p-4 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5',
        isDefault && 'bg-black/[0.04] dark:bg-white/[0.06]',
        className,
      )}
    >
      <div data-build-part="icon" className="mb-3 size-[46px] shrink-0 rounded-full">{avatar}</div>
      <div className="mt-1 flex min-w-0 flex-1 flex-col py-0.5">
        <div className="mb-1 flex h-7 items-center justify-between gap-3">
          <div data-build-part="title" className="flex min-w-0 items-center gap-2">{identity}</div>
          <div data-build-part="actions" className="flex shrink-0 items-center gap-1">{actions}</div>
        </div>
        <div className="min-h-[21px] text-sm leading-[1.5] text-muted-foreground">
          <span data-build-part="detail" className="block w-fit max-w-full line-clamp-2">{model}</span>
        </div>
        <div data-build-part="meta" className="flex min-h-[22px] w-fit max-w-full flex-wrap items-center gap-1.5 text-sm leading-[1.5] text-muted-foreground">
          {channels}
        </div>
      </div>
    </div>
  );
}

export function AgentsStructureSkeleton({ index = 0 }: { index?: number }) {
  return (
    <AgentCardFrame
      data-testid="agents-structure-row"
      aria-hidden="true"
      avatar={<span className="block size-[46px] rounded-full" />}
      identity={(
        <>
          <span className="block h-6 w-32 max-w-full" />
          {index === 0 && <span data-build-status className="h-5 w-16 rounded-full" />}
        </>
      )}
      model={<span className="block h-[21px] w-80 max-w-full" />}
      channels={(
        <>
          <span className="block h-[22px] w-16" />
          <span data-build-chip className="h-[22px] w-28 rounded-full" />
          <span data-build-chip className="h-[22px] w-24 rounded-full" />
        </>
      )}
      actions={(
        <>
          {index !== 0 && <span data-build-action className="block size-7 rounded-lg" />}
          <span data-build-action className="block size-7 rounded-lg" />
        </>
      )}
    />
  );
}

export function AgentCard({
  agent, channelGroups, onOpenSettings, onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const accounts = channelGroups.flatMap((group) => group.accounts
    .filter((account) => account.agentId === agent.id)
    .map((account) => ({
      key: `${group.channelType}/${account.accountId}`,
      label: `${CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType} · ${account.accountId === 'default' ? t('settingsDialog.mainAccount') : account.name || account.accountId}`,
    })));

  return (
    <AgentCardFrame
      data-testid={`agent-card-${agent.id}`}
      isDefault={agent.isDefault}
      avatar={<AgentAvatar agentId={agent.id} name={agent.name} avatar={agent.avatar} size={46} className="block shadow-sm" />}
      identity={(
        <>
          <h2 className="truncate text-base font-semibold text-foreground">{agent.name}</h2>
          {agent.isDefault && (
            <Badge data-build-status variant="secondary" className="flex shrink-0 items-center gap-1 rounded-full border-0 bg-black/[0.04] px-2 py-0.5 font-mono text-2xs font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]">
              <Check className="h-3 w-3" />
              {t('defaultBadge')}
            </Badge>
          )}
        </>
      )}
      model={t('modelLine', { model: agent.modelDisplay, suffix: agent.inheritedModel ? ` (${t('inherited')})` : '' })}
      channels={accounts.length ? (
        <>
          <span>{t('channelsLine', { channels: '' })}</span>
          {accounts.map((account) => (
            <span key={account.key} data-build-chip className="max-w-full truncate rounded-full border border-border/60 bg-foreground/[0.035] px-2 py-0.5 text-xs">
              {account.label}
            </span>
          ))}
        </>
      ) : t('channelsLine', { channels: t('none') })}
      actions={(
        <>
          {!agent.isDefault && (
            <Button data-build-action variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={onDelete} title={t('deleteAgent')} aria-label={t('deleteAgent')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button data-build-action data-testid={`agent-settings-${agent.id}`} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10" onClick={onOpenSettings} title={t('settings')} aria-label={t('settings')}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </>
      )}
    />
  );
}
