import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const LONG_DIRECTORY = 'C:/workspace/verse-claw/packages/conversation/src/components/execution/details';
const LONG_OUTPUT = [
  ...Array.from({ length: 32 }, (_, index) => `PASS tests/unit/conversation-rendering-${index + 1}.test.ts`),
  '22 tests passed',
].join('\n');
const ORIGINAL_CODE = Array.from({ length: 24 }, (_, index) => `const step${index + 1} = "pending";`).join('\n') + '\n';
const MODIFIED_CODE = ORIGINAL_CODE.replaceAll('pending', 'completed');

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function surface(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload), '```'].join('\n');
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Show the execution receipt.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        '### Execution receipt',
        '',
        'The structured execution surfaces below come from the conversation payload.',
        '',
        surface({
          type: 'approval-card',
          id: 'approval-release',
          title: 'Publish the release?',
          description: 'External process write: this command may write outside the ClawX write journal; those changes have no automatic rollback.',
          icon: 'shield-alert',
          variant: 'destructive',
          confirmLabel: 'Approve',
          cancelLabel: 'Deny',
          metadata: [{ key: 'Target', value: 'staging' }],
        }),
        '',
        surface({
          type: 'terminal',
          id: 'terminal-tests',
          command: 'pnpm test --filter execution',
          cwd: LONG_DIRECTORY,
          stdout: LONG_OUTPUT,
          exitCode: 0,
          durationMs: 1840,
        }),
        '',
        surface({
          type: 'code-diff',
          id: 'diff-agent',
          filePath: `${LONG_DIRECTORY}/agent.ts`,
          language: 'typescript',
          original: ORIGINAL_CODE,
          modified: MODIFIED_CODE,
        }),
        '',
        surface({
          type: 'progress-tracker',
          id: 'progress-run',
          status: 'completed',
          steps: [
            { id: 'inspect', label: 'Inspect runtime events', status: 'completed' },
            { id: 'render', label: 'Render official Tool UI', status: 'completed' },
            { id: 'verify', label: 'Verify execution receipt', status: 'completed' },
          ],
          choice: {
            outcome: 'success',
            summary: 'Execution surfaces verified',
            at: new Date().toISOString(),
          },
        }),
        '',
        surface({
          type: 'web-search',
          id: 'web-search-reactbits',
          query: 'ReactBits CallChip progress',
          provider: 'tavily',
          status: 'searching',
          progress: 0.42,
          results: [
            { title: 'ReactBits CallChip', url: 'https://www.reactbits.dev/micro/call-chip', content: 'A chip with a left-to-right progress wash.' },
            { title: 'Rare UI Web Search', url: 'https://rareui.com/components/websearch', content: 'Search pill, source cards and citations.' },
            { title: 'Motion progress values', url: 'https://motion.dev/docs/react-animate', content: 'Animating a motion value.' },
            { title: 'Rare UI license', url: 'https://rareui.com/license', content: 'Attribution terms.' },
          ],
        }),
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('Tool UI execution surfaces', () => {
  test('renders official execution surfaces in light, dark, and narrow layouts', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.reload().catch((error) => {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      });

      const approval = page.getByTestId('chat-tool-ui-approval');
      const terminal = page.getByTestId('chat-tool-ui-terminal');
      const codeDiff = page.getByTestId('chat-tool-ui-code-diff');
      const progress = page.getByTestId('chat-tool-ui-progress-tracker');
      const webSearch = page.getByTestId('chat-tool-ui-web-search');
      await expect(approval).toBeVisible({ timeout: 30_000 });
      await expect(approval).toContainText('no automatic rollback');
      await expect(terminal).toContainText('22 tests passed');
      await expect(terminal.locator('input')).toHaveCount(0);
      await expect(codeDiff).toContainText('agent.ts');
      await expect(progress).toContainText('Execution surfaces verified');
      await expect(webSearch).toContainText('ReactBits CallChip');
      const webSearchProgress = webSearch.getByTestId('chat-web-search-progress');
      await expect(webSearchProgress).toHaveAttribute('data-progress-mode', 'horizontal');
      await expect(webSearchProgress).toHaveClass(/origin-left/);
      await expect(webSearch.getByTestId('chat-web-search-bar')).toHaveAttribute('data-progress-mode', 'horizontal');
      await expect(page.getByText('"original"', { exact: false })).toHaveCount(0);
      await expect(terminal.getByText('Exit 0', { exact: true })).toBeVisible();

      const outputToggle = terminal.getByRole('button', { name: 'Show all output (33 lines)' });
      const diffToggle = codeDiff.getByRole('button', { name: 'Expand diff' });
      await expect(outputToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(diffToggle).toHaveAttribute('aria-expanded', 'false');
      const outputRegion = terminal.getByRole('region', { name: 'Command output' });
      await expect.poll(() => outputRegion.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(1);
      expect(await outputRegion.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      // Verify keyboard scrolling on the region itself. `locator.press` focuses
      // the element before dispatching, avoiding page-focus races after reloads.
      await outputRegion.press('Home');
      await expect(outputRegion).toBeFocused();
      await expect.poll(() => outputRegion.evaluate(element => element.scrollTop)).toBe(0);
      // Layout can settle after the first End keypress; keep the key path under
      // test while allowing the final scroll position to converge.
      await expect.poll(async () => {
        await outputRegion.press('End');
        return outputRegion.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
      }, { timeout: 5_000 }).toBeLessThanOrEqual(1);
      const diffRegion = codeDiff.getByRole('region', { name: 'File differences' });
      await expect(diffRegion.locator('pre[data-diff-type="split"]')).toHaveCount(1);
      await expect(diffRegion.locator('pre')).toHaveAttribute('data-indicators', 'classic');
      await expect(diffRegion.locator('pre')).not.toHaveAttribute('data-background');
      const outputPreviewHeight = (await terminal.boundingBox())!.height;
      const diffPreviewHeight = (await codeDiff.boundingBox())!.height;
      expect(outputPreviewHeight).toBeLessThan(320);
      expect(diffPreviewHeight).toBeLessThan(350);
      await outputToggle.focus();
      await page.keyboard.press('Enter');
      expect((await terminal.boundingBox())!.height).toBeGreaterThan(outputPreviewHeight + 100);
      await terminal.getByRole('button', { name: 'Collapse output' }).click();
      await diffToggle.focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await codeDiff.boundingBox())!.height).toBeGreaterThan(diffPreviewHeight + 100);
      await expect(diffRegion.locator('pre[data-diff-type="single"]')).toHaveCount(1);
      await codeDiff.getByRole('button', { name: 'Collapse diff' }).click();

      await terminal.getByRole('button', { name: 'Copy output' }).click();
      // Windows clipboard text uses CRLF; compare every character after newline normalization.
      await expect.poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(LONG_OUTPUT);
      await codeDiff.getByRole('button', { name: 'Copy patch' }).click();
      await expect.poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(MODIFIED_CODE);

      const diskSpaceNotice = page.getByText('Disk space is running low', { exact: true });
      if (await diskSpaceNotice.isVisible().catch(() => false)) {
        await diskSpaceNotice.locator('xpath=ancestor::*[@data-sonner-toast][1]').getByRole('button').click();
      }

      const message = approval.locator('xpath=ancestor::*[starts-with(@data-testid,"chat-message-")][1]');
      await page.setViewportSize({ width: 1280, height: 1400 });
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });
      await message.scrollIntoViewIfNeeded();

      const approvalSurface = approval.locator('[data-slot="approval-card"] > div').first();
      const terminalSurface = terminal.locator('[data-slot="terminal"] > div').first();
      const codeDiffSurface = codeDiff.locator('[data-slot="code-diff"] > div').first();
      const progressSurface = progress.locator('[data-slot="progress-tracker"] > div').first();
      const surfaces = [approvalSurface, terminalSurface, codeDiffSurface, progressSurface];
      const lightBackgrounds = await Promise.all(
        surfaces.map((surface) => surface.evaluate((element) => getComputedStyle(element).backgroundColor)),
      );
      for (const background of lightBackgrounds) {
        expect(background).not.toBe('rgba(0, 0, 0, 0)');
      }
      expect(await diffRegion.locator('pre').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(lightBackgrounds[2]);
      expect(await diffRegion.evaluate(element => element.clientHeight)).toBe(200);

      const denyBox = await approval.getByRole('button', { name: 'Deny' }).boundingBox();
      const approveBox = await approval.getByRole('button', { name: 'Approve' }).boundingBox();
      const approvalSurfaceBox = await approvalSurface.boundingBox();
      expect(denyBox).not.toBeNull();
      expect(approveBox).not.toBeNull();
      expect(approvalSurfaceBox).not.toBeNull();
      expect(Math.abs((denyBox?.y ?? 0) - (approveBox?.y ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((denyBox?.width ?? 0) - (approveBox?.width ?? 0))).toBeLessThanOrEqual(2);
      const actionGroupWidth = (approveBox?.x ?? 0) + (approveBox?.width ?? 0) - (denyBox?.x ?? 0);
      expect(actionGroupWidth).toBeLessThanOrEqual((approvalSurfaceBox?.width ?? 0) / 2 + 1);
      const actionRightInset = (approvalSurfaceBox?.x ?? 0) + (approvalSurfaceBox?.width ?? 0)
        - ((approveBox?.x ?? 0) + (approveBox?.width ?? 0));
      const actionBottomInset = (approvalSurfaceBox?.y ?? 0) + (approvalSurfaceBox?.height ?? 0)
        - ((approveBox?.y ?? 0) + (approveBox?.height ?? 0));
      expect(actionRightInset).toBeGreaterThanOrEqual(0);
      expect(actionRightInset).toBeLessThanOrEqual(16);
      expect(actionBottomInset).toBeGreaterThanOrEqual(0);
      expect(actionBottomInset).toBeLessThanOrEqual(16);

      const lightPath = testInfo.outputPath('tool-ui-execution-light.png');
      await message.screenshot({ path: lightPath });
      await testInfo.attach('tool-ui-execution-light', { path: lightPath, contentType: 'image/png' });
      await terminal.screenshot({ path: testInfo.outputPath('terminal-light.png') });
      await codeDiff.screenshot({ path: testInfo.outputPath('diff-light.png') });
      await webSearch.screenshot({ path: testInfo.outputPath('web-search-light.png') });

      await page.evaluate(() => {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      });
      const darkBackgrounds = await Promise.all(
        surfaces.map((surface) => surface.evaluate((element) => getComputedStyle(element).backgroundColor)),
      );
      expect(darkBackgrounds).not.toEqual(lightBackgrounds);
      expect(await diffRegion.locator('pre').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(darkBackgrounds[2]);
      const darkPath = testInfo.outputPath('tool-ui-execution-dark.png');
      await message.screenshot({ path: darkPath });
      await testInfo.attach('tool-ui-execution-dark', { path: darkPath, contentType: 'image/png' });

      await page.setViewportSize({ width: 800, height: 1400 });
      await message.scrollIntoViewIfNeeded();
      const narrowPath = testInfo.outputPath('tool-ui-execution-narrow.png');
      await message.screenshot({ path: narrowPath });
      await testInfo.attach('tool-ui-execution-narrow', { path: narrowPath, contentType: 'image/png' });
      expect((await terminal.boundingBox())?.width ?? 0).toBeLessThanOrEqual(760);
      const overflowChecks = await Promise.all(
        [approval, terminal, codeDiff, progress, webSearch].map((surface) => surface.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        )),
      );
      expect(overflowChecks).toEqual([true, true, true, true, true]);
      await page.setViewportSize({ width: 640, height: 1400 });
      await expect(diffRegion.locator('pre[data-diff-type="split"]')).toHaveCount(1);
      for (const surface of [terminalSurface, codeDiffSurface]) {
        const header = surface.locator(':scope > div').first();
        const actions = surface.getByRole('button').first();
        const box = (await surface.boundingBox())!;
        const actionBox = (await actions.boundingBox())!;
        expect(actionBox.x).toBeGreaterThanOrEqual(box.x);
        expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
        expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      const compactPath = testInfo.outputPath('tool-ui-execution-640.png');
      await message.screenshot({ path: compactPath });
      await testInfo.attach('tool-ui-execution-640', { path: compactPath, contentType: 'image/png' });
    } finally {
      await closeElectronApp(app);
    }
  });
});
