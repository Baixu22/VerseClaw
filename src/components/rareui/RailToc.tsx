/** Adapted from Rare UI Rail TOC. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export type RailTocItem = { id: string; label: string; depth: number };
type Point = { x: number; y: number };

function buildPath(points: Point[]) {
  if (!points.length) return '';
  let path = `M${points[0].x} 0 L${points[0].x} ${points[0].y}`;
  points.slice(1).forEach((to, index) => {
    const from = points[index];
    if (from.x !== to.x) path += ` L${from.x} ${from.y + (to.y - from.y) * 0.3} L${to.x} ${to.y - (to.y - from.y) * 0.3}`;
    path += ` L${to.x} ${to.y}`;
  });
  return path;
}

export function RailToc({ items, activeIndex, onSelect, title }: {
  items: RailTocItem[];
  activeIndex: number;
  onSelect: (item: RailTocItem) => void;
  title: string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setPoints(items.map((item, index) => {
      const row = element.querySelectorAll<HTMLElement>('li')[index];
      return { x: 5 + item.depth * 12, y: row ? row.offsetTop + row.offsetHeight / 2 : index * 30 + 15 };
    }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items]);
  const at = points[activeIndex];
  return (
    <nav data-slot="rail-toc" aria-label={title} className="rare-rail-toc">
      <p className="mb-2 text-xs font-medium text-foreground">{title}</p>
      <div className="relative">
      <svg aria-hidden="true" className="rare-rail-toc__track">
        <path d={buildPath(points)} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" />
        <path d={buildPath(points.slice(0, activeIndex + 1))} fill="none" className="text-foreground/60" stroke="currentColor" strokeWidth="1.2" />
        {points.map((point, index) => <circle key={items[index]?.id} cx={point.x} cy={point.y} r="2.5" stroke="currentColor" strokeWidth="1" className={index <= activeIndex ? 'fill-foreground/50' : 'fill-surface-modal'} />)}
      </svg>
      <ol ref={list} className="rare-rail-toc__list">
        {items.map((item, index) => (
          <li key={item.id} className="rare-rail-toc__item">
            <button type="button" aria-current={index === activeIndex ? 'location' : undefined}
              style={{ paddingLeft: 22 + item.depth * 12 }} onClick={() => onSelect(item)}>{item.label}</button>
          </li>
        ))}
      </ol>
      {at && <motion.svg className="rare-rail-toc__plane" aria-hidden="true" viewBox="0 0 24 24"
        initial={false} animate={{ x: at.x, y: at.y }} transition={{ duration: reduced ? 0 : 0.16 }}>
        <path d="M12 2 20.5 21 12 17.5 3.5 21Z" fill="currentColor" />
      </motion.svg>}
      </div>
    </nav>
  );
}
