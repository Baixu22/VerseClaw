import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectConfigurationPanel } from '@/components/agents/ProjectConfigurationPanel';
import { KnowledgeOperationsSettings } from '@/components/settings/KnowledgeOperationsSettings';
import { PROJECT_RAG_DEFAULTS, type ProjectRagConfigV2, type RetrievalCapabilitySnapshotV1 } from '@shared/knowledge/operations';
import type { ProjectConfigurationResult } from '@shared/project-configuration';

const host = vi.hoisted(() => ({
  configurationOperations: vi.fn(), previewConfiguration: vi.fn(), applyConfiguration: vi.fn(), reconcileConfiguration: vi.fn(),
  operationsStatus: vi.fn(), operationsConfigure: vi.fn(),
}));
vi.mock('@/lib/host-api', () => ({ hostApi: { workspaces: host, knowledge: host } }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: (select: (state: { activeWorkspaceId: string }) => unknown) => select({ activeWorkspaceId: 'project-a' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

it('keeps pending configuration recovery available through edits and previews', async () => {
  const values = { modelRef: 'provider/model', denyTools: [], contextTokens: 4096 };
  const pending: ProjectConfigurationResult = { requestId: 'original-request', workspaceId: 'project-a', agentId: 'main',
    phase: 'pending', desired: values, configured: values, effective: null, runtimeGeneration: null, error: null };
  host.configurationOperations.mockResolvedValue([pending]);
  host.previewConfiguration.mockResolvedValue({ workspaceId: 'project-a', ownerKey: 'owner', agentId: 'main', configRevision: 'rev',
    digest: 'digest', before: values, desired: { ...values, contextTokens: 2048 } });
  host.reconcileConfiguration.mockResolvedValue({ ...pending, phase: 'rolled-back', effective: values });
  await act(async () => { render(<ProjectConfigurationPanel workspaceId="project-a" ownerKey="owner" />); });
  const panel = screen.getByTestId('project-config-project-a') as HTMLDetailsElement;
  panel.open = true;
  fireEvent.change(screen.getByTestId('project-config-context-project-a'), { target: { value: '2048' } });
  expect(screen.getByTestId('project-config-recover-project-a')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByTestId('project-config-preview-project-a')); });
  expect(screen.getByTestId('project-config-recover-project-a')).toBeVisible();
  expect(screen.getByTestId('project-config-apply-project-a')).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByTestId('project-config-recover-project-a')); });
  expect(host.reconcileConfiguration).toHaveBeenCalledWith({ workspaceId: 'project-a', ownerKey: 'owner', requestId: 'original-request' });
  expect(screen.queryByTestId('project-config-recover-project-a')).not.toBeInTheDocument();
  expect(screen.getByTestId('project-config-apply-project-a')).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByTestId('project-config-preview-project-a')); });
  expect(screen.getByTestId('project-config-apply-project-a')).toBeEnabled();
});

function operations(config: ProjectRagConfigV2): RetrievalCapabilitySnapshotV1 {
  return { schema: 'RetrievalCapabilitySnapshot/v1', owner: { namespaceId: 'wiki:project-a', workspaceId: 'project-a', sessionId: 'session' },
    config, status: 'ready', reasons: [], index: { schema: 'IndexStatus/v1', status: 'running', lastError: null, sources: [], jobs: [],
      activeWorker: false, workerThreadIds: [], lagCount: 0, logicalDeletedCount: 0, cleanupPendingGenerations: 0,
      storage: { bytes: 0, budgetBytes: config.maxStorageBytes, budgetExceeded: false } } };
}

it('keeps operations blocked until a fresh poll confirms the saved configuration', async () => {
  vi.useFakeTimers();
  let finishOld!: (value: unknown) => void;
  const old = operations(PROJECT_RAG_DEFAULTS);
  const configured = { ...PROJECT_RAG_DEFAULTS, profile: 'quality' as const };
  host.operationsStatus.mockResolvedValue({ success: true, operations: old });
  host.operationsConfigure.mockResolvedValue({ success: true, config: configured, restartRequired: true });
  await act(async () => { render(<MemoryRouter><KnowledgeOperationsSettings /></MemoryRouter>); });
  fireEvent.change(screen.getByTestId('operations-profile'), { target: { value: 'quality' } });
  host.operationsStatus.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => { vi.advanceTimersByTime(2000); });
  await act(async () => { fireEvent.click(screen.getByTestId('operations-save')); });
  await act(async () => finishOld({ success: true, operations: old }));
  expect(screen.getByTestId('operations-save')).toBeDisabled();
  expect(screen.getByTestId('index-rebuild')).toBeDisabled();
  expect(screen.getByText('operations.restarting')).toBeVisible();
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByTestId('operations-save')).toBeDisabled();
  host.operationsStatus.mockResolvedValue({ success: true, operations: operations(configured) });
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByTestId('operations-save')).toBeEnabled();
  expect(screen.getByTestId('operations-profile')).toHaveValue('quality');
  expect(screen.queryByText('operations.restarting')).not.toBeInTheDocument();
});
