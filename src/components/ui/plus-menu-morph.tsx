import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PlusMenuMorphItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  testId?: string;
};

export type PlusMenuMorphProps = {
  items: PlusMenuMorphItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  triggerLabel?: string;
  disabled?: boolean;
  triggerTestId?: string;
  containerTestId?: string;
};

const MORPH_TOKENS = {
  openDur: '300ms',
  closeDur: '220ms',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
  closeEase: 'cubic-bezier(0.22, 1, 0.36, 1)',
  rClosed: 999,
  rOpen: 15,
  fadeDur: '160ms',
  slide: 10,
  rotate: 45,
  scale: 0.97,
  blur: 2,
} as const;

function PlusMenuMorph({
  items,
  open: openProp,
  onOpenChange,
  className,
  triggerLabel = 'Open menu',
  disabled = false,
  triggerTestId,
  containerTestId,
}: PlusMenuMorphProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenInternal(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [panelSize, setPanelSize] = useState({ width: 156, height: 44 });

  // The reference demo has a fixed card. The composer has translated labels
  // and an optional model row, so measure the real action list instead.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const measure = () => {
      const next = {
        width: Math.ceil(menu.offsetWidth),
        height: Math.ceil(menu.offsetHeight),
      };
      setPanelSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen(!open);
  }, [disabled, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const tokens: Record<string, string> = {
    '--pm-open-dur': MORPH_TOKENS.openDur,
    '--pm-close-dur': MORPH_TOKENS.closeDur,
    '--pm-ease': MORPH_TOKENS.ease,
    '--pm-close-ease': MORPH_TOKENS.closeEase,
    '--pm-r-closed': `${MORPH_TOKENS.rClosed}px`,
    '--pm-r-open': `${MORPH_TOKENS.rOpen}px`,
    '--pm-fade-dur': MORPH_TOKENS.fadeDur,
    '--pm-slide': `${MORPH_TOKENS.slide}px`,
    '--pm-rotate': `${MORPH_TOKENS.rotate}deg`,
    '--pm-scale': String(MORPH_TOKENS.scale),
    '--pm-blur': `${MORPH_TOKENS.blur}px`,
    '--pm-open-width': `${panelSize.width}px`,
    '--pm-open-height': `${panelSize.height}px`,
  };

  return (
    <span className="pm-morph-slot" data-testid={`${containerTestId ?? 'pm-morph'}-slot`}>
      <div
        ref={rootRef}
        className={cn('pm-morph', className)}
        style={tokens}
        data-open={open ? 'true' : 'false'}
        data-direction="up-left"
        data-testid={containerTestId}
      >
        <div ref={menuRef} className="pm-morph-menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid={item.testId}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon && <span className="pm-morph-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="pm-morph-plus"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : triggerLabel}
          disabled={disabled}
          data-testid={triggerTestId}
          onClick={toggle}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </span>
  );
}

export { PlusMenuMorph };
