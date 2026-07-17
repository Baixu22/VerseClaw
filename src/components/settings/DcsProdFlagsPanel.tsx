import { useMemo, useState } from 'react';
import { BookOpen, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  DCS_PROD_FLAGS,
  type DcsProdFlagEntry,
  type DcsProdFlagRisk,
} from '@shared/dcs/prod-flags-catalog';

function riskTone(risk: DcsProdFlagRisk): string {
  switch (risk) {
    case 'baseline-on':
      return 'border-emerald-500/20 text-emerald-700 dark:text-emerald-400';
    case 'shadow-only':
      return 'border-sky-500/20 text-sky-700 dark:text-sky-400';
    case 'api-only':
    case 'request-only':
      return 'border-violet-500/20 text-violet-700 dark:text-violet-400';
    case 'opt-in':
    default:
      return 'border-amber-500/30 text-amber-700 dark:text-amber-400';
  }
}

function FlagRow({
  entry,
  selected,
  onSelect,
}: {
  entry: DcsProdFlagEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`settings-dcs-prod-flag-${entry.id}`}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-black/15 bg-black/5 dark:border-white/20 dark:bg-white/10'
          : 'border-black/10 bg-surface-modal hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{entry.key}</span>
        <Badge variant="outline" className={cn('text-tiny font-normal', riskTone(entry.risk))}>
          {t(`developer.dcsProdFlags.risk.${entry.risk}`)}
        </Badge>
        <Badge variant="outline" className="text-tiny font-normal text-muted-foreground">
          {entry.wave}
        </Badge>
      </div>
      <p className="mt-1 text-meta text-muted-foreground">
        {t('developer.dcsProdFlags.defaultLabel')}: {entry.defaultDisplay}
      </p>
    </button>
  );
}

export function DcsProdFlagsPanel() {
  const { t } = useTranslation('settings');
  const [selectedId, setSelectedId] = useState(DCS_PROD_FLAGS[0]?.id ?? '');
  const selected = useMemo(
    () => DCS_PROD_FLAGS.find((f) => f.id === selectedId) ?? DCS_PROD_FLAGS[0],
    [selectedId],
  );

  return (
    <div
      className="space-y-4 rounded-lg border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
      data-testid="settings-dcs-prod-flags"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Shield className="h-4 w-4" />
            {t('developer.dcsProdFlags.title')}
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">{t('developer.dcsProdFlags.description')}</p>
        </div>
        <Badge
          variant="outline"
          className="w-fit border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
          data-testid="settings-dcs-prod-flags-mode"
        >
          {t('developer.dcsProdFlags.modeOptIn')}
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2" data-testid="settings-dcs-prod-flags-list">
          {DCS_PROD_FLAGS.map((entry) => (
            <FlagRow
              key={entry.id}
              entry={entry}
              selected={entry.id === selected?.id}
              onSelect={() => setSelectedId(entry.id)}
            />
          ))}
        </div>

        {selected && (
          <div
            className="space-y-3 rounded-lg border border-black/10 bg-surface-modal p-4 dark:border-white/10"
            data-testid="settings-dcs-prod-flags-detail"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <BookOpen className="h-4 w-4" />
              {selected.key}
            </div>
            <div className="space-y-2 text-meta text-muted-foreground">
              <p>
                <span className="font-medium text-foreground/80">{t('developer.dcsProdFlags.defaultLabel')}: </span>
                {selected.defaultDisplay}
              </p>
              <p>
                <span className="font-medium text-foreground/80">{t('developer.dcsProdFlags.enableLabel')}: </span>
                {selected.enable}
              </p>
              <p>
                <span className="font-medium text-foreground/80">{t('developer.dcsProdFlags.rollbackLabel')}: </span>
                {selected.rollback}
              </p>
              <p>
                <span className="font-medium text-foreground/80">{t('developer.dcsProdFlags.riskLabel')}: </span>
                {selected.riskNote}
              </p>
            </div>
            <p className="text-tiny text-muted-foreground">{t('developer.dcsProdFlags.readOnlyNote')}</p>
          </div>
        )}
      </div>
    </div>
  );
}