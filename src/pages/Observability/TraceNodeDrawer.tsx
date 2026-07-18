import type { ReactNode } from 'react';
import { LocateFixed, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppleDrawer } from '@/components/ui/apple-drawer';

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

  return (
    <AppleDrawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      title={title}
      description={subtitle}
      size="compact"
      dragMode="none"
      className="!w-[min(420px,calc(100vw-16px))]"
      testId="observability-detail-panel"
      overlayTestId="trace-drawer-overlay"
    >
          <aside className="flex h-full min-w-0 flex-col">
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
          </aside>
    </AppleDrawer>
  );
}
