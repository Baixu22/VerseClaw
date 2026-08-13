import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import {
  AlertCircle,
  Quote,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

/*
 * F6 note: `BranchPicker` (multi-draft switcher) and `ToolFallbackCard`
 * (degraded tool card) were removed from this file. Their metadata never had a
 * producer, so neither rendered a single frame in production. Recover
 * BranchPicker from commit ac5a06830 if a regenerate feature lands.
 */

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
