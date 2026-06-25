import { useMemo, useCallback } from 'react';
import { BookOpen, CheckCircle2, FileText, PanelsTopLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceKnowledgeScope, WorkspacePermissionMode } from '@shared/types/workspace';
import type {
  PromptMode,
  WorkModeCapabilitySkill,
  WorkModeKitConfig,
  WorkModeId,
  WorkModeToolBundleConfig,
} from '@shared/types/work-mode';
import {
  resolveWorkModeKitCapabilities,
  resolveWorkModePreset,
  WORK_MODE_KIT_DEFINITIONS,
  WORK_MODE_PROMPT_MAP,
} from '@shared/types/work-mode';
import type { WorkKitProviderCapability } from '@shared/types/work-provider';
import { summarizeWorkProviderCapabilities } from '@shared/types/work-provider';
import { cn } from '@/lib/utils';

type WorkModeSummaryPanelProps = {
  workMode: WorkModeId;
  promptMode?: PromptMode;
  permissionMode?: WorkspacePermissionMode;
  knowledgeScope: WorkspaceKnowledgeScope;
  skills?: WorkModeCapabilitySkill[];
  runtimeAvailable?: boolean;
  toolBundleConfig?: WorkModeToolBundleConfig | null;
  kitConfig?: WorkModeKitConfig | null;
  providerCapabilities?: WorkKitProviderCapability[];
  onPromptModeChange?: (mode: PromptMode) => void;
  compact?: boolean;
  className?: string;
};

const ICONS: Record<WorkModeId, typeof PanelsTopLeft> = {
  plan: PanelsTopLeft,
  build: CheckCircle2,
  review: BookOpen,
  docsData: FileText,
};

const PROMPT_MODE_CYCLE: PromptMode[] = ['full', 'minimal', 'none'];

function getPromptModeColor(mode: PromptMode, compact: boolean): string {
  const base = compact
    ? 'px-1.5 py-1 text-2xs'
    : 'px-2 py-0.5 text-tiny';
  const colors: Record<PromptMode, string> = {
    none: 'border-zinc-300 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/30 dark:text-zinc-400 dark:hover:bg-zinc-800/50',
    minimal: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-800/30 dark:text-emerald-400 dark:hover:bg-emerald-800/50',
    full: 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-600 dark:bg-blue-800/30 dark:text-blue-400 dark:hover:bg-blue-800/50',
  };
  return cn(base, colors[mode]);
}

function getPromptModeMarker(mode: PromptMode): string {
  const markers: Record<PromptMode, string> = { none: 'N', minimal: 'M', full: 'F' };
  return markers[mode];
}

export function WorkModeSummaryPanel({
  workMode,
  promptMode,
  permissionMode,
  knowledgeScope,
  skills = [],
  runtimeAvailable = true,
  toolBundleConfig,
  kitConfig,
  providerCapabilities = [],
  onPromptModeChange,
  compact = false,
  className,
}: WorkModeSummaryPanelProps) {
  const { t } = useTranslation(['chat', 'settings']);
  const preset = useMemo(
    () => resolveWorkModePreset(workMode, undefined, toolBundleConfig, kitConfig),
    [workMode, toolBundleConfig, kitConfig],
  );
  const Icon = ICONS[workMode];
  const effectivePromptMode: PromptMode = promptMode ?? WORK_MODE_PROMPT_MAP[workMode];

  const promptModeLabel = useMemo(() => {
    const labels: Record<PromptMode, { label: string; savings: string }> = {
      none: {
        label: t('workModePanel.intensityMode_none'),
        savings: '~3k-5k',
      },
      minimal: {
        label: t('workModePanel.intensityMode_minimal'),
        savings: '~1.5k-2.5k',
      },
      full: {
        label: t('workModePanel.intensityMode_full'),
        savings: '',
      },
    };
    return labels[effectivePromptMode];
  }, [effectivePromptMode, t]);

  const handlePromptModeToggle = useCallback(() => {
    if (!onPromptModeChange) return;
    const currentIndex = PROMPT_MODE_CYCLE.indexOf(effectivePromptMode);
    const nextIndex = (currentIndex + 1) % PROMPT_MODE_CYCLE.length;
    onPromptModeChange(PROMPT_MODE_CYCLE[nextIndex]);
  }, [effectivePromptMode, onPromptModeChange]);

  const permissionMismatch = Boolean(permissionMode && permissionMode !== preset.recommendedPermissionMode);
  const knowledgeScopeLabel = t(`composer.knowledgeScope.${knowledgeScope}`);
  const capabilities = useMemo(
    () => resolveWorkModeKitCapabilities(preset.kits, skills, runtimeAvailable),
    [preset.kits, skills, runtimeAvailable],
  );
  const selectedProviderCapabilities = useMemo(
    () => providerCapabilities.filter((capability) => preset.kits.includes(capability.kit)),
    [providerCapabilities, preset.kits],
  );
  const providerSummary = useMemo(
    () => summarizeWorkProviderCapabilities(
      selectedProviderCapabilities.flatMap((capability) => capability.statuses.map((status) => ({ status }))),
    ),
    [selectedProviderCapabilities],
  );
  const artifactTypes = useMemo(
    () => Array.from(new Set(capabilities.flatMap((capability) => capability.artifactTypes))),
    [capabilities],
  );
  const knowledgeText = t('workModePanel.knowledge', { scope: knowledgeScopeLabel });
  const permissionText = permissionMode
    ? t('workModePanel.permissionMismatch', {
      current: t(`composer.permissionMode.${permissionMode}`),
      recommended: t(`composer.permissionMode.${preset.recommendedPermissionMode}`),
    })
    : '';

  const intensityButtonClass = cn(
    'inline-flex items-center gap-1 rounded-full border font-medium leading-none transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    onPromptModeChange && 'cursor-pointer',
    getPromptModeColor(effectivePromptMode, compact),
  );

  const intensityContent = (
    <>
      <span className={cn('leading-none', compact ? 'text-[10px]' : 'text-[11px]')}>
        {getPromptModeMarker(effectivePromptMode)}
      </span>
      <span>{promptModeLabel.label}</span>
    </>
  );

  return (
    <section
      data-testid="work-mode-summary-panel"
      className={cn(
        'mx-auto mb-3 w-[min(48rem,calc(100%-2rem))] rounded-md border border-black/10 bg-surface-modal/95 px-3 py-2.5 text-sm shadow-sm backdrop-blur dark:border-white/10',
        compact && 'px-2.5 py-2 text-xs',
        className,
      )}
      aria-label={t(preset.labelKey)}
    >
      <div className={cn('flex items-start gap-3', compact && 'gap-2.5')}>
        <div className={cn(
          'mt-0.5 rounded-md bg-black/5 p-1.5 text-muted-foreground dark:bg-white/10',
          compact && 'p-1',
        )}>
          <Icon className={cn('h-3.5 w-3.5', compact && 'h-3 w-3')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', compact && 'gap-x-1.5')}>
            <h2 className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>{t(preset.labelKey)}</h2>
            <span
              className={cn(
                'text-muted-foreground',
                compact
                  ? 'rounded-sm bg-surface-input px-1.5 py-0.5 text-2xs leading-none'
                  : 'text-tiny',
              )}
            >
              {typeof knowledgeText === 'string' ? knowledgeText : `Knowledge: ${knowledgeScopeLabel}`}
            </span>
          </div>
          <p className={cn('mt-0.5 text-muted-foreground', compact ? 'line-clamp-1 text-2xs leading-4' : 'line-clamp-2 text-xs')}>
            {t(`workModePanel.summary.${workMode}`)}
          </p>
          {!compact && artifactTypes.length > 0 && (
            <p className="mt-1 text-tiny text-muted-foreground">
              {t('workModePanel.artifacts', {
                types: artifactTypes
                  .map((type) => t(`workModePanel.artifactTypes.${type}`, { defaultValue: type.toUpperCase() }))
                  .join(', '),
              })}
            </p>
          )}
          {!compact && selectedProviderCapabilities.length > 0 && (
            <p className={cn('mt-1 text-muted-foreground', compact ? 'text-2xs leading-4' : 'text-tiny')}>
              {t('workModePanel.providerStatus', {
                ready: providerSummary.ready,
                missingDependency: providerSummary.missingDependency,
                missingConfig: providerSummary.missingConfig,
                externalUnavailable: providerSummary.externalUnavailable,
              })}
            </p>
          )}
          {!compact && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {capabilities.map((capability) => {
                const definition = WORK_MODE_KIT_DEFINITIONS[capability.kit];
                return (
                  <span
                    key={capability.kit}
                    className={cn(
                      'rounded-md border px-2 py-0.5 text-tiny',
                      capability.status === 'ready'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : capability.status === 'missingSkill' || capability.status === 'disabled'
                          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'
                          : 'border-black/10 bg-black/[0.03] text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]',
                    )}
                  >
                    {t('workModePanel.kitStatus', {
                      kit: t(definition.labelKey, { ns: 'settings' }),
                      status: t(`workModePanel.capability.${capability.status}`),
                    })}
                  </span>
                );
              })}
            </div>
          )}
          {permissionMismatch && permissionMode && (
            <p className={cn('mt-1 text-amber-700 dark:text-amber-400', compact ? 'text-2xs' : 'text-tiny')}>
              {typeof permissionText === 'string' ? permissionText : ''}
            </p>
          )}
          <div className={cn('flex flex-wrap items-center gap-1.5', compact ? 'mt-1.5' : 'mt-2')}>
            {onPromptModeChange ? (
              <button
                type="button"
                data-testid="work-mode-intensity-toggle"
                onClick={handlePromptModeToggle}
                title={t('workModePanel.intensity')}
                aria-label={t('workModePanel.intensity')}
                className={intensityButtonClass}
              >
                {intensityContent}
              </button>
            ) : (
              <span
                data-testid="work-mode-intensity-badge"
                title={t('workModePanel.intensity')}
                className={intensityButtonClass}
              >
                {intensityContent}
              </span>
            )}
            {!compact && effectivePromptMode !== 'full' && (
              <span className="text-tiny text-muted-foreground">
                {t('workModePanel.tokenSavings', { tokens: promptModeLabel.savings })}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
