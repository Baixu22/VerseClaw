import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LocateFixed, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TraceNodeDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  statusIcon?: ReactNode;
  onCenterSelected?: () => void;
  children: ReactNode;
}

export function TraceNodeDrawer({
  open,
  onClose,
  title,
  subtitle,
  statusIcon,
  onCenterSelected,
  children,
}: TraceNodeDrawerProps) {
  const { t } = useTranslation('observability');
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/15 backdrop-blur-[1px] dark:bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={onClose}
            data-testid="trace-drawer-overlay"
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-full w-[min(420px,calc(100vw-16px))] flex-col border-l border-black/10 bg-surface-modal shadow-xl dark:border-white/10"
            initial={{ x: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 1 : 0.98 }}
            animate={{ x: 0 }}
            exit={{ x: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 1 : 0.98 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            data-testid="observability-detail-panel"
          >
            <div className="flex min-h-14 items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
              <div className="flex min-w-0 items-center gap-2">
                {statusIcon}
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium">{title}</h3>
                  {subtitle && <p className="truncate text-2xs text-muted-foreground">{subtitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {onCenterSelected && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onCenterSelected}
                    title={t('graph.centerSelected')}
                    data-testid="trace-drawer-locate"
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onClose}
                  title={t('drawer.close')}
                  data-testid="trace-drawer-close"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className={cn('min-h-0 flex-1 overflow-hidden')}>{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
