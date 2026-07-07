import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';

const hostApiMock = vi.hoisted(() => ({
  settings: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

describe('UI depth mode preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostApiMock.settings.set.mockResolvedValue({ success: true });
    useSettingsStore.setState({ uiDepthMode: 'basic' });
  });

  it('defaults to basic mode', () => {
    expect(useSettingsStore.getState().uiDepthMode).toBe('basic');
  });

  it('switches between basic and advanced without writing to host settings', () => {
    useSettingsStore.getState().setUiDepthMode('advanced');

    expect(useSettingsStore.getState().uiDepthMode).toBe('advanced');
    expect(hostApiMock.settings.set).not.toHaveBeenCalledWith('uiDepthMode', 'advanced');

    useSettingsStore.getState().setUiDepthMode('basic');

    expect(useSettingsStore.getState().uiDepthMode).toBe('basic');
    expect(hostApiMock.settings.set).not.toHaveBeenCalledWith('uiDepthMode', 'basic');
  });
});
