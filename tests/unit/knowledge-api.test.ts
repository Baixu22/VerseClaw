import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(async () => ''),
  },
}));

const root = join(tmpdir(), `clawx-knowledge-api-${Date.now()}`);

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => root,
}));

describe('knowledge host API', () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('wraps wiki.status and reports Gateway failures', async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ vaultExists: true })
        .mockRejectedValueOnce(new Error('gateway unavailable')),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    await expect(api.status()).resolves.toEqual({
      success: true,
      status: { vaultExists: true },
    });
    await expect(api.status()).resolves.toMatchObject({
      success: false,
      error: 'gateway unavailable',
    });
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(1, 'wiki.status', {}, 12000);
  });

  it('returns a read-only SEKB runtime lessons report without Gateway writes', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('runtime lessons report must not call Gateway RPC');
      }),
    };
    const runtimeLessonsReporter = vi.fn(async () => ({
      success: true,
      available: true,
      counts: { trajectories: 3, undistilledTrajectories: 2, activePrinciples: 1 },
      undistilled: [{
        trajectory_id: 'traj-1',
        created_at: '2026-07-06T00:00:00.000Z',
        task_intent: 'Fix failing Knowledge import',
        task_type: 'coding',
        context_fingerprint: ['knowledge', 'sekb'],
        outcome: 'failure',
        error_signature: 'TypeError::missing_runtime_report',
      }],
      activePrinciples: [{
        principle_id: 'pr-1',
        title: 'Check runtime report before editing Knowledge UI',
        task_types: ['coding'],
        context_tags: ['knowledge'],
        criticality: 'medium',
        retrieval_count: 4,
        adoption_count: 2,
      }],
      indexPreview: 'SEKB L1 index preview',
    }));
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never, runtimeLessonsReporter });

    await expect(api.runtimeLessonsReport()).resolves.toMatchObject({
      success: true,
      available: true,
      counts: { trajectories: 3, undistilledTrajectories: 2, activePrinciples: 1 },
      undistilled: [expect.objectContaining({ trajectory_id: 'traj-1' })],
      activePrinciples: [expect.objectContaining({ principle_id: 'pr-1' })],
      indexPreview: 'SEKB L1 index preview',
    });
    expect(runtimeLessonsReporter).toHaveBeenCalledTimes(1);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('configures memory-wiki defaults without overwriting unrelated plugin config', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'config.get') {
          return {
            hash: 'h1',
            config: {
              plugins: {
                entries: {
                  other: { enabled: false },
                  'memory-wiki': {
                    enabled: false,
                    config: {
                      search: { maxResults: 7 },
                    },
                  },
                },
              },
            },
          };
        }
        if (method === 'config.patch') return { ok: true, params };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    await expect(api.configure()).resolves.toEqual({ success: true });

    const patchCall = gatewayManager.rpc.mock.calls.find(([method]) => method === 'config.patch');
    const patchPayload = patchCall?.[1] as { raw: string; baseHash?: string };
    const patch = JSON.parse(patchPayload.raw);
    expect(patchPayload.baseHash).toBe('h1');
    expect(patch.plugins.entries['memory-wiki']).toMatchObject({
      enabled: true,
      config: {
        vaultMode: 'isolated',
        vault: { renderMode: 'native' },
        search: { backend: 'shared', corpus: 'wiki', maxResults: 7 },
      },
    });
    expect(patch.plugins.entries['memory-wiki']).not.toHaveProperty('other');

    await expect(api.configure({ renderMode: 'obsidian' })).resolves.toEqual({ success: true });
    const obsidianPatchPayload = gatewayManager.rpc.mock.calls
      .filter(([method]) => method === 'config.patch')
      .at(-1)?.[1] as { raw: string };
    const obsidianPatch = JSON.parse(obsidianPatchPayload.raw);
    expect(obsidianPatch.plugins.entries['memory-wiki'].config.vault.renderMode).toBe('obsidian');
  });

  it('enumerates bounded text files and skips large or non-text imports', async () => {
    const folder = join(root, 'notes');
    mkdirSync(folder, { recursive: true });
    const small = join(folder, 'one.md');
    const large = join(folder, 'large.md');
    const binary = join(folder, 'image.png');
    writeFileSync(small, '# One');
    writeFileSync(large, 'x'.repeat(32));
    writeFileSync(binary, 'not text');

    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'wiki.ingest') {
          return {
            sourcePath: params.inputPath,
            pageId: 'page-one',
            pagePath: 'one.md',
            title: params.title,
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.ingestFiles({
      paths: [folder],
      maxFiles: 10,
      maxBytesPerFile: 16,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ inputPath: small, pageId: 'page-one' }),
      expect.objectContaining({ inputPath: large, error: 'tooLarge' }),
    ]));
    expect(result.items.some((item) => item.inputPath === binary)).toBe(false);
    expect(gatewayManager.rpc).toHaveBeenCalledTimes(1);
    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'wiki.ingest',
      expect.objectContaining({ inputPath: small, title: 'one' }),
      120000,
    );
  });

  it('keeps draft review and steward review local until a reviewed change is applied', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('wiki.apply should not be called yet');
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const created = await api.createDraft({
      title: 'Knowledge governance',
      body: 'Agents can read wiki pages, but user confirmation is required before any write.',
      type: 'decision',
      sourceIds: ['chat-session-1'],
      createdBy: 'agent',
    });

    expect(created.success).toBe(true);
    expect(created.draft?.status).toBe('draft');
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const review = await api.stewardReview({ draftId: created.draft!.id });
    expect(review.success).toBe(true);
    expect(review.config.capabilities.canApplyDirectly).toBe(false);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const updated = await api.updateDraft({
      id: created.draft!.id,
      tags: ['governance'],
    });
    expect(updated.success).toBe(true);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const rejected = await api.reviewDraft({ id: created.draft!.id, action: 'request_changes' });
    expect(rejected.success).toBe(true);
    expect(rejected.draft?.status).toBe('steward_reviewed');
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('orchestrates inbox candidates into drafts without applying wiki writes', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('wiki.apply should not be called for inbox orchestration');
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const created = await api.createInboxItem({
      title: 'Task decision',
      body: 'Use Knowledge Inbox as the buffer before formal wiki writes.',
      kind: 'task-ledger',
      type: 'decision',
      sourceRefs: [{ id: 'task-1', kind: 'task_ledger', label: 'Task Ledger decision' }],
      tags: ['governance'],
      createdBy: 'agent',
      warnings: ['Needs user review before writing.'],
      metadata: {
        mvpVersion: 'knowledge-interaction-mvp-1',
        recommendation: 'save',
        score: { reusability: 0.82, uniqueness: 0.5, confidence: 0.86, overall: 0.77 },
        temporality: 'stable',
        reason: 'Mission completed with reusable evidence-backed knowledge.',
        missionId: 'mission-1',
        tick: 1,
        outcome: 'complete',
        evidenceRefs: ['task-1'],
        captureKey: 'mission:mission-1:tick:1:knowledge:abcdef0123456789',
      },
    });

    expect(created.success).toBe(true);
    expect(created.item).toMatchObject({
      status: 'pending',
      kind: 'task-ledger',
      sourceIds: ['task-1'],
      metadata: expect.objectContaining({
        mvpVersion: 'knowledge-interaction-mvp-1',
        recommendation: 'save',
        reason: 'Mission completed with reusable evidence-backed knowledge.',
        evidenceRefs: ['task-1'],
        captureKey: 'mission:mission-1:tick:1:knowledge:abcdef0123456789',
        triage: expect.objectContaining({
          action: 'needs-decision',
          reason: expect.stringContaining('warnings'),
        }),
      }),
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const duplicate = await api.createInboxItem({
      title: 'Duplicate Task decision',
      body: 'Duplicate capture should return the original item.',
      kind: 'task-ledger',
      type: 'decision',
      sourceRefs: [{ id: 'task-1', kind: 'task_ledger', label: 'Task Ledger decision' }],
      tags: ['governance'],
      createdBy: 'agent',
      metadata: {
        mvpVersion: 'knowledge-interaction-mvp-1',
        recommendation: 'save',
        score: { reusability: 0.82, uniqueness: 0.5, confidence: 0.86, overall: 0.77 },
        temporality: 'stable',
        reason: 'Mission completed with reusable evidence-backed knowledge.',
        missionId: 'mission-1',
        tick: 1,
        outcome: 'complete',
        evidenceRefs: ['task-1'],
        captureKey: 'mission:mission-1:tick:1:knowledge:abcdef0123456789',
      },
    });

    expect(duplicate.success).toBe(true);
    expect(duplicate.item?.id).toBe(created.item?.id);
    expect(duplicate.item?.title).toBe('Task decision');

    const listed = await api.listInboxItems({ status: 'pending' });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].metadata?.triage).toMatchObject({
      action: 'needs-decision',
    });

    const promoted = await api.promoteInboxItemToDraft({ id: created.item!.id });
    expect(promoted.success).toBe(true);
    expect(promoted.item?.status).toBe('promoted');
    expect(promoted.draft).toMatchObject({
      title: 'Task decision',
      status: 'draft',
      sourceIds: ['task-1'],
    });
    expect(promoted.proposal).toMatchObject({
      operation: 'create',
      status: 'proposed',
      draftId: promoted.draft!.id,
      requiresUserConfirmation: true,
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const pendingAfterPromote = await api.listInboxItems({ status: 'pending' });
    expect(pendingAfterPromote.items).toHaveLength(0);

    const manual = await api.createInboxItem({
      title: 'Manual note',
      body: 'Candidate that should be dismissed.',
      kind: 'manual',
      createdBy: 'user',
    });
    const dismissed = await api.dismissInboxItem({ id: manual.item!.id });
    expect(dismissed.success).toBe(true);
    expect(dismissed.item?.status).toBe('dismissed');
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('keeps automatic knowledge candidates as pending Inbox items without reviewed apply', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('automatic knowledge candidates must not call Gateway writes');
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const created = await api.createInboxItem({
      title: 'Architecture correction',
      body: 'User corrected the architecture note: watched directory capture must be review-gated.',
      kind: 'chat-session',
      type: 'architecture',
      sourceRefs: [{ id: 'AGENTS.md', kind: 'file', path: join(root, 'workspace', 'AGENTS.md') }],
      createdBy: 'agent',
    });

    expect(created.success).toBe(true);
    expect(created.item).toMatchObject({
      status: 'pending',
      type: 'architecture',
      createdBy: 'agent',
    });
    expect(created.item?.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Rules-governed files'),
    ]));

    const proposals = await api.listProposals({ status: 'all' });
    expect(proposals.proposals).toHaveLength(0);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('triages inbox candidates as duplicate, incomplete, or ready for review', async () => {
    const { triageKnowledgeInboxItem } = await import('@electron/services/knowledge-api');
    const baseItem = {
      id: 'inbox-base',
      title: 'Renderer boundary',
      body: 'Renderer code must call host-api instead of direct IPC for knowledge routes.',
      kind: 'manual',
      type: 'architecture',
      status: 'pending',
      sourceIds: ['source-1'],
      sourceRefs: [{ id: 'source-1', kind: 'manual' }],
      tags: [],
      workspaceId: null,
      agentId: null,
      createdBy: 'agent',
      warnings: [],
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    } as const;

    expect(triageKnowledgeInboxItem(baseItem as never)).toMatchObject({
      action: 'ready-for-review',
    });

    expect(triageKnowledgeInboxItem({
      ...baseItem,
      id: 'inbox-empty',
      title: '',
      body: '',
      sourceIds: [],
      sourceRefs: [],
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
    } as never)).toMatchObject({
      action: 'reject-low-value',
    });

    expect(triageKnowledgeInboxItem({
      ...baseItem,
      id: 'inbox-duplicate',
      title: 'Renderer boundary',
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
    } as never, [baseItem as never])).toMatchObject({
      action: 'possible-duplicate',
      duplicateOf: 'inbox-base',
    });
  });

  it('forces watched-directory automation to remain review-gated', async () => {
    const watchedDir = join(root, 'watched');
    mkdirSync(watchedDir, { recursive: true });
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('watched directories must not direct-ingest automatically');
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const added = await api.addWatchedDirectory({
      id: 'ignored',
      path: watchedDir,
      patterns: ['**/*.md'],
      enabled: false,
      ingestNewFiles: true,
      autoCompile: true,
      requiresReview: false,
    });

    expect(added.success).toBe(true);
    expect(await api.listWatchedDirectories()).toEqual([
      expect.objectContaining({
        path: watchedDir,
        requiresReview: true,
      }),
    ]);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('records knowledge provenance references as metadata only', async () => {
    const gatewayManager = { rpc: vi.fn() };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const recorded = await api.recordKnowledgeReference({
      targetId: 'notes/decision.md',
      targetKind: 'wiki-page',
      title: 'Decision',
      sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md' }],
      reference: { kind: 'search', lookup: 'notes/decision.md', query: 'native wiki' },
    });

    expect(recorded.success).toBe(true);
    expect(recorded.record).toMatchObject({
      targetId: 'notes/decision.md',
      targetKind: 'wiki-page',
      title: 'Decision',
      sourceRefs: [expect.objectContaining({ id: 'notes/decision.md' })],
    });
    expect(recorded.record?.references).toHaveLength(1);
    expect(recorded.record?.references[0]).toMatchObject({
      kind: 'search',
      lookup: 'notes/decision.md',
      query: 'native wiki',
    });

    const loaded = await api.getProvenance({ targetId: 'notes/decision.md', targetKind: 'wiki-page' });
    expect(loaded.success).toBe(true);
    expect(loaded.record?.references).toHaveLength(1);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('validates proposals and applies only approved create proposals', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.apply') return { pageId: 'synthesis-1' };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    await expect(api.proposeChange({
      operation: 'update',
      reason: 'Needs correction',
    })).resolves.toMatchObject({ success: false, error: 'targetPageIds are required for this operation' });

    await expect(api.proposeChange({
      operation: 'update',
      targetPageIds: ['wiki/page.md'],
      reason: 'Needs correction',
    })).resolves.toMatchObject({ success: false, error: 'diff is required for update or merge proposals' });

    const draft = await api.createDraft({
      title: 'Reviewed synthesis',
      body: 'Use an isolated native wiki by default, with Obsidian only as an optional renderer.',
      type: 'synthesis',
      sourceIds: ['notes/decision.md'],
      createdBy: 'user',
    });
    const proposal = await api.proposeChange({
      operation: 'create',
      draftId: draft.draft!.id,
      reason: 'User asked to save this synthesis',
      sources: [{ id: 'notes/decision.md', kind: 'wiki' }],
    });

    await expect(api.applyReviewedChange({ id: proposal.proposal!.id })).resolves.toMatchObject({
      success: false,
      error: 'proposal must be approved by the user before apply',
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    await api.reviewDraft({ id: draft.draft!.id, action: 'approve' });
    const applied = await api.applyReviewedChange({ id: proposal.proposal!.id });

    expect(applied.success).toBe(true);
    expect(applied.draft?.status).toBe('applied');
    expect(applied.proposal?.status).toBe('applied');
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.apply', expect.objectContaining({
      op: 'create_synthesis',
      title: 'Reviewed synthesis',
      sourceIds: ['notes/decision.md'],
    }), 120000);
  });

  it('converts legacy applyDraft calls into review-gated drafts without direct wiki apply', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.applyDraft({
      title: 'Legacy save request',
      body: 'Capture this as reusable knowledge after review.',
      sourceIds: ['notes/source.md'],
      claims: [{ text: 'A claim preserved for review.' }],
      confidence: 0.72,
      status: 'draft',
    });

    expect(result).toMatchObject({
      success: true,
      changed: false,
      operation: 'review_required',
      reviewRequired: true,
      draft: expect.objectContaining({
        title: 'Legacy save request',
        status: 'draft',
        sourceIds: ['notes/source.md'],
        metadata: expect.objectContaining({
          reviewGate: 'applyDraft',
          directApplyDisabled: true,
        }),
      }),
      proposal: expect.objectContaining({
        operation: 'create',
        status: 'proposed',
        requiresUserConfirmation: true,
      }),
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    await expect(api.listDrafts({ status: 'all' })).resolves.toMatchObject({
      drafts: [expect.objectContaining({ id: result.draft?.id })],
    });
    await expect(api.listProposals({ status: 'all' })).resolves.toMatchObject({
      proposals: [expect.objectContaining({ id: result.proposal?.id, draftId: result.draft?.id })],
    });
  });

  it('routes knowledge context only when scope and mode allow read-only search', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.search') {
          return {
            results: [
              {
                id: 'route-1',
                title: 'Architecture Decision',
                lookup: 'architecture/decision.md',
                pagePath: 'architecture/decision.md',
                snippet: 'Use the managed wiki as read-only context.',
                score: 0.82,
              },
              {
                id: 'pitfall-1',
                title: 'Route context pitfall',
                lookup: 'troubleshooting/route-context.md',
                pagePath: 'troubleshooting/route-context.md',
                type: 'troubleshooting',
                snippet: 'routeContext failures must not block chat send.',
                score: 0.78,
                metadata: { knowledgeKind: 'error-experience', errorExperience: { schemaVersion: 1 } },
              },
              {
                id: 'rule-1',
                title: 'Chat loop boundary',
                lookup: 'harness/specs/rules/chat-loop-boundary.md',
                pagePath: 'harness/specs/rules/chat-loop-boundary.md',
                type: 'rule',
                snippet: 'Knowledge writes are best-effort side effects.',
                score: 0.7,
                metadata: { knowledgeKind: 'rule' },
              },
            ],
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    await expect(api.routeContext({
      message: '之前项目里为什么选择 managed wiki 架构？',
      scope: 'none',
      mode: 'suggest',
    })).resolves.toMatchObject({ success: true, decision: 'skip' });

    await expect(api.routeContext({
      message: '之前项目里为什么选择 managed wiki 架构？',
      scope: 'wiki',
      mode: 'manual',
    })).resolves.toMatchObject({ success: true, decision: 'skip' });

    await expect(api.routeContext({
      message: '之前项目里为什么选择 managed wiki 架构？',
      scope: 'wiki',
      mode: 'suggest',
      selectedReferences: [{ id: 'manual', title: 'Manual', lookup: 'manual.md', corpus: 'wiki' }],
    })).resolves.toMatchObject({ success: true, decision: 'skip' });

    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const suggest = await api.routeContext({
      message: '之前项目里为什么选择 managed wiki 架构？',
      scope: 'wiki',
      mode: 'suggest',
    });

    expect(suggest).toMatchObject({
      success: true,
      decision: 'suggest',
      retrievalDiagnostics: expect.objectContaining({
        query: expect.any(String),
        corpus: 'wiki',
        backend: 'fallback-keyword',
        resultCount: 3,
        selectedCount: 3,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'route-1',
            sourceKind: 'wiki-page',
            reason: expect.any(String),
          }),
        ]),
      }),
      candidates: expect.arrayContaining([
        expect.objectContaining({
          attachKind: 'suggested',
          lookup: 'architecture/decision.md',
          routeGroup: 'docs',
          confidence: 0.82,
        }),
        expect.objectContaining({
          lookup: 'troubleshooting/route-context.md',
          routeGroup: 'pitfalls',
        }),
        expect.objectContaining({
          lookup: 'harness/specs/rules/chat-loop-boundary.md',
          routeGroup: 'rules',
        }),
      ]),
      candidateGroups: [
        expect.objectContaining({ key: 'docs', candidates: [expect.objectContaining({ id: 'route-1' })] }),
        expect.objectContaining({ key: 'pitfalls', candidates: [expect.objectContaining({ id: 'pitfall-1' })] }),
        expect.objectContaining({ key: 'rules', candidates: [expect.objectContaining({ id: 'rule-1' })] }),
      ],
      groupedCandidates: expect.objectContaining({
        docs: [expect.objectContaining({ id: 'route-1' })],
        pitfalls: [expect.objectContaining({ id: 'pitfall-1' })],
        rules: [expect.objectContaining({ id: 'rule-1' })],
      }),
    });
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.search', expect.objectContaining({
      corpus: 'wiki',
      maxResults: 3,
    }), 30000);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  it('adds retrieval diagnostics to search without replacing legacy results', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.search') {
          return {
            results: [
              {
                id: 'search-1',
                title: 'Route context notes',
                lookup: 'notes/route-context.md',
                pagePath: 'notes/route-context.md',
                snippet: 'Knowledge side effects are best effort.',
                score: 0.91,
                metadata: { knowledgeKind: 'rule' },
              },
            ],
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.search({ query: 'routeContext failure', corpus: 'wiki', maxResults: 5 });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'search-1', lookup: 'notes/route-context.md' }),
    ]);
    expect(result.retrievalDiagnostics).toMatchObject({
      query: 'routeContext failure',
      corpus: 'wiki',
      mode: 'keyword',
      backend: 'fallback-keyword',
      resultCount: 1,
      selectedCount: 1,
      items: [
        expect.objectContaining({
          id: 'search-1',
          lookup: 'notes/route-context.md',
          sourceKind: 'rule',
          score: 0.91,
        }),
      ],
    });
  });

  it('matches error-experience advisories and updates effectiveness counters', async () => {
    const gatewayManager = { rpc: vi.fn() };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const created = await api.createInboxItem({
      title: 'Route context failure handling',
      body: 'routeContext failures must not block ordinary chat send.',
      kind: 'manual',
      type: 'troubleshooting',
      sourceIds: ['notes/route-context.md'],
      sourceRefs: [{ id: 'notes/route-context.md', kind: 'wiki', path: 'notes/route-context.md' }],
      tags: ['error-experience'],
      createdBy: 'user',
      metadata: {
        knowledgeKind: 'error-experience',
        errorExperience: {
          schemaVersion: 1,
          id: 'ee-route-context',
          title: 'Route context failure handling',
          summary: 'routeContext failures must not block ordinary chat send.',
          triggerPattern: {
            errorType: 'test',
            keywords: ['routeContext', 'knowledge side effect'],
            filePatterns: ['src/pages/Chat/**'],
            stackTraceSignature: 'RouteContextFailure',
            commandSignature: 'pnpm test',
            scenarioDescription: 'routeContext failure',
            routeQueries: ['route context failure'],
          },
          rootCause: {
            summary: 'Knowledge side effects were coupled to Chat send.',
            contributingFactors: ['routeContext failure was not best-effort'],
          },
          resolution: {
            steps: ['Catch knowledge guard errors.', 'Keep Chat send independent.'],
            verificationCommands: ['pnpm exec vitest run tests/unit/chat-input.test.tsx'],
          },
          applicability: {
            projectScopes: ['current-workspace'],
            modules: ['src/pages/Chat'],
            roles: ['knowledge-librarian'],
            confidence: 0.7,
            severity: 'high',
          },
          provenance: {
            createdFrom: { kind: 'manual', id: 'unit-test' },
            sourceRefs: [{ id: 'notes/route-context.md', kind: 'wiki', path: 'notes/route-context.md' }],
            createdAt: '2026-07-04T00:00:00.000Z',
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
    });
    expect(created.success).toBe(true);

    const matched = await api.matchErrorExperience({
      signal: {
        kind: 'test-failure',
        text: 'RouteContextFailure: routeContext knowledge side effect failed',
        command: 'pnpm test',
        stackTrace: 'RouteContextFailure',
        filePaths: ['src/pages/Chat/index.tsx'],
      },
      limit: 1,
    });

    expect(matched).toMatchObject({
      success: true,
      advisories: [
        expect.objectContaining({
          targetKind: 'inbox',
          targetId: created.item?.id,
          title: 'Route context failure handling',
          rootCause: 'Knowledge side effects were coupled to Chat send.',
          recommendedResolution: ['Catch knowledge guard errors.', 'Keep Chat send independent.'],
        }),
      ],
    });

    const updated = await api.updateErrorExperienceEffectiveness({
      targetKind: 'inbox',
      targetId: created.item!.id,
      action: 'accepted',
      note: 'unit test accepted advisory',
    });

    expect(updated).toMatchObject({
      success: true,
      effectiveness: expect.objectContaining({
        hitCount: 1,
        acceptedCount: 1,
      }),
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('aggregates governance quality metrics from audit issues and error-experience counters', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.compile') {
          return {
            freshnessReports: [
              { pageId: 'old-1', pagePath: 'old.md', pageTitle: 'Old note', reason: 'Last verified too long ago' },
            ],
          };
        }
        if (method === 'wiki.lint') {
          return {
            provenanceGaps: [
              { pageId: 'gap-1', pagePath: 'gap.md', pageTitle: 'Gap note', description: 'Missing source refs' },
            ],
            danglingPages: [
              { pageId: 'orphan-1', pagePath: 'orphan.md', pageTitle: 'Orphan note' },
            ],
            duplicates: [
              { topic: 'Duplicate route notes', pageIds: ['dup-a', 'dup-b'] },
            ],
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    await api.createInboxItem({
      title: 'Low-confidence repeated card',
      body: 'Route context failures are repeatedly dismissed.',
      kind: 'manual',
      type: 'troubleshooting',
      createdBy: 'user',
      metadata: {
        knowledgeKind: 'error-experience',
        errorExperience: {
          schemaVersion: 1,
          id: 'ee-low-confidence',
          title: 'Low-confidence repeated card',
          summary: 'Route context failures are repeatedly dismissed.',
          triggerPattern: {
            errorType: 'logic',
            keywords: ['routeContext'],
            filePatterns: ['src/pages/Chat/**'],
            scenarioDescription: 'routeContext repeated failure',
            routeQueries: ['routeContext'],
          },
          rootCause: { summary: 'The card needs review.', contributingFactors: [] },
          resolution: { steps: ['Review and tighten the trigger.'], verificationCommands: [] },
          applicability: {
            projectScopes: ['current-workspace'],
            modules: ['src/pages/Chat'],
            roles: ['knowledge-librarian'],
            confidence: 0.4,
            severity: 'medium',
          },
          provenance: {
            createdFrom: { kind: 'manual', id: 'unit-test' },
            sourceRefs: [{ id: 'unit-test', kind: 'manual' }],
            createdAt: '2026-07-04T00:00:00.000Z',
          },
          effectiveness: {
            hitCount: 4,
            acceptedCount: 1,
            dismissedCount: 4,
            preventedFailureCount: 0,
            staleCount: 1,
          },
        },
      },
    });

    const result = await api.governanceAudit();

    expect(result.success).toBe(true);
    expect(result.summaries).toMatchObject({
      stale: 1,
      dangling: 1,
      duplicates: 1,
      provenanceGaps: 1,
    });
    expect(result.qualityMetrics).toMatchObject({
      staleCards: 2,
      duplicateClusters: 1,
      sourceGaps: 1,
      unreferencedPages: 1,
      lowConfidenceHighHitCards: 1,
      highDismissalCards: 1,
    });
    expect(result.qualityMetrics?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source_gaps', count: 1 }),
      expect.objectContaining({ kind: 'low_confidence_high_hit_cards', count: 1 }),
      expect.objectContaining({ kind: 'high_dismissal_cards', count: 1 }),
    ]));
  });

  it('auto-read routes only high-confidence fresh non-contradicted candidates', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.search') {
          return {
            results: [
              { id: 'fresh', title: 'Fresh', lookup: 'fresh.md', score: 0.9, freshnessLevel: 'fresh', matchedClaimStatus: 'supported' },
              { id: 'low', title: 'Low', lookup: 'low.md', score: 0.2, freshnessLevel: 'fresh', matchedClaimStatus: 'supported' },
              { id: 'stale', title: 'Stale', lookup: 'stale.md', score: 0.9, freshnessLevel: 'stale', matchedClaimStatus: 'supported' },
              { id: 'conflict', title: 'Conflict', lookup: 'conflict.md', score: 0.9, freshnessLevel: 'fresh', matchedClaimStatus: 'contradicted' },
              { id: 'extra', title: 'Extra', lookup: 'extra.md', score: 0.8, freshnessLevel: 'fresh', matchedClaimStatus: 'supported' },
            ],
          };
        }
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.routeContext({
      message: '项目历史里这个排障约定和架构决策是什么？',
      scope: 'all',
      mode: 'auto-read',
    });

    expect(result).toMatchObject({
      success: true,
      decision: 'auto_attach',
      candidates: [
        expect.objectContaining({ id: 'fresh', attachKind: 'auto' }),
        expect.objectContaining({ id: 'extra', attachKind: 'auto' }),
      ],
    });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.id)).not.toEqual(expect.arrayContaining(['low', 'stale', 'conflict']));
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  it('validates OKF bundles while preserving frontmatter and treating compatibility issues as warnings', async () => {
    const bundle = join(root, 'okf-bundle');
    mkdirSync(join(bundle, 'concepts'), { recursive: true });
    writeFileSync(join(bundle, 'index.md'), '---\nokf_version: "0.1"\n---\n# OKF bundle');
    writeFileSync(join(bundle, 'log.md'), '# Reserved log');
    writeFileSync(join(bundle, 'concepts', 'alpha.md'), [
      '---',
      'type: custom-type',
      'title: Alpha',
      'description: Alpha description',
      'resource: local',
      'tags: [okf, mvp]',
      'custom_field: preserved',
      '---',
      '# Alpha',
      'See [Missing](missing.md).',
      '',
      '## Citations',
      '- [Source](https://example.com/source)',
    ].join('\n'));

    const gatewayManager = { rpc: vi.fn() };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.validateOkfBundle({ path: bundle });

    expect(result.success).toBe(true);
    expect(result.okfVersion).toBe('0.1');
    expect(result.summary).toMatchObject({
      conceptFiles: 1,
      validConcepts: 1,
      reservedFiles: 2,
      errors: 0,
    });
    expect(result.typeDistribution['custom-type']).toBe(1);
    expect(result.concepts[0]).toMatchObject({
      conceptId: 'concepts/alpha',
      frontmatter: expect.objectContaining({
        type: 'custom-type',
        title: 'Alpha',
        custom_field: 'preserved',
      }),
      citations: ['https://example.com/source'],
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'unknownType',
      'unknownFields',
      'brokenLink',
    ]));
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects OKF concept files missing frontmatter or type', async () => {
    const bundle = join(root, 'invalid-okf');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'plain.md'), '# No frontmatter');
    writeFileSync(join(bundle, 'missing-type.md'), '---\ntitle: Missing type\n---\n# Missing type');

    const gatewayManager = { rpc: vi.fn() };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.validateOkfBundle({ path: bundle });

    expect(result.success).toBe(false);
    expect(result.summary.conceptFiles).toBe(2);
    expect(result.summary.validConcepts).toBe(0);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'missingFrontmatter',
      'missingType',
    ]));
    expect(result.warnings.map((warning) => warning.code)).toContain('missingRootIndex');
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('imports selected OKF concepts through wiki.ingest and records mapping metadata without wiki.apply', async () => {
    const bundle = join(root, 'import-okf');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'index.md'), '---\nokf_version: "0.1"\n---\n# Bundle');
    writeFileSync(join(bundle, 'alpha.md'), [
      '---',
      'type: architecture',
      'title: Alpha Architecture',
      'description: Architecture note',
      'extra_key: preserved',
      '---',
      '# Alpha',
      'See [Beta](beta.md).',
    ].join('\n'));
    writeFileSync(join(bundle, 'beta.md'), [
      '---',
      'type: decision',
      'title: Beta Decision',
      'description: Decision note',
      '---',
      '# Beta',
    ].join('\n'));

    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'wiki.ingest') {
          return {
            sourcePath: params.inputPath,
            pageId: `page-${params.title}`,
            pagePath: `${params.title}.md`,
          };
        }
        if (method === 'wiki.apply') throw new Error('wiki.apply must not be called');
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.importOkfBundle({ path: bundle, conceptIds: ['alpha'] });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.items[0]).toMatchObject({
      conceptId: 'alpha',
      title: 'Alpha Architecture',
      pageId: 'page-Alpha Architecture',
      frontmatter: expect.objectContaining({ extra_key: 'preserved' }),
    });
    expect(gatewayManager.rpc).toHaveBeenCalledTimes(1);
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.ingest', expect.objectContaining({
      inputPath: join(bundle, 'alpha.md'),
      title: 'Alpha Architecture',
    }), 120000);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());

    const mappingDir = join(root, 'knowledge', 'okf', 'bundles');
    const mappingFiles = readdirSync(mappingDir).filter((name) => name.endsWith('.json'));
    expect(mappingFiles).toHaveLength(1);
    const mapping = JSON.parse(readFileSync(join(mappingDir, mappingFiles[0]), 'utf8'));
    expect(mapping.items[0]).toMatchObject({
      conceptId: 'alpha',
      pageId: 'page-Alpha Architecture',
      frontmatter: expect.objectContaining({ extra_key: 'preserved' }),
    });
  });

  it('persists source sets and answers from their selected sources without applying durable wiki changes', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'wiki.get') {
          return {
            lookup: params.lookup,
            title: params.lookup === 'notes/decision.md' ? 'Decision note' : 'Procedure note',
            pagePath: params.lookup,
            body: params.lookup === 'notes/decision.md'
              ? 'Use source-backed drafts before durable Knowledge writes.'
              : 'Review generated artifacts before applying them.',
          };
        }
        if (method === 'wiki.apply') throw new Error('wiki.apply must not be called');
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const saved = await api.saveSourceSet({
      title: 'NotebookLM slice',
      sourceRefs: [
        { id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision note' },
        { id: 'notes/procedure.md', kind: 'wiki', path: 'notes/procedure.md', label: 'Procedure note' },
      ],
      metadata: { workspaceId: 'workspace-a' },
    });

    expect(saved.success).toBe(true);
    expect(saved.sourceSet).toMatchObject({
      title: 'NotebookLM slice',
      sourceRefs: [
        expect.objectContaining({ id: 'notes/decision.md', kind: 'wiki' }),
        expect.objectContaining({ id: 'notes/procedure.md', kind: 'wiki' }),
      ],
      metadata: { workspaceId: 'workspace-a' },
    });

    await expect(api.listSourceSets()).resolves.toMatchObject({
      success: true,
      sourceSets: [expect.objectContaining({ id: saved.sourceSet!.id, title: 'NotebookLM slice' })],
    });

    const answer = await api.answerFromSourceSet({
      question: 'Why keep review before durable writes?',
      sourceRefs: saved.sourceSet!.sourceRefs,
    });

    expect(answer.success).toBe(true);
    expect(answer.groundingStatus).toBe('grounded');
    expect(answer.answer).toContain('Decision note');
    expect(answer.sources.map((source) => source.lookup)).toEqual(['notes/decision.md', 'notes/procedure.md']);
    expect(answer.unknowns).toContain('Grounding is page/snippet level.');
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.get', expect.objectContaining({
      lookup: 'notes/decision.md',
      lineCount: 80,
      corpus: 'wiki',
    }), 30000);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  it('creates reviewable studio artifact drafts from selected source sets', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'wiki.get') {
          return {
            lookup: params.lookup,
            title: 'Decision note',
            pagePath: params.lookup,
            body: 'Notebook artifacts must remain drafts until the user confirms apply.',
          };
        }
        if (method === 'wiki.apply') throw new Error('wiki.apply must not be called');
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.createArtifactDraft({
      artifactType: 'decision-memo',
      title: 'Decision memo',
      question: 'What should the user approve?',
      sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision note' }],
    });

    expect(result.success).toBe(true);
    expect(result.draft).toMatchObject({
      title: 'Decision memo',
      type: 'decision',
      status: 'draft',
      sourceIds: ['notes/decision.md'],
      sourceRefs: [expect.objectContaining({ id: 'notes/decision.md', kind: 'wiki' })],
      tags: ['studio-artifact', 'decision-memo'],
      metadata: {
        knowledgeKind: 'studio-artifact',
        artifactType: 'decision-memo',
        groundingStatus: 'grounded',
      },
    });
    expect(result.draft?.body).toContain('## Sources used');
    expect(result.draft?.body).toContain('Decision note');
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });
});
