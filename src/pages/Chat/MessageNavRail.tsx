/** Proximity turn navigation adapted from Rare UI Proximity Sidebar.
 * Copyright (c) 2026 Swami Malode. See components/rareui/LICENSE. */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark } from 'lucide-react';
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';

export type MessageNavRailItem = { id?: string; index: number; ordinal: number; title: string; response?: string; completedAt?: number };
export const MESSAGE_NAV_RAIL_MIN_ITEMS = 4;
export const MESSAGE_NAV_RAIL_MIN_WIDTH = 300;

function readBookmarks(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

function Mark({ item, active, mouseY, onSelect, bookmarked, onBookmark }: {
  item: MessageNavRailItem; active: boolean; mouseY: MotionValue<number>; onSelect: () => void;
  bookmarked: boolean; onBookmark: () => void;
}) {
  const { t } = useTranslation('chat');
  const { triggerRef: button, layerRef, open, setOpen, style } = usePopover<HTMLButtonElement>({ preferredSide: 'right', fixedWidth: 288, gap: 8 });
  const portal = useOverlayPortalContainer();
  const previewId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  const close = () => { cancel(); timer.current = setTimeout(() => setOpen(false), 150); };
  const show = () => { cancel(); setOpen(true); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useDismissOnOutside({ open, onDismiss: () => setOpen(false),
    onEscape: () => { button.current?.focus(); setOpen(false); }, refs: [button, layerRef] });
  const reduced = useReducedMotion();
  const scaleX = useTransform(mouseY, (y) => {
    const rect = button.current?.getBoundingClientRect();
    const proximity = rect ? Math.max(0, 1 - Math.abs(y - rect.top - rect.height / 2) / 70) : 0;
    return reduced ? (active ? 0.8 : 0.5) : Math.max(active ? 0.8 : 0.5, 0.5 + proximity * 0.5);
  });
  return (
    <>
        <button ref={button} type="button" className="rare-turn-rail__button"
          data-testid={`chat-message-nav-rail-item-${item.index}`} data-nav-index={item.index}
          data-bookmarked={bookmarked}
          data-active={active} aria-current={active ? 'location' : undefined}
          aria-label={t('messageNav.jumpTo', { ordinal: item.ordinal })}
          aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? previewId : undefined}
          onPointerEnter={() => { cancel(); timer.current = setTimeout(() => setOpen(true), 160); }}
          onPointerLeave={close} onFocus={show}
          onBlur={event => { if (!layerRef.current?.contains(event.relatedTarget)) close(); }}
          onKeyDown={event => {
            if ((event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) && open) {
              event.preventDefault(); layerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
            }
          }}
          onClick={() => { onSelect(); setOpen(false); }}>
          {bookmarked ? <Bookmark aria-hidden="true" className="rare-turn-rail__bookmark" />
            : <motion.span className="rare-turn-rail__mark" aria-hidden="true" style={{ scaleX }} />}
        </button>
      {open && createPortal(
        <div ref={layerRef} id={previewId} role="dialog" aria-label={t('messageNav.preview', { ordinal: item.ordinal })}
          style={style} className="rare-turn-preview" data-testid={`turn-preview-${item.index}`}
          onPointerEnter={show} onPointerLeave={close}
          onFocus={show} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== button.current) close(); }}
          onKeyDown={event => {
            if (event.key === 'Tab') {
              event.preventDefault(); setOpen(false);
              if (!event.shiftKey && button.current?.nextElementSibling instanceof HTMLButtonElement) button.current.nextElementSibling.focus();
              else button.current?.focus();
              setOpen(false);
            }
          }}>
          <button className="rare-turn-preview__bookmark" type="button"
            aria-pressed={bookmarked} disabled={!item.id}
            aria-label={t(bookmarked ? 'messageNav.removeBookmark' : 'messageNav.addBookmark')}
            onClick={onBookmark}>
            <Bookmark aria-hidden="true" className="h-4 w-4" fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
          <p className="pr-7 font-medium leading-5 text-foreground">{item.title}</p>
          {item.response && <p className="border-t border-border pt-2 leading-5 text-muted-foreground">{item.response}</p>}
        </div>, portal ?? document.body)}
    </>
  );
}

export function MessageNavRail({ items, scrollRef, onSelect, firstVisibleIndex, scopeKey = 'preview' }: {
  items: MessageNavRailItem[]; scrollRef: React.RefObject<HTMLElement | null>;
  onSelect?: (index: number) => void;
  firstVisibleIndex?: number;
  scopeKey?: string;
}) {
  const { t } = useTranslation('chat');
  const railRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [fits, setFits] = useState(true);
  const mouseY = useMotionValue(Infinity);
  const reduced = useReducedMotion();
  const storageKey = `verse-turn-bookmarks-v1:${scopeKey}`;
  const [bookmarks, setBookmarks] = useState(() => readBookmarks(storageKey));
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === storageKey) setBookmarks(readBookmarks(storageKey)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
  const bookmarkedItems = items.filter(item => item.id && bookmarks.includes(item.id));
  const select = (item: MessageNavRailItem) => {
    if (onSelect) onSelect(item.index);
    else {
      const scroller = scrollRef.current;
      const anchor = scroller?.querySelector<HTMLElement>(`#chat-message-${item.index}`);
      if (!scroller || !anchor) return;
      scroller.scrollTo({ top: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 20, behavior: reduced ? 'instant' : 'smooth' });
    }
    setActiveIndex(item.index);
  };
  const sync = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (scroller.clientWidth > 0) setFits(scroller.clientWidth >= MESSAGE_NAV_RAIL_MIN_WIDTH);
    const readingLine = scroller.getBoundingClientRect().top + 60;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
    let current = items[0]?.index ?? null;
    for (const item of items) {
      if (firstVisibleIndex !== undefined) {
        if (item.index <= firstVisibleIndex) current = item.index;
        continue;
      }
      const anchor = scroller.querySelector<HTMLElement>(`#chat-message-${item.index}`);
      if (anchor && anchor.getBoundingClientRect().top <= readingLine) current = item.index;
    }
    setActiveIndex(atBottom ? items.at(-1)?.index ?? current : current);
  }, [items, scrollRef, firstVisibleIndex]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const frame = requestAnimationFrame(sync);
    const resize = new ResizeObserver(sync);
    resize.observe(scroller);
    scroller.addEventListener('scroll', sync, { passive: true });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); scroller.removeEventListener('scroll', sync); };
  }, [sync, scrollRef]);
  useEffect(() => {
    const list = railRef.current;
    const mark = list?.querySelector<HTMLElement>(`[data-nav-index="${activeIndex}"]`);
    if (!list || !mark) return;
    if (mark.offsetTop < list.scrollTop) list.scrollTop = mark.offsetTop;
    else if (mark.offsetTop + mark.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = mark.offsetTop + mark.offsetHeight - list.clientHeight;
  }, [activeIndex]);
  if (items.length < MESSAGE_NAV_RAIL_MIN_ITEMS || !fits) return null;
  return (
    <nav data-testid="chat-message-nav-rail" data-slot="proximity-sidebar" aria-label={t('messageNav.label')} className="rare-turn-rail">
      {bookmarkedItems.length > 0 && <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="rare-turn-rail__next" data-testid="chat-message-nav-next-bookmark"
            aria-label={t('messageNav.nextBookmark')} onClick={() => select(bookmarkedItems.find(item => item.index > (activeIndex ?? -1)) ?? bookmarkedItems[0])}>
            <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('messageNav.nextBookmark')}</TooltipContent>
      </Tooltip>}
      <div ref={railRef} className="rare-turn-rail__marks"
        onPointerMove={(event) => mouseY.set(event.clientY)} onPointerLeave={() => mouseY.set(Infinity)}>
        {items.map((item) => <Mark key={item.id ?? item.index} item={item} active={item.index === activeIndex} mouseY={mouseY}
          bookmarked={!!item.id && bookmarks.includes(item.id)}
          onBookmark={() => {
            if (!item.id) return;
            const saved = readBookmarks(storageKey);
            const next = saved.includes(item.id) ? saved.filter(id => id !== item.id) : [...saved, item.id];
            setBookmarks(next);
            try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the mark for this visit when storage is unavailable. */ }
          }}
          onSelect={() => select(item)} />)}
      </div>
    </nav>
  );
}
