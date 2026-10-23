import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryPage } from '@/pages/Memory';
import type { MemorySurfaceEntry, MemorySurfaceSnapshot } from '@shared/types/memory';

const {
  surfaceMock,
  approveCandidateMock,
  deleteMock,
  rememberMock,
  exportMock,
  toastMock,
} = vi.hoisted(() => ({
  surfaceMock: vi.fn(),
  approveCandidateMock: vi.fn(),
  deleteMock: vi.fn(),
  rememberMock: vi.fn(),
  exportMock: vi.fn(),
  toastMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    memory: {
      surface: (...args: unknown[]) => surfaceMock(...args),
      approveCandidate: (...args: unknown[]) => approveCandidateMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
      remember: (...args: unknown[]) => rememberMock(...args),
      export: (...args: unknown[]) => exportMock(...args),
    },
  },
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (state: { activeWorkspace: { rootPath: string } }) => unknown) => selector({
    activeWorkspace: { rootPath: 'D:/workspace/project' },
  }),
}));

const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('sonner', () => ({ toast: toastMock }));

const acceptedEntry: MemorySurfaceEntry = {
  key: 'role-memory-card:accepted-1',
  id: 'accepted-1',
  source: 'role-memory-card',
  state: 'accepted',
  stateLabel: 'active',
  content: 'The user prefers conventional commits.',
  scope: 'workspace',
  scopeKey: 'D:/workspace/project',
  roleTags: ['architect'],
  sourceLabel: 'user',
  createdAt: '2026-10-23T00:00:00.000Z',
  updatedAt: null,
  sensitivity: 'normal',
  confidence: 0.95,
  importance: 0.8,
  evidenceCount: 1,
  provenance: ['manual:test'],
  injectable: true,
  retrievable: true,
  modelVisible: true,
  deletable: true,
};

const candidateEntry: MemorySurfaceEntry = {
  key: 'runtime-fact:candidate-1',
  id: 'candidate-1',
  source: 'runtime-fact',
  state: 'candidate',
  stateLabel: 'candidate',
  content: 'user prefers concise release notes',
  subject: 'user',
  predicate: 'prefers',
  objectSummary: 'concise release notes',
  scope: 'task',
  scopeKey: 'task-1',
  roleTags: [],
  sourceLabel: 'task_event',
  createdAt: '2026-10-23T01:00:00.000Z',
  updatedAt: null,
  sensitivity: 'normal',
  confidence: 0.82,
  importance: null,
  evidenceCount: 2,
  provenance: ['trace:run-1'],
  injectable: false,
  retrievable: false,
  modelVisible: false,
  deletable: false,
  proposalId: 'candidate-1',
  reason: 'Awaiting owner approval',
};

function makeSnapshot(overrides: Partial<MemorySurfaceSnapshot> = {}): MemorySurfaceSnapshot {
  return {
    schemaVersion: 'MemorySurface/v1',
    generatedAt: '2026-10-23T02:00:00.000Z',
    accepted: [acceptedEntry],
    candidates: [candidateEntry],
    status: {
      roleMemory: {
        owner: 'role-memory-card-governance',
        enabled: true,
        readGate: 'open',
        writeGate: 'open',
        candidateCapture: true,
        candidatePersistence: true,
        modelRetrieval: true,
      },
      runtimeMemory: {
        owner: 'runtime-memory-store',
        enabled: true,
        readGate: 'open',
        writeGate: 'open',
        candidateCapture: true,
        candidatePersistence: true,
        modelRetrieval: true,
        persist: true,
        provider: true,
        injectionPilotEnabled: true,
        injectionProviders: ['role-memory', 'runtime-memory'],
      },
      legacySources: [{
        id: 'native-openclaw-memory',
        controlledHere: false,
        mayAffectPrompt: true,
        explanation: 'Native OpenClaw memory has a separate owner.',
      }],
    },
    model: {
      acceptedOnly: true,
      acceptedKeys: [acceptedEntry.key],
      candidateKeysExcluded: [candidateEntry.key],
      candidateBoundary: 'Candidates are not model-visible.',
      productDescription: 'One reviewable Memory concept.',
      approvalBoundary: 'Only accepted memory enters prompts.',
    },
    counts: { accepted: 1, candidates: 1, modelVisible: 1 },
    ...overrides,
  };
}

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    surfaceMock.mockResolvedValue({ success: true, ...makeSnapshot() });
  });

  it('shows accepted memory separately from non-model-visible candidates', async () => {
    render(<MemoryPage />);

    const accepted = await screen.findByTestId('memory-accepted-item');
    expect(accepted).toHaveAttribute('data-model-visible', 'true');
    expect(accepted).toHaveTextContent('The user prefers conventional commits.');

    fireEvent.click(screen.getByTestId('memory-tab-candidates'));
    const candidate = await screen.findByTestId('memory-candidate-item');
    expect(candidate).toHaveAttribute('data-model-visible', 'false');
    expect(candidate).toHaveTextContent('candidate');
    expect(screen.getByTestId('memory-legacy-boundary')).toHaveTextContent('memoryPage.legacyBoundaryDescription');
    expect(surfaceMock).toHaveBeenCalledWith({ limit: 200 });
  });

  it('approves through the typed façade and reloads the owner projection', async () => {
    approveCandidateMock.mockResolvedValue({ success: true, approved: true, acceptedId: 'accepted-2' });
    render(<MemoryPage />);

    fireEvent.click(await screen.findByTestId('memory-tab-candidates'));
    fireEvent.click(await screen.findByTestId('memory-approve-button'));

    await waitFor(() => expect(approveCandidateMock).toHaveBeenCalledWith({
      source: 'runtime-fact',
      id: 'candidate-1',
    }));
    await waitFor(() => expect(surfaceMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(toastMock.success).toHaveBeenCalledWith('memoryPage.approved');
  });

  it('deletes accepted memory through the owner-dispatched delete API', async () => {
    deleteMock.mockResolvedValue({ success: true, deleted: true });
    render(<MemoryPage />);

    fireEvent.click(await screen.findByTestId('memory-delete-button'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm-button'));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({
      source: 'role-memory-card',
      id: 'accepted-1',
      reason: 'memoryPage.deleteReason',
    }));
    await waitFor(() => expect(surfaceMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(toastMock.success).toHaveBeenCalledWith('memoryPage.deleted');
  });

  it('creates Remember this as a normal proposal and selects the candidate queue when review is required', async () => {
    rememberMock.mockResolvedValue({
      success: true,
      accepted: false,
      reviewRequired: true,
      proposalId: 'proposal-2',
      reason: 'needs review',
    });
    render(<MemoryPage />);

    fireEvent.click(await screen.findByTestId('memory-remember-button'));
    fireEvent.change(screen.getByTestId('memory-remember-content'), {
      target: { value: 'Remember to use pnpm for package scripts.' },
    });
    fireEvent.change(screen.getByTestId('memory-remember-role'), {
      target: { value: 'architect' },
    });
    fireEvent.click(screen.getByTestId('memory-remember-submit'));

    await waitFor(() => expect(rememberMock).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Remember to use pnpm for package scripts.',
      type: 'fact',
      scope: 'workspace',
      scopeKey: 'D:/workspace/project',
      roleTags: ['architect'],
      sensitivity: 'normal',
    })));
    await waitFor(() => expect(screen.getByTestId('memory-tab-candidates')).toHaveAttribute('data-state', 'active'));
    expect(toastMock.warning).toHaveBeenCalledWith('needs review');
  });

  it('exports through Host API and renders the disk path and digest receipt', async () => {
    exportMock.mockResolvedValue({
      success: true,
      path: 'D:/userData/exports/memory/memory-export.json',
      sha256: 'a'.repeat(64),
      generatedAt: '2026-10-23T02:01:00.000Z',
      counts: { accepted: 1, candidates: 1, redacted: 0 },
    });
    render(<MemoryPage />);

    fireEvent.click(await screen.findByTestId('memory-export-button'));

    await waitFor(() => expect(exportMock).toHaveBeenCalledWith({ format: 'json' }));
    expect(await screen.findByTestId('memory-export-path')).toHaveTextContent('memory-export.json');
    expect(screen.getByTestId('memory-export-receipt')).toHaveTextContent('a'.repeat(64));
  });

  it('shows a retryable error instead of inventing empty memory when Host is unavailable', async () => {
    surfaceMock.mockResolvedValue({ success: false, error: 'Gateway manager unavailable' });
    render(<MemoryPage />);

    expect(await screen.findByTestId('memory-error')).toHaveTextContent('Gateway manager unavailable');
    expect(screen.queryByTestId('memory-accepted-empty')).toBeNull();
  });

  it('uses only the typed renderer facade', async () => {
    const source = await readFile('src/pages/Memory/index.tsx', 'utf8');
    expect(source).not.toMatch(/ipcRenderer|127\.0\.0\.1:18789|gateway\.rpc/);
    expect(source).toContain('hostApi.memory.surface');
    expect(source).toContain('hostApi.memory.approveCandidate');
    expect(source).toContain('hostApi.memory.delete');
    expect(source).toContain('hostApi.memory.remember');
    expect(source).toContain('hostApi.memory.export');
  });
});
