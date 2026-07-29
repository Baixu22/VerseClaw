import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, Bot, Check, Columns3, Copy, Database, Edit3, Eye, FilePlus2, FileSearch, FileText, FolderPlus, History, Inbox, Layers, Lightbulb, Link2, ListTodo, Loader2, MessageCircle, Plus, Puzzle, RefreshCw, RotateCcw, Ruler, Save, Search, SendHorizontal, ShieldCheck, Sparkles, Tags, Upload, Wrench, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  hostApi,
  type KnowledgeArtifactType,
  type KnowledgeChangeProposal,
  type KnowledgeDraft,
  type KnowledgeDraftType,
  type KnowledgeInboxItem,
  type KnowledgeOkfConcept,
  type KnowledgeOkfValidationResult,
  type KnowledgeProvenanceRecord,
  type KnowledgeQualityMetrics,
  type KnowledgeRuntimeLessonsReportResult,
  type KnowledgeSearchResult,
  type KnowledgeSekbConfirmPrincipleResult,
  type KnowledgeSekbDistillationSuggestion,
  type KnowledgeSekbRetrieveForTaskResult,
  type KnowledgeSourceSet,
  type KnowledgeStatusResult,
  type KnowledgeStewardConfigGetResult,
  type KnowledgeStewardReviewResult,
  type KnowledgeStewardTriage,
  type KnowledgeStewardTriageAction,
} from '@/lib/host-api';
import {
  buildGroundedLibrarianAnswer,
  createDraftPayloadFromGroundedAnswer,
  createErrorExperienceInboxPayloadFromGroundedAnswer,
  type KnowledgeLibrarianGroundedAnswer,
} from '@/lib/knowledge-librarian';
import { cn } from '@/lib/utils';

type SearchRow = Record<string, unknown>;
type WorkbenchTab = 'library' | 'inbox' | 'drafts' | 'review' | 'runtime' | 'governance';
type MarkdownEditorMode = 'edit' | 'preview' | 'split';
type KnowledgeLibrarianCitation = {
  lookup: string;
  title: string;
  excerpt: string;
  path?: string;
  score?: number;
};
type KnowledgeLibrarianMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  citations?: KnowledgeLibrarianCitation[];
  groundedAnswer?: KnowledgeLibrarianGroundedAnswer;
};
type KnowledgeLibrarianCheckpoint = {
  version: 1;
  updatedAt: string;
  vaultPath?: string;
  editorTitle: string;
  editorSource: string;
  messages: KnowledgeLibrarianMessage[];
};
type KnowledgeLibrarianPromptSuggestion = {
  id: string;
  label: string;
  prompt: string;
};
type KnowledgeQualityMetricKind =
  | 'stale_cards'
  | 'duplicate_clusters'
  | 'source_gaps'
  | 'unreferenced_pages'
  | 'low_confidence_high_hit_cards'
  | 'high_dismissal_cards';
type InboxMetadataView = Record<string, unknown> & {
  recommendation?: unknown;
  reason?: unknown;
  score?: unknown;
  evidenceRefs?: unknown;
  missionId?: unknown;
  tick?: unknown;
  outcome?: unknown;
  temporality?: unknown;
  captureKey?: unknown;
  triage?: unknown;
};
type InboxScoreDimension = 'reusability' | 'uniqueness' | 'confidence';
type InboxSourceDisplay = KnowledgeInboxItem['sourceRefs'][number];
type SourceSetRef = KnowledgeSourceSet['sourceRefs'][number];

const PANEL_CLASS = 'rounded-xl border border-black/10 bg-surface-modal shadow-sm dark:border-white/10';
const QUIET_BUTTON_CLASS = 'h-9 rounded-lg border border-black/10 bg-transparent px-3 text-meta font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const ROW_CLASS = 'flex items-center justify-between gap-4 rounded-lg bg-surface-input px-3 py-2';
const WORKSPACE_CHROME_CLASS = 'overflow-hidden rounded-xl border border-black/10 bg-surface-modal shadow-sm dark:border-white/10';
const WORKSPACE_SECTION_CLASS = 'min-h-0 bg-surface-input/70 dark:bg-surface-input/80';
const KNOWLEDGE_LIBRARIAN_STORAGE_KEY = 'clawx.knowledge.librarian.checkpoint.v1';
const KNOWLEDGE_TYPES: KnowledgeDraftType[] = ['decision', 'architecture', 'command', 'troubleshooting', 'glossary', 'source-note', 'synthesis', 'procedure'];
const PRIMARY_WORKBENCH_TABS: WorkbenchTab[] = ['library', 'inbox', 'drafts', 'review', 'runtime'];
const QUALITY_METRIC_KINDS: KnowledgeQualityMetricKind[] = [
  'stale_cards',
  'duplicate_clusters',
  'source_gaps',
  'unreferenced_pages',
  'low_confidence_high_hit_cards',
  'high_dismissal_cards',
];
const STUDIO_ARTIFACTS: Array<{ type: KnowledgeArtifactType; labelKey: string }> = [
  { type: 'summary', labelKey: 'studio.summary' },
  { type: 'faq', labelKey: 'studio.faq' },
  { type: 'decision-memo', labelKey: 'studio.decisionMemo' },
  { type: 'troubleshooting-recipe', labelKey: 'studio.troubleshootingRecipe' },
];

const TAB_ICONS: Record<WorkbenchTab, React.ComponentType<{ className?: string }>> = {
  library: Layers,
  inbox: Inbox,
  drafts: Edit3,
  review: ShieldCheck,
  runtime: History,
  governance: Database,
};

const TYPE_ICONS: Record<KnowledgeDraftType, React.ComponentType<{ className?: string }>> = {
  decision: Ruler,
  architecture: Puzzle,
  command: ArrowRight,
  troubleshooting: Search,
  glossary: BookOpen,
  'source-note': FileText,
  synthesis: Lightbulb,
  procedure: ListTodo,
};
const QUALITY_METRIC_ICONS: Record<KnowledgeQualityMetricKind, React.ComponentType<{ className?: string }>> = {
  stale_cards: History,
  duplicate_clusters: Layers,
  source_gaps: Link2,
  unreferenced_pages: FileSearch,
  low_confidence_high_hit_cards: Lightbulb,
  high_dismissal_cards: RotateCcw,
};

const TYPE_COLOR = {
  decision: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/10',
  architecture: 'border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-400 hover:border-violet-500/50 hover:bg-violet-500/10',
  command: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400 hover:border-rose-500/50 hover:bg-rose-500/10',
  troubleshooting: 'border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-400 hover:border-orange-500/50 hover:bg-orange-500/10',
  glossary: 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-400 hover:border-sky-500/50 hover:bg-sky-500/10',
  'source-note': 'border-slate-500/30 bg-slate-500/5 text-slate-700 dark:text-slate-400 hover:border-slate-500/50 hover:bg-slate-500/10',
  synthesis: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/10',
  procedure: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-500/10',
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getSearchRows(result: KnowledgeSearchResult | null): SearchRow[] {
  if (!result) return [];
  if (Array.isArray(result.results)) return result.results as SearchRow[];
  const candidates = ['items', 'matches', 'pages'];
  for (const key of candidates) {
    const value = (result as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter((entry): entry is SearchRow => !!asRecord(entry));
  }
  return [];
}

function getLookup(row: SearchRow): string {
  return getString(row, ['pagePath', 'path', 'relativePath', 'id', 'pageId', 'lookup']);
}

function getTitle(row: SearchRow): string {
  return getString(row, ['title', 'pageTitle', 'name', 'id', 'pageId', 'pagePath']) || 'Result';
}

function getSnippet(row: SearchRow): string {
  return getString(row, ['snippet', 'excerpt', 'text', 'summary', 'content']);
}

function sourceRefFromSearchRow(row: SearchRow): SourceSetRef | null {
  const lookup = getLookup(row);
  if (!lookup) return null;
  return {
    id: lookup,
    kind: 'wiki',
    path: lookup,
    label: getTitle(row),
  };
}

function getScore(row: SearchRow): number | undefined {
  const value = row.score ?? row.rank ?? row.similarity;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed > 1 ? parsed / 100 : parsed;
  }
  return undefined;
}

function getPageBody(page: Record<string, unknown> | null): string {
  if (!page) return '';
  const direct = getString(page, ['content', 'markdown', 'text', 'body', 'raw']);
  if (direct) return direct;
  const nested = asRecord(page.page);
  return nested ? getPageBody(nested) : JSON.stringify(page, null, 2);
}

function getOkfBadges(record: Record<string, unknown>): string[] {
  const okf = asRecord(record.okf) ?? asRecord(record.okfMetadata);
  const source = okf ?? record;
  const conceptId = getString(source, ['conceptId', 'okfConceptId']);
  if (!okf && !conceptId) return [];
  return [
    getString(source, ['type', 'okfType']),
    conceptId,
    getString(source, ['resource']),
    getString(source, ['timestamp']),
  ].filter(Boolean);
}

function okfConceptTitle(concept: KnowledgeOkfConcept): string {
  return concept.frontmatter.title || concept.conceptId;
}

function knowledgeTypeCount(pageCounts: Record<string, number>, type: KnowledgeDraftType): number {
  if (type === 'source-note') return pageCounts['source-note'] ?? pageCounts.source ?? 0;
  if (type === 'glossary') return pageCounts.glossary ?? pageCounts.entity ?? pageCounts.concept ?? 0;
  return pageCounts[type] ?? 0;
}

function makeStarterMarkdown(title: string): string {
  return `# ${title}\n\n## Notes\n\n\n## Links\n\n- \n`;
}

function markdownSummary(body: string): string {
  const compact = body
    .replace(/^---[\s\S]*?---/u, '')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function readableExcerpt(body: string, fallback = ''): string {
  const compact = (body || fallback)
    .replace(/^---[\s\S]*?---/u, '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[#>*_`[\]()[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

function makeLibrarianMessage(
  role: KnowledgeLibrarianMessage['role'],
  content: string,
  citations?: KnowledgeLibrarianCitation[],
  groundedAnswer?: KnowledgeLibrarianGroundedAnswer,
): KnowledgeLibrarianMessage {
  return {
    id: `kl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(citations && citations.length > 0 ? { citations } : {}),
    ...(groundedAnswer ? { groundedAnswer } : {}),
  };
}

function parseLibrarianCheckpoint(raw: string | null): KnowledgeLibrarianCheckpoint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeLibrarianCheckpoint>;
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return null;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      vaultPath: typeof parsed.vaultPath === 'string' ? parsed.vaultPath : undefined,
      editorTitle: typeof parsed.editorTitle === 'string' ? parsed.editorTitle : '',
      editorSource: typeof parsed.editorSource === 'string' ? parsed.editorSource : '',
      messages: parsed.messages.filter((message): message is KnowledgeLibrarianMessage => (
        !!message
        && typeof message.id === 'string'
        && (message.role === 'user' || message.role === 'assistant' || message.role === 'system')
        && typeof message.content === 'string'
        && typeof message.createdAt === 'string'
      )).slice(-30),
    };
  } catch {
    return null;
  }
}

function KnowledgeAssistantMarkdown({ content }: { content: string }) {
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

function KnowledgeAssistantMessage({
  message,
  copied,
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
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
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
            'rounded-xl border px-3.5 py-2.5 text-sm leading-6 shadow-sm',
            isUser
              ? 'border-primary/20 bg-primary/10 text-foreground'
              : 'border-black/10 bg-surface-input/90 text-foreground dark:border-white/10',
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : groundedAnswer ? (
            <div className="space-y-3" data-testid="knowledge-librarian-grounded-answer">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  {sectionLabels.groundingStatus[groundedAnswer.groundingStatus]}
                </Badge>
                <Badge variant="outline" className="border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">
                  {sectionLabels.confidence}: {Math.round(groundedAnswer.confidence * 100)}%
                </Badge>
              </div>
              <section data-testid="knowledge-librarian-answer-section">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{sectionLabels.answer}</h4>
                <div className="prose prose-sm mt-1 max-w-none break-words text-foreground dark:prose-invert prose-headings:font-serif prose-headings:font-normal prose-a:text-primary">
                  <KnowledgeAssistantMarkdown content={groundedAnswer.answer} />
                </div>
              </section>
              <section data-testid="knowledge-librarian-sources-section">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{sectionLabels.sources}</h4>
                <div className="mt-2 grid gap-2">
                  {groundedAnswer.sources.map((source, index) => (
                    <button
                      key={`${message.id}:source:${source.lookup}`}
                      type="button"
                      className="rounded-lg border border-black/10 bg-background/70 px-3 py-2 text-left text-xs shadow-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => onOpenCitation({ lookup: source.lookup, title: source.title, excerpt: source.excerpt, path: source.path, score: source.score })}
                      data-testid="knowledge-librarian-source"
                    >
                      <span className="flex items-start gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{source.title}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{source.path || source.lookup}</span>
                          <span className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{source.excerpt}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                  {groundedAnswer.sources.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{groundedAnswer.unknowns[0]}</p>
                  ) : null}
                </div>
              </section>
              <section data-testid="knowledge-librarian-unknowns-section">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{sectionLabels.unknowns}</h4>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                  {groundedAnswer.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
                </ul>
              </section>
              <section data-testid="knowledge-librarian-next-action-section">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{sectionLabels.nextAction}</h4>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                  {groundedAnswer.nextActions.map((action) => <li key={action}>{action}</li>)}
                </ul>
              </section>
              <details className="rounded-lg border border-black/10 bg-background/60 px-3 py-2 text-xs dark:border-white/10" data-testid="knowledge-librarian-retrieval-inspector">
                <summary className="cursor-pointer font-medium text-foreground">{sectionLabels.retrieval}</summary>
                <dl className="mt-2 grid gap-1.5 text-muted-foreground">
                  <div className="flex justify-between gap-3"><dt>{sectionLabels.query}</dt><dd className="min-w-0 truncate font-mono">{groundedAnswer.retrieval.query}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{sectionLabels.corpus}</dt><dd>{groundedAnswer.retrieval.corpus}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{sectionLabels.roleTag}</dt><dd>{groundedAnswer.retrieval.roleTag}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{sectionLabels.resultCount}</dt><dd>{groundedAnswer.retrieval.resultCount}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{sectionLabels.selectedSources}</dt><dd>{groundedAnswer.retrieval.selectedSources.length}</dd></div>
                </dl>
              </details>
              <div className="flex flex-wrap gap-2" data-testid="knowledge-librarian-candidate-actions">
                <Button type="button" variant="outline" size="sm" className="h-7 rounded-md px-2 text-[11px]" onClick={() => onSaveDraft(groundedAnswer)} data-testid="knowledge-librarian-save-draft">
                  <FilePlus2 className="mr-1.5 h-3 w-3" />
                  {actionLabels.saveDraft}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 rounded-md px-2 text-[11px]" onClick={() => onCreateErrorExperience(groundedAnswer)} data-testid="knowledge-librarian-create-error-experience">
                  <Wrench className="mr-1.5 h-3 w-3" />
                  {actionLabels.createErrorExperience}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 rounded-md px-2 text-[11px]" onClick={() => onSendToSteward(groundedAnswer)} data-testid="knowledge-librarian-send-steward">
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
        {message.citations && message.citations.length > 0 ? (
          <div className="mt-2 grid gap-2" data-testid="knowledge-librarian-citations" aria-label={citationsLabel}>
            {message.citations.map((citation, index) => (
              <button
                key={`${message.id}:${citation.lookup}`}
                type="button"
                className="rounded-lg border border-black/10 bg-background/70 px-3 py-2 text-left text-xs shadow-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                onClick={() => onOpenCitation(citation)}
                data-testid="knowledge-librarian-citation"
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{citation.title}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{citation.lookup}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function KnowledgeAssistantPromptInput({
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
      className="rounded-xl border border-black/10 bg-background px-3 py-2 shadow-sm transition-colors focus-within:border-primary/35 dark:border-white/10"
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

function KnowledgeAssistantErrorCard({
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

type InboxRecommendation = 'save' | 'review' | 'archive-only';
type InboxTriageGroup = KnowledgeStewardTriageAction;

const INBOX_TRIAGE_ORDER: InboxTriageGroup[] = ['needs-decision', 'ready-for-review', 'possible-duplicate', 'observe', 'reject-low-value'];
const INBOX_STATUSES = new Set(['pending', 'promoted', 'dismissed']);
const INBOX_TEMPORALITIES = new Set(['stable', 'versioned', 'ephemeral']);
const INBOX_OUTCOMES = new Set(['idle', 'running', 'sleeping', 'paused', 'ask_user', 'complete', 'blocked', 'cancelled', 'error']);
const INBOX_SOURCE_KINDS = new Set(['chat', 'file', 'wiki', 'task_ledger', 'trace', 'task_loop', 'manual', 'search_result', 'other']);
const INBOX_SCORE_DIMENSIONS: InboxScoreDimension[] = ['reusability', 'uniqueness', 'confidence'];

function inboxMetadata(item: KnowledgeInboxItem): InboxMetadataView {
  return (asRecord(item.metadata) ?? {}) as InboxMetadataView;
}

function inboxRecommendation(item: KnowledgeInboxItem): InboxRecommendation {
  const recommendation = inboxMetadata(item).recommendation;
  return recommendation === 'save' || recommendation === 'archive-only' ? recommendation : 'review';
}

function inboxTriage(item: KnowledgeInboxItem): KnowledgeStewardTriage {
  const triage = asRecord(inboxMetadata(item).triage);
  const action = triage?.action;
  if (
    triage
    && (
    action === 'needs-decision'
    || action === 'ready-for-review'
    || action === 'possible-duplicate'
    || action === 'observe'
    || action === 'reject-low-value'
    )
  ) {
    return {
      action,
      confidence: typeof triage.confidence === 'number' && Number.isFinite(triage.confidence) ? triage.confidence : 0.5,
      ...(typeof triage.duplicateOf === 'string' && triage.duplicateOf.trim() ? { duplicateOf: triage.duplicateOf.trim() } : {}),
      ...(Array.isArray(triage.conflictWith) ? { conflictWith: triage.conflictWith.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) } : {}),
      reason: typeof triage.reason === 'string' && triage.reason.trim() ? triage.reason.trim() : '',
      ...(Array.isArray(triage.suggestedEdits) ? { suggestedEdits: triage.suggestedEdits.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) } : {}),
    };
  }
  const recommendation = inboxRecommendation(item);
  if (recommendation === 'save') {
    return { action: 'ready-for-review', confidence: 0.6, reason: inboxReason(item) };
  }
  if (recommendation === 'archive-only') {
    return { action: 'observe', confidence: 0.5, reason: inboxReason(item) };
  }
  return { action: 'needs-decision', confidence: 0.5, reason: inboxReason(item) };
}

function inboxReason(item: KnowledgeInboxItem): string {
  const triage = asRecord(inboxMetadata(item).triage);
  const triageReason = triage?.reason;
  if (typeof triageReason === 'string' && triageReason.trim()) return triageReason.trim();
  const reason = inboxMetadata(item).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : '';
}

function inboxMetadataString(item: KnowledgeInboxItem, key: keyof InboxMetadataView): string {
  const value = inboxMetadata(item)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function inboxMetadataNumber(item: KnowledgeInboxItem, key: keyof InboxMetadataView): number | null {
  const value = inboxMetadata(item)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inboxOverallScore(item: KnowledgeInboxItem): number | null {
  const score = asRecord(inboxMetadata(item).score);
  const overall = score?.overall;
  return typeof overall === 'number' && Number.isFinite(overall) ? overall : null;
}

function inboxScorePercent(item: KnowledgeInboxItem, dimension: InboxScoreDimension): number | null {
  const score = asRecord(inboxMetadata(item).score);
  const value = score?.[dimension];
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function inboxEvidenceCount(item: KnowledgeInboxItem): number {
  const evidenceRefs = inboxMetadata(item).evidenceRefs;
  if (Array.isArray(evidenceRefs)) return evidenceRefs.filter((ref) => typeof ref === 'string' && ref.trim()).length;
  return Math.max(item.sourceRefs.length, item.sourceIds.length);
}

function inboxRecommendationClass(recommendation: InboxRecommendation): string {
  if (recommendation === 'save') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (recommendation === 'archive-only') return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-400';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
}

function inboxTriageClass(action: InboxTriageGroup): string {
  if (action === 'needs-decision') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';
  if (action === 'ready-for-review') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (action === 'possible-duplicate') return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400';
  if (action === 'observe') return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-400';
}

function inboxKnownLabel(namespace: 'status' | 'temporality' | 'outcomes', value: string): string {
  if (namespace === 'status' && INBOX_STATUSES.has(value)) return `inbox.status.${value}`;
  if (namespace === 'temporality' && INBOX_TEMPORALITIES.has(value)) return `inbox.temporality.${value}`;
  if (namespace === 'outcomes' && INBOX_OUTCOMES.has(value)) return `inbox.outcomes.${value}`;
  return '';
}

function inboxSourceKindLabel(kind: unknown): string {
  return typeof kind === 'string' && INBOX_SOURCE_KINDS.has(kind) ? `inbox.sourceKinds.${kind}` : 'inbox.sourceKinds.other';
}

function inboxSourceDisplays(item: KnowledgeInboxItem): InboxSourceDisplay[] {
  if (item.sourceRefs.length > 0) return item.sourceRefs;
  return item.sourceIds.map((id) => ({ id, kind: 'manual' as const, label: id }));
}

function runtimePrincipleField(suggestion: KnowledgeSekbDistillationSuggestion, key: string): string {
  const value = suggestion.suggested_principle[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').join(', ');
  return '';
}

export function Knowledge() {
  const { t } = useTranslation(['knowledge', 'common']);
  const [status, setStatus] = useState<KnowledgeStatusResult['status'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [selectedPage, setSelectedPage] = useState<Record<string, unknown> | null>(null);
  const [selectedRow, setSelectedRow] = useState<SearchRow | null>(null);
  const [selectedLookup, setSelectedLookup] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftSources, setDraftSources] = useState('');
  const [draftType, setDraftType] = useState<KnowledgeDraftType>('synthesis');
  const [draftTags, setDraftTags] = useState('');
  const [editorTitle, setEditorTitle] = useState(t('workspace.untitled'));
  const [editorBody, setEditorBody] = useState(() => makeStarterMarkdown(t('workspace.untitled')));
  const [editorSource, setEditorSource] = useState('');
  const [editorType, setEditorType] = useState<KnowledgeDraftType>('source-note');
  const [editorTags, setEditorTags] = useState('');
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>('split');
  const [sourceSets, setSourceSets] = useState<KnowledgeSourceSet[]>([]);
  const [currentSourceRefs, setCurrentSourceRefs] = useState<SourceSetRef[]>([]);
  const [sourceSetTitle, setSourceSetTitle] = useState('');
  const [currentSourceSetId, setCurrentSourceSetId] = useState<string | null>(null);
  const [librarianOpen, setLibrarianOpen] = useState(false);
  const [librarianQuestion, setLibrarianQuestion] = useState('');
  const [librarianError, setLibrarianError] = useState<string | null>(null);
  const [lastLibrarianQuestion, setLastLibrarianQuestion] = useState('');
  const [copiedLibrarianMessageId, setCopiedLibrarianMessageId] = useState<string | null>(null);
  const [librarianMessages, setLibrarianMessages] = useState<KnowledgeLibrarianMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY))?.messages ?? [];
  });
  const [librarianCheckpointAt, setLibrarianCheckpointAt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY))?.updatedAt ?? null;
  });
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('library');
  const [drafts, setDrafts] = useState<KnowledgeDraft[]>([]);
  const [inboxItems, setInboxItems] = useState<KnowledgeInboxItem[]>([]);
  const [proposals, setProposals] = useState<KnowledgeChangeProposal[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [stewardReview, setStewardReview] = useState<KnowledgeStewardReviewResult | null>(null);
  const [stewardConfig, setStewardConfig] = useState<KnowledgeStewardConfigGetResult | null>(null);
  const [showStewardConfig, setShowStewardConfig] = useState(false);
  const [selectedProvenance, setSelectedProvenance] = useState<KnowledgeProvenanceRecord | null>(null);
  const [okfPath, setOkfPath] = useState('');
  const [okfValidation, setOkfValidation] = useState<KnowledgeOkfValidationResult | null>(null);
  const [selectedOkfConceptIds, setSelectedOkfConceptIds] = useState<Set<string>>(() => new Set());
  const [governanceRunning, setGovernanceRunning] = useState(false);
  const [governanceIssues, setGovernanceIssues] = useState<any[]>([]);
  const [governanceContradictions, setGovernanceContradictions] = useState(0);
  const [governanceStale, setGovernanceStale] = useState(0);
  const [governanceDangling, setGovernanceDangling] = useState(0);
  const [governanceQualityMetrics, setGovernanceQualityMetrics] = useState<KnowledgeQualityMetrics | null>(null);
  const [governanceLastChecked, setGovernanceLastChecked] = useState<string | null>(null);
  const [, setDismissedIssueIds] = useState<Set<string>>(() => new Set());
  const [runtimeLessons, setRuntimeLessons] = useState<KnowledgeRuntimeLessonsReportResult | null>(null);
  const [runtimeLessonsLoading, setRuntimeLessonsLoading] = useState(false);
  const [runtimeLessonsRequested, setRuntimeLessonsRequested] = useState(false);
  const [runtimeSuggestions, setRuntimeSuggestions] = useState<KnowledgeSekbDistillationSuggestion[]>([]);
  const [selectedRuntimeSuggestionIndex, setSelectedRuntimeSuggestionIndex] = useState(0);
  const [runtimeSessionId, setRuntimeSessionId] = useState('');
  const [runtimeRejectReason, setRuntimeRejectReason] = useState('');
  const [runtimeConfirmResult, setRuntimeConfirmResult] = useState<KnowledgeSekbConfirmPrincipleResult | null>(null);
  const [runtimeRetrieveIntent, setRuntimeRetrieveIntent] = useState('');
  const [runtimeRetrieveType, setRuntimeRetrieveType] = useState('');
  const [runtimeRetrieveTags, setRuntimeRetrieveTags] = useState('');
  const [runtimeRetrieveResult, setRuntimeRetrieveResult] = useState<KnowledgeSekbRetrieveForTaskResult | null>(null);

  const rows = useMemo(() => getSearchRows(searchResult), [searchResult]);
  const pageCounts = (status?.pageCounts ?? {}) as Record<string, number>;
  const sourceCounts = (status?.sourceCounts ?? {}) as Record<string, number>;
  const warnings = status?.warnings ?? [];
  const selectedPageBody = useMemo(() => getPageBody(selectedPage), [selectedPage]);
  const ready = Boolean(status?.vaultExists);
  const statusTone = ready
    ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
    : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
  const metrics = useMemo(() => [
    { label: t('metrics.sources'), value: pageCounts.source ?? 0, icon: FileText, tone: 'text-sky-700 dark:text-sky-400' },
    { label: t('metrics.syntheses'), value: pageCounts.synthesis ?? 0, icon: Sparkles, tone: 'text-violet-700 dark:text-violet-400' },
    { label: t('metrics.entities'), value: (pageCounts.entity ?? 0) + (pageCounts.concept ?? 0), icon: Database, tone: 'text-emerald-700 dark:text-emerald-400' },
    { label: t('metrics.warnings'), value: warnings.length, icon: AlertTriangle, tone: warnings.length > 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-muted-foreground' },
  ], [pageCounts.concept, pageCounts.entity, pageCounts.source, pageCounts.synthesis, t, warnings.length]);
  const knowledgeDocTotal = useMemo(
    () => (pageCounts.source ?? 0) + (pageCounts.synthesis ?? 0) + (pageCounts.entity ?? 0) + (pageCounts.concept ?? 0),
    [pageCounts.concept, pageCounts.entity, pageCounts.source, pageCounts.synthesis],
  );
  const groupedInboxItems = useMemo(() => {
    const groups: Record<InboxTriageGroup, KnowledgeInboxItem[]> = INBOX_TRIAGE_ORDER.reduce((acc, action) => {
      acc[action] = [];
      return acc;
    }, {} as Record<InboxTriageGroup, KnowledgeInboxItem[]>);
    for (const item of inboxItems) {
      groups[inboxTriage(item).action].push(item);
    }
    return groups;
  }, [inboxItems]);
  const orderedInboxItems = useMemo(() => INBOX_TRIAGE_ORDER.flatMap((key) => groupedInboxItems[key]), [groupedInboxItems]);
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null, [drafts, selectedDraftId]);
  const selectedInboxItem = useMemo(() => inboxItems.find((item) => item.id === selectedInboxId) ?? orderedInboxItems[0] ?? null, [inboxItems, orderedInboxItems, selectedInboxId]);
  const selectedProposal = useMemo(() => proposals.find((proposal) => proposal.id === selectedProposalId) ?? proposals[0] ?? null, [proposals, selectedProposalId]);
  const draftCounts = useMemo(() => drafts.reduce<Record<string, number>>((acc, draft) => {
    acc[draft.status] = (acc[draft.status] ?? 0) + 1;
    return acc;
  }, {}), [drafts]);
  const okfConcepts = okfValidation?.concepts ?? [];
  const selectedOkfCount = selectedOkfConceptIds.size;
  const okfCanImport = Boolean(okfValidation?.success && okfPath && selectedOkfCount > 0);
  const okfAllSelected = okfConcepts.length > 0 && okfConcepts.every((concept) => selectedOkfConceptIds.has(concept.conceptId));
  const selectedRuntimeSuggestion = runtimeSuggestions[selectedRuntimeSuggestionIndex] ?? null;
  const editorSummary = useMemo(() => markdownSummary(editorBody), [editorBody]);
  const editorSourceIds = useMemo(() => {
    const explicit = editorSource.trim();
    if (explicit) return [explicit];
    const slug = editorTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return [`manual:${slug || 'untitled'}`];
  }, [editorSource, editorTitle]);
  const relatedRows = useMemo(() => rows.filter((row) => getLookup(row) !== editorSource).slice(0, 4), [editorSource, rows]);
  const librarianPromptSuggestions = useMemo<KnowledgeLibrarianPromptSuggestion[]>(() => {
    const currentTitle = editorTitle.trim() || t('workspace.untitled');
    return [
      {
        id: 'summarize-current',
        label: t('librarian.suggestions.summarize.label'),
        prompt: t('librarian.suggestions.summarize.prompt', { title: currentTitle }),
      },
      {
        id: 'find-related',
        label: t('librarian.suggestions.related.label'),
        prompt: t('librarian.suggestions.related.prompt', { title: currentTitle }),
      },
      {
        id: 'review-gaps',
        label: t('librarian.suggestions.gaps.label'),
        prompt: t('librarian.suggestions.gaps.prompt', { title: currentTitle }),
      },
    ];
  }, [editorTitle, t]);
  const qualityMetricCards = useMemo(() => QUALITY_METRIC_KINDS.map((kind) => {
    const metric = governanceQualityMetrics?.metrics.find((entry) => entry.kind === kind);
    const count = metric?.count ?? 0;
    const severity = metric?.severity ?? 'info';
    const MetricIcon = QUALITY_METRIC_ICONS[kind];
    const tone = severity === 'error'
      ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400'
      : severity === 'warning'
        ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400'
        : 'border-black/10 bg-surface-input text-muted-foreground dark:border-white/10';
    return {
      kind,
      count,
      severity,
      affectedIds: metric?.affectedIds ?? [],
      MetricIcon,
      tone,
      label: t(`governance.qualityMetrics.kinds.${kind}`),
      hint: t(`governance.qualityMetrics.hints.${kind}`),
    };
  }), [governanceQualityMetrics, t]);

  useEffect(() => {
    if (typeof window === 'undefined' || librarianMessages.length === 0) return;
    const updatedAt = new Date().toISOString();
    const checkpoint: KnowledgeLibrarianCheckpoint = {
      version: 1,
      updatedAt,
      vaultPath: status?.vaultPath,
      editorTitle,
      editorSource,
      messages: librarianMessages.slice(-30),
    };
    try {
      window.localStorage.setItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY, JSON.stringify(checkpoint));
      setLibrarianCheckpointAt(updatedAt);
    } catch {
      // Best-effort checkpoint only; never block the knowledge workspace.
    }
  }, [editorSource, editorTitle, librarianMessages, status?.vaultPath]);

  const clearLibrarianThread = useCallback(() => {
    setLibrarianMessages([]);
    setLibrarianQuestion('');
    setLibrarianError(null);
    setLastLibrarianQuestion('');
    setLibrarianCheckpointAt(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostApi.knowledge.status();
      if (!result.success) throw new Error(result.error || t('errors.status'));
      setStatus(result.status ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const refreshGovernance = useCallback(async () => {
    const [inboxResult, draftResult, proposalResult, sourceSetResult] = await Promise.all([
      hostApi.knowledge.listInboxItems({ status: 'pending', limit: 100 }),
      hostApi.knowledge.listDrafts({ status: 'all', limit: 100 }),
      hostApi.knowledge.listProposals({ status: 'all', limit: 100 }),
      hostApi.knowledge.listSourceSets(),
    ]);
    if (inboxResult.success) setInboxItems(inboxResult.items);
    if (draftResult.success) setDrafts(draftResult.drafts);
    if (proposalResult.success) setProposals(proposalResult.proposals);
    if (sourceSetResult.success) setSourceSets(sourceSetResult.sourceSets);
  }, []);

  useEffect(() => {
    void refreshGovernance();
  }, [refreshGovernance]);

  const refreshRuntimeLessons = useCallback(async () => {
    setRuntimeLessonsRequested(true);
    setRuntimeLessonsLoading(true);
    setError(null);
    try {
      const result = await hostApi.knowledge.runtimeLessonsReport();
      if (!result.success) throw new Error(result.error || t('runtime.errors.report'));
      setRuntimeLessons(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRuntimeLessonsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workbenchTab === 'runtime' && !runtimeLessonsRequested) {
      void refreshRuntimeLessons();
    }
  }, [refreshRuntimeLessons, runtimeLessonsRequested, workbenchTab]);

  const requestRuntimeSuggestions = useCallback(async () => {
    const trajectoryIds = (runtimeLessons?.undistilled ?? []).map((entry) => entry.trajectory_id);
    setRunning('runtimeSuggest');
    setError(null);
    try {
      const result = await hostApi.knowledge.sekbSuggestPrinciples({ trajectoryIds });
      if (!result.success || !result.available) {
        throw new Error(result.error || t('runtime.errors.suggest'));
      }
      setRuntimeSuggestions(result.suggestions);
      setSelectedRuntimeSuggestionIndex(0);
      setRuntimeConfirmResult(null);
      toast.success(t('runtime.toasts.suggested', { count: result.suggestions.length }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [runtimeLessons?.undistilled, t]);

  const confirmRuntimeSuggestion = useCallback(async () => {
    if (!selectedRuntimeSuggestion || !runtimeSessionId.trim()) return;
    const confirmedIndex = selectedRuntimeSuggestionIndex;
    setRunning('runtimeConfirm');
    setError(null);
    try {
      const result = await hostApi.knowledge.sekbConfirmPrinciple({
        suggestion: selectedRuntimeSuggestion,
        sessionId: runtimeSessionId.trim(),
        sourceSystem: 'ui-confirm',
        integrityClaim: 'confirmed',
      });
      if (!result.success || !result.available || !result.principleId) {
        throw new Error(result.error || t('runtime.errors.confirm'));
      }
      setRuntimeConfirmResult(result);
      setRuntimeSuggestions((current) => current.filter((_, index) => index !== confirmedIndex));
      setSelectedRuntimeSuggestionIndex(0);
      setRuntimeSessionId('');
      toast.success(t('runtime.toasts.confirmed'));
      await refreshRuntimeLessons();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshRuntimeLessons, runtimeSessionId, selectedRuntimeSuggestion, selectedRuntimeSuggestionIndex, t]);

  const rejectRuntimeSuggestion = useCallback(async () => {
    if (!selectedRuntimeSuggestion) return;
    const rejectedIndex = selectedRuntimeSuggestionIndex;
    setRunning('runtimeReject');
    setError(null);
    try {
      const result = await hostApi.knowledge.sekbRejectSuggestion({
        suggestion: selectedRuntimeSuggestion,
        ...(runtimeRejectReason.trim() ? { reason: runtimeRejectReason.trim() } : {}),
      });
      if (!result.success || !result.available) {
        throw new Error(result.error || t('runtime.errors.reject'));
      }
      setRuntimeSuggestions((current) => current.filter((_, index) => index !== rejectedIndex));
      setSelectedRuntimeSuggestionIndex(0);
      setRuntimeRejectReason('');
      toast.success(t('runtime.toasts.rejected'));
      await refreshRuntimeLessons();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshRuntimeLessons, runtimeRejectReason, selectedRuntimeSuggestion, selectedRuntimeSuggestionIndex, t]);

  const retrieveRuntimePrinciples = useCallback(async () => {
    if (!runtimeRetrieveIntent.trim() || !runtimeRetrieveType.trim()) return;
    setRunning('runtimeRetrieve');
    setError(null);
    try {
      const contextTags = runtimeRetrieveTags.split(',').map((tag) => tag.trim()).filter(Boolean);
      const result = await hostApi.knowledge.sekbRetrieveForTask({
        taskIntent: runtimeRetrieveIntent.trim(),
        taskType: runtimeRetrieveType.trim(),
        contextTags,
        topK: 5,
      });
      if (!result.success || !result.available) {
        throw new Error(result.error || t('runtime.errors.retrieve'));
      }
      setRuntimeRetrieveResult(result);
      toast.success(t('runtime.toasts.retrieved', { count: result.principles.length }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [runtimeRetrieveIntent, runtimeRetrieveTags, runtimeRetrieveType, t]);

  const runGovernanceChecks = useCallback(async () => {
    setGovernanceRunning(true);
    try {
      const result = await hostApi.knowledge.governanceAudit();
      if (result.success && 'issues' in result) {
        const issues = (result as any).issues ?? [];
        const summaries = (result as any).summaries ?? { contradictions: 0, stale: 0, dangling: 0, duplicates: 0, provenanceGaps: 0 };
        setGovernanceIssues(issues);
        setGovernanceContradictions(summaries.contradictions ?? 0);
        setGovernanceStale(summaries.stale ?? 0);
        setGovernanceDangling(summaries.dangling ?? 0);
        setGovernanceQualityMetrics((result as { qualityMetrics?: KnowledgeQualityMetrics }).qualityMetrics ?? null);
        setGovernanceLastChecked((result as any).runAt ?? null);
      }
    } catch {
      toast.error(t('errors.action'));
    } finally {
      setGovernanceRunning(false);
    }
  }, [t]);

  const runLint = useCallback(async () => {
    setGovernanceRunning(true);
    try {
      const result = await hostApi.knowledge.lint();
      if (result.success) {
        toast.success(t('governance.lintComplete'));
        if (governanceIssues.length > 0) {
          await runGovernanceChecks();
        }
      }
    } catch {
      toast.error(t('errors.action'));
    } finally {
      setGovernanceRunning(false);
    }
  }, [t, governanceIssues.length, runGovernanceChecks]);

  const runCompile = useCallback(async () => {
    setGovernanceRunning(true);
    try {
      const result = await hostApi.knowledge.compile();
      if (result.success) {
        toast.success(t('governance.compileComplete'));
        if (governanceIssues.length > 0) {
          await runGovernanceChecks();
        }
      }
    } catch {
      toast.error(t('errors.action'));
    } finally {
      setGovernanceRunning(false);
    }
  }, [t, governanceIssues.length, runGovernanceChecks]);

  const dismissGovernanceIssue = useCallback((issueId: string) => {
    setDismissedIssueIds(prev => {
      const next = new Set(prev);
      next.add(issueId);
      return next;
    });
    setGovernanceIssues(prev => prev.filter(i => i.id !== issueId));
  }, []);

  const runAction = useCallback(async (key: string, action: () => Promise<{ success?: boolean; error?: string }>) => {
    setRunning(key);
    setError(null);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t(`toasts.${key}`));
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshStatus, t]);

  const pickAndIngest = useCallback(async (mode: 'files' | 'folder') => {
    const result = await hostApi.dialog.open({
      title: mode === 'files' ? t('dialogs.pickFiles') : t('dialogs.pickFolder'),
      properties: mode === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    await runAction('ingest', () => hostApi.knowledge.ingestFiles({ paths: result.filePaths }));
  }, [runAction, t]);

  const validateOkfBundle = useCallback(async () => {
    const result = await hostApi.dialog.open({
      title: t('dialogs.pickOkfBundle'),
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const path = result.filePaths[0];
    setRunning('validateOkf');
    setError(null);
    try {
      const validation = await hostApi.knowledge.validateOkfBundle({ path });
      setOkfPath(path);
      setOkfValidation(validation);
      setSelectedOkfConceptIds(new Set(validation.concepts.map((concept) => concept.conceptId)));
      if (!validation.success) {
        const message = validation.error || t('errors.okfValidation');
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(t('toasts.validateOkf'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [t]);

  const toggleOkfConcept = useCallback((conceptId: string) => {
    setSelectedOkfConceptIds((current) => {
      const next = new Set(current);
      if (next.has(conceptId)) next.delete(conceptId);
      else next.add(conceptId);
      return next;
    });
  }, []);

  const toggleAllOkfConcepts = useCallback(() => {
    setSelectedOkfConceptIds((current) => {
      if (okfConcepts.length > 0 && okfConcepts.every((concept) => current.has(concept.conceptId))) {
        return new Set();
      }
      return new Set(okfConcepts.map((concept) => concept.conceptId));
    });
  }, [okfConcepts]);

  const importOkfBundle = useCallback(async () => {
    if (!okfPath || !okfValidation) return;
    setRunning('importOkf');
    setError(null);
    try {
      const result = await hostApi.knowledge.importOkfBundle({
        path: okfPath,
        conceptIds: Array.from(selectedOkfConceptIds),
      });
      if (!result.success) throw new Error(result.error || t('errors.okfImport'));
      toast.success(t('toasts.importOkf'));
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [okfPath, okfValidation, refreshStatus, selectedOkfConceptIds, t]);

  const searchWiki = useCallback(async (searchTerm?: string) => {
    const term = (searchTerm ?? query).trim();
    if (!term) return;
    if (searchTerm != null) setQuery(term);
    setRunning('search');
    setError(null);
    try {
      const result = await hostApi.knowledge.search({ query: term, maxResults: 12, corpus: 'wiki' });
      if (!result.success) throw new Error(result.error || t('errors.search'));
      setSearchResult(result);
      setSelectedPage(null);
      setSelectedRow(null);
      setSelectedLookup('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [query, t]);

  const addSourceToCurrentSet = useCallback((ref: SourceSetRef | null) => {
    if (!ref) return;
    setCurrentSourceRefs((current) => {
      const next = new Map(current.map((item) => [item.id, item]));
      next.set(ref.id, { ...next.get(ref.id), ...ref });
      return Array.from(next.values());
    });
    if (!sourceSetTitle.trim()) setSourceSetTitle(t('sourceSet.defaultTitle'));
    setCurrentSourceSetId(null);
  }, [sourceSetTitle, t]);

  const clearCurrentSourceSet = useCallback(() => {
    setCurrentSourceRefs([]);
    setSourceSetTitle('');
    setCurrentSourceSetId(null);
  }, []);

  const saveCurrentSourceSet = useCallback(async () => {
    if (currentSourceRefs.length === 0) return;
    setRunning('sourceSetSave');
    setError(null);
    try {
      const result = await hostApi.knowledge.saveSourceSet({
        ...(currentSourceSetId ? { id: currentSourceSetId } : {}),
        title: sourceSetTitle.trim() || t('sourceSet.defaultTitle'),
        sourceRefs: currentSourceRefs,
      });
      if (!result.success || !result.sourceSet) throw new Error(result.error || t('errors.action'));
      setCurrentSourceSetId(result.sourceSet.id);
      setSourceSetTitle(result.sourceSet.title);
      setCurrentSourceRefs(result.sourceSet.sourceRefs);
      setSourceSets((current) => [result.sourceSet!, ...current.filter((item) => item.id !== result.sourceSet!.id)]);
      toast.success(t('sourceSet.saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [currentSourceRefs, currentSourceSetId, sourceSetTitle, t]);

  const createStudioArtifact = useCallback(async (artifactType: KnowledgeArtifactType, label: string) => {
    if (currentSourceRefs.length === 0) return;
    setRunning(`studio:${artifactType}`);
    setError(null);
    try {
      const result = await hostApi.knowledge.createArtifactDraft({
        artifactType,
        title: label,
        question: t('studio.question', { artifact: label }),
        sourceRefs: currentSourceRefs,
        ...(currentSourceSetId ? { sourceSetId: currentSourceSetId } : {}),
      });
      if (!result.success || !result.draft) throw new Error(result.error || t('errors.action'));
      setSelectedDraftId(result.draft.id);
      setWorkbenchTab('drafts');
      await refreshGovernance();
      toast.success(t('studio.artifactCreated'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [currentSourceRefs, currentSourceSetId, refreshGovernance, t]);

  const askLibrarian = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? librarianQuestion).trim();
    if (!question || running) return;
    const userMessage = makeLibrarianMessage('user', question);
    setLibrarianMessages((messages) => [...messages, userMessage].slice(-30));
    setLibrarianQuestion('');
    setLastLibrarianQuestion(question);
    setLibrarianError(null);
    setRunning('librarianAsk');
    setError(null);
    try {
      if (currentSourceRefs.length > 0) {
        const result = await hostApi.knowledge.answerFromSourceSet({
          question,
          sourceRefs: currentSourceRefs,
          ...(currentSourceSetId ? { sourceSetId: currentSourceSetId } : {}),
        });
        if (!result.success) throw new Error(result.error || t('errors.search'));
        const citations: KnowledgeLibrarianCitation[] = result.sources.map((source) => ({
          lookup: source.lookup,
          title: source.title,
          path: source.path || source.lookup,
          excerpt: source.excerpt || t('librarian.emptyCitation'),
        }));
        const groundedAnswer: KnowledgeLibrarianGroundedAnswer = {
          question,
          answer: result.answer,
          sources: result.sources.map((source) => ({
            id: source.id,
            lookup: source.lookup,
            title: source.title,
            path: source.path || source.lookup,
            excerpt: source.excerpt,
            corpus: 'wiki',
            reason: t('sourceSet.answerBoundary'),
          })),
          unknowns: result.unknowns,
          suggestions: result.suggestedNextActions,
          nextActions: result.suggestedNextActions,
          confidence: result.confidence,
          groundingStatus: result.groundingStatus,
          retrieval: {
            query: result.retrievalDiagnostics.query,
            corpus: result.retrievalDiagnostics.corpus,
            roleTag: 'knowledge-librarian',
            resultCount: result.retrievalDiagnostics.resultCount,
            selectedSources: result.sources.map((source) => ({
              id: source.id,
              lookup: source.lookup,
              title: source.title,
              path: source.path || source.lookup,
              excerpt: source.excerpt,
              corpus: 'wiki',
            })),
          },
        };
        setLibrarianMessages((messages) => [...messages, makeLibrarianMessage('assistant', groundedAnswer.answer, citations, groundedAnswer)].slice(-30));
        return;
      }
      const result = await hostApi.knowledge.search({
        query: question,
        maxResults: 4,
        corpus: 'wiki',
        roleTag: 'knowledge-librarian',
      });
      if (!result.success) throw new Error(result.error || t('errors.search'));
      setSearchResult(result);
      setQuery(question);
      const matches = getSearchRows(result).slice(0, 3);
      const citations: KnowledgeLibrarianCitation[] = [];
      for (const row of matches) {
        const lookup = getLookup(row);
        if (!lookup) continue;
        let body = getSnippet(row);
        try {
          const page = await hostApi.knowledge.get({ lookup, lineCount: 80, corpus: 'wiki' });
          if (page.success) body = getPageBody(page as Record<string, unknown>) || body;
        } catch {
          // Search snippets are still useful if a page preview fails.
        }
        const excerpt = readableExcerpt(body, getSnippet(row));
        citations.push({
          lookup,
          title: getTitle(row),
          path: getString(row, ['sourcePath', 'pagePath', 'path']) || lookup,
          score: getScore(row),
          excerpt: excerpt || t('librarian.emptyCitation'),
        });
        void hostApi.knowledge.recordKnowledgeReference({
          targetId: lookup,
          targetKind: 'wiki-page',
          title: getTitle(row),
          sourceRefs: [{ id: lookup, kind: 'wiki', path: lookup }],
          reference: { kind: 'search', lookup, query: question },
        }).catch(() => undefined);
      }

      if (citations.length === 0 && editorBody.trim()) {
        citations.push({
          lookup: editorSource || editorSourceIds[0],
          title: editorTitle.trim() || t('workspace.untitled'),
          path: editorSource || editorSourceIds[0],
          excerpt: readableExcerpt(editorBody, editorSummary) || t('librarian.emptyCitation'),
        });
      }

      const groundedAnswer = buildGroundedLibrarianAnswer({
        question,
        resultCount: getSearchRows(result).length,
        corpus: 'wiki',
        roleTag: 'knowledge-librarian',
        sources: citations.map((citation) => ({
          id: citation.lookup,
          lookup: citation.lookup,
          title: citation.title,
          path: citation.path || citation.lookup,
          excerpt: citation.excerpt,
          corpus: 'wiki',
          ...(typeof citation.score === 'number' ? { score: citation.score } : {}),
          reason: t('librarian.retrieval.selectedReason'),
        })),
        messages: {
          answerIntro: t('librarian.answerIntro', { count: citations.length }),
          answerBoundary: t('librarian.answerBoundary'),
          noAnswer: t('librarian.noAnswer'),
          missingSources: t('librarian.unknowns.noSources'),
          pageSnippetGrounding: t('librarian.unknowns.pageSnippetLevel'),
          suggestionSaveDraft: t('librarian.suggestions.next.saveDraft'),
          suggestionCreateErrorExperience: t('librarian.suggestions.next.createErrorExperience'),
          suggestionSendToSteward: t('librarian.suggestions.next.sendToSteward'),
          suggestionBroadenSearch: t('librarian.suggestions.next.broadenSearch'),
        },
      });
      setLibrarianMessages((messages) => [...messages, makeLibrarianMessage('assistant', groundedAnswer.answer, citations, groundedAnswer)].slice(-30));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLibrarianError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [currentSourceRefs, currentSourceSetId, editorBody, editorSource, editorSourceIds, editorSummary, editorTitle, librarianQuestion, running, t]);

  const copyLibrarianMessage = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedLibrarianMessageId(messageId);
      window.setTimeout(() => setCopiedLibrarianMessageId((current) => (current === messageId ? null : current)), 1600);
    } catch {
      toast.error(t('librarian.copyFailed'));
    }
  }, [t]);

  const saveGroundedAnswerDraft = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianDraft');
    setError(null);
    try {
      const result = await hostApi.knowledge.createDraft(createDraftPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.draftTitlePrefix'),
      }));
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.librarianDraft'));
      await refreshGovernance();
      setWorkbenchTab('drafts');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, t]);

  const createGroundedAnswerErrorExperience = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianErrorExperience');
    setError(null);
    try {
      const result = await hostApi.knowledge.createInboxItem(createErrorExperienceInboxPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.errorExperienceTitlePrefix'),
        createdFromId: answer.question,
      }));
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.librarianErrorExperience'));
      await refreshGovernance();
      setWorkbenchTab('inbox');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, t]);

  const sendGroundedAnswerToSteward = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianSteward');
    setError(null);
    try {
      const created = await hostApi.knowledge.createDraft(createDraftPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.stewardTitlePrefix'),
      }));
      if (!created.success || !created.draft) throw new Error(created.error || t('errors.action'));
      const reviewed = await hostApi.knowledge.stewardReview({ draftId: created.draft.id });
      if (!reviewed.success) throw new Error(reviewed.error || t('errors.action'));
      setStewardReview(reviewed);
      toast.success(t('toasts.librarianSteward'));
      await refreshGovernance();
      setWorkbenchTab('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, t]);

  const openResult = useCallback(async (row: SearchRow) => {
    const lookup = getLookup(row);
    if (!lookup) return;
    setRunning(`get:${lookup}`);
    setError(null);
    try {
      const result = await hostApi.knowledge.get({ lookup, lineCount: 120, corpus: 'wiki' });
      if (!result.success) throw new Error(result.error || t('errors.get'));
      setSelectedPage(result);
      setSelectedRow(row);
      setSelectedLookup(lookup);
      const body = getPageBody(result as Record<string, unknown>);
      setEditorTitle(getTitle(row));
      setEditorBody(body || makeStarterMarkdown(getTitle(row)));
      setEditorSource(lookup);
      setEditorType('source-note');
      setWorkbenchTab('library');
      try {
        const provenance = await hostApi.knowledge.recordKnowledgeReference({
          targetId: lookup,
          targetKind: 'wiki-page',
          title: getTitle(row),
          sourceRefs: [{ id: lookup, kind: 'wiki', path: lookup }],
          reference: {
            kind: 'search',
            lookup,
            ...(query.trim() ? { query: query.trim() } : {}),
          },
        });
        if (provenance.success) setSelectedProvenance(provenance.record ?? null);
      } catch {
        setSelectedProvenance(null);
      }
      if (!draftSources.trim()) setDraftSources(getString(row, ['id', 'pageId', 'pagePath', 'path', 'relativePath']) || lookup);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [draftSources, query, t]);

  const createEditorNote = useCallback(() => {
    const title = t('workspace.untitled');
    setEditorTitle(title);
    setEditorBody(makeStarterMarkdown(title));
    setEditorSource('');
    setEditorTags('');
    setEditorType('source-note');
    setSelectedPage(null);
    setSelectedRow(null);
    setSelectedLookup('');
    setWorkbenchTab('library');
  }, [t]);

  const sendEditorToReview = useCallback(async () => {
    const title = editorTitle.trim() || t('workspace.untitled');
    const body = editorBody.trim();
    if (!body) return;
    const tags = editorTags
      .split(/\r?\n|,/u)
      .map((item) => item.trim())
      .filter(Boolean);
    setRunning('editorDraft');
    setError(null);
    try {
      const draftResult = await hostApi.knowledge.createDraft({
        title,
        body,
        type: editorType,
        sourceIds: editorSourceIds,
        tags,
        createdBy: 'user',
      });
      if (!draftResult.success || !draftResult.draft) throw new Error(draftResult.error || t('errors.action'));
      const proposalResult = await hostApi.knowledge.proposeChange({
        operation: 'create',
        draftId: draftResult.draft.id,
        reason: t('workspace.reviewReason'),
        sources: editorSourceIds.map((id) => ({ id, kind: 'manual' as const })),
      });
      if (!proposalResult.success) throw new Error(proposalResult.error || t('errors.action'));
      toast.success(t('toasts.createDraft'));
      await refreshGovernance();
      setSelectedDraftId(draftResult.draft.id);
      if (proposalResult.proposal) setSelectedProposalId(proposalResult.proposal.id);
      setWorkbenchTab('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [editorBody, editorSourceIds, editorTags, editorTitle, editorType, refreshGovernance, t]);

  const promoteInboxItem = useCallback(async (item?: KnowledgeInboxItem | null) => {
    const target = item ?? selectedInboxItem;
    if (!target) return;
    setRunning(`promoteInbox:${target.id}`);
    setError(null);
    try {
      const result = await hostApi.knowledge.promoteInboxItemToDraft({ id: target.id });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.promoteInbox'));
      await refreshGovernance();
      if (result.draft) setSelectedDraftId(result.draft.id);
      if (result.proposal) setSelectedProposalId(result.proposal.id);
      setWorkbenchTab('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, selectedInboxItem, t]);

  const dismissInboxItem = useCallback(async (item?: KnowledgeInboxItem | null) => {
    const target = item ?? selectedInboxItem;
    if (!target) return;
    setRunning(`dismissInbox:${target.id}`);
    setError(null);
    try {
      const result = await hostApi.knowledge.dismissInboxItem({ id: target.id });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.dismissInbox'));
      await refreshGovernance();
      setSelectedInboxId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, selectedInboxItem, t]);

  const useSelectedResultInDraft = useCallback(() => {
    if (!selectedRow || !selectedPageBody.trim()) return;
    const lookup = selectedLookup || getLookup(selectedRow);
    if (!draftTitle.trim()) setDraftTitle(getTitle(selectedRow));
    if (!draftSources.trim() && lookup) setDraftSources(lookup);
    if (!draftBody.trim()) setDraftBody(selectedPageBody);
    setWorkbenchTab('drafts');
  }, [draftBody, draftSources, draftTitle, selectedLookup, selectedPageBody, selectedRow]);

  const applyDraft = useCallback(async () => {
    const sourceIds = draftSources
      .split(/\r?\n|,/u)
      .map((item) => item.trim())
      .filter(Boolean);
    const tags = draftTags
      .split(/\r?\n|,/u)
      .map((item) => item.trim())
      .filter(Boolean);
    setRunning('createDraft');
    setError(null);
    try {
      const draftResult = await hostApi.knowledge.createDraft({
        title: draftTitle,
        body: draftBody,
        type: draftType,
        sourceIds,
        tags,
        createdBy: 'user',
      });
      if (!draftResult.success || !draftResult.draft) throw new Error(draftResult.error || t('errors.action'));
      const proposalResult = await hostApi.knowledge.proposeChange({
        operation: 'create',
        draftId: draftResult.draft.id,
        reason: t('draft.defaultProposalReason'),
        sources: sourceIds.map((id) => ({ id, kind: 'manual' as const })),
      });
      if (!proposalResult.success) throw new Error(proposalResult.error || t('errors.action'));
      toast.success(t('toasts.createDraft'));
      await refreshGovernance();
      setSelectedDraftId(draftResult.draft.id);
      if (proposalResult.proposal) setSelectedProposalId(proposalResult.proposal.id);
      setWorkbenchTab('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
    setDraftTitle('');
    setDraftBody('');
    setDraftSources('');
    setDraftTags('');
    setDraftType('synthesis');
  }, [draftBody, draftSources, draftTags, draftTitle, draftType, refreshGovernance, t]);

  const askSteward = useCallback(async (draft?: KnowledgeDraft | null) => {
    const target = draft ?? selectedDraft;
    setRunning('stewardReview');
    setError(null);
    try {
      const result = target
        ? await hostApi.knowledge.stewardReview({ draftId: target.id })
        : await hostApi.knowledge.stewardReview({
          title: draftTitle,
          body: draftBody,
          sourceIds: draftSources.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean),
          tags: draftTags.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean),
        });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      setStewardReview(result);
      toast.success(t('toasts.stewardReview'));
      await refreshGovernance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [draftBody, draftSources, draftTags, draftTitle, refreshGovernance, selectedDraft, t]);

  // Area 5 §3.5 — load the KB role registry for the Configure flow.
  const loadStewardConfig = useCallback(async () => {
    try {
      const result = await hostApi.knowledge.stewardConfigGet();
      if (result.success) setStewardConfig(result);
    } catch {
      // Best-effort: if the registry can't be loaded, the Configure modal
      // simply shows nothing. The steward still works via DEFAULT_REGISTRY.
    }
  }, []);

  // Area 5 §3.5 — change the active default role variant.
  const setStewardDefaultRole = useCallback(async (roleId: string) => {
    setRunning('stewardConfigUpdate');
    try {
      const result = await hostApi.knowledge.stewardConfigUpdate({ defaultRoleId: roleId });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      setStewardConfig({ success: true, registry: result.registry, activeRole: result.registry.roles.find((r) => r.roleId === result.registry.defaultRoleId) });
      toast.success(t('toasts.stewardReview'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [t]);

  // Area 5 §3.5 — load the steward registry once on mount so the Configure
  // modal and review-tab steward section have variant metadata available.
  useEffect(() => {
    void loadStewardConfig();
  }, [loadStewardConfig]);

  const reviewAndApply = useCallback(async () => {
    if (!selectedDraft || !selectedProposal) return;
    setRunning('applyReviewedChange');
    setError(null);
    try {
      const reviewResult = await hostApi.knowledge.reviewDraft({ id: selectedDraft.id, action: 'approve', stewardNotes: selectedDraft.stewardNotes });
      if (!reviewResult.success) throw new Error(reviewResult.error || t('errors.action'));
      const applyResult = await hostApi.knowledge.applyReviewedChange({ id: selectedProposal.id });
      if (!applyResult.success) throw new Error(applyResult.error || t('errors.action'));
      toast.success(t('toasts.applyReviewedChange'));
      await refreshGovernance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, selectedDraft, selectedProposal, t]);

  const rejectDraft = useCallback(async () => {
    if (!selectedDraft) return;
    await runAction('rejectDraft', () => hostApi.knowledge.reviewDraft({ id: selectedDraft.id, action: 'reject' }));
    await refreshGovernance();
  }, [refreshGovernance, runAction, selectedDraft]);

  const busy = running != null || loading;

  return (
    <div data-testid="knowledge-page" className="flex h-[calc(100vh-2.5rem)] min-h-0 flex-col overflow-hidden -m-6 bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 px-10 pb-6 pt-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-foreground/70" />
            <h1 className="truncate font-serif text-4xl font-normal tracking-tight text-foreground">{t('title')}</h1>
            <Badge variant="outline" className={cn('border', statusTone)}>
              {ready ? t('status.ready') : t('status.missing')}
            </Badge>
          </div>
          <p className="mt-2 text-subtitle font-medium text-foreground/60">{t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void runAction('configure', () => hostApi.knowledge.configure())} disabled={busy}>
            {running === 'configure' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Wrench className="mr-2 h-3.5 w-3.5" />}
            {t('actions.configure')}
          </Button>
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void runAction('init', () => hostApi.knowledge.init())} disabled={busy}>
            {running === 'init' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
            {t('actions.init')}
          </Button>
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void refreshStatus()} disabled={busy}>
            {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            {t('common:actions.refresh')}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-5 pb-10 md:px-8 xl:px-10">
        {error && (
          <div data-testid="knowledge-error" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div data-testid="knowledge-command-bar" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-surface-modal/90 p-2 shadow-sm backdrop-blur dark:border-white/10">
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void pickAndIngest('files')} disabled={busy}>
            <FilePlus2 className="mr-2 h-3.5 w-3.5" />
            {t('actions.importFiles')}
          </Button>
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void pickAndIngest('folder')} disabled={busy}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" />
            {t('actions.importFolder')}
          </Button>
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void validateOkfBundle()} disabled={busy} data-testid="knowledge-okf-validate">
            {running === 'validateOkf' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-2 h-3.5 w-3.5" />}
            {t('actions.validateOkf')}
          </Button>
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void importOkfBundle()} disabled={busy || !okfCanImport} data-testid="knowledge-okf-import">
            {running === 'importOkf' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
            {t('actions.importOkf')}{selectedOkfCount > 0 ? ` (${selectedOkfCount})` : ''}
          </Button>
          <Button variant="outline" className={cn('ml-auto', QUIET_BUTTON_CLASS)} onClick={() => void runAction('openVault', () => hostApi.knowledge.openVault())} disabled={busy}>
            {t('actions.openVault')}
          </Button>
        </div>

        <section className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]" data-testid="knowledge-assistant-overview">
          <div className={cn(PANEL_CLASS, 'overflow-hidden p-5')}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                  <h2 className="font-serif text-2xl font-normal tracking-tight text-foreground">{t('assistant.title')}</h2>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t('assistant.subtitle')}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setWorkbenchTab('library')} data-testid="knowledge-assistant-browse">
                  <BookOpen className="mr-2 h-4 w-4" />
                  {t('assistant.browse')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={QUIET_BUTTON_CLASS}
                  onClick={() => setWorkbenchTab('governance')}
                  data-testid="knowledge-audit-center-button"
                >
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  {t('governance.openAudit')}
                </Button>
              </div>
            </div>
            <div className="mt-5 grid gap-2 md:grid-cols-4">
              <button
                type="button"
                className="rounded-lg border border-black/10 bg-surface-input/80 p-3 text-left transition-colors hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
                onClick={() => setWorkbenchTab('library')}
                data-testid="knowledge-assistant-docs"
              >
                <div className="text-xl font-semibold tabular-nums tracking-tight">{knowledgeDocTotal}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{t('assistant.docs')}</div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">{t('assistant.docsHint')}</p>
              </button>
              <button
                type="button"
                className="rounded-lg border border-black/10 bg-surface-input/80 p-3 text-left transition-colors hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
                onClick={() => setWorkbenchTab('inbox')}
                data-testid="knowledge-assistant-inbox"
              >
                <div className="text-xl font-semibold tabular-nums tracking-tight">{inboxItems.length}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{t('assistant.pending')}</div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">{t('assistant.pendingHint')}</p>
              </button>
              <button
                type="button"
                className="rounded-lg border border-black/10 bg-surface-input/80 p-3 text-left transition-colors hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
                onClick={() => setWorkbenchTab('drafts')}
                data-testid="knowledge-assistant-drafts"
              >
                <div className="text-xl font-semibold tabular-nums tracking-tight">{drafts.length}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{t('assistant.drafts')}</div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">{t('assistant.draftsHint')}</p>
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  warnings.length > 0
                    ? 'border-yellow-500/20 bg-yellow-500/10 hover:bg-yellow-500/15'
                    : 'border-black/10 bg-surface-input/80 hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5',
                )}
                onClick={() => setWorkbenchTab('governance')}
                data-testid="knowledge-assistant-audit"
              >
                <div className="text-xl font-semibold tabular-nums tracking-tight">{warnings.length}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{t('assistant.health')}</div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">{t('assistant.healthHint')}</p>
              </button>
            </div>
          </div>

          <div className={cn(PANEL_CLASS, 'p-5')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-normal tracking-tight">{t('assistant.mapTitle')}</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('assistant.mapHint')}</p>
              </div>
              <Badge variant="outline" className={cn('border', statusTone)}>
                {ready ? t('status.ready') : t('status.missing')}
              </Badge>
            </div>
            <div className="mt-4 grid gap-2">
              {KNOWLEDGE_TYPES.slice(0, 4).map((type) => {
                const TypeIcon = TYPE_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-surface-input/80 px-3 py-2 text-left transition-colors hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
                    onClick={() => void searchWiki(t(`types.${type}`))}
                    data-testid={`knowledge-assistant-map-${type}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">{t(`types.${type}`)}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{knowledgeTypeCount(pageCounts, type)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {okfValidation && (
          <Card className={cn('mb-4', PANEL_CLASS)} data-testid="knowledge-okf-panel">
            <CardHeader className="p-4">
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>{t('okf.title')}</span>
                <Badge variant="outline" className={cn(
                  'border',
                  okfValidation.success
                    ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-destructive/30 bg-destructive/10 text-destructive',
                )}>
                  {okfValidation.okfVersion ? `OKF ${okfValidation.okfVersion}` : t('okf.badge')}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <div className="grid gap-2 text-sm md:grid-cols-4">
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.concepts')}</span><span className="font-medium tabular-nums">{okfValidation.summary.conceptFiles}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.validConcepts')}</span><span className="font-medium tabular-nums">{okfValidation.summary.validConcepts}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.reservedFiles')}</span><span className="font-medium tabular-nums">{okfValidation.summary.reservedFiles}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.warnings')}</span><span className="font-medium tabular-nums">{okfValidation.summary.warnings}</span></div>
              </div>
              <div className="rounded-lg bg-surface-input px-3 py-2 text-xs">
                <span className="text-muted-foreground">{t('okf.bundlePath')}</span>
                <span className="ml-2 font-mono text-foreground">{okfPath}</span>
              </div>
              {Object.keys(okfValidation.typeDistribution).length > 0 && (
                <div className="flex flex-wrap items-center gap-2" data-testid="knowledge-okf-type-distribution">
                  <span className="text-xs text-muted-foreground">{t('okf.typeDistribution')}</span>
                  {Object.entries(okfValidation.typeDistribution).map(([type, count]) => (
                    <Badge key={type} variant="outline" className="border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">
                      {type}: {count}
                    </Badge>
                  ))}
                </div>
              )}
              {(okfValidation.errors.length > 0 || okfValidation.warnings.length > 0) && (
                <div className="grid gap-3 lg:grid-cols-2">
                  {okfValidation.errors.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" data-testid="knowledge-okf-errors">
                      <div className="font-medium">{t('okf.errors')}</div>
                      {okfValidation.errors.slice(0, 6).map((issue, index) => (
                        <p key={`${issue.code}:${issue.conceptId ?? issue.filePath ?? index}`}>{issue.message}</p>
                      ))}
                    </div>
                  )}
                  {okfValidation.warnings.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400" data-testid="knowledge-okf-warnings">
                      <div className="font-medium">{t('okf.warnings')}</div>
                      {okfValidation.warnings.slice(0, 6).map((issue, index) => (
                        <p key={`${issue.code}:${issue.conceptId ?? issue.filePath ?? index}`}>{issue.message}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {okfConcepts.length > 0 && (
                <div className="space-y-2">
                  <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-surface-input px-3 py-2 text-xs font-medium dark:border-white/10">
                    <input
                      type="checkbox"
                      checked={okfAllSelected}
                      onChange={toggleAllOkfConcepts}
                      data-testid="knowledge-okf-select-all"
                    />
                    {t('okf.selectAll')}
                  </label>
                  <div className="grid max-h-72 gap-2 overflow-auto pr-1">
                    {okfConcepts.map((concept) => (
                      <label
                        key={concept.conceptId}
                        className="grid cursor-pointer gap-2 rounded-lg border border-black/10 bg-surface-input p-3 text-left dark:border-white/10"
                        data-testid="knowledge-okf-concept"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedOkfConceptIds.has(concept.conceptId)}
                            onChange={() => toggleOkfConcept(concept.conceptId)}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{okfConceptTitle(concept)}</span>
                          <Badge variant="outline" className="shrink-0 border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">{concept.frontmatter.type}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 pl-6">
                          <Badge variant="outline" className="max-w-full truncate border-black/10 bg-transparent font-mono text-[10px] dark:border-white/10">{concept.conceptId}</Badge>
                          {concept.frontmatter.resource && <Badge variant="outline" className="max-w-full truncate border-black/10 bg-transparent text-[10px] dark:border-white/10">{concept.frontmatter.resource}</Badge>}
                          {concept.frontmatter.timestamp && <Badge variant="outline" className="border-black/10 bg-transparent text-[10px] dark:border-white/10">{concept.frontmatter.timestamp}</Badge>}
                        </div>
                        {concept.bodyPreview && <p className="line-clamp-2 pl-6 text-xs leading-5 text-muted-foreground">{concept.bodyPreview}</p>}
                        {concept.warnings.length > 0 && (
                          <p className="pl-6 text-xs text-yellow-700 dark:text-yellow-400">
                            {concept.warnings[0].message}
                          </p>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-4" data-testid="knowledge-metrics">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
            <Card key={metric.label} className={cn(PANEL_CLASS, 'cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-black/20 dark:hover:border-white/20')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums tracking-tight">{metric.value}</div>
                    <div className="mt-1 truncate text-xs font-medium text-muted-foreground">{metric.label}</div>
                  </div>
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', metric.tone.replace('text-', 'border-'), metric.tone.replace('text-', 'bg-'), '/10')}>
                    <Icon className={cn('h-4 w-4', metric.tone)} />
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>

        <div className="mt-4 grid gap-1 rounded-xl border border-black/10 bg-surface-modal p-1 shadow-sm dark:border-white/10 md:grid-cols-5" data-testid="knowledge-workbench-tabs">
          {PRIMARY_WORKBENCH_TABS.map((tab) => {
            const TabIcon = TAB_ICONS[tab];
            const isActive = workbenchTab === tab;
            return (
            <button
              key={tab}
              type="button"
              className={cn(
                'flex items-center justify-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer',
                isActive
                  ? 'border-primary/30 bg-primary/5 text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
              )}
              onClick={() => setWorkbenchTab(tab)}
              data-testid={`knowledge-tab-${tab}`}
            >
              {TabIcon && <TabIcon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/60')} />}
              {t(tab === 'library' ? 'tabs.sources' : `tabs.${tab}`)}
            </button>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className={cn(
              'flex items-center gap-2 rounded-lg border border-black/10 bg-surface-modal px-3 py-2 text-sm font-medium transition-all duration-200 dark:border-white/10',
              workbenchTab === 'governance'
                ? 'border-primary/30 bg-primary/5 text-foreground shadow-sm'
                : 'text-muted-foreground hover:border-black/20 hover:bg-black/5 hover:text-foreground dark:hover:border-white/20 dark:hover:bg-white/5',
            )}
            onClick={() => setWorkbenchTab(workbenchTab === 'governance' ? 'library' : 'governance')}
            data-testid="knowledge-tab-governance"
          >
            <ShieldCheck className={cn('h-4 w-4', workbenchTab === 'governance' ? 'text-primary' : 'text-muted-foreground/60')} />
            {workbenchTab === 'governance' ? t('governance.backToLibrary') : t('governance.openAudit')}
          </button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
          <Card className={PANEL_CLASS}>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{t('status.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <div className="grid gap-2 text-sm">
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.vault')}</span><span className="min-w-0 truncate font-mono">{status?.vaultPath || '-'}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.mode')}</span><span className="font-medium text-foreground">{status?.vaultMode || '-'}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.render')}</span><span className="font-medium text-foreground">{status?.renderMode || '-'}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.obsidian')}</span><span className={status?.obsidianCli?.available ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>{status?.obsidianCli?.available ? t('status.available') : t('status.unavailable')}</span></div>
                <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.nativeSources')}</span><span className="font-medium tabular-nums text-foreground">{sourceCounts.native ?? 0}</span></div>
              </div>
              {warnings.length > 0 && (
                <div className="space-y-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs">
                  {warnings.map((warning, index) => (
                    <p key={`${warning.code ?? 'warning'}:${index}`} className="text-yellow-700 dark:text-yellow-400">{warning.message}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={PANEL_CLASS}>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{t('search.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchWiki(); }} placeholder={t('search.placeholder')} data-testid="knowledge-search-input" className="pl-9" />
                </div>
                <Button onClick={() => void searchWiki()} disabled={busy || !query.trim()} data-testid="knowledge-search-submit" size="sm">
                  {running === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-1.5 hidden sm:inline">{t('search.button')}</span>
                </Button>
              </div>
              <div className="grid gap-2">
                {rows.map((row, index) => {
                  const lookup = getLookup(row);
                  const okfBadges = getOkfBadges(row);
                  return (
                    <div
                      key={`${lookup || index}`}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'w-full rounded-lg border border-black/10 p-3 text-left transition-all duration-200 hover:shadow-sm dark:border-white/10',
                        lookup && lookup === selectedLookup
                          ? 'border-primary/30 bg-primary/5 shadow-sm'
                          : 'hover:bg-black/5 hover:border-black/20 dark:hover:bg-white/5 dark:hover:border-white/20',
                      )}
                      data-testid="knowledge-search-result"
                      onClick={() => void openResult(row)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void openResult(row); }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{getTitle(row)}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 rounded-md px-2 text-[11px]"
                            data-testid="knowledge-source-set-add-result"
                            onClick={(event) => {
                              event.stopPropagation();
                              addSourceToCurrentSet(sourceRefFromSearchRow(row));
                            }}
                            disabled={!lookup}
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            {t('sourceSet.addResult')}
                          </Button>
                          {running === `get:${lookup}` && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                          {lookup && lookup === selectedLookup && !running && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                      </div>
                      {okfBadges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {okfBadges.map((badge) => (
                            <Badge key={badge} variant="outline" className="max-w-full truncate border-black/10 bg-black/5 text-[10px] dark:border-white/10 dark:bg-white/10">
                              {badge}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {getSnippet(row) && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{getSnippet(row)}</p>}
                      {lookup && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">{lookup}</p>}
                    </div>
                  );
                })}
                {searchResult && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('search.empty')}</p>}
              </div>
              {selectedPage && (
                <div className="rounded-lg border border-black/10 bg-surface-input dark:border-white/10">
                  <div className="flex items-center justify-between gap-3 border-b border-black/10 px-3 py-2 dark:border-white/10">
                    <div className="min-w-0">
                      <span className="block truncate text-xs font-medium text-muted-foreground">{selectedLookup || t('search.preview')}</span>
                      {selectedProvenance && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                          <History className="h-3 w-3" />
                          {t('provenance.references', { count: selectedProvenance.references.length })}
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 rounded-md px-2 text-tiny"
                      data-testid="knowledge-use-result-draft"
                      onClick={useSelectedResultInDraft}
                      disabled={!selectedRow || !selectedPageBody.trim()}
                    >
                      {t('search.useInDraft')}
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-auto p-3 text-xs">
                    {selectedPageBody}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className={cn('mt-4', workbenchTab === 'library' ? WORKSPACE_CHROME_CLASS : PANEL_CLASS)}>
          <CardHeader className={cn('p-4', workbenchTab === 'library' && 'border-b border-black/10 bg-surface-input/60 dark:border-white/10')}>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span className="flex min-w-0 items-center gap-2">
                {(() => {
                  const ActiveIcon = TAB_ICONS[workbenchTab];
                  return ActiveIcon ? <ActiveIcon className="h-4 w-4 shrink-0 text-muted-foreground" /> : null;
                })()}
                <span className="truncate">{t(workbenchTab === 'library' ? 'sources.title' : workbenchTab === 'inbox' ? 'inbox.title' : workbenchTab === 'drafts' ? 'draft.title' : workbenchTab === 'review' ? 'review.title' : workbenchTab === 'runtime' ? 'runtime.title' : 'governance.title')}</span>
              </span>
              <Badge variant="outline" className="shrink-0 border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">
                {t('governance.readOnlyBadge')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className={cn(workbenchTab === 'library' ? 'p-0' : 'p-4 pt-0')}>
            {workbenchTab === 'library' && (
              <div className="grid min-h-[680px] xl:grid-cols-[280px_minmax(0,1fr)_320px]" data-testid="knowledge-library">
                <aside className={cn('flex min-h-0 flex-col border-b border-black/10 dark:border-white/10 xl:border-b-0 xl:border-r', WORKSPACE_SECTION_CLASS)} data-testid="knowledge-vault-sidebar">
                  <div className="flex items-center justify-between gap-2 border-b border-black/10 bg-background/30 p-3 dark:border-white/10">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{t('workspace.vault')}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{status?.vaultPath || t('workspace.localVault')}</div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-md border-black/10 bg-background/60 px-2 shadow-none dark:border-white/10" onClick={createEditorNote} data-testid="knowledge-new-note">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    <div className="mb-3 text-[11px] font-semibold uppercase text-muted-foreground">{t('workspace.documents')}</div>
                    <div className="space-y-1.5" data-testid="knowledge-document-list">
                      {rows.length === 0 && (
                        <div className="rounded-md border border-dashed border-black/10 p-3 text-xs leading-5 text-muted-foreground dark:border-white/10">
                          {t('workspace.emptyDocuments')}
                        </div>
                      )}
                      {rows.map((row, index) => {
                        const lookup = getLookup(row);
                        const selected = lookup && lookup === editorSource;
                        return (
                          <button
                            key={`${lookup || index}:workspace`}
                            type="button"
                            className={cn(
                              'flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors',
                              selected
                                ? 'border-primary/30 bg-primary/5 text-foreground shadow-sm'
                                : 'border-transparent hover:border-black/10 hover:bg-black/5 dark:hover:border-white/10 dark:hover:bg-white/5',
                            )}
                            onClick={() => void openResult(row)}
                            data-testid="knowledge-document-row"
                          >
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{getTitle(row)}</span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground">{lookup || t('workspace.localDraft')}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mb-2 mt-5 text-[11px] font-semibold uppercase text-muted-foreground">{t('workspace.types')}</div>
                    <div className="grid gap-1.5">
                      {KNOWLEDGE_TYPES.map((type) => {
                        const TypeIcon = TYPE_ICONS[type];
                        const accent = TYPE_COLOR[type];
                        return (
                          <button
                            key={type}
                            type="button"
                            className={cn('flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors', accent)}
                            onClick={() => void searchWiki(t(`types.${type}`))}
                            data-testid={`knowledge-type-${type}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{t(`types.${type}`)}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{knowledgeTypeCount(pageCounts, type)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>
                <section className="flex min-h-0 flex-col bg-background/70" data-testid="knowledge-markdown-workspace">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-background/60 p-3 dark:border-white/10">
                    <div className="min-w-0 flex-1">
                      <Input value={editorTitle} onChange={(event) => setEditorTitle(event.target.value)} className="h-9 border-transparent bg-transparent px-0 font-serif text-2xl tracking-tight shadow-none focus-visible:ring-0" data-testid="knowledge-editor-title" />
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{editorSource || t('workspace.localDraft')}</span>
                        <span>{editorBody.length} {t('workspace.characters')}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-black/10 bg-background/50 p-1 dark:border-white/10">
                      {(['edit', 'preview', 'split'] as MarkdownEditorMode[]).map((mode) => {
                        const ModeIcon = mode === 'edit' ? Edit3 : mode === 'preview' ? Eye : Columns3;
                        return (
                          <button key={mode} type="button" className={cn('flex h-7 w-8 items-center justify-center rounded-md transition-colors', editorMode === mode ? 'bg-black/5 text-foreground dark:bg-white/10' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5')} onClick={() => setEditorMode(mode)} title={t(`workspace.modes.${mode}`)} data-testid={`knowledge-editor-mode-${mode}`}>
                            <ModeIcon className="h-3.5 w-3.5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-3 border-b border-black/10 bg-surface-input/50 p-3 dark:border-white/10 md:grid-cols-[180px_minmax(0,1fr)_160px]">
                    <select value={editorType} onChange={(event) => setEditorType(event.target.value as KnowledgeDraftType)} className="h-9 rounded-lg border border-black/10 bg-background/70 px-3 text-sm shadow-none dark:border-white/10" data-testid="knowledge-editor-type">
                      {KNOWLEDGE_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
                    </select>
                    <Input value={editorTags} onChange={(event) => setEditorTags(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} className="h-9 bg-background/70 shadow-none" data-testid="knowledge-editor-tags" />
                    <Button type="button" className="shadow-none" onClick={() => void sendEditorToReview()} disabled={busy || !editorBody.trim()} data-testid="knowledge-editor-save-draft">
                      {running === 'editorDraft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {t('workspace.submitReview')}
                    </Button>
                  </div>
                  <div className={cn('grid min-h-0 flex-1 gap-0', editorMode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
                    {(editorMode === 'edit' || editorMode === 'split') && (
                      <Textarea value={editorBody} onChange={(event) => setEditorBody(event.target.value)} className="min-h-[520px] resize-none rounded-none border-0 bg-background/40 p-5 font-mono text-sm leading-7 shadow-none focus-visible:ring-0" data-testid="knowledge-markdown-editor" />
                    )}
                    {(editorMode === 'preview' || editorMode === 'split') && (
                      <div className="min-h-[520px] overflow-auto border-black/10 bg-background/80 p-6 text-sm leading-7 dark:border-white/10 lg:border-l [&_a]:text-primary [&_blockquote]:border-l-2 [&_blockquote]:border-black/20 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_h1]:mb-4 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-normal [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-normal [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-black/5 [&_pre]:p-3 [&_ul]:list-disc" data-testid="knowledge-markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{editorBody || t('workspace.emptyPreview')}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </section>
                <aside className={cn('flex min-h-0 flex-col gap-3 border-t border-black/10 p-3 dark:border-white/10 xl:border-l xl:border-t-0', WORKSPACE_SECTION_CLASS)} data-testid="knowledge-librarian-panel">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                      <Bot className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{t('librarian.title')}</div>
                      <div className="text-[11px] text-muted-foreground">{t('librarian.roleId')}</div>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-black/10 bg-background/60 p-3 dark:border-white/10" data-testid="knowledge-source-set-panel">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Layers className="h-3.5 w-3.5" />
                          {t('sourceSet.title')}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t('sourceSet.count', { count: currentSourceRefs.length })}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" className="h-7 rounded-md px-2 text-[11px]" onClick={clearCurrentSourceSet} disabled={currentSourceRefs.length === 0} data-testid="knowledge-source-set-clear">
                        {t('sourceSet.clear')}
                      </Button>
                    </div>
                    <Input
                      value={sourceSetTitle}
                      onChange={(event) => setSourceSetTitle(event.target.value)}
                      placeholder={t('sourceSet.titlePlaceholder')}
                      className="h-8 bg-background/70 text-xs shadow-none"
                      data-testid="knowledge-source-set-title"
                    />
                    {currentSourceRefs.length === 0 ? (
                      <p className="text-xs leading-5 text-muted-foreground">{t('sourceSet.empty')}</p>
                    ) : (
                      <div className="max-h-28 space-y-1 overflow-auto">
                        {currentSourceRefs.map((ref) => (
                          <div key={ref.id} className="rounded-md bg-black/5 px-2 py-1.5 text-xs dark:bg-white/10" data-testid="knowledge-source-set-ref">
                            <span className="block truncate font-medium">{ref.label || ref.id}</span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">{ref.path || ref.id}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {sourceSets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {sourceSets.slice(0, 3).map((sourceSet) => (
                          <button
                            key={sourceSet.id}
                            type="button"
                            className="max-w-full truncate rounded-md border border-black/10 px-2 py-1 text-[11px] text-muted-foreground hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                            onClick={() => {
                              setCurrentSourceSetId(sourceSet.id);
                              setSourceSetTitle(sourceSet.title);
                              setCurrentSourceRefs(sourceSet.sourceRefs);
                            }}
                            data-testid="knowledge-source-set-saved"
                          >
                            {sourceSet.title}
                          </button>
                        ))}
                      </div>
                    )}
                    <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void saveCurrentSourceSet()} disabled={busy || currentSourceRefs.length === 0} data-testid="knowledge-source-set-save">
                      {running === 'sourceSetSave' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                      {t('sourceSet.save')}
                    </Button>
                    <p className="text-[11px] leading-4 text-muted-foreground">{t('sourceSet.answerBoundary')}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border border-black/10 bg-background/60 p-3 dark:border-white/10" data-testid="knowledge-studio-actions">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      {t('studio.title')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {STUDIO_ARTIFACTS.map((artifact) => {
                        const label = t(artifact.labelKey);
                        return (
                          <Button
                            key={artifact.type}
                            type="button"
                            variant="outline"
                            className="h-8 rounded-md px-2 text-[11px] shadow-none"
                            onClick={() => void createStudioArtifact(artifact.type, label)}
                            disabled={busy || currentSourceRefs.length === 0}
                            data-testid={`knowledge-studio-artifact-${artifact.type}`}
                          >
                            {running === `studio:${artifact.type}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileText className="mr-1 h-3 w-3" />}
                            <span className="truncate">{label}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-lg border border-black/10 bg-background/60 p-3 dark:border-white/10">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><FileText className="h-3.5 w-3.5" />{t('librarian.currentDocument')}</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{editorSummary || t('librarian.noSummary')}</p>
                  </div>
                  <div className="grid gap-2">
                    <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => setLibrarianOpen(true)} data-testid="knowledge-librarian-open"><MessageCircle className="mr-2 h-3.5 w-3.5" />{t('librarian.openAssistant')}</Button>
                    <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void askSteward(null)} disabled={busy || !editorBody.trim()} data-testid="knowledge-librarian-review"><ShieldCheck className="mr-2 h-3.5 w-3.5" />{t('librarian.askSteward')}</Button>
                  </div>
                  <div className="space-y-2 rounded-lg border border-black/10 bg-background/60 p-3 dark:border-white/10">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Link2 className="h-3.5 w-3.5" />{t('librarian.related')}</div>
                    {relatedRows.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">{t('librarian.noRelated')}</p> : relatedRows.map((row, index) => (
                      <button key={`${getLookup(row) || index}:related`} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/5" onClick={() => void openResult(row)} data-testid="knowledge-related-row">
                        <span className="block truncate font-medium">{getTitle(row)}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{getLookup(row)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2 rounded-lg border border-black/10 bg-background/60 p-3 dark:border-white/10">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Tags className="h-3.5 w-3.5" />{t('librarian.boundaries')}</div>
                    <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                      <li>{t('librarian.boundaryRead')}</li>
                      <li>{t('librarian.boundaryDraft')}</li>
                      <li>{t('librarian.boundarySources')}</li>
                    </ul>
                  </div>
                </aside>
              </div>
            )}

            {workbenchTab === 'inbox' && (
              <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]" data-testid="knowledge-inbox">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-lg bg-surface-input p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                      <Inbox className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-xl font-semibold tabular-nums tracking-tight">{inboxItems.length}</div>
                      <div className="text-[11px] text-muted-foreground">{t('inbox.pending')}</div>
                    </div>
                  </div>
                  <div className="max-h-80 space-y-1.5 overflow-auto">
                    {inboxItems.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('inbox.empty')}</p>}
                    {INBOX_TRIAGE_ORDER.map((triageAction) => {
                      const group = groupedInboxItems[triageAction];
                      if (group.length === 0) return null;
                      return (
                        <div key={triageAction} className="space-y-1.5" data-testid={`knowledge-inbox-group-${triageAction}`}>
                          <div className="flex items-center justify-between px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <span>{t(`inbox.triage.groups.${triageAction}`)}</span>
                            <span className="tabular-nums">{group.length}</span>
                          </div>
                          {group.map((item) => {
                            const isSelected = selectedInboxItem?.id === item.id;
                            const triage = inboxTriage(item);
                            const recommendationForItem = inboxRecommendation(item);
                            const reason = inboxReason(item);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={cn(
                                  'w-full rounded-lg border border-black/10 p-3 text-left transition-all duration-200 dark:border-white/10',
                                  isSelected
                                    ? 'border-primary/30 bg-primary/5 shadow-sm'
                                    : 'hover:bg-black/5 hover:border-black/20 dark:hover:bg-white/5 dark:hover:border-white/20',
                                )}
                                onClick={() => setSelectedInboxId(item.id)}
                                data-testid="knowledge-inbox-row"
                              >
                                <div className="flex items-center gap-2">
                                  {item.warnings && item.warnings.length > 0 && (
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                                  )}
                                  <span className="truncate text-sm font-semibold">{item.title}</span>
                                </div>
                                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <Badge variant="outline" className={cn('border text-[10px] font-medium', inboxTriageClass(triage.action))} data-testid="knowledge-inbox-triage-badge">
                                    {t(`inbox.triage.actions.${triage.action}`)}
                                  </Badge>
                                  <Badge variant="outline" className={cn('border text-[10px] font-medium', inboxRecommendationClass(recommendationForItem))}>
                                    {t(`inbox.recommendations.${recommendationForItem}`)}
                                  </Badge>
                                  <Badge variant="outline" className="border-black/10 bg-transparent text-[10px] font-medium dark:border-white/10">{t(`inbox.kinds.${item.kind}`)}</Badge>
                                  <span className="font-medium">{t(`types.${item.type}`)}</span>
                                  <span>{t('inbox.evidenceCount', { count: inboxEvidenceCount(item) })}</span>
                                  {item.warnings && item.warnings.length > 0 && (
                                    <span className="text-yellow-600 dark:text-yellow-400 font-medium">{t('inbox.warningCount', { count: item.warnings.length })}</span>
                                  )}
                                </div>
                                {reason && <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{reason}</p>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{selectedInboxItem?.title ?? t('inbox.noSelection')}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedInboxItem ? `${t(`inbox.kinds.${selectedInboxItem.kind}`)} / ${t(`types.${selectedInboxItem.type}`)}` : t('inbox.noSelectionHint')}
                        </p>
                        {selectedInboxItem && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="outline" className={cn('border', inboxTriageClass(inboxTriage(selectedInboxItem).action))} data-testid="knowledge-inbox-triage-detail">
                              {t(`inbox.triage.actions.${inboxTriage(selectedInboxItem).action}`)}
                            </Badge>
                            <Badge variant="outline" className={cn('border', inboxRecommendationClass(inboxRecommendation(selectedInboxItem)))}>
                              {t(`inbox.recommendations.${inboxRecommendation(selectedInboxItem)}`)}
                            </Badge>
                            <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400" data-testid="knowledge-inbox-boundary">
                              {t('inbox.boundary')}
                            </Badge>
                            <span className="text-muted-foreground">{t('inbox.evidenceCount', { count: inboxEvidenceCount(selectedInboxItem) })}</span>
                            {inboxOverallScore(selectedInboxItem) != null && (
                              <span className="text-muted-foreground">{t('inbox.score', { score: Math.round((inboxOverallScore(selectedInboxItem) ?? 0) * 100) })}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {selectedInboxItem && (
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void promoteInboxItem(selectedInboxItem)}
                            disabled={busy}
                            data-testid="knowledge-inbox-promote"
                          >
                            {running === `promoteInbox:${selectedInboxItem.id}` ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
                            {t('inbox.promote')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={QUIET_BUTTON_CLASS}
                            onClick={() => void dismissInboxItem(selectedInboxItem)}
                            disabled={busy}
                            data-testid="knowledge-inbox-dismiss"
                          >
                            <X className="mr-2 h-3.5 w-3.5" />
                            {t('inbox.dismiss')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="max-h-80 overflow-auto rounded-lg border border-black/10 bg-surface-input p-3 font-mono text-xs dark:border-white/10">
                    {selectedInboxItem?.body ?? t('inbox.noSelection')}
                  </div>
                  {selectedInboxItem && (
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                      <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10" data-testid="knowledge-inbox-recommendation">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium text-muted-foreground">{t('inbox.triage.title')}</div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge variant="outline" className={cn('border text-[10px]', inboxTriageClass(inboxTriage(selectedInboxItem).action))}>
                              {t('inbox.triage.confidence', { confidence: Math.round(inboxTriage(selectedInboxItem).confidence * 100) })}
                            </Badge>
                            {inboxOverallScore(selectedInboxItem) != null && (
                              <Badge variant="outline" className={cn('border text-[10px]', inboxRecommendationClass(inboxRecommendation(selectedInboxItem)))}>
                                {t('inbox.score', { score: Math.round((inboxOverallScore(selectedInboxItem) ?? 0) * 100) })}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {inboxReason(selectedInboxItem) || t('inbox.noReason')}
                        </p>
                        {(inboxTriage(selectedInboxItem).duplicateOf || (inboxTriage(selectedInboxItem).conflictWith ?? []).length > 0 || (inboxTriage(selectedInboxItem).suggestedEdits ?? []).length > 0) && (
                          <div className="mt-3 grid gap-2 text-xs" data-testid="knowledge-inbox-triage-details">
                            {inboxTriage(selectedInboxItem).duplicateOf && (
                              <div className="rounded-md border border-black/10 bg-background/50 p-2 dark:border-white/10">
                                <span className="font-medium text-foreground/80">{t('inbox.triage.duplicateOf')}: </span>
                                <span className="font-mono text-[11px] text-muted-foreground">{inboxTriage(selectedInboxItem).duplicateOf}</span>
                              </div>
                            )}
                            {(inboxTriage(selectedInboxItem).conflictWith ?? []).length > 0 && (
                              <div className="rounded-md border border-black/10 bg-background/50 p-2 dark:border-white/10">
                                <span className="font-medium text-foreground/80">{t('inbox.triage.conflictWith')}: </span>
                                <span className="font-mono text-[11px] text-muted-foreground">{(inboxTriage(selectedInboxItem).conflictWith ?? []).join(', ')}</span>
                              </div>
                            )}
                            {(inboxTriage(selectedInboxItem).suggestedEdits ?? []).length > 0 && (
                              <div className="rounded-md border border-black/10 bg-background/50 p-2 dark:border-white/10">
                                <div className="font-medium text-foreground/80">{t('inbox.triage.suggestedEdits')}</div>
                                <ul className="mt-1 space-y-1 text-muted-foreground">
                                  {(inboxTriage(selectedInboxItem).suggestedEdits ?? []).map((edit) => (
                                    <li key={edit}>{edit}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-3 grid gap-2 sm:grid-cols-3" data-testid="knowledge-inbox-scores">
                          {INBOX_SCORE_DIMENSIONS.map((dimension) => {
                            const percent = inboxScorePercent(selectedInboxItem, dimension);
                            return (
                              <div key={dimension} className="rounded-md border border-black/10 bg-background/50 p-2 dark:border-white/10">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t(`inbox.scoreDimensions.${dimension}`)}</div>
                                <div className="mt-1 text-sm font-semibold tabular-nums">{percent == null ? t('inbox.notAvailable') : t('inbox.percentValue', { percent })}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10" data-testid="knowledge-inbox-context">
                        <div className="text-xs font-medium text-muted-foreground">{t('inbox.context')}</div>
                        <dl className="mt-2 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">{t('inbox.statusLabel')}</dt>
                            <dd className="min-w-0 truncate font-medium">
                              {t(inboxKnownLabel('status', selectedInboxItem.status) || 'inbox.notAvailable')}
                            </dd>
                          </div>
                          {inboxMetadataString(selectedInboxItem, 'missionId') && (
                            <div className="flex items-center justify-between gap-2">
                              <dt className="text-muted-foreground">{t('inbox.missionId')}</dt>
                              <dd className="min-w-0 truncate font-mono text-[11px]">{inboxMetadataString(selectedInboxItem, 'missionId')}</dd>
                            </div>
                          )}
                          {inboxMetadataNumber(selectedInboxItem, 'tick') != null && (
                            <div className="flex items-center justify-between gap-2">
                              <dt className="text-muted-foreground">{t('inbox.tick')}</dt>
                              <dd className="min-w-0 truncate font-medium">{t('inbox.tickValue', { tick: inboxMetadataNumber(selectedInboxItem, 'tick') })}</dd>
                            </div>
                          )}
                          {inboxMetadataString(selectedInboxItem, 'outcome') && (
                            <div className="flex items-center justify-between gap-2">
                              <dt className="text-muted-foreground">{t('inbox.outcome')}</dt>
                              <dd className="min-w-0 truncate font-medium">
                                {t(inboxKnownLabel('outcomes', inboxMetadataString(selectedInboxItem, 'outcome')) || 'inbox.notAvailable')}
                              </dd>
                            </div>
                          )}
                          {inboxMetadataString(selectedInboxItem, 'temporality') && (
                            <div className="flex items-center justify-between gap-2">
                              <dt className="text-muted-foreground">{t('inbox.temporalityLabel')}</dt>
                              <dd className="min-w-0 truncate font-medium">
                                {t(inboxKnownLabel('temporality', inboxMetadataString(selectedInboxItem, 'temporality')) || 'inbox.notAvailable')}
                              </dd>
                            </div>
                          )}
                        </dl>
                        {inboxMetadataString(selectedInboxItem, 'captureKey') && (
                          <details className="mt-3 rounded-md border border-black/10 bg-background/50 p-2 text-xs dark:border-white/10" data-testid="knowledge-inbox-audit">
                            <summary className="cursor-pointer select-none font-medium text-muted-foreground">{t('inbox.auditDetails')}</summary>
                            <div className="mt-2 min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                              <span className="font-sans text-muted-foreground">{t('inbox.captureKey')}: </span>
                              {inboxMetadataString(selectedInboxItem, 'captureKey')}
                            </div>
                          </details>
                        )}
                      </div>
                      <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10" data-testid="knowledge-inbox-sources">
                        <div className="text-xs font-medium text-muted-foreground">{t('inbox.sources')}</div>
                        <div className="mt-2 space-y-2">
                          {selectedInboxItem.sourceRefs.length === 0 && selectedInboxItem.sourceIds.length === 0 && <p className="text-xs text-muted-foreground">{t('inbox.noSources')}</p>}
                          {inboxSourceDisplays(selectedInboxItem).map((ref) => (
                            <div key={ref.id} className="rounded-md border border-black/10 bg-background/50 p-2 dark:border-white/10" data-testid="knowledge-inbox-source">
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge variant="outline" className="shrink-0 border-black/10 bg-transparent text-[10px] font-medium dark:border-white/10">
                                  {t(inboxSourceKindLabel(ref.kind))}
                                </Badge>
                                <span className="min-w-0 truncate text-xs font-medium">{ref.label ?? ref.path ?? ref.id}</span>
                              </div>
                              {(ref.path || ref.id) && (
                                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{ref.path ?? ref.id}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10" data-testid="knowledge-inbox-warnings">
                        <div className="text-xs font-medium text-muted-foreground">{t('inbox.warnings')}</div>
                        <div className="mt-2 space-y-2">
                          {(selectedInboxItem.warnings ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t('inbox.noWarnings')}</p>}
                          {(selectedInboxItem.warnings ?? []).map((warning) => (
                            <p key={warning} className="rounded-md border border-yellow-500/20 bg-yellow-500/10 p-2 text-xs text-yellow-700 dark:text-yellow-400">{warning}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {workbenchTab === 'drafts' && (
              <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]" data-testid="knowledge-draft-inbox">
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(['draft', 'steward_reviewed', 'approved'] as const).map((statusKey) => (
                      <div key={statusKey} className="rounded-lg bg-surface-input p-3">
                        <div className="text-xl font-semibold tabular-nums tracking-tight">{draftCounts[statusKey] ?? 0}</div>
                        <div className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">{t(`draft.status.${statusKey}`)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-auto">
                    {drafts.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('draft.empty')}</p>}
                    {drafts.map((draft) => {
                      const isSelected = selectedDraft?.id === draft.id;
                      const TypeIcon = TYPE_ICONS[draft.type];
                      const accent = TYPE_COLOR[draft.type];
                      return (
                      <button
                        key={draft.id}
                        type="button"
                        className={cn(
                          'w-full rounded-lg border border-black/10 p-3 text-left transition-all duration-200 dark:border-white/10',
                          isSelected
                            ? 'border-primary/30 bg-primary/5 shadow-sm'
                            : 'hover:bg-black/5 hover:border-black/20 dark:hover:bg-white/5 dark:hover:border-white/20',
                        )}
                        onClick={() => {
                          setSelectedDraftId(draft.id);
                          setWorkbenchTab('review');
                        }}
                        data-testid="knowledge-draft-row"
                      >
                        <div className="flex items-center gap-2">
                          <TypeIcon className={cn('h-3.5 w-3.5 shrink-0', accent)} />
                          <span className="truncate text-sm font-semibold">{draft.title}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-medium">{t(`types.${draft.type}`)}</span>
                          <span className="text-muted-foreground/50">·</span>
                          <span>{t(`draft.status.${draft.status}`)}</span>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>{t('draft.titleLabel')}</Label>
                      <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} data-testid="knowledge-draft-title" />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('draft.typeLabel')}</Label>
                      <select value={draftType} onChange={(event) => setDraftType(event.target.value as KnowledgeDraftType)} className="h-9 w-full rounded-lg border border-black/10 bg-surface-input px-3 text-sm transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 dark:border-white/10 cursor-pointer" data-testid="knowledge-draft-type">
                        {KNOWLEDGE_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('draft.sourcesLabel')}</Label>
                      <Textarea value={draftSources} onChange={(event) => setDraftSources(event.target.value)} rows={4} className="font-mono text-xs" data-testid="knowledge-draft-sources" />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('draft.tagsLabel')}</Label>
                      <Input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} data-testid="knowledge-draft-tags" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => void applyDraft()}
                        disabled={busy || !draftTitle.trim() || !draftBody.trim() || !draftSources.trim()}
                        data-testid="knowledge-draft-apply"
                      >
                        {running === 'createDraft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t('draft.create')}
                      </Button>
                      <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void askSteward(null)} disabled={busy || !draftTitle.trim() || !draftBody.trim()}>
                        {t('draft.askSteward')}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('draft.bodyLabel')}</Label>
                    <Textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={16} className="font-mono text-xs" data-testid="knowledge-draft-body" />
                  </div>
                </div>
              </div>
            )}

            {workbenchTab === 'review' && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" data-testid="knowledge-review">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-lg bg-surface-input p-3">
                    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', TYPE_COLOR[selectedDraft?.type ?? 'synthesis'])}>
                      {(() => { const TI = TYPE_ICONS[selectedDraft?.type ?? 'synthesis']; return <TI className="h-5 w-5" />; })()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{selectedDraft?.title ?? t('review.noDraft')}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{selectedDraft ? `${t(`types.${selectedDraft.type}`)} · ${t(`draft.status.${selectedDraft.status}`)}` : '-'}</div>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-auto rounded-lg border border-black/10 bg-surface-input p-3 font-mono text-xs leading-relaxed dark:border-white/10">
                    {selectedDraft?.body ?? t('review.noDraft')}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                    <div className="text-sm font-semibold">{t('review.diffTitle')}</div>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-xs leading-relaxed text-muted-foreground">{selectedProposal?.diff ?? selectedDraft?.body ?? t('review.noProposal')}</pre>
                  </div>
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-relaxed text-yellow-700 dark:text-yellow-400">
                    {t('review.confirmationBoundary')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void reviewAndApply()} disabled={busy || !selectedDraft || !selectedProposal} data-testid="knowledge-review-apply">
                      {running === 'applyReviewedChange' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {t('review.approveAndApply')}
                    </Button>
                    <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void askSteward(selectedDraft)} disabled={busy || !selectedDraft} data-testid="knowledge-steward-review">
                      {t('draft.askSteward')}
                    </Button>
                    <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void rejectDraft()} disabled={busy || !selectedDraft}>
                      {t('review.reject')}
                    </Button>
                    <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => setShowStewardConfig(true)} data-testid="knowledge-steward-configure">
                      <Wrench className="mr-1.5 h-3.5 w-3.5" />
                      {t('review.steward.configure')}
                    </Button>
                  </div>

                  {/* Area 5 §3.5 — Steward review result for the current draft */}
                  <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10" data-testid="knowledge-steward-review-result">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{t('review.steward.section')}</div>
                      {stewardReview ? (
                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-400">
                          {t('review.steward.classifiedAs', { type: t(`types.${stewardReview.type}`) })}
                        </Badge>
                      ) : null}
                    </div>
                    {stewardReview ? (
                      <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
                        {stewardConfig?.activeRole ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground/80">{t('review.steward.variant')}:</span>
                            <span>{stewardConfig.activeRole.displayName ?? stewardConfig.activeRole.roleId}</span>
                            <Badge variant="outline" className="ml-1 border-slate-500/30 bg-slate-500/5 text-slate-700 dark:text-slate-400">
                              {stewardConfig.activeRole.classification === 'semantic' ? t('review.steward.semantic') : t('review.steward.heuristic')}
                            </Badge>
                          </div>
                        ) : null}
                        {stewardReview.warnings.length > 0 ? (
                          <div>
                            <div className="font-medium text-foreground/80">{t('review.steward.warnings')}</div>
                            <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-700 dark:text-amber-400">
                              {stewardReview.warnings.map((warning, idx) => (
                                <li key={idx}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {stewardReview.notes ? (
                          <div>
                            <div className="font-medium text-foreground/80">{t('review.steward.notes')}</div>
                            <p className="mt-1 whitespace-pre-wrap">{stewardReview.notes}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">{t('review.steward.noReview')}</p>
                    )}
                  </div>

                  {/* Area 5 §3.5 — Steward queue: drafts awaiting steward review */}
                  <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10" data-testid="knowledge-steward-queue">
                    <div className="text-sm font-semibold">{t('review.steward.queue')}</div>
                    {drafts.filter((draft) => draft.status === 'steward_reviewed').length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs">
                        {drafts.filter((draft) => draft.status === 'steward_reviewed').map((draft) => (
                          <li key={draft.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                              onClick={() => setSelectedDraftId(draft.id)}
                            >
                              <span className="truncate font-medium text-foreground/80">{draft.title}</span>
                              <span className="shrink-0 text-muted-foreground">{t(`types.${draft.type}`)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">{t('review.steward.queueEmpty')}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {workbenchTab === 'runtime' && (
              <div className="space-y-5" data-testid="knowledge-runtime-lessons">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 pb-4 dark:border-white/10">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{t('runtime.title')}</h3>
                      <Badge variant="outline" className="border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                        {t('runtime.reviewOnlyBadge')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('runtime.subtitle')}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={QUIET_BUTTON_CLASS}
                    onClick={() => void refreshRuntimeLessons()}
                    disabled={runtimeLessonsLoading}
                    data-testid="knowledge-runtime-refresh"
                  >
                    {runtimeLessonsLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                    {t('runtime.refresh')}
                  </Button>
                </div>

                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-700 dark:text-yellow-400">
                  {t('runtime.reviewBoundary')}
                </div>

                {runtimeLessonsLoading && !runtimeLessons ? (
                  <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('runtime.loading')}
                  </div>
                ) : null}

                {!runtimeLessonsLoading && runtimeLessons && !runtimeLessons.available ? (
                  <div className="rounded-lg border border-black/10 bg-surface-input p-5 text-sm text-muted-foreground dark:border-white/10">
                    {t('runtime.unavailable')}
                  </div>
                ) : null}

                {runtimeLessons?.available ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {([
                        ['trajectories', runtimeLessons.counts.trajectories],
                        ['undistilled', runtimeLessons.counts.undistilledTrajectories],
                        ['principles', runtimeLessons.counts.activePrinciples],
                      ] as const).map(([key, value]) => (
                        <div key={key} className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                          <div className="text-xl font-semibold tabular-nums">{value}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{t(`runtime.metrics.${key}`)}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <section className="space-y-3" aria-labelledby="runtime-undistilled-title">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 id="runtime-undistilled-title" className="text-sm font-semibold">{t('runtime.undistilledTitle')}</h4>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void requestRuntimeSuggestions()}
                            disabled={busy || runtimeLessons.undistilled.length === 0}
                            data-testid="knowledge-runtime-suggest"
                          >
                            {running === 'runtimeSuggest' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                            {t(running === 'runtimeSuggest' ? 'runtime.suggesting' : 'runtime.requestSuggestions')}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {runtimeLessons.undistilled.map((entry) => (
                            <div key={entry.trajectory_id} className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <span className="text-sm font-medium">{entry.task_intent}</span>
                                <Badge variant="outline" className="border-black/10 bg-black/5 text-[10px] dark:border-white/10 dark:bg-white/10">{entry.outcome}</Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                <Badge variant="outline" className="border-black/10 bg-transparent font-mono text-[10px] dark:border-white/10">{entry.trajectory_id}</Badge>
                                <Badge variant="outline" className="border-black/10 bg-transparent text-[10px] dark:border-white/10">{t('runtime.taskType')}: {entry.task_type}</Badge>
                                {entry.context_fingerprint.map((tag) => <Badge key={tag} variant="outline" className="border-black/10 bg-transparent text-[10px] dark:border-white/10">{tag}</Badge>)}
                              </div>
                              {entry.error_signature ? <p className="mt-2 break-words text-xs text-red-700 dark:text-red-400">{t('runtime.errorSignature')}: {entry.error_signature}</p> : null}
                            </div>
                          ))}
                          {runtimeLessons.undistilled.length === 0 ? <p className="rounded-lg bg-surface-input p-3 text-sm text-muted-foreground">{t('runtime.emptyUndistilled')}</p> : null}
                        </div>
                      </section>

                      <section className="space-y-3" aria-labelledby="runtime-principles-title">
                        <h4 id="runtime-principles-title" className="text-sm font-semibold">{t('runtime.principlesTitle')}</h4>
                        <div className="space-y-2">
                          {runtimeLessons.activePrinciples.map((principle) => (
                            <div key={principle.principle_id} className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <span className="text-sm font-medium">{principle.title}</span>
                                <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400">{principle.criticality}</Badge>
                              </div>
                              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{principle.principle_id}</p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {principle.task_types.map((type) => <Badge key={`type:${type}`} variant="outline" className="border-black/10 bg-transparent text-[10px] dark:border-white/10">{type}</Badge>)}
                                {principle.context_tags.map((tag) => <Badge key={`tag:${tag}`} variant="outline" className="border-black/10 bg-transparent text-[10px] dark:border-white/10">{tag}</Badge>)}
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">{t('runtime.retrievals')}: {principle.retrieval_count} · {t('runtime.adoptions')}: {principle.adoption_count}</p>
                            </div>
                          ))}
                          {runtimeLessons.activePrinciples.length === 0 ? <p className="rounded-lg bg-surface-input p-3 text-sm text-muted-foreground">{t('runtime.emptyPrinciples')}</p> : null}
                        </div>
                      </section>
                    </div>

                    <section className="space-y-2" aria-labelledby="runtime-index-title">
                      <h4 id="runtime-index-title" className="text-sm font-semibold">{t('runtime.indexTitle')}</h4>
                      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-black/10 bg-surface-input p-3 text-xs leading-5 text-muted-foreground dark:border-white/10">{runtimeLessons.indexPreview || t('runtime.emptyIndex')}</pre>
                    </section>

                    <section className="space-y-3 border-t border-black/10 pt-5 dark:border-white/10" aria-labelledby="runtime-suggestions-title">
                      <div>
                        <h4 id="runtime-suggestions-title" className="text-sm font-semibold">{t('runtime.suggestionsTitle')}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{t('runtime.suggestionsDescription')}</p>
                      </div>
                      {runtimeSuggestions.length > 0 ? (
                        <div className="grid gap-4 xl:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
                          <div className="space-y-2" data-testid="knowledge-runtime-suggestion-list">
                            {runtimeSuggestions.map((suggestion, index) => (
                              <button
                                key={`${suggestion.source_trajectory_ids.join(':')}:${index}`}
                                type="button"
                                className={cn(
                                  'w-full rounded-lg border p-3 text-left transition-colors',
                                  selectedRuntimeSuggestionIndex === index
                                    ? 'border-primary/30 bg-primary/5'
                                    : 'border-black/10 bg-surface-input hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
                                )}
                                onClick={() => setSelectedRuntimeSuggestionIndex(index)}
                                data-testid={`knowledge-runtime-suggestion-${index}`}
                              >
                                <span className="block text-sm font-medium">{runtimePrincipleField(suggestion, 'title') || suggestion.cluster_summary}</span>
                                <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{suggestion.cluster_summary}</span>
                                <span className="mt-2 block text-[10px] font-medium text-primary">{t('runtime.confidence')}: {Math.round(suggestion.confidence * 100)}%</span>
                              </button>
                            ))}
                          </div>

                          {selectedRuntimeSuggestion ? (
                            <div className="space-y-4 rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10" data-testid="knowledge-runtime-suggestion-review">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <h5 className="text-sm font-semibold">{runtimePrincipleField(selectedRuntimeSuggestion, 'title') || t('runtime.untitledSuggestion')}</h5>
                                  <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">{Math.round(selectedRuntimeSuggestion.confidence * 100)}%</Badge>
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">{selectedRuntimeSuggestion.cluster_summary}</p>
                                <div className="flex flex-wrap gap-1">
                                  {selectedRuntimeSuggestion.source_trajectory_ids.map((id) => <Badge key={id} variant="outline" className="border-black/10 bg-transparent font-mono text-[10px] dark:border-white/10">{id}</Badge>)}
                                </div>
                              </div>
                              {(['condition', 'action', 'reason', 'task_types', 'context_tags', 'criticality'] as const).map((field) => {
                                const value = runtimePrincipleField(selectedRuntimeSuggestion, field);
                                return value ? (
                                  <div key={field}>
                                    <div className="text-[11px] font-medium text-muted-foreground">{t(`runtime.fields.${field}`)}</div>
                                    <p className="mt-1 text-sm leading-5">{value}</p>
                                  </div>
                                ) : null;
                              })}

                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label htmlFor="runtime-session-id">{t('runtime.sessionId')}</Label>
                                  <Input id="runtime-session-id" value={runtimeSessionId} onChange={(event) => setRuntimeSessionId(event.target.value)} placeholder={t('runtime.sessionPlaceholder')} data-testid="knowledge-runtime-session-id" />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="runtime-reject-reason">{t('runtime.rejectReason')}</Label>
                                  <Input id="runtime-reject-reason" value={runtimeRejectReason} onChange={(event) => setRuntimeRejectReason(event.target.value)} placeholder={t('runtime.rejectPlaceholder')} data-testid="knowledge-runtime-reject-reason" />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" onClick={() => void confirmRuntimeSuggestion()} disabled={busy || !runtimeSessionId.trim()} data-testid="knowledge-runtime-confirm">
                                  {running === 'runtimeConfirm' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                                  {t(running === 'runtimeConfirm' ? 'runtime.confirming' : 'runtime.confirm')}
                                </Button>
                                <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void rejectRuntimeSuggestion()} disabled={busy} data-testid="knowledge-runtime-reject">
                                  {running === 'runtimeReject' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1.5 h-3.5 w-3.5" />}
                                  {t(running === 'runtimeReject' ? 'runtime.rejecting' : 'runtime.reject')}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="rounded-lg bg-surface-input p-3 text-sm text-muted-foreground">{t('runtime.noSuggestions')}</p>
                      )}

                      {runtimeConfirmResult?.principleId ? (
                        <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400" data-testid="knowledge-runtime-confirm-result">
                          {t('runtime.confirmResult')}: <span className="font-mono">{runtimeConfirmResult.principleId}</span>
                        </div>
                      ) : null}
                    </section>

                    <section className="space-y-4 border-t border-black/10 pt-5 dark:border-white/10" aria-labelledby="runtime-retrieve-title">
                      <div>
                        <h4 id="runtime-retrieve-title" className="text-sm font-semibold">{t('runtime.retrieveTitle')}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{t('runtime.retrieveDescription')}</p>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-retrieve-intent">{t('runtime.taskIntent')}</Label>
                          <Input id="runtime-retrieve-intent" value={runtimeRetrieveIntent} onChange={(event) => setRuntimeRetrieveIntent(event.target.value)} placeholder={t('runtime.taskIntentPlaceholder')} data-testid="knowledge-runtime-retrieve-intent" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-retrieve-type">{t('runtime.taskType')}</Label>
                          <Input id="runtime-retrieve-type" value={runtimeRetrieveType} onChange={(event) => setRuntimeRetrieveType(event.target.value)} placeholder={t('runtime.taskTypePlaceholder')} data-testid="knowledge-runtime-retrieve-type" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-retrieve-tags">{t('runtime.contextTags')}</Label>
                          <Input id="runtime-retrieve-tags" value={runtimeRetrieveTags} onChange={(event) => setRuntimeRetrieveTags(event.target.value)} placeholder={t('runtime.contextTagsPlaceholder')} data-testid="knowledge-runtime-retrieve-tags" />
                        </div>
                      </div>
                      <Button type="button" onClick={() => void retrieveRuntimePrinciples()} disabled={busy || !runtimeRetrieveIntent.trim() || !runtimeRetrieveType.trim()} data-testid="knowledge-runtime-retrieve">
                        {running === 'runtimeRetrieve' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
                        {t(running === 'runtimeRetrieve' ? 'runtime.retrieving' : 'runtime.retrieve')}
                      </Button>

                      {runtimeRetrieveResult ? (
                        <div className="grid gap-3 lg:grid-cols-2" data-testid="knowledge-runtime-retrieve-result">
                          <div className="space-y-2">
                            {runtimeRetrieveResult.principles.map((principle) => (
                              <div key={principle.principle_id} className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                                <div className="text-sm font-medium">{principle.title}</div>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">{principle.action}</p>
                              </div>
                            ))}
                            {runtimeRetrieveResult.principles.length === 0 ? <p className="rounded-lg bg-surface-input p-3 text-sm text-muted-foreground">{t('runtime.noRetrieved')}</p> : null}
                          </div>
                          <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                            <div className="text-xs font-semibold text-sky-700 dark:text-sky-400">{t('runtime.advisoryTitle')}</div>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground" data-testid="knowledge-runtime-injection">{runtimeRetrieveResult.injection || t('runtime.emptyAdvisory')}</pre>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  </>
                ) : null}
              </div>
            )}

            {workbenchTab === 'governance' && (
              <div className="space-y-4" data-testid="knowledge-governance">
                {/* Run buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => void runGovernanceChecks()}
                    disabled={governanceRunning}
                    variant="default"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                    data-testid="knowledge-governance-run"
                  >
                    {governanceRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t('governance.runHealthCheck')}
                  </Button>
                  <Button
                    onClick={() => void runLint()}
                    disabled={governanceRunning}
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg border-black/10 px-3 text-xs font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    {t('governance.runLint')}
                  </Button>
                  <Button
                    onClick={() => void runCompile()}
                    disabled={governanceRunning}
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg border-black/10 px-3 text-xs font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('governance.runCompile')}
                  </Button>
                  {governanceRunning && (
                    <span className="text-xs text-muted-foreground">{t('governance.checking')}</span>
                  )}
                </div>

                {/* Health summary cards */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className={cn(
                    'rounded-lg border p-4 transition-shadow',
                    governanceContradictions > 0
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-black/10 bg-surface-input dark:border-white/10'
                  )}>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border',
                        governanceContradictions > 0
                          ? 'border-red-500/20 bg-red-500/10'
                          : 'border-green-500/20 bg-green-500/10'
                      )}>
                        <AlertTriangle className={cn(
                          'h-5 w-5',
                          governanceContradictions > 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'
                        )} />
                      </div>
                      <div>
                        <div className="text-xl font-semibold tabular-nums tracking-tight">{governanceContradictions}</div>
                        <div className="text-[11px] text-muted-foreground">{t('governance.contradictions')}</div>
                      </div>
                    </div>
                    {governanceContradictions > 0 && governanceIssues.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {governanceIssues.filter(i => i.category === 'contradiction').slice(0, 3).map(issue => (
                          <button
                            key={issue.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-2 rounded-md bg-red-500/5 px-2 py-1.5 text-left text-xs hover:bg-red-500/10"
                            onClick={() => dismissGovernanceIssue(issue.id)}
                            data-testid={`governance-issue-${issue.id}`}
                          >
                            <span className="truncate text-red-700 dark:text-red-400">{issue.title}</span>
                            <X className="h-3 w-3 shrink-0 text-red-500/60 hover:text-red-500" />
                          </button>
                        ))}
                        {governanceIssues.filter(i => i.category === 'contradiction').length > 3 && (
                          <div className="text-xs text-muted-foreground px-2">
                            +{governanceIssues.filter(i => i.category === 'contradiction').length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                    {governanceContradictions === 0 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">{t('governance.noIssues')}</p>
                    )}
                  </div>

                  <div className={cn(
                    'rounded-lg border p-4 transition-shadow',
                    governanceStale > 0
                      ? 'border-yellow-500/30 bg-yellow-500/5'
                      : 'border-black/10 bg-surface-input dark:border-white/10'
                  )}>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border',
                        governanceStale > 0
                          ? 'border-yellow-500/20 bg-yellow-500/10'
                          : 'border-sky-500/20 bg-sky-500/10'
                      )}>
                        <History className={cn(
                          'h-5 w-5',
                          governanceStale > 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-sky-700 dark:text-sky-400'
                        )} />
                      </div>
                      <div>
                        <div className="text-xl font-semibold tabular-nums tracking-tight">{governanceStale}</div>
                        <div className="text-[11px] text-muted-foreground">{t('governance.stale')}</div>
                      </div>
                    </div>
                    {governanceStale > 0 && governanceIssues.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {governanceIssues.filter(i => i.category === 'stale').slice(0, 3).map(issue => (
                          <button
                            key={issue.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-2 rounded-md bg-yellow-500/5 px-2 py-1.5 text-left text-xs hover:bg-yellow-500/10"
                            onClick={() => dismissGovernanceIssue(issue.id)}
                            data-testid={`governance-issue-${issue.id}`}
                          >
                            <span className="truncate text-yellow-700 dark:text-yellow-400">{issue.title}</span>
                            <X className="h-3 w-3 shrink-0 text-yellow-500/60 hover:text-yellow-500" />
                          </button>
                        ))}
                        {governanceIssues.filter(i => i.category === 'stale').length > 3 && (
                          <div className="text-xs text-muted-foreground px-2">
                            +{governanceIssues.filter(i => i.category === 'stale').length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                    {governanceStale === 0 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">{t('governance.noIssues')}</p>
                    )}
                  </div>

                  <div className={cn(
                    'rounded-lg border p-4 transition-shadow',
                    governanceDangling > 0
                      ? 'border-yellow-500/30 bg-yellow-500/5'
                      : 'border-black/10 bg-surface-input dark:border-white/10'
                  )}>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border',
                        governanceDangling > 0
                          ? 'border-yellow-500/20 bg-yellow-500/10'
                          : 'border-violet-500/20 bg-violet-500/10'
                      )}>
                        <Layers className={cn(
                          'h-5 w-5',
                          governanceDangling > 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-violet-700 dark:text-violet-400'
                        )} />
                      </div>
                      <div>
                        <div className="text-xl font-semibold tabular-nums tracking-tight">{governanceDangling}</div>
                        <div className="text-[11px] text-muted-foreground">{t('governance.dangling')}</div>
                      </div>
                    </div>
                    {governanceDangling > 0 && governanceIssues.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {governanceIssues.filter(i => i.category === 'dangling').slice(0, 3).map(issue => (
                          <button
                            key={issue.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-2 rounded-md bg-yellow-500/5 px-2 py-1.5 text-left text-xs hover:bg-yellow-500/10"
                            onClick={() => dismissGovernanceIssue(issue.id)}
                            data-testid={`governance-issue-${issue.id}`}
                          >
                            <span className="truncate text-yellow-700 dark:text-yellow-400">{issue.title}</span>
                            <X className="h-3 w-3 shrink-0 text-yellow-500/60 hover:text-yellow-500" />
                          </button>
                        ))}
                        {governanceIssues.filter(i => i.category === 'dangling').length > 3 && (
                          <div className="text-xs text-muted-foreground px-2">
                            +{governanceIssues.filter(i => i.category === 'dangling').length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                    {governanceDangling === 0 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">{t('governance.noIssues')}</p>
                    )}
                  </div>
                </div>

                <section className="space-y-3" data-testid="knowledge-quality-metrics">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold">{t('governance.qualityMetrics.title')}</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t('governance.qualityMetrics.description')}</p>
                    </div>
                    <Badge variant="outline" className="border-black/10 bg-surface-input text-xs font-medium dark:border-white/10">
                      {governanceQualityMetrics ? t('governance.qualityMetrics.sourceAudit') : t('governance.qualityMetrics.pendingAudit')}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {qualityMetricCards.map(({ kind, count, severity, affectedIds, MetricIcon, tone, label, hint }) => (
                      <div
                        key={kind}
                        className={cn('rounded-lg border p-3', tone)}
                        data-testid={`knowledge-quality-metric-${kind}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-foreground">{label}</div>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{hint}</p>
                          </div>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-background/50">
                            <MetricIcon className="h-4 w-4" />
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{count}</span>
                          <span className="rounded-md border border-current/20 bg-background/40 px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            {t(`governance.qualityMetrics.severity.${severity}`)}
                          </span>
                        </div>
                        {affectedIds.length > 0 ? (
                          <div className="mt-2 truncate text-[10px] text-muted-foreground" title={affectedIds.join(', ')}>
                            {t('governance.qualityMetrics.affected', { count: affectedIds.length })}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>

                {/* Action list */}
                {governanceIssues.length > 0 && (
                  <div className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                    <h4 className="mb-3 text-sm font-semibold">{t('governance.suggestions')}</h4>
                    <div className="space-y-1.5">
                      {governanceIssues.map(issue => (
                        <div
                          key={issue.id}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm',
                            issue.severity === 'error' ? 'bg-red-500/5' :
                            issue.severity === 'warning' ? 'bg-yellow-500/5' :
                            'bg-surface-modal'
                          )}
                          data-testid={`governance-action-${issue.id}`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                              'shrink-0 text-xs font-semibold uppercase tracking-wider',
                              issue.severity === 'error' ? 'text-red-600 dark:text-red-400' :
                              issue.severity === 'warning' ? 'text-yellow-600 dark:text-yellow-400' :
                              'text-muted-foreground'
                            )}>
                              {issue.severity === 'error' ? '!' : issue.severity === 'warning' ? '~' : 'i'}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-foreground">{issue.title}</div>
                              <div className="truncate text-[11px] text-muted-foreground">{issue.description}</div>
                              {issue.affectedPageIds.length > 0 && (
                                <div className="mt-1 text-[10px] text-muted-foreground/60">
                                  {issue.category} — {issue.affectedPageIds.length} page(s)
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 rounded-md px-2 text-[11px] font-medium text-foreground/60 hover:text-foreground"
                              onClick={() => dismissGovernanceIssue(issue.id)}
                              data-testid={`governance-dismiss-${issue.id}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-3 dark:border-white/5">
                      <span className="text-[11px] text-muted-foreground">{t('governance.lastCheck', { time: governanceLastChecked ? new Date(governanceLastChecked).toLocaleString() : '-' })}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 rounded-md border-black/10 px-2 text-[11px] font-medium shadow-none dark:border-white/10"
                        onClick={() => setGovernanceIssues([])}
                        data-testid="knowledge-governance-dismiss-all"
                      >
                        <X className="h-3 w-3" />
                        {t('governance.dismissAll')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {governanceIssues.length === 0 && !governanceRunning && (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 bg-surface-input p-8 dark:border-white/10">
                    <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground/80">{t('governance.allClear')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t('governance.allClearHint')}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

          </CardContent>
        </Card>
      </main>

      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 flex h-12 items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-600 px-4 text-white shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        onClick={() => setLibrarianOpen(true)}
        data-testid="knowledge-librarian-fab"
        aria-label={t('librarian.openAssistant')}
      >
        <Bot className="h-5 w-5" />
        <span className="hidden text-sm font-medium md:inline">{t('librarian.openAssistant')}</span>
      </button>

      {librarianOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/35 p-3 backdrop-blur-[2px] md:items-stretch md:p-4" role="dialog" aria-modal="true" data-testid="knowledge-librarian-modal">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-black/10 bg-surface-modal shadow-2xl dark:border-white/10 md:max-h-none">
            <div className="flex items-center justify-between gap-3 border-b border-black/10 bg-emerald-500/10 px-4 py-3 dark:border-white/10">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                  <Bot className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{t('librarian.modalTitle')}</div>
                  <div className="truncate text-xs text-muted-foreground">{t('librarian.modalSubtitle')}</div>
                </div>
              </div>
              <button type="button" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5" onClick={() => setLibrarianOpen(false)} aria-label={t('review.steward.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 bg-surface-input/80 px-3 py-2 text-xs text-muted-foreground dark:border-white/10" data-testid="knowledge-librarian-checkpoint">
                <span className="flex min-w-0 items-center gap-2">
                  <History className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {librarianCheckpointAt ? t('librarian.checkpointSaved', { time: new Date(librarianCheckpointAt).toLocaleTimeString() }) : t('librarian.noCheckpoint')}
                  </span>
                </span>
                <Button type="button" variant="ghost" className="h-7 rounded-md px-2 text-[11px]" onClick={clearLibrarianThread} disabled={librarianMessages.length === 0} data-testid="knowledge-librarian-clear">
                  {t('librarian.clearThread')}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {(['ask', 'organize', 'review'] as const).map((mode) => (
                  <div key={mode} className="rounded-lg border border-black/10 bg-surface-input/80 p-3 dark:border-white/10" data-testid={`knowledge-librarian-capability-${mode}`}>
                    <div className="text-sm font-semibold">{t(`librarian.capabilities.${mode}.title`)}</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`librarian.capabilities.${mode}.body`)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-black/10 bg-surface-input/80 p-3 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{editorTitle}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{editorSource || t('workspace.localDraft')}</div>
                  </div>
                  <Badge variant="outline" className="border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">{t(`types.${editorType}`)}</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{editorSummary || t('librarian.noSummary')}</p>
              </div>

              <div className="mt-4 rounded-xl border border-black/10 bg-background/60 p-3 dark:border-white/10" data-testid="knowledge-librarian-thread">
                <div className="mb-3 flex flex-wrap gap-2" data-testid="knowledge-librarian-suggestions">
                  {librarianPromptSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="rounded-full border border-black/10 bg-surface-input px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => void askLibrarian(suggestion.prompt)}
                      disabled={busy}
                      data-testid={`knowledge-librarian-suggestion-${suggestion.id}`}
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {librarianMessages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-black/10 bg-surface-input/50 p-4 text-center text-xs leading-5 text-muted-foreground dark:border-white/10">
                      {t('librarian.threadEmpty')}
                    </div>
                  ) : librarianMessages.map((message) => (
                    <KnowledgeAssistantMessage
                      key={message.id}
                      message={message}
                      copied={copiedLibrarianMessageId === message.id}
                      copyLabel={t('librarian.copy')}
                      copiedLabel={t('librarian.copied')}
                      roleLabel={t('librarian.roleId')}
                      userLabel={t('librarian.you')}
                      citationsLabel={t('librarian.citations')}
                      sectionLabels={{
                        answer: t('librarian.sections.answer'),
                        sources: t('librarian.sections.sources'),
                        unknowns: t('librarian.sections.unknowns'),
                        nextAction: t('librarian.sections.nextAction'),
                        retrieval: t('librarian.sections.retrieval'),
                        query: t('librarian.retrieval.query'),
                        corpus: t('librarian.retrieval.corpus'),
                        roleTag: t('librarian.retrieval.roleTag'),
                        resultCount: t('librarian.retrieval.resultCount'),
                        selectedSources: t('librarian.retrieval.selectedSources'),
                        confidence: t('librarian.confidence'),
                        groundingStatus: {
                          grounded: t('librarian.groundingStatus.grounded'),
                          partial: t('librarian.groundingStatus.partial'),
                          missing_sources: t('librarian.groundingStatus.missingSources'),
                        },
                      }}
                      actionLabels={{
                        saveDraft: t('librarian.actions.saveDraft'),
                        createErrorExperience: t('librarian.actions.createErrorExperience'),
                        sendToSteward: t('librarian.actions.sendToSteward'),
                      }}
                      onCopy={(content) => void copyLibrarianMessage(message.id, content)}
                      onOpenCitation={(citation) => void openResult({ title: citation.title, pagePath: citation.lookup, snippet: citation.excerpt })}
                      onSaveDraft={(answer) => void saveGroundedAnswerDraft(answer)}
                      onCreateErrorExperience={(answer) => void createGroundedAnswerErrorExperience(answer)}
                      onSendToSteward={(answer) => void sendGroundedAnswerToSteward(answer)}
                    />
                  ))}
                  {running === 'librarianAsk' ? (
                    <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-surface-input/80 px-3 py-2 text-xs text-muted-foreground dark:border-white/10" data-testid="knowledge-librarian-loading">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('librarian.searching')}
                    </div>
                  ) : null}
                  {librarianError ? (
                    <KnowledgeAssistantErrorCard
                      error={librarianError}
                      title={t('librarian.errorTitle')}
                      retryLabel={t('librarian.retry')}
                      dismissLabel={t('librarian.dismissError')}
                      onRetry={() => void askLibrarian(lastLibrarianQuestion)}
                      onDismiss={() => setLibrarianError(null)}
                    />
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void searchWiki(editorTitle)} disabled={busy || !editorTitle.trim()} data-testid="knowledge-librarian-search">
                  <Search className="mr-2 h-3.5 w-3.5" />
                  {t('librarian.actions.searchRelated')}
                </Button>
                <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void askSteward(null)} disabled={busy || !editorBody.trim()} data-testid="knowledge-librarian-steward">
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  {t('librarian.actions.stewardReview')}
                </Button>
                <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => setWorkbenchTab('inbox')} data-testid="knowledge-librarian-inbox">
                  <Inbox className="mr-2 h-3.5 w-3.5" />
                  {t('librarian.actions.openInbox')}
                </Button>
                <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void sendEditorToReview()} disabled={busy || !editorBody.trim()} data-testid="knowledge-librarian-submit">
                  <Save className="mr-2 h-3.5 w-3.5" />
                  {t('librarian.actions.submitDraft')}
                </Button>
              </div>

              <div className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-700 dark:text-yellow-400">
                {t('librarian.writeBoundary')}
              </div>
            </div>

            <div className="border-t border-black/10 bg-surface-input/70 p-3 dark:border-white/10">
              <KnowledgeAssistantPromptInput
                value={librarianQuestion}
                onChange={setLibrarianQuestion}
                onSubmit={() => void askLibrarian()}
                disabled={busy}
                running={running === 'librarianAsk'}
                placeholder={t('librarian.askPlaceholder')}
                askLabel={t('librarian.askButton')}
                hint={t('librarian.askHint')}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Area 5 §3.5 — Configure Steward modal: variant list + active selection */}
      {showStewardConfig ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="knowledge-steward-config-modal" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl border border-black/10 bg-surface-modal p-5 shadow-lg dark:border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{t('review.steward.configureTitle')}</div>
              <button type="button" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5" onClick={() => setShowStewardConfig(false)} aria-label={t('review.steward.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {stewardConfig?.registry ? (
              <div className="mt-3 space-y-2">
                {stewardConfig.registry.roles.map((role) => {
                  const isActive = role.roleId === stewardConfig.registry.defaultRoleId;
                  return (
                    <div
                      key={role.roleId}
                      className={cn(
                        'rounded-lg border p-3 transition-colors',
                        isActive
                          ? 'border-violet-500/40 bg-violet-500/5'
                          : 'border-black/10 bg-surface-input dark:border-white/10',
                      )}
                      data-testid={`knowledge-steward-variant-${role.roleId}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-foreground/80">{role.displayName ?? role.roleId}</span>
                            {isActive ? (
                              <Badge variant="outline" className="border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-400">
                                {t('review.steward.activeVariant')}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline" className="border-slate-500/30 bg-slate-500/5 text-slate-700 dark:text-slate-400">
                              {role.classification === 'semantic' ? t('review.steward.semantic') : t('review.steward.heuristic')}
                            </Badge>
                            {role.reviewFocus && role.reviewFocus.length > 0 ? (
                              <span className="truncate">{role.reviewFocus.join(' · ')}</span>
                            ) : null}
                          </div>
                          {role.description ? (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{role.description}</p>
                          ) : null}
                        </div>
                        {!isActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 rounded-md px-2 text-xs font-medium"
                            onClick={() => void setStewardDefaultRole(role.roleId)}
                            disabled={busy}
                            data-testid={`knowledge-steward-variant-set-active-${role.roleId}`}
                          >
                            {running === 'stewardConfigUpdate' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            {t('review.steward.setActive')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t('review.steward.queueEmpty')}</p>
            )}

            <div className="mt-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-relaxed text-yellow-700 dark:text-yellow-400">
              {t('review.steward.boundaryNotice')}
            </div>

            <div className="mt-3 flex justify-end">
              <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => setShowStewardConfig(false)}>
                {t('review.steward.close')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Knowledge;
