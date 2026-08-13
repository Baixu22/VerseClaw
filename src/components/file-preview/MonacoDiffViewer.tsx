/**
 * Monaco split diff editor — minimalist premium shell.
 * Renders a clean VS Code–style diff with no extra chrome: no minimap,
 * no overview ruler, no indicators clutter. Just the diff.
 *
 * Boundary: this is the SIDE-PANEL, whole-file diff. The chat transcript uses
 * `components/tool-ui/code-diff` instead — it must not lazy-load an editor per
 * turn. See src/pages/Chat/run-surface-promotion.ts for the full boundary table.
 */
import { useMemo } from 'react';
import { DiffEditor, languageForPath } from '@/lib/monaco/loader';
import { useSettingsStore } from '@/stores/settings';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';

export interface MonacoDiffViewerProps {
  filePath: string;
  /** Left pane; `null`/`undefined` treated as empty (e.g. new file → all additions). */
  original: string | null | undefined;
  modified: string;
  className?: string;
}

function resolveMonacoTheme(theme: string | undefined): string {
  if (theme === 'dark') return 'vs-dark';
  if (theme === 'light') return 'vs';
  const prefersDark =
    typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'vs-dark' : 'vs';
}

function diffModelPath(filePath: string, side: 'orig' | 'mod'): string {
  const key = encodeURIComponent(filePath.replace(/\\/g, '/'));
  return `inmemory://clawx-diff/${side}/${key}`;
}

export default function MonacoDiffViewer({
  filePath,
  original,
  modified,
  className,
}: MonacoDiffViewerProps) {
  const theme = useSettingsStore((s) => s.theme);
  const language = useMemo(() => languageForPath(filePath), [filePath]);
  const monacoTheme = resolveMonacoTheme(theme);
  const originalPath = useMemo(() => diffModelPath(filePath, 'orig'), [filePath]);
  const modifiedPath = useMemo(() => diffModelPath(filePath, 'mod'), [filePath]);
  const left = original ?? '';

  return (
    <div
      data-testid="monaco-diff-viewer"
      className={cn('clawx-diff-editor h-full w-full min-h-0', className)}
    >
      <DiffEditor
        height="100%"
        language={language}
        original={left}
        modified={modified}
        originalModelPath={originalPath}
        modifiedModelPath={modifiedPath}
        theme={monacoTheme}
        loading={
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        }
        options={{
          readOnly: true,
          domReadOnly: true,
          originalEditable: false,
          renderSideBySide: true,
          useInlineViewWhenSpaceIsLimited: false,
          renderIndicators: false,
          renderOverviewRuler: false,
          renderMarginRevertIcon: false,
          minimap: { enabled: false },
          fontSize: 12.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontLigatures: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          wordWrap: 'on',
          diffWordWrap: 'on',
          automaticLayout: true,
          guides: { indentation: false },
          stickyScroll: { enabled: false },
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false,
          },
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: 'none',
          overviewRulerBorder: false,
          contextmenu: false,
        }}
      />
    </div>
  );
}
