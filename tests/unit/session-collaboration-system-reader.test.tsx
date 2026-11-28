// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';

const mocks = vi.hoisted(() => ({ sender: vi.fn(), refresh: vi.fn(), navigation: undefined as (() => void) | undefined,
  notification: undefined as ((event: { method: string }) => void) | undefined,
  reconnect: undefined as ((status: { state: string }) => void) | undefined }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessions: { collaborationSender: mocks.sender },
  workspaces: { systemControl: async () => ({ paused: false, revision: 1 }) } } }));
vi.mock('../../src/lib/host-events', () => ({ hostEvents: {
  onWorkspaceNavigationChanged: (listener: () => void) => { mocks.navigation = listener; return () => { mocks.navigation = undefined; }; },
  onGatewayStatus: (listener: typeof mocks.reconnect) => { mocks.reconnect = listener; return () => { mocks.reconnect = undefined; }; },
  onGatewayNotification: (listener: typeof mocks.notification) => { mocks.notification = listener; return () => { mocks.notification = undefined; }; },
} }));
vi.mock('../../src/stores/system-portfolio', () => ({ useSystemPortfolioStore: () => ({ refresh: mocks.refresh, entries: {
  first: { profile: { id: 'unrelated-project', name: 'First project' }, snapshot: { workspaceId: 'unrelated-project',
    coordinator: { sessionKey: 'agent:main:wrong', generation: 'wrong-generation', state: 'ready' },
    plan: null, evidence: [], observedAt: 1, resources: { activeTaskClaims: null, pendingEffects: null, observations: [], costUsd: null } } },
}, loading: false, unavailable: false }) }));
vi.mock('../../src/components/agents/SessionCollaborationPanel', () => ({ SessionCollaborationPanel: ({ requester }: { requester?: AutonomySessionScope }) =>
  <div data-testid="actual-collaboration-reader">{JSON.stringify(requester ?? null)}</div> }));
vi.mock('../../src/components/agents/ProjectConfigurationPanel', () => ({ ProjectConfigurationPanel: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
import { SystemPortfolioPanel } from '../../src/components/agents/SystemPortfolioPanel';
const current = parseSessionCollaborationQuery({ requester: { workspaceId: 'actual-workspace', projectId: 'actual-workspace',
  sessionKey: 'agent:main:actual', sessionGeneration: 'current-generation' } }).requester;
beforeEach(() => { vi.resetAllMocks(); mocks.navigation = undefined; mocks.reconnect = undefined; mocks.sender.mockResolvedValue({ source: { scope: current } }); });

it('uses the actual desktop reader even when a different project coordinator appears first', async () => {
  const mounted = render(<MemoryRouter><SystemPortfolioPanel /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('actual-collaboration-reader').textContent).toBe(JSON.stringify(current)));
  expect(mocks.sender).toHaveBeenCalledOnce();
  mounted.unmount(); expect(mocks.navigation).toBeUndefined(); expect(mocks.reconnect).toBeUndefined(); expect(mocks.notification).toBeUndefined();
});
it('drops an earlier reader response after navigation and leaves missing identity unselected', async () => {
  let finish!: (value: unknown) => void;
  mocks.sender.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ source: null });
  render(<MemoryRouter><SystemPortfolioPanel /></MemoryRouter>);
  await act(async () => { mocks.navigation?.(); });
  await act(async () => finish({ source: { scope: current } }));
  expect(screen.getByTestId('actual-collaboration-reader').textContent).toBe('null');
  const next = { ...current, sessionGeneration: 'new-generation' };
  mocks.sender.mockResolvedValueOnce({ source: { scope: next } });
  await act(async () => { mocks.reconnect?.({ state: 'running' }); });
  expect(screen.getByTestId('actual-collaboration-reader').textContent).toBe(JSON.stringify(next));
  mocks.sender.mockResolvedValueOnce({ source: { scope: current } });
  await act(async () => { mocks.notification?.({ method: 'sessions.changed' }); });
  expect(screen.getByTestId('actual-collaboration-reader').textContent).toBe(JSON.stringify(current));
});
