import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Send, ShieldCheck, X } from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { RemoteForgeMutationPayload } from '@shared/host-api/contract';
import type { RemoteForgeMutationV1, RemoteForgePullRequestReadV1 } from '@shared/types/remote-forge';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

type MutationAction = RemoteForgeMutationPayload['action'];

type PendingMutation = {
  approval: PermissionApprovalEvent;
  payload: RemoteForgeMutationPayload;
};

const actions: MutationAction[] = [
  'review_submit',
  'line_comment_create',
  'comment_edit',
  'thread_reply',
  'metadata_update',
];

function commaValues(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function firstDiffHunk(pullRequest: RemoteForgePullRequestReadV1, path: string | null): string | undefined {
  const artifact = path ? pullRequest.patchArtifacts.find((entry) => entry.file === path) : undefined;
  const hunk = artifact?.hunks[0];
  if (!hunk) return undefined;
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.heading ? ` ${hunk.heading}` : ''}`;
  const body = hunk.lines.map((line) => {
    if (line.kind === 'addition') return `+${line.text}`;
    if (line.kind === 'deletion') return `-${line.text}`;
    if (line.kind === 'no-newline') return '\\ No newline at end of file';
    return ` ${line.text}`;
  }).join('\n');
  return `${header}\n${body}`.slice(0, 4_096);
}

export function RemoteForgeMutationPanel({
  owner,
  repository,
  pullRequest,
  selectedPath,
}: {
  owner: string;
  repository: string;
  pullRequest: RemoteForgePullRequestReadV1;
  selectedPath: string | null;
}) {
  const { t } = useTranslation('codeReview');
  const [action, setAction] = useState<MutationAction>('review_submit');
  const [reviewEvent, setReviewEvent] = useState<'comment' | 'approve' | 'request_changes'>('comment');
  const [body, setBody] = useState('');
  const [line, setLine] = useState('1');
  const [side, setSide] = useState<'LEFT' | 'RIGHT'>('RIGHT');
  const [commentId, setCommentId] = useState('');
  const [title, setTitle] = useState(pullRequest.detail.title);
  const [metadataBody, setMetadataBody] = useState(pullRequest.detail.body ?? '');
  const [labels, setLabels] = useState('');
  const [reviewers, setReviewers] = useState('');
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [result, setResult] = useState<RemoteForgeMutationV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTitle(pullRequest.detail.title);
    setMetadataBody(pullRequest.detail.body ?? '');
    setPending(null);
    setResult(null);
    setError(null);
  }, [
    pullRequest.detail.body,
    pullRequest.detail.headSha,
    pullRequest.detail.number,
    pullRequest.detail.title,
  ]);

  const buildPayload = (): RemoteForgeMutationPayload | null => {
    const expectedHeadSha = pullRequest.detail.headSha;
    if (!expectedHeadSha) {
      setError(t('remote.mutation.errors.missingHead'));
      return null;
    }
    const base = {
      provider: 'github' as const,
      owner,
      repository,
      number: pullRequest.detail.number,
      expectedHeadSha,
    };
    if (action === 'review_submit') {
      if (!body.trim()) {
        setError(t('remote.mutation.errors.bodyRequired'));
        return null;
      }
      return { ...base, action, event: reviewEvent, body };
    }
    if (action === 'line_comment_create') {
      const parsedLine = Number(line);
      if (!selectedPath || !Number.isInteger(parsedLine) || parsedLine <= 0 || !body.trim()) {
        setError(t('remote.mutation.errors.lineRequired'));
        return null;
      }
      return {
        ...base,
        action,
        path: selectedPath,
        side,
        line: parsedLine,
        body,
        diffHunk: firstDiffHunk(pullRequest, selectedPath),
      };
    }
    if (action === 'comment_edit' || action === 'thread_reply') {
      const parsedCommentId = Number(commentId);
      if (!Number.isInteger(parsedCommentId) || parsedCommentId <= 0 || !body.trim()) {
        setError(t('remote.mutation.errors.commentRequired'));
        return null;
      }
      return { ...base, action, commentId: parsedCommentId, body };
    }
    if (!pullRequest.detail.updatedAt || (!title.trim() && metadataBody === '')) {
      setError(t('remote.mutation.errors.metadataRequired'));
      return null;
    }
    return {
      ...base,
      action: 'metadata_update',
      expectedUpdatedAt: pullRequest.detail.updatedAt,
      title,
      body: metadataBody,
      labels: commaValues(labels),
      reviewers: commaValues(reviewers),
    };
  };

  const requestApproval = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await hostApi.remoteForge.mutatePullRequest(payload);
      if (response.approvalRequired && response.approval) {
        setPending({ approval: response.approval, payload });
      } else if (response.error) {
        setError(t(`remote.mutation.errors.${response.error.code}`));
      } else {
        setError(t('remote.mutation.errors.requestFailed'));
      }
    } catch {
      setError(t('remote.mutation.errors.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const decide = async (decision: 'approved' | 'denied') => {
    if (!pending) return;
    setLoading(true);
    setError(null);
    try {
      const decided = await hostApi.permissions.decideApproval({ id: pending.approval.id, decision });
      if (!decided.success) {
        setError(t('remote.mutation.errors.approvalFailed'));
        return;
      }
      if (decision === 'denied') {
        setPending(null);
        return;
      }
      const response = await hostApi.remoteForge.mutatePullRequest({
        ...pending.payload,
        approvalId: pending.approval.id,
      });
      setPending(null);
      if (response.mutation) setResult(response.mutation);
      if (response.error && !response.mutation) setError(t(`remote.mutation.errors.${response.error.code}`));
      if (!response.mutation && !response.error) setError(t('remote.mutation.errors.publishFailed'));
    } catch {
      setError(t('remote.mutation.errors.publishFailed'));
    } finally {
      setLoading(false);
    }
  };

  const locked = loading || pending !== null;

  return (
    <section aria-labelledby="remote-forge-mutation" className="border-t border-border/60 pt-5" data-testid="remote-forge-mutation-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="remote-forge-mutation" className="text-base font-medium text-foreground">
            {t('remote.mutation.title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('remote.mutation.draftState')}</p>
        </div>
        <label className="text-sm text-muted-foreground">
          <span className="sr-only">{t('remote.mutation.action')}</span>
          <select
            data-testid="remote-forge-mutation-action"
            disabled={locked}
            value={action}
            onChange={(event) => setAction(event.target.value as MutationAction)}
            className="h-9 rounded-md border border-border bg-surface-input px-3 text-sm text-foreground outline-none focus:border-foreground/30"
          >
            {actions.map((item) => <option key={item} value={item}>{t(`remote.mutation.actions.${item}`)}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          {action === 'review_submit' && (
            <label className="block text-sm font-medium text-foreground">
              <span>{t('remote.mutation.reviewEvent')}</span>
              <select
                disabled={locked}
                value={reviewEvent}
                onChange={(event) => setReviewEvent(event.target.value as typeof reviewEvent)}
                className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
              >
                <option value="comment">{t('remote.mutation.events.comment')}</option>
                <option value="approve">{t('remote.mutation.events.approve')}</option>
                <option value="request_changes">{t('remote.mutation.events.request_changes')}</option>
              </select>
            </label>
          )}

          {action === 'line_comment_create' && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_auto] sm:items-end">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('remote.mutation.path')}</p>
                <p data-testid="remote-forge-mutation-path" className="mt-2 truncate rounded-md border border-border bg-surface-modal px-3 py-2 text-sm text-muted-foreground">
                  {selectedPath ?? t('remote.mutation.selectFile')}
                </p>
              </div>
              <label className="text-sm font-medium text-foreground">
                <span>{t('remote.mutation.line')}</span>
                <input
                  data-testid="remote-forge-mutation-line"
                  disabled={locked}
                  type="number"
                  min={1}
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                  className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
                />
              </label>
              <div className="flex h-9 overflow-hidden rounded-md border border-border" aria-label={t('remote.mutation.side')}>
                {(['LEFT', 'RIGHT'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={locked}
                    onClick={() => setSide(value)}
                    className={cn('px-3 text-xs font-medium', side === value ? 'bg-black/5 text-foreground dark:bg-white/10' : 'bg-surface-input text-muted-foreground')}
                  >
                    {t(`remote.mutation.sides.${value}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(action === 'comment_edit' || action === 'thread_reply') && (
            <label className="block text-sm font-medium text-foreground">
              <span>{t('remote.mutation.commentId')}</span>
              <input
                data-testid="remote-forge-mutation-comment-id"
                disabled={locked}
                type="number"
                min={1}
                value={commentId}
                onChange={(event) => setCommentId(event.target.value)}
                className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
              />
            </label>
          )}

          {action === 'metadata_update' ? (
            <>
              <label className="block text-sm font-medium text-foreground">
                <span>{t('remote.mutation.metadataTitle')}</span>
                <input
                  data-testid="remote-forge-mutation-title"
                  disabled={locked}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                <span>{t('remote.mutation.metadataBody')}</span>
                <textarea
                  data-testid="remote-forge-mutation-metadata-body"
                  disabled={locked}
                  value={metadataBody}
                  onChange={(event) => setMetadataBody(event.target.value)}
                  className="mt-2 min-h-24 w-full resize-y rounded-md border border-border bg-surface-input p-3 text-sm outline-none focus:border-foreground/30"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground">
                  <span>{t('remote.mutation.labels')}</span>
                  <input
                    data-testid="remote-forge-mutation-labels"
                    disabled={locked}
                    value={labels}
                    onChange={(event) => setLabels(event.target.value)}
                    className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  <span>{t('remote.mutation.reviewers')}</span>
                  <input
                    data-testid="remote-forge-mutation-reviewers"
                    disabled={locked}
                    value={reviewers}
                    onChange={(event) => setReviewers(event.target.value)}
                    className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
                  />
                </label>
              </div>
            </>
          ) : (
            <label className="block text-sm font-medium text-foreground">
              <span>{t('remote.mutation.body')}</span>
              <textarea
                data-testid="remote-forge-mutation-body"
                disabled={locked}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="mt-2 min-h-28 w-full resize-y rounded-md border border-border bg-surface-input p-3 text-sm outline-none focus:border-foreground/30"
              />
            </label>
          )}

          <button
            type="button"
            data-testid="remote-forge-mutation-request"
            disabled={locked}
            onClick={() => void requestApproval()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && !pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t('remote.mutation.requestApproval')}
          </button>
        </div>

        <aside className="space-y-3" aria-live="polite">
          {pending && (
            <div data-testid="remote-forge-mutation-approval" className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
              <p className="text-sm font-medium">{t('remote.mutation.approvalTitle')}</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-3"><dt>{t('remote.mutation.action')}</dt><dd>{t(`remote.mutation.actions.${pending.payload.action}`)}</dd></div>
                <div className="flex justify-between gap-3"><dt>{t('remote.mutation.head')}</dt><dd className="max-w-36 truncate font-mono">{pending.payload.expectedHeadSha}</dd></div>
              </dl>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  data-testid="remote-forge-mutation-deny"
                  disabled={loading}
                  onClick={() => void decide('denied')}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-current/20 px-3 text-xs font-medium disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('remote.mutation.deny')}
                </button>
                <button
                  type="button"
                  data-testid="remote-forge-mutation-approve"
                  disabled={loading}
                  onClick={() => void decide('approved')}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-amber-700 px-3 text-xs font-medium text-white disabled:opacity-60 dark:bg-amber-500 dark:text-black"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {t('remote.mutation.approveAndPublish')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div data-testid="remote-forge-mutation-error" className="flex gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div data-testid="remote-forge-mutation-result" className={cn(
              'rounded-md border p-3 text-sm',
              result.state === 'succeeded'
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : result.state === 'partial'
                  ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400',
            )}>
              <p data-testid="remote-forge-mutation-state" className="font-medium">{t(`remote.mutation.states.${result.state}`)}</p>
              <ul className="mt-2 space-y-1 text-xs">
                {result.effects.map((effect) => (
                  <li key={`${effect.id}:${effect.operation}`} className="flex justify-between gap-3">
                    <span>{t(`remote.mutation.effects.${effect.id}`)}</span>
                    <span>{t(`remote.mutation.effectStates.${effect.state}`)}</span>
                  </li>
                ))}
              </ul>
              {result.reconciliation.required && (
                <p data-testid="remote-forge-mutation-reconciliation" className="mt-3 text-xs font-medium">
                  {t(`remote.mutation.reconciliation.${result.reconciliation.state}`)}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
