import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  GitBranch,
  Quote,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DotMatrix, type DotMatrixState } from '@/components/assistant-ui/dot-matrix';
import type {
  AssistantBranch,
  AssistantReasoning,
  AssistantStatusDimension,
  AssistantToolFallback,
  AssistantUsageModel,
} from './model';

export function BranchPicker({
  branches,
  storageKey,
  onSelect,
}: {
  branches: AssistantBranch[];
  storageKey: string;
  onSelect: (branch: AssistantBranch | null) => void;
}) {
  const { t } = useTranslation('chat');
  const [index, setIndex] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : 0;
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  });
  const safeIndex = branches.length > 0 ? Math.min(index, branches.length - 1) : 0;

  useEffect(() => {
    const branch = branches[safeIndex] ?? null;
    onSelect(branch);
    if (branches.length > 0) localStorage.setItem(storageKey, String(safeIndex));
  }, [branches, onSelect, safeIndex, storageKey]);

  if (branches.length <= 1) return null;

  const move = (delta: number) => {
    setIndex((current) => (current + delta + branches.length) % branches.length);
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-black/[0.07] bg-background/70 p-1 text-xs text-muted-foreground shadow-sm shadow-black/[0.04] dark:border-white/[0.09] dark:shadow-black/20"
      data-testid="assistant-branch-picker"
    >
      <GitBranch className="h-3.5 w-3.5" />
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        onClick={() => move(-1)}
        aria-label={t('assistantRender.branch.previous')}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-16 px-1 text-center font-mono text-[11px]">
        {t('assistantRender.branch.count', { current: safeIndex + 1, total: branches.length })}
      </span>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        onClick={() => move(1)}
        aria-label={t('assistantRender.branch.next')}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ReasoningPanel({ items }: { items: AssistantReasoning[] }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="w-full rounded-lg border border-black/[0.07] bg-background/60 text-muted-foreground shadow-sm shadow-black/[0.04] dark:border-white/[0.09] dark:shadow-black/20" data-testid="assistant-reasoning-panel">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Brain className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="truncate">{items[0]?.title || t('assistantRender.reasoning.title')}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-black/[0.06] px-3 py-2.5 text-[13px] leading-[1.65] text-muted-foreground dark:border-white/[0.08]">
          {items.map((item) => (
            <p key={item.id} className="whitespace-pre-wrap break-words">{item.summary}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolFallbackCard({ tools }: { tools: AssistantToolFallback[] }) {
  const { t } = useTranslation('chat');
  if (tools.length === 0) return null;
  return (
    <div className="w-full space-y-1.5" data-testid="assistant-tool-fallback">
      {tools.map((tool) => (
        <div
          key={tool.id}
          className={cn(
            'rounded-lg border px-3 py-2 text-[13px] shadow-sm shadow-black/[0.04] dark:shadow-black/20',
            tool.status === 'error' && 'border-destructive/25 bg-destructive/[0.04] text-destructive',
            tool.status === 'running' && 'border-primary/25 bg-background/60 text-foreground',
            tool.status === 'completed' && 'border-black/[0.07] bg-background/60 text-muted-foreground dark:border-white/[0.09]',
          )}
        >
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 truncate font-mono font-medium">{tool.name}</span>
            <span className="ml-auto shrink-0 rounded-md border border-black/[0.05] bg-black/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide dark:border-white/[0.07] dark:bg-white/[0.07]">
              {t(`assistantRender.tool.${tool.status}`)}
            </span>
          </div>
          {tool.summary && <p className="mt-1 line-clamp-2 break-words opacity-80">{tool.summary}</p>}
        </div>
      ))}
    </div>
  );
}

export function AssistantErrorCard({
  title,
  message,
  onDismiss,
}: {
  title: string;
  message: string;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation('chat');
  return (
    <div className="max-w-4xl rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3" data-testid="assistant-error-card">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">{title}</p>
          <p className="mt-1 break-words text-sm text-destructive/90">{message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
            aria-label={t('assistantRender.error.dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function TokenUsageRoll({ usage }: { usage: AssistantUsageModel }) {
  const { t } = useTranslation('chat');
  const percentage = usage.maxTokens ? Math.min(100, Math.round((usage.totalTokens / usage.maxTokens) * 100)) : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-background/85 px-3 py-2 text-xs text-muted-foreground shadow-sm" data-testid="assistant-token-usage-roll">
      <CircleDollarSign className="h-3.5 w-3.5 text-foreground/70" />
      <span className="font-mono text-foreground">{formatCompact(usage.totalTokens)}</span>
      <span>{t('assistantRender.usage.tokens')}</span>
      {percentage != null && (
        <span className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/10">{percentage}%</span>
      )}
      {usage.estimatedCostUsd != null && (
        <span className="font-mono text-[11px]">${usage.estimatedCostUsd.toFixed(4)}</span>
      )}
    </div>
  );
}

export function DotMatrixStatus({ dimensions }: { dimensions: AssistantStatusDimension[] }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background/85 px-2 py-2 shadow-sm" data-testid="assistant-dot-matrix-status">
      {dimensions.map((item) => (
        <span
          key={item.id}
          className={cn(
            'h-2.5 w-2.5 rounded-sm',
            item.state === 'active' && 'bg-primary animate-pulse',
            item.state === 'ok' && 'bg-green-500',
            item.state === 'warning' && 'bg-amber-500',
            item.state === 'error' && 'bg-destructive',
            item.state === 'idle' && 'bg-muted-foreground/25',
          )}
          title={t(`assistantRender.status.${item.id}`, { defaultValue: item.label })}
        />
      ))}
    </div>
  );
}

function resolveAssistantStatusMatrixState(dimensions: AssistantStatusDimension[]): DotMatrixState {
  const byId = new Map(dimensions.map((dimension) => [dimension.id, dimension]));
  if (dimensions.some((dimension) => dimension.state === 'error')) return 'error';
  if (byId.get('tools')?.state === 'active') return 'syncing';
  if (byId.get('run')?.state === 'active') return 'streaming';
  if (byId.get('gateway')?.state === 'warning') return 'connecting';
  if (dimensions.some((dimension) => dimension.state === 'warning')) return 'warning';
  if (dimensions.some((dimension) => dimension.state === 'ok')) return 'success';
  return 'idle';
}

export function AssistantStatusIndicator({ dimensions }: { dimensions: AssistantStatusDimension[] }) {
  const { t } = useTranslation('chat');
  const state = resolveAssistantStatusMatrixState(dimensions);
  return (
    <div
      tabIndex={0}
      className="group/status relative inline-flex items-center"
      data-testid="assistant-status-indicator"
      aria-label={t('assistantRender.statusIndicator.label')}
      title={t('assistantRender.statusIndicator.label')}
    >
      <DotMatrix
        state={state}
        label={t('assistantRender.statusIndicator.label')}
        className="size-4 text-foreground/75"
        data-testid="assistant-status-dot-matrix"
      />
      <div
        className={cn(
          'pointer-events-none absolute bottom-full right-0 z-30 mb-2 translate-y-1 opacity-0',
          'transition-all duration-150 group-hover/status:translate-y-0 group-hover/status:opacity-100',
          'group-focus-within/status:translate-y-0 group-focus-within/status:opacity-100',
        )}
      >
        <DotMatrixStatus dimensions={dimensions} />
      </div>
    </div>
  );
}

export function SelectionQuoteToolbar({
  containerRef,
  onQuote,
}: {
  containerRef: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);

  const updateSelection = useCallback(() => {
    const root = containerRef.current;
    const browserSelection = window.getSelection();
    const text = browserSelection?.toString().trim() ?? '';
    if (!root || !browserSelection || !text || text.length < 2) {
      setSelection(null);
      return;
    }
    const anchor = browserSelection.anchorNode;
    if (!anchor || !root.contains(anchor)) {
      setSelection(null);
      return;
    }
    const range = browserSelection.rangeCount > 0 ? browserSelection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      setSelection(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    setSelection({
      text,
      left: Math.max(8, rect.left - rootRect.left + rect.width / 2),
      top: Math.max(8, rect.top - rootRect.top - 42),
    });
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener('selectionchange', updateSelection);
    window.addEventListener('mouseup', updateSelection);
    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      window.removeEventListener('mouseup', updateSelection);
    };
  }, [updateSelection]);

  if (!selection) return null;
  return (
    <div
      className="absolute z-30 -translate-x-1/2 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-lg"
      style={{ left: selection.left, top: selection.top }}
      data-testid="assistant-selection-quote-toolbar"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-popover-foreground hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => {
          onQuote(selection.text);
          window.getSelection()?.removeAllRanges();
          setSelection(null);
        }}
      >
        <Quote className="h-3.5 w-3.5" />
        {t('assistantRender.quote.action')}
      </button>
    </div>
  );
}
