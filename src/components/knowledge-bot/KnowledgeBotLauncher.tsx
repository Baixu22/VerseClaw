import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { KnowledgeBot } from './KnowledgeBot';

const STORAGE_KEY = 'clawx.knowledge.bot-position.v1';
type Position = { x: number; y: number };
const SIZE = 88;
const RADIUS = 112;

function bounds() {
  const page = document.querySelector('[data-testid="knowledge-page"]')?.getBoundingClientRect();
  return { left: Math.max(12, (page?.left ?? 0) + 12), top: Math.max(52, (page?.top ?? 40) + 12),
    right: window.innerWidth - SIZE - 12, bottom: window.innerHeight - SIZE - 12 };
}
function clamp(position: Position): Position {
  const b = bounds();
  return { x: Math.max(b.left, Math.min(b.right, position.x)), y: Math.max(b.top, Math.min(b.bottom, position.y)) };
}
function dock(): Position {
  return clamp({ x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 20 });
}
function distance(position: Position): number {
  const anchor = dock();
  return Math.hypot(position.x - anchor.x, position.y - anchor.y);
}
function constrain(position: Position): Position {
  const anchor = dock();
  const radius = RADIUS + 18;
  const length = distance(position);
  return clamp(length <= radius ? position : { x: anchor.x + (position.x - anchor.x) * radius / length, y: anchor.y + (position.y - anchor.y) * radius / length });
}
function restore(): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) && distance(value) <= RADIUS ? clamp(value) : null;
  } catch { return null; }
}

export function KnowledgeBotLauncher({ onOpen, hidden = false }: { onOpen: () => void; hidden?: boolean }) {
  const { t } = useTranslation('knowledge');
  const [position, setPosition] = useState<Position | null>(restore);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [tilt, setTilt] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const springBack = useRef<Animation | null>(null);
  const reveal = useRef<Animation | null>(null);
  const gesture = useRef<{ id: number; start: Position; origin: Position; lastX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const wasHidden = useRef(hidden);

  useLayoutEffect(() => {
    if (wasHidden.current && !hidden) buttonRef.current?.focus({ preventScroll: true });
    wasHidden.current = hidden;
  }, [hidden]);

  useEffect(() => {
    reveal.current?.cancel();
    if (hidden || !buttonRef.current?.animate) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    reveal.current = buttonRef.current.animate([
      { opacity: .2, transform: reduced ? 'none' : 'translateY(6px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: reduced ? 80 : 140, easing: 'ease-out' });
    return () => reveal.current?.cancel();
  }, [hidden]);

  useEffect(() => {
    const resize = () => setPosition((value) => value && distance(value) <= RADIUS ? clamp(value) : null);
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); springBack.current?.cancel(); };
  }, []);

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false); setTilt(0);
    suppressClick.current = cancel || current.moved;
    if (cancel) setPosition(current.origin);
    else if (current.moved) {
      const released = { x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y };
      const outside = distance(released) > RADIUS;
      const next = outside ? dock() : clamp(released);
      const visible = event.currentTarget.getBoundingClientRect();
      setPosition(next);
      if (outside && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        springBack.current = event.currentTarget.animate([
          { transform: `translate(${visible.x - next.x}px, ${visible.y - next.y}px)` },
          { transform: 'translate(0, 0)' },
        ], { duration: 300, easing: 'cubic-bezier(.22,1.3,.36,1)' });
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Position is optional UI state. */ }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <Tooltip open={dragging ? false : undefined}>
    <TooltipTrigger asChild>
      <button ref={buttonRef} hidden={hidden} type="button" className="knowledge-bot-launcher" data-testid="knowledge-librarian-open"
        data-dragging={dragging} aria-label={t('librarian.openAssistant')} aria-describedby="knowledge-bot-drag-hint"
        style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          springBack.current?.cancel();
          reveal.current?.cancel();
          suppressClick.current = false;
          const rect = event.currentTarget.getBoundingClientRect();
          gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: rect.x, y: rect.y }, lastX: event.clientX, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.id !== event.pointerId) return;
          const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
          if (!current.moved && Math.hypot(dx, dy) < 6) return;
          current.moved = true;
          setDragging(true);
          setTilt(Math.max(-16, Math.min(16, (event.clientX - current.lastX) * .6)));
          current.lastX = event.clientX;
          setPosition(constrain({ x: current.origin.x + dx, y: current.origin.y + dy }));
        }}
        onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)}
        onLostPointerCapture={(event) => finishDrag(event, true)}
        onClick={(event) => {
          if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
          onOpen();
        }}>
        <span className="knowledge-bot-launcher__body" style={{ '--bot-tilt': `${tilt}deg` } as CSSProperties}>
          <KnowledgeBot size={SIZE} state={dragging ? 'dragging' : hovered ? 'curious' : 'idle'} follow />
        </span>
        <span className="sr-only" id="knowledge-bot-drag-hint">{t('librarian.bot.dragHint')}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent>{t('librarian.bot.dragHint')}</TooltipContent>
  </Tooltip>;
}
