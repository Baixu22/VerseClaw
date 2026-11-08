import { writeFile } from 'node:fs/promises';
import { HOST_EVENT_CHANNELS } from '../../shared/host-events/contract';
import { readSessionListPages } from '../../src/lib/session-read-model';
import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, revealSectionHeadingActionsFor, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { addSessionChainChildren, configureSessionChainProvider, createSessionChainProject,
  instrumentSessionChainHost, readSessionChainHostCalls, observeSessionUi, setSessionChainViewport } from './fixtures/session-task-chain';

test('question fork keeps its source draft and handoff submits one reviewed first turn', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm((text) => ({ text: `ANSWER ${[...text.matchAll(/UI-(?:FIRST|SECOND|HANDOFF)/g)].at(-1)?.[0] ?? 'READY'}` }));
  const app = await launchElectronApp({ skipSetup: true });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-session-journey', provider: 'local-scripted', status: 'running' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Journey project');
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
    for (const marker of ['UI-FIRST', 'UI-SECOND']) {
      await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey, message: marker, idempotencyKey: marker });
      await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: project.sessionKey, limit: 50 })).includes(`ANSWER ${marker}`), { timeout: 45_000 }).toBe(true);
      await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: project.sessionKey })).session.hasActiveRun, { timeout: 20_000 }).toBe(false);
    }
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('UI-SECOND', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-composer-input').fill('Keep the source draft');
    await instrumentSessionChainHost(app);
    const countBefore = (await rpc<{ sessions: unknown[] }>('sessions.list', {})).sessions.length;
    const questionRow = page.locator('[id^="chat-message-"]').filter({ has: page.getByText('UI-SECOND', { exact: true }) });
    await page.getByText('UI-SECOND', { exact: true }).hover();
    await questionRow.getByTestId('chat-user-message-fork').click();
    await expect(page.getByTestId('question-fork-dialog')).toBeVisible();
    await page.getByTestId('question-fork-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await rpc<{ sessions: unknown[] }>('sessions.list', {})).sessions.length).toBe(countBefore);
    await page.getByText('UI-SECOND', { exact: true }).hover();
    await questionRow.getByTestId('chat-user-message-fork').click();
    await page.getByTestId('question-fork-draft').fill('A new question held as a draft');
    await page.getByTestId('question-fork-create').click();
    await expect(page.getByTestId('question-fork-dialog')).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('A new question held as a draft');
    await expect(page.getByTestId('session-family-source')).toBeVisible();
    const listed = await rpc<{ sessions: Array<{ key: string; parentSessionKey?: string; forkedFromParent?: boolean }> }>('sessions.list', {});
    const fork = listed.sessions.find((session) => session.parentSessionKey === project.sessionKey && session.forkedFromParent);
    expect(fork).toBeTruthy();
    const forkHistory = await rpc('chat.history', { sessionKey: fork!.key, limit: 50 });
    expect(JSON.stringify(forkHistory)).toContain('ANSWER UI-FIRST');
    expect(JSON.stringify(forkHistory)).not.toContain('UI-SECOND');
    expect((await readSessionChainHostCalls(app)).filter((call) => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('question-fork-draft.png') });
    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Keep the source draft');
    await page.getByTestId('chat-project-session-header').getByRole('button').nth(1).click();
    await page.getByTestId('chat-session-handoff').click();
    await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
    await page.getByTestId('chat-handoff-draft').fill('UI-HANDOFF');
    await page.getByTestId('chat-handoff-create').click();
    await expect(page.getByText('ANSWER UI-HANDOFF', { exact: true })).toBeVisible({ timeout: 60_000 });
    const operation = await hostInvoke<{ operation: { id: string; sessionKey: string; phase: string } }>(app, 'sessions', 'handoffOperation', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey, reconcile: true,
    });
    expect(operation.operation.phase).toBe('sent');
    const children = (await rpc<{ sessions: Array<{ key: string; parentSessionKey?: string }> }>('sessions.list', {})).sessions;
    expect(children.find((session) => session.key === operation.operation.sessionKey)?.parentSessionKey).toBe(project.sessionKey);
    const afterCalls = await readSessionChainHostCalls(app);
    expect(afterCalls.filter((call) => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(1);
    evidence.fork = fork; evidence.handoff = operation.operation; evidence.calls = afterCalls; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await captureUi((name) => testInfo.outputPath(name));
    await writeFile(testInfo.outputPath('question-handoff-journey.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});

test('family navigation preserves 2/20/100 runtime children and responsive keyboard layouts', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(900_000);
  let holdNext = false;
  let held = false;
  let releaseHold = () => {};
  const llm = await startScriptedLlm(async (text) => {
    if (holdNext && text.includes('FAMILY-HOLD')) {
      holdNext = false;
      held = true;
      await new Promise<void>((resolve) => { releaseHold = resolve; });
    }
    return { text: 'Agent-driven family fixture.' };
  });
  const app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
  const captureUi = await observeSessionUi(app);
  const metrics: unknown[] = [];
  const budgets: Record<string, unknown> = {};
  const result = { status: 'running', error: null as string | null };
  try {
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const { execFileSync } = await import('node:child_process');
    type Projection = 'time' | 'project';
    type SourceFile = { path: string; sha256: string; text: string };
    type OwnerSession = { key: string; sessionId?: string; parentSessionKey?: string; spawnedBy?: string };
    type ClientCall = { id: string; module: string; action: string; payload?: { method?: string };
      startedAt: number; endedAt?: number; durationMs?: number; ok?: boolean };
    const budgetFiles = {
      containment: 'tests/unit/sidebar-render-containment.test.tsx',
      sidebar: 'src/components/layout/Sidebar.tsx',
      familyProjection: 'src/components/layout/SessionFolderTree.tsx',
      flatProjection: 'src/components/layout/session-buckets.ts',
      readModel: 'src/lib/session-read-model.ts',
      chatStore: 'src/stores/chat.ts',
      workspaceStore: 'src/stores/workspaces.ts',
      locale: 'shared/i18n/locales/en/chat.json',
      rule: 'harness/specs/rules/sidebar-session-row-controls.md',
      acceptedBaseline: 'harness/specs/fixtures/tf0423-session-loading/after.json',
      attributionBaseline: 'harness/specs/fixtures/tf0423-session-loading/attribution.json',
      acceptance: 'harness/specs/fixtures/tf0423-session-loading/acceptance.json',
      probe: 'harness/specs/fixtures/tf0423-session-loading/probe.mjs',
      rendererSampler: 'src/lib/performance-metrics.ts',
      eventContract: 'shared/host-events/contract.ts',
      observation: 'tests/e2e/session-derivation-ui.spec.ts',
    };
    const sources: Record<string, SourceFile> = Object.fromEntries(await Promise.all(Object.entries(budgetFiles).map(async ([name, path]) => {
      const bytes = await readFile(path);
      return [name, { path, sha256: createHash('sha256').update(bytes).digest('hex'), text: bytes.toString('utf8') }] as const;
    })));
    const sourceFiles = Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, { path: value.path, sha256: value.sha256 }]));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sourceIdentity = { head, files: sourceFiles, fingerprint: createHash('sha256').update(JSON.stringify({ head, files: sourceFiles })).digest('hex') };
    const viewLabels = (JSON.parse(sources.locale.text) as { sessionView: Record<Projection, string> }).sessionView;
    const mountLimit = Number(/expect\(mounted\)\.toBeLessThanOrEqual\((\d+)\)/.exec(sources.containment.text)?.[1]);
    const renderChunk = Number(/SIDEBAR_SESSION_RENDER_CHUNK\s*=\s*(\d+)/.exec(sources.sidebar.text)?.[1]);
    const streamCounts = [...sources.containment.text.matchAll(/await countAfter\((\d+)\)/g)].map((match) => Number(match[1]));
    if (!Number.isInteger(mountLimit) || mountLimit < 1 || renderChunk !== mountLimit || streamCounts.length !== 2
      || !sources.containment.text.includes('expect(many.total).toBe(few.total)')
      || !sources.containment.text.includes('toBeLessThanOrEqual(SESSION_KEYS.length)')) {
      throw new Error('Existing sidebar mount/stream-render budget is missing or changed: ' + budgetFiles.containment);
    }
    const baseline = JSON.parse(sources.acceptedBaseline.text) as { candidate: string; fixture: { sessionCount: number; transcriptBytes: number };
      loadSessionsMs: number; sessionSwitch: { count: number; p50Ms: number; p95Ms: number; longTasksOver50Ms: unknown[] };
      summariesHostCall: { requestedKeys: number; calls: unknown[] } };
    const attribution = JSON.parse(sources.attributionBaseline.text) as { runs: Array<{ sessionCount: number; loadSessionsMs: number; switchP50Ms: number; switchP95Ms: number }> };
    expect(baseline.fixture.sessionCount).toBe(333);
    expect(attribution.runs.some((run) => run.sessionCount === 20)).toBe(true);
    Object.assign(budgets, {
      sources: sourceFiles, sourceIdentity, initialMountedRows: mountLimit, streamCounts,
      streamRenderInvariant: 'same committed-row work for few/many events; at most one constant row pass, in each projection',
      controlledBaseline: { kind: 'same-candidate flat-vs-family', baselineProjection: 'time', candidateProjection: 'project',
        selectionEntry: 'sidebar-session-organize > Time / Projects',
        loadMetric: 'warm projection selection to first rows and complete mounted key set',
        coldReload: 'shared project warmup only; excluded from flat-vs-family deltas' },
      metricsWithoutAbsoluteBudgets: ['projectionFirstRowsMs', 'completeKeysReadyMs', 'RPC count/duration',
        'root React commits', 'projection-switch total row work', 'DOM mutations', 'session-switch latency'],
      historicalBaseline: { status: 'reference-only', after: baseline, attribution: attribution.runs },
    });

    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Family project');
    await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      message: 'Agent-driven family render probe', idempotencyKey: 'family-render-user-turn' });
    await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history',
      params: { sessionKey: project.sessionKey, limit: 20 }, timeoutMs: 30_000 })).includes('Agent-driven family fixture.'),
    { timeout: 45_000 }).toBe(true);
    await expect.poll(async () => (await hostInvoke<{ session: { hasActiveRun: boolean } }>(app, 'gateway', 'rpc', {
      method: 'sessions.describe', params: { key: project.sessionKey }, timeoutMs: 30_000 })).session.hasActiveRun).toBe(false);
    const children: string[] = [];
    expect(await setSessionChainViewport(app, { width: 1280, height: 800 })).toEqual({ width: 1280, height: 800 });
    const page = await getStableWindow(app);
    await page.addInitScript(() => {
      type Fiber = { child?: Fiber | null; sibling?: Fiber | null; alternate?: Fiber | null; flags: number; tag: number;
        memoizedProps?: { session?: { key?: string }; sessionLabel?: string; onSwitch?: unknown } };
      type Probe = { rendererCount: number; commits: number; identifiedRows: number; rowWork: Record<string, number>; domMutations: number };
      type Hook = { supportsFiber?: boolean; inject?: (renderer: unknown) => number; onCommitFiberRoot?: (id: number, root: { current: Fiber }) => void };
      const target = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook; __familyRenderProbe?: Probe };
      const previous = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const probe: Probe = { rendererCount: 0, commits: 0, identifiedRows: 0, rowWork: {}, domMutations: 0 };
      const previousRows = new Map<string, Fiber>();
      target.__familyRenderProbe = probe;
      target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        ...previous, supportsFiber: true,
        inject(renderer) { probe.rendererCount += 1; return previous?.inject?.call(previous, renderer) ?? probe.rendererCount; },
        onCommitFiberRoot(id, root) {
          previous?.onCommitFiberRoot?.call(previous, id, root);
          probe.commits += 1;
          const stack = [root.current];
          const counted = new Set<string>();
          while (stack.length) {
            const fiber = stack.pop()!;
            const props = fiber.memoizedProps;
            const key = props?.session?.key;
            if (key && !counted.has(key) && (fiber.tag === 0 || fiber.tag === 15)
              && typeof props?.sessionLabel === 'string' && typeof props?.onSwitch === 'function') {
              counted.add(key); probe.identifiedRows += 1;
              // Bailouts retain old subtrees and flags; only a new committed row fibre can add work.
              if (previousRows.get(key) !== fiber && (!fiber.alternate || (fiber.flags & 1) !== 0)) {
                probe.rowWork[key] = (probe.rowWork[key] ?? 0) + 1;
              }
              previousRows.set(key, fiber);
            }
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
          }
        },
      };
      new MutationObserver((records) => {
        probe.domMutations += records.filter((record) => {
          const element = record.target instanceof Element ? record.target : record.target.parentElement;
          return Boolean(element?.closest('.sidebar-scroll'));
        }).length;
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const twoFrames = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const renderer = () => page.evaluate(() => {
      const target = window as unknown as { __familyRenderProbe?: { rendererCount: number; commits: number; identifiedRows: number; rowWork: Record<string, number>; domMutations: number };
        __CLAWX_PERF_SNAPSHOT__?: () => { longTasks: Array<{ startTime: number; durationMs: number }>; ipc: { count: number; p50Ms: number | null; p95Ms: number | null }; unavailable: string[] } };
      if (!target.__familyRenderProbe || !target.__CLAWX_PERF_SNAPSHOT__) throw new Error('Renderer commit or existing performance sampler unavailable');
      return { ...target.__familyRenderProbe, rowWork: { ...target.__familyRenderProbe.rowWork }, performance: target.__CLAWX_PERF_SNAPSHOT__() };
    });
    const readRows = () => page.locator('[data-testid^="sidebar-session-agent:"]').evaluateAll((buttons) => buttons.map((button) => {
      const key = button.getAttribute('data-testid')!.slice('sidebar-session-'.length);
      const box = (button.closest('.sidebar-row') ?? button).getBoundingClientRect();
      return { key, x: box.x, y: box.y, width: box.width, height: box.height };
    }).filter((row) => row.width > 0 && row.height > 0));
    const revealChildren = async () => {
      const seen = new Set<string>();
      await expect.poll(async () => {
        for (const row of await readRows()) if (children.includes(row.key)) seen.add(row.key);
        // Move away from a clamped bottom before scrolling down again so the
        // existing incremental renderer receives a real browser scroll event.
        await page.locator('.sidebar-scroll').hover();
        await page.mouse.wheel(0, -200);
        await twoFrames();
        await page.mouse.wheel(0, 10_000);
        await twoFrames();
        return [...seen].sort();
      }, { timeout: 30_000 }).toEqual([...children].sort());
      const rows = (await readRows()).filter((row) => children.includes(row.key));
      expect(rows.map((row) => row.key).sort()).toEqual([...children].sort());
      expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
      for (const row of rows) expect(row.height).toBe(30);
      const ordered = rows.toSorted((left, right) => left.y - right.y);
      for (let index = 1; index < ordered.length; index += 1) expect(ordered[index].y).toBeGreaterThanOrEqual(ordered[index - 1].y + ordered[index - 1].height);
      return rows;
    };
    const publish = (event: import('../../shared/chat-runtime-events').ChatRuntimeEvent) => app.evaluate(({ BrowserWindow }, { channel, event }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, event);
    }, { channel: HOST_EVENT_CHANNELS.chat.runtimeEvent, event });
    const committedWork = (sample: Awaited<ReturnType<typeof renderer>>) => [project.sessionKey, ...children]
      .reduce((sum, key) => sum + (sample.rowWork[key] ?? 0), 0);
    const chooseProjection = async (view: Projection) => {
      const organize = page.getByTestId('sidebar-session-organize');
      await revealSectionHeadingActionsFor(organize); await organize.click();
      const option = page.getByRole('menuitemradio', { name: viewLabels[view], exact: true });
      const changed = await option.getAttribute('aria-checked') !== 'true';
      await option.click(); await twoFrames();
      return changed;
    };
    const exposeProjection = async (view: Projection) => {
      if (view === 'project') {
        const toggle = page.getByTestId('session-family-toggle-' + project.sessionKey);
        await expect(toggle).toBeVisible({ timeout: 30_000 });
        await expect(toggle).toContainText(String(children.length));
        if (await toggle.getAttribute('aria-expanded') !== 'true') { await toggle.focus(); await toggle.press('ArrowRight'); }
      } else await expect(page.getByTestId('session-family-toggle-' + project.sessionKey)).toHaveCount(0);
      await twoFrames();
    };
    const readOwner = () => readSessionListPages((params) => hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
      method: 'sessions.list', params, timeoutMs: 30_000 })) as Promise<{ sessions: OwnerSession[] }>;
    const ownerRows = (owner: { sessions: OwnerSession[] }) => owner.sessions
      .filter((row) => [project.sessionKey, ...children].includes(row.key))
      .map((row) => ({ key: row.key, sessionId: row.sessionId, parentSessionKey: row.parentSessionKey, spawnedBy: row.spawnedBy }))
      .toSorted((left, right) => left.key.localeCompare(right.key));
    const rpcWindow = async (startedAt: number, endedAt: number) => {
      const calls = await readSessionChainHostCalls(app);
      const completed = (await getAgentDevHostCalls(page) as ClientCall[]).filter((call) =>
        call.startedAt >= startedAt && typeof call.endedAt === 'number' && call.endedAt <= endedAt);
      const byAction: Record<string, number> = {};
      const byGatewayMethod: Record<string, number> = {};
      for (const call of calls) {
        const action = call.module + '.' + call.action;
        byAction[action] = (byAction[action] ?? 0) + 1;
        if (call.module === 'gateway' && call.method) byGatewayMethod[call.method] = (byGatewayMethod[call.method] ?? 0) + 1;
      }
      return { startedAt, endedAt, requestCount: calls.length, byAction, byGatewayMethod,
        completed: completed.map((call) => ({ id: call.id, module: call.module, action: call.action, method: call.payload?.method,
          durationMs: call.durationMs, ok: call.ok })) };
    };
    const sampleProjection = async (view: Projection, datasetIdentity: { fingerprint: string; rows: ReturnType<typeof ownerRows> }) => {
      await chooseProjection(view === 'time' ? 'project' : 'time');
      await exposeProjection(view === 'time' ? 'project' : 'time');
      await revealChildren();
      await page.locator('.sidebar-scroll').evaluate((element) => { element.scrollTop = 0; });
      await instrumentSessionChainHost(app);
      const before = await renderer();
      const startedAt = Date.now();
      expect(await chooseProjection(view)).toBe(true);
      await exposeProjection(view);
      await expect.poll(async () => (await readRows()).filter((row) => [project.sessionKey, ...children].includes(row.key)).length).toBeGreaterThan(0);
      const projectionFirstRowsMs = Date.now() - startedAt;
      const initialRows = await readRows();
      expect(initialRows.length).toBeLessThanOrEqual(mountLimit);
      const completeDom = await revealChildren();
      const targetRows = (await readRows()).filter((row) => [project.sessionKey, ...children].includes(row.key));
      expect(targetRows.map((row) => row.key).sort()).toEqual([project.sessionKey, ...children].sort());
      const after = await renderer();
      const endedAt = Date.now();
      const rpc = await rpcWindow(startedAt, endedAt);
      expect(ownerRows(await readOwner())).toEqual(datasetIdentity.rows);
      for (const key of [project.sessionKey, ...children]) expect(after.rowWork[key]).toBeGreaterThan(0);
      const rowWorkByKey = Object.fromEntries([project.sessionKey, ...children].map((key) =>
        [key, (after.rowWork[key] ?? 0) - (before.rowWork[key] ?? 0)]));
      return { projection: view, sourceIdentity, datasetIdentity, projectionFirstRowsMs, completeKeysReadyMs: endedAt - startedAt,
        initialMountedRows: initialRows.length, targetKeys: targetRows.map((row) => row.key).sort(), completeDom,
        rpc, rootCommits: after.commits - before.commits, committedRowWork: committedWork(after) - committedWork(before),
        rowWorkByKey, domMutations: after.domMutations - before.domMutations };
    };
    const streamProbe = async (view: Projection, eventCount: number) => {
      held = false;
      holdNext = true;
      const identity = 'family-render-' + children.length + '-' + eventCount + '-' + Date.now();
      const receipt = await hostInvoke<{ success: boolean; result?: { runId?: string } }>(app, 'chat', 'sendWithMedia', {
        workspaceId: project.workspaceId, sessionKey: project.sessionKey, message: 'FAMILY-HOLD ' + identity, idempotencyKey: identity,
      });
      const runId = receipt.result?.runId;
      if (!receipt.success || !runId) throw new Error('Live family probe run was not acknowledged');
      await expect.poll(() => held, { timeout: 30_000 }).toBe(true);
      await page.reload();
      await chooseProjection(view); await exposeProjection(view); await revealChildren();
      const actualOwner = await hostInvoke<{ session: { sessionId: string; hasActiveRun: boolean } }>(app, 'gateway', 'rpc', {
        method: 'sessions.describe', params: { key: project.sessionKey }, timeoutMs: 30_000,
      });
      expect(actualOwner.session).toMatchObject({ sessionId: project.generation, hasActiveRun: true });
      const ts = Date.now();
      await publish({ type: 'run.started', runId, sessionKey: project.sessionKey, seq: 0, ts, startedAt: ts });
      await publish({ type: 'assistant.delta', runId, sessionKey: project.sessionKey, seq: 1, ts, replace: true,
        text: 'FAMILY-STREAM-WARMUP' });
      await expect(page.locator('body')).toContainText('FAMILY-STREAM-WARMUP');
      let previousWork = -1;
      let settledSamples = 0;
      await expect.poll(async () => {
        const work = committedWork(await renderer());
        settledSamples = work === previousWork ? settledSamples + 1 : 0;
        previousWork = work;
        return settledSamples;
      }, { timeout: 15_000, intervals: [100, 250, 500] }).toBeGreaterThanOrEqual(3);
      await twoFrames();
      const before = await renderer();
      expect(before.rendererCount).toBeGreaterThan(0);
      expect(before.identifiedRows).toBeGreaterThan(0);
      expect(committedWork(before)).toBeGreaterThan(0);
      for (const key of [project.sessionKey, ...children]) expect(before.rowWork[key]).toBeGreaterThan(0);
      for (let seq = 1; seq <= eventCount; seq += 1) {
        await publish({ type: 'assistant.delta', runId, sessionKey: project.sessionKey, seq: seq + 1, ts, replace: true,
          text: 'FAMILY-STREAM-' + eventCount + '-' + seq });
        await expect(page.locator('body')).toContainText('FAMILY-STREAM-' + eventCount + '-' + seq);
        await twoFrames();
      }
      const after = await renderer();
      const dom = (await readRows()).filter((row) => children.includes(row.key));
      expect(dom.map((row) => row.key).sort()).toEqual([...children].sort());
      releaseHold();
      await expect.poll(async () => (await hostInvoke<{ session: { hasActiveRun: boolean } }>(app, 'gateway', 'rpc', {
        method: 'sessions.describe', params: { key: project.sessionKey }, timeoutMs: 30_000,
      })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
      await twoFrames();
      return { projection: view, sourceIdentity, eventCount, warmupEvents: 1, settledSamples, before, after,
        committedRowWork: committedWork(after) - committedWork(before), dom, receipt, actualOwner,
        streamInput: 'agent event replay during an actual live Gateway model request' };
    };

    for (const count of [2, 20, 100]) {
      children.push(...await addSessionChainChildren(app, project, children.length, count));
      const owner = await readOwner();
      expect(owner.sessions.filter((session) => session.parentSessionKey === project.sessionKey).map((session) => session.key).sort()).toEqual([...children].sort());
      const rows = ownerRows(owner);
      expect(rows.map((row) => row.key).sort()).toEqual([project.sessionKey, ...children].sort());
      const datasetIdentity = { workspaceId: project.workspaceId, coordinatorKey: project.sessionKey,
        childKeys: [...children].sort(), rows, fingerprint: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
      await instrumentSessionChainHost(app);
      const reloadStartedAt = Date.now(); await page.reload();
      const toggle = page.getByTestId('session-family-toggle-' + project.sessionKey);
      await expect(toggle).toBeVisible({ timeout: 30_000 }); await expect(toggle).toContainText(String(count));
      const reloadEndedAt = Date.now();
      const sharedWarmup = { projection: 'project', coldReloadMs: reloadEndedAt - reloadStartedAt,
        rpc: await rpcWindow(reloadStartedAt, reloadEndedAt), excludedFromProjectionComparison: true };
      const flat = await sampleProjection('time', datasetIdentity);
      const family = await sampleProjection('project', datasetIdentity);
      expect(family.sourceIdentity.fingerprint).toBe(flat.sourceIdentity.fingerprint);
      expect(family.datasetIdentity.fingerprint).toBe(flat.datasetIdentity.fingerprint);
      expect(family.targetKeys).toEqual(flat.targetKeys);
      const actionKeys = [...new Set([...Object.keys(flat.rpc.byAction), ...Object.keys(family.rpc.byAction)])].sort();
      const comparison = { kind: 'same-candidate flat-vs-family', sourceIdentity: sourceIdentity.fingerprint,
        datasetIdentity: datasetIdentity.fingerprint, childKeys: [...children].sort(),
        familyMinusFlat: {
          projectionFirstRowsMs: family.projectionFirstRowsMs - flat.projectionFirstRowsMs,
          completeKeysReadyMs: family.completeKeysReadyMs - flat.completeKeysReadyMs,
          rpcRequests: family.rpc.requestCount - flat.rpc.requestCount,
          rpcByAction: Object.fromEntries(actionKeys.map((key) => [key, (family.rpc.byAction[key] ?? 0) - (flat.rpc.byAction[key] ?? 0)])),
          rootCommits: family.rootCommits - flat.rootCommits,
          committedRowWork: family.committedRowWork - flat.committedRowWork,
          rowWorkByKey: Object.fromEntries(flat.targetKeys.map((key) => [key, (family.rowWorkByKey[key] ?? 0) - (flat.rowWorkByKey[key] ?? 0)])),
          domMutations: family.domMutations - flat.domMutations,
        },
        budgetPolicy: 'initial mount and stream containment use existing budgets; deltas are measured without new absolute limits',
      };
      const measurement: Record<string, unknown> = { count, sourceIdentity, datasetIdentity,
        actualRuntimeSessionCount: owner.sessions.length, sharedWarmup, flat, family, comparison };
      metrics.push(measurement);
      const streamContainment: unknown[] = [];
      measurement.streamContainment = streamContainment;
      for (const view of ['time', 'project'] as const) {
        const few = await streamProbe(view, streamCounts[0]);
        const many = await streamProbe(view, streamCounts[1]);
        streamContainment.push({ projection: view, sourceIdentity, datasetIdentity, evidenceType: 'electron-main-event-fixture',
          channel: HOST_EVENT_CHANNELS.chat.runtimeEvent, few, many, oneConstantPass: children.length + 1 });
        expect(many.committedRowWork).toBe(few.committedRowWork);
        expect(many.committedRowWork).toBeLessThanOrEqual(children.length + 1);
      }
      await chooseProjection('project'); await exposeProjection('project'); await revealChildren();
      const durationsMs: number[] = [];
      for (let index = 0; index < baseline.sessionSwitch.count; index += 1) {
        const row = page.getByTestId('sidebar-session-' + children[index % children.length]);
        await row.scrollIntoViewIfNeeded();
        const elapsed = await row.evaluate((button) => new Promise<number>((resolve) => {
          const started = performance.now(); (button as HTMLElement).click();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
        }));
        await expect(row.locator('xpath=ancestor::div[@data-hook-key][1]')).toHaveAttribute('data-hook-selected', 'true');
        durationsMs.push(elapsed);
      }
      const sorted = durationsMs.toSorted((left, right) => left - right);
      const p50Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5))];
      const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      measurement.switchLatency = { method: 'DOM click to two settled animation frames, matching TF-0423 probe', durationsMs, p50Ms, p95Ms };
      measurement.historicalComparison = { status: 'reference-only', baselineCandidate: baseline.candidate,
        baselineSessionCount: baseline.fixture.sessionCount, switchP50DeltaMs: p50Ms - baseline.sessionSwitch.p50Ms,
        switchP95DeltaMs: p95Ms - baseline.sessionSwitch.p95Ms, scale20Reference: count === 20 ? attribution.runs.find((run) => run.sessionCount === 20) : null };
      await page.getByTestId('session-family-source').click();
      await expect(page.getByTestId('sidebar-session-' + project.sessionKey).locator('xpath=ancestor::div[@data-hook-key][1]')).toHaveAttribute('data-hook-selected', 'true');
      await page.locator('.sidebar-scroll').evaluate((element) => { element.scrollTop = 0; });
    }
    for (const theme of ['light', 'dark'] as const) {
      await hostInvoke(app, 'settings', 'set', { key: 'theme', value: theme });
      await page.reload();
      for (const width of [1280, 960]) {
        expect(await setSessionChainViewport(app, { width, height: 800 })).toEqual({ width, height: 800 });
        await twoFrames();
        const sidebarToggle = page.getByTestId('sidebar-collapse-toggle');
        if (await sidebarToggle.getAttribute('aria-label') === 'Expand sidebar') await sidebarToggle.click();
        const toggle = page.getByTestId('session-family-toggle-' + project.sessionKey);
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        const dom = await revealChildren();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        const first = page.locator('.ws-family-row[data-lineage-depth="1"]').first();
        await first.scrollIntoViewIfNeeded(); await expect(first).toBeVisible();
        const parentBox = await toggle.boundingBox(); const childBox = await first.boundingBox();
        expect(parentBox && childBox && childBox.y >= parentBox.y).toBeTruthy();
        metrics.push({ theme, width, childKeys: dom.map((row) => row.key).sort(), dom });
        await page.locator('.sidebar-scroll').evaluate((element) => { element.scrollTop = 0; });
        await page.screenshot({ path: testInfo.outputPath('family-' + theme + '-' + width + '.png') });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('sidebar-collapse-toggle').click();
    await page.screenshot({ path: testInfo.outputPath('family-collapsed-reduced-motion.png') });
    await page.getByTestId('sidebar-collapse-toggle').click();
    await expect(page.getByTestId('session-family-toggle-' + project.sessionKey)).toBeVisible();
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = String(error); throw error; } finally {
    releaseHold();
    await writeFile(testInfo.outputPath('family-layout.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-session-family',
      provider: 'local-scripted', status: result.status, error: result.error, fixtureScale: true, budgets, metrics, providerLog: llm.log }, null, 2));
    await captureUi((name) => testInfo.outputPath(name));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
