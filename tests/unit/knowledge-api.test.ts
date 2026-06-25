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
    });

    expect(created.success).toBe(true);
    expect(created.item).toMatchObject({
      status: 'pending',
      kind: 'task-ledger',
      sourceIds: ['task-1'],
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const listed = await api.listInboxItems({ status: 'pending' });
    expect(listed.items).toHaveLength(1);

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

  it('routes knowledge context only when scope and mode allow read-only search', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'wiki.search') {
          return {
            results: [{
              id: 'route-1',
              title: 'Architecture Decision',
              lookup: 'architecture/decision.md',
              pagePath: 'architecture/decision.md',
              snippet: 'Use the managed wiki as read-only context.',
              score: 0.82,
            }],
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
      candidates: [expect.objectContaining({
        attachKind: 'suggested',
        lookup: 'architecture/decision.md',
        confidence: 0.82,
      })],
    });
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.search', expect.objectContaining({
      corpus: 'wiki',
      maxResults: 3,
    }), 30000);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
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
});
