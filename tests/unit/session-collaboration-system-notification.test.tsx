// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, type SessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { createSessionActivityReadSnapshot } from '../../shared/types/session-activity';

const mocks = vi.hoisted(() => ({ sender: vi.fn(), query: vi.fn(), refresh: vi.fn(),
  notifications: new Set<(event: { method: string }) => void>() }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessions: { collaborationSender: mocks.sender,
  collaborationMessages: async () => ({ success: true, messages: { state: 'empty', items: [], receipt: null, nextCursor: null } }),
  collaborationHints: async () => ({ success: false }) },
  sessionActivity: { query: mocks.query, read: async ({ scope }: { scope: Parameters<typeof createSessionActivityReadSnapshot>[0] }) =>
    ({ success: true, snapshot: createSessionActivityReadSnapshot(scope) }), watch: () => new Promise(() => {}), cancelWatch: async () => ({ success: true }) },
  workspaces: { systemControl: async () => ({ paused: false, revision: 1 }) } } }));
vi.mock('../../src/lib/host-events', () => ({ hostEvents: {
  onWorkspaceNavigationChanged: () => () => {}, onGatewayStatus: () => () => {},
  onGatewayNotification: (listener: (event: { method: string }) => void) => { mocks.notifications.add(listener); return () => { mocks.notifications.delete(listener); }; },
} }));
vi.mock('../../src/stores/system-portfolio', () => ({ useSystemPortfolioStore: () => ({ refresh: mocks.refresh, entries: {}, loading: false, unavailable: false }) }));
vi.mock('../../src/lib/workspace-session', () => ({ activateWorkspaceScopedSession: vi.fn() }));
vi.mock('../../src/stores/artifact-panel', () => ({ openWorkspacePanel: vi.fn() }));
vi.mock('../../src/components/agents/ProjectConfigurationPanel', () => ({ ProjectConfigurationPanel: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
import { SystemPortfolioPanel } from '../../src/components/agents/SystemPortfolioPanel';
import { useSessionCollaborationUi } from '../../src/stores/session-collaboration';
const reader = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:reader', sessionGeneration: 'reader-generation' } }).requester;
const target = { ...reader, sessionKey: 'agent:main:target' as typeof reader.sessionKey, sessionGeneration: 'target-generation' };
function page(query: SessionCollaborationQuery) {
  const unread = (owner: string) => ({ owner, state: 'not_read', value: null, readAt: null, reason: 'source-not-read' });
  const empty = (owner: string, value: unknown) => ({ owner, state: 'empty', value, readAt: 1 });
  return { ...emptySessionCollaborationPage(query, 'ready'), scanned: 1, items: [{ sessionKey: target.sessionKey, label: 'Target', status: 'idle', detail: { scope: target }, sources: {
    session: { owner: 'sessions', state: 'ready', readAt: 1, value: { scope: target, agentId: 'main' } },
    run: empty('runtime', null), tasks: empty('TaskSystem', []), actions: empty('session-task-effects/bash-processes', []),
    goal: empty('TaskSystem', null), origin: empty('sessions', null), execution: unread('execution-domain'),
  } }] };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.notifications.clear(); sessionStorage.clear();
  useSessionCollaborationUi.setState({ views: {}, messageDrafts: {}, watchCursors: {}, persistenceFailed: false });
  mocks.sender.mockResolvedValue({ source: { scope: reader, name: 'Reader' } });
  mocks.query.mockImplementation(async query => ({ success: true, page: page(query) }));
});

it('keeps the real expanded message composer mounted while a routine notification rechecks the same reader', async () => {
  render(<MemoryRouter><SystemPortfolioPanel /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId(`collaboration-row-${encodeURIComponent(target.sessionKey)}`));
  const details = screen.getByTestId('collaboration-messages') as HTMLDetailsElement;
  details.open = true; fireEvent(details, new Event('toggle'));
  const draft = await screen.findByTestId('collaboration-message-draft') as HTMLTextAreaElement;
  await waitFor(() => expect(draft.disabled).toBe(false));
  fireEvent.change(draft, { target: { value: 'Keep the current draft' } });
  let finish!: (value: unknown) => void;
  mocks.sender.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { mocks.notifications.forEach(listener => listener({ method: 'sessions.changed' })); });
  expect(screen.getByTestId('collaboration-message-draft')).toBe(draft); expect(details.open).toBe(true);
  await act(async () => finish({ source: { scope: { ...reader }, name: 'Reader' } }));
  expect(screen.getByTestId('collaboration-message-draft')).toBe(draft); expect(draft.value).toBe('Keep the current draft');
  expect(details.open).toBe(true);
});
