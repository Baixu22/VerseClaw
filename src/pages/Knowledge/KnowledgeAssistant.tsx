import { useEffect, useRef } from 'react';
import { AlertTriangle, Bot, Check, Copy, FilePlus2, Loader2, RotateCcw, SendHorizontal, ShieldCheck, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { KnowledgeLibrarianGroundedAnswer } from '@/lib/knowledge-librarian';
import type { KnowledgeLibrarianCitation, KnowledgeLibrarianMessage } from './knowledge-view-utils';

export function KnowledgeAssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children, ...props }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary"
              {...props}
            >
              {children}
            </a>
          );
        },
        code({ className, children, ...props }) {
          const block = /language-/u.test(className ?? '');
          return block ? (
            <code className={cn('font-mono text-xs', className)} {...props}>
              {children}
            </code>
          ) : (
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10" {...props}>
              {children}
            </code>
          );
        },
        pre({ children, ...props }) {
          return (
            <pre
              className="my-3 max-w-full overflow-x-auto rounded-lg border border-black/10 bg-black/[0.04] p-3 text-xs leading-5 dark:border-white/10 dark:bg-white/[0.06]"
              {...props}
            >
              {children}
            </pre>
          );
        },
        ul({ children, ...props }) {
          return <ul className="my-2 list-disc space-y-1 pl-5" {...props}>{children}</ul>;
        },
        ol({ children, ...props }) {
          return <ol className="my-2 list-decimal space-y-1 pl-5" {...props}>{children}</ol>;
        },
        p({ children, ...props }) {
          return <p className="my-2 first:mt-0 last:mb-0" {...props}>{children}</p>;
        },
        table({ children, ...props }) {
          return (
            <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
              <table className="w-full min-w-max border-collapse text-xs" {...props}>{children}</table>
            </div>
          );
        },
        th({ children, ...props }) {
          return <th className="border-b border-black/10 bg-black/[0.04] px-2 py-1.5 text-left font-semibold dark:border-white/10 dark:bg-white/[0.06]" {...props}>{children}</th>;
        },
        td({ children, ...props }) {
          return <td className="border-t border-black/5 px-2 py-1.5 align-top dark:border-white/10" {...props}>{children}</td>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function KnowledgeAssistantMessage({
  message,
  copied,
  busy,
  copyLabel,
  copiedLabel,
  roleLabel,
  userLabel,
  citationsLabel,
  sectionLabels,
  actionLabels,
  onCopy,
  onOpenCitation,
  onSaveDraft,
  onCreateErrorExperience,
  onSendToSteward,
}: {
  message: KnowledgeLibrarianMessage;
  copied: boolean;
  busy: boolean;
  copyLabel: string;
  copiedLabel: string;
  roleLabel: string;
  userLabel: string;
  citationsLabel: string;
  sectionLabels: {
    answer: string;
    sources: string;
    unknowns: string;
    nextAction: string;
    retrieval: string;
    query: string;
    corpus: string;
    roleTag: string;
    resultCount: string;
    selectedSources: string;
    confidence: string;
    groundingStatus: Record<KnowledgeLibrarianGroundedAnswer['groundingStatus'], string>;
  };
  actionLabels: {
    saveDraft: string;
    createErrorExperience: string;
    sendToSteward: string;
  };
  onCopy: (content: string) => void;
  onOpenCitation: (citation: KnowledgeLibrarianCitation) => void;
  onSaveDraft: (answer: KnowledgeLibrarianGroundedAnswer) => void;
  onCreateErrorExperience: (answer: KnowledgeLibrarianGroundedAnswer) => void;
  onSendToSteward: (answer: KnowledgeLibrarianGroundedAnswer) => void;
}) {
  const isUser = message.role === 'user';
  const label = isUser ? userLabel : roleLabel;
  const groundedAnswer = !isUser ? message.groundedAnswer : undefined;
  return (
    <article
      className={cn(
        'group flex gap-2.5',
        isUser ? 'justify-end' : 'justify-start',
      )}
      data-testid={`knowledge-librarian-message-${message.role}`}
    >
      {!isUser ? (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-surface-input text-muted-foreground dark:border-white/10">
          <Bot className="h-3.5 w-3.5" />
        </div>
      ) : null}
      <div className={cn('min-w-0 max-w-[88%]', isUser && 'flex flex-col items-end')}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{label}</span>
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
            onClick={() => onCopy(message.content)}
            aria-label={copied ? copiedLabel : copyLabel}
            title={copied ? copiedLabel : copyLabel}
            data-testid="knowledge-librarian-copy"
          >
            {copied ? <Check className="h-3 w-3 text-green-700 dark:text-green-400" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
        <div
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-sm leading-6',
            isUser
              ? 'border border-black/10 bg-surface-input text-foreground dark:border-white/10'
              : 'text-foreground',
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : groundedAnswer ? (
            <div className="space-y-3" data-testid="knowledge-librarian-grounded-answer">
              {/* Restraint: the grounding badge only earns space when grounding is
                  imperfect. A fully grounded answer says so by simply citing sources. */}
              {groundedAnswer.groundingStatus !== 'grounded' ? (
                <Badge variant="outline" className="border-black/10 bg-black/5 text-[10px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/10">
                  {sectionLabels.groundingStatus[groundedAnswer.groundingStatus]}
                </Badge>
              ) : null}
              <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-headings:font-serif prose-headings:font-normal prose-a:text-primary" data-testid="knowledge-librarian-answer-section">
                <KnowledgeAssistantMarkdown content={groundedAnswer.answer} />
              </div>
              <section data-testid="knowledge-librarian-sources-section">
                <div className="grid gap-1.5">
                  {groundedAnswer.sources.map((source, index) => (
                    <button
                      key={`${message.id}:source:${source.lookup}`}
                      type="button"
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => onOpenCitation({ lookup: source.lookup, title: source.title, excerpt: source.excerpt, path: source.path, score: source.score })}
                      data-testid="knowledge-librarian-source"
                    >
                      <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{source.title}</span>
                      <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">{source.path || source.lookup}</span>
                    </button>
                  ))}
                  {groundedAnswer.sources.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{groundedAnswer.unknowns[0]}</p>
                  ) : null}
                </div>
              </section>
              {/* Restraint: unknowns, next actions and the retrieval trace are
                  diagnostics. They stay reachable, but folded by default so the
                  answer itself is what the reader meets first. */}
              <details className="group text-xs" data-testid="knowledge-librarian-retrieval-inspector">
                <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  {sectionLabels.retrieval}
                </summary>
                <div className="mt-2 space-y-2 border-l border-black/10 pl-3 dark:border-white/10">
                  {groundedAnswer.unknowns.length > 0 ? (
                    <div data-testid="knowledge-librarian-unknowns-section">
                      <div className="text-[11px] font-medium text-foreground/70">{sectionLabels.unknowns}</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-5 text-muted-foreground">
                        {groundedAnswer.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {groundedAnswer.nextActions.length > 0 ? (
                    <div data-testid="knowledge-librarian-next-action-section">
                      <div className="text-[11px] font-medium text-foreground/70">{sectionLabels.nextAction}</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-5 text-muted-foreground">
                        {groundedAnswer.nextActions.map((action) => <li key={action}>{action}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <dl className="grid gap-1 text-[11px] text-muted-foreground">
                    <div className="flex justify-between gap-3"><dt>{sectionLabels.query}</dt><dd className="min-w-0 truncate font-mono">{groundedAnswer.retrieval.query}</dd></div>
                    <div className="flex justify-between gap-3"><dt>{sectionLabels.resultCount}</dt><dd>{groundedAnswer.retrieval.resultCount}</dd></div>
                    <div className="flex justify-between gap-3"><dt>{sectionLabels.confidence}</dt><dd>{Math.round(groundedAnswer.confidence * 100)}%</dd></div>
                  </dl>
                </div>
              </details>
              <div className="flex flex-wrap gap-1" data-testid="knowledge-librarian-candidate-actions">
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => onSaveDraft(groundedAnswer)} data-testid="knowledge-librarian-save-draft">
                  <FilePlus2 className="mr-1.5 h-3 w-3" />
                  {actionLabels.saveDraft}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => onCreateErrorExperience(groundedAnswer)} data-testid="knowledge-librarian-create-error-experience">
                  <Wrench className="mr-1.5 h-3 w-3" />
                  {actionLabels.createErrorExperience}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => onSendToSteward(groundedAnswer)} data-testid="knowledge-librarian-send-steward">
                  <ShieldCheck className="mr-1.5 h-3 w-3" />
                  {actionLabels.sendToSteward}
                </Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-headings:font-serif prose-headings:font-normal prose-a:text-primary">
              <KnowledgeAssistantMarkdown content={message.content} />
            </div>
          )}
        </div>
        {message.citations && message.citations.length > 0 && !groundedAnswer ? (
          <div className="mt-1.5 grid gap-0.5" data-testid="knowledge-librarian-citations" aria-label={citationsLabel}>
            {message.citations.map((citation, index) => (
              <button
                key={`${message.id}:${citation.lookup}`}
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => onOpenCitation(citation)}
                data-testid="knowledge-librarian-citation"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{citation.title}</span>
                <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">{citation.lookup}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function KnowledgeAssistantPromptInput({
  value,
  onChange,
  onSubmit,
  disabled,
  running,
  placeholder,
  askLabel,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  running: boolean;
  placeholder: string;
  askLabel: string;
  hint: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [value]);

  return (
    <form
      className="rounded-xl border border-black/10 bg-surface-input px-3 py-2 transition-colors focus-within:border-primary/35 dark:border-white/10"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      data-testid="knowledge-librarian-composer"
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        data-testid="knowledge-librarian-question"
        className="min-h-[48px] resize-none border-0 bg-transparent px-0 py-1 text-sm shadow-none focus-visible:ring-0"
        disabled={disabled}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] leading-4 text-muted-foreground">{hint}</p>
        <Button type="submit" size="sm" className="h-8 rounded-lg px-3" disabled={disabled || !value.trim()} data-testid="knowledge-librarian-ask">
          {running ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="mr-2 h-3.5 w-3.5" />}
          {askLabel}
        </Button>
      </div>
    </form>
  );
}

export function KnowledgeAssistantErrorCard({
  error,
  retryLabel,
  dismissLabel,
  title,
  onRetry,
  onDismiss,
}: {
  error: string;
  retryLabel: string;
  dismissLabel: string;
  title: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
      data-testid="knowledge-librarian-error"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <p className="mt-1 break-words text-xs leading-5">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 rounded-md px-2 text-[11px]" onClick={onRetry} data-testid="knowledge-librarian-retry">
              <RotateCcw className="mr-1.5 h-3 w-3" />
              {retryLabel}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px]" onClick={onDismiss}>
              {dismissLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
