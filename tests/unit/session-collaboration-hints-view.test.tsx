// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyCollaborationHints, parseCollaborationHintsQuery } from '../../shared/types/session-collaboration-hints';

const mocks = vi.hoisted(() => ({ sender: vi.fn(), read: vi.fn(), notification: undefined as ((sessionKey?: string) => void) | undefined,
  navigation: undefined as (() => void) | undefined }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessions: { collaborationSender: mocks.sender, collaborationHints: mocks.read } } }));
vi.mock('../../src/lib/host-events', () => ({ hostEvents: { onGatewayNotification: (listener: (event: { method: string; params?: { sessionKey: string } }) => void) => {
  mocks.notification = sessionKey => listener({ method: 'session.message', ...(sessionKey ? { params: { sessionKey } } : {}) }); return () => { mocks.notification = undefined; };
}, onGatewayStatus: () => () => {}, onWorkspaceNavigationChanged: (listener: () => void) => {
  mocks.navigation = listener; return () => { mocks.navigation = undefined; };
} } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
import { SessionCollaborationHints } from '../../src/components/agents/SessionCollaborationHints';

const reader = { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:reader', sessionGeneration: 'reader' };
const target = parseCollaborationHintsQuery({ requester: reader, target: { ...reader, sessionKey: 'agent:main:target' }, limit: 1 }).target;
const query = parseCollaborationHintsQuery({ requester: reader, target, limit: 1 });
const page = { ...emptyCollaborationHints(query, 'ready'), taskReadState: 'ready', task: { task: { taskNodeId: 'original-task', revision: 1, digest: 'a'.repeat(64), state: 'doing' },
  referenceOnly: true, claim: null, pendingOperations: 0, dependencies: [], relation: 'same-task', sharedArtifacts: [] } };
function open() { const element = screen.getByTestId('collaboration-hints') as HTMLDetailsElement; element.open = true; fireEvent(element, new Event('toggle')); }
beforeEach(() => { vi.clearAllMocks(); mocks.sender.mockResolvedValue({ source: { scope: reader } }); mocks.read.mockResolvedValue({ success: true, hints: page }); });

it('loads on demand using the active reader and links to the original task without taking a claim', async () => {
  render(<MemoryRouter><SessionCollaborationHints target={target} /></MemoryRouter>);
  expect(mocks.read).not.toHaveBeenCalled(); open();
  const link = await screen.findByTestId('collaboration-hints-open-task');
  expect(mocks.read).toHaveBeenCalledWith(query);
  expect(link.getAttribute('href')).toBe('/task-ledger?workspaceId=workspace&nodeId=original-task');
  expect(screen.getByTestId('collaboration-hints-role').textContent).toContain('observer');
});

it('removes old facts when a refresh loses visibility and preserves keyboard focus', async () => {
  render(<MemoryRouter><SessionCollaborationHints target={target} /></MemoryRouter>); open();
  await screen.findByTestId('collaboration-hints-open-task');
  const refresh = screen.getByRole('button', { name: 'collaboration.refresh' }); refresh.focus();
  mocks.read.mockResolvedValueOnce({ success: true, hints: emptyCollaborationHints(query, 'unavailable', 'not-visible') });
  fireEvent.click(refresh);
  await waitFor(() => expect(screen.queryByTestId('collaboration-hints-open-task')).toBeNull());
  expect(document.activeElement).toBe(refresh);
  await waitFor(() => expect(screen.getByTestId('collaboration-hints-status').textContent).toContain('unavailable'));
});

it('does not apply a pending response after the selected target changes', async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<MemoryRouter><SessionCollaborationHints key="first" target={target} /></MemoryRouter>); open();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  view.rerender(<MemoryRouter><SessionCollaborationHints key="second" target={{ ...target, sessionGeneration: 'new-generation' }} /></MemoryRouter>);
  await act(async () => { finish({ success: true, hints: page }); });
  expect(screen.queryByTestId('collaboration-hints-open-task')).toBeNull();
});

it('shows an unavailable task source alongside the available admission observation', async () => {
  mocks.read.mockResolvedValueOnce({ success: true, hints: { ...emptyCollaborationHints(query, 'ready', 'task-owner-missing'),
    admission: { owner: 'SessionAdmissionRegistry', active: 1, waiters: 0, fenced: false } } });
  render(<MemoryRouter><SessionCollaborationHints target={target} /></MemoryRouter>); open();
  expect((await screen.findByTestId('collaboration-hints-task-status')).textContent).toContain('taskUnavailable');
  expect(screen.getByTestId('collaboration-hints-admission')).toBeTruthy();
  expect(screen.queryByText('collaboration.hints.noTask')).toBeNull();
});

it('coalesces notifications during a pending read and shows each completed observation', async () => {
  vi.useFakeTimers();
  const finish: Array<(value: unknown) => void> = [];
  mocks.read.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  const view = render(<MemoryRouter><SessionCollaborationHints target={target} /></MemoryRouter>);
  try {
    await act(async () => { open(); });
    expect(mocks.read).toHaveBeenCalledOnce();
    for (let index = 0; index < 5; index++) await act(async () => {
      mocks.notification?.(target.sessionKey); await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.read).toHaveBeenCalledOnce();
    await act(async () => { finish[0]({ success: true, hints: page }); });
    expect(screen.getByTestId('collaboration-hints-open-task')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('collaboration-hints-open-task')).toBeTruthy();
    await act(async () => { finish[1]({ success: true, hints: page }); await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  } finally { view.unmount(); vi.useRealTimers(); }
});

it('ignores another session message when both reader and target are known', async () => {
  const view = render(<MemoryRouter><SessionCollaborationHints target={target} /></MemoryRouter>); open();
  await screen.findByTestId('collaboration-hints-open-task');
  vi.useFakeTimers();
  try {
    await act(async () => { mocks.notification?.('agent:main:unrelated'); await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.read).toHaveBeenCalledOnce();
  } finally { view.unmount(); vi.useRealTimers(); }
});

it.each(['displayed', 'pending'] as const)('invalidates %s observations when host navigation switches the actual reader', async state => {
  let finishOld!: (value: unknown) => void, finishNew!: (value: unknown) => void;
  if (state === 'pending') mocks.read.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  render(<MemoryRouter><SessionCollaborationHints target={target} /></MemoryRouter>); open();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  if (state === 'displayed') await screen.findByTestId('collaboration-hints-open-task');
  const nextReader = { ...reader, sessionKey: 'agent:main:new-reader', sessionGeneration: 'next-generation' };
  mocks.sender.mockResolvedValue({ source: { scope: nextReader } });
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  await act(async () => { mocks.navigation?.(); });
  expect(screen.queryByTestId('collaboration-hints-open-task')).toBeNull();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith({ requester: nextReader, target, limit: 1 }));
  if (state === 'pending') await act(async () => { finishOld({ success: true, hints: page }); });
  expect(screen.queryByTestId('collaboration-hints-open-task')).toBeNull();
  await act(async () => { finishNew({ success: true, hints: { ...page, requester: nextReader,
    task: { ...page.task, task: { ...page.task.task, taskNodeId: 'new-reader-task' }, relation: 'different' } } }); });
  expect(screen.getByTestId('collaboration-hints-open-task').getAttribute('href')).toContain('nodeId=new-reader-task');
});
