import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { PromptCacheRiskAssessment } from '@shared/types/workspace';

const fixture = vi.hoisted(() => ({
  chat: { currentSessionKey: 'agent:main:toolbar', currentAgentId: 'main', loading: false, refresh: vi.fn() },
  panel: { open: false, tabs: [], toggle: vi.fn(), openWorkspacePanel: vi.fn() },
  profiles: [
    { id: 'source', name: 'Source', coordinatorBindings: { 'agent:main:toolbar': { activeTaskNodeId: 'task', bindingRevision: 1 } } },
    { id: 'target', name: 'Target' },
  ],
  migrate: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/chat', () => ({ useChatStore: Object.assign(
  (selector: (state: typeof fixture.chat) => unknown) => selector(fixture.chat),
  { getState: () => fixture.chat },
) }));
vi.mock('@/stores/artifact-panel', () => ({ useArtifactPanel: (selector: (state: typeof fixture.panel) => unknown) => selector(fixture.panel) }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: (selector: (state: unknown) => unknown) => selector({ agents: [{ id: 'main', workspace: 'D:/tmp/toolbar' }] }) }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: (selector: (state: unknown) => unknown) => selector({ profiles: fixture.profiles }) }));
vi.mock('@/lib/host-api', () => ({ hostApi: { workspaces: { migrateExecution: fixture.migrate, executionMigration: vi.fn() } } }));
vi.mock('@/components/chat/ResourceChip', () => ({ ResourceChip: () => null }));
vi.mock('@/components/chat/MemoryInjectionPanel', () => ({ MemoryInjectionPanel: () => null }));

import { ChatToolbar } from '@/pages/Chat/ChatToolbar';

function toolbar(props: React.ComponentProps<typeof ChatToolbar> = {}) {
  return <MemoryRouter><TooltipProvider><ChatToolbar workspaceId="source" sessionGeneration="generation-a" {...props} /></TooltipProvider></MemoryRouter>;
}
beforeEach(() => { vi.clearAllMocks(); fixture.panel.open = false; });
afterEach(cleanup);

it('keeps migration open after dismissing More, then returns focus without starting a migration', async () => {
  render(toolbar());
  fireEvent.click(screen.getByTestId('chat-toolbar-more'));
  await waitFor(() => expect(screen.getByTestId('chat-toolbar-more-menu')).toBeVisible());
  fireEvent.click(screen.getByTestId('execution-migration-open'));
  expect(screen.getByTestId('execution-migration-dialog')).toBeVisible();
  expect(screen.getByTestId('chat-toolbar-more-menu')).not.toBeVisible();
  expect(screen.getByTestId('execution-migration-target')).toHaveTextContent('Target');
  expect(fixture.migrate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'migration.cancel' }));
  await waitFor(() => expect(screen.getByTestId('chat-toolbar-more')).toHaveFocus());
});

it('keeps guarded lifecycle actions in More and supports keyboard dismissal', async () => {
  const checkpoints = vi.fn();
  render(toolbar({ onCheckpoints: checkpoints, onForkSession: vi.fn(), forkDisabled: true, forkDisabledReason: 'Wait for this run', onHandoffSession: vi.fn(), handoffDisabled: true, handoffDisabledReason: 'Session identity is loading' }));
  expect(screen.getByTestId('chat-session-checkpoints')).not.toBeVisible();
  fireEvent.click(screen.getByTestId('chat-toolbar-more'));
  await waitFor(() => expect(screen.getByTestId('chat-toolbar-more-menu')).toHaveFocus());
  expect(screen.getByTestId('chat-session-fork')).toBeDisabled();
  expect(screen.getByTestId('chat-session-fork')).toHaveTextContent('Wait for this run');
  expect(screen.getByTestId('chat-session-handoff')).toBeDisabled();
  expect(screen.getByTestId('chat-session-handoff')).toHaveTextContent('Session identity is loading');
  fireEvent.keyDown(screen.getByTestId('chat-toolbar-more-menu'), { key: 'ArrowDown' });
  expect(screen.getByTestId('chat-session-checkpoints')).toHaveFocus();
  fireEvent.click(screen.getByTestId('chat-session-checkpoints'));
  expect(checkpoints).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId('chat-toolbar-more'));
  fireEvent.keyDown(screen.getByTestId('chat-toolbar-more-menu'), { key: 'Escape' });
  expect(screen.getByTestId('chat-toolbar-more')).toHaveFocus();
});

it('clears a recovered cache warning even when the session retains its risk history', () => {
  const assessment = { status: 'at-risk', lastRiskEvent: { reason: 'model-changed' }, hitRate: 0.2, cacheReadTokens: 200, cacheWriteTokens: 800 } as PromptCacheRiskAssessment;
  const view = render(toolbar({ promptCacheStatus: assessment }));
  expect(screen.getByTestId('chat-prompt-cache-status')).toBeVisible();
  view.rerender(toolbar({ promptCacheStatus: { ...assessment, status: 'warm' } }));
  expect(screen.queryByTestId('chat-prompt-cache-status')).toBeNull();
});

it('keeps the environment control reachable while workspace tabs are open', () => {
  fixture.panel.open = true;
  const toggle = vi.fn();
  render(toolbar({ sessionActivityAvailable: true, sessionActivityNeedsAttention: true, onToggleSessionActivity: toggle }));
  fireEvent.click(screen.getByTestId('chat-session-activity-toggle'));
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.getByTestId('chat-session-activity-toggle').closest('[aria-hidden="true"]')).toBeNull();
});
