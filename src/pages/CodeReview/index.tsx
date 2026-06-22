import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Files,
  GitBranch,
  GitCommit,
  Loader2,
  PlusCircle,
  ShieldCheck,
} from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { CodeReviewFinding, CodeReviewRun, CodeReviewTarget } from '@shared/types/code-review';
import type { GitBranch as GitBranchInfo } from '@shared/types/git';

type TargetKind = CodeReviewTarget['kind'];

const targetIcons: Record<TargetKind, ReactNode> = {
  uncommitted: <Files className="h-4 w-4" />,
  baseBranch: <GitBranch className="h-4 w-4" />,
  commit: <GitCommit className="h-4 w-4" />,
};

const severityClass: Record<CodeReviewFinding['severity'], string> = {
  critical: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400',
  high: 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  medium: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  low: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  info: 'border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400',
};

function targetPayload(kind: TargetKind, baseBranch: string, commit: string): CodeReviewTarget {
  if (kind === 'baseBranch') return { kind, baseBranch: baseBranch.trim() };
  if (kind === 'commit') return { kind, commit: commit.trim() };
  return { kind: 'uncommitted' };
}

function defaultBaseBranch(branches: GitBranchInfo[]): string {
  return branches.find((branch) => !branch.current && /^(origin\/)?main$/.test(branch.name))?.name
    ?? branches.find((branch) => !branch.current && /^(origin\/)?master$/.test(branch.name))?.name
    ?? branches.find((branch) => !branch.current)?.name
    ?? '';
}

export default function CodeReviewPage() {
  const { t } = useTranslation('codeReview');
  const [targetKind, setTargetKind] = useState<TargetKind>('uncommitted');
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [baseBranch, setBaseBranch] = useState('');
  const [commit, setCommit] = useState('');
  const [focus, setFocus] = useState('');
  const [review, setReview] = useState<CodeReviewRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [creatingNodeId, setCreatingNodeId] = useState<string | null>(null);
  const [createdNodeIds, setCreatedNodeIds] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void hostApi.git.branches()
      .then((result) => {
        if (cancelled || !result.success) return;
        setBranches(result.branches);
        setBaseBranch((current) => current || defaultBaseBranch(result.branches));
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const branchOptions = useMemo(
    () => branches.map((branch) => branch.upstream ?? branch.name),
    [branches],
  );

  const handleRunReview = async () => {
    setError(null);
    setReview(null);
    setCreatedNodeIds({});
    if (targetKind === 'baseBranch' && !baseBranch.trim()) {
      setError(t('errors.baseBranchRequired'));
      return;
    }
    if (targetKind === 'commit' && !commit.trim()) {
      setError(t('errors.commitRequired'));
      return;
    }

    setRunning(true);
    try {
      const result = await hostApi.codeReview.run({
        target: targetPayload(targetKind, baseBranch, commit),
        focus: focus.trim() || undefined,
      });
      setReview(result.review);
      if (!result.success) {
        setError(result.error ?? result.review.error ?? t('errors.reviewFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleCreateNode = async (findingId?: string) => {
    if (!review) return;
    const key = findingId ?? 'review';
    setCreatingNodeId(key);
    setError(null);
    try {
      const result = await hostApi.codeReview.createTaskLedgerNode({
        runId: review.runId,
        findingId,
      });
      if (result.success) {
        setCreatedNodeIds((current) => ({ ...current, [key]: result.nodeId }));
      } else {
        setError(result.error ?? t('errors.ledgerFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingNodeId(null);
    }
  };

  const hasFindings = Boolean(review?.findings.length);

  return (
    <div data-testid="code-review-page" className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border/60 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">
              {t('title')}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
          <div
            data-testid="code-review-readonly"
            className="inline-flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{t('readonly')}</span>
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="border-b border-border/60 p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium text-foreground">{t('target.label')}</label>
              <div className="mt-2 grid gap-2" data-testid="code-review-targets">
                {(['uncommitted', 'baseBranch', 'commit'] as TargetKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    data-testid={`code-review-target-${kind}`}
                    onClick={() => setTargetKind(kind)}
                    className={cn(
                      'flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      targetKind === kind
                        ? 'border-foreground/20 bg-black/5 text-foreground dark:bg-white/10'
                        : 'border-border bg-surface-modal text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5',
                    )}
                  >
                    {targetIcons[kind]}
                    <span>{t(`target.${kind}`)}</span>
                  </button>
                ))}
              </div>
            </div>

            {targetKind === 'baseBranch' && (
              <div>
                <label htmlFor="code-review-base" className="text-sm font-medium text-foreground">
                  {t('target.baseBranchInput')}
                </label>
                <input
                  id="code-review-base"
                  data-testid="code-review-base-input"
                  list="code-review-branches"
                  value={baseBranch}
                  onChange={(event) => setBaseBranch(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
                  placeholder={t('target.baseBranchPlaceholder')}
                />
                <datalist id="code-review-branches">
                  {branchOptions.map((branch) => (
                    <option key={branch} value={branch} />
                  ))}
                </datalist>
              </div>
            )}

            {targetKind === 'commit' && (
              <div>
                <label htmlFor="code-review-commit" className="text-sm font-medium text-foreground">
                  {t('target.commitInput')}
                </label>
                <input
                  id="code-review-commit"
                  data-testid="code-review-commit-input"
                  value={commit}
                  onChange={(event) => setCommit(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
                  placeholder={t('target.commitPlaceholder')}
                />
              </div>
            )}

            <div>
              <label htmlFor="code-review-focus" className="text-sm font-medium text-foreground">
                {t('focus.label')}
              </label>
              <textarea
                id="code-review-focus"
                data-testid="code-review-focus"
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                rows={5}
                className="mt-2 w-full resize-none rounded-md border border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-foreground/30"
                placeholder={t('focus.placeholder')}
              />
            </div>

            <button
              type="button"
              data-testid="code-review-run"
              onClick={() => void handleRunReview()}
              disabled={running}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              <span>{running ? t('actions.running') : t('actions.run')}</span>
            </button>
          </div>
        </section>

        <section className="min-h-0 overflow-auto p-4">
          {error && (
            <div
              data-testid="code-review-error"
              className="mb-4 flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!review && !running && (
            <div className="flex min-h-[360px] items-center justify-center rounded-md border border-dashed border-border bg-surface-modal">
              <p className="max-w-sm px-4 text-center text-sm text-muted-foreground">
                {t('empty')}
              </p>
            </div>
          )}

          {running && (
            <div className="flex min-h-[360px] items-center justify-center rounded-md border border-border bg-surface-modal">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{t('running')}</span>
              </div>
            </div>
          )}

          {review && !running && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-surface-modal p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium text-foreground">{t('results.title')}</h2>
                    <p data-testid="code-review-summary" className="mt-1 text-sm text-muted-foreground">
                      {review.summary}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="code-review-create-run-node"
                    onClick={() => void handleCreateNode()}
                    disabled={creatingNodeId === 'review' || Boolean(createdNodeIds.review)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
                  >
                    {creatingNodeId === 'review' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                    <span>{createdNodeIds.review ? t('actions.nodeCreated') : t('actions.createReviewNode')}</span>
                  </button>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">{t('results.target')}</dt>
                    <dd data-testid="code-review-target-label" className="mt-1 font-medium text-foreground">
                      {review.target.label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('results.files')}</dt>
                    <dd className="mt-1 font-medium text-foreground">{review.diffStats.files}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('results.findings')}</dt>
                    <dd className="mt-1 font-medium text-foreground">{review.findings.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('results.readonly')}</dt>
                    <dd className="mt-1 font-medium text-foreground">{review.readonly ? t('yes') : t('no')}</dd>
                  </div>
                </dl>
              </div>

              {!hasFindings && (
                <div data-testid="code-review-no-findings" className="rounded-md border border-border bg-surface-modal p-6 text-sm text-muted-foreground">
                  {t('results.noFindings')}
                </div>
              )}

              <div data-testid="code-review-findings" className="space-y-3">
                {review.findings.map((finding, index) => (
                  <article
                    key={finding.id}
                    data-testid="code-review-finding"
                    className="rounded-md border border-border bg-surface-modal p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-md border px-2 py-1 text-xs font-medium', severityClass[finding.severity])}>
                            {t(`severity.${finding.severity}`)}
                          </span>
                          <span className="text-sm font-medium text-foreground">
                            {finding.file}{finding.line ? `:${finding.line}` : ''}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-foreground">{finding.reason}</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t('finding.suggestedFix')}: {finding.suggestedFix}
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid={`code-review-create-finding-node-${index}`}
                        onClick={() => void handleCreateNode(finding.id)}
                        disabled={creatingNodeId === finding.id || Boolean(createdNodeIds[finding.id])}
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
                      >
                        {creatingNodeId === finding.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                        <span>{createdNodeIds[finding.id] ? t('actions.nodeCreated') : t('actions.createFindingNode')}</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
