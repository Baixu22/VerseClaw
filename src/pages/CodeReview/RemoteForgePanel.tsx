import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileCode2,
  GitPullRequest,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { CodeDiff } from '@/components/tool-ui/code-diff';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { RemoteForgeMutationPanel } from './RemoteForgeMutationPanel';
import { RemoteForgeMergePanel } from './RemoteForgeMergePanel';
import type {
  GitPatchArtifactV1,
  RemoteForgeCapabilityMatrix,
  RemoteForgeCompleteness,
  RemoteForgeContent,
  RemoteForgePullRequestReadV1,
  RemoteForgeReadiness,
} from '@shared/types/remote-forge';

type StateTone = 'success' | 'warning' | 'danger' | 'neutral';

const toneClass: Record<StateTone, string> = {
  success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  danger: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400',
  neutral: 'border-border bg-surface-modal text-muted-foreground',
};

const capabilityKeys = [
  'pullRequestRead',
  'commitsRead',
  'filesRead',
  'diffRead',
  'checksRead',
  'reviewsRead',
  'contentRead',
  'protectionRead',
] as const satisfies ReadonlyArray<keyof RemoteForgeCapabilityMatrix>;

function completenessTone(completeness: RemoteForgeCompleteness): StateTone {
  if (completeness.state === 'complete') return 'success';
  if (completeness.state === 'incomplete' || completeness.state === 'truncated') return 'warning';
  return 'danger';
}

function readinessTone(readiness: RemoteForgeReadiness): StateTone {
  if (readiness.state === 'ready') return 'success';
  if (readiness.state === 'blocked') return 'danger';
  if (readiness.state === 'pending') return 'warning';
  return 'neutral';
}

function artifactForFile(
  pullRequest: RemoteForgePullRequestReadV1,
  path: string,
): GitPatchArtifactV1 | undefined {
  return pullRequest.patchArtifacts.find((artifact) => artifact.file === path);
}

export function RemoteForgePanel() {
  const { t } = useTranslation('codeReview');
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [number, setNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<RemoteForgeCapabilityMatrix | null>(null);
  const [pullRequest, setPullRequest] = useState<RemoteForgePullRequestReadV1 | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<RemoteForgeContent | null>(null);

  const selectedArtifact = useMemo(
    () => pullRequest && selectedPath ? artifactForFile(pullRequest, selectedPath) : undefined,
    [pullRequest, selectedPath],
  );

  const loadPullRequest = async () => {
    const prNumber = Number(number);
    if (!owner.trim() || !repository.trim() || !Number.isInteger(prNumber) || prNumber <= 0) {
      setError(t('remote.errors.required'));
      return;
    }
    setLoading(true);
    setError(null);
    setPullRequest(null);
    setSelectedPath(null);
    setContent(null);
    const payload = {
      provider: 'github' as const,
      owner: owner.trim(),
      repository: repository.trim(),
    };
    try {
      const [capabilityResult, pullRequestResult] = await Promise.all([
        hostApi.remoteForge.capabilities(payload),
        hostApi.remoteForge.readPullRequest({ ...payload, number: prNumber }),
      ]);
      setCapability(capabilityResult.capability);
      if (!pullRequestResult.pullRequest) {
        setError(t('remote.errors.readFailed'));
        return;
      }
      setPullRequest(pullRequestResult.pullRequest);
      setCapability(pullRequestResult.pullRequest.capability);
      if (!pullRequestResult.success) setError(t('remote.errors.incomplete'));
    } catch {
      setError(t('remote.errors.readFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadContent = async (path: string) => {
    if (!pullRequest?.detail.headSha) return;
    setSelectedPath(path);
    setContent(null);
    setContentLoading(true);
    try {
      const result = await hostApi.remoteForge.readContents({
        provider: 'github',
        owner: owner.trim(),
        repository: repository.trim(),
        ref: pullRequest.detail.headSha,
        paths: [path],
      });
      setContent(result.contents[0] ?? null);
      if (!result.success) setError(t('remote.errors.contentIncomplete'));
    } catch {
      setError(t('remote.errors.contentFailed'));
    } finally {
      setContentLoading(false);
    }
  };

  return (
    <main data-testid="remote-forge-panel" className="min-h-0 flex-1 overflow-auto">
      <section className="border-b border-border/60 px-4 py-5 sm:px-6">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_auto] md:items-end">
          <label className="text-sm font-medium text-foreground">
            <span>{t('remote.owner')}</span>
            <input
              data-testid="remote-forge-owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
              placeholder={t('remote.ownerPlaceholder')}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            <span>{t('remote.repository')}</span>
            <input
              data-testid="remote-forge-repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
              placeholder={t('remote.repositoryPlaceholder')}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            <span>{t('remote.number')}</span>
            <input
              data-testid="remote-forge-number"
              inputMode="numeric"
              min={1}
              type="number"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
              placeholder={t('remote.numberPlaceholder')}
            />
          </label>
          <button
            type="button"
            data-testid="remote-forge-read"
            disabled={loading}
            onClick={() => void loadPullRequest()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span>{loading ? t('remote.loading') : t('remote.read')}</span>
          </button>
        </div>
      </section>

      <div className="space-y-5 p-4 sm:p-6">
        {error && (
          <div
            data-testid="remote-forge-error"
            className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!pullRequest && !loading && (
          <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed border-border bg-surface-modal">
            <div className="max-w-md px-5 text-center text-sm text-muted-foreground">
              <GitPullRequest className="mx-auto mb-3 h-7 w-7" />
              <p>{t('remote.empty')}</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
            <span>{t('remote.loading')}</span>
          </div>
        )}

        {pullRequest && (
          <>
            <section aria-labelledby="remote-forge-summary" className="border-b border-border/60 pb-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">
                    {pullRequest.repository} #{pullRequest.detail.number}
                  </p>
                  <h2 id="remote-forge-summary" data-testid="remote-forge-title" className="mt-1 text-xl font-medium text-foreground">
                    {pullRequest.detail.title}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {pullRequest.detail.headRef} &rarr; {pullRequest.detail.baseRef}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span
                    data-testid="remote-forge-readiness"
                    className={cn('inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm', toneClass[readinessTone(pullRequest.readiness)])}
                  >
                    {pullRequest.readiness.state === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                    {t(`remote.readiness.${pullRequest.readiness.state}`)}
                  </span>
                  <span
                    data-testid="remote-forge-completeness"
                    className={cn('inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm', toneClass[completenessTone(pullRequest.completeness)])}
                  >
                    <CircleDot className="h-4 w-4" />
                    {t(`remote.completeness.${pullRequest.completeness.state}`)}
                  </span>
                </div>
              </div>

              {pullRequest.readiness.reasons.length > 0 && (
                <div data-testid="remote-forge-readiness-reasons" className="mt-3 flex flex-wrap gap-2">
                  {pullRequest.readiness.reasons.map((reason) => (
                    <span key={reason} className="rounded-md bg-black/5 px-2 py-1 text-xs text-muted-foreground dark:bg-white/10">
                      {t(`remote.reasons.${reason}`)}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="remote-forge-evidence" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 id="remote-forge-evidence" className="text-base font-medium text-foreground">
                    {t('remote.evidence')}
                  </h2>
                  <p className="text-xs text-muted-foreground">{t('remote.head', { sha: pullRequest.detail.headSha ?? t('remote.missing') })}</p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
                  {([
                    ['commits', pullRequest.commits.items.length],
                    ['files', pullRequest.files.items.length],
                    ['checks', pullRequest.checks.items.length],
                    ['reviews', pullRequest.reviews.items.length],
                  ] as const).map(([key, value]) => (
                    <div key={key} className="bg-surface-modal px-3 py-3">
                      <dt className="text-xs text-muted-foreground">{t(`remote.counts.${key}`)}</dt>
                      <dd className="mt-1 text-lg font-medium text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-5 space-y-2" data-testid="remote-forge-files">
                  {pullRequest.files.items.map((file) => (
                    <button
                      type="button"
                      key={file.path}
                      data-testid="remote-forge-file"
                      disabled={!pullRequest.detail.headSha || contentLoading}
                      onClick={() => void loadContent(file.path)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        selectedPath === file.path
                          ? 'border-foreground/20 bg-black/5 dark:bg-white/10'
                          : 'border-border bg-surface-modal hover:bg-black/5 dark:hover:bg-white/5',
                      )}
                    >
                      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{file.path}</span>
                      <span className="shrink-0 text-xs text-emerald-700 dark:text-emerald-400">+{file.additions}</span>
                      <span className="shrink-0 text-xs text-red-700 dark:text-red-400">-{file.deletions}</span>
                    </button>
                  ))}
                </div>
              </div>

              {capability && (
                <aside aria-labelledby="remote-forge-capabilities">
                  <h2 id="remote-forge-capabilities" className="text-base font-medium text-foreground">
                    {t('remote.capabilities.title')}
                  </h2>
                  <dl className="mt-3 divide-y divide-border/60 border-y border-border/60 text-sm">
                    {capabilityKeys.map((key) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-2">
                        <dt className="text-muted-foreground">{t(`remote.capabilities.${key}`)}</dt>
                        <dd className="font-medium text-foreground">{t(`remote.capabilityState.${capability[key]}`)}</dd>
                      </div>
                    ))}
                  </dl>
                </aside>
              )}
            </section>

            {selectedPath && (
              <section aria-labelledby="remote-forge-file-preview" className="border-t border-border/60 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="remote-forge-file-preview" className="min-w-0 truncate text-base font-medium text-foreground">
                    {selectedPath}
                  </h2>
                  {contentLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {selectedArtifact?.patch && selectedArtifact.completeness === 'complete' && selectedArtifact.contentKind === 'text' && (
                  <div className="mt-3" data-testid="remote-forge-diff">
                    <CodeDiff
                      id={`remote-forge:${pullRequest.requestId}:${selectedPath}`}
                      patch={selectedArtifact.patch}
                      filename={selectedPath}
                      language="text"
                      lineNumbers="visible"
                      diffStyle="unified"
                    />
                  </div>
                )}
                {content && (
                  <div className="mt-3" data-testid="remote-forge-content">
                    {content.kind === 'utf8' && content.text !== undefined ? (
                      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-surface-input p-3 text-xs leading-5 text-foreground">
                        {content.text}
                      </pre>
                    ) : (
                      <div className={cn('rounded-md border p-3 text-sm', toneClass[completenessTone(content.completeness)])}>
                        {t(`remote.content.${content.kind}`)}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            <RemoteForgeMutationPanel
              owner={owner.trim()}
              repository={repository.trim()}
              pullRequest={pullRequest}
              selectedPath={selectedPath}
            />
            <RemoteForgeMergePanel
              owner={owner.trim()}
              repository={repository.trim()}
              pullRequest={pullRequest}
            />
          </>
        )}
      </div>
    </main>
  );
}
