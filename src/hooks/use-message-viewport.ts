import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

type Item = { key: string; index: number };
const ROW_GAP = 16;
const ESTIMATED_HEIGHT = 200;
const EMPTY_HEIGHTS = new Map<string, number>();

export function measureMessageWindow<T extends Item>(items: T[], heights: Map<string, number>, top: number, height: number, maxRows: number) {
  const offsets: number[] = [];
  let total = 0;
  for (const item of items) { offsets.push(total); total += (heights.get(item.key) ?? ESTIMATED_HEIGHT) + ROW_GAP; }
  const cap = Math.max(1, Math.floor(maxRows));
  const position = Math.max(0, Math.min(Number.isFinite(top) ? top : total, Math.max(0, total - height)));
  let first = 0;
  while (first + 1 < items.length && offsets[first + 1] <= position) first++;
  let last = first;
  while (last + 1 < items.length && offsets[last + 1] < position + height) last++;
  const start = items.length <= cap ? 0 : Math.max(0, first - Math.min(4, Math.floor(cap / 4)));
  const end = items.length <= cap ? items.length : Math.min(items.length, start + cap, last + 5);
  return { rows: items.slice(start, end), offsets, total, first, start, end };
}

/** Measured rows share the existing scroller and sticky-bottom owner. */
export function useMessageViewport<T extends Item>(items: T[], getScrollElement: () => HTMLElement | null, sessionKey: string, maxRows: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((node: HTMLDivElement | null) => { listRef.current = node; setListElement(node); }, []);
  const [measurements, setMeasurements] = useState({ sessionKey, heights: new Map<string, number>(), width: 0 });
  const [view, setView] = useState({ top: Infinity, height: 800 });
  const layout = useMemo(() => measureMessageWindow(items, measurements.sessionKey === sessionKey ? measurements.heights : EMPTY_HEIGHTS, view.top, view.height, maxRows),
    [items, view, maxRows, measurements, sessionKey]);
  const current = useRef({ items, layout, sessionKey });
  const anchor = useRef<{ sessionKey: string; key?: string; offset: number; pinned: boolean } | undefined>(undefined);
  const restore = useRef<typeof anchor.current>(undefined);
  const pendingJump = useRef<string | undefined>(undefined);
  const observer = useRef<ResizeObserver | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const frame = useRef<number | undefined>(undefined);
  const origin = useCallback(() => {
    const container = getScrollElement();
    return container && listRef.current ? listRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop : 0;
  }, [getScrollElement]);
  const sync = useCallback(() => {
    const container = getScrollElement();
    if (!container) return;
    const top = Math.max(0, container.scrollTop - origin());
    const { items: rows, layout: latest, sessionKey: session } = current.current;
    let first = 0;
    while (first + 1 < rows.length && latest.offsets[first + 1] <= top) first++;
    anchor.current = { sessionKey: session, key: rows[first]?.key, offset: top - (latest.offsets[first] ?? 0),
      pinned: container.scrollHeight - container.scrollTop - container.clientHeight <= 8 };
    setView(previous => previous.top === top && previous.height === container.clientHeight ? previous : { top, height: container.clientHeight });
  }, [getScrollElement, origin]);
  const schedule = useCallback(() => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => { frame.current = undefined; sync(); });
  }, [sync]);
  const measure = useCallback((node: HTMLElement | null) => {
    const key = node?.dataset.viewportKey;
    if (!node || !key) return;
    const previous = elements.current.get(key);
    if (previous) observer.current?.unobserve(previous);
    elements.current.set(key, node); observer.current?.observe(node);
  }, []);

  useLayoutEffect(() => {
    const container = getScrollElement();
    if (!container || !listRef.current) return;
    const resize = new ResizeObserver(entries => {
      const width = listRef.current?.clientWidth ?? 0;
      restore.current = anchor.current;
      setMeasurements(data => {
        const reset = sessionKey !== data.sessionKey || (width > 0 && width !== data.width);
        const heights = reset ? new Map<string, number>() : new Map(data.heights);
        let changed = reset;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.viewportKey;
          if (!key) continue;
          const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
          if (height > 0 && Math.abs((heights.get(key) ?? ESTIMATED_HEIGHT) - height) > 0.5) {
            heights.set(key, height); changed = true;
          }
        }
        const known = new Set(current.current.items.map(item => item.key));
        for (const key of heights.keys()) if (!known.has(key)) heights.delete(key);
        return changed ? { sessionKey, width, heights } : data;
      });
    });
    observer.current = resize;
    resize.observe(container); resize.observe(listRef.current);
    elements.current.forEach(node => resize.observe(node));
    container.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      resize.disconnect(); observer.current = null;
      container.removeEventListener('scroll', schedule);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [getScrollElement, sessionKey, sync, schedule, listElement]);

  useLayoutEffect(() => {
    const prior = current.current;
    const container = getScrollElement();
    const saved = restore.current ?? (prior.items !== items ? anchor.current : undefined);
    current.current = { items, layout, sessionKey };
    restore.current = undefined;
    for (const [key, node] of elements.current) {
      if (!node.isConnected) { observer.current?.unobserve(node); elements.current.delete(key); }
    }
    if (!container) return;
    const jump = pendingJump.current;
    if (jump) {
      const index = items.findIndex(item => item.key === jump);
      if (index >= 0) container.scrollTo({ top: Math.max(0, origin() + layout.offsets[index] - 20), behavior: 'instant' });
      if (elements.current.has(jump)) pendingJump.current = undefined;
    } else if (saved?.sessionKey === sessionKey) {
      const index = items.findIndex(item => item.key === saved.key);
      if (saved.pinned) container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
      else if (index >= 0) container.scrollTo({ top: origin() + layout.offsets[index] + saved.offset, behavior: 'instant' });
    }
    schedule();
  }, [items, layout, sessionKey, getScrollElement, origin, schedule]);

  const scrollToIndex = useCallback((messageIndex: number) => {
    const container = getScrollElement(); const latest = current.current;
    const position = latest.items.findIndex(item => item.index === messageIndex);
    if (!container || position < 0) return;
    pendingJump.current = latest.items[position].key;
    container.scrollTo({ top: Math.max(0, origin() + latest.layout.offsets[position] - 20), behavior: 'instant' });
    sync();
  }, [getScrollElement, origin, sync]);

  return { ...layout, attachList, measure, scrollToIndex, firstVisibleIndex: items[layout.first]?.index };
}
