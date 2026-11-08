# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: long-session-coordination.spec.ts >> opens the long-session coordinator from Chat and verifies receipts, navigation, keyboard, window lifecycle, locales, and screenshots
- Location: tests\e2e\long-session-coordination.spec.ts:182:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('long-session-coordinator')
Expected substring: "local-workspace"
Received string:    "Long-session coordinatorinvalidgit / local / r2D:\\ClawX-work\\session-task-unified-relay-20261109\\.tmp\\e2e-runs\\verse-claw-e2e-run-lrRonx\\verse-claw-e2e-home-H9D7DK\\.openclaw\\workspaceRecovery: environment-missingenvironment-generation-changed61a55fb3a94e328f64795ea7fdd58b16ce5c15a2f9109957ec88b1ed801e9354architectfailed / pendingResumeCPU 0.0%RSS 1169 MB4 processes0 slots0 background terminals0 queued"
Timeout: 15000ms

Call log:
  - Expect "toContainText" with timeout 15000ms
  - waiting for getByTestId('long-session-coordinator')
    3 × locator resolved to <section data-testid="long-session-coordinator" class="mx-1 mb-1 rounded-md border border-black/5 bg-foreground/[0.025] p-2 dark:border-white/10">…</section>
      - unexpected value "Long-session coordinatoractivegit / local / r1D:\ClawX-work\session-task-unified-relay-20261109\.tmp\e2e-runs\verse-claw-e2e-run-lrRonx\verse-claw-e2e-home-H9D7DK\.openclaw\workspaceRecovery: unknown61a55fb3a94e328f64795ea7fdd58b16ce5c15a2f9109957ec88b1ed801e9354architectfailed / pendingPause"
    15 × locator resolved to <section data-testid="long-session-coordinator" class="mx-1 mb-1 rounded-md border border-black/5 bg-foreground/[0.025] p-2 dark:border-white/10">…</section>
       - unexpected value "Long-session coordinatorinvalidgit / local / r2D:\ClawX-work\session-task-unified-relay-20261109\.tmp\e2e-runs\verse-claw-e2e-run-lrRonx\verse-claw-e2e-home-H9D7DK\.openclaw\workspaceRecovery: environment-missingenvironment-generation-changed61a55fb3a94e328f64795ea7fdd58b16ce5c15a2f9109957ec88b1ed801e9354architectfailed / pendingResumeCPU 0.0%RSS 1169 MB4 processes0 slots0 background terminals0 queued"

```

# Test source

```ts
  200 |     const label = `Coordination ${Date.now()}`;
  201 |     const created = await hostInvoke<CreatedSession>(app, 'gateway', 'rpc', {
  202 |       method: 'sessions.create',
  203 |       params: { agentId: 'main', label },
  204 |       timeoutMs: 60_000,
  205 |     });
  206 |     const sessionKey = created.key ?? created.sessionKey ?? '';
  207 |     if (!sessionKey) throw new Error('Session creation returned no key');
  208 |     let sessionGeneration = created.entry?.sessionId ?? '';
  209 |     if (!sessionGeneration) {
  210 |       const described = await hostInvoke<DescribedSession>(app, 'gateway', 'rpc', {
  211 |         method: 'sessions.describe',
  212 |         params: { key: sessionKey },
  213 |         timeoutMs: 30_000,
  214 |       });
  215 |       sessionGeneration = described.session?.sessionId ?? '';
  216 |     }
  217 |     if (!sessionGeneration) throw new Error('Coordinator session has no generation');
  218 |     await hostInvoke(app, 'workspaces', 'update', {
  219 |       id: workspace.id,
  220 |       agentId: 'main',
  221 |       activeSessionKey: sessionKey,
  222 |       sessionKey,
  223 |     });
  224 | 
  225 |     const ledger = await hostInvoke<LedgerSnapshot>(app, 'taskLedger', 'createNode', {
  226 |       workspaceId: workspace.id,
  227 |       node: { title: `Coordination task ${Date.now()}`, kind: 'task', status: 'todo' },
  228 |       idempotencyKey: `coordination-task-${Date.now()}`,
  229 |     });
  230 |     const task = ledger.snapshot.nodes.at(-1);
  231 |     if (!task) throw new Error('Task Ledger returned no task');
  232 |     await hostInvoke(app, 'taskLedger', 'linkSession', {
  233 |       workspaceId: workspace.id,
  234 |       nodeId: task.id,
  235 |       sessionKey,
  236 |       agentId: 'main',
  237 |       relation: 'related',
  238 |       idempotencyKey: `coordination-link-${sessionKey}-${task.id}`,
  239 |     });
  240 |     const bound = await hostInvoke<BindingResult>(app, 'workspaces', 'bindCoordinator', {
  241 |       workspaceId: workspace.id,
  242 |       agentId: 'main',
  243 |       sessionKey,
  244 |       expectedRevision: 0,
  245 |       taskLedgerNodeIds: [task.id],
  246 |       environment: { kind: 'local', rootPath: workspace.rootPath, setupProfile: null },
  247 |       archiveRestorePolicy: 'restore',
  248 |     });
  249 |     expect(bound.success).toBe(true);
  250 |     expect(bound.recovery.state).toBe('ready');
  251 |     expect(bound.binding?.sessionGeneration).toBe(sessionGeneration);
  252 |     const bindingRevision = bound.binding?.bindingRevision;
  253 |     if (typeof bindingRevision !== 'number') throw new Error('Coordinator binding revision is missing');
  254 | 
  255 |     const idempotencyKey = `coordination-ui-${Date.now()}`;
  256 |     const delegated = await hostInvoke<DelegationResult>(app, 'sessions', 'delegate', {
  257 |       sessionKey,
  258 |       workspaceId: workspace.id,
  259 |       agentId: 'main',
  260 |       taskRef: task.id,
  261 |       task: 'Exercise the long-session coordinator UI with an actual worker receipt',
  262 |       expectedBindingRevision: bindingRevision,
  263 |       expectedSessionGeneration: sessionGeneration,
  264 |       idempotencyKey,
  265 |       backend: 'subagent',
  266 |       worker: {
  267 |         roleName: 'architect',
  268 |         task: 'Return through the existing coordinator completion receipt path',
  269 |         isolation: 'shared',
  270 |         writeSet: [],
  271 |       },
  272 |       includeVerifier: false,
  273 |     });
  274 |     expect(delegated.success).toBe(true);
  275 |     expect(delegated.status).toBe('accepted');
  276 |     const orchestrationRunId = delegated.receipt?.orchestrationRunId;
  277 |     if (!orchestrationRunId) throw new Error('Delegation returned no orchestration run id');
  278 |     const batch = await waitForTerminalBatch(app, sessionKey, workspace.id, orchestrationRunId);
  279 |     expect(batch.status).toBe('terminal');
  280 |     const worker = batch.members[0];
  281 |     if (!worker?.childSessionKey) throw new Error('Terminal batch did not expose a child session key');
  282 |     const mainActivity = await hostInvoke<{ success: boolean; snapshot: ActivitySnapshot['snapshot'] }>(
  283 |       app,
  284 |       'sessionActivity',
  285 |       'snapshot',
  286 |       { workspaceId: workspace.id, sessionKey },
  287 |     );
  288 |     expect(mainActivity.success).toBe(true);
  289 |     expect(mainActivity.snapshot.completionBatches.some((candidate) => candidate.batchId === batch.batchId)).toBe(true);
  290 |     const activeBackgroundTerminalCount = mainActivity.snapshot.terminals.filter(
  291 |       (terminal) => ['starting', 'running', 'idle', 'blocked'].includes(terminal.status),
  292 |     ).length;
  293 |     const resourceEnvelope = await hostInvoke<ResourceEnvelopeState>(app, 'resourceEnvelope', 'getState');
  294 |     expect(resourceEnvelope.measured).toBe(true);
  295 |     if (!resourceEnvelope.snapshot) throw new Error('Measured resource envelope has no snapshot');
  296 | 
  297 |     await reloadChat(app, page, sessionKey);
  298 |     let coordinator = await openCoordinator(page);
  299 |     await expect(coordinator).toContainText(task.id);
> 300 |     await expect(coordinator).toContainText('local-workspace');
      |                               ^ Error: expect(locator).toContainText(expected) failed
  301 |     await expect(coordinator.getByTestId('coordinator-recovery')).toContainText('ready');
  302 |     await expect(coordinator).toContainText('CPU');
  303 |     await expect(coordinator).toContainText(`${activeBackgroundTerminalCount} background terminals`);
  304 |     await expect(coordinator).toContainText(`${resourceEnvelope.snapshot.totals.queuedCount} queued`);
  305 |     await expect(coordinator).toContainText(worker.roleName);
  306 |     await expect(coordinator).toContainText(`${batch.outcome} / ${batch.delivery.state}`);
  307 | 
  308 |     const pause = coordinator.getByTestId('coordinator-pause');
  309 |     await pause.focus();
  310 |     await expect(pause).toBeFocused();
  311 |     await page.keyboard.press('Enter');
  312 |     await expect(coordinator.getByTestId('coordinator-resume')).toBeVisible({ timeout: 30_000 });
  313 |     await expect(coordinator).toContainText(COORDINATOR_COPY.en.paused);
  314 |     const pauseControlAbsentWhilePaused = await coordinator.getByTestId('coordinator-pause').count() === 0;
  315 |     const pausedReadback = await hostInvoke<{
  316 |       binding?: { state: string; bindingRevision: number } | null;
  317 |       recovery: { state: string };
  318 |     }>(app, 'workspaces', 'resolveCoordinator', {
  319 |       workspaceId: workspace.id,
  320 |       agentId: 'main',
  321 |       sessionKey,
  322 |     });
  323 |     expect(pausedReadback.binding?.state).toBe('paused');
  324 | 
  325 |     const resume = coordinator.getByTestId('coordinator-resume');
  326 |     await resume.focus();
  327 |     await expect(resume).toBeFocused();
  328 |     await page.keyboard.press('Enter');
  329 |     await expect(coordinator.getByTestId('coordinator-pause')).toBeVisible({ timeout: 30_000 });
  330 |     await expect(coordinator).toContainText(COORDINATOR_COPY.en.active);
  331 |     const activeReadback = await hostInvoke<{
  332 |       binding?: { state: string; bindingRevision: number } | null;
  333 |       recovery: { state: string };
  334 |     }>(app, 'workspaces', 'resolveCoordinator', {
  335 |       workspaceId: workspace.id,
  336 |       agentId: 'main',
  337 |       sessionKey,
  338 |     });
  339 |     expect(activeReadback.binding?.state).toBe('active');
  340 | 
  341 |     const windowLifecycle = await minimizeAndRestore(app);
  342 |     expect(windowLifecycle).toEqual({ minimized: true, restored: true, visible: true });
  343 |     await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
  344 |     await expect(coordinator).toBeVisible();
  345 | 
  346 |     const taskLedgerLink = coordinator.getByTestId(`coordinator-task-ledger-${task.id}`);
  347 |     await taskLedgerLink.click();
  348 |     await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 })
  349 |       .toBe(`#/task-ledger?nodeId=${encodeURIComponent(task.id)}`);
  350 |     const taskLedgerHash = new URL(page.url()).hash;
  351 |     await page.goBack({ waitUntil: 'domcontentloaded' });
  352 |     await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 60_000 });
  353 |     coordinator = await openCoordinator(page);
  354 | 
  355 |     const workerButton = coordinator.getByTestId(`coordinator-worker-${batch.batchId}`);
  356 |     await expect(workerButton).toContainText(worker.roleName);
  357 |     await workerButton.click();
  358 |     const childRow = page.getByTestId(`sidebar-session-${worker.childSessionKey}`);
  359 |     await expect(childRow).toBeVisible({ timeout: 60_000 });
  360 |     await expect(childRow.locator(
  361 |       'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " sidebar-row ")][1]',
  362 |     )).toHaveAttribute('data-hook-selected', 'true', { timeout: 30_000 });
  363 |     if (await page.getByTestId('resource-popover-close').isVisible().catch(() => false)) {
  364 |       await page.getByTestId('resource-popover-close').click();
  365 |     }
  366 |     await selectSession(page, sessionKey);
  367 |     coordinator = await openCoordinator(page);
  368 |     await expect(coordinator).toContainText(task.id);
  369 | 
  370 |     const locales: Array<{ locale: Locale; title: string; active: string }> = [];
  371 |     for (const locale of ['en', 'zh', 'ja', 'ru'] as const) {
  372 |       await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
  373 |       await reloadChat(app, page, sessionKey);
  374 |       await expect(page.locator('html')).toHaveAttribute('lang', locale);
  375 |       coordinator = await openCoordinator(page);
  376 |       const copy = COORDINATOR_COPY[locale];
  377 |       const title = coordinator.getByText(copy.title, { exact: true });
  378 |       await expect(title).toBeVisible({ timeout: 30_000 });
  379 |       await expect(coordinator).toContainText(copy.active);
  380 |       await expect(coordinator.getByTestId(`coordinator-worker-${batch.batchId}`)).toContainText(worker.roleName);
  381 |       locales.push({ locale, title: await title.innerText(), active: copy.active });
  382 |       await page.getByTestId('resource-popover-close').click();
  383 |     }
  384 | 
  385 |     await reloadChat(app, page, sessionKey);
  386 |     coordinator = await openCoordinator(page);
  387 |     const workerRows = coordinator.locator('[data-testid^="coordinator-worker-"]');
  388 |     const quietBefore = await workerRows.count();
  389 |     const bellUnreadBefore = await page.getByTestId('chat-completion-unread-dot').count();
  390 |     await page.waitForTimeout(2_500);
  391 |     const quietAfter = await workerRows.count();
  392 |     const bellUnreadAfter = await page.getByTestId('chat-completion-unread-dot').count();
  393 |     expect(quietAfter).toBe(quietBefore);
  394 |     const observedWorkerManagedStopControls = await coordinator.locator('[data-testid^="resource-row-stop-"]').count();
  395 |     expect(observedWorkerManagedStopControls).toBe(0);
  396 | 
  397 |     const requestedWide = { width: 1280, height: 800 };
  398 |     const wide = await pinWindowContentSize(app, requestedWide);
  399 |     const widePath = testInfo.outputPath('coordination-wide.png');
  400 |     await page.screenshot({ path: widePath, fullPage: true });
```