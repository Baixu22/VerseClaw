import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { recoverFromDynamicImportLoadError } from '@/lib/dynamic-import-recovery';
import { SettingsSectionLoading } from './sections/SettingsSectionLoading';
import { SettingsPageChrome } from './SettingsPageChrome';
import { resolveSettingsSection, type SettingsSectionId } from './route-config';

let settingsModulePromise: ReturnType<typeof importSettingsModule> | null = null;

function getE2ESectionDelayMs(): number {
  const params = new URLSearchParams(window.location.search);
  const delay = Number(params.get('e2eSettingsSectionDelayMs'));
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 30_000) : 0;
}

function createPreloadableLazy<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const load = () => {
    if (!pending) {
      const modulePromise = loader();
      const delayMs = getE2ESectionDelayMs();
      pending = (delayMs > 0
        ? Promise.all([
            modulePromise,
            new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)),
          ]).then(([module]) => module)
        : modulePromise).catch((error) => {
          pending = null;
          recoverFromDynamicImportLoadError(error);
          throw error;
        });
    }
    return pending;
  };
  return { Component: lazy(load), preload: () => { void load(); } };
}

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

const SettingsImplementation = lazy(loadSettingsModule);
const settingsModels = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Models').then((module) => ({ default: module.Models })));
const settingsAgents = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Agents').then((module) => ({ default: module.Agents })));
const settingsSkills = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Skills').then((module) => ({ default: module.Skills })));
const settingsChannels = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Channels').then((module) => ({ default: module.Channels })));
const settingsBilling = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/pages/Billing').then((module) => ({ default: module.Billing })));
const settingsBrowser = createPreloadableLazy<{ embedded?: boolean }>(() => import('@/components/settings/BrowserSettingsPanel').then((module) => ({
  default: module.BrowserSettingsPanel as ComponentType<{ embedded?: boolean }>,
})));
const settingsStorage = createPreloadableLazy<Record<string, never>>(() => import('./sections/StorageCleanerSection').then((module) => ({
  default: module.StorageCleanerSection as ComponentType<Record<string, never>>,
})));
const settingsArchived = createPreloadableLazy<Record<string, never>>(() => import('./sections/ArchivedSection').then((module) => ({
  default: module.ArchivedSection as ComponentType<Record<string, never>>,
})));

const standaloneSections = {
  models: settingsModels.Component,
  agents: settingsAgents.Component,
  skills: settingsSkills.Component,
  channels: settingsChannels.Component,
  billing: settingsBilling.Component,
  browser: settingsBrowser.Component,
} as const;
const SettingsStorage = settingsStorage.Component;
const SettingsArchived = settingsArchived.Component;

export type SettingsPresentation = 'page';

export function SettingsRoute() {
  const { t } = useTranslation('settings');
  const location = useLocation();
  const currentSection = resolveSettingsSection(location.pathname);

  if (currentSection === 'overview') {
    return <Navigate to="/settings/general" replace />;
  }

  const sectionMeta = {
    general: { title: t('navigation.general.title'), description: t('navigation.general.description') },
    models: { title: t('navigation.models.title'), description: t('navigation.models.description') },
    agents: { title: t('navigation.agents.title'), description: t('navigation.agents.description') },
    channels: { title: t('navigation.channels.title'), description: t('navigation.channels.description') },
    skills: { title: t('navigation.skills.title'), description: t('navigation.skills.description') },
    browser: { title: t('navigation.browser.title'), description: t('navigation.browser.description') },
    system: { title: t('navigation.system.title'), description: t('navigation.system.description') },
    developer: { title: t('navigation.developer.title'), description: t('navigation.developer.description') },
    billing: { title: t('navigation.billing.title'), description: t('navigation.billing.description') },
    storage: { title: t('navigation.storage.title'), description: t('navigation.storage.description') },
    archived: { title: t('navigation.archived.title'), description: t('navigation.archived.description') },
  } satisfies Record<Exclude<SettingsSectionId, 'overview'>, { title: string; description: string }>;

  const meta = sectionMeta[currentSection];
  const pageTitleTestId = currentSection === 'models'
    ? 'models-page-title'
    : currentSection === 'billing'
      ? 'billing-page-title'
      : undefined;
  const loadingShell = (
    <SettingsPageChrome title={meta.title} description={meta.description} titleTestId={pageTitleTestId}>
      <SettingsSectionLoading label={t('loading.section')} />
    </SettingsPageChrome>
  );

  const StandaloneSection = currentSection in standaloneSections
    ? standaloneSections[currentSection as keyof typeof standaloneSections]
    : null;

  if (StandaloneSection) {
    return (
      <Suspense fallback={loadingShell}>
        <SettingsPageChrome title={meta.title} description={meta.description} titleTestId={pageTitleTestId}>
          <div className="codex-settings-content animate-in fade-in duration-150 motion-reduce:animate-none">
            <StandaloneSection embedded />
          </div>
        </SettingsPageChrome>
      </Suspense>
    );
  }

  if (currentSection === 'storage' || currentSection === 'archived') {
    const StandalonePage = currentSection === 'storage' ? SettingsStorage : SettingsArchived;
    return (
      <Suspense fallback={loadingShell}>
        <SettingsPageChrome title={meta.title} description={meta.description}>
          <div className="codex-settings-content animate-in fade-in duration-150 motion-reduce:animate-none">
            <StandalonePage />
          </div>
        </SettingsPageChrome>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={loadingShell}>
      <SettingsPageChrome title={meta.title} description={meta.description}>
        <SettingsImplementation embedded />
      </SettingsPageChrome>
    </Suspense>
  );
}

export default SettingsRoute;
