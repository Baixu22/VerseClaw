import { useCallback, useEffect, useRef, type AnimationEvent, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { OverlayPortalProvider } from './overlay-portal';

export type AppleDrawerSize = 'compact' | 'regular' | 'wide';
export type AppleDrawerDragMode = 'handle' | 'none';

export interface AppleDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened?: () => void;
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
  onOpened,
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
  const portalHostRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const closeTimerRef = useRef<number | null>(null);
  const openedNotifiedRef = useRef(false);
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
  const notifyOpened = useCallback(() => {
    if (openedNotifiedRef.current) return;
    openedNotifiedRef.current = true;
    onOpened?.();
  }, [onOpened]);
  const handleAnimationEnd = useCallback((nextOpen: boolean) => {
    if (!nextOpen) notifyClosed();
  }, [notifyClosed]);
  const handleContentAnimationEnd = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget
      && event.animationName === 'apple-drawer-slide-from-right'
    ) {
      notifyOpened();
    }
  }, [notifyOpened]);

  useEffect(() => {
    if (open) {
      openedNotifiedRef.current = false;
      closedNotifiedRef.current = false;
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }

    closeTimerRef.current = window.setTimeout(notifyClosed, reduceMotion ? 100 : 220);
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
          className="apple-drawer-overlay fixed inset-x-0 bottom-0 top-10 z-[60] bg-black/24 dark:bg-black/60"
        />
        <Drawer.Content
          data-testid={testId}
          onAnimationEnd={handleContentAnimationEnd}
          className={cn(
            'apple-drawer-content fixed bottom-0 right-0 top-10 z-[70] flex outline-none',
            'overflow-hidden rounded-l-[20px] border-l border-white/70 bg-surface-modal',
            'shadow-[0_24px_80px_rgba(15,23,42,0.22),0_2px_12px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.68)]',
            'dark:border-white/10 dark:bg-surface-modal',
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
            <OverlayPortalProvider container={portalHostRef}>
              {children}
            </OverlayPortalProvider>
            <div
              ref={portalHostRef}
              className="pointer-events-none absolute inset-0 z-[95] [&>*]:pointer-events-auto"
              data-testid={testId ? `${testId}-portal-host` : undefined}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
