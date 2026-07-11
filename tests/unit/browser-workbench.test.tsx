import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWorkbench } from '@/pages/Browser';

const statusMock = vi.fn();
const profilesMock = vi.fn();
const tasksMock = vi.fn();
const vaultMock = vi.fn();
const createTaskMock = vi.fn();
const runTaskMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agentBrowser: {
      status: (...args: unknown[]) => statusMock(...args),
      profiles: (...args: unknown[]) => profilesMock(...args),
      tasks: (...args: unknown[]) => tasksMock(...args),
      vault: (...args: unknown[]) => vaultMock(...args),
      createTask: (...args: unknown[]) => createTaskMock(...args),
      runTask: (...args: unknown[]) => runTaskMock(...args),
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

  it('creates and immediately runs a browser task from the task composer', async () => {
    createTaskMock.mockResolvedValue({ success: true, task: { id: 'task-1' } });
    runTaskMock.mockResolvedValue({ success: true, task: { id: 'task-1', status: 'completed' } });
    render(<BrowserWorkbench />);

    const tasksTab = screen.getByRole('tab', { name: 'tabs.tasks' });
    fireEvent.mouseDown(tasksTab, { button: 0, ctrlKey: false });
    fireEvent.click(tasksTab);
    const nameInput = await screen.findByLabelText('tasks.name');
    fireEvent.change(nameInput, { target: { value: 'Check status' } });
    fireEvent.change(screen.getByLabelText('tasks.url'), { target: { value: 'https://example.com' } });
    fireEvent.change(screen.getByLabelText('tasks.objective'), { target: { value: 'Read status' } });
    fireEvent.click(screen.getByRole('button', { name: 'tasks.runNow' }));

    await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Check status',
      url: 'https://example.com',
      objective: 'Read status',
      profile: 'default',
      mode: 'headless',
    })));
    expect(runTaskMock).toHaveBeenCalledWith({ taskId: 'task-1' });
  });
});
