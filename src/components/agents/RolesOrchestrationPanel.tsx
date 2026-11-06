import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Download,
  Eye,
  FileText,
  GitMerge,
  History,
  Info,
  Layers3,
  ListChecks,
  Loader2,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { approvalDisplayDetails } from '@/lib/permission-approval-display';
import {
  applyPlanEditOperation,
  buildPlanEditLedgerEvents,
  createPlanEditDraft,
  type PlanEditDraft,
} from '@/lib/orchestration-plan-edit-draft';
import { buildOrchestrationPlanLedgerEvents } from '@/lib/task-ledger-plan-projection';
import { useSettingsStore } from '@/stores/settings';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { MemoryProposal, RoleConfigEffort, RoleConfigPermissions } from '@shared/host-api/contract';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import type { TaskLoopLifecycleEvent } from '@shared/host-events/contract';
import type { MissionLifecycleEvent, MissionStatus } from '@shared/types/mission-control';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { roleTone, toneClasses } from '@/lib/role-visuals';
import { RoleCard, type RoleCardData } from './RoleCard';
import { OrchestrationPlanView, type PlanView } from './OrchestrationPlanView';
import { SubagentRunnerPanel } from './SubagentRunnerPanel';
import { AgencyRolePromotionPanel } from './AgencyRolePromotionPanel';
import { ProposeFactsConfirmQueue } from './ProposeFactsConfirmQueue';
import { buildMemoryExportSnapshot } from './memory-surface';
import { AgentRoleIdentity, RoleBadge } from './AgentAvatar';
import { isTaskLoopPassed, serializeCodingRunJsonl } from '@shared/product-semantics';
import { projectTaskLoopCodingRun } from '@shared/types/coding-run';
import type { AgentAvatarView } from '@shared/types/agent';
import { subagentLifecycleIdentityKey } from '@shared/subagent-lifecycle';

/**
 * Role-first runtime panel: browse role contracts (roles.list / roles.get),
 * preview an orchestration plan (orchestrator.plan), and launch an orchestration
 * run (orchestrator.run) anchored on an agent's main session.
 *
 * All data flows through the generic gateway RPC proxy (hostApi.gateway.rpc),
 * so no dedicated host-api module is required. orchestrator.run is gated as a
 * mutating request and may return an approval-required response, which is
 * surfaced via an inline approve/reject control rather than silently failing.
 */

type AgentLike = {
  id: string;
  name: string;
  isDefault: boolean;
  mainSessionKey: string;
  avatar?: AgentAvatarView;
};

type LifecyclePhase = 'started' | 'completed' | 'error' | 'verified';
type LifecycleEntry = {
  phase: LifecyclePhase;
  ts: number;
  roleName: string;
  agentId?: string;
  taskNodeId?: string;
  error?: string;
  task?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type UnwrapResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string; approval?: PermissionApprovalEvent };

/** Surfaces a permission-block / approval-required gateway response, else returns the payload. */
function unwrapRpc(result: unknown): UnwrapResult {
  if (!isRecord(result)) {
    return { ok: false, message: 'Empty gateway response' };
  }
  if (result.success === false) {
    if (result.approvalRequired) {
      const approval = isRecord(result.approval) ? (result.approval as unknown as PermissionApprovalEvent) : undefined;
      return {
        ok: false,
        message: String(result.error ?? 'This operation requires approval in the current permission mode'),
        approval,
      };
    }
    return { ok: false, message: String(result.error ?? 'Gateway request was rejected') };
  }
  return { ok: true, data: result };
}

function readMissionPanelResult(value: unknown): MissionPanelResult {
  const record = isRecord(value) ? value : {};
  return {
    missionId: String(record.missionId ?? ''),
    status: String(record.status ?? ''),
    phase: String(record.phase ?? ''),
    tick: typeof record.tick === 'number' ? record.tick : 0,
    reviewerDecision: typeof record.lastDecision === 'string' ? record.lastDecision : undefined,
    nextWakeAt: typeof record.nextWakeAt === 'number' ? record.nextWakeAt : undefined,
    blockedReason: typeof record.blockedReason === 'string' ? record.blockedReason : undefined,
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    taskLoopRunId: typeof record.taskLoopRunId === 'string' ? record.taskLoopRunId : undefined,
  };
}

type RunResult =
  | { kind: 'success'; spawnedRunIds: string[] }
  | { kind: 'failure'; failures: Array<{ roleName: string; error?: string }> };

type OrchestrationSynthesisView = {
  status?: string;
  summary?: string;
  roleContributions?: Array<{
    roleName?: string;
    status?: string;
    task?: string;
    phase?: string;
    outputPreview?: string;
    evidenceRefs?: Array<{ type?: string; ref?: string }>;
  }>;
  evidenceRefs?: Array<{ type?: string; ref?: string; roleName?: string; taskId?: string }>;
  visibleFailures?: Array<{ code?: string; message?: string; roleName?: string; evidenceRefs?: Array<{ type?: string; ref?: string }> }>;
  verifier?: {
    decision?: string;
    verifierRole?: string;
    evidenceRefs?: Array<{ type?: string; ref?: string }>;
    reasons?: Array<{ code?: string; message?: string }>;
  };
  traceIds?: string[];
  blackboardSummary?: {
    entryCount?: number;
    unresolvedConflicts?: number;
    openQuestions?: number;
    openRisks?: number;
    memoryProposals?: number;
    evidenceRefs?: string[];
    trustBoundaries?: string[];
  };
  policy?: { toolAccess?: string; verifierAuthority?: string; memoryWrite?: string };
};

type MissionPanelResult = {
  missionId: string;
  status: MissionStatus | string;
  phase: string;
  tick: number;
  reviewerDecision?: string;
  nextWakeAt?: number;
  blockedReason?: string;
  traceId?: string;
  taskLoopRunId?: string;
};

type RoutingMemoDashboardView = {
  pilotMode?: string;
  authority?: string;
  authorityReason?: string;
  sampleCount?: number;
  outcomes?: {
    graphStatus?: Record<string, number>;
    qualityOverall?: Record<string, number>;
  };
  shadow?: {
    sampleCount?: number;
    divergenceCount?: number;
    outcomes?: Record<string, number>;
    divergenceSuccessRate?: number | null;
  };
  activeGate?: {
    eligible?: boolean;
    reasons?: string[];
    minShadowSamples?: number;
    minDivergenceSuccessRate?: number;
    shadowSampleCount?: number;
    divergenceCount?: number;
    divergenceSuccessRate?: number | null;
  };
  recentSamples?: Array<{
    id?: string;
    leadRole?: string;
    graphStatus?: string;
    qualityOverall?: string;
    shadow?: {
      actualLeadRole?: string;
      memoLeadRole?: string;
      diverged?: boolean;
      outcome?: string;
      similarity?: number;
    };
  }>;
};

type MemoryCardView = {
  id: string;
  type: string;
  scope?: string;
  sensitivity?: string;
  status: string;
  content: string;
  roleTags?: string[];
  ownerRole?: string | null;
  sourceRole?: string | null;
  applicableRoles?: string[];
  allowedMutators?: string[];
  phaseTags?: string[];
  retentionLabels?: string[];
  confidence?: number;
  importance?: number;
  source?: string;
  createdAt?: string;
  evidenceRefs?: Array<{ type?: string; ref?: string; excerpt?: string }>;
  updatedAt?: string;
  expiresAt?: string | null;
};

type MemoryProposalView = {
  id: string;
  operation: string;
  status: string;
  decision: string;
  reviewReason?: string | null;
  conflictIds?: string[];
  riskLevel?: string;
  impactScope?: string;
  suggestedAction?: string;
  reasonSummary?: string;
  permissionDecision?: string;
  permissionReason?: string;
  batchId?: string | null;
  evidenceStatus?: string;
  retentionReason?: string | null;
  source?: string;
  createdAt?: string;
  confidence?: number;
  proposal?: {
    content?: string;
    roleTags?: string[];
    sensitivity?: string;
    confidence?: number;
    importance?: number;
    applicableRoles?: string[];
    source?: string;
  };
};

type MemoryDraftState = {
  type: string;
  scope: string;
  sensitivity: string;
  content: string;
  confidence: number;
  importance: number;
  ownerRole: string;
  sourceRole: string;
  applicableRoles: string;
  allowedMutators: string;
  phaseTags: string;
  expiresAt: string;
  evidenceRef: string;
  evidenceExcerpt: string;
};

type RoleConfigDraftState = {
  name: string;
  displayName: string;
  description: string;
  rolePrompt: string;
  tools: string;
  effort: RoleConfigEffort;
  filesystem: NonNullable<RoleConfigPermissions['filesystem']>;
  network: NonNullable<RoleConfigPermissions['network']>;
  commands: string;
  tags: string;
};

type MemoryProposalPreviewView = {
  operation?: string;
  targetId?: string | null;
  normalized?: {
    type?: string;
    scope?: string;
    sensitivity?: string;
    content?: string;
    confidence?: number;
    importance?: number;
    applicableRoles?: string[];
  };
  decision?: {
    action?: string;
    accepted?: boolean;
    reason?: string;
  };
  conflicts?: MemoryConflictView[];
  evidence?: MemoryEvidenceCheckView;
  riskLevel?: string;
  impactScope?: string;
  suggestedAction?: string;
  reasonSummary?: string;
  permissionDecision?: string;
  permissionReason?: string;
  wouldWrite?: boolean;
};

type MemoryConflictView = {
  id: string;
  type: string;
  status: string;
  reason: string;
  cardIds?: string[];
};

type MemoryInjectionView = {
  id: string;
  roleName: string;
  createdAt: string;
  truncated?: boolean;
  policyVersion?: string;
  candidateExplanations?: Array<{
    cardId: string;
    score: number;
    selected: boolean;
    bucket?: string;
    reason: string;
    penalties?: string[];
    truncatedReason?: string;
    injectionClass?: string;
    whatWouldSelect?: string;
  }>;
};

type MemoryInjectionCandidateView = NonNullable<MemoryInjectionView['candidateExplanations']>[number];
const MEMORY_INJECTION_CLASSES = ['must', 'should', 'may', 'never'] as const;
type MemoryInjectionClassView = (typeof MEMORY_INJECTION_CLASSES)[number];

type MemoryRetentionView = {
  card: MemoryCardView;
  recommendedAction: string;
  retentionScore: number;
  labels: string[];
  reason: string;
};

type MemoryEvidenceCheckView = {
  status: string;
  summary: string;
  refs?: Array<{ status: string; reason: string; ref: { type?: string; ref?: string; excerpt?: string } }>;
};

type MemoryConflictDetailView = {
  conflict?: MemoryConflictView;
  cards?: MemoryCardView[];
  proposals?: MemoryProposalView[];
  evidence?: MemoryEvidenceCheckView[];
  suggestedAction?: string;
  reasonSummary?: string;
};

type MemorySimulationView = {
  pack?: {
    policyVersion?: string;
    truncated?: boolean;
    budget?: { total?: number };
    estimatedTokens?: { total?: number };
    candidateExplanations?: MemoryInjectionView['candidateExplanations'];
  };
  selectedCards?: MemoryCardView[];
};

type MemoryHealthView = {
  ok?: boolean;
  checks?: Array<{ name: string; status: string; message: string; count?: number }>;
};

type MemoryUtilityReportView = {
  roleName?: string;
  generatedAt?: string;
  dataQuality?: string;
  missingEvidence?: string[];
  sample?: {
    cards?: number;
    injections?: number;
    feedback?: number;
    proposals?: number;
    conflicts?: number;
  };
  aggregate?: {
    contextPrecisionAtK?: number | null;
    helpfulnessRate?: number | null;
    harmRate?: number | null;
    staleRate?: number | null;
    conflictRate?: number | null;
    reviewAcceptanceRate?: number | null;
    tokenOverheadPerRun?: number | null;
    taskSuccessDelta?: number | null;
  };
  cards?: Array<{
    cardId: string;
    card?: MemoryCardView;
    selectedCount?: number;
    skippedCount?: number;
    feedbackCount?: number;
    helpfulCount?: number;
    neutralCount?: number;
    harmfulCount?: number;
    missingNeededCount?: number;
    userCorrectedCount?: number;
    conflictCount?: number;
    retentionAction?: string;
    utilityScore?: number | null;
    dataQuality?: string;
    reasonSummary?: string;
  }>;
};

type MemoryDetailView = {
  card?: MemoryCardView;
  proposal?: MemoryProposalView;
  conflict?: MemoryConflictView;
  injection?: MemoryInjectionView;
  conflictDetail?: MemoryConflictDetailView;
  evidence?: MemoryEvidenceCheckView;
  retention?: MemoryRetentionView;
  proposals?: MemoryProposalView[];
  conflicts?: MemoryConflictView[];
  versions?: Array<{ id: string; version: number; reason?: string | null; createdAt: string }>;
  audit?: Array<{ id: string; action: string; reason?: string | null; createdAt: string }>;
  injections?: MemoryInjectionView[];
};

function scoreToPercent(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function formatMemoryMetric(value?: number | null, options?: { percent?: boolean }): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (options?.percent) return `${Math.round(value * 100)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function memoryStatusClasses(status?: string): string {
  if (status === 'active') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'cold') return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  if (status === 'archived') return 'border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400';
  if (status === 'tombstone') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  return 'border-border bg-surface-input text-muted-foreground';
}

function memorySensitivityClasses(sensitivity?: string): string {
  if (sensitivity === 'secret' || sensitivity === 'secret_adjacent') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  if (sensitivity === 'sensitive') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'border-border bg-black/5 text-muted-foreground dark:bg-white/10';
}

function formatMemoryDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

const MEMORY_TYPE_OPTIONS = ['fact', 'constraint', 'preference', 'procedure', 'risk', 'decision', 'episode', 'handoff', 'artifact_ref'] as const;
const MEMORY_SCOPE_OPTIONS = ['role', 'task', 'session', 'project', 'workspace', 'user', 'team', 'agent', 'global'] as const;
const MEMORY_SENSITIVITY_OPTIONS = ['normal', 'sensitive', 'secret_adjacent', 'secret'] as const;
function splitMemoryList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function displayEvidenceRef(ref: { type?: string; ref?: string } | string | undefined): string {
  if (!ref) return '-';
  if (typeof ref === 'string') return ref;
  const value = ref.ref || '-';
  return ref.type ? `${ref.type}:${value}` : value;
}

function compactList<T>(items: T[] | undefined, limit = 6): T[] {
  return (items ?? []).slice(0, limit);
}

function remainingCount<T>(items: T[] | undefined, limit = 6): number {
  return Math.max(0, (items?.length ?? 0) - limit);
}

function joinMemoryList(value?: string[]): string {
  return (value ?? []).join(', ');
}

function defaultRoleConfigDraft(role?: RoleCardData | null): RoleConfigDraftState {
  return {
    name: role?.name ?? '',
    displayName: role?.displayName ?? '',
    description: role?.description ?? '',
    rolePrompt: role?.rolePrompt ?? '',
    tools: joinMemoryList(role?.tools),
    effort: (role?.effort === 'low' || role?.effort === 'medium' || role?.effort === 'high') ? role.effort : 'medium',
    filesystem: role?.permissions?.filesystem === 'none' || role?.permissions?.filesystem === 'read' || role?.permissions?.filesystem === 'write' || role?.permissions?.filesystem === 'admin'
      ? role.permissions.filesystem
      : 'read',
    network: role?.permissions?.network === 'none' || role?.permissions?.network === 'limited' || role?.permissions?.network === 'full'
      ? role.permissions.network
      : 'none',
    commands: joinMemoryList(role?.permissions?.commands),
    tags: joinMemoryList(role?.tags),
  };
}

function defaultMemoryDraft(roleName?: string | null): MemoryDraftState {
  return {
    type: 'procedure',
    scope: 'role',
    sensitivity: 'normal',
    content: '',
    confidence: 0.85,
    importance: 0.55,
    ownerRole: roleName ?? '',
    sourceRole: '',
    applicableRoles: roleName ?? '',
    allowedMutators: 'ownerRole, operator',
    phaseTags: '',
    expiresAt: '',
    evidenceRef: 'clawx-role-memory-ui',
    evidenceExcerpt: '',
  };
}

function draftFromCard(card: MemoryCardView, roleName?: string | null): MemoryDraftState {
  const evidence = card.evidenceRefs?.[0];
  return {
    ...defaultMemoryDraft(roleName),
    type: card.type || 'procedure',
    scope: card.scope || 'role',
    sensitivity: card.sensitivity || 'normal',
    content: card.content,
    confidence: typeof card.confidence === 'number' ? card.confidence : 0.85,
    importance: typeof card.importance === 'number' ? card.importance : 0.55,
    ownerRole: card.ownerRole || roleName || '',
    sourceRole: card.sourceRole || '',
    applicableRoles: joinMemoryList(card.applicableRoles ?? card.roleTags) || roleName || '',
    allowedMutators: joinMemoryList(card.allowedMutators) || 'ownerRole, operator',
    phaseTags: joinMemoryList((card as { phaseTags?: string[] }).phaseTags),
    expiresAt: (card as { expiresAt?: string | null }).expiresAt?.slice(0, 10) ?? '',
    evidenceRef: evidence?.ref || 'clawx-role-memory-ui',
    evidenceExcerpt: evidence?.excerpt || '',
  };
}

function draftFromProposal(proposal: Record<string, unknown>, roleName?: string | null): MemoryDraftState {
  const evidenceRefs = Array.isArray(proposal.evidenceRefs) ? proposal.evidenceRefs as Array<{ ref?: string; excerpt?: string }> : [];
  return {
    ...defaultMemoryDraft(roleName),
    type: typeof proposal.type === 'string' ? proposal.type : 'procedure',
    scope: typeof proposal.scope === 'string' ? proposal.scope : 'role',
    sensitivity: typeof proposal.sensitivity === 'string' ? proposal.sensitivity : 'normal',
    content: typeof proposal.content === 'string' ? proposal.content : '',
    confidence: typeof proposal.confidence === 'number' ? proposal.confidence : 0.85,
    importance: typeof proposal.importance === 'number' ? proposal.importance : 0.55,
    ownerRole: typeof proposal.ownerRole === 'string' ? proposal.ownerRole : roleName ?? '',
    sourceRole: typeof proposal.sourceRole === 'string' ? proposal.sourceRole : '',
    applicableRoles: Array.isArray(proposal.applicableRoles) ? joinMemoryList(proposal.applicableRoles as string[]) : roleName ?? '',
    allowedMutators: Array.isArray(proposal.allowedMutators) ? joinMemoryList(proposal.allowedMutators as string[]) : 'ownerRole, operator',
    phaseTags: Array.isArray(proposal.phaseTags) ? joinMemoryList(proposal.phaseTags as string[]) : '',
    expiresAt: typeof proposal.expiresAt === 'string' ? proposal.expiresAt.slice(0, 10) : '',
    evidenceRef: evidenceRefs[0]?.ref || 'clawx-role-memory-ui',
    evidenceExcerpt: evidenceRefs[0]?.excerpt || '',
  };
}

function proposalSourceLabel(proposal: MemoryProposalView): string {
  return proposal.proposal?.source || proposal.source || 'metadata-missing';
}

function proposalConfidenceScore(proposal: MemoryProposalView): number | null {
  const value = typeof proposal.proposal?.confidence === 'number'
    ? proposal.proposal.confidence
    : typeof proposal.confidence === 'number'
      ? proposal.confidence
      : null;
  return value === null ? null : scoreToPercent(value);
}

function proposalReviewReason(proposal: MemoryProposalView): string | null {
  return proposal.reasonSummary || proposal.reviewReason || proposal.permissionReason || proposal.retentionReason || null;
}

export default function RolesOrchestrationPanel({ agents, showMemoryPanel = true }: { agents: AgentLike[]; showMemoryPanel?: boolean }) {
  const { t } = useTranslation('agents');
  const roleMemoryEnabled = useSettingsStore((state) => state.roleMemoryEnabled);
  const activeWorkspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const tt = useCallback(
    (key: string, defaultValue: string, vars?: Record<string, unknown>) =>
      t(key, { defaultValue, ...(vars ?? {}) }),
    [t],
  );

  const [roles, setRoles] = useState<RoleCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleConfigMode, setRoleConfigMode] = useState<'create' | 'edit' | null>(null);
  const [roleConfigDraft, setRoleConfigDraft] = useState<RoleConfigDraftState>(() => defaultRoleConfigDraft());
  const [roleConfigSaving, setRoleConfigSaving] = useState(false);
  const [roleConfigError, setRoleConfigError] = useState<string | null>(null);
  const [roleConfigPendingName, setRoleConfigPendingName] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planEditDraft, setPlanEditDraft] = useState<PlanEditDraft | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PermissionApprovalEvent | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [routingMemoDashboard, setRoutingMemoDashboard] = useState<RoutingMemoDashboardView | null>(null);
  const [routingMemoLoading, setRoutingMemoLoading] = useState(false);
  const [synthesis, setSynthesis] = useState<OrchestrationSynthesisView | null>(null);
  const [lifecycleEvents, setLifecycleEvents] = useState<Record<string, LifecycleEntry>>({});
  const [taskLoopEvents, setTaskLoopEvents] = useState<Record<string, TaskLoopLifecycleEvent>>({});
  const [taskLoopRunning, setTaskLoopRunning] = useState(false);
  const [taskLoopResult, setTaskLoopResult] = useState<{
    loopRunId: string;
    status: string;
    phase: string;
    traceId?: string;
    evidenceGate?: TaskLoopLifecycleEvent['evidenceGate'];
    roleQualitySummary?: TaskLoopLifecycleEvent['roleQualitySummary'];
    filesTouched?: string[];
    testsRun?: string[];
    blockedReason?: string;
  } | null>(null);
  const [missionEvents, setMissionEvents] = useState<Record<string, MissionLifecycleEvent>>({});
  const [missionRunning, setMissionRunning] = useState(false);
  const [missionResult, setMissionResult] = useState<MissionPanelResult | null>(null);
  const [memoryCards, setMemoryCards] = useState<MemoryCardView[]>([]);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposalView[]>([]);
  const [memoryConflictItems, setMemoryConflictItems] = useState<MemoryConflictView[]>([]);
  const [memoryInjections, setMemoryInjections] = useState<MemoryInjectionView[]>([]);
  const [memoryRetention, setMemoryRetention] = useState<MemoryRetentionView[]>([]);
  const [memoryStats, setMemoryStats] = useState<Record<string, number>>({});
  const [memoryConflicts, setMemoryConflicts] = useState(0);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryFeedbackLoading, setMemoryFeedbackLoading] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraftState>(() => defaultMemoryDraft(null));
  const [memoryDraftTarget, setMemoryDraftTarget] = useState<{ id: string; mode: 'update' | 'supersede' } | null>(null);
  const [memoryAdvancedOpen, setMemoryAdvancedOpen] = useState(false);
  const [memoryPreview, setMemoryPreview] = useState<MemoryProposalPreviewView | null>(null);
  const [memoryPreviewLoading, setMemoryPreviewLoading] = useState(false);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [memorySimulation, setMemorySimulation] = useState<MemorySimulationView | null>(null);
  const [memoryHealth, setMemoryHealth] = useState<MemoryHealthView | null>(null);
  const [memoryUtility, setMemoryUtility] = useState<MemoryUtilityReportView | null>(null);
  const [memoryDetailOpen, setMemoryDetailOpen] = useState(false);
  const [memoryDetail, setMemoryDetail] = useState<MemoryDetailView | null>(null);
  const [memoryDetailLoading, setMemoryDetailLoading] = useState(false);
  const [memoryExporting, setMemoryExporting] = useState(false);
  const [memoryDeleteTarget, setMemoryDeleteTarget] = useState<MemoryCardView | null>(null);
  const roleMemoryDisabled = !roleMemoryEnabled;

  const activeMemoryCards = useMemo(
    () => memoryCards.filter((card) => card.status === 'active' || card.status === 'cold'),
    [memoryCards],
  );
  const reviewMemoryProposals = useMemo(
    () => {
      const riskRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      const scopeRank: Record<string, number> = { user: 5, workspace: 4, project: 3, agent: 2, team: 2, role: 1, session: 0, task: 0, global: 5 };
      const evidenceRank: Record<string, number> = { missing: 4, contradicted: 4, stale: 3, weak: 2, unchecked: 1, verified: 0 };
      return memoryProposals
        .filter((proposal) => proposal.status === 'needs_review' || proposal.status === 'pending')
        .sort((a, b) =>
          (riskRank[b.riskLevel ?? ''] ?? 0) - (riskRank[a.riskLevel ?? ''] ?? 0) ||
          (scopeRank[b.impactScope ?? ''] ?? 0) - (scopeRank[a.impactScope ?? ''] ?? 0) ||
          (b.conflictIds?.length ?? 0) - (a.conflictIds?.length ?? 0) ||
          (evidenceRank[b.evidenceStatus ?? ''] ?? 0) - (evidenceRank[a.evidenceStatus ?? ''] ?? 0),
        );
    },
    [memoryProposals],
  );
  const latestInjection = memoryInjections[0];
  const selectedInjectionCandidates = latestInjection?.candidateExplanations?.filter((candidate) => candidate.selected).length ?? 0;
  const skippedInjectionCandidates = latestInjection?.candidateExplanations?.filter((candidate) => !candidate.selected).length ?? 0;
  const simulationBudgetPercent = useMemo(() => {
    const total = memorySimulation?.pack?.budget?.total ?? 0;
    const used = memorySimulation?.pack?.estimatedTokens?.total ?? 0;
    if (total <= 0 || used <= 0) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  }, [memorySimulation]);
  const simulationCandidatesByClass = useMemo(() => {
    const groups: Record<MemoryInjectionClassView, MemoryInjectionCandidateView[]> = {
      must: [],
      should: [],
      may: [],
      never: [],
    };
    for (const candidate of memorySimulation?.pack?.candidateExplanations ?? []) {
      const injectionClass = MEMORY_INJECTION_CLASSES.includes(candidate.injectionClass as MemoryInjectionClassView)
        ? candidate.injectionClass as MemoryInjectionClassView
        : 'may';
      groups[injectionClass].push(candidate);
    }
    return groups;
  }, [memorySimulation]);
  const activeMemoryCount = memoryStats.active ?? activeMemoryCards.length;
  const reviewMemoryCount = memoryStats.proposalsNeedsReview ?? reviewMemoryProposals.length;
  const conflictMemoryCount = memoryStats.conflictsOpen ?? memoryConflictItems.length;
  const retentionMemoryCount = memoryRetention.length;
  const healthWarningCount = memoryHealth?.checks?.filter((check) => check.status !== 'ok').length ?? 0;
  const memoryFeedbackCount = memoryUtility?.sample?.feedback ?? 0;
  const memoryQualityLabel = memoryUtility?.dataQuality ?? 'insufficient';
  const anchorSession = useMemo(() => {
    const def = agents.find((agent) => agent.isDefault) ?? agents[0];
    return def?.mainSessionKey ?? '';
  }, [agents]);
  const anchorAgentId = useMemo(() => {
    const def = agents.find((agent) => agent.isDefault) ?? agents[0];
    return def?.id ?? '';
  }, [agents]);
  const anchorAgent = useMemo(
    () => agents.find((agent) => agent.id === anchorAgentId) ?? null,
    [agents, anchorAgentId],
  );
  const showRoleMemoryDisabledToast = useCallback(() => {
    toast.message(tt('roles.memoryDisabledToast', 'Role Memory is disabled in Settings.'));
  }, [tt]);

  const loadRoles = useCallback(async (): Promise<RoleCardData[]> => {
    setLoading(true);
    try {
      const result = await hostApi.gateway.rpc('roles.list');
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return [];
      }
      const list = Array.isArray(unwrapped.data.roles) ? (unwrapped.data.roles as RoleCardData[]) : [];
      setRoles(list);
      return list;
    } catch (err) {
      toast.error(String(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const selectedRoleConfig = useMemo(
    () => roles.find((role) => role.name === selectedRole && role.origin === 'config') ?? null,
    [roles, selectedRole],
  );
  const roleConfigNameValid = /^[a-z][a-z0-9-]{1,63}$/.test(roleConfigDraft.name.trim());
  const roleConfigCanSave =
    roleConfigNameValid &&
    roleConfigDraft.displayName.trim().length > 0 &&
    roleConfigDraft.rolePrompt.trim().length > 0 &&
    !roleConfigSaving;

  const updateRoleConfigDraft = useCallback((patch: Partial<RoleConfigDraftState>) => {
    setRoleConfigDraft((prev) => ({ ...prev, ...patch }));
    setRoleConfigError(null);
  }, []);

  const startCreateConfigRole = useCallback(() => {
    setRoleConfigMode('create');
    setRoleConfigDraft(defaultRoleConfigDraft());
    setRoleConfigError(null);
    setRoleConfigPendingName(null);
  }, []);

  const startEditConfigRole = useCallback(() => {
    if (!selectedRoleConfig) return;
    setRoleConfigMode('edit');
    setRoleConfigDraft(defaultRoleConfigDraft(selectedRoleConfig));
    setRoleConfigError(null);
    setRoleConfigPendingName(null);
  }, [selectedRoleConfig]);

  const cancelRoleConfigEdit = useCallback(() => {
    setRoleConfigMode(null);
    setRoleConfigDraft(defaultRoleConfigDraft());
    setRoleConfigError(null);
  }, []);

  const saveRoleConfig = useCallback(async () => {
    if (!roleConfigCanSave) {
      setRoleConfigError(tt('roles.configValidationError', 'Name, display name, and role prompt are required.'));
      return;
    }
    const roleName = roleConfigDraft.name.trim();
    setRoleConfigSaving(true);
    setRoleConfigError(null);
    try {
      const result = await hostApi.roles.upsertConfigRole({
        name: roleName,
        displayName: roleConfigDraft.displayName.trim(),
        description: roleConfigDraft.description.trim() || undefined,
        rolePrompt: roleConfigDraft.rolePrompt.trim(),
        tools: splitMemoryList(roleConfigDraft.tools),
        effort: roleConfigDraft.effort,
        permissions: {
          filesystem: roleConfigDraft.filesystem,
          network: roleConfigDraft.network,
          commands: splitMemoryList(roleConfigDraft.commands),
        },
        tags: splitMemoryList(roleConfigDraft.tags),
      });
      const refreshedRoles = await loadRoles();
      const runtimeHasRole = refreshedRoles.some((role) => role.name === roleName);
      if (result.pendingRuntimeRefresh || !runtimeHasRole) {
        setRoleConfigPendingName(roleName);
        toast.message(tt('roles.configPendingRuntimeToast', 'Saved to config. It will be available after the runtime refreshes.'));
      } else {
        setRoleConfigPendingName(null);
        toast.success(tt('roles.configSaved', 'Role saved'));
      }
      setSelectedRole(roleName);
      setRoleConfigMode(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRoleConfigError(message);
      toast.error(tt('roles.configSaveFailed', 'Failed to save role: {{error}}', { error: message }));
    } finally {
      setRoleConfigSaving(false);
    }
  }, [loadRoles, roleConfigCanSave, roleConfigDraft, tt]);

  const loadRoutingMemoDashboard = useCallback(async () => {
    const workspaceDir = activeWorkspace?.rootPath;
    if (!workspaceDir) {
      setRoutingMemoDashboard(null);
      return;
    }
    setRoutingMemoLoading(true);
    try {
      const result = await hostApi.gateway.rpc('routing_memo.summary', { workspaceDir });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      setRoutingMemoDashboard(unwrapped.data as RoutingMemoDashboardView);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRoutingMemoLoading(false);
    }
  }, [activeWorkspace?.rootPath]);

  useEffect(() => {
    if (expanded && roles.length === 0 && !loading) {
      void loadRoles();
    }
  }, [expanded, roles.length, loading, loadRoles]);

  useEffect(() => {
    if (expanded) {
      void loadRoutingMemoDashboard();
    }
  }, [expanded, loadRoutingMemoDashboard]);

  const loadRoleMemory = useCallback(async () => {
    if (!selectedRole) return;
    if (roleMemoryDisabled) {
      setMemoryCards([]);
      setMemoryProposals([]);
      setMemoryConflictItems([]);
      setMemoryInjections([]);
      setMemoryRetention([]);
      setMemoryHealth(null);
      setMemoryUtility(null);
      setMemoryStats({});
      setMemoryConflicts(0);
      setMemorySimulation(null);
      return;
    }
    setMemoryLoading(true);
    try {
      // Migrated: typed facade calls (throw on error -> rejected in allSettled).
      // Blocked methods stay on gateway.rpc (envelope error model).
      const [
        listSettled, injectionsSettled, healthSettled,
        proposalsSettled, conflictsSettled, statsSettled, retentionSettled, utilitySettled,
      ] = await Promise.allSettled([
        hostApi.memory.list({ roleName: selectedRole, status: 'all' }),
        hostApi.memory.explainInjection({ roleName: selectedRole, limit: 10 }),
        hostApi.memory.health(),
        hostApi.gateway.rpc('memory.proposals', { roleName: selectedRole, limit: 50 }),
        hostApi.gateway.rpc('memory.conflicts', { status: 'open' }),
        hostApi.gateway.rpc('memory.stats'),
        hostApi.gateway.rpc('memory.retentionCandidates', { roleName: selectedRole, limit: 8 }),
        hostApi.gateway.rpc('memory.utilityReport', { roleName: selectedRole, limit: 12 }),
      ]);

      // Typed facade results
      if (listSettled.status === 'fulfilled') {
        setMemoryCards(Array.isArray(listSettled.value.cards) ? (listSettled.value.cards as MemoryCardView[]) : []);
      }
      setMemoryLoading(false);
      if (injectionsSettled.status === 'fulfilled') {
        setMemoryInjections(Array.isArray(injectionsSettled.value.injections) ? (injectionsSettled.value.injections as MemoryInjectionView[]) : []);
      }
      if (healthSettled.status === 'fulfilled') {
        // Typed facade flattens health fields to top level (result.ok, result.checks, ...).
        setMemoryHealth(healthSettled.value as unknown as MemoryHealthView);
      }

      // Gateway RPC results (blocked methods - keep unwrapRpc envelope pattern)
      const proposalsResult = proposalsSettled.status === 'fulfilled' ? proposalsSettled.value : undefined;
      const conflictsResult = conflictsSettled.status === 'fulfilled' ? conflictsSettled.value : undefined;
      const statsResult = statsSettled.status === 'fulfilled' ? statsSettled.value : undefined;
      const retentionResult = retentionSettled.status === 'fulfilled' ? retentionSettled.value : undefined;
      const utilityResult = utilitySettled.status === 'fulfilled' ? utilitySettled.value : undefined;
      const conflictsUnwrapped = unwrapRpc(conflictsResult);
      if (conflictsUnwrapped.ok) {
        const conflicts = Array.isArray(conflictsUnwrapped.data.conflicts) ? conflictsUnwrapped.data.conflicts : [];
        setMemoryConflictItems(conflicts as MemoryConflictView[]);
        setMemoryConflicts(conflicts.length);
      }
      const proposalsUnwrapped = unwrapRpc(proposalsResult);
      if (proposalsUnwrapped.ok) {
        setMemoryProposals(Array.isArray(proposalsUnwrapped.data.proposals) ? (proposalsUnwrapped.data.proposals as MemoryProposalView[]) : []);
      }
      const statsUnwrapped = unwrapRpc(statsResult);
      if (statsUnwrapped.ok && isRecord(statsUnwrapped.data.stats)) {
        setMemoryStats(statsUnwrapped.data.stats as Record<string, number>);
      }
      const retentionUnwrapped = unwrapRpc(retentionResult);
      if (retentionUnwrapped.ok) {
        setMemoryRetention(Array.isArray(retentionUnwrapped.data.candidates) ? (retentionUnwrapped.data.candidates as MemoryRetentionView[]) : []);
      }
      const utilityUnwrapped = unwrapRpc(utilityResult);
      if (utilityUnwrapped.ok && isRecord(utilityUnwrapped.data.report)) {
        setMemoryUtility(utilityUnwrapped.data.report as MemoryUtilityReportView);
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [roleMemoryDisabled, selectedRole]);

  useEffect(() => {
    if (expanded && selectedRole) {
      void loadRoleMemory();
    } else {
      setMemoryCards([]);
      setMemoryProposals([]);
      setMemoryConflictItems([]);
      setMemoryInjections([]);
      setMemoryRetention([]);
      setMemoryHealth(null);
      setMemoryUtility(null);
      setMemoryStats({});
      setMemoryConflicts(0);
    }
  }, [expanded, selectedRole, loadRoleMemory]);

  useEffect(() => {
    setMemoryDraft(defaultMemoryDraft(selectedRole));
    setMemoryDraftTarget(null);
    setMemoryPreview(null);
    setMemoryAdvancedOpen(false);
  }, [selectedRole]);

  const updateMemoryDraft = useCallback((patch: Partial<MemoryDraftState>) => {
    setMemoryDraft((prev) => ({ ...prev, ...patch }));
    setMemoryPreview(null);
  }, []);

  const buildMemoryProposal = useCallback(() => {
    const applicableRoles = splitMemoryList(memoryDraft.applicableRoles);
    const allowedMutators = splitMemoryList(memoryDraft.allowedMutators);
    const phaseTags = splitMemoryList(memoryDraft.phaseTags);
    return {
      type: memoryDraft.type,
      scope: memoryDraft.scope,
      roleTags: selectedRole ? [selectedRole] : applicableRoles,
      ownerRole: memoryDraft.ownerRole.trim() || selectedRole || undefined,
      sourceRole: memoryDraft.sourceRole.trim() || undefined,
      applicableRoles: applicableRoles.length ? applicableRoles : selectedRole ? [selectedRole] : [],
      allowedMutators,
      phaseTags,
      content: memoryDraft.content.trim(),
      confidence: memoryDraft.confidence,
      importance: memoryDraft.importance,
      sensitivity: memoryDraft.sensitivity,
      source: 'user',
      evidenceRefs: [{
        type: 'manual',
        ref: memoryDraft.evidenceRef.trim() || 'clawx-role-memory-ui',
        ...(memoryDraft.evidenceExcerpt.trim() ? { excerpt: memoryDraft.evidenceExcerpt.trim() } : {}),
      }],
      ...(memoryDraft.expiresAt ? { expiresAt: memoryDraft.expiresAt } : {}),
    };
  }, [memoryDraft, selectedRole]);

  const previewRoleMemory = useCallback(async () => {
    if (!selectedRole || !memoryDraft.content.trim()) return;
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryPreviewLoading(true);
    try {
      const operation = memoryDraftTarget?.mode === 'supersede'
        ? 'supersede'
        : memoryDraftTarget?.mode === 'update'
          ? 'update'
          : 'create';
      const result = await hostApi.gateway.rpc('memory.previewProposal', {
        proposal: buildMemoryProposal(),
        operation,
        ...(memoryDraftTarget ? { targetId: memoryDraftTarget.id } : {}),
      });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      setMemoryPreview(isRecord(unwrapped.data.preview) ? (unwrapped.data.preview as MemoryProposalPreviewView) : null);
      toast.message(tt('roles.memoryPreviewReady', 'Preview updated'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryPreviewLoading(false);
    }
  }, [buildMemoryProposal, memoryDraft.content, memoryDraftTarget, roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, tt]);

  const proposeRoleMemory = useCallback(async () => {
    if (!selectedRole || !memoryDraft.content.trim()) return;
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const proposal = buildMemoryProposal() as unknown as MemoryProposal;
      // Migrated: update + propose use typed facade; supersede stays on gateway.rpc (blocked).
      // Typed facade throws on error (caught by try/catch); gateway.rpc returns envelope.
      if (memoryDraftTarget?.mode === 'update') {
        const result = await hostApi.memory.update({ id: memoryDraftTarget.id, patch: proposal });
        const accepted = result.accepted === true;
        toast[accepted ? 'success' : 'message'](
          accepted
            ? tt('roles.memorySaved', 'Role memory saved')
            : String(result.reason ?? tt('roles.memoryNeedsReview', 'Memory needs review')),
        );
      } else if (memoryDraftTarget?.mode === 'supersede') {
        const result = await hostApi.gateway.rpc('memory.supersede', { id: memoryDraftTarget.id, proposal });
        const unwrapped = unwrapRpc(result);
        if (!unwrapped.ok) {
          toast.error(unwrapped.message);
          return;
        }
        const accepted = unwrapped.data.accepted === true;
        toast[accepted ? 'success' : 'message'](
          accepted
            ? tt('roles.memorySaved', 'Role memory saved')
            : String(unwrapped.data.reason ?? tt('roles.memoryNeedsReview', 'Memory needs review')),
        );
      } else {
        const result = await hostApi.memory.propose(proposal);
        const accepted = result.accepted === true;
        toast[accepted ? 'success' : 'message'](
          accepted
            ? tt('roles.memorySaved', 'Role memory saved')
            : String(result.reason ?? tt('roles.memoryNeedsReview', 'Memory needs review')),
        );
      }
      setMemoryDraft(defaultMemoryDraft(selectedRole));
      setMemoryDraftTarget(null);
      setMemoryPreview(null);
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [buildMemoryProposal, loadRoleMemory, memoryDraft.content, memoryDraftTarget, roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, tt]);

  const archiveRoleMemory = useCallback(async (id: string) => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.archive', { id });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      toast.success(tt('roles.memoryArchived', 'Role memory archived'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [loadRoleMemory, roleMemoryDisabled, showRoleMemoryDisabledToast, tt]);

  const reviewRoleMemory = useCallback(async (id: string, action: 'approve' | 'reject' | 'applyAsCold') => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.review', { id, action });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      toast.success(tt('roles.memoryReviewed', 'Memory review updated'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [loadRoleMemory, roleMemoryDisabled, showRoleMemoryDisabledToast, tt]);

  const reviewSelectedRoleMemory = useCallback(async (action: 'approve' | 'reject' | 'applyAsCold') => {
    if (selectedReviewIds.length === 0) return;
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.reviewBatch', { ids: selectedReviewIds, action });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      setSelectedReviewIds([]);
      toast.success(tt('roles.memoryBatchReviewed', 'Batch review updated'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [loadRoleMemory, roleMemoryDisabled, selectedReviewIds, showRoleMemoryDisabledToast, tt]);

  const proposeRetention = useCallback(async (cardId: string, action?: string) => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.retentionPropose', { cardId, action });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      toast.success(tt('roles.memoryRetentionProposed', 'Lifecycle proposal created'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [loadRoleMemory, roleMemoryDisabled, showRoleMemoryDisabledToast, tt]);

  const restoreRoleMemory = useCallback(async (id: string) => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.restore', { id });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      toast.success(tt('roles.memoryRestoreProposed', 'Restore proposal created'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [loadRoleMemory, roleMemoryDisabled, showRoleMemoryDisabledToast, tt]);

  const tombstoneRoleMemory = useCallback(async (id: string) => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.archive', { id, tombstone: true });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      toast.success(tt('roles.memoryTombstoneProposed', 'Tombstone proposal created'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [loadRoleMemory, roleMemoryDisabled, showRoleMemoryDisabledToast, tt]);

  const requestDeleteRoleMemory = useCallback((card: MemoryCardView) => {
    setMemoryDeleteTarget(card);
  }, []);

  const confirmDeleteRoleMemory = useCallback(async () => {
    if (!memoryDeleteTarget) return;
    const target = memoryDeleteTarget;
    setMemoryDeleteTarget(null);
    await tombstoneRoleMemory(target.id);
  }, [memoryDeleteTarget, tombstoneRoleMemory]);

  const exportRoleMemory = useCallback(() => {
    if (!selectedRole) return;
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryExporting(true);
    try {
      const snapshot = buildMemoryExportSnapshot({
        generatedAt: new Date().toISOString(),
        roleName: selectedRole,
        cards: memoryCards,
        proposals: memoryProposals,
        injections: memoryInjections,
      });
      const serialized = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([serialized], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'clawx-memory-' + selectedRole + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      toast.success(tt('roles.memoryExported', 'Memory export ready'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryExporting(false);
    }
  }, [memoryCards, memoryInjections, memoryProposals, roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, tt]);

  const prepareMemoryDraft = useCallback((card: MemoryCardView, mode: 'update' | 'supersede') => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryDraftTarget({ id: card.id, mode });
    setMemoryDraft(draftFromCard(card, selectedRole));
    setMemoryPreview(null);
    setMemoryDetailOpen(false);
    toast.message(mode === 'supersede' ? tt('roles.memorySupersedeDraftReady', 'Supersede draft loaded') : tt('roles.memoryEditDraftReady', 'Edit draft loaded'));
  }, [roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, tt]);

  const prepareMergeDraft = useCallback(async (cardIds?: string[], proposalIds?: string[]) => {
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.mergeDraft', { cardIds, proposalIds });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      const draft = isRecord(unwrapped.data.draft) ? unwrapped.data.draft : undefined;
      if (draft) setMemoryDraft(draftFromProposal(draft, selectedRole));
      setMemoryPreview(null);
      setMemoryDetailOpen(false);
      toast.message(tt('roles.memoryMergeDraftReady', 'Merge draft loaded'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, tt]);

  const simulateRoleMemoryInjection = useCallback(async () => {
    if (!selectedRole) return;
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryLoading(true);
    try {
      const result = await hostApi.gateway.rpc('memory.simulateInjection', { roleName: selectedRole, task });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      setMemorySimulation(unwrapped.data as MemorySimulationView);
      toast.success(tt('roles.memorySimulationReady', 'Injection simulation updated'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryLoading(false);
    }
  }, [roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, task, tt]);

  const submitMemoryFeedback = useCallback(async (
    cardId: string,
    outcome: 'helpful' | 'neutral' | 'harmful' | 'missing_needed' | 'user_corrected',
    injectionId?: string,
  ) => {
    if (!selectedRole) return;
    if (roleMemoryDisabled) {
      showRoleMemoryDisabledToast();
      return;
    }
    setMemoryFeedbackLoading(`${injectionId ?? 'card'}:${cardId}:${outcome}`);
    try {
      const result = await hostApi.gateway.rpc('memory.feedback', {
        roleName: selectedRole,
        cardId,
        injectionId,
        outcome,
        taskSuccess: 'unknown',
      });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      toast.success(tt('roles.memoryFeedbackSaved', 'Memory feedback recorded'));
      await loadRoleMemory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryFeedbackLoading(null);
    }
  }, [loadRoleMemory, roleMemoryDisabled, selectedRole, showRoleMemoryDisabledToast, tt]);

  const openMemoryDetail = useCallback(async (id: string, kind: 'card' | 'proposal' | 'conflict' | 'injection' = 'card') => {
    setMemoryDetailOpen(true);
    setMemoryDetailLoading(true);
    try {
      // Migrated: memory.detail uses typed facade (throws on error, caught by try/catch).
      // conflictDetail stays on gateway.rpc (blocked method).
      const detailResult = await hostApi.memory.detail({ id, kind });
      const nextDetail = detailResult as unknown as MemoryDetailView;
      if (kind === 'conflict') {
        const conflictResult = await hostApi.gateway.rpc('memory.conflictDetail', { id });
        const conflictUnwrapped = unwrapRpc(conflictResult);
        if (conflictUnwrapped.ok) {
          nextDetail.conflictDetail = conflictUnwrapped.data as MemoryConflictDetailView;
        }
      }
      setMemoryDetail(nextDetail);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMemoryDetailLoading(false);
    }
  }, []);

  // Subscribe to subagent lifecycle events for real-time orchestration progress.
  // Events arrive via the gateway broadcast -> main relay -> host
  useEffect(() => {
    if (typeof hostEvents.onSubagentLifecycle !== 'function') {
      return;
    }
    const unsubscribe = hostEvents.onSubagentLifecycle((event) => {
      const roleName = event.roleName;
      if (!roleName) return;
      const eventKey = subagentLifecycleIdentityKey(event);
      setLifecycleEvents((prev) => ({
        ...prev,
        [eventKey]: {
          phase: event.status as LifecyclePhase,
          ts: event.ts ?? Date.now(),
          roleName,
          agentId: event.agentId,
          taskNodeId: event.taskNodeId,
          error: event.error,
          task: event.task,
        },
      }));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof hostEvents.onTaskLoopLifecycle !== 'function') {
      return;
    }
    const unsubscribe = hostEvents.onTaskLoopLifecycle((event) => {
      setTaskLoopEvents((prev) => ({
        ...prev,
        [event.loopRunId]: event,
      }));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof hostEvents.onMissionControlLifecycle !== 'function') {
      return;
    }
    const unsubscribe = hostEvents.onMissionControlLifecycle((event) => {
      setMissionEvents((prev) => ({
        ...prev,
        [`${event.missionId}:${event.tick}:${event.phase}:${event.status}:${event.ts}`]: event,
      }));
      setMissionResult((prev) => {
        if (prev && prev.missionId !== event.missionId) return prev;
        return {
          missionId: event.missionId,
          status: event.status,
          phase: event.phase,
          tick: event.tick,
          reviewerDecision: event.reviewerDecision,
          nextWakeAt: event.nextWakeAt,
          blockedReason: event.blockedReason,
          traceId: event.traceId,
          taskLoopRunId: event.taskLoopRunId,
        };
      });
    });
    return unsubscribe;
  }, []);

  const runPlan = useCallback(async () => {
    if (!task.trim()) {
      toast.error(tt('roles.taskRequired', 'Enter a task description first'));
      return;
    }
    setPlanning(true);
    setPlan(null);
    setPlanEditDraft(null);
    setPlanEditing(false);
    try {
      const result = await hostApi.gateway.rpc('orchestrator.plan', {
        task: task.trim(),
        agentId: anchorAgentId,
        ...(selectedRole ? { leadRole: selectedRole } : {}),
      });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      const nextPlan = isRecord(unwrapped.data.plan) ? (unwrapped.data.plan as unknown as PlanView) : null;
      setPlan(nextPlan);
      const planNodes = nextPlan?.taskGraph?.nodes
        ?.filter((node) => node.taskNodeId && node.roleName && node.task)
        .map((node) => ({
          id: String(node.taskNodeId),
          title: `${node.roleName}: ${node.task}`,
          parentId: nextPlan.taskGraph?.graphRunId ?? null,
          metadata: { readonlyProjection: true, source: 'orchestrator.plan' },
        })) ?? [];
      setPlanEditDraft(planNodes.length > 0
        ? createPlanEditDraft({
          baseProjectionId: nextPlan?.taskGraph?.graphRunId ?? `plan:${Date.now()}`,
          nodes: planNodes,
        })
        : null);
      if (nextPlan) {
        const events = buildOrchestrationPlanLedgerEvents({
          task: task.trim(),
          plan: nextPlan,
          sessionKey: anchorSession || null,
        });
        if (events.length > 0) {
          try {
            await hostApi.taskLedger.appendEvents({
              workspaceId: activeWorkspaceId,
              events,
              idempotencyKey: events[0].idempotencyKey,
            });
          } catch {
            // Task Ledger projection is best-effort; planning should remain usable.
          }
        }
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPlanning(false);
    }
  }, [activeWorkspaceId, anchorAgentId, anchorSession, task, selectedRole, tt]);

  const updatePlanEditDraft = useCallback((operation: Parameters<typeof applyPlanEditOperation>[1]) => {
    setPlanEditDraft((current) => current ? applyPlanEditOperation(current, operation) : current);
  }, []);

  const resetPlanEditDraft = useCallback(() => {
    if (!plan?.taskGraph?.nodes?.length) {
      setPlanEditDraft(null);
      setPlanEditing(false);
      return;
    }
    const planNodes = plan.taskGraph.nodes
      .filter((node) => node.taskNodeId && node.roleName && node.task)
      .map((node) => ({
        id: String(node.taskNodeId),
        title: `${node.roleName}: ${node.task}`,
        parentId: plan.taskGraph?.graphRunId ?? null,
        metadata: { readonlyProjection: true, source: 'orchestrator.plan' },
      }));
    setPlanEditDraft(planNodes.length > 0
      ? createPlanEditDraft({
        baseProjectionId: plan.taskGraph?.graphRunId ?? `plan:${Date.now()}`,
        nodes: planNodes,
      })
      : null);
    setPlanEditing(false);
  }, [plan]);

  const savePlanEdits = useCallback(async () => {
    if (!planEditDraft) return;
    const events = buildPlanEditLedgerEvents({
      draft: planEditDraft,
      workspaceId: activeWorkspaceId,
      sessionKey: anchorSession || null,
      auditReason: 'User saved plan edit',
    });
    if (events.length === 0) {
      setPlanEditing(false);
      return;
    }
    await hostApi.taskLedger.appendEvents({
      workspaceId: activeWorkspaceId,
      events,
      idempotencyKey: events[0].idempotencyKey,
    });
    setPlanEditing(false);
    toast.success(tt('roles.planEdit.saved', 'Plan edits saved'));
  }, [activeWorkspaceId, anchorSession, planEditDraft, tt]);

  const executeRun = useCallback(
    async (approvalId?: string) => {
      const result = await hostApi.gateway.rpc(
        'orchestrator.run',
        {
          task: task.trim(),
          sessionKey: anchorSession,
          agentId: anchorAgentId,
          ...(selectedRole ? { leadRole: selectedRole } : {}),
        },
        undefined,
        approvalId,
      );
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        if (unwrapped.approval) {
          setPendingApproval(unwrapped.approval);
        } else {
          toast.error(unwrapped.message);
        }
        return false;
      }
      const ids = Array.isArray(unwrapped.data.spawnedRunIds) ? (unwrapped.data.spawnedRunIds as string[]) : [];
      const failures = Array.isArray(unwrapped.data.failures)
        ? (unwrapped.data.failures as Array<{ roleName: string; error?: string }>)
        : [];
      setRunResult(ids.length > 0 ? { kind: 'success', spawnedRunIds: ids } : { kind: 'failure', failures });
      setSynthesis(isRecord(unwrapped.data.synthesis) ? (unwrapped.data.synthesis as OrchestrationSynthesisView) : null);
      toast.success(tt('roles.runStarted', 'Orchestration started: {{count}} subagents', { count: ids.length }));
      setPendingApproval(null);
      return true;
    },
    [task, anchorSession, anchorAgentId, selectedRole, tt],
  );

  const runOrchestration = useCallback(async () => {
    if (!task.trim()) {
      toast.error(tt('roles.taskRequired', 'Enter a task description first'));
      return;
    }
    if (!anchorSession) {
      toast.error(tt('roles.noSession', 'No session available for orchestration. Create or select an Agent first.'));
      return;
    }
    setPendingApproval(null);
    setRunResult(null);
    setSynthesis(null);
    setLifecycleEvents({});
    setRunning(true);
    try {
      await executeRun();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRunning(false);
    }
  }, [task, anchorSession, tt, executeRun]);

  const runTaskLoop = useCallback(async () => {
    if (!task.trim()) {
      toast.error(tt('roles.taskRequired', 'Enter a task description first'));
      return;
    }
    if (!anchorSession) {
      toast.error(tt('roles.noSession', 'No session available for orchestration. Create or select an Agent first.'));
      return;
    }
    setTaskLoopRunning(true);
    setTaskLoopResult(null);
    try {
      const result = await hostApi.gateway.rpc('task_loop.run', {
        task: task.trim(),
        sessionKey: anchorSession,
        agentId: anchorAgentId,
        ...(selectedRole ? { leadRole: selectedRole } : {}),
      });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      const loop = isRecord(unwrapped.data.loop) ? unwrapped.data.loop : {};
      const loopEvidenceGate = isRecord(loop.evidenceGate) ? loop.evidenceGate : null;
      const loopRoleQualitySummary = isRecord(loop.roleQualitySummary) ? loop.roleQualitySummary : null;
      const evidenceGate = loopEvidenceGate
        ? {
            status: typeof loopEvidenceGate.status === 'string'
              ? (loopEvidenceGate.status as NonNullable<TaskLoopLifecycleEvent['evidenceGate']>['status'])
              : 'blocked',
            reasons: Array.isArray(loopEvidenceGate.reasons)
              ? loopEvidenceGate.reasons.filter((item): item is string => typeof item === 'string')
              : [],
            workerCount: typeof loopEvidenceGate.workerCount === 'number'
              ? loopEvidenceGate.workerCount
              : Array.isArray(loop.subagentEvidence)
                ? loop.subagentEvidence.length
                : 0,
            failedWorkerCount: typeof loopEvidenceGate.failedWorkerCount === 'number' ? loopEvidenceGate.failedWorkerCount : 0,
            unverifiableWorkerCount: typeof loopEvidenceGate.unverifiableWorkerCount === 'number' ? loopEvidenceGate.unverifiableWorkerCount : 0,
          }
        : undefined;
      const roleQualitySummary = loopRoleQualitySummary
        ? {
            good: typeof loopRoleQualitySummary.good === 'number' ? loopRoleQualitySummary.good : 0,
            needsAttention: typeof loopRoleQualitySummary.needsAttention === 'number' ? loopRoleQualitySummary.needsAttention : 0,
            poorAttempt: typeof loopRoleQualitySummary.poorAttempt === 'number' ? loopRoleQualitySummary.poorAttempt : 0,
          }
        : undefined;
      const next = {
        loopRunId: String(loop.loopRunId ?? ''),
        status: String(loop.status ?? ''),
        phase: String(loop.phase ?? ''),
        traceId: typeof loop.traceId === 'string' ? loop.traceId : undefined,
        evidenceGate,
        roleQualitySummary,
        filesTouched: Array.isArray(loopEvidenceGate?.filesTouched)
          ? loopEvidenceGate.filesTouched.filter((item): item is string => typeof item === 'string')
          : [],
        testsRun: Array.isArray(loopEvidenceGate?.testsRun)
          ? loopEvidenceGate.testsRun.filter((item): item is string => typeof item === 'string')
          : [],
        blockedReason: typeof loop.finalSummary === 'string' && loop.status === 'blocked' ? loop.finalSummary : undefined,
      };
      setTaskLoopResult(next);
      toast.success(tt('roles.taskLoopStarted', 'Task loop finished: {{status}}', { status: next.status || 'unknown' }));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setTaskLoopRunning(false);
    }
  }, [anchorAgentId, anchorSession, selectedRole, task, tt]);

  const runMissionLoop = useCallback(async () => {
    if (!task.trim() && !missionResult?.missionId) {
      toast.error(tt('roles.taskRequired', 'Enter a task description first'));
      return;
    }
    if (!anchorSession && !missionResult?.missionId) {
      toast.error(tt('roles.noSession', 'No session available for orchestration. Create or select an Agent first.'));
      return;
    }
    setMissionRunning(true);
    try {
      const result = await hostApi.gateway.rpc('mission.run', {
        ...(missionResult?.missionId ? { missionId: missionResult.missionId } : {}),
        ...(task.trim() ? { objective: task.trim() } : {}),
        sessionKey: anchorSession,
        agentId: anchorAgentId,
        ...(selectedRole ? { leadRole: selectedRole } : {}),
      });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      const next = readMissionPanelResult(unwrapped.data.mission);
      setMissionResult(next);
      toast.success(tt('roles.missionStarted', 'Mission {{status}} at tick {{tick}}', {
        status: next.status || 'unknown',
        tick: next.tick,
      }));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMissionRunning(false);
    }
  }, [anchorAgentId, anchorSession, missionResult?.missionId, selectedRole, task, tt]);

  const controlMission = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    const missionId = missionResult?.missionId;
    if (!missionId) return;
    setMissionRunning(true);
    try {
      const result = await hostApi.gateway.rpc(`mission.${action}`, { missionId });
      const unwrapped = unwrapRpc(result);
      if (!unwrapped.ok) {
        toast.error(unwrapped.message);
        return;
      }
      const next = readMissionPanelResult(unwrapped.data.mission);
      setMissionResult(next);
      toast.success(tt('roles.missionUpdated', 'Mission {{status}}', { status: next.status || 'unknown' }));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setMissionRunning(false);
    }
  }, [missionResult?.missionId, tt]);

  const approveRun = useCallback(async () => {
    if (!pendingApproval) return;
    setRunning(true);
    try {
      const decision = await hostApi.permissions.decideApproval({
        id: pendingApproval.id,
        decision: 'approved',
      });
      if (!decision.success) {
        toast.error(decision.error || tt('roles.approveFailed', 'Approval failed'));
        return;
      }
      await executeRun(pendingApproval.id);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRunning(false);
    }
  }, [pendingApproval, tt, executeRun]);

  const dismissApproval = useCallback(() => setPendingApproval(null), []);

  return (
    <Card className="mt-8 border-border/60">
      <CardHeader
        data-testid="role-orchestration-toggle"
        className="cursor-pointer select-none"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{tt('roles.title', 'Roles & Orchestration')}</CardTitle>
          </div>
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </div>
        <CardDescription>
          {tt('roles.description', 'Role-contract-driven subagent orchestration (role-driven tool allowlist, model, and thinking effort).')}
        </CardDescription>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-6">
          {/* Section A: available roles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <span className="text-sm font-medium">{tt('roles.available', 'Available roles')}</span>
                <p className="text-2xs text-muted-foreground">
                  {tt('roles.configBoundaryHint', 'Built-in roles are read-only; custom roles are saved to OpenClaw config.')}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedRoleConfig && (
                  <Button
                    data-testid="role-config-edit-selected"
                    variant="outline"
                    size="sm"
                    onClick={startEditConfigRole}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    {tt('roles.configEdit', 'Edit')}
                  </Button>
                )}
                <Button
                  data-testid="role-config-create"
                  variant="outline"
                  size="sm"
                  onClick={startCreateConfigRole}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {tt('roles.configCreate', 'New role')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void loadRoles()} disabled={loading}>
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
              </div>
            </div>
            {roleConfigPendingName && (
              <div
                data-testid="role-config-pending-runtime"
                className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
              >
                {tt('roles.configPendingRuntime', 'Saved to config. It will be available after the runtime refreshes.')}
              </div>
            )}
            {roleConfigMode && (
              <div className="rounded-md border border-border/60 bg-surface-input p-3" data-testid="role-config-form">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {roleConfigMode === 'edit'
                        ? tt('roles.configEditTitle', 'Edit config role')
                        : tt('roles.configCreateTitle', 'Create config role')}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {tt('roles.configFormHint', 'This saves a config role only. Runtime availability depends on the next role refresh.')}
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-full text-2xs">
                    {tt('roles.originCustom', 'Custom')}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                    {tt('roles.configName', 'Name')}
                    <Input
                      data-testid="role-config-name"
                      value={roleConfigDraft.name}
                      onChange={(event) => updateRoleConfigDraft({ name: event.target.value })}
                      disabled={roleConfigMode === 'edit'}
                      placeholder="qa-helper"
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                    {tt('roles.configDisplayName', 'Display name')}
                    <Input
                      data-testid="role-config-display-name"
                      value={roleConfigDraft.displayName}
                      onChange={(event) => updateRoleConfigDraft({ displayName: event.target.value })}
                      placeholder={tt('roles.configDisplayNamePlaceholder', 'QA Helper')}
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground md:col-span-2">
                    {tt('roles.configDescription', 'Description')}
                    <Input
                      data-testid="role-config-description"
                      value={roleConfigDraft.description}
                      onChange={(event) => updateRoleConfigDraft({ description: event.target.value })}
                      placeholder={tt('roles.configDescriptionPlaceholder', 'Short role catalog description')}
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground md:col-span-2">
                    {tt('roles.configRolePrompt', 'Role prompt')}
                    <Textarea
                      data-testid="role-config-prompt"
                      value={roleConfigDraft.rolePrompt}
                      onChange={(event) => updateRoleConfigDraft({ rolePrompt: event.target.value })}
                      placeholder={tt('roles.configPromptPlaceholder', 'Describe the role boundary and expected behavior')}
                      className="min-h-[84px] text-xs"
                    />
                  </label>
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                    {tt('roles.configTools', 'Tools')}
                    <Input
                      data-testid="role-config-tools"
                      value={roleConfigDraft.tools}
                      onChange={(event) => updateRoleConfigDraft({ tools: event.target.value })}
                      placeholder="read, shell"
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                    {tt('roles.configTags', 'Tags')}
                    <Input
                      data-testid="role-config-tags"
                      value={roleConfigDraft.tags}
                      onChange={(event) => updateRoleConfigDraft({ tags: event.target.value })}
                      placeholder="qa, docs"
                      className="h-8 text-xs"
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-3 md:col-span-2">
                    <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                      {tt('roles.configEffort', 'Effort')}
                      <Select value={roleConfigDraft.effort} onValueChange={(value) => updateRoleConfigDraft({ effort: value as RoleConfigEffort })}>
                        <SelectTrigger size="sm" data-testid="role-config-effort"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">low</SelectItem>
                          <SelectItem value="medium">medium</SelectItem>
                          <SelectItem value="high">high</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                      {tt('roles.configFilesystem', 'Filesystem')}
                      <Select value={roleConfigDraft.filesystem} onValueChange={(value) => updateRoleConfigDraft({ filesystem: value as RoleConfigDraftState['filesystem'] })}>
                        <SelectTrigger size="sm" data-testid="role-config-filesystem"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">none</SelectItem>
                          <SelectItem value="read">read</SelectItem>
                          <SelectItem value="write">write</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="space-y-1 text-2xs font-medium text-muted-foreground">
                      {tt('roles.configNetwork', 'Network')}
                      <Select value={roleConfigDraft.network} onValueChange={(value) => updateRoleConfigDraft({ network: value as RoleConfigDraftState['network'] })}>
                        <SelectTrigger size="sm" data-testid="role-config-network"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">none</SelectItem>
                          <SelectItem value="limited">limited</SelectItem>
                          <SelectItem value="full">full</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <label className="space-y-1 text-2xs font-medium text-muted-foreground md:col-span-2">
                    {tt('roles.configCommands', 'Commands')}
                    <Input
                      data-testid="role-config-commands"
                      value={roleConfigDraft.commands}
                      onChange={(event) => updateRoleConfigDraft({ commands: event.target.value })}
                      placeholder="pnpm, git"
                      className="h-8 text-xs"
                    />
                  </label>
                </div>
                {!roleConfigNameValid && roleConfigDraft.name.trim() && (
                  <p className="mt-2 text-2xs text-amber-700 dark:text-amber-400">
                    {tt('roles.configNamePattern', 'Use lowercase letters, numbers, and hyphens; start with a letter.')}
                  </p>
                )}
                {roleConfigError && (
                  <p className="mt-2 text-2xs text-red-700 dark:text-red-400">{roleConfigError}</p>
                )}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={cancelRoleConfigEdit}>
                    {tt('roles.cancel', 'Cancel')}
                  </Button>
                  <Button
                    data-testid="role-config-save"
                    size="sm"
                    onClick={() => void saveRoleConfig()}
                    disabled={!roleConfigCanSave}
                  >
                    {roleConfigSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    {tt('roles.configSave', 'Save role')}
                  </Button>
                </div>
              </div>
            )}
            {loading && roles.length === 0 ? (
              <div className="flex justify-center py-4"><LoadingSpinner /></div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {roles.map((role) => (
                  <RoleCard
                    key={role.name}
                    role={role}
                    selected={selectedRole === role.name}
                    onSelect={() => setSelectedRole((prev) => (prev === role.name ? null : role.name))}
                    tt={tt}
                  />
                ))}
              </div>
            )}
          </div>

          <AgencyRolePromotionPanel
            onRoleMaterialized={() => void loadRoles()}
            roleMemoryEnabled={roleMemoryEnabled}
            onMemoryProposed={() => void loadRoleMemory()}
          />

          {showMemoryPanel && (
          <TooltipProvider>
            <div className="space-y-4 border-t border-border/60 pt-4" data-testid="role-memory-panel" data-surface-id="agents.memory">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{tt('roles.memoryTitle', 'Role Memory')}</span>
                    {selectedRole && <Badge variant="secondary" className="rounded-full">{selectedRole}</Badge>}
                    {roleMemoryDisabled && (
                      <Badge variant="outline" className="rounded-full border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400">
                        {tt('roles.memoryDisabledBadge', 'Disabled')}
                      </Badge>
                    )}
                    {memoryConflicts > 0 && (
                      <Badge variant="outline" className="rounded-full border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {tt('roles.memoryConflictCount', '{{count}} conflicts', { count: memoryConflicts })}
                      </Badge>
                    )}
                    {retentionMemoryCount > 0 && (
                      <Badge variant="outline" className="rounded-full border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400">
                        <History className="mr-1 h-3 w-3" />
                        {tt('roles.memoryRetentionCount', '{{count}} suggestions', { count: retentionMemoryCount })}
                      </Badge>
                    )}
                    {healthWarningCount > 0 && (
                      <Badge variant="outline" className="rounded-full border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        <ShieldAlert className="mr-1 h-3 w-3" />
                        {tt('roles.memoryHealthWarnings', '{{count}} health warnings', { count: healthWarningCount })}
                      </Badge>
                    )}
                  </div>
                  <p className="max-w-2xl text-xs text-muted-foreground">
                    {tt('roles.memoryGovernanceHint', 'Review what this role will remember, why changes are blocked, and what context was injected into recent runs.')}
                  </p>
                  <p className="max-w-2xl text-xs text-muted-foreground" data-testid="memory-model-visibility">
                    {tt('roles.memoryModelVisibility', 'Model visibility: accepted memory only. Candidates remain review-only and are neither retrievable nor injectable until approved.')}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1" data-testid="memory-surface-semantics">
                    <Badge variant="outline" className="rounded-full text-2xs">
                      {roleMemoryDisabled ? tt('roles.memoryMasterOff', 'Master: off') : tt('roles.memoryMasterOn', 'Master: on')}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-2xs">
                      {tt('roles.memoryReadGate', 'Read: accepted only')}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-2xs">
                      {tt('roles.memoryWriteGate', 'Write: candidate then review')}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-2xs">
                      {tt('roles.memoryDeleteGate', 'Delete: tombstone')}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-2xs">
                      {tt('roles.memoryLegacyGate', 'Legacy: native unchanged')}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="memory-export"
                    disabled={!selectedRole || memoryLoading || roleMemoryDisabled || memoryExporting}
                    onClick={exportRoleMemory}
                  >
                    <Download className={cn('mr-1.5 h-3.5 w-3.5', memoryExporting && 'animate-pulse')} />
                    {tt('roles.memoryExport', 'Export')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void loadRoleMemory()} disabled={!selectedRole || memoryLoading || roleMemoryDisabled}>
                    <RefreshCw className={cn('h-4 w-4', memoryLoading && 'animate-spin')} />
                  </Button>
                </div>
              </div>

              {roleMemoryDisabled && (
                <div className="rounded-md border border-zinc-500/20 bg-zinc-500/10 px-3 py-2.5" data-testid="memory-disabled-semantics">
                  <p className="text-xs text-muted-foreground">
                    {tt('roles.memoryLegacyFallback', 'Memory is off: managed cards are retained on disk but are not read, written, or injected. Native OpenClaw memory remains separate and unchanged.')}
                  </p>
                </div>
              )}

              {!roleMemoryDisabled && (
                <div className="rounded-md border border-border/60 bg-surface-input p-3" data-testid="memory-runtime-candidates">
                  <ProposeFactsConfirmQueue />
                </div>
              )}

              {!selectedRole ? (
                <div className="flex items-center gap-3 rounded-md border border-dashed border-border/70 bg-surface-input px-3 py-4">
                  <CircleDot className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{tt('roles.memorySelectRole', 'Select a role to manage its active memory.')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {roleMemoryDisabled && (
                    <div
                      className="rounded-md border border-zinc-500/20 bg-zinc-500/10 px-3 py-3"
                      data-testid="role-memory-disabled-banner"
                    >
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="mt-0.5 h-4 w-4 text-zinc-700 dark:text-zinc-400" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground">{tt('roles.memoryDisabledTitle', 'Role Memory is off')}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tt('roles.memoryDisabledDescription', 'Existing role memories stay on disk, but they are not injected into role runs and memory changes are blocked until you enable Role Memory in Settings.')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    {[
                      { icon: Layers3, label: tt('roles.memoryMetricActive', 'Usable'), value: activeMemoryCount, tone: 'text-emerald-700 dark:text-emerald-400' },
                      { icon: Clock3, label: tt('roles.memoryMetricReview', 'Review'), value: reviewMemoryCount, tone: 'text-amber-700 dark:text-amber-400' },
                      { icon: GitMerge, label: tt('roles.memoryMetricConflicts', 'Conflicts'), value: conflictMemoryCount, tone: 'text-red-700 dark:text-red-400' },
                      { icon: History, label: tt('roles.memoryMetricInjections', 'Runs'), value: memoryInjections.length, tone: 'text-blue-700 dark:text-blue-400' },
                      { icon: BarChart3, label: tt('roles.memoryMetricFeedback', 'Feedback'), value: memoryFeedbackCount, tone: memoryQualityLabel === 'strong' ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-700 dark:text-zinc-400' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-md border border-border/60 bg-surface-input px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <item.icon className={cn('h-4 w-4 shrink-0', item.tone)} />
                          <span className="truncate text-xs text-muted-foreground">{item.label}</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border border-border/60 bg-surface-input p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="text-xs font-medium">
                          {memoryDraftTarget
                            ? tt('roles.memoryComposerEditTitle', 'Memory proposal draft')
                            : tt('roles.memoryComposerTitle', 'New memory proposal')}
                        </span>
                      </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground" data-testid="role-memory-composer-info" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          {tt('roles.memoryComposerHint', 'Low-risk proposals may be accepted by policy; conflicts and sensitive changes wait for review.')}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {memoryDraftTarget && (
                      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-2">
                        <span className="text-2xs text-blue-700 dark:text-blue-400">
                          {memoryDraftTarget.mode === 'supersede'
                            ? tt('roles.memorySupersedeDraft', 'Supersede proposal draft')
                            : tt('roles.memoryEditDraft', 'Edit proposal draft')}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-2xs"
                          onClick={() => {
                            setMemoryDraftTarget(null);
                            setMemoryDraft(defaultMemoryDraft(selectedRole));
                            setMemoryPreview(null);
                          }}
                        >
                          {tt('roles.memoryCancelDraft', 'Cancel draft')}
                        </Button>
                      </div>
                    )}
                    <div className="grid gap-2 lg:grid-cols-[1fr_220px]">
                      <Textarea
                        data-testid="role-memory-input"
                        value={memoryDraft.content}
                        onChange={(event) => updateMemoryDraft({ content: event.target.value })}
                        placeholder={tt('roles.memoryPlaceholder', 'Add a role-specific memory for future runs')}
                        disabled={roleMemoryDisabled}
                        className="min-h-[116px] resize-none bg-background text-sm"
                      />
                      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
                        <div className="space-y-1.5">
                          <span className="text-2xs font-medium text-muted-foreground">{tt('roles.memoryType', 'Type')}</span>
                          <Select value={memoryDraft.type} onValueChange={(value) => updateMemoryDraft({ type: value })} disabled={roleMemoryDisabled}>
                            <SelectTrigger size="sm" data-testid="role-memory-type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {MEMORY_TYPE_OPTIONS.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <span className="text-2xs font-medium text-muted-foreground">{tt('roles.memoryScope', 'Scope')}</span>
                          <Select value={memoryDraft.scope} onValueChange={(value) => updateMemoryDraft({ scope: value })} disabled={roleMemoryDisabled}>
                            <SelectTrigger size="sm" data-testid="role-memory-scope"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {MEMORY_SCOPE_OPTIONS.map((scope) => <SelectItem key={scope} value={scope}>{scope}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <span className="text-2xs font-medium text-muted-foreground">{tt('roles.memorySensitivity', 'Sensitivity')}</span>
                          <Select value={memoryDraft.sensitivity} onValueChange={(value) => updateMemoryDraft({ sensitivity: value })} disabled={roleMemoryDisabled}>
                            <SelectTrigger size="sm" data-testid="role-memory-sensitivity"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {MEMORY_SENSITIVITY_OPTIONS.map((sensitivity) => <SelectItem key={sensitivity} value={sensitivity}>{sensitivity}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                        <div className="flex items-center justify-between text-2xs text-muted-foreground">
                          <span>{tt('roles.memoryConfidence', 'Confidence')}</span>
                          <span>{scoreToPercent(memoryDraft.confidence)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={memoryDraft.confidence}
                          onChange={(event) => updateMemoryDraft({ confidence: Number(event.target.value) })}
                          disabled={roleMemoryDisabled}
                          className="mt-2 h-1.5 w-full accent-primary"
                        />
                      </div>
                      <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                        <div className="flex items-center justify-between text-2xs text-muted-foreground">
                          <span>{tt('roles.memoryImportance', 'Importance')}</span>
                          <span>{scoreToPercent(memoryDraft.importance)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={memoryDraft.importance}
                          onChange={(event) => updateMemoryDraft({ importance: Number(event.target.value) })}
                          disabled={roleMemoryDisabled}
                          className="mt-2 h-1.5 w-full accent-primary"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-2xs"
                        onClick={() => setMemoryAdvancedOpen((prev) => !prev)}
                      >
                        <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                        {memoryAdvancedOpen ? tt('roles.memoryHideAdvanced', 'Hide governance fields') : tt('roles.memoryShowAdvanced', 'Governance fields')}
                      </Button>
                      {memoryAdvancedOpen && (
                        <div className="mt-2 grid gap-2 rounded-md border border-border/60 bg-background/70 p-2.5 md:grid-cols-2">
                          <Input value={memoryDraft.ownerRole} onChange={(event) => updateMemoryDraft({ ownerRole: event.target.value })} placeholder={tt('roles.memoryOwnerRole', 'Owner')} className="h-8 text-xs" />
                          <Input value={memoryDraft.sourceRole} onChange={(event) => updateMemoryDraft({ sourceRole: event.target.value })} placeholder={tt('roles.memorySourceRole', 'Source role')} className="h-8 text-xs" />
                          <Input value={memoryDraft.applicableRoles} onChange={(event) => updateMemoryDraft({ applicableRoles: event.target.value })} placeholder={tt('roles.memoryApplicableRoles', 'Applies to')} className="h-8 text-xs" />
                          <Input value={memoryDraft.allowedMutators} onChange={(event) => updateMemoryDraft({ allowedMutators: event.target.value })} placeholder={tt('roles.memoryAllowedMutators', 'Can propose changes')} className="h-8 text-xs" />
                          <Input value={memoryDraft.phaseTags} onChange={(event) => updateMemoryDraft({ phaseTags: event.target.value })} placeholder={tt('roles.memoryPhaseTags', 'Phases, comma separated')} className="h-8 text-xs" />
                          <Input type="date" value={memoryDraft.expiresAt} onChange={(event) => updateMemoryDraft({ expiresAt: event.target.value })} className="h-8 text-xs" />
                          <Input value={memoryDraft.evidenceRef} onChange={(event) => updateMemoryDraft({ evidenceRef: event.target.value })} placeholder={tt('roles.memoryEvidenceRef', 'Evidence reference')} className="h-8 text-xs md:col-span-2" />
                          <Textarea value={memoryDraft.evidenceExcerpt} onChange={(event) => updateMemoryDraft({ evidenceExcerpt: event.target.value })} placeholder={tt('roles.memoryEvidenceExcerpt', 'Evidence excerpt')} className="min-h-[58px] resize-none text-xs md:col-span-2" />
                        </div>
                      )}
                    </div>
                    {memoryPreview && (
                      <div data-testid="role-memory-preview" className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn('rounded-full text-2xs', memoryPreview.decision?.accepted ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400')}>
                            {memoryPreview.decision?.action ?? tt('roles.memoryPreviewUnknown', 'preview')}
                          </Badge>
                          {memoryPreview.riskLevel && <Badge variant="outline" className="rounded-full text-2xs">{memoryPreview.riskLevel}</Badge>}
                          {memoryPreview.impactScope && <Badge variant="outline" className="rounded-full text-2xs">{memoryPreview.impactScope}</Badge>}
                          {memoryPreview.permissionDecision && <Badge variant="secondary" className="rounded-full text-2xs">{memoryPreview.permissionDecision}</Badge>}
                          {memoryPreview.evidence?.status && <Badge variant="outline" className="rounded-full text-2xs">{memoryPreview.evidence.status}</Badge>}
                          <Badge variant="outline" className="rounded-full text-2xs">{tt('roles.memoryPreviewReadOnly', 'read-only')}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-foreground">{memoryPreview.reasonSummary || memoryPreview.decision?.reason || tt('roles.memoryNoReason', 'No reason provided')}</p>
                        {memoryPreview.permissionReason && <p className="mt-1 text-2xs text-muted-foreground">{memoryPreview.permissionReason}</p>}
                        {memoryPreview.conflicts?.length ? (
                          <p className="mt-1 text-2xs text-amber-700 dark:text-amber-400">{tt('roles.memoryPreviewConflicts', '{{count}} possible conflicts', { count: memoryPreview.conflicts.length })}</p>
                        ) : null}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={roleMemoryDisabled || !memoryDraft.content.trim() || memoryPreviewLoading}
                        onClick={() => void previewRoleMemory()}
                        data-testid="role-memory-preview-button"
                      >
                        {memoryPreviewLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                        {tt('roles.memoryPreviewImpact', 'Preview impact')}
                      </Button>
                      <Button
                        data-testid="role-memory-save"
                        data-action={memoryDraftTarget ? 'proposal' : 'remember'}
                        className="h-8"
                        disabled={roleMemoryDisabled || !memoryDraft.content.trim() || memoryLoading}
                        onClick={() => void proposeRoleMemory()}
                      >
                        <Check className="mr-1 h-4 w-4" />
                        {memoryDraftTarget ? tt('roles.memorySubmitProposal', 'Submit proposal') : tt('roles.memorySave', 'Save')}
                      </Button>
                    </div>
                  </div>

                  {memoryRetention.length > 0 && (
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <History className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                        <span className="text-xs font-medium">{tt('roles.memoryRetentionTitle', 'Lifecycle suggestions')}</span>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {memoryRetention.slice(0, 4).map((candidate) => (
                          <div
                            key={candidate.card.id}
                            className="rounded-md bg-background/70 px-2.5 py-2"
                          >
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => void openMemoryDetail(candidate.card.id, 'card')}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant="outline" className="rounded-full text-2xs">{candidate.recommendedAction}</Badge>
                                <span className="text-2xs text-muted-foreground">{Math.round(candidate.retentionScore * 100)}%</span>
                              </div>
                              <p className="mt-1 line-clamp-1 text-xs text-foreground">{candidate.card.content}</p>
                              <p className="mt-1 text-2xs text-muted-foreground">{candidate.reason}</p>
                            </button>
                            <div className="mt-2 flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-2xs"
                                disabled={memoryLoading}
                                onClick={() => void proposeRetention(candidate.card.id, candidate.recommendedAction)}
                              >
                                <Clock3 className="mr-1 h-3 w-3" />
                                {tt('roles.memoryCreateProposal', 'Create proposal')}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Tabs defaultValue="active" className="space-y-3">
                    <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-surface-input p-1 md:grid-cols-5">
                      <TabsTrigger value="active" className="gap-1.5 text-xs">
                        <Layers3 className="h-3.5 w-3.5" />
                        {tt('roles.memoryTabActive', 'Active')}
                      </TabsTrigger>
                      <TabsTrigger value="review" className="gap-1.5 text-xs" data-testid="role-memory-review-tab">
                        <Clock3 className="h-3.5 w-3.5" />
                        {tt('roles.memoryTabReview', 'Review')} {reviewMemoryProposals.length ? `(${reviewMemoryProposals.length})` : ''}
                      </TabsTrigger>
                      <TabsTrigger value="conflicts" className="gap-1.5 text-xs">
                        <GitMerge className="h-3.5 w-3.5" />
                        {tt('roles.memoryTabConflicts', 'Conflicts')} {memoryConflicts ? `(${memoryConflicts})` : ''}
                      </TabsTrigger>
                      <TabsTrigger value="injections" className="gap-1.5 text-xs">
                        <Sparkles className="h-3.5 w-3.5" />
                        {tt('roles.memoryTabInjections', 'Injections')}
                      </TabsTrigger>
                      <TabsTrigger value="quality" className="gap-1.5 text-xs">
                        <BarChart3 className="h-3.5 w-3.5" />
                        {tt('roles.memoryTabQuality', 'Quality')}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="active" className="space-y-2">
                      {activeMemoryCards.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/70 bg-surface-input px-3 py-4">
                          <p className="text-xs font-medium text-foreground">{tt('roles.memoryEmptyTitle', 'No usable role memory')}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{tt('roles.memoryEmpty', 'No active memory for this role yet.')}</p>
                        </div>
                      ) : activeMemoryCards.slice(0, 8).map((card) => (
                        <div
                          key={card.id}
                          className="cursor-pointer rounded-md border border-l-2 border-border/60 border-l-emerald-500/60 bg-surface-input px-3 py-3 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                          data-testid="role-memory-card"
                          onClick={() => void openMemoryDetail(card.id, 'card')}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className={cn('rounded-full text-2xs', memoryStatusClasses(card.status))}>{card.status}</Badge>
                                <Badge variant="secondary" className="rounded-full text-2xs">{card.type}</Badge>
                                {card.scope && <Badge variant="outline" className="rounded-full text-2xs">{card.scope}</Badge>}
                                {card.sensitivity && (
                                  <Badge variant="outline" className={cn('rounded-full text-2xs', memorySensitivityClasses(card.sensitivity))}>{card.sensitivity}</Badge>
                                )}
                              </div>
                              <p className="line-clamp-3 text-sm leading-5 text-foreground">{card.content}</p>
                              <div className="grid gap-2 md:grid-cols-2">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-2xs text-muted-foreground">
                                    <span>{tt('roles.memoryConfidence', 'Confidence')}</span>
                                    <span>{scoreToPercent(card.confidence)}%</span>
                                  </div>
                                  <Progress value={scoreToPercent(card.confidence)} className="h-1.5 bg-black/10 dark:bg-white/10" />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex justify-between text-2xs text-muted-foreground">
                                    <span>{tt('roles.memoryImportance', 'Importance')}</span>
                                    <span>{scoreToPercent(card.importance)}%</span>
                                  </div>
                                  <Progress value={scoreToPercent(card.importance)} className="h-1.5 bg-black/10 dark:bg-white/10" />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                                {card.evidenceRefs?.length ? <span>{tt('roles.memoryEvidence', '{{count}} evidence refs', { count: card.evidenceRefs.length })}</span> : null}
                                {formatMemoryDate(card.updatedAt) && <span>{formatMemoryDate(card.updatedAt)}</span>}
                              </div>
                            </div>
                            {card.status !== 'archived' && card.status !== 'tombstone' && (
                              <div className="flex shrink-0 items-center gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0"
                                      disabled={roleMemoryDisabled || memoryLoading}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void archiveRoleMemory(card.id);
                                      }}
                                      data-testid="role-memory-archive"
                                    >
                                      <Archive className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tt('roles.memoryArchive', 'Archive')}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                                      disabled={roleMemoryDisabled || memoryLoading}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        requestDeleteRoleMemory(card);
                                      }}
                                      data-testid="role-memory-delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tt('roles.memoryDelete', 'Delete')}</TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </TabsContent>

                    <TabsContent value="review" className="space-y-2">
                      {reviewMemoryProposals.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/70 bg-surface-input px-3 py-4">
                          <p className="text-xs font-medium text-foreground">{tt('roles.memoryReviewEmptyTitle', 'Review queue is clear')}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{tt('roles.memoryReviewEmpty', 'No memory proposals need review.')}</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-surface-input px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                              {tt('roles.memorySelectedCount', '{{count}} selected', { count: selectedReviewIds.length })}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              <Button size="sm" className="h-7 text-2xs" disabled={roleMemoryDisabled || memoryLoading || selectedReviewIds.length === 0} onClick={() => void reviewSelectedRoleMemory('approve')}>
                                {tt('roles.memoryApproveSelected', 'Approve selected')}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-2xs" disabled={roleMemoryDisabled || memoryLoading || selectedReviewIds.length === 0} onClick={() => void reviewSelectedRoleMemory('applyAsCold')}>
                                {tt('roles.memoryColdSelected', 'Cold selected')}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-2xs text-red-700 dark:text-red-400" disabled={roleMemoryDisabled || memoryLoading || selectedReviewIds.length === 0} onClick={() => void reviewSelectedRoleMemory('reject')}>
                                {tt('roles.memoryRejectSelected', 'Reject selected')}
                              </Button>
                            </div>
                          </div>
                          {reviewMemoryProposals.slice(0, 8).map((proposal) => (
                        <div
                          key={proposal.id}
                          className="cursor-pointer rounded-md border border-l-2 border-amber-500/20 border-l-amber-500/70 bg-amber-500/5 px-3 py-3 transition-colors hover:bg-amber-500/10"
                          onClick={() => void openMemoryDetail(proposal.id, 'proposal')}
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5"
                                  checked={selectedReviewIds.includes(proposal.id)}
                                  onChange={(event) => {
                                    event.stopPropagation();
                                    setSelectedReviewIds((prev) => event.target.checked ? [...prev, proposal.id] : prev.filter((id) => id !== proposal.id));
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={tt('roles.memorySelectProposal', 'Select proposal')}
                                />
                                <Badge variant="outline" className="rounded-full border-amber-500/25 bg-amber-500/10 text-2xs text-amber-700 dark:text-amber-400">{proposal.operation}</Badge>
                                <Badge variant="secondary" className="rounded-full text-2xs">{proposal.status}</Badge>
                                {proposal.riskLevel && <Badge variant="outline" className="rounded-full text-2xs">{proposal.riskLevel}</Badge>}
                                {proposal.impactScope && <Badge variant="outline" className="rounded-full text-2xs">{proposal.impactScope}</Badge>}
                                {proposal.evidenceStatus && <Badge variant="outline" className="rounded-full text-2xs">{proposal.evidenceStatus}</Badge>}
                                {proposal.proposal?.sensitivity && (
                                  <Badge variant="outline" className={cn('rounded-full text-2xs', memorySensitivityClasses(proposal.proposal.sensitivity))}>{proposal.proposal.sensitivity}</Badge>
                                )}
                              </div>
                              <p className="line-clamp-3 text-sm leading-5 text-foreground">{proposal.proposal?.content}</p>
                              <div className="grid gap-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-2 text-2xs text-muted-foreground md:grid-cols-3">
                                <div data-testid="role-memory-proposal-source">
                                  <span className="font-medium text-foreground">{tt('roles.memoryProposalSource', 'Source')}</span>
                                  <span className="ml-1">{proposalSourceLabel(proposal)}</span>
                                </div>
                                <div data-testid="role-memory-proposal-confidence">
                                  <span className="font-medium text-foreground">{tt('roles.memoryProposalConfidence', 'Confidence')}</span>
                                  <span className="ml-1">
                                    {proposalConfidenceScore(proposal) === null
                                      ? tt('roles.memoryProposalMetadataMissing', 'metadata missing')
                                      : `${proposalConfidenceScore(proposal)}%`}
                                  </span>
                                </div>
                                <div data-testid="role-memory-proposal-needs-review">
                                  <span className="font-medium text-foreground">{tt('roles.memoryProposalReviewState', 'Review')}</span>
                                  <span className="ml-1">{proposalReviewReason(proposal) || tt('roles.memoryNoReason', 'No reason provided')}</span>
                                </div>
                              </div>
                              <div className="rounded-md bg-background/70 px-2.5 py-2">
                                <p className="text-2xs font-medium text-muted-foreground">{tt('roles.memoryReviewReason', 'Gatekeeper reason')}</p>
                                <p className="mt-1 text-xs text-foreground">{proposal.reasonSummary || proposal.reviewReason || tt('roles.memoryNoReason', 'No reason provided')}</p>
                                {proposal.suggestedAction && (
                                  <p className="mt-1 text-2xs text-muted-foreground">
                                    {tt('roles.memorySuggestedAction', 'Suggested')}: {proposal.suggestedAction}
                                  </p>
                                )}
                              </div>
                              {proposal.conflictIds?.length ? (
                                <p className="text-2xs text-muted-foreground">{tt('roles.memoryConflictRefs', '{{count}} related conflicts', { count: proposal.conflictIds.length })}</p>
                              ) : null}
                              {proposal.retentionReason ? (
                                <p className="text-2xs text-blue-700 dark:text-blue-400">{proposal.retentionReason}</p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-1.5 md:justify-end">
                              <Button size="sm" className="h-8" disabled={roleMemoryDisabled || memoryLoading} onClick={(event) => { event.stopPropagation(); void reviewRoleMemory(proposal.id, 'approve'); }}>
                                <Check className="mr-1 h-3.5 w-3.5" />
                                {tt('roles.memoryApprove', 'Approve')}
                              </Button>
                              <Button size="sm" variant="outline" className="h-8" disabled={roleMemoryDisabled || memoryLoading} onClick={(event) => { event.stopPropagation(); void reviewRoleMemory(proposal.id, 'applyAsCold'); }}>{tt('roles.memoryApplyCold', 'Cold')}</Button>
                              <Button size="sm" variant="ghost" className="h-8 text-red-700 dark:text-red-400" disabled={roleMemoryDisabled || memoryLoading} onClick={(event) => { event.stopPropagation(); void reviewRoleMemory(proposal.id, 'reject'); }}>{tt('roles.memoryReject', 'Reject')}</Button>
                            </div>
                          </div>
                        </div>
                          ))}
                        </>
                      )}
                    </TabsContent>

                    <TabsContent value="conflicts" className="space-y-2">
                      {memoryConflictItems.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/70 bg-surface-input px-3 py-4">
                          <p className="text-xs font-medium text-foreground">{tt('roles.memoryConflictEmptyTitle', 'No open conflicts')}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{tt('roles.memoryConflictEmpty', 'No open memory conflicts.')}</p>
                        </div>
                      ) : memoryConflictItems.slice(0, 8).map((conflict) => (
                        <div
                          key={conflict.id}
                          className="cursor-pointer rounded-md border border-l-2 border-red-500/20 border-l-red-500/70 bg-red-500/5 px-3 py-3 transition-colors hover:bg-red-500/10"
                          onClick={() => void openMemoryDetail(conflict.id, 'conflict')}
                        >
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className="rounded-full border-red-500/25 bg-red-500/10 text-2xs text-red-700 dark:text-red-400">{conflict.type}</Badge>
                                <Badge variant="secondary" className="rounded-full text-2xs">{conflict.status}</Badge>
                                {conflict.cardIds?.length ? <span className="text-2xs text-muted-foreground">{tt('roles.memoryConflictCards', '{{count}} cards', { count: conflict.cardIds.length })}</span> : null}
                              </div>
                              <p className="text-sm leading-5 text-foreground">{conflict.reason}</p>
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-2xs"
                                  disabled={memoryLoading || !conflict.cardIds?.length}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void prepareMergeDraft(conflict.cardIds);
                                  }}
                                >
                                  <GitMerge className="mr-1 h-3 w-3" />
                                  {tt('roles.memoryMergeDraft', 'Merge draft')}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </TabsContent>

                    <TabsContent value="injections" className="space-y-2">
                      <div className="rounded-md border border-border/60 bg-surface-input px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-foreground">{tt('roles.memorySimulationTitle', 'Injection simulation')}</p>
                            <p className="mt-1 text-2xs text-muted-foreground">{tt('roles.memorySimulationHint', 'Preview how the current task would select role memory.')}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={roleMemoryDisabled || memoryLoading || !selectedRole}
                            onClick={() => void simulateRoleMemoryInjection()}
                            data-testid="role-memory-simulate"
                          >
                            <Sparkles className="mr-1 h-3.5 w-3.5" />
                            {tt('roles.memorySimulate', 'Simulate')}
                          </Button>
                        </div>
                        {memorySimulation?.pack?.candidateExplanations?.length ? (
                          <div className="mt-3 space-y-3" data-testid="role-memory-simulation-result">
                            <div className="rounded-md bg-background/70 px-2.5 py-2">
                              <div className="flex items-center justify-between text-2xs text-muted-foreground">
                                <span>{tt('roles.memoryContextBudget', 'Context budget')}</span>
                                <span>{memorySimulation.pack.estimatedTokens?.total ?? 0} / {memorySimulation.pack.budget?.total ?? 0}</span>
                              </div>
                              <Progress value={simulationBudgetPercent} className="mt-2 h-1.5 bg-black/10 dark:bg-white/10" />
                            </div>
                            {MEMORY_INJECTION_CLASSES.map((injectionClass) => {
                              const candidates = simulationCandidatesByClass[injectionClass];
                              if (candidates.length === 0) return null;
                              return (
                                <div key={injectionClass} className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2" data-testid={`role-memory-simulation-${injectionClass}`}>
                                  <div className="mb-2 flex items-center justify-between">
                                    <Badge variant="outline" className="rounded-full text-2xs">{injectionClass}</Badge>
                                    <span className="text-2xs text-muted-foreground">{tt('roles.memoryCandidateCount', '{{count}} candidates', { count: candidates.length })}</span>
                                  </div>
                                  <div className="space-y-2">
                                    {candidates.slice(0, 3).map((candidate) => (
                                      <div key={candidate.cardId} className="rounded-md bg-surface-input px-2.5 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex min-w-0 items-center gap-1.5">
                                            <Badge
                                              variant="outline"
                                              className={cn(
                                                'rounded-full text-2xs',
                                                candidate.selected
                                                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                                  : 'border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400',
                                              )}
                                            >
                                              {candidate.selected ? tt('roles.memorySelected', 'selected') : tt('roles.memorySkipped', 'skipped')}
                                            </Badge>
                                            <span className="truncate font-mono text-2xs text-muted-foreground">{candidate.cardId}</span>
                                          </div>
                                          <span className="text-2xs text-muted-foreground">{candidate.score.toFixed(2)}</span>
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{candidate.whatWouldSelect || candidate.reason}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      {memoryInjections.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/70 bg-surface-input px-3 py-4">
                          <p className="text-xs font-medium text-foreground">{tt('roles.memoryInjectionEmptyTitle', 'No injection history')}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{tt('roles.memoryInjectionEmpty', 'No injection logs for this role yet.')}</p>
                        </div>
                      ) : memoryInjections.slice(0, 6).map((injection) => {
                        const candidates = injection.candidateExplanations ?? [];
                        return (
                          <div
                            key={injection.id}
                            className="cursor-pointer rounded-md border border-border/60 bg-surface-input px-3 py-3 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={() => void openMemoryDetail(injection.id, 'injection')}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="rounded-full text-2xs">{injection.policyVersion ?? 'v1'}</Badge>
                                <span className="text-2xs text-muted-foreground">{formatMemoryDate(injection.createdAt)}</span>
                                {injection.truncated && <Badge variant="outline" className="rounded-full text-2xs">{tt('roles.memoryTruncated', 'truncated')}</Badge>}
                              </div>
                              <span className="text-2xs text-muted-foreground">
                                {tt('roles.memoryCandidatesSummary', '{{selected}} selected / {{skipped}} skipped', {
                                  selected: candidates.filter((candidate) => candidate.selected).length,
                                  skipped: candidates.filter((candidate) => !candidate.selected).length,
                                })}
                              </span>
                            </div>
                            <div className="mt-3 space-y-2">
                              {candidates.slice(0, 4).map((candidate) => (
                                <div
                                  key={candidate.cardId}
                                  className="rounded-md bg-background/70 px-2.5 py-2"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openMemoryDetail(candidate.cardId, 'card');
                                  }}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          'rounded-full text-2xs',
                                          candidate.selected
                                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                            : 'border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400',
                                        )}
                                      >
                                        {candidate.selected ? tt('roles.memorySelected', 'selected') : tt('roles.memorySkipped', 'skipped')}
                                      </Badge>
                                      <span className="truncate font-mono text-2xs text-muted-foreground">{candidate.cardId}</span>
                                    </div>
                                    <span className="text-2xs text-muted-foreground">
                                      {candidate.injectionClass ? `${candidate.injectionClass} · ` : ''}{tt('roles.memoryScore', 'Score')} {candidate.score.toFixed(2)}
                                    </span>
                                  </div>
                                  <Progress value={scoreToPercent(candidate.score)} className="mt-2 h-1.5 bg-black/10 dark:bg-white/10" />
                                  <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                                    {candidate.bucket ?? candidate.truncatedReason ?? tt('roles.memoryNoBucket', 'not injected')} · {candidate.reason}
                                  </p>
                                  {candidate.penalties?.length ? (
                                    <p className="mt-1 text-2xs text-amber-700 dark:text-amber-400">
                                      {tt('roles.memoryPenalties', 'Penalties')}: {candidate.penalties.join(', ')}
                                    </p>
                                  ) : null}
                                  {candidate.whatWouldSelect ? (
                                    <p className="mt-1 text-2xs text-blue-700 dark:text-blue-400">{candidate.whatWouldSelect}</p>
                                  ) : null}
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-2xs"
                                      disabled={roleMemoryDisabled || Boolean(memoryFeedbackLoading)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void submitMemoryFeedback(candidate.cardId, 'helpful', injection.id);
                                      }}
                                    >
                                      <ThumbsUp className="mr-1 h-3 w-3" />
                                      {tt('roles.memoryFeedbackHelpful', 'Helpful')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-2xs text-red-700 dark:text-red-400"
                                      disabled={roleMemoryDisabled || Boolean(memoryFeedbackLoading)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void submitMemoryFeedback(candidate.cardId, 'harmful', injection.id);
                                      }}
                                    >
                                      <ThumbsDown className="mr-1 h-3 w-3" />
                                      {tt('roles.memoryFeedbackHarmful', 'Harmful')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-2xs"
                                      disabled={roleMemoryDisabled || Boolean(memoryFeedbackLoading)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void submitMemoryFeedback(candidate.cardId, candidate.selected ? 'user_corrected' : 'missing_needed', injection.id);
                                      }}
                                    >
                                      {candidate.selected ? tt('roles.memoryFeedbackCorrected', 'Corrected') : tt('roles.memoryFeedbackMissing', 'Missing')}
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {latestInjection && (
                        <p className="text-2xs text-muted-foreground">
                          {tt('roles.memoryLatestInjectionSummary', 'Latest run: {{selected}} selected, {{skipped}} skipped', {
                            selected: selectedInjectionCandidates,
                            skipped: skippedInjectionCandidates,
                          })}
                        </p>
                      )}
                    </TabsContent>

                    <TabsContent value="quality" className="space-y-3">
                      <div className="rounded-md border border-border/60 bg-surface-input px-3 py-3" data-testid="role-memory-quality">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'rounded-full text-2xs',
                                  memoryQualityLabel === 'strong'
                                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                    : memoryQualityLabel === 'partial'
                                      ? 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                                      : 'border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400',
                                )}
                              >
                                {memoryQualityLabel}
                              </Badge>
                              <span className="text-xs font-medium text-foreground">{tt('roles.memoryQualityTitle', 'Memory quality')}</span>
                            </div>
                            <p className="text-2xs text-muted-foreground" data-testid="role-memory-feedback-diagnostic">
                              {t('roles.memoryQualityHint')}
                            </p>
                          </div>
                          <span className="text-2xs text-muted-foreground">{formatMemoryDate(memoryUtility?.generatedAt)}</span>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {[
                            { label: tt('roles.memoryQualityPrecision', 'Precision'), value: formatMemoryMetric(memoryUtility?.aggregate?.contextPrecisionAtK, { percent: true }) },
                            { label: tt('roles.memoryQualityHelpful', 'Helpful rate'), value: formatMemoryMetric(memoryUtility?.aggregate?.helpfulnessRate, { percent: true }) },
                            { label: tt('roles.memoryQualityHarm', 'Harm rate'), value: formatMemoryMetric(memoryUtility?.aggregate?.harmRate, { percent: true }) },
                            { label: tt('roles.memoryQualityTokens', 'Tokens/run'), value: formatMemoryMetric(memoryUtility?.aggregate?.tokenOverheadPerRun) },
                          ].map((item) => (
                            <div key={item.label} className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                              <p className="text-2xs text-muted-foreground">{item.label}</p>
                              <p className="mt-1 text-sm font-medium text-foreground">{item.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                            <p className="text-2xs font-medium text-muted-foreground">{tt('roles.memoryQualitySample', 'Sample')}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {[
                                ['cards', memoryUtility?.sample?.cards],
                                ['injections', memoryUtility?.sample?.injections],
                                ['feedback', memoryUtility?.sample?.feedback],
                                ['proposals', memoryUtility?.sample?.proposals],
                                ['conflicts', memoryUtility?.sample?.conflicts],
                              ].map(([label, value]) => (
                                <Badge key={label} variant="secondary" className="rounded-full text-2xs">
                                  {label}: {value ?? 0}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                            <p className="text-2xs font-medium text-muted-foreground">{tt('roles.memoryQualityMissing', 'Missing evidence')}</p>
                            <div className="mt-2 space-y-1">
                              {(memoryUtility?.missingEvidence?.length ? memoryUtility.missingEvidence : [tt('roles.memoryQualityNoMissing', 'No missing evidence reported.')]).slice(0, 3).map((item) => (
                                <p key={item} className="text-2xs text-muted-foreground">{item}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {memoryUtility?.cards?.length ? (
                        <div className="space-y-2">
                          {memoryUtility.cards.slice(0, 8).map((item) => (
                            <div
                              key={item.cardId}
                              className="cursor-pointer rounded-md border border-border/60 bg-surface-input px-3 py-3 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                              onClick={() => void openMemoryDetail(item.cardId, 'card')}
                            >
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline" className="rounded-full text-2xs">{item.dataQuality ?? 'insufficient'}</Badge>
                                    <Badge variant="secondary" className="rounded-full text-2xs">
                                      {tt('roles.memoryQualityUtility', 'Utility')}: {formatMemoryMetric(item.utilityScore, { percent: true })}
                                    </Badge>
                                    <Badge variant="outline" className="rounded-full text-2xs">{item.retentionAction ?? 'review'}</Badge>
                                    {item.conflictCount ? <Badge variant="outline" className="rounded-full border-red-500/25 bg-red-500/10 text-2xs text-red-700 dark:text-red-400">{tt('roles.memoryQualityConflictCount', '{{count}} conflicts', { count: item.conflictCount })}</Badge> : null}
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-foreground">{item.card?.content ?? item.cardId}</p>
                                  <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{item.reasonSummary}</p>
                                </div>
                                <div className="grid min-w-[170px] grid-cols-2 gap-1.5 text-2xs text-muted-foreground">
                                  <span>{tt('roles.memorySelected', 'selected')}: {item.selectedCount ?? 0}</span>
                                  <span>{tt('roles.memorySkipped', 'skipped')}: {item.skippedCount ?? 0}</span>
                                  <span>{tt('roles.memoryFeedbackHelpful', 'Helpful')}: {item.helpfulCount ?? 0}</span>
                                  <span>{tt('roles.memoryFeedbackHarmful', 'Harmful')}: {item.harmfulCount ?? 0}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed border-border/70 bg-surface-input px-3 py-4">
                          <p className="text-xs font-medium text-foreground">{tt('roles.memoryQualityEmptyTitle', 'No quality signal yet')}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{tt('roles.memoryQualityEmpty', 'Run a role with memory and record feedback to build a real quality report.')}</p>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
          </TooltipProvider>
          )}

          {/* Section B: orchestration task */}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <span className="text-sm font-medium">{tt('roles.orchestrate', 'Orchestrate task')}</span>
            <div
              data-testid="routing-memo-dashboard"
              className="rounded-md border border-border/60 bg-surface-input px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                  <span className="text-xs font-medium text-foreground">
                    {tt('roles.routingMemoTitle', 'Routing Memo evidence')}
                  </span>
                  <Badge
                    data-testid="routing-memo-authority"
                    variant="outline"
                    className="rounded-full text-2xs"
                  >
                    {tt('roles.routingMemoAuthority', 'Authority')}: {routingMemoDashboard?.authority ?? 'off'}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => void loadRoutingMemoDashboard()}
                  disabled={routingMemoLoading}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', routingMemoLoading && 'animate-spin')} />
                </Button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md bg-background/70 px-2.5 py-2" data-testid="routing-memo-samples">
                  <p className="text-2xs text-muted-foreground">{tt('roles.routingMemoSamples', 'Shadow samples')}</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {routingMemoDashboard?.shadow?.sampleCount ?? 0}
                    <span className="ml-1 text-2xs font-normal text-muted-foreground">
                      / {routingMemoDashboard?.sampleCount ?? 0}
                    </span>
                  </p>
                </div>
                <div className="rounded-md bg-background/70 px-2.5 py-2" data-testid="routing-memo-divergence">
                  <p className="text-2xs text-muted-foreground">{tt('roles.routingMemoDivergence', 'Divergences')}</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {routingMemoDashboard?.shadow?.divergenceCount ?? 0}
                  </p>
                </div>
                <div className="rounded-md bg-background/70 px-2.5 py-2" data-testid="routing-memo-outcomes">
                  <p className="text-2xs text-muted-foreground">{tt('roles.routingMemoOutcomes', 'Outcomes')}</p>
                  <p className="mt-0.5 text-xs font-medium text-foreground">
                    {tt('roles.routingMemoOutcomeSummary', '{{completed}} complete / {{partial}} partial', {
                      completed: routingMemoDashboard?.outcomes?.graphStatus?.completed ?? 0,
                      partial: routingMemoDashboard?.outcomes?.graphStatus?.partial ?? 0,
                    })}
                  </p>
                </div>
                <div className="rounded-md bg-background/70 px-2.5 py-2" data-testid="routing-memo-active-gate">
                  <p className="text-2xs text-muted-foreground">{tt('roles.routingMemoActiveGate', 'Active gate')}</p>
                  <p className={cn(
                    'mt-0.5 text-xs font-medium',
                    routingMemoDashboard?.activeGate?.eligible
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400',
                  )}>
                    {routingMemoDashboard?.activeGate?.eligible
                      ? tt('roles.routingMemoGateMet', 'Gate met')
                      : tt('roles.routingMemoGateNotMet', 'Gate not met')}
                  </p>
                </div>
              </div>
              {routingMemoDashboard?.recentSamples?.[0] && (
                <p className="mt-2 truncate text-2xs text-muted-foreground" data-testid="routing-memo-recent-sample">
                  {tt('roles.routingMemoRecentSample', 'Latest')}: {routingMemoDashboard.recentSamples[0].leadRole ?? '-'}
                  {' / '}
                  {routingMemoDashboard.recentSamples[0].graphStatus ?? '-'}
                  {routingMemoDashboard.recentSamples[0].shadow?.outcome
                    ? ` / ${routingMemoDashboard.recentSamples[0].shadow?.outcome}`
                    : ''}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                data-testid="role-orchestration-task-input"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder={tt('roles.taskPlaceholder', 'Describe the task to orchestrate, e.g. refactor this module and add tests')}
              />
              <Button variant="outline" onClick={() => void runPlan()} disabled={planning}>
                <ListChecks className="h-4 w-4 mr-1" />
                {tt('roles.plan', 'Plan')}
              </Button>
              <Button onClick={() => void runOrchestration()} disabled={running}>
                <Play className="h-4 w-4 mr-1" />
                {tt('roles.run', 'Run')}
              </Button>
              <Button data-testid="role-task-loop-run" variant="secondary" onClick={() => void runTaskLoop()} disabled={taskLoopRunning}>
                {taskLoopRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                {tt('roles.taskLoop', 'Task loop')}
              </Button>
              <Button data-testid="role-mission-run" variant="secondary" onClick={() => void runMissionLoop()} disabled={missionRunning}>
                {missionRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                {tt('roles.missionControl', 'Mission Control')}
              </Button>
            </div>

            <SubagentRunnerPanel anchorSession={anchorSession} anchorAgentId={anchorAgentId} />

            {plan && (
              <OrchestrationPlanView
                plan={plan}
                tt={tt}
                editControl={planEditDraft ? {
                  editing: planEditing,
                  order: planEditDraft.order,
                  disabledNodeIds: planEditDraft.disabledNodeIds,
                  notesByNodeId: planEditDraft.notesByNodeId,
                  onToggleEditing: () => setPlanEditing((value) => !value),
                  onDisableNode: (nodeId) => updatePlanEditDraft({ type: 'disable_node', nodeId }),
                  onEnableNode: (nodeId) => updatePlanEditDraft({ type: 'enable_node', nodeId }),
                  onNoteNode: (nodeId, note) => updatePlanEditDraft({ type: 'note_node', nodeId, note }),
                  onMoveNode: (nodeId, beforeNodeId) => updatePlanEditDraft({ type: 'reorder_node', nodeId, beforeNodeId }),
                  onSave: () => void savePlanEdits(),
                  onCancel: resetPlanEditDraft,
                  onRegenerate: () => void runPlan(),
                } : undefined}
              />
            )}

            {/* Real-time orchestration progress (fed by subagent lifecycle events) */}
            {Object.keys(lifecycleEvents).length > 0 && (
              <div data-testid="role-task-loop-progress" className="rounded-xl bg-surface-input p-3 space-y-1">
                <p className="text-2xs font-medium text-muted-foreground">{tt('roles.progress', 'Orchestration progress')}</p>
                {Object.entries(lifecycleEvents).map(([eventKey, entry]) => {
                  const roleName = entry.roleName;
                  const tone = roleTone(roleName);
                  const dotClasses = toneClasses(tone);
                  return (
                    <div key={eventKey} className="flex items-center gap-2 rounded-lg py-1">
                      {anchorAgent ? (
                        <AgentRoleIdentity
                          agentId={entry.agentId ?? anchorAgent.id}
                          name={anchorAgent.name}
                          avatar={anchorAgent.avatar ?? { kind: anchorAgent.id === 'main' ? 'brand' : 'fallback', source: 'default', revision: `fallback:${anchorAgent.id}` }}
                          roleName={roleName}
                          size={28}
                        />
                      ) : <RoleBadge roleName={roleName} size={22} />}
                      {entry.phase === 'started' ? (
                        <Loader2 className={cn('h-3 w-3 shrink-0 animate-spin', dotClasses.text)} />
                      ) : entry.phase === 'completed' || entry.phase === 'verified' ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 shrink-0 text-red-500" />
                      )}
                      <span className="text-2xs font-medium text-foreground truncate">{roleName}</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-2xs rounded-full border shrink-0',
                          entry.phase === 'started' && 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
                          entry.phase === 'completed' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
                          entry.phase === 'verified' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
                          entry.phase === 'error' && 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
                        )}
                      >
                        {entry.phase === 'started' ? tt('roles.phaseStarted', 'running')
                          : entry.phase === 'completed' ? tt('roles.phaseCompleted', 'done')
                          : entry.phase === 'verified' ? tt('roles.phaseVerified', 'verified')
                          : tt('roles.phaseError', 'failed')}
                      </Badge>
                      {entry.error && (
                        <span className="text-2xs text-muted-foreground truncate">{entry.error}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {Object.keys(taskLoopEvents).length > 0 && (
              <div className="rounded-xl bg-surface-input p-3 space-y-1">
                <p className="text-2xs font-medium text-muted-foreground">{tt('roles.taskLoopProgress', 'Task loop progress')}</p>
                {Object.values(taskLoopEvents).slice(-3).map((event) => (
                  <div key={event.loopRunId} data-testid="role-task-loop-event" className="flex items-center gap-2">
                    {event.status === 'running' ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
                    ) : event.status === 'complete' ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3 w-3 shrink-0 text-amber-500" />
                    )}
                    <span className="text-2xs font-medium text-foreground truncate">{event.loopRunId}</span>
                    <Badge variant="secondary" className="rounded-full text-2xs">
                      {tt('roles.taskLoopPhase', 'Round {{iteration}} · {{phase}}', { iteration: event.iteration, phase: event.phase })}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-2xs">{event.status}</Badge>
                    {event.selfCheckDecision && (
                      <Badge variant="outline" className="rounded-full text-2xs">{event.selfCheckDecision}</Badge>
                    )}
                    {event.evidenceGate && (
                      <Badge
                        data-testid="role-task-loop-evidence-gate"
                        variant={event.evidenceGate.status === 'pass' ? 'secondary' : 'outline'}
                        className="rounded-full text-2xs"
                      >
                        {tt('roles.taskLoopEvidenceGate', 'Gate {{status}}', { status: event.evidenceGate.status })}
                      </Badge>
                    )}
                    {event.roleQualitySummary && (
                      <Badge data-testid="role-task-loop-quality" variant="outline" className="rounded-full text-2xs">
                        {tt('roles.taskLoopQuality', 'Q {{good}}/{{needs}}/{{poor}}', {
                          good: event.roleQualitySummary.good,
                          needs: event.roleQualitySummary.needsAttention,
                          poor: event.roleQualitySummary.poorAttempt,
                        })}
                      </Badge>
                    )}
                    {event.error && (
                      <span className="text-2xs text-muted-foreground truncate">{event.error}</span>
                    )}
                    {!event.error && event.blockedReason && (
                      <span className="text-2xs text-muted-foreground truncate">{event.blockedReason}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {taskLoopResult && (() => {
              const { codingRun: taskLoopCodingRun, events: taskLoopEvents } = projectTaskLoopCodingRun(taskLoopResult);
              return (
              <div data-testid="role-task-loop-result" className="rounded-xl border border-border/60 bg-surface-input p-3">
                <div className="flex items-center gap-2">
                  <CircleDot className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-foreground">
                    {tt('roles.taskLoopSummary', 'Task loop {{status}} at {{phase}}', {
                      status: isTaskLoopPassed({ status: taskLoopResult.status, evidenceGate: taskLoopResult.evidenceGate })
                        ? 'complete (verified)'
                        : taskLoopResult.status,
                      phase: taskLoopResult.phase,
                    })}
                  </span>
                </div>
                {taskLoopResult.evidenceGate && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 pl-6">
                    <Badge data-testid="role-task-loop-result-gate" variant="secondary" className="rounded-full text-2xs">
                      {tt('roles.taskLoopEvidenceGate', 'Gate {{status}}', { status: taskLoopResult.evidenceGate.status })}
                    </Badge>
                    {taskLoopResult.roleQualitySummary && (
                      <Badge data-testid="role-task-loop-result-quality" variant="outline" className="rounded-full text-2xs">
                        {tt('roles.taskLoopQuality', 'Q {{good}}/{{needs}}/{{poor}}', {
                          good: taskLoopResult.roleQualitySummary.good,
                          needs: taskLoopResult.roleQualitySummary.needsAttention,
                          poor: taskLoopResult.roleQualitySummary.poorAttempt,
                        })}
                      </Badge>
                    )}
                  </div>
                )}
                {(taskLoopResult.filesTouched?.length || taskLoopResult.testsRun?.length || taskLoopResult.blockedReason) && (
                  <div className="mt-2 pl-6 text-2xs text-muted-foreground space-y-1">
                    {taskLoopResult.filesTouched?.length ? (
                      <p data-testid="role-task-loop-files" className="truncate">
                        {tt('roles.taskLoopFiles', 'Files: {{count}}', { count: taskLoopResult.filesTouched.length })}
                      </p>
                    ) : null}
                    {taskLoopResult.testsRun?.length ? (
                      <p data-testid="role-task-loop-tests" className="truncate">
                        {tt('roles.taskLoopTests', 'Tests: {{count}}', { count: taskLoopResult.testsRun.length })}
                      </p>
                    ) : null}
                    {taskLoopResult.blockedReason ? (
                      <p data-testid="role-task-loop-blocked" className="truncate">{taskLoopResult.blockedReason}</p>
                    ) : null}
                  </div>
                )}
                {taskLoopResult.traceId && (
                  <p data-testid="role-task-loop-trace" className="mt-1 pl-6 font-mono text-2xs text-muted-foreground">{taskLoopResult.traceId}</p>
                )}
                <details className="mt-2 pl-6" data-testid="role-task-loop-coding-run">
                  <summary className="cursor-pointer text-2xs text-muted-foreground">{tt('roles.taskLoopCodingRun', 'CodingRun evidence')}</summary>
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/60 p-2 font-mono text-[10px] leading-4 text-foreground/80">
                    {serializeCodingRunJsonl(taskLoopCodingRun, taskLoopEvents)}
                  </pre>
                </details>
              </div>
              );
            })()}

            {Object.keys(missionEvents).length > 0 && (
              <div data-testid="role-mission-progress" className="rounded-xl bg-surface-input p-3 space-y-1">
                <p className="text-2xs font-medium text-muted-foreground">{tt('roles.missionProgress', 'Mission Control progress')}</p>
                {Object.values(missionEvents).slice(-4).map((event) => (
                  <div key={`${event.missionId}:${event.tick}:${event.phase}:${event.status}:${event.ts}`} data-testid="role-mission-event" className="flex items-center gap-2">
                    {event.status === 'running' ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
                    ) : event.status === 'complete' ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                    ) : event.status === 'sleeping' || event.status === 'paused' ? (
                      <Clock3 className="h-3 w-3 shrink-0 text-amber-500" />
                    ) : (
                      <XCircle className="h-3 w-3 shrink-0 text-red-500" />
                    )}
                    <span className="text-2xs font-medium text-foreground truncate">{event.missionId}</span>
                    <Badge variant="secondary" className="rounded-full text-2xs">
                      {tt('roles.missionPhase', 'Tick {{tick}} · {{phase}}', { tick: event.tick, phase: event.phase })}
                    </Badge>
                    <Badge variant="outline" className="rounded-full text-2xs">{event.status}</Badge>
                    {event.reviewerDecision && (
                      <Badge variant="outline" className="rounded-full text-2xs">{event.reviewerDecision}</Badge>
                    )}
                    {event.blockedReason && (
                      <span className="text-2xs text-muted-foreground truncate">{event.blockedReason}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {missionResult && (
              <div data-testid="role-mission-result" className="rounded-xl border border-border/60 bg-surface-input p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CircleDot className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-foreground">
                    {tt('roles.missionSummary', 'Mission {{status}} at {{phase}}', {
                      status: missionResult.status,
                      phase: missionResult.phase,
                    })}
                  </span>
                  <Badge variant="secondary" className="rounded-full text-2xs">
                    {tt('roles.missionTick', 'Tick {{tick}}', { tick: missionResult.tick })}
                  </Badge>
                  {missionResult.reviewerDecision && (
                    <Badge variant="outline" className="rounded-full text-2xs">{missionResult.reviewerDecision}</Badge>
                  )}
                </div>
                {missionResult.nextWakeAt && (
                  <p className="mt-1 pl-6 text-2xs text-muted-foreground">
                    {tt('roles.missionNextWake', 'Next wake: {{time}}', { time: new Date(missionResult.nextWakeAt).toLocaleString() })}
                  </p>
                )}
                {missionResult.blockedReason && (
                  <p data-testid="role-mission-blocked" className="mt-1 pl-6 text-2xs text-amber-700 dark:text-amber-400">{missionResult.blockedReason}</p>
                )}
                {missionResult.traceId && (
                  <p data-testid="role-mission-trace" className="mt-1 pl-6 font-mono text-2xs text-muted-foreground">{missionResult.traceId}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 pl-6">
                  <Button
                    data-testid="role-mission-pause"
                    size="sm"
                    variant="outline"
                    onClick={() => void controlMission('pause')}
                    disabled={missionRunning || ['complete', 'blocked', 'cancelled', 'error', 'paused'].includes(String(missionResult.status))}
                  >
                    <PauseCircle className="h-3.5 w-3.5 mr-1" />
                    {tt('roles.missionPause', 'Pause')}
                  </Button>
                  <Button
                    data-testid="role-mission-resume"
                    size="sm"
                    variant="outline"
                    onClick={() => void controlMission('resume')}
                    disabled={missionRunning || missionResult.status !== 'paused'}
                  >
                    <Play className="h-3.5 w-3.5 mr-1" />
                    {tt('roles.missionResume', 'Resume')}
                  </Button>
                  <Button
                    data-testid="role-mission-cancel"
                    size="sm"
                    variant="outline"
                    onClick={() => void controlMission('cancel')}
                    disabled={missionRunning || ['complete', 'blocked', 'cancelled', 'error'].includes(String(missionResult.status))}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    {tt('roles.missionCancel', 'Cancel')}
                  </Button>
                </div>
              </div>
            )}

            {/* Run result feedback bar */}
            {runResult && runResult.kind === 'success' && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-medium text-foreground">
                    {tt('roles.runSummary', 'Started {{count}} subagents', { count: runResult.spawnedRunIds.length })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 pl-6">
                  {runResult.spawnedRunIds.map((id) => (
                    <span key={id} className="text-2xs font-mono text-muted-foreground bg-surface-input rounded-md px-1.5 py-0.5">
                      {id.slice(0, 8)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {runResult && runResult.kind === 'failure' && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-xs font-medium text-foreground">
                    {tt('roles.runFailed', 'Orchestration failed to spawn subagents')}
                  </span>
                </div>
                <ul className="mt-1 pl-6 space-y-0.5">
                  {runResult.failures.map((f, i) => (
                    <li key={i} className="text-2xs text-muted-foreground">
                      <span className="font-mono">{f.roleName}</span>
                      {f.error ? ` — ${f.error}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {synthesis && (
              <div
                data-testid="role-orchestration-synthesis"
                className="rounded-xl border border-border/60 bg-surface-input p-3"
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.85fr)]">
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground">
                            {tt('roles.synthesisTitle', 'Synthesis')}
                          </p>
                          {synthesis.summary && (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {synthesis.summary}
                            </p>
                          )}
                        </div>
                      </div>
                      {synthesis.status && (
                        <Badge variant="outline" className="shrink-0 rounded-full text-2xs">
                          {synthesis.status}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md bg-background/70 px-2.5 py-2 text-2xs text-muted-foreground">
                        {tt('roles.synthesisVerifier', 'Verifier')}: <span className="font-medium text-foreground">{synthesis.verifier?.decision ?? '-'}</span>
                      </div>
                      <div className="rounded-md bg-background/70 px-2.5 py-2 text-2xs text-muted-foreground">
                        {tt('roles.synthesisEvidence', 'Evidence')}: <span className="font-medium text-foreground">{synthesis.evidenceRefs?.length ?? 0}</span>
                      </div>
                      <div className="rounded-md bg-background/70 px-2.5 py-2 text-2xs text-muted-foreground">
                        {tt('roles.synthesisTraces', 'Traces')}: <span className="font-medium text-foreground">{synthesis.traceIds?.length ?? 0}</span>
                      </div>
                      <div className="rounded-md bg-background/70 px-2.5 py-2 text-2xs text-muted-foreground">
                        {tt('roles.synthesisRoles', 'Roles')}: <span className="font-medium text-foreground">{synthesis.roleContributions?.length ?? 0}</span>
                      </div>
                    </div>

                    {synthesis.roleContributions?.length ? (
                      <div className="mt-3">
                        <p className="text-2xs font-medium text-muted-foreground">{tt('roles.synthesisRoleOutcomes', 'Role outcomes')}</p>
                        <ul className="mt-1 space-y-1">
                          {compactList(synthesis.roleContributions, 5).map((role, index) => (
                            <li key={`${role.roleName ?? 'role'}-${index}`} className="rounded-md bg-background/60 px-2.5 py-2 text-2xs text-muted-foreground">
                              <span className="font-mono text-foreground">{role.roleName ?? '-'}</span>
                              <span> · {role.status ?? '-'}</span>
                              {role.phase ? <span> · {role.phase}</span> : null}
                              {role.task ? <span className="block truncate">{role.task}</span> : null}
                              {role.evidenceRefs?.length ? (
                                <span className="block truncate font-mono text-muted-foreground">
                                  {compactList(role.evidenceRefs, 2).map(displayEvidenceRef).join(', ')}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 rounded-md border border-border/60 bg-background/50 p-2.5">
                    <div className="grid gap-2">
                      <div className="text-2xs text-muted-foreground">
                        <span className="font-medium text-foreground">{tt('roles.synthesisVerifier', 'Verifier')}</span>
                        <div className="mt-1 font-mono">{synthesis.verifier?.decision ?? '-'}</div>
                        {synthesis.verifier?.evidenceRefs?.length ? (
                          <div className="mt-1 truncate font-mono">{compactList(synthesis.verifier.evidenceRefs, 3).map(displayEvidenceRef).join(', ')}</div>
                        ) : null}
                      </div>

                      {synthesis.evidenceRefs?.length ? (
                        <div className="text-2xs text-muted-foreground">
                          <span className="font-medium text-foreground">{tt('roles.synthesisEvidenceRefs', 'Evidence refs')}</span>
                          <ul className="mt-1 space-y-0.5">
                            {compactList(synthesis.evidenceRefs, 6).map((ref, index) => (
                              <li key={`${displayEvidenceRef(ref)}-${index}`} className="truncate font-mono">{displayEvidenceRef(ref)}</li>
                            ))}
                          </ul>
                          {remainingCount(synthesis.evidenceRefs, 6) > 0 && <p className="mt-1">+{remainingCount(synthesis.evidenceRefs, 6)}</p>}
                        </div>
                      ) : null}

                      {synthesis.traceIds?.length ? (
                        <div className="text-2xs text-muted-foreground">
                          <span className="font-medium text-foreground">{tt('roles.synthesisTraceIds', 'Trace ids')}</span>
                          <div className="mt-1 space-y-0.5">
                            {compactList(synthesis.traceIds, 4).map((traceId) => (
                              <p key={traceId} className="truncate font-mono">{traceId}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {synthesis.blackboardSummary ? (
                        <div className="text-2xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {tt('roles.synthesisBlackboard', 'Blackboard')}: {synthesis.blackboardSummary.entryCount ?? 0}
                          </span>
                          <div className="mt-1 grid grid-cols-2 gap-1">
                            <span>{tt('roles.synthesisBlackboardRisks', 'Risks')}: {synthesis.blackboardSummary.openRisks ?? 0}</span>
                            <span>{tt('roles.synthesisBlackboardConflicts', 'Conflicts')}: {synthesis.blackboardSummary.unresolvedConflicts ?? 0}</span>
                            <span>{tt('roles.synthesisBlackboardQuestions', 'Questions')}: {synthesis.blackboardSummary.openQuestions ?? 0}</span>
                            <span>{tt('roles.synthesisBlackboardMemory', 'Memory')}: {synthesis.blackboardSummary.memoryProposals ?? 0}</span>
                          </div>
                          {synthesis.blackboardSummary.trustBoundaries?.length ? (
                            <p className="mt-1 truncate font-mono">{synthesis.blackboardSummary.trustBoundaries.join(', ')}</p>
                          ) : null}
                        </div>
                      ) : null}

                      {synthesis.visibleFailures?.length ? (
                        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                          <p className="text-2xs font-medium text-red-700 dark:text-red-400">
                            {tt('roles.synthesisFailures', 'Failures')}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {synthesis.visibleFailures.slice(0, 4).map((failure, index) => (
                              <li key={`${failure.code ?? 'failure'}-${index}`} className="text-2xs text-muted-foreground">
                                {failure.roleName && <span className="font-mono text-foreground">{failure.roleName}: </span>}
                                {failure.message || failure.code || '-'}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {synthesis.policy && (
                  <p className="mt-2 text-2xs text-muted-foreground">
                    {tt('roles.synthesisPolicy', 'Policy')}: {tt('roles.synthesisPolicyValue', 'tools {{tools}} / verifier {{verifier}} / memory {{memory}}', {
                      tools: synthesis.policy.toolAccess ?? '-',
                      verifier: synthesis.policy.verifierAuthority ?? '-',
                      memory: synthesis.policy.memoryWrite ?? '-',
                    })}
                  </p>
                )}
              </div>
            )}

            {/* Approval round-trip */}
            {pendingApproval && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {tt('roles.approvalTitle', 'Orchestration run needs approval')}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {/* Redacted for external writes — see approvalDisplayDetails. */}
                        {approvalDisplayDetails(pendingApproval).reason || tt('roles.approvalHint', 'Spawning subagents requires approval under the current permission mode')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={running} onClick={dismissApproval}>
                      {tt('roles.cancel', 'Cancel')}
                    </Button>
                    <Button size="sm" className="h-7 text-xs" disabled={running} onClick={() => void approveRun()}>
                      <Check className="h-3 w-3 mr-1" />
                      {tt('roles.approve', 'Approve & run')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
      <Sheet open={memoryDetailOpen} onOpenChange={setMemoryDetailOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{tt('roles.memoryDetailTitle', 'Memory governance detail')}</SheetTitle>
            <SheetDescription>
              {tt('roles.memoryDetailDescription', 'Inspect ownership, review policy, evidence, history, and runtime impact.')}
            </SheetDescription>
          </SheetHeader>
          {memoryDetailLoading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : (
            <div className="mt-5 space-y-4">
              {memoryDetail?.card && (
                <div className="rounded-md border border-border/60 bg-surface-input p-3">
                  <p className="text-xs font-medium">{tt('roles.memoryDetailOverview', 'Overview')}</p>
                  <p className="mt-2 text-sm leading-5 text-foreground">{memoryDetail.card.content}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={cn('rounded-full text-2xs', memoryStatusClasses(memoryDetail.card.status))}>{memoryDetail.card.status}</Badge>
                    <Badge variant="secondary" className="rounded-full text-2xs">{memoryDetail.card.type}</Badge>
                    {memoryDetail.card.scope && <Badge variant="outline" className="rounded-full text-2xs">{memoryDetail.card.scope}</Badge>}
                    {memoryDetail.card.sensitivity && <Badge variant="outline" className={cn('rounded-full text-2xs', memorySensitivityClasses(memoryDetail.card.sensitivity))}>{memoryDetail.card.sensitivity}</Badge>}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                    <span>{tt('roles.memoryOwnerRole', 'Owner')}: {memoryDetail.card.ownerRole || '-'}</span>
                    <span>{tt('roles.memorySourceRole', 'Source role')}: {memoryDetail.card.sourceRole || '-'}</span>
                    <span>{tt('roles.memoryApplicableRoles', 'Applies to')}: {(memoryDetail.card.applicableRoles ?? memoryDetail.card.roleTags ?? []).join(', ') || '-'}</span>
                    <span>{tt('roles.memoryAllowedMutators', 'Can propose changes')}: {(memoryDetail.card.allowedMutators ?? []).join(', ') || '-'}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 text-2xs" disabled={roleMemoryDisabled} onClick={() => memoryDetail.card && prepareMemoryDraft(memoryDetail.card, 'update')}>
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      {tt('roles.memoryEditAsProposal', 'Edit as proposal')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-2xs" disabled={roleMemoryDisabled} onClick={() => memoryDetail.card && prepareMemoryDraft(memoryDetail.card, 'supersede')}>
                      <GitMerge className="mr-1 h-3.5 w-3.5" />
                      {tt('roles.memorySupersede', 'Supersede')}
                    </Button>
                    {(memoryDetail.card.status === 'archived' || memoryDetail.card.status === 'tombstone') && (
                      <Button size="sm" variant="outline" className="h-8 text-2xs" disabled={roleMemoryDisabled} onClick={() => memoryDetail.card && void restoreRoleMemory(memoryDetail.card.id)}>
                        <History className="mr-1 h-3.5 w-3.5" />
                        {tt('roles.memoryRestore', 'Restore')}
                      </Button>
                    )}
                    {memoryDetail.retention?.recommendedAction && memoryDetail.retention.recommendedAction !== 'keep' && (
                      <Button size="sm" variant="outline" className="h-8 text-2xs" disabled={roleMemoryDisabled} onClick={() => memoryDetail.card && void proposeRetention(memoryDetail.card.id, memoryDetail.retention?.recommendedAction)}>
                        <Clock3 className="mr-1 h-3.5 w-3.5" />
                        {tt('roles.memoryApplyRetention', 'Apply suggestion')}
                      </Button>
                    )}
                    {memoryDetail.card.status !== 'tombstone' && (
                      <Button size="sm" variant="ghost" className="h-8 text-2xs text-red-700 dark:text-red-400" disabled={roleMemoryDisabled} onClick={() => memoryDetail.card && void tombstoneRoleMemory(memoryDetail.card.id)}>
                        {tt('roles.memoryTombstone', 'Tombstone')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {memoryDetail?.proposal && (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium">{tt('roles.memoryDetailGovernance', 'Governance')}</p>
                  <p className="mt-2 text-sm leading-5 text-foreground">{memoryDetail.proposal.proposal?.content}</p>
                  <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                    <span>{tt('roles.memoryRiskLevel', 'Risk')}: {memoryDetail.proposal.riskLevel || '-'}</span>
                    <span>{tt('roles.memoryImpactScope', 'Impact scope')}: {memoryDetail.proposal.impactScope || '-'}</span>
                    <span>{tt('roles.memoryPermissionDecision', 'Permission')}: {memoryDetail.proposal.permissionDecision || '-'}</span>
                    <span>{tt('roles.memorySuggestedAction', 'Suggested')}: {memoryDetail.proposal.suggestedAction || '-'}</span>
                    <span>{tt('roles.memoryReviewReason', 'Gatekeeper reason')}: {memoryDetail.proposal.reasonSummary || memoryDetail.proposal.reviewReason || '-'}</span>
                  </div>
                </div>
              )}

              {memoryDetail?.conflicts?.length ? (
                <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                  <p className="text-xs font-medium">{tt('roles.memoryDetailConflicts', 'Conflicts')}</p>
                  <div className="mt-2 space-y-2">
                    {memoryDetail.conflicts.slice(0, 4).map((conflict) => (
                      <div key={conflict.id} className="rounded-md bg-background/70 px-2.5 py-2">
                        <Badge variant="outline" className="rounded-full text-2xs">{conflict.type}</Badge>
                        <p className="mt-1 text-xs text-foreground">{conflict.reason}</p>
                      </div>
                    ))}
                  </div>
                  {memoryDetail.conflictDetail?.cards?.length ? (
                    <div className="mt-3 grid gap-2">
                      <p className="text-2xs font-medium text-muted-foreground">{memoryDetail.conflictDetail.reasonSummary}</p>
                      {memoryDetail.conflictDetail.cards.slice(0, 3).map((card) => (
                        <div key={card.id} className="rounded-md bg-background/70 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="rounded-full text-2xs">{card.scope}</Badge>
                            <Badge variant="secondary" className="rounded-full text-2xs">{card.status}</Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-foreground">{card.content}</p>
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" className="h-8 text-2xs" disabled={roleMemoryDisabled} onClick={() => void prepareMergeDraft(memoryDetail.conflictDetail?.cards?.map((card) => card.id))}>
                          <GitMerge className="mr-1 h-3.5 w-3.5" />
                          {tt('roles.memoryMergeDraft', 'Merge draft')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {(memoryDetail?.card?.evidenceRefs?.length || memoryDetail?.evidence) ? (
                <div className="rounded-md border border-border/60 bg-surface-input p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">{tt('roles.memoryDetailEvidence', 'Evidence')}</p>
                    {memoryDetail.evidence?.status && <Badge variant="outline" className="rounded-full text-2xs">{memoryDetail.evidence.status}</Badge>}
                  </div>
                  {memoryDetail.evidence?.summary && <p className="mt-1 text-2xs text-muted-foreground">{memoryDetail.evidence.summary}</p>}
                  <div className="mt-2 space-y-2">
                    {(memoryDetail.card?.evidenceRefs ?? []).slice(0, 6).map((ref, index) => (
                      <div key={`${ref.type}-${ref.ref}-${index}`} className="rounded-md bg-background/70 px-2.5 py-2">
                        <p className="text-2xs text-muted-foreground">{ref.type}: {ref.ref}</p>
                        {ref.excerpt && <p className="mt-1 line-clamp-2 text-xs text-foreground">{ref.excerpt}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border border-border/60 bg-surface-input p-3" data-testid="role-memory-impact-path">
                <p className="text-xs font-medium">{tt('roles.memoryImpactPath', 'Impact path')}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    {
                      label: tt('roles.memoryImpactProposal', 'Proposal'),
                      value: memoryDetail?.proposal?.status ?? ((memoryDetail?.proposals?.length ?? 0) > 0 ? tt('roles.memoryImpactProposalCount', '{{count}} linked', { count: memoryDetail?.proposals?.length ?? 0 }) : tt('roles.memoryImpactNoProposal', 'none')),
                      tone: 'border-blue-500/20 bg-blue-500/5 text-blue-700 dark:text-blue-400',
                    },
                    {
                      label: tt('roles.memoryImpactGovernance', 'Governance'),
                      value: memoryDetail?.proposal?.reasonSummary ?? memoryDetail?.card?.status ?? tt('roles.memoryImpactNoGovernance', 'no active decision'),
                      tone: 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400',
                    },
                    {
                      label: tt('roles.memoryImpactRuntime', 'Runtime'),
                      value: (memoryDetail?.injections?.length ?? 0) > 0
                        ? tt('roles.memoryImpactRuntimeCount', '{{count}} recent runs', { count: memoryDetail?.injections?.length ?? 0 })
                        : tt('roles.memoryImpactRuntimeNone', 'not injected recently'),
                      tone: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
                    },
                    {
                      label: tt('roles.memoryImpactLifecycle', 'Lifecycle'),
                      value: memoryDetail?.retention?.recommendedAction ?? tt('roles.memoryImpactLifecycleKeep', 'keep'),
                      tone: 'border-zinc-500/20 bg-zinc-500/5 text-zinc-700 dark:text-zinc-400',
                    },
                  ].map((item) => (
                    <div key={item.label} className={cn('min-w-0 rounded-md border px-2.5 py-2', item.tone)}>
                      <p className="text-2xs font-medium">{item.label}</p>
                      <p className="mt-1 truncate text-xs text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-surface-input p-3">
                <p className="text-xs font-medium">{tt('roles.memoryDetailHistory', 'History')}</p>
                <div className="mt-2 grid gap-2">
                  {(memoryDetail?.versions ?? []).slice(0, 4).map((version) => (
                    <div key={version.id} className="flex items-center justify-between rounded-md bg-background/70 px-2.5 py-2 text-xs">
                      <span>v{version.version}</span>
                      <span className="text-muted-foreground">{formatMemoryDate(version.createdAt)}</span>
                    </div>
                  ))}
                  {(memoryDetail?.audit ?? []).slice(0, 4).map((event) => (
                    <div key={event.id} className="flex items-center justify-between rounded-md bg-background/70 px-2.5 py-2 text-xs">
                      <span>{event.action}</span>
                      <span className="text-muted-foreground">{formatMemoryDate(event.createdAt)}</span>
                    </div>
                  ))}
                  {(memoryDetail?.versions?.length ?? 0) === 0 && (memoryDetail?.audit?.length ?? 0) === 0 && (
                    <p className="text-xs text-muted-foreground">{tt('roles.memoryNoHistory', 'No history recorded yet.')}</p>
                  )}
                </div>
              </div>

              {memoryDetail?.injections?.length ? (
                <div className="rounded-md border border-border/60 bg-surface-input p-3">
                  <p className="text-xs font-medium">{tt('roles.memoryDetailRuntimeImpact', 'Runtime impact')}</p>
                  <div className="mt-2 space-y-2">
                    {memoryDetail.injections.slice(0, 3).map((injection) => (
                      <div key={injection.id} className="rounded-md bg-background/70 px-2.5 py-2">
                        <div className="flex items-center justify-between text-2xs text-muted-foreground">
                          <span>{injection.policyVersion ?? 'v1'}</span>
                          <span>{formatMemoryDate(injection.createdAt)}</span>
                        </div>
                        {(injection.candidateExplanations ?? []).slice(0, 2).map((candidate) => (
                          <p key={candidate.cardId} className="mt-1 text-2xs text-muted-foreground">
                            {candidate.injectionClass ? `${candidate.injectionClass} · ` : ''}{candidate.selected ? tt('roles.memorySelected', 'selected') : tt('roles.memorySkipped', 'skipped')} · {candidate.score.toFixed(2)}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={memoryDeleteTarget !== null}
        title={tt('roles.memoryDeleteTitle', 'Delete memory?')}
        message={tt('roles.memoryDeleteHint', 'This removes the memory from retrieval and injection and records a tombstone so the audit trail remains. It does not immediately erase stored content.')}
        confirmLabel={tt('common:actions.delete', 'Delete')}
        cancelLabel={tt('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={confirmDeleteRoleMemory}
        onCancel={() => setMemoryDeleteTarget(null)}
        onError={(error) => toast.error(String(error))}
      />
    </Card>
  );
}
