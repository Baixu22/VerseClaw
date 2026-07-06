# Knowledge Runtime Lessons Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Runtime Lessons surface to Knowledge so SEKB appears as a Knowledge learning source instead of a separate product.

**Execution status:** Phase 1 implementation is complete for the read-only
Runtime Lessons slice. Follow-up phases for confirm/reject, draft export,
retrieval policy, and composer tightening remain intentionally deferred.

**Architecture:** Electron Main owns a Knowledge host API method that returns a normalized SEKB operator report. Renderer consumes only `hostApi.knowledge.runtimeLessonsReport()` and renders a new read-only Knowledge tab with full locale coverage. The first slice does not add confirm/reject, retrieval policy changes, schema changes, default-on SEKB behavior, or Chat composer changes.

**Tech Stack:** Electron Main service, typed Host API contract, React 19, Vite, TypeScript, Vitest, Playwright Electron E2E, react-i18next locale JSON.

## Global Constraints

- Work on branch `codex/sekb-runtime-knowledge`; do not use `knowledge-ux`.
- Current worktree contains unrelated runtime-memory staged/dirty files; every git command for this task must use explicit pathspecs.
- Renderer backend calls must go through `src/lib/host-api.ts`; no direct renderer IPC and no direct Gateway HTTP/WebSocket.
- SEKB remains runtime-side, explicit, default-off, advisory, and confirmation-gated.
- Phase 1 is read-only: no principle writes, no wiki writes, no retries, no blocking, no hidden correction.
- User-visible UI text must be added to `shared/i18n/locales/en/zh/ja/ru/knowledge.json`.
- User-visible UI change requires Electron E2E coverage.
- Host API/Main boundary changes require focused unit tests and harness validation.
- Run comms replay/compare because this task touches the renderer/Main Host API surface.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; update them with the new Runtime Lessons surface.

---

## File Structure

- Modify `shared/host-api/contract.ts`
  Add `KnowledgeRuntimeLessonsReportResult` and the `knowledge.runtimeLessonsReport()` contract method.

- Modify `src/lib/host-api.ts`
  Export the new report type and add the facade method that calls `invokeHost('knowledge', 'runtimeLessonsReport')`.

- Modify `electron/services/knowledge-api.ts`
  Add a read-only runtime lessons handler. The default implementation dynamically loads the built OpenClaw runtime SEKB module from `getOpenClawRuntimeDir()/dist/knowledge/sekb/index.js`; tests inject a reporter to avoid brittle runtime imports.

- Modify `src/pages/Knowledge/index.tsx`
  Add a `runtime` workbench tab and render counts, undistilled trajectories, active principles, and index preview.

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
  `README.ja-JP.md`.

---

### Task 1: Host API Contract And Service Read Model

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `electron/services/knowledge-api.ts`
- Test: `tests/unit/knowledge-api.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`

**Interfaces:**
- Produces: `KnowledgeRuntimeLessonsReportResult`
- Produces: `hostApi.knowledge.runtimeLessonsReport(): Promise<KnowledgeRuntimeLessonsReportResult>`
- Produces: `createKnowledgeApi({ gatewayManager, runtimeLessonsReporter? })`

- [ ] **Step 1: Write failing service test**

Add this test to `tests/unit/knowledge-api.test.ts`:

```ts
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
```

- [ ] **Step 2: Run service test to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-api.test.ts -t "returns a read-only SEKB runtime lessons report without Gateway writes"
```

Expected: FAIL because `api.runtimeLessonsReport` is not defined or `createKnowledgeApi` does not accept `runtimeLessonsReporter`.

- [ ] **Step 3: Write failing facade test**

In `tests/unit/host-api-facade.test.ts`, extend the existing `calls knowledge APIs through hostInvoke` test by adding:

```ts
    await hostApi.knowledge.runtimeLessonsReport();
```

and add the next expectation after the existing knowledge expectations:

```ts
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'knowledge',
      action: 'runtimeLessonsReport',
    }));
```

- [ ] **Step 4: Run facade test to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/host-api-facade.test.ts -t "calls knowledge APIs through hostInvoke"
```

Expected: FAIL because `hostApi.knowledge.runtimeLessonsReport` is not defined.

- [ ] **Step 5: Implement contract types**

Add these types near the other Knowledge types in `shared/host-api/contract.ts`:

```ts
export type KnowledgeRuntimeLessonsReportResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'reportFailed';
  counts: {
    trajectories: number;
    undistilledTrajectories: number;
    activePrinciples: number;
  };
  undistilled: Array<{
    trajectory_id: string;
    created_at: string;
    task_intent: string;
    task_type: string;
    context_fingerprint: string[];
    outcome: 'success' | 'failure' | 'partial';
    error_signature: string | null;
  }>;
  activePrinciples: Array<{
    principle_id: string;
    title: string;
    task_types: string[];
    context_tags: string[];
    criticality: 'low' | 'medium' | 'high';
    retrieval_count: number;
    adoption_count: number;
  }>;
  indexPreview: string;
};
```

Add this method to `HostApiContract['knowledge']`:

```ts
    runtimeLessonsReport: () => KnowledgeRuntimeLessonsReportResult;
```

- [ ] **Step 6: Implement host-api facade**

Import/export `KnowledgeRuntimeLessonsReportResult` in `src/lib/host-api.ts`, then add this method under `hostApi.knowledge`:

```ts
    runtimeLessonsReport: (): Promise<KnowledgeRuntimeLessonsReportResult> => (
      invokeHost('knowledge', 'runtimeLessonsReport')
    ),
```

- [ ] **Step 7: Implement Main read model**

In `electron/services/knowledge-api.ts`:

```ts
import { pathToFileURL } from 'node:url';
import { getOpenClawRuntimeDir } from '../utils/paths';
```

Add the report type to the imported host contract types:

```ts
  KnowledgeRuntimeLessonsReportResult,
```

Add this helper type and empty report near the top-level local types:

```ts
type RuntimeLessonsReporter = () => Promise<KnowledgeRuntimeLessonsReportResult>;

const EMPTY_RUNTIME_LESSONS_REPORT: Omit<KnowledgeRuntimeLessonsReportResult, 'success' | 'available' | 'reason'> = {
  counts: { trajectories: 0, undistilledTrajectories: 0, activePrinciples: 0 },
  undistilled: [],
  activePrinciples: [],
  indexPreview: '',
};
```

Add this default reporter:

```ts
async function defaultRuntimeLessonsReporter(): Promise<KnowledgeRuntimeLessonsReportResult> {
  const runtimeDir = getOpenClawRuntimeDir();
  const entryPath = join(runtimeDir, 'dist', 'knowledge', 'sekb', 'index.js');
  if (!existsSync(entryPath)) {
    return {
      success: true,
      available: false,
      reason: 'runtimeUnavailable',
      ...EMPTY_RUNTIME_LESSONS_REPORT,
    };
  }
  try {
    const sekb = await import(pathToFileURL(entryPath).href) as {
      KnowledgeStore: new () => unknown;
      buildSekbOperatorReport: (store: unknown) => Omit<KnowledgeRuntimeLessonsReportResult, 'success' | 'available' | 'reason'>;
    };
    const report = sekb.buildSekbOperatorReport(new sekb.KnowledgeStore());
    return { success: true, available: true, ...report };
  } catch (error) {
    return {
      success: false,
      available: false,
      reason: 'reportFailed',
      error: error instanceof Error ? error.message : String(error),
      ...EMPTY_RUNTIME_LESSONS_REPORT,
    };
  }
}
```

Change the function signature:

```ts
export function createKnowledgeApi({
  gatewayManager,
  runtimeLessonsReporter = defaultRuntimeLessonsReporter,
}: {
  gatewayManager: GatewayManager;
  runtimeLessonsReporter?: RuntimeLessonsReporter;
}): CompleteHostServiceRegistry['knowledge'] {
```

Add this handler inside the returned `knowledge` service object:

```ts
    runtimeLessonsReport: async () => runtimeLessonsReporter(),
```

- [ ] **Step 8: Run Task 1 tests to verify GREEN**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts
```

Expected: PASS.

---

### Task 2: Knowledge Runtime Lessons UI

**Files:**
- Modify: `src/pages/Knowledge/index.tsx`
- Modify: `tests/unit/knowledge-page.test.tsx`
- Modify: `shared/i18n/locales/en/knowledge.json`
- Modify: `shared/i18n/locales/zh/knowledge.json`
- Modify: `shared/i18n/locales/ja/knowledge.json`
- Modify: `shared/i18n/locales/ru/knowledge.json`

**Interfaces:**
- Consumes: `hostApi.knowledge.runtimeLessonsReport()`
- Produces: `knowledge-tab-runtime`
- Produces: `knowledge-runtime-lessons`

- [ ] **Step 1: Write failing UI test**

Update `tests/unit/knowledge-page.test.tsx`:

Add `runtimeLessonsReport: vi.fn(),` to `hostApiMock`.

Expose it in the `vi.mock('@/lib/host-api')` knowledge object:

```ts
      runtimeLessonsReport: hostApiMock.runtimeLessonsReport,
```

Reset it in `beforeEach()`:

```ts
    hostApiMock.runtimeLessonsReport.mockReset();
```

Set the default mock result:

```ts
    hostApiMock.runtimeLessonsReport.mockResolvedValue({
      success: true,
      available: true,
      counts: { trajectories: 5, undistilledTrajectories: 2, activePrinciples: 1 },
      undistilled: [{
        trajectory_id: 'traj-runtime-1',
        created_at: '2026-07-06T00:00:00.000Z',
        task_intent: 'Recover from failed Knowledge import',
        task_type: 'coding',
        context_fingerprint: ['knowledge', 'runtime-lessons'],
        outcome: 'failure',
        error_signature: 'ImportError::knowledge_runtime_lessons',
      }],
      activePrinciples: [{
        principle_id: 'principle-runtime-1',
        title: 'Inspect runtime lessons before changing Knowledge flows',
        task_types: ['coding'],
        context_tags: ['knowledge'],
        criticality: 'medium',
        retrieval_count: 3,
        adoption_count: 1,
      }],
      indexPreview: 'Runtime lesson index preview',
    });
```

Add labels:

```ts
  'tabs.runtime': 'Runtime Lessons',
  'runtime.title': 'Runtime Lessons',
  'runtime.subtitle': 'SEKB runtime learning from agent runs.',
  'runtime.unavailable': 'Runtime lessons are not available.',
  'runtime.metrics.trajectories': 'Trajectories',
  'runtime.metrics.undistilled': 'Undistilled',
  'runtime.metrics.principles': 'Principles',
  'runtime.undistilledTitle': 'Undistilled runs',
  'runtime.principlesTitle': 'Active principles',
  'runtime.indexTitle': 'Index preview',
  'runtime.emptyUndistilled': 'No undistilled runtime runs.',
  'runtime.emptyPrinciples': 'No active runtime principles.',
  'runtime.errorSignature': 'Error signature',
  'runtime.taskType': 'Task type',
```

Add this test:

```ts
  it('shows SEKB runtime lessons as a read-only Knowledge tab', async () => {
    render(<Knowledge />);

    await screen.findByTestId('knowledge-page');
    fireEvent.click(await screen.findByTestId('knowledge-tab-runtime'));

    await screen.findByTestId('knowledge-runtime-lessons');
    expect(hostApiMock.runtimeLessonsReport).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Runtime Lessons')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Recover from failed Knowledge import')).toBeInTheDocument();
    expect(screen.getByText('ImportError::knowledge_runtime_lessons')).toBeInTheDocument();
    expect(screen.getByText('Inspect runtime lessons before changing Knowledge flows')).toBeInTheDocument();
    expect(screen.getByText('Runtime lesson index preview')).toBeInTheDocument();
    expect(screen.queryByText('Approve and Apply')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run UI test to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-page.test.tsx -t "shows SEKB runtime lessons as a read-only Knowledge tab"
```

Expected: FAIL because the runtime tab does not exist.

- [ ] **Step 3: Add i18n keys**

Add matching `tabs.runtime` and `runtime.*` keys to all four `knowledge.json` locale files. Use concise local translations. Keep JSON valid and keep existing keys unchanged.

- [ ] **Step 4: Implement Runtime Lessons tab**

In `src/pages/Knowledge/index.tsx`:

- Import `BrainCircuit` or `Activity` from `lucide-react`.
- Import `type KnowledgeRuntimeLessonsReportResult` from `@/lib/host-api`.
- Change `type WorkbenchTab` to include `'runtime'`.
- Add `'runtime'` to `WORKBENCH_TABS`.
- Add an icon in `TAB_ICONS`.
- Add state:

```ts
  const [runtimeLessons, setRuntimeLessons] = useState<KnowledgeRuntimeLessonsReportResult | null>(null);
  const [runtimeLessonsLoading, setRuntimeLessonsLoading] = useState(false);
```

- Add loader:

```ts
  const refreshRuntimeLessons = useCallback(async () => {
    setRuntimeLessonsLoading(true);
    try {
      setRuntimeLessons(await hostApi.knowledge.runtimeLessonsReport());
    } catch (err) {
      setRuntimeLessons({
        success: false,
        available: false,
        reason: 'reportFailed',
        error: err instanceof Error ? err.message : String(err),
        counts: { trajectories: 0, undistilledTrajectories: 0, activePrinciples: 0 },
        undistilled: [],
        activePrinciples: [],
        indexPreview: '',
      });
    } finally {
      setRuntimeLessonsLoading(false);
    }
  }, []);
```

- Load when the runtime tab is selected:

```ts
  useEffect(() => {
    if (workbenchTab === 'runtime' && !runtimeLessons && !runtimeLessonsLoading) {
      void refreshRuntimeLessons();
    }
  }, [refreshRuntimeLessons, runtimeLessons, runtimeLessonsLoading, workbenchTab]);
```

- Render a read-only `data-testid="knowledge-runtime-lessons"` panel with:
  - three compact metrics for trajectories, undistilled, active principles
  - unavailable/error state when `available` is false or `success` is false
  - undistilled trajectory list showing intent, task type, outcome, tags, and error signature
  - active principle list showing title, criticality, task types, tags, retrieval/adoption counts
  - index preview in a scrollable monospace block
  - no apply, confirm, reject, or write buttons

- [ ] **Step 5: Run UI tests to verify GREEN**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-page.test.tsx
```

Expected: PASS.

---

### Task 3: Electron E2E Coverage

**Files:**
- Modify: `tests/e2e/knowledge-hub.spec.ts`

**Interfaces:**
- Consumes: Host API mock key `typed('knowledge', 'runtimeLessonsReport')`
- Produces: E2E proof that the Knowledge page exposes Runtime Lessons as read-only UI.

- [ ] **Step 1: Write failing E2E assertion**

In the first `Knowledge Hub MVP` E2E test, add this host API mock entry:

```ts
        [typed('knowledge', 'runtimeLessonsReport')]: {
          success: true,
          available: true,
          counts: { trajectories: 4, undistilledTrajectories: 1, activePrinciples: 1 },
          undistilled: [{
            trajectory_id: 'traj-e2e-1',
            created_at: '2026-07-06T00:00:00.000Z',
            task_intent: 'E2E runtime lesson capture',
            task_type: 'knowledge-ui',
            context_fingerprint: ['knowledge', 'runtime-lessons'],
            outcome: 'success',
            error_signature: null,
          }],
          activePrinciples: [{
            principle_id: 'principle-e2e-1',
            title: 'Keep Runtime Lessons review-only in Phase 1',
            task_types: ['knowledge-ui'],
            context_tags: ['knowledge'],
            criticality: 'medium',
            retrieval_count: 2,
            adoption_count: 1,
          }],
          indexPreview: 'E2E runtime lesson index',
        },
```

Add these assertions after the Knowledge page becomes visible:

```ts
    await page.getByTestId('knowledge-tab-runtime').click();
    await expect(page.getByTestId('knowledge-runtime-lessons')).toBeVisible();
    await expect(page.getByTestId('knowledge-runtime-lessons')).toContainText('E2E runtime lesson capture');
    await expect(page.getByTestId('knowledge-runtime-lessons')).toContainText('Keep Runtime Lessons review-only in Phase 1');
    await expect(page.getByTestId('knowledge-runtime-lessons')).toContainText('E2E runtime lesson index');
```

- [ ] **Step 2: Run E2E spec to verify RED**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run test:e2e -- tests/e2e/knowledge-hub.spec.ts
```

Expected: FAIL because the runtime tab does not exist.

- [ ] **Step 3: Re-run E2E after Task 2 implementation**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run test:e2e -- tests/e2e/knowledge-hub.spec.ts
```

Expected: PASS.

---

### Task 4: README And Design Sync

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md`

**Interfaces:**
- Produces: documentation that Knowledge now has a read-only Runtime Lessons surface backed by SEKB operator report.

- [ ] **Step 1: Update README files**

Add one concise bullet or sentence in each README Knowledge section:

```md
- Knowledge includes a read-only Runtime Lessons view for SEKB trajectories, undistilled runs, active principles, and index preview.
```

Translate that sentence in `README.zh-CN.md` and `README.ja-JP.md`.

- [ ] **Step 2: Update design spec status**

In `docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md`, add a short implementation note under "Phase 1: Read-only unification" stating that Phase 1 exposes the operator report as a read-only Knowledge Runtime Lessons surface and still defers confirm/reject and retrieval policy changes.

- [ ] **Step 3: Run docs diff check**

Run:

```powershell
git diff --check -- README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md
```

Expected: PASS.

---

### Task 5: Final Verification And Commit

**Files:**
- All files changed by Tasks 1-4 only.

**Interfaces:**
- Produces: focused proof set and path-limited commit.

- [ ] **Step 1: Run focused unit tests**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run harness validation**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' harness validate --spec harness/specs/tasks/knowledge-hub-vnext-orchestration.md
```

Expected: PASS.

- [ ] **Step 4: Run Electron E2E**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run test:e2e -- tests/e2e/knowledge-hub.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run comms replay and compare**

Run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:replay
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:compare
```

Expected: PASS.

- [ ] **Step 6: Check path-limited diff**

Run:

```powershell
git diff --check -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts src/pages/Knowledge/index.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/superpowers/plans/2026-07-06-knowledge-runtime-lessons-phase-1.md
```

Expected: PASS.

- [ ] **Step 7: Path-limited commit**

Run:

```powershell
git add -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts src/pages/Knowledge/index.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/superpowers/plans/2026-07-06-knowledge-runtime-lessons-phase-1.md
git commit --only -m "feat: surface sekb runtime lessons in knowledge" -- shared/host-api/contract.ts src/lib/host-api.ts electron/services/knowledge-api.ts src/pages/Knowledge/index.tsx shared/i18n/locales/en/knowledge.json shared/i18n/locales/zh/knowledge.json shared/i18n/locales/ja/knowledge.json shared/i18n/locales/ru/knowledge.json tests/unit/knowledge-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-page.test.tsx tests/e2e/knowledge-hub.spec.ts README.md README.zh-CN.md README.ja-JP.md docs/superpowers/specs/2026-07-06-knowledge-sekb-unified-experience-design.md docs/superpowers/plans/2026-07-06-knowledge-runtime-lessons-phase-1.md
```

Expected: commit contains only Phase 1 files.

## Self-Review

- Spec coverage: Phase 1 read-only unification is covered by Tasks 1-5. Confirm/reject, retrieval policy, composer tightening, and embeddings/rerankers are intentionally deferred.
- Incomplete-instruction scan: no unresolved implementation markers are present.
- Type consistency: `KnowledgeRuntimeLessonsReportResult` is produced by the contract, returned by Main, consumed by the facade and Knowledge UI, and mocked in unit/E2E tests.
