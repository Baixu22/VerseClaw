import { describe, expect, it } from 'vitest';
import {
  buildGroundedLibrarianAnswer,
  createDraftPayloadFromGroundedAnswer,
  createErrorExperienceInboxPayloadFromGroundedAnswer,
  groundedAnswerMarkdown,
  type KnowledgeLibrarianGroundedSource,
} from '@/lib/knowledge-librarian';

const messages = {
  answerIntro: 'Found sources:',
  answerBoundary: 'Review before durable knowledge.',
  noAnswer: 'No matching page.',
  missingSources: 'No source was found.',
  pageSnippetGrounding: 'Grounding is page/snippet level.',
  suggestionSaveDraft: 'Save a draft.',
  suggestionCreateErrorExperience: 'Create an error experience.',
  suggestionSendToSteward: 'Ask steward.',
  suggestionBroadenSearch: 'Broaden search.',
};

const source: KnowledgeLibrarianGroundedSource = {
  id: 'notes/decision.md',
  lookup: 'notes/decision.md',
  title: 'Decision note',
  path: 'notes/decision.md',
  excerpt: 'Use the governed Knowledge review path.',
  corpus: 'wiki',
  score: 0.82,
};

describe('knowledge librarian grounded answers', () => {
  it('formats grounded answers with sections and retrieval inspection', () => {
    const answer = buildGroundedLibrarianAnswer({
      question: 'Why use governed knowledge?',
      sources: [source],
      resultCount: 1,
      corpus: 'wiki',
      roleTag: 'knowledge-librarian',
      messages,
    });

    expect(answer.groundingStatus).toBe('partial');
    expect(answer.confidence).toBeUndefined();
    expect(answer.sources).toEqual([source]);
    expect(answer.unknowns).toContain('Grounding is page/snippet level.');
    expect(answer.retrieval).toMatchObject({
      query: 'Why use governed knowledge?',
      corpus: 'wiki',
      roleTag: 'knowledge-librarian',
      resultCount: 1,
    });

    const markdown = groundedAnswerMarkdown(answer);
    expect(markdown).toContain('## Answer');
    expect(markdown).toContain('## Sources used');
    expect(markdown).toContain('Decision note (notes/decision.md)');
    expect(markdown).toContain('## Unknowns / missing sources');
    expect(markdown).toContain('## Suggested next action');
  });

  it('labels missing sources and keeps candidate payloads reviewable', () => {
    const answer = buildGroundedLibrarianAnswer({
      question: 'What happened in the unknown incident?',
      sources: [],
      resultCount: 0,
      messages,
    });

    expect(answer.groundingStatus).toBe('missing_sources');
    expect(answer.confidence).toBeUndefined();
    expect(answer.unknowns).toEqual(['No source was found.']);
    expect(answer.nextActions).toEqual(['Broaden search.']);

    const draft = createDraftPayloadFromGroundedAnswer(answer, { titlePrefix: 'Grounded answer' });
    expect(draft).toMatchObject({
      title: 'Grounded answer: What happened in the unknown incident?',
      type: 'synthesis',
      createdBy: 'agent',
      metadata: {
        knowledgeKind: 'librarian-grounded-answer',
        groundingStatus: 'missing_sources',
      },
    });

    const inbox = createErrorExperienceInboxPayloadFromGroundedAnswer(answer, { titlePrefix: 'Experience' });
    expect(inbox.kind).toBe('manual');
    expect(inbox.type).toBe('troubleshooting');
    expect(inbox.metadata?.knowledgeKind).toBe('error-experience');
    expect(inbox.metadata?.errorExperience).toMatchObject({
      schemaVersion: 1,
      applicability: { severity: 'medium' },
      effectiveness: {
        hitCount: 0,
        acceptedCount: 0,
        dismissedCount: 0,
        preventedFailureCount: 0,
        staleCount: 0,
      },
    });
    expect(inbox.warnings).toEqual(['No source citation was available when this candidate was created.']);
    expect((inbox.metadata?.errorExperience as { applicability: { confidence?: number } }).applicability.confidence).toBeUndefined();
  });
});
