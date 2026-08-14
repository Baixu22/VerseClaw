import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, ArrowRight, BookOpen, Bot, Check, Columns3, Copy, Database, Edit3, Ellipsis, Eye, FilePlus2, FileSearch, FileText, FolderPlus, History, Inbox, Layers, Lightbulb, Link2, ListTodo, Loader2, Plus, Puzzle, RefreshCw, RotateCcw, Ruler, Save, Search, SendHorizontal, ShieldCheck, Sparkles, Tags, Upload, Wrench, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
  type KnowledgeSekbCaptureTrajectoryResult,
  type KnowledgeSekbBatchDistillSuggestResult,
  type KnowledgeSekbShadowEvaluationExportResult,
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
type KnowledgeUtilityPanel = 'status' | 'okf' | 'sources' | null;
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

/**
 * Knowledge surface ladder — three tiers, no ad-hoc alpha.
 *
 * Before this pass the page mixed 10 different translucent surface values
 * (`bg-background/40|50|60|70|80`, `bg-surface-input/50|70|80|90`,
 * `bg-surface-modal/70`). Because each composited against whatever sat behind
 * it, one workspace rendered 6 distinct greys and the left rail never matched
 * the global sidebar. The tiers below are the only surfaces this page uses:
 *
 *   canvas  bg-background       page + editor + preview (matches <main>)
 *   rail    bg-surface-sidebar  document rail (matches the global left sidebar)
 *   panel   bg-surface-modal    raised cards and popovers
 *   control bg-surface-input    inputs, code panes, recessed rows
 */
const PANEL_CLASS = 'rounded-xl border border-black/10 bg-surface-modal shadow-sm dark:border-white/10';
const QUIET_BUTTON_CLASS = 'h-9 rounded-lg border border-black/10 bg-transparent px-3 text-meta font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const MENU_ITEM_CLASS = 'flex h-9 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-sm outline-none transition-colors data-[disabled]:opacity-40 data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10 motion-reduce:transition-none';
const ROW_CLASS = 'flex items-center justify-between gap-4 rounded-lg bg-surface-input px-3 py-2';
const WORKSPACE_SECTION_CLASS = 'min-h-0 bg-surface-sidebar';
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
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground" onClick={() => onSaveDraft(groundedAnswer)} data-testid="knowledge-librarian-save-draft">
                  <FilePlus2 className="mr-1.5 h-3 w-3" />
                  {actionLabels.saveDraft}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground" onClick={() => onCreateErrorExperience(groundedAnswer)} data-testid="knowledge-librarian-create-error-experience">
                  <Wrench className="mr-1.5 h-3 w-3" />
                  {actionLabels.createErrorExperience}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground" onClick={() => onSendToSteward(groundedAnswer)} data-testid="knowledge-librarian-send-steward">
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

function inboxSensitivity(item: KnowledgeInboxItem): 'normal' | 'secret_adjacent' | 'secret' {
  const sensitivity = inboxMetadata(item).sensitivity;
  return sensitivity === 'secret' || sensitivity === 'secret_adjacent' ? sensitivity : 'normal';
}

function inboxTokenCost(item: KnowledgeInboxItem): number | null {
  const cost = inboxMetadata(item).tokenCost;
  if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) return cost;
  const body = item.body.trim();
  if (!body) return null;
  // Bounded display estimate (~4 chars/token), not an LLM token count.
  return Math.max(1, Math.ceil(body.length / 4));
}

function inboxSensitivityClass(sensitivity: 'normal' | 'secret_adjacent' | 'secret'): string {
  if (sensitivity === 'secret') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';
  if (sensitivity === 'secret_adjacent') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-400';
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
  const [keReviewQueueEnabled, setKeReviewQueueEnabled] = useState<boolean | null>(null);
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
  const [utilityPanel, setUtilityPanel] = useState<KnowledgeUtilityPanel>(null);
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
  const [runtimeCaptureIntent, setRuntimeCaptureIntent] = useState('');
  const [runtimeCaptureType, setRuntimeCaptureType] = useState('');
  const [runtimeCaptureOutcome, setRuntimeCaptureOutcome] = useState<'success' | 'failure' | 'partial'>('success');
  const [runtimeCaptureError, setRuntimeCaptureError] = useState('');
  const [runtimeCaptureResult, setRuntimeCaptureResult] = useState<KnowledgeSekbCaptureTrajectoryResult | null>(null);
  const [runtimeDistillResult, setRuntimeDistillResult] = useState<KnowledgeSekbBatchDistillSuggestResult | null>(null);
  const [runtimeShadowKey, setRuntimeShadowKey] = useState('');
  const [runtimeShadowResult, setRuntimeShadowResult] = useState<KnowledgeSekbShadowEvaluationExportResult | null>(null);
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
    try {
      const snapshot = await hostApi.dcsProdFlags.getFlags();
      const flag = snapshot.flags.find((entry) => entry.id === 'runtime-memory-candidate-generation');
      setKeReviewQueueEnabled(flag ? flag.enabled === true : false);
    } catch {
      setKeReviewQueueEnabled(null);
    }
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

  const captureRuntimeTrajectory = useCallback(async () => {
    if (!runtimeCaptureIntent.trim() || !runtimeCaptureType.trim()) return;
    setRunning('runtimeCapture');
    setError(null);
    try {
      const result = await hostApi.knowledge.sekbCaptureTrajectory({
        taskIntent: runtimeCaptureIntent.trim(),
        taskType: runtimeCaptureType.trim(),
        outcome: runtimeCaptureOutcome,
        ...(runtimeCaptureOutcome === 'failure' && runtimeCaptureError.trim()
          ? { rawError: runtimeCaptureError.trim() }
          : {}),
      });
      if (!result.success || !result.available) {
        throw new Error(result.error || t('runtime.errors.capture'));
      }
      setRuntimeCaptureResult(result);
      toast.success(t('runtime.toasts.captured'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [runtimeCaptureIntent, runtimeCaptureOutcome, runtimeCaptureType, runtimeCaptureError, t]);

  const runBatchDistill = useCallback(async () => {
    setRunning('runtimeDistill');
    setError(null);
    try {
      const result = await hostApi.knowledge.sekbBatchDistillSuggest({});
      if (!result.success || !result.available) {
        throw new Error(result.error || t('runtime.errors.distill'));
      }
      setRuntimeDistillResult(result);
      if (result.suggestions.length > 0) {
        toast.success(t('runtime.toasts.distilled', { count: result.suggestions.length }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [t]);

  const runShadowEvaluationExport = useCallback(async () => {
    if (!runtimeShadowKey.trim()) return;
    setRunning('runtimeShadow');
    setError(null);
    try {
      const result = await hostApi.knowledge.sekbShadowEvaluationExport({
        pseudonymizationKey: runtimeShadowKey.trim(),
      });
      if (!result.success || !result.available) {
        throw new Error(result.error || t('runtime.errors.shadow'));
      }
      setRuntimeShadowResult(result);
      toast.success(t('runtime.toasts.shadow'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [runtimeShadowKey, t]);

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
      setUtilityPanel('okf');
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
      setUtilityPanel(null);
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
      <TooltipProvider delayDuration={250}>
      <header className="shrink-0 border-b border-black/10 bg-surface-modal px-5 pt-4 dark:border-white/10 md:px-6">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <BookOpen className="h-5 w-5 shrink-0 text-foreground/65" />
            <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground">{t('title')}</h1>
            <button
              type="button"
              className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5', statusTone)}
              onClick={() => setUtilityPanel('status')}
              data-testid="knowledge-status-trigger"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-green-500' : 'bg-yellow-500')} />
              {ready ? t('status.ready') : t('status.missing')}
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {!ready ? (
              <Button type="button" size="sm" onClick={() => void runAction('init', () => hostApi.knowledge.init())} disabled={busy}>
                {running === 'init' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Check className="mr-2 h-3.5 w-3.5" />}
                {t('actions.init')}
              </Button>
            ) : null}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  onClick={() => setLibrarianOpen(true)}
                  aria-label={t('librarian.openAssistant')}
                  data-testid="knowledge-librarian-open"
                >
                  <Bot className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('librarian.openAssistant')}</TooltipContent>
            </Tooltip>

            <DropdownMenu.Root>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                      aria-label={t('actions.more')}
                      data-testid="knowledge-more-actions"
                    >
                      <Ellipsis className="h-4 w-4" />
                    </Button>
                  </DropdownMenu.Trigger>
                </TooltipTrigger>
                <TooltipContent>{t('actions.more')}</TooltipContent>
              </Tooltip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-[80] min-w-60 overflow-hidden rounded-lg border border-border bg-surface-modal p-1.5 text-foreground shadow-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
                >
                  <DropdownMenu.Label className="px-2.5 py-1.5 text-2xs font-semibold uppercase text-muted-foreground">
                    {t('actions.content')}
                  </DropdownMenu.Label>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void pickAndIngest('files')}>
                    <FilePlus2 className="h-4 w-4 text-muted-foreground" />
                    {t('actions.importFiles')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void pickAndIngest('folder')}>
                    <FolderPlus className="h-4 w-4 text-muted-foreground" />
                    {t('actions.importFolder')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void validateOkfBundle()} data-testid="knowledge-okf-validate">
                    {running === 'validateOkf' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileSearch className="h-4 w-4 text-muted-foreground" />}
                    {t('actions.validateOkf')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void runAction('openVault', () => hostApi.knowledge.openVault())}>
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    {t('actions.openVault')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Label className="px-2.5 py-1.5 text-2xs font-semibold uppercase text-muted-foreground">
                    {t('actions.maintenance')}
                  </DropdownMenu.Label>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void refreshStatus()}>
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    {t('common:actions.refresh')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void runAction('configure', () => hostApi.knowledge.configure())}>
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    {t('actions.configure')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} disabled={busy} onSelect={() => void runAction('init', () => hostApi.knowledge.init())}>
                    <Check className="h-4 w-4 text-muted-foreground" />
                    {t('actions.init')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={() => setWorkbenchTab('governance')} data-testid="knowledge-tab-governance">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    {t('governance.openAudit')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        <nav className="mt-3 flex h-10 items-end gap-1 overflow-x-auto" data-testid="knowledge-workbench-tabs" aria-label={t('tabs.navigation')}>
          {PRIMARY_WORKBENCH_TABS.map((tab) => {
            const TabIcon = TAB_ICONS[tab];
            const isActive = workbenchTab === tab;
            const count = tab === 'inbox' ? inboxItems.length : tab === 'drafts' ? drafts.length : 0;
            return (
              <button
                key={tab}
                type="button"
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-black/20 hover:text-foreground dark:hover:border-white/20',
                )}
                onClick={() => setWorkbenchTab(tab)}
                data-testid={`knowledge-tab-${tab}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <TabIcon className="h-4 w-4" />
                {t(tab === 'library' ? 'tabs.library' : `tabs.${tab}`)}
                {count > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4 md:px-6">
        {error && (
          <div data-testid="knowledge-error" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card className={cn(PANEL_CLASS, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
          {/* Restraint: the workbench tab strip already names the active view, so a
              card header repeating that name plus a read-only badge on every tab was
              duplicated chrome. Boundary wording now lives once per flow, at the
              point of action, rather than as a standing banner. */}
          <CardContent className={cn('min-h-0 flex-1', workbenchTab === 'library' ? 'p-0' : 'overflow-y-auto p-4')}>
            {workbenchTab === 'library' && (
              <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)]" data-testid="knowledge-library">
                <aside className={cn('flex min-h-0 flex-col border-r border-black/10 dark:border-white/10', WORKSPACE_SECTION_CLASS)} data-testid="knowledge-vault-sidebar">
                  <div className="space-y-1.5 border-b border-black/10 p-3 dark:border-white/10">
                    <div className="flex gap-1.5">
                      <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchWiki(); }} placeholder={t('search.placeholder')} data-testid="knowledge-search-input" className="h-8 border-black/10 bg-surface-input pl-8 text-xs shadow-none dark:border-white/10" />
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => void searchWiki()} disabled={busy || !query.trim()} data-testid="knowledge-search-submit" aria-label={t('search.button')}>
                            {running === 'search' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Search className="h-3.5 w-3.5" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('search.button')}</TooltipContent>
                      </Tooltip>
                    </div>
                    <Button type="button" variant="ghost" className="h-8 w-full justify-start px-2 text-xs font-normal text-muted-foreground shadow-none hover:text-foreground" onClick={createEditorNote} data-testid="knowledge-new-note">
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      {t('workspace.newNote')}
                    </Button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <Button type="button" variant="ghost" className="h-8 w-full justify-between px-2 text-xs font-normal text-muted-foreground shadow-none hover:text-foreground" data-testid="knowledge-type-menu">
                          <span className="flex items-center gap-2"><Tags className="h-3.5 w-3.5" />{t('workspace.browseTypes')}</span>
                          <Ellipsis className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content align="start" sideOffset={5} className="z-[80] min-w-60 rounded-lg border border-border bg-surface-modal p-1.5 shadow-xl">
                          {KNOWLEDGE_TYPES.map((type) => {
                            const TypeIcon = TYPE_ICONS[type];
                            return (
                              <DropdownMenu.Item key={type} className={MENU_ITEM_CLASS} onSelect={() => void searchWiki(t(`types.${type}`))}>
                                <TypeIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">{t(`types.${type}`)}</span>
                                <span className="tabular-nums text-muted-foreground">{knowledgeTypeCount(pageCounts, type)}</span>
                              </DropdownMenu.Item>
                            );
                          })}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    <div className="mb-1.5 px-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{t('workspace.documents')}</div>
                    <div className="space-y-0.5" data-testid="knowledge-document-list">
                      {rows.length === 0 && (
                        <div className="px-2 py-0.5 text-xs text-muted-foreground">
                          {t('workspace.emptyDocuments')}
                        </div>
                      )}
                      {rows.map((row, index) => {
                        const lookup = getLookup(row);
                        const selected = lookup && lookup === editorSource;
                        return (
                          <div
                            key={`${lookup || index}:workspace`}
                            className={cn(
                              'group flex items-center gap-1 rounded-[6px] pr-1 transition-colors',
                              selected
                                ? 'bg-black/[0.06] text-foreground dark:bg-white/10'
                                : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                            )}
                            data-testid="knowledge-document-row"
                          >
                            <button type="button" className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left" onClick={() => void openResult(row)} data-testid="knowledge-search-result">
                              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px] leading-5">{getTitle(row)}</span>
                                <span className="block truncate font-mono text-[10px] text-muted-foreground">{lookup || t('workspace.localDraft')}</span>
                              </span>
                            </button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-[4px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100" data-testid="knowledge-source-set-add-result" onClick={() => addSourceToCurrentSet(sourceRefFromSearchRow(row))} disabled={!lookup} aria-label={t('sourceSet.addResult')}>
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('sourceSet.addResult')}</TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </aside>
                <section className="flex min-h-0 flex-col bg-background" data-testid="knowledge-markdown-workspace">
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-background p-3 dark:border-white/10">
                    <div className="min-w-0 flex-1">
                      <Input value={editorTitle} onChange={(event) => setEditorTitle(event.target.value)} className="h-8 border-transparent bg-transparent px-0 font-serif text-xl tracking-tight shadow-none focus-visible:ring-0" data-testid="knowledge-editor-title" />
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="max-w-72 truncate font-mono">{editorSource || t('workspace.localDraft')}</span>
                        {selectedProvenance ? <span>{t('provenance.references', { count: selectedProvenance.references.length })}</span> : null}
                        <span>{editorBody.length} {t('workspace.characters')}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button type="button" variant="ghost" className="h-8 rounded-md px-2.5 text-xs" data-testid="knowledge-use-result-draft" onClick={useSelectedResultInDraft} disabled={!selectedRow || !selectedPageBody.trim()}>
                        <Edit3 className="mr-1.5 h-3.5 w-3.5" />{t('search.useInDraft')}
                      </Button>
                      <Button type="button" variant="ghost" className="h-8 rounded-md px-2.5 text-xs" onClick={() => setUtilityPanel('sources')} data-testid="knowledge-source-tools">
                        <Layers className="mr-1.5 h-3.5 w-3.5" />{t('workspace.sourceTools')}
                      </Button>
                      <div className="flex items-center gap-1 rounded-lg border border-black/10 bg-background p-1 dark:border-white/10">
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
                  </div>
                  <div className="grid shrink-0 gap-2 border-b border-black/10 bg-surface-input p-2.5 dark:border-white/10 md:grid-cols-[160px_minmax(0,1fr)_150px]">
                    <select value={editorType} onChange={(event) => setEditorType(event.target.value as KnowledgeDraftType)} className="h-9 rounded-lg border border-black/10 bg-surface-input px-3 text-sm shadow-none dark:border-white/10" data-testid="knowledge-editor-type" aria-label={t('draft.typeLabel')}>
                      {KNOWLEDGE_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
                    </select>
                    <Input value={editorTags} onChange={(event) => setEditorTags(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} className="h-9 bg-surface-input shadow-none" data-testid="knowledge-editor-tags" />
                    <Button type="button" className="shadow-none" onClick={() => void sendEditorToReview()} disabled={busy || !editorBody.trim()} data-testid="knowledge-editor-save-draft">
                      {running === 'editorDraft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {t('workspace.submitReview')}
                    </Button>
                  </div>
                  <div className={cn('grid min-h-0 flex-1 gap-0', editorMode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
                    {(editorMode === 'edit' || editorMode === 'split') && (
                      <Textarea value={editorBody} onChange={(event) => setEditorBody(event.target.value)} className="h-full min-h-0 resize-none rounded-none border-0 bg-background p-5 font-mono text-sm leading-7 shadow-none focus-visible:ring-0" data-testid="knowledge-markdown-editor" />
                    )}
                    {(editorMode === 'preview' || editorMode === 'split') && (
                      <div className="h-full min-h-0 overflow-auto border-black/10 bg-background p-5 text-sm leading-7 dark:border-white/10 lg:border-l [&_a]:text-primary [&_blockquote]:border-l-2 [&_blockquote]:border-black/20 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_h1]:mb-4 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-normal [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-normal [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-black/5 [&_pre]:p-3 [&_ul]:list-disc" data-testid="knowledge-markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{editorBody || t('workspace.emptyPreview')}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {workbenchTab === 'inbox' && (
              <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]" data-testid="knowledge-inbox">
                <div className="space-y-3">
                  {keReviewQueueEnabled === false && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400" data-testid="knowledge-inbox-ke-unavailable">
                      {t('inbox.keUnavailable')}
                    </div>
                  )}
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
                            {keReviewQueueEnabled === true && (
                              <Badge variant="outline" className={cn('border text-[10px]', inboxSensitivityClass(inboxSensitivity(selectedInboxItem)))} data-testid="knowledge-inbox-sensitivity">
                                {t('inbox.sensitivityLabel', { level: t(`inbox.sensitivity.${inboxSensitivity(selectedInboxItem)}`) })}
                              </Badge>
                            )}
                            {keReviewQueueEnabled === true && inboxTokenCost(selectedInboxItem) != null && (
                              <span className="text-muted-foreground" data-testid="knowledge-inbox-token-cost">{t('inbox.tokenCost', { tokens: inboxTokenCost(selectedInboxItem) })}</span>
                            )}
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
                              <div className="rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
                                <span className="font-medium text-foreground/80">{t('inbox.triage.duplicateOf')}: </span>
                                <span className="font-mono text-[11px] text-muted-foreground">{inboxTriage(selectedInboxItem).duplicateOf}</span>
                              </div>
                            )}
                            {(inboxTriage(selectedInboxItem).conflictWith ?? []).length > 0 && (
                              <div className="rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
                                <span className="font-medium text-foreground/80">{t('inbox.triage.conflictWith')}: </span>
                                <span className="font-mono text-[11px] text-muted-foreground">{(inboxTriage(selectedInboxItem).conflictWith ?? []).join(', ')}</span>
                              </div>
                            )}
                            {(inboxTriage(selectedInboxItem).suggestedEdits ?? []).length > 0 && (
                              <div className="rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
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
                              <div key={dimension} className="rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
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
                          <details className="mt-3 rounded-md border border-black/10 bg-background p-2 text-xs dark:border-white/10" data-testid="knowledge-inbox-audit">
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
                            <div key={ref.id} className="rounded-md border border-black/10 bg-background p-2 dark:border-white/10" data-testid="knowledge-inbox-source">
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
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 text-xs leading-relaxed text-muted-foreground">{selectedProposal?.diff ?? selectedDraft?.body ?? t('review.noProposal')}</pre>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                  {/* The apply boundary still has to be stated, but it belongs next to
                      the button that crosses it — not as a standing yellow banner. */}
                  <p className="text-[11px] leading-4 text-muted-foreground">{t('review.confirmationBoundary')}</p>

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
                      <Badge variant="outline" className="border-black/10 bg-black/5 text-[10px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/10">
                        {t('runtime.reviewOnlyBadge')}
                      </Badge>
                    </div>
                    {/* The badge, this line and a standing yellow banner all said
                        "review only". One statement is enough. */}
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('runtime.reviewBoundary')}</p>
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

                    <section className="space-y-3 border-t border-black/10 pt-5 dark:border-white/10" aria-labelledby="runtime-capture-title">
                      <div>
                        <h4 id="runtime-capture-title" className="text-sm font-semibold">{t('runtime.captureTitle')}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{t('runtime.captureDescription')}</p>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-capture-intent">{t('runtime.taskIntent')}</Label>
                          <Input id="runtime-capture-intent" value={runtimeCaptureIntent} onChange={(event) => setRuntimeCaptureIntent(event.target.value)} placeholder={t('runtime.taskIntentPlaceholder')} data-testid="knowledge-runtime-capture-intent" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-capture-type">{t('runtime.taskType')}</Label>
                          <Input id="runtime-capture-type" value={runtimeCaptureType} onChange={(event) => setRuntimeCaptureType(event.target.value)} placeholder={t('runtime.taskTypePlaceholder')} data-testid="knowledge-runtime-capture-type" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-capture-outcome">{t('runtime.outcome')}</Label>
                          <select
                            id="runtime-capture-outcome"
                            className="h-9 w-full rounded-lg border border-black/10 bg-surface-input px-3 text-sm dark:border-white/10"
                            value={runtimeCaptureOutcome}
                            onChange={(event) => setRuntimeCaptureOutcome(event.target.value as 'success' | 'failure' | 'partial')}
                            data-testid="knowledge-runtime-capture-outcome"
                          >
                            <option value="success">{t('runtime.outcomeSuccess')}</option>
                            <option value="partial">{t('runtime.outcomePartial')}</option>
                            <option value="failure">{t('runtime.outcomeFailure')}</option>
                          </select>
                        </div>
                      </div>
                      {runtimeCaptureOutcome === 'failure' ? (
                        <div className="space-y-1.5">
                          <Label htmlFor="runtime-capture-error">{t('runtime.rawError')}</Label>
                          <Input id="runtime-capture-error" value={runtimeCaptureError} onChange={(event) => setRuntimeCaptureError(event.target.value)} placeholder={t('runtime.rawErrorPlaceholder')} data-testid="knowledge-runtime-capture-error" />
                        </div>
                      ) : null}
                      <Button type="button" onClick={() => void captureRuntimeTrajectory()} disabled={busy || !runtimeCaptureIntent.trim() || !runtimeCaptureType.trim()} data-testid="knowledge-runtime-capture">
                        {running === 'runtimeCapture' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                        {t(running === 'runtimeCapture' ? 'runtime.capturing' : 'runtime.capture')}
                      </Button>
                      {runtimeCaptureResult ? (
                        <p className="text-xs text-muted-foreground" data-testid="knowledge-runtime-capture-result">
                          {runtimeCaptureResult.success ? t('runtime.captureSuccess') : t('runtime.captureFailed')}
                        </p>
                      ) : null}
                    </section>

                    <section className="space-y-3 border-t border-black/10 pt-5 dark:border-white/10" aria-labelledby="runtime-distill-title">
                      <div>
                        <h4 id="runtime-distill-title" className="text-sm font-semibold">{t('runtime.distillTitle')}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{t('runtime.distillDescription')}</p>
                      </div>
                      <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void runBatchDistill()} disabled={busy} data-testid="knowledge-runtime-distill">
                        {running === 'runtimeDistill' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                        {t(running === 'runtimeDistill' ? 'runtime.distilling' : 'runtime.distill')}
                      </Button>
                      {runtimeDistillResult ? (
                        <p className="text-xs text-muted-foreground" data-testid="knowledge-runtime-distill-result">
                          {t('runtime.distillResult', { count: runtimeDistillResult.suggestions.length })}
                        </p>
                      ) : null}
                    </section>

                    <section className="space-y-3 border-t border-black/10 pt-5 dark:border-white/10" aria-labelledby="runtime-shadow-title">
                      <div>
                        <h4 id="runtime-shadow-title" className="text-sm font-semibold">{t('runtime.shadowTitle')}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{t('runtime.shadowDescription')}</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="runtime-shadow-key">{t('runtime.shadowKey')}</Label>
                        <Input id="runtime-shadow-key" value={runtimeShadowKey} onChange={(event) => setRuntimeShadowKey(event.target.value)} placeholder={t('runtime.shadowKeyPlaceholder')} data-testid="knowledge-runtime-shadow-key" />
                      </div>
                      <Button type="button" variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void runShadowEvaluationExport()} disabled={busy || !runtimeShadowKey.trim()} data-testid="knowledge-runtime-shadow-report">
                        {running === 'runtimeShadow' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-1.5 h-3.5 w-3.5" />}
                        {t(running === 'runtimeShadow' ? 'runtime.shadowRunning' : 'runtime.shadowReport')}
                      </Button>
                      {runtimeShadowResult ? (
                        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-black/10 bg-surface-input p-3 text-xs leading-5 text-muted-foreground dark:border-white/10" data-testid="knowledge-runtime-shadow-result">
                          {JSON.stringify(runtimeShadowResult, null, 2)}
                        </pre>
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
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-background">
                            <MetricIcon className="h-4 w-4" />
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{count}</span>
                          <span className="rounded-md border border-current/20 bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase">
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

      <Sheet open={utilityPanel !== null} onOpenChange={(open) => { if (!open) setUtilityPanel(null); }}>
        <SheetContent side="right" className="bottom-0 top-10 flex h-auto w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg" data-testid="knowledge-utility-sheet">
          <SheetHeader className="shrink-0 border-b border-black/10 px-5 py-4 pr-14 text-left dark:border-white/10">
            <SheetTitle className="font-serif text-xl font-normal tracking-tight">
              {utilityPanel === 'status' ? t('utility.status.title') : utilityPanel === 'okf' ? t('utility.okf.title') : t('utility.sources.title')}
            </SheetTitle>
            <SheetDescription>
              {utilityPanel === 'status' ? t('utility.status.description') : utilityPanel === 'okf' ? t('utility.okf.description') : t('utility.sources.description')}
            </SheetDescription>
          </SheetHeader>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3 h-9 w-9 rounded-lg" aria-label={t('utility.close')}>
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {utilityPanel === 'status' ? (
              <div className="space-y-4" data-testid="knowledge-status-panel">
                <div className="grid gap-2 text-sm">
                  <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.vault')}</span><span className="min-w-0 truncate font-mono text-xs">{status?.vaultPath || '-'}</span></div>
                  <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.mode')}</span><span className="font-medium text-foreground">{status?.vaultMode || '-'}</span></div>
                  <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.render')}</span><span className="font-medium text-foreground">{status?.renderMode || '-'}</span></div>
                  <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.obsidian')}</span><span className={status?.obsidianCli?.available ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>{status?.obsidianCli?.available ? t('status.available') : t('status.unavailable')}</span></div>
                  <div className={ROW_CLASS}><span className="text-muted-foreground">{t('status.nativeSources')}</span><span className="font-medium tabular-nums text-foreground">{sourceCounts.native ?? 0}</span></div>
                </div>
                {warnings.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs">
                    {warnings.map((warning, index) => (
                      <p key={`${warning.code ?? 'warning'}:${index}`} className="text-yellow-700 dark:text-yellow-400">{warning.message}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {utilityPanel === 'okf' ? (
              okfValidation ? (
                <div className="space-y-4" data-testid="knowledge-okf-panel">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="outline" className={cn('border', okfValidation.success ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400' : 'border-destructive/30 bg-destructive/10 text-destructive')}>
                      {okfValidation.okfVersion ? `OKF ${okfValidation.okfVersion}` : t('okf.badge')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{t('okf.selectedConcepts', { count: selectedOkfCount })}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.concepts')}</span><span className="font-medium tabular-nums">{okfValidation.summary.conceptFiles}</span></div>
                    <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.validConcepts')}</span><span className="font-medium tabular-nums">{okfValidation.summary.validConcepts}</span></div>
                    <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.reservedFiles')}</span><span className="font-medium tabular-nums">{okfValidation.summary.reservedFiles}</span></div>
                    <div className={ROW_CLASS}><span className="text-muted-foreground">{t('okf.warnings')}</span><span className="font-medium tabular-nums">{okfValidation.summary.warnings}</span></div>
                  </div>
                  <div className="min-w-0 rounded-lg bg-surface-input px-3 py-2 text-xs">
                    <span className="text-muted-foreground">{t('okf.bundlePath')}</span>
                    <span className="ml-2 break-all font-mono text-foreground">{okfPath}</span>
                  </div>
                  {Object.keys(okfValidation.typeDistribution).length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2" data-testid="knowledge-okf-type-distribution">
                      <span className="text-xs text-muted-foreground">{t('okf.typeDistribution')}</span>
                      {Object.entries(okfValidation.typeDistribution).map(([type, count]) => (
                        <Badge key={type} variant="outline" className="border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">{type}: {count}</Badge>
                      ))}
                    </div>
                  ) : null}
                  {okfValidation.errors.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" data-testid="knowledge-okf-errors">
                      <div className="font-medium">{t('okf.errors')}</div>
                      {okfValidation.errors.slice(0, 6).map((issue, index) => <p key={`${issue.code}:${issue.conceptId ?? issue.filePath ?? index}`}>{issue.message}</p>)}
                    </div>
                  ) : null}
                  {okfValidation.warnings.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400" data-testid="knowledge-okf-warnings">
                      <div className="font-medium">{t('okf.warnings')}</div>
                      {okfValidation.warnings.slice(0, 6).map((issue, index) => <p key={`${issue.code}:${issue.conceptId ?? issue.filePath ?? index}`}>{issue.message}</p>)}
                    </div>
                  ) : null}
                  {okfConcepts.length > 0 ? (
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-surface-input px-3 py-2 text-xs font-medium dark:border-white/10">
                        <input type="checkbox" checked={okfAllSelected} onChange={toggleAllOkfConcepts} data-testid="knowledge-okf-select-all" />
                        {t('okf.selectAll')}
                      </label>
                      <div className="grid gap-2">
                        {okfConcepts.map((concept) => (
                          <label key={concept.conceptId} className="grid cursor-pointer gap-2 rounded-lg border border-black/10 bg-surface-input p-3 text-left dark:border-white/10" data-testid="knowledge-okf-concept">
                            <div className="flex min-w-0 items-center gap-2">
                              <input type="checkbox" checked={selectedOkfConceptIds.has(concept.conceptId)} onChange={() => toggleOkfConcept(concept.conceptId)} />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">{okfConceptTitle(concept)}</span>
                              <Badge variant="outline" className="shrink-0 border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">{concept.frontmatter.type}</Badge>
                            </div>
                            <div className="flex flex-wrap gap-1 pl-6">
                              <Badge variant="outline" className="max-w-full truncate border-black/10 bg-transparent font-mono text-[10px] dark:border-white/10">{concept.conceptId}</Badge>
                              {concept.frontmatter.resource ? <Badge variant="outline" className="max-w-full truncate border-black/10 bg-transparent text-[10px] dark:border-white/10">{concept.frontmatter.resource}</Badge> : null}
                            </div>
                            {concept.bodyPreview ? <p className="line-clamp-2 pl-6 text-xs leading-5 text-muted-foreground">{concept.bodyPreview}</p> : null}
                            {concept.warnings.length > 0 ? <p className="pl-6 text-xs text-yellow-700 dark:text-yellow-400">{concept.warnings[0].message}</p> : null}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <Button type="button" className="w-full" onClick={() => void importOkfBundle()} disabled={busy || !okfCanImport} data-testid="knowledge-okf-import">
                    {running === 'importOkf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Upload className="mr-2 h-4 w-4" />}
                    {t('actions.importOkf')}{selectedOkfCount > 0 ? ` (${selectedOkfCount})` : ''}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('utility.okf.empty')}</p>
              )
            ) : null}

            {utilityPanel === 'sources' ? (
              <div className="space-y-5">
                <section className="space-y-3" data-testid="knowledge-source-set-panel">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{t('sourceSet.title')}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t('sourceSet.count', { count: currentSourceRefs.length })}</p>
                    </div>
                    <Button type="button" variant="ghost" className="h-8 rounded-md px-2 text-xs" onClick={clearCurrentSourceSet} disabled={currentSourceRefs.length === 0} data-testid="knowledge-source-set-clear">{t('sourceSet.clear')}</Button>
                  </div>
                  <Input value={sourceSetTitle} onChange={(event) => setSourceSetTitle(event.target.value)} placeholder={t('sourceSet.titlePlaceholder')} className="h-9 bg-surface-input text-sm shadow-none" data-testid="knowledge-source-set-title" />
                  {currentSourceRefs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-black/10 p-3 text-xs leading-5 text-muted-foreground dark:border-white/10">{t('sourceSet.empty')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {currentSourceRefs.map((ref) => (
                        <div key={ref.id} className="rounded-md bg-black/5 px-2.5 py-2 text-xs dark:bg-white/10" data-testid="knowledge-source-set-ref">
                          <span className="block truncate font-medium">{ref.label || ref.id}</span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">{ref.path || ref.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button type="button" variant="outline" className={cn(QUIET_BUTTON_CLASS, 'w-full')} onClick={() => void saveCurrentSourceSet()} disabled={busy || currentSourceRefs.length === 0} data-testid="knowledge-source-set-save">
                    {running === 'sourceSetSave' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                    {t('sourceSet.save')}
                  </Button>
                  <p className="text-[11px] leading-4 text-muted-foreground">{t('sourceSet.answerBoundary')}</p>
                </section>

                {sourceSets.length > 0 ? (
                  <section className="space-y-2 border-t border-black/10 pt-4 dark:border-white/10">
                    <h3 className="text-sm font-semibold">{t('sourceSet.savedSets')}</h3>
                    <div className="grid gap-1.5">
                      {sourceSets.map((sourceSet) => (
                        <button key={sourceSet.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-md border border-black/10 px-3 py-2 text-left text-xs transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5" onClick={() => { setCurrentSourceSetId(sourceSet.id); setSourceSetTitle(sourceSet.title); setCurrentSourceRefs(sourceSet.sourceRefs); }} data-testid="knowledge-source-set-saved">
                          <span className="min-w-0 flex-1 truncate font-medium">{sourceSet.title}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{sourceSet.sourceRefs.length}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="space-y-3 border-t border-black/10 pt-4 dark:border-white/10" data-testid="knowledge-studio-actions">
                  <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">{t('studio.title')}</h3></div>
                  <div className="grid grid-cols-2 gap-2">
                    {STUDIO_ARTIFACTS.map((artifact) => {
                      const label = t(artifact.labelKey);
                      return (
                        <Button key={artifact.type} type="button" variant="outline" className="h-9 rounded-md px-2 text-xs shadow-none" onClick={() => void createStudioArtifact(artifact.type, label)} disabled={busy || currentSourceRefs.length === 0} data-testid={`knowledge-studio-artifact-${artifact.type}`}>
                          {running === `studio:${artifact.type}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
                          <span className="truncate">{label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </section>

                {relatedRows.length > 0 ? (
                  <section className="space-y-2 border-t border-black/10 pt-4 dark:border-white/10">
                    <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">{t('librarian.related')}</h3></div>
                    {relatedRows.map((row, index) => (
                      <button key={`${getLookup(row) || index}:related`} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5" onClick={() => { void openResult(row); setUtilityPanel(null); }} data-testid="knowledge-related-row">
                        <span className="block truncate font-medium">{getTitle(row)}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{getLookup(row)}</span>
                      </button>
                    ))}
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* The librarian rides the shared Sheet rather than a hand-rolled fixed
          overlay: it inherits the app's slide-in-from-right motion, the modal
          z-index and backdrop tokens, and — importantly — Radix's focus trap,
          Escape-to-close and scroll lock. The previous markup declared
          aria-modal without any of that behaviour. */}
      <Sheet open={librarianOpen} onOpenChange={setLibrarianOpen}>
        <SheetContent
          side="right"
          className="bottom-0 top-10 flex h-auto w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          data-testid="knowledge-librarian-modal"
        >
          <SheetHeader className="shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-black/10 px-4 py-3 pr-14 text-left dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2.5">
              <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
              <SheetTitle className="truncate text-sm font-medium">{t('librarian.modalTitle')}</SheetTitle>
              <SheetDescription className="sr-only">{t('librarian.modalSubtitle')}</SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground"
              onClick={clearLibrarianThread}
              disabled={librarianMessages.length === 0}
              data-testid="knowledge-librarian-clear"
            >
              {t('librarian.clearThread')}
            </Button>
          </SheetHeader>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-2.5 h-9 w-9 rounded-lg" aria-label={t('review.steward.close')}>
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>

          {/* Restraint: the thread is the panel. Capability cards, the current-note
              card, the quick-action grid and the write-boundary banner were resident
              chrome that squeezed the conversation; their functions all remain
              reachable from the workbench tabs and per-answer actions. */}
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3" data-testid="knowledge-librarian-thread">
            <div className="space-y-3">
              {librarianMessages.length === 0 ? (
                <p className="px-1 py-8 text-center text-xs leading-5 text-muted-foreground">
                  {t('librarian.threadEmpty')}
                </p>
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
                <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="knowledge-librarian-loading">
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
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

          <div className="shrink-0 border-t border-black/10 px-4 pb-3 pt-2.5 dark:border-white/10">
            <div className="mb-2 flex flex-wrap gap-1.5" data-testid="knowledge-librarian-suggestions">
              {librarianPromptSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-normal text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-white/10 dark:hover:bg-white/5"
                  onClick={() => void askLibrarian(suggestion.prompt)}
                  disabled={busy}
                  data-testid={`knowledge-librarian-suggestion-${suggestion.id}`}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            <KnowledgeAssistantPromptInput
              value={librarianQuestion}
              onChange={setLibrarianQuestion}
              onSubmit={() => void askLibrarian()}
              disabled={busy}
              running={running === 'librarianAsk'}
              placeholder={t('librarian.askPlaceholder')}
              askLabel={t('librarian.askButton')}
              hint={librarianCheckpointAt ? t('librarian.checkpointSaved', { time: new Date(librarianCheckpointAt).toLocaleTimeString() }) : t('librarian.askHint')}
            />
          </div>
        </SheetContent>
      </Sheet>

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
      </TooltipProvider>
    </div>
  );
}

export default Knowledge;
