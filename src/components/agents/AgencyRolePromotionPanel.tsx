import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CheckCircle2,
  Download,
  FolderOpen,
  Library,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type {
  AgencyMemoryProposalCandidate,
  AgencyRoleCandidatePayload,
  AgencyRoleDraftSummary,
  AgencyRoleEvidenceQualification,
  AgencyRolePackageSummary,
  AgencyRolePromotionRecord,
  AgencyRoleReviewPayload,
  AgencyRoleToolHintDisposition,
} from '@shared/host-api/contract';

type HintDraft = {
  disposition: '' | 'mapped' | 'waived';
  selectedTools: string;
  reviewerNote: string;
};

type CandidateDraft = Omit<
  AgencyRoleCandidatePayload,
  'tools' | 'tags' | 'outputSections' | 'handoffTo' | 'handoffFrom'
> & {
  tools: string;
  tags: string;
  outputSections: string;
  handoffTo: string;
  handoffFrom: string;
  commands: string;
};

type ConfirmAction = 'approve' | 'retire' | null;

export type AgencyRolePromotionPanelProps = {
  onRoleMaterialized: () => void;
  roleMemoryEnabled?: boolean;
  onMemoryProposed?: () => void;
};

function splitList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))];
}

function candidateDraft(candidate: AgencyRoleCandidatePayload): CandidateDraft {
  return {
    ...candidate,
    tools: candidate.tools?.join(', ') ?? '',
    tags: candidate.tags?.join(', ') ?? '',
    outputSections: candidate.outputSections.join(', '),
    handoffTo: candidate.handoffTo.join(', '),
    handoffFrom: candidate.handoffFrom.join(', '),
    commands: candidate.permissions?.commands?.join(', ') ?? '',
  };
}

function candidatePayload(candidate: CandidateDraft): AgencyRoleCandidatePayload {
  return {
    name: candidate.name.trim(),
    displayName: candidate.displayName.trim(),
    ...(candidate.description?.trim() ? { description: candidate.description.trim() } : {}),
    rolePrompt: candidate.rolePrompt.trim(),
    tools: splitList(candidate.tools),
    effort: candidate.effort,
    permissions: {
      ...candidate.permissions,
      commands: splitList(candidate.commands),
    },
    tags: splitList(candidate.tags),
    outputFormat: candidate.outputFormat,
    outputSections: splitList(candidate.outputSections),
    handoffTo: splitList(candidate.handoffTo),
    handoffFrom: splitList(candidate.handoffFrom),
    requiresReview: candidate.requiresReview,
    riskProfile: candidate.riskProfile,
  };
}

function hintDrafts(draft: AgencyRoleDraftSummary): Record<string, HintDraft> {
  return Object.fromEntries(draft.toolHints.map((hint) => [
    hint,
    { disposition: '', selectedTools: '', reviewerNote: '' },
  ]));
}

function recordHintDrafts(record: AgencyRolePromotionRecord): Record<string, HintDraft> {
  return Object.fromEntries(record.toolHintDispositions.map((entry) => [
    entry.hint,
    {
      disposition: entry.disposition,
      selectedTools: entry.selectedTools.join(', '),
      reviewerNote: entry.reviewerNote,
    },
  ]));
}

function dispositionPayload(
  hints: Record<string, HintDraft>,
): AgencyRoleToolHintDisposition[] {
  return Object.entries(hints).flatMap(([hint, value]) => {
    if (!value.disposition) return [];
    return [{
      hint,
      disposition: value.disposition,
      selectedTools: value.disposition === 'mapped' ? splitList(value.selectedTools) : [],
      reviewerNote: value.reviewerNote.trim(),
    }];
  });
}

function lifecycleTone(lifecycle: AgencyRolePromotionRecord['lifecycle']): string {
  if (lifecycle === 'active') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  }
  if (lifecycle === 'retired') {
    return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400';
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
}

export function AgencyRolePromotionPanel({
  onRoleMaterialized,
  roleMemoryEnabled = true,
  onMemoryProposed,
}: AgencyRolePromotionPanelProps) {
  const { t } = useTranslation('agents');
  const translateRef = useRef(t);
  translateRef.current = t;
  const [sourceRoot, setSourceRoot] = useState('');
  const [drafts, setDrafts] = useState<AgencyRoleDraftSummary[]>([]);
  const [packages, setPackages] = useState<AgencyRolePackageSummary[]>([]);
  const [reviews, setReviews] = useState<AgencyRolePromotionRecord[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidateDraft | null>(null);
  const [hints, setHints] = useState<Record<string, HintDraft>>({});
  const [qualification, setQualification] =
    useState<AgencyRoleEvidenceQualification>('unverified');
  const [evidenceRefs, setEvidenceRefs] = useState('');
  const [reviewer, setReviewer] = useState('operator');
  const [comment, setComment] = useState('');
  const [search, setSearch] = useState('');
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<AgencyMemoryProposalCandidate[]>([]);
  const [selectedMemorySections, setSelectedMemorySections] = useState<Set<string>>(new Set());
  const [memoryPreviews, setMemoryPreviews] = useState<Record<
    string,
    { action: string; conflicts: number }
  >>({});

  const selectedPackage =
    packages.find((entry) => entry.packageId === selectedPackageId) ?? null;
  const selectedDraft = selectedPackage?.draft ?? null;
  const selectedReview = useMemo(
    () => reviews.find((review) => review.packageId === selectedPackageId) ?? null,
    [reviews, selectedPackageId],
  );
  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return drafts;
    return drafts.filter((draft) => [
      draft.displayName,
      draft.sourceDivision,
      draft.roleName,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [drafts, search]);
  const newerPackageIds = useMemo(
    () => new Set(packages.flatMap((entry) => (
      entry.supersedesPackageId ? [entry.supersedesPackageId] : []
    ))),
    [packages],
  );

  const hintsComplete = selectedDraft?.toolHints.every((hint) => {
    const value = hints[hint];
    if (!value?.disposition) return false;
    if (value.disposition === 'mapped') return splitList(value.selectedTools).length > 0;
    return value.reviewerNote.trim().length > 0;
  }) ?? false;
  const evidenceComplete =
    qualification === 'unverified' || splitList(evidenceRefs).length > 0;
  const candidateComplete = Boolean(
    candidate?.name.trim() && candidate.displayName.trim() && candidate.rolePrompt.trim(),
  );
  const canReview = Boolean(
    selectedDraft
    && candidate
    && hintsComplete
    && evidenceComplete
    && reviewer.trim()
    && candidateComplete
    && !busy,
  );
  const selectedMemoryCandidates = memoryCandidates.filter(
    (entry) => selectedMemorySections.has(entry.sectionId),
  );
  const canExtractMemory = Boolean(
    roleMemoryEnabled
    && selectedPackage?.completeness === 'complete'
    && selectedReview?.lifecycle === 'active'
    && selectedReview.materialization.status === 'complete'
    && !busy,
  );
  const canSubmitMemory = selectedMemoryCandidates.length > 0
    && selectedMemoryCandidates.every((entry) => memoryPreviews[entry.sectionId])
    && !busy;

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.roles.listAgencyPackages();
      if (!result.success) {
        throw new Error(
          result.error ?? translateRef.current('roles.agencyPromotion.libraryError'),
        );
      }
      setPackages(result.packages);
      setReviews(result.reviews);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const loadCatalog = async (root: string) => {
    setLoading(true);
    try {
      const result = await hostApi.roles.agencyCatalog({ sourceRoot: root });
      if (!result.success) {
        throw new Error(result.error ?? t('roles.agencyPromotion.catalogError'));
      }
      setDrafts(result.drafts);
      setIssues([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const selectSource = async () => {
    const result = await hostApi.dialog.open({
      title: t('roles.agencyPromotion.selectSource'),
      properties: ['openDirectory'],
    });
    const root = result.filePaths[0];
    if (result.canceled || !root) return;
    setSourceRoot(root);
    await loadCatalog(root);
  };

  const importDraft = async (draft: AgencyRoleDraftSummary) => {
    if (!sourceRoot) return;
    setBusy(true);
    try {
      const result = await hostApi.roles.importAgencyPackage({
        sourceRoot,
        draftId: draft.id,
      });
      if (!result.success) {
        throw new Error(result.error ?? t('roles.agencyPromotion.importError'));
      }
      setPackages((current) => [
        result.package,
        ...current.filter((entry) => entry.packageId !== result.package.packageId),
      ]);
      selectPackage(result.package);
      toast.success(t('roles.agencyPromotion.imported'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshPackage = async (rolePackage: AgencyRolePackageSummary) => {
    const selection = await hostApi.dialog.open({
      title: t('roles.agencyPromotion.selectUpdateSource'),
      properties: ['openDirectory'],
    });
    const root = selection.filePaths[0];
    if (selection.canceled || !root) return;
    setBusy(true);
    try {
      const result = await hostApi.roles.refreshAgencyPackage({
        packageId: rolePackage.packageId,
        sourceRoot: root,
      });
      if (!result.success) {
        throw new Error(result.error ?? t('roles.agencyPromotion.updateError'));
      }
      setPackages((current) => [
        result.package,
        ...current.filter((entry) => entry.packageId !== result.package.packageId),
      ]);
      if (result.package.packageId !== rolePackage.packageId) {
        toast.success(t('roles.agencyPromotion.updateAvailable'));
      } else {
        toast.message(t('roles.agencyPromotion.upToDate'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const selectPackage = (rolePackage: AgencyRolePackageSummary) => {
    const draft = rolePackage.draft;
    const review = reviews.find((entry) => entry.packageId === rolePackage.packageId);
    setSelectedPackageId(rolePackage.packageId);
    setCandidate(candidateDraft(review?.candidate ?? draft.roleCandidate));
    setHints(review ? recordHintDrafts(review) : hintDrafts(draft));
    setQualification(review?.evidenceQualification ?? 'unverified');
    setEvidenceRefs(review?.evidenceRefs.join(', ') ?? '');
    setReviewer(review?.reviewer ?? 'operator');
    setComment(review?.comment ?? '');
    setIssues([]);
    setMemoryCandidates([]);
    setSelectedMemorySections(new Set());
    setMemoryPreviews({});
  };

  const updateCandidate = (patch: Partial<CandidateDraft>) => {
    setCandidate((current) => current ? { ...current, ...patch } : current);
    setIssues([]);
  };

  const updateHint = (hint: string, patch: Partial<HintDraft>) => {
    setHints((current) => ({
      ...current,
      [hint]: { ...current[hint]!, ...patch },
    }));
    setIssues([]);
  };

  const buildReviewPayload = (): AgencyRoleReviewPayload => {
    if (!selectedDraft || !candidate) {
      throw new Error(t('roles.agencyPromotion.selectDraftFirst'));
    }
    return {
      packageId: selectedPackage!.packageId,
      reviewer: reviewer.trim(),
      candidate: candidatePayload(candidate),
      toolHintDispositions: dispositionPayload(hints),
      evidenceQualification: qualification,
      evidenceRefs: splitList(evidenceRefs),
      comment: comment.trim(),
    };
  };

  const submitReview = async () => {
    setBusy(true);
    setIssues([]);
    try {
      const payload = buildReviewPayload();
      const preview = await hostApi.roles.previewAgencyPromotion(payload);
      setIssues(preview.validation.issues);
      if (!preview.validation.ok) return;
      const result = await hostApi.roles.reviewAgencyPromotion(payload);
      if (!result.success) throw new Error(result.error ?? t('roles.agencyPromotion.reviewError'));
      setReviews((current) => [
        result.record,
        ...current.filter((entry) => entry.id !== result.record.id),
      ]);
      toast.success(t('roles.agencyPromotion.reviewSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!selectedReview) return;
    setBusy(true);
    try {
      const result = await hostApi.roles.approveAgencyPromotion({
        reviewId: selectedReview.id,
        reviewer: reviewer.trim(),
        comment: comment.trim(),
      });
      setReviews((current) => [
        result.record,
        ...current.filter((entry) => entry.id !== result.record.id),
      ]);
      if (!result.success) throw new Error(result.error ?? t('roles.agencyPromotion.approvalError'));
      if (result.pendingRuntimeRefresh) {
        toast.message(t('roles.agencyPromotion.pendingRuntimeRefresh'));
      }
      onRoleMaterialized();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const retire = async () => {
    if (!selectedReview) return;
    setBusy(true);
    try {
      const result = await hostApi.roles.retireAgencyPromotion({
        reviewId: selectedReview.id,
        reviewer: reviewer.trim(),
        comment: comment.trim(),
      });
      setReviews((current) => [
        result.record,
        ...current.filter((entry) => entry.id !== result.record.id),
      ]);
      if (!result.success) throw new Error(result.error ?? t('roles.agencyPromotion.retirementError'));
      onRoleMaterialized();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const extractMemoryCandidates = async () => {
    if (!selectedPackage || !selectedReview || !canExtractMemory) return;
    setBusy(true);
    try {
      const result = await hostApi.roles.previewAgencyMemoryProposals({
        packageId: selectedPackage.packageId,
        reviewId: selectedReview.id,
      });
      if (!result.success) {
        throw new Error(result.error ?? t('roles.agencyPromotion.memory.extractError'));
      }
      setMemoryCandidates(result.candidates);
      setSelectedMemorySections(new Set(result.candidates.map((entry) => entry.sectionId)));
      setMemoryPreviews({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const previewMemoryCandidates = async () => {
    if (selectedMemoryCandidates.length === 0 || !roleMemoryEnabled) return;
    setBusy(true);
    try {
      const entries = await Promise.all(selectedMemoryCandidates.map(async (candidate) => {
        const result = await hostApi.memory.previewProposal(candidate.proposal);
        if (!result.success) {
          throw new Error(result.error ?? t('roles.agencyPromotion.memory.previewError'));
        }
        return [
          candidate.sectionId,
          {
            action: result.preview.decision.action,
            conflicts: result.preview.conflicts.length,
          },
        ] as const;
      }));
      setMemoryPreviews(Object.fromEntries(entries));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitMemoryCandidates = async () => {
    if (!canSubmitMemory || !roleMemoryEnabled) return;
    setBusy(true);
    try {
      for (const candidate of selectedMemoryCandidates) {
        const result = await hostApi.memory.propose(candidate.proposal);
        if (!result.success) {
          throw new Error(result.error ?? t('roles.agencyPromotion.memory.submitError'));
        }
      }
      toast.success(t('roles.agencyPromotion.memory.submitted', {
        count: selectedMemoryCandidates.length,
      }));
      onMemoryProposed?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-4 border-t border-border/60 pt-4"
      data-testid="agency-role-promotion-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">{t('roles.agencyPromotion.title')}</h3>
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t('roles.agencyPromotion.description')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {sourceRoot && (
            <Button
              variant="ghost"
              size="icon"
              title={t('roles.agencyPromotion.refresh')}
              onClick={() => void loadCatalog(sourceRoot)}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          )}
          <Button
            data-testid="agency-source-select"
            variant="outline"
            size="sm"
            onClick={() => void selectSource()}
          >
            <FolderOpen className="mr-1.5 h-4 w-4" />
            {t('roles.agencyPromotion.selectSource')}
          </Button>
        </div>
      </div>

      {sourceRoot && (
        <p
          data-testid="agency-source-path"
          className="truncate rounded-md bg-surface-input px-2.5 py-1.5 font-mono text-2xs text-muted-foreground"
          title={sourceRoot}
        >
          {sourceRoot}
        </p>
      )}

      {sourceRoot && (
        <div className="space-y-2 border-b border-border/60 pb-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium">
              {t('roles.agencyPromotion.externalDirectory')}
            </h4>
            <Button
              variant="ghost"
              size="icon"
              title={t('roles.agencyPromotion.refresh')}
              onClick={() => void loadCatalog(sourceRoot)}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              data-testid="agency-catalog-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('roles.agencyPromotion.search')}
              className="h-9 pl-8 text-xs"
            />
          </div>
          <div data-testid="agency-draft-list" className="grid gap-2 sm:grid-cols-2">
            {filteredDrafts.map((draft) => (
              <div
                key={draft.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-surface-input px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs font-medium">
                      {draft.displayName}
                    </p>
                    <Badge
                      data-testid="agency-external-draft-status"
                      variant="outline"
                      className="shrink-0 rounded-full text-2xs"
                    >
                      {t('roles.agencyPromotion.draft')}
                    </Badge>
                  </div>
                  <p className="truncate text-2xs text-muted-foreground">
                    {draft.sourceDivision ?? draft.roleName}
                  </p>
                </div>
                <Button
                  data-testid={`agency-import-${draft.id}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void importDraft(draft)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {t('roles.agencyPromotion.import')}
                </Button>
              </div>
            ))}
            {!loading && filteredDrafts.length === 0 && (
              <p className="py-3 text-xs text-muted-foreground">
                {t('roles.agencyPromotion.noDrafts')}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,2fr)]">
        <div
          data-testid="agency-local-library"
          className="min-w-0 space-y-2 border-b border-border/60 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4"
        >
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-xs font-medium">
              {t('roles.agencyPromotion.localLibrary')}
            </h4>
          </div>
          <div className="max-h-[34rem] space-y-1 overflow-y-auto">
            {packages.map((rolePackage) => (
              <div
                key={rolePackage.packageId}
                className={cn(
                  'flex items-start gap-1 rounded-md border border-transparent',
                  selectedPackageId === rolePackage.packageId
                    ? 'bg-black/5 dark:bg-white/10'
                    : 'hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                <button
                  data-testid={`agency-package-${rolePackage.packageId}`}
                  type="button"
                  onClick={() => selectPackage(rolePackage)}
                  className="min-w-0 flex-1 px-2.5 py-2 text-left"
                >
                  <span className="block truncate text-xs font-medium">
                    {rolePackage.draft.displayName}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="rounded-full text-2xs">
                      {t(`roles.agencyPromotion.completeness.${rolePackage.completeness}`)}
                    </Badge>
                    {newerPackageIds.has(rolePackage.packageId) && (
                      <Badge variant="secondary" className="rounded-full text-2xs">
                        {t('roles.agencyPromotion.newerVersion')}
                      </Badge>
                    )}
                  </span>
                </button>
                {rolePackage.completeness === 'complete' && (
                  <Button
                    data-testid={`agency-package-refresh-${rolePackage.packageId}`}
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="mt-1 h-8 w-8 shrink-0"
                    title={t('roles.agencyPromotion.checkUpdate')}
                    disabled={busy}
                    onClick={() => void refreshPackage(rolePackage)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {!loading && packages.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {t('roles.agencyPromotion.noLocalPackages')}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0">
          {!selectedDraft || !candidate ? (
            <div className="flex min-h-52 items-center justify-center rounded-md border border-dashed border-border/70 bg-surface-input p-6 text-center text-xs text-muted-foreground">
              {t('roles.agencyPromotion.selectPackage')}
            </div>
          ) : (
            <div className="space-y-4">
              {selectedPackage?.completeness === 'legacy-reconstructed' && (
                <p
                  data-testid="agency-package-reconstructed-warning"
                  className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t('roles.agencyPromotion.reconstructedWarning')}
                </p>
              )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{selectedDraft.displayName}</span>
                  <Badge
                    data-testid="agency-draft-status"
                    variant="outline"
                    className="rounded-full text-2xs"
                  >
                    {t('roles.agencyPromotion.draft')}
                  </Badge>
                  {selectedReview && (
                    <>
                      <Badge
                        data-testid="agency-promotion-lifecycle"
                        variant="outline"
                        className={cn('rounded-full text-2xs', lifecycleTone(selectedReview.lifecycle))}
                      >
                        {t(`roles.agencyPromotion.lifecycle.${selectedReview.lifecycle}`)}
                      </Badge>
                      <Badge variant="secondary" className="rounded-full text-2xs">
                        {t(`roles.agencyPromotion.evidence.${selectedReview.evidenceQualification}`)}
                      </Badge>
                    </>
                  )}
                </div>
                <p className="break-all font-mono text-2xs text-muted-foreground">
                  {selectedDraft.sourceRef.relativePath} / {selectedDraft.sourceRef.sha256}
                </p>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t('roles.agencyPromotion.name')}>
                    <Input
                      value={candidate.name}
                      onChange={(event) => updateCandidate({ name: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <Field label={t('roles.agencyPromotion.displayName')}>
                    <Input
                      value={candidate.displayName}
                      onChange={(event) => updateCandidate({ displayName: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <Field className="md:col-span-2" label={t('roles.agencyPromotion.descriptionField')}>
                    <Input
                      value={candidate.description ?? ''}
                      onChange={(event) => updateCandidate({ description: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <Field className="md:col-span-2" label={t('roles.agencyPromotion.rolePrompt')}>
                    <Textarea
                      value={candidate.rolePrompt}
                      onChange={(event) => updateCandidate({ rolePrompt: event.target.value })}
                      className="min-h-24 text-xs"
                    />
                  </Field>
                  <NativeSelect
                    label={t('roles.agencyPromotion.effort')}
                    value={candidate.effort}
                    onChange={(value) => updateCandidate({
                      effort: value as AgencyRoleCandidatePayload['effort'],
                    })}
                    options={['low', 'medium', 'high']}
                    t={t}
                  />
                  <NativeSelect
                    label={t('roles.agencyPromotion.risk')}
                    value={candidate.riskProfile}
                    onChange={(value) => updateCandidate({
                      riskProfile: value as AgencyRoleCandidatePayload['riskProfile'],
                    })}
                    options={['low', 'medium', 'high', 'critical']}
                    t={t}
                  />
                  <NativeSelect
                    label={t('roles.agencyPromotion.filesystem')}
                    value={candidate.permissions?.filesystem ?? 'read'}
                    onChange={(value) => updateCandidate({
                      permissions: {
                        ...candidate.permissions,
                        filesystem: value as NonNullable<AgencyRoleCandidatePayload['permissions']>['filesystem'],
                      },
                    })}
                    options={['none', 'read', 'write', 'admin']}
                    t={t}
                  />
                  <NativeSelect
                    label={t('roles.agencyPromotion.network')}
                    value={candidate.permissions?.network ?? 'none'}
                    onChange={(value) => updateCandidate({
                      permissions: {
                        ...candidate.permissions,
                        network: value as NonNullable<AgencyRoleCandidatePayload['permissions']>['network'],
                      },
                    })}
                    options={['none', 'limited', 'full']}
                    t={t}
                  />
                  <Field className="md:col-span-2" label={t('roles.agencyPromotion.commands')}>
                    <Input
                      value={candidate.commands}
                      onChange={(event) => updateCandidate({ commands: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <NativeSelect
                    label={t('roles.agencyPromotion.outputFormat')}
                    value={candidate.outputFormat}
                    onChange={(value) => updateCandidate({
                      outputFormat: value as AgencyRoleCandidatePayload['outputFormat'],
                    })}
                    options={['markdown', 'json', 'text']}
                    t={t}
                  />
                  <Field label={t('roles.agencyPromotion.outputSections')}>
                    <Input
                      value={candidate.outputSections}
                      onChange={(event) => updateCandidate({ outputSections: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <Field label={t('roles.agencyPromotion.handoffTo')}>
                    <Input
                      value={candidate.handoffTo}
                      onChange={(event) => updateCandidate({ handoffTo: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <Field label={t('roles.agencyPromotion.handoffFrom')}>
                    <Input
                      value={candidate.handoffFrom}
                      onChange={(event) => updateCandidate({ handoffFrom: event.target.value })}
                      className="h-8 text-xs"
                    />
                  </Field>
                  <div className="flex items-center justify-between rounded-md bg-surface-input px-3 py-2 md:col-span-2">
                    <span className="text-xs">{t('roles.agencyPromotion.requiresReview')}</span>
                    <Switch
                      checked={candidate.requiresReview}
                      onCheckedChange={(checked) => updateCandidate({ requiresReview: checked })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-medium">{t('roles.agencyPromotion.toolHints')}</h4>
                  {selectedDraft.toolHints.map((hint) => {
                    const value = hints[hint]!;
                    const suggestions = selectedDraft.toolMappingSuggestions
                      .find((entry) => entry.hint === hint)?.candidateTools ?? [];
                    return (
                      <div key={hint} className="rounded-md border border-border/60 bg-surface-input p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs">{hint}</span>
                          <div className="flex rounded-md bg-background/50 p-0.5">
                            <Button
                              data-testid={`agency-hint-${hint}-map`}
                              type="button"
                              size="sm"
                              variant={value.disposition === 'mapped' ? 'secondary' : 'ghost'}
                              className="h-7 rounded px-2 text-2xs"
                              onClick={() => updateHint(hint, {
                                disposition: 'mapped',
                                reviewerNote: '',
                              })}
                            >
                              {t('roles.agencyPromotion.map')}
                            </Button>
                            <Button
                              data-testid={`agency-hint-${hint}-waive`}
                              type="button"
                              size="sm"
                              variant={value.disposition === 'waived' ? 'secondary' : 'ghost'}
                              className="h-7 rounded px-2 text-2xs"
                              onClick={() => updateHint(hint, {
                                disposition: 'waived',
                                selectedTools: '',
                              })}
                            >
                              {t('roles.agencyPromotion.waive')}
                            </Button>
                          </div>
                        </div>
                        {value.disposition === 'mapped' && (
                          <div className="mt-2 space-y-1">
                            <Input
                              data-testid={`agency-hint-${hint}-tools`}
                              value={value.selectedTools}
                              onChange={(event) => updateHint(hint, {
                                selectedTools: event.target.value,
                              })}
                              placeholder={t('roles.agencyPromotion.mappedTools')}
                              className="h-8 text-xs"
                            />
                            {suggestions.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {suggestions.map((tool) => (
                                  <button
                                    key={tool}
                                    type="button"
                                    className="rounded border border-border/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                                    onClick={() => updateHint(hint, {
                                      selectedTools: splitList(`${value.selectedTools},${tool}`).join(', '),
                                    })}
                                  >
                                    {tool}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {value.disposition === 'waived' && (
                          <Input
                            data-testid={`agency-hint-${hint}-note`}
                            value={value.reviewerNote}
                            onChange={(event) => updateHint(hint, {
                              reviewerNote: event.target.value,
                            })}
                            placeholder={t('roles.agencyPromotion.waiverReason')}
                            className="mt-2 h-8 text-xs"
                          />
                        )}
                      </div>
                    );
                  })}
                  {selectedDraft.toolHints.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('roles.agencyPromotion.noToolHints')}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t('roles.agencyPromotion.evidenceQualification')}>
                    <select
                      data-testid="agency-evidence-qualification"
                      value={qualification}
                      onChange={(event) => setQualification(
                        event.target.value as AgencyRoleEvidenceQualification,
                      )}
                      className="h-9 w-full rounded-md border border-input bg-surface-modal px-2 text-xs"
                    >
                      {['unverified', 'scenario-verified', 'release-qualified'].map((value) => (
                        <option key={value} value={value}>
                          {t(`roles.agencyPromotion.evidence.${value}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('roles.agencyPromotion.evidenceRefs')}>
                    <Input
                      data-testid="agency-evidence-refs"
                      value={evidenceRefs}
                      onChange={(event) => setEvidenceRefs(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label={t('roles.agencyPromotion.reviewer')}>
                    <Input
                      data-testid="agency-reviewer"
                      value={reviewer}
                      onChange={(event) => setReviewer(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                  <Field label={t('roles.agencyPromotion.comment')}>
                    <Input
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      className="h-9 text-xs"
                    />
                  </Field>
                </div>

                {issues.length > 0 && (
                  <div className="space-y-1 rounded-md border border-red-500/20 bg-red-500/10 p-3">
                    {issues.map((issue) => (
                      <p key={`${issue.path}:${issue.message}`} className="text-xs text-red-700 dark:text-red-400">
                        <span className="font-mono">{issue.path}</span>: {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                {selectedReview?.materialization.status === 'failed' && (
                  <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                    {selectedReview.materialization.error ?? t('roles.agencyPromotion.materializationFailed')}
                  </p>
                )}
                {selectedReview?.materialization.status === 'pending' && (
                  <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    {t('roles.agencyPromotion.materializationPending')}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    data-testid="agency-promotion-review"
                    size="sm"
                    variant="outline"
                    disabled={!canReview}
                    onClick={() => void submitReview()}
                  >
                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                    {t('roles.agencyPromotion.review')}
                  </Button>
                  {selectedReview
                    && selectedReview.lifecycle === 'reviewed'
                    && ['not-started', 'failed'].includes(selectedReview.materialization.status) && (
                    <Button
                      data-testid="agency-promotion-approve"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmAction('approve')}
                    >
                      <ShieldCheck className="mr-1.5 h-4 w-4" />
                      {selectedReview.materialization.status === 'failed'
                        ? t('roles.agencyPromotion.retry')
                        : t('roles.agencyPromotion.approve')}
                    </Button>
                  )}
                  {selectedReview?.lifecycle === 'active' && (
                    <Button
                      data-testid="agency-promotion-retire"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setConfirmAction('retire')}
                    >
                      <Archive className="mr-1.5 h-4 w-4" />
                      {t('roles.agencyPromotion.retire')}
                    </Button>
                  )}
                </div>

                {selectedReview?.lifecycle === 'active' && (
                  <div className="space-y-3 border-t border-border/60 pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-primary" />
                          <h4 className="text-xs font-medium">
                            {t('roles.agencyPromotion.memory.title')}
                          </h4>
                        </div>
                        <p className="text-2xs text-muted-foreground">
                          {t('roles.agencyPromotion.memory.description')}
                        </p>
                      </div>
                      <Button
                        data-testid="agency-memory-extract"
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canExtractMemory}
                        onClick={() => void extractMemoryCandidates()}
                      >
                        {busy
                          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          : <Search className="mr-1.5 h-4 w-4" />}
                        {t('roles.agencyPromotion.memory.extract')}
                      </Button>
                    </div>

                    {!roleMemoryEnabled && (
                      <p
                        data-testid="agency-memory-disabled"
                        className="rounded-md border border-zinc-500/20 bg-zinc-500/10 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-400"
                      >
                        {t('roles.agencyPromotion.memory.disabled')}
                      </p>
                    )}

                    {memoryCandidates.length > 0 && (
                      <>
                        <div className="space-y-2">
                          {memoryCandidates.map((memoryCandidate) => {
                            const preview = memoryPreviews[memoryCandidate.sectionId];
                            return (
                              <label
                                key={memoryCandidate.sectionId}
                                data-testid={`agency-memory-candidate-${memoryCandidate.sectionId}`}
                                className="flex items-start gap-3 rounded-md border border-border/60 bg-surface-input p-3"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                  checked={selectedMemorySections.has(memoryCandidate.sectionId)}
                                  onChange={(event) => {
                                    const checked = event.target.checked;
                                    setSelectedMemorySections((current) => {
                                      const next = new Set(current);
                                      if (checked) next.add(memoryCandidate.sectionId);
                                      else next.delete(memoryCandidate.sectionId);
                                      return next;
                                    });
                                    setMemoryPreviews({});
                                  }}
                                />
                                <span className="min-w-0 flex-1 space-y-1">
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline" className="rounded-full text-2xs">
                                      {t(`roles.agencyPromotion.memory.type.${memoryCandidate.type}`)}
                                    </Badge>
                                    <span className="text-2xs text-muted-foreground">
                                      {memoryCandidate.headingPath.join(' / ')}
                                    </span>
                                    {preview && (
                                      <Badge variant="secondary" className="rounded-full text-2xs">
                                        {preview.action === 'needs_review'
                                          ? t('roles.agencyPromotion.memory.needsReview')
                                          : preview.action}
                                        {preview.conflicts > 0
                                          ? ` · ${t('roles.agencyPromotion.memory.conflicts', {
                                            count: preview.conflicts,
                                          })}`
                                          : ''}
                                      </Badge>
                                    )}
                                  </span>
                                  <span className="block whitespace-pre-wrap text-xs">
                                    {memoryCandidate.content}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            data-testid="agency-memory-preview"
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={selectedMemoryCandidates.length === 0 || busy}
                            onClick={() => void previewMemoryCandidates()}
                          >
                            <ShieldCheck className="mr-1.5 h-4 w-4" />
                            {t('roles.agencyPromotion.memory.preview')}
                          </Button>
                          <Button
                            data-testid="agency-memory-submit"
                            type="button"
                            size="sm"
                            disabled={!canSubmitMemory}
                            onClick={() => void submitMemoryCandidates()}
                          >
                            <Send className="mr-1.5 h-4 w-4" />
                            {t('roles.agencyPromotion.memory.submit')}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      <ConfirmDialog
        open={confirmAction === 'approve'}
        title={t('roles.agencyPromotion.approveTitle')}
        message={t('roles.agencyPromotion.approveMessage', {
          name: selectedReview?.candidate.name ?? candidate?.name ?? '',
          filesystem: selectedReview?.candidate.permissions?.filesystem ?? candidate?.permissions?.filesystem ?? '',
          network: selectedReview?.candidate.permissions?.network ?? candidate?.permissions?.network ?? '',
          tools: selectedReview?.candidate.tools?.join(', ') ?? splitList(candidate?.tools ?? '').join(', '),
        })}
        confirmLabel={t('roles.agencyPromotion.approve')}
        cancelLabel={t('roles.cancel')}
        onConfirm={approve}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'retire'}
        title={t('roles.agencyPromotion.retireTitle')}
        message={t('roles.agencyPromotion.retireMessage')}
        confirmLabel={t('roles.agencyPromotion.retire')}
        cancelLabel={t('roles.cancel')}
        variant="destructive"
        onConfirm={retire}
        onCancel={() => setConfirmAction(null)}
      />
    </section>
  );
}

function Field({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={cn('space-y-1 text-2xs font-medium text-muted-foreground', className)}>
      {label}
      {children}
    </label>
  );
}

function NativeSelect({
  label,
  onChange,
  options,
  t,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  t: (key: string) => string;
  value: string;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-surface-modal px-2 text-xs"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`roles.agencyPromotion.option.${option}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}
