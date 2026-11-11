import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { basenameFromPath } from '@/lib/git-ui';
import { useWorkspacesStore } from '@/stores/workspaces';
import { WorkspacePickerMenu } from './WorkspacePickerMenu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toastUserError } from '@/lib/user-error';
import { SessionWorkspacePicker } from './SessionWorkspacePicker';
import type { GitWorktree } from '@shared/types/git';

/**
 * The active project token in the chat empty state, plus the workspace picker
 * it opens.
 *
 * Ported from the FakeCoding reference empty state, where the active project
 * doubles as the project switcher. The reference names it inline in a hero
 * heading; this build has no heading (the watermark is the display type), so
 * the trigger is an unboxed control in the context row under the composer,
 * beside the branch selector. The shared header menu shell
 * carries the measured geometry — see styles/codex-welcome-hero.css.
 *
 * The reference's menu also offers "new project" and "work without a project".
 * Neither maps onto a ClawX workspace, so the footer instead reuses the
 * existing folder picker — the same action the composer header already exposes.
 */
export type WelcomeProjectPickerProps = {
  /** Opens the native directory chooser. Wired to Chat's handlePickWorkspaceFolder. */
  onPickFolder?: () => void | Promise<unknown>;
  onSelect?: (workspaceId: string) => void | Promise<unknown>;
  disabled?: boolean;
  onSelectWorktree?: (tree: GitWorktree) => Promise<void>;
};

export function WelcomeProjectPicker({ disabled = false, onPickFolder, onSelect, onSelectWorktree }: WelcomeProjectPickerProps) {
  const { t } = useTranslation('chat');
  const profiles = useWorkspacesStore((state) => state.profiles);
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const activeWorkspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const switchWorkspace = useWorkspacesStore((state) => state.switchWorkspace);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Same expression the composer header uses, so both surfaces always agree on
  // what this workspace is called.
  const displayName = activeWorkspace?.name
    || basenameFromPath(activeWorkspace?.rootPath)
    || 'clawx';

  const close = useCallback(() => {
    setOpen(false);
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
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close, open]);

  const handleSelect = (id: string) => {
    close();
    if (id === activeWorkspaceId) return;
    void Promise.resolve((onSelect ?? switchWorkspace)(id)).catch(toastUserError);
  };

  return (
    <span className="codex-welcome-project-wrap" ref={rootRef}>
      <Tooltip>
        <TooltipTrigger asChild>
      <button
        ref={triggerRef}
        type="button"
        className="codex-welcome-context__subcontrol codex-welcome-context__subcontrol--project codex-welcome-project-token"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('welcome.changeProject', { projectName: displayName })}
        disabled={disabled}
        data-testid="welcome-project-trigger"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="codex-welcome-context__name">{displayName}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
        </TooltipTrigger>
        {activeWorkspace?.rootPath && (
          <TooltipContent side="top" collisionPadding={8} className="max-w-xs break-all text-xs">
            {activeWorkspace.rootPath}
          </TooltipContent>
        )}
      </Tooltip>

      {open && (
        <WorkspacePickerMenu
          profiles={profiles}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={handleSelect}
          onPickFolder={onPickFolder ? () => {
            close();
            return onPickFolder();
          } : undefined}
          className="codex-header-menu--welcome-project"
          menuTestId="welcome-project-menu"
          rowTestId="welcome-project-item"
          pickFolderTestId="welcome-project-pick-folder"
          emptyTestId="welcome-project-empty"
          extraActions={onSelectWorktree ? <SessionWorkspacePicker embedded disabled={disabled} onSelect={async tree => { await onSelectWorktree(tree); close(); }} /> : undefined}
        />
      )}
    </span>
  );
}