import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { basenameFromPath } from '@/lib/git-ui';
import { useWorkspacesStore } from '@/stores/workspaces';
import { toastUserError } from '@/lib/user-error';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { WorkspacePickerMenu } from './WorkspacePickerMenu';

export type WelcomeProjectPickerProps = {
  onPickFolder?: () => void | Promise<unknown>;
  onSelect?: (workspaceId: string) => void | Promise<unknown>;
  disabled?: boolean;
};

/** Project selection sits beside execution settings in the composer tray. */
export function WelcomeProjectPicker({ disabled = false, onPickFolder, onSelect }: WelcomeProjectPickerProps) {
  const { t } = useTranslation('chat');
  const profiles = useWorkspacesStore(state => state.profiles);
  const activeWorkspace = useWorkspacesStore(state => state.activeWorkspace);
  const switchWorkspace = useWorkspacesStore(state => state.switchWorkspace);
  const { open, setOpen, triggerRef, layerRef, style } = usePopover<HTMLButtonElement>({ align: 'left', gap: 6, fitViewport: true });
  const overlay = useOverlayPortalContainer();
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismissOnOutside({ open, onDismiss: close, onEscape: () => { close(); triggerRef.current?.focus(); }, refs: [triggerRef, layerRef] });
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => layerRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, layerRef]);
  const displayName = activeWorkspace?.name || basenameFromPath(activeWorkspace?.rootPath) || t('workspace.chooseNew');
  return <span className="composer-context-project">
    <button ref={triggerRef} type="button" className="composer-context-chip" aria-expanded={open} aria-haspopup="menu"
      aria-label={t('welcome.changeProject', { projectName: displayName })} title={activeWorkspace?.rootPath}
      disabled={disabled} data-testid="welcome-project-trigger" onClick={() => setOpen(!open)}>
      <Folder aria-hidden="true" /><span>{displayName}</span>
    </button>
    {open && createPortal(<div ref={layerRef} style={style} className="composer-context-menu composer-context-project-menu">
      <WorkspacePickerMenu profiles={profiles} activeWorkspaceId={activeWorkspace?.id}
        onSelect={id => { close(); if (id !== activeWorkspace?.id) void Promise.resolve((onSelect ?? switchWorkspace)(id)).catch(toastUserError); }}
        onPickFolder={onPickFolder ? () => { close(); return onPickFolder(); } : undefined}
        menuTestId="welcome-project-menu" rowTestId="welcome-project-item" pickFolderTestId="welcome-project-pick-folder" emptyTestId="welcome-project-empty" />
    </div>, overlay ?? document.body)}
  </span>;
}
