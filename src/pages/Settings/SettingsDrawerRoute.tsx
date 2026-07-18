import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  Cpu,
  Network,
  Palette,
  Puzzle,
  ReceiptText,
  Search,
  Server,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import { AppleDrawer } from '@/components/ui/apple-drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SettingsRoute } from './SettingsRoute';
import { resolveSettingsSection } from './route-config';
import { useUiOverlay } from '@/components/layout/ui-overlay-context';
import { MOTION_SPRING } from '@/components/ui/motion';
import { filterSettingsSections } from '@/lib/settings-search';

type SettingsDrawerRouteProps = {
  open: boolean;
  onClosed: () => void;
};

export function SettingsDrawerRoute({ open, onClosed }: SettingsDrawerRouteProps) {
  const { t } = useTranslation(['settings', 'common']);
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const reduceMotion = useReducedMotion();
  const currentSection = resolveSettingsSection(location.pathname);
  const { requestCloseSettings } = useUiOverlay();

  const sections = useMemo(() => [
    { id: 'general', to: '/settings/general', icon: Palette, group: 'experience' },
    { id: 'models', to: '/settings/models', icon: Cpu, group: 'configuration' },
    { id: 'agents', to: '/settings/agents', icon: Bot, group: 'configuration' },
    { id: 'skills', to: '/settings/skills', icon: Puzzle, group: 'configuration' },
    { id: 'channels', to: '/settings/channels', icon: Network, group: 'configuration' },
    { id: 'billing', to: '/settings/billing', icon: ReceiptText, group: 'operations' },
    { id: 'system', to: '/settings/system', icon: Server, group: 'operations' },
    { id: 'developer', to: '/settings/developer', icon: Wrench, group: 'operations' },
    { id: 'storage', to: '/settings/storage', icon: Trash2, group: 'operations' },
  ].map((section) => ({
    ...section,
    title: t(`settings:navigation.${section.id}.title`),
    description: t(`settings:navigation.${section.id}.description`),
  })), [t]);

  const filteredSections = filterSettingsSections(sections, query);

  return (
    <AppleDrawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestCloseSettings();
      }}
      onClosed={onClosed}
      title={t('settings:title')}
      description={t('settings:subtitle')}
      size="wide"
      dragMode="handle"
      testId="settings-drawer"
    >
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-black/8 bg-material-panel/90 px-4 backdrop-blur-[18px] dark:border-white/10 dark:bg-surface-modal/70">
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-semibold leading-6 tracking-[-0.02em] text-foreground">
              {t('settings:title')}
            </h1>
          </div>
          <div className="relative ml-auto w-[min(300px,42vw)]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('common:actions.search')}
              aria-label={t('common:actions.search')}
              className="h-8 rounded-lg border-black/8 bg-surface-input/72 pl-9 text-xs shadow-inner dark:border-white/10"
              data-testid="settings-drawer-search"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            aria-label={t('common:actions.close')}
            title={t('common:actions.close')}
            onClick={() => requestCloseSettings()}
            data-testid="settings-drawer-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="shrink-0 border-b border-black/8 bg-surface-sidebar/65 p-2.5 md:hidden dark:border-white/10">
          <select
            value={currentSection === 'overview' ? '/settings' : `/settings/${currentSection}`}
            onChange={(event) => navigate(event.target.value)}
            className="h-9 w-full rounded-lg border border-black/10 bg-surface-input/80 px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring dark:border-white/10"
            data-testid="settings-drawer-mobile-nav"
            aria-label={t('settings:title')}
          >
            <option value="/settings">{t('settings:title')}</option>
            {filteredSections.map((section) => (
              <option key={section.id} value={section.to}>{section.title}</option>
            ))}
          </select>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[232px] shrink-0 overflow-y-auto border-r border-black/8 bg-material-sidebar/92 p-3 backdrop-blur-[20px] dark:border-white/10 dark:bg-surface-sidebar/68 md:block">
            {(['configuration', 'experience', 'operations'] as const).map((group) => {
              const items = filteredSections.filter((section) => section.group === group);
              if (items.length === 0) return null;
              return (
                <section key={group} className="mb-5 last:mb-0">
                  <h2 className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
                    {t(`settings:navigation.groups.${group}`)}
                  </h2>
                  <div className="space-y-0.5">
                    {items.map((section) => {
                      const Icon = section.icon;
                      const active = currentSection === section.id;
                      return (
                        <Link
                          key={section.id}
                          to={section.to}
                          data-testid={`settings-nav-${section.id}`}
                          className={cn(
                            'group relative flex min-h-9 items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] leading-4',
                            'transition-[background-color,color,box-shadow] duration-150',
                            active
                              ? 'text-foreground'
                              : 'text-foreground/72 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
                          )}
                        >
                          {active ? (
                            <motion.span
                              layoutId="settings-drawer-selection"
                              className="absolute inset-0 rounded-[9px] bg-material-elevated/88 shadow-sm dark:bg-white/10"
                              transition={reduceMotion ? { duration: 0 } : MOTION_SPRING.control}
                            />
                          ) : null}
                          <Icon className="relative z-10 h-4 w-4 shrink-0 text-current" strokeWidth={1.8} />
                          <span className="relative z-10 truncate font-medium">{section.title}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </aside>
          <main className="min-w-0 flex-1 bg-material-canvas/94 dark:bg-background/76">
            <SettingsRoute presentation="drawer" />
          </main>
        </div>
      </div>
    </AppleDrawer>
  );
}
