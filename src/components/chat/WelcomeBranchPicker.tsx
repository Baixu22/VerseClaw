import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import type { GitBranch as GitBranchInfo } from '@shared/types/git';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ComposerPopover } from './ComposerPopover';

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
  const [switching, setSwitching] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void hostApi.git.branches().then((result) => {
      if (cancelled) return;
      setBranches(result.success ? result.branches ?? [] : []);
      setLoadFailed(!result.success);
    }).catch(() => {
      if (!cancelled) setLoadFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, retry]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  const filteredBranches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? branches.filter((entry) => entry.name.toLowerCase().includes(query)) : branches;
  }, [branches, search]);

  const checkout = async (entry: GitBranchInfo) => {
    if (entry.current || loading || switching || disabled) return;
    setSwitching(true);
    try {
      const result = await hostApi.git.checkoutBranch({ name: entry.name });
      if (!result.success) {
        toast.error(t('welcome.branchSwitchFailed', { error: result.reason || result.stderr || entry.name }));
        return;
      }
      close();
      await onChanged?.();
    } catch (error) {
      toast.error(t('welcome.branchSwitchFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSwitching(false);
    }
  };

  const label = detached ? t('composer.git.detached') : branch || t('composer.git.unknownBranch');

  return (
    <span className="codex-welcome-branch-wrap" ref={rootRef}>
      <Tooltip>
        <TooltipTrigger asChild>
      <button
        ref={triggerRef}
        type="button"
        className={cn('codex-welcome-context__subcontrol', open && 'is-open')}
        aria-haspopup="dialog"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={t('welcome.branchPickerTitle')}
        disabled={disabled || switching}
        data-testid="welcome-branch-trigger"
        onClick={() => {
          if (open) { close(); return; }
          setLoading(true);
          setLoadFailed(false);
          setBranches([]);
          setOpen(true);
        }}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="codex-welcome-context__branch-name">{label}</span>
        {loading || switching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />}
      </button>
        </TooltipTrigger>
        <TooltipContent side="top" collisionPadding={8}>{label}</TooltipContent>
      </Tooltip>
      <ComposerPopover open={open} align="right" id={menuId} className="codex-composer-menu--welcome-branch" role="dialog" aria-label={t('welcome.branchPickerTitle')} data-testid="welcome-branch-menu">
          <div className="codex-welcome-project-search">
            <Search aria-hidden="true" />
            <input ref={searchRef} aria-label={t('welcome.branchSearch')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('welcome.branchSearch')} onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              rootRef.current?.querySelector<HTMLButtonElement>('[data-branch-option]:not(:disabled)')?.focus();
            }} />
          </div>
          <div className="codex-welcome-project-list">
            {filteredBranches.map((entry) => (
              <button key={entry.name} type="button" data-branch-option aria-current={entry.current || undefined} title={entry.name} className="codex-composer-menu__item" disabled={entry.current || loading || switching || disabled} onClick={() => void checkout(entry)} data-testid={`welcome-branch-item-${entry.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`}>
                <span className="codex-composer-menu__icon"><GitBranch aria-hidden="true" /></span>
                <span className="codex-welcome-project-name">{entry.name}</span>
                {entry.current ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
              </button>
            ))}
            {loading ? <div className="codex-welcome-project-empty" role="status">{t('welcome.branchLoading')}</div>
              : loadFailed ? <div className="codex-welcome-project-empty" role="alert">
                {t('welcome.branchLoadFailed')}
                <button type="button" className="codex-composer-menu__item" onClick={() => {
                  setLoading(true);
                  setLoadFailed(false);
                  setRetry((value) => value + 1);
                }}>{t('retry')}</button>
              </div>
                : filteredBranches.length === 0 && <div className="codex-welcome-project-empty">{t('welcome.branchEmpty')}</div>}
          </div>
      </ComposerPopover>
    </span>
  );
}
