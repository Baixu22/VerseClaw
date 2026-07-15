import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Cpu,
  Network,
  Palette,
  Puzzle,
  ReceiptText,
  Server,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { recoverFromDynamicImportLoadError } from '@/lib/dynamic-import-recovery';
import { SettingsSectionLoading } from './sections/SettingsSectionLoading';
import { resolveSettingsSection, type SettingsSectionId } from './route-config';

let settingsModulePromise: ReturnType<typeof importSettingsModule> | null = null;

function importSettingsModule() {
  return import('./index').then((module) => ({ default: module.Settings }));
}

function loadSettingsModule() {
  if (!settingsModulePromise) {
    settingsModulePromise = importSettingsModule().catch((error) => {
      settingsModulePromise = null;
      recoverFromDynamicImportLoadError(error);
      throw error;
    });
  }
  return settingsModulePromise;
}

function preloadSettingsModule() {
  void loadSettingsModule().catch(() => undefined);
}

const SettingsImplementation = lazy(loadSettingsModule);

function SettingsPageShell({ children }: { children: ReactNode }) {
  return (
    <div data-testid="settings-page" className="-m-6 flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        {children}
      </div>
    </div>
  );
}

export function SettingsRoute() {
  const { t } = useTranslation('settings');
  const location = useLocation();
  const navigate = useNavigate();
  const currentSection = resolveSettingsSection(location.pathname);

  const sectionMeta = {
    general: { title: t('navigation.general.title'), description: t('navigation.general.description') },
    models: { title: t('navigation.models.title'), description: t('navigation.models.description') },
    agents: { title: t('navigation.agents.title'), description: t('navigation.agents.description') },
    channels: { title: t('navigation.channels.title'), description: t('navigation.channels.description') },
    skills: { title: t('navigation.skills.title'), description: t('navigation.skills.description') },
    system: { title: t('navigation.system.title'), description: t('navigation.system.description') },
    developer: { title: t('navigation.developer.title'), description: t('navigation.developer.description') },
    billing: { title: t('navigation.billing.title'), description: t('navigation.billing.description') },
    storage: { title: t('navigation.storage.title'), description: t('navigation.storage.description') },
  } satisfies Record<Exclude<SettingsSectionId, 'overview'>, { title: string; description: string }>;

  const settingsSections = [
    { id: 'general', to: '/settings/general', icon: <Palette />, testId: 'settings-nav-general', ...sectionMeta.general },
    { id: 'models', to: '/settings/models', icon: <Cpu />, testId: 'settings-nav-models', ...sectionMeta.models },
    { id: 'agents', to: '/settings/agents', icon: <Bot />, testId: 'settings-nav-agents', ...sectionMeta.agents },
    { id: 'skills', to: '/settings/skills', icon: <Puzzle />, testId: 'settings-nav-skills', ...sectionMeta.skills },
    { id: 'channels', to: '/settings/channels', icon: <Network />, testId: 'settings-nav-channels', ...sectionMeta.channels },
    { id: 'system', to: '/settings/system', icon: <Server />, testId: 'settings-nav-system', ...sectionMeta.system },
    { id: 'developer', to: '/settings/developer', icon: <Wrench />, testId: 'settings-nav-developer', ...sectionMeta.developer },
    { id: 'billing', to: '/settings/billing', icon: <ReceiptText />, testId: 'settings-nav-billing', ...sectionMeta.billing },
    { id: 'storage', to: '/settings/storage', icon: <Trash2 />, testId: 'settings-nav-storage', ...sectionMeta.storage },
  ] as const;
  const groups = [
    { id: 'configuration', title: t('navigation.groups.configuration'), sections: settingsSections.filter((item) => ['models', 'agents', 'skills', 'channels'].includes(item.id)) },
    { id: 'experience', title: t('navigation.groups.experience'), sections: settingsSections.filter((item) => item.id === 'general') },
    { id: 'operations', title: t('navigation.groups.operations'), sections: settingsSections.filter((item) => ['billing', 'system', 'developer', 'storage'].includes(item.id)) },
  ];

  if (currentSection !== 'overview') {
    const pageTitleTestId = currentSection === 'models'
      ? 'models-page-title'
      : currentSection === 'billing' ? 'billing-page-title' : undefined;
    return (
      <Suspense fallback={(
        <SettingsPageShell>
          <div className="mb-6 flex shrink-0 flex-col justify-between gap-3 border-b border-border pb-5 md:flex-row md:items-start">
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/settings')}
                data-testid="settings-back-button"
                className="mb-4 h-8 border-black/10 bg-transparent px-2.5 text-xs dark:border-white/10"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('navigation.back')}
              </Button>
              <h1 data-testid={pageTitleTestId} className="mb-1 font-serif text-2xl font-normal tracking-tight text-foreground">
                {sectionMeta[currentSection].title}
              </h1>
              <p className="max-w-3xl text-sm leading-5 text-muted-foreground">{sectionMeta[currentSection].description}</p>
            </div>
          </div>
          <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pb-10 pr-2">
            <SettingsSectionLoading label={t('loading.section')} />
          </div>
        </SettingsPageShell>
      )}>
        <SettingsImplementation />
      </Suspense>
    );
  }

  return (
    <SettingsPageShell>
      <div className="mb-6 shrink-0 border-b border-border pb-5">
        <h1 className="mb-1.5 font-serif text-3xl font-normal tracking-tight text-foreground">{t('title')}</h1>
        <p className="max-w-3xl text-sm leading-5 text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pb-10 pr-2">
        <div data-testid="settings-overview" className="space-y-6">
          {groups.map((group) => (
            <section key={group.id} className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground/70">{group.title}</h2>
              <div className="grid overflow-hidden rounded-lg border border-border md:grid-cols-2">
                {group.sections.map((section) => (
                  <Card key={section.id} className="group rounded-none border-0 border-b border-border bg-surface-modal shadow-none transition-colors last:border-b-0 hover:bg-black/[0.03] motion-reduce:transition-none md:odd:border-r dark:hover:bg-white/[0.05]">
                    <Link
                      to={section.to}
                      data-testid={section.testId}
                      onPointerEnter={preloadSettingsModule}
                      onFocus={preloadSettingsModule}
                      className="flex h-full min-h-20 items-center gap-3 px-4 py-3"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black/5 text-foreground/80 dark:bg-white/10 [&_svg]:h-4 [&_svg]:w-4">{section.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{section.title}</span>
                        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{section.description}</span>
                      </span>
                      <ChevronRight className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground', 'motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5')} />
                    </Link>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </SettingsPageShell>
  );
}

export default SettingsRoute;
