/**
 * MessageNavRail — a minimap of the user's own prompts, down the left gutter.
 *
 * Long sessions have one navigation problem the transcript cannot solve: "where
 * did I ask that?". Scrolling is linear and every turn now folds its process
 * away, so the visual landmarks that used to mark turn boundaries are gone. The
 * rail turns each prompt into a 2px tick — dense enough that twenty turns still
 * fit, quiet enough to ignore.
 *
 * It is NOT a replacement for the `QuestionDirectory` panel: that one is an
 * opt-in, toolbar-toggled list with full titles and takes real layout width.
 * This is always-on, costs 14px of otherwise-empty gutter, and answers "roughly
 * where am I" as much as "take me there" — which is why the bar tracking the
 * viewport is highlighted rather than every bar looking alike.
 *
 * Deliberately absent: any notion of assistant messages. Ticks map to prompts
 * because prompts are what the user remembers writing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type MessageNavRailItem = {
  /** Index into the transcript — matches the `#chat-message-{index}` anchor. */
  index: number;
  /** 1-based prompt number, for the accessible label. */
  ordinal: number;
  /** Already-truncated prompt preview (see `buildQuestionDirectoryTitle`). */
  title: string;
};

/**
 * Below three prompts the rail is noise: two ticks navigate a conversation the
 * user can see in one screen, and the affordance costs more attention than it
 * returns.
 */
export const MESSAGE_NAV_RAIL_MIN_ITEMS = 3;

/**
 * The rail takes its own 28px column rather than floating in the reading
 * column's gutter.
 *
 * The gutter looked free — the column is capped at 820px and centred — but it
 * only exists when the pane is wider than the cap. An absolutely positioned
 * rail there had nothing to sit in at common window sizes, so occupying real
 * space keeps it visible without overlapping prose.
 *
 * Below this pane width even that is too much to give up, so the rail folds.
 */
export const MESSAGE_NAV_RAIL_MIN_WIDTH = 520;

export function MessageNavRail({
  items,
  scrollRef,
}: {
  items: MessageNavRailItem[];
  /** The transcript scroller — supplies both the width gate and the scroll signal. */
  scrollRef: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation('chat');
  const railRef = useRef<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [fits, setFits] = useState(true);

  /**
   * Width gate. Measured from the scroller rather than the viewport: the artifact
   * panel can halve the transcript's width without the window changing at all,
   * and that case has to fold the rail away too.
   *
   * A non-positive measurement means "not laid out yet" (first frame, hidden tab,
   * headless), NOT "too narrow", so it is ignored and the initial answer is
   * optimistic — with no layout there is no prose to overlap.
   */
  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const width = scroller.clientWidth;
    if (width <= 0) return;
    setFits(width >= MESSAGE_NAV_RAIL_MIN_WIDTH);
  }, [scrollRef]);

  /* Re-measured after EVERY render, deliberately. A single mount-time
   * measurement latches whatever the layout happened to be mid-startup and
   * never revisits it — the rail then stays hidden (or visible) for the rest of
   * the session regardless of the real width. One `clientWidth` read per render
   * is cheaper than the class of bug that costs. */
  useEffect(() => {
    measure();
  });

  /* Explicit signals on top, for the case where nothing re-renders: the observer
   * catches the artifact panel resizing the scroller, `resize` catches
   * environments that throttle observers on emulated viewport changes. */
  useEffect(() => {
    const scroller = scrollRef.current;
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (scroller) observer?.observe(scroller);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure, scrollRef]);

  /**
   * Which prompt is the reader currently in?
   *
   * Resolved on scroll rather than with an IntersectionObserver: the answer is
   * "the last prompt whose anchor is at or above the reading line", which is a
   * property of the scroll position, not of any single element's visibility. An
   * observer would go silent exactly when it matters — while the reader sits in
   * the middle of one very long turn whose anchor has left the viewport.
   */
  const syncActive = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const readingLine = scroller.getBoundingClientRect().top + 96;
    let current: number | null = null;
    for (const item of items) {
      const anchor = document.getElementById(`chat-message-${item.index}`);
      if (!anchor) continue;
      if (anchor.getBoundingClientRect().top <= readingLine) current = item.index;
      else break;
    }
    setActiveIndex(current ?? items[0]?.index ?? null);
  }, [items, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    /* The first read waits a frame: measuring in the effect body can catch a
     * pre-layout position, which would mark the wrong tick current until the
     * reader happens to scroll. */
    const frame = requestAnimationFrame(syncActive);
    scroller.addEventListener('scroll', syncActive, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', syncActive);
    };
  }, [scrollRef, syncActive]);

  /* A rail taller than its 70vh cap scrolls internally; keep the active tick
   * reachable rather than silently dropping prompts from the list. */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || activeIndex == null) return;
    rail.querySelector(`[data-nav-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const jumpTo = (index: number) => {
    document.getElementById(`chat-message-${index}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  if (items.length < MESSAGE_NAV_RAIL_MIN_ITEMS || !fits) return null;

  return (
    <nav
      ref={railRef}
      data-testid="chat-message-nav-rail"
      aria-label={t('messageNav.label')}
      /* An in-flow 28px column, vertically centred on the pane. `sticky` keeps
         the ticks in place while the transcript scrolls underneath. */
      className={cn(
        'sticky top-0 z-20 flex h-full w-7 shrink-0 flex-col items-center justify-center',
        'max-h-full overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      {items.map((item) => {
        const isActive = item.index === activeIndex;
        return (
          <Tooltip key={item.index}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid={`chat-message-nav-rail-item-${item.index}`}
                data-nav-index={item.index}
                data-active={isActive ? 'true' : 'false'}
                aria-label={t('messageNav.jumpTo', { ordinal: item.ordinal })}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => jumpTo(item.index)}
                /* The button is the hit area (16px tall), the span is the mark
                   (2px tall) — a 2px target would be unclickable. */
                className="group/nav-tick flex h-4 w-7 shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 rounded-full transition-[width,background-color,opacity] duration-200 ease-out',
                    'group-hover/nav-tick:w-6 group-focus-visible/nav-tick:w-6',
                    isActive
                      ? 'w-5 bg-foreground/55'
                      : 'w-3 bg-foreground/25 group-hover/nav-tick:bg-foreground/50',
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="max-w-xs text-xs">
              {item.title}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
