import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { CheckpointsDialog } from '@/components/chat/CheckpointsDialog';

const translate = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
const resumeCheckpointsMock = vi.fn();
const restoreCheckpointMock = vi.fn();
const checkpointDiffMock = vi.fn();

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('@/components/ui/dialog', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const DialogStateContext = React.createContext(false);

  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (
      <DialogStateContext.Provider value={open}>
        {open ? children : null}
      </DialogStateContext.Provider>
    ),
    DialogContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="checkpoints-dialog-content">{children}</div>
    ),
    DialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{children}</p>
    ),
    DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 {...props}>{children}</h2>
    ),
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: {
      resumeCheckpoints: (...args: unknown[]) => resumeCheckpointsMock(...args),
      restoreCheckpoint: (...args: unknown[]) => restoreCheckpointMock(...args),
      checkpointDiff: (...args: unknown[]) => checkpointDiffMock(...args),
    },
  },
}));

function makeCheckpoint(id: string, createdAt: string, filesTouched = 2, testsRun = 1) {
  return {
    id,
    sessionKey: 'agent::s1',
    trigger: 'guide',
    status: 'repair',
    checkpoint: {
      schemaVersion: 1,
      id,
      sessionKey: 'agent::s1',
      trigger: 'guide',
      activeTask: 'Verify the implementation',
      objective: 'Implement feature X',
      filesTouched: new Array(filesTouched).fill('src/a.ts'),
      testsRun: new Array(testsRun).fill('pnpm test'),
      decisions: ['use sqlite'],
      openBlockers: [],
      deviations: [],
      reviewNeededItems: [],
      evidenceRefs: [],
      createdAt,
    },
    createdAt: Date.parse(createdAt),
    updatedAt: Date.parse(createdAt),
  };
}

describe('CheckpointsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads and lists checkpoints on open', async () => {
    resumeCheckpointsMock.mockResolvedValue({
      success: true,
      checkpoints: [
        makeCheckpoint('c1', '2026-07-31T00:00:00.000Z'),
        makeCheckpoint('c2', '2026-07-31T01:00:00.000Z', 4, 3),
      ],
    });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(resumeCheckpointsMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey: 'agent::s1', limit: 20 }),
      );
    });
    expect(screen.getByText('checkpoints.title')).toBeDefined();
    expect(screen.getAllByText('Implement feature X')).toHaveLength(2);
  });

  it('shows empty state when no checkpoints', async () => {
    resumeCheckpointsMock.mockResolvedValue({ success: true, checkpoints: [] });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('checkpoints.empty')).toBeDefined();
    });
  });

  it('restores a checkpoint and refreshes the list', async () => {
    resumeCheckpointsMock.mockResolvedValue({
      success: true,
      checkpoints: [makeCheckpoint('c1', '2026-07-31T00:00:00.000Z')],
    });
    restoreCheckpointMock.mockResolvedValueOnce({
      success: true,
      checkpointId: 'c1',
      rolledBackTo: 'checkpoint:c1',
      mode: 'legacy_checkpoint_fallback',
      evidenceSummary: 'Restored from checkpoint "c1"',
    });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-checkpoint-restore-c1')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('chat-checkpoint-restore-c1'));
    await waitFor(() => {
      expect(restoreCheckpointMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey: 'agent::s1', checkpointId: 'c1' }),
      );
    });
    await waitFor(() => {
      // legacy_checkpoint_fallback → 追加"部分恢复"标注（i18n mock 返回 key）
      expect(
        screen.getByText('Restored from checkpoint "c1" checkpoints.partialRestoreNotice'),
      ).toBeDefined();
    });
  });

  it('omits the partial-restore notice for full event-log replays', async () => {
    resumeCheckpointsMock.mockResolvedValue({
      success: true,
      checkpoints: [makeCheckpoint('c1', '2026-07-31T00:00:00.000Z')],
    });
    restoreCheckpointMock.mockResolvedValueOnce({
      success: true,
      checkpointId: 'c1',
      rolledBackTo: 'checkpoint:c1',
      mode: 'event_log_replay',
      evidenceSummary: 'Replayed event-log entries 1..5',
    });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-checkpoint-restore-c1')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('chat-checkpoint-restore-c1'));
    await waitFor(() => {
      expect(screen.getByText('Replayed event-log entries 1..5')).toBeDefined();
    });
    expect(screen.queryByText(/partialRestoreNotice/)).toBeNull();
  });

  it('surfaces restore failure', async () => {
    resumeCheckpointsMock.mockResolvedValue({
      success: true,
      checkpoints: [makeCheckpoint('c1', '2026-07-31T00:00:00.000Z')],
    });
    restoreCheckpointMock.mockResolvedValue({
      success: false,
      error: 'checkpoint restore failed: no_checkpoint',
      checkpointId: 'c1',
      rolledBackTo: '',
      mode: 'legacy_checkpoint_fallback',
      evidenceSummary: '',
    });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-checkpoint-restore-c1')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('chat-checkpoint-restore-c1'));
    await waitFor(() => {
      expect(screen.getByText('checkpoint restore failed: no_checkpoint')).toBeDefined();
    });
  });

  it('expands checkpoint diff panel with files and unified diff', async () => {
    resumeCheckpointsMock.mockResolvedValue({
      success: true,
      checkpoints: [makeCheckpoint('c1', '2026-07-31T00:00:00.000Z')],
    });
    checkpointDiffMock.mockResolvedValueOnce({
      success: true,
      checkpointId: 'c1',
      files: [
        { filePath: 'src/a.ts', status: 'modified', unifiedDiff: '--- src/a.ts\n+++ src/a.ts\n@@ -1,1 +1,1 @@\n-v1\n+v2\n' },
        { filePath: 'src/new.ts', status: 'created', unifiedDiff: '+hello\n' },
      ],
      errors: [],
    });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-checkpoint-diff-c1')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('chat-checkpoint-diff-c1'));
    await waitFor(() => {
      expect(checkpointDiffMock).toHaveBeenCalledWith(
        expect.objectContaining({ checkpointId: 'c1', sessionKey: 'agent::s1' }),
      );
    });
    expect(screen.getByTestId('chat-checkpoint-diff-panel-c1')).toBeDefined();
    expect(screen.getAllByText(/src\/a\.ts/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/src\/new\.ts/).length).toBeGreaterThan(0);
    // unified diff body rendered inside the <pre> blocks
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('-v1');
    expect(pre?.textContent).toContain('+v2');
  });

  it('shows diff empty state when a checkpoint has no undoable changes', async () => {
    resumeCheckpointsMock.mockResolvedValue({
      success: true,
      checkpoints: [makeCheckpoint('c1', '2026-07-31T00:00:00.000Z')],
    });
    checkpointDiffMock.mockResolvedValueOnce({
      success: true,
      checkpointId: 'c1',
      files: [],
      errors: [],
    });
    render(
      <CheckpointsDialog
        open
        onOpenChange={() => undefined}
        sessionKey="agent::s1" generation="generation-1"
        agentId={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-checkpoint-diff-c1')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('chat-checkpoint-diff-c1'));
    await waitFor(() => {
      expect(screen.getByText('checkpoints.diffEmpty')).toBeDefined();
    });
  });
});
