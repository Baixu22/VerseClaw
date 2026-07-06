/**
 * Session Search Modal
 *
 * Spotlight-style search overlay triggered from the sidebar search input.
 * Uses a fixed centered overlay. Keep centering independent from animation
 * transforms so the panel cannot drift toward the sidebar trigger.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, CornerDownLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ChatSession } from '@/stores/chat';
import { getSessionActivityMs } from '@/components/layout/session-buckets';
import type { WorkspaceProfile } from '@shared/types/workspace';

const LAYOUT_ID = 'sidebar-session-search';

const MODAL_MAX_HEIGHT = 460;

export interface SessionSearchModalProps {
  open: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  currentSessionKey: string;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  workspaces: WorkspaceProfile[];
  agentNameById: Record<string, string>;
  onSwitch: (key: string) => void;
}

type SearchResult = {
  session: ChatSession;
  label: string;
  activityMs: number;
  workspaceName?: string;
  workgroupName?: string;
};

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function getSessionLabel(
  session: ChatSession,
  sessionLabels: Record<string, string>,
): string {
  return (
    sessionLabels[session.key]
    ?? session.label
    ?? session.derivedTitle
    ?? session.displayName
    ?? session.lastMessagePreview
    ?? session.key
  );
}

function formatRelative(ms: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!ms) return '';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return t('chat:sidebar.searchRelativeNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('chat:sidebar.searchRelativeMinutes', { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t('chat:sidebar.searchRelativeHours', { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t('chat:sidebar.searchRelativeDays', { count: diffDay });
  return new Date(ms).toLocaleDateString();
}

export function SessionSearchModal({
  open,
  onClose,
  sessions,
  currentSessionKey,
  sessionLabels,
  sessionLastActivity,
  workspaces,
  agentNameById,
  onSwitch,
}: SessionSearchModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when modal opens. Query/selection are reset by remount
  // (parent passes a fresh `key` when opening).
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open]);

  // Build a flat searchable list (current agent only)
  const results = useMemo<SearchResult[]>(() => {
    const currentAgentId = getAgentIdFromSessionKey(currentSessionKey);
    const sessionToWorkspace = new Map<string, string>();
    const sessionToWorkgroup = new Map<string, string>();
    for (const ws of workspaces) {
      for (const key of Object.keys(ws.sessionStates ?? {})) sessionToWorkspace.set(key, ws.name);
      if (ws.activeSessionKey) sessionToWorkspace.set(ws.activeSessionKey, ws.name);
      for (const binding of Object.values(ws.agentBindings ?? {})) {
        if (binding.sessionKey) sessionToWorkspace.set(binding.sessionKey, ws.name);
      }
      const workgroupById = new Map((ws.sessionFolders ?? []).map((folder) => [folder.id, folder.name]));
      for (const [sessionKey, folderId] of Object.entries(ws.sessionFolderAssignments ?? {})) {
        const workgroupName = workgroupById.get(folderId);
        if (workgroupName) sessionToWorkgroup.set(sessionKey, workgroupName);
      }
    }

    const list = sessions
      .filter((s) => getAgentIdFromSessionKey(s.key) === currentAgentId)
      .map((session) => {
        const label = getSessionLabel(session, sessionLabels);
        const activityMs = getSessionActivityMs(session, sessionLastActivity);
        const workspaceName = sessionToWorkspace.get(session.key);
        const workgroupName = sessionToWorkgroup.get(session.key);
        return { session, label, activityMs, workspaceName, workgroupName };
      })
      .sort((a, b) => b.activityMs - a.activityMs);

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.session.key.toLowerCase().includes(q) ||
        (r.workspaceName?.toLowerCase().includes(q) ?? false) ||
        (r.workgroupName?.toLowerCase().includes(q) ?? false),
    );
  }, [sessions, currentSessionKey, sessionLabels, sessionLastActivity, workspaces, query]);

  // Clamp selection when results change — derive clamped index during render.
  // No effect needed; safeSelectedIndex is always valid for rendering/keyboard.
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  // Scroll selected item into view
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[safeSelectedIndex] as HTMLElement | undefined;
    if (item) {
      const listRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [safeSelectedIndex, open]);

  const handleSelect = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      onSwitch(result.session.key);
      onClose();
    },
    [results, onSwitch, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSelect(safeSelectedIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [results.length, handleSelect, safeSelectedIndex, onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — click to close */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            data-testid="session-search-modal-backdrop"
          />

          <motion.div
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4"
            transition={{
              duration: 0.12,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="pointer-events-auto w-full max-w-[560px] overflow-hidden rounded-lg border border-black/10 bg-surface-modal shadow-lg dark:border-white/10"
              style={{ maxHeight: MODAL_MAX_HEIGHT }}
              data-testid="session-search-modal"
            >
            {/* Search header */}
            <div className="flex items-center gap-2.5 border-b border-black/5 px-3 py-2.5 dark:border-white/10">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t('chat:sidebar.searchModalPlaceholder')}
                aria-label={t('chat:sidebar.searchSessions')}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label={t('chat:sidebar.clearSearch')}
                className="rounded p-1 text-muted-foreground/60 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              className="max-h-[360px] overflow-y-auto p-1"
              role="listbox"
              aria-label={t('chat:sidebar.searchSessions')}
            >
              {results.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-2xs text-muted-foreground/70">
                    {query.trim()
                      ? t('chat:sidebar.searchNoResults')
                      : t('chat:sidebar.searchEmptyHint')}
                  </p>
                </div>
              ) : (
                results.map((result, index) => {
                  const selected = index === safeSelectedIndex;
                  const isCurrent = result.session.key === currentSessionKey;
                  const agentName =
                    agentNameById[getAgentIdFromSessionKey(result.session.key)] || '';
                  return (
                    <button
                      key={result.session.key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-testid={`session-search-result-${index}`}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => handleSelect(index)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                        selected
                          ? 'bg-black/5 text-foreground dark:bg-white/10'
                          : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {result.label}
                          </span>
                          {isCurrent && (
                            <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-2xs font-medium text-primary">
                              {t('chat:sidebar.searchCurrent')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                          {result.workspaceName && (
                            <span className="truncate">{result.workspaceName}</span>
                          )}
                          {result.workspaceName && result.workgroupName && <span>/</span>}
                          {result.workgroupName && (
                            <span className="truncate">{result.workgroupName}</span>
                          )}
                          {(result.workspaceName || result.workgroupName) && agentName && <span>/</span>}
                          {agentName && <span className="truncate">{agentName}</span>}
                          {result.activityMs > 0 && (
                            <>
                              <span>/</span>
                              <span>{formatRelative(result.activityMs, t)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {selected && (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center justify-between border-t border-black/5 px-3 py-1.5 text-2xs text-muted-foreground/60 dark:border-white/10">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-surface-input px-1 py-0.5 font-mono">↑↓</kbd>
                  {t('chat:sidebar.searchHintNavigate')}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-surface-input px-1 py-0.5 font-mono">↵</kbd>
                  {t('chat:sidebar.searchHintSelect')}
                </span>
              </div>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-surface-input px-1 py-0.5 font-mono">esc</kbd>
                {t('chat:sidebar.searchHintClose')}
              </span>
            </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const SESSION_SEARCH_LAYOUT_ID = LAYOUT_ID;
