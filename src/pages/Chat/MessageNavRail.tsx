/** Proximity turn navigation adapted from Rare UI Proximity Sidebar.
 * Copyright (c) 2026 Swami Malode. See components/rareui/LICENSE. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type MessageNavRailItem = { index: number; ordinal: number; title: string; response?: string; completedAt?: number };
export const MESSAGE_NAV_RAIL_MIN_ITEMS = 4;
export const MESSAGE_NAV_RAIL_MIN_WIDTH = 300;

function Mark({ item, active, mouseY, onSelect }: {
  item: MessageNavRailItem; active: boolean; mouseY: MotionValue<number>; onSelect: () => void;
}) {
  const { t } = useTranslation('chat');
  const button = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const scaleX = useTransform(mouseY, (y) => {
    const rect = button.current?.getBoundingClientRect();
    const proximity = rect ? Math.max(0, 1 - Math.abs(y - rect.top - rect.height / 2) / 70) : 0;
    return reduced ? (active ? 0.8 : 0.5) : Math.max(active ? 0.8 : 0.5, 0.5 + proximity * 0.5);
  });
  return (
    <Tooltip delayDuration={180}>
      <TooltipTrigger asChild>
        <button ref={button} type="button" className="rare-turn-rail__button"
          data-testid={`chat-message-nav-rail-item-${item.index}`} data-nav-index={item.index}
          data-active={active} aria-current={active ? 'location' : undefined}
          aria-label={t('messageNav.jumpTo', { ordinal: item.ordinal })} onClick={onSelect}>
          <motion.span className="rare-turn-rail__mark" aria-hidden="true" style={{ scaleX }} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" collisionPadding={12} className="max-w-[280px]">
        <div className="space-y-2 py-1 text-xs" data-testid={`turn-preview-${item.index}`}>
          <p className="font-medium leading-5 text-foreground">{item.title}</p>
          {item.response && <p className="border-t border-border pt-2 leading-5 text-muted-foreground">{item.response}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function MessageNavRail({ items, scrollRef, onSelect, firstVisibleIndex }: {
  items: MessageNavRailItem[]; scrollRef: React.RefObject<HTMLElement | null>;
  onSelect?: (index: number) => void;
  firstVisibleIndex?: number;
}) {
  const { t } = useTranslation('chat');
  const railRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [fits, setFits] = useState(true);
  const mouseY = useMotionValue(Infinity);
  const reduced = useReducedMotion();
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
      <div ref={railRef} className="rare-turn-rail__marks"
        onPointerMove={(event) => mouseY.set(event.clientY)} onPointerLeave={() => mouseY.set(Infinity)}>
        {items.map((item) => <Mark key={item.index} item={item} active={item.index === activeIndex} mouseY={mouseY}
          onSelect={() => {
            if (onSelect) { onSelect(item.index); setActiveIndex(item.index); return; }
            const scroller = scrollRef.current;
            const anchor = scroller?.querySelector<HTMLElement>(`#chat-message-${item.index}`);
            if (!scroller || !anchor) return;
            scroller.scrollTo({ top: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 20, behavior: reduced ? 'instant' : 'smooth' });
            setActiveIndex(item.index);
          }} />)}
      </div>
    </nav>
  );
}
