import { Check, ChevronRight, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodingRunEvidenceEvent, CodingRunView } from '@shared/product-semantics';
import { serializeCodingRunJsonl } from '@shared/product-semantics';
import { Button } from '@/components/ui/button';

export function CodingRunEvidence({
  codingRun,
  events = [],
}: {
  codingRun: CodingRunView;
  events?: readonly CodingRunEvidenceEvent[];
}) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const jsonl = useMemo(() => serializeCodingRunJsonl(codingRun, events), [codingRun, events]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <details
      className="group/diagnostics min-w-0 border-t border-border/50 pt-1"
      data-testid="chat-coding-run-evidence"
      data-coding-run-id={codingRun.codingRunId}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 transition-transform duration-150 group-open/diagnostics:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        {t('turnSummary.codingRun.title')}
      </summary>
      <div className="min-w-0 pb-2 pl-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-2xs text-muted-foreground">
            {t('turnSummary.codingRun.jsonl')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-2xs"
            onClick={() => void handleCopy()}
            data-testid="chat-coding-run-copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t('turnSummary.codingRun.copied') : t('turnSummary.codingRun.copy')}
          </Button>
        </div>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/60 p-2 font-mono text-[10px] leading-4 text-foreground/80">
          {jsonl}
        </pre>
      </div>
    </details>
  );
}
