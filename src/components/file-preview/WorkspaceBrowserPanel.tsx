import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useArtifactPanel } from '@/stores/artifact-panel';
import type { WorkspaceArtifactPanelState, WorkspaceBrowserView } from '@shared/types/workspace';
import { WorkspaceLiveBrowserPanel } from './WorkspaceLiveBrowserPanel';
import { WorkspaceWebPreviewPanel } from './WorkspaceWebPreviewPanel';

export function WorkspaceBrowserPanel({
  onOpenWorkspaceWebView,
  onAppendComposerDraft,
  onSessionStateChange,
}: {
  onOpenWorkspaceWebView?: () => void;
  onAppendComposerDraft?: (text: string) => void;
  onSessionStateChange?: (patch: WorkspaceArtifactPanelState) => void;
}) {
  const { t } = useTranslation('chat');
  const view = useArtifactPanel((state) => state.browserView);
  const setBrowserView = useArtifactPanel((state) => state.setBrowserView);
  const selectView = (next: WorkspaceBrowserView) => {
    setBrowserView(next);
    onSessionStateChange?.({ browserView: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workspace-browser-panel">
      <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-2">
        <div className="inline-flex h-7 items-center rounded-md bg-black/[0.035] p-0.5 dark:bg-white/[0.055]" role="tablist" aria-label={t('workspace.browser.views.label')}>
          {(['preview', 'live'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={view === entry}
              data-testid={`workspace-browser-view-${entry}`}
              className={cn('h-6 rounded px-2 text-xs text-muted-foreground transition-colors duration-150 motion-reduce:transition-none', view === entry && 'bg-background text-foreground shadow-[0_0_0_1px_hsl(var(--border)/0.55)]')}
              onClick={() => selectView(entry)}
            >
              {t(`workspace.browser.views.${entry}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'preview' ? (
          <WorkspaceWebPreviewPanel onOpenWorkspaceWebView={onOpenWorkspaceWebView} onAppendComposerDraft={onAppendComposerDraft} />
        ) : (
          <WorkspaceLiveBrowserPanel onSessionStateChange={onSessionStateChange} />
        )}
      </div>
    </div>
  );
}
