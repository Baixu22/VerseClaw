// R2: use-session-status five-state model — a failed git/terminal query must
// surface as failed+retry, never as "not a repository" / absent terminal.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStatus } from '@/pages/Chat/use-session-status';

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

describe('use-session-status failure states (R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycleSubscribeMock.mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a failed git query as failed+retry instead of folding to not-a-repository', async () => {
    gitStatusMock.mockRejectedValue(new Error('git boom sk-12345678901234567890'));
    terminalStatusMock.mockResolvedValue({ status: 'idle', pid: null });

    const { result } = renderHook(() =>
      useSessionStatus({ workspaceId: 'ws-1', sessionKey: 'agent:main:main' }),
    );

    await waitFor(() => {
      expect(result.current.gitState?.status).toBe('failed');
    });
    const state = result.current.gitState;
    expect(state && 'error' in state ? state.error.retry : undefined).toEqual(expect.any(Function));
    expect(result.current.git).toBeNull();
  });

  it('surfaces a failed terminal query as failed+retry instead of an absent terminal', async () => {
    gitStatusMock.mockResolvedValue({ status: { isRepository: true, branch: 'main', clean: true } });
    terminalStatusMock.mockRejectedValue(new Error('terminal down'));

    const { result } = renderHook(() =>
      useSessionStatus({ workspaceId: 'ws-1', sessionKey: 'agent:main:main' }),
    );

    await waitFor(() => {
      expect(result.current.terminalState?.status).toBe('failed');
    });
    const state = result.current.terminalState;
    expect(state && 'error' in state ? state.error.retry : undefined).toEqual(expect.any(Function));
  });
});
