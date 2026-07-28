/**
 * FP-P1-02: Setup wizard Workspace preflight + permission step.
 *
 * The chosen directory becomes the SINGLE workspace authority: the created
 * profile is activated and its rootPath is synced into the gateway config
 * (agents.defaults.workspace) by the workspaces service, eliminating the
 * historical "cwd as a second authority" split. Permission is explicit:
 * read-only, or controlled write limited to the workspace boundary.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, FolderOpen, Info, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import type { WorkspacePreflightResult } from '@shared/host-api/contract';

export type WorkspaceSetupOutcome = {
  workspaceId: string;
  rootPath: string;
  permissionMode: 'readOnly' | 'acceptEdits';
};

interface WorkspaceStepContentProps {
  confirmed: WorkspaceSetupOutcome | null;
  onConfirmed: (outcome: WorkspaceSetupOutcome | null) => void;
}

const CHECK_ORDER = ['exists', 'readable', 'writable', 'git', 'sensitivePath', 'diskSpace'] as const;

export function WorkspaceStepContent({ confirmed, onConfirmed }: WorkspaceStepContentProps) {
  const { t } = useTranslation('setup');
  const [preflight, setPreflight] = useState<WorkspacePreflightResult | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<'readOnly' | 'acceptEdits'>('acceptEdits');
  const [createError, setCreateError] = useState<string | null>(null);

  const pickFolder = async () => {
    setPicking(true);
    setCreateError(null);
    try {
      const picked = await hostApi.dialog.open({
        title: t('workspace.pickTitle'),
        properties: ['openDirectory', 'createDirectory'],
      });
      const paths = (picked as { filePaths?: string[]; canceled?: boolean }) ?? {};
      const rootPath = paths.filePaths?.[0];
      if (paths.canceled || !rootPath) return;
      onConfirmed(null);
      const result = await hostApi.workspaces.preflight(rootPath);
      setPreflight(result);
      if (result.readOnlyOnly) setMode('readOnly');
    } finally {
      setPicking(false);
    }
  };

  const confirmWorkspace = async () => {
    if (!preflight?.ok) return;
    const effectiveMode = preflight.readOnlyOnly ? 'readOnly' : mode;
    setCreating(true);
    setCreateError(null);
    try {
      const snapshot = await hostApi.workspaces.create({
        rootPath: preflight.resolvedPath,
        permissionMode: effectiveMode,
      });
      const workspaceId = (snapshot as { activeWorkspaceId?: string }).activeWorkspaceId;
      if (!workspaceId) throw new Error('workspace was not activated');
      onConfirmed({
        workspaceId,
        rootPath: preflight.resolvedPath,
        permissionMode: effectiveMode,
      });
    } catch (error) {
      setCreateError(String(error));
      onConfirmed(null);
    } finally {
      setCreating(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" />;
      case 'info':
        return <Info className="h-4 w-4 text-muted-foreground" />;
      case 'warn':
        return <AlertCircle className="h-4 w-4 text-yellow-700 dark:text-yellow-400" />;
      default:
        return <XCircle className="h-4 w-4 text-red-700 dark:text-red-400" />;
    }
  };

  return (
    <div data-testid="setup-workspace-step" className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('workspace.stepIntro')}</p>

      <div className="flex items-center gap-3">
        <Button data-testid="setup-workspace-pick" onClick={() => void pickFolder()} disabled={picking}>
          {picking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
          {t('workspace.pickButton')}
        </Button>
        {preflight && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {preflight.resolvedPath}
          </span>
        )}
      </div>

      {preflight && (
        <div data-testid="setup-workspace-preflight" className="space-y-1 rounded-lg border border-border p-3">
          {CHECK_ORDER.map((id) => {
            const check = preflight.checks.find((entry) => entry.id === id);
            if (!check) return null;
            return (
              <div key={id} className="flex items-center gap-2 text-sm" data-testid={`setup-workspace-check-${id}-${check.status}`}>
                {statusIcon(check.status)}
                <span>{t(`workspace.checks.${id}`)}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(`workspace.details.${check.detail.split(':')[0]}`, {
                    defaultValue: check.detail,
                    extra: check.detail.split(':')[1] ?? '',
                  })}
                </span>
              </div>
            );
          })}
          {!preflight.ok && (
            <p data-testid="setup-workspace-blocked" className="pt-1 text-sm text-red-700 dark:text-red-400">
              {t('workspace.blocked')}
            </p>
          )}
          {preflight.readOnlyOnly && (
            <p className="pt-1 text-sm text-yellow-700 dark:text-yellow-400">
              {t('workspace.readOnlyFallback')}
            </p>
          )}
        </div>
      )}

      {preflight?.ok && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('workspace.permissionTitle')}</p>
          {(['readOnly', 'acceptEdits'] as const).map((candidate) => {
            const disabled = candidate === 'acceptEdits' && preflight.readOnlyOnly;
            return (
              <button
                key={candidate}
                type="button"
                data-testid={`setup-workspace-mode-${candidate}`}
                disabled={disabled}
                onClick={() => {
                  setMode(candidate);
                  onConfirmed(null);
                }}
                className={cn(
                  'flex w-full flex-col rounded-lg border p-3 text-left text-sm',
                  disabled && 'opacity-50',
                  mode === candidate && !disabled
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-surface-input/50',
                )}
              >
                <span className="font-medium">{t(`workspace.modes.${candidate}.title`)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`workspace.modes.${candidate}.desc`)}
                </span>
              </button>
            );
          })}
          <div className="flex items-center gap-3 pt-1">
            <Button
              data-testid="setup-workspace-confirm"
              disabled={creating}
              onClick={() => void confirmWorkspace()}
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('workspace.confirming')}
                </>
              ) : (
                t('workspace.confirmButton')
              )}
            </Button>
            {confirmed && (
              <span
                data-testid="setup-workspace-confirmed"
                className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t('workspace.confirmedAs', {
                  mode: t(`workspace.modes.${confirmed.permissionMode}.title`),
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {createError && (
        <p className="text-sm text-red-700 dark:text-red-400">{createError}</p>
      )}
    </div>
  );
}
