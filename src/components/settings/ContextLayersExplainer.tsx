import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';

/**
 * TASK-P0-05: honest map of the CVK shell versus DCS. VToken is an internal
 * pack strategy and intentionally has no independent user control.
 * Display-only — does not enable features.
 */
export function ContextLayersExplainer() {
  const { t } = useTranslation('settings');
  return (
    <div
      className="space-y-3 rounded-lg border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]"
      data-testid="settings-context-layers-explainer"
    >
      <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Layers className="h-4 w-4" />
        {t('developer.contextLayers.title')}
      </Label>
      <div className="space-y-3 text-meta text-muted-foreground">
        <div data-testid="settings-context-layers-cvk">
          <p className="font-medium text-foreground/90">{t('developer.contextLayers.cvkTitle')}</p>
          <p className="mt-1">{t('developer.contextLayers.cvkBody')}</p>
        </div>
        <div data-testid="settings-context-layers-dcs">
          <p className="font-medium text-foreground/90">{t('developer.contextLayers.dcsTitle')}</p>
          <p className="mt-1">{t('developer.contextLayers.dcsBody')}</p>
        </div>
      </div>
    </div>
  );
}
