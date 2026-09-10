import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLiveBrowserPanel } from '@/components/file-preview/WorkspaceLiveBrowserPanel';

const statusMock = vi.fn();
const profilesMock = vi.fn();
const openMock = vi.fn();
const createTaskMock = vi.fn();
const setBrowserSessionId = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agentBrowser: {
      status: (...args: unknown[]) => statusMock(...args),
      profiles: (...args: unknown[]) => profilesMock(...args),
      open: (...args: unknown[]) => openMock(...args),
      createTask: (...args: unknown[]) => createTaskMock(...args),
      navigate: vi.fn(),
      pressKey: vi.fn(),
      screenshot: vi.fn(),
      takeSnapshot: vi.fn(),
      focus: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      requestModeUpgrade: vi.fn(),
      close: vi.fn(),
      clickByUid: vi.fn(),
      fillByUid: vi.fn(),
      networkListRequests: vi.fn(),
      getConsoleMessages: vi.fn(),
      jsListResources: vi.fn(),
      sourceMapListCandidates: vi.fn(),
      runtimeInspectGlobals: vi.fn(),
    },
  },
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: unknown) => unknown) => selector({
    browserSessionId: null,
    browserUrl: 'https://example.com/status',
    setBrowserSessionId,
  }),
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (state: unknown) => unknown) => selector({
    activeWorkspace: {
      id: 'workspace-demo',
      agentId: 'main',
      activeSessionKey: 'agent:main:main',
    },
  }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ currentSessionKey: 'agent:main:main' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('WorkspaceLiveBrowserPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profilesMock.mockResolvedValue({ success: true, profiles: [{ profile: 'work', label: 'Work', source: 'metadata' }] });
    openMock.mockResolvedValue({
      success: true,
      session: {
        id: 'browser-1', profile: 'work', mode: 'headless', url: 'https://example.com/status', title: 'Status',
        createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
      },
    });
    createTaskMock.mockResolvedValue({ success: true, task: { id: 'task-1', status: 'waiting-approval' } });
  });

  it('opens a workspace-owned headless session using the selected profile', async () => {
    statusMock.mockResolvedValue({ success: true, sessions: [] });
    render(<WorkspaceLiveBrowserPanel />);

    await screen.findByRole('button', { name: 'workspace.open' });
    fireEvent.change(screen.getByLabelText('workspace.mode'), { target: { value: 'headless' } });
    fireEvent.click(screen.getByRole('button', { name: 'workspace.open' }));

    await waitFor(() => expect(openMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/status',
      mode: 'headless',
      profile: 'work',
      authPersistence: 'profile',
      workspaceId: 'workspace-demo',
      sessionKey: 'agent:main:main',
      agentId: 'main',
    })));
  });

  it('creates a current-page automation as an approval-bound workspace task', async () => {
    statusMock.mockResolvedValue({
      success: true,
      sessions: [{
        id: 'browser-1', profile: 'work', mode: 'visible', url: 'https://example.com/status', title: 'Status',
        createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
      }],
    });
    render(<WorkspaceLiveBrowserPanel />);

    await screen.findByLabelText('workspace.more');
    expect(document.querySelector('.rs-browser-actions > button[aria-label="workspace.focus"]')).toBeNull();
    expect(document.querySelector('.rs-browser-actions > button[aria-label="workspace.screenshot"]')).toBeNull();
    fireEvent.click(screen.getByLabelText('workspace.more'));
    expect(screen.getByRole('button', { name: 'workspace.focus' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'workspace.screenshot' })).toBeVisible();
    fireEvent.click(screen.getByText('workspace.automation.open'));
    fireEvent.change(screen.getByLabelText('workspace.automation.success'), { target: { value: 'Operational' } });
    fireEvent.click(screen.getByRole('button', { name: 'workspace.automation.submit' }));

    await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/status',
      profile: 'work',
      mode: 'headless',
      allowedDomains: ['example.com'],
      steps: [{ action: 'wait-for-selector', selector: 'body' }],
      successCriteria: { kind: 'text-includes', value: 'Operational' },
      workspaceId: 'workspace-demo',
      sessionKey: 'agent:main:main',
      agentId: 'main',
    })));
  });
});
