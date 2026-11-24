import { randomUUID } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';
import { createComposerContextFiles, persistComposerContext } from './fixtures/composer-context-report';
import { hostInvoke } from './fixtures/fp-p1-harness';
import type { WorkspaceContextRange } from '../../shared/types/workspace';

const sessionKey = 'agent:main:main';
const modelRef = 'custom-composerprobe/gpt-6.1-sol';

for (const theme of ['light', 'dark'] as const) {
  test(`uses recorded files for context and fits adjacent model controls (${theme})`, async ({ launchElectronApp, homeDir, userDataDir }, info) => {
    test.setTimeout(180000);
    const sessionId = randomUUID();
    const files = await createComposerContextFiles(homeDir);
    const input = { homeDir, stateDir: join(userDataDir, 'openclaw-source-state'), ...files, sessionKey, sessionId, modelRef, usage: { input: 2400, output: 200, cacheRead: 1200, cacheWrite: 0 } };
    const first = await persistComposerContext(input, info.outputPath('first-inputs'));
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme, deviceScaleFactor: 1 });
    try {
      const now = new Date().toISOString();
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpcByMethod: { 'sessions.list': { sessions: [{ key: sessionKey, sessionId, displayName: 'Context source inspection', modelRefOverride: modelRef }] }, 'chat.history': { messages: [] }, '*': {} },
        hostApi: {
          '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', isDefault: true, modelRef, overrideModelRef: modelRef, inheritedModel: false, workspace: files.workspaceDir, mainSessionKey: sessionKey, reasoningEffort: 'max', channelTypes: [] }], defaultAgentId: 'main', defaultModelRef: modelRef },
          '["providers","accounts",null]': [
            { id: 'composerprobe', vendorId: 'custom', label: 'Any', authMode: 'api_key', model: 'gpt-6.1-sol', baseUrl: 'https://composer.invalid/v1', enabled: true, isDefault: true, createdAt: now, updatedAt: now },
            { id: 'composersecond', vendorId: 'custom', label: 'Any 02', authMode: 'api_key', model: 'gpt-6.2-sol', baseUrl: 'https://composer-second.invalid/v1', enabled: true, isDefault: false, createdAt: now, updatedAt: now },
          ],
          '["providers","accountKeyInfo",null]': [{ accountId: 'composerprobe', hasKey: true, keyMasked: '***' }, { accountId: 'composersecond', hasKey: true, keyMasked: '***' }],
          '["providers","vendors",null]': [],
          '["sessions","compactionStatus",null]': { success: true, available: false, canCompact: false, inProgress: false, pressure: 'unknown', warnings: [] },
        },
      });
      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await pinWindowContentSize(app, { width: 1280, height: 800 });
      const tag = page.getByTestId('chat-context-indicator');
      const details = page.getByTestId('chat-context-details');
      await expect(tag).toHaveAttribute('aria-label', `Context: ${first.usedTokens.toLocaleString('en-US')} of 32,768 tokens`);
      const readRange = () => hostInvoke<{ success: boolean; range: WorkspaceContextRange }>(app, 'usage', 'contextRange', { sessionKey, expectedSessionId: sessionId, modelRef });
      const firstRange = await readRange();
      expect(firstRange.range.usageSource).toBe('last-request');
      expect(firstRange.range.composition?.systemPromptChars).toBe(first.report.systemPrompt.chars);
      expect(firstRange.range.composition?.workspaceFiles.entries.map(entry => entry.chars)).toEqual(first.report.injectedWorkspaceFiles.map(entry => entry.injectedChars));
      expect(firstRange.range).not.toHaveProperty('summarizedMessageCount');
      expect(firstRange.range).not.toHaveProperty('truncatedMessageCount');
      await tag.click();
      await expect(tag).toHaveText('');
      await expect(tag).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect(await tag.locator('circle').evaluateAll(circles => circles.every(circle => getComputedStyle(circle).fill === 'none'))).toBe(true);
      await expect(details.getByTestId('chat-context-composition-bar')).toHaveCSS('height', '2px');
      await details.locator('summary').filter({ hasText: 'Project files' }).click();
      await expect(details.getByText('AGENTS.md', { exact: true })).toBeVisible();
      await expect(details.getByTestId('chat-context-source-entries').filter({ hasText: 'TOOLS.md' })).toContainText(first.report.injectedWorkspaceFiles[1].injectedChars.toLocaleString('en-US'));
      await expect(details).toContainText('Input tokens measured for the last request.');
      await page.screenshot({ path: info.outputPath(`context-files-${theme}-1280.png`) });
      await page.keyboard.press('Escape');
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-agent-effort-slider').hover();
      const tooltip = page.getByTestId('chat-agent-effort-tooltip');
      await expect.poll(() => tooltip.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42)).toBeCloseTo(-36, 0);
      await page.screenshot({ path: info.outputPath(`model-tooltip-${theme}-1280.png`) });
      await page.getByTestId('chat-model-picker-current').click();
      const search = page.getByTestId('chat-model-picker-search');
      await expect(search).toBeFocused();
      await expect(search).toHaveCSS('outline-style', 'none');
      await expect(search).toHaveCSS('box-shadow', 'none');
      await expect(search).toHaveCSS('border-top-width', '0px');
      await expect(page.getByTestId('chat-agent-effort-slider')).toBeHidden();
      await expect(page.getByTestId('chat-agent-effort-tooltip')).toBeHidden();
      await page.screenshot({ path: info.outputPath(`model-search-${theme}-1280.png`) });
      await tag.click();
      await expect(page.getByTestId('chat-model-settings-card')).toBeHidden();
      await expect(details).toBeVisible();
      await page.keyboard.press('Escape');

      // Change the source and rebuild its real runtime report; UI must follow the new persisted values.
      await appendFile(files.files[1], '\nRecorded source changes must update the context report.\n');
      const second = await persistComposerContext({ ...input, usage: { input: 2700, output: 250, cacheRead: 1300, cacheWrite: 100 } }, info.outputPath('second-inputs'));
      const secondRange = await readRange();
      expect(second.report.systemPrompt.chars).toBeGreaterThan(first.report.systemPrompt.chars);
      expect(secondRange.range.composition?.systemPromptChars).toBe(second.report.systemPrompt.chars);
      expect(secondRange.range.usedTokens).toBe(second.usedTokens);
      expect(second.sources[1].sha256).not.toBe(first.sources[1].sha256);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(tag).toHaveAttribute('aria-label', `Context: ${second.usedTokens.toLocaleString('en-US')} of 32,768 tokens`);
      await tag.click();
      await details.getByTestId('chat-context-detailed-breakdown').click();
      await expect(details.getByText('TOOLS.md', { exact: true })).toBeVisible();
      await expect(details.getByTestId('chat-context-source-entries').filter({ hasText: 'TOOLS.md' })).toContainText(second.report.injectedWorkspaceFiles[1].injectedChars.toLocaleString('en-US'));
      await page.screenshot({ path: info.outputPath(`context-updated-${theme}-1280.png`) });
      const sizes: Record<string, unknown> = {};
      for (const width of [1280, 375]) {
        await pinWindowContentSize(app, { width, height: width === 375 ? 667 : 800 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const bounds = await details.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(7);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 7);
        expect(bounds!.y).toBeGreaterThanOrEqual(7);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual((width === 375 ? 667 : 800) - 7);
        await expect(details.getByRole('heading', { name: 'Context window', exact: true })).toBeInViewport();
        await expect(details.getByTestId('chat-context-usage')).toBeInViewport();
        await expect(details.getByRole('button', { name: 'Close context details' })).toBeInViewport();
        sizes[String(width)] = bounds;
        await page.screenshot({ path: info.outputPath(`context-updated-${theme}-${width}px.png`) });
      }
      await page.evaluate(async () => {
        await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'language', value: 'zh' } });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
      for (const width of [1280, 375]) {
        await pinWindowContentSize(app, { width, height: width === 375 ? 667 : 800 });
        await tag.click();
        await details.getByTestId('chat-context-source-group').last().locator('summary').click();
        await expect(details.getByText('TOOLS.md', { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`context-files-${theme}-zh-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.getByTestId('chat-model-picker-button').click();
        await page.getByTestId('chat-agent-effort-slider').hover();
        await expect(tooltip).toBeVisible();
        await page.screenshot({ path: info.outputPath(`model-tooltip-${theme}-zh-${width}.png`) });
        await page.keyboard.press('Escape');
      }
      await writeFile(info.outputPath('source-chain.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-composer-context',
        contextService: 'real-Main', navigationAndProviderSeam: 'typed-replay', electronVersion: await app.evaluate(() => process.versions.electron), first, firstRange, second, secondRange, sizes }, null, 2));
    } finally { await closeElectronApp(app); }
  });
}
