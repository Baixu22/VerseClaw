import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
            className="fixed inset-0 z-40 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            data-testid="trace-drawer-overlay"
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col border-l border-black/10 bg-background shadow-xl dark:border-white/10"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            data-testid="observability-detail-panel"
          >
            <div className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
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
