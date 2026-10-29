/** Adapted from Rare UI Web Search. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory.
 *
 * Progress adaptation: Rare UI's reference draws a progress ring around the
 * globe tile. This port keeps the rest of the surface (search pill, source
 * cards, favicon stack, answer summary, collapse) but replaces the ring with
 * the same left-to-right progress wash ReactBits' CallChip uses, so a running
 * search reads as a filling bar instead of an arc. */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { AlertTriangle, Check, ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type WebSearchStatus = 'searching' | 'done' | 'error';

export type WebSearchSource = {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  score?: number;
  publishedDate?: string;
  favicon?: string;
};

export type WebSearchProps = {
  sources: WebSearchSource[];
  status?: WebSearchStatus;
  query?: string;
  label?: string;
  progress?: number;
  provider?: string;
  answer?: string;
  truncated?: boolean;
  linked?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

const COLUMNS = 4;
const STEP = 0.3;
const START = 0.08;
const CREEP = 0.25;
const CREEP_SECONDS = 4;

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function siteName(url: string): string {
  const host = hostOf(url);
  const parts = host.split('.');
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] || host;
}

function faviconHue(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) % 360;
}

function faviconBackground(hue: number): string {
  return 'linear-gradient(135deg, oklch(0.72 0.15 ' + hue + '), oklch(0.58 0.17 ' + ((hue + 30) % 360) + '))';
}

function WebSourceFavicon({ source, size }: { source: WebSearchSource; size: number }) {
  const [broken, setBroken] = useState(false);
  const name = siteName(source.url) || source.url;
  const showImage = Boolean(source.favicon) && !broken;
  const hue = faviconHue(name);

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold uppercase leading-none text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: showImage ? undefined : faviconBackground(hue),
      }}
    >
      {showImage ? (
        <img
          src={source.favicon}
          alt=""
          draggable={false}
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        name.charAt(0)
      )}
    </span>
  );
}

function FaviconStack({ sources }: { sources: WebSearchSource[] }) {
  const shown = sources.slice(0, 4);
  const overlap = 8;
  return (
    <span className="flex w-fit shrink-0 items-center" data-testid="chat-web-search-stack" aria-hidden="true">
      {shown.map((source, index) => (
        <span
          key={source.id}
          className="relative rounded-full border border-border/60 bg-surface-input p-[1.5px]"
          style={{ zIndex: shown.length - index, marginLeft: index === 0 ? 0 : -overlap }}
        >
          <WebSourceFavicon source={source} size={18} />
        </span>
      ))}
    </span>
  );
}

function SkeletonCard({ reduced }: { reduced: boolean }) {
  const bar = 'rounded-full bg-black/[0.06] dark:bg-white/[0.07]';
  return (
    <div className="relative flex h-[84px] flex-col justify-between overflow-hidden rounded-xl bg-black/[0.035] p-2.5 dark:bg-white/[0.05]">
      <span className="flex flex-col gap-1.5 pt-0.5">
        <span className={cn(bar, 'h-2.5 w-[88%]')} />
        <span className={cn(bar, 'h-2.5 w-[60%]')} />
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(bar, 'size-3.5')} />
        <span className={cn(bar, 'h-2 w-12')} />
      </span>
      {!reduced && (
        <motion.span
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/[0.06]"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1.3, ease: 'easeInOut', repeat: Infinity }}
        />
      )}
    </div>
  );
}

function SourceCard({ source, index, linked }: { source: WebSearchSource; index: number; linked: boolean }) {
  const href = linked ? source.url : undefined;
  return (
    <a
      data-slot="web-search-source"
      data-testid="chat-web-search-source"
      href={href}
      target={linked ? '_blank' : undefined}
      rel={linked ? 'noreferrer' : undefined}
      title={source.snippet || source.title}
      className={cn(
        'group/source flex h-[84px] w-full flex-col justify-between rounded-xl bg-black/[0.035] p-2.5 text-left no-underline outline-none transition-[background-color,box-shadow,translate] duration-200 dark:bg-white/[0.05]',
        linked
          ? 'cursor-pointer hover:-translate-y-0.5 hover:bg-black/[0.05] hover:shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:hover:bg-white/[0.08] dark:hover:shadow-none'
          : 'cursor-default',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      <span className="line-clamp-2 text-[12.5px] font-semibold leading-[17px] text-foreground/85 transition-colors group-hover/source:text-foreground">
        {source.title || hostOf(source.url)}
      </span>
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <WebSourceFavicon source={source} size={16} />
        <span className="min-w-0 flex-1 truncate">{siteName(source.url)}</span>
        <span className="text-[11px] font-semibold tabular-nums opacity-70">{index}</span>
      </span>
    </a>
  );
}

function MoreCard({ hidden, expanded, onClick }: { hidden: WebSearchSource[]; expanded: boolean; onClick: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <button
      type="button"
      data-testid="chat-web-search-more"
      onClick={onClick}
      aria-expanded={expanded}
      className="group/source flex h-[84px] w-full flex-col justify-between rounded-xl bg-black/[0.035] p-2.5 text-left outline-none transition-colors hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
    >
      <FaviconStack sources={hidden} />
      <span className="flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold leading-[17px] text-foreground/85 group-hover/source:text-foreground">
        <span className="tabular-nums">{hidden.length}</span>
        {t('toolUi.webSearch.more', { count: hidden.length })}
      </span>
    </button>
  );
}

export function WebSearch({
  sources,
  status = 'done',
  query,
  label,
  progress,
  provider,
  answer,
  truncated = false,
  linked = true,
  open,
  defaultOpen = true,
  onOpenChange,
  className,
}: WebSearchProps) {
  const { t } = useTranslation('chat');
  const reduced = !!useReducedMotion();
  const [openState, setOpenState] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);
  const fill = useMotionValue(0);

  const searching = status === 'searching';
  const failed = status === 'error';
  const isOpen = open ?? openState;
  const count = sources.length;
  const countProgress = count === 0 ? START : 1 - (1 - STEP) ** count;
  const targetProgress = clampProgress(progress ?? countProgress);
  const fillTarget = searching ? Math.min(targetProgress, 0.92) : failed ? 0.92 : 1;

  useEffect(() => {
    if (reduced) {
      fill.jump(fillTarget);
      return undefined;
    }
    let creep: ReturnType<typeof animate> | undefined;
    const settle = animate(fill, fillTarget, {
      duration: searching ? 0.6 : 0.35,
      ease: 'easeOut',
    });
    if (searching) {
      void settle.then(() => {
        creep = animate(fill, fillTarget + (1 - fillTarget) * CREEP, {
          duration: CREEP_SECONDS,
          ease: 'easeOut',
        });
      });
    }
    return () => {
      settle.stop();
      creep?.stop();
    };
  }, [fill, fillTarget, reduced, searching]);

  const hidden = !expanded && count >= COLUMNS ? sources.slice(COLUMNS - 1) : [];
  const shown = hidden.length > 0 ? sources.slice(0, COLUMNS - 1) : sources;
  const skeletons = searching ? Math.max(0, COLUMNS - count) : 0;

  const text = useMemo(() => {
    if (label) return label;
    if (searching) {
      return query
        ? t('toolUi.webSearch.searchingQuery', { query })
        : t('toolUi.webSearch.searching');
    }
    if (failed) return t('toolUi.webSearch.failed');
    return t('toolUi.webSearch.searched', { count });
  }, [count, failed, label, query, searching, t]);

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const fillBackground = searching
    ? 'bg-foreground/[0.05]'
    : failed
      ? 'bg-destructive/10'
      : 'bg-emerald-500/10';
  const barColor = searching
    ? 'bg-primary'
    : failed
      ? 'bg-destructive'
      : 'bg-emerald-500';

  return (
    <div
      data-slot="web-search"
      data-testid="chat-web-search"
      data-status={status}
      data-progress-mode="horizontal"
      className={cn('flex w-full max-w-full flex-col text-foreground', className)}
    >
      <button
        type="button"
        data-testid="chat-web-search-trigger"
        onClick={toggle}
        aria-expanded={isOpen}
        className={cn(
          'group/web-search relative flex h-9 w-fit max-w-full items-center gap-2 overflow-hidden rounded-full border bg-surface-input pl-1.5 pr-3 text-left outline-none transition-colors',
          'border-border/60 hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:hover:bg-white/[0.04]',
          searching && 'border-foreground/15',
          failed && 'border-destructive/30',
        )}
      >
        <motion.span
          aria-hidden="true"
          data-testid="chat-web-search-progress"
          data-progress-mode="horizontal"
          className={cn('pointer-events-none absolute inset-0 origin-left rounded-full', fillBackground)}
          style={{ scaleX: fill }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-black/[0.07] dark:bg-white/[0.09]"
        >
          <motion.span
            data-testid="chat-web-search-bar"
            data-progress-mode="horizontal"
            className={cn('absolute inset-y-0 left-0 w-full origin-left', barColor)}
            style={{ scaleX: fill }}
          />
        </span>
        <span
          className={cn(
            'relative flex size-6 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-muted-foreground dark:bg-white/[0.07]',
            !searching && !failed && 'text-emerald-700 dark:text-emerald-400',
            failed && 'text-destructive',
          )}
          aria-hidden="true"
        >
          {searching ? (
            <Search className="size-3.5" strokeWidth={1.8} />
          ) : failed ? (
            <AlertTriangle className="size-3.5" strokeWidth={2} />
          ) : (
            <Check className="size-3.5" strokeWidth={2.2} />
          )}
        </span>

        <span className="relative min-w-0 max-w-[16rem] truncate text-[13px] font-semibold leading-5">
          {searching && !reduced ? (
            <span className="bg-[linear-gradient(110deg,hsl(var(--muted-foreground))_0%,hsl(var(--foreground))_45%,hsl(var(--muted-foreground))_80%)] bg-[length:200%_100%] bg-clip-text text-transparent motion-safe:animate-[ai-elements-shimmer_1.8s_linear_infinite]">
              {text}
            </span>
          ) : (
            text
          )}
        </span>

        {count > 0 && <FaviconStack sources={sources} />}

        {provider ? (
          <span className="relative shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/[0.07]">
            {provider}
          </span>
        ) : null}

        <motion.span
          className="relative shrink-0 text-muted-foreground transition-colors group-hover/web-search:text-foreground"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          aria-hidden="true"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (count > 0 || searching) && (
          <motion.div
            key="sources"
            data-testid="chat-web-search-sources"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
          >
            <ol className="grid grid-cols-2 gap-2 pt-2.5 sm:grid-cols-4">
              <AnimatePresence initial={false} mode="popLayout">
                {shown.map((source, index) => (
                  <motion.li
                    key={source.id}
                    layout={!reduced}
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: reduced ? 0 : 0.25, delay: reduced ? 0 : index * 0.04 }}
                  >
                    <SourceCard source={source} index={index + 1} linked={linked} />
                  </motion.li>
                ))}
                {hidden.length > 0 && (
                  <motion.li key="more" layout={!reduced}>
                    <MoreCard hidden={hidden} expanded={expanded} onClick={() => setExpanded(true)} />
                  </motion.li>
                )}
                {Array.from({ length: skeletons }, (_, index) => (
                  <li key={'skeleton-' + index} aria-hidden="true">
                    <SkeletonCard reduced={reduced} />
                  </li>
                ))}
              </AnimatePresence>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>

      {answer && !searching ? (
        <div
          data-testid="chat-web-search-answer"
          className="mt-2 rounded-xl border border-border/60 bg-surface-input/60 px-3 py-2 text-[13px] leading-6 text-foreground/80"
        >
          <p className="whitespace-pre-wrap">{answer}</p>
        </div>
      ) : null}

      {truncated && !searching ? (
        <p className="pt-1.5 text-[11px] text-muted-foreground">
          {t('toolUi.webSearch.truncated')}
        </p>
      ) : null}
    </div>
  );
}

export default WebSearch;
