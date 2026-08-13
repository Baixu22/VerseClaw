/**
 * ThinkingReasoning — the agent's reasoning stream.
 *
 * Ported from AIcss "Thinking + Reasoning" (https://www.aicss.dev/components/
 * thinking-reasoning, free tier) and rewritten for this codebase:
 *
 * - The upstream component is a self-contained demo: hardcoded sentences and a
 *   `setTimeout` timeline that fakes ~5s of thinking. This version is driven by
 *   real data — sentences appear because the store received them.
 * - Upstream styles with plain CSS modules that theme via
 *   `@media (prefers-color-scheme: dark)`. This app themes with `darkMode:
 *   ['class']` (the theme is user-selectable), so a media query would show
 *   light chrome inside a dark transcript. Rewritten with the project's tokens.
 * - Upstream pins `width: 360px` / `min-height: 206px`; the transcript is fluid
 *   and must not reserve 206px of empty space, so both are dropped.
 *
 * Kept from the original: the shimmering header that folds into a "Thought
 * for Ns" summary, the grid-rows collapse, and the capped viewport whose top
 * and bottom fades follow the scroll position.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import type { AssistantReasoning } from './model';

/** Viewport cap and fade depth, in px — mirrors the upstream geometry. */
const MAX_VIEWPORT_H = 180;
const FADE = 16;

export function ThinkingReasoning({
  items,
  streaming = false,
  durationMs,
  defaultOpen = false,
}: {
  items: AssistantReasoning[];
  /** While the run is still thinking the stream stays open and the label shimmers. */
  streaming?: boolean;
  /** Renders "Thought for Ns" when the elapsed time is actually known. */
  durationMs?: number;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(defaultOpen);
  const [capped, setCapped] = useState(false);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // While thinking the reasoning is always visible; once done it folds into
  // the summary and the user can toggle it back open.
  const expanded = streaming || open;
  const scrollable = !streaming && open;

  const syncFades = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const overflowing = el.scrollHeight > el.clientHeight + 1;
    setCapped(overflowing);
    setFade({
      top: overflowing && el.scrollTop > 1,
      bottom: overflowing && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  // New sentences arrive from the store rather than a scripted timer, so the
  // "auto-scroll to the newest thought" behaviour keys off item count.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (streaming) el.scrollTop = el.scrollHeight;
    syncFades();
  }, [items.length, expanded, streaming, syncFades]);

  if (items.length === 0) return null;

  const seconds = durationMs != null && Number.isFinite(durationMs)
    ? Math.max(1, Math.round(durationMs / 1000))
    : null;
  const summaryLabel = seconds != null
    ? t('assistantRender.reasoning.thoughtFor', { seconds })
    : items[0]?.title || t('assistantRender.reasoning.thought');

  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? FADE : 0}px, #000 calc(100% - ${fade.bottom ? FADE : 0}px), transparent 100%)`
    : undefined;

  return (
    <div className="flex w-full min-w-0 flex-col" data-testid="assistant-reasoning-panel">
      <button
        type="button"
        className={cn(
          'inline-flex min-h-5 items-center gap-1.5 self-start rounded-sm text-left',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          streaming ? 'cursor-default' : 'cursor-pointer',
        )}
        aria-expanded={expanded}
        aria-label={t('assistantRender.reasoning.toggle')}
        onClick={streaming ? undefined : () => setOpen((value) => !value)}
      >
        {streaming ? (
          <Shimmer className="text-[13px] font-medium leading-[18px] tracking-[-0.005em]">
            {t('assistantRender.reasoning.thinking')}
          </Shimmer>
        ) : (
          <span className="text-[13px] font-medium leading-[18px] tracking-[-0.005em] text-muted-foreground/70">
            {summaryLabel}
          </span>
        )}
        {!streaming && (
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        )}
      </button>

      {/* grid-rows 1fr → 0fr collapses to the content's own height without
          measuring it, which keeps variable-length reasoning smooth. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={viewportRef}
            onScroll={scrollable ? syncFades : undefined}
            style={{
              maxHeight: `${MAX_VIEWPORT_H}px`,
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
            className={cn(
              'mt-1.5 flex flex-col gap-1',
              scrollable ? 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'overflow-hidden',
            )}
          >
            {items.map((item) => (
              <p
                key={item.id}
                className="m-0 line-clamp-2 text-[13px] font-[425] leading-5 tracking-[-0.005em] text-muted-foreground/80 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
              >
                {item.summary}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
