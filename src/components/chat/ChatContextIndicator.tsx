import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TokenTag from '@lobehub/ui/es/chat/TokenTag/TokenTag';
import { Brain, ChevronRight, X } from 'lucide-react';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { MemoryInjectionReceiptEntry, SessionCompactionStatus } from '@shared/host-api/contract';
import type { ContextSourceGroup } from '@shared/types/context-display';
import type { WorkspaceContextRange } from '@shared/types/workspace';

type Props = {
  sessionKey: string;
  sessionId?: string;
  contextRange?: WorkspaceContextRange | null;
  compactionStatus?: SessionCompactionStatus | null;
  onOpen?: () => void;
};

const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const full = (value: number) => new Intl.NumberFormat().format(value);

function SourceRow({ label, chars, color, share, children }: { label: string; chars: number | null; color: string; share: number | null; children?: ReactNode }) {
  const { t } = useTranslation('chat');
  return <div className="chat-context-source-row">
    <span className={cn('size-2.5 rounded-sm', color)} aria-hidden="true" />
    <span className="min-w-0" title={label}>{label}</span>
    <span className="tabular-nums text-muted-foreground" title={chars == null ? undefined : t('contextDisplay.chars', { value: full(chars) })}>{chars == null ? '—' : t('contextDisplay.chars', { value: compact(chars) })}</span>
    <span className="text-right font-medium tabular-nums" title={t('contextDisplay.sourceShare')}>{share == null ? '—' : `${Math.round(share * 10) / 10}%`}</span>
    {children ?? <span aria-hidden="true" />}
  </div>;
}

function SourceGroup({ label, group, color, share }: { label: string; group: ContextSourceGroup; color: string; share: number | null }) {
  const { t } = useTranslation('chat');
  if (!group.entries.length) return <SourceRow label={label} chars={group.chars} color={color} share={share} />;
  return <details className="group" data-testid="chat-context-source-group">
    <summary className="cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <SourceRow label={`${label} · ${group.totalEntries}`} chars={group.chars} color={color} share={share}>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
      </SourceRow>
    </summary>
    <ul className="mb-2 ml-5 space-y-2 border-l border-border pl-3" data-testid="chat-context-source-entries">
      {group.entries.map((entry, index) => <li key={`${entry.name}:${index}`} className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-all font-mono">{entry.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{entry.chars == null ? t('contextDisplay.unknown') : full(entry.chars)}</span>
        </div>
        {entry.path && <p className="mt-0.5 break-all text-muted-foreground">{entry.path}</p>}
        {entry.status !== 'included' && <p className="mt-0.5 text-amber-700 dark:text-amber-400">{t(`contextDisplay.fileStatus.${entry.status}`)}{entry.status === 'truncated' && entry.rawChars != null ? ` · ${t('contextDisplay.originalChars', { value: full(entry.rawChars) })}` : ''}</p>}
      </li>)}
      {group.totalEntries > group.entries.length && <li className="text-muted-foreground">{t('contextDisplay.moreEntries', { count: group.totalEntries - group.entries.length })}</li>}
    </ul>
  </details>;
}

/** A nonmodal, hoverable context report; only memory receipts are loaded on demand. */
export function ChatContextIndicator({ sessionKey, sessionId, contextRange, compactionStatus, onOpen }: Props) {
  const { t, i18n } = useTranslation('chat');
  const timestamp = (value: number) => new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const id = useId();
  const portal = useOverlayPortalContainer();
  const { triggerRef, layerRef, open, setOpen, style, placement } = usePopover<HTMLButtonElement>({ gap: 8, align: 'right', fitViewport: true, preferredSide: 'top' });
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [receiptResult, setReceiptResult] = useState<{ key: string; state: 'ready' | 'error'; receipts: MemoryInjectionReceiptEntry[] } | null>(null);
  const [retry, setRetry] = useState(0);
  const matchingRange = contextRange?.sessionKey === sessionKey && (!sessionId || !contextRange.sessionId || contextRange.sessionId === sessionId) ? contextRange : null;
  const composition = matchingRange?.composition && (!sessionId || matchingRange.composition.sessionId === sessionId) ? matchingRange.composition : null;
  const reportGeneratedAt = composition?.generatedAt;
  const receiptKey = JSON.stringify([sessionKey, sessionId, reportGeneratedAt, retry]);
  const receiptState = receiptResult?.key === receiptKey ? receiptResult.state : 'loading';
  const receipts = receiptResult?.key === receiptKey && receiptResult.state === 'ready' ? receiptResult.receipts : [];
  const used = matchingRange?.usageSource === 'unavailable' ? null : matchingRange?.usedTokens ?? null;
  const limit = matchingRange?.maxTokens ?? null;
  const truncatedMessageCount = matchingRange ? compactionStatus?.truncatedMessageCount ?? matchingRange.truncatedMessageCount ?? null : null;
  const validUsed = used != null && Number.isFinite(used) && used >= 0 ? used : null;
  const validLimit = limit != null && Number.isFinite(limit) && limit > 0 ? limit : null;
  const utilisation = validUsed != null && validLimit != null ? validUsed / validLimit : null;
  const percent = utilisation == null ? null : Math.round(utilisation * 100);
  const status = utilisation == null ? 'unknown' : utilisation >= 0.9 ? 'overload' : utilisation >= 0.7 ? 'low' : 'normal';
  const sourceParts = composition ? [
    { id: 'currentTurn', chars: composition.currentTurnChars, color: 'bg-blue-500' },
    { id: 'tools', chars: composition.tools.chars, color: 'bg-orange-500' },
    { id: 'runtimeContext', chars: composition.runtimeContextChars, color: 'bg-teal-500' },
    { id: 'instructions', chars: composition.instructionsChars, color: 'bg-amber-500' },
    { id: 'skills', chars: composition.skills.chars, color: 'bg-zinc-400' },
    { id: 'workspaceFiles', chars: composition.workspaceFiles.chars, color: 'bg-zinc-500' },
  ] : [];
  const sourceTotalChars = sourceParts.reduce((total, part) => total + (part.chars ?? 0), 0);
  const sourceShare = (chars: number | null) => chars != null && sourceTotalChars > 0 ? chars / sourceTotalChars * 100 : null;
  const clearTimer = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  const close = useCallback(() => { clearTimer(); setPinned(false); setOpen(false); }, [clearTimer, setOpen]);
  const reveal = () => { clearTimer(); onOpen?.(); setOpen(true); };
  const leave = () => {
    clearTimer();
    if (pinned) return;
    hoverTimer.current = setTimeout(() => {
      if (!triggerRef.current?.contains(document.activeElement) && !layerRef.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  useDismissOnOutside({ open, onDismiss: close, onEscape: () => { triggerRef.current?.focus(); close(); }, refs: [triggerRef, layerRef] });
  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open || reportGeneratedAt == null) return;
    let cancelled = false;
    void hostApi.memory.injectionReceipts({ sessionKey, limit: 8 }).then(result => {
      if (cancelled) return;
      if (!result.success) throw new Error('receipt_read_failed');
      // Receipts are timestamped session history; they have no report/generation identity.
      setReceiptResult({ key: receiptKey, state: 'ready', receipts: result.receipts.filter(receipt => receipt.sessionKey === sessionKey).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8) });
    }).catch(() => { if (!cancelled) setReceiptResult({ key: receiptKey, state: 'error', receipts: [] }); });
    return () => { cancelled = true; };
  }, [open, sessionKey, reportGeneratedAt, receiptKey]);

  const label = t('contextDisplay.ariaLabel', { used: validUsed == null ? t('contextDisplay.unknown') : full(validUsed), max: validLimit == null ? t('contextDisplay.unknown') : full(validLimit) });
  const color = status === 'overload' ? 'text-red-700 dark:text-red-400' : status === 'low' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground';
  return <>
    <button
      ref={triggerRef}
      type="button"
      className={cn('chat-context-token-tag codex-composer-control', color, open && 'is-active')}
      data-testid="chat-context-indicator"
      data-status={status}
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      aria-haspopup="dialog"
      onMouseEnter={() => { clearTimer(); hoverTimer.current = setTimeout(reveal, 200); }}
      onMouseLeave={leave}
      onFocus={reveal}
      onBlur={event => { if (!pinned && !layerRef.current?.contains(event.relatedTarget as Node | null)) close(); }}
      onClick={event => {
        clearTimer();
        onOpen?.();
        setPinned(!pinned);
        setOpen(!pinned);
        if (!pinned && event.detail === 0) window.requestAnimationFrame(() => layerRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
      }}
    >
      <TokenTag as="span" role="presentation" tabIndex={-1} aria-hidden="true" size={16} value={utilisation == null ? 0 : validUsed!} maxValue={validLimit ?? 1} showInfo={false} className="pointer-events-none" style={{ height: 18, width: 18, color: 'inherit', background: 'transparent' }} />
    </button>
    {open && createPortal(<div
      ref={layerRef}
      id={id}
      role="dialog"
      aria-label={t('contextDisplay.title')}
      style={style}
      className="chat-context-details flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-modal text-xs text-foreground shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
      data-testid="chat-context-details"
      data-side={placement}
      onMouseEnter={clearTimer}
      onMouseLeave={leave}
      onBlur={event => { if (!pinned && !layerRef.current?.contains(event.relatedTarget as Node | null) && event.relatedTarget !== triggerRef.current) close(); }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="flex-1 text-base font-normal">{t('contextDisplay.title')}</h2>
        {percent != null && <span className={cn('tabular-nums', color)}>{percent}%</span>}
        <button type="button" className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:hover:bg-white/10" aria-label={t('contextDisplay.close')} onClick={() => { triggerRef.current?.focus(); close(); }}><X className="size-3.5" aria-hidden="true" /></button>
      </header>
      <div className="chat-context-usage-summary shrink-0">
        <p className="font-medium tabular-nums" data-testid="chat-context-usage">{t('contextDisplay.usedOfTotal', { used: validUsed == null ? '—' : full(validUsed), max: validLimit == null ? '—' : full(validLimit) })}</p>
        {validUsed != null && validLimit != null && <p className="text-muted-foreground">{t('contextDisplay.remaining', { value: full(Math.max(0, validLimit - validUsed)) })}</p>}
      </div>
      <div className="chat-context-source-scroll min-h-0 overflow-y-auto" data-testid="chat-context-source-scroll">
      <div className="space-y-1 px-4 pb-2">
        {matchingRange?.modelRef && <p className="break-all text-muted-foreground">{matchingRange.modelRef}</p>}
        {validUsed == null && <p className="text-muted-foreground">{t('contextDisplay.usagePending')}</p>}
        <p className="text-muted-foreground">{t(matchingRange?.usageSource === 'last-request' ? 'contextDisplay.lastRequest' : 'contextDisplay.currentSnapshot')}</p>
      </div>
      <section className="border-t border-border px-3 py-2" aria-label={t('contextDisplay.composition')}>
        <div className="flex items-center justify-between gap-3 px-1 py-1"><h3 className="font-medium">{t('contextDisplay.composition')}</h3><span className="text-xs text-muted-foreground">{t('contextDisplay.sourceShare')}</span></div>
        {composition ? <>
          <div className="chat-context-composition-line mx-1 mb-2 mt-1 flex overflow-hidden rounded-full bg-muted" data-testid="chat-context-composition-bar" role="img" aria-label={t('contextDisplay.sourceShare')}>
            {sourceParts.filter(part => part.chars != null && part.chars > 0).map(part => <span key={part.id} className={part.color} style={{ width: `${sourceShare(part.chars) ?? 0}%` }} title={`${t(`contextDisplay.${part.id}`)}: ${full(part.chars!)}`} />)}
          </div>
          <p className="px-1 pb-2 text-xs text-muted-foreground">{t('contextDisplay.sourceTotal', { value: full(sourceTotalChars) })}</p>
          <SourceRow label={t('contextDisplay.currentTurn')} chars={composition.currentTurnChars} color="bg-blue-500" share={sourceShare(composition.currentTurnChars)} />
          <SourceGroup label={t('contextDisplay.tools')} group={composition.tools} color="bg-orange-500" share={sourceShare(composition.tools.chars)} />
          <SourceRow label={t('contextDisplay.runtimeContext')} chars={composition.runtimeContextChars} color="bg-teal-500" share={sourceShare(composition.runtimeContextChars)} />
          <SourceRow label={t('contextDisplay.instructions')} chars={composition.instructionsChars} color="bg-amber-500" share={sourceShare(composition.instructionsChars)} />
          <SourceGroup label={t('contextDisplay.skills')} group={composition.skills} color="bg-zinc-400" share={sourceShare(composition.skills.chars)} />
          <SourceGroup label={t('contextDisplay.workspaceFiles')} group={composition.workspaceFiles} color="bg-zinc-500" share={sourceShare(composition.workspaceFiles.chars)} />
          <p className="px-1 py-2 leading-5 text-muted-foreground">{t('contextDisplay.characterMeasurement')}</p>
          <p className="px-1 pb-2 text-muted-foreground">{t(composition.source === 'estimate' ? 'contextDisplay.estimatedReport' : 'contextDisplay.runtimeReport')} · {timestamp(composition.generatedAt)}{composition.modelRef && composition.modelRef !== matchingRange?.modelRef ? ` · ${composition.modelRef}` : ''}</p>
        </> : <p className="px-1 py-2 leading-5 text-muted-foreground" data-testid="chat-context-composition-pending">{t('contextDisplay.compositionPending')}</p>}
        {matchingRange?.retainedMessageCount != null && <p className="px-1 py-2 text-muted-foreground">{t('contextDisplay.loadedMessages', { count: matchingRange.retainedMessageCount })}</p>}
        {truncatedMessageCount != null && truncatedMessageCount > 0 && <p className="px-1 pb-2 text-amber-700 dark:text-amber-400" data-testid="chat-context-hidden-messages">{t('contextDisplay.hiddenMessages', { count: truncatedMessageCount })}</p>}
      </section>
      {composition && <section className="border-t border-border px-4 py-3" aria-label={t('contextDisplay.memory')}>
        <h3 className="mb-2 flex items-center gap-2 font-medium"><Brain className="size-3.5 text-muted-foreground" aria-hidden="true" />{t('contextDisplay.memory')}</h3>
        <p className="mb-2 text-xs leading-5 text-muted-foreground">{t('contextDisplay.memoryScope')}</p>
        {receiptState === 'loading' && <p role="status" className="text-muted-foreground">{t('contextDisplay.memoryLoading')}</p>}
        {receiptState === 'error' && <p role="status" className="flex items-center justify-between gap-2 text-muted-foreground">{t('contextDisplay.memoryError')}<button type="button" className="rounded-md px-2 py-1 text-foreground hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-ring dark:hover:bg-white/10" onClick={() => setRetry(value => value + 1)}>{t('contextDisplay.retry')}</button></p>}
        {receiptState === 'ready' && !receipts.length && <p className="text-muted-foreground">{t('contextDisplay.memoryNone')}</p>}
        {receiptState === 'ready' && receipts.map((receipt, index) => <details key={`${receipt.source}:${receipt.createdAt}:${index}`} className="group mb-2" data-testid="chat-context-memory-receipt">
          <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><ChevronRight className="mt-0.5 size-3 shrink-0 group-open:rotate-90" aria-hidden="true" /><span className="min-w-0 flex-1 break-all">{receipt.source}</span><span className="shrink-0 text-muted-foreground">{t('contextDisplay.memorySelected', { count: receipt.selected.length })}</span></summary>
          <div className="ml-5 mt-2 space-y-1 break-all text-muted-foreground"><p>{timestamp(receipt.createdAt)} · {t('contextDisplay.chars', { value: full(receipt.budgetCharsApplied) })}</p>{receipt.selected.map((ref, refIndex) => <p className="font-mono" key={refIndex}>{ref}</p>)}{receipt.omitted.length > 0 && <p>{t('contextDisplay.memoryOmitted', { count: receipt.omitted.length })}</p>}</div>
        </details>)}
      </section>}
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-3 leading-5 text-muted-foreground">
        {composition && <button type="button" className="mb-2 rounded-md bg-black/5 px-2.5 py-1.5 font-medium text-foreground hover:bg-black/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-white/10 dark:hover:bg-white/20" data-testid="chat-context-detailed-breakdown" onClick={() => { clearTimer(); setPinned(true); layerRef.current?.querySelectorAll<HTMLDetailsElement>('details').forEach(detail => { detail.open = true; }); }}>{t('contextDisplay.detailedBreakdown')}</button>}
        <p className="text-xs">{t(pinned ? 'contextDisplay.pinned' : 'contextDisplay.pinHint')}</p>
      </footer>
    </div>, portal ?? document.body)}
  </>;
}
