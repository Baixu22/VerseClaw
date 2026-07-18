import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AppleDrawer } from '@/components/ui/apple-drawer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MaterialSurface, SettingsGroup, SettingsRow, WorkbenchPageShell } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {materials.map(([level, label]) => level === 'canvas' ? (
            <div key={level} data-material-level={level} className="min-h-28 rounded-xl border border-border bg-material-canvas p-4 shadow-sm">
              <span className="text-sm font-semibold">{label}</span>
            </div>
          ) : (
            <MaterialSurface key={level} level={level} data-material-level={level} className="min-h-28 rounded-xl p-4">
              <span className="text-sm font-semibold">{label}</span>
            </MaterialSurface>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('common:uiV2Showcase.controls')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="panel">{t('common:uiV2Showcase.panel')}</SelectItem>
                  <SelectItem value="elevated">{t('common:uiV2Showcase.elevated')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="ui-v2-showcase-open-dialog" onClick={() => setDialogOpen(true)}>{t('common:uiV2Showcase.openDialog')}</Button>
              <Button data-testid="ui-v2-showcase-open-drawer" variant="outline" onClick={() => setDrawerOpen(true)}>{t('common:uiV2Showcase.openDrawer')}</Button>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('common:uiV2Showcase.controls')} />
              <span className="text-xs text-muted-foreground">
                {reduceMotion ? t('common:uiV2Showcase.motionReduced') : t('common:uiV2Showcase.motionNormal')}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('common:uiV2Showcase.feedback')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {[
              [CheckCircle2, 'success', 'text-green-700 dark:text-green-400', 'bg-green-500/10 border-green-500/20'],
              [AlertTriangle, 'warning', 'text-yellow-700 dark:text-yellow-400', 'bg-yellow-500/10 border-yellow-500/20'],
              [XCircle, 'error', 'text-red-700 dark:text-red-400', 'bg-red-500/10 border-red-500/20'],
              [Loader2, 'loading', 'text-primary', 'bg-primary/10 border-primary/20'],
            ].map(([Icon, key, iconClass, surfaceClass]) => (
              <div key={String(key)} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', String(surfaceClass))}>
                <Icon className={cn('h-4 w-4', String(iconClass), key === 'loading' && 'animate-spin motion-reduce:animate-none')} />
                {t(`common:uiV2Showcase.${String(key)}`)}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-[18px] border-white/60 bg-material-elevated/96 p-6 backdrop-blur-[22px] dark:border-white/10">
          <DialogTitle>{t('common:uiV2Showcase.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('common:uiV2Showcase.dialogDescription')}</DialogDescription>
        </DialogContent>
      </Dialog>

      <AppleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={t('common:uiV2Showcase.drawerTitle')}
        description={t('common:uiV2Showcase.drawerDescription')}
        size="compact"
        dragMode="handle"
        testId="ui-v2-showcase-drawer"
      >
        <div className="h-full overflow-y-auto p-6">
          <h2 className="text-xl font-semibold">{t('common:uiV2Showcase.drawerTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('common:uiV2Showcase.drawerDescription')}</p>
          <SettingsGroup title={t('common:uiV2Showcase.controls')}>
            <SettingsRow title={t('common:uiV2Showcase.control')} control={<Switch checked={enabled} onCheckedChange={setEnabled} />} />
          </SettingsGroup>
        </div>
      </AppleDrawer>
    </WorkbenchPageShell>
  );
}
