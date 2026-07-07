# Knowledge Runtime Lessons Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SEKB distillation suggestions reviewable inside the existing Knowledge governance flow, with explicit confirm, reject, and export-to-draft actions.

**Architecture:** Knowledge remains the user-facing governance surface. Electron Main owns a Knowledge Host API review adapter that calls the existing SEKB `DistillationTool` for runtime principle confirmation/rejection and reuses existing Knowledge draft/proposal helpers when a Runtime Lesson should become Library content. Renderer consumes only `hostApi.knowledge.*`, shows Runtime Lesson suggestions in the existing Runtime Lessons and Review surfaces, and never calls SEKB, IPC, Gateway HTTP, or wiki.apply directly.

**Tech Stack:** Electron Main service, typed Host API contract, React 19, Vite, TypeScript, Vitest, Playwright Electron E2E, react-i18next locale JSON, existing OpenClaw runtime SEKB distillation APIs.

## Global Constraints

- Work on branch `codex/sekb-runtime-knowledge`; do not use `knowledge-ux`.
- The current worktree contains unrelated runtime-memory and context-runtime-kit files; every git command must use explicit pathspecs.
- Do not create a parallel SEKB governance system; Phase 2 must reuse Knowledge review, draft, proposal, provenance, and governance concepts.
- Renderer backend calls must go through `src/lib/host-api.ts`; no direct renderer IPC and no direct Gateway HTTP/WebSocket.
- SEKB remains runtime-side, explicit, default-off, advisory, and confirmation-gated.
- `DistillationTool.confirm_and_save` remains the only path that writes confirmed SEKB L2 principles.
- Rejecting a Runtime Lesson suggestion records a SEKB rejection only; it must not write Library/wiki content.
- Exporting a Runtime Lesson to Knowledge creates an existing Knowledge draft and create proposal only; it must not call `wiki.apply`.
- Persistent SEKB state stays in OpenClaw SQLite. Do not add SEKB JSON sidecars.
- Existing Knowledge draft/proposal storage may be reused because it is the current Knowledge governance system.
- User-visible UI text must be added to `shared/i18n/locales/en/zh/ja/ru/knowledge.json`.
- User-visible UI change requires Electron E2E coverage.
- Host API/Main/renderer boundary changes require focused unit tests and comms replay/compare.
- No desktop default-on SEKB enablement, autonomous distillation, verifier, curator, hidden correction, retry, output rewrite, tool blocking, or external vector DB in this phase.

---

## Stage Checklist

- [ ] Stage 0: Re-run `git status --short --branch` and both harness context commands before implementation.
- [ ] Stage 1: Scope mapping is `Desktop UI + Operator surface + Distillation`, implemented through existing Knowledge governance.
- [ ] Stage 2: Write failing tests first for service, facade, UI, and E2E.
- [ ] Stage 3: Implement only the typed Host API, Main service adapter, Knowledge UI, i18n, and docs.
- [ ] Stage 4: Prove confirm/reject/export do not call `wiki.apply` unless the user later applies an approved Knowledge proposal.
- [ ] Stage 5: Update docs and README translations because this phase changes user-visible Knowledge behavior.
- [ ] Stage 6: Run focused tests, E2E, harness validation, comms replay/compare, and path-limited diff checks.

## Governance Reuse Decision

Use the existing Knowledge governance system as the owner:

- Runtime Lessons tab remains the inspection and quick triage surface.
- Review tab becomes the unified review queue for both Knowledge drafts/proposals and Runtime Lesson suggestions.
- Confirm writes an SEKB Runtime Lesson principle through `DistillationTool.confirm_and_save`.
- Reject writes an SEKB distillation rejection through `DistillationTool.reject_suggestion`.
- Export creates a normal Knowledge draft plus create proposal with Runtime Lesson provenance, then the existing approve/apply path controls any Library/wiki write.
- Governance shows counts and boundaries, but it does not become a separate SEKB admin console.

Rejected approaches:

- A standalone SEKB management page is rejected because it duplicates Knowledge governance.
- Directly converting suggestions into wiki pages is rejected because it bypasses existing draft/proposal review.
- Persisting pending suggestions in a new sidecar table/file is rejected for Phase 2 because current SEKB suggestions can be regenerated from undistilled trajectories and rejections already persist in SEKB SQLite.

## File Structure

- Modify `shared/host-api/contract.ts`
  Add reviewable Runtime Lesson suggestion types, source provenance kind, and Knowledge Host API methods for list, confirm, reject, and export.

- Modify `src/lib/host-api.ts`
  Export new types and add facade methods that call typed `invokeHost('knowledge', ...)`.

- Modify `electron/services/knowledge-api.ts`
  Add an injectable Runtime Lessons reviewer bridge. The default bridge dynamically loads built OpenClaw runtime SEKB modules from `getOpenClawRuntimeDir()/dist/knowledge/sekb/index.js`, calls `DistillationTool`, and maps SEKB suggestions into Knowledge-owned review models. Export-to-draft reuses existing `createDraftFromPayload`, `writeDraft`, `createProposalForDraft`, and `writeProposal`.

- Modify `src/pages/Knowledge/index.tsx`
  Add Runtime Lesson suggestion state, actions, and review UI inside the existing Runtime Lessons and Review tabs.

- Modify locale files:
  `shared/i18n/locales/en/knowledge.json`,
  `shared/i18n/locales/zh/knowledge.json`,
  `shared/i18n/locales/ja/knowledge.json`,
  `shared/i18n/locales/ru/knowledge.json`.

- Modify tests:
  `tests/unit/knowledge-api.test.ts`,
  `tests/unit/host-api-facade.test.ts`,
  `tests/unit/knowledge-page.test.tsx`,
  `tests/e2e/knowledge-hub.spec.ts`.

- Modify docs:
  `README.md`,
  `README.zh-CN.md`,
  `README.ja-JP.md`,
  `docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md`,
  `docs/enhancements/sekb-runtime-roadmap.md`.

---

### Task 1: Host API Contract And Main Review Adapter

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `electron/services/knowledge-api.ts`
- Test: `tests/unit/knowledge-api.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`

**Interfaces:**
- Produces: `KnowledgeRuntimeLessonSuggestion`
- Produces: `hostApi.knowledge.listRuntimeLessonSuggestions(payload?)`
- Produces: `hostApi.knowledge.confirmRuntimeLessonSuggestion(payload)`
- Produces: `hostApi.knowledge.rejectRuntimeLessonSuggestion(payload)`
- Produces: `hostApi.knowledge.exportRuntimeLessonToDraft(payload)`
- Produces: `createKnowledgeApi({ gatewayManager, runtimeLessonsReporter?, runtimeLessonsReviewer? })`

- [ ] **Step 1: Write failing service test for Runtime Lesson governance reuse**

Add this test to `tests/unit/knowledge-api.test.ts` after the existing Runtime Lessons report test:

```ts
  it('reviews SEKB runtime lesson suggestions through Knowledge governance without wiki writes', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => {
        throw new Error('runtime lesson review must not call Gateway RPC');
      }),
    };
    const suggestion = {
      id: 'krls-1',
      clusterSummary: 'Similar coding trajectories (2)',
      sourceTrajectoryIds: ['traj-1', 'traj-2'],
      suggestedPrinciple: {
        title: 'Check prior runtime lessons before editing Knowledge',
        condition: 'When changing Knowledge review behavior',
        action: 'Inspect matching SEKB trajectories and active principles first',
        reason: 'Repeated Knowledge failures usually preserve useful setup constraints',
        taskTypes: ['coding'],
        contextTags: ['knowledge', 'sekb'],
        criticality: 'medium' as const,
      },
      confidence: 0.72,
      sourceRefs: [
        { id: 'sekb:trajectory:traj-1', kind: 'runtime_lesson' as const, label: 'SEKB trajectory traj-1' },
        { id: 'sekb:trajectory:traj-2', kind: 'runtime_lesson' as const, label: 'SEKB trajectory traj-2' },
      ],
    };
    const runtimeLessonsReviewer = {
      listSuggestions: vi.fn(async () => ({
        success: true,
        available: true,
        suggestions: [suggestion],
      })),
      confirmSuggestion: vi.fn(async () => ({
        success: true,
        available: true,
        suggestion,
        principleId: 'principle-1',
      })),
      rejectSuggestion: vi.fn(async () => ({
        success: true,
        available: true,
        suggestion,
      })),
    };
    const { createKnowledgeApi } = await import('@electron/services/knowledge-api');
    const api = createKnowledgeApi({
      gatewayManager: gatewayManager as never,
      runtimeLessonsReviewer,
    });

    await expect(api.listRuntimeLessonSuggestions({ minClusterSize: 2, limit: 10 })).resolves.toMatchObject({
      success: true,
      available: true,
      suggestions: [expect.objectContaining({ id: 'krls-1' })],
    });

    await expect(api.confirmRuntimeLessonSuggestion({
      suggestionId: 'krls-1',
      edits: { criticality: 'high' },
    })).resolves.toMatchObject({
      success: true,
      principleId: 'principle-1',
    });

    await expect(api.rejectRuntimeLessonSuggestion({
      suggestionId: 'krls-1',
      reason: 'Too specific for this workspace',
    })).resolves.toMatchObject({
      success: true,
      suggestion: expect.objectContaining({ id: 'krls-1' }),
    });

    const exported = await api.exportRuntimeLessonToDraft({ suggestionId: 'krls-1' });
    expect(exported).toMatchObject({
      success: true,
      draft: expect.objectContaining({
        title: 'Check prior runtime lessons before editing Knowledge',
        type: 'troubleshooting',
        status: 'draft',
        sourceIds: ['sekb:trajectory:traj-1', 'sekb:trajectory:traj-2'],
        sourceRefs: [
          expect.objectContaining({ id: 'sekb:trajectory:traj-1', kind: 'runtime_lesson' }),
        ],
      }),
      proposal: expect.objectContaining({
        operation: 'create',
        status: 'proposed',
        requiresUserConfirmation: true,
      }),
    });

    const drafts = await api.listDrafts({ status: 'all' });
    expect(drafts.drafts).toHaveLength(1);
    const proposals = await api.listProposals({ status: 'all' });
    expect(proposals.proposals).toHaveLength(1);
    expect(runtimeLessonsReviewer.listSuggestions).toHaveBeenCalledWith({ minClusterSize: 2, limit: 10 });
    expect(runtimeLessonsReviewer.confirmSuggestion).toHaveBeenCalledWith({
      suggestionId: 'krls-1',
      edits: { criticality: 'high' },
    });
    expect(runtimeLessonsReviewer.rejectSuggestion).toHaveBeenCalledWith({
      suggestionId: 'krls-1',
      reason: 'Too specific for this workspace',
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run service test to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-api.test.ts -t "reviews SEKB runtime lesson suggestions through Knowledge governance without wiki writes"
```

Expected: FAIL because the new Runtime Lesson review Host API methods and reviewer injection do not exist.

- [ ] **Step 3: Write failing facade test**

In `tests/unit/host-api-facade.test.ts`, extend the existing `calls knowledge APIs through hostInvoke` test by adding these calls after `runtimeLessonsReport()`:

```ts
    await hostApi.knowledge.listRuntimeLessonSuggestions({ minClusterSize: 2, limit: 10 });
    await hostApi.knowledge.confirmRuntimeLessonSuggestion({
      suggestionId: 'krls-1',
      edits: { criticality: 'high' },
    });
    await hostApi.knowledge.rejectRuntimeLessonSuggestion({
      suggestionId: 'krls-1',
      reason: 'Too specific',
    });
    await hostApi.knowledge.exportRuntimeLessonToDraft({ suggestionId: 'krls-1' });
```

Add these expectations after the current `runtimeLessonsReport` expectation:

```ts
    expect(hostInvoke).toHaveBeenNthCalledWith(9, expect.objectContaining({
      module: 'knowledge',
      action: 'listRuntimeLessonSuggestions',
      payload: { minClusterSize: 2, limit: 10 },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(10, expect.objectContaining({
      module: 'knowledge',
      action: 'confirmRuntimeLessonSuggestion',
      payload: { suggestionId: 'krls-1', edits: { criticality: 'high' } },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(11, expect.objectContaining({
      module: 'knowledge',
      action: 'rejectRuntimeLessonSuggestion',
      payload: { suggestionId: 'krls-1', reason: 'Too specific' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(12, expect.objectContaining({
      module: 'knowledge',
      action: 'exportRuntimeLessonToDraft',
      payload: { suggestionId: 'krls-1' },
    }));
```

- [ ] **Step 4: Run facade test to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/host-api-facade.test.ts -t "calls knowledge APIs through hostInvoke"
```

Expected: FAIL because the facade methods do not exist.

- [ ] **Step 5: Add Host API contract types**

In `shared/host-api/contract.ts`, extend `KnowledgeSourceRef.kind`:

```ts
  kind?: 'chat' | 'file' | 'wiki' | 'task_ledger' | 'manual' | 'search_result' | 'runtime_lesson';
```

Add these types near `KnowledgeRuntimeLessonsReportResult`:

```ts
export type KnowledgeRuntimeLessonPrincipleDraft = {
  title: string;
  condition: string;
  action: string;
  reason: string;
  taskTypes: string[];
  contextTags: string[];
  criticality: 'low' | 'medium' | 'high' | 'critical';
};

export type KnowledgeRuntimeLessonSuggestion = {
  id: string;
  clusterSummary: string;
  sourceTrajectoryIds: string[];
  suggestedPrinciple: KnowledgeRuntimeLessonPrincipleDraft;
  confidence: number;
  sourceRefs: KnowledgeSourceRef[];
};

export type KnowledgeListRuntimeLessonSuggestionsPayload = {
  trajectoryIds?: string[] | null;
  minClusterSize?: number;
  limit?: number;
};

export type KnowledgeListRuntimeLessonSuggestionsResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'reviewFailed';
  suggestions: KnowledgeRuntimeLessonSuggestion[];
};

export type KnowledgeRuntimeLessonPrincipleEdits = Partial<KnowledgeRuntimeLessonPrincipleDraft>;

export type KnowledgeConfirmRuntimeLessonSuggestionPayload = {
  suggestionId: string;
  edits?: KnowledgeRuntimeLessonPrincipleEdits;
};

export type KnowledgeRejectRuntimeLessonSuggestionPayload = {
  suggestionId: string;
  reason: string;
};

export type KnowledgeExportRuntimeLessonToDraftPayload = {
  suggestionId: string;
  title?: string;
  body?: string;
  type?: KnowledgeDraftType;
  tags?: string[];
};

export type KnowledgeRuntimeLessonReviewResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'reviewFailed';
  suggestion?: KnowledgeRuntimeLessonSuggestion;
  principleId?: string;
  draft?: KnowledgeDraft;
  proposal?: KnowledgeChangeProposal;
};
```

Add these methods to `HostApiContract['knowledge']` after `runtimeLessonsReport`:

```ts
    listRuntimeLessonSuggestions: (payload?: KnowledgeListRuntimeLessonSuggestionsPayload) => KnowledgeListRuntimeLessonSuggestionsResult;
    confirmRuntimeLessonSuggestion: (payload: KnowledgeConfirmRuntimeLessonSuggestionPayload) => KnowledgeRuntimeLessonReviewResult;
    rejectRuntimeLessonSuggestion: (payload: KnowledgeRejectRuntimeLessonSuggestionPayload) => KnowledgeRuntimeLessonReviewResult;
    exportRuntimeLessonToDraft: (payload: KnowledgeExportRuntimeLessonToDraftPayload) => KnowledgeRuntimeLessonReviewResult;
```

- [ ] **Step 6: Add Host API facade methods**

In `src/lib/host-api.ts`, import and export the new contract types, then add these methods under `hostApi.knowledge` after `runtimeLessonsReport`:

```ts
    listRuntimeLessonSuggestions: (
      input?: KnowledgeListRuntimeLessonSuggestionsPayload,
    ): Promise<KnowledgeListRuntimeLessonSuggestionsResult> => (
      invokeHost('knowledge', 'listRuntimeLessonSuggestions', input)
    ),
    confirmRuntimeLessonSuggestion: (
      input: KnowledgeConfirmRuntimeLessonSuggestionPayload,
    ): Promise<KnowledgeRuntimeLessonReviewResult> => (
      invokeHost('knowledge', 'confirmRuntimeLessonSuggestion', input)
    ),
    rejectRuntimeLessonSuggestion: (
      input: KnowledgeRejectRuntimeLessonSuggestionPayload,
    ): Promise<KnowledgeRuntimeLessonReviewResult> => (
      invokeHost('knowledge', 'rejectRuntimeLessonSuggestion', input)
    ),
    exportRuntimeLessonToDraft: (
      input: KnowledgeExportRuntimeLessonToDraftPayload,
    ): Promise<KnowledgeRuntimeLessonReviewResult> => (
      invokeHost('knowledge', 'exportRuntimeLessonToDraft', input)
    ),
```

- [ ] **Step 7: Add Main service reviewer types and SEKB mapper**

In `electron/services/knowledge-api.ts`, import the new types:

```ts
  KnowledgeConfirmRuntimeLessonSuggestionPayload,
  KnowledgeExportRuntimeLessonToDraftPayload,
  KnowledgeListRuntimeLessonSuggestionsPayload,
  KnowledgeListRuntimeLessonSuggestionsResult,
  KnowledgeRejectRuntimeLessonSuggestionPayload,
  KnowledgeRuntimeLessonPrincipleDraft,
  KnowledgeRuntimeLessonReviewResult,
  KnowledgeRuntimeLessonSuggestion,
```

Extend `normalizeSourceRefs` to accept `runtime_lesson`:

```ts
      || entry.kind === 'runtime_lesson'
```

Add these local types near `RuntimeLessonsReporter`:

```ts
type RuntimeLessonsReviewer = {
  listSuggestions: (
    payload?: KnowledgeListRuntimeLessonSuggestionsPayload,
  ) => Promise<KnowledgeListRuntimeLessonSuggestionsResult>;
  confirmSuggestion: (
    payload: KnowledgeConfirmRuntimeLessonSuggestionPayload,
  ) => Promise<KnowledgeRuntimeLessonReviewResult>;
  rejectSuggestion: (
    payload: KnowledgeRejectRuntimeLessonSuggestionPayload,
  ) => Promise<KnowledgeRuntimeLessonReviewResult>;
};

type SekbDistillationSuggestion = {
  cluster_summary: string;
  source_trajectory_ids: string[];
  suggested_principle: Record<string, unknown>;
  confidence: number;
};
```

Add these helpers near `defaultRuntimeLessonsReporter`:

```ts
function runtimeLessonSuggestionId(suggestion: SekbDistillationSuggestion): string {
  const fingerprint = {
    cluster_summary: suggestion.cluster_summary,
    source_trajectory_ids: [...suggestion.source_trajectory_ids].sort(),
    suggested_principle: suggestion.suggested_principle,
    confidence: suggestion.confidence,
  };
  return `krls_${createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 16)}`;
}

function normalizeRuntimePrincipleDraft(value: Record<string, unknown>, clusterSummary: string): KnowledgeRuntimeLessonPrincipleDraft {
  return {
    title: getString(value.title) ?? 'Review repeated runtime lesson',
    condition: getString(value.condition) ?? clusterSummary,
    action: getString(value.action) ?? 'Compare the current task against prior captured trajectories before acting',
    reason: getString(value.reason) ?? 'Prior outcomes can reveal reusable constraints',
    taskTypes: normalizeStringList(value.task_types),
    contextTags: normalizeStringList(value.context_tags),
    criticality: value.criticality === 'low' || value.criticality === 'high' || value.criticality === 'critical'
      ? value.criticality
      : 'medium',
  };
}

function normalizeRuntimeLessonSuggestion(suggestion: SekbDistillationSuggestion): KnowledgeRuntimeLessonSuggestion {
  const sourceTrajectoryIds = Array.from(new Set(suggestion.source_trajectory_ids.filter((id) => id.trim()))).sort();
  return {
    id: runtimeLessonSuggestionId(suggestion),
    clusterSummary: suggestion.cluster_summary,
    sourceTrajectoryIds,
    suggestedPrinciple: normalizeRuntimePrincipleDraft(suggestion.suggested_principle, suggestion.cluster_summary),
    confidence: Math.max(0, Math.min(1, Number.isFinite(suggestion.confidence) ? suggestion.confidence : 0)),
    sourceRefs: sourceTrajectoryIds.map((id) => ({
      id: `sekb:trajectory:${id}`,
      kind: 'runtime_lesson' as const,
      label: `SEKB trajectory ${id}`,
    })),
  };
}
```

- [ ] **Step 8: Add default SEKB reviewer bridge**

Add this default reviewer below `defaultRuntimeLessonsReporter`:

```ts
async function loadSekbDistillationRuntime(): Promise<{
  tool: {
    suggest_principles_from_trajectories: (
      trajectoryIds?: string[] | null,
      minClusterSize?: number,
    ) => SekbDistillationSuggestion[];
    confirm_and_save: (suggestion: SekbDistillationSuggestion, edits?: Record<string, unknown> | null) => string;
    reject_suggestion: (suggestion: SekbDistillationSuggestion, reason: string) => void;
  };
} | null> {
  const runtimeDir = getOpenClawRuntimeDir();
  const entryPath = join(runtimeDir, 'dist', 'knowledge', 'sekb', 'index.js');
  if (!existsSync(entryPath)) return null;
  const sekb = await import(pathToFileURL(entryPath).href) as {
    KnowledgeStore: new () => unknown;
    DistillationTool: new (options: { store: unknown }) => {
      suggest_principles_from_trajectories: (
        trajectoryIds?: string[] | null,
        minClusterSize?: number,
      ) => SekbDistillationSuggestion[];
      confirm_and_save: (suggestion: SekbDistillationSuggestion, edits?: Record<string, unknown> | null) => string;
      reject_suggestion: (suggestion: SekbDistillationSuggestion, reason: string) => void;
    };
  };
  const store = new sekb.KnowledgeStore();
  return { tool: new sekb.DistillationTool({ store }) };
}

function runtimeEditsToSekbPrinciple(edits: unknown): Record<string, unknown> | null {
  if (!isRecord(edits)) return null;
  const normalized: Record<string, unknown> = {};
  if (getString(edits.title)) normalized.title = getString(edits.title);
  if (getString(edits.condition)) normalized.condition = getString(edits.condition);
  if (getString(edits.action)) normalized.action = getString(edits.action);
  if (getString(edits.reason)) normalized.reason = getString(edits.reason);
  const taskTypes = normalizeStringList(edits.taskTypes);
  if (taskTypes.length > 0) normalized.task_types = taskTypes;
  const contextTags = normalizeStringList(edits.contextTags);
  if (contextTags.length > 0) normalized.context_tags = contextTags;
  if (edits.criticality === 'low' || edits.criticality === 'medium' || edits.criticality === 'high' || edits.criticality === 'critical') {
    normalized.criticality = edits.criticality;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function listDefaultRuntimeLessonSuggestions(
  payload?: KnowledgeListRuntimeLessonSuggestionsPayload,
): Promise<KnowledgeListRuntimeLessonSuggestionsResult> {
  try {
    const runtime = await loadSekbDistillationRuntime();
    if (!runtime) {
      return { success: true, available: false, reason: 'runtimeUnavailable', suggestions: [] };
    }
    const trajectoryIds = Array.isArray(payload?.trajectoryIds) ? normalizeStringList(payload?.trajectoryIds) : null;
    const minClusterSize = clampPositiveInt(payload?.minClusterSize, 2, 10);
    const limit = clampPositiveInt(payload?.limit, 20, 100);
    const suggestions = runtime.tool
      .suggest_principles_from_trajectories(trajectoryIds, minClusterSize)
      .map(normalizeRuntimeLessonSuggestion)
      .slice(0, limit);
    return { success: true, available: true, suggestions };
  } catch (error) {
    return {
      success: false,
      available: false,
      reason: 'reviewFailed',
      error: error instanceof Error ? error.message : String(error),
      suggestions: [],
    };
  }
}

async function findDefaultRuntimeLessonSuggestion(suggestionId: string): Promise<{
  tool: NonNullable<Awaited<ReturnType<typeof loadSekbDistillationRuntime>>>['tool'];
  raw: SekbDistillationSuggestion;
  mapped: KnowledgeRuntimeLessonSuggestion;
} | null> {
  const runtime = await loadSekbDistillationRuntime();
  if (!runtime) return null;
  const rawSuggestions = runtime.tool.suggest_principles_from_trajectories(null, 2);
  for (const raw of rawSuggestions) {
    const mapped = normalizeRuntimeLessonSuggestion(raw);
    if (mapped.id === suggestionId) return { tool: runtime.tool, raw, mapped };
  }
  return null;
}

const defaultRuntimeLessonsReviewer: RuntimeLessonsReviewer = {
  listSuggestions: listDefaultRuntimeLessonSuggestions,
  confirmSuggestion: async (payload) => {
    try {
      const suggestionId = getString(payload.suggestionId);
      if (!suggestionId) return { success: false, available: true, error: 'suggestionId is required' };
      const found = await findDefaultRuntimeLessonSuggestion(suggestionId);
      if (!found) return { success: false, available: false, reason: 'runtimeUnavailable', error: 'runtime lesson suggestion not found' };
      const principleId = found.tool.confirm_and_save(found.raw, runtimeEditsToSekbPrinciple(payload.edits));
      return { success: true, available: true, suggestion: found.mapped, principleId };
    } catch (error) {
      return { success: false, available: false, reason: 'reviewFailed', error: error instanceof Error ? error.message : String(error) };
    }
  },
  rejectSuggestion: async (payload) => {
    try {
      const suggestionId = getString(payload.suggestionId);
      const reason = getString(payload.reason);
      if (!suggestionId || !reason) return { success: false, available: true, error: 'suggestionId and reason are required' };
      const found = await findDefaultRuntimeLessonSuggestion(suggestionId);
      if (!found) return { success: false, available: false, reason: 'runtimeUnavailable', error: 'runtime lesson suggestion not found' };
      found.tool.reject_suggestion(found.raw, reason);
      return { success: true, available: true, suggestion: found.mapped };
    } catch (error) {
      return { success: false, available: false, reason: 'reviewFailed', error: error instanceof Error ? error.message : String(error) };
    }
  },
};
```

- [ ] **Step 9: Wire reviewer into Knowledge API and export-to-draft**

Change `createKnowledgeApi` signature:

```ts
export function createKnowledgeApi({
  gatewayManager,
  runtimeLessonsReporter = defaultRuntimeLessonsReporter,
  runtimeLessonsReviewer = defaultRuntimeLessonsReviewer,
}: {
  gatewayManager: GatewayManager;
  runtimeLessonsReporter?: RuntimeLessonsReporter;
  runtimeLessonsReviewer?: RuntimeLessonsReviewer;
}): CompleteHostServiceRegistry['knowledge'] {
```

Add this helper near `createProposalForDraft`:

```ts
function runtimeLessonDraftPayload(
  suggestion: KnowledgeRuntimeLessonSuggestion,
  payload: KnowledgeExportRuntimeLessonToDraftPayload,
): KnowledgeCreateDraftPayload {
  const principle = suggestion.suggestedPrinciple;
  const title = getString(payload.title) ?? principle.title;
  const body = getString(payload.body) ?? [
    `# ${title}`,
    '',
    `Condition: ${principle.condition}`,
    `Action: ${principle.action}`,
    `Reason: ${principle.reason}`,
    '',
    `Runtime cluster: ${suggestion.clusterSummary}`,
    `Confidence: ${suggestion.confidence.toFixed(2)}`,
    `Source trajectories: ${suggestion.sourceTrajectoryIds.join(', ')}`,
  ].join('\n');
  return {
    title,
    body,
    type: payload.type ?? 'troubleshooting',
    sourceIds: suggestion.sourceRefs.map((ref) => ref.id),
    sourceRefs: suggestion.sourceRefs,
    tags: normalizeStringList([
      ...principle.taskTypes,
      ...principle.contextTags,
      ...(Array.isArray(payload.tags) ? payload.tags : []),
      'runtime-lessons',
    ]),
    createdBy: 'agent',
    confidence: suggestion.confidence,
  };
}
```

Add these methods to the returned service object after `runtimeLessonsReport`:

```ts
    listRuntimeLessonSuggestions: async (payload): Promise<KnowledgeListRuntimeLessonSuggestionsResult> => (
      runtimeLessonsReviewer.listSuggestions(payload)
    ),

    confirmRuntimeLessonSuggestion: async (payload): Promise<KnowledgeRuntimeLessonReviewResult> => (
      runtimeLessonsReviewer.confirmSuggestion(payload)
    ),

    rejectRuntimeLessonSuggestion: async (payload): Promise<KnowledgeRuntimeLessonReviewResult> => (
      runtimeLessonsReviewer.rejectSuggestion(payload)
    ),

    exportRuntimeLessonToDraft: async (payload): Promise<KnowledgeRuntimeLessonReviewResult> => {
      const listed = await runtimeLessonsReviewer.listSuggestions({ limit: 100 });
      if (!listed.success || !listed.available) {
        return { success: false, available: listed.available, reason: listed.reason, error: listed.error ?? 'runtime lesson suggestions unavailable' };
      }
      const suggestion = listed.suggestions.find((item) => item.id === payload.suggestionId);
      if (!suggestion) return { success: false, available: true, error: 'runtime lesson suggestion not found' };
      const draft = createDraftFromPayload(runtimeLessonDraftPayload(suggestion, payload));
      if (!draft) return { success: false, available: true, error: 'runtime lesson draft could not be created' };
      const proposal = createProposalForDraft(draft, 'Runtime Lesson exported to a Knowledge draft for explicit review and apply.');
      await writeDraft(draft);
      await writeProposal(proposal);
      await appendAudit({
        type: 'runtime_lesson_exported_to_draft',
        suggestionId: suggestion.id,
        draftId: draft.id,
        proposalId: proposal.id,
      });
      return { success: true, available: true, suggestion, draft, proposal };
    },
```

- [ ] **Step 10: Run Task 1 tests to verify GREEN**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1 with path-limited staging**

Run:

```powershell
git add -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts
git commit --only -m "feat: review sekb lesson suggestions through knowledge api" -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts
```

Expected: commit contains only Task 1 files.

---

### Task 2: Runtime Lesson Suggestions In Existing Knowledge UI

**Files:**
- Modify: `src/pages/Knowledge/index.tsx`
- Modify: `tests/unit/knowledge-page.test.tsx`
- Modify: `shared/i18n/locales/en/knowledge.json`
- Modify: `shared/i18n/locales/zh/knowledge.json`
- Modify: `shared/i18n/locales/ja/knowledge.json`
- Modify: `shared/i18n/locales/ru/knowledge.json`

**Interfaces:**
- Consumes: `hostApi.knowledge.listRuntimeLessonSuggestions()`
- Consumes: `hostApi.knowledge.confirmRuntimeLessonSuggestion()`
- Consumes: `hostApi.knowledge.rejectRuntimeLessonSuggestion()`
- Consumes: `hostApi.knowledge.exportRuntimeLessonToDraft()`
- Produces: `data-testid="knowledge-runtime-suggestions"`
- Produces: `data-testid="knowledge-runtime-review"`
- Produces: `data-testid="runtime-suggestion-confirm-<id>"`
- Produces: `data-testid="runtime-suggestion-reject-<id>"`
- Produces: `data-testid="runtime-suggestion-export-<id>"`

- [ ] **Step 1: Write failing UI test**

In `tests/unit/knowledge-page.test.tsx`, add these mocks to `hostApiMock`:

```ts
  listRuntimeLessonSuggestions: vi.fn(),
  confirmRuntimeLessonSuggestion: vi.fn(),
  rejectRuntimeLessonSuggestion: vi.fn(),
  exportRuntimeLessonToDraft: vi.fn(),
```

Expose them in the `vi.mock('@/lib/host-api')` knowledge object:

```ts
      listRuntimeLessonSuggestions: hostApiMock.listRuntimeLessonSuggestions,
      confirmRuntimeLessonSuggestion: hostApiMock.confirmRuntimeLessonSuggestion,
      rejectRuntimeLessonSuggestion: hostApiMock.rejectRuntimeLessonSuggestion,
      exportRuntimeLessonToDraft: hostApiMock.exportRuntimeLessonToDraft,
```

Reset them in `beforeEach()`:

```ts
    hostApiMock.listRuntimeLessonSuggestions.mockReset();
    hostApiMock.confirmRuntimeLessonSuggestion.mockReset();
    hostApiMock.rejectRuntimeLessonSuggestion.mockReset();
    hostApiMock.exportRuntimeLessonToDraft.mockReset();
```

Add these labels to the local `labels` object:

```ts
  'runtime.suggestionsTitle': 'Review suggestions',
  'runtime.emptySuggestions': 'No Runtime Lesson suggestions need review.',
  'runtime.confirmSuggestion': 'Confirm Lesson',
  'runtime.rejectSuggestion': 'Reject',
  'runtime.exportSuggestion': 'Export Draft',
  'runtime.rejectReason': 'Rejection reason',
  'runtime.reviewTitle': 'Runtime Lesson review',
  'runtime.reviewSubtitle': 'Confirm runtime principles or export them into Knowledge drafts.',
  'runtime.confirmedToast': 'Runtime Lesson confirmed',
  'runtime.rejectedToast': 'Runtime Lesson rejected',
  'runtime.exportedToast': 'Runtime Lesson exported to draft',
  'runtime.confidence': 'Confidence',
  'runtime.condition': 'Condition',
  'runtime.action': 'Action',
  'runtime.reason': 'Reason',
```

Set default mock values in `beforeEach()`:

```ts
    hostApiMock.listRuntimeLessonSuggestions.mockResolvedValue({
      success: true,
      available: true,
      suggestions: [{
        id: 'krls-1',
        clusterSummary: 'Similar coding trajectories (2)',
        sourceTrajectoryIds: ['traj-1', 'traj-2'],
        suggestedPrinciple: {
          title: 'Check prior runtime lessons before editing Knowledge',
          condition: 'When changing Knowledge review behavior',
          action: 'Inspect matching SEKB trajectories first',
          reason: 'Repeated Knowledge failures usually preserve setup constraints',
          taskTypes: ['coding'],
          contextTags: ['knowledge', 'sekb'],
          criticality: 'medium',
        },
        confidence: 0.72,
        sourceRefs: [
          { id: 'sekb:trajectory:traj-1', kind: 'runtime_lesson', label: 'SEKB trajectory traj-1' },
        ],
      }],
    });
    hostApiMock.confirmRuntimeLessonSuggestion.mockResolvedValue({
      success: true,
      available: true,
      principleId: 'principle-1',
    });
    hostApiMock.rejectRuntimeLessonSuggestion.mockResolvedValue({
      success: true,
      available: true,
    });
    hostApiMock.exportRuntimeLessonToDraft.mockResolvedValue({
      success: true,
      available: true,
      draft: {
        id: 'draft-runtime-1',
        title: 'Check prior runtime lessons before editing Knowledge',
        body: 'Runtime lesson draft body',
        type: 'troubleshooting',
        status: 'draft',
        sourceIds: ['sekb:trajectory:traj-1'],
        sourceRefs: [{ id: 'sekb:trajectory:traj-1', kind: 'runtime_lesson', label: 'SEKB trajectory traj-1' }],
        tags: ['runtime-lessons'],
        workspaceId: null,
        agentId: null,
        createdBy: 'agent',
        confidence: 0.72,
        warnings: [],
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      },
      proposal: {
        id: 'proposal-runtime-1',
        operation: 'create',
        status: 'proposed',
        draftId: 'draft-runtime-1',
        reason: 'Runtime Lesson exported to a Knowledge draft for explicit review and apply.',
        sources: [{ id: 'sekb:trajectory:traj-1', kind: 'runtime_lesson' }],
        requiresUserConfirmation: true,
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      },
    });
```

Add this test:

```ts
  it('reviews Runtime Lesson suggestions through the existing Knowledge queue', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.click(await screen.findByTestId('knowledge-tab-runtime'));

    await screen.findByTestId('knowledge-runtime-suggestions');
    expect(hostApiMock.listRuntimeLessonSuggestions).toHaveBeenCalled();
    expect(screen.getAllByText('Check prior runtime lessons before editing Knowledge')[0]).toBeInTheDocument();
    expect(screen.getByText('Similar coding trajectories (2)')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('runtime-suggestion-confirm-krls-1'));
    await waitFor(() => expect(hostApiMock.confirmRuntimeLessonSuggestion).toHaveBeenCalledWith({ suggestionId: 'krls-1' }));

    fireEvent.click(await screen.findByTestId('knowledge-tab-review'));
    await screen.findByTestId('knowledge-runtime-review');
    fireEvent.change(screen.getByTestId('runtime-suggestion-reject-reason'), {
      target: { value: 'Too specific for this workspace' },
    });
    fireEvent.click(screen.getByTestId('runtime-suggestion-reject-krls-1'));
    await waitFor(() => expect(hostApiMock.rejectRuntimeLessonSuggestion).toHaveBeenCalledWith({
      suggestionId: 'krls-1',
      reason: 'Too specific for this workspace',
    }));

    fireEvent.click(screen.getByTestId('runtime-suggestion-export-krls-1'));
    await waitFor(() => expect(hostApiMock.exportRuntimeLessonToDraft).toHaveBeenCalledWith({ suggestionId: 'krls-1' }));
    expect(hostApiMock.applyReviewedChange).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run UI test to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-page.test.tsx -t "reviews Runtime Lesson suggestions through the existing Knowledge queue"
```

Expected: FAIL because Runtime Lesson suggestions and actions are not rendered.

- [ ] **Step 3: Add locale keys**

Add these keys under `runtime` in all four locale files:

```json
{
  "suggestionsTitle": "Review suggestions",
  "emptySuggestions": "No Runtime Lesson suggestions need review.",
  "confirmSuggestion": "Confirm Lesson",
  "rejectSuggestion": "Reject",
  "exportSuggestion": "Export Draft",
  "rejectReason": "Rejection reason",
  "reviewTitle": "Runtime Lesson review",
  "reviewSubtitle": "Confirm runtime principles or export them into Knowledge drafts.",
  "confirmedToast": "Runtime Lesson confirmed",
  "rejectedToast": "Runtime Lesson rejected",
  "exportedToast": "Runtime Lesson exported to draft",
  "confidence": "Confidence",
  "condition": "Condition",
  "action": "Action",
  "reason": "Reason"
}
```

Use concise translations in `zh`, `ja`, and `ru`, preserve existing JSON ordering where practical, and do not hardcode these strings in JSX.

- [ ] **Step 4: Add Runtime Lesson suggestion state and loaders**

In `src/pages/Knowledge/index.tsx`, import the new type:

```ts
  type KnowledgeRuntimeLessonSuggestion,
```

Add state near the existing Runtime Lessons state:

```ts
  const [runtimeSuggestions, setRuntimeSuggestions] = useState<KnowledgeRuntimeLessonSuggestion[]>([]);
  const [runtimeSuggestionsLoading, setRuntimeSuggestionsLoading] = useState(false);
  const [runtimeSuggestionsLoaded, setRuntimeSuggestionsLoaded] = useState(false);
  const [selectedRuntimeSuggestionId, setSelectedRuntimeSuggestionId] = useState<string | null>(null);
  const [runtimeRejectReason, setRuntimeRejectReason] = useState('');
```

Add derived selection:

```ts
  const selectedRuntimeSuggestion = useMemo(
    () => runtimeSuggestions.find((suggestion) => suggestion.id === selectedRuntimeSuggestionId) ?? runtimeSuggestions[0] ?? null,
    [runtimeSuggestions, selectedRuntimeSuggestionId],
  );
```

Add loader:

```ts
  const refreshRuntimeSuggestions = useCallback(async () => {
    setRuntimeSuggestionsLoading(true);
    try {
      const result = await hostApi.knowledge.listRuntimeLessonSuggestions({ limit: 20, minClusterSize: 2 });
      if (!result.success || !result.available) {
        setRuntimeSuggestions([]);
        setRuntimeSuggestionsLoaded(true);
        return;
      }
      setRuntimeSuggestions(result.suggestions);
      setSelectedRuntimeSuggestionId((current) => (
        current && result.suggestions.some((suggestion) => suggestion.id === current)
          ? current
          : result.suggestions[0]?.id ?? null
      ));
      setRuntimeSuggestionsLoaded(true);
    } catch {
      setRuntimeSuggestions([]);
      setRuntimeSuggestionsLoaded(true);
    } finally {
      setRuntimeSuggestionsLoading(false);
    }
  }, []);
```

Load suggestions when the Runtime Lessons or Review tab is selected:

```ts
  useEffect(() => {
    if ((workbenchTab === 'runtime' || workbenchTab === 'review') && !runtimeSuggestionsLoaded && !runtimeSuggestionsLoading) {
      void refreshRuntimeSuggestions();
    }
  }, [refreshRuntimeSuggestions, runtimeSuggestionsLoaded, runtimeSuggestionsLoading, workbenchTab]);
```

- [ ] **Step 5: Add Runtime Lesson action handlers**

Add these callbacks near the existing draft review callbacks:

```ts
  const confirmRuntimeSuggestion = useCallback(async (suggestionId: string) => {
    setRunning('confirmRuntimeLesson');
    setError(null);
    try {
      const result = await hostApi.knowledge.confirmRuntimeLessonSuggestion({ suggestionId });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('runtime.confirmedToast'));
      await Promise.all([refreshRuntimeLessons(), refreshRuntimeSuggestions()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshRuntimeLessons, refreshRuntimeSuggestions, t]);

  const rejectRuntimeSuggestion = useCallback(async (suggestionId: string) => {
    const reason = runtimeRejectReason.trim();
    if (!reason) return;
    setRunning('rejectRuntimeLesson');
    setError(null);
    try {
      const result = await hostApi.knowledge.rejectRuntimeLessonSuggestion({ suggestionId, reason });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('runtime.rejectedToast'));
      setRuntimeRejectReason('');
      await refreshRuntimeSuggestions();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshRuntimeSuggestions, runtimeRejectReason, t]);

  const exportRuntimeSuggestion = useCallback(async (suggestionId: string) => {
    setRunning('exportRuntimeLesson');
    setError(null);
    try {
      const result = await hostApi.knowledge.exportRuntimeLessonToDraft({ suggestionId });
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('runtime.exportedToast'));
      await refreshGovernance();
      if (result.draft) {
        setDrafts((previous) => [result.draft!, ...previous.filter((draft) => draft.id !== result.draft!.id)]);
      }
      if (result.proposal) {
        setProposals((previous) => [result.proposal!, ...previous.filter((proposal) => proposal.id !== result.proposal!.id)]);
      }
      if (result.draft) setSelectedDraftId(result.draft.id);
      if (result.proposal) setSelectedProposalId(result.proposal.id);
      setWorkbenchTab('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [refreshGovernance, t]);
```

- [ ] **Step 6: Render Runtime Lesson suggestions in the Runtime tab**

Inside the existing `workbenchTab === 'runtime'` block, below active principles/index preview, add a suggestions section:

```tsx
                    <div className="space-y-3" data-testid="knowledge-runtime-suggestions">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{t('runtime.suggestionsTitle')}</div>
                        {runtimeSuggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                      </div>
                      {runtimeSuggestions.length === 0 && (
                        <p className="rounded-lg border border-black/10 bg-surface-input p-4 text-sm text-muted-foreground dark:border-white/10">
                          {t('runtime.emptySuggestions')}
                        </p>
                      )}
                      {runtimeSuggestions.map((suggestion) => (
                        <div key={suggestion.id} className="rounded-lg border border-black/10 bg-surface-input p-4 dark:border-white/10">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold">{suggestion.suggestedPrinciple.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{suggestion.clusterSummary}</div>
                              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                                <div><span className="font-medium text-foreground/80">{t('runtime.condition')}:</span> {suggestion.suggestedPrinciple.condition}</div>
                                <div><span className="font-medium text-foreground/80">{t('runtime.action')}:</span> {suggestion.suggestedPrinciple.action}</div>
                                <div><span className="font-medium text-foreground/80">{t('runtime.reason')}:</span> {suggestion.suggestedPrinciple.reason}</div>
                              </div>
                            </div>
                            <Badge variant="outline" className="border-black/10 bg-background/60 text-[10px] dark:border-white/10">
                              {t('runtime.confidence')}: {Math.round(suggestion.confidence * 100)}%
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void confirmRuntimeSuggestion(suggestion.id)}
                              disabled={busy}
                              data-testid={`runtime-suggestion-confirm-${suggestion.id}`}
                            >
                              {t('runtime.confirmSuggestion')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={QUIET_BUTTON_CLASS}
                              onClick={() => void exportRuntimeSuggestion(suggestion.id)}
                              disabled={busy}
                              data-testid={`runtime-suggestion-export-${suggestion.id}`}
                            >
                              {t('runtime.exportSuggestion')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
```

- [ ] **Step 7: Render Runtime Lesson suggestions in the Review tab**

Inside the existing `workbenchTab === 'review'` layout, add a Runtime Lesson review block before the existing draft/proposal review block:

```tsx
                <div className="rounded-lg border border-black/10 bg-surface-input p-3 dark:border-white/10 lg:col-span-2" data-testid="knowledge-runtime-review">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{t('runtime.reviewTitle')}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('runtime.reviewSubtitle')}</p>
                    </div>
                    <Badge variant="outline" className="border-black/10 bg-background/60 text-[10px] dark:border-white/10">
                      {runtimeSuggestions.length}
                    </Badge>
                  </div>
                  {selectedRuntimeSuggestion ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-md bg-background/60 p-3">
                        <div className="text-sm font-semibold">{selectedRuntimeSuggestion.suggestedPrinciple.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{selectedRuntimeSuggestion.clusterSummary}</div>
                      </div>
                      <Textarea
                        value={runtimeRejectReason}
                        onChange={(event) => setRuntimeRejectReason(event.target.value)}
                        placeholder={t('runtime.rejectReason')}
                        rows={2}
                        data-testid="runtime-suggestion-reject-reason"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => void confirmRuntimeSuggestion(selectedRuntimeSuggestion.id)}
                          disabled={busy}
                          data-testid={`runtime-suggestion-confirm-${selectedRuntimeSuggestion.id}`}
                        >
                          {t('runtime.confirmSuggestion')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={QUIET_BUTTON_CLASS}
                          onClick={() => void exportRuntimeSuggestion(selectedRuntimeSuggestion.id)}
                          disabled={busy}
                          data-testid={`runtime-suggestion-export-${selectedRuntimeSuggestion.id}`}
                        >
                          {t('runtime.exportSuggestion')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={QUIET_BUTTON_CLASS}
                          onClick={() => void rejectRuntimeSuggestion(selectedRuntimeSuggestion.id)}
                          disabled={busy || !runtimeRejectReason.trim()}
                          data-testid={`runtime-suggestion-reject-${selectedRuntimeSuggestion.id}`}
                        >
                          {t('runtime.rejectSuggestion')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">{t('runtime.emptySuggestions')}</p>
                  )}
                </div>
```

Keep the existing draft/proposal review section in place. This proves Runtime Lesson review is added to the same Knowledge Review tab rather than replacing or duplicating existing governance.

- [ ] **Step 8: Run UI tests to verify GREEN**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-page.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2 with path-limited staging**

Run:

```powershell
git add -- src/pages/Knowledge/index.tsx tests/unit/knowledge-page.test.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json
git commit --only -m "feat: review runtime lessons in knowledge queue" -- src/pages/Knowledge/index.tsx tests/unit/knowledge-page.test.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json
```

Expected: commit contains only Task 2 files.

---

### Task 3: Electron E2E And Documentation

**Files:**
- Modify: `tests/e2e/knowledge-hub.spec.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md`
- Modify: `docs/enhancements/sekb-runtime-roadmap.md`

**Interfaces:**
- Produces: E2E proof that Runtime Lesson suggestions are reviewable through Knowledge and do not directly apply Library/wiki writes.
- Produces: docs explaining Phase 2 review closure and README translation impact.

- [ ] **Step 1: Add E2E Host API mocks**

In `tests/e2e/knowledge-hub.spec.ts`, add these Host API entries to the first Knowledge Hub test's `hostApi` map:

```ts
        [typed('knowledge', 'listRuntimeLessonSuggestions', { limit: 20, minClusterSize: 2 })]: {
          success: true,
          available: true,
          suggestions: [{
            id: 'krls-e2e-1',
            clusterSummary: 'Similar E2E trajectories (2)',
            sourceTrajectoryIds: ['traj-e2e-1', 'traj-e2e-2'],
            suggestedPrinciple: {
              title: 'Review Runtime Lessons before applying Knowledge changes',
              condition: 'When changing Knowledge governance UI',
              action: 'Inspect Runtime Lessons and export drafts through review',
              reason: 'Runtime evidence should not bypass user confirmation',
              taskTypes: ['knowledge-ui'],
              contextTags: ['knowledge', 'runtime-lessons'],
              criticality: 'medium',
            },
            confidence: 0.81,
            sourceRefs: [{ id: 'sekb:trajectory:traj-e2e-1', kind: 'runtime_lesson', label: 'SEKB trajectory traj-e2e-1' }],
          }],
        },
        [typed('knowledge', 'confirmRuntimeLessonSuggestion', { suggestionId: 'krls-e2e-1' })]: {
          success: true,
          available: true,
          principleId: 'principle-e2e-confirmed',
        },
        [typed('knowledge', 'rejectRuntimeLessonSuggestion', {
          suggestionId: 'krls-e2e-1',
          reason: 'Too narrow for E2E',
        })]: {
          success: true,
          available: true,
        },
        [typed('knowledge', 'exportRuntimeLessonToDraft', { suggestionId: 'krls-e2e-1' })]: {
          success: true,
          available: true,
          draft: {
            id: 'draft-runtime-e2e',
            title: 'Review Runtime Lessons before applying Knowledge changes',
            body: 'Runtime Lessons export draft',
            type: 'troubleshooting',
            status: 'draft',
            sourceIds: ['sekb:trajectory:traj-e2e-1'],
            sourceRefs: [{ id: 'sekb:trajectory:traj-e2e-1', kind: 'runtime_lesson', label: 'SEKB trajectory traj-e2e-1' }],
            tags: ['runtime-lessons'],
            workspaceId: null,
            agentId: null,
            createdBy: 'agent',
            confidence: 0.81,
            warnings: [],
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:00:00.000Z',
          },
          proposal: {
            id: 'proposal-runtime-e2e',
            operation: 'create',
            status: 'proposed',
            draftId: 'draft-runtime-e2e',
            reason: 'Runtime Lesson exported to a Knowledge draft for explicit review and apply.',
            sources: [{ id: 'sekb:trajectory:traj-e2e-1', kind: 'runtime_lesson' }],
            requiresUserConfirmation: true,
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:00:00.000Z',
          },
        },
```

- [ ] **Step 2: Add E2E assertions**

In the same test, after the existing Runtime Lessons Phase 1 assertions, add:

```ts
    await expect(page.getByTestId('knowledge-runtime-suggestions')).toContainText('Review Runtime Lessons before applying Knowledge changes');
    await page.getByTestId('runtime-suggestion-confirm-krls-e2e-1').click();

    await page.getByTestId('knowledge-tab-review').click();
    await expect(page.getByTestId('knowledge-runtime-review')).toBeVisible();
    await page.getByTestId('runtime-suggestion-reject-reason').fill('Too narrow for E2E');
    await page.getByTestId('runtime-suggestion-reject-krls-e2e-1').click();
    await page.getByTestId('runtime-suggestion-export-krls-e2e-1').click();
    await expect(page.getByTestId('knowledge-review')).toContainText('Review Runtime Lessons before applying Knowledge changes');
```

- [ ] **Step 3: Run E2E spec to verify RED before UI implementation**

Run before Task 2 implementation:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run test:e2e -- tests/e2e/knowledge-hub.spec.ts
```

Expected: FAIL because Runtime Lesson suggestions are not rendered yet.

- [ ] **Step 4: Re-run E2E after Task 2 implementation**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run test:e2e -- tests/e2e/knowledge-hub.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Update README translations**

Update the Knowledge feature summary in all README files.

Use this English wording in `README.md`:

```md
- Knowledge includes Runtime Lessons review: SEKB suggestions can be confirmed as runtime principles, rejected with reasons, or exported into normal Knowledge drafts before any Library write.
```

Translate the same meaning in `README.zh-CN.md` and `README.ja-JP.md`.

- [ ] **Step 6: Update design and roadmap docs**

In `docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md`, add this implementation note under "Phase 2: Reviewable Runtime Lesson suggestions":

```md
Implementation note (2026-07-06): Phase 2 plans Runtime Lesson suggestions as
items inside the existing Knowledge review flow. Confirm calls the SEKB
distillation confirmation path, reject records a SEKB rejection reason, and
export creates a normal Knowledge draft/proposal for later user-reviewed
Library apply. No separate SEKB governance UI or autonomous writer is added.
```

In `docs/enhancements/sekb-runtime-roadmap.md`, add this note under "Option 2: Operator Distillation Workflow":

```md
Knowledge integration note: desktop review should expose SEKB suggestions
through the Knowledge Host API and existing Review queue. Runtime principle
confirmation remains `DistillationTool.confirm_and_save`; Knowledge export
creates drafts/proposals only and does not apply wiki writes.
```

- [ ] **Step 7: Run docs diff check**

Run:

```powershell
git diff --check -- README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/enhancements/sekb-runtime-roadmap.md tests/e2e/knowledge-hub.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3 with path-limited staging**

Run:

```powershell
git add -- tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/enhancements/sekb-runtime-roadmap.md
git commit --only -m "docs: document runtime lesson review flow" -- tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/enhancements/sekb-runtime-roadmap.md
```

Expected: commit contains only Task 3 files.

---

### Task 4: Final Verification And Closure

**Files:**
- All files changed by Tasks 1-3 only.

**Interfaces:**
- Produces: focused proof set, comms proof, harness validation, and clean path-limited commit history.

- [ ] **Step 1: Run focused unit tests**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused web typecheck**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run typecheck:web
```

Expected: PASS.

If the broader `pnpm run typecheck` is requested, run it separately and record unrelated `openclaw_runtime/src/**` failures as unrelated only after `typecheck:web` passes.

- [ ] **Step 3: Run Electron E2E**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run test:e2e -- tests/e2e/knowledge-hub.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run harness validation**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' harness validate --spec harness/specs/tasks/knowledge-hub-vnext-orchestration.md --no-diff
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' harness validate --spec harness/specs/tasks/sekb-runtime-long-task-development.md --no-diff
```

Expected: PASS.

Use `--no-diff` because this branch currently carries unrelated runtime-memory/context-runtime-kit work that must not be mixed into the SEKB/Knowledge diff.

- [ ] **Step 5: Run comms replay and compare**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:replay
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:compare
```

Expected: PASS because Phase 2 changes typed Host API and renderer/Main communication surfaces.

- [ ] **Step 6: Record schema verification decision**

Do not run `openclaw_runtime/scripts/generate-kysely-types.mjs --verify` unless implementation edits `openclaw_runtime/**` or SEKB schema files. This plan uses existing built SEKB exports and does not change OpenClaw SQLite schema.

- [ ] **Step 7: Run path-limited diff checks**

Run:

```powershell
git diff --check -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts src/pages/Knowledge/index.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/enhancements/sekb-runtime-roadmap.md docs/superpowers/plans/2026-07-06-knowledge-runtime-lessons-phase-2.md
git diff --stat -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts src/pages/Knowledge/index.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/enhancements/sekb-runtime-roadmap.md docs/superpowers/plans/2026-07-06-knowledge-runtime-lessons-phase-2.md
```

Expected: PASS for `git diff --check`; diff stat includes only Phase 2 files.

- [ ] **Step 8: Final path-limited status check**

Run:

```powershell
git status --short --branch
```

Expected: branch remains `codex/sekb-runtime-knowledge`; unrelated runtime-memory/context-runtime-kit files may still appear but are not staged in Phase 2 commits.

## Self-Review

- Spec coverage: Phase 2 design requirements are covered by Tasks 1-4. Suggestions are listed, confirmed, rejected, exported, tested, documented, and surfaced inside existing Knowledge governance.
- Existing governance reuse: export uses current Knowledge draft/proposal helpers; Review tab remains the review queue; no standalone SEKB management page is introduced.
- Safety boundaries: confirm writes only through `DistillationTool.confirm_and_save`; reject writes only through `reject_suggestion`; export does not call `wiki.apply`; renderer uses Host API only.
- Placeholder scan: no task contains unresolved implementation placeholders.
- Type consistency: `KnowledgeRuntimeLessonSuggestion`, review payloads, review results, Host API methods, service adapter, UI mocks, and E2E mocks use the same camelCase names.
- Verification coverage: focused unit tests, Electron E2E, harness validation, comms replay/compare, docs diff check, and path-limited git checks are listed with expected outcomes.
