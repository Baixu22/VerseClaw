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
    // Commit is debounced so slider drag stays smooth.
    await waitFor(() => {
      expect(updateAgentReasoningEffort).toHaveBeenCalled();
    });
    const [agentId, value] = updateAgentReasoningEffort.mock.calls[0]!;
    expect(agentId).toBe('main');
    // Index 5 is the xhigh slot.
    expect(value).toBe('xhigh');
  });

  it('maps the top slider slot to the runtime max thinking level', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    fireEvent.change(slider, { target: { value: '6' } });
    await waitFor(() => {
      expect(updateAgentReasoningEffort).toHaveBeenCalled();
    });
    const [, value] = updateAgentReasoningEffort.mock.calls.at(-1)!;
    expect(value).toBe('max');
  });

  it('uses the reference-style black squircle card', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const popover = await screen.findByTestId('chat-agent-effort-popover');
    const card = popover.querySelector('.effort-card') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain('bg-black');
    expect(card.style.clipPath).toContain('effort-squircle');
  });

  it('renders squircle clip-path definitions for card and track', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const popover = await screen.findByTestId('chat-agent-effort-popover');
    const clipPaths = popover.querySelectorAll('clipPath');
    expect(clipPaths).toHaveLength(2);
  });

  it('only ignites the fire trail at max effort', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const track = await screen.findByTestId('chat-agent-effort-track');
    const canvas = screen.getByTestId('chat-agent-effort-fire');

    // Agent starts at 'high' — flame not yet active (shader gates at 100%).
    expect(track.className).not.toContain('effort-track-active');
    expect(canvas).toHaveClass('mix-blend-screen', 'motion-reduce:hidden');
    expect(canvas.style.maskImage).toContain('linear-gradient');

    const slider = screen.getByTestId('chat-agent-effort-slider');
    fireEvent.change(slider, { target: { value: '6' } });
    expect(track.className).toContain('effort-track-active');
    expect(track.className).toContain('effort-track-full');
  });

  it('shows all 7 tick labels under the track', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    await screen.findByTestId('chat-agent-effort-slider');
    const tickContainer = screen.getByTestId('chat-agent-effort-ticks');
    expect(tickContainer).toBeTruthy();
    const ticks = tickContainer.querySelectorAll('span');
    expect(ticks.length).toBe(7);
  });

  it('highlights the active tick label with the theme accent', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    await screen.findByTestId('chat-agent-effort-slider');
    const tickContainer = screen.getByTestId('chat-agent-effort-ticks');
    const ticks = tickContainer.querySelectorAll('span');
    // The agent starts at 'high' (index 4), so tick 4 should be active.
    const activeTick = ticks[4];
    expect(activeTick.className).toContain('effort-tick-active');
  });

  it('closes the popover on Escape key', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    await screen.findByTestId('chat-agent-effort-popover');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('chat-agent-effort-popover')).not.toBeInTheDocument();
    });
  });

  it('does not commit when slider value matches the initial effort', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    // Agent starts at 'high' (index 4) — setting to the same value should not call update
    fireEvent.change(slider, { target: { value: '4' } });
    // Wait a tick to ensure no async call fires
    await new Promise((r) => setTimeout(r, 50));
    expect(updateAgentReasoningEffort).not.toHaveBeenCalled();
  });

  it('toggles chevron rotation when popover opens', async () => {
    renderButton();
    const btn = screen.getByTestId('chat-agent-effort-button');
    const chevron = btn.querySelector('svg.lucide-chevron-down') as SVGElement;
    expect(chevron).toBeTruthy();
    // SVG elements have SVGAnimatedString for className — use getAttribute
    const initialClass = chevron.getAttribute('class') ?? '';
    expect(initialClass).not.toContain('rotate-180');
    fireEvent.click(btn);
    await screen.findByTestId('chat-agent-effort-popover');
    // After opening, chevron should be rotated
    const chevronAfter = screen.getByTestId('chat-agent-effort-button').querySelector('svg.lucide-chevron-down') as SVGElement;
    const afterClass = chevronAfter.getAttribute('class') ?? '';
    expect(afterClass).toContain('rotate-180');
  });
});
