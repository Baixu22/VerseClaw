import { BookOpen, CheckCircle2, FileText, PanelsTopLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceKnowledgeScope, WorkspacePermissionMode } from '@shared/types/workspace';
import type {
  WorkModeCapabilitySkill,
  WorkModeKitConfig,
  WorkModeId,
  WorkModeToolBundleConfig,
} from '@shared/types/work-mode';
import {
  resolveWorkModeKitCapabilities,
  resolveWorkModePreset,
  WORK_MODE_KIT_DEFINITIONS,
} from '@shared/types/work-mode';
import { cn } from '@/lib/utils';

type WorkModeSummaryPanelProps = {
  workMode: WorkModeId;
  permissionMode?: WorkspacePermissionMode;
  knowledgeScope: WorkspaceKnowledgeScope;
  skills?: WorkModeCapabilitySkill[];
  runtimeAvailable?: boolean;
  toolBundleConfig?: WorkModeToolBundleConfig | null;
  kitConfig?: WorkModeKitConfig | null;
  compact?: boolean;
};

const ICONS: Record<WorkModeId, typeof PanelsTopLeft> = {
  plan: PanelsTopLeft,
  build: CheckCircle2,
  review: BookOpen,
  docsData: FileText,
};

export function WorkModeSummaryPanel({
  workMode,
  permissionMode,
  knowledgeScope,
  skills = [],
  runtimeAvailable = true,
  toolBundleConfig,
  kitConfig,
  compact = false,
}: WorkModeSummaryPanelProps) {
  const { t } = useTranslation(['chat', 'settings']);
  const preset = resolveWorkModePreset(workMode, undefined, toolBundleConfig, kitConfig);
  const Icon = ICONS[workMode];
  const permissionMismatch = Boolean(permissionMode && permissionMode !== preset.recommendedPermissionMode);
  const knowledgeScopeLabel = t(`composer.knowledgeScope.${knowledgeScope}`);
  const capabilities = resolveWorkModeKitCapabilities(preset.kits, skills, runtimeAvailable);
  const artifactTypes = Array.from(new Set(capabilities.flatMap((capability) => capability.artifactTypes)));
  const knowledgeText = t('workModePanel.knowledge', { scope: knowledgeScopeLabel });
  const permissionText = permissionMode
    ? t('workModePanel.permissionMismatch', {
      current: t(`composer.permissionMode.${permissionMode}`),
      recommended: t(`composer.permissionMode.${preset.recommendedPermissionMode}`),
    })
    : '';

  return (
    <section
      data-testid="work-mode-summary-panel"
      className={cn(
        'mx-auto mb-3 w-[min(48rem,calc(100%-2rem))] rounded-xl border border-black/10 bg-surface-modal/95 px-3 py-2.5 text-sm shadow-sm dark:border-white/10',
        compact && 'text-xs',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-black/5 p-1.5 text-muted-foreground dark:bg-white/10">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-medium text-foreground">{t(preset.labelKey)}</h2>
            <span className="text-tiny text-muted-foreground">
              {typeof knowledgeText === 'string' ? knowledgeText : `Knowledge: ${knowledgeScopeLabel}`}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`workModePanel.summary.${workMode}`)}</p>
          {artifactTypes.length > 0 && (
            <p className="mt-1 text-tiny text-muted-foreground">
              {t('workModePanel.artifacts', {
                types: artifactTypes
                  .map((type) => t(`workModePanel.artifactTypes.${type}`, { defaultValue: type.toUpperCase() }))
                  .join(', '),
              })}
            </p>
          )}
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
          {permissionMismatch && permissionMode && (
            <p className="mt-1 text-tiny text-amber-700 dark:text-amber-400">
              {typeof permissionText === 'string' ? permissionText : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
