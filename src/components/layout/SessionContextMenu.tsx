/**
 * Conversation context menu — right-click surface for a sidebar session row.
 *
 * Why a menu at all: the row's hover strip is a 22px-per-button budget parked on
 * top of the title. Every action added there costs title width and adds one more
 * thing to aim at, which is how the strip grew to five buttons and started
 * colliding with the row's own status marks. Actions that are occasional
 * (migrate, fork, hand off, copy paths) belong behind a deliberate gesture; the
 * strip keeps only the ones worth a single click.
 *
 * Two things are load-bearing here:
 *
 *  1. It PORTALS to <body>. The sidebar scroller clips popovers
 *     (`.task-collection-list` / `.project-tasks` carry overflow for the
 *     collapse animation), which is the same reason the move menu portals.
 *  2. "Migrate workstream" is a PAGE of this menu, not a submenu. A nested
 *     popover needs its own flip/collision math and a hover-intent timer; a
 *     second page needs neither and cannot end up off-screen on its own.
 *
 * Styling reuses the `.codex-dropdown` recipe (src/styles/codex-sidebar.css) so
 * this menu is indistinguishable from the organize / project / footer menus.
 *
 * It opens two ways with one body: right-click (anchored at the pointer) and
 * the row's visible ⋯ button (anchored under the button, right-aligned). The ⋯
 * button is what makes the menu discoverable; right-click is the shortcut.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderInput,
  GitBranch,
  Link2,
  Mail,
  MailOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import type { SessionFolder } from '@shared/types/workspace';
import { workstreamAccent } from './session-buckets';

/** Fixed width so the open menu can be flipped inside the viewport. */
const MENU_WIDTH = 208;
/** Keep the menu clear of the viewport edges. */
const VIEWPORT_MARGIN = 8;

export type SessionContextMenuTarget = {
  sessionKey: string;
  label: string;
  /** Anchor in client coordinates — the pointer for a right-click. */
  x: number;
  y: number;
  /** `end`: `x` is the menu's right edge (opened from the row's ⋯ button). */
  align?: 'start' | 'end';
  /** Bottom edge to use when the menu has to open ABOVE its anchor. */
  flipY?: number;
  isPinned: boolean;
  isUnread: boolean;
  /** Null when no project claims the session (nothing to migrate or copy). */
  workspaceId: string | null;
  workspacePath?: string;
  folders: SessionFolder[];
  currentFolderId: string | null;
};

export interface SessionContextMenuProps {
  target: SessionContextMenuTarget;
  onClose: () => void;
  onRename: (sessionKey: string, label: string) => void;
  onTogglePinned: (sessionKey: string) => void;
  onToggleUnread: (sessionKey: string) => void;
  onMoveToFolder: (sessionKey: string, folderId: string | null) => void;
  onCreateFolderAndMove: (sessionKey: string, name: string) => void;
  onFork: (sessionKey: string) => void;
  onHandoff: (sessionKey: string) => void;
  onCopyWorkPath: (sessionKey: string) => void;
  onCopySessionId: (sessionKey: string) => void;
  onArchive: (sessionKey: string, label: string) => void;
  onDelete: (sessionKey: string, label: string) => void;
}

export function SessionContextMenu({
  target,
  onClose,
  onRename,
  onTogglePinned,
  onToggleUnread,
  onMoveToFolder,
  onCreateFolderAndMove,
  onFork,
  onHandoff,
  onCopyWorkPath,
  onCopySessionId,
  onArchive,
  onDelete,
}: SessionContextMenuProps) {
  const { t } = useTranslation(['chat', 'common']);
  const menuRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<'root' | 'move'>('root');
  const [streamDraft, setStreamDraft] = useState<string | null>(null);
  /* Horizontal placement needs no measurement — the width is fixed. */
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      target.align === 'end' ? target.x - MENU_WIDTH : target.x,
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    ),
  );

  /*
   * Vertical placement is CORRECTED ON THE NODE, not stored in state: the menu's
   * height depends on how many workstreams the project has and whether the
   * inline "new workstream" input is open, so it is measured after commit rather
   * than estimated from a row count. Writing `style.top` here (instead of
   * setState) keeps this a one-pass layout fix with no cascading render.
   */
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const { offsetHeight } = element;
    const maxTop = window.innerHeight - offsetHeight - VIEWPORT_MARGIN;
    const flippedTop = (target.flipY ?? target.y) - offsetHeight;
    // Prefer opening downward from the pointer; flip above it when that would
    // overflow and the flipped position actually fits.
    const top = target.y <= maxTop
      ? target.y
      : Math.max(VIEWPORT_MARGIN, flippedTop >= VIEWPORT_MARGIN ? flippedTop : maxTop);
    element.style.top = `${top}px`;
  }, [page, streamDraft, target.flipY, target.y]);

  /* Keyboard: the menu takes focus when it opens and hands it back on Escape,
     so ⋯ → arrows → Enter works without the pointer. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      // The open row's own ⋯ toggles the menu in its click handler; closing it
      // here first would make that click re-open it.
      if ((event.target as Element).closest?.('.sidebar-session-context-menu,.sidebar-session-more-trigger[aria-expanded="true"]')) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      returnFocusRef.current?.focus?.({ preventScroll: true });
    };
    addEventListener('pointerdown', closeOnOutside);
    addEventListener('keydown', closeOnEscape);
    return () => {
      removeEventListener('pointerdown', closeOnOutside);
      removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const { sessionKey } = target;
  const canMigrate = target.workspaceId != null;

  const renderRootPage = () => (
    <>
      {canMigrate && (
        <button
          type="button"
          role="menuitem"
          data-testid="sidebar-session-context-move"
          className="codex-dropdown__item"
          onClick={() => setPage('move')}
        >
          <span className="codex-dropdown__icon"><FolderInput className="h-4 w-4" /></span>
          <span className="codex-dropdown__text">{t('chat:workgroups.moveTo')}</span>
          <ChevronRight className="codex-dropdown__trailing-chevron" aria-hidden />
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-rename"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onRename(sessionKey, target.label);
        }}
      >
        <span className="codex-dropdown__icon"><Pencil className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('common:sidebar.renameSession')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-unread"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onToggleUnread(sessionKey);
        }}
      >
        <span className="codex-dropdown__icon">
          {target.isUnread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </span>
        <span className="codex-dropdown__text">
          {t(target.isUnread ? 'chat:sidebar.markRead' : 'chat:sidebar.markUnread')}
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-pin"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onTogglePinned(sessionKey);
        }}
      >
        <span className="codex-dropdown__icon">
          {target.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </span>
        <span className="codex-dropdown__text">
          {t(target.isPinned ? 'chat:sidebar.unpinSession' : 'chat:sidebar.pinSession')}
        </span>
      </button>

      <div className="codex-dropdown__sep" />
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-fork"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onFork(sessionKey);
        }}
      >
        <span className="codex-dropdown__icon"><GitBranch className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('chat:sidebar.forkSession')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-handoff"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onHandoff(sessionKey);
        }}
      >
        <span className="codex-dropdown__icon"><Link2 className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('chat:sidebar.handoffSession')}</span>
      </button>

      <div className="codex-dropdown__sep" />
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-copy-path"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onCopyWorkPath(sessionKey);
        }}
      >
        <span className="codex-dropdown__icon"><Copy className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('chat:sidebar.copyWorkPath')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-copy-id"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onCopySessionId(sessionKey);
        }}
      >
        <span className="codex-dropdown__icon"><Copy className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('chat:sidebar.copySessionId')}</span>
      </button>

      <div className="codex-dropdown__sep" />
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-archive"
        className="codex-dropdown__item"
        onClick={() => {
          onClose();
          onArchive(sessionKey, target.label);
        }}
      >
        <span className="codex-dropdown__icon"><Archive className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('chat:sidebar.archiveSession')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-delete"
        className="codex-dropdown__item codex-dropdown__item--danger"
        onClick={() => {
          onClose();
          onDelete(sessionKey, target.label);
        }}
      >
        <span className="codex-dropdown__icon"><Trash2 className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('common:sidebar.deleteSession')}</span>
      </button>
    </>
  );

  const renderMovePage = () => (
    <>
      <button
        type="button"
        className="codex-dropdown__item codex-dropdown__item--back"
        data-testid="sidebar-session-context-move-back"
        onClick={() => {
          setPage('root');
          setStreamDraft(null);
        }}
      >
        <span className="codex-dropdown__icon"><ChevronLeft className="h-4 w-4" /></span>
        <span className="codex-dropdown__text">{t('chat:sidebar.menuBack')}</span>
      </button>
      <div className="codex-dropdown__sep" />
      <button
        type="button"
        role="menuitem"
        data-testid="sidebar-session-context-move-none"
        className={cn('codex-dropdown__item', !target.currentFolderId && 'checked')}
        onClick={() => {
          onClose();
          onMoveToFolder(sessionKey, null);
        }}
      >
        <span className="codex-dropdown__icon" />
        <span className="codex-dropdown__text">{t('chat:workgroups.noWorkgroup')}</span>
        {!target.currentFolderId && <Check className="size-3.5 shrink-0 opacity-70" aria-hidden />}
      </button>
      {target.folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          role="menuitem"
          data-testid={`sidebar-session-context-move-to-${folder.id}`}
          className={cn('codex-dropdown__item', target.currentFolderId === folder.id && 'checked')}
          onClick={() => {
            onClose();
            onMoveToFolder(sessionKey, folder.id);
          }}
        >
          <span className="codex-dropdown__icon">
            <span
              className="ws-menu-dot"
              aria-hidden="true"
              style={{ '--ws-accent': workstreamAccent(folder.id) } as React.CSSProperties}
            />
          </span>
          <span className="codex-dropdown__text">{folder.name}</span>
          {target.currentFolderId === folder.id && (
            <Check className="size-3.5 shrink-0 opacity-70" aria-hidden />
          )}
        </button>
      ))}
      <div className="codex-dropdown__sep" />
      {streamDraft == null ? (
        <button
          type="button"
          role="menuitem"
          data-testid="sidebar-session-context-move-new"
          className="codex-dropdown__item"
          onClick={() => setStreamDraft('')}
        >
          <span className="codex-dropdown__icon"><Plus className="h-4 w-4" /></span>
          <span className="codex-dropdown__text">{t('chat:workgroups.newStream')}</span>
        </button>
      ) : (
        <div className="px-1.5 py-1">
          <Input
            autoFocus
            value={streamDraft}
            placeholder={t('chat:workgroups.namePlaceholder')}
            data-testid="sidebar-session-context-move-new-input"
            onChange={(event) => setStreamDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const name = streamDraft.trim();
                if (!name) return;
                onClose();
                onCreateFolderAndMove(sessionKey, name);
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                setStreamDraft(null);
              }
            }}
            className="h-7 w-full min-w-0 text-2xs"
          />
        </div>
      )}
    </>
  );

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : index <= 0 ? items.length - 1 : index - 1;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={t('chat:sidebar.sessionActions')}
      data-testid={`sidebar-session-context-menu-${sessionKey}`}
      data-align={target.align ?? 'start'}
      className="codex-dropdown sidebar-session-context-menu"
      style={{ top: target.y, left, width: MENU_WIDTH }}
      onKeyDown={moveFocus}
    >
      <div className="codex-dropdown__label sidebar-session-context-menu__title">{target.label}</div>
      {page === 'root' ? renderRootPage() : renderMovePage()}
    </div>,
    document.body,
  );
}
