import { Loader2, Save, Sparkles, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  KnowledgeArtifactType,
  KnowledgeSourceSet,
  KnowledgeSourceRef,
} from '@/lib/host-api';
import { cn } from '@/lib/utils';

const QUIET_BUTTON_CLASS = 'h-9 rounded-lg border border-border/60 bg-transparent px-3 text-meta font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';

const STUDIO_ARTIFACTS: Array<{ type: KnowledgeArtifactType; labelKey: string }> = [
  { type: 'summary', labelKey: 'studio.summary' },
  { type: 'faq', labelKey: 'studio.faq' },
  { type: 'decision-memo', labelKey: 'studio.decisionMemo' },
  { type: 'troubleshooting-recipe', labelKey: 'studio.troubleshootingRecipe' },
];

export type KnowledgeSourceSetStudioProps = {
  sourceSetTitle: string;
  onSourceSetTitleChange: (value: string) => void;
  currentSourceRefs: KnowledgeSourceRef[];
  sourceSets: KnowledgeSourceSet[];
  onSelectSourceSet: (sourceSet: KnowledgeSourceSet) => void;
  onClearCurrentSourceSet: () => void;
  onSaveCurrentSourceSet: () => void;
  semanticEnabled: boolean;
  onSemanticEnabledChange: (enabled: boolean) => void;
  busy: boolean;
  running: string | null;
  onCreateArtifact: (artifactType: KnowledgeArtifactType, label: string) => void;
};

export function KnowledgeSourceSetStudio({
  sourceSetTitle,
  onSourceSetTitleChange,
  currentSourceRefs,
  sourceSets,
  onSelectSourceSet,
  onClearCurrentSourceSet,
  onSaveCurrentSourceSet,
  semanticEnabled,
  onSemanticEnabledChange,
  busy,
  running,
  onCreateArtifact,
}: KnowledgeSourceSetStudioProps) {
  const { t } = useTranslation('knowledge');

  return (
    <>
      <section className="space-y-3" data-testid="knowledge-source-set-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('sourceSet.title')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('sourceSet.count', { count: currentSourceRefs.length })}</p>
          </div>
          <Button type="button" variant="ghost" className="h-8 rounded-md px-2 text-xs" onClick={onClearCurrentSourceSet} disabled={currentSourceRefs.length === 0} data-testid="knowledge-source-set-clear">
            {t('sourceSet.clear')}
          </Button>
        </div>
        <Input value={sourceSetTitle} onChange={(event) => onSourceSetTitleChange(event.target.value)} placeholder={t('sourceSet.titlePlaceholder')} className="h-9 bg-surface-input text-sm shadow-none" data-testid="knowledge-source-set-title" />
        {currentSourceRefs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-black/10 p-3 text-xs leading-5 text-muted-foreground dark:border-white/10">{t('sourceSet.empty')}</p>
        ) : (
          <div className="space-y-1.5">
            {currentSourceRefs.map((ref) => (
              <div key={ref.id} className="rounded-md bg-black/5 px-2.5 py-2 text-xs dark:bg-white/10" data-testid="knowledge-source-set-ref">
                <span className="block truncate font-medium">{ref.label || ref.id}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{ref.path || ref.id}</span>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="outline" className={cn(QUIET_BUTTON_CLASS, 'w-full')} onClick={onSaveCurrentSourceSet} disabled={busy || currentSourceRefs.length === 0} data-testid="knowledge-source-set-save">
          {running === 'sourceSetSave' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          {t('sourceSet.save')}
        </Button>
        <div className="flex items-center justify-between gap-3">
          <button type="button" className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5" onClick={() => onSemanticEnabledChange(!semanticEnabled)} aria-pressed={semanticEnabled} data-testid="knowledge-source-set-semantic-toggle">
            <span className={cn('flex h-4 w-7 items-center rounded-full border transition-colors', semanticEnabled ? 'border-primary/40 bg-primary/20' : 'border-border/60 bg-black/5 dark:bg-white/10')}>
              <span className={cn('ml-0.5 h-3 w-3 rounded-full bg-background shadow-sm transition-transform', semanticEnabled && 'translate-x-3')} />
            </span>
            {t('sourceSet.semanticToggle')}
          </button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">{t('sourceSet.answerBoundary')}</p>
      </section>

      {sourceSets.length > 0 ? (
        <section className="space-y-2 border-t border-border/60 pt-4">
          <h3 className="text-sm font-semibold">{t('sourceSet.savedSets')}</h3>
          <div className="grid gap-1.5">
            {sourceSets.map((sourceSet) => (
              <button key={sourceSet.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5" onClick={() => onSelectSourceSet(sourceSet)} data-testid="knowledge-source-set-saved">
                <span className="min-w-0 flex-1 truncate font-medium">{sourceSet.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{sourceSet.sourceRefs.length}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 border-t border-border/60 pt-4" data-testid="knowledge-studio-actions">
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">{t('studio.title')}</h3></div>
        <div className="grid grid-cols-2 gap-2">
          {STUDIO_ARTIFACTS.map((artifact) => {
            const label = t(artifact.labelKey);
            return (
              <Button key={artifact.type} type="button" variant="outline" className="h-9 rounded-md px-2 text-xs shadow-none" onClick={() => onCreateArtifact(artifact.type, label)} disabled={busy || currentSourceRefs.length === 0} data-testid={`knowledge-studio-artifact-${artifact.type}`}>
                {running === `studio:${artifact.type}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
                <span className="truncate">{label}</span>
              </Button>
            );
          })}
        </div>
      </section>
    </>
  );
}
