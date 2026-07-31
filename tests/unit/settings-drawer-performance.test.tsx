import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDrawerRoute } from '@/pages/Settings/SettingsDrawerRoute';

const state = vi.hoisted(() => ({
  contentRenders: 0,
  requestCloseSettings: vi.fn(),
  onOpened: undefined as (() => void) | undefined,
  onClosed: undefined as (() => void) | undefined,
}));

vi.mock('@/components/ui/apple-drawer', () => ({
  AppleDrawer: ({
    children,
    onOpened,
    onClosed,
  }: {
    children: React.ReactNode;
    onOpened?: () => void;
    onClosed?: () => void;
  }) => {
    state.onOpened = onOpened;
    state.onClosed = onClosed;
    return <div>{children}</div>;
  },
}));

vi.mock('@/pages/Settings/SettingsRoute', () => ({
  SettingsRoute: () => {
    state.contentRenders += 1;
    return <div data-testid="active-settings-content" />;
  },
}));

vi.mock('@/components/layout/ui-overlay-context', () => ({
  useUiOverlay: () => ({ requestCloseSettings: state.requestCloseSettings }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('Settings drawer render isolation', () => {
  beforeEach(() => {
    state.contentRenders = 0;
    state.requestCloseSettings.mockClear();
    state.onOpened = undefined;
    state.onClosed = undefined;
  });

  it('filters navigation without rerendering the active Settings content', () => {
    render(
      <MemoryRouter initialEntries={['/settings/models']}>
        <SettingsDrawerRoute open onClosed={() => undefined} />
      </MemoryRouter>,
    );

    expect(state.contentRenders).toBe(0);
    expect(screen.getByTestId('settings-drawer-opening-content')).toBeInTheDocument();

    act(() => state.onOpened?.());
    expect(state.contentRenders).toBe(1);
    expect(screen.queryByTestId('settings-drawer-opening-content')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('settings-drawer-search'), { target: { value: 'agent' } });
    expect(screen.queryByTestId('settings-nav-models')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-agents')).toBeInTheDocument();
    expect(state.contentRenders).toBe(1);

    fireEvent.click(screen.getByTestId('settings-drawer-close'));
    expect(state.requestCloseSettings).toHaveBeenCalledWith();
  });
});
