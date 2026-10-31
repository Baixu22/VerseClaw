/**
 * Hover marquee for one-line sidebar titles.
 *
 * A long session title is clipped to the row. Hovering the row (or reaching it
 * with the keyboard) scrolls the title as a seamless loop: the text glides left,
 * a copy follows it in after a fixed gap, and the loop comes to rest exactly
 * where it started before the next pass. Because the rest position of every
 * cycle is identical to the start, there is never a visible jump.
 *
 * Why it is imperative rather than React state:
 *
 *  - Session rows are memoized and the sidebar is re-render sensitive (see
 *    `sidebar-render-containment`). Hover is high-frequency; toggling an
 *    attribute and running a Web Animation costs no render at all.
 *  - The trailing copy is a CSS `::after` (`content: attr(data-text) / ""`), so
 *    it is not in the DOM text, not in the accessibility tree, and cannot
 *    double-match `getByText` queries.
 *
 * Speed is constant per pixel (not a fixed duration), so a slightly long title
 * and a very long one read at the same pace. Each pass eases in over a few
 * pixels, cruises, and eases out: one curve stretched over the whole pass would
 * make a long title crawl for its first second and read as "not started".
 * Reduced motion disables the loop; the row tooltip still carries the full title.
 */
import { useCallback, useEffect, useRef } from 'react';

/** Gap between the title and its looping copy. Mirrors `.task-title__text::after`. */
export const TITLE_MARQUEE_GAP_PX = 36;
/** Cruising speed. Slow enough to read CJK titles mid-scroll. */
export const TITLE_MARQUEE_SPEED_PX_PER_S = 42;
/** Distance spent accelerating at the start of a pass, and braking at its end. */
const TITLE_MARQUEE_RAMP_PX = 10;
/** Hover intent: rows the pointer merely crosses never start moving. */
const TITLE_MARQUEE_HOVER_INTENT_MS = 260;
/** Rest at the seamless point between passes. */
const TITLE_MARQUEE_LOOP_HOLD_MS = 1400;
/** Sub-pixel overflow is a rounding artefact, not a clipped title. */
const TITLE_MARQUEE_MIN_OVERFLOW_PX = 2;
/**
 * Exact quadratic ease-in / ease-out. Their slope where they meet the cruise is
 * 2 (relative), so a ramp lasting 2 × ramp ÷ speed joins the constant-speed
 * stretch without a velocity jump.
 */
const EASE_IN_QUAD = 'cubic-bezier(0.333, 0, 0.667, 0.333)';
const EASE_OUT_QUAD = 'cubic-bezier(0.333, 0.667, 0.667, 1)';

export type TitleMarqueePlan = {
  /** Distance of one pass: the title plus the gap before its copy. */
  travel: number;
  /** Duration of each of the two speed ramps. */
  rampMs: number;
  moveMs: number;
  totalMs: number;
};

/** Geometry → timing. Null when the title already fits its frame. */
export function planTitleMarquee(textWidth: number, frameWidth: number): TitleMarqueePlan | null {
  if (!(textWidth > 0) || !(frameWidth > 0)) return null;
  if (textWidth - frameWidth <= TITLE_MARQUEE_MIN_OVERFLOW_PX) return null;
  const travel = Math.round(textWidth + TITLE_MARQUEE_GAP_PX);
  const rampMs = Math.round(((2 * TITLE_MARQUEE_RAMP_PX) / TITLE_MARQUEE_SPEED_PX_PER_S) * 1000);
  const cruiseMs = Math.round(((travel - 2 * TITLE_MARQUEE_RAMP_PX) / TITLE_MARQUEE_SPEED_PX_PER_S) * 1000);
  const moveMs = rampMs + cruiseMs + rampMs;
  return { travel, rampMs, moveMs, totalMs: moveMs + TITLE_MARQUEE_LOOP_HOLD_MS };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function currentTranslateX(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly !== 'function') return 0;
  return new DOMMatrixReadOnly(transform).m41;
}

/**
 * `clipRef` is the overflow frame, `textRef` the moving title inside it. The
 * frame carries `data-marquee="on"` while a loop (or its settle) is running,
 * which is what reveals the trailing copy and the two-sided fade in CSS.
 */
export function useTitleMarquee() {
  const clipRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const intentTimer = useRef<number | null>(null);
  const loop = useRef<{ animation: Animation; travel: number } | null>(null);
  const settle = useRef<Animation | null>(null);

  const clearIntent = useCallback(() => {
    if (intentTimer.current == null) return;
    window.clearTimeout(intentTimer.current);
    intentTimer.current = null;
  }, []);

  const reset = useCallback(() => {
    settle.current?.cancel();
    settle.current = null;
    loop.current?.animation.cancel();
    loop.current = null;
    clipRef.current?.removeAttribute('data-marquee');
  }, []);

  const start = useCallback(() => {
    if (intentTimer.current != null || loop.current) return;
    // Re-entering while the previous pass is still settling: start clean.
    if (settle.current) reset();
    intentTimer.current = window.setTimeout(() => {
      intentTimer.current = null;
      const clip = clipRef.current;
      const text = textRef.current;
      if (!clip || !text || typeof text.animate !== 'function' || prefersReducedMotion()) return;
      const clipStyle = getComputedStyle(clip);
      const frameWidth = clip.clientWidth
        - (parseFloat(clipStyle.paddingLeft) || 0)
        - (parseFloat(clipStyle.paddingRight) || 0);
      const plan = planTitleMarquee(text.getBoundingClientRect().width, frameWidth);
      if (!plan) return;
      clip.setAttribute('data-marquee', 'on');
      const ramp = TITLE_MARQUEE_RAMP_PX;
      const at = (ms: number) => ms / plan.totalMs;
      const animation = text.animate(
        [
          { transform: 'translateX(0)', easing: EASE_IN_QUAD },
          { transform: `translateX(${-ramp}px)`, offset: at(plan.rampMs), easing: 'linear' },
          { transform: `translateX(${-(plan.travel - ramp)}px)`, offset: at(plan.moveMs - plan.rampMs), easing: EASE_OUT_QUAD },
          { transform: `translateX(${-plan.travel}px)`, offset: at(plan.moveMs) },
          { transform: `translateX(${-plan.travel}px)` },
        ],
        { duration: plan.totalMs, iterations: Infinity },
      );
      loop.current = { animation, travel: plan.travel };
    }, TITLE_MARQUEE_HOVER_INTENT_MS);
  }, [reset]);

  /**
   * Leaving mid-pass glides to the NEAREST rest point instead of snapping back:
   * past the halfway mark that is the copy's start, which looks identical to
   * the original's, so the title never rewinds across the whole row.
   */
  const stop = useCallback(() => {
    clearIntent();
    const current = loop.current;
    const text = textRef.current;
    if (!current || !text) return;
    loop.current = null;
    const x = currentTranslateX(text);
    current.animation.cancel();
    const target = -x > current.travel / 2 ? -current.travel : 0;
    const distance = Math.abs(target - x);
    if (distance < 0.5) {
      clipRef.current?.removeAttribute('data-marquee');
      return;
    }
    const animation = text.animate(
      [{ transform: `translateX(${x}px)` }, { transform: `translateX(${target}px)` }],
      { duration: Math.min(460, 170 + distance * 1.6), easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'forwards' },
    );
    settle.current = animation;
    animation.onfinish = () => {
      if (settle.current !== animation) return;
      settle.current = null;
      // Same frame: drop the copy and the held transform together.
      animation.cancel();
      clipRef.current?.removeAttribute('data-marquee');
    };
  }, [clearIntent]);

  useEffect(() => () => {
    clearIntent();
    reset();
  }, [clearIntent, reset]);

  return { clipRef, textRef, start, stop };
}
