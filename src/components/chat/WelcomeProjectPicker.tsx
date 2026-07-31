import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Folder, FolderPlus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { basenameFromPath } from '@/lib/git-ui';
import { useWorkspacesStore } from '@/stores/workspaces';

/**
 * The clickable project name inside the chat empty-state title, plus the
 * workspace picker it opens.
 *
 * Ported from the FakeCoding reference empty state, where the active project is
 * named inline in the hero heading and doubles as the project switcher. The
 * shell (`.codex-composer-menu`) and the dotted-underline trigger
 * (`.codex-welcome-project`) carry the measured geometry; see
 * styles/codex-welcome-hero.css for where those numbers come from.
 *
 * The reference's menu also offers "new project" and "work without a project".
 * Neither maps onto a ClawX workspace, so the footer instead reuses the
 * existing folder picker — the same action the composer header already exposes.
 */
export type WelcomeProjectPickerProps = {
  /** Opens the native directory chooser. Wired to Chat's handlePickWorkspaceFolder. */
  onPickFolder?: () => void | Promise<unknown>;
  disabled?: boolean;
};

export function WelcomeProjectPicker({ disabled = false, onPickFolder }: WelcomeProjectPickerProps) {
  const { t } = useTranslation('chat');
  const profiles = useWorkspacesStore((state) => state.profiles);
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const activeWorkspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const switchWorkspace = useWorkspacesStore((state) => state.switchWorkspace);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Same expression the composer header uses, so both surfaces always agree on
  // what this workspace is called.
  const displayName = activeWorkspace?.name
    || basenameFromPath(activeWorkspace?.rootPath)
    || 'clawx';

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [profiles],
  );

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sortedProfiles;
    return sortedProfiles.filter((profile) => {
      const name = profile.name || basenameFromPath(profile.rootPath);
      return name.toLowerCase().includes(query) || profile.rootPath.toLowerCase().includes(query);
    });
  }, [search, sortedProfiles]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const handleSelect = (id: string) => {
    close();
    if (id === activeWorkspaceId) return;
    void switchWorkspace(id);
  };

  return (
    <span className="codex-welcome-project-wrap" ref={rootRef}>
      <button
        type="button"
        className="codex-welcome-project"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('welcome.changeProject', { projectName: displayName })}
        disabled={disabled}
        title={activeWorkspace?.rootPath}
        data-testid="welcome-project-trigger"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {displayName}
      </button>

      {open && (
        <div
          className="codex-composer-menu codex-composer-menu--welcome-project"
          role="listbox"
          aria-label={t('welcome.changeProject', { projectName: displayName })}
          data-testid="welcome-project-menu"
        >
          <div className="codex-welcome-project-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              placeholder={t('welcome.projectSearch')}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="codex-welcome-project-list">
            {filteredProfiles.map((profile) => {
              const name = profile.name || basenameFromPath(profile.rootPath);
              const selected = profile.id === activeWorkspaceId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="codex-composer-menu__item"
                  title={profile.rootPath}
                  data-testid="welcome-project-item"
                  onClick={() => handleSelect(profile.id)}
                >
                  <span className="codex-composer-menu__icon">
                    <Folder aria-hidden="true" />
                  </span>
                  <span className="codex-welcome-project-name">{name}</span>
                  <span className="codex-composer-menu__check" data-hidden={selected ? undefined : 'true'}>
                    <Check aria-hidden="true" />
                  </span>
                </button>
              );
            })}

            {filteredProfiles.length === 0 && (
              <div className="codex-welcome-project-empty" data-testid="welcome-project-empty">
                {search.trim() ? t('welcome.projectEmpty') : t('workspace.noRecent')}
              </div>
            )}
          </div>

          {onPickFolder && (
            <div className="codex-welcome-project-footer">
              <button
                type="button"
                className={cn('codex-composer-menu__item')}
                data-testid="welcome-project-pick-folder"
                onClick={() => {
                  close();
                  void onPickFolder();
                }}
              >
                <span className="codex-composer-menu__icon">
                  <FolderPlus aria-hidden="true" />
                </span>
                <span className="codex-welcome-project-name">{t('workspace.chooseNew')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
