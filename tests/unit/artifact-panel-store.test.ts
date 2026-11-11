import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_PANEL_DEFAULT_WIDTH,
  openWorkspacePanel,
  useArtifactPanel,
} from '@/stores/artifact-panel';

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

describe('artifact panel canonical workspace state', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    resetPanel();
  });

  it('opens every capability through WorkspacePanelIntent without duplicate tabs', () => {
    openWorkspacePanel({ panel: 'review', view: 'ai-review', filePath: 'src/App.tsx' });
    openWorkspacePanel({ panel: 'browser', view: 'live', url: 'https://example.com', sessionId: 'browser-1' });
    openWorkspacePanel({ panel: 'browser', view: 'preview' });

    const state = useArtifactPanel.getState();
    expect(state.tabs.map((tab) => tab.kind)).toEqual(['review', 'browser']);
    expect(state.reviewView).toBe('ai-review');
    expect(state.selectedPath).toBe('src/App.tsx');
    expect(state.browserView).toBe('preview');
    expect(state.browserSessionId).toBeNull();
    expect(state.open).toBe(true);
  });

  it('hides and restores the same tabs and selection until explicitly reset', () => {
    openWorkspacePanel({ panel: 'review', filePath: 'src/App.tsx' });
    openWorkspacePanel({ panel: 'subagent', sessionKey: 'agent:worker:child' });
    useArtifactPanel.getState().setExpanded(true);
    const before = useArtifactPanel.getState();
    before.hide();
    expect(useArtifactPanel.getState().open).toBe(false);
    useArtifactPanel.getState().toggle();
    expect(useArtifactPanel.getState()).toMatchObject({
      open: true, expanded: true, tabs: before.tabs,
      activeTabId: before.activeTabId, selectedPath: 'src/App.tsx',
    });
    useArtifactPanel.getState().close();
    expect(useArtifactPanel.getState()).toMatchObject({ open: false, tabs: [], selectedPath: null });
  });

  it.each([
    [{ activeTab: 'changes' }, 'review', 'changes'],
    [{ activeTab: 'preview' }, 'files', undefined],
    [{ workspaceView: 'web' }, 'browser', undefined],
    [{ workspaceView: 'git' }, 'review', 'changes'],
  ] as const)('migrates legacy state %o to %s', (legacy, expectedKind, expectedReviewView) => {
    useArtifactPanel.getState().restoreSessionState({ open: true, ...legacy });

    const state = useArtifactPanel.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.kind).toBe(expectedKind);
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.kind).toBe(expectedKind);
    if (expectedReviewView) expect(state.reviewView).toBe(expectedReviewView);
  });

  it('falls back to Files for unrecognized persisted tab values', () => {
    useArtifactPanel.getState().restoreSessionState({
      open: true,
      tabs: [{ kind: 'unknown-panel' }],
      activeTabKind: 'unknown-panel',
    });

    const state = useArtifactPanel.getState();
    expect(state.tabs.map((tab) => tab.kind)).toEqual(['files']);
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.kind).toBe('files');
  });

  it('forces terminal intents to the bottom at 960px', () => {
    window.innerWidth = 960;
    openWorkspacePanel({ panel: 'terminal', placement: 'side' });

    const state = useArtifactPanel.getState();
    expect(state.terminalPlacement).toBe('bottom');
    expect(state.tabs.map((tab) => tab.kind)).toEqual(['terminal']);
  });
});
