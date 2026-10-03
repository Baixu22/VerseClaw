import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryInjectionPanel } from '@/components/chat/MemoryInjectionPanel';
import type { MemoryInjectionReceiptEntry } from '@shared/host-api/contract';

const { injectionReceiptsMock } = vi.hoisted(() => ({
  injectionReceiptsMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    memory: {
      injectionReceipts: (...args: unknown[]) => injectionReceiptsMock(...args),
    },
  },
}));

// Stable t: react-i18next returns a stable t, so useCallback([t]) deps don't
// churn. A fresh arrow per render would re-fire the load effect endlessly.
const stableT = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key;
const stableTranslation = { t: stableT };
vi.mock('react-i18next', () => ({
  useTranslation: () => stableTranslation,
}));

const receipt: MemoryInjectionReceiptEntry = {
  sessionKey: 'session-1',
  source: 'compass-pre-reply-retrieval',
  selected: ['ref:memory:fact-a', 'ref:memory:fact-b'],
  omitted: ['ref:memory:fact-c'],
  budgetCharsApplied: 120,
  budgetCharsRequested: 200,
  createdAt: 1_726_000_000_000,
};

function renderPanel() {
  return render(
    <MemoryInjectionPanel open onOpenChange={vi.fn()} sessionKey="session-1" />,
  );
}

describe('MemoryInjectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injected: groups receipts by source and shows selected/omitted refs and budget', async () => {
    injectionReceiptsMock.mockResolvedValue({ success: true, receipts: [receipt] });
    renderPanel();

    const group = await screen.findByTestId('memory-injection-source-group');
    expect(group).toHaveAttribute('data-source', 'compass-pre-reply-retrieval');
    expect(injectionReceiptsMock).toHaveBeenCalledWith({ sessionKey: 'session-1' });

    // Selected refs are rendered (sanitized ref:memory:* only).
    expect(screen.getByText('ref:memory:fact-a')).toBeVisible();
    expect(screen.getByText('ref:memory:fact-b')).toBeVisible();
    // Omitted refs sit behind the budget-trim disclosure (a collapsed <details>).
    expect(screen.getByTestId('memory-injection-omitted')).toBeInTheDocument();
    // Budget applied < requested -> the trimmed marker appears.
    expect(screen.getByText('memoryInjection.trimmed')).toBeVisible();
  });

  it('none: a successful empty read shows the empty state, not an error', async () => {
    injectionReceiptsMock.mockResolvedValue({ success: true, receipts: [] });
    renderPanel();

    expect(await screen.findByTestId('memory-injection-empty')).toBeVisible();
    expect(screen.queryByTestId('memory-injection-error')).toBeNull();
    expect(screen.queryByTestId('memory-injection-groups')).toBeNull();
  });

  it('timeout: a failed read shows a retryable error and re-fetches on retry', async () => {
    injectionReceiptsMock.mockResolvedValue({ success: false, error: 'RPC timeout' });
    renderPanel();

    expect(await screen.findByTestId('memory-injection-error')).toBeVisible();
    expect(screen.getByText('memoryInjection.errorTimeout')).toBeVisible();
    expect(screen.getByText('RPC timeout')).toBeVisible();

    // Retry re-issues the read; a now-healthy response renders the group.
    injectionReceiptsMock.mockResolvedValue({ success: true, receipts: [receipt] });
    fireEvent.click(screen.getByText('memoryInjection.retry'));
    await waitFor(() => expect(screen.getByTestId('memory-injection-source-group')).toBeVisible());
    expect(injectionReceiptsMock).toHaveBeenCalledTimes(2);
  });

  it('uses only the typed renderer facade (no direct IPC or gateway calls)', async () => {
    const source = await readFile('src/components/chat/MemoryInjectionPanel.tsx', 'utf8');
    expect(source).not.toMatch(/ipcRenderer|127\.0\.0\.1:18789|gateway\.rpc/);
    expect(source).toContain('hostApi.memory.injectionReceipts');
  });
});
