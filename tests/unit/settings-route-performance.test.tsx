import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SettingsRoute } from '@/pages/Settings/SettingsRoute';

const state = vi.hoisted(() => ({ settingsModuleLoads: 0 }));

vi.mock('@/pages/Settings/index', () => {
  state.settingsModuleLoads += 1;
  return { Settings: () => <div data-testid="settings-monolith" /> };
});

vi.mock('@/pages/Models', () => ({
  Models: () => <div data-testid="models-page" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Settings route section ownership', () => {
  it('loads a standalone section without evaluating the Settings monolith', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/models']}>
        <SettingsRoute />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('models-page')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-monolith')).not.toBeInTheDocument();
    expect(state.settingsModuleLoads).toBe(0);
  });
});
