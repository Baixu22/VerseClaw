import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../shared/i18n/locales/en/settings.json';
import zh from '../../shared/i18n/locales/zh/settings.json';
import ja from '../../shared/i18n/locales/ja/settings.json';
import ru from '../../shared/i18n/locales/ru/settings.json';
import { DcsProdFlagsPanel } from '@/components/settings/DcsProdFlagsPanel';

const messages = { en, zh, ja, ru };
const state = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh' | 'ja' | 'ru', setFlag: vi.fn() }));
vi.mock('react-i18next', () => {
  const t = (key: string) => {
    let value: unknown = messages[state.language];
    for (const segment of key.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
    return typeof value === 'string' ? value : key;
  };
  return { initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t }) };
});
vi.mock('@/lib/host-api', () => ({ hostApi: { dcsProdFlags: {
  getFlags: async () => ({ productionMode: 'opt-in', flags: [
    ...['symbol-lease', 'symbol-lease-mode', 'patch-flow'].map((id) => ({ id, writable: true, enabled: true, status: 'applied' })),
    { id: 'context-view-tools', writable: true, enabled: false, status: 'read-only' },
  ] }),
  getPreview: async () => ({ enabled: false, partial: false, comboFlagIds: ['context-view-tools'], missingPrereqs: ['providerVerified'] }),
  setFlag: (...args: unknown[]) => state.setFlag(...args),
} } }));

beforeEach(() => { state.language = 'en'; state.setFlag.mockReset(); });
async function ready() {
  render(<DcsProdFlagsPanel />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('TF-0774 Developer retirement projection', () => {
  it.each(['en', 'zh', 'ja', 'ru'] as const)('renders %s retirement and refuses a stale writable snapshot', async (language) => {
    state.language = language;
    await ready();
    for (const id of ['symbol-lease', 'symbol-lease-mode', 'patch-flow']) {
      const row = screen.getByTestId(`settings-dcs-prod-flag-${id}`);
      fireEvent.click(row);
      expect(row).toHaveTextContent(messages[language].developer.dcsProdFlags.retired.label);
      expect(screen.getByTestId('settings-dcs-prod-flags-readonly-hint')).toHaveTextContent(messages[language].developer.dcsProdFlags.retired.description);
      expect(screen.getByTestId('settings-dcs-prod-flag-retired-detail')).toHaveTextContent(messages[language].developer.dcsProdFlags.retired.alternative);
      expect(screen.queryByTestId(`settings-dcs-prod-flag-switch-${id}`)).not.toBeInTheDocument();
    }
    expect(state.setFlag).not.toHaveBeenCalled();
  });

  it('keeps an ordinary writable control available', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('settings-dcs-prod-flag-context-view-tools'));
    expect(screen.getByTestId('settings-dcs-prod-flag-switch-context-view-tools')).toBeVisible();
  });
});
