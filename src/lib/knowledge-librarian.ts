import type {
  KnowledgeCreateDraftPayload,
  KnowledgeCreateInboxItemPayload,
  KnowledgeDraftType,
  KnowledgeSourceRef,
  KnowledgeSourceSetAnswerSource,
} from '@shared/host-api/contract';
import type { AnswerClaimV1, CitationV2, KnowledgeAnswerMode } from '@shared/knowledge/answer';

export type KnowledgeLibrarianGroundingStatus = 'grounded' | 'partial' | 'missing_sources';

export type KnowledgeLibrarianGroundedSource = {
  id: string;
  lookup: string;
  title: string;
  path?: string;
  excerpt: string;
  corpus?: 'wiki' | 'memory' | 'all';
  score?: number;
  reason?: string;
  citation?: KnowledgeSourceSetAnswerSource['citation'];
  answerCitation?: CitationV2;
  readRange?: KnowledgeSourceSetAnswerSource['readRange'];
  updatedAt?: string;
};

export type KnowledgeLibrarianRetrievalInspector = {
  query: string;
  corpus: 'wiki' | 'memory' | 'all';
  roleTag: string;
  resultCount: number;
  selectedSources: KnowledgeLibrarianGroundedSource[];
};

export type KnowledgeLibrarianGroundedAnswer = {
  question: string;
  answer: string;
  sources: KnowledgeLibrarianGroundedSource[];
  unknowns: string[];
  suggestions: string[];
  nextActions: string[];
  confidence?: number;
  answerMode?: KnowledgeAnswerMode;
  claims?: AnswerClaimV1[];
  groundingStatus: KnowledgeLibrarianGroundingStatus;
  retrieval: KnowledgeLibrarianRetrievalInspector;
};

export type BuildGroundedLibrarianAnswerInput = {
  question: string;
  sources: KnowledgeLibrarianGroundedSource[];
  resultCount: number;
  corpus?: 'wiki' | 'memory' | 'all';
  roleTag?: string;
  messages: {
    answerIntro: string;
    answerBoundary: string;
    noAnswer: string;
    missingSources: string;
    pageSnippetGrounding: string;
    suggestionSaveDraft: string;
    suggestionCreateErrorExperience: string;
    suggestionSendToSteward: string;
    suggestionBroadenSearch: string;
  };
};

function sourceRefsFromAnswer(answer: KnowledgeLibrarianGroundedAnswer): KnowledgeSourceRef[] {
  return answer.sources.map((source) => ({
    id: source.lookup || source.id,
    kind: 'wiki',
    label: source.title,
    path: source.path || source.lookup,
    ...(source.citation ? { revision: source.citation.revision, contentDigest: source.citation.contentDigest,
      ...(source.citation.sourceRef ? { sourceRef: source.citation.sourceRef } : {}) } : {}),
  }));
}

function sourceIdsFromAnswer(answer: KnowledgeLibrarianGroundedAnswer): string[] {
  return Array.from(new Set(answer.sources.map((source) => source.lookup || source.id).filter(Boolean)));
}

function slugText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 72);
}

function firstSentence(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const sentence = compact.match(/^.{12,220}?[.!?\u3002\uff01\uff1f](?:\s|$)/u)?.[0]?.trim();
  return sentence || (compact.length > 220 ? `${compact.slice(0, 220)}...` : compact);
}

export function buildGroundedLibrarianAnswer(input: BuildGroundedLibrarianAnswerInput): KnowledgeLibrarianGroundedAnswer {
  const sources = input.sources.slice(0, 5);
  const groundingStatus: KnowledgeLibrarianGroundingStatus = sources.length === 0
    ? 'missing_sources'
    : 'partial';
  const answer = sources.length > 0
    ? [
      input.messages.answerIntro,
      ...sources.map((source, index) => `${index + 1}. ${source.title}: ${source.excerpt}`),
      input.messages.answerBoundary,
    ].join('\n\n')
    : input.messages.noAnswer;
  const unknowns = sources.length > 0
    ? [input.messages.pageSnippetGrounding]
    : [input.messages.missingSources];
  const suggestions = sources.length > 0
    ? [
      input.messages.suggestionSaveDraft,
      input.messages.suggestionCreateErrorExperience,
      input.messages.suggestionSendToSteward,
    ]
    : [input.messages.suggestionBroadenSearch];
  return {
    question: input.question,
    answer,
    sources,
    unknowns,
    suggestions,
    nextActions: suggestions,
    groundingStatus,
    retrieval: {
      query: input.question,
      corpus: input.corpus ?? 'wiki',
      roleTag: input.roleTag ?? 'knowledge-librarian',
      resultCount: input.resultCount,
      selectedSources: sources,
    },
  };
}

export function groundedAnswerMarkdown(answer: KnowledgeLibrarianGroundedAnswer): string {
  const sourceLines = answer.sources.length > 0
    ? answer.sources.map((source, index) => `${index + 1}. ${source.title} (${source.path || source.lookup})\n   ${source.excerpt}`).join('\n')
    : '- No source matched this answer.';
  const unknownLines = answer.unknowns.map((entry) => `- ${entry}`).join('\n');
  const actionLines = answer.nextActions.map((entry) => `- ${entry}`).join('\n');
  return [
    `# Librarian answer: ${answer.question}`,
    '',
    '## Answer',
    '',
    answer.answer,
    '',
    '## Sources used',
    '',
    sourceLines,
    '',
    '## Unknowns / missing sources',
    '',
    unknownLines,
    '',
    '## Suggested next action',
    '',
    actionLines,
  ].join('\n');
}

export function createDraftPayloadFromGroundedAnswer(answer: KnowledgeLibrarianGroundedAnswer, options?: {
  titlePrefix?: string;
  type?: KnowledgeDraftType;
}): KnowledgeCreateDraftPayload {
  return {
    title: `${options?.titlePrefix ?? 'Librarian answer'}: ${answer.question}`.slice(0, 120),
    body: groundedAnswerMarkdown(answer),
    type: options?.type ?? 'synthesis',
    sourceIds: sourceIdsFromAnswer(answer),
    sourceRefs: sourceRefsFromAnswer(answer),
    tags: ['librarian', 'grounded-answer'],
    createdBy: 'agent',
    ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
    metadata: {
      knowledgeKind: 'librarian-grounded-answer',
      driven_by: 'agent', actor: 'knowledge-librarian',
      groundingStatus: answer.groundingStatus,
      retrieval: answer.retrieval,
    },
  };
}

export function createErrorExperienceInboxPayloadFromGroundedAnswer(answer: KnowledgeLibrarianGroundedAnswer, options?: {
  titlePrefix?: string;
  createdFromId?: string;
}): KnowledgeCreateInboxItemPayload {
  const primarySource = answer.sources[0];
  const keywords = Array.from(new Set([
    ...answer.question.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/u).filter((part) => part.length >= 3).slice(0, 8),
    'knowledge',
    'librarian',
  ]));
  const filePatterns = Array.from(new Set(answer.sources.flatMap((source) => {
    const path = source.path || source.lookup;
    return path ? [path] : [];
  }))).slice(0, 8);
  const title = `${options?.titlePrefix ?? 'Error experience'}: ${answer.question}`.slice(0, 120);
  const summary = firstSentence(answer.answer) || answer.question;
  const sourceRefs = sourceRefsFromAnswer(answer);
  return {
    title,
    body: groundedAnswerMarkdown(answer),
    kind: 'manual',
    type: 'troubleshooting',
    sourceIds: sourceIdsFromAnswer(answer),
    sourceRefs,
    tags: ['error-experience', 'librarian'],
    createdBy: 'agent',
    warnings: answer.sources.length === 0 ? ['No source citation was available when this candidate was created.'] : [],
    metadata: {
      knowledgeKind: 'error-experience',
      driven_by: 'agent', actor: 'knowledge-librarian',
      captureKey: `librarian:error-experience:${slugText(answer.question) || Date.now()}`,
      errorExperience: {
        schemaVersion: 1,
        id: `ee_${slugText(answer.question) || Date.now()}`,
        title,
        summary,
        triggerPattern: {
          errorType: 'logic',
          keywords,
          filePatterns,
          scenarioDescription: answer.question,
          routeQueries: [answer.question],
        },
        rootCause: {
          summary,
          contributingFactors: answer.unknowns,
        },
        resolution: {
          steps: answer.nextActions.length > 0 ? answer.nextActions : answer.suggestions,
          verificationCommands: [],
        },
        applicability: {
          projectScopes: ['current-workspace'],
          modules: filePatterns,
          roles: ['knowledge-librarian'],
          confidence: answer.confidence,
          severity: 'medium',
        },
        provenance: {
          createdFrom: {
            kind: 'manual',
            id: options?.createdFromId ?? answer.question,
            label: 'Knowledge Librarian grounded answer',
          },
          sourceRefs: sourceRefs.length > 0
            ? sourceRefs.map((source) => ({ id: source.id, kind: source.kind ?? 'wiki', label: source.label, path: source.path }))
            : [{ id: primarySource?.lookup ?? answer.question, kind: 'manual', label: answer.question }],
          createdAt: new Date().toISOString(),
        },
        effectiveness: {
          hitCount: 0,
          acceptedCount: 0,
          dismissedCount: 0,
          preventedFailureCount: 0,
          staleCount: 0,
        },
      },
    },
  };
}
