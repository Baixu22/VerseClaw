import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, Check, Database, Edit3, FilePlus2, FileSearch, FileText, FolderPlus, History, Inbox, Layers, Lightbulb, ListTodo, Loader2, Puzzle, RefreshCw, Ruler, Search, ShieldCheck, Sparkles, Upload, Wrench, X } from 'lucide-react';
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
  type KnowledgeSearchResult,
  type KnowledgeStatusResult,
  type KnowledgeStewardReviewResult,
} from '@/lib/host-api';
import { cn } from '@/lib/utils';

type SearchRow = Record<string, unknown>;
type WorkbenchTab = 'library' | 'inbox' | 'drafts' | 'review' | 'governance';

const PANEL_CLASS = 'rounded-xl border border-black/10 bg-surface-modal shadow-sm dark:border-white/10';
const QUIET_BUTTON_CLASS = 'h-9 rounded-lg border border-black/10 bg-transparent px-3 text-meta font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const ROW_CLASS = 'flex items-center justify-between gap-4 rounded-lg bg-surface-input px-3 py-2';
const KNOWLEDGE_TYPES: KnowledgeDraftType[] = ['decision', 'architecture', 'command', 'troubleshooting', 'glossary', 'source-note', 'synthesis', 'procedure'];
const WORKBENCH_TABS: WorkbenchTab[] = ['library', 'inbox', 'drafts', 'review', 'governance'];

const TAB_ICONS: Record<WorkbenchTab, React.ComponentType<{ className?: string }>> = {
  library: Layers,
  inbox: Inbox,
  drafts: Edit3,
  review: ShieldCheck,
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
  const [stewardReview, setStewardReview] = useState<KnowledgeStewardReviewResult | null>(null);
  const [selectedProvenance, setSelectedProvenance] = useState<KnowledgeProvenanceRecord | null>(null);
  const [okfPath, setOkfPath] = useState('');
  const [okfValidation, setOkfValidation] = useState<KnowledgeOkfValidationResult | null>(null);
  const [selectedOkfConceptIds, setSelectedOkfConceptIds] = useState<Set<string>>(() => new Set());

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
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null, [drafts, selectedDraftId]);
  const selectedInboxItem = useMemo(() => inboxItems.find((item) => item.id === selectedInboxId) ?? inboxItems[0] ?? null, [inboxItems, selectedInboxId]);
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

        <div className="mt-4 grid gap-2 md:grid-cols-5" data-testid="knowledge-workbench-tabs">
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
              <span>{t(workbenchTab === 'library' ? 'library.title' : workbenchTab === 'inbox' ? 'inbox.title' : workbenchTab === 'drafts' ? 'draft.title' : workbenchTab === 'review' ? 'review.title' : 'governance.title')}</span>
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
                    {inboxItems.map((item) => {
                      const isSelected = selectedInboxItem?.id === item.id;
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
                          <Badge variant="outline" className="border-black/10 bg-transparent text-[10px] font-medium dark:border-white/10">{t(`inbox.kinds.${item.kind}`)}</Badge>
                          <span className="font-medium">{t(`types.${item.type}`)}</span>
                          {item.warnings && item.warnings.length > 0 && (
                            <span className="text-yellow-600 dark:text-yellow-400 font-medium">{t('inbox.warningCount', { count: item.warnings.length })}</span>
                          )}
                        </div>
                      </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{selectedInboxItem?.title ?? t('inbox.noSelection')}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedInboxItem ? `${t(`inbox.kinds.${selectedInboxItem.kind}`)} · ${t(`types.${selectedInboxItem.type}`)}` : t('inbox.noSelectionHint')}
                        </p>
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
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                        <div className="text-xs font-medium text-muted-foreground">{t('inbox.sources')}</div>
                        <div className="mt-2 space-y-1">
                          {selectedInboxItem.sourceRefs.length === 0 && selectedInboxItem.sourceIds.length === 0 && <p className="text-xs text-muted-foreground">{t('inbox.noSources')}</p>}
                          {selectedInboxItem.sourceRefs.map((ref) => (
                            <p key={ref.id} className="truncate font-mono text-[11px] text-muted-foreground">{ref.label ?? ref.path ?? ref.id}</p>
                          ))}
                          {selectedInboxItem.sourceRefs.length === 0 && selectedInboxItem.sourceIds.map((id) => (
                            <p key={id} className="truncate font-mono text-[11px] text-muted-foreground">{id}</p>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10">
                        <div className="text-xs font-medium text-muted-foreground">{t('inbox.warnings')}</div>
                        <div className="mt-2 space-y-1">
                          {(selectedInboxItem.warnings ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t('inbox.noWarnings')}</p>}
                          {(selectedInboxItem.warnings ?? []).map((warning) => (
                            <p key={warning} className="text-xs text-yellow-700 dark:text-yellow-400">{warning}</p>
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
                  </div>
                </div>
              </div>
            )}

            {workbenchTab === 'governance' && (
              <div className="grid gap-4 md:grid-cols-3" data-testid="knowledge-governance">
                <div className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10 hover:shadow-sm transition-shadow">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-green-500/20 bg-green-500/10">
                    <ShieldCheck className="h-5 w-5 text-green-700 dark:text-green-400" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{t('governance.steward')}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t('governance.stewardDescription')}</p>
                </div>
                <div className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10 hover:shadow-sm transition-shadow">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10">
                    <ShieldCheck className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{t('governance.permissions')}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t('governance.permissionsDescription')}</p>
                </div>
                <div className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10 hover:shadow-sm transition-shadow">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
                    <History className="h-5 w-5 text-violet-700 dark:text-violet-400" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{t('governance.lastReview')}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{stewardReview?.notes ?? t('governance.noReview')}</p>
                  {stewardReview?.warnings?.map((warning) => (
                    <p key={warning} className="mt-2 rounded-md bg-yellow-500/10 px-2 py-1 text-xs text-yellow-700 dark:text-yellow-400">{warning}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default Knowledge;
