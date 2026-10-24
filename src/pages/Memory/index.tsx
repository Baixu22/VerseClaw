import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Check,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import { cn } from '@/lib/utils';
import type { MemorySurfaceEntry, MemorySurfaceSnapshot } from '@shared/types/memory';

type MemoryTab = 'accepted' | 'candidates';
type ScopeOption = 'workspace' | 'role' | 'global' | 'project' | 'session' | 'task' | 'user';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function gateLabel(t: (key: string) => string, open: boolean): string {
  return t(open ? 'memoryPage.gateOpen' : 'memoryPage.gateClosed');
}

export function MemoryPage() {
  const { t } = useTranslation('agents');
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const [snapshot, setSnapshot] = useState<MemorySurfaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MemoryTab>('accepted');
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemorySurfaceEntry | null>(null);
  const [rememberOpen, setRememberOpen] = useState(false);
  const [rememberContent, setRememberContent] = useState('');
  const [rememberScope, setRememberScope] = useState<ScopeOption>('workspace');
  const [rememberRole, setRememberRole] = useState('');
  const [rememberSensitivity, setRememberSensitivity] = useState<'normal' | 'sensitive'>('normal');
  const [exportReceipt, setExportReceipt] = useState<{ path: string; sha256: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostApi.memory.surface({ limit: 200 });
      if (!result.success) throw new Error(result.error ?? t('memoryPage.loadError'));
      setSnapshot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filterEntries = useCallback((entries: MemorySurfaceEntry[]): MemorySurfaceEntry[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => (
      entry.content.toLowerCase().includes(needle)
      || entry.sourceLabel.toLowerCase().includes(needle)
      || entry.scope.toLowerCase().includes(needle)
      || entry.roleTags.some((role) => role.toLowerCase().includes(needle))
    ));
  }, [query]);

  const accepted = useMemo(
    () => filterEntries(snapshot?.accepted ?? []),
    [filterEntries, snapshot?.accepted],
  );
  const candidates = useMemo(
    () => filterEntries(snapshot?.candidates ?? []),
    [filterEntries, snapshot?.candidates],
  );

  const approveCandidate = useCallback(async (entry: MemorySurfaceEntry) => {
    setBusyKey(entry.key);
    try {
      const result = await hostApi.memory.approveCandidate({ source: entry.source, id: entry.id });
      if (!result.success) throw new Error(result.error ?? t('memoryPage.approveError'));
      if (!result.approved) {
        toast.warning(result.reason || t('memoryPage.approveBlocked'));
      } else {
        toast.success(t('memoryPage.approved'));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [load, t]);

  const deleteAccepted = useCallback(async () => {
    if (!deleteTarget) return;
    const result = await hostApi.memory.delete({
      source: deleteTarget.source,
      id: deleteTarget.id,
      reason: t('memoryPage.deleteReason'),
    });
    if (!result.success) throw new Error(result.error ?? t('memoryPage.deleteError'));
    toast.success(t('memoryPage.deleted'));
    setDeleteTarget(null);
    await load();
  }, [deleteTarget, load, t]);

  const exportMemory = useCallback(async () => {
    setBusyKey('export');
    try {
      const result = await hostApi.memory.export({ format: 'json' });
      if (!result.success) throw new Error(result.error ?? t('memoryPage.exportError'));
      setExportReceipt({ path: result.path, sha256: result.sha256 });
      toast.success(t('memoryPage.exported'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [t]);

  const submitRemember = useCallback(async () => {
    if (!rememberContent.trim()) return;
    setBusyKey('remember');
    try {
      const role = rememberRole.trim();
      const result = await hostApi.memory.remember({
        content: rememberContent,
        type: 'fact',
        scope: rememberScope,
        scopeKey: rememberScope === 'workspace' ? activeWorkspace?.rootPath ?? null : role || null,
        roleTags: role ? [role] : undefined,
        sensitivity: rememberSensitivity,
      });
      if (!result.success) throw new Error(result.error ?? t('memoryPage.rememberError'));
      if (result.accepted) {
        toast.success(t('memoryPage.rememberAccepted'));
        setTab('accepted');
      } else {
        toast.warning(result.reason || t('memoryPage.rememberQueued'));
        setTab('candidates');
      }
      setRememberContent('');
      setRememberOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [activeWorkspace?.rootPath, load, rememberContent, rememberRole, rememberScope, rememberSensitivity, t]);

  const modelCount = snapshot?.counts.modelVisible ?? 0;
  const candidateCount = snapshot?.counts.candidates ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="memory-page">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/5 text-foreground dark:bg-white/10">
              <Brain className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-serif text-2xl font-normal tracking-tight">{t('memoryPage.title')}</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">{t('memoryPage.description')}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="memory-remember-button"
            variant="outline"
            size="sm"
            onClick={() => setRememberOpen((open) => !open)}
            disabled={loading}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('memoryPage.rememberButton')}
          </Button>
          <Button
            data-testid="memory-export-button"
            variant="outline"
            size="sm"
            onClick={() => void exportMemory()}
            disabled={loading || busyKey === 'export'}
          >
            {busyKey === 'export'
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {t('memoryPage.exportButton')}
          </Button>
          <Button
            data-testid="memory-refresh-button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('memoryPage.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3" data-testid="memory-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{t('memoryPage.unavailableTitle')}</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>{t('memoryPage.retry')}</Button>
        </div>
      )}

      {loading && !snapshot && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-surface-input py-16 text-sm text-muted-foreground" data-testid="memory-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('memoryPage.loading')}
        </div>
      )}

      {snapshot && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border-border/60 bg-surface-input shadow-none">
              <CardContent className="flex items-start gap-3 p-4">
                <Eye className="mt-0.5 h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('memoryPage.modelVisible')}</p>
                  <p className="mt-1 text-2xl font-medium tracking-tight" data-testid="memory-model-count">{modelCount}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">{t('memoryPage.acceptedOnly')}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-surface-input shadow-none">
              <CardContent className="flex items-start gap-3 p-4">
                <Clock3 className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('memoryPage.awaitingReview')}</p>
                  <p className="mt-1 text-2xl font-medium tracking-tight" data-testid="memory-candidate-count">{candidateCount}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">{t('memoryPage.notModelVisible')}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-surface-input shadow-none" data-testid="memory-control-status">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t('memoryPage.roleMemory')}</span>
                  <Badge variant={snapshot.status.roleMemory.enabled ? 'success' : 'warning'}>
                    {gateLabel(t, snapshot.status.roleMemory.enabled)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t('memoryPage.runtimeCapture')}</span>
                  <Badge variant={snapshot.status.runtimeMemory.candidateCapture ? 'success' : 'outline'}>
                    {gateLabel(t, snapshot.status.runtimeMemory.candidateCapture)}
                  </Badge>
                </div>
                <p className="text-2xs leading-4 text-muted-foreground">
                  {snapshot.status.runtimeMemory.candidatePersistence
                    ? t('memoryPage.candidatePersisted')
                    : t('memoryPage.runtimeCandidateNotPersisted')}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 px-4 py-3" data-testid="memory-model-boundary">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{t('memoryPage.boundaryTitle')}</p>
                <p>{t('memoryPage.modelBoundaryDescription')}</p>
                {snapshot.status.legacySources[0] && (
                  <p data-testid="memory-legacy-boundary">{t('memoryPage.legacyBoundaryDescription')}</p>
                )}
              </div>
            </div>
          </div>

          {rememberOpen && (
            <section className="rounded-xl border border-border/60 bg-surface-modal p-4 shadow-sm" data-testid="memory-remember-form">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">{t('memoryPage.rememberTitle')}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t('memoryPage.rememberDescription')}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRememberOpen(false)} aria-label={t('memoryPage.close')}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_180px]">
                <div className="space-y-1.5 md:col-span-3">
                  <Label htmlFor="memory-remember-content">{t('memoryPage.rememberContent')}</Label>
                  <Textarea
                    id="memory-remember-content"
                    data-testid="memory-remember-content"
                    value={rememberContent}
                    onChange={(event) => setRememberContent(event.target.value)}
                    placeholder={t('memoryPage.rememberPlaceholder')}
                    rows={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memory-remember-scope">{t('memoryPage.scope')}</Label>
                  <select
                    id="memory-remember-scope"
                    data-testid="memory-remember-scope"
                    className="h-9 w-full rounded-md border border-border bg-surface-input px-2.5 text-sm"
                    value={rememberScope}
                    onChange={(event) => setRememberScope(event.target.value as ScopeOption)}
                  >
                    {(['workspace', 'role', 'project', 'session', 'task', 'user', 'global'] as ScopeOption[]).map((scope) => (
                      <option key={scope} value={scope}>{t(`memoryPage.scopes.${scope}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memory-remember-role">{t('memoryPage.roleOptional')}</Label>
                  <Input
                    id="memory-remember-role"
                    data-testid="memory-remember-role"
                    value={rememberRole}
                    onChange={(event) => setRememberRole(event.target.value)}
                    placeholder={t('memoryPage.rolePlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memory-remember-sensitivity">{t('memoryPage.sensitivity')}</Label>
                  <select
                    id="memory-remember-sensitivity"
                    data-testid="memory-remember-sensitivity"
                    className="h-9 w-full rounded-md border border-border bg-surface-input px-2.5 text-sm"
                    value={rememberSensitivity}
                    onChange={(event) => setRememberSensitivity(event.target.value as 'normal' | 'sensitive')}
                  >
                    <option value="normal">{t('memoryPage.sensitivityNormal')}</option>
                    <option value="sensitive">{t('memoryPage.sensitivitySensitive')}</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setRememberOpen(false)}>{t('memoryPage.cancel')}</Button>
                <Button
                  data-testid="memory-remember-submit"
                  size="sm"
                  onClick={() => void submitRemember()}
                  disabled={!rememberContent.trim() || busyKey === 'remember'}
                >
                  {busyKey === 'remember'
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  {t('memoryPage.rememberSubmit')}
                </Button>
              </div>
            </section>
          )}

          {exportReceipt && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs" data-testid="memory-export-receipt">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">{t('memoryPage.exportReady')}</p>
              <p className="mt-1 break-all font-mono text-2xs text-muted-foreground" data-testid="memory-export-path">{exportReceipt.path}</p>
              <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">SHA-256 {exportReceipt.sha256}</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="tablist" aria-label={t('memoryPage.title')} className="inline-flex h-8 items-center rounded-lg bg-surface-input p-0.5">
                {(['accepted', 'candidates'] as MemoryTab[]).map((value) => {
                  const active = tab === value;
                  const count = value === 'accepted' ? snapshot.counts.accepted : snapshot.counts.candidates;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-state={active ? 'active' : 'inactive'}
                      data-testid={`memory-tab-${value}`}
                      className={cn(
                        'inline-flex h-7 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors',
                        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setTab(value)}
                    >
                      {t(value === 'accepted' ? 'memoryPage.acceptedTab' : 'memoryPage.candidatesTab')} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  data-testid="memory-search"
                  className="h-8 pl-8 text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('memoryPage.searchPlaceholder')}
                />
              </div>
            </div>

            {tab === 'accepted' ? (
              <MemoryEntryList
                entries={accepted}
                empty={t('memoryPage.acceptedEmpty')}
                mode="accepted"
                busyKey={busyKey}
                onDelete={setDeleteTarget}
              />
            ) : (
              <MemoryEntryList
                entries={candidates}
                empty={t('memoryPage.candidatesEmpty')}
                mode="candidate"
                busyKey={busyKey}
                onApprove={(entry) => void approveCandidate(entry)}
              />
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('memoryPage.deleteTitle')}
        message={t('memoryPage.deleteDescription', { content: deleteTarget?.content.slice(0, 120) ?? '' })}
        confirmLabel={t('memoryPage.deleteConfirm')}
        cancelLabel={t('memoryPage.cancel')}
        variant="destructive"
        onConfirm={deleteAccepted}
        onCancel={() => setDeleteTarget(null)}
        onError={(err) => toast.error(err instanceof Error ? err.message : String(err))}
      />
    </div>
  );
}

function MemoryEntryList({
  entries,
  empty,
  mode,
  busyKey,
  onApprove,
  onDelete,
}: {
  entries: MemorySurfaceEntry[];
  empty: string;
  mode: 'accepted' | 'candidate';
  busyKey: string | null;
  onApprove?: (entry: MemorySurfaceEntry) => void;
  onDelete?: (entry: MemorySurfaceEntry) => void;
}) {
  const { t } = useTranslation('agents');
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 py-12 text-center text-xs text-muted-foreground" data-testid={`memory-${mode}-empty`}>
        {mode === 'accepted' ? <Database className="h-5 w-5 opacity-60" aria-hidden="true" /> : <Clock3 className="h-5 w-5 opacity-60" aria-hidden="true" />}
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid={`memory-${mode}-list`}>
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="rounded-xl border border-border/60 bg-surface-input px-4 py-3"
          data-testid={`memory-${mode}-item`}
          data-memory-key={entry.key}
          data-model-visible={entry.modelVisible ? 'true' : 'false'}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={entry.state === 'accepted' ? 'success' : 'warning'}>
                  {entry.state === 'accepted' ? t('memoryPage.accepted') : t('memoryPage.candidate')}
                </Badge>
                <Badge variant={entry.modelVisible ? 'default' : 'outline'}>
                  {entry.modelVisible
                    ? <><Eye className="mr-1 h-3 w-3" aria-hidden="true" />{t('memoryPage.modelVisibleBadge')}</>
                    : <><EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />{t('memoryPage.notModelVisibleBadge')}</>}
                </Badge>
                <span className="text-2xs text-muted-foreground">{entry.sourceLabel} · {entry.scope}{entry.scopeKey ? ` · ${entry.scopeKey}` : ''}</span>
              </div>
              <p className="break-words text-sm leading-6 text-foreground">{entry.content}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                <span>{formatDate(entry.createdAt)}</span>
                <span>{t('memoryPage.evidenceCount', { count: entry.evidenceCount })}</span>
                <span>{t('memoryPage.stateLabel')}: {entry.stateLabel}</span>
                <span>{t('memoryPage.sensitivityLabel')}: {entry.sensitivity}</span>
                {entry.roleTags.length > 0 && <span>{entry.roleTags.join(', ')}</span>}
              </div>
              {entry.reason && (
                <p className="rounded-md bg-background/60 px-2.5 py-1.5 text-2xs text-muted-foreground">{entry.reason}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {mode === 'accepted' && onDelete && (
                <Button
                  data-testid="memory-delete-button"
                  variant="ghost"
                  size="sm"
                  className="text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
                  onClick={() => onDelete(entry)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t('memoryPage.delete')}
                </Button>
              )}
              {mode === 'candidate' && onApprove && (
                <Button
                  data-testid="memory-approve-button"
                  size="sm"
                  onClick={() => onApprove(entry)}
                  disabled={busyKey === entry.key}
                >
                  {busyKey === entry.key
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  {t('memoryPage.approve')}
                </Button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default MemoryPage;
