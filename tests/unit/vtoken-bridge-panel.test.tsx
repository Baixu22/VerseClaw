// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VtokenBridgePanel } from '@/components/settings/VtokenBridgePanel';

const getStatus = vi.fn();
const setEnabled = vi.fn();
const ensureStarted = vi.fn();
const open = vi.fn();
const ingestMarkdown = vi.fn();
const assemble = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    vtoken: {
      getStatus: (...args: unknown[]) => getStatus(...args),
      setEnabled: (...args: unknown[]) => setEnabled(...args),
      ensureStarted: (...args: unknown[]) => ensureStarted(...args),
      open: (...args: unknown[]) => open(...args),
      ingestMarkdown: (...args: unknown[]) => ingestMarkdown(...args),
      assemble: (...args: unknown[]) => assemble(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      return `${key}:${JSON.stringify(opts)}`;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('VtokenBridgePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatus.mockResolvedValue({
      success: true,
      enabled: true,
      running: false,
      workerPid: null,
      opened: false,
      packageRoot: 'C:/repo/packages/vtoken',
    });
    setEnabled.mockResolvedValue({ success: true, enabled: true });
    ensureStarted.mockResolvedValue({
      success: true,
      enabled: true,
      running: true,
      workerPid: 1234,
      opened: true,
      version: '0.4.3',
    });
    open.mockResolvedValue({ success: true, ok: true });
    ingestMarkdown.mockResolvedValue({ success: true, ok: true, nodes_added: 1 });
    assemble.mockResolvedValue({
      success: true,
      ok: true,
      result: {
        prompt: 'x',
        tokens_used: 6,
        tokens_budget: 300,
        slot_breakdown: {},
        nodes_included: ['a'],
        nodes_evicted: [],
        dedup_count: 0,
      },
    });
  });

  it('loads status and shows enabled default', async () => {
    render(<VtokenBridgePanel />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-vtoken-bridge-enabled-badge').textContent).toContain(
        'developer.vtokenBridge.badgeEnabled',
      );
    });
    expect(getStatus).toHaveBeenCalled();
  });

  it('smoke assemble enables bridge and calls host assemble path', async () => {
    render(<VtokenBridgePanel />);
    const smoke = screen.getByTestId('settings-vtoken-bridge-smoke');
    await waitFor(() => {
      expect((smoke as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(smoke);

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith({ enabled: true });
      expect(ensureStarted).toHaveBeenCalled();
      expect(open).toHaveBeenCalled();
      expect(ingestMarkdown).toHaveBeenCalled();
      expect(assemble).toHaveBeenCalledWith({
        taskHint: 'working context sample',
        budgetTokens: 300,
        renderMode: 'compact',
      });
    });
  });
});