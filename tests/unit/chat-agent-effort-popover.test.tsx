import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatAgentEffortButton } from '@/components/chat/ChatAgentEffortPopover';

const updateAgentReasoningEffort = vi.fn().mockResolvedValue(undefined);
const agentState = {
  currentAgentId: 'main',
  agents: [
    {
      id: 'main',
      name: 'Main',
      reasoningEffort: 'high',
    },
  ],
  defaultModelRef: null,
  updateAgentModel: vi.fn(),
  updateAgentReasoningEffort,
};

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentState) => unknown) => selector(agentState),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/use-webgl-fire', () => ({
  useWebglFire: () => undefined,
}));

function renderButton() {
  return render(
    <TooltipProvider>
      <ChatAgentEffortButton agentId="main" />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  updateAgentReasoningEffort.mockClear();
  // jsdom does not implement getBoundingClientRect with size — patch it.
  if (!Element.prototype.getBoundingClientRect) {
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, x: 0, y: 0, toJSON: () => '' } as DOMRect;
    };
  }
  // jsdom does not implement ResizeObserver used by the popover layout.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('ChatAgentEffortButton', () => {
  it('renders the current effort label from the agent', () => {
    renderButton();
    const btn = screen.getByTestId('chat-agent-effort-button');
    expect(btn).toBeInTheDocument();
    // 'high' maps to a non-empty label key — the mock translator returns the key, so
    // we just assert the button is enabled and the label is some effort token.
    expect(btn.textContent).toMatch(/high|effort/i);
  });

  it('opens the popover with a slider and 7 options', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-agent-effort-popover')).toBeInTheDocument();
    });
    const slider = screen.getByTestId('chat-agent-effort-slider');
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '6');
  });

  it('commits the slider value through updateAgentReasoningEffort', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    fireEvent.change(slider, { target: { value: '5' } });
    // Commit fires on the input handler in this component (optimistic).
    await waitFor(() => {
      expect(updateAgentReasoningEffort).toHaveBeenCalled();
    });
    const [agentId, value] = updateAgentReasoningEffort.mock.calls[0]!;
    expect(agentId).toBe('main');
    // Index 5 should resolve to one of the persisted values — never 'max'.
    expect(value).not.toBe('max');
    expect(['auto', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(value);
  });

  it('maps the top slider slot to the existing xhigh API value', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    fireEvent.change(slider, { target: { value: '6' } });
    await waitFor(() => {
      expect(updateAgentReasoningEffort).toHaveBeenCalled();
    });
    const [, value] = updateAgentReasoningEffort.mock.calls.at(-1)!;
    expect(value).toBe('xhigh');
  });
});
