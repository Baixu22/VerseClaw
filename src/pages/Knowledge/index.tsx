import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, BrainCircuit, Check, Database, Edit3, FilePlus2, FileSearch, FileText, FolderPlus, History, Inbox, Layers, Lightbulb, ListTodo, Loader2, Puzzle, RefreshCw, Ruler, Search, ShieldCheck, Sparkles, Upload, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  hostApi,
  type KnowledgeChangeProposal,
  type KnowledgeDraft,
  type KnowledgeDraftType,
  type KnowledgeInboxItem,
  type KnowledgeOkfConcept,
  type KnowledgeOkfValidationResult,
  type KnowledgeProvenanceRecord,
  type KnowledgeRuntimeLessonsReportResult,
  type KnowledgeSearchResult,
  type KnowledgeStatusResult,
  type KnowledgeStewardReviewResult,
} from '@/lib/host-api';
import { cn } from '@/lib/utils';

type SearchRow = Record<string, unknown>;

type WorkbenchTab = 'library' | 'inbox' | 'drafts' | 'runtime' | 'review' | 'governance';
	type WorkbenchTab = 'library' | 'inbox' | 'drafts' | 'review' | 'governance';
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
};
type InboxScoreDimension = 'reusability' | 'uniqueness' | 'confidence';
type InboxSourceDisplay = KnowledgeInboxItem['sourceRefs'][number];

const PANEL_CLASS = 'rounded-xl border border-black/10 bg-surface-modal shadow-sm dark:border-white/10';
const QUIET_BUTTON_CLASS = 'h-9 rounded-lg border border-black/10 bg-transparent px-3 text-meta font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const ROW_CLASS = 'flex items-center justify-between gap-4 rounded-lg bg-surface-input px-3 py-2';
const KNOWLEDGE_TYPES: KnowledgeDraftType[] = ['decision', 'architecture', 'command', 'troubleshooting', 'glossary', 'source-note', 'synthesis', 'procedure'];
const WORKBENCH_TABS: WorkbenchTab[] = ['library', 'inbox', 'drafts', 'runtime', 'review', 'governance'];

const TAB_ICONS: Record<WorkbenchTab, React.ComponentType<{ className?: string }>> = {
  library: Layers,
  inbox: Inbox,
  drafts: Edit3,
  runtime: BrainCircuit,
  review: ShieldCheck,
  governance: Database,
};

const WORKBENCH_TITLE_KEYS: Record<WorkbenchTab, string> = {
  library: 'library.title',
  inbox: 'inbox.title',
  drafts: 'draft.title',
  runtime: 'runtime.title',
  review: 'review.title',
  governance: 'governance.title',
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

type InboxRecommendation = 'save' | 'review' | 'archive-only';

const INBOX_RECOMMENDATION_ORDER: InboxRecommendation[] = ['save', 'review', 'archive-only'];
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

function inboxReason(item: KnowledgeInboxItem): string {
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
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('library');
  const [drafts, setDrafts] = useState<KnowledgeDraft[]>([]);
  const [inboxItems, setInboxItems] = useState<KnowledgeInboxItem[]>([]);
  const [proposals, setProposals] = useState<KnowledgeChangeProposal[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [stewardReview, setStewardReview] = useState<KnowledgeStewardReviewResult | null>(null); void stewardReview;
  const [selectedProvenance, setSelectedProvenance] = useState<KnowledgeProvenanceRecord | null>(null);
  const [okfPath, setOkfPath] = useState('');
  const [okfValidation, setOkfValidation] = useState<KnowledgeOkfValidationResult | null>(null);
  const [selectedOkfConceptIds, setSelectedOkfConceptIds] = useState<Set<string>>(() => new Set());
  const [runtimeLessons, setRuntimeLessons] = useState<KnowledgeRuntimeLessonsReportResult | null>(null);
  const [runtimeLessonsLoading, setRuntimeLessonsLoading] = useState(false);
  const [governanceRunning, setGovernanceRunning] = useState(false);
  const [governanceIssues, setGovernanceIssues] = useState<any[]>([]);
  const [governanceContradictions, setGovernanceContradictions] = useState(0);
  const [governanceStale, setGovernanceStale] = useState(0);
  const [governanceDangling, setGovernanceDangling] = useState(0);
  const [governanceLastChecked, setGovernanceLastChecked] = useState<string | null>(null);
  const [, setDismissedIssueIds] = useState<Set<string>>(() => new Set());

  const rows = useMemo(() => getSearchRows(searchResult), [searchResult]);
  const pageCounts = status?.pageCounts ?? {};
  const sourceCounts = status?.sourceCounts ?? {};
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

  const runtimeCounts = runtimeLessons?.counts ?? { trajectories: 0, undistilledTrajectories: 0, activePrinciples: 0 };
  const runtimeMetrics = useMemo(() => [
    { label: t('runtime.metrics.trajectories'), value: runtimeCounts.trajectories, icon: History, tone: 'text-sky-700 dark:text-sky-400' },
    { label: t('runtime.metrics.undistilled'), value: runtimeCounts.undistilledTrajectories, icon: AlertTriangle, tone: 'text-yellow-700 dark:text-yellow-400' },
    { label: t('runtime.metrics.principles'), value: runtimeCounts.activePrinciples, icon: Lightbulb, tone: 'text-emerald-700 dark:text-emerald-400' },
  ], [runtimeCounts.activePrinciples, runtimeCounts.trajectories, runtimeCounts.undistilledTrajectories, t]);

  const groupedInboxItems = useMemo(() => {
    const groups: Record<InboxRecommendation, KnowledgeInboxItem[]> = {
      save: [],
      review: [],
      'archive-only': [],
    };
    for (const item of inboxItems) {
      groups[inboxRecommendation(item)].push(item);
    }
    return groups;
  }, [inboxItems]);
  const orderedInboxItems = useMemo(() => INBOX_RECOMMENDATION_ORDER.flatMap((key) => groupedInboxItems[key]), [groupedInboxItems]);
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
    const [inboxResult, draftResult, proposalResult] = await Promise.all([
      hostApi.knowledge.listInboxItems({ status: 'pending', limit: 100 }),
      hostApi.knowledge.listDrafts({ status: 'all', limit: 100 }),
      hostApi.knowledge.listProposals({ status: 'all', limit: 100 }),
    ]);
    if (inboxResult.success) setInboxItems(inboxResult.items);
    if (draftResult.success) setDrafts(draftResult.drafts);
    if (proposalResult.success) setProposals(proposalResult.proposals);
  }, []);

  useEffect(() => {
    void refreshGovernance();
  }, [refreshGovernance]);

  const refreshRuntimeLessons = useCallback(async () => {
    setRuntimeLessonsLoading(true);
    try {
      setRuntimeLessons(await hostApi.knowledge.runtimeLessonsReport());
    } catch (err) {
      setRuntimeLessons({
        success: false,
        available: false,
        reason: 'reportFailed',
        error: err instanceof Error ? err.message : String(err),
        counts: { trajectories: 0, undistilledTrajectories: 0, activePrinciples: 0 },
        undistilled: [],
        activePrinciples: [],
        indexPreview: '',
      });
    } finally {
      setRuntimeLessonsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workbenchTab === 'runtime' && !runtimeLessons && !runtimeLessonsLoading) {
      void refreshRuntimeLessons();
    }
  }, [refreshRuntimeLessons, runtimeLessons, runtimeLessonsLoading, workbenchTab]);

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
        setGovernanceLastChecked((result as any).runAt ?? null);
      }
    } catch (err) {
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

  const searchWiki = useCallback(async () => {
    if (!query.trim()) return;
    setRunning('search');
    setError(null);
    try {
      const result = await hostApi.knowledge.search({ query: query.trim(), maxResults: 12, corpus: 'wiki' });
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
      setWorkbenchTab('governance');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [draftBody, draftSources, draftTags, draftTitle, refreshGovernance, selectedDraft, t]);

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

      <main className="min-h-0 flex-1 overflow-auto px-10 pb-10">
        {error && (
          <div data-testid="knowledge-error" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div data-testid="knowledge-command-bar" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-surface-modal p-2 shadow-sm dark:border-white/10">
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
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void runAction('compile', () => hostApi.knowledge.compile())} disabled={busy}>
            {running === 'compile' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
            {t('actions.compile')}
          </Button>
          <Button variant="outline" className={QUIET_BUTTON_CLASS} onClick={() => void runAction('lint', () => hostApi.knowledge.lint())} disabled={busy}>
            {running === 'lint' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
            {t('actions.lint')}
          </Button>
          <Button variant="outline" className={cn('ml-auto', QUIET_BUTTON_CLASS)} onClick={() => void runAction('openVault', () => hostApi.knowledge.openVault())} disabled={busy}>
            {t('actions.openVault')}
          </Button>
        </div>

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

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-testid="knowledge-workbench-tabs">
          {WORKBENCH_TABS.map((tab) => {
            const TabIcon = TAB_ICONS[tab];
            const isActive = workbenchTab === tab;
            return (
            <button
              key={tab}
              type="button"
              className={cn(
                'flex items-center gap-2.5 rounded-lg border border-black/10 bg-surface-modal px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 dark:border-white/10 cursor-pointer',
                isActive
                  ? 'border-primary/30 bg-primary/5 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-black/5 hover:text-foreground hover:border-black/20 dark:hover:bg-white/5 dark:hover:border-white/20',
              )}
              onClick={() => setWorkbenchTab(tab)}
              data-testid={`knowledge-tab-${tab}`}
            >
              {TabIcon && <TabIcon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/60')} />}
              {t(`tabs.${tab}`)}
            </button>
            );
          })}
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
                    <button
                      key={`${lookup || index}`}
                      type="button"
                      className={cn(
                        'w-full rounded-lg border border-black/10 p-3 text-left transition-all duration-200 hover:shadow-sm dark:border-white/10',
                        lookup && lookup === selectedLookup
                          ? 'border-primary/30 bg-primary/5 shadow-sm'
                          : 'hover:bg-black/5 hover:border-black/20 dark:hover:bg-white/5 dark:hover:border-white/20',
                      )}
                      data-testid="knowledge-search-result"
                      onClick={() => void openResult(row)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{getTitle(row)}</span>
                        {running === `get:${lookup}` && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {lookup && lookup === selectedLookup && !running && <Check className="h-3.5 w-3.5 text-primary" />}
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
                    </button>
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

        <Card className={cn('mt-4', PANEL_CLASS)}>
          <CardHeader className="p-4">
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>{t(WORKBENCH_TITLE_KEYS[workbenchTab])}</span>
              <Badge variant="outline" className="border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">
                {t('governance.readOnlyBadge')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {workbenchTab === 'library' && (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4" data-testid="knowledge-library">
                {KNOWLEDGE_TYPES.map((type) => {
                  const TypeIcon = TYPE_ICONS[type];
                  const accent = TYPE_COLOR[type];
                  return (
                  <button
                    key={type}
                    type="button"
                    className={cn(
                      'group flex flex-col gap-3 rounded-lg border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer',
                      accent,
                    )}
                    onClick={() => {
                      setQuery(type);
                      setWorkbenchTab('library');
                    }}
                    data-testid={`knowledge-type-${type}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', accent)}>
                        <TypeIcon className="h-4 w-4" />
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{t(`types.${type}`)}</div>
                      <div className="mt-0.5 text-xs leading-4 text-muted-foreground">{t('library.typeHint')}</div>
                    </div>
                  </button>
                  );
                })}
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
                    {INBOX_RECOMMENDATION_ORDER.map((recommendation) => {
                      const group = groupedInboxItems[recommendation];
                      if (group.length === 0) return null;
                      return (
                        <div key={recommendation} className="space-y-1.5" data-testid={`knowledge-inbox-group-${recommendation}`}>
                          <div className="flex items-center justify-between px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <span>{t(`inbox.groups.${recommendation}`)}</span>
                            <span className="tabular-nums">{group.length}</span>
                          </div>
                          {group.map((item) => {
                            const isSelected = selectedInboxItem?.id === item.id;
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
                          <div className="text-xs font-medium text-muted-foreground">{t('inbox.reason')}</div>
                          {inboxOverallScore(selectedInboxItem) != null && (
                            <Badge variant="outline" className={cn('border text-[10px]', inboxRecommendationClass(inboxRecommendation(selectedInboxItem)))}>
                              {t('inbox.score', { score: Math.round((inboxOverallScore(selectedInboxItem) ?? 0) * 100) })}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {inboxReason(selectedInboxItem) || t('inbox.noReason')}
                        </p>
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

            {workbenchTab === 'runtime' && (
              <div className="space-y-4">
                {runtimeLessonsLoading && !runtimeLessons && (
                  <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-surface-input p-4 text-sm text-muted-foreground dark:border-white/10">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('runtime.loading')}
                  </div>
                )}

                {runtimeLessons && (
                  <div className="space-y-4" data-testid="knowledge-runtime-lessons">
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{t('runtime.title')}</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('runtime.subtitle')}</p>
                      </div>
                      <Badge variant="outline" className="border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">
                        {t('governance.readOnlyBadge')}
                      </Badge>
                    </div>

                    {(!runtimeLessons.success || !runtimeLessons.available) && (
                      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-relaxed text-yellow-700 dark:text-yellow-400">
                        {runtimeLessons.error || t('runtime.unavailable')}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      {runtimeMetrics.map((metric) => {
                        const Icon = metric.icon;
                        return (
                          <div key={metric.label} className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xl font-semibold tabular-nums tracking-tight">{metric.value}</div>
                                <div className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">{metric.label}</div>
                              </div>
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-background/50 dark:border-white/10">
                                <Icon className={cn('h-4 w-4', metric.tone)} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
                      <div className="space-y-3">
                        <div className="text-sm font-semibold">{t('runtime.undistilledTitle')}</div>
                        {runtimeLessons.undistilled.length === 0 && (
                          <p className="rounded-lg border border-black/10 bg-surface-input p-4 text-sm text-muted-foreground dark:border-white/10">{t('runtime.emptyUndistilled')}</p>
                        )}
                        {runtimeLessons.undistilled.map((trajectory) => (
                          <div key={trajectory.trajectory_id} className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground">{trajectory.task_intent}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <span>{t('runtime.taskType')}: {trajectory.task_type}</span>
                                  <span className="text-muted-foreground/50">/</span>
                                  <span>{trajectory.outcome}</span>
                                  <span className="font-mono text-muted-foreground/70">{trajectory.created_at}</span>
                                </div>
                              </div>
                              <Badge variant="outline" className="border-black/10 bg-background/60 text-[10px] dark:border-white/10">
                                {trajectory.trajectory_id}
                              </Badge>
                            </div>
                            {trajectory.context_fingerprint.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {trajectory.context_fingerprint.map((tag) => (
                                  <Badge key={tag} variant="outline" className="border-black/10 bg-black/5 text-[10px] dark:border-white/10 dark:bg-white/10">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {trajectory.error_signature && (
                              <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-xs text-red-700 dark:text-red-400">
                                <span className="font-medium">{t('runtime.errorSignature')}:</span>{' '}
                                <span className="font-mono">{trajectory.error_signature}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-3">
                          <div className="text-sm font-semibold">{t('runtime.principlesTitle')}</div>
                          {runtimeLessons.activePrinciples.length === 0 && (
                            <p className="rounded-lg border border-black/10 bg-surface-input p-4 text-sm text-muted-foreground dark:border-white/10">{t('runtime.emptyPrinciples')}</p>
                          )}
                          {runtimeLessons.activePrinciples.map((principle) => (
                            <div key={principle.principle_id} className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-foreground">{principle.title}</div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Badge variant="outline" className="border-black/10 bg-background/60 text-[10px] dark:border-white/10">{principle.criticality}</Badge>
                                    {principle.task_types.map((taskType) => (
                                      <Badge key={taskType} variant="outline" className="border-black/10 bg-black/5 text-[10px] dark:border-white/10 dark:bg-white/10">{taskType}</Badge>
                                    ))}
                                    {principle.context_tags.map((tag) => (
                                      <Badge key={tag} variant="outline" className="border-black/10 bg-black/5 text-[10px] dark:border-white/10 dark:bg-white/10">{tag}</Badge>
                                    ))}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">
                                  {principle.retrieval_count}/{principle.adoption_count}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <div className="text-sm font-semibold">{t('runtime.indexTitle')}</div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-black/10 bg-surface-input p-3 text-xs leading-relaxed dark:border-white/10">
                            {runtimeLessons.indexPreview || '-'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
                  </div>
                </div>
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
    </div>
  );
}

export default Knowledge;
