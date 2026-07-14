/**
 * 抄写自 browser-ai-assistant-master/src/side-panel/components/BoundaryChoiceDialog.tsx。
 *
 * 适配点：
 * 1. `../../shared/browserControl` → `@shared/agent-browser/browser-control`
 *    （BrowserControlBoundaryChoiceRequestMessage 已抄入该文件）
 * 2. 样式类名 → ClawX 设计 token（src/styles/globals.css）：
 *    - `dialog-overlay` → `bg-black/30 dark:bg-black/60`（modal scrim backdrop）
 *    - `boundary-choice-dialog` → `bg-surface-modal`（raised panel）
 *    - `boundary-choice-item-active` → `bg-black/5 dark:bg-white/10`（selected state）
 *    - `ui-button-primary/ui-button-secondary` → 复用 `Button` 组件
 *    - `ui-input` → `bg-surface-input`（recessed input）
 * 3. 文案 → react-i18next `browser` 命名空间，全 locale 覆盖（en/zh/ja/ru）
 * 4. 风险等级颜色 → 设计 token 状态色（text-{green|yellow|red}-700 dark:text-…-400）
 *
 * 逻辑结构（useState + toggleChoice + submit + cancel）原样抄写。
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BrowserControlBoundaryChoiceRequestMessage } from '@shared/agent-browser/browser-control';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BoundaryChoiceDialogProps {
  request: BrowserControlBoundaryChoiceRequestMessage;
  onSubmit: (selectedChoiceIds: string[], otherText?: string) => void;
}

const RISK_CLASS: Record<string, string> = {
  low: 'text-green-700 dark:text-green-400',
  medium: 'text-yellow-700 dark:text-yellow-400',
  high: 'text-red-700 dark:text-red-400',
};

export function BoundaryChoiceDialog({ request, onSubmit }: BoundaryChoiceDialogProps) {
  const { t } = useTranslation('browser');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const remaining = request.expiresAt - Date.now();
    const timer = window.setTimeout(() => {
      if (!cancelled) setExpired(true);
    }, Math.max(0, remaining));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request.expiresAt]);
  const hasSelection = selectedIds.length > 0 || otherText.trim().length > 0;

  const toggleChoice = (choiceId: string) => {
    if (submitting) {
      return;
    }
    setSelectedIds((current) => {
      if (request.allowMultiple) {
        return current.includes(choiceId) ? current.filter((id) => id !== choiceId) : [...current, choiceId];
      }
      return current.includes(choiceId) ? [] : [choiceId];
    });
  };

  const submit = () => {
    if (submitting || expired || !hasSelection) {
      return;
    }
    setSubmitting(true);
    const trimmedOther = otherText.trim();
    onSubmit(selectedIds, trimmedOther || undefined);
  };

  const cancel = () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    onSubmit([], t('boundaryChoice.cancelled'));
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" aria-hidden="true" />
      <section
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-surface-modal p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={t('boundaryChoice.dialogLabel')}
      >
        <div className="mb-4">
          <h2 className="font-serif text-lg font-normal tracking-tight text-foreground">{request.question}</h2>
          {request.reason && (
            <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p>
          )}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          {request.choices.map((choice) => {
            const isSelected = selectedIds.includes(choice.id);
            return (
              <button
                key={choice.id}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-border bg-black/5 dark:bg-white/10'
                    : 'border-border bg-surface-input hover:bg-black/5 dark:hover:bg-white/5',
                )}
                type="button"
                aria-pressed={isSelected}
                disabled={submitting}
                onClick={() => toggleChoice(choice.id)}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{choice.title}</span>
                  <span className={cn('text-2xs font-medium uppercase', RISK_CLASS[choice.risk ?? ''] ?? 'text-muted-foreground')}>
                    {choice.risk}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">{choice.description}</span>
                <span className="text-2xs text-muted-foreground">
                  {t('boundaryChoice.grantsCount', { count: choice.grants.length })}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mb-4 flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{t('boundaryChoice.other')}</span>
          <textarea
            className="rounded-md border border-border bg-surface-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={otherText}
            disabled={submitting}
            onChange={(event) => setOtherText(event.target.value)}
            placeholder={t('boundaryChoice.otherPlaceholder')}
            rows={2}
          />
        </label>

        {expired && (
          <p className="mb-3 text-sm text-yellow-700 dark:text-yellow-400">{t('boundaryChoice.expired')}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" disabled={submitting} onClick={cancel}>
            {t('boundaryChoice.cancel')}
          </Button>
          <Button
            variant="default"
            type="button"
            disabled={submitting || expired || !hasSelection}
            onClick={submit}
          >
            {t('boundaryChoice.submit')}
          </Button>
        </div>
      </section>
    </>
  );
}
