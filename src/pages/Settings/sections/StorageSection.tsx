import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { SessionStorageEntry, SessionStorageSnapshot, StorageWorktree } from '@shared/types/session-storage';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SettingsSection, SettingsRow, SettingsCard } from '@/components/settings/primitives/SettingsSection';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useChatStore } from '@/stores/chat';

function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

type Pending = { kind: 'release'; session: SessionStorageEntry } | { kind: 'remove'; tree: StorageWorktree; approval?: PermissionApprovalEvent };

export function StorageSection() {
  const { t } = useTranslation('settings', { keyPrefix: 'storage' });
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<SessionStorageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { const result = await hostApi.sessionStorage.snapshot(); if (alive.current) setSnapshot(result); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [refresh]);
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const sessions = snapshot?.sessions.filter((row) => matches(`${row.label} ${row.workspaceName} ${row.sessionKey}`)) ?? [];
  const worktrees = snapshot?.worktrees.filter((row) => matches(`${row.path} ${row.branch} ${row.repositoryName}`)) ?? [];
  const transcriptSizes = [...new Map(snapshot?.sessions.map((row) => [row.sessionKey, row.disk]) ?? []).values()];
  const openSession = async (session: SessionStorageEntry) => {
    setBusy(true);
    try {
      await useWorkspacesStore.getState().switchWorkspace(session.workspaceId);
      await hostApi.workspaces.saveState({ id: session.workspaceId, activeSessionKey: session.sessionKey });
      await useWorkspacesStore.getState().fetchWorkspaces();
      useChatStore.getState().switchSession(session.sessionKey);
      navigate('/');
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const prepareRemoval = async (tree: StorageWorktree) => {
    setBusy(true); setError(null);
    try {
      const result = await hostApi.sessionStorage.removeWorktree({ workspaceId: tree.repositoryWorkspaceId, path: tree.path });
      if (result.approvalRequired && result.approval) setPending({ kind: 'remove', tree, approval: result.approval });
      else if (!result.success) throw new Error(result.reason || result.stderr || t('operationFailed'));
      else await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const dismiss = () => {
    if (busy) return;
    if (pending?.kind === 'remove' && pending.approval) {
      void hostApi.permissions.decideApproval({ id: pending.approval.id, decision: 'denied' }).catch(() => {});
    }
    setPending(null);
  };
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.kind === 'release') {
        const result = await hostApi.sessionStorage.release({ workspaceId: pending.session.workspaceId, sessionKey: pending.session.sessionKey });
        if (!result.success) throw new Error(t('releasePartial', { count: result.failed }));
        toast.success(t('released', { count: result.released }));
      } else {
        const approvalId = pending.approval?.id;
        if (approvalId) {
          const decision = await hostApi.permissions.decideApproval({ id: approvalId, decision: 'approved' });
          if (!decision.success) throw new Error(t('operationFailed'));
        }
        const result = await hostApi.sessionStorage.removeWorktree({ workspaceId: pending.tree.repositoryWorkspaceId, path: pending.tree.path, approvalId });
        if (result.approvalRequired && result.approval) { setPending({ ...pending, approval: result.approval }); return; }
        if (!result.success) throw new Error(result.reason || result.stderr || t('operationFailed'));
        toast.success(t('removed'));
      }
      setPending(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPending(null); }
    finally { setBusy(false); }
  };
  return <div data-testid="storage-page" className="min-w-0">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 max-w-[280px] bg-surface-input" />
      <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => void refresh()} data-testid="storage-refresh">
        {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{t('refresh')}
      </Button>
    </div>
    {error && <p role="alert" className="mb-4 break-words text-sm text-red-700 dark:text-red-400">{error}</p>}
    {loading && !snapshot && <p role="status" className="py-8 text-sm text-muted-foreground">{t('loading')}</p>}
    {snapshot && <>
      <SettingsSection title={t('overview')} description={t('memoryHint')}>
        <SettingsRow title={t('appMemory')} control={<span className="tabular-nums">{formatStorageBytes(snapshot.applicationMemoryBytes)}</span>} />
        <SettingsRow title={t('sessionFiles')} description={t('sessionFilesHint')} control={<span className="tabular-nums">{transcriptSizes.some((row) => row.partial) ? '≥ ' : ''}{formatStorageBytes(transcriptSizes.reduce((sum, row) => sum + row.bytes, 0))}</span>} />
        <SettingsRow title={t('workingFiles')} description={t('workingFilesHint')} control={<span className="tabular-nums">{snapshot.worktrees.some((row) => row.disk.partial) ? '≥ ' : ''}{formatStorageBytes(snapshot.worktrees.reduce((sum, row) => sum + row.disk.bytes, 0))}</span>} />
      </SettingsSection>
      <SettingsSection title={t('sessions')} description={t('sessionsHint')} testId="storage-sessions">
        {sessions.length === 0 && <SettingsRow title={t('empty')} />}
        {sessions.map((session) => <SettingsRow key={`${session.workspaceId}:${session.sessionKey}`}
          title={<span className="block max-w-[440px] truncate" title={session.label}>{session.label === session.sessionKey ? session.workspaceName : session.label}</span>}
          description={<span className="block break-words">{session.workspaceName} · {session.disk.partial ? '≥ ' : ''}{formatStorageBytes(session.disk.bytes)} · {t('processMemory', { value: formatStorageBytes(session.memoryBytes) })}
            <span className="mt-0.5 block">{t('resources', { terminals: session.terminals, browsers: session.browsers, servers: session.servers })}</span></span>}
          control={<div className="flex flex-wrap items-center justify-end gap-1">
            <Button size="sm" variant="ghost" aria-label={t('openSession')} onClick={() => void openSession(session)} disabled={busy}><ArrowUpRight className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" disabled={busy || session.terminals + session.browsers + session.servers === 0} onClick={() => setPending({ kind: 'release', session })}>{t('release')}</Button>
          </div>} />)}
      </SettingsSection>
      <SettingsSection title={t('worktrees')} description={t('worktreesHint')} testId="storage-worktrees">
        {worktrees.length === 0 && <SettingsRow title={t('empty')} />}
        {worktrees.map((tree) => <SettingsRow key={tree.path} title={<span className="block truncate" title={tree.branch}>{tree.branch || tree.head?.slice(0, 8) || tree.repositoryName}</span>}
          description={<span className="block"><span className="block break-all">{tree.path}</span><span>{tree.disk.partial ? '≥ ' : ''}{formatStorageBytes(tree.disk.bytes)} · {tree.reason?.startsWith('UI_CLEANUP_') ? t('protected.owner') : tree.protection ? t(`protected.${tree.protection}`) : t('idle')}</span></span>}
          control={<Button size="sm" variant="outline" disabled={busy || Boolean(tree.protection)} onClick={() => void prepareRemoval(tree)}>{t('remove')}</Button>} />)}
      </SettingsSection>
      <SettingsCard><SettingsRow title={t('archived')} description={t('archivedHint')} control={<Button variant="ghost" size="sm" onClick={() => navigate('/settings/archived')}>{t('manage')}<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Button>} /></SettingsCard>
      <p className="mt-3 text-xs text-muted-foreground">{t('measuredAt', { time: new Date(snapshot.measuredAt).toLocaleTimeString() })}</p>
    </>}
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-md space-y-4 rounded-2xl border border-border/60 bg-surface-modal p-5 shadow-xl">
        <div className="space-y-2"><DialogTitle className="text-base font-medium">{pending?.kind === 'release' ? t('releaseTitle') : t('removeTitle')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">{pending?.kind === 'release' ? t('releaseHint') : t('removeHint')}</DialogDescription></div>
        <p className="break-all text-sm text-muted-foreground">{pending?.kind === 'release' ? pending.session.label : pending?.tree.path}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={dismiss}>{t('cancel')}</Button><Button disabled={busy} onClick={() => void confirm()} data-testid="storage-confirm">{busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{pending?.kind === 'release' ? t('release') : t('remove')}</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
