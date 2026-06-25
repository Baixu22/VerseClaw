import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteTasks } from '@/pages/RemoteTasks';

const listMock = vi.fn();
const createMock = vi.fn();
const previewMock = vi.fn();
const approveMock = vi.fn();
const rejectMock = vi.fn();
const executeMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    remoteTasks: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      preview: (...args: unknown[]) => previewMock(...args),
      approve: (...args: unknown[]) => approveMock(...args),
      reject: (...args: unknown[]) => rejectMock(...args),
      execute: (...args: unknown[]) => executeMock(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe('RemoteTasks page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({ success: true, tasks: [], generatedAt: '2026-06-23T00:00:00.000Z' });
    previewMock.mockResolvedValue({ success: true, requiresApproval: false, changes: [] });
  });

  it('loads an empty inbox and creates a local message task through hostApi', async () => {
    createMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-1',
        source: 'local',
        status: 'pending',
        command: { kind: 'message', title: 'form.defaultTitle', body: 'form.defaultBody' },
        createdAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:00:00.000Z',
        approvedAt: null,
        completedAt: null,
      },
    });

    render(<RemoteTasks />);

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.getByTestId('remote-tasks-page')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('remote-task-create'));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'local',
      command: {
        kind: 'message',
        title: 'form.defaultTitle',
        body: 'form.defaultBody',
      },
    })));
    expect(toastSuccessMock).toHaveBeenCalledWith('toast.created');
  });

  it('approves a pending settings task from the detail pane', async () => {
    const task = {
      id: 'task-approval',
      source: 'local',
      status: 'pendingApproval',
      command: { kind: 'settingsPatch', patch: { theme: 'system' } },
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
      approvedAt: null,
      completedAt: null,
    };
    listMock.mockResolvedValue({ success: true, tasks: [task], generatedAt: '2026-06-23T00:00:00.000Z' });
    previewMock.mockResolvedValue({
      success: true,
      requiresApproval: true,
      changes: [{ key: 'theme', before: 'dark', after: 'system' }],
    });
    approveMock.mockResolvedValue({
      success: true,
      task: { ...task, status: 'pending', approvedAt: '2026-06-23T00:01:00.000Z' },
    });

    render(<RemoteTasks />);

    await waitFor(() => expect(screen.getAllByText('theme').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('actions.approve'));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith({ id: 'task-approval' }));
  });
});
