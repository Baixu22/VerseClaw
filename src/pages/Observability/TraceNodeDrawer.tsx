import { useRef, useState, type ReactNode } from 'react';
import { List, LocateFixed, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppleDrawer } from '@/components/ui/apple-drawer';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

const primaryDetails = ['summary', 'issues', 'events'];
const allDetails = [...primaryDetails, 'io', 'artifacts', 'compare', 'annotation', 'attributes', 'timeline', 'score'];

export function TraceDetailTabs({ children }: { children: ReactNode }) {
  const { t } = useTranslation('observability');
  const [tab, setTab] = useState('summary');
  const [shortcut, setShortcut] = useState('io');
  const [menuOpen, setMenuOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const pickedFromMenu = useRef(false);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <div className="observability-detail-bar flex shrink-0 items-center gap-1 border-b border-border px-2">
        <TabsList ref={list} aria-label={t('tabs.details')} data-testid="observability-detail-tabs"
          className="observability-detail-tabs h-10 min-w-0 flex-1 justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent p-0">
          {[...primaryDetails, shortcut].map(value => (
            <TabsTrigger key={value} value={value} className="observability-detail-tab h-10 shrink-0 rounded-none px-2"
              onFocus={event => {
                const tab = event.currentTarget;
                requestAnimationFrame(() => {
                  const strip = tab.closest<HTMLElement>('[role="tablist"]');
                  if (!strip) return;
                  const item = tab.getBoundingClientRect();
                  const bounds = strip.getBoundingClientRect();
                  if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
                  else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
                });
              }}>
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <Select value={tab} open={menuOpen} onOpenChange={setMenuOpen} onValueChange={value => {
          pickedFromMenu.current = true;
          if (!primaryDetails.includes(value)) setShortcut(value);
          setTab(value);
        }}>
          <SelectTrigger size="sm" aria-label={t('tabs.all')} title={t('tabs.all')} data-testid="observability-all-detail-tabs"
            className="h-8 w-auto shrink-0 gap-0.5 border-0 bg-transparent px-1.5 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
            <List className="observability-all-tabs-icon size-4" aria-hidden="true" />
            <span className="observability-all-tabs-label">{t('tabs.all')}</span>
          </SelectTrigger>
          <SelectContent align="end" collisionPadding={8} onEscapeKeyDown={event => {
            event.preventDefault();
            setMenuOpen(false);
          }} onCloseAutoFocus={event => {
            if (!pickedFromMenu.current) return;
            pickedFromMenu.current = false;
            event.preventDefault();
            list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
          }}>
            {allDetails.map(value => <SelectItem key={value} value={value}>{t(`tabs.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {children}
    </Tabs>
  );
}

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
      onEscapeKeyDown={event => {
        if (event.target instanceof Element && event.target.closest('[role="listbox"]')) event.preventDefault();
      }}
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
