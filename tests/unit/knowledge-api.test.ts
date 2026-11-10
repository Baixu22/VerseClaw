import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { createOwnerReadSnapshot, deriveReadAdmissionContext, digestOwnerReadContent } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(async () => ''),
  },
}));

const root = join(tmpdir(), `clawx-knowledge-api-${Date.now()}`);


type FakeConfirmOptions = {
  sessionId?: string;
  requireSession?: boolean;
  sourceSystem?: string;
  integrityClaim?: unknown;
  summaryOnly?: boolean;
  contextBlockSink?: unknown;
  contextBlockSinkKind?: string;
  experienceShadow?: {
    workspaceRoot: string;
    enabled: boolean;
    dualWrite?: boolean;
  };
};

type FakeConfirmCall = { suggestion: unknown; edits: unknown; options: FakeConfirmOptions };

/** Inject an in-memory runtime so the production host route can be observed without a built dist. */
async function installFakeSekbRuntime(): Promise<FakeConfirmCall[]> {
  const confirmCalls: FakeConfirmCall[] = [];
  const runtime = {
    KnowledgeStore: class {
      constructor() {}
    },
    DistillationTool: class {
      constructor() {}
      async confirm_and_save_with_lineage(suggestion: unknown, edits: unknown, options: FakeConfirmOptions) {
        confirmCalls.push({ suggestion, edits, options });
        if (options?.experienceShadow?.enabled) {
          const memoryDir = join(options.experienceShadow.workspaceRoot, '.openclaw', 'memory');
          mkdirSync(memoryDir, { recursive: true });
          writeFileSync(join(memoryDir, 'experience-shadow.jsonl'), JSON.stringify({
            atMs: 1,
            sessionId: options.sessionId,
            principleId: 'principle-shadow',
            mode: 'dual-write-shadow',
          }) + '\n', 'utf8');
        }
        return {
          principleId: 'principle-shadow',
          provenance: undefined,
          dcsWrite: 'persisted',
          highTrustEligible: false,
        };
      }
      confirm_and_save(suggestion: unknown, edits: unknown, options: FakeConfirmOptions) {
        confirmCalls.push({ suggestion, edits, options });
        return 'principle-shadow';
      }
    },
    isSekbBatchDistillationAssistantEnabled: () => false,
  };
  const mod = await import('@electron/services/knowledge-api');
  mod.__setSekbRuntimeModuleForTests(runtime as never);
  return confirmCalls;
}

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => root,
  getDataDir: () => join(root, 'userData'),
  getResourcesDir: () => join(process.cwd(), 'resources'),
  // Point at a temp root without openclaw_runtime dist so SEKB ops degrade honestly.
  getOpenClawRuntimeDir: () => join(root, 'missing-openclaw-runtime'),
}));

describe('knowledge host API', () => {
  beforeEach(async () => {
    closeOpenClawStateDatabaseForTest();
    const mod = await import('@electron/services/knowledge-api');
    mod.__resetKnowledgeGovernanceForTests();
    mod.__resetGovernanceWriterQueueForTests();
    mod.__resetHostGovernedAdaptersForTests();
    mod.__setSekbRuntimeModuleForTests(undefined);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    await createWorkspacesApi().create({ name: 'Knowledge owner fixture', rootPath: root, agentId: 'main', permissionMode: 'acceptEdits' });
  });

  afterEach(async () => {
    const mod = await import('@electron/services/knowledge-api');
    mod.stopAllKnowledgeSourceWatches();
    mod.__setSekbRuntimeModuleForTests(undefined);
    closeOpenClawStateDatabaseForTest();
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
      evidence: {
        state: 'unknown' as const,
        ageDistribution: { underHour: 0, underDay: 0, underWeek: 0, older: 0, invalid: 0 },
        trajectoriesByOutcome: { success: 2, partial: 0, failure: 1 },
        steps: { min: 0, max: 0, average: 0 },
        durationSeconds: { min: 0, max: 0, average: 0 },
        errorSignatures: { withoutSignature: 3, distinct: 0, recurringTrajectories: 0 },
        shadow: {
          evaluatedTrajectories: 0,
          captureRecommendations: { retain: 0, review_low_signal: 0 },
          completionStatuses: { supported: 0, partial: 0, unsupported: 0, unknown: 0 },
        },
        feedback: {
          confirmedPrinciples: 1,
          rejectedSuggestions: 0,
          rejectionBreakdown: { general: 0, batchAssisted: 0 },
          retrievals: 4,
          adoptions: 2,
          postAdoptionSuccesses: 0,
        },
        batchDistillationAssistant: {
          state: 'unknown' as const,
          suggestionCount: { status: 'unavailable' as const, reason: 'not_persisted' },
          acceptedCount: { status: 'unavailable' as const, reason: 'not_persisted' },
          rejectedCount: { status: 'unavailable' as const, reason: 'not_persisted' },
          normalizedEditDistance: { status: 'unavailable' as const, reason: 'not_persisted' },
          duplicateSuggestionRate: { status: 'unavailable' as const, reason: 'not_evaluated' },
          sourceAttributionCompleteness: { status: 'unavailable' as const, reason: 'not_evaluated' },
          inputTokens: { status: 'unavailable' as const, reason: 'not_persisted' },
          outputTokens: { status: 'unavailable' as const, reason: 'not_persisted' },
          totalCostUsd: { status: 'unavailable' as const, reason: 'not_persisted' },
          fallbackCount: { status: 'unavailable' as const, reason: 'not_persisted' },
          subsequentAdoption: { status: 'unavailable' as const, reason: 'not_persisted' },
        },
        metricsUnavailable: [{ metric: 'historical_suggestion_count', reason: 'not_persisted' }],
      },
    }));
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never, runtimeLessonsReporter: runtimeLessonsReporter as never });

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

  it('resolves Host SEKB state dir and workspace root without using process.cwd defaults', async () => {
    const {
      resolveHostOpenClawStateDir,
      resolveHostSekbWorkspaceRoot,
    } = await import('@electron/services/knowledge-api');

    expect(resolveHostOpenClawStateDir({ OPENCLAW_STATE_DIR: 'C:/tmp/custom-state' }, join(root, 'userData')))
      .toBe('C:/tmp/custom-state');
    expect(resolveHostOpenClawStateDir({}, join(root, 'userData')))
      .toBe(join(root, 'userData', 'openclaw-source-state'));

    const previous = process.env.VERSE_CLAW_REPO_ROOT;
    process.env.VERSE_CLAW_REPO_ROOT = join(root, 'repo-root');
    try {
      expect(resolveHostSekbWorkspaceRoot(process.env)).toBe(join(root, 'repo-root'));
    } finally {
      if (previous === undefined) delete process.env.VERSE_CLAW_REPO_ROOT;
      else process.env.VERSE_CLAW_REPO_ROOT = previous;
    }
  });

  it('exposes SEKB ops host routes without gateway RPC and without auto-writes', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('SEKB ops routes must not call Gateway RPC');
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    await expect(api.sekbShadowEvaluationExport({ pseudonymizationKey: '' })).resolves.toMatchObject({
      success: false,
      reason: 'missingKey',
      authority: 'offline_evaluation_evidence_not_runtime_source_of_truth',
    });
    // Without a built openclaw_runtime dist, routes degrade honestly.
    await expect(api.sekbSuggestPrinciples({})).resolves.toMatchObject({
      available: false,
      reason: 'runtimeUnavailable',
      mode: 'deterministic',
      suggestions: [],
    });
    await expect(api.sekbBatchDistillSuggest({})).resolves.toMatchObject({
      available: false,
      reason: 'runtimeUnavailable',
    });
    await expect(api.sekbConfirmPrinciple({
      suggestion: {
        cluster_summary: 'x',
        source_trajectory_ids: [],
        suggested_principle: {},
        confidence: 0.1,
      },
    })).resolves.toMatchObject({
      available: false,
      reason: 'runtimeUnavailable',
    });
    await expect(api.sekbRejectSuggestion({
      suggestion: {
        cluster_summary: 'x',
        source_trajectory_ids: [],
        suggested_principle: {},
        confidence: 0.1,
      },
      reason: 'nope',
    })).resolves.toMatchObject({
      available: false,
      reason: 'runtimeUnavailable',
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('passes explicit experienceShadow through the production SEKB confirm route', async () => {
    const confirmCalls = await installFakeSekbRuntime();
    confirmCalls.length = 0;
    const workspaceRoot = join(root, 'repo-root');
    const previousRoot = process.env.VERSE_CLAW_REPO_ROOT;
    process.env.VERSE_CLAW_REPO_ROOT = workspaceRoot;
    try {
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: { rpc: vi.fn() } as never });

      const result = await api.sekbConfirmPrinciple({
        sessionId: 'session-shadow',
        suggestion: {
          cluster_summary: 'x',
          source_trajectory_ids: [],
          suggested_principle: {},
          confidence: 0.1,
        },
        experienceShadow: { enabled: true },
      });

      expect(result).toMatchObject({
        success: true,
        available: true,
        principleId: 'principle-shadow',
        dcsWrite: 'persisted',
        principleOnly: false,
      });
      expect(confirmCalls).toHaveLength(1);
      expect(confirmCalls[0]?.options.experienceShadow).toEqual({
        workspaceRoot,
        enabled: true,
        dualWrite: true,
      });
      const journal = join(workspaceRoot, '.openclaw', 'memory', 'experience-shadow.jsonl');
      expect(readFileSync(journal, 'utf8')).toContain('"sessionId":"session-shadow"');
      expect(readFileSync(journal, 'utf8')).toContain('"mode":"dual-write-shadow"');
    } finally {
      if (previousRoot === undefined) delete process.env.VERSE_CLAW_REPO_ROOT;
      else process.env.VERSE_CLAW_REPO_ROOT = previousRoot;
    }
  });

  it('omits experienceShadow entirely when the explicit request is absent', async () => {
    const confirmCalls = await installFakeSekbRuntime();
    confirmCalls.length = 0;
    const workspaceRoot = join(root, 'repo-root-off');
    const previousRoot = process.env.VERSE_CLAW_REPO_ROOT;
    process.env.VERSE_CLAW_REPO_ROOT = workspaceRoot;
    try {
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: { rpc: vi.fn() } as never });

      const result = await api.sekbConfirmPrinciple({
        sessionId: 'session-off',
        suggestion: {
          cluster_summary: 'x',
          source_trajectory_ids: [],
          suggested_principle: {},
          confidence: 0.1,
        },
      });

      expect(result).toMatchObject({
        success: true,
        available: true,
        principleId: 'principle-shadow',
        dcsWrite: 'persisted',
      });
      expect(confirmCalls).toHaveLength(1);
      expect(confirmCalls[0]?.options).not.toHaveProperty('experienceShadow');
      expect(existsSync(join(workspaceRoot, '.openclaw', 'memory', 'experience-shadow.jsonl'))).toBe(false);
    } finally {
      if (previousRoot === undefined) delete process.env.VERSE_CLAW_REPO_ROOT;
      else process.env.VERSE_CLAW_REPO_ROOT = previousRoot;
    }
  });

  it('configures memory-wiki defaults without overwriting unrelated plugin config', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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

  it('runs the semantic steward invoker through the gateway agent RPC when the active role is semantic', async () => {
    // Earlier tests may have loaded the default (heuristic) registry into the
    // module-level cache; reset so the semantic registry below is read.
    const { __resetRoleRegistryCacheForTests } = await import('@electron/services/knowledge-api');
    __resetRoleRegistryCacheForTests();

    // Semantic role registry so the steward review opts into the LLM pass.
    const knowledgeDir = join(root, 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(
      join(knowledgeDir, 'steward-roles.json'),
      JSON.stringify({
        version: 1,
        defaultRoleId: 'knowledge-steward-semantic',
        roles: [
          {
            roleId: 'knowledge-steward-semantic',
            enabled: true,
            displayName: 'Semantic Steward',
            classification: 'semantic',
            capabilities: {
              canSearch: true,
              canRead: true,
              canProposeDraft: true,
              canClassify: true,
              canSuggestMerge: true,
              canSuggestArchive: true,
              canApplyDirectly: false,
            },
            scope: { workspace: true, agent: false, global: false },
          },
        ],
      }),
      'utf8',
    );

    // Gateway mock that accepts the steward run and streams an assistant delta.
    const listeners = new Set<(event: unknown) => void>();
    const emit = (event: unknown) => {
      for (const listener of listeners) listener(event);
    };
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => {
        listeners.add(listener);
      }),
      off: vi.fn((_event: string, listener: (event: unknown) => void) => {
        listeners.delete(listener);
      }),
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'agent') {
          return { runId: 'steward-run-1' };
        }
        if (method === 'agent.wait') {
          // The invoker only starts collecting deltas after `agent` resolves and
          // modelRunId is known, so stream the reply here (matching real timing).
          emit({ runId: 'steward-run-1', type: 'assistant.delta', text: JSON.stringify({
            type: 'synthesis',
            tags: ['governance'],
            warnings: [{ kind: 'quality', message: 'Body lacks evidence chain.' }],
            confidence: 0.85,
          }) });
          return { status: 'completed' };
        }
        return {};
      }),
    };

    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const created = await api.createDraft({
      title: 'Semantic governance',
      body: 'Agents must route knowledge changes through the steward review.',
      type: 'decision',
      sourceIds: ['chat-session-1'],
      createdBy: 'agent',
    });
    expect(created.success).toBe(true);

    const review = await api.stewardReview({ draftId: created.draft!.id });
    expect(review.success).toBe(true);
    expect(review.type).toBe('synthesis');
    expect(review.tags).toContain('governance');
    expect(review.notes).toContain('Semantic steward pass');
    expect(review.warnings.some((w) => w.includes('[quality]'))).toBe(true);
    expect(gatewayManager.rpc).toHaveBeenCalledWith('agent', expect.objectContaining({ modelRun: true }), 60000);
    expect(gatewayManager.rpc).toHaveBeenCalledWith('agent.wait', expect.objectContaining({ runId: 'steward-run-1' }), 65000);
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

  it('reconciles watched file changes into versioned agent-driven review candidates', async () => {
    const watchedDir = join(root, 'watched-native'); mkdirSync(watchedDir, { recursive: true });
    writeFileSync(join(watchedDir, 'existing.md'), 'Source before startup');
    const gatewayManager = { rpc: vi.fn(async () => { throw new Error('no direct wiki write'); }) };
    const { createKnowledgeApi, stopAllKnowledgeSourceWatches } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    try {
      await expect(api.addWatchedDirectory({ id: 'new', path: watchedDir, patterns: ['**/*.md'], enabled: true, ingestNewFiles: true, autoCompile: true, requiresReview: false })).resolves.toMatchObject({ success: true });
      let result = await api.listInboxItems({ status: 'all' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ status: 'pending', createdBy: 'agent', metadata: { sourceTransition: 'created', driven_by: 'agent', actor: 'knowledge-source-sync', requiresReview: true } });
      writeFileSync(join(watchedDir, 'existing.md'), 'Source after update');
      await vi.waitFor(async () => expect((await api.listInboxItems({ status: 'all' })).items).toHaveLength(2), { timeout: 5000 });
      stopAllKnowledgeSourceWatches();
      writeFileSync(join(watchedDir, 'new.md'), 'Missed while stopped');
      const restarted = createKnowledgeApi({ gatewayManager: gatewayManager as never });
      await restarted.listWatchedDirectories();
      result = await restarted.listInboxItems({ status: 'all' });
      expect(result.items).toHaveLength(3);
      expect(new Set(result.items.map(x => x.metadata?.captureKey)).size).toBe(3);
      expect(gatewayManager.rpc).not.toHaveBeenCalled();
    } finally { stopAllKnowledgeSourceWatches(); }
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
      runtimeLessons: {
        requested: false,
        included: false,
        available: false,
        principleCount: 0,
        reason: 'not-requested',
      },
    });
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.search', expect.objectContaining({
      corpus: 'wiki',
      maxResults: 3,
    }), 30000);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  it('keeps Runtime Lessons opt-in and exposes principle provenance', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
    const principle = {
      principle_id: 'principle-route',
      title: 'Keep knowledge side effects best-effort',
      condition: 'When Chat routes knowledge context',
      action: 'Keep retrieval advisory and non-blocking',
      reason: 'Chat send must remain usable when knowledge routing fails',
      retrieval_count: 4,
    };
    const runtime = {
      KnowledgeStore: class {},
      RetrievalEngine: class {
        retrieve_for_task() {
          return [principle];
        }
      },
    };
    const mod = await import('@electron/services/knowledge-api');
    mod.__setSekbRuntimeModuleForTests(runtime as never);
    const api = mod.createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const withoutSourcePolicy = await api.routeContext({
      message: '之前项目里为什么选择 managed wiki 架构？',
      scope: 'wiki',
      mode: 'suggest',
    });
    expect(withoutSourcePolicy.runtimeLessons).toEqual({
      requested: false,
      included: false,
      available: false,
      principleCount: 0,
      reason: 'not-requested',
    });
    expect(withoutSourcePolicy.candidates).toHaveLength(1);
    expect(withoutSourcePolicy.candidates[0]).not.toHaveProperty('runtimeLesson');

    const withSourcePolicy = await api.routeContext({
      message: '之前项目里为什么选择 managed wiki 架构？',
      scope: 'wiki',
      mode: 'suggest',
      sourcePolicy: { runtimeLessons: true },
    });
    expect(withSourcePolicy.runtimeLessons).toEqual({
      requested: true,
      included: true,
      available: true,
      principleCount: 1,
    });
    expect(withSourcePolicy.candidates).toHaveLength(2);
    expect(withSourcePolicy.candidates[1]).toMatchObject({
      id: 'sekb:principle-route',
      lookup: 'sekb:principle-route',
      routeGroup: 'runtime_lessons',
      sourceKind: 'sekb-principle',
      runtimeLesson: {
        principleId: 'principle-route',
        condition: 'When Chat routes knowledge context',
        action: 'Keep retrieval advisory and non-blocking',
        reason: 'Chat send must remain usable when knowledge routing fails',
        retrievalCount: 4,
      },
    });
    expect(withSourcePolicy.candidateGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'runtime_lessons' }),
    ]));
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  it.each(['array', 'results', 'hits'] as const)('preserves %s Gateway rows and SourceRef in Host search', async (shape) => {
    const sourceRef = { schema: 'SourceRef/v2', domain: 'wiki', authorityId: 'memory-wiki',
      namespaceId: 'wiki-owner-fixture', subjectId: 'notes/route-context.md', revision: '1',
      sourceDigest: `sha256:${'a'.repeat(64)}`, policyEpoch: `sha256:${'b'.repeat(64)}` };
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.search') {
          const rows = [
              {
                id: 'search-1',
                title: 'Route context notes',
                lookup: 'notes/route-context.md',
                pagePath: 'notes/route-context.md',
                snippet: 'Knowledge side effects are best effort.',
                score: 0.91,
                metadata: { knowledgeKind: 'rule' },
                sourceRef,
              },
            ];
          return shape === 'array' ? rows : { [shape]: rows };
        }
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });

    const result = await api.search({ query: 'routeContext failure', corpus: 'wiki', maxResults: 5 });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'search-1', lookup: 'notes/route-context.md', sourceRef }),
    ]);
    expect(result).not.toHaveProperty('0');
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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

  it.each([false, true])('rejects archived Source Set evidence without fallback (semantic=%s)', async (semantic) => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.embedding.status') return { mode: 'remote', status: 'ready', providerRef: 'agent-fixture-provider', dimensions: 2, spaceId: 'agent-fixture-space' };
        if (method === 'wiki.get') return {
          corpus: 'wiki', path: 'notes/archived.md', title: 'Archived decision',
          content: 'ARCHIVED_BODY_MUST_NOT_ENTER_ANSWER', status: 'archived', revision: 19,
          fromLine: 1, lineCount: 80, totalLines: 120, truncated: true,
        };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const answer = await api.answerFromSourceSet({
      question: 'What is the deployment decision?', semantic,
      sourceRefs: [{ id: 'notes/archived.md', kind: 'wiki', path: 'notes/archived.md' }],
    });
    expect(answer.groundingStatus).toBe('missing_sources');
    expect(answer.sources).toEqual([]);
    expect(answer.answer).not.toContain('ARCHIVED_BODY_MUST_NOT_ENTER_ANSWER');
    expect(answer.rejections).toEqual([expect.objectContaining({ reason: 'archived', subjectId: 'notes/archived.md' })]);
    expect(answer.confidence).toBeUndefined();
    expect(gatewayManager.rpc.mock.calls.some(call => call[0] === 'wiki.embedding.embed')).toBe(false);
  });

  it('retains explicit Source Set version pins and rejects a changed owner revision', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.get') return {
          corpus: 'wiki', path: 'notes/versioned.md', title: 'Versioned decision',
          content: 'OWNER_REVISION_20_BODY', status: 'active', revision: 20,
        };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const ref = { id: 'notes/versioned.md', kind: 'wiki' as const, path: 'notes/versioned.md', revision: '19' };
    const saved = await api.saveSourceSet({ title: 'Pinned decision', sourceRefs: [ref] });
    expect(saved.sourceSet?.sourceRefs).toEqual([ref]);
    const answer = await api.answerFromSourceSet({ question: 'Which decision applies?', sourceRefs: saved.sourceSet!.sourceRefs });
    expect(answer.groundingStatus).toBe('missing_sources');
    expect(answer.sources).toEqual([]);
    expect(answer.rejections).toEqual([expect.objectContaining({ reason: 'revision_mismatch' })]);
    expect(answer.answer).not.toContain('OWNER_REVISION_20_BODY');
  });

  it('reports unverified Source Set excerpts as partial rather than a calibrated answer', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.get') return {
          corpus: 'wiki', path: params.lookup, title: String(params.lookup),
          content: params.lookup === 'notes/port-a.md' ? 'The gateway port is 8080.' : 'The gateway port is 9090.',
          status: 'active', revision: 19, updatedAt: '2026-11-04T00:00:00.000Z',
        };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const answer = await api.answerFromSourceSet({
      question: 'What port should the gateway use?',
      sourceRefs: ['notes/port-a.md', 'notes/port-b.md'].map((id) => ({ id, kind: 'wiki', path: id })),
    });
    expect(answer.groundingStatus).toBe('partial');
    expect(answer.synthesisMode).toBe('source-excerpts');
    expect(answer.confidence).toBeUndefined();
    expect(answer.unknowns.join(' ')).toContain('not been evaluated');
    expect(answer.sources.every((source) => source.citation?.revision === '19')).toBe(true);
  });

  it('keeps Studio drafts bound to admitted evidence and prevents client metadata from upgrading it', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.get') return {
          corpus: 'wiki', path: params.lookup, title: String(params.lookup),
          content: params.lookup === 'notes/active.md' ? 'ADMITTED_BODY' : 'ARCHIVED_BODY',
          status: params.lookup === 'notes/active.md' ? 'active' : 'archived', revision: 19,
        };
        throw new Error(`unexpected rpc ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const archived = { id: 'notes/archived.md', kind: 'wiki' as const, path: 'notes/archived.md' };
    await expect(api.createArtifactDraft({ artifactType: 'summary', sourceRefs: [archived] })).resolves.toMatchObject({ success: false });
    await expect(api.listDrafts({ status: 'all' })).resolves.toMatchObject({ drafts: [] });
    const result = await api.createArtifactDraft({
      artifactType: 'summary', sourceRefs: [{ id: 'notes/active.md', kind: 'wiki', path: 'notes/active.md' }, archived],
      metadata: { groundingStatus: 'grounded', rejections: [], sourceSetEvidence: [], driven_by: 'real-human', actor: 'publisher' },
    });
    expect(result.success).toBe(true);
    expect(result.draft?.sourceRefs).toEqual([expect.objectContaining({ id: 'notes/active.md', revision: '19' })]);
    expect(result.draft?.metadata).toMatchObject({
      driven_by: 'agent', actor: 'knowledge-source-set',
      groundingStatus: 'partial', rejections: [expect.objectContaining({ reason: 'archived' })],
      sourceSetEvidence: [expect.objectContaining({ citation: expect.objectContaining({ revision: '19' }) })],
    });
    expect(result.draft?.createdBy).toBe('agent');
    expect(result.draft?.confidence).toBeUndefined();
    expect(JSON.stringify(result.draft)).not.toContain('ARCHIVED_BODY');
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  it('applies saved Source Set workspace context without granting cross-workspace reads', async () => {
    const gatewayManager = { rpc: vi.fn(async (method: string) => method === 'sessions.describe'
      ? { session: { sessionId: '10000000-0000-4000-8000-000000000001' } }
      : ({ corpus: 'wiki', path: 'notes/scoped.md', content: 'OTHER_WORKSPACE_BODY', status: 'active', scope: { workspaceId: 'workspace-b' } })) };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const saved = await api.saveSourceSet({ title: 'Workspace A', sourceRefs: [{ id: 'notes/scoped.md', kind: 'wiki' }], metadata: { workspaceId: 'workspace-a' } });
    const answer = await api.answerFromSourceSet({ question: 'Scoped answer?', sourceRefs: saved.sourceSet!.sourceRefs, sourceSetId: saved.sourceSet!.id });
    expect(answer.sources).toEqual([]);
    expect(answer.rejections).toEqual([expect.objectContaining({ reason: 'scope_mismatch' })]);
    expect(answer.answer).not.toContain('OTHER_WORKSPACE_BODY');
  });

  it('answers default and follow-up questions through the existing model-only Gateway with checked citations', async () => {
    const listeners = new Set<(value: unknown) => void>();
    const gatewayManager = {
      on: vi.fn((_event: string, callback: (value: unknown) => void) => listeners.add(callback)),
      off: vi.fn((_event: string, callback: (value: unknown) => void) => listeners.delete(callback)),
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.search') return { results: [{ pagePath: 'port.md', title: 'Gateway port' }] };
        if (method === 'wiki.get') return { corpus: 'wiki', path: 'port.md', content: '网关端口为8080。', revision: 2, status: 'active' };
        if (method === 'agent') return { runId: 'qa-run' };
        if (method === 'agent.wait') {
          for (const callback of listeners) callback({ runId: 'qa-run', type: 'assistant.delta', text: JSON.stringify({ claims: [{ text: '网关端口为8080。', citations: [{ sourceId: 'memory-wiki:port.md', quote: '端口为8080' }] }], unknowns: [] }) });
          return { status: 'completed' };
        }
        throw Error(`Unexpected RPC ${method}`);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const answer = await api.answerFromSourceSet({ question: '它的端口呢？', sourceRefs: [], synthesis: true, history: [{ role: 'user', content: '讨论网关' }] });
    expect(answer).toMatchObject({ success: true, synthesisMode: 'model', model: { status: 'completed', runId: 'qa-run' }, groundingStatus: 'partial' });
    expect(answer.unknowns.join(' ')).toContain('no known freshness');
    expect(answer.answer).toContain('网关端口为8080');
    expect(gatewayManager.rpc).toHaveBeenCalledWith('wiki.search', expect.objectContaining({ query: expect.stringContaining('讨论网关') }), 30000);
    expect(gatewayManager.rpc).toHaveBeenCalledWith('agent', expect.objectContaining({ modelRun: true, promptMode: 'none', message: expect.stringContaining('讨论网关'), deliver: false }), 60000);
    expect(listeners.size).toBe(0);
  });

  it('persists source sets and answers from their selected sources without applying durable wiki changes', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
    expect(answer.groundingStatus).toBe('partial');
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

  it.each([false, true])('uses the selected semantic service with owner pins and one shared deadline (query expires=%s)', async (queryExpires) => {
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.stubEnv('KNOWLEDGE_EMBEDDING_DEADLINE_MS', '1000');
    try {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
        if (method === 'wiki.embedding.status') return { mode: 'remote', status: 'ready', providerRef: 'agent-fixture-provider', dimensions: 2, spaceId: 'agent-fixture-space' };
        if (method === 'wiki.embedding.embed') {
          if (params.kind === 'query') { clock += queryExpires ? 1001 : 100; return { vectors: [[1, 0]] }; }
          return { vectors: (params.sources as Array<{ subjectId: string }>).map(pin => pin.subjectId.includes('procedure') ? [0, 1] : [1, 0]) };
        }
        if (method === 'wiki.get') {
          const identity = params.readIdentity as { workspaceId: string; sessionId: string; agentSessionKey: string; egressProviderRefs: string[] };
          const context = deriveReadAdmissionContext({ principalId: 'operator', sessionId: identity.sessionId,
            sessionKey: identity.agentSessionKey, workspaceId: identity.workspaceId, ownerNamespaces: ['agent-fixture-wiki'],
            policyDigest: digestOwnerReadContent('agent-fixture-policy'), egressProviderRefs: identity.egressProviderRefs,
            expiresAt: new Date(Date.now() + 30_000).toISOString() });
          const body = params.lookup === 'notes/decision.md'
            ? 'Use source-backed drafts before durable Knowledge writes.'
            : 'Review generated artifacts before applying them.';
          const title = params.lookup === 'notes/decision.md' ? 'Decision note' : 'Procedure note';
          const snapshot = createOwnerReadSnapshot({ raw: body, startChar: 0, endChar: body.length, title, context,
            source: { domain: 'wiki', authorityId: 'memory-wiki', namespaceId: 'agent-fixture-wiki', subjectId: String(params.lookup), revision: '1' },
            policy: { status: 'active', trust: 'confirmed', sensitivity: 'workspace', acl: { read: ['operator'] }, retention: { policy: 'source-coupled' } } });
          return { lookup: params.lookup, title, pagePath: params.lookup, body, ownerSnapshot: snapshot };
        }
        if (method === 'wiki.apply') throw new Error('wiki.apply must not be called');
        throw new Error('unexpected rpc ' + method);
      }),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const answer = await api.answerFromSourceSet({
      question: 'Why keep review before durable writes?', semantic: true,
      sourceRefs: [
        { id: 'notes/procedure.md', kind: 'wiki', path: 'notes/procedure.md', label: 'Procedure note' },
        { id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision note' },
      ],
    });
    expect(answer.success).toBe(true);
    expect(answer.semanticRequested).toBe(true);
    if (queryExpires) {
      expect(answer.semanticLane).toMatchObject({ status: 'error', reason: expect.stringContaining('total deadline') });
      expect(gatewayManager.rpc.mock.calls.filter(call => call[0] === 'wiki.embedding.embed')).toHaveLength(1);
      return;
    }
    expect(answer.semanticLane, JSON.stringify(answer)).toMatchObject({ status: 'available', providerId: 'agent-fixture-provider' });
    expect(answer.retrievalDiagnostics.backend).toBe('semantic');
    expect(answer.sources.map(source => source.lookup)).toEqual(['notes/decision.md', 'notes/procedure.md']);
    const calls = gatewayManager.rpc.mock.calls.filter(call => call[0] === 'wiki.embedding.embed');
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({ kind: 'query', expectedSpaceId: 'agent-fixture-space' });
    expect(calls[1][1]).toMatchObject({ kind: 'document', expectedSpaceId: 'agent-fixture-space' });
    expect((calls[1][1].sources as unknown[])).toHaveLength(2);
    expect(calls[1][1]).not.toHaveProperty('texts');
    expect(calls[0][1].deadlineAt).toBe(calls[1][1].deadlineAt);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
    } finally { now.mockRestore(); vi.unstubAllEnvs(); }
  });

  it('normalizes provider whitespace before deriving owner egress and sending configure', async () => {
    const gatewayManager = { rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
      if (method === 'wiki.embedding.configure') return { mode: params.mode, status: 'installing', credentialEpoch: 1 };
      throw new Error(`unexpected rpc ${method}`);
    }) };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    await expect(api.embeddingConfigure({ mode: 'remote', providerRef: ' siliconflow ' })).resolves.toMatchObject({ success: true });
    const call = gatewayManager.rpc.mock.calls.find(row => row[0] === 'wiki.embedding.configure')!;
    expect(call[1]).toMatchObject({ providerRef: 'siliconflow', readIdentity: { egressProviderRefs: ['siliconflow'] } });
  });

  it('keeps admitted lexical evidence available when the embedding status service fails', async () => {
    const gatewayManager = { rpc: vi.fn(async (method: string) => {
      if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
      if (method === 'wiki.embedding.status') throw new Error('embedding service unavailable');
      if (method === 'wiki.get') return { corpus: 'wiki', path: 'notes/decision.md', title: 'Decision', content: 'Review source-backed drafts before durable writes.', status: 'active', revision: 1 };
      throw new Error(`unexpected rpc ${method}`);
    }) };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
    const result = await api.answerFromSourceSet({ question: 'Review before durable writes', semantic: true,
      sourceRefs: [{ id: 'notes/decision.md', path: 'notes/decision.md', kind: 'wiki' }] });
    expect(result.sources).toHaveLength(1);
    expect(result.semanticLane?.status).toBe('unavailable');
    expect(gatewayManager.rpc.mock.calls.some(call => call[0] === 'wiki.embedding.embed')).toBe(false);
  });

  it('creates reviewable studio artifact drafts from selected source sets', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
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
          groundingStatus: 'partial',
      },
    });
    expect(result.draft?.body).toContain('## Sources used');
    expect(result.draft?.body).toContain('Decision note');
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });

  describe('KS-01 ReviewBundle and governance integrity hard acceptance', () => {
    it('pairs 10 drafts and 10 proposals without cross-selection', async () => {
      const gatewayManager = { rpc: vi.fn(async () => { throw new Error('no wiki.apply expected'); }) };
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
      const pairs: Array<{ draftId: string; proposalId: string }> = [];
      for (let index = 0; index < 10; index += 1) {
        const draft = await api.createDraft({
          title: `Cross draft ${index}`,
          body: `Cross-body ${index} with enough source evidence for review.`,
          type: 'synthesis',
          sourceIds: [`notes/cross-${index}.md`],
          createdBy: 'user',
        });
        const proposal = await api.proposeChange({
          operation: 'create',
          draftId: draft.draft!.id,
          reason: `Cross proposal ${index}`,
          sources: [{ id: `notes/cross-${index}.md`, kind: 'wiki' }],
        });
        pairs.push({ draftId: draft.draft!.id, proposalId: proposal.proposal!.id });
      }
      const listed = await api.listReviewBundles({ status: 'all' });
      expect(listed.success).toBe(true);
      expect(listed.bundles).toHaveLength(10);
      for (const bundle of listed.bundles) {
        const pair = pairs.find((candidate) => candidate.proposalId === bundle.proposalId);
        expect(pair).toBeTruthy();
        expect(bundle.draftId).toBe(pair!.draftId);
        expect(bundle.id).toBe(`kb_${bundle.proposalId}_${bundle.draftId}`);
      }
      expect(gatewayManager.rpc).not.toHaveBeenCalled();
    });

    it('rejects stale approvals as conflicts and never calls wiki.apply', async () => {
      const gatewayManager = { rpc: vi.fn(async () => { throw new Error('wiki.apply must not be called'); }) };
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
      const draft = await api.createDraft({
        title: 'Stale CAS',
        body: 'Approved content must not apply after a later edit changes the digest.',
        type: 'synthesis',
        sourceIds: ['notes/stale.md'],
        createdBy: 'user',
      });
      const proposal = await api.proposeChange({
        operation: 'create',
        draftId: draft.draft!.id,
        reason: 'review',
        sources: [{ id: 'notes/stale.md', kind: 'wiki' }],
      });
      const reviewed = await api.reviewDraft({ id: draft.draft!.id, action: 'approve' });
      expect(reviewed.success).toBe(true);
      await api.updateDraft({ id: draft.draft!.id, body: 'Edited after approval must invalidate the reviewed digest.' });
      const applied = await api.applyReviewedChange({
        reviewBundleId: `kb_${proposal.proposal!.id}_${draft.draft!.id}`,
      });
      expect(applied.success).toBe(false);
      expect(applied.conflict?.code === 'stale_revision' || applied.conflict?.code === 'stale_digest').toBe(true);
      expect(gatewayManager.rpc).not.toHaveBeenCalled();
    });

    it('concurrent same captureKey calls create exactly one inbox candidate', async () => {
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: { rpc: vi.fn() } as never });
      const payloads = Array.from({ length: 12 }, (_, index) => ({
        title: `Concurrent candidate ${index}`,
        body: 'Concurrent captures with the same key must dedupe inside one critical section.',
        kind: 'task-ledger' as const,
        type: 'decision' as const,
        sourceIds: [`task-${index}`],
        createdBy: 'agent' as const,
        metadata: { captureKey: 'mission:concurrent:capture:stable-key' },
      }));
      const results = await Promise.all(payloads.map((payload) => api.createInboxItem(payload)));
      expect(results.every((result) => result.success)).toBe(true);
      const ids = new Set(results.map((result) => result.item?.id).filter(Boolean));
      expect(ids.size).toBe(1);
      const listed = await api.listInboxItems({ status: 'pending' });
      expect(listed.items).toHaveLength(1);
    });

    it('idempotent apply retry is duplicate success and writes an operation journal', async () => {
      const gatewayManager = {
        rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
          if (method === 'wiki.apply') return { pageId: 'idempotent-page' };
          throw new Error(`unexpected rpc ${method}`);
        }),
      };
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: gatewayManager as never });
      const draft = await api.createDraft({
        title: 'Idempotent apply',
        body: 'The same effect key and digest must never call wiki.apply twice.',
        type: 'synthesis',
        sourceIds: ['notes/idempotent.md'],
        createdBy: 'user',
      });
      const proposal = await api.proposeChange({
        operation: 'create',
        draftId: draft.draft!.id,
        reason: 'review',
        sources: [{ id: 'notes/idempotent.md', kind: 'wiki' }],
      });
      const bundleId = `kb_${proposal.proposal!.id}_${draft.draft!.id}`;
      await api.reviewDraft({ id: draft.draft!.id, action: 'approve' });
      const first = await api.applyReviewedChange({ reviewBundleId: bundleId });
      const second = await api.applyReviewedChange({ reviewBundleId: bundleId });
      expect(first.success).toBe(true);
      expect(second).toMatchObject({ success: true, changed: false, operation: 'duplicate' });
      expect(gatewayManager.rpc).toHaveBeenCalledTimes(1);
      const operationsDir = join(root, 'knowledge', 'operations');
      expect(readdirSync(operationsDir).filter((name) => name.endsWith('.json'))).toHaveLength(1);
      const journal = JSON.parse(readFileSync(join(operationsDir, readdirSync(operationsDir)[0]), 'utf8'));
      expect(journal.state).toBe('json_committed');
      expect(journal.idempotencyKey).toBeTruthy();
    });
  });


  describe('KS-03 GovernanceStore cutover hard acceptance', () => {
    it('new inbox/draft/proposal records go to SQLite and JSON governance writers stay zero', async () => {
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: { rpc: vi.fn() } as never });
      const inbox = await api.createInboxItem({
        title: 'SQLite inbox',
        body: 'Inbox records must persist in openclaw-state after KS-03 cutover.',
        kind: 'manual',
        createdBy: 'user',
      });
      const draft = await api.createDraft({
        title: 'SQLite draft',
        body: 'Draft records must persist in openclaw-state after KS-03 cutover.',
        type: 'synthesis',
        sourceIds: ['notes/sqlite.md'],
        createdBy: 'user',
      });
      const proposal = await api.proposeChange({
        operation: 'create',
        draftId: draft.draft!.id,
        reason: 'cutover',
        sources: [{ id: 'notes/sqlite.md', kind: 'wiki' }],
      });
      expect(inbox.success).toBe(true);
      expect(draft.success).toBe(true);
      expect(proposal.success).toBe(true);
      expect(readdirSync(join(root, 'knowledge', 'inbox')).filter((name) => name.endsWith('.json'))).toEqual([]);
      expect(readdirSync(join(root, 'knowledge', 'drafts')).filter((name) => name.endsWith('.json'))).toEqual([]);
      expect(readdirSync(join(root, 'knowledge', 'proposals')).filter((name) => name.endsWith('.json'))).toEqual([]);
      const { GovernanceStore } = await import('../../openclaw_runtime/src/knowledge/governance-store');
      const { openOpenClawStateDatabase } = await import('../../openclaw_runtime/src/state/openclaw-state-db');
      const database = openOpenClawStateDatabase({
        env: { ...process.env, OPENCLAW_STATE_DIR: join(root, 'userData', 'openclaw-source-state') },
      });
      const store = new GovernanceStore({ database: { path: database.path } });
      expect(store.listCandidates({ recordKind: 'inbox' })).toHaveLength(1);
      expect(store.listCandidates({ recordKind: 'draft' })).toHaveLength(1);
      expect(store.listProposals({ draftId: draft.draft!.id })).toHaveLength(1);
    });

    it('imports legacy JSON in one transaction and leaves it read-only with parity 100%', async () => {
      const legacyDraft = {
        id: 'kd_legacy_import',
        title: 'Legacy JSON draft',
        body: 'This record predates the SQLite GovernanceStore cutover.',
        type: 'synthesis',
        status: 'draft',
        sourceIds: ['notes/legacy.md'],
        sourceRefs: [{ id: 'notes/legacy.md', kind: 'wiki' }],
        tags: [],
        workspaceId: null,
        agentId: null,
        createdBy: 'user',
        warnings: [],
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      };
      const legacyProposal = {
        id: 'kp_legacy_import',
        operation: 'create',
        status: 'proposed',
        draftId: 'kd_legacy_import',
        reason: 'legacy',
        sources: [{ id: 'notes/legacy.md', kind: 'wiki' }],
        requiresUserConfirmation: true,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      };
      mkdirSync(join(root, 'knowledge', 'drafts'), { recursive: true });
      mkdirSync(join(root, 'knowledge', 'proposals'), { recursive: true });
      writeFileSync(join(root, 'knowledge', 'drafts', 'kd_legacy_import.json'), JSON.stringify(legacyDraft));
      writeFileSync(join(root, 'knowledge', 'proposals', 'kp_legacy_import.json'), JSON.stringify(legacyProposal));
      const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
      const api = createKnowledgeApi({ gatewayManager: { rpc: vi.fn() } as never });
      const listed = await api.listDrafts({ status: 'all' });
      const proposals = await api.listProposals({ status: 'all' });
      expect(listed.drafts.some((draft) => draft.id === 'kd_legacy_import')).toBe(true);
      expect(proposals.proposals.some((proposal) => proposal.id === 'kp_legacy_import')).toBe(true);
      const report = JSON.parse(readFileSync(join(root, 'knowledge', 'governance-migration.json'), 'utf8'));
      expect(report.candidates.jsonCount).toBe(1);
      expect(report.candidates.importedCount).toBe(1);
      expect(report.proposals.jsonCount).toBe(1);
      expect(report.proposals.importedCount).toBe(1);
      expect(report.legacyJsonMode).toBe('read-only');
      expect(readFileSync(join(root, 'knowledge', 'drafts', 'kd_legacy_import.json'), 'utf8')).toContain('Legacy JSON draft');
    });
  });


  describe('KS-02 truthful DCS projection sink', () => {
    it('exposes a blockstore sink with read-back verification when state DB opens', async () => {
      const { createHostExperienceProjectionSink } = await import('@electron/services/knowledge-api');
      const stateDir = join(root, 'userData', 'openclaw-source-state');
      const projection = createHostExperienceProjectionSink(stateDir);
      expect(projection.kind).toBe('blockstore');
      const blockId = 'experience:sekb:experience-projection/v1:agent:alpha:main:principle-verify:rev1';
      const result = await projection.sink([{
        block: {
          block_id: blockId,
          block_type: 'experience',
          source_system: 'sekb',
          session_id: 'agent:alpha:main',
          presence: { always_on: false, on_demand: { expand_tool: 'context_search', auto_register: false }, background: true },
          entities: ['postgresql'],
          valid_at: new Date('2020-01-01T00:00:00.000Z'),
          created_at: new Date('2020-01-01T00:00:00.000Z'),
          mutability: 'system_managed',
          summary: 'Verify',
          full_content: 'Read-back before persisted.',
          compression_depth: 0,
          entity_extraction_status: 'empty',
        },
        admission: {
          confirmed: true,
          confidence: 0.8,
          write_origin: 'handler',
          integrity: 'confirmed',
          session_id: 'agent:alpha:main',
          provenance_source: 'sekb',
        },
      }]);
      expect(result[0].accepted).toBe(true);
      expect(await projection.verifyBlock!(blockId, 'agent:alpha:main')).toBe(true);
    });

    it('falls back to a journal sink and never claims blockstore when state DB cannot open', async () => {
      const { createHostExperienceProjectionSink } = await import('@electron/services/knowledge-api');
      const statePath = join(root, 'state-as-file');
      writeFileSync(statePath, 'not-a-directory');
      const projection = createHostExperienceProjectionSink(statePath);
      expect(projection.kind).toBe('journal');
      expect(projection.verifyBlock).toBeUndefined();
    });
  });

});
