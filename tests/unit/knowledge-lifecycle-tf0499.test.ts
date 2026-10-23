import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_ADJACENT_OBJECTS,
  KNOWLEDGE_LIFECYCLE_STAGES,
  KNOWLEDGE_SOURCE_KINDS,
  describeKnowledgeLifecycleForModel,
  isKnowledgeLifecycleStage,
  isMemoryCandidateNotKnowledge,
  validateKnowledgeLifecycleEntry,
} from '../../shared/knowledge-lifecycle';

describe('TF-0499 knowledge lifecycle', () => {
  it('exposes exactly one knowledge lifecycle with SEKB as a source kind', () => {
    expect(KNOWLEDGE_LIFECYCLE_STAGES).toEqual(['source', 'draft', 'proposal', 'applied']);
    expect(KNOWLEDGE_SOURCE_KINDS).toContain('runtime-lesson');
    // SEKB must not appear as a second review queue or parallel stage.
    expect(KNOWLEDGE_LIFECYCLE_STAGES.some((stage) => /sekb/i.test(stage))).toBe(false);
  });

  it('keeps a memory candidate outside the knowledge lifecycle', () => {
    expect(KNOWLEDGE_ADJACENT_OBJECTS).toEqual(['memory-candidate']);
    expect(isKnowledgeLifecycleStage('memory-candidate')).toBe(false);
    expect(isMemoryCandidateNotKnowledge('memory-candidate')).toBe(true);
    expect(isMemoryCandidateNotKnowledge('memoryCandidate')).toBe(true);
  });

  it('requires evidence references for applied knowledge', () => {
    expect(validateKnowledgeLifecycleEntry({ id: 'k-1', stage: 'applied', evidenceRefs: [] }))
      .toEqual([expect.objectContaining({ code: 'applied_knowledge_evidence_missing' })]);
    expect(validateKnowledgeLifecycleEntry({ id: 'k-2', stage: 'applied', evidenceRefs: ['trajectory:1'] }))
      .toEqual([]);
  });

  it('describes every stage to the model without conflating memory candidates', () => {
    const description = describeKnowledgeLifecycleForModel();
    for (const stage of KNOWLEDGE_LIFECYCLE_STAGES) expect(description).toContain(stage);
    expect(description).toContain('runtime-lesson');
    expect(description).toContain('memory candidate is not knowledge');
  });
});
