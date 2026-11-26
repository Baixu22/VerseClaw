// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSessionCollaborationQuery, emptySessionCollaborationPage, type SessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { createSessionActivityReadSnapshot } from '../../shared/types/session-activity';
import { normalizeTaskReference } from '../../shared/types/identity-scope';

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), watch: vi.fn(), cancel: vi.fn(), activate: vi.fn(),
  notification: undefined as ((value: { method: string }) => void) | undefined,
  gatewayStatus: undefined as ((value: { state: string }) => void) | undefined }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessionActivity: { query: mocks.query, read: mocks.read, watch: mocks.watch, cancelWatch: mocks.cancel } } }));
vi.mock('../../src/lib/host-events', () => ({ hostEvents: {
  onGatewayNotification: (listener: typeof mocks.notification) => { mocks.notification = listener; return () => {}; },
  onGatewayStatus: (listener: typeof mocks.gatewayStatus) => { mocks.gatewayStatus = listener; return () => {}; },
} }));
vi.mock('../../src/lib/workspace-session', () => ({ activateWorkspaceScopedSession: mocks.activate }));
vi.mock('../../src/stores/artifact-panel', () => ({ openWorkspacePanel: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: { count?: number }) => `${key}${params?.count === undefined ? '' : `:${params.count}`}`, i18n: { language: 'en' } }) }));
import { SessionCollaborationPanel } from '../../src/components/agents/SessionCollaborationPanel';
import { subscribeSessionCollaboration, useSessionCollaborationUi } from '../../src/stores/session-collaboration';

const a = { workspaceId: 'workspace-a', projectId: 'workspace-a', sessionKey: 'agent:main:a', sessionGeneration: 'generation-a' };
const b = { workspaceId: 'workspace-b', projectId: 'workspace-b', sessionKey: 'agent:main:b', sessionGeneration: 'generation-b' };
const input = parseSessionCollaborationQuery({ requester: a });
function page(query: SessionCollaborationQuery) {
  const result = emptySessionCollaborationPage(query, 'ready');
  const task = normalizeTaskReference({ kind: 'ledger', taskNodeId: 'task-panel' });
  if (task.kind !== 'ledger') throw new Error('Fixture task owner missing');
  for (const value of [a, b]) {
    const scope = parseSessionCollaborationQuery({ requester: value }).requester;
    if (query.target && query.target.sessionKey !== value.sessionKey) continue;
    if (query.search && !`Goal ${value.workspaceId}`.includes(query.search)) continue;
    result.scanned++;
    const source = <T,>(owner: string, data: T) => ({ owner, state: 'ready' as const, readAt: 1, value: data });
    const unread = (owner: string) => ({ owner, state: 'not_read' as const, readAt: null, value: null, reason: 'source-not-read' as const });
    result.items.push({ sessionKey: scope.sessionKey, label: value.workspaceId, status: 'idle', detail: { scope }, sources: {
      session: source('sessions', { scope, agentId: 'main' }), goal: source('TaskSystem', { text: `Goal ${value.workspaceId}`, truncated: false }),
      tasks: source('TaskSystem', [{ authorityId: value.workspaceId, taskNodeId: task.taskNodeId, revision: 1, digest: 'digest', state: 'ready' as const, referenceOnly: true, claim: null }]),
      run: { owner: 'runtime', state: 'empty', value: null, readAt: 1 }, actions: { owner: 'session-task-effects/bash-processes', state: 'empty', value: [], readAt: 1 },
      origin: source('sessions', { spawnedBy: null, parentSessionKey: null }), execution: unread('execution-domain'),
    } });
  }
  if (!result.items.length) result.state = 'empty';
  return result;
}
beforeEach(() => {
  vi.clearAllMocks(); useSessionCollaborationUi.setState({ views: {} });
  mocks.query.mockImplementation(async query => ({ success: true, page: page(query) }));
  mocks.read.mockImplementation(async query => ({ success: true, snapshot: createSessionActivityReadSnapshot(query.scope) }));
  mocks.watch.mockImplementation(() => new Promise(() => {})); mocks.cancel.mockResolvedValue({ success: true, cancelled: true });
});
describe('shared collaboration panel', () => {
  it('keeps an unread requester separate from a real empty result', () => {
    render(<MemoryRouter><SessionCollaborationPanel /></MemoryRouter>);
    expect(screen.getByText('collaboration.requesterMissing')).toBeTruthy(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('loads only the selected detail, preserves keyboard focus on refresh and cancels on unmount', async () => {
    const mounted = render(<MemoryRouter><SessionCollaborationPanel requester={input.requester} /></MemoryRouter>);
    await screen.findByText('Goal workspace-a'); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.activate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`collaboration-row-${encodeURIComponent(b.sessionKey)}`));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith({ scope: parseSessionCollaborationQuery({ requester: b }).requester }));
    const filter = screen.getByTestId('collaboration-search') as HTMLInputElement;
    filter.focus(); fireEvent.change(filter, { target: { value: 'workspace-b' } });
    await waitFor(() => expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ search: 'workspace-b' })));
    act(() => mocks.notification?.({ method: 'sessions.changed' }));
    await waitFor(() => expect(screen.getByTestId(`collaboration-row-${encodeURIComponent(b.sessionKey)}`).getAttribute('aria-pressed')).toBe('true'));
    expect(document.activeElement).toBe(filter); expect(filter.value).toBe('workspace-b'); expect(mocks.activate).not.toHaveBeenCalled();
    mounted.unmount(); await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ target: expect.objectContaining({ sessionGeneration: b.sessionGeneration }) }) })));
  });
  it('does not display a late previous-workspace reply under a new requester', async () => {
    let release!: (value: unknown) => void;
    mocks.query.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const mounted = render(<MemoryRouter><SessionCollaborationPanel requester={input.requester} /></MemoryRouter>);
    await waitFor(() => expect(mocks.query).toHaveBeenCalled());
    const next = parseSessionCollaborationQuery({ requester: { ...a, workspaceId: b.workspaceId, projectId: b.projectId } }).requester;
    mounted.rerender(<MemoryRouter><SessionCollaborationPanel requester={next} /></MemoryRouter>);
    await act(async () => release({ success: true, page: page(input) }));
    expect(screen.queryByText('Goal workspace-a')).toBeNull();
  });
  it('fences selected detail when the target is no longer visible', async () => {
    mocks.query.mockImplementation(async request => ({ success: true, page: request.target
      ? emptySessionCollaborationPage(request, 'unavailable', 'not-visible') : page(request) }));
    render(<MemoryRouter><SessionCollaborationPanel requester={input.requester} /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId(`collaboration-row-${encodeURIComponent(b.sessionKey)}`));
    const detail = within(screen.getByTestId('collaboration-detail'));
    await detail.findByText('collaboration.page.unavailable:0');
    expect(detail.queryByText('Goal workspace-b')).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('replays the selected watch when Gateway reconnects before the pending wait fails', async () => {
    let fail!: (error: Error) => void;
    mocks.watch.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const query = parseSessionCollaborationQuery({ requester: input.requester, target: input.requester, limit: 1 });
    const unsubscribe = subscribeSessionCollaboration({ id: 'reconnect', query, condition: 'changed' }, vi.fn());
    try {
      mocks.gatewayStatus?.({ state: 'running' });
      fail(new Error('Connection closed'));
      await waitFor(() => expect(mocks.watch).toHaveBeenCalledTimes(2));
      expect(mocks.watch.mock.calls[1][0]).toMatchObject({ query, condition: 'changed' });
    } finally {
      unsubscribe();
    }
  });
});
