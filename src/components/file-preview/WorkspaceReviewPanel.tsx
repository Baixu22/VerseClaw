import { useTranslation } from 'react-i18next';
import { CodeReviewPanel } from '@/pages/CodeReview';
import { RemoteForgePanel } from '@/pages/CodeReview/RemoteForgePanel';
import { cn } from '@/lib/utils';
import { useArtifactPanel } from '@/stores/artifact-panel';
import type { WorkspaceArtifactPanelState, WorkspaceReviewView } from '@shared/types/workspace';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import { FilePreviewBody } from './FilePreviewBody';

const REVIEW_VIEWS: readonly WorkspaceReviewView[] = ['changes', 'ai-review', 'pull-requests'];

export function WorkspaceReviewPanel({
  sessionState,
  onSessionStateChange,
}: {
  sessionState?: WorkspaceArtifactPanelState;
  onSessionStateChange?: (patch: WorkspaceArtifactPanelState) => void;
}) {
  const { t } = useTranslation('chat');
  const view = useArtifactPanel((state) => state.reviewView);
  const setReviewView = useArtifactPanel((state) => state.setReviewView);
  const intentSelectedPath = useArtifactPanel((state) => state.selectedPath);
  const setIntentSelectedPath = useArtifactPanel((state) => state.setSelectedPath);
  const focusedFile = useArtifactPanel((state) => state.focusedFile);

  const selectView = (next: WorkspaceReviewView) => {
    setReviewView(next);
    onSessionStateChange?.({ reviewView: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workspace-review-panel">
      <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-2">
        <div className="inline-flex h-7 items-center rounded-md bg-black/[0.035] p-0.5 dark:bg-white/[0.055]" role="tablist" aria-label={t('workspace.review.views.label')}>
          {REVIEW_VIEWS.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={view === entry}
              data-testid={`workspace-review-view-${entry}`}
              className={cn(
                'h-6 rounded px-2 text-xs text-muted-foreground transition-colors duration-150 motion-reduce:transition-none',
                view === entry && 'bg-background text-foreground shadow-[0_0_0_1px_hsl(var(--border)/0.55)]',
              )}
              onClick={() => selectView(entry)}
            >
              {t(`workspace.review.views.${entry}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('min-h-0 flex-1', view === 'changes' ? 'overflow-hidden' : 'overflow-auto')}>
        {view === 'changes' && (
          focusedFile ? (
            <FilePreviewBody key={focusedFile.filePath} file={focusedFile} compact mode="diff" />
          ) : (
            <WorkspaceGitPanel
              selectedPath={sessionState?.gitSelectedPath ?? intentSelectedPath}
              diffMode={sessionState?.gitDiffMode ?? 'unstaged'}
              onSelectedPathChange={(gitSelectedPath) => {
                setIntentSelectedPath(gitSelectedPath);
                onSessionStateChange?.({ gitSelectedPath });
              }}
              onDiffModeChange={(gitDiffMode) => onSessionStateChange?.({ gitDiffMode })}
            />
          )
        )}
        {view === 'ai-review' && <CodeReviewPanel embedded />}
        {view === 'pull-requests' && <RemoteForgePanel />}
      </div>
    </div>
  );
}
