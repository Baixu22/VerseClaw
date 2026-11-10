import { useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

type Props = HTMLMotionProps<'div'> & { open: boolean; align?: 'left' | 'right'; inline?: boolean };

/** The composer's small menus share the add menu's blur/slide, including exit. */
export function ComposerPopover({ open, ...props }: Props) {
  return <AnimatePresence>{open && <Surface {...props} />}</AnimatePresence>;
}

function Surface({ align = 'left', inline = false, className, children, style, ...props }: Omit<Props, 'open'>) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (inline) return;
    const panel = ref.current;
    const anchor = panel?.parentElement;
    if (!panel || !anchor) return;
    // Keep the entire menu reachable in both the centered welcome composer and
    // the bottom conversation composer, without moving the surrounding layout.
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const column = anchor.closest('[data-testid="chat-conversation-column"]');
      const bounds = column?.getBoundingClientRect();
      const toolbar = column?.querySelector('[data-testid="chat-toolbar-shell"]')?.getBoundingClientRect();
      const top = Math.max(8, (toolbar?.bottom ?? bounds?.top ?? 0) + 8);
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 8;
      const above = Math.max(0, rect.top - top - 8);
      const below = Math.max(0, bottom - rect.bottom - 8);
      const side = above >= Math.min(panel.scrollHeight, 260) || above >= below ? 'top' : 'bottom';
      panel.dataset.side = side;
      panel.style.maxHeight = `${side === 'top' ? above : below}px`;
      panel.style.bottom = side === 'top' ? 'calc(100% + 8px)' : 'auto';
      panel.style.top = side === 'bottom' ? 'calc(100% + 8px)' : 'auto';
      const desiredLeft = align === 'right' ? rect.right - panel.offsetWidth : rect.left;
      const left = Math.max((bounds?.left ?? 0) + 8, Math.min(desiredLeft, (bounds?.right ?? window.innerWidth) - panel.offsetWidth - 8));
      panel.style.left = `${left - rect.left}px`;
      panel.style.right = 'auto';
      panel.style.transformOrigin = `${align} ${side === 'top' ? 'bottom' : 'top'}`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    observer.observe(panel);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [align, inline]);

  return (
    <motion.div
      {...props}
      ref={ref}
      style={inline ? { ...style, position: 'relative', top: 'auto', bottom: 'auto', left: 0, width: '100%', minWidth: 0, maxHeight: '50vh' } : style}
      className={cn('codex-composer-menu codex-composer-popover', className)}
      data-state={present ? 'open' : 'closed'}
      inert={!present}
      aria-hidden={!present || undefined}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 10, scale: reducedMotion ? 1 : 0.97, filter: reducedMotion ? 'none' : 'blur(2px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: reducedMotion ? 'none' : 'blur(0px)', transitionEnd: { filter: 'none' } }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : 10, scale: reducedMotion ? 1 : 0.97, filter: reducedMotion ? 'none' : 'blur(2px)', transition: { duration: reducedMotion ? 0 : 0.16 } }}
      transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1], opacity: { duration: reducedMotion ? 0 : 0.16 }, filter: { duration: reducedMotion ? 0 : 0.16 } }}
    >
      {children}
    </motion.div>
  );
}
