import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';
import type { ElectronApplication, Page } from '@playwright/test';

const SESSION = 'agent:main:main';
const ALPHA = 'custom-alpha123/model-alpha';
const BETA = 'custom-beta5678/provider/model-beta';
const snapshot = (effort: string) => ({ success: true, agents: [{ id: 'main', name: 'Main', isDefault: true,
  modelRef: ALPHA, modelDisplay: 'model-alpha', overrideModelRef: ALPHA, inheritedModel: false,
  workspace: 'D:/tmp/model-settings-fixture', mainSessionKey: SESSION, channelTypes: [], reasoningEffort: effort }],
  defaultAgentId: 'main', defaultModelRef: ALPHA, configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} });

async function seed(app: ElectronApplication) {
  const now = new Date().toISOString();
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
    gatewayRpcByMethod: { 'sessions.list': { sessions: [{ key: SESSION, sessionId: 'model-settings-generation', displayName: '模型选择', modelRefOverride: ALPHA }] },
      'chat.history': { messages: [] }, '*': {} },
    hostApi: {
      '["agents","list",null]': snapshot('max'),
      '["agents","updateReasoningEffort",null]': snapshot('auto'),
      '["sessions","patchRuntimeModel",null]': { success: true },
      '["providers","accounts",null]': [
        { id: 'alpha1234', vendorId: 'custom', label: 'Alpha', authMode: 'api_key', baseUrl: 'https://alpha.invalid/v1', model: 'model-alpha', enabled: true, isDefault: true, createdAt: now, updatedAt: now },
        { id: 'custom-beta5678', vendorId: 'custom', label: 'Beta', authMode: 'api_key', baseUrl: 'https://beta.invalid/v1', model: BETA, enabled: true, isDefault: false, createdAt: now, updatedAt: now },
      ],
      '["providers","accountKeyInfo",null]': [{ accountId: 'alpha1234', hasKey: true, keyMasked: '***' }, { accountId: 'custom-beta5678', hasKey: true, keyMasked: '***' }],
      '["providers","vendors",null]': [],
    },
  });
}
async function openModels(page: Page) {
  await page.getByTestId('chat-model-picker-current').click();
  await expect(page.getByTestId('chat-model-picker-search')).toBeVisible();
  await expect.poll(() => page.getByTestId('chat-model-picker-list-layer').evaluate(element => {
    const match = getComputedStyle(element).clipPath.match(/^inset\((.*?)\s+round/);
    return match ? Math.max(...match[1].split(/\s+/).map(value => Math.abs(parseFloat(value)))) : 0;
  })).toBeLessThan(0.2);
}
async function language(page: Page, value: string) {
  await page.evaluate(async language => {
    await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'language', value: language } });
  }, value);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}

test('opens the compact reasoning card, masks its slider and saves the selected runtime model', async ({ launchElectronApp }, info) => {
  test.setTimeout(180000);
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark', deviceScaleFactor: 1 });
  try {
    await seed(app);
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await page.getByTestId('chat-composer-input').fill('保留这份草稿');
    await page.getByTestId('chat-model-picker-button').click();
    await expect(page.getByTestId('chat-model-settings-effort')).toContainText('Max');
    await expect(page.getByTestId('chat-agent-effort-slider')).toBeVisible();
    await page.getByTestId('chat-agent-effort-slider').hover();
    await expect(page.getByTestId('chat-agent-effort-tooltip')).toBeVisible();
    await expect(page.getByTestId('chat-agent-effort-popover').locator('img')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('settings-tooltip-dark-1280.png') });
    await openModels(page);
    await expect(page.getByTestId('chat-agent-effort-slider')).toBeHidden();
    await expect(page.getByTestId('chat-model-settings-slider-region')).toHaveAttribute('inert', '');
    await expect(page.getByTestId('chat-agent-effort-tooltip')).toBeHidden();
    const opacity = await page.locator('[data-slot="model-picker-surface"]').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(opacity).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: info.outputPath('models-dark-1280.png') });
    await page.getByTestId('chat-model-picker-search').fill('model-beta');
    await expect(page.getByTestId('chat-model-options').getByRole('option')).toHaveCount(1);
    await page.getByTestId('chat-model-picker-search').press('Enter');
    await expect(page.getByTestId('chat-model-picker-menu')).toBeHidden();
    await expect(page.getByTestId('chat-model-picker-button')).toHaveAttribute('title', BETA);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('保留这份草稿');
    const calls = await app.evaluate(() => (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module: string; action: string; payload: unknown }> }).__verseClawE2eHostCalls ?? []);
    const modelCalls = calls.filter(call => call.module === 'sessions' && call.action === 'patchRuntimeModel');
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].payload).toEqual({ sessionKey: SESSION, modelRef: BETA });
    expect(calls.filter(call => call.module === 'agents' && call.action === 'updateModel')).toHaveLength(0);
    await page.getByTestId('chat-model-picker-button').click();
    await page.getByTestId('chat-model-settings-reset').click();
    await expect(page.getByTestId('chat-agent-effort-slider')).toHaveValue('0');
    await page.screenshot({ path: info.outputPath('settings-reset-auto.png') });
    await writeFile(info.outputPath('interaction.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-model-ui', modelCalls, sliderMasked: true, avatarReplacedByText: true, draftPreserved: true, reset: 'auto' }, null, 2));
  } finally { await closeElectronApp(app); }
});

test('keeps both layers usable across locales, themes, 375px and reduced motion', async ({ launchElectronApp }, info) => {
  test.setTimeout(180000);
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark', deviceScaleFactor: 1 });
  try {
    await seed(app);
    const page = await getStableWindow(app); await page.reload();
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.setMinimumSize(320, 600); });
    const measurements: unknown[] = [];
    for (const lang of ['en', 'zh', 'ja', 'ru']) {
      await language(page, lang);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async theme => {
          await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'theme', value: theme } });
        }, theme);
        await page.reload();
        for (const width of [1280, 375]) {
          const size = await pinWindowContentSize(app, { width, height: 800 }); expect(size.width).toBe(width);
          await page.getByTestId('chat-model-picker-button').click();
          await expect(page.getByTestId('chat-agent-effort-slider')).toBeVisible();
          await openModels(page);
          const bounds = await page.getByTestId('chat-model-picker-list-layer').evaluate(element => {
            const box = element.getBoundingClientRect();
            return { viewport: innerWidth, left: box.left, right: box.right, top: box.top, bottom: box.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
          });
          expect(bounds.left).toBeGreaterThanOrEqual(6); expect(bounds.right).toBeLessThanOrEqual(width - 6);
          expect(bounds.top).toBeGreaterThanOrEqual(6); expect(bounds.bottom).toBeLessThanOrEqual(794);
          expect(bounds.overflow).toBe(false); measurements.push({ lang, theme, width, ...bounds });
          if (width === 375 && (lang === 'zh' || lang === 'ru')) await page.screenshot({ path: info.outputPath(`models-${lang}-${theme}-375.png`) });
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('chat-agent-effort-slider')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('chat-model-picker-menu')).toBeHidden();
        }
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('chat-model-picker-button').click();
    await page.getByTestId('chat-agent-effort-slider').focus();
    await expect(page.getByTestId('chat-agent-effort-tooltip')).toBeVisible();
    await page.getByTestId('chat-model-picker-current').click();
    await expect(page.getByTestId('chat-agent-effort-slider')).toBeHidden();
    await page.screenshot({ path: info.outputPath('models-reduced-motion.png') });
    await writeFile(info.outputPath('geometry.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-model-ui', measurements, reducedMotion: true }, null, 2));
  } finally { await closeElectronApp(app); }
});
