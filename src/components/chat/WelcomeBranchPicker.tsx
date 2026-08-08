import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import type { GitBranch as GitBranchInfo } from '@shared/types/git';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type WelcomeBranchPickerProps = {
  branch: string;
  detached?: boolean;
  disabled?: boolean;
  onChanged?: () => void | Promise<unknown>;
};

export function WelcomeBranchPicker({ branch, detached = false, disabled = false, onChanged }: WelcomeBranchPickerProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.git.branches();
      setBranches(result.branches ?? []);
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open, refresh]);

  const filteredBranches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? branches.filter((entry) => entry.name.toLowerCase().includes(query)) : branches;
  }, [branches, search]);

  const checkout = async (entry: GitBranchInfo) => {
    if (entry.current || loading || disabled) return;
    setLoading(true);
    try {
      const result = await hostApi.git.checkoutBranch({ name: entry.name });
      if (!result.success) {
        toast.error(t('welcome.branchSwitchFailed', { error: result.reason || branch }));
        return;
      }
      close();
      await onChanged?.();
    } catch (error) {
      toast.error(t('welcome.branchSwitchFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setLoading(false);
    }
  };

  const label = detached ? t('composer.git.detached') : branch;

  return (
    <span className="relative min-w-0" ref={rootRef}>
      <Tooltip>
        <TooltipTrigger asChild>
      <button
        type="button"
        className={cn('codex-welcome-context__subcontrol', open && 'is-open')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('welcome.branchPickerTitle')}
        disabled={disabled}
        data-testid="welcome-branch-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="codex-welcome-context__branch-name">{label}</span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />}
      </button>
        </TooltipTrigger>
        <TooltipContent side="top" collisionPadding={8}>{label}</TooltipContent>
      </Tooltip>
      {open && (
        <div className="codex-composer-menu codex-composer-menu--welcome-branch" role="listbox" data-testid="welcome-branch-menu">
          <div className="codex-welcome-project-search">
            <Search aria-hidden="true" />
            <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('welcome.branchSearch')} />
          </div>
          <div className="codex-welcome-project-list">
            {filteredBranches.map((entry) => (
              <button key={entry.name} type="button" role="option" aria-selected={entry.current} className="codex-composer-menu__item" disabled={entry.current || loading} onClick={() => void checkout(entry)} data-testid={`welcome-branch-item-${entry.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`}>
                <span className="codex-composer-menu__icon"><GitBranch aria-hidden="true" /></span>
                <span className="codex-welcome-project-name">{entry.name}</span>
                {entry.current ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
              </button>
            ))}
            {filteredBranches.length === 0 && <div className="codex-welcome-project-empty">{t('welcome.branchEmpty')}</div>}
          </div>
        </div>
      )}
    </span>
  );
}
