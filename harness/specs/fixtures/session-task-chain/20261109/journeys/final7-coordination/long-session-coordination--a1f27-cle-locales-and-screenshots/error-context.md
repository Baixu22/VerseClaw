# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: long-session-coordination.spec.ts >> opens the long-session coordinator from Chat and verifies receipts, navigation, keyboard, window lifecycle, locales, and screenshots
- Location: tests\e2e\long-session-coordination.spec.ts:183:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
```

# Test source

```ts
  301 |     expect(resourceEnvelope.measured).toBe(true);
  302 |     if (!resourceEnvelope.snapshot) throw new Error('Measured resource envelope has no snapshot');
  303 | 
  304 |     await reloadChat(app, page, sessionKey);
  305 |     let coordinator = await openCoordinator(page);
  306 |     await expect(coordinator).toContainText(task.id);
  307 |     expect(bound.binding?.environment.backend).toBe('git');
  308 |     await expect(coordinator).toContainText('git / local');
  309 |     await expect(coordinator.getByTestId('coordinator-recovery')).toContainText('ready');
  310 |     await expect(coordinator).toContainText('CPU');
  311 |     await expect(coordinator).toContainText(`${activeBackgroundTerminalCount} background terminals`);
  312 |     await expect(coordinator).toContainText(`${resourceEnvelope.snapshot.totals.queuedCount} queued`);
  313 |     await expect(coordinator).toContainText(worker.roleName);
  314 |     await expect(coordinator).toContainText(`${batch.outcome} / ${batch.delivery.state}`);
  315 | 
  316 |     const pause = coordinator.getByTestId('coordinator-pause');
  317 |     await pause.focus();
  318 |     await expect(pause).toBeFocused();
  319 |     await page.keyboard.press('Enter');
  320 |     await expect(coordinator.getByTestId('coordinator-resume')).toBeVisible({ timeout: 30_000 });
  321 |     await expect(coordinator).toContainText(COORDINATOR_COPY.en.paused);
  322 |     const pauseControlAbsentWhilePaused = await coordinator.getByTestId('coordinator-pause').count() === 0;
  323 |     const pausedReadback = await hostInvoke<{
  324 |       binding?: { state: string; bindingRevision: number } | null;
  325 |       recovery: { state: string };
  326 |     }>(app, 'workspaces', 'resolveCoordinator', {
  327 |       workspaceId: workspace.id,
  328 |       agentId: 'main',
  329 |       sessionKey,
  330 |     });
  331 |     expect(pausedReadback.binding?.state).toBe('paused');
  332 | 
  333 |     const resume = coordinator.getByTestId('coordinator-resume');
  334 |     await resume.focus();
  335 |     await expect(resume).toBeFocused();
  336 |     await page.keyboard.press('Enter');
  337 |     await expect(coordinator.getByTestId('coordinator-pause')).toBeVisible({ timeout: 30_000 });
  338 |     await expect(coordinator).toContainText(COORDINATOR_COPY.en.active);
  339 |     const activeReadback = await hostInvoke<{
  340 |       binding?: { state: string; bindingRevision: number } | null;
  341 |       recovery: { state: string };
  342 |     }>(app, 'workspaces', 'resolveCoordinator', {
  343 |       workspaceId: workspace.id,
  344 |       agentId: 'main',
  345 |       sessionKey,
  346 |     });
  347 |     expect(activeReadback.binding?.state).toBe('active');
  348 | 
  349 |     const windowLifecycle = await minimizeAndRestore(app);
  350 |     expect(windowLifecycle).toEqual({ minimized: true, restored: true, visible: true });
  351 |     await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
  352 |     await expect(coordinator).toBeVisible();
  353 | 
  354 |     const taskLedgerLink = coordinator.getByTestId(`coordinator-task-ledger-${task.id}`);
  355 |     await taskLedgerLink.click();
  356 |     await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 })
  357 |       .toBe(`#/task-ledger?nodeId=${encodeURIComponent(task.id)}`);
  358 |     const taskLedgerHash = new URL(page.url()).hash;
  359 |     await page.goBack({ waitUntil: 'domcontentloaded' });
  360 |     await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 60_000 });
  361 |     coordinator = await openCoordinator(page);
  362 | 
  363 |     const workerButton = coordinator.getByTestId(`coordinator-worker-${batch.batchId}`);
  364 |     await expect(workerButton).toContainText(worker.roleName);
  365 |     await workerButton.click();
  366 |     const childRow = page.getByTestId(`sidebar-session-${worker.childSessionKey}`);
  367 |     await expect(childRow).toBeVisible({ timeout: 60_000 });
  368 |     await expect(childRow.locator(
  369 |       'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " sidebar-row ")][1]',
  370 |     )).toHaveAttribute('data-hook-selected', 'true', { timeout: 30_000 });
  371 |     if (await page.getByTestId('resource-popover-close').isVisible().catch(() => false)) {
  372 |       await page.getByTestId('resource-popover-close').click();
  373 |     }
  374 |     await selectSession(page, sessionKey);
  375 |     coordinator = await openCoordinator(page);
  376 |     await expect(coordinator).toContainText(task.id);
  377 | 
  378 |     const locales: Array<{ locale: Locale; title: string; active: string }> = [];
  379 |     for (const locale of ['en', 'zh', 'ja', 'ru'] as const) {
  380 |       await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
  381 |       await reloadChat(app, page, sessionKey);
  382 |       await expect(page.locator('html')).toHaveAttribute('lang', locale);
  383 |       coordinator = await openCoordinator(page);
  384 |       const copy = COORDINATOR_COPY[locale];
  385 |       const title = coordinator.getByText(copy.title, { exact: true });
  386 |       await expect(title).toBeVisible({ timeout: 30_000 });
  387 |       await expect(coordinator).toContainText(copy.active);
  388 |       await expect(coordinator.getByTestId(`coordinator-worker-${batch.batchId}`)).toContainText(worker.roleName);
  389 |       locales.push({ locale, title: await title.innerText(), active: copy.active });
  390 |       await page.getByTestId('resource-popover-close').click();
  391 |     }
  392 | 
  393 |     await reloadChat(app, page, sessionKey);
  394 |     coordinator = await openCoordinator(page);
  395 |     const workerRows = coordinator.locator('[data-testid^="coordinator-worker-"]');
  396 |     const quietBefore = await workerRows.count();
  397 |     const bellUnreadBefore = await page.getByTestId('chat-completion-unread-dot').count();
  398 |     await page.waitForTimeout(2_500);
  399 |     const quietAfter = await workerRows.count();
  400 |     const bellUnreadAfter = await page.getByTestId('chat-completion-unread-dot').count();
> 401 |     expect(quietAfter).toBe(quietBefore);
      |                        ^ Error: expect(received).toBe(expected) // Object.is equality
  402 |     const observedWorkerManagedStopControls = await coordinator.locator('[data-testid^="resource-row-stop-"]').count();
  403 |     expect(observedWorkerManagedStopControls).toBe(0);
  404 | 
  405 |     const requestedWide = { width: 1280, height: 800 };
  406 |     const wide = await pinWindowContentSize(app, requestedWide);
  407 |     const widePath = testInfo.outputPath('coordination-wide.png');
  408 |     await page.screenshot({ path: widePath, fullPage: true });
  409 |     const wideEvidence = await pngEvidence(widePath);
  410 |     const wideViewport = await page.evaluate(() => ({
  411 |       innerWidth: window.innerWidth,
  412 |       innerHeight: window.innerHeight,
  413 |       devicePixelRatio: window.devicePixelRatio,
  414 |     }));
  415 | 
  416 |     const requestedNarrow = { width: 680, height: 760 };
  417 |     const narrow = await pinWindowContentSize(app, requestedNarrow);
  418 |     const narrowPath = testInfo.outputPath('coordination-narrow.png');
  419 |     await page.screenshot({ path: narrowPath, fullPage: true });
  420 |     const narrowEvidence = await pngEvidence(narrowPath);
  421 |     const narrowViewport = await page.evaluate(() => ({
  422 |       innerWidth: window.innerWidth,
  423 |       innerHeight: window.innerHeight,
  424 |       devicePixelRatio: window.devicePixelRatio,
  425 |     }));
  426 |     await pinWindowContentSize(app, requestedWide);
  427 | 
  428 |     const screenshots = [
  429 |       {
  430 |         id: 'wide',
  431 |         path: 'coordination-wide.png',
  432 |         requestedViewport: requestedWide,
  433 |         contentSize: wide,
  434 |         browserViewport: wideViewport,
  435 |         pixels: wideEvidence.pixels,
  436 |         bytes: wideEvidence.bytes,
  437 |         sha256: wideEvidence.sha256,
  438 |       },
  439 |       {
  440 |         id: 'narrow',
  441 |         path: 'coordination-narrow.png',
  442 |         requestedViewport: requestedNarrow,
  443 |         contentSize: narrow,
  444 |         browserViewport: narrowViewport,
  445 |         pixels: narrowEvidence.pixels,
  446 |         bytes: narrowEvidence.bytes,
  447 |         sha256: narrowEvidence.sha256,
  448 |       },
  449 |     ];
  450 | 
  451 |     const journeyOutput = testInfo.outputPath('coordination-ui-journey.json');
  452 |     await writeFile(journeyOutput, `${JSON.stringify({
  453 |       schema: 'clawx.long-session.coordination-ui-journey/v1',
  454 |       driven_by: 'agent',
  455 |       actor: process.env.COMPASS_AGENT_NAME ?? 'codex-long-session-r2',
  456 |       workspaceId: workspace.id,
  457 |       rootPath: workspace.rootPath,
  458 |       sessionKey,
  459 |       sessionGeneration,
  460 |       taskRef: task.id,
  461 |       bindingRevision,
  462 |       idempotencyKey,
  463 |       actualWorker: {
  464 |         delegationStatus: delegated.status,
  465 |         orchestrationRunId,
  466 |         batchId: batch.batchId,
  467 |         status: batch.status,
  468 |         outcome: batch.outcome,
  469 |         delivery: batch.delivery,
  470 |         member: worker,
  471 |       },
  472 |       observed: {
  473 |         bindingStates: ['ready', 'active', 'paused', 'active'],
  474 |         keyboard: { pause: 'focus + Enter', resume: 'focus + Enter', verifiedByHostReadback: true },
  475 |         pausedState: { pauseControlAbsent: pauseControlAbsentWhilePaused, hostState: pausedReadback.binding?.state },
  476 |         resumedState: { hostState: activeReadback.binding?.state },
  477 |         ownerReads: {
  478 |           activityBackgroundRead: mainActivity.snapshot.backgroundRead.state,
  479 |           activityCompletionBatchIds: mainActivity.snapshot.completionBatches.map((candidate) => candidate.batchId),
  480 |           recoveryState: activeReadback.recovery.state,
  481 |           resourceEnvelope: resourceEnvelope.snapshot,
  482 |           activeBackgroundTerminalCount,
  483 |         },
  484 |         windowLifecycle,
  485 |         taskLedgerNavigation: { hash: taskLedgerHash, includesNodeId: taskLedgerHash.includes(`nodeId=${encodeURIComponent(task.id)}`) },
  486 |         workerNavigation: { childSessionKey: worker.childSessionKey, sidebarSelected: true, returnedToCoordinator: true },
  487 |         locales,
  488 |         quietWindow: {
  489 |           durationMs: 2_500,
  490 |           completionBatchRowsBefore: quietBefore,
  491 |           completionBatchRowsAfter: quietAfter,
  492 |           completionBellUnreadBefore: bellUnreadBefore,
  493 |           completionBellUnreadAfter: bellUnreadAfter,
  494 |         },
  495 |         observedWorkerManagedStopControls,
  496 |       },
  497 |       screenshots,
  498 |       transport: 'built Electron Chat ResourceChip -> typed workspaces/taskLedger/settings host-api -> actual Main owner; sessions.delegate -> Gateway orchestrator -> persisted session activity completion batch',
  499 |       negativeCases: [
  500 |         'While paused, the UI exposes resume only and the Workspace owner readback reports paused.',
  501 |         'The observed completion worker is listed as a navigation target and does not receive a managed-resource stop control.',
```