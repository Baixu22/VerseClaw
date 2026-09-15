import type { KnowledgeChangeProposal, KnowledgeDraft, KnowledgeInboxItem } from '@/lib/host-api';

export type KnowledgeReviewKind = 'inbox' | 'draft' | 'proposal';
export type KnowledgeReviewItem = {
  key: string;
  kind: KnowledgeReviewKind;
  id: string;
  title: string;
  summary: string;
  status: KnowledgeInboxItem['status'] | KnowledgeDraft['status'] | KnowledgeChangeProposal['status'];
  updatedAt: string;
  draftId?: string;
};

export function projectKnowledgeReviewItems({ inboxItems, drafts, proposals }: {
  inboxItems: readonly Pick<KnowledgeInboxItem, 'id' | 'title' | 'body' | 'status' | 'updatedAt'>[];
  drafts: readonly Pick<KnowledgeDraft, 'id' | 'title' | 'body' | 'status' | 'updatedAt'>[];
  proposals: readonly Pick<KnowledgeChangeProposal, 'id' | 'draftId' | 'reason' | 'status' | 'updatedAt'>[];
}): KnowledgeReviewItem[] {
  const titles = new Map(drafts.map((draft) => [draft.id, draft.title]));
  const summarize = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 180);
  const items: KnowledgeReviewItem[] = [
    ...inboxItems.map((item) => ({ ...item, key: `inbox:${item.id}`, kind: 'inbox' as const, summary: summarize(item.body) })),
    ...drafts.map((item) => ({ ...item, key: `draft:${item.id}`, kind: 'draft' as const, summary: summarize(item.body) })),
    ...proposals.map((item) => ({
      ...item, key: `proposal:${item.id}`, kind: 'proposal' as const,
      title: (item.draftId ? titles.get(item.draftId) : undefined) || item.reason || item.id,
      summary: summarize(item.reason),
    })),
  ];
  return items.sort((left, right) => (
    (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0)
    || left.key.localeCompare(right.key)
  ));
}
