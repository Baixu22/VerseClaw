import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { tmpdir } from 'node:os';

// Area 5 §3.4 — roleTags tests. Verifies:
//   - roleTags round-trip through create/get/update
//   - normalization (dedupe, trim, filter-empty, non-string rejection)
//   - ranking shaping in listDrafts and search (ranking-only, never filter-out)
//   - inbox → draft promotion carries roleTags forward
//   - default-off: absent roleTags → field omitted, not undefined

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => null),
}));

const root = join(tmpdir(), `clawx-kb-roletags-test-${Date.now()}`);

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => root,
  getDataDir: () => join(root, 'userData'),
}));

async function getApi(gatewayManager: unknown = null) {
  const mod = await import('@electron/services/knowledge-api');
  return mod.createKnowledgeApi({ gatewayManager: gatewayManager as never });
}

describe('Area 5 §3.4 — roleTags', () => {
  beforeEach(async () => {
    closeOpenClawStateDatabaseForTest();
    const mod = await import('@electron/services/knowledge-api');
    mod.__resetKnowledgeGovernanceForTests();
    mod.__resetGovernanceWriterQueueForTests();
    mod.__resetHostGovernedAdaptersForTests();
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
    rmSync(root, { recursive: true, force: true });
  });

  describe('createDraft roleTags', () => {
    it('preserves roleTags through create → get round-trip', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Role-scoped note',
        body: 'Body content for the planner role.',
        roleTags: ['planner', 'architect'],
      });
      expect(created.success).toBe(true);
      expect(created.draft?.roleTags).toEqual(['planner', 'architect']);

      const fetched = await api.getDraft({ id: created.draft!.id });
      expect(fetched.success).toBe(true);
      expect(fetched.draft?.roleTags).toEqual(['planner', 'architect']);
    });

    it('omits roleTags field when not provided (default-off)', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Untagged note',
        body: 'No role binding.',
      });
      expect(created.success).toBe(true);
      expect(created.draft?.roleTags).toBeUndefined();
    });

    it('normalizes roleTags: dedupe, trim, filter empty/non-string', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Messy tags',
        body: 'Body.',
        // @ts-expect-error — intentionally malformed input
        roleTags: ['planner', '  planner  ', '', 'architect', 123, null, 'planner'],
      });
      expect(created.success).toBe(true);
      expect(created.draft?.roleTags).toEqual(['planner', 'architect']);
    });

    it('omits roleTags when payload array is empty after normalization', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Empty tags',
        body: 'Body.',
        roleTags: ['', '  ', ''],
      });
      expect(created.success).toBe(true);
      expect(created.draft?.roleTags).toBeUndefined();
    });
  });

  describe('updateDraft roleTags', () => {
    it('updates roleTags on an existing draft', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Draft',
        body: 'Body.',
        roleTags: ['planner'],
      });
      const updated = await api.updateDraft({
        id: created.draft!.id,
        roleTags: ['researcher', 'planner'],
      });
      expect(updated.success).toBe(true);
      expect(updated.draft?.roleTags).toEqual(['researcher', 'planner']);
    });

    it('removes roleTags when updated with an empty array', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Draft',
        body: 'Body.',
        roleTags: ['planner'],
      });
      expect(created.draft?.roleTags).toEqual(['planner']);

      const updated = await api.updateDraft({
        id: created.draft!.id,
        roleTags: [],
      });
      expect(updated.success).toBe(true);
      expect(updated.draft?.roleTags).toBeUndefined();
    });

    it('preserves existing roleTags when payload omits the field', async () => {
      const api = await getApi();
      const created = await api.createDraft({
        title: 'Draft',
        body: 'Body.',
        roleTags: ['planner'],
      });
      const updated = await api.updateDraft({
        id: created.draft!.id,
        title: 'Updated title',
      });
      expect(updated.success).toBe(true);
      expect(updated.draft?.title).toBe('Updated title');
      expect(updated.draft?.roleTags).toEqual(['planner']);
    });
  });

  describe('createInboxItem roleTags', () => {
    it('preserves roleTags through create round-trip', async () => {
      const api = await getApi();
      const created = await api.createInboxItem({
        title: 'Inbox role note',
        body: 'Body.',
        roleTags: ['data-scientist'],
      });
      expect(created.success).toBe(true);
      expect(created.item?.roleTags).toEqual(['data-scientist']);
    });

    it('omits roleTags when not provided', async () => {
      const api = await getApi();
      const created = await api.createInboxItem({
        title: 'Untagged inbox',
        body: 'Body.',
      });
      expect(created.success).toBe(true);
      expect(created.item?.roleTags).toBeUndefined();
    });

    it('normalizes roleTags', async () => {
      const api = await getApi();
      const created = await api.createInboxItem({
        title: 'Messy',
        body: 'Body.',
        // @ts-expect-error — intentionally malformed
        roleTags: ['planner', 'planner', '  ', 42],
      });
      expect(created.success).toBe(true);
      expect(created.item?.roleTags).toEqual(['planner']);
    });
  });

  describe('updateInboxItem roleTags', () => {
    it('updates roleTags on a pending inbox item', async () => {
      const api = await getApi();
      const created = await api.createInboxItem({
        title: 'Inbox',
        body: 'Body.',
      });
      const updated = await api.updateInboxItem({
        id: created.item!.id,
        roleTags: ['reviewer'],
      });
      expect(updated.success).toBe(true);
      expect(updated.item?.roleTags).toEqual(['reviewer']);
    });

    it('removes roleTags when updated with an empty array', async () => {
      const api = await getApi();
      const created = await api.createInboxItem({
        title: 'Inbox',
        body: 'Body.',
        roleTags: ['planner'],
      });
      const updated = await api.updateInboxItem({
        id: created.item!.id,
        roleTags: [],
      });
      expect(updated.success).toBe(true);
      expect(updated.item?.roleTags).toBeUndefined();
    });
  });

  describe('listDrafts roleTag ranking shaping', () => {
    it('ranks drafts matching the roleTag first; others remain visible', async () => {
      const api = await getApi();
      // Use a unique workspaceId so this test is isolated from other tests'
      // drafts on disk (beforeEach cleanup can be unreliable on Windows).
      const workspaceId = `ws-ranking-${Date.now()}`;
      // Create drafts: untagged, planner-tagged, untagged, planner-tagged.
      await api.createDraft({ title: 'A-untagged', body: 'Body.', workspaceId, roleTags: [] });
      const plannerA = await api.createDraft({ title: 'B-planner', body: 'Body.', workspaceId, roleTags: ['planner'] });
      await api.createDraft({ title: 'C-untagged', body: 'Body.', workspaceId });
      const plannerB = await api.createDraft({ title: 'D-planner', body: 'Body.', workspaceId, roleTags: ['planner', 'architect'] });

      const result = await api.listDrafts({ workspaceId, roleTag: 'planner' });
      expect(result.success).toBe(true);
      expect(result.drafts).toHaveLength(4);
      // The two planner-tagged drafts must rank first.
      const firstTwoIds = new Set([result.drafts[0].id, result.drafts[1].id]);
      expect(firstTwoIds).toEqual(new Set([plannerA.draft!.id, plannerB.draft!.id]));
      expect(result.drafts[0].roleTags).toContain('planner');
      expect(result.drafts[1].roleTags).toContain('planner');
      // The untagged drafts remain visible (ranking-only, not filter-out).
      const lastTwoTitles = new Set([result.drafts[2].title, result.drafts[3].title]);
      expect(lastTwoTitles).toEqual(new Set(['A-untagged', 'C-untagged']));
      expect(result.drafts[2].roleTags).toBeUndefined();
      expect(result.drafts[3].roleTags).toBeUndefined();
    });

    it('preserves original order when roleTag is not requested', async () => {
      const api = await getApi();
      const workspaceId = `ws-no-tag-${Date.now()}`;
      const a = await api.createDraft({ title: 'A', body: 'Body.', workspaceId });
      const b = await api.createDraft({ title: 'B', body: 'Body.', workspaceId, roleTags: ['planner'] });
      const c = await api.createDraft({ title: 'C', body: 'Body.', workspaceId });

      // Without roleTag, the order should match the default sort (updatedAt desc).
      const unfiltered = await api.listDrafts({ workspaceId });
      const withEmptyTag = await api.listDrafts({ workspaceId, roleTag: undefined });
      expect(unfiltered.success).toBe(true);
      expect(withEmptyTag.success).toBe(true);
      expect(unfiltered.drafts).toHaveLength(3);
      expect(withEmptyTag.drafts.map((d) => d.id)).toEqual(unfiltered.drafts.map((d) => d.id));
      // All three drafts are present.
      const ids = new Set(withEmptyTag.drafts.map((d) => d.id));
      expect(ids).toEqual(new Set([a.draft!.id, b.draft!.id, c.draft!.id]));
    });

    it('preserves original order when roleTag matches nothing', async () => {
      const api = await getApi();
      const workspaceId = `ws-no-match-${Date.now()}`;
      const a = await api.createDraft({ title: 'A', body: 'Body.', workspaceId });
      const b = await api.createDraft({ title: 'B', body: 'Body.', workspaceId });

      const unfiltered = await api.listDrafts({ workspaceId });
      const withNonMatchingTag = await api.listDrafts({ workspaceId, roleTag: 'nonexistent-role' });
      expect(unfiltered.success).toBe(true);
      expect(withNonMatchingTag.success).toBe(true);
      expect(unfiltered.drafts).toHaveLength(2);
      // When roleTag matches nothing, the order is identical to no roleTag.
      expect(withNonMatchingTag.drafts.map((d) => d.id)).toEqual(unfiltered.drafts.map((d) => d.id));
      const ids = new Set(withNonMatchingTag.drafts.map((d) => d.id));
      expect(ids).toEqual(new Set([a.draft!.id, b.draft!.id]));
    });
  });

  describe('search roleTag ranking shaping (best-effort)', () => {
    it('ranks wiki search results carrying matching roleTags first', async () => {
      const gatewayManager = {
        rpc: vi.fn(async () => ({
          results: [
            { id: 'p1', title: 'Untagged page' },
            { id: 'p2', title: 'Planner page', roleTags: ['planner'] },
            { id: 'p3', title: 'Other page', roleTags: ['reviewer'] },
            { id: 'p4', title: 'Planner+arch page', roleTags: ['planner', 'architect'] },
          ],
        })),
      };
      const api = await getApi(gatewayManager);
      const result = await api.search({ query: 'test', roleTag: 'planner' });
      const results = result.results;
      expect(result.success).toBe(true);
      expect(results).toHaveLength(4);
      // Planner-tagged results rank first (stable among themselves).
      expect((results?.[0] as { id: string }).id).toBe('p2');
      expect((results?.[1] as { id: string }).id).toBe('p4');
      // Non-matching results remain visible.
      expect((results?.[2] as { id: string }).id).toBe('p1');
      expect((results?.[3] as { id: string }).id).toBe('p3');
    });

    it('does not reorder when roleTag is absent', async () => {
      const gatewayManager = {
        rpc: vi.fn(async () => ({
          results: [
            { id: 'p1', title: 'A' },
            { id: 'p2', title: 'B', roleTags: ['planner'] },
          ],
        })),
      };
      const api = await getApi(gatewayManager);
      const result = await api.search({ query: 'test' });
      const results = result.results;
      expect(result.success).toBe(true);
      expect((results?.[0] as { id: string }).id).toBe('p1');
      expect((results?.[1] as { id: string }).id).toBe('p2');
    });

    it('does not reorder when no results carry roleTags', async () => {
      const gatewayManager = {
        rpc: vi.fn(async () => ({
          results: [
            { id: 'p1', title: 'A' },
            { id: 'p2', title: 'B' },
          ],
        })),
      };
      const api = await getApi(gatewayManager);
      const result = await api.search({ query: 'test', roleTag: 'planner' });
      const results = result.results;
      expect(result.success).toBe(true);
      expect((results?.[0] as { id: string }).id).toBe('p1');
      expect((results?.[1] as { id: string }).id).toBe('p2');
    });
  });

  describe('inbox → draft promotion carries roleTags forward', () => {
    it('preserves roleTags when promoting an inbox item to a draft', async () => {
      const api = await getApi();
      const inbox = await api.createInboxItem({
        title: 'Promote me',
        body: 'Body.',
        roleTags: ['planner', 'architect'],
      });
      expect(inbox.item?.roleTags).toEqual(['planner', 'architect']);

      const promoted = await api.promoteInboxItemToDraft({ id: inbox.item!.id });
      expect(promoted.success).toBe(true);
      expect(promoted.draft?.roleTags).toEqual(['planner', 'architect']);
    });

    it('omits roleTags on the draft when the inbox item had none', async () => {
      const api = await getApi();
      const inbox = await api.createInboxItem({
        title: 'Untagged promote',
        body: 'Body.',
      });
      const promoted = await api.promoteInboxItemToDraft({ id: inbox.item!.id });
      expect(promoted.success).toBe(true);
      expect(promoted.draft?.roleTags).toBeUndefined();
    });
  });
});
