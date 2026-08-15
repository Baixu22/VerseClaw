// R2: WorkspaceTerminalPanel surfaces a failed terminal.status query as an
// inline degraded notice with retry, not as a silently idle terminal.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTerminalPanel } from '@/components/file-preview/WorkspaceTerminalPanel';

const terminalStatusMock = vi.fn();

const { workspacesState } = vi.hoisted(() => ({
  workspacesState: {
    activeWorkspace: { id: 'ws-1', rootPath: '/tmp', permissionMode: 'acceptEdits' },
    saveWorkspaceState: vi.fn(),
  },
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (state: typeof workspacesState) => unknown) => selector(workspacesState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    terminal: {
      status: (...args: unknown[]) => terminalStatusMock(...args),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      open: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
    },
    permissions: { decideApproval: vi.fn() },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onTerminalData: vi.fn(() => () => {}),
    onTerminalStatusChanged: vi.fn(() => () => {}),
    onTerminalExit: vi.fn(() => () => {}),
  },
}));

const LABELS: Record<string, string> = {
  'workspace.terminal.status.idle': 'Idle',
  'workspace.terminal.toast.statusFailed': 'Terminal status is temporarily unavailable.',
  'workspace.terminal.blocked.title': 'Interactive terminal is disabled in this permission mode',
  'workspace.terminal.blocked.body': 'Switch permission mode first.',
  'workspace.terminal.actions.start': 'Start',
  'workspace.terminal.actions.clear': 'Clear',
  retry: 'Retry',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, _fallback?: string) => LABELS[key] ?? key,
    }),
  };
});

// xterm is a browser-bound canvas library; stub it out for jsdom.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    onData() { return { dispose() {} }; }
    write() {}
    writeln() {}
    clear() {}
    focus() {}
    dispose() {}
    options = { theme: {} };
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() { return null; }
  },
}));

// jsdom has no ResizeObserver; the panel constructs one on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

describe('WorkspaceTerminalPanel status failure (R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalStatusMock.mockRejectedValue(new Error('terminal status down'));
  });

  it('renders a degraded notice with retry when terminal.status fails', async () => {
    render(<WorkspaceTerminalPanel />);

    const error = await screen.findByTestId('workspace-terminal-status-error');
    expect(error).toHaveTextContent('Terminal status is temporarily unavailable.');
    expect(screen.getByTestId('workspace-terminal-status-retry')).toBeInTheDocument();
  });
});
