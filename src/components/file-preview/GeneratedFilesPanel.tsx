import { FileText, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FileLineStatsLabel } from '@/components/tool-ui/shared/file-line-stats';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import {
  computeLineStats,
  supportsInlineDiff,
  supportsInlineDocumentPreview,
  supportsRichDocumentPreview,
  type GeneratedFile,
} from '@/lib/generated-files';

export interface GeneratedFilesPanelProps {
  files: GeneratedFile[];
  onOpen: (file: GeneratedFile) => void;
  onRevealInFileManager?: (file: GeneratedFile) => void;
  className?: string;
}

export function GeneratedFilesPanel({
  files,
  onOpen,
  onRevealInFileManager,
  className,
}: GeneratedFilesPanelProps) {
  const { t } = useTranslation('chat');
  if (!files.length) return null;

  const revealInFileManager = (file: GeneratedFile) => {
    if (onRevealInFileManager) {
      onRevealInFileManager(file);
      return;
    }
    void hostApi.shell.showItemInFolder(file.filePath);
  };

  return (
    <div className={cn('git-surface space-y-0.5', className)} data-testid="chat-generated-files">
      <p className="pb-0.5 text-xs font-medium text-muted-foreground">
        {t('generatedFiles.title', { count: files.length, defaultValue: 'File changes ({{count}})' })}
      </p>
      {files.map((file) => {
        const lineStats = computeLineStats(file);
        const clickable = supportsInlineDiff(file) || supportsInlineDocumentPreview(file.ext);
        const revealOnly = supportsRichDocumentPreview(file.ext);
        const onClick = revealOnly
          ? () => revealInFileManager(file)
          : clickable
            ? () => onOpen(file)
            : undefined;
        return (
          <button
            key={`${file.filePath}-${file.lastSeenIndex}`}
            type="button"
            disabled={!onClick}
            onClick={onClick}
            className={cn(
              'git-row group/file flex min-h-8 w-full min-w-0 items-center gap-2 text-left text-sm text-muted-foreground',
              onClick && 'hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              !onClick && 'cursor-default',
            )}
            title={file.filePath}
          >
            {revealOnly
              ? <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              : <FileText className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{file.fileName}</span><span className="block truncate text-[11px] font-normal text-muted-foreground">{file.filePath}</span></span>
            {lineStats && <FileLineStatsLabel stats={lineStats} />}
            <span className="shrink-0 text-xs text-muted-foreground/75">
              {revealOnly
                ? t('generatedFiles.openFolder', 'Open folder')
                : file.action === 'created'
                  ? t('generatedFiles.created', 'Created')
                  : t('generatedFiles.modified', 'Modified')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default GeneratedFilesPanel;
