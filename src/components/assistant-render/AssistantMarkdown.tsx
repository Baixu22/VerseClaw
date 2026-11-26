import { Children, createContext, isValidElement, memo, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps, type CodeHeaderProps } from '@assistant-ui/react-markdown';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/components/tool-ui/shared/use-copy-to-clipboard';
import { cn } from '@/lib/utils';
import type { Element, Root, RootContent } from 'hast';
import type { Root as MarkdownRoot, RootContent as MarkdownNode } from 'mdast';
import { MarkdownSyntaxHighlight } from './MarkdownSyntaxHighlight';
import { GitHubCard } from './GitHubCard';
import { WebsiteLink } from './WebsiteLink';
import { ConversationImage } from './resources/ConversationImage';
import { WebsiteLinkCard } from './resources/ResourceCards';
import { SessionReference, useMessageReferences } from './MessageReferences';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { sanitizeResourceUrl } from '@/pages/Chat/conversation-resources';
import { hostApi } from '@/lib/host-api';
import { parseGitHubUrl } from '@/lib/github-link';

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

// Standalone links can also be opened in the workspace browser.
function standaloneWebsiteLink(children: ReactNode): { href: string; title?: string } | null {
  const nodes = Children.toArray(children).filter((node) => !(typeof node === 'string' && !node.trim()));
  const only = nodes[0];
  if (nodes.length !== 1 || !isValidElement(only)) return null;
  const { href, children: linkChildren } = only.props as { href?: unknown; children?: ReactNode };
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return null;
  const text = plainTextOf(linkChildren).trim();
  return { href, title: text && text !== href ? text : undefined };
}

// Streaming links stay in source form until the paragraph is complete.
const SidePreviewContext = createContext<boolean | null>(null);

const markdownComponents: MarkdownTextPrimitiveProps['components'] = {
  p: function MarkdownParagraph({ children, node: _node, ...props }) {
    const allowSidePreview = useContext(SidePreviewContext);
    const link = allowSidePreview ? standaloneWebsiteLink(children) : null;
    return <p {...props}>
      {link && parseGitHubUrl(link.href)?.type !== 'repo'
        ? <WebsiteLinkCard url={link.href} title={link.title} allowSidePreview inline />
        : children}
    </p>;
  },
  a: function MarkdownLink({ href, children, node: _node, ...props }) {
    const allowReferences = useContext(SidePreviewContext) !== null;
    if (!href) return <span>{children}</span>;
    if (allowReferences && /^https?:\/\//i.test(href)) {
      if (parseGitHubUrl(href)?.type === 'repo') return <GitHubCard url={href} />;
      return <WebsiteLink url={href}>{children}</WebsiteLink>;
    }
    if (maskChatSecrets(href) !== href) {
      const { openUrl } = sanitizeResourceUrl(href);
      return openUrl ? <button type="button" className="underline" onClick={() => void hostApi.shell.openExternal(openUrl)}>{children}</button> : <span>{children}</span>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
  button({ node, children }) {
    const id = node?.properties.dataSessionRef;
    return typeof id === 'string' ? <SessionReference id={id} /> : <>{children}</>;
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
// Resource components keep the original URL for explicit opens. No raw URL is
// needed in the DOM when it contains a credential.
function maskMarkdownContent() {
  return (tree: MarkdownRoot) => {
    function visit(node: MarkdownRoot | MarkdownNode) {
      if ('value' in node) node.value = maskChatSecrets(node.value);
      if ('title' in node && node.title) node.title = maskChatSecrets(node.title);
      if ('alt' in node && node.alt) node.alt = maskChatSecrets(node.alt);
      if ('label' in node && node.label) node.label = maskChatSecrets(node.label);
      if ('identifier' in node) node.identifier = maskChatSecrets(node.identifier);
      if (node.type === 'code' && node.lang) node.lang = maskChatSecrets(node.lang);
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}
const remarkPlugins = [remarkGfm, remarkMath, maskMarkdownContent];
const rehypePlugins: NonNullable<MarkdownTextPrimitiveProps['rehypePlugins']> = [
  [rehypeKatex, { strict: false, throwOnError: false, output: 'html' }],
];
// Bound both tall logs and unbroken pastes before the Markdown parser runs.
function collapsedPreview(text: string) {
  const firstLines = text.split('\n', 25);
  if (text.length <= 2400 && firstLines.length < 25) return null;
  const head = firstLines.slice(0, 10).join('\n').slice(0, 800);
  const boundary = head.lastIndexOf('\n\n');
  // A whole paragraph can carry links and formatting. A cut URL or code fence stays inert.
  if (boundary > 0 && !/^(?: {0,3})(?:`{3,}|~{3,})/m.test(head)) {
    return { markdown: true, text: head.slice(0, boundary) };
  }
  return { markdown: false, text: head.trimEnd() + '…' };
}

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  isStreaming,
  allowSidePreview = false,
  foldLongText = true,
}: {
  text: string;
  isStreaming: boolean;
  allowSidePreview?: boolean;
  foldLongText?: boolean;
}) {
  const { t } = useTranslation('chat');
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const preview = useMemo(() => isStreaming || !foldLongText ? null : collapsedPreview(text), [text, isStreaming, foldLongText]);
  const references = useMessageReferences();
  const plugins = useMemo(() => isStreaming ? [...rehypePlugins, markWritingEnd] : [...rehypePlugins, references], [references, isStreaming]);
  const excerpt = expanded ? null : preview;
  return (
    <SidePreviewContext.Provider value={isStreaming ? null : allowSidePreview}>
      <div id={id} className="w-full min-w-0 max-w-full">
        {excerpt && !excerpt.markdown ? (
          <p className="chat-long-message-preview reading-text">{maskChatSecrets(excerpt.text)}</p>
        ) : (
          <TextMessagePartProvider text={excerpt?.text ?? text} isRunning={isStreaming}>
            <MarkdownTextPrimitive
              className="prose w-full max-w-none break-words codex-markdown"
              smooth={false}
              defer={isStreaming}
              preprocess={normalizeLatexDelimiters}
              remarkPlugins={remarkPlugins}
              rehypePlugins={plugins}
              components={isStreaming ? markdownComponents : completeComponents}
            />
          </TextMessagePartProvider>
        )}
      </div>
      {preview !== null && (
        <button type="button" className="chat-message-disclosure" aria-controls={id} aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          {t(expanded ? 'markdown.showLess' : 'markdown.showFull')}
          <ChevronDown aria-hidden="true" size={14} className={expanded ? 'rotate-180' : undefined} />
        </button>
      )}
    </SidePreviewContext.Provider>
  );
});
