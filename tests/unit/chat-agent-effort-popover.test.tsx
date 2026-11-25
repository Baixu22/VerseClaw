import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatAgentEffortButton, ChatAgentEffortPanel } from '@/components/chat/ChatAgentEffortPopover';

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
    expect(slider).toHaveAttribute('step', '0.05');
  });

  it('commits the slider value through updateAgentReasoningEffort', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    fireEvent.change(slider, { target: { value: '5' } });
    fireEvent.pointerUp(slider);
    // Persist only after the drag ends so agent refreshes cannot interrupt it.
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
    fireEvent.pointerUp(slider);
    await waitFor(() => {
      expect(updateAgentReasoningEffort).toHaveBeenCalled();
    });
    const [, value] = updateAgentReasoningEffort.mock.calls.at(-1)!;
    expect(value).toBe('max');
  });

  it('uses the shared dropdown squircle card', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const popover = await screen.findByTestId('chat-agent-effort-popover');
    const card = popover.querySelector('.effort-card') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain('effort-card--dropdown');
    expect(card.style.clipPath).toContain('effort-squircle');
  });

  it('keeps the card squircle and mounts the preview slider filters', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const popover = await screen.findByTestId('chat-agent-effort-popover');
    const clipPaths = popover.querySelectorAll('clipPath');
    const track = screen.getByTestId('chat-agent-effort-track');
    expect(clipPaths).toHaveLength(1);
    expect(track.className).toContain('h-8');
    expect(track.style.clipPath).toBe('');
    expect(popover.querySelectorAll('filter')).toHaveLength(2);
  });

  it('moves continuously and snaps to the nearest effort on release', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider') as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '2.4' } });
    expect(slider.value).toBe('2.4');

    fireEvent.pointerUp(slider);
    await waitFor(() => expect(slider.value).toBe('2'));
    await waitFor(() => expect(updateAgentReasoningEffort).toHaveBeenCalledWith('main', 'low'));
  });

  it('shows localized effort text in the floating tooltip', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    fireEvent.pointerEnter(slider);
    expect(screen.getByTestId('chat-agent-effort-tooltip')).toHaveAttribute('aria-label', 'composer.effortStatusHigh');
    fireEvent.change(slider, { target: { value: '5' } });
    expect(slider).toHaveAttribute('aria-valuetext', 'composer.effortStatusXhigh');
    expect(screen.getByTestId('chat-agent-effort-tooltip')).toHaveAttribute('aria-label', 'composer.effortStatusXhigh');
    expect(updateAgentReasoningEffort).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat-agent-effort-fire')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-agent-effort-preview').querySelector('img')).toBeNull();
  });

  it('shows nine vertical marks and one current label below the track', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    await screen.findByTestId('chat-agent-effort-slider');
    const tickContainer = screen.getByTestId('chat-agent-effort-ticks');
    expect(tickContainer).toBeTruthy();
    const ticks = tickContainer.querySelectorAll('span');
    expect(ticks.length).toBe(9);
    expect(screen.getByTestId('chat-agent-effort-label')).toHaveTextContent('composer.effortStatusHigh');
  });

  it('uses the compact rectangular preview thumb', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    await screen.findByTestId('chat-agent-effort-slider');
    const thumb = screen.getByTestId('chat-agent-effort-thumb');
    expect(thumb).toHaveClass('w-3', 'h-5', 'rounded-sm');
  });

  it('previews keyboard changes and saves them on key release', async () => {
    renderButton();
    fireEvent.click(screen.getByTestId('chat-agent-effort-button'));
    const slider = await screen.findByTestId('chat-agent-effort-slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveValue('5');
    expect(screen.getByTestId('chat-agent-effort-tooltip')).toHaveAttribute('aria-label', 'composer.effortStatusXhigh');
    expect(updateAgentReasoningEffort).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(updateAgentReasoningEffort).toHaveBeenCalledWith('main', 'xhigh');
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyUp(slider, { key: 'Home' });
    expect(updateAgentReasoningEffort).toHaveBeenLastCalledWith('main', 'auto');
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyUp(slider, { key: 'End' });
    expect(updateAgentReasoningEffort).toHaveBeenLastCalledWith('main', 'max');
  });

  it.each(['pointercancel', 'lostpointercapture'])('saves %s exactly once', (endEvent) => {
    render(<ChatAgentEffortPanel agentId="main" />);
    const slider = screen.getByTestId('chat-agent-effort-slider');
    Object.defineProperty(slider, 'setPointerCapture', { value: vi.fn() });
    vi.spyOn(screen.getByTestId('chat-agent-effort-track'), 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, top: 0, height: 32 } as DOMRect);
    fireEvent(slider, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 40 }));
    expect(updateAgentReasoningEffort).not.toHaveBeenCalled();
    fireEvent(slider, new Event(endEvent, { bubbles: true }));
    fireEvent.lostPointerCapture(slider);
    fireEvent.blur(slider);
    expect(updateAgentReasoningEffort).toHaveBeenCalledTimes(1);
    expect(updateAgentReasoningEffort).toHaveBeenCalledWith('main', 'low');
  });

  it('keeps a pointer preview uncommitted when the input loses focus during the drag', () => {
    render(<ChatAgentEffortPanel agentId="main" />);
    const slider = screen.getByTestId('chat-agent-effort-slider');
    Object.defineProperty(slider, 'setPointerCapture', { value: vi.fn() });
    vi.spyOn(screen.getByTestId('chat-agent-effort-track'), 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, top: 0, height: 32 } as DOMRect);
    fireEvent(slider, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 40 }));
    fireEvent.blur(slider);
    expect(updateAgentReasoningEffort).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(updateAgentReasoningEffort).toHaveBeenCalledExactlyOnceWith('main', 'low');
  });

  it('keeps a disabled slider inactive', () => {
    render(<ChatAgentEffortPanel agentId="main" disabled />);
    const slider = screen.getByTestId('chat-agent-effort-slider');
    expect(slider).toBeDisabled();
    fireEvent.pointerEnter(slider);
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.change(slider, { target: { value: '6' } });
    fireEvent.pointerUp(slider);
    expect(screen.queryByTestId('chat-agent-effort-tooltip')).not.toBeInTheDocument();
    expect(updateAgentReasoningEffort).not.toHaveBeenCalled();
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
