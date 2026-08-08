import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WelcomeProjectPicker } from '@/components/chat/WelcomeProjectPicker';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { WorkspaceProfile } from '@shared/types/workspace';

const switchWorkspace = vi.fn();

type PickerState = {
  profiles: WorkspaceProfile[];
  activeWorkspace: WorkspaceProfile | null;
  activeWorkspaceId: string | null;
  switchWorkspace: typeof switchWorkspace;
};

let state: PickerState;

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (value: PickerState) => unknown) => selector(state),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (
      params?.projectName ? `${key}:${String(params.projectName)}` : key
    ),
  }),
}));

function makeProfile(overrides: Partial<WorkspaceProfile> & { id: string }): WorkspaceProfile {
  return {
    name: '',
    rootPath: `D:\\work\\${overrides.id}`,
    ...overrides,
  } as WorkspaceProfile;
}

beforeEach(() => {
  switchWorkspace.mockReset();
  const active = makeProfile({ id: 'ws-clawx', name: 'ClawX', lastOpenedAt: 200 });
  state = {
    profiles: [
      active,
      makeProfile({ id: 'ws-verse', name: 'verseshell', lastOpenedAt: 100 }),
    ],
    activeWorkspace: active,
    activeWorkspaceId: 'ws-clawx',
    switchWorkspace,
  };
});

// The picker renders a Tooltip for the workspace path (mirrors the real Chat
// tree, where the component sits inside a TooltipProvider), so tests wrap it.
function renderPicker(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('WelcomeProjectPicker', () => {
  it('names the active workspace on the trigger and keeps the menu closed until asked', () => {
    renderPicker(<WelcomeProjectPicker />);

    const trigger = screen.getByTestId('welcome-project-trigger');
    expect(trigger).toHaveTextContent('ClawX');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('welcome-project-menu')).toBeNull();
  });

  it('switches workspace on selection and closes', () => {
    renderPicker(<WelcomeProjectPicker />);

    fireEvent.click(screen.getByTestId('welcome-project-trigger'));
    expect(screen.getByTestId('welcome-project-menu')).toBeTruthy();

    const rows = screen.getAllByTestId('welcome-project-item');
    expect(rows.map((row) => row.querySelector('.text-xs')?.textContent?.trim())).toEqual(['ClawX', 'verseshell']);

    fireEvent.click(rows[1]);
    expect(switchWorkspace).toHaveBeenCalledWith('ws-verse');
    expect(screen.queryByTestId('welcome-project-menu')).toBeNull();
  });

  it('does not re-switch when the active workspace is picked again', () => {
    renderPicker(<WelcomeProjectPicker />);

    fireEvent.click(screen.getByTestId('welcome-project-trigger'));
    fireEvent.click(screen.getAllByTestId('welcome-project-item')[0]);

    expect(switchWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('welcome-project-menu')).toBeNull();
  });

  it('shows the workspace path in each shared dropdown row', () => {
    renderPicker(<WelcomeProjectPicker />);

    fireEvent.click(screen.getByTestId('welcome-project-trigger'));
    const rows = screen.getAllByTestId('welcome-project-item');
    expect(rows[0]).toHaveTextContent('D:\\work\\ws-clawx');
    expect(screen.queryByPlaceholderText('welcome.projectSearch')).toBeNull();
  });

  it('closes on Escape', () => {
    renderPicker(<WelcomeProjectPicker />);

    fireEvent.click(screen.getByTestId('welcome-project-trigger'));
    expect(screen.getByTestId('welcome-project-menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('welcome-project-menu')).toBeNull();
  });

  it('offers the folder picker only when a handler is supplied', () => {
    const onPickFolder = vi.fn();
    const { rerender } = renderPicker(<WelcomeProjectPicker onPickFolder={onPickFolder} />);

    fireEvent.click(screen.getByTestId('welcome-project-trigger'));
    fireEvent.click(screen.getByTestId('welcome-project-pick-folder'));
    expect(onPickFolder).toHaveBeenCalledTimes(1);

    rerender(<TooltipProvider><WelcomeProjectPicker /></TooltipProvider>);
    fireEvent.click(screen.getByTestId('welcome-project-trigger'));
    expect(screen.queryByTestId('welcome-project-pick-folder')).toBeNull();
  });

  it('falls back to the folder name when the workspace is unnamed', () => {
    const active = makeProfile({ id: 'ws-raw', rootPath: 'D:\\work\\raw-folder' });
    state = { ...state, profiles: [active], activeWorkspace: active, activeWorkspaceId: 'ws-raw' };

    renderPicker(<WelcomeProjectPicker />);
    expect(screen.getByTestId('welcome-project-trigger')).toHaveTextContent('raw-folder');
  });
});
