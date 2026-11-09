import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySessionActivitySnapshot, type SessionActivitySnapshot } from '@shared/types/session-activity';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';

const state = vi.hoisted(() => ({ history: vi.fn(), sendWorker: vi.fn(), ledger: vi.fn(), sessionTask: vi.fn(), snapshot: null as SessionActivitySnapshot | null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { model?: string; cost?: string }) => values?.model ?? values?.cost ?? key }) }));
vi.mock('@/lib/host-api', () => ({ hostApi: { sessions: { history: (...args: unknown[]) => state.history(...args), sendWorker: (...args: unknown[]) => state.sendWorker(...args) },
  taskLedger: { snapshot: (...args: unknown[]) => state.ledger(...args), sessionTask: (...args: unknown[]) => state.sessionTask(...args) }, workspaces: { selectSessionTask: vi.fn() } } }));
vi.mock('@/stores/chat', () => ({ useChatStore: (selector: (value: unknown) => unknown) => selector({ currentSessionKey: 'agent:main:parent', currentAgentId: 'main' }) }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: (selector: (value: unknown) => unknown) => selector({ activeWorkspace: { id: 'workspace-a' } }) }));
vi.mock('@/stores/session-activity', () => ({ useSessionActivityStore: (selector: (value: unknown) => unknown) => selector({}), selectSessionActivitySnapshot: () => state.snapshot }));
vi.mock('@/components/agents/AgentAvatar', () => ({ AgentAvatar: () => <span />, RoleBadge: () => <span /> }));
vi.mock('@/lib/user-error', () => ({ describeUserError: () => ({ errorId: 'fixture-error' }), toastUserError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TaskLedgerSummaryPanel } from '@/components/task-ledger/TaskLedgerSummaryPanel';
import { WorkspaceSubagentPanel } from '@/components/file-preview/WorkspaceSubagentPanel';

beforeEach(() => {
  state.history.mockReset(); state.sendWorker.mockReset(); state.ledger.mockReset(); state.sessionTask.mockReset();
  state.sessionTask.mockResolvedValue({ success: true, task: null, children: [] });
  state.snapshot = createEmptySessionActivitySnapshot('agent:main:parent');
  state.snapshot.session.sessionId = 'parent-generation';
  state.snapshot.subagents = [{ id: 'worker', childSessionKey: 'agent:main:child', status: 'started', updatedAt: 1, source: 'event' }];
  state.history.mockResolvedValue({ success: true, sessionGeneration: 'child-generation', model: 'actual-provider/worker-model', messages: [{ role: 'assistant', content: 'Worker transcript' }] });
});

describe('session task and worker panels consume owner results', () => {
  it('scrolls the actual transcript after a delayed task-owner read releases the loading placeholder', async () => {
    let resolveOwner: (result: unknown) => void = () => {};
    state.sessionTask.mockReturnValueOnce(new Promise(resolve => { resolveOwner = resolve; }));
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await waitFor(() => expect(state.sessionTask).toHaveBeenCalledTimes(1));
    const scroll = screen.getByTestId('workspace-subagent-transcript');
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1200 });
    resolveOwner({ success: true, task: null, children: [] });
    await screen.findByText('Worker transcript');
    await waitFor(() => expect(scroll.scrollTop).toBe(1200));
  });
  it.each([undefined, null])('keeps an unavailable recorded cost (%s) unknown rather than zero', async costUsd => {
    state.history.mockResolvedValue({ success: true, sessionGeneration: 'child-generation', costUsd,
      messages: [{ role: 'assistant', content: 'Worker transcript' }] });
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await screen.findByText('Worker transcript');
    expect(screen.getByTestId('workspace-subagent-cost')).toHaveTextContent('delegationStages.costUnknown');
    expect(screen.getByTestId('workspace-subagent-cost')).not.toHaveTextContent('$0');
  });

  it('preserves a recorded zero cost when the owner actually supplies it', async () => {
    state.history.mockResolvedValue({ success: true, sessionGeneration: 'child-generation', costUsd: 0,
      messages: [{ role: 'assistant', content: 'Worker transcript' }] });
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await screen.findByText('Worker transcript');
    expect(screen.getByTestId('workspace-subagent-cost')).toHaveTextContent('$0.00');
  });
  it('reads acceptance for the displayed worker generation and preserves its transcript when that owner is unavailable', async () => {
    state.sessionTask.mockResolvedValueOnce({ success: true, task: { contract: { taskNodeId: 'worker-task', state: 'done' } }, children: [] });
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('workspace-subagent-panel').querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'accepted'));
    expect(state.sessionTask).toHaveBeenLastCalledWith({ workspaceId: 'workspace-a', sessionKey: 'agent:main:child', expectedSessionGeneration: 'child-generation' });
    state.sessionTask.mockRejectedValueOnce(new Error('TASK_GENERATION_STALE'));
    fireEvent.click(screen.getByTestId('workspace-subagent-refresh'));
    await waitFor(() => expect(screen.getByTestId('workspace-subagent-refresh')).toBeEnabled());
    expect(screen.getByTestId('workspace-subagent-panel').querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'unavailable');
    expect(screen.getByTestId('workspace-subagent-transcript')).toHaveTextContent('Worker transcript');
  });
  it('keeps a project-wide Ledger warning unavailable and removes task selection', async () => {
    const snapshot: TaskLedgerSnapshot = { schemaVersion: 1, workspaceId: 'workspace-a', sourceWorkspaceId: 'workspace-a', generatedAt: '2026-11-08T00:00:00Z',
      nodes: [{ id: 'task-a', title: 'Recorded task', kind: 'task', status: 'todo', createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z' }],
      edges: [], sessionLinks: [], rootNodeIds: ['task-a'], reviewNodeIds: [], activeNodeIds: [], blockedNodeIds: [], recentDecisions: [], eventsCount: 1,
      warnings: [{ type: 'invalid_event', message: 'Ledger event could not be read' }] };
    state.ledger.mockResolvedValue({ success: true, snapshot });
    render(<MemoryRouter><TaskLedgerSummaryPanel mode="bar" workspaceId="workspace-a" projectWide
      session={{ key: 'agent:main:parent', sessionId: 'parent-generation' }} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'unavailable'));
    fireEvent.click(screen.getByTestId('session-tasks-toggle'));
    expect(screen.queryByTestId('session-task-select-task-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-task-list')).toHaveTextContent('summary.scope.unavailable');
  });

  it('refreshes the current worker generation after definite rejection while retaining the input', async () => {
    let generation = 'child-generation';
    state.history.mockImplementation(async (payload: { expectedSessionGeneration?: string }) => payload.expectedSessionGeneration && payload.expectedSessionGeneration !== generation
      ? { success: false, error: 'Worker generation changed' }
      : { success: true, sessionGeneration: generation, model: 'actual-provider/worker-model', messages: [{ role: 'assistant', content: 'Worker transcript' }] });
    state.sendWorker.mockResolvedValue({ success: false, phase: 'rejected', error: 'Worker generation changed' });
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await screen.findByText('Worker transcript');
    expect(screen.getByTestId('workspace-subagent-model')).toHaveTextContent('actual-provider/worker-model');
    generation = 'replacement-generation';
    fireEvent.change(screen.getByTestId('workspace-subagent-dispatch-input'), { target: { value: 'Keep my instruction' } });
    fireEvent.click(screen.getByTestId('workspace-subagent-dispatch'));
    await waitFor(() => expect(screen.getByTestId('worker-send-phase')).toHaveTextContent('delegationStages.status.rejected'));
    fireEvent.click(screen.getByTestId('workspace-subagent-refresh'));
    await waitFor(() => expect(screen.getByTestId('workspace-subagent-dispatch')).toBeEnabled());
    expect(state.history.mock.calls.at(-1)![0]).not.toHaveProperty('expectedSessionGeneration');
    expect(screen.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('Keep my instruction');
  });

  it.each(['queued', 'steered'])('uses the successful %s receipt without inventing a run or task acceptance', async (phase) => {
    state.sendWorker.mockResolvedValue({ success: true, phase });
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await screen.findByText('Worker transcript');
    fireEvent.change(screen.getByTestId('workspace-subagent-dispatch-input'), { target: { value: 'New instruction' } });
    fireEvent.click(screen.getByTestId('workspace-subagent-dispatch'));
    await waitFor(() => expect(screen.getByTestId('worker-send-phase')).toHaveTextContent(`delegationStages.status.${phase}`));
    expect(screen.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('');
    expect(screen.getByTestId('workspace-subagent-panel').querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'unavailable');
  });

  it('reconciles an unknown send with its original intervention key and clears only the acknowledged input', async () => {
    let key = '';
    state.sendWorker.mockImplementation(async (payload: { idempotencyKey: string }) => { key = payload.idempotencyKey; return { success: false, phase: 'unknown' }; });
    render(<MemoryRouter><WorkspaceSubagentPanel childSessionKey="agent:main:child" /></MemoryRouter>);
    await screen.findByText('Worker transcript');
    fireEvent.change(screen.getByTestId('workspace-subagent-dispatch-input'), { target: { value: 'Recover my instruction' } });
    fireEvent.click(screen.getByTestId('workspace-subagent-dispatch'));
    await waitFor(() => expect(screen.getByTestId('worker-send-phase')).toHaveTextContent('delegationStages.status.unknown'));
    expect(screen.getByTestId('workspace-subagent-dispatch')).toBeDisabled();
    state.history.mockResolvedValue({ success: true, sessionGeneration: 'child-generation', messages: [],
      workerSendReceipt: { phase: 'queued', idempotencyKey: key, source: 'runtime-intervention' } });
    fireEvent.click(screen.getByTestId('workspace-subagent-refresh'));
    await waitFor(() => expect(screen.getByTestId('worker-send-phase')).toHaveTextContent('delegationStages.status.queued'));
    expect(state.history.mock.calls.at(-1)![0]).toMatchObject({ expectedSessionGeneration: 'child-generation', workerSendIdempotencyKey: key });
    expect(screen.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('');
  });
});
