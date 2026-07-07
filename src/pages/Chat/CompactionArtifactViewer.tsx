import { GitBranchPlus, RotateCcw, ShieldCheck } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CompressionArtifact, CompressionEvidenceRef, CompressionFact } from '@/lib/host-api';
import { cn } from '@/lib/utils';

type CompactionArtifactViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionKey?: string | null;
  checkpointId?: string | null;
  artifact?: CompressionArtifact | null;
  warnings?: string[];
  onPrepareRecovery?: () => void;
  onForkSession?: () => void;
  prepareRecoveryBusy?: boolean;
  forkBusy?: boolean;
};

function percent(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function collectWarnings(artifact?: CompressionArtifact | null, extraWarnings: string[] = []): string[] {
  const values = [
    ...(artifact?.warnings ?? []),
    ...(artifact?.quality?.warnings ?? []),
    ...extraWarnings,
  ];
  return [...new Set(values.map((warning) => warning.trim()).filter(Boolean))];
}

function evidenceLabel(ref: CompressionEvidenceRef): string {
  return ref.label?.trim() || ref.ref;
}

function FactList({
  facts,
  emptyLabel,
  testId,
}: {
  facts: CompressionFact[];
  emptyLabel: string;
  testId?: string;
}) {
  if (facts.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2" data-testid={testId}>
      {facts.map((fact, index) => (
        <li
          key={`${fact.text}-${index}`}
          className="rounded-md border border-black/10 bg-surface-input px-3 py-2 text-sm dark:border-white/10"
        >
          <p className="leading-relaxed text-foreground">{fact.text}</p>
          {fact.evidenceRefs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {fact.evidenceRefs.map((ref, refIndex) => (
                <span
                  key={`${ref.type}-${ref.ref}-${refIndex}`}
                  className="rounded-sm bg-black/5 px-1.5 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10"
                >
                  {evidenceLabel(ref)}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function StringList({
  items,
  emptyLabel,
  danger,
}: {
  items: string[];
  emptyLabel: string;
  danger?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className={cn(
            'rounded-md border px-3 py-2 text-sm leading-relaxed',
            danger
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'border-black/10 bg-surface-input text-foreground dark:border-white/10',
          )}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function CompactionArtifactViewer({
  open,
  onOpenChange,
  sessionKey,
  checkpointId,
  artifact,
  warnings = [],
  onPrepareRecovery,
  onForkSession,
  prepareRecoveryBusy = false,
  forkBusy = false,
}: CompactionArtifactViewerProps) {
  const { t } = useTranslation('chat');
  const allWarnings = useMemo(() => collectWarnings(artifact, warnings), [artifact, warnings]);
  const quality = artifact?.quality;
  const summaryFacts = artifact
    ? [
      ...artifact.done,
      ...artifact.inProgress,
      ...artifact.blocked,
      ...artifact.decisions,
      ...artifact.filesTouched,
      ...artifact.testsRun,
      ...artifact.failedAttempts,
      ...artifact.deviations,
    ].slice(0, 8)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden rounded-lg border border-black/10 bg-surface-modal p-0 shadow-xl dark:border-white/10"
        data-testid="chat-compaction-artifact-viewer"
      >
        <div className="border-b border-black/10 px-5 py-4 dark:border-white/10">
          <DialogTitle className="flex items-center gap-2 font-serif text-xl font-normal tracking-tight text-foreground">
            <ShieldCheck className="h-5 w-5 text-green-700 dark:text-green-400" />
            {t('composer.compaction.artifactViewer.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('composer.compaction.artifactViewer.description')}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!artifact && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              {t('composer.compaction.artifactViewer.empty')}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md bg-surface-input px-3 py-2">
              <p className="text-xs text-muted-foreground">{t('composer.compaction.artifactViewer.identifiers')}</p>
              <div className="mt-1 space-y-1 text-sm font-medium text-foreground">
                {sessionKey && <p>{t('composer.compaction.artifactViewer.sessionKey', { sessionKey })}</p>}
                {checkpointId && <p>{t('composer.compaction.artifactViewer.checkpointId', { checkpointId })}</p>}
              </div>
            </div>
            <div className="rounded-md bg-surface-input px-3 py-2">
              <p className="text-xs text-muted-foreground">{t('composer.compaction.artifactViewer.quality')}</p>
              <div className="mt-1 space-y-1 text-sm font-medium text-foreground">
                <p>{t('composer.compaction.artifactViewer.qualityScore', { score: percent(quality?.score) })}</p>
                <p className="text-xs font-normal text-muted-foreground">
                  {t('composer.compaction.artifactViewer.qualityCoverage', {
                    evidence: percent(quality?.evidenceCoverage),
                    fields: percent(quality?.fieldCoverage),
                    tokens: quality?.projectionTokens ?? 0,
                  })}
                </p>
              </div>
            </div>
          </div>

          <Section title={t('composer.compaction.artifactViewer.objective')}>
            <p className="rounded-md bg-surface-input px-3 py-2 text-sm leading-relaxed text-foreground">
              {artifact?.objective || t('composer.compaction.artifactViewer.empty')}
            </p>
          </Section>

          <Section title={t('composer.compaction.artifactViewer.currentState')}>
            <p className="rounded-md bg-surface-input px-3 py-2 text-sm leading-relaxed text-foreground">
              {artifact?.currentState || t('composer.compaction.artifactViewer.empty')}
            </p>
          </Section>

          <Section title={t('composer.compaction.artifactViewer.summary')}>
            <FactList
              facts={summaryFacts}
              emptyLabel={t('composer.compaction.artifactViewer.empty')}
              testId="chat-compaction-artifact-summary"
            />
          </Section>

          <Section title={t('composer.compaction.artifactViewer.warnings')}>
            <StringList
              items={allWarnings}
              emptyLabel={t('composer.compaction.artifactViewer.noWarnings')}
              danger
            />
          </Section>

          <Section title={t('composer.compaction.artifactViewer.unverifiedClaims')}>
            <StringList
              items={artifact?.unverifiedClaims ?? []}
              emptyLabel={t('composer.compaction.artifactViewer.noUnverifiedClaims')}
              danger
            />
          </Section>

          <Section title={t('composer.compaction.artifactViewer.reviewNeeded')}>
            <FactList
              facts={artifact?.reviewNeeded ?? []}
              emptyLabel={t('composer.compaction.artifactViewer.noReviewNeeded')}
            />
          </Section>
        </div>

        <div className="flex flex-col gap-2 border-t border-black/10 px-5 py-4 dark:border-white/10 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('composer.compaction.artifactViewer.close')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onPrepareRecovery}
            disabled={!onPrepareRecovery || prepareRecoveryBusy}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('composer.compaction.artifactViewer.prepareRecovery')}
          </Button>
          <Button
            type="button"
            onClick={onForkSession}
            disabled={!onForkSession || forkBusy}
          >
            <GitBranchPlus className="mr-2 h-4 w-4" />
            {t('composer.compaction.artifactViewer.forkSession')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { CompactionArtifactViewerProps };
