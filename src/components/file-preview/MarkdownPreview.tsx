/**
 * Rendered Markdown preview.
 *
 * Two important deltas from a vanilla ReactMarkdown setup:
 *
 *   1. `remark-frontmatter` is enabled with the `yaml`/`toml` flavours so a
 *      file like `SKILL.md` doesn't render its `---\nname: …\n---` block as
 *      a giant paragraph between two horizontal rules. The frontmatter is
 *      extracted into a side-rendered metadata card above the body so users
 *      can still see it without the noise.
 *
 *   2. We render heading / inline-code / fenced-code with explicit Tailwind
 *      classes instead of relying solely on `.prose`, because the project
 *      doesn't ship `@tailwindcss/typography` — only the small subset of
 *      `.prose` rules from `globals.css` exists.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'motion/react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';
import { RailToc, type RailTocItem } from '@/components/rareui/RailToc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function markdownOutline(source: string, prefix: string): RailTocItem[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  const headings: Array<RailTocItem & { depth: number }> = [];
  const text = (node: MarkdownNode): string => typeof node.value === 'string'
    ? node.value
    : node.children ? node.children.map(text).join('') : '';
  const walk = (node: MarkdownNode) => {
    if (node.type === 'heading') headings.push({ id: `${prefix}-${node.position?.start.offset ?? headings.length}`, label: text(node), depth: node.depth ?? 1 });
    node.children?.forEach(walk);
  };
  walk(tree);
  const minDepth = Math.min(...headings.map((heading) => heading.depth));
  return headings.map((heading) => ({ ...heading, depth: Math.min(3, heading.depth - minDepth) }));
}

interface FrontmatterSplit {
  body: string;
  yaml: string | null;
}

type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
};

function splitFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---')) {
    return { body: source, yaml: null };
  }
  // Match opening fence + YAML body + closing fence on its own line.
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: source, yaml: null };
  const yaml = match[1].trim();
  const body = source.slice(match[0].length);
  return { body, yaml: yaml.length > 0 ? yaml : null };
}

export default function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  const { body, yaml } = useMemo(() => splitFrontmatter(source), [source]);
  const { t } = useTranslation('chat');
  const prefix = `preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const reduced = useReducedMotion();
  const items = useMemo(() => markdownOutline(body, prefix), [body, prefix]);
  const headingIds = useMemo(() => () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: `${prefix}-${node.position?.start.offset ?? 0}` } };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  }, [prefix]);
  const sync = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const range = scroller.scrollHeight - scroller.clientHeight;
    setProgress(range > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / range)) : 1);
    const line = scroller.getBoundingClientRect().top + 48;
    const index = items.findLastIndex((item) => (scroller.querySelector<HTMLElement>(`#${item.id}`)?.getBoundingClientRect().top ?? Infinity) <= line);
    setActiveIndex(range > 0 && range - scroller.scrollTop < 2 ? Math.max(0, items.length - 1) : Math.max(0, index));
  }, [items]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = 0;
    const frame = requestAnimationFrame(sync);
    const resize = new ResizeObserver(sync);
    resize.observe(scroller);
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
    scroller.addEventListener('scroll', sync, { passive: true });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); scroller.removeEventListener('scroll', sync); };
  }, [body, sync]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!controlRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); controlRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    const frame = requestAnimationFrame(() => controlRef.current?.querySelector<HTMLButtonElement>('nav button[aria-current]')?.focus());
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); };
  }, [open]);

  return (
    <div className="rare-markdown-shell" data-testid="markdown-preview">
    <div ref={scrollRef} className="rare-markdown-scroll" data-testid="markdown-preview-scroll">
    <div className={cn('prose max-w-none px-6 py-4 text-sm leading-relaxed', className)}>
      {yaml && (
        <pre className="mb-4 rounded-lg border border-black/5 bg-black/[.03] px-3 py-2 text-2xs leading-relaxed text-foreground/70 dark:border-white/10 dark:bg-white/5">
          <code className="font-mono">{yaml}</code>
        </pre>
      )}
      <ReactMarkdown
        remarkPlugins={[[remarkFrontmatter, ['yaml', 'toml']], remarkGfm, remarkMath, headingIds]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 className="mb-3 mt-4 text-2xl font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="mb-2 mt-4 text-xl font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="mb-2 mt-3 text-base font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h4>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClass, children, ...props }) => {
            const match = /language-(\w+)/.exec(codeClass || '');
            const isInline = !match && !codeClass;
            if (isInline) {
              return (
                <code
                  className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[0.9em] text-foreground dark:bg-white/10"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn('font-mono text-[0.9em]', codeClass)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 text-xs leading-relaxed dark:bg-white/10">
              {children}
            </pre>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
    </div>
    {items.length > 0 && <div ref={controlRef} className="rare-markdown-control">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="rare-markdown-progress" data-testid="markdown-toc-toggle"
            aria-expanded={open} aria-controls={`${prefix}-toc`} aria-label={t('filePreview.toc.progress', { percent: Math.round(progress * 100) })}
            onClick={() => setOpen((previous) => !previous)}>
            <svg aria-hidden="true" width="25" height="25" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="1.5" opacity=".2" />
              <circle data-testid="markdown-progress-ring" cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="1.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} transform="rotate(-90 14 14)" strokeLinecap="round" />
              <path d="M10 11h8M10 14h5M10 17h7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{t('filePreview.toc.title')}</TooltipContent>
      </Tooltip>
      {open && <div id={`${prefix}-toc`} className="rare-markdown-toc motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150" data-testid="markdown-toc-panel">
        <RailToc items={items} activeIndex={activeIndex} title={t('filePreview.toc.title')} onSelect={(item) => {
          const scroller = scrollRef.current;
          const heading = scroller?.querySelector<HTMLElement>(`#${item.id}`);
          if (!scroller || !heading) return;
          scroller.scrollTo({ top: heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 20, behavior: reduced ? 'instant' : 'smooth' });
          setActiveIndex(items.indexOf(item));
        }} />
      </div>}
    </div>}
    </div>
  );
}
