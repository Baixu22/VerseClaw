/**
 * Archived sessions — Settings page.
 *
 * Structure, toolbar layout, grouping behaviour and date formatting are ported
 * from the FakeCoding reference app's 已归档任务 page
 * (FakeCoding-main/web/src/components/SettingsDialog.tsx `ArchivedPage`), which
 * reproduces the official Codex settings screen. Styles live in
 * src/styles/codex-settings-archived.css.
 *
 * Data differs from the source: FakeCoding groups `tasks` by `projectId`, ClawX
 * groups `SessionArchiveEntry` by `originalWorkspaceId` resolved against the
 * workspace store. This page replaces the old sidebar ArchiveModal, so it keeps
 * ClawX's per-row permanent delete, which the reference design does not have.
 */
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Archive, Loader2, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { SessionArchiveEntry } from '@shared/types/workspace';

type ArchivedView = 'allSessions' | 'allWorkspaces';

export function ArchivedSection() {
  const { t } = useTranslation(['chat', 'common', 'settings']);
  const {
    archivedSessions,
    archivedSessionsLoading,
    loadArchivedSessions,
    restoreSession,
    permanentDeleteSession,
  } = useChatStore(useShallow((s) => ({
    archivedSessions: s.archivedSessions,
    archivedSessionsLoading: s.archivedSessionsLoading,
    loadArchivedSessions: s.loadArchivedSessions,
    restoreSession: s.restoreSession,
    permanentDeleteSession: s.permanentDeleteSession,
  })));
  const workspaces = useWorkspacesStore((s) => s.profiles);

  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SessionArchiveEntry | null>(null);
  // CDP bodyText: "所有任务 所有项目" — view toggle beside the search box.
  const [view, setView] = useState<ArchivedView>('allWorkspaces');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  useEffect(() => {
    setConfirmEmpty(false);
    void loadArchivedSessions();
  }, [loadArchivedSessions]);

  // newest first
  const sorted = useMemo(
    () => [...archivedSessions].sort((a, b) => b.archivedAt - a.archivedAt),
    [archivedSessions],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q
      ? sorted.filter((entry) => (entry.label || entry.sessionKey).toLowerCase().includes(q))
      : sorted),
    [sorted, q],
  );

  // group by originating workspace, preserving the filtered (newest-first) order
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; entries: SessionArchiveEntry[] }>();
    for (const entry of filtered) {
      const key = entry.originalWorkspaceId || '__none__';
      if (!map.has(key)) {
        const workspace = workspaces.find((w) => w.id === entry.originalWorkspaceId);
        map.set(key, {
          id: key,
          name: workspace?.name || t('chat:archive.ungrouped'),
          entries: [],
        });
      }
      map.get(key)!.entries.push(entry);
    }
    return [...map.values()];
  }, [filtered, workspaces, t]);

  const handleRestore = async (sessionKey: string) => {
    setPendingKey(sessionKey);
    try {
      await restoreSession(sessionKey);
    } finally {
      setPendingKey(null);
    }
  };

  const handlePermanentDelete = async (sessionKey: string) => {
    setPendingKey(sessionKey);
    try {
      await permanentDeleteSession(sessionKey);
    } finally {
      setPendingKey(null);
    }
  };

  const handleEmptyAll = async () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setPendingKey('__empty_all__');
    try {
      await Promise.all(sorted.map((entry) => permanentDeleteSession(entry.sessionKey)));
    } finally {
      setPendingKey(null);
      setConfirmEmpty(false);
    }
  };

  const renderRow = (entry: SessionArchiveEntry) => (
    <div
      key={entry.sessionKey}
      className="sp-archived-row"
      data-testid={`settings-archived-item-${entry.sessionKey}`}
    >
      <div className="sp-archived-meta">
        <div className="sp-archived-title">{entry.label || entry.sessionKey}</div>
        <div className="sp-archived-date">{formatArchivedDate(entry.archivedAt)}</div>
      </div>
      <div className="sp-archived-actions">
        <Button
          data-testid={`settings-archived-restore-${entry.sessionKey}`}
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={pendingKey === entry.sessionKey}
          onClick={() => void handleRestore(entry.sessionKey)}
        >
          <RotateCcw className="h-3 w-3" />
          {t('chat:archive.restore')}
        </Button>
        <Button
          data-testid={`settings-archived-delete-${entry.sessionKey}`}
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={pendingKey === entry.sessionKey}
          onClick={() => setDeleteTarget(entry)}
        >
          <Trash2 className="h-3 w-3" />
          {t('chat:archive.deletePermanently')}
        </Button>
      </div>
    </div>
  );

  return (
    <div data-testid="settings-archived-section">
      <ConfirmDialog open={deleteTarget !== null} title={t('chat:archive.deleteTitle')}
        message={t('chat:archive.permanentDeleteMessage', { label: deleteTarget?.label || deleteTarget?.sessionKey })}
        confirmLabel={t('chat:archive.deletePermanently')} cancelLabel={t('common:actions.cancel')} variant="destructive"
        onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
          if (!deleteTarget) return;
          await handlePermanentDelete(deleteTarget.sessionKey); setDeleteTarget(null);
        }} />
      {sorted.length > 0 && (
        <div className="sp-archived-title-row justify-end">
          <Button
            data-testid="settings-archived-empty-all"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={pendingKey !== null}
            onClick={() => void handleEmptyAll()}
          >
            {confirmEmpty ? t('chat:archive.emptyAllConfirm') : t('chat:archive.emptyAll')}
          </Button>
        </div>
      )}

      <div className="sp-archived-toolbar">
        <div className="sp-archived-search">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            type="text"
            data-testid="settings-archived-search"
            placeholder={t('chat:archive.searchPlaceholder')}
            aria-label={t('chat:archive.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="sp-segmented" role="group" aria-label={t('chat:archive.viewLabel')}>
          {(['allSessions', 'allWorkspaces'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`settings-archived-view-${option}`}
              className={view === option ? 'active' : undefined}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {t(`chat:archive.view.${option}`)}
            </button>
          ))}
        </div>
      </div>

      {archivedSessionsLoading && sorted.length === 0 ? (
        <div className="sp-archived-empty flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('chat:archive.loading')}
        </div>
      ) : sorted.length === 0 ? (
        <div data-testid="settings-archived-empty" className="sp-archived-empty flex items-center gap-2">
          <Archive className="h-4 w-4 opacity-50" />
          {t('chat:archive.empty')}
        </div>
      ) : filtered.length === 0 ? (
        <div data-testid="settings-archived-no-match" className="sp-archived-empty">
          {t('chat:archive.noMatches')}
        </div>
      ) : view === 'allSessions' ? (
        <div className="sp-archived-groups" data-testid="settings-archived-list">
          <div className="sp-archived-card">{filtered.map(renderRow)}</div>
        </div>
      ) : (
        <div className="sp-archived-groups" data-testid="settings-archived-list">
          {groups.map((group) => (
            <div key={group.id} className="sp-archived-card" data-testid={`settings-archived-group-${group.id}`}>
              <div className="sp-archived-group-header">
                <span className="sp-archived-group-name">{group.name}</span>
                <span className="sp-archived-group-count">
                  {t('chat:archive.groupCount', { count: group.entries.length })}
                </span>
              </div>
              {group.entries.map(renderRow)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Locale-aware archive timestamp (source hardcodes a zh-CN format). */
function formatArchivedDate(ms: number): string {
  if (!ms) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '-';
  }
}
