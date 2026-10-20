import { describe, expect, it } from 'vitest';
import { knowledgeHostApi } from '@/lib/host-api/knowledge';

describe('knowledge host API split', () => {
  it('keeps the knowledge surface composed from domain modules', () => {
    expect(knowledgeHostApi.routeContext).toBeTypeOf('function');
    expect(knowledgeHostApi.createInboxItem).toBeTypeOf('function');
    expect(knowledgeHostApi.createDraft).toBeTypeOf('function');
    expect(knowledgeHostApi.stewardReview).toBeTypeOf('function');
    expect(knowledgeHostApi.runtimeLessonsReport).toBeTypeOf('function');
    expect(knowledgeHostApi.answerFromSourceSet).toBeTypeOf('function');
    expect(knowledgeHostApi.listWatchedDirectories).toBeTypeOf('function');
    expect(knowledgeHostApi.recordKnowledgeReference).toBeTypeOf('function');
  });
});
