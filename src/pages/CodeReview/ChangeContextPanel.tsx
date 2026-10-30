import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import {
  CHANGE_CONTEXT_COMPARISON_MODES,
  type ChangeContextComparisonMode,
  type ChangeContextProjection,
  type ChangeContextReviewCommentAnchor,
  type ChangeContextReviewCommentProjection,
  type ChangeContextReviewVerdict,
} from '@shared/types/change-context';

const inputClass = 'rounded-md border border-border bg-surface-input px-3 py-2 text-sm';
const buttonClass = 'rounded-md border border-border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50';

async function digest(content: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function ChangeContextPanel() {
  const workspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  return <ActiveChangeContextPanel key={workspaceId ?? 'default'} />;
}

function ActiveChangeContextPanel() {
  const { t } = useTranslation('codeReview');
  const workspace = useWorkspacesStore((state) => state.activeWorkspace);
  const [enabled, setEnabled] = useState(false);
  const [sessionKey, setSessionKey] = useState(workspace?.activeSessionKey ?? '');
  const [mode, setMode] = useState<ChangeContextComparisonMode>('merge-base');
  const [revision, setRevision] = useState('');
  const [projection, setProjection] = useState<ChangeContextProjection | null>(null);
  const [comments, setComments] = useState<ChangeContextReviewCommentProjection[]>([]);
  const [path, setPath] = useState('');
  const [startLine, setStartLine] = useState(1);
  const [endLine, setEndLine] = useState(1);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ChangeContextReviewVerdict | null>(null);
  const [nodeId, setNodeId] = useState('');
  const [destinationHead, setDestinationHead] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [pullState, setPullState] = useState('');
  const author = { id: 'local-user', kind: 'user' as const };
  const identity = { workspaceId: workspace?.id ?? null, sessionKey };

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function refreshComments(contextId: string) {
    const result = await hostApi.changeContext.listComments({ ...identity, contextId });
    setComments(result.comments);
    if (!result.success) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
  }

  async function anchor(): Promise<ChangeContextReviewCommentAnchor> {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      throw new Error(t('changeContext.invalidRange'));
    }
    const file = await hostApi.files.readText(path);
    if (!file.ok || typeof file.content !== 'string') throw new Error(t('changeContext.sourceUnavailable'));
    const lines = file.content.replace(/\r\n/g, '\n').split('\n');
    if (endLine > lines.length) throw new Error(t('changeContext.invalidRange'));
    const excerpt = lines.slice(startLine - 1, endLine).join('\n');
    return {
      path, range: { startLine, endLine },
      fileDigest: await digest(file.content.endsWith('\n') ? file.content.slice(0, -1) : file.content),
      rangeDigest: await digest(excerpt), originalExcerpt: excerpt,
      baseRevision: projection?.comparison?.base ?? null,
      candidateRevision: projection?.comparison?.candidate ?? null,
    };
  }

  return <section data-testid="change-context" className="border-b border-border p-4">
    <button type="button" data-testid="change-context-toggle" className={buttonClass} aria-expanded={enabled} disabled={busy}
      onClick={() => { setEnabled(!enabled); setProjection(null); setComments([]); setError(''); }}>
      {t('changeContext.title')}
    </button>
    {enabled && <fieldset disabled={busy} className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">{t('changeContext.optIn')}</p>
      <div className="flex flex-wrap gap-2">
        <input aria-label={t('changeContext.session')} data-testid="change-context-session" className={inputClass}
          value={sessionKey} onChange={(event) => { setSessionKey(event.target.value); setProjection(null); setComments([]); }} />
        <select aria-label={t('changeContext.mode')} data-testid="change-context-mode" className={inputClass} value={mode}
          onChange={(event) => { setMode(event.target.value as ChangeContextComparisonMode); setProjection(null); setComments([]); }}>
          {CHANGE_CONTEXT_COMPARISON_MODES.map((value) => <option key={value} value={value}>{t(`changeContext.modes.${value}`)}</option>)}
        </select>
        {mode !== 'last-turn' && <input data-testid="change-context-revision" aria-label={t('changeContext.revision')}
          className={inputClass} value={revision} onChange={(event) => { setRevision(event.target.value); setProjection(null); setComments([]); }} />}
        <button type="button" data-testid="change-context-load" className={buttonClass} disabled={busy || !sessionKey.trim()}
          onClick={() => void perform(async () => {
            setVerdict(null); setPullState('');
            const comparison = mode === 'merge-base' ? { mode, baseRef: revision }
              : mode === 'last-commit' ? { mode, commit: revision }
                : mode === 'checkpoint' ? { mode, checkpointId: revision } : { mode };
            const result = await hostApi.changeContext.getProjection({ ...identity, comparison });
            setProjection(result.projection ?? null);
            if (result.projection) await refreshComments(result.projection.contextId);
            if (!result.success) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
          })}>{t('changeContext.load')}</button>
      </div>
      {error && <p role="alert" data-testid="change-context-error" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      {projection && <div className="space-y-3" data-testid="change-context-projection">
        <p data-testid="change-context-state" className="text-sm">{t(`changeContext.states.${projection.diff?.state ?? 'unavailable'}`)}</p>
        <ul className="text-sm">{projection.diff?.files.map((file) => <li key={file.path}>{file.path}</li>)}</ul>
        {projection.diff?.patchArtifacts.map((patch, index) => <pre key={index} className="max-h-60 overflow-auto rounded-md bg-surface-modal p-3 text-xs">{patch.patch ?? patch.message}</pre>)}
        <div className="flex flex-wrap gap-2">
          <input aria-label={t('changeContext.taskNode')} data-testid="review-task-node" className={inputClass} value={nodeId} onChange={(event) => setNodeId(event.target.value)} />
          {(['approve', 'request_changes', 'comment_only'] as const).map((decision) => <button type="button" key={decision} data-testid={`review-verdict-${decision}`} className={buttonClass} disabled={busy || !projection.reviewedDigest}
            onClick={() => void perform(async () => {
              const result = await hostApi.changeContext.submitVerdict({ ...identity, contextId: projection.contextId, reviewedDigest: projection.reviewedDigest!, author, decision,
                ...(decision === 'request_changes' && nodeId.trim() ? { taskLedgerNodeId: nodeId.trim() } : {}) });
              if (!result.success || !result.verdict) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
              setVerdict(result.verdict);
              if (result.verdict.taskLedgerLink) setNodeId(result.verdict.taskLedgerLink.taskLedgerNodeId);
            })}>{t(`changeContext.verdicts.${decision}`)}</button>)}
        </div>
        {verdict && <p data-testid="review-verdict-result" className="text-sm">{t(`changeContext.verdicts.${verdict.decision}`)}{verdict.taskLedgerLink ? ` · ${verdict.taskLedgerLink.taskLedgerNodeId}` : ''}</p>}
        <p className="text-sm text-muted-foreground">{t('changeContext.verdictBoundary')}</p>
        <div className="flex flex-wrap gap-2">
          <input aria-label={t('changeContext.destinationHead')} data-testid="pull-head" className={inputClass} value={destinationHead} onChange={(event) => setDestinationHead(event.target.value)} />
          <input aria-label={t('changeContext.approval')} data-testid="pull-approval" className={inputClass} value={approvalId} onChange={(event) => setApprovalId(event.target.value)} />
          {projection.diff?.patchArtifacts.map((patch, index) => <button type="button" key={index} className={buttonClass} data-testid="pull-changes" disabled={busy || patch.completeness !== 'complete' || patch.contentKind !== 'text' || !destinationHead.trim() || pullState === 'recovery_required'}
            onClick={() => void perform(async () => {
              const result = await hostApi.changeContext.pullChanges({ ...identity, contextId: projection.contextId, patchArtifact: patch,
                expectedDestinationHead: destinationHead.trim(), approvalId: approvalId.trim() });
              setPullState(result.state);
              if (!result.success) throw new Error(result.error.safeMessage);
            })}>{t('changeContext.pull')} · {patch.file}</button>)}
        </div>
        {pullState && <p data-testid="pull-state" className="text-sm">{t(`changeContext.pullStates.${pullState}`)}</p>}
        <h2 className="font-serif font-normal tracking-tight">{t('reviewComments.title')}</h2>
        <div className="flex flex-wrap gap-2">
          <input data-testid="comment-path" aria-label={t('changeContext.path')} className={inputClass} value={path} onChange={(event) => setPath(event.target.value)} />
          <input data-testid="comment-start" aria-label={t('changeContext.startLine')} className={inputClass} type="number" min={1} value={startLine} onChange={(event) => setStartLine(Number(event.target.value))} />
          <input data-testid="comment-end" aria-label={t('changeContext.endLine')} className={inputClass} type="number" min={startLine} value={endLine} onChange={(event) => setEndLine(Number(event.target.value))} />
          <input data-testid="comment-body" aria-label={t('changeContext.comment')} className={inputClass} value={body} onChange={(event) => setBody(event.target.value)} />
          <button type="button" data-testid="comment-create" className={buttonClass} disabled={busy || !body.trim() || !path.trim()}
            onClick={() => void perform(async () => {
              const result = await hostApi.changeContext.createComment({ ...identity, contextId: projection.contextId, body, author, anchor: await anchor() });
              if (!result.success) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
              setBody(''); await refreshComments(projection.contextId);
            })}>{t('changeContext.addComment')}</button>
          <button type="button" data-testid="comments-refresh" className={buttonClass} disabled={busy}
            onClick={() => void perform(() => refreshComments(projection.contextId))}>{t('changeContext.refresh')}</button>
        </div>
        {comments.filter(({ comment }) => !comment.deletedAt).map(({ comment, anchorState }) => <article key={comment.id} data-testid="review-comment" className="rounded-md border border-border bg-surface-modal p-3 text-sm">
          <p>{comment.body}</p><p>{comment.anchor.path}:{comment.anchor.range.startLine}–{comment.anchor.range.endLine}</p>
          <p data-testid="comment-anchor-state">{t(`reviewComments.anchorState.${anchorState}`)}</p>
          {anchorState !== 'live' && <p className="text-amber-700 dark:text-amber-400">{t('reviewComments.staleHelper')}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" data-testid="comment-reanchor" className={buttonClass} disabled={busy || !path.trim()}
              onClick={() => void perform(async () => {
                const result = await hostApi.changeContext.reanchorComment({ commentId: comment.id, expectedUpdatedAt: comment.updatedAt, author, anchor: await anchor(), reason: t('reviewComments.reanchor') });
                if (!result.success) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
                await refreshComments(projection.contextId);
              })}>{t('reviewComments.reanchor')}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void perform(async () => {
              const result = await hostApi.changeContext.resolveComment({ commentId: comment.id, resolved: !comment.resolvedAt, author });
              if (!result.success) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
              await refreshComments(projection.contextId);
            })}>{t(comment.resolvedAt ? 'changeContext.reopen' : 'changeContext.resolve')}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void perform(async () => {
              const result = await hostApi.changeContext.deleteComment({ commentId: comment.id, expectedUpdatedAt: comment.updatedAt, author, reason: t('changeContext.delete') });
              if (!result.success) throw new Error(result.error?.safeMessage ?? t('changeContext.failed'));
              await refreshComments(projection.contextId);
            })}>{t('changeContext.delete')}</button>
          </div>
        </article>)}
      </div>}
    </fieldset>}
  </section>;
}
