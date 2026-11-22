import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadActivity: vi.fn(async () => undefined),
  binding: {
    workspaceId: 'project-a', agentId: 'main', sessionKey: 'agent:main:parent',
    state: 'active', bindingRevision: 1, sessionGeneration: 'generation-a',
    environment: { backend: 'git', kind: 'local', canonicalRoot: 'D:/project-a' },
    taskLedgerReferences: [{ taskLedgerNodeId: 'task-a' }],
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/poll-scheduler', () => ({ createPollScheduler: () => () => {} }));
vi.mock('@/lib/workspace-session', () => ({
  getWorkspaceCoordinatorBinding: () => mocks.binding,
  activateWorkspaceSession: vi.fn(),
}));
vi.mock('@/lib/host-api', () => ({ hostApi: {
  workspaces: { resolveCoordinator: async () => ({ binding: mocks.binding, recovery: { state: 'ready' } }) },
  resourceEnvelope: { getState: async () => ({ measured: false, snapshot: null }) },
} }));
vi.mock('@/stores/chat', () => ({ useChatStore: (selector: (state: unknown) => unknown) => selector({
  currentSessionKey: 'agent:main:parent', activeTaskNodeId: 'task-a',
  sessions: [{ key: 'agent:main:parent', sessionId: 'generation-a' }],
}) }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: (selector: (state: unknown) => unknown) => selector({
  activeWorkspace: { id: 'project-a', rootPath: 'D:/project-a' },
}) }));
vi.mock('@/stores/session-activity', () => ({
  useSessionActivityStore: (selector: (state: unknown) => unknown) => selector({ load: mocks.loadActivity }),
  selectSessionActivitySnapshot: () => undefined,
}));
vi.mock('@/stores/resource-tracker', () => ({ useResourceStore: () => ({
  resources: [], idleCount: 0, unreachableCount: 0, idleTimeoutMinutes: 10,
  isInitialized: true, init: () => () => {}, stopResource: vi.fn(), stopAll: vi.fn(),
}) }));

import { ResourceChip } from '@/components/chat/ResourceChip';

beforeEach(() => mocks.loadActivity.mockClear());

it('reads the current activity owner when the resource popover opens with background polling stopped', async () => {
  render(<MemoryRouter><ResourceChip /></MemoryRouter>);
  expect(mocks.loadActivity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('resource-chip'));
  await waitFor(() => expect(mocks.loadActivity).toHaveBeenCalledWith({
    workspaceId: 'project-a', sessionKey: 'agent:main:parent',
  }));
  fireEvent.click(screen.getByTestId('resource-popover-close'));
  expect(mocks.loadActivity).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId('resource-chip'));
  await waitFor(() => expect(mocks.loadActivity).toHaveBeenCalledTimes(2));
});
