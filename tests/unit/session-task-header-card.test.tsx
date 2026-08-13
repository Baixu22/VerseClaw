import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionTaskHeaderCard } from '@/pages/Chat/SessionTaskHeaderCard';

const {
  describeMock,
  compactionStatusMock,
  longTaskControlStatusMock,
  sendWithMediaMock,
} = vi.hoisted(() => ({
  describeMock: vi.fn(),
  compactionStatusMock: vi.fn(),
  longTaskControlStatusMock: vi.fn(),
  sendWithMediaMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: {
      describe: (...args: unknown[]) => describeMock(...args),
      compactionStatus: (...args: unknown[]) => compactionStatusMock(...args),
      longTaskControlStatus: (...args: unknown[]) => longTaskControlStatusMock(...args),
    },
    chat: {
      sendWithMedia: (...args: unknown[]) => sendWithMediaMock(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}::${String(opts.count)}` : key,
  }),
}));

const chatState = {
  currentSessionKey: 'agent:main:s1',
  sessions: [{ key: 'agent:main:s1', label: 'Labeled session' }],
  sending: false,
};
vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

function defaultDescribe() {
  return {
    success: true,
    session: {
      key: 'agent:main:s1',
      label: 'Labeled session',
      goal: { objective: 'Build the thing', status: 'active', tokenBudget: 1000, tokensUsed: 250 },
      parentSessionKey: 'agent:main:parent',
      forkedFromParent: false,
      childSessions: ['agent:main:child'],
      compactionCheckpointCount: 1,
    },
  };
}

describe('SessionTaskHeaderCard', () => {
  it('renders collapsed title and goal, then expands to show details and goal actions', async () => {
    describeMock.mockResolvedValue(defaultDescribe());
    compactionStatusMock.mockResolvedValue({
      success: true,
      available: true,
      canCompact: true,
      inProgress: false,
      pressure: 'low',
      truncatedMessageCount: 3,
      warnings: [],
    });
    longTaskControlStatusMock.mockResolvedValue({
      available: true,
      queueCount: 2,
      warnings: [],
    });

    render(<SessionTaskHeaderCard />);

    await waitFor(() => expect(screen.getByTestId('session-task-header-card')).toBeTruthy());
    expect(screen.getByText('Labeled session')).toBeTruthy();
    expect(screen.getByText('sessionTaskCard.goalStatus.active')).toBeTruthy();

    fireEvent.click(screen.getByTestId('session-task-header-expand'));
    expect(screen.getAllByText('Build the thing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/sessionTaskCard.parent/)).toBeTruthy();
    expect(screen.getByText('sessionTaskCard.children::1')).toBeTruthy();
    expect(screen.getByText('sessionTaskCard.compaction.truncated::3')).toBeTruthy();

    fireEvent.click(screen.getByTestId('session-task-goal-start'));
    await waitFor(() => expect(sendWithMediaMock).toHaveBeenCalled());
    expect(sendWithMediaMock.mock.calls[0][0]).toMatchObject({
      sessionKey: 'agent:main:s1',
      message: '/goal start',
      deliver: true,
    });
  });

  it('disables goal actions while sending and hides the card without a session', async () => {
    describeMock.mockResolvedValue(defaultDescribe());
    compactionStatusMock.mockResolvedValue({ success: true, available: false, inProgress: false, pressure: 'unknown', truncatedMessageCount: 0, warnings: [] });
    longTaskControlStatusMock.mockResolvedValue({ available: false, queueCount: 0, warnings: [] });
    chatState.sending = true;
    render(<SessionTaskHeaderCard />);
    await waitFor(() => expect(screen.getByTestId('session-task-header-card')).toBeTruthy());
    fireEvent.click(screen.getByTestId('session-task-header-expand'));
    expect((screen.getByTestId('session-task-goal-complete') as HTMLButtonElement).disabled).toBe(true);
    chatState.sending = false;
  });
});