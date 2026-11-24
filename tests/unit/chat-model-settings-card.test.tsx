import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chat from '../../shared/i18n/locales/en/chat.json';
import { ChatModelSettingsCard } from '@/components/chat/ChatModelSettingsCard';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ updateEffort: vi.fn() }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: (select: (state: unknown) => unknown) => select({ updateAgentReasoningEffort: mocks.updateEffort }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  let value: unknown = chat;
  for (const part of key.split('.')) value = (value as Record<string, unknown>)?.[part];
  return typeof value === 'string' ? value : key;
} }) }));
vi.mock('@/components/chat/ModelBrandIcon', () => ({ ModelBrandIcon: () => <span aria-hidden="true" /> }));
vi.mock('@/components/chat/ChatAgentEffortPopover', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/chat/ChatAgentEffortPopover')>();
  return { ...original, ChatAgentEffortPanel: ({ disabled }: { disabled: boolean }) => <input type="range" data-testid="chat-agent-effort-slider" disabled={disabled} /> };
});
vi.mock('framer-motion', async importOriginal => {
  const original = await importOriginal<typeof import('framer-motion')>();
  return { ...original, animate: () => ({ stop: vi.fn(), finished: Promise.resolve() }) };
});

const options = [
  { modelRef: 'openai/gpt-5', label: 'GPT 5 / OpenAI' },
  { modelRef: 'deepseek/deepseek-chat', label: 'DeepSeek / DeepSeek' },
];
function card(props: Partial<React.ComponentProps<typeof ChatModelSettingsCard>> = {}) {
  return <TooltipProvider><ChatModelSettingsCard agentId="main" effort="max" modelRef="openai/gpt-5" options={options}
    onSelectModel={vi.fn()} onEffortChange={vi.fn()} {...props} /></TooltipProvider>;
}

beforeEach(() => {
  mocks.updateEffort.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('CSS', { ...CSS, escape: (text: string) => text.replace(/["\\]/g, '\\$&') });
});
afterEach(() => vi.unstubAllGlobals());

describe('compact model settings card', () => {
  it('starts with reasoning settings and hides the whole slider while the model list is open', async () => {
    render(card());
    expect(screen.getByTestId('chat-model-settings-effort')).toHaveTextContent(chat.composer.effortStatusMax);
    expect(screen.getByTestId('chat-agent-effort-slider')).toBeVisible();
    expect(screen.queryByTestId('chat-model-picker-search')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-model-picker-current'));
    expect(screen.getByTestId('chat-model-picker-search')).toBeVisible();
    expect(screen.getByTestId('chat-model-settings-slider-region')).toHaveAttribute('inert');
    expect(screen.getByTestId('chat-agent-effort-slider')).not.toBeVisible();
    fireEvent.keyDown(screen.getByTestId('chat-model-picker-search'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('chat-agent-effort-slider')).toBeVisible());
    expect(screen.getByTestId('chat-model-settings-slider-region')).not.toHaveAttribute('inert');
  });
  it('filters real model references and passes the exact selected reference without changing the stored label', () => {
    const select = vi.fn();
    render(card({ onSelectModel: select }));
    const original = screen.getByTestId('chat-model-picker-current').getAttribute('aria-label');
    fireEvent.click(screen.getByTestId('chat-model-picker-current'));
    fireEvent.change(screen.getByTestId('chat-model-picker-search'), { target: { value: 'deepseek' } });
    expect(screen.queryByTestId('chat-model-picker-option-GPT 5 / OpenAI')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('chat-model-picker-search'), { key: 'Enter' });
    expect(select).toHaveBeenCalledExactlyOnceWith('deepseek/deepseek-chat');
    expect(screen.getByTestId('chat-model-picker-current')).toHaveAttribute('aria-label', original);
  });
  it('does not present the first configured model as the current model when no runtime model is known', () => {
    render(card({ modelRef: null }));
    expect(screen.getByTestId('chat-model-picker-current')).toHaveAccessibleName(`Model: ${chat.composer.modelSourceDefault}`);
  });
  it('keeps the current runtime model available during provider hydration', () => {
    render(card({ options: [] }));
    fireEvent.click(screen.getByTestId('chat-model-picker-current'));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });
  it('resets through the existing agent owner after confirmation from the store', async () => {
    let finish!: () => void;
    mocks.updateEffort.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const change = vi.fn();
    render(card({ onEffortChange: change }));
    fireEvent.click(screen.getByTestId('chat-model-settings-reset'));
    expect(mocks.updateEffort).toHaveBeenCalledExactlyOnceWith('main', 'auto');
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-model-settings-reset')).toBeDisabled();
    finish();
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith('auto'));
  });
  it('keeps a failed reset retryable and retains the selected effort', async () => {
    mocks.updateEffort.mockRejectedValueOnce(new Error('failed'));
    const change = vi.fn();
    render(card({ onEffortChange: change }));
    fireEvent.click(screen.getByTestId('chat-model-settings-reset'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(chat.composer.effortResetFailed));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-model-settings-reset')).not.toBeDisabled();
  });
  it('blocks pointer and reset changes while the composer is disabled', () => {
    const select = vi.fn();
    render(card({ disabled: true, onSelectModel: select }));
    fireEvent.click(screen.getByTestId('chat-model-picker-current'));
    fireEvent.click(screen.getByTestId('chat-model-settings-reset'));
    expect(screen.queryByTestId('chat-model-picker-search')).toBeNull();
    expect(screen.getByTestId('chat-agent-effort-slider')).toBeDisabled();
    expect(select).not.toHaveBeenCalled(); expect(mocks.updateEffort).not.toHaveBeenCalled();
  });
});
