import { useEffect, useState, type ComponentType } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { recoverFromDynamicImportLoadError } from '@/lib/dynamic-import-recovery';
import { SettingsSectionLoading, type SettingsSectionSkeletonVariant } from './sections/SettingsSectionLoading';
import { SettingsPageChrome } from './SettingsPageChrome';
import { resolveSettingsSection, type SettingsSectionId } from './route-config';

function getE2ESectionDelayMs(): number {
  const params = new URLSearchParams(window.location.search);
  const delay = Number(params.get('e2eSettingsSectionDelayMs'));
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 30_000) : 0;
}

/**
 * Commits the loading page before starting the module work. This keeps the
 * real async state visible during React Router transitions, where a lazy
 * component would otherwise leave the previous page mounted until it resolves.
 */
function createDeferredComponent<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  fallbackVariant: SettingsSectionSkeletonVariant = 'settings-rows',
) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  let settledComponent: ComponentType<P> | null = null;

  const load = () => {
    if (settledComponent) {
      return Promise.resolve({ default: settledComponent });
    }
    if (!pending) {
      const modulePromise = loader();
      const delayMs = getE2ESectionDelayMs();
      pending = (delayMs > 0
        ? Promise.all([
            modulePromise,
            new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)),
          ]).then(([module]) => module)
        : modulePromise)
        .then((module) => {
          settledComponent = module.default;
          return module;
        })
        .catch((error) => {
          pending = null;
          recoverFromDynamicImportLoadError(error);
          throw error;
        });
    }
    return pending;
  };

  function DeferredComponent(props: P) {
    const { t } = useTranslation('settings');
    const [LoadedComponent, setLoadedComponent] = useState<ComponentType<P> | null>(
      () => settledComponent,
    );
    const [loadError, setLoadError] = useState<unknown>(null);

    useEffect(() => {
      if (LoadedComponent) return;
      let active = true;
      void load()
        .then((module) => {
          if (active) setLoadedComponent(() => module.default);
        })
        .catch((error: unknown) => {
          if (active) setLoadError(error);
        });
      return () => {
        active = false;
      };
    }, [LoadedComponent]);

    if (loadError) throw loadError;
    if (!LoadedComponent) {
      return <SettingsSectionLoading label={t('loading.section')} variant={fallbackVariant} />;
    }
    return <LoadedComponent {...props} />;
  }

  return {
    Component: DeferredComponent,
    preload: () => {
      void load();
    },
  };
}

const settingsImplementation = createDeferredComponent<{ embedded?: boolean }>(
  () => import('./index').then((module) => ({ default: module.Settings })),
  'settings-rows',
);
const settingsModels = createDeferredComponent<{ embedded?: boolean }>(
  () => import('@/pages/Models').then((module) => ({ default: module.Models })),
  'generic',
);
const settingsAgents = createDeferredComponent<{ embedded?: boolean }>(
  () => import('@/pages/Agents').then((module) => ({ default: module.Agents })),
  'agent-list',
);
const settingsSkills = createDeferredComponent<{ embedded?: boolean }>(
  () => import('@/pages/Skills').then((module) => ({ default: module.Skills })),
  'skill-list',
);
const settingsChannels = createDeferredComponent<{ embedded?: boolean }>(
  () => import('@/pages/Channels').then((module) => ({ default: module.Channels })),
  'channel-grid',
);
const settingsBilling = createDeferredComponent<{ embedded?: boolean }>(
  () => import('@/pages/Billing').then((module) => ({ default: module.Billing })),
  'billing',
);
const settingsBrowser = createDeferredComponent<{ embedded?: boolean }>(
  () => import('@/components/settings/BrowserSettingsPanel').then((module) => ({
    default: module.BrowserSettingsPanel as ComponentType<{ embedded?: boolean }>,
  })),
  'settings-rows',
);
const settingsArchived = createDeferredComponent<Record<string, never>>(
  () => import('./sections/ArchivedSection').then((module) => ({
    default: module.ArchivedSection as ComponentType<Record<string, never>>,
  })),
  'archived',
);
const settingsRecovery = createDeferredComponent<Record<string, never>>(
  () => import('./sections/RecoverySettingsSection').then((module) => ({
    default: module.RecoverySettingsSection as ComponentType<Record<string, never>>,
  })),
  'settings-rows',
);

const settingsStorage = createDeferredComponent<{ embedded?: boolean }>(
  () => import('./sections/StorageSection').then((module) => ({ default: module.StorageSection })),
);

const standaloneSections = {
  storage: settingsStorage.Component,
  models: settingsModels.Component,
  agents: settingsAgents.Component,
  skills: settingsSkills.Component,
  channels: settingsChannels.Component,
  billing: settingsBilling.Component,
  browser: settingsBrowser.Component,
} as const;
const SettingsImplementation = settingsImplementation.Component;
const SettingsArchived = settingsArchived.Component;
const SettingsRecovery = settingsRecovery.Component;

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
    archived: { title: t('navigation.archived.title'), description: t('navigation.archived.description') },
    storage: { title: t('navigation.storage.title'), description: t('navigation.storage.description') },
    recovery: { title: t('navigation.recovery.title'), description: t('navigation.recovery.description') },
  } satisfies Record<Exclude<SettingsSectionId, 'overview'>, { title: string; description: string }>;

  const meta = sectionMeta[currentSection];
  const pageTitleTestId = currentSection === 'models'
    ? 'models-page-title'
    : currentSection === 'billing'
      ? 'billing-page-title'
      : undefined;

  const StandaloneSection = currentSection in standaloneSections
    ? standaloneSections[currentSection as keyof typeof standaloneSections]
    : null;

  if (StandaloneSection) {
    return (
      <SettingsPageChrome title={meta.title} description={meta.description} titleTestId={pageTitleTestId}>
        <div className="codex-settings-content animate-in fade-in duration-150 motion-reduce:animate-none">
          <StandaloneSection embedded />
        </div>
      </SettingsPageChrome>
    );
  }

  if (currentSection === 'archived') {
    const StandalonePage = SettingsArchived;
    return (
      <SettingsPageChrome title={meta.title} description={meta.description}>
        <div className="codex-settings-content animate-in fade-in duration-150 motion-reduce:animate-none">
          <StandalonePage />
        </div>
      </SettingsPageChrome>
    );
  }

  if (currentSection === 'recovery') {
    return (
      <SettingsPageChrome title={meta.title} description={meta.description}>
        <div className="codex-settings-content animate-in fade-in duration-150 motion-reduce:animate-none">
          <SettingsRecovery />
        </div>
      </SettingsPageChrome>
    );
  }

  return (
    <SettingsPageChrome title={meta.title} description={meta.description}>
      <SettingsImplementation embedded />
    </SettingsPageChrome>
  );
}

export default SettingsRoute;