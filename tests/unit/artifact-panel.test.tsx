import { act, fireEvent, render as renderView, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactPanel } from '@/components/file-preview/ArtifactPanel';
function render(ui: ReactElement) {
  return renderView(ui, { wrapper: TooltipProvider });
}
import {
  ARTIFACT_PANEL_DEFAULT_WIDTH,
  openWorkspacePanel,
  useArtifactPanel,
} from '@/stores/artifact-panel';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string | Record<string, unknown>) => (
        typeof fallback === 'string' ? fallback : ''
      ),
    }),
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    git: { status: vi.fn(async () => ({ ok: true, status: { isRepository: false } })) },
    shell: { showItemInFolder: vi.fn() },
  },
}));

vi.mock('@/components/file-preview/WorkspaceBrowserBody', () => ({
  WorkspaceBrowserBody: () => <div data-testid="workspace-files-content" />,
}));
vi.mock('@/components/file-preview/WorkspaceReviewPanel', () => ({
  WorkspaceReviewPanel: () => <div data-testid="workspace-review-content" />,
}));
vi.mock('@/components/file-preview/WorkspaceTerminalPanel', () => ({
  WorkspaceTerminalPanel: () => <div data-testid="workspace-terminal-content" />,
}));
vi.mock('@/components/file-preview/WorkspaceBrowserPanel', () => ({
  WorkspaceBrowserPanel: () => <div data-testid="workspace-browser-content" />,
}));
vi.mock('@/components/file-preview/WorkspaceAuditPanel', () => ({
  WorkspaceAuditPanel: () => <div data-testid="workspace-audit-content" />,
}));
vi.mock('@/components/file-preview/ArtifactView', () => ({
  ArtifactView: () => <div data-testid="workspace-artifacts-content" />,
}));

function resetPanel() {
  useArtifactPanel.setState({
    open: false,
    expanded: false,
    tabs: [],
    activeTabId: null,
    focusedFile: null,
    selectedPath: null,
    reviewView: 'changes',
    browserView: 'preview',
    browserSessionId: null,
    browserUrl: null,
    terminalPlacement: 'side',
    widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
  });
}

beforeEach(() => {
  resetPanel();
  window.electron.platform = 'win32';
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
});

afterEach(() => resetPanel());

describe('ArtifactPanel', () => {
  it('opens canonical workspace entries from the restrained launcher', () => {
    render(<ArtifactPanel files={[]} agent={null} />);

    expect(screen.getByTestId('artifact-panel-launcher-review')).toBeVisible();
    expect(screen.getByTestId('artifact-panel-launcher-terminal')).toBeVisible();
    expect(screen.getByTestId('artifact-panel-launcher-browser')).toBeVisible();
    expect(screen.getByTestId('artifact-panel-launcher-files')).toBeVisible();
    expect(screen.queryByTestId('artifact-panel-launcher-agents')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('artifact-panel-launcher-files'));
    expect(screen.getByTestId('artifact-panel-tab-files')).toBeVisible();
    expect(screen.getByTestId('workspace-files-content')).toBeVisible();
  });

  it('keeps canonical tabs mounted and switches the active content', () => {
    act(() => {
      openWorkspacePanel({ panel: 'review', view: 'changes' });
      openWorkspacePanel({ panel: 'browser', view: 'preview' });
      openWorkspacePanel({ panel: 'terminal', placement: 'side' });
    });

    render(<ArtifactPanel files={[]} agent={null} />);

    expect(screen.getByTestId('artifact-panel-tab-review')).toBeVisible();
    expect(screen.getByTestId('artifact-panel-tab-browser')).toBeVisible();
    expect(screen.getByTestId('artifact-panel-tab-terminal')).toBeVisible();
    expect(screen.getByTestId('workspace-terminal-content')).toBeVisible();

    fireEvent.pointerDown(screen.getByTestId('artifact-panel-tab-review'), { button: 0 });
    expect(screen.getByTestId('workspace-review-content')).toBeVisible();
    expect(screen.getByTestId('workspace-terminal-content').parentElement).toHaveClass('hidden');
  });

  it('uses draggable macOS chrome while keeping tab controls interactive', () => {
    window.electron.platform = 'darwin';
    act(() => openWorkspacePanel({ panel: 'files' }));

    render(<ArtifactPanel files={[]} agent={null} />);

    expect(screen.getByTestId('artifact-panel')).toHaveClass('no-drag');
    expect(screen.getByTestId('artifact-panel-drag-region')).toHaveClass('drag-region');
    expect(screen.getByTestId('artifact-panel-tab-files').closest('.rs-tab-scroll-area')).toHaveClass('no-drag');
  });

  it('collapses the panel when the final tab is closed without ending its capability', () => {
    act(() => openWorkspacePanel({ panel: 'terminal' }));
    render(<ArtifactPanel files={[]} agent={null} />);

    fireEvent.click(screen.getByTestId('artifact-panel-tab-close-terminal'));
    expect(useArtifactPanel.getState().open).toBe(false);
    expect(useArtifactPanel.getState().tabs).toEqual([]);
  });

  it('closes the workspace while retaining its selected tab and content', () => {
    act(() => openWorkspacePanel({ panel: 'files', filePath: 'src/App.tsx' }));
    const onSessionStateChange = vi.fn();
    render(<ArtifactPanel files={[]} agent={null} onSessionStateChange={onSessionStateChange} />);
    const content = screen.getByTestId('workspace-files-content');
    const tabId = useArtifactPanel.getState().activeTabId;
    fireEvent.click(screen.getByTestId('artifact-panel-close'));
    expect(useArtifactPanel.getState()).toMatchObject({ open: false, activeTabId: tabId, selectedPath: 'src/App.tsx' });
    expect(onSessionStateChange).toHaveBeenCalledWith({ open: false });
    expect(screen.getByTestId('workspace-files-content')).toBe(content);
  });

  it('dismisses the portalled tab menu when the toolbar hides the retained panel', () => {
    act(() => openWorkspacePanel({ panel: 'files' }));
    render(<ArtifactPanel files={[]} agent={null} />);
    fireEvent.click(screen.getByTestId('artifact-panel-new-tab'));
    expect(screen.getByTestId('artifact-panel-new-tab-menu')).toBeVisible();
    act(() => useArtifactPanel.getState().hide());
    expect(screen.queryByTestId('artifact-panel-new-tab-menu')).not.toBeInTheDocument();
    act(() => useArtifactPanel.getState().toggle());
    expect(screen.queryByTestId('artifact-panel-new-tab-menu')).not.toBeInTheDocument();
  });
});
