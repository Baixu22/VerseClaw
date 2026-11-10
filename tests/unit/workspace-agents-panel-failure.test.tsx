// R2: WorkspaceAgentsPanel transcript failure must render failed+retry,
// not an empty transcript.
import { MemoryRouter } from 'react-router-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAgentsPanel } from '@/components/file-preview/WorkspaceAgentsPanel';
import { DEFAULT_SESSION_KEY } from '@shared/chat/types';
import type { SessionActivitySubagent } from '@shared/types/session-activity';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';

const historyMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: { history: (...args: unknown[]) => historyMock(...args) },
    taskLedger: { sessionTask: () => Promise.resolve({ success: true, task: null, children: [] }) },
    gateway: { rpc: () => Promise.resolve({ success: true }) },
  },
}));

/* The roster is the session-activity store's, not this panel's. One completed
 * worker with its own child session is all the transcript path needs. */
const SUBAGENT: SessionActivitySubagent = {
  id: 'agent-1',
  role: 'planner',
  task: 'Plan the work',
  status: 'completed',
  childSessionKey: 'agent:main:child-1',
  agentId: 'main',
  updatedAt: 1,
  source: 'event',
};

/* One stable state object: the real store hands out the same array reference
 * until it updates, and a fresh literal per render would make the panel look
 * like it refetches on every event. */
const SNAPSHOT = { ...createEmptySessionActivitySnapshot(DEFAULT_SESSION_KEY), subagents: [SUBAGENT] };
const ACTIVITY_STATE = { snapshots: { [DEFAULT_SESSION_KEY]: SNAPSHOT } };

vi.mock('@/stores/session-activity', () => ({
  useSessionActivityStore: (selector: (state: unknown) => unknown) => selector(ACTIVITY_STATE),
  selectSessionActivitySnapshot: (_state: unknown, _workspaceId: unknown, sessionKey: string) => sessionKey === DEFAULT_SESSION_KEY ? SNAPSHOT : undefined,
}));

const LABELS: Record<string, string> = {
  'agentsPanel.title': 'Agents',
  'agentsPanel.description': 'Sub-agent workspace tab.',
  'agentsPanel.empty': 'No sub-agents in this session yet.',
  'agentsPanel.transcriptEmpty': 'This agent has no transcript yet.',
  'agentsPanel.transcriptUnavailable': 'Transcript unavailable for this agent.',
  'agentsPanel.transcriptFailed': 'Could not load this transcript.',
  'agentsPanel.dispatchFailed': 'Dispatch failed',
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

describe('WorkspaceAgentsPanel transcript failure (R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SNAPSHOT.subagents = [SUBAGENT];
    historyMock.mockRejectedValue(new Error('history boom sk-12345678901234567890'));
  });

  it('renders failed+retry instead of an empty transcript when history fails', async () => {
    render(<MemoryRouter><WorkspaceAgentsPanel /></MemoryRouter>);

    const failed = await screen.findByTestId('workspace-agents-transcript-failed');
    expect(failed).toHaveTextContent('Could not load this transcript.');
    const retry = screen.getByTestId('workspace-agents-transcript-retry');
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(historyMock).toHaveBeenCalledTimes(2);
  });

  it('keeps run-only roster facts on the selected row when several children lack session keys', () => {
    SNAPSHOT.subagents = [
      { ...SUBAGENT, id: 'older', childSessionKey: undefined, status: 'error', updatedAt: 1 },
      { ...SUBAGENT, id: 'newer', childSessionKey: undefined, status: 'completed', updatedAt: 2 },
    ];
    const { container } = render(<MemoryRouter><WorkspaceAgentsPanel /></MemoryRouter>);
    expect(container.querySelector('[data-stage="execution"]')).toHaveAttribute('data-status', 'completed');
    fireEvent.click(screen.getByTestId('workspace-agents-row-older'));
    expect(container.querySelector('[data-stage="execution"]')).toHaveAttribute('data-status', 'error');
  });
});
