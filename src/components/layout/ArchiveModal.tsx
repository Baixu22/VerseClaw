/**
 * Archive Modal — recycle bin for archived sessions.
 *
 * Lists sessions the user has archived (renamed `.jsonl` → `.archived.jsonl`
 * on disk). Each entry exposes Restore (move back into the live sessions
 * list) and Permanent Delete (sweep the archived transcript + trajectory
 * artefacts). The header also offers "Empty archive" to permanently delete
 * every entry at once.
 *
 * The modal is a plain Radix Dialog (not a framer-motion layoutId panel)
 * because it is opened from the sidebar footer, not from a shared-element
 * trigger — there is no element to morph from.
 */
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Archive, RotateCcw, Trash2, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chat';

interface ArchiveModalProps {
  open: boolean;
  onClose: () => void;
}

export function ArchiveModal({ open, onClose }: ArchiveModalProps) {
  const { t } = useTranslation(['chat', 'common']);
  const { archivedSessions, archivedSessionsLoading, loadArchivedSessions, restoreSession, permanentDeleteSession } = useChatStore(useShallow((s) => ({
    archivedSessions: s.archivedSessions,
    archivedSessionsLoading: s.archivedSessionsLoading,
    loadArchivedSessions: s.loadArchivedSessions,
    restoreSession: s.restoreSession,
    permanentDeleteSession: s.permanentDeleteSession,
  })));
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmEmpty(false);
      void loadArchivedSessions();
    }
  }, [open, loadArchivedSessions]);

  const sorted = useMemo(() => {
    return [...archivedSessions].sort((a, b) => b.archivedAt - a.archivedAt);
  }, [archivedSessions]);

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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        data-testid="archive-modal"
        className="flex max-h-[80vh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-lg border bg-surface-modal p-0 shadow-lg motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <DialogTitle className="text-sm font-semibold tracking-tight">
              {t('chat:archive.title')}
            </DialogTitle>
            {sorted.length > 0 && (
              <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-2xs text-muted-foreground dark:bg-white/10">
                {sorted.length}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label={t('common:actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {archivedSessionsLoading && sorted.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-2xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('chat:archive.loading')}
            </div>
          ) : sorted.length === 0 ? (
            <div data-testid="archive-modal-empty" className="flex flex-col items-center justify-center gap-1 py-10 text-center">
              <Archive className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">{t('chat:archive.empty')}</p>
            </div>
          ) : (
            <ul className="space-y-0.5" data-testid="archive-modal-list">
              {sorted.map((entry) => (
                <li
                  key={entry.sessionKey}
                  data-testid={`archive-modal-item-${entry.sessionKey}`}
                  className="group flex min-h-12 items-center gap-2 rounded-md px-2 py-1.5 transition-[background-color,opacity,transform] duration-150 hover:bg-black/5 dark:hover:bg-white/5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-reduce:transition-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground/80">
                      {entry.label || entry.sessionKey}
                    </div>
                    <div className="truncate text-2xs text-muted-foreground/70">
                      {new Date(entry.archivedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex min-w-[10.5rem] shrink-0 items-center justify-end gap-0.5">
                    <Button
                      data-testid={`archive-modal-restore-${entry.sessionKey}`}
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-2xs"
                      disabled={pendingKey === entry.sessionKey}
                      onClick={() => void handleRestore(entry.sessionKey)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t('chat:archive.restore')}
                    </Button>
                    <Button
                      data-testid={`archive-modal-delete-${entry.sessionKey}`}
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-2xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      disabled={pendingKey === entry.sessionKey}
                      onClick={() => void handlePermanentDelete(entry.sessionKey)}
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('chat:archive.deletePermanently')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {sorted.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t border-black/5 px-4 py-3 dark:border-white/10">
            <Button
              data-testid="archive-modal-empty-all"
              variant="ghost"
              size="sm"
              className="text-2xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              disabled={pendingKey !== null}
              onClick={() => void handleEmptyAll()}
            >
              {confirmEmpty
                ? t('chat:archive.emptyAllConfirm')
                : t('chat:archive.emptyAll')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
