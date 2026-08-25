// R2: SessionStatusRail renders failed+retry for git and terminal status
// queries instead of "not a repository" / absent terminal.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStatusRail } from '@/components/chat/SessionStatusRail';
import { TooltipProvider } from '@/components/ui/tooltip';

const gitStatusMock = vi.fn();
const terminalStatusMock = vi.fn();
const lifecycleSubscribeMock = vi.fn(() => () => {});

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    git: { status: () => gitStatusMock() },
    terminal: { status: (...args: unknown[]) => terminalStatusMock(...args) },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onSubagentLifecycle: (...args: unknown[]) => lifecycleSubscribeMock(...args),
  },
}));

const LABELS: Record<string, string> = {
  'sessionRail.title': 'Session status',
  'sessionRail.expand': 'Expand',
  'sessionRail.collapse': 'Collapse',
  'sessionRail.git.title': 'Git',
  'sessionRail.git.loading': 'Reading repository status…',
  'sessionRail.git.notARepository': 'This project is not a Git repository',
  'sessionRail.git.unavailable': 'Git status is temporarily unavailable.',
  'sessionRail.terminal.title': 'Terminal',
  'sessionRail.terminal.unavailable': 'Terminal status is temporarily unavailable.',
  'sessionRail.terminal.state.idle': 'Idle',
  'common:errorBoundary.errorReference': 'Error reference:',
  retry: 'Retry',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        const label = LABELS[key];
        if (!label) return key;
        if (!values) return label;
        return label.replace(/\{\{[^}]+\}\}/g, (token) => String(values[token.slice(2, -2).trim()] ?? token));
      },
    }),
  };
});

function renderRail() {
  return render(
    <TooltipProvider>
    <SessionStatusRail
      workspaceId="ws-1"
      sessionKey="agent:main:main"
      collapsed={false}
      planTitle=""
      planTodos={[]}
      orchestrations={[]}
      onOpenGit={vi.fn()}
      onOpenTerminal={vi.fn()}
      onOpenAgents={vi.fn()}
    />
    </TooltipProvider>,
  );
}

describe('SessionStatusRail failure states (R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycleSubscribeMock.mockReturnValue(() => {});
    terminalStatusMock.mockResolvedValue({ status: 'idle', pid: null });
  });

  it('renders git failed+retry when the git query rejects', async () => {
    gitStatusMock.mockRejectedValue(new Error('git boom'));
    renderRail();

    const error = await screen.findByTestId('session-status-rail-git-error');
    expect(error).toHaveTextContent('Git status is temporarily unavailable.');
    expect(screen.getByTestId('session-status-rail-git-retry')).toBeInTheDocument();
  });

  it('renders terminal failed+retry when the terminal query rejects', async () => {
    gitStatusMock.mockResolvedValue({ status: { isRepository: true, branch: 'main', clean: true, changes: [] } });
    terminalStatusMock.mockRejectedValue(new Error('terminal boom'));
    renderRail();

    // The terminal section only exists once the query has failed and starts
    // collapsed — wait for it, open it, then assert the error body.
    await screen.findByTestId('session-status-rail-terminal-toggle');
    fireEvent.click(screen.getByTestId('session-status-rail-terminal-toggle'));
    const error = await screen.findByTestId('session-status-rail-terminal-error');
    expect(error).toHaveTextContent('Terminal status is temporarily unavailable.');
    const retry = screen.getByTestId('session-status-rail-terminal-retry');
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(terminalStatusMock).toHaveBeenCalledTimes(2));
  });
});
