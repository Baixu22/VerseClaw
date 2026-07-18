import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { OverlayPortalProvider } from './overlay-portal';

export type AppleDrawerSize = 'compact' | 'regular' | 'wide';
export type AppleDrawerDragMode = 'handle' | 'none';

export interface AppleDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed?: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: AppleDrawerSize;
  dragMode?: AppleDrawerDragMode;
  children: ReactNode;
  className?: string;
  testId?: string;
  overlayTestId?: string;
}

const sizeClasses: Record<AppleDrawerSize, string> = {
  compact: 'w-[min(560px,calc(100vw-24px))]',
  regular: 'w-[min(760px,calc(100vw-24px))]',
  wide: 'w-[min(980px,calc(100vw-24px))]',
};

export function AppleDrawer({
  open,
  onOpenChange,
  onClosed,
  title,
  description,
  size = 'regular',
  dragMode = 'handle',
  children,
  className,
  testId,
  overlayTestId,
}: AppleDrawerProps) {
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const closeTimerRef = useRef<number | null>(null);
  const closedNotifiedRef = useRef(false);
  const notifyClosed = useCallback(() => {
    if (closedNotifiedRef.current) return;
    closedNotifiedRef.current = true;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    onClosed?.();
  }, [onClosed]);
  const handleAnimationEnd = useCallback((nextOpen: boolean) => {
    if (!nextOpen) notifyClosed();
  }, [notifyClosed]);

  useEffect(() => {
    if (open) {
      closedNotifiedRef.current = false;
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }

    closeTimerRef.current = window.setTimeout(notifyClosed, reduceMotion ? 160 : 420);
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [notifyClosed, open, reduceMotion]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      onAnimationEnd={handleAnimationEnd}
      direction="right"
      modal
      handleOnly={dragMode === 'handle'}
      dismissible
      shouldScaleBackground={false}
      preventScrollRestoration
      autoFocus
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Overlay
          data-testid={overlayTestId ?? (testId ? `${testId}-overlay` : undefined)}
          className="apple-drawer-overlay fixed inset-x-0 bottom-0 top-10 z-[60] bg-black/16 backdrop-blur-[3px] dark:bg-black/55"
        />
        <Drawer.Content
          data-testid={testId}
          className={cn(
            'apple-drawer-content fixed bottom-0 right-0 top-10 z-[70] flex outline-none',
            'overflow-hidden rounded-l-[20px] border-l border-white/70 bg-surface-modal/96',
            'shadow-[0_24px_80px_rgba(15,23,42,0.22),0_2px_12px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.68)]',
            'backdrop-blur-[24px] backdrop-saturate-[1.28] dark:border-white/10 dark:bg-surface-modal/90',
            sizeClasses[size],
            className,
          )}
        >
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          {description ? <Drawer.Description className="sr-only">{description}</Drawer.Description> : null}
          {dragMode === 'handle' ? (
            <div className="absolute inset-y-0 left-0 z-20 flex w-11 -translate-x-1/2 items-center justify-center">
              <Drawer.Handle
                preventCycle
                className="!m-0 !h-9 !w-1 !rounded-full !bg-foreground/20 transition-[opacity,background-color] duration-150 hover:!bg-foreground/35"
              />
            </div>
          ) : null}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <OverlayPortalProvider container={portalHost}>
              {children}
            </OverlayPortalProvider>
            <div
              ref={setPortalHost}
              className="pointer-events-none absolute inset-0 z-[95] [&>*]:pointer-events-auto"
              data-testid={testId ? `${testId}-portal-host` : undefined}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
