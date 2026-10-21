/**
 * MessageNavRail — the prompt minimap's contract.
 *
 * Tested at component level rather than through the Chat page: every assertion
 * here is about the rail's own decisions (when to appear, what to jump to, what
 * the preview says), and none of them need a transcript store to reach. The
 * page-level wiring is covered by `chat-message-nav-rail-wiring` at the bottom.
 *
 * jsdom notes that shape these tests:
 *   - `clientWidth` is always 0 and read-only, so the width gate is exercised by
 *     defining it per case. 0 deliberately means "not laid out yet", which is why
 *     the default-width case still renders.
 *   - Scrolling is scoped to the transcript's own scrollTo, so outer panes stay put.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  MessageNavRail,
  MESSAGE_NAV_RAIL_MIN_ITEMS,
  MESSAGE_NAV_RAIL_MIN_WIDTH,
  type MessageNavRailItem,
} from '@/pages/Chat/MessageNavRail';

/* jsdom implements no scrolling at all. The rail keeps its own active tick in
 * view, so the prototype needs a stub before anything mounts; per-anchor spies
 * below still shadow it where a call has to be asserted. */
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? function noop() {};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'messageNav.label') return 'Prompt navigation';
      if (key === 'messageNav.jumpTo') return `Jump to prompt ${String(options?.ordinal ?? '')}`;
      return key;
    },
  }),
}));

function makeItems(count: number): MessageNavRailItem[] {
  return Array.from({ length: count }, (_, i) => ({
    // Prompts sit at even transcript indices when every turn has one reply, so
    // non-contiguous indices are the normal case, not an edge case.
    index: i * 2,
    ordinal: i + 1,
    title: `Prompt number ${i + 1}`,
  }));
}

/**
 * Mount the rail alongside the transcript anchors it navigates. `scrollWidth`
 * stands in for the reading pane's measured width.
 */
function mountRail(items: MessageNavRailItem[], scrollerWidth = 0) {
  const scroller = document.createElement('div');
  scroller.setAttribute('data-testid', 'scroller');
  Object.defineProperty(scroller, 'clientWidth', { value: scrollerWidth, configurable: true });
  document.body.appendChild(scroller);

  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo;
  for (const item of items) {
    const anchor = document.createElement('div');
    anchor.id = `chat-message-${item.index}`;
    scroller.appendChild(anchor);
  }

  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = scroller;

  const view = render(
    <TooltipProvider>
      <MessageNavRail items={items} scrollRef={ref} />
    </TooltipProvider>,
  );
  return { ...view, scroller, scrollTo };
}

describe('MessageNavRail visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it(`stays hidden below ${MESSAGE_NAV_RAIL_MIN_ITEMS} prompts`, () => {
    mountRail(makeItems(MESSAGE_NAV_RAIL_MIN_ITEMS - 1));
    expect(screen.queryByTestId('chat-message-nav-rail')).not.toBeInTheDocument();
  });

  it(`appears at exactly ${MESSAGE_NAV_RAIL_MIN_ITEMS} prompts, one tick each`, () => {
    mountRail(makeItems(MESSAGE_NAV_RAIL_MIN_ITEMS));
    expect(screen.getByTestId('chat-message-nav-rail')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^chat-message-nav-rail-item-/)).toHaveLength(MESSAGE_NAV_RAIL_MIN_ITEMS);
  });

  it('scales to many prompts without dropping any', () => {
    // No top-N truncation: a rail that silently omits prompts reads as "that
    // turn does not exist". Overflow is handled by scrolling the rail instead.
    mountRail(makeItems(40));
    expect(screen.getAllByTestId(/^chat-message-nav-rail-item-/)).toHaveLength(40);
  });

  it('folds away when the reading pane is too narrow to spare a gutter', async () => {
    mountRail(makeItems(5), MESSAGE_NAV_RAIL_MIN_WIDTH - 1);
    await waitFor(() => expect(screen.queryByTestId('chat-message-nav-rail')).not.toBeInTheDocument());
  });

  it('shows when the pane is wide enough', () => {
    mountRail(makeItems(5), MESSAGE_NAV_RAIL_MIN_WIDTH);
    expect(screen.getByTestId('chat-message-nav-rail')).toBeInTheDocument();
  });

  /**
   * A zero measurement means "layout has not happened yet" — first frame, hidden
   * tab, headless. Treating it as "too narrow" latched the rail off for the whole
   * session, because nothing re-renders it once layout settles.
   */
  it('treats an unmeasured pane as wide rather than narrow', () => {
    mountRail(makeItems(5), 0);
    expect(screen.getByTestId('chat-message-nav-rail')).toBeInTheDocument();
  });
});

describe('MessageNavRail navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('scrolls to the transcript anchor for the clicked prompt', () => {
    const items = makeItems(4);
    const { scrollTo } = mountRail(items, 1200);

    fireEvent.click(screen.getByTestId(`chat-message-nav-rail-item-${items[2].index}`));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: -20 });
  });

  it('labels each tick with its prompt ordinal', () => {
    mountRail(makeItems(4), 1200);
    expect(screen.getByLabelText('Jump to prompt 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Jump to prompt 3')).toBeInTheDocument();
  });

  it('carries the prompt text as the hover preview', async () => {
    const items = makeItems(4);
    items[1].response = 'Visible assistant response';
    mountRail(items, 1200);

    fireEvent.focus(screen.getByTestId(`chat-message-nav-rail-item-${items[1].index}`));

    // Radix portals the content and mirrors it into a visually-hidden
    // `role="tooltip"` node, so the preview legitimately appears twice.
    expect(await screen.findAllByText('Prompt number 2')).not.toHaveLength(0);
    expect(await screen.findAllByText('Visible assistant response')).not.toHaveLength(0);
    expect(screen.queryByText('Prompt number 1')).not.toBeInTheDocument();
  });

  it('marks exactly one tick as current', async () => {
    mountRail(makeItems(5), 1200);
    // The first active-tick read is deferred a frame so it measures post-layout.
    await waitFor(() => {
      const active = screen.getAllByTestId(/^chat-message-nav-rail-item-/)
        .filter((tick) => tick.dataset.active === 'true');
      expect(active).toHaveLength(1);
    });
  });
});
