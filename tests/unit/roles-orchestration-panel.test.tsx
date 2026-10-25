import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import RolesOrchestrationPanel from '@/components/agents/RolesOrchestrationPanel';

const {
  gatewayRpcMock,
  appendEventsMock,
  upsertConfigRoleMock,
  memoryListMock,
  memoryExplainInjectionMock,
  memoryHealthMock,
  memoryProposeFactsListMock,
  translate,
  settingsState,
} = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  appendEventsMock: vi.fn(),
  upsertConfigRoleMock: vi.fn(),
  memoryListMock: vi.fn(),
  memoryExplainInjectionMock: vi.fn(),
  memoryHealthMock: vi.fn(),
  memoryProposeFactsListMock: vi.fn(),
  translate: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  settingsState: { roleMemoryEnabled: false },
}));

vi.mock('@/components/agents/SubagentRunnerPanel', () => ({
  SubagentRunnerPanel: () => <div data-testid="subagent-runner-panel" />,
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    gateway: {
      rpc: (...args: unknown[]) => gatewayRpcMock(...args),
    },
    taskLedger: {
      appendEvents: (...args: unknown[]) => appendEventsMock(...args),
    },
    roles: {
      upsertConfigRole: (...args: unknown[]) => upsertConfigRoleMock(...args),
    },
    memory: {
      list: (...args: unknown[]) => memoryListMock(...args),
      explainInjection: (...args: unknown[]) => memoryExplainInjectionMock(...args),
      health: (...args: unknown[]) => memoryHealthMock(...args),
      detail: vi.fn(),
      propose: vi.fn(),
      feedback: vi.fn(),
      proposeFactsList: (...args: unknown[]) => memoryProposeFactsListMock(...args),
      proposeFactsConfirm: vi.fn(),
    },
    permissions: {
      decideApproval: vi.fn(),
    },
    taskLoop: {
      start: vi.fn(),
    },
    missions: {
      start: vi.fn(),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onSubagentLifecycle: vi.fn(() => vi.fn()),
    onTaskLoopLifecycle: vi.fn(() => vi.fn()),
    onMissionControlLifecycle: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { roleMemoryEnabled: boolean }) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (state: { activeWorkspaceId: string | null }) => unknown) => selector({ activeWorkspaceId: 'default' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

function renderPanel() {
  return render(
    <TooltipProvider>
      <RolesOrchestrationPanel
        agents={[{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: 'agent:main:abc' }]}
      />
    </TooltipProvider>,
  );
}

describe('RolesOrchestrationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.roleMemoryEnabled = false;
    memoryListMock.mockResolvedValue({ success: true, cards: [] });
    memoryExplainInjectionMock.mockResolvedValue({ success: true, injections: [] });
    memoryHealthMock.mockResolvedValue({ success: true, ok: true, checks: [] });
    memoryProposeFactsListMock.mockResolvedValue({ success: true, enabled: false, candidates: [] });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'roles.list') {
        return {
          roles: [
            { name: 'planner', displayName: 'Planner', rolePrompt: 'Plan work', tools: ['read'], effort: 'medium', origin: 'built-in' },
            { name: 'docs-helper', displayName: 'Docs Helper', rolePrompt: 'Write docs', tools: ['read'], effort: 'low', origin: 'config', tags: ['docs'] },
          ],
        };
      }
      if (method === 'orchestrator.plan') {
        return {
          plan: {
            mode: 'lead-workers',
            leadRole: 'planner',
            workers: [{ roleName: 'planner', task: 'Plan the work' }],
            reasons: ['explicit-workers'],
            taskGraph: {
              graphRunId: 'explicit-workers',
              status: 'planned',
              nodes: [{
                taskNodeId: 'planner-1',
                roleName: 'planner',
                task: 'Plan the work',
                phase: 'planning',
                dependsOn: [],
                scope: 'Plan the work',
                requiredCapabilities: [],
                status: 'ready',
              }],
              edges: [],
            },
          },
        };
      }
      if (method === 'memory.archive') {
        return { card: { id: 'mem-1', status: 'tombstone' } };
      }
      if (method === 'memory.proposals') {
        return {
          proposals: [{
            id: 'prop-session-summary',
            operation: 'create',
            status: 'needs_review',
            decision: 'needs_review',
            reviewReason: 'Missing source metadata needs review.',
            reasonSummary: 'Needs review because source metadata is incomplete.',
            proposal: {
              content: 'Use pnpm run i18n:lint after changing locale files.',
              confidence: 0.71,
              source: 'session_summary',
            },
            evidenceStatus: 'unchecked',
          }],
        };
      }
      return {};
    });
    appendEventsMock.mockResolvedValue({ success: true, snapshot: { nodes: [] } });
    upsertConfigRoleMock.mockResolvedValue({
      success: true,
      pendingRuntimeRefresh: true,
      role: {
        name: 'qa-helper',
        displayName: 'QA Helper',
        rolePrompt: 'Check risky paths',
        tools: ['read', 'shell'],
        effort: 'medium',
        permissions: { filesystem: 'read', network: 'none', commands: [] },
        tags: ['qa'],
        origin: 'config',
      },
    });
  });

  it('records successful orchestration plan previews to Task Ledger as read-only projections', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
    fireEvent.change(screen.getByTestId('role-orchestration-task-input'), {
      target: { value: 'Stabilize smoke tests' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));

    await waitFor(() => {
      expect(appendEventsMock).toHaveBeenCalled();
    });
    expect(appendEventsMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'default',
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'node_created',
          payload: expect.objectContaining({
            node: expect.objectContaining({
              kind: 'goal',
              metadata: expect.objectContaining({
                readonlyProjection: true,
                source: 'orchestrator.plan',
              }),
            }),
          }),
        }),
      ]),
    }));
  });

  it('saves lightweight plan edits to Task Ledger without creating a DAG editor', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
    fireEvent.change(screen.getByTestId('role-orchestration-task-input'), {
      target: { value: 'Stabilize smoke tests' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));

    await screen.findByTestId('orchestration-plan-edit-toggle');
    appendEventsMock.mockClear();
    fireEvent.click(screen.getByTestId('orchestration-plan-edit-toggle'));
    fireEvent.click(screen.getByTestId('orchestration-plan-disable-planner-1'));
    fireEvent.change(screen.getByTestId('orchestration-plan-note-planner-1'), {
      target: { value: 'Skip planner slice for this run' },
    });
    fireEvent.click(screen.getByTestId('orchestration-plan-save-edits'));

    await waitFor(() => {
      expect(appendEventsMock).toHaveBeenCalledWith(expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'node_updated',
            payload: expect.objectContaining({
              patch: expect.objectContaining({
                metadata: expect.objectContaining({
                  projectionEdit: expect.objectContaining({
                    auditReason: expect.stringMatching(/plan edit/i),
                  }),
                }),
              }),
            }),
          }),
        ]),
      }));
    });
    expect(screen.queryByTestId('orchestration-plan-edge-editor')).toBeNull();
  });

  it('creates a config-backed role through the typed host API and shows pending runtime refresh state', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
    fireEvent.click(await screen.findByTestId('role-config-create'));
    fireEvent.change(screen.getByTestId('role-config-name'), { target: { value: 'qa-helper' } });
    fireEvent.change(screen.getByTestId('role-config-display-name'), { target: { value: 'QA Helper' } });
    fireEvent.change(screen.getByTestId('role-config-prompt'), { target: { value: 'Check risky paths' } });
    fireEvent.change(screen.getByTestId('role-config-tools'), { target: { value: 'read, shell' } });
    fireEvent.change(screen.getByTestId('role-config-tags'), { target: { value: 'qa' } });
    fireEvent.click(screen.getByTestId('role-config-save'));

    await waitFor(() => {
      expect(upsertConfigRoleMock).toHaveBeenCalledWith(expect.objectContaining({
        name: 'qa-helper',
        displayName: 'QA Helper',
        rolePrompt: 'Check risky paths',
        tools: ['read', 'shell'],
        effort: 'medium',
        permissions: expect.objectContaining({
          filesystem: 'read',
          network: 'none',
          commands: [],
        }),
        tags: ['qa'],
      }));
    });
    expect(await screen.findByTestId('role-config-pending-runtime')).toHaveTextContent('Saved to config');
  });

  it('edits only config roles from the selected role detail', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
    fireEvent.click(await screen.findByText('Docs Helper'));
    fireEvent.click(screen.getByTestId('role-config-edit-selected'));
    expect(screen.getByTestId('role-config-name')).toBeDisabled();
    expect(screen.getByTestId('role-config-name')).toHaveValue('docs-helper');
    expect(screen.getByTestId('role-config-display-name')).toHaveValue('Docs Helper');

    fireEvent.change(screen.getByTestId('role-config-display-name'), { target: { value: 'Docs Lead' } });
    fireEvent.change(screen.getByTestId('role-config-prompt'), { target: { value: 'Keep docs polished' } });
    fireEvent.click(screen.getByTestId('role-config-save'));

    await waitFor(() => {
      expect(upsertConfigRoleMock).toHaveBeenCalledWith(expect.objectContaining({
        name: 'docs-helper',
        displayName: 'Docs Lead',
        rolePrompt: 'Keep docs polished',
      }));
    });
  });

  it('does not offer editing for built-in roles', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
    fireEvent.click(await screen.findByText('Planner'));

    expect(screen.queryByTestId('role-config-edit-selected')).toBeNull();
  });

  it('exports accepted memory through the single surface and deletes through tombstone confirmation', async () => {
    settingsState.roleMemoryEnabled = true;
    memoryListMock.mockResolvedValue({
      success: true,
      cards: [{
        id: 'mem-1',
        type: 'procedure',
        status: 'active',
        content: 'Keep migration notes for future runs.',
        source: 'user',
        createdAt: '2026-10-21T00:00:00.000Z',
      }],
    });

    const createObjectUrl = vi.fn(() => 'blob:tf-0498');
    const revokeObjectUrl = vi.fn();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      renderPanel();
      fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
      fireEvent.click(await screen.findByText('Planner'));
      await screen.findByTestId('role-memory-card');

      fireEvent.click(screen.getByTestId('memory-export'));
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('role-memory-delete'));
      fireEvent.click(await screen.findByTestId('confirm-dialog-confirm-button'));
      await waitFor(() => {
        expect(gatewayRpcMock).toHaveBeenCalledWith('memory.archive', { id: 'mem-1', tombstone: true });
      });
    } finally {
      clickSpy.mockRestore();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
    }
  });

  it('shows memory proposal source metadata in the review queue without claiming automatic writes', async () => {
    settingsState.roleMemoryEnabled = true;
    renderPanel();

    fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
    fireEvent.click(await screen.findByText('Planner'));
    await waitFor(() => {
      expect(gatewayRpcMock).toHaveBeenCalledWith('memory.proposals', expect.objectContaining({ roleName: 'planner' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('role-memory-review-tab')).toHaveTextContent('Review (1)');
    });
    const reviewTab = screen.getByTestId('role-memory-review-tab');
    await act(async () => {
      reviewTab.focus();
      fireEvent.keyDown(reviewTab, { key: 'Enter' });
    });

    expect(await screen.findByTestId('role-memory-proposal-source')).toHaveTextContent('session_summary');
    expect(screen.getByTestId('role-memory-proposal-confidence')).toHaveTextContent('71%');
    expect(screen.getByTestId('role-memory-proposal-needs-review')).toHaveTextContent('Needs review because source metadata is incomplete.');
    expect(screen.queryByText(/automatic|automatically|auto write|long-term memory for every task/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('role-memory-composer-info')).toBeInTheDocument();
    expect(screen.queryByText(/low-risk proposals may be accepted|low-risk.*policy/i)).not.toBeInTheDocument();
  });
});
