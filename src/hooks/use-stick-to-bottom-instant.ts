import { useCallback, useEffect, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

const ESCAPE_FROM_LOCK_OFFSET_PX = 70;

/** Sub-pixel tolerance for "the transcript is at the bottom again". */
const PINNED_EPSILON_PX = 8;

/**
 * A wrapper around useStickToBottom that ensures the initial scroll
 * to bottom happens instantly without any visible animation.
 *
 * @param resetKey - When this key changes, the scroll position will be reset to bottom instantly.
 *                   Typically this should be the conversation ID.
 * @param active   - When true (e.g. an AI run is streaming), the scroll position is pinned to the
 *                   very bottom instantly on every layout change — both growth and shrink — so
 *                   tool-heavy runs that churn the layout don't produce erratic up/down jitter.
 *                   Pinning is suppressed once the user manually scrolls more than
 *                   `ESCAPE_FROM_LOCK_OFFSET_PX` away from the bottom, so it never fights a
 *                   user reading earlier history; returning to the bottom resumes it.
 */
export function useStickToBottomInstant(resetKey?: string, active = false, preserveReadingPosition = false) {
  const lastKeyRef = useRef(resetKey);
  const hasInitializedRef = useRef(false);

  const result = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  const { scrollRef, contentRef, stopScroll } = result;
  const scrollEscapeCleanupRef = useRef<(() => void) | null>(null);

  // Keep the latest "should we pin?" inputs available inside the ResizeObserver
  // callback without re-creating the observer on every render.
  //
  // The latch is ours, not the library's `escapedFromLock`: the library flips
  // its flag on *any* upward scrollTop change, which includes the browser
  // clamping the scroll position when the transcript gets shorter.
  const activeRef = useRef(active);
  const userEscapedRef = useRef(false);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  /*
   * Last observed transcript geometry.
   *
   * These two numbers are what separate "the user scrolled up" from "the
   * transcript changed underneath a stationary viewport". A wide gap from the
   * bottom is only a user gesture when the viewport itself moved up:
   *
   *   - user scrolls up   → scrollTop decreased, scrollHeight unchanged
   *   - content appended  → scrollHeight increased, scrollTop unchanged
   *   - content shrank    → scrollHeight decreased, scrollTop follows it down
   *                         (browser clamping / scroll anchoring)
   *
   * Latching on either of the non-gesture cases switched pinning off for the
   * remainder of the run, with nothing left to re-pin the transcript — the 240px
   * drift the pin-to-bottom spec reports.
   */
  const lastScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  // Instantly glue the scrollbar to the bottom. The library only animates on
  // *positive* resizes and ignores *negative* ones; this covers both so the
  // bar stays at the very bottom through promotion/demotion, graph collapse,
  // and indicator swaps during a run.
  const pinToBottom = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    lastScrollHeightRef.current = scrollElement.scrollHeight;
    if (!activeRef.current || userEscapedRef.current) {
      lastScrollTopRef.current = scrollElement.scrollTop;
      return;
    }
    scrollElement.scrollTop = scrollElement.scrollHeight;
    lastScrollTopRef.current = scrollElement.scrollTop;
  }, [scrollRef]);

  // Combine the library's content ref with our own ResizeObserver so we can
  // react to every layout change (the library's observer only scrolls on
  // growth).
  const pinObserverRef = useRef<ResizeObserver | null>(null);
  const combinedContentRef = useCallback(
    (element: HTMLElement | null) => {
      contentRef(element);

      pinObserverRef.current?.disconnect();
      pinObserverRef.current = null;

      if (!element) return;

      const observer = new ResizeObserver(() => {
        pinToBottom();
        // A trailing frame lets the library's own scroll settle first so our
        // instant pin wins the final position.
        requestAnimationFrame(() => pinToBottom());
      });
      observer.observe(element);
      pinObserverRef.current = observer;
    },
    [contentRef, pinToBottom],
  );

  const combinedScrollRef = useCallback(
    (element: HTMLElement | null) => {
      scrollRef(element);

      scrollEscapeCleanupRef.current?.();
      scrollEscapeCleanupRef.current = null;

      if (!element) return;

      const handleScroll = () => {
        const scrollHeight = element.scrollHeight;
        const scrollTop = element.scrollTop;
        const previousHeight = lastScrollHeightRef.current;
        const previousTop = lastScrollTopRef.current;
        lastScrollHeightRef.current = scrollHeight;
        lastScrollTopRef.current = scrollTop;
        const distanceFromBottom = scrollHeight - element.clientHeight - scrollTop;
        if (distanceFromBottom > ESCAPE_FROM_LOCK_OFFSET_PX) {
          /*
           * Only a viewport that actually moved up is the user taking over.
           * `previousHeight` of 0 means this is the first observation — pinning
           * has not run yet, so there is nothing to escape from either.
           */
          const viewportMovedUp = scrollTop < previousTop;
          const contentShrank = scrollHeight < previousHeight;
          if (previousHeight === 0 || !viewportMovedUp || contentShrank) return;
          userEscapedRef.current = true;
          stopScroll();
          return;
        }
        // Back at the bottom (our own pin, "scroll to latest", or the user
        // scrolling down): resume pinning.
        if (distanceFromBottom <= PINNED_EPSILON_PX) {
          userEscapedRef.current = false;
        }
      };
      element.addEventListener("scroll", handleScroll, { passive: true });
      scrollEscapeCleanupRef.current = () => element.removeEventListener("scroll", handleScroll);
    },
    [scrollRef, stopScroll],
  );

  useEffect(() => {
    return () => {
      pinObserverRef.current?.disconnect();
      pinObserverRef.current = null;
      scrollEscapeCleanupRef.current?.();
      scrollEscapeCleanupRef.current = null;
    };
  }, []);

  // Reset initialization when key changes
  useEffect(() => {
    if (resetKey !== lastKeyRef.current) {
      hasInitializedRef.current = false;
      lastKeyRef.current = resetKey;
    }
  }, [resetKey]);

  // Scroll to bottom instantly on mount or when key changes
  useEffect(() => {
    if (preserveReadingPosition) {
      // The session reading owner restores this visit. Disable library/stream
      // pinning before its frame so a delayed bottom scroll cannot replace it.
      stopScroll();
      userEscapedRef.current = true;
      hasInitializedRef.current = true;
      return;
    }
    if (hasInitializedRef.current) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    // Hide, scroll, reveal pattern to avoid visible animation
    scrollElement.style.visibility = "hidden";

    // Use double RAF to ensure content is rendered
    let frame2: number | undefined;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        // Direct scroll to bottom
        scrollElement.scrollTop = scrollElement.scrollHeight;

        scrollElement.style.visibility = "";
        hasInitializedRef.current = true;
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2 !== undefined) cancelAnimationFrame(frame2);
      scrollElement.style.visibility = "";
    };
  }, [scrollRef, resetKey, preserveReadingPosition, stopScroll]);

  return { ...result, scrollRef: combinedScrollRef, contentRef: combinedContentRef };
}
