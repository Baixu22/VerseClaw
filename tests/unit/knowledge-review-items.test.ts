// @vitest-environment node
import { expect, it } from 'vitest';
import { projectKnowledgeReviewItems } from '@/lib/knowledge-review-items';

it('projects distinct source identities and resolves proposal titles without mutating source DTOs', () => {
  const inboxItems = [{ id: 'same', title: 'Candidate', body: 'Source\ncontext', status: 'pending' as const, updatedAt: '2026-09-10T00:00:00Z' }];
  const drafts = [{ id: 'same', title: 'Reviewed draft', body: 'Draft body', status: 'steward_reviewed' as const, updatedAt: '2026-09-11T00:00:00Z' }];
  const proposals = [{ id: 'same', draftId: 'same', reason: 'Preserve the citation', status: 'proposed' as const, updatedAt: '2026-09-12T00:00:00Z' }];
  const before = JSON.stringify({ inboxItems, drafts, proposals });
  const items = projectKnowledgeReviewItems({ inboxItems, drafts, proposals });
  expect(items.map((item) => item.key)).toEqual(['proposal:same', 'draft:same', 'inbox:same']);
  expect(items[0]).toMatchObject({ title: 'Reviewed draft', draftId: 'same', status: 'proposed' });
  expect(items[2].summary).toBe('Source context');
  expect(JSON.stringify({ inboxItems, drafts, proposals })).toBe(before);
});

it('keeps a draftless proposal identifiable and orders unknown dates deterministically', () => {
  const items = projectKnowledgeReviewItems({ inboxItems: [], drafts: [], proposals: [
    { id: 'b', reason: '', status: 'approved', updatedAt: '' },
    { id: 'a', reason: 'Archive outdated page', status: 'proposed', updatedAt: 'invalid' },
  ] });
  expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  expect(items[1]).toMatchObject({ title: 'b', kind: 'proposal' });
  expect(items[1].draftId).toBeUndefined();
});
