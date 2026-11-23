import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Circle, CircleAlert, FolderGit2, Loader2, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type WorktreeCreationProgressState = {
  stage: 'saving' | 'creating' | 'opening';
  branch: string;
  path?: string;
  error?: string;
  stay: boolean;
  onStay: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

export function WorktreeCreationProgress({ progress, hero = false }: { progress: WorktreeCreationProgressState; hero?: boolean }) {
  const { t } = useTranslation('settings', { keyPrefix: 'storage.creation' });
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { action.current?.focus({ preventScroll: true }); }, [progress.error]);
  const stages = ['saving', 'creating', 'opening'] as const;
  const index = stages.indexOf(progress.stage);
  return <div className={cn('codex-composer-host mx-auto w-full max-w-[768px] px-4 pb-5 pt-2', hero && 'codex-composer-host--hero')}>
    <div className="worktree-progress-title"><FolderGit2 aria-hidden="true" /><span>{t('title')}</span><span className="ml-auto truncate text-xs">{progress.branch}</span></div>
    <section className="codex-composer-shell worktree-progress-card" data-testid="worktree-creation-progress" data-stage={progress.stage}
      data-failed={Boolean(progress.error)} role={progress.error ? 'alert' : 'status'} aria-live="polite" aria-busy={!progress.error}>
      <ol className="worktree-progress-stages">
        {stages.map((stage, position) => {
          const skipped = stage === 'opening' && progress.stay;
          const done = position < index;
          const active = position === index && !skipped;
          const Icon = skipped ? Minus : done ? Check : active ? progress.error ? CircleAlert : Loader2 : Circle;
          return <li key={stage} aria-current={active ? 'step' : undefined} data-complete={done} data-pending={!done && !active}
            data-error={active && Boolean(progress.error)}>
            <Icon className={cn(active && !progress.error && 'motion-safe:animate-spin')} aria-hidden="true" />
            <span>{t(stage)}</span>
          </li>;
        })}
      </ol>
      {progress.error && <p className="worktree-progress-error">{progress.error}</p>}
      {expanded && <dl id={detailsId} className="worktree-progress-details">
        <dt>{t('branch')}</dt><dd>{progress.branch}</dd>
        {progress.path && <><dt>{t('directory')}</dt><dd>{progress.path}</dd></>}
      </dl>}
      <footer className="worktree-progress-footer">
        <button type="button" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} onClick={() => setExpanded(!expanded)}>
          <ChevronRight className={cn(expanded && 'rotate-90')} aria-hidden="true" />{t('details')}
        </button>
        <div className="ml-auto flex items-center gap-1">
          {progress.error ? <>
            <button type="button" onClick={progress.onDismiss} data-testid="worktree-creation-dismiss">{t('return')}</button>
            <button type="button" ref={action} className="worktree-progress-primary" onClick={progress.onRetry} data-testid="worktree-creation-retry">{t(progress.path ? 'open' : 'retry')}</button>
          </> : <button type="button" ref={action} onClick={progress.onStay} disabled={progress.stay || progress.stage === 'opening'} data-testid="worktree-creation-stay">
            {t(progress.stay ? 'staying' : 'stay')}
          </button>}
        </div>
      </footer>
    </section>
  </div>;
}
