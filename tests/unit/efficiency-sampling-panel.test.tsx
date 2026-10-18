/**
 * P2 #161: Settings runtime efficiency panel.
 *
 * Executed renderer coverage for the interaction the Electron E2E spec also
 * targets: the readout must fail closed before any real sample, and the switch
 * must persist through host-api.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EfficiencySamplingPanel } from '@/components/settings/EfficiencySamplingPanel';
import type { RuntimeEfficiencyState } from '@shared/host-api/contract';

const { getStateMock, setEnabledMock, toastSuccessMock, toastErrorMock, tMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  setEnabledMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  // Stable identity: a fresh `t` each render would re-run the load effect forever.
  tMock: (key: string) => key,
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    efficiency: {
      getState: (...args: unknown[]) => getStateMock(...args),
      setEnabled: (...args: unknown[]) => setEnabledMock(...args),
    },
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: tMock }) };
});

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

function unmeasuredState(enabled: boolean): RuntimeEfficiencyState {
  return { enabled, running: false, measured: false, summary: null, samples: [], shed: null, backgroundWork: null };
}

describe('EfficiencySamplingPanel', () => {
  beforeEach(() => {
    getStateMock.mockReset();
    setEnabledMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('fails closed to not-sampled instead of a healthy zero', async () => {
    getStateMock.mockResolvedValue(unmeasuredState(true));
    render(<EfficiencySamplingPanel />);

    await waitFor(() => expect(screen.getByTestId('settings-efficiency-not-sampled')).toBeTruthy());
    expect(screen.queryByTestId('settings-efficiency-cpu')).toBeNull();
    expect(screen.queryByTestId('settings-efficiency-sample-count')).toBeNull();
  });

  it('renders the measured readout once a real sample exists', async () => {
    getStateMock.mockResolvedValue({
      enabled: true,
      running: true,
      measured: true,
      summary: {
        sampleCount: 3,
        coverageMs: 10000,
        latest: {
          at: 1,
          cpuPercent: 12.5,
          rssBytes: 1024 * 1024,
          heapUsedBytes: 2048,
          systemFreeBytes: 100,
          systemTotalBytes: 200,
          cpuCount: 8,
          shed: false,
          source: 'os-cpu',
        },
        avgCpuPercent: 10,
        peakCpuPercent: 12.5,
        peakRssBytes: 1024 * 1024,
        shedSampleCount: 0,
      },
      samples: [],
      shed: { shedding: false, reason: null, activeReasons: [], transitionCount: 0, lastTransitionAt: null },
      backgroundWork: { deferring: false, reason: null, deferredCount: 2, resumeCount: 1, lastDeferReason: 'tree-rss', pendingCount: 0, transitionCount: 2 },
    });
    render(<EfficiencySamplingPanel />);

    await waitFor(() => expect(screen.getByTestId('settings-efficiency-sample-count')).toBeTruthy());
    expect(screen.getByTestId('settings-efficiency-cpu')).toBeTruthy();
    expect(screen.getByTestId('settings-efficiency-background-work')).toBeTruthy();
    expect(screen.queryByTestId('settings-efficiency-not-sampled')).toBeNull();
  });

  it('persists the toggle through host-api', async () => {
    getStateMock.mockResolvedValue(unmeasuredState(true));
    setEnabledMock.mockResolvedValue(unmeasuredState(false));
    render(<EfficiencySamplingPanel />);

    // The switch is disabled until the initial host-api read resolves.
    await waitFor(() => {
      const element = screen.getByTestId('settings-efficiency-toggle') as HTMLButtonElement;
      expect(element.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('settings-efficiency-toggle'));

    await waitFor(() => expect(setEnabledMock).toHaveBeenCalledWith(false));
  });
});
