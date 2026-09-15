import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelStepContent, ProviderStepContent, type PendingProviderSetup } from '@/pages/Setup/ProviderModelSteps';
import type { ProviderAccount, ProviderWithKeyInfo } from '@/lib/providers';

const providers = vi.hoisted(() => ({
  accounts: [] as ProviderAccount[], statuses: [] as ProviderWithKeyInfo[], vendors: [],
  refreshProviderSnapshot: vi.fn(), validateAccountApiKey: vi.fn(), createAccount: vi.fn(),
  listAccountModels: vi.fn(), updateAccount: vi.fn(), setDefaultAccount: vi.fn(),
}));
const settings = vi.hoisted(() => ({ setSetupProviderVerification: vi.fn() }));
vi.mock('@/stores/providers', () => ({
  useProviderStore: Object.assign(<T,>(selector: (state: typeof providers) => T) => selector(providers), { getState: () => providers }),
}));
vi.mock('@/stores/settings', () => ({ useSettingsStore: <T,>(selector: (state: typeof settings) => T) => selector(settings) }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const pending = { accountId: 'account-a', vendorId: 'custom', label: 'Account A', baseUrl: 'https://provider.example/v1' } satisfies PendingProviderSetup;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function beginProvider() {
  const onValidated = vi.fn();
  const view = render(<ProviderStepContent pending={null} onValidated={onValidated} />);
  fireEvent.click(screen.getByTestId('setup-provider-vendor-custom'));
  fireEvent.change(screen.getByTestId('setup-provider-base-url'), { target: { value: pending.baseUrl } });
  fireEvent.change(screen.getByTestId('setup-provider-api-key'), { target: { value: 'test-credential' } });
  fireEvent.click(screen.getByTestId('setup-provider-validate'));
  return { ...view, onValidated };
}
async function beginModel() {
  const onVerified = vi.fn();
  const view = render(<ModelStepContent pending={pending} onVerified={onVerified} />);
  fireEvent.click(await screen.findByTestId('setup-model-option-model-a'));
  fireEvent.click(screen.getByTestId('setup-model-confirm'));
  return { ...view, onVerified };
}

describe('Setup asynchronous verification ownership', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    providers.accounts = [];
    providers.statuses = [];
    providers.refreshProviderSnapshot.mockResolvedValue(undefined);
    providers.validateAccountApiKey.mockResolvedValue({ valid: true });
    providers.createAccount.mockResolvedValue(undefined);
    providers.listAccountModels.mockResolvedValue({ success: true, models: ['model-a', 'model-b'] });
    providers.updateAccount.mockResolvedValue(undefined);
    providers.setDefaultAccount.mockResolvedValue(undefined);
  });

  it.each(['vendor', 'key', 'endpoint'] as const)('ignores Provider validation after changing the %s', async (changed) => {
    const reply = deferred<{ valid: boolean }>();
    providers.validateAccountApiKey.mockReturnValueOnce(reply.promise);
    const { onValidated } = beginProvider();
    if (changed === 'vendor') fireEvent.click(screen.getByTestId('setup-provider-vendor-openai'));
    else fireEvent.change(screen.getByTestId(changed === 'key' ? 'setup-provider-api-key' : 'setup-provider-base-url'), { target: { value: 'replacement' } });
    onValidated.mockClear();
    await act(async () => { reply.resolve({ valid: true }); });
    expect(providers.createAccount).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
    expect(screen.queryByTestId('setup-provider-validated')).not.toBeInTheDocument();
  });

  it('does not save a Provider when its validation completes after unmount', async () => {
    const reply = deferred<{ valid: boolean }>();
    providers.validateAccountApiKey.mockReturnValueOnce(reply.promise);
    const { onValidated, unmount } = beginProvider();
    unmount();
    onValidated.mockClear();
    await act(async () => { reply.resolve({ valid: true }); });
    expect(providers.createAccount).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
  });

  it('keeps StrictMode model loading usable and confirms the current selection', async () => {
    const reply = deferred<{ success: boolean; models: string[] }>();
    providers.listAccountModels.mockReturnValueOnce(reply.promise);
    const onVerified = vi.fn();
    render(<StrictMode><ModelStepContent pending={pending} onVerified={onVerified} /></StrictMode>);
    await act(async () => { reply.resolve({ success: true, models: ['model-a'] }); });
    expect(providers.listAccountModels).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByTestId('setup-model-option-model-a'));
    fireEvent.click(screen.getByTestId('setup-model-confirm'));
    await waitFor(() => expect(onVerified).toHaveBeenLastCalledWith({ model: 'model-a' }));
    expect(settings.setSetupProviderVerification).toHaveBeenCalledWith(expect.objectContaining({ status: 'verified', accountId: pending.accountId, model: 'model-a' }));
  });

  it('keeps a newly selected model unverified when the earlier update finishes', async () => {
    const reply = deferred<void>();
    providers.updateAccount.mockReturnValueOnce(reply.promise);
    const { onVerified } = await beginModel();
    fireEvent.click(screen.getByTestId('setup-model-option-model-b'));
    onVerified.mockClear();
    await act(async () => { reply.resolve(undefined); });
    expect(providers.setDefaultAccount).not.toHaveBeenCalled();
    expect(settings.setSetupProviderVerification).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.getByTestId('setup-model-confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('setup-model-confirm'));
    await waitFor(() => expect(onVerified).toHaveBeenLastCalledWith({ model: 'model-b' }));
    expect(providers.setDefaultAccount).toHaveBeenCalledTimes(1);
  });

  it.each(['update', 'default'] as const)('does not verify an unmounted Model after the pending %s write', async (stage) => {
    const reply = deferred<void>();
    if (stage === 'update') providers.updateAccount.mockReturnValueOnce(reply.promise);
    else providers.setDefaultAccount.mockReturnValueOnce(reply.promise);
    const { onVerified, unmount } = await beginModel();
    if (stage === 'default') await waitFor(() => expect(providers.setDefaultAccount).toHaveBeenCalledTimes(1));
    unmount();
    onVerified.mockClear();
    await act(async () => { reply.resolve(undefined); });
    if (stage === 'update') expect(providers.setDefaultAccount).not.toHaveBeenCalled();
    expect(settings.setSetupProviderVerification).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('keeps a newer account list when the previous listing returns late', async () => {
    const reply = deferred<{ success: boolean; models: string[] }>();
    providers.listAccountModels.mockReturnValueOnce(reply.promise).mockResolvedValueOnce({ success: true, models: ['model-b'] });
    const onVerified = vi.fn();
    const { rerender } = render(<ModelStepContent pending={pending} onVerified={onVerified} />);
    rerender(<ModelStepContent pending={{ ...pending, accountId: 'account-b' }} onVerified={onVerified} />);
    await screen.findByTestId('setup-model-option-model-b');
    await act(async () => { reply.resolve({ success: true, models: ['model-a'] }); });
    expect(screen.queryByTestId('setup-model-option-model-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('setup-model-option-model-b')).toBeInTheDocument();
  });
});
