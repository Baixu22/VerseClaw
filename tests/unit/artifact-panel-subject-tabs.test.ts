// Sub-agent and process tabs are the panel's only multi-instance kinds. Two
// workers must be able to sit side by side; everything else must stay
// single-instance, which is the invariant these tests pin.
import { beforeEach, describe, expect, it } from 'vitest';
import { useArtifactPanel } from '@/stores/artifact-panel';

function tabs() {
  return useArtifactPanel.getState().tabs.map((tab) => ({
    kind: tab.kind,
    subject: tab.subject,
    title: tab.title,
  }));
}

describe('artifact panel multi-instance tabs', () => {
  beforeEach(() => {
    useArtifactPanel.getState().close();
  });

  it('opens one tab per sub-agent', () => {
    const { openWorkspacePanel } = useArtifactPanel.getState();
    openWorkspacePanel({ panel: 'subagent', sessionKey: 'agent:explorer:child-1', roleName: 'Wren' });
    openWorkspacePanel({ panel: 'subagent', sessionKey: 'agent:reviewer:child-2', roleName: 'Piper' });

    expect(tabs()).toEqual([
      { kind: 'subagent', subject: 'agent:explorer:child-1', title: 'Wren' },
      { kind: 'subagent', subject: 'agent:reviewer:child-2', title: 'Piper' },
    ]);
  });

  it('re-focuses an existing sub-agent tab instead of duplicating it', () => {
    const { openWorkspacePanel } = useArtifactPanel.getState();
    openWorkspacePanel({ panel: 'subagent', sessionKey: 'agent:explorer:child-1', roleName: 'Wren' });
    const firstId = useArtifactPanel.getState().activeTabId;
    openWorkspacePanel({ panel: 'files' });
    openWorkspacePanel({ panel: 'subagent', sessionKey: 'agent:explorer:child-1', roleName: 'Wren' });

    expect(useArtifactPanel.getState().tabs).toHaveLength(2);
    expect(useArtifactPanel.getState().activeTabId).toBe(firstId);
  });

  it('opens one tab per process and keeps them apart from sub-agents', () => {
    const { openWorkspacePanel } = useArtifactPanel.getState();
    openWorkspacePanel({ panel: 'process', processId: 'call-1', command: 'pnpm vitest run' });
    openWorkspacePanel({ panel: 'process', processId: 'call-9', command: 'pnpm vite' });
    openWorkspacePanel({ panel: 'subagent', sessionKey: 'agent:explorer:child-1' });

    expect(tabs()).toEqual([
      { kind: 'process', subject: 'call-1', title: 'pnpm vitest run' },
      { kind: 'process', subject: 'call-9', title: 'pnpm vite' },
      { kind: 'subagent', subject: 'agent:explorer:child-1', title: undefined },
    ]);
  });

  it('keeps subject-less kinds single-instance', () => {
    const { openWorkspacePanel } = useArtifactPanel.getState();
    openWorkspacePanel({ panel: 'terminal' });
    openWorkspacePanel({ panel: 'terminal' });
    openWorkspacePanel({ panel: 'files' });
    openWorkspacePanel({ panel: 'files', filePath: 'a.ts' });

    expect(tabs().map((tab) => tab.kind)).toEqual(['terminal', 'files']);
  });

  it('does not restore subject-bearing tabs from a saved session', () => {
    // The worker or process a saved chip named belongs to a run that has ended,
    // so restoring the chip would restore an empty pane.
    useArtifactPanel.getState().restoreSessionState({
      open: true,
      tabs: [
        { kind: 'files' },
        { kind: 'subagent', title: 'Wren' },
        { kind: 'process', title: 'pnpm vitest run' },
      ],
      activeTabKind: 'files',
    });

    expect(tabs().map((tab) => tab.kind)).toEqual(['files']);
  });
});
