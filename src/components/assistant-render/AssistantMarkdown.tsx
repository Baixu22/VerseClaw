import { Children, isValidElement, memo, useCallback, useState, type ReactNode } from 'react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type CodeHeaderProps } from '@assistant-ui/react-markdown';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { GitHubCard, isGitHubUrl } from './GitHubCard';
import { ConversationImage } from './resources/ConversationImage';
import { WebsiteLinkCard } from './resources/ResourceCards';

function normalizeLatexDelimiters(input: string): string {
  if (!input || (input.indexOf('\\(') === -1 && input.indexOf('\\[') === -1)) {
    return input;
  }

  const parts = input.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith('```') || part.startsWith('`')) continue;
    let next = part.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`);
    next = next.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`);
    parts[i] = next;
  }
  return parts.join('');
}

// ── Assistant Markdown ──────────────────────────────────────────

/*
 * Code block header. Ported from the reference `markdown-code-toolbar`
 * (FakeCoding web/src/styles.css:8264-8288): 32px min-height, a lowercase
 * language label rather than an uppercase tracked one, and a 24px ghost button.
 * The header and the <pre> below it together form the radius-10 bordered block
 * described by `.markdown-code-block`.
 */
function MarkdownCodeHeader({ language, code }: CodeHeaderProps) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const label = language && language !== 'unknown' ? language : t('markdown.codeBlock');

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div
      className="mt-3.5 flex min-h-8 items-center justify-between gap-3 rounded-t-[10px] border border-b-0 border-conversation-strong bg-black/[0.02] px-2.5 text-xs lowercase text-conversation-tertiary dark:bg-white/[0.02]"
      data-testid="assistant-code-header"
    >
      <span className="min-w-0 truncate font-mono">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-conversation-tertiary transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.06]"
        aria-label={copied ? t('markdown.copiedCode') : t('markdown.copyCode')}
        data-testid="assistant-code-copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
        </TooltipTrigger>
        <TooltipContent side="top">{copied ? t('markdown.copiedCode') : t('markdown.copyCode')}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function plainTextOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainTextOf).join('');
  if (isValidElement(node)) return plainTextOf((node.props as { children?: ReactNode }).children);
  return '';
}

/**
 * A paragraph that is nothing but one website link is a resource, not prose. A
 * link inside a sentence stays inline, and GitHub keeps its own card.
 */
function standaloneWebsiteLink(children: ReactNode): { href: string; title?: string } | null {
  const nodes = Children.toArray(children).filter((node) => !(typeof node === 'string' && !node.trim()));
  const only = nodes[0];
  if (nodes.length !== 1 || !isValidElement(only)) return null;
  const { href, children: linkChildren } = only.props as { href?: unknown; children?: ReactNode };
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href) || isGitHubUrl(href)) return null;
  const text = plainTextOf(linkChildren).trim();
  return { href, title: text && text !== href ? text : undefined };
}

/**
 * Memoized so the markdown tree (including `.prose table`) is rebuilt only when
 * `text` / `isStreaming` actually change. `ChatMessage` re-renders on every
 * periodic status / usage update; without this memo those re-renders rebuild the
 * markdown table element and detach it mid-action, which is the
 * `scrollIntoViewIfNeeded` / screenshot "Element is not attached to the DOM"
 * failure tracked as issue #45. Both props are primitives, so the default
 * shallow comparison is exact.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  isStreaming,
  allowSidePreview = false,
}: {
  text: string;
  isStreaming: boolean;
  /** Where the workspace panel is on screen, link cards may offer it. */
  allowSidePreview?: boolean;
}) {
  return (
    <>
      <TextMessagePartProvider text={text} isRunning={isStreaming}>
        <MarkdownTextPrimitive
          className={cn(
            /* `prose` is retained purely as a locator: eight e2e specs find
             * assistant replies through `.prose`. The visual rules now come from
             * `codex-markdown` (styles/codex-conversation.css), whose two-class
             * descendant selectors outrank the `.prose x` rules in globals.css. */
            'prose w-full max-w-none break-words text-foreground codex-markdown',
            isStreaming && 'codex-markdown-streaming',
          )}
          smooth={false}
          defer={isStreaming}
          preprocess={normalizeLatexDelimiters}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: 'html' }]]}
          components={{
              p({ children, ...props }) {
                // Mid-stream a lone link may still grow into a sentence; don't flip layout.
                const link = isStreaming ? null : standaloneWebsiteLink(children);
                if (link) {
                  return <WebsiteLinkCard url={link.href} title={link.title} allowSidePreview={allowSidePreview} />;
                }
                return <p {...props}>{children}</p>;
              },
              a({ href, children, ...props }) {
                if (href && isGitHubUrl(href)) {
                  return <GitHubCard url={href} />;
                }
                /* Underline styling is inherited from `.codex-markdown a` —
                 * the reference keeps transcript links monochrome. */
                return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
              },
              code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !className;
              if (isInline) {
                /* Inline code chrome lives in `.codex-markdown :not(pre) > code`. */
                return <code {...props}>{children}</code>;
              }
              return (
                <code className={cn('font-mono', className)} {...props}>
                  {children}
                </code>
              );
            },
            pre({ children, className, style, ...props }) {
              return (
                <pre
                  {...props}
                  style={{
                    ...style,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                  }}
                  className={cn(
                    /* Bottom half of `.markdown-code-block`: radius 10 to match
                     * the header above, 10px/12px padding, no fill of its own. */
                    'mb-3.5 overflow-x-auto whitespace-pre-wrap break-words rounded-b-[10px] rounded-t-none border border-t-0 border-conversation-strong bg-black/[0.02] px-3 py-2.5 text-conversation-body dark:bg-white/[0.02]',
                    className,
                  )}
                >
                  {children}
                </pre>
              );
            },
            img({ src, alt }) {
              if (!src) return null;
              return <ConversationImage url={String(src)} alt={typeof alt === 'string' ? alt : undefined} />;
            },
            CodeHeader: MarkdownCodeHeader,
            /* Headings, blockquote, hr, th and td are fully described by
             * codex-conversation.css; overriding them here would only re-open
             * the gap the port closes. The table keeps a wrapper because the
             * reference scrolls wide tables in a `markdown-table-scroll`
             * container (styles.css:8231-8236) rather than clipping them. */
            table({ children, ...props }) {
              return (
                <div className="my-2.5 mb-[18px] max-w-full overflow-x-auto">
                  <table {...props}>{children}</table>
                </div>
              );
            },
            input({ type, checked, ...props }) {
              if (type !== 'checkbox') return <input type={type} checked={checked} {...props} />;
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mt-1 h-3.5 w-3.5 rounded border-black/20 accent-primary dark:border-white/20"
                  {...props}
                />
              );
            },
          }}
        />
      </TextMessagePartProvider>
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
      )}
    </>
  );
});
