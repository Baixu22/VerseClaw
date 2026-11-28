// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyMaterialPage } from '../../shared/types/session-collaboration-material';
import { parseSessionCollaborationQuery, emptySessionCollaborationPage, validateSessionCollaborationPage } from '../../shared/types/session-collaboration';
import { waitForSessionCollaboration } from '../../shared/session-collaboration-watch';
import { parseSessionCollaborationWatch, type SessionCollaborationWatch } from '../../shared/types/session-collaboration-watch';

const mocks = vi.hoisted(() => ({ watch: vi.fn(), cancel: vi.fn(), sender: vi.fn(), materials: vi.fn(), present: vi.fn(), messages: vi.fn(), send: vi.fn(),
  status: undefined as ((value: { state: string }) => void) | undefined, navigation: undefined as (() => void) | undefined }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessionActivity: { watch: mocks.watch, cancelWatch: mocks.cancel }, sessions: {
  collaborationSender: mocks.sender, collaborationMaterials: mocks.materials, presentCollaborationMaterial: mocks.present,
  collaborationMessages: mocks.messages, sendCollaborationMessage: mocks.send,
} } }));
vi.mock('../../src/lib/host-events', () => ({ hostEvents: { onGatewayStatus: (listener: typeof mocks.status) => {
  mocks.status = listener; return () => { mocks.status = undefined; };
}, onWorkspaceNavigationChanged: (listener: () => void) => { mocks.navigation = listener; return () => { mocks.navigation = undefined; }; } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: { state?: string }) => params?.state ? `${key}:${params.state}` : key }) }));
const reader = parseSessionCollaborationQuery({ requester: { workspaceId: 'w', projectId: 'w', sessionKey: 'agent:main:reader', sessionGeneration: 'gr' } }).requester;
const target = { ...reader, sessionKey: 'agent:main:target' as typeof reader.sessionKey, sessionGeneration: 'gt' };
const ref = { authorityId: 'authority', taskNodeId: 'task' as never, taskRevision: 1, taskDigest: 'a'.repeat(64), id: 'material', version: 1, contentDigest: 'b'.repeat(64) };
const material = { ...ref, kind: 'claim' as const, summary: 'Protected original material', evidenceRefs: [], sensitivity: 'internal' as const,
  sourceGeneration: target.sessionGeneration, sourceRun: { runId: 'run' as never, scope: target }, state: 'claim' as const, createdAt: 1 };
const query = parseSessionCollaborationQuery({ requester: reader, target, limit: 1 });
function page() {
  const unread = (owner: string) => ({ owner, state: 'not_read', value: null, readAt: null, reason: 'source-not-read' });
  return { ...emptySessionCollaborationPage(query, 'ready'), scanned: 1, items: [{ sessionKey: target.sessionKey, label: 'Target', status: 'idle', detail: { scope: target }, sources: {
    session: { owner: 'sessions', state: 'ready', value: { scope: target, agentId: 'main' }, readAt: 1 },
    tasks: { owner: 'TaskSystem', state: 'empty', value: [], readAt: 1 }, run: { owner: 'runtime', state: 'empty', value: null, readAt: 1 },
    actions: { owner: 'session-task-effects/bash-processes', state: 'empty', value: [], readAt: 1 }, goal: unread('TaskSystem'), origin: unread('sessions'), execution: unread('execution-domain'),
  } }] };
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); sessionStorage.clear(); mocks.status = undefined; mocks.navigation = undefined;
  mocks.watch.mockImplementation(() => new Promise(() => {})); mocks.cancel.mockResolvedValue({ success: true, cancelled: true });
  mocks.sender.mockResolvedValue({ source: { scope: reader } }); mocks.present.mockResolvedValue({ success: true });
  mocks.messages.mockResolvedValue({ success: true, messages: { state: 'empty', items: [], receipt: null, nextCursor: null } });
  mocks.materials.mockResolvedValue({ success: true, materials: { ...emptyMaterialPage({ requester: reader, target, ref }, 'ready'),
    detail: { material, state: 'claim' }, scanned: 1 } });
});

it('recovers an interrupted send after a renderer reload under the original scoped ID', async () => {
  const first = await import('../../src/stores/session-collaboration');
  const key = JSON.stringify([reader, target]);
  first.useSessionCollaborationUi.getState().updateMessageDraft(key, { id: 'original-intent', text: 'Keep the exact draft', phase: 'sending', purpose: 'request' });
  vi.resetModules();
  const reloaded = await import('../../src/stores/session-collaboration');
  expect(reloaded.useSessionCollaborationUi.getState().messageDrafts[key]).toMatchObject({ id: 'original-intent', text: 'Keep the exact draft', phase: 'unknown' });
  expect(reloaded.useSessionCollaborationUi.getState().messageDrafts[JSON.stringify([reader, { ...target, sessionGeneration: 'reset' }])]).toBeUndefined();
});

it('resumes from the acknowledged watch cursor after reload without replaying the same notification', async () => {
  const first = await import('../../src/stores/session-collaboration');
  const received = vi.fn();
  const request = { id: 'watch', query, condition: 'changed' as const };
  mocks.watch.mockImplementationOnce(async (input: SessionCollaborationWatch) => ({ success: true, watch: {
    schemaVersion: 'SessionCollaborationWatch/v1', id: input.id, state: 'changed', cursor: 'confirmed-cursor', page: page(),
    event: { id: 'owner-event', owner: 'sessions', kind: 'changed' },
  } }));
  const stop = first.subscribeSessionCollaboration(request, received);
  await waitFor(() => expect(received).toHaveBeenCalledOnce()); stop();
  vi.resetModules();
  const reloaded = await import('../../src/stores/session-collaboration');
  const again = reloaded.subscribeSessionCollaboration({ ...request, id: 'after-reload' }, received);
  expect(mocks.watch.mock.lastCall?.[0]).toMatchObject({ cursor: 'confirmed-cursor', query }); again();
});

it('does not persist a watch cursor before its consumer accepts the update', async () => {
  const { subscribeSessionCollaboration } = await import('../../src/stores/session-collaboration');
  mocks.watch.mockImplementationOnce(async (input: SessionCollaborationWatch) => ({ success: true, watch: {
    schemaVersion: 'SessionCollaborationWatch/v1', id: input.id, state: 'changed', cursor: 'unacknowledged', page: page(),
    event: { id: 'unhandled-event', owner: 'sessions', kind: 'changed' },
  } }));
  const consumer = vi.fn(result => { if (result.event) throw new Error('Consumer interrupted'); });
  const stop = subscribeSessionCollaboration({ id: 'before-interruption', query, condition: 'changed' }, consumer);
  await waitFor(() => expect(consumer).toHaveBeenCalledTimes(2)); stop();
  vi.resetModules();
  const reloaded = await import('../../src/stores/session-collaboration');
  const again = reloaded.subscribeSessionCollaboration({ id: 'after-interruption', query, condition: 'changed' }, vi.fn());
  expect(mocks.watch.mock.lastCall?.[0].cursor).toBeUndefined(); again();
});

it('delivers every repeated owner transition before acknowledging its cursor', async () => {
  const { subscribeSessionCollaboration } = await import('../../src/stores/session-collaboration');
  const agents = ['main', 'changed', 'main', 'changed'];
  mocks.watch.mockImplementation(async (input: SessionCollaborationWatch) => {
    const agentId = agents.shift();
    if (!agentId) return new Promise(() => {});
    const current = validateSessionCollaborationPage(input.query, page());
    current.items[0].sources.session.value!.agentId = agentId;
    return { success: true, watch: await waitForSessionCollaboration({ ...input, timeoutMs: 0 }, {
      read: async () => ({ page: current }), subscribe: () => () => {},
    }) };
  });
  const received = vi.fn();
  const stop = subscribeSessionCollaboration({ id: 'repeated', query, condition: 'changed', timeoutMs: 1000 }, received);
  try {
    await waitFor(() => expect(mocks.watch).toHaveBeenCalledTimes(5));
    const events = received.mock.calls.map(([result]) => result.event).filter(Boolean);
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3]);
    expect(new Set(events.map(event => event.id)).size).toBe(3);
    expect(mocks.watch.mock.lastCall?.[0].cursor).toBe(received.mock.lastCall?.[0].cursor);
  } finally { stop(); }
});

it('pauses on a cursor save failure and retries the last saved cursor after reconnect', async () => {
  const { subscribeSessionCollaboration, useSessionCollaborationUi } = await import('../../src/stores/session-collaboration');
  const request = parseSessionCollaborationWatch({ id: 'cursor-storage-failure', query, condition: 'changed' });
  const key = JSON.stringify([request.query, request.condition, null, null]);
  expect(useSessionCollaborationUi.getState().acknowledgeWatch(key, 'last-saved')).toBe(true);
  const respond = async (input: SessionCollaborationWatch) => ({ success: true, watch: {
    schemaVersion: 'SessionCollaborationWatch/v1', id: input.id, state: 'changed', cursor: 'next-cursor', page: page(),
    event: { id: 'next-event', owner: 'sessions', kind: 'changed' },
  } });
  mocks.watch.mockImplementationOnce(respond).mockImplementationOnce(respond);
  const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  expect(useSessionCollaborationUi.getState().updateMessageDraft(JSON.stringify([reader, target]), { text: 'Keep this unsaved draft' })).toBe(false);
  expect(useSessionCollaborationUi.getState().persistenceFailed).toBe(true);
  const received = vi.fn(), recovery = vi.fn();
  const stop = subscribeSessionCollaboration(request, received, recovery);
  try {
    await waitFor(() => expect(recovery).toHaveBeenLastCalledWith(true));
    expect(mocks.watch).toHaveBeenCalledOnce();
    expect(useSessionCollaborationUi.getState().watchCursors[key]).toBe('last-saved');
    expect(JSON.parse(sessionStorage.getItem('clawx.sessionCollaboration.recovery.v1')!).watchCursors[key]).toBe('last-saved');
    failed.mockRestore();
    act(() => mocks.status?.({ state: 'running' }));
    await waitFor(() => expect(mocks.watch).toHaveBeenCalledTimes(3));
    expect(mocks.watch.mock.calls[1][0].cursor).toBe('last-saved');
    expect(mocks.watch.mock.calls[2][0].cursor).toBe('next-cursor');
    expect(received).toHaveBeenCalledOnce();
    expect(recovery).toHaveBeenLastCalledWith(false);
    expect(useSessionCollaborationUi.getState().persistenceFailed).toBe(false);
  } finally { failed.mockRestore(); stop(); }
});

it('keeps old-generation drafts inspectable and makes capacity available after explicit discard', async () => {
  const { useSessionCollaborationUi } = await import('../../src/stores/session-collaboration');
  const { SessionCollaborationRecovery } = await import('../../src/components/agents/SessionCollaborationRecovery');
  for (let index = 0; index < 64; index++) {
    expect(useSessionCollaborationUi.getState().updateMessageDraft(JSON.stringify([reader, { ...target, sessionGeneration: `old-${index}` }]),
      { id: `intent-${index}`, text: `Saved intent ${index}`, phase: 'unknown' })).toBe(true);
  }
  const key = JSON.stringify([reader, target]);
  expect(useSessionCollaborationUi.getState().updateMessageDraft(key, { text: 'Current draft' })).toBe(false);
  for (const generation of ['extra-1', 'extra-2']) {
    expect(useSessionCollaborationUi.getState().updateMessageDraft(JSON.stringify([reader, { ...target, sessionGeneration: generation }]),
      { text: generation })).toBe(false);
  }
  render(<SessionCollaborationRecovery />);
  const previous = screen.getByText('Saved intent 0').closest('li')!;
  expect(previous.textContent).toContain('old-0'); expect(previous.textContent).toContain('intent-0');
  const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  fireEvent.click(within(previous).getByRole('button', { name: 'collaboration.recovery.discard' }));
  expect(screen.getByText('Saved intent 0')).toBeTruthy();
  failed.mockRestore();
  fireEvent.click(within(previous).getByRole('button', { name: 'collaboration.recovery.discard' }));
  expect(screen.queryByText('Saved intent 0')).toBeNull();
  expect(screen.getAllByTestId('collaboration-saved-draft')).toHaveLength(66);
  expect(Object.keys(JSON.parse(sessionStorage.getItem('clawx.sessionCollaboration.recovery.v1')!).messageDrafts)).toHaveLength(63);
  for (const index of [1, 2]) fireEvent.click(within(screen.getByText(`Saved intent ${index}`).closest('li')!).getByRole('button', { name: 'collaboration.recovery.discard' }));
  expect(screen.getAllByTestId('collaboration-saved-draft')).toHaveLength(64);
  expect(useSessionCollaborationUi.getState().updateMessageDraft(key, { phase: 'sending' })).toBe(true);
  expect(mocks.send).not.toHaveBeenCalled();
  const saved = JSON.parse(sessionStorage.getItem('clawx.sessionCollaboration.recovery.v1')!);
  expect(saved.messageDrafts[key].phase).toBe('unknown');
});

it('shows the material subscription recovery warning when its cursor cannot be saved', async () => {
  const { SessionCollaborationMaterials } = await import('../../src/components/agents/SessionCollaborationMaterials');
  let finish!: (value: unknown) => void;
  mocks.watch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><SessionCollaborationMaterials target={target} reference={{ source: target, ref }} /></MemoryRouter>);
  await screen.findByText(material.summary);
  await waitFor(() => expect(mocks.watch).toHaveBeenCalledOnce());
  const input = mocks.watch.mock.calls[0][0] as SessionCollaborationWatch;
  const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    await act(async () => finish({ success: true, watch: { schemaVersion: 'SessionCollaborationWatch/v1', id: input.id,
      state: 'timeout', cursor: 'ack-failed', event: null, page: page() } }));
    expect((await screen.findByRole('alert')).textContent).toBe('collaboration.recovery.watchSaveFailed');
    expect(mocks.watch).toHaveBeenCalledOnce();
  } finally { failed.mockRestore(); }
});

it('ignores corrupt window recovery data and keeps stored drafts scoped to both generations', async () => {
  sessionStorage.setItem('clawx.sessionCollaboration.recovery.v1', '{broken');
  const first = await import('../../src/stores/session-collaboration');
  expect(first.useSessionCollaborationUi.getState().messageDrafts).toEqual({});
  const key = JSON.stringify([reader, target]);
  first.useSessionCollaborationUi.getState().updateMessageDraft(key, { id: 'unchanged-intent', text: 'Keep scope', phase: 'unknown' });
  vi.resetModules();
  const next = await import('../../src/stores/session-collaboration');
  expect(next.useSessionCollaborationUi.getState().messageDrafts[key].id).toBe('unchanged-intent');
  expect(next.useSessionCollaborationUi.getState().messageDrafts[JSON.stringify([{ ...reader, sessionGeneration: 'new' }, target])]).toBeUndefined();
});

it('clears a material body when its source resets and does not retain the old contents', async () => {
  const { SessionCollaborationMaterials } = await import('../../src/components/agents/SessionCollaborationMaterials');
  let finish!: (value: unknown) => void;
  mocks.watch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><SessionCollaborationMaterials target={target} reference={{ source: target, ref }} /></MemoryRouter>);
  await screen.findByText(material.summary); await waitFor(() => expect(mocks.watch).toHaveBeenCalled());
  const request = mocks.watch.mock.calls[0][0] as SessionCollaborationWatch;
  await act(async () => finish({ success: true, watch: { schemaVersion: 'SessionCollaborationWatch/v1', id: request.id,
    state: 'stale', cursor: null, event: null, page: emptySessionCollaborationPage(request.query, 'stale', 'generation-changed') } }));
  await waitFor(() => expect(screen.queryByText(material.summary)).toBeNull());
});

it('clears material contents on navigation and rejects an in-flight response for the previous reader', async () => {
  const { SessionCollaborationMaterials } = await import('../../src/components/agents/SessionCollaborationMaterials');
  let finish!: (value: unknown) => void;
  mocks.materials.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><SessionCollaborationMaterials target={target} reference={{ source: target, ref }} /></MemoryRouter>);
  await waitFor(() => expect(mocks.materials).toHaveBeenCalledOnce());
  mocks.sender.mockResolvedValue({ source: null });
  await act(async () => { mocks.navigation?.(); });
  await act(async () => finish({ success: true, materials: { ...emptyMaterialPage({ requester: reader }, 'ready'), detail: { material, state: 'claim' } } }));
  expect(screen.queryByText(material.summary)).toBeNull();
});

it('does not dispatch a message when its recovery intent cannot be saved', async () => {
  const { fireEvent } = await import('@testing-library/react');
  const { SessionCollaborationMessages } = await import('../../src/components/agents/SessionCollaborationMessages');
  render(<SessionCollaborationMessages requester={reader} target={target} />);
  const details = screen.getByTestId('collaboration-messages') as HTMLDetailsElement;
  details.open = true; fireEvent(details, new Event('toggle'));
  const draft = await screen.findByTestId('collaboration-message-draft');
  await waitFor(() => expect((draft as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(draft, { target: { value: 'Must keep this intent before sending' } });
  const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    fireEvent.click(screen.getByTestId('collaboration-message-send'));
    await screen.findByRole('alert'); expect(mocks.send).not.toHaveBeenCalled();
    expect((draft as HTMLTextAreaElement).value).toBe('Must keep this intent before sending');
  } finally { failed.mockRestore(); }
});

it('reads an unknown original receipt automatically when opening after reload without sending', async () => {
  const initial = await import('../../src/stores/session-collaboration');
  const key = JSON.stringify([reader, target]);
  initial.useSessionCollaborationUi.getState().updateMessageDraft(key, { id: 'restored-original', text: 'Keep original', phase: 'unknown' });
  vi.resetModules();
  const { SessionCollaborationMessages } = await import('../../src/components/agents/SessionCollaborationMessages');
  const { useSessionCollaborationUi } = await import('../../src/stores/session-collaboration');
  render(<SessionCollaborationMessages requester={reader} target={target} />);
  expect(mocks.messages).not.toHaveBeenCalled();
  const details = screen.getByTestId('collaboration-messages') as HTMLDetailsElement;
  details.open = true; fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(mocks.messages).toHaveBeenCalledWith({ requester: reader, target, id: 'restored-original' }));
  await waitFor(() => expect(useSessionCollaborationUi.getState().messageDrafts[key].phase).toBe('retry'));
  expect(useSessionCollaborationUi.getState().messageDrafts[key]).toMatchObject({ id: 'restored-original', text: 'Keep original' });
  expect(mocks.send).not.toHaveBeenCalled();
});

it('reauthorizes a selected material for the new reader after navigation before displaying fresh content', async () => {
  const { SessionCollaborationMaterials } = await import('../../src/components/agents/SessionCollaborationMaterials');
  render(<MemoryRouter><SessionCollaborationMaterials target={target} reference={{ source: target, ref }} /></MemoryRouter>);
  await screen.findByText(material.summary);
  const nextReader = { ...reader, sessionKey: 'agent:main:another' as typeof reader.sessionKey, sessionGeneration: 'new-reader' };
  mocks.sender.mockResolvedValue({ source: { scope: nextReader } });
  mocks.materials.mockResolvedValue({ success: true, materials: { ...emptyMaterialPage({ requester: nextReader }, 'ready'),
    detail: { material: { ...material, summary: 'Freshly authorized material' }, state: 'claim' } } });
  await act(async () => { mocks.navigation?.(); });
  await screen.findByText('Freshly authorized material');
  expect(screen.queryByText(material.summary)).toBeNull();
  expect(mocks.materials).toHaveBeenLastCalledWith({ requester: nextReader, target, ref });
});

it('checks an old-generation intent through the current reader and never associates its receipt with a replacement draft', async () => {
  const { useSessionCollaborationUi } = await import('../../src/stores/session-collaboration');
  const { SessionCollaborationRecovery } = await import('../../src/components/agents/SessionCollaborationRecovery');
  const old = { ...reader, sessionGeneration: 'retired-generation' };
  const key = JSON.stringify([old, target]);
  useSessionCollaborationUi.getState().updateMessageDraft(key, { id: 'old-intent', text: 'Original unknown', phase: 'unknown' });
  mocks.messages.mockResolvedValue({ success: true, messages: { state: 'ready', receipt: { message: { id: 'old-intent' }, phase: 'replied' } } });
  render(<SessionCollaborationRecovery />);
  fireEvent.click(screen.getByRole('button', { name: 'collaboration.messages.check' }));
  await screen.findByText('collaboration.recovery.receipt:collaboration.messages.states.replied');
  expect(mocks.messages).toHaveBeenCalledWith({ requester: reader, target, id: 'old-intent' });
  expect(useSessionCollaborationUi.getState().messageDrafts[key]).toMatchObject({ id: 'old-intent', phase: 'unknown' });
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'collaboration.recovery.discard' }));
  act(() => { useSessionCollaborationUi.getState().updateMessageDraft(key, { id: 'new-intent', text: 'Replacement', phase: 'unknown' }); });
  expect(screen.queryByRole('status')).toBeNull();
  mocks.messages.mockResolvedValue({ success: true, messages: { state: 'stale', receipt: null } });
  fireEvent.click(screen.getByRole('button', { name: 'collaboration.messages.check' }));
  await screen.findByText('collaboration.recovery.receipt:collaboration.messages.states.stale');
  expect(mocks.send).not.toHaveBeenCalled();
});

it('rejects an archived receipt that arrives after reader navigation', async () => {
  const { useSessionCollaborationUi } = await import('../../src/stores/session-collaboration');
  const { SessionCollaborationRecovery } = await import('../../src/components/agents/SessionCollaborationRecovery');
  const key = JSON.stringify([{ ...reader, sessionGeneration: 'old' }, target]);
  useSessionCollaborationUi.getState().updateMessageDraft(key, { id: 'late-intent', text: 'Original', phase: 'unknown' });
  let finish!: (value: unknown) => void;
  mocks.messages.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<SessionCollaborationRecovery />);
  fireEvent.click(screen.getByRole('button', { name: 'collaboration.messages.check' }));
  await waitFor(() => expect(mocks.messages).toHaveBeenCalledOnce());
  await act(async () => { mocks.navigation?.(); });
  await act(async () => finish({ success: true, messages: { state: 'ready', receipt: { message: { id: 'late-intent' }, phase: 'replied' } } }));
  expect(screen.queryByRole('status')).toBeNull(); expect(mocks.send).not.toHaveBeenCalled();
});
