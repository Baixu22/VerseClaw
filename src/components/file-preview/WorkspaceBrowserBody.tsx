/**
 * Inline workspace browser body — left tree + right preview.
 *
 * Strictly scoped to the current agent's `agent.workspace` directory.
 * Used by `ArtifactPanel`'s browser tab (split-pane on the chat page).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { ArrowLeft, Ellipsis, RefreshCw } from '@/components/icons/codex-icons';
import { readTextFile, statFile } from '@/lib/file-preview-client';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import {
  isHtmlPreviewExt,
  isOfficePreviewExt,
  isPdfPreviewExt,
  isSheetPreviewExt,
  supportsInlineDocumentPreview,
  supportsRichDocumentPreview,
} from '@/lib/generated-files';
import {
  collectInitialExpanded,
  findNode,
  loadWorkspaceTree,
  type WorkspaceTreeNode,
} from '@/lib/workspace-tree';
import type { AgentSummary } from '@/types/agent';
import { FileTree } from '@/components/ai-elements/file-tree';
import { FilePreviewIcon } from './file-card-utils';
import { formatFileSize } from './format';
import {
  confirmAndOpenFile,
  shouldOfferDirectOpenFallback,
} from './open-file-utils';
import MarkdownPreview from './MarkdownPreview';
import HtmlPreview from './HtmlPreview';
import ImageViewer from './ImageViewer';
import OfficePreview from './OfficePreview';

const MonacoViewerLazy = lazy(() => import('./MonacoViewer'));
const PdfViewerLazy = lazy(() => import('./PdfViewer'));
const SheetViewerLazy = lazy(() => import('./SheetViewer'));

/** Inline rich-doc viewers tap out past this — falls back to direct open. */
const RICH_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

export interface WorkspaceBrowserBodyProps {
  agent: AgentSummary | null;
  /** Used to mark "Added this run" badges on the tree. */
  runStartedAt?: number | null;
  /** Bumping this number triggers a tree reload (e.g. after AI run idles). */
  refreshSignal?: number;
  /** Compact mode used inside the side panel (smaller fonts/paddings). */
  compact?: boolean;
  /** Left tree column width in px. */
  treeWidth?: number;
  /** Optional slot rendered in the toolbar (e.g. close button when used in a Sheet). */
  toolbarTrailing?: React.ReactNode;
  selectedPath?: string | null;
  onSelectedPathChange?: (path: string | null) => void;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; root: WorkspaceTreeNode; truncated: boolean }
  | { status: 'error'; message: string };

type FileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'tooLarge'; size?: number }
  | { status: 'binary'; size?: number }
  | { status: 'unsupported'; size?: number }
  | { status: 'error'; message: string };

export function WorkspaceBrowserBody({
  agent,
  runStartedAt,
  refreshSignal,
  compact = false,
  treeWidth,
  toolbarTrailing,
  selectedPath,
  onSelectedPathChange,
}: WorkspaceBrowserBodyProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [fileState, setFileState] = useState<FileState>({ status: 'idle' });
  const [refreshTick, setRefreshTick] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [treePaneWidth, setTreePaneWidth] = useState(treeWidth ?? (compact ? 208 : 268));
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 960);
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);

  const workspace = activeWorkspace?.rootPath || agent?.workspace || '';
  const workspaceLabel = activeWorkspace?.name || agent?.name || '';

  const normalizeSelectedPath = useCallback((path: string | null | undefined) => {
    if (!path) return null;
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedRoot = workspace.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return normalizedPath.slice(normalizedRoot.length + 1);
    }
    return normalizedPath;
  }, [workspace]);

  const reload = useCallback(() => setRefreshTick((v) => v + 1), []);

  // Reset selection when the workspace changes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on agent switch */
    setSelectedRel(normalizeSelectedPath(selectedPath));
    setFileState({ status: 'idle' });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activeWorkspace?.id, agent?.id, normalizeSelectedPath, selectedPath]);

  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= 960);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const selectRelPath = useCallback((relPath: string | null) => {
    setSelectedRel(relPath);
    onSelectedPathChange?.(relPath);
  }, [onSelectedPathChange]);

  const beginTreeResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (narrow) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treePaneWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setTreePaneWidth(Math.min(420, Math.max(160, startWidth + moveEvent.clientX - startX)));
    };
    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
  }, [narrow, treePaneWidth]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async tree fetch
    setState({ status: 'loading' });
    loadWorkspaceTree(workspace, {
      runStartedAt: runStartedAt ?? null,
      includeHidden: showHidden,
    })
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setState({ status: 'error', message: 'load' });
          return;
        }
        setState({ status: 'ready', root: res.root, truncated: res.truncated });
        setExpanded((prev) => (prev.size > 0 ? prev : collectInitialExpanded(res.root, 1)));
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, runStartedAt, refreshTick, showHidden, refreshSignal]);

  const selectedNode = useMemo(() => {
    if (!selectedRel || state.status !== 'ready') return null;
    return findNode(state.root, selectedRel);
  }, [selectedRel, state]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- selection-driven loader */
    if (!selectedNode || selectedNode.isDir) {
      setFileState({ status: 'idle' });
      return;
    }
    const node = selectedNode;
    let cancelled = false;
    if (node.contentType === 'document' && !supportsInlineDocumentPreview(node.ext ?? '')) {
      setFileState({ status: 'loading' });
      void statFile(node.absPath)
        .then((res) => {
          if (cancelled) return;
          setFileState({ status: 'unsupported', size: res.ok ? res.size : undefined });
        })
        .catch(() => {
          if (cancelled) return;
          setFileState({ status: 'unsupported' });
        });
      return () => {
        cancelled = true;
      };
    }
    if (supportsRichDocumentPreview(node.ext ?? '')) {
      // PDF / spreadsheet viewers handle their own loading; we only need
      // a stat for the badge / direct-open fallbacks.  Files that exceed
      // the inline cap fall back to the existing tooLarge UI so users
      // can still open them with the system default app.
      setFileState({ status: 'loading' });
      void statFile(node.absPath)
        .then((res) => {
          if (cancelled) return;
          if (res.ok && typeof res.size === 'number' && res.size > RICH_PREVIEW_MAX_BYTES) {
            setFileState({ status: 'tooLarge', size: res.size });
            return;
          }
          setFileState({ status: 'ready', content: '' });
        })
        .catch(() => {
          if (cancelled) return;
          setFileState({ status: 'ready', content: '' });
        });
      return () => {
        cancelled = true;
      };
    }
    if (node.contentType === 'snapshot' || node.contentType === 'video' || node.contentType === 'audio') {
      setFileState({ status: 'ready', content: '' });
      return;
    }
    setFileState({ status: 'loading' });
    /* eslint-enable react-hooks/set-state-in-effect */
    readTextFile(node.absPath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.error === 'tooLarge') {
            setFileState({ status: 'tooLarge', size: res.size });
            return;
          }
          if (res.error === 'binary') {
            setFileState({ status: 'binary', size: res.size });
            return;
          }
          setFileState({ status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        setFileState({ status: 'ready', content: res.content ?? '' });
      })
      .catch((err) => {
        if (cancelled) return;
        setFileState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  const handleOpenWorkspaceInFinder = useCallback(() => {
    if (!workspace) return;
    hostApi.shell.openPath(workspace).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', 'Could not reveal in file manager'));
    });
  }, [workspace, t]);

  const handleOpenSelectedInFinder = useCallback(() => {
    if (!selectedNode || selectedNode.isDir) return;
    hostApi.shell.showItemInFolder(selectedNode.absPath).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', 'Could not reveal in file manager'));
    });
  }, [selectedNode, t]);

  const handleOpenSelectedDirectly = useCallback(async () => {
    if (!selectedNode || selectedNode.isDir) return;
    const currentSize =
      fileState.status === 'tooLarge' || fileState.status === 'binary' || fileState.status === 'unsupported'
        ? fileState.size
        : undefined;
    try {
      await confirmAndOpenFile({
        filePath: selectedNode.absPath,
        fileName: selectedNode.name,
        size: currentSize,
        t,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('filePreview.errors.openFailed', { defaultValue: 'Open failed: {{error}}', error: message }));
    }
  }, [selectedNode, fileState, t]);

  const toggleNode = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const renderTree = () => {
    if (state.status === 'loading' || state.status === 'idle') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      );
    }
    if (state.status === 'error') {
      return (
        <div className="px-4 py-6 text-xs text-destructive">
          {state.message === 'outsideSandbox'
            ? t('filePreview.errors.outsideSandbox', 'Path is outside the workspace; read denied')
            : t('workspace.empty', 'Workspace is empty or inaccessible')}
        </div>
      );
    }
    return (
      <div className="space-y-1 overflow-y-auto">
        <FileTree
          nodes={state.root.children ?? []}
          expanded={expanded}
          selectedRel={selectedRel}
          onToggle={toggleNode}
          onSelect={selectRelPath}
          freshLabel={t('workspace.freshBadge', 'Added this run')}
          renderIcon={(node) => (
            <FilePreviewIcon
              contentType={node.contentType}
              mimeType={node.mimeType}
              ext={node.ext}
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
          )}
        />
        {state.truncated && (
          <div className="mt-2 px-3 py-2 text-2xs text-muted-foreground/80">
            {t('workspace.truncated', 'Directory too large; truncated to first 5000 nodes')}
          </div>
        )}
      </div>
    );
  };

  const renderBody = () => {
    if (selectedRel && state.status === 'ready' && !selectedNode) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
          {t('filePreview.errors.notFound', 'File not found')}
        </div>
      );
    }
    if (!selectedNode || selectedNode.isDir) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('workspace.pickFile', 'Select a file on the left to preview')}
        </div>
      );
    }
    if (selectedNode.contentType === 'snapshot') {
      return <ImageViewer filePath={selectedNode.absPath} fileName={selectedNode.name} />;
    }
    if (isOfficePreviewExt(selectedNode.ext)) {
      return <OfficePreview filePath={selectedNode.absPath} fileName={selectedNode.name} />;
    }
    if (isPdfPreviewExt(selectedNode.ext)) {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          }
        >
          <PdfViewerLazy filePath={selectedNode.absPath} fileName={selectedNode.name} surface="workspace" />
        </Suspense>
      );
    }
    if (isSheetPreviewExt(selectedNode.ext)) {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          }
        >
          <SheetViewerLazy filePath={selectedNode.absPath} fileName={selectedNode.name} />
        </Suspense>
      );
    }
    if (fileState.status === 'loading' || fileState.status === 'idle') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }
    if (fileState.status === 'tooLarge') {
      const directOpen = shouldOfferDirectOpenFallback(selectedNode.ext, fileState.size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>
            {directOpen
              ? t('filePreview.errors.largeBinaryOpenHint', {
                defaultValue: 'This file is {{size}}. Verse Claw does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                size: formatFileSize(fileState.size ?? 0) || '> 2MB',
              })
              : t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenSelectedDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenSelectedInFinder}>
              <Folder className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>
          </div>
        </div>
      );
    }
    if (fileState.status === 'binary') {
      const directOpen = shouldOfferDirectOpenFallback(selectedNode.ext, fileState.size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>
            {directOpen
              ? t('filePreview.errors.largeBinaryOpenHint', {
                defaultValue: 'This file is {{size}}. Verse Claw does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                size: formatFileSize(fileState.size ?? 0) || '> 2MB',
              })
              : t('filePreview.errors.binary', 'Binary files do not support text preview')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenSelectedDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenSelectedInFinder}>
              <Folder className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>
          </div>
        </div>
      );
    }
    if (fileState.status === 'error') {
      const errMsg = fileState.message;
      const hint = errMsg === 'outsideSandbox'
        ? t('filePreview.errors.outsideSandbox', 'Path is outside the workspace; read denied')
        : errMsg === 'notFound'
          ? t('filePreview.errors.notFound', 'File not found')
          : errMsg;
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
          {hint}
        </div>
      );
    }
    if (fileState.status === 'unsupported') {
      const directOpen = shouldOfferDirectOpenFallback(selectedNode.ext, fileState.size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              {directOpen
                ? t('filePreview.errors.largeBinaryOpenTitle', 'This file is too large for inline preview')
                : t('filePreview.errors.unsupportedFormatTitle', 'This file format is not supported for inline preview or diff')}
            </p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {directOpen
                ? t('filePreview.errors.largeBinaryOpenHint', {
                  defaultValue: 'This file is {{size}}. Verse Claw does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                  size: formatFileSize(fileState.size ?? 0) || '> 2MB',
                })
                : t(
                  'filePreview.errors.unsupportedFormatHint',
                  'Only directly readable files such as text and Markdown support inline preview and diff. Please open this file in your file manager.',
                )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenSelectedDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenSelectedInFinder}>
              <Folder className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>
          </div>
        </div>
      );
    }

    if (isHtmlPreviewExt(selectedNode.ext)) {
      return (
        <HtmlPreview
          source={fileState.content}
          filePath={selectedNode.absPath}
          fileName={selectedNode.name}
        />
      );
    }

    if (selectedNode.contentType === 'document') {
      return (
        <div className="h-full overflow-hidden">
          <MarkdownPreview source={fileState.content} />
        </div>
      );
    }

    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        }
      >
        <MonacoViewerLazy filePath={selectedNode.absPath} value={fileState.content} readOnly />
      </Suspense>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'flex h-8 shrink-0 items-center justify-between gap-3 border-b border-black/5 px-2 dark:border-white/10',
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {narrow && selectedRel && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => selectRelPath(null)} aria-label={t('workspace.actions.backToTree', 'Back to files')} title={t('workspace.actions.backToTree', 'Back to files')}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {selectedRel || workspaceLabel || workspace}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={reload}
            disabled={state.status === 'loading'}
            title={t('workspace.actions.refresh', 'Refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', state.status === 'loading' && 'animate-spin')} />
          </Button>
          <details className="relative">
            <summary
              className="flex h-7 w-7 cursor-default list-none items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              aria-label={t('workspace.actions.more', 'More file actions')}
              title={t('workspace.actions.more', 'More file actions')}
              data-testid="workspace-files-menu"
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </summary>
            <div className="absolute right-0 top-8 z-30 min-w-48 rounded-md border border-border bg-surface-modal p-1 shadow-lg">
              <button type="button" className="rs-browser-options-item" onClick={() => setShowHidden((value) => !value)}>
                {showHidden
                  ? t('workspace.actions.hideHidden', 'Hide hidden files')
                  : t('workspace.actions.showHidden', 'Show hidden files')}
              </button>
              <button type="button" className="rs-browser-options-item" onClick={handleOpenWorkspaceInFinder}>
                {t('workspace.actions.openRootInFinder', 'Show root folder in file manager')}
              </button>
            </div>
          </details>
          {toolbarTrailing}
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : `${treePaneWidth}px 1px minmax(0, 1fr)` }}
      >
        <aside className={cn('min-h-0 overflow-hidden', narrow && selectedRel && 'hidden')}>
          <div className="h-full overflow-y-auto py-2 text-sm">{renderTree()}</div>
        </aside>
        {!narrow && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.actions.resizeTree', 'Resize file tree')}
            className="relative z-10 cursor-col-resize bg-border/60 before:absolute before:inset-y-0 before:-left-1 before:w-3"
            onPointerDown={beginTreeResize}
          />
        )}
        <section className={cn('flex min-h-0 flex-col overflow-hidden', narrow && !selectedRel && 'hidden')}>
          {selectedNode && !selectedNode.isDir && (
            <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-1.5 text-xs text-muted-foreground dark:border-white/10">
              <div className="flex min-w-0 items-center gap-2">
                <FilePreviewIcon
                  contentType={selectedNode.contentType}
                  mimeType={selectedNode.mimeType}
                  ext={selectedNode.ext}
                  className="h-4 w-4 shrink-0"
                />
                <span className="truncate font-mono">{selectedNode.relPath || selectedNode.name}</span>
                {selectedNode.isFresh && (
                  <Badge variant="default" className="ml-1 text-2xs px-1.5 py-0">
                    {t('workspace.freshBadge', 'Added this run')}
                  </Badge>
                )}
              </div>
              <span className="shrink-0">{formatFileSize(selectedNode.size ?? 0)}</span>
            </div>
          )}
          <div className="min-h-0 flex-1">{renderBody()}</div>
        </section>
      </div>
    </div>
  );
}

export default WorkspaceBrowserBody;
