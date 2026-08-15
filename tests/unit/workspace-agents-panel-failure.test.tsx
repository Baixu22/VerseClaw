// R2: WorkspaceAgentsPanel transcript failure must render failed+retry,
// not an empty transcript.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAgentsPanel } from '@/components/file-preview/WorkspaceAgentsPanel';

const historyMock = vi.fn();
const lifecycleSubscribeMock = vi.fn(() => () => {});

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: { history: (...args: unknown[]) => historyMock(...args) },
    gateway: { rpc: () => Promise.resolve({ success: true }) },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onSubagentLifecycle: (...args: unknown[]) => lifecycleSubscribeMock(...args),
  },
}));

// Fire a completed sub-agent event with its own session so the panel loads a transcript.
function emitCompletedAgent() {
  const handler = lifecycleSubscribeMock.mock.calls.at(-1)?.[0] as ((event: unknown) => void) | undefined;
  if (!handler) throw new Error('lifecycle subscriber not registered');
  act(() => {
    handler({
      type: 'subagent.started',
      key: 'agent-1',
      roleName: 'planner',
      task: 'Plan the work',
      status: 'completed',
      childSessionKey: 'agent:main:child-1',
      agentId: 'main',
      ts: Date.now(),
    });
  });
}

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
    lifecycleSubscribeMock.mockReturnValue(() => {});
    historyMock.mockRejectedValue(new Error('history boom sk-12345678901234567890'));
  });

  it('renders failed+retry instead of an empty transcript when history fails', async () => {
    render(<WorkspaceAgentsPanel />);
    emitCompletedAgent();

    const failed = await screen.findByTestId('workspace-agents-transcript-failed');
    expect(failed).toHaveTextContent('Could not load this transcript.');
    const retry = screen.getByTestId('workspace-agents-transcript-retry');
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(historyMock).toHaveBeenCalledTimes(2);
  });
});
