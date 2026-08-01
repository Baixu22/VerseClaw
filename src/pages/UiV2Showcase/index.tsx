import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CalendarDays, FileText, Inbox, PenLine, Settings } from '@/components/icons/codex-icons';
import { AppleDrawer } from '@/components/ui/apple-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MaterialSurface, SettingsGroup, SettingsRow, WorkbenchPageShell } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';

export function UiV2Showcase() {
  const { t } = useTranslation(['common', 'settings']);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const reduceMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(true);
  const [segment, setSegment] = useState('first');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const materials = [
    ['canvas', t('common:uiV2Showcase.canvas')],
    ['sidebar', t('common:uiV2Showcase.sidebar')],
    ['panel', t('common:uiV2Showcase.panel')],
    ['elevated', t('common:uiV2Showcase.elevated')],
    ['control', t('common:uiV2Showcase.control')],
  ] as const;

  return (
    <WorkbenchPageShell
      title={t('common:uiV2Showcase.title')}
      description={t('common:uiV2Showcase.description')}
      testId="ui-v2-showcase"
      actions={(
        <div className="flex rounded-[10px] border border-border bg-material-control/70 p-0.5">
          {(['light', 'dark', 'system'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="ghost"
              data-testid={`ui-v2-theme-${value}`}
              className={cn('h-7 px-2.5 text-xs', theme === value && 'bg-material-elevated shadow-sm')}
              onClick={() => setTheme(value)}
            >
              {t(`settings:appearance.${value}`)}
            </Button>
          ))}
        </div>
      )}
    >
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">{t('common:uiV2Showcase.materials')}</h2>
        <div className="grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 xl:grid-cols-5">
          {materials.map(([level, label]) => level === 'canvas' ? (
            <div key={level} data-material-level={level} className="min-h-20 border-b border-r border-border bg-material-canvas p-3">
              <span className="text-[13px] font-medium">{label}</span>
            </div>
          ) : (
            <MaterialSurface key={level} level={level} data-material-level={level} className="min-h-20 border-b border-r p-3">
              <span className="text-[13px] font-medium">{label}</span>
            </MaterialSurface>
          ))}
        </div>
      </section>

      <div className="grid border-y border-border lg:grid-cols-[1.2fr_0.8fr] lg:divide-x lg:divide-border">
        <section className="space-y-4 py-4 lg:pr-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-medium">{t('common:uiV2Showcase.controls')}</h2>
              <div data-testid="ui-v2-showcase-codex-icons" className="flex items-center gap-1 text-muted-foreground">
                <PenLine aria-hidden="true" className="h-4 w-4" />
                <Inbox aria-hidden="true" className="h-4 w-4" />
                <CalendarDays aria-hidden="true" className="h-4 w-4" />
                <FileText aria-hidden="true" className="h-4 w-4" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      data-testid="ui-v2-showcase-tooltip-trigger"
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={t('common:uiV2Showcase.control')}
                    >
                      <Settings aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent data-testid="ui-v2-showcase-tooltip">
                    {t('common:uiV2Showcase.control')}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex w-fit rounded-[10px] bg-material-control/80 p-0.5" aria-label={t('common:uiV2Showcase.segmented')}>
              {['first', 'second', 'third'].map((value, index) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn('h-7 min-w-16 text-xs', segment === value && 'bg-material-elevated shadow-sm')}
                  onClick={() => setSegment(value)}
                >
                  {index + 1}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder={t('common:uiV2Showcase.sampleInput')} />
              <Select defaultValue="panel">
                <SelectTrigger data-testid="ui-v2-showcase-select"><SelectValue /></SelectTrigger>
                <SelectContent data-testid="ui-v2-showcase-select-menu">
                  <SelectItem value="panel">{t('common:uiV2Showcase.panel')}</SelectItem>
                  <SelectItem value="elevated">{t('common:uiV2Showcase.elevated')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card data-testid="ui-v2-showcase-card" className="shadow-none">
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 p-3">
                <div className="min-w-0">
                  <CardTitle>{t('common:uiV2Showcase.controls')}</CardTitle>
                  <CardDescription>{t('common:uiV2Showcase.dialogDescription')}</CardDescription>
                </div>
                <Badge data-testid="ui-v2-showcase-default-badge">
                  {t('common:uiV2Showcase.feedback')}
                </Badge>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0">
                <Textarea data-testid="ui-v2-showcase-textarea" placeholder={t('common:uiV2Showcase.sampleInput')} />
              </CardContent>
            </Card>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="ui-v2-showcase-open-dialog" onClick={() => setDialogOpen(true)}>{t('common:uiV2Showcase.openDialog')}</Button>
              <Button data-testid="ui-v2-showcase-open-drawer" variant="outline" onClick={() => setDrawerOpen(true)}>{t('common:uiV2Showcase.openDrawer')}</Button>
              <Button data-testid="ui-v2-showcase-open-sheet" variant="ghost" onClick={() => setSheetOpen(true)}>{t('common:uiV2Showcase.openSheet')}</Button>
              <Switch data-testid="ui-v2-showcase-switch" checked={enabled} onCheckedChange={setEnabled} aria-label={t('common:uiV2Showcase.controls')} />
              <span className="text-xs text-muted-foreground">
                {reduceMotion ? t('common:uiV2Showcase.motionReduced') : t('common:uiV2Showcase.motionNormal')}
              </span>
            </div>
        </section>

        <section className="grid content-start gap-2 py-4 lg:pl-5">
          <h2 className="mb-1 text-[15px] font-medium">{t('common:uiV2Showcase.feedback')}</h2>
          <div data-testid="ui-v2-showcase-badges" className="divide-y divide-border border-y border-border">
            <div className="flex min-h-9 items-center gap-2 px-2 py-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" />
              <Badge variant="success">{t('common:uiV2Showcase.success')}</Badge>
            </div>
            <div className="flex min-h-9 items-center gap-2 px-2 py-1.5">
              <AlertTriangle className="h-4 w-4 text-yellow-700 dark:text-yellow-400" />
              <Badge variant="warning">{t('common:uiV2Showcase.warning')}</Badge>
            </div>
            <div className="flex min-h-9 items-center gap-2 px-2 py-1.5">
              <XCircle className="h-4 w-4 text-red-700 dark:text-red-400" />
              <Badge variant="destructive">{t('common:uiV2Showcase.error')}</Badge>
            </div>
            <div className="flex min-h-9 items-center gap-2 px-2 py-1.5">
              <Loader2 className="h-4 w-4 animate-spin text-blue-700 motion-reduce:animate-none dark:text-blue-400" />
              <Badge variant="outline" className="border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400">
                {t('common:uiV2Showcase.loading')}
              </Badge>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-lg border-border bg-material-elevated p-5">
          <DialogTitle>{t('common:uiV2Showcase.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('common:uiV2Showcase.dialogDescription')}</DialogDescription>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent data-testid="ui-v2-showcase-sheet" side="right" className="w-[min(380px,calc(100vw-24px))]">
          <SheetHeader>
            <SheetTitle>{t('common:uiV2Showcase.drawerTitle')}</SheetTitle>
            <SheetDescription>{t('common:uiV2Showcase.drawerDescription')}</SheetDescription>
          </SheetHeader>
          <SheetFooter className="mt-5">
            <SheetClose asChild>
              <Button variant="outline">{t('common:actions.close')}</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AppleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={t('common:uiV2Showcase.drawerTitle')}
        description={t('common:uiV2Showcase.drawerDescription')}
        size="compact"
        dragMode="handle"
        testId="ui-v2-showcase-drawer"
      >
        <div className="h-full overflow-y-auto p-5">
          <h2 className="text-lg font-normal tracking-normal">{t('common:uiV2Showcase.drawerTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('common:uiV2Showcase.drawerDescription')}</p>
          <SettingsGroup title={t('common:uiV2Showcase.controls')}>
            <SettingsRow title={t('common:uiV2Showcase.control')} control={<Switch checked={enabled} onCheckedChange={setEnabled} />} />
          </SettingsGroup>
        </div>
      </AppleDrawer>
    </WorkbenchPageShell>
  );
}
