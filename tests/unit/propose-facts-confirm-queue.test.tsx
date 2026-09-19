import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposeFactsConfirmQueue } from '@/components/agents/ProposeFactsConfirmQueue';
import type { MemoryProposeFactsCandidate } from '@shared/host-api/contract';

const { proposeFactsListMock, proposeFactsConfirmMock, toastMock } = vi.hoisted(() => ({
  proposeFactsListMock: vi.fn(),
  proposeFactsConfirmMock: vi.fn(),
  toastMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    memory: {
      proposeFactsList: (...args: unknown[]) => proposeFactsListMock(...args),
      proposeFactsConfirm: (...args: unknown[]) => proposeFactsConfirmMock(...args),
    },
  },
}));

// Stable t so useCallback([t]) deps don't churn and re-fire the load effect.
const stableTranslation = { t: (key: string) => key };
vi.mock('react-i18next', () => ({
  useTranslation: () => stableTranslation,
}));

vi.mock('sonner', () => ({ toast: toastMock }));

const candidate: MemoryProposeFactsCandidate = {
  factId: 'fact-1',
  subject: 'user',
  predicate: 'prefers',
  objectSummary: 'dark mode',
  confidence: 0.82,
  source: 'human_confirmation',
  proposedAt: 1_726_000_000_000,
};

describe('ProposeFactsConfirmQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists pending candidates and confirms one through the E-1 gate', async () => {
    proposeFactsListMock.mockResolvedValue({ success: true, enabled: true, candidates: [candidate] });
    proposeFactsConfirmMock.mockResolvedValue({
      success: true,
      confirmed: true,
      message: 'confirmed and persisted',
      factId: 'fact-1',
    });
    render(<ProposeFactsConfirmQueue />);

    const row = await screen.findByTestId('propose-facts-candidate');
    expect(row).toHaveAttribute('data-fact-id', 'fact-1');
    expect(screen.getByText('dark mode')).toBeVisible();

    fireEvent.click(screen.getByTestId('propose-facts-confirm'));
    await waitFor(() => expect(proposeFactsConfirmMock).toHaveBeenCalledWith({ factId: 'fact-1' }));
    // Confirmed row is removed from the queue.
    await waitFor(() => expect(screen.queryByTestId('propose-facts-candidate')).toBeNull());
    expect(toastMock.success).toHaveBeenCalledWith('proposeFacts.confirmed');
  });

  it('keeps the row and warns when the owner-convergence gate blocks persistence', async () => {
    proposeFactsListMock.mockResolvedValue({ success: true, enabled: true, candidates: [candidate] });
    proposeFactsConfirmMock.mockResolvedValue({
      success: true,
      confirmed: false,
      message: 'confirm blocked by E-1 owner convergence',
    });
    render(<ProposeFactsConfirmQueue />);

    fireEvent.click(await screen.findByTestId('propose-facts-confirm'));
    await waitFor(() =>
      expect(toastMock.warning).toHaveBeenCalledWith('confirm blocked by E-1 owner convergence'),
    );
    // confirmed=false is NOT an error and the row stays for another attempt.
    expect(screen.getByTestId('propose-facts-candidate')).toBeVisible();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('shows the disabled notice when the proposeFacts flags are off (default)', async () => {
    proposeFactsListMock.mockResolvedValue({ success: true, enabled: false, candidates: [] });
    render(<ProposeFactsConfirmQueue />);

    expect(await screen.findByTestId('propose-facts-disabled')).toBeVisible();
    expect(screen.queryByTestId('propose-facts-confirm')).toBeNull();
  });

  it('shows the empty state when enabled with no candidates', async () => {
    proposeFactsListMock.mockResolvedValue({ success: true, enabled: true, candidates: [] });
    render(<ProposeFactsConfirmQueue />);

    expect(await screen.findByTestId('propose-facts-empty')).toBeVisible();
  });

  it('uses only the typed renderer facade (no direct IPC or gateway calls)', async () => {
    const source = await readFile('src/components/agents/ProposeFactsConfirmQueue.tsx', 'utf8');
    expect(source).not.toMatch(/ipcRenderer|127\.0\.0\.1:18789|gateway\.rpc/);
    expect(source).toContain('hostApi.memory.proposeFactsConfirm');
  });
});
