import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiOverlay } from '@/components/layout/ui-overlay-context';
import { filterSettingsSections } from '@/lib/settings-search';
import { resolveSettingsSection } from './route-config';
import { SettingsNavIcon, type SettingsIconName } from './codex-settings-icons';

const sections = [
  { id: 'general', to: '/settings/general', icon: 'general', group: 'experience' },
  { id: 'models', to: '/settings/models', icon: 'config', group: 'configuration' },
  { id: 'agents', to: '/settings/agents', icon: 'account', group: 'configuration' },
  { id: 'skills', to: '/settings/skills', icon: 'plugins', group: 'configuration' },
  { id: 'channels', to: '/settings/channels', icon: 'connections', group: 'configuration' },
  { id: 'browser', to: '/settings/browser', icon: 'browser', group: 'configuration' },
  { id: 'billing', to: '/settings/billing', icon: 'appearance', group: 'operations' },
  { id: 'system', to: '/settings/system', icon: 'computer', group: 'operations' },
  { id: 'developer', to: '/settings/developer', icon: 'hooks', group: 'operations' },
  { id: 'storage', to: '/settings/storage', icon: 'environments', group: 'operations' },
  { id: 'archived', to: '/settings/archived', icon: 'archived', group: 'experience' },
  { id: 'recovery', to: '/settings/recovery', icon: 'computer', group: 'operations' },
] satisfies Array<{
  id: string;
  to: string;
  icon: SettingsIconName;
  group: 'configuration' | 'experience' | 'operations';
}>;

export function SettingsSidebar() {
  const { t } = useTranslation(['settings', 'common']);
  const { pathname } = useLocation();
  const { requestCloseSettings } = useUiOverlay();
  const [query, setQuery] = useState('');
  const currentSection = resolveSettingsSection(pathname);
  const filtered = useMemo(() => filterSettingsSections(sections.map((section) => ({
    ...section,
    title: t(`settings:navigation.${section.id}.title`),
    description: t(`settings:navigation.${section.id}.description`),
  })), query), [query, t]);

  return (
    <aside data-testid="settings-sidebar" className="codex-settings-sidebar flex min-h-0 w-[275px] shrink-0 flex-col bg-surface-sidebar p-2">
      <button type="button" data-testid="settings-back-button" onClick={() => requestCloseSettings()} className="codex-settings-back">
        <SettingsNavIcon name="back" />
        <span>{t('settings:navigation.back')}</span>
      </button>
      <label className="mb-4 flex h-7 shrink-0 items-center gap-2 rounded-[12.5px] border-[0.667px] border-border/70 bg-foreground/[0.03] px-2 text-muted-foreground">
        <SettingsNavIcon name="search" />
        <input
          data-testid="settings-sidebar-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('common:actions.search')}
          aria-label={t('common:actions.search')}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-[445] leading-[18px] text-foreground outline-none placeholder:text-muted-foreground/80"
        />
      </label>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
        {(['configuration', 'experience', 'operations'] as const).map((group) => {
          const items = filtered.filter((section) => section.group === group);
          if (!items.length) return null;
          return (
            <section key={group} className="flex flex-col gap-px">
              <h2 className="mb-[3px] flex min-h-[21px] items-center px-2 text-sm font-medium leading-[21px] text-muted-foreground">
                {t(`settings:navigation.groups.${group}`)}
              </h2>
              {items.map((section) => {
                const active = currentSection === section.id;
                return (
                  <Link
                    key={section.id}
                    to={section.to}
                    data-testid={`settings-nav-${section.id}`}
                    aria-current={active ? 'page' : undefined}
                    className="codex-settings-nav-item"
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center"><SettingsNavIcon name={section.icon} /></span>
                    <span className="truncate">{section.title}</span>
                  </Link>
                );
              })}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
