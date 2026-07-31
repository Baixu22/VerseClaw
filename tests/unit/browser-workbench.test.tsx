import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWorkbench } from '@/pages/Browser';

const statusMock = vi.fn();
const profilesMock = vi.fn();
const tasksMock = vi.fn();
const vaultMock = vi.fn();
const createTaskMock = vi.fn();
const approveTaskMock = vi.fn();
const rejectTaskMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agentBrowser: {
      status: (...args: unknown[]) => statusMock(...args),
      profiles: (...args: unknown[]) => profilesMock(...args),
      tasks: (...args: unknown[]) => tasksMock(...args),
      vault: (...args: unknown[]) => vaultMock(...args),
      createTask: (...args: unknown[]) => createTaskMock(...args),
      approveTask: (...args: unknown[]) => approveTaskMock(...args),
      rejectTask: (...args: unknown[]) => rejectTaskMock(...args),
      show: vi.fn(),
      hide: vi.fn(),
      close: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      deleteCredential: vi.fn(),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Browser workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusMock.mockResolvedValue({
      success: true,
      sessions: [{
        id: 'session-1',
        profile: 'work',
        mode: 'headless',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
      }],
    });
    profilesMock.mockResolvedValue({ success: true, profiles: [{ profile: 'default', source: 'metadata' }] });
    tasksMock.mockResolvedValue({ success: true, tasks: [] });
    vaultMock.mockResolvedValue({ success: true, credentials: [] });
  });

  it('loads real session, task, profile, and vault data through hostApi', async () => {
    render(<BrowserWorkbench />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(tasksMock).toHaveBeenCalled();
    expect(profilesMock).toHaveBeenCalled();
    expect(vaultMock).toHaveBeenCalled();
    expect(screen.getByTestId('browser-workbench')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });

  it('creates a browser task for approval without running it', async () => {
    createTaskMock.mockResolvedValue({ success: true, task: { id: 'task-1', status: 'waiting-approval' } });
    render(<BrowserWorkbench />);

    const tasksTab = screen.getByRole('tab', { name: 'tabs.tasks' });
    fireEvent.mouseDown(tasksTab, { button: 0, ctrlKey: false });
    fireEvent.click(tasksTab);
    const nameInput = await screen.findByLabelText('tasks.name');
    fireEvent.change(nameInput, { target: { value: 'Check status' } });
    fireEvent.change(screen.getByLabelText('tasks.url'), { target: { value: 'https://example.com' } });
    fireEvent.change(screen.getByLabelText('tasks.objective'), { target: { value: 'Read status' } });
    fireEvent.change(screen.getByLabelText('tasks.successValue'), { target: { value: 'All systems operational' } });
    fireEvent.click(screen.getByRole('button', { name: 'tasks.submitForApproval' }));

    await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Check status',
      url: 'https://example.com',
      objective: 'Read status',
      allowedDomains: [],
      profile: 'default',
      mode: 'headless',
      steps: [{ action: 'wait-for-selector', selector: 'body' }],
      successCriteria: { kind: 'text-includes', value: 'All systems operational' },
    })));
  });

  it('shows persisted approval scope and approves by task id only', async () => {
    tasksMock.mockResolvedValue({
      success: true,
      tasks: [{
        id: 'task-approval',
        name: 'Review release notes',
        url: 'https://example.com/releases',
        objective: 'Open the release notes and verify the heading',
        profile: 'default',
        mode: 'headless',
        allowedDomains: ['example.com'],
        permissionScope: ['navigate', 'read-page'],
        steps: [
          { id: 'step-1', action: 'navigate', url: 'https://example.com/releases', status: 'pending' },
          { id: 'step-2', action: 'wait-for-selector', selector: 'h1', status: 'pending' },
        ],
        successCriteria: { kind: 'selector-visible', value: 'h1' },
        approval: { status: 'pending', requestedAt: '2026-07-29T10:00:00.000Z' },
        counters: { totalSteps: 2, passedSteps: 0, failedSteps: 0 },
        status: 'waiting-approval',
        retryCount: 0,
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:00:00.000Z',
      }],
    });
    approveTaskMock.mockResolvedValue({ success: true, task: { id: 'task-approval', status: 'completed' } });
    render(<BrowserWorkbench />);

    const tasksTab = screen.getByRole('tab', { name: 'tabs.tasks' });
    fireEvent.mouseDown(tasksTab, { button: 0, ctrlKey: false });
    fireEvent.click(tasksTab);
    expect(await screen.findByTestId('task-approval-task-approval')).toHaveTextContent('example.com');
    expect(screen.getByTestId('task-approval-task-approval')).toHaveTextContent('permissionScope.navigate');
    fireEvent.click(screen.getByRole('button', { name: 'actions.approve' }));

    await waitFor(() => expect(approveTaskMock).toHaveBeenCalledWith({ taskId: 'task-approval' }));
  });
});
