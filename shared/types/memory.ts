export type MemorySemanticCardType =
  | 'fact'
  | 'constraint'
  | 'preference'
  | 'procedure'
  | 'risk'
  | 'decision'
  | 'episode'
  | 'handoff'
  | 'artifact_ref';
export type MemoryLegacyCardType = 'project_fact' | 'role_experience' | 'episodic' | 'procedural';
export type MemoryCardType = MemorySemanticCardType | MemoryLegacyCardType;
export type MemoryCardScope = 'global' | 'project' | 'workspace' | 'agent' | 'team' | 'role' | 'session' | 'task' | 'user';
export type MemoryCardStatus = 'active' | 'cold' | 'archived' | 'tombstone';
export type MemoryCardSensitivity = 'normal' | 'sensitive' | 'secret_adjacent' | 'secret';
export type MemoryCardDurability = 'ephemeral' | 'session' | 'project' | 'long_term';
export type MemoryCardSource = 'user' | 'role' | 'system' | 'trace' | 'session_summary';
export type MemoryPhaseTag = 'plan' | 'implement' | 'test' | 'review' | 'security' | 'docs' | 'handoff';
export type MemoryConflictType =
  | 'duplicate'
  | 'contradiction'
  | 'scope_conflict'
  | 'stale_conflict'
  | 'role_conflict'
  | 'permission_conflict'
  | 'sensitive_review';
export type MemoryGatekeeperAction = 'accept' | 'reject' | 'merge' | 'supersede' | 'needs_review';
export type MemoryProposalOperation = 'create' | 'update' | 'archive' | 'supersede' | 'tombstone';
export type MemoryProposalStatus = 'pending' | 'auto_accepted' | 'rejected' | 'needs_review' | 'approved' | 'applied';
export type MemoryReviewAction = 'approve' | 'reject' | 'applyAsCold' | 'supersede' | 'merge';
export type MemoryPermissionDecision = 'allow' | 'needs_review' | 'reject';
export type MemoryRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type MemorySuggestedAction = 'approve' | 'applyAsCold' | 'reject' | 'merge' | 'supersede';
export type MemoryInjectionClass = 'must' | 'should' | 'may' | 'never';
export type MemoryRetentionAction = 'keep' | 'cold' | 'archive' | 'tombstone' | 'review';
export type MemoryEvidenceStatus = 'verified' | 'missing' | 'stale' | 'weak' | 'contradicted' | 'unchecked';
export type MemoryFeedbackOutcome = 'helpful' | 'neutral' | 'harmful' | 'missing_needed' | 'user_corrected';
export type MemoryTaskSuccess = 'success' | 'partial' | 'failure' | 'unknown';
export type MemoryDataQuality = 'insufficient' | 'partial' | 'strong';

export type MemoryEvidenceRef = {
  type: 'file' | 'trace' | 'session' | 'tool' | 'memory_search' | 'memory_md' | 'qmd' | 'dream' | 'manual';
  ref: string;
  excerpt?: string;
};

export type MemoryCard = {
  id: string;
  type: MemoryCardType;
  scope: MemoryCardScope;
  scopeKey?: string | null;
  roleTags: string[];
  ownerRole?: string | null;
  sourceRole?: string | null;
  applicableRoles?: string[];
  allowedMutators?: string[];
  phaseTags?: MemoryPhaseTag[];
  content: string;
  evidence: string[];
  evidenceRefs?: MemoryEvidenceRef[];
  confidence: number;
  importance: number;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt?: string;
  accessCount: number;
  version: number;
  status: MemoryCardStatus;
  sensitivity?: MemoryCardSensitivity;
  durability?: MemoryCardDurability;
  source?: MemoryCardSource;
  supersedes?: string | null;
  supersededBy?: string | null;
  expiresAt?: string | null;
  retentionLabels?: string[];
};

export type MemoryScoreInput = {
  semanticRelevance?: number;
  importance?: number;
  recency?: number;
  accessFrequency?: number;
  roleRelevance?: number;
  stalenessPenalty?: number;
  contradictionPenalty?: number;
};

export type ContextPackBucketName =
  | 'hardConstraints'
  | 'rolePlaybook'
  | 'projectFacts'
  | 'teamHandoffs'
  | 'recentEpisodes'
  | 'openConflicts'
  | 'taskState';

export type ContextPackBuckets = Record<ContextPackBucketName, string[]>;

export type ContextPackBudget = Record<ContextPackBucketName, number> & {
  total: number;
};

export type ContextPack = {
  budget: ContextPackBudget;
  buckets: ContextPackBuckets;
  estimatedTokens: Record<ContextPackBucketName, number> & { total: number };
  truncated: boolean;
  policyVersion?: string;
  candidateExplanations?: MemoryInjectionCandidateExplain[];
};

export type MemoryProposal = {
  type: MemoryCardType;
  scope: MemoryCardScope;
  scopeKey?: string | null;
  roleTags?: string[];
  ownerRole?: string | null;
  sourceRole?: string | null;
  applicableRoles?: string[];
  allowedMutators?: string[];
  phaseTags?: MemoryPhaseTag[];
  content: string;
  evidence?: string[];
  evidenceRefs?: MemoryEvidenceRef[];
  confidence?: number;
  importance?: number;
  sensitivity?: MemoryCardSensitivity;
  durability?: MemoryCardDurability;
  source?: MemoryCardSource;
  targetId?: string;
  operation?: MemoryProposalOperation;
  reason?: string;
  expiresAt?: string | null;
};

export type MemoryProposalDraft = MemoryProposal & {
  draftSource: 'manual' | 'explicit_remember' | 'trace_summary' | 'session_summary' | 'orchestration_handoff' | 'memory_search';
};

export type MemoryProposalRecord = {
  id: string;
  operation: MemoryProposalOperation;
  targetId?: string | null;
  proposal: MemoryProposal;
  normalized?: MemoryProposal;
  decision: MemoryGatekeeperAction;
  status: MemoryProposalStatus;
  reviewReason?: string | null;
  conflictIds: string[];
  riskLevel?: MemoryRiskLevel;
  impactScope?: MemoryCardScope;
  suggestedAction?: MemorySuggestedAction;
  reasonSummary?: string;
  permissionDecision?: MemoryPermissionDecision;
  permissionReason?: string;
  batchId?: string | null;
  evidenceStatus?: MemoryEvidenceStatus;
  retentionReason?: string | null;
  policySnapshot?: unknown;
  createdAt: string;
  decidedAt?: string | null;
};

export type MemoryGatekeeperDecision = {
  action: MemoryGatekeeperAction;
  accepted: boolean;
  reason?: string;
  card?: MemoryCard;
  targetId?: string;
  conflicts?: MemoryConflict[];
  proposal?: MemoryProposalRecord;
  riskLevel?: MemoryRiskLevel;
  impactScope?: MemoryCardScope;
  suggestedAction?: MemorySuggestedAction;
  reasonSummary?: string;
  permissionDecision?: MemoryPermissionDecision;
  permissionReason?: string;
};

export type MemoryProposalPreview = {
  operation: MemoryProposalOperation;
  targetId?: string | null;
  proposal: MemoryProposal;
  normalized: MemoryProposal;
  decision: MemoryGatekeeperDecision;
  conflicts: MemoryConflict[];
  evidence: MemoryEvidenceCheckResult;
  target?: MemoryCard;
  riskLevel?: MemoryRiskLevel;
  impactScope?: MemoryCardScope;
  suggestedAction?: MemorySuggestedAction;
  reasonSummary?: string;
  permissionDecision?: MemoryPermissionDecision;
  permissionReason?: string;
  wouldWrite: false;
};

export type MemoryConflict = {
  id: string;
  type: MemoryConflictType;
  cardIds: string[];
  status: 'open' | 'resolved';
  reason: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolution?: string | null;
};

export type MemoryVersionRecord = {
  id: string;
  cardId: string;
  version: number;
  snapshot: MemoryCard;
  reason?: string | null;
  createdAt: string;
};

export type MemoryAuditEvent = {
  id: string;
  action: string;
  cardId?: string | null;
  reason?: string | null;
  payload: unknown;
  createdAt: string;
};

export type MemoryInjectionCandidateExplain = {
  cardId: string;
  score: number;
  selected: boolean;
  bucket?: ContextPackBucketName;
  reason: string;
  penalties: string[];
  truncatedReason?: 'bucket_budget' | 'total_budget' | 'conflict' | 'sensitivity' | 'stale';
  injectionClass?: MemoryInjectionClass;
  whatWouldSelect?: string;
};

export type MemoryInjectionRecord = {
  id: string;
  roleName: string;
  task?: string;
  sessionKey?: string;
  cardIds: string[];
  reasons: Record<string, string>;
  budget: ContextPackBudget;
  estimatedTokens: ContextPack['estimatedTokens'];
  truncated: boolean;
  policyVersion?: string;
  selectorSnapshot?: unknown;
  candidateExplanations?: MemoryInjectionCandidateExplain[];
  createdAt: string;
};

export type MemoryFeedbackRecord = {
  id: string;
  injectionId?: string | null;
  cardId?: string | null;
  roleName?: string | null;
  outcome: MemoryFeedbackOutcome;
  taskSuccess: MemoryTaskSuccess;
  note?: string | null;
  createdAt: string;
};

export type MemoryUtilityCardReport = {
  cardId: string;
  card?: MemoryCard;
  selectedCount: number;
  skippedCount: number;
  feedbackCount: number;
  helpfulCount: number;
  neutralCount: number;
  harmfulCount: number;
  missingNeededCount: number;
  userCorrectedCount: number;
  conflictCount: number;
  retentionAction: MemoryRetentionAction;
  utilityScore: number | null;
  dataQuality: MemoryDataQuality;
  reasonSummary: string;
};

export type MemoryUtilityReport = {
  roleName?: string;
  generatedAt: string;
  dataQuality: MemoryDataQuality;
  missingEvidence: string[];
  sample: {
    cards: number;
    injections: number;
    feedback: number;
    proposals: number;
    conflicts: number;
  };
  aggregate: {
    contextPrecisionAtK: number | null;
    helpfulnessRate: number | null;
    harmRate: number | null;
    staleRate: number | null;
    conflictRate: number | null;
    reviewAcceptanceRate: number | null;
    tokenOverheadPerRun: number | null;
    taskSuccessDelta: number | null;
  };
  cards: MemoryUtilityCardReport[];
};

export type MemoryRetentionCandidate = {
  card: MemoryCard;
  recommendedAction: MemoryRetentionAction;
  retentionScore: number;
  labels: string[];
  reason: string;
};

export type MemoryEvidenceCheckRef = {
  ref: MemoryEvidenceRef;
  status: MemoryEvidenceStatus;
  reason: string;
};

export type MemoryEvidenceCheckResult = {
  id: string;
  targetKind: 'card' | 'proposal' | 'refs';
  targetId?: string | null;
  status: MemoryEvidenceStatus;
  refs: MemoryEvidenceCheckRef[];
  summary: string;
  checkedAt: string;
};

export type MemoryReviewBatchResult = {
  batchId: string;
  action: MemoryReviewAction;
  results: Array<{ id: string; ok: boolean; decision: MemoryGatekeeperDecision }>;
  createdAt: string;
};

export type MemoryConflictDetail = {
  conflict?: MemoryConflict;
  cards: MemoryCard[];
  proposals: MemoryProposalRecord[];
  evidence: MemoryEvidenceCheckResult[];
  scopePrecedence: MemoryCardScope[];
  suggestedAction: MemorySuggestedAction;
  reasonSummary: string;
};

export type MemoryMergeDraft = {
  draft: MemoryProposal;
  cardIds: string[];
  proposalIds: string[];
  suggestedAction: 'merge' | 'supersede';
  reasonSummary: string;
};

export type MemoryInjectionSimulation = {
  roleName: string;
  task?: string;
  phase?: MemoryPhaseTag;
  pack: ContextPack;
  selectedCards: MemoryCard[];
  selectorSnapshot: unknown;
};

export type MemoryHealthReport = {
  ok: boolean;
  checkedAt: string;
  checks: Array<{
    name: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
    count?: number;
  }>;
};
