import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KnowledgeVectorSettings } from '@/components/settings/KnowledgeVectorSettings';
import type { KnowledgeVectorStatus } from '@shared/knowledge/vector';

const api = vi.hoisted(() => ({
  vectorStatus: vi.fn(), vectorConfigure: vi.fn(), vectorRebuild: vi.fn(),
  vectorOptimize: vi.fn(), vectorDisable: vi.fn(),
}));
vi.mock('@/lib/host-api', () => ({ hostApi: { knowledge: api } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows native fallback, preserves a failed action through polling, and supports retry and disable', async () => {
  let status: KnowledgeVectorStatus = {
    status: 'ready', requestedBackend: 'lancedb-ann', effectiveBackend: 'sqlite-flat',
    capability: { available: false, maxReferenceRows: 100000 },
    generation: { generationId: 'fixture', rowCount: 1, spaceId: 'fixture', backend: 'sqlite-flat' },
    indexing: false, reason: 'native unavailable',
  };
  api.vectorStatus.mockImplementation(async () => ({ success: true, vector: status }));
  api.vectorConfigure
    .mockResolvedValueOnce({ success: false, error: 'build failed' })
    .mockImplementation(async () => ({ success: true, vector: status }));
  api.vectorDisable.mockImplementation(async () => {
    status = { ...status, status: 'disabled', requestedBackend: null, generation: null, reason: null };
    return { success: true, vector: status };
  });
  render(<KnowledgeVectorSettings />);
  expect(await screen.findByTestId('vector-capability')).toHaveTextContent('vector.nativeUnavailable');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('vector-configure'));
  expect(await screen.findByRole('alert')).toHaveTextContent('build failed');
  await waitFor(() => expect(api.vectorStatus.mock.calls.length).toBeGreaterThan(1), { timeout: 4000 });
  expect(screen.getByRole('alert')).toHaveTextContent('build failed');
  fireEvent.click(screen.getByTestId('vector-configure'));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  fireEvent.click(screen.getByTestId('vector-disable'));
  await waitFor(() => expect(screen.getByTestId('vector-status')).toHaveAttribute('data-state', 'disabled'));
  expect(screen.getByTestId('vector-disable')).toBeDisabled();
  expect(screen.getByTestId('vector-rebuild')).toBeDisabled();
  expect(screen.getByTestId('vector-optimize')).toBeDisabled();
});
