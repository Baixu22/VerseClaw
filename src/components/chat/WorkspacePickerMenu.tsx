import { Check, Folder, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { basenameFromPath } from '@/lib/git-ui';
import { cn } from '@/lib/utils';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { ReactNode } from 'react';

export type WorkspacePickerMenuProps = {
  profiles: Array<Pick<WorkspaceProfile, 'id' | 'name' | 'rootPath'> & { lastOpenedAt?: number }>;
  activeWorkspaceId?: string | null;
  onSelect: (workspaceId: string) => void | Promise<unknown>;
  onPickFolder?: () => void | Promise<unknown>;
  className?: string;
  menuTestId?: string;
  rowTestId?: string;
  pickFolderTestId?: string;
  emptyTestId?: string;
  extraActions?: ReactNode;
};

export function WorkspacePickerMenu({
  profiles,
  activeWorkspaceId,
  onSelect,
  onPickFolder,
  className,
  menuTestId,
  rowTestId,
  pickFolderTestId,
  emptyTestId,
  extraActions,
}: WorkspacePickerMenuProps) {
  const { t } = useTranslation('chat');
  const sortedProfiles = [...profiles].sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0));

  return (
    <div className={cn('codex-header-menu', className)} data-testid={menuTestId} role="menu">
      <div className="codex-header-menu__label">{t('workspace.recent')}</div>
      {sortedProfiles.length > 0 ? sortedProfiles.map((profile) => {
        const name = profile.name || basenameFromPath(profile.rootPath);
        const selected = profile.id === activeWorkspaceId;
        return (
          <button
            key={profile.id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className="codex-header-menu__item"
            data-testid={rowTestId}
            data-selected={selected ? 'true' : undefined}
            onClick={() => void onSelect(profile.id)}
          >
            <span className="codex-header-menu__icon"><Folder className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">{name}</span>
              <span className="block truncate font-mono text-2xs text-muted-foreground">{profile.rootPath}</span>
            </span>
            <span className={cn('codex-header-menu__check', !selected && 'opacity-0')} aria-hidden="true">
              <Check className="h-4 w-4" />
            </span>
          </button>
        );
      }) : (
        <div className="codex-header-menu__label" data-testid={emptyTestId}>{t('workspace.noRecent')}</div>
      )}

      {(extraActions || onPickFolder) && <hr className="codex-header-menu__sep" />}
      {extraActions}
      {onPickFolder && (
        <button
          type="button"
          className="codex-header-menu__item codex-header-menu__item--muted"
          data-testid={pickFolderTestId}
          onClick={() => void onPickFolder()}
        >
          <span className="codex-header-menu__icon"><FolderPlus className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1 truncate">{t('workspace.chooseNew')}</span>
        </button>
      )}
    </div>
  );
}
