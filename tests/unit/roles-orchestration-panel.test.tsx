import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import RolesOrchestrationPanel from '@/components/agents/RolesOrchestrationPanel';

const { gatewayRpcMock, appendEventsMock, translate } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  appendEventsMock: vi.fn(),
  translate: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
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
    memory: {
      list: vi.fn(),
      explainInjection: vi.fn(),
      health: vi.fn(),
      detail: vi.fn(),
      propose: vi.fn(),
      feedback: vi.fn(),
      delete: vi.fn(),
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
  useSettingsStore: (selector: (state: { roleMemoryEnabled: boolean }) => unknown) => selector({ roleMemoryEnabled: false }),
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
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'roles.list') {
        return {
          roles: [{ name: 'planner', displayName: 'Planner', tools: ['read'], effort: 'medium' }],
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
      return {};
    });
    appendEventsMock.mockResolvedValue({ success: true, snapshot: { nodes: [] } });
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
});
