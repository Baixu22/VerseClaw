import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stable(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}
const key = (action: string, payload: unknown = null) => stable(['knowledge', action, payload]);
const evidence = process.env.CLAWX_KNOWLEDGE_BOT_EVIDENCE_DIR ?? resolve('docs/dev/evidence/knowledge-bot');
const question = 'Explain the decision';
const markdown = '# Decision\n\nUse **cited sources**.\n\n| Scope | Result |\n| --- | --- |\n| Knowledge | Reviewed |\n\n```ts\nconst grounded = true;\n```';

test('approved solid follows drag, real host requests, retries and shared conversation rendering', async ({ electronApp, page }) => {
  test.setTimeout(150_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  const bootConsole: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') bootConsole.push(message.text()); });
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: { [stable(['sessions.list', {}])]: { success: true, result: { sessions: [] } } },
    hostApi: {
      [key('status')]: { success: true, status: { vaultExists: true, vaultPath: 'D:/knowledge-bot-e2e/wiki', vaultMode: 'isolated', renderMode: 'native', pageCounts: { source: 1 }, sourceCounts: { native: 1 }, warnings: [], obsidianCli: { available: false } } },
      [key('listInboxItems', { status: 'pending', limit: 100 })]: { success: true, items: [] },
      [key('listDrafts', { status: 'all', limit: 100 })]: { success: true, drafts: [] },
      [key('listProposals', { status: 'all', limit: 100 })]: { success: true, proposals: [] },
      [key('listSourceSets')]: { success: true, sourceSets: [] },
      [key('listReviewBundles')]: { success: true, bundles: [] },
      [key('search', { query: '', maxResults: 30, corpus: 'wiki' })]: { success: true, results: [] },
    },
  });
  // Reload after mocks are installed so bootstrap failures and first render
  // are observed by this test, rather than lost before listeners attach.
  await page.reload();
  await expect.poll(() => errors).toEqual([]);
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-knowledge').click();
  const launcher = page.getByTestId('knowledge-librarian-open');
  await expect(launcher).toBeVisible();
  await expect(launcher.getByTestId('knowledge-bot')).toHaveAttribute('data-ready', 'true');
  const before = (await launcher.boundingBox())!;
  const dock = await page.evaluate(() => ({ x: innerWidth - 112, y: innerHeight - 108 }));
  await page.mouse.move(before.x + 44, before.y + 44);
  await page.mouse.down();
  await page.mouse.move(before.x - 130, before.y - 100, { steps: 6 });
  await expect(launcher).toHaveAttribute('data-dragging', 'true');
  await expect(launcher.getByTestId('knowledge-bot')).toHaveAttribute('data-state', 'dragging');
  const constrained = await launcher.evaluate((button) => ({ x: parseFloat(button.style.left), y: parseFloat(button.style.top) }));
  expect(Math.hypot(constrained.x - dock.x, constrained.y - dock.y)).toBeLessThanOrEqual(130.01);
  await page.screenshot({ path: resolve(evidence, 'drag.png') });
  await page.mouse.up();
  await expect(page.getByTestId('knowledge-page')).toBeVisible();
  await expect(page.getByTestId('knowledge-chat-page')).toHaveCount(0);
  const after = (await launcher.boundingBox())!;
  await expect.poll(async () => (await launcher.boundingBox())!.x).toBeCloseTo(dock.x, 0);
  const snapped = (await launcher.boundingBox())!;
  const storedPosition = await page.evaluate(() => JSON.parse(localStorage.getItem('clawx.knowledge.bot-position.v1')!));
  expect(storedPosition.x).toBeCloseTo(snapped.x, 0);
  // A short drag remains in the corner's permitted radius.
  await page.mouse.move(snapped.x + 44, snapped.y + 44);
  await page.mouse.down();
  await page.mouse.move(snapped.x, snapped.y + 10, { steps: 4 });
  await page.mouse.up();
  const withinRange = (await launcher.boundingBox())!;
  expect(withinRange.x).toBeCloseTo(snapped.x - 44, 0);
  await page.evaluate((content) => localStorage.setItem('clawx.knowledge.librarian.checkpoint.v1', JSON.stringify({ version: 1, updatedAt: '2026-10-22T00:00:00Z', messages: [{ id: 'markdown-evidence', role: 'assistant', content, createdAt: '2026-10-22T00:00:00Z', citations: [] }] })), markdown);
  await launcher.focus();
  await page.keyboard.press('Enter');
  const chat = page.getByTestId('knowledge-chat-page');
  await expect(chat).toBeVisible();
  const floating = page.getByTestId('knowledge-bot-window');
  await expect(floating).toBeVisible();
  await expect(floating).toHaveAttribute('data-phase', 'open');
  await expect(page.getByTestId('knowledge-page')).toBeVisible();
  const floatBox = (await floating.boundingBox())!;
  expect(Math.round(floatBox.width)).toBeLessThanOrEqual(400);
  expect(Math.round(floatBox.height)).toBeLessThanOrEqual(520);
  expect(floatBox.x).toBeGreaterThan(1280 / 2);
  const edgeSpacing = await floating.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const surface = document.querySelector('[data-testid="knowledge-markdown-preview"]')?.getBoundingClientRect();
    const close = node.querySelector<HTMLElement>('[data-testid="knowledge-bot-close"]')!;
    const composer = node.querySelector<HTMLElement>('[data-testid="knowledge-librarian-composer"]')!.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    return { viewportRight: innerWidth - box.right, viewportBottom: innerHeight - box.bottom,
      surfaceRightGap: surface ? surface.right - box.right : null,
      composerLeft: composer.left - box.left, composerRight: box.right - composer.right, composerBottom: box.bottom - composer.bottom,
      closeWidth: closeBox.width, closeInset: box.right - closeBox.right,
      closeBackground: getComputedStyle(close).backgroundColor,
    };
  });
  expect(edgeSpacing.viewportRight).toBeGreaterThanOrEqual(39);
  expect(edgeSpacing.viewportBottom).toBeGreaterThanOrEqual(39);
  expect(Math.abs(edgeSpacing.composerLeft - edgeSpacing.composerRight)).toBeLessThan(1);
  expect(edgeSpacing.composerBottom).toBeGreaterThanOrEqual(15);
  expect(edgeSpacing.closeWidth).toBeGreaterThanOrEqual(30);
  expect(edgeSpacing.closeInset).toBeGreaterThanOrEqual(13);
  await expect(floating.getByTestId('knowledge-librarian-clear')).toHaveCount(0);
  await expect(floating.getByTestId('knowledge-librarian-suggestions')).toHaveCount(0);
  await floating.getByTestId('knowledge-bot-prompts').click();
  await expect(page.getByTestId('knowledge-librarian-suggestions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(floating).toBeVisible();
  await expect(page.getByTestId('knowledge-librarian-suggestions')).toHaveCount(0);
  await expect(chat.locator('.codex-markdown table')).toBeVisible();
  await chat.getByTestId('assistant-code-header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(evidence, 'markdown-light.png') });
  const initialUrl = page.url();
  await expect(chat).toHaveAttribute('data-bot-state', 'idle');

  // Delay only the test host response: the renderer still traverses production
  // host-api -> IPC -> reply, and no animation state is injected by this test.
  await electronApp.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Request = { id?: string; module: string; action: string; payload?: { query?: string } };
    const previous = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
    const runtime = globalThis as unknown as { __knowledgeBotRequests: Request[]; __knowledgeBotSearchCount: number; __knowledgeBotReleases: Record<string, () => void> };
    runtime.__knowledgeBotRequests = []; runtime.__knowledgeBotSearchCount = 0; runtime.__knowledgeBotReleases = {};
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      if (request.module !== 'knowledge') return previous(event, request);
      runtime.__knowledgeBotRequests.push(request);
      const respond = (data: unknown) => ({ id: request.id, ok: true, data });
      const hold = (phase: string) => new Promise<void>((resolve) => { runtime.__knowledgeBotReleases[phase] = resolve; });
      if (request.action === 'answerFromSourceSet') {
        runtime.__knowledgeBotSearchCount++;
        await hold('search');
        if (runtime.__knowledgeBotSearchCount === 2) return respond({ success: false, error: 'Knowledge search unavailable' });
        if (runtime.__knowledgeBotSearchCount === 3) return respond({ success: true, answer: 'No admitted sources are available.', sources: [], unknowns: ['Missing evidence.'], groundingStatus: 'missing_sources', suggestedNextActions: [], retrievalDiagnostics: { resultCount: 0 } });
        return respond({ success: true, answer: 'Use cited sources for knowledge answers. [memory-wiki:notes/decision.md]',
          sources: [{ id: 'notes/decision.md', lookup: 'notes/decision.md', title: 'Decision', excerpt: 'Use cited sources for knowledge answers.',
            citation: { refId: 'memory-wiki:notes/decision.md', revision: '7', contentDigest: 'sha256:fixture', owner: 'memory-wiki', subjectId: 'notes/decision.md', sourceRefs: [] } }],
          unknowns: [], groundingStatus: 'grounded', suggestedNextActions: [], retrievalDiagnostics: { resultCount: 1 } });
      }
      if (request.action === 'recordKnowledgeReference') return respond({ success: true });
      return previous(event, request);
    });
  });
  const release = async (phase: string) => {
    await expect.poll(() => electronApp.evaluate((_app, name) => Boolean((globalThis as unknown as { __knowledgeBotReleases: Record<string, () => void> }).__knowledgeBotReleases[name]), phase)).toBe(true);
    await electronApp.evaluate((_app, name) => {
      const releases = (globalThis as unknown as { __knowledgeBotReleases: Record<string, () => void> }).__knowledgeBotReleases;
      releases[name]?.(); delete releases[name];
    }, phase);
  };
  const input = page.getByTestId('knowledge-librarian-question');
  await input.fill(question);
  await expect(chat).toHaveAttribute('data-bot-state', 'listening');
  await page.getByTestId('knowledge-librarian-ask').click();
  await expect(chat).toHaveAttribute('data-bot-state', 'searching');
  const animatedAvatar = chat.getByTestId('knowledge-librarian-loading').locator('.knowledge-bot__engine svg');
  const animatedFrame = await animatedAvatar.innerHTML();
  await expect.poll(() => animatedAvatar.innerHTML()).not.toBe(animatedFrame);
  const searchPath = await animatedAvatar.locator('path').first().getAttribute('d');
  await page.screenshot({ path: resolve(evidence, 'searching-light.png') });
  await release('search');
  await expect(chat).toHaveAttribute('data-bot-state', 'finished');
  await expect(page.getByTestId('knowledge-librarian-answer-section').locator('.codex-markdown')).toBeVisible();
  await expect(page.getByTestId('knowledge-librarian-source')).toHaveCount(1);
  await expect(page.getByTestId('knowledge-librarian-answer-section')).not.toContainText('I searched the vault');
  await expect(page.getByTestId('knowledge-librarian-retrieval-inspector')).toContainText('Explain the decision');
  await expect(floating.getByTestId('knowledge-librarian-candidate-actions')).toBeHidden();
  await expect(floating.getByTestId('knowledge-librarian-composer')).not.toContainText('Checkpoint saved');
  await floating.getByTestId('knowledge-librarian-retrieval-inspector').locator('summary').click();
  await expect(floating.getByTestId('knowledge-librarian-save-draft')).toBeVisible();
  await floating.getByTestId('knowledge-librarian-retrieval-inspector').locator('summary').click();
  await chat.getByTestId('knowledge-librarian-message-assistant').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(evidence, 'answer-light.png') });
  await input.fill('Retain my unfinished question');
  await page.getByTestId('knowledge-bot-close').click();
  await expect(floating).toHaveAttribute('aria-hidden', 'true');
  await expect(floating).toBeHidden();
  await expect(launcher).toBeVisible();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(chat).toBeVisible();
  await expect(input).toHaveValue('Retain my unfinished question');
  await expect(floating).toHaveAttribute('data-phase', 'open');
  expect(page.url()).toBe(initialUrl);
  await expect(chat.getByTestId('knowledge-librarian-composer')).toHaveClass(/codex-composer-shell/);

  await input.fill('Try again');
  await page.getByTestId('knowledge-librarian-ask').click();
  await expect(chat).toHaveAttribute('data-bot-state', 'searching');
  // Closing while a request is pending preserves the actual request, and the
  // reopened view still reflects the same pending state until the host replies.
  await floating.getByTestId('knowledge-bot-close').click();
  await expect(floating).toBeHidden();
  await launcher.click();
  await expect(chat).toHaveAttribute('data-bot-state', 'searching');
  await release('search');
  await expect(chat).toHaveAttribute('data-bot-state', 'failed');
  await expect(page.getByTestId('knowledge-librarian-error')).toContainText('Knowledge search unavailable');
  await page.screenshot({ path: resolve(evidence, 'failed.png') });
  await page.getByTestId('knowledge-librarian-retry').click();
  await expect(chat).toHaveAttribute('data-bot-state', 'searching');
  await release('search');
  await expect(chat).toHaveAttribute('data-bot-state', 'confused');
  await expect(page.getByTestId('knowledge-librarian-answer-section').last()).toContainText('No admitted sources');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(chat.locator('header [data-testid="knowledge-bot"]')).toHaveCount(0);
  const lastAvatar = chat.getByTestId('knowledge-librarian-message-assistant').last().getByTestId('knowledge-bot');
  await expect(lastAvatar).toHaveAttribute('data-motion', 'reduced');
  await expect(lastAvatar).toHaveAttribute('data-ready', 'true');
  const reducedSvg = lastAvatar.locator('.knowledge-bot__engine svg');
  const reducedFrame = await reducedSvg.innerHTML();
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(960, 760); });
  await page.screenshot({ path: resolve(evidence, 'narrow-reduced.png') });
  expect(await reducedSvg.innerHTML()).toBe(reducedFrame);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  // The earlier error toast is transient; clear that notification through its
  // UI so it does not obscure the final Markdown acceptance screenshot.
  const toastClose = page.locator('[data-sonner-toast] [data-close-button]');
  if (await toastClose.count()) await toastClose.first().click();
  await floating.getByTestId('knowledge-librarian-thread').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: resolve(evidence, 'markdown-dark-narrow.png') });
  expect(await chat.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(floating).toBeHidden();
  await expect(floating).toHaveAttribute('data-phase', 'closed');
  await expect(launcher).toBeVisible();
  const restored = (await launcher.boundingBox())!;
  expect(restored.x).toBeLessThanOrEqual(960 - 88);
  await page.screenshot({ path: resolve(evidence, 'launcher-dark.png') });

  const requests = await electronApp.evaluate(() => (globalThis as unknown as { __knowledgeBotRequests: unknown[] }).__knowledgeBotRequests);
  expect((requests as Array<{ action: string }>).some((r) => ['applyDraft', 'applyReviewedChange'].includes(r.action))).toBe(false);
  expect(errors).toEqual([]);
  expect(bootConsole.filter((message) => /ReferenceError|TypeError|Error Boundary/.test(message))).toEqual([]);
  await writeFile(resolve(evidence, 'interaction-results.json'), JSON.stringify({
    driven_by: 'agent', actor: 'codex', evidence_kind: 'real-electron-with-controlled-host-responses',
    floating: { floatBox, edgeSpacing, backgroundMounted: true, routeUnchanged: true, draftRetained: true, pendingRequestRetained: true, escapeClosed: true,
      compactMetadata: true, promptsInMenu: true, candidateActionsInDetails: true, minimizeControl: true, focusRestored: true, animation: { openMs: 180, closeMs: 140, reducedMs: 80 } },
    drag: { before, constrained, after, snapped, withinRange, storedPosition, restored, radius: 112, openedOnDrag: false, keyboardOpened: true },
    observedStates: ['idle', 'listening', 'searching', 'finished', 'failed', 'searching', 'confused'],
    sharedMarkdown: { table: true, codeHeader: true, composerShell: true }, reducedMotionStable: true,
    searchBodyPathPresent: Boolean(searchPath), animatedFrameChanges: true, errors, requests,
  }, null, 2) + '\n');
});
