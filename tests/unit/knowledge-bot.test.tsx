import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { KnowledgeBot } from '@/components/knowledge-bot/KnowledgeBot';
import { KnowledgeBotLauncher } from '@/components/knowledge-bot/KnowledgeBotLauncher';
import { useKnowledgeBotActivity } from '@/components/knowledge-bot/use-knowledge-bot-activity';
import { KnowledgeBotWindow } from '@/components/knowledge-bot/KnowledgeBotWindow';

const engine = vi.hoisted(() => ({
  create: vi.fn(), setState: vi.fn(), setExpression: vi.fn(), destroy: vi.fn(),
}));
vi.mock('@/components/knowledge-bot/vendor/grok-player.js', () => ({
  createGrokBot: engine.create,
}));
vi.mock('@/pages/Chat/KnowledgeChat', () => ({ KnowledgeChat: () => <input aria-label="retained draft" /> }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('clawx.knowledge.bot-position.v1');
  engine.create.mockReturnValue({ ready: Promise.resolve(), error: null, setState: engine.setState, setExpression: engine.setExpression, destroy: engine.destroy });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // jsdom does not implement pointer capture or PointerEvent.
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true;
    }
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.animate = vi.fn().mockReturnValue({ cancel: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Knowledge character', () => {
  it('updates the existing engine, settles historical poses and disposes all instances', async () => {
    const { rerender, unmount } = render(<KnowledgeBot state="searching" />);
    await act(async () => { await Promise.resolve(); });
    expect(engine.setState).toHaveBeenLastCalledWith('searching');
    rerender(<KnowledgeBot state="failed" />);
    expect(engine.create).toHaveBeenCalledTimes(1);
    expect(engine.setState).toHaveBeenLastCalledWith('failed');
    rerender(<KnowledgeBot state="idle" animated={false} />);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
    expect(engine.create).toHaveBeenLastCalledWith(expect.any(HTMLElement), expect.objectContaining({ staticMode: true, silhouette: expect.objectContaining({ solid: expect.any(Object) }) }));
    unmount();
    expect(engine.destroy).toHaveBeenCalledTimes(2);
  });

  it('limits roaming and springs back beyond the radius without opening; cancellation and keyboard activation work', () => {
    const open = vi.fn();
    render(<TooltipProvider><KnowledgeBotLauncher onOpen={open} /></TooltipProvider>);
    const button = screen.getByTestId('knowledge-librarian-open');
    const origin = { x: window.innerWidth - 112, y: window.innerHeight - 108 };
    button.getBoundingClientRect = () => ({ ...origin, left: origin.x, top: origin.y, right: origin.x+88, bottom: origin.y+88, width: 88, height: 88, toJSON: () => ({}) });
    fireEvent.pointerDown(button, { pointerId: 1, clientX: origin.x+44, clientY: origin.y+44 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: origin.x-10, clientY: origin.y+10 });
    expect(button).toHaveAttribute('data-dragging', 'true');
    expect(screen.getByTestId('knowledge-bot')).toHaveAttribute('data-state', 'dragging');
    fireEvent.pointerUp(button, { pointerId: 1, clientX: origin.x-10, clientY: origin.y+10 });
    fireEvent.click(button, { detail: 1 });
    expect(open).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('clawx.knowledge.bot-position.v1')!)).toEqual({ x: origin.x-54, y: origin.y-34 });
    fireEvent.pointerDown(button, { pointerId: 2, clientX: origin.x+44, clientY: origin.y+44 });
    fireEvent.pointerMove(button, { pointerId: 2, clientX: -999, clientY: -999 });
    expect(Math.hypot(parseFloat(button.style.left)-origin.x, parseFloat(button.style.top)-origin.y)).toBeLessThanOrEqual(130.01);
    fireEvent.pointerUp(button, { pointerId: 2, clientX: -999, clientY: -999 });
    expect(button.style.left).toBe(`${origin.x}px`);
    expect(HTMLElement.prototype.animate).toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerId: 3, clientX: origin.x+44, clientY: origin.y+44 });
    fireEvent.pointerCancel(button, { pointerId: 3 });
    fireEvent.click(button, { detail: 1 });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 0 });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('only completion settles on a timer; input focus cannot replace a request or error', () => {
    vi.useFakeTimers();
    function Activity() {
      const activity = useKnowledgeBotActivity();
      return <><output>{activity.state}</output><button onClick={() => activity.setComposing(true)}>focus</button><button onClick={() => activity.setActivity('searching')}>search</button><button onClick={() => activity.setActivity('finished')}>finish</button><button onClick={() => activity.setActivity('failed')}>fail</button></>;
    }
    render(<Activity />);
    fireEvent.click(screen.getByText('focus')); expect(screen.getByRole('status')).toHaveTextContent('listening');
    fireEvent.click(screen.getByText('search')); expect(screen.getByRole('status')).toHaveTextContent('searching');
    fireEvent.click(screen.getByText('finish')); expect(screen.getByRole('status')).toHaveTextContent('finished');
    act(() => vi.advanceTimersByTime(2300)); expect(screen.getByRole('status')).toHaveTextContent('listening');
    fireEvent.click(screen.getByText('fail'));
    act(() => vi.advanceTimersByTime(5000)); expect(screen.getByRole('status')).toHaveTextContent('failed');
  });

  it('ignores an interrupted close completion, retains the thread, then returns focus only after close', async () => {
    const transitions: Array<{ finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
    HTMLElement.prototype.animate = vi.fn().mockImplementation(() => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const cancel = vi.fn();
      transitions.push({ finish, cancel });
      return { finished, cancel };
    });
    const afterClose = vi.fn();
    const props = { context: {}, onClose: vi.fn(), onAfterClose: afterClose, onOpenCitation: vi.fn() };
    const { rerender } = render(<KnowledgeBotWindow {...props} open />);
    const panel = screen.getByTestId('knowledge-bot-window');
    await screen.findByLabelText('retained draft');
    fireEvent.change(screen.getByLabelText('retained draft'), { target: { value: 'keep this' } });
    await act(async () => transitions[0].finish());
    expect(panel).toHaveAttribute('data-phase', 'open');
    rerender(<KnowledgeBotWindow {...props} open={false} />);
    expect(panel).toHaveAttribute('data-phase', 'closing');
    expect(panel.hidden).toBe(false);
    expect(panel.inert).toBe(true);
    expect(afterClose).not.toHaveBeenCalled();
    rerender(<KnowledgeBotWindow {...props} open />);
    expect(transitions[1].cancel).toHaveBeenCalled();
    await act(async () => transitions[1].finish());
    expect(panel).toHaveAttribute('data-phase', 'opening');
    await act(async () => transitions[2].finish());
    expect(panel).toHaveAttribute('data-phase', 'open');
    expect(screen.getByLabelText('retained draft')).toHaveValue('keep this');
    rerender(<KnowledgeBotWindow {...props} open={false} />);
    await act(async () => transitions[3].finish());
    expect(panel.hidden).toBe(true);
    expect(afterClose).toHaveBeenCalledTimes(1);
  });
});
