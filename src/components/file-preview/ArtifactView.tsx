import { useCallback } from 'react';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { hostApi } from '@/lib/host-api';
import type { WorkArtifact, ArtifactAction } from '@shared/types/work-artifact';
import { cn } from '@/lib/utils';
import { FilePreviewBody } from './FilePreviewBody';
import type { FilePreviewTarget } from './types';

interface ArtifactViewProps {
  artifacts: WorkArtifact[];
  selectedArtifactId: string | null;
  onSelect: (id: string) => void;
  onValidate: (id: string) => void;
  generating: boolean;
  compact?: boolean;
}

function artifactToFileTarget(artifact: WorkArtifact): FilePreviewTarget {
  return {
    filePath: artifact.filePath,
    fileName: artifact.fileName,
    ext: artifact.ext,
    mimeType: artifact.mimeType,
    contentType: artifact.htmlContent
      ? 'document'
      : /^(docx?|pdf)$/i.test(artifact.ext)
        ? 'document'
        : /^(xlsx?|csv)$/i.test(artifact.ext)
          ? 'other'
          : 'code',
    fullContent: artifact.htmlContent,
    size: artifact.size,
  };
}

function artifactIcon(artifact: WorkArtifact, className?: string) {
  if (artifact.status === 'generating' || artifact.status === 'pending') {
    return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />;
  }
  if (artifact.status === 'invalid' || artifact.status === 'validationError' || artifact.status === 'error') {
    return <XCircle className={cn('h-4 w-4 text-destructive', className)} />;
  }
  if (artifact.status === 'ready' && artifact.validation?.valid !== false) {
    return <CheckCircle2 className={cn('h-4 w-4 text-emerald-500', className)} />;
  }
  return <Loader2 className={cn('h-4 w-4 text-amber-500', className)} />;
}

function statusLabelKey(status: string): string {
  if (status === 'generating' || status === 'pending') return 'artifactView.status.generating';
  if (status === 'ready') return 'artifactView.status.ready';
  if (status === 'invalid') return 'artifactView.status.invalid';
  if (status === 'validationError') return 'artifactView.status.validationError';
  return 'artifactView.status.error';
}

export function ArtifactView({ artifacts, selectedArtifactId, onSelect, onValidate, generating, compact = false }: ArtifactViewProps) {
  const { t } = useTranslation('chat');
  const selected = artifacts.find((a) => a.id === selectedArtifactId);

  const handleAction = useCallback((artifact: WorkArtifact, action: ArtifactAction) => {
    switch (action.type) {
      case 'validate':
        onValidate(artifact.id);
        break;
      case 'openFolder':
        hostApi.shell.showItemInFolder(artifact.filePath).catch(() => {
          toast.error(t('filePreview.errors.openInFinderFailed'));
        });
        break;
      case 'preview':
        onSelect(artifact.id);
        break;
      case 'revise':
        onSelect(artifact.id);
        break;
    }
  }, [onSelect, onValidate, t]);

  if (compact) {
    return (
      <div className="space-y-1.5 px-1" data-testid="artifact-view-compact">
        {artifacts.length === 0 && !generating && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {t('artifactView.empty', 'No artifacts generated yet')}
          </p>
        )}
        {generating && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{t('artifactView.generating', 'Generating...')}</span>
          </div>
        )}
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => handleAction(artifact, { type: 'preview' })}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5',
              selected?.id === artifact.id && 'bg-black/5 dark:bg-white/10',
            )}
          >
            {artifactIcon(artifact)}
            <span className="min-w-0 flex-1 truncate font-medium">{artifact.title}</span>
            <span className="shrink-0 text-tiny text-muted-foreground">{artifact.ext.toUpperCase()}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="artifact-view">
      <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-3 py-2 dark:border-white/10">
        <h3 className="text-xs font-medium text-foreground">{t('artifactView.title', 'Artifacts')}</h3>
        {generating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-black/5 dark:border-white/10">
          {artifacts.length === 0 && !generating && (
            <div className="flex flex-1 items-center justify-center px-3 text-center text-xs text-muted-foreground">
              {t('artifactView.empty', 'No artifacts generated yet')}
            </div>
          )}
          {artifacts.map((artifact) => (
            <div key={artifact.id} className="group flex flex-col border-b border-black/[0.03] dark:border-white/[0.03]">
              <button
                type="button"
                onClick={() => onSelect(artifact.id)}
                className={cn(
                  'flex flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                  selected?.id === artifact.id && 'bg-black/5 dark:bg-white/10',
                )}
              >
                <div className="flex items-center gap-2">
                  {artifactIcon(artifact)}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{artifact.title}</span>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-tiny text-muted-foreground">{artifact.fileName}</span>
                  <span className={cn(
                    'text-tiny',
                    artifact.status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                  )}>
                    {t(statusLabelKey(artifact.status))}
                  </span>
                </div>
                <div className="flex items-center gap-1 pl-6 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleAction(artifact, { type: 'validate' }); }}
                    className="rounded px-1.5 py-0.5 text-tiny text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleAction(artifact, { type: 'openFolder' }); }}
                    className="rounded px-1.5 py-0.5 text-tiny text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </button>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {selected ? (
            <FilePreviewBody key={selected.id} file={artifactToFileTarget(selected)} compact mode="preview" />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              {t('artifactView.selectHint', 'Select an artifact to preview')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ArtifactView;
