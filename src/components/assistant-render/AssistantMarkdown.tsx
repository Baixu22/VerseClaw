import { Children, createContext, isValidElement, memo, useContext, type ReactNode } from 'react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps, type CodeHeaderProps } from '@assistant-ui/react-markdown';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/components/tool-ui/shared/use-copy-to-clipboard';
import { cn } from '@/lib/utils';
import type { Element, Root, RootContent } from 'hast';
import { MarkdownSyntaxHighlight } from './MarkdownSyntaxHighlight';
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

function MarkdownCodeHeader({ language, code }: CodeHeaderProps) {
  const { t } = useTranslation('chat');
  const { copiedId, copy } = useCopyToClipboard();
  const copied = copiedId !== null;
  const label = language && language !== 'unknown' ? language : t('markdown.codeBlock');

  return (
    <div
      className="markdown-code-header"
      data-testid="assistant-code-header"
    >
      <span className="min-w-0 truncate font-mono">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void copy(code)}
            className="inline-flex h-6 shrink-0 items-center rounded-md px-1.5 transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.06]"
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

// null keeps a partial URL inline until the paragraph is complete.
const SidePreviewContext = createContext<boolean | null>(null);

const markdownComponents: MarkdownTextPrimitiveProps['components'] = {
  p: function MarkdownParagraph({ children, node: _node, ...props }) {
    const allowSidePreview = useContext(SidePreviewContext);
    const link = allowSidePreview === null ? null : standaloneWebsiteLink(children);
    return link
      ? <WebsiteLinkCard url={link.href} title={link.title} allowSidePreview={!!allowSidePreview} />
      : <p {...props}>{children}</p>;
  },
  a({ href, children, node: _node, ...props }) {
    if (href && isGitHubUrl(href)) return <GitHubCard url={href} />;
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
  pre({ children, className, node: _node, ...props }) {
    return <pre {...props} className={cn('markdown-code-body whitespace-pre-wrap break-words', className)}>{children}</pre>;
  },
  img({ src, alt }) {
    return src ? <ConversationImage url={String(src)} alt={typeof alt === 'string' ? alt : undefined} /> : null;
  },
  table({ children, node: _node, ...props }) {
    return <div className="markdown-table-scroll"><table {...props}>{children}</table></div>;
  },
  input({ type, checked, node: _node, ...props }) {
    return <input type={type} checked={checked} readOnly={type === 'checkbox'} {...props} />;
  },
  CodeHeader: MarkdownCodeHeader,
};

const completeComponents = { ...markdownComponents, SyntaxHighlighter: MarkdownSyntaxHighlight };

// Follow the last Markdown block through nested lists, quotes and tables.
// Inline emphasis and links stay inside the block, ahead of its decorative caret.
function markWritingEnd() {
  return (tree: Root) => {
    let parent: Root | Element = tree;
    let target: Element | undefined;
    for (;;) {
      const last: RootContent | undefined = parent.children.findLast(child => child.type !== 'text' || child.value.trim() !== '');
      if (last?.type !== 'element') break;
      if (/^(li|p|h[1-6]|td|th|pre)$/.test(last.tagName)) {
        target = last;
        if (last.tagName !== 'li') break;
      }
      parent = last;
    }
    if (target) target.properties['data-writing-end'] = true;
  };
}
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: NonNullable<MarkdownTextPrimitiveProps['rehypePlugins']> = [
  [rehypeKatex, { strict: false, throwOnError: false, output: 'html' }],
];
const streamingPlugins = [...rehypePlugins, markWritingEnd];

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  isStreaming,
  allowSidePreview = false,
}: {
  text: string;
  isStreaming: boolean;
  allowSidePreview?: boolean;
}) {
  return (
    <SidePreviewContext.Provider value={isStreaming ? null : allowSidePreview}>
      <TextMessagePartProvider text={text} isRunning={isStreaming}>
        <MarkdownTextPrimitive
          className="prose w-full max-w-none break-words codex-markdown"
          smooth={false}
          defer={isStreaming}
          preprocess={normalizeLatexDelimiters}
          remarkPlugins={remarkPlugins}
          rehypePlugins={isStreaming ? streamingPlugins : rehypePlugins}
          components={isStreaming ? markdownComponents : completeComponents}
        />
      </TextMessagePartProvider>
    </SidePreviewContext.Provider>
  );
});
