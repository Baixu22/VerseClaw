// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
const mocks = vi.hoisted(() => ({ list: vi.fn(), sender: vi.fn(), send: vi.fn() }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessions: { collaborationMessages: mocks.list, collaborationSender: mocks.sender, sendCollaborationMessage: mocks.send } } }));
vi.mock('../../src/lib/host-events', () => ({ hostEvents: { onGatewayStatus: () => () => {} } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SessionCollaborationMessages } from '../../src/components/agents/SessionCollaborationMessages';
import { useSessionCollaborationUi } from '../../src/stores/session-collaboration';
const source = parseSessionCollaborationQuery({ requester: { workspaceId: 'a', projectId: 'a', sessionKey: 'agent:main:a', sessionGeneration: 'ga' } }).requester;
const target = parseSessionCollaborationQuery({ requester: { workspaceId: 'b', projectId: 'b', sessionKey: 'agent:main:b', sessionGeneration: 'gb' } }).requester;
beforeEach(() => {
  vi.clearAllMocks(); useSessionCollaborationUi.setState({ messageDrafts: {} });
  mocks.list.mockResolvedValue({ success: true, messages: { state: 'empty', items: [], receipt: null, nextCursor: null } });
  mocks.sender.mockResolvedValue({ source: { scope: source, name: 'Source' } }); mocks.send.mockResolvedValue({ success: false, phase: 'unknown', receipt: null });
});
const expand = () => { const details = screen.getByTestId('collaboration-messages') as HTMLDetailsElement; details.open = true; fireEvent(details, new Event('toggle')); };
describe('message view draft ownership', () => {
  it('reads only on expansion and retains an unknown intent across unmount without a new ID', async () => {
    const mounted = render(<SessionCollaborationMessages requester={source} target={target} />);
    expect(mocks.list).not.toHaveBeenCalled(); expand();
    const body = await screen.findByTestId('collaboration-message-draft'); await waitFor(() => expect((body as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(body, { target: { value: 'Retain this original intent' } }); fireEvent.click(screen.getByTestId('collaboration-message-send'));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce()); const id = mocks.send.mock.calls[0][0].id;
    await waitFor(() => expect((screen.getByTestId('collaboration-message-draft') as HTMLTextAreaElement).disabled).toBe(true));
    mounted.unmount(); render(<SessionCollaborationMessages requester={source} target={target} />); expand();
    await waitFor(() => expect((screen.getByTestId('collaboration-message-draft') as HTMLTextAreaElement).value).toBe('Retain this original intent'));
    expect(Object.values(useSessionCollaborationUi.getState().messageDrafts)[0].id).toBe(id);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('keeps same-key drafts separate across workspace and physical generation', () => {
    const update = useSessionCollaborationUi.getState().updateMessageDraft;
    const first = JSON.stringify([source, target]), second = JSON.stringify([{ ...source, workspaceId: 'other', projectId: 'other' }, target]);
    update(first, { text: 'Original' }); update(second, { text: 'Other workspace' });
    const third = JSON.stringify([{ ...source, sessionGeneration: 'new' }, target]); update(third, { text: 'New generation' });
    expect(useSessionCollaborationUi.getState().messageDrafts[first].text).toBe('Original');
    expect(useSessionCollaborationUi.getState().messageDrafts[second].text).toBe('Other workspace');
  });
});
