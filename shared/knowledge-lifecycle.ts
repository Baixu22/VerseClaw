/**
 * TF-0499: one knowledge lifecycle vocabulary.
 *
 * Knowledge owns sources, drafts, proposals and applied records. SEKB runtime
 * lessons enter that same lifecycle as a `source` of kind `runtime-lesson`;
 * they are never a second review queue and never a parallel status axis.
 * A memory candidate is a different object: it belongs to memory, not to
 * knowledge, and must never be reported with a knowledge status.
 */
export const KNOWLEDGE_LIFECYCLE_STAGES = ['source', 'draft', 'proposal', 'applied'] as const;
export type KnowledgeLifecycleStage = (typeof KNOWLEDGE_LIFECYCLE_STAGES)[number];

export const KNOWLEDGE_SOURCE_KINDS = ['document', 'web', 'bundle', 'runtime-lesson', 'manual'] as const;
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

/** The only non-knowledge object the model may encounter next to knowledge. */
export const KNOWLEDGE_ADJACENT_OBJECTS = ['memory-candidate'] as const;
export type KnowledgeAdjacentObject = (typeof KNOWLEDGE_ADJACENT_OBJECTS)[number];

export type KnowledgeLifecycleObject = {
  stage: KnowledgeLifecycleStage;
  sourceKind?: KnowledgeSourceKind;
  terminal: boolean;
  reviewable: boolean;
  userVisible: boolean;
};

export type KnowledgeLifecycleEntry = {
  id: string;
  stage: KnowledgeLifecycleStage;
  sourceKind?: KnowledgeSourceKind;
  /** Evidence references that justified this entry; never empty for SEKB entries. */
  evidenceRefs: readonly string[];
};

export type KnowledgeLifecycleIssue = {
  code: string;
  message: string;
  id?: string;
};

/**
 * Canonical description of each stage. This is the single source the model
 * self-description and the Knowledge UI are expected to agree with.
 */
export const KNOWLEDGE_LIFECYCLE_STAGES_DESCRIPTION: Readonly<Record<KnowledgeLifecycleStage, KnowledgeLifecycleObject>> = {
  source: { stage: 'source', terminal: false, reviewable: true, userVisible: true },
  draft: { stage: 'draft', terminal: false, reviewable: true, userVisible: true },
  proposal: { stage: 'proposal', terminal: false, reviewable: true, userVisible: true },
  applied: { stage: 'applied', terminal: true, reviewable: false, userVisible: true },
};

export function isKnowledgeLifecycleStage(value: unknown): value is KnowledgeLifecycleStage {
  return typeof value === 'string' && (KNOWLEDGE_LIFECYCLE_STAGES as readonly string[]).includes(value);
}

export function isKnowledgeAdjacentObject(value: unknown): value is KnowledgeAdjacentObject {
  return typeof value === 'string' && (KNOWLEDGE_ADJACENT_OBJECTS as readonly string[]).includes(value);
}

/** A memory candidate is never a knowledge stage. */
export function isMemoryCandidateNotKnowledge(value: unknown): boolean {
  if (value === 'memory-candidate' || value === 'memoryCandidate') return true;
  return typeof value === 'string' && /^memory[-_ ]?candidate$/iu.test(value.trim());
}

export function validateKnowledgeLifecycleEntry(entry: KnowledgeLifecycleEntry): KnowledgeLifecycleIssue[] {
  const issues: KnowledgeLifecycleIssue[] = [];
  if (!entry.id || !entry.id.trim()) {
    issues.push({ code: 'knowledge_entry_id_missing', message: 'knowledge entry id is required' });
  }
  if (!isKnowledgeLifecycleStage(entry.stage)) {
    issues.push({ code: 'knowledge_stage_invalid', message: 'unknown knowledge lifecycle stage', id: entry.id });
    return issues;
  }
  if (isMemoryCandidateNotKnowledge(entry.stage)) {
    issues.push({ code: 'memory_candidate_is_not_knowledge', message: 'a memory candidate cannot carry a knowledge stage', id: entry.id });
  }
  if (entry.sourceKind !== undefined && !(KNOWLEDGE_SOURCE_KINDS as readonly string[]).includes(entry.sourceKind)) {
    issues.push({ code: 'knowledge_source_kind_invalid', message: 'unknown knowledge source kind', id: entry.id });
  }
  if (entry.stage === 'applied' && entry.evidenceRefs.length === 0) {
    issues.push({ code: 'applied_knowledge_evidence_missing', message: 'an applied knowledge record needs at least one evidence reference', id: entry.id });
  }
  return issues;
}

/** Compact, non-user-facing model projection: exactly the four stages plus the adjacent object. */
export function describeKnowledgeLifecycleForModel(): string {
  return [
    'Knowledge lifecycle: source -> draft -> proposal -> applied.',
    'Runtime lessons (SEKB) enter as a source of kind runtime-lesson; they are not a separate review queue.',
    'A memory candidate is not knowledge and never carries a knowledge status.',
  ].join(' ');
}
