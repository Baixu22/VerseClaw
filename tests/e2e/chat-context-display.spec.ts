import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';
import type { WorkspaceSnapshot } from '../../shared/types/workspace';

const keyA = 'agent:main:main';
const keyB = 'agent:main:context-b';
const generationA = 'context-generation-a';
const generationB = 'context-generation-b';
const generatedAt = Date.now();
const composition = (sessionId = generationA, fileName = 'AGENTS.md') => ({
  sessionId, generatedAt, source: 'run', modelRef: 'test/model', systemPromptChars: 6000, instructionsChars: 1500, currentTurnChars: 100, runtimeContextChars: 200,
  workspaceFiles: { chars: 3000, totalEntries: 2, entries: [
    { name: fileName, path: `D:/project/${fileName}`, chars: 2500, rawChars: 4000, status: 'truncated' },
    { name: 'SOUL.md', path: 'D:/project/SOUL.md', chars: 500, rawChars: 500, status: 'included' },
  ] },
  skills: { chars: 1000, totalEntries: 1, entries: [{ name: 'search', chars: 1000, status: 'included' }] },
  tools: { chars: 2000, totalEntries: 1, entries: [{ name: 'exec', chars: 2000, status: 'included' }] },
});

function mocks(options: { used?: number | null; report?: boolean; language?: string; theme?: string } = {}) {
  const used = options.used === undefined ? 40000 : options.used;
  const range = { sessionKey: keyA, sessionId: generationA, modelRef: 'test/model', usedTokens: used, maxTokens: 128000, usageSource: used == null ? 'unavailable' : 'runtime', status: 'bestEffort', retainedMessageCount: 12, composition: options.report === false ? null : composition() };
  const compaction = { success: true, available: true, canCompact: true, inProgress: false, usedTokens: used, maxTokens: 128000, truncatedMessageCount: 0, pressure: 'low', warnings: [] };
  const hostApi: Record<string, unknown> = {
    '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', mainSessionKey: keyA }], defaultAgentId: 'main', defaultModelRef: null },
    '["workspaces","list",null]': { profiles: [], activeWorkspaceId: null, activeWorkspace: null },
    '["usage","contextRange",null]': { success: true, range },
    '["usage","live",null]': { success: true, usage: { sessionKey: keyA, scope: 'session', inputTokens: 500000, outputTokens: 100000, cacheReadTokens: 300000, cacheWriteTokens: 0, totalTokens: 900000, updatedAt: generatedAt, status: 'final' } },
    '["sessions","compactionStatus",null]': compaction,
    '["memory","injectionReceipts",null]': { success: true, receipts: [{ sessionKey: keyA, source: 'working-memory', selected: ['memory:fact-1'], omitted: ['memory:fact-2'], budgetCharsApplied: 120, budgetCharsRequested: 180, createdAt: generatedAt + 5 }] },
  };
  if (options.language) hostApi['["settings","getAll",null]'] = { language: options.language, theme: options.theme ?? 'light', chatContextDisplayEnabled: true };
  return {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpcByMethod: {
      'sessions.list': { sessions: [{ key: keyA, sessionId: generationA, displayName: 'Context A', updatedAt: generatedAt, messageCount: 1 }, { key: keyB, sessionId: generationB, displayName: 'Context B', updatedAt: generatedAt, messageCount: 1, lastMessagePreview: 'Previous conversation' }] },
      'chat.history': { messages: [] },
      '*': {},
    },
    hostApi,
  };
}

// Agent-driven fixtures exercise the actual Electron UI and typed host facade.
for (const theme of ['light', 'dark'] as const) {
  test(`shows the TokenTag and source details with keyboard and narrow layouts (${theme})`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });
    try {
      await installIpcMocks(app, mocks());
      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.setViewportSize({ width: 1280, height: 800 });
      const tag = page.getByTestId('chat-context-indicator');
      await expect(tag).toHaveAttribute('aria-label', 'Context: 40,000 of 128,000 tokens');
      await expect(tag).toHaveText('');
      await expect(tag).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(tag).toHaveCSS('width', '30px');
      await expect(tag.locator('svg')).toHaveCount(1);
      await expect(tag.locator('.ant-progress-circle-path').first()).toHaveCSS('stroke', await tag.evaluate(element => getComputedStyle(element).color));
      await expect(tag).toHaveAttribute('data-status', 'normal');
      expect((await getAgentDevHostCalls(page) as Array<{ module: string; action: string }>).filter(call => call.module === 'memory' && call.action === 'injectionReceipts')).toHaveLength(0);
      await tag.hover();
      const details = page.getByTestId('chat-context-details');
      await expect(details).toBeVisible();
      await expect(details.getByTestId('chat-context-usage')).toHaveText('40,000 / 128,000 tokens');
      await expect(details.getByTestId('chat-context-composition-bar').locator('span')).toHaveCount(6);
      await expect(details.getByTestId('chat-context-composition-bar')).toHaveCSS('height', '2px');
      await expect(details).toContainText('Share of recorded characters');
      await details.locator('summary').filter({ hasText: 'Project files' }).click();
      await expect(details.getByText('AGENTS.md', { exact: true })).toBeVisible();
      await expect(details.getByText('AGENTS.md', { exact: true })).toBeInViewport();
      await expect(details).toContainText('Trimmed to fit the context');
      await expect(details).toContainText('working-memory');
      const sourceScroll = details.getByTestId('chat-context-source-scroll');
      await sourceScroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(details.getByRole('heading', { name: 'Context window', exact: true })).toBeInViewport();
      await expect(details.getByTestId('chat-context-usage')).toBeInViewport();
      await expect(details.getByRole('button', { name: 'Close context details' })).toBeInViewport();
      await sourceScroll.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`context-details-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(details).not.toBeVisible();
      await expect(tag).toBeFocused();

      await tag.press('Enter');
      await expect(details).toContainText('Details stay open');
      await expect(details.getByRole('button', { name: 'Close context details' })).toBeFocused();
      await page.keyboard.press('Tab');
      const toolSummary = details.locator('summary').filter({ hasText: 'Tool definitions' });
      await expect(toolSummary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(details.getByText('exec', { exact: true })).toBeVisible();
      await details.getByTestId('chat-context-detailed-breakdown').click();
      expect(await details.getByTestId('chat-context-source-group').evaluateAll(groups => groups.every(group => (group as HTMLDetailsElement).open))).toBe(true);
      await page.getByTestId('chat-composer-input').click({ position: { x: 8, y: 8 } });
      await expect(details).not.toBeVisible();
      await page.setViewportSize({ width: 375, height: 667 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.evaluate(() => window.innerWidth)).toBe(375);
      await expect(tag).toBeVisible();
      const tagBounds = await tag.boundingBox();
      expect(tagBounds).not.toBeNull();
      expect(tagBounds!.x).toBeGreaterThanOrEqual(7);
      expect(tagBounds!.x + tagBounds!.width).toBeLessThanOrEqual(368);
      await tag.click();
      await expect(details).toBeVisible();
      await expect(tag).toHaveText('');
      const bounds = await details.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(7);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(368);
      expect(bounds!.y).toBeGreaterThanOrEqual(7);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(660);
      expect(await tag.locator('.ant-progress-circle-path').evaluateAll(paths => paths.every(path => getComputedStyle(path).transitionDuration === '0s'))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`context-details-${theme}-375px.png`) });
    } finally { await closeElectronApp(app); }
  });
}

test('keeps an unknown reading distinct from cumulative billing and signals high window usage', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, mocks({ used: null, report: false }));
    const page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const tag = page.getByTestId('chat-context-indicator');
    await expect(tag).toHaveAttribute('data-status', 'unknown');
    await tag.click();
    await expect(page.getByTestId('chat-context-usage')).toHaveText('— / 128,000 tokens');
    await expect(page.getByTestId('chat-context-composition-pending')).toBeVisible();
    await installIpcMocks(app, mocks({ used: 120000 }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(tag).toHaveAttribute('data-status', 'overload');
    await tag.click();
    await expect(page.getByTestId('chat-context-usage')).toHaveText('120,000 / 128,000 tokens');
  } finally { await closeElectronApp(app); }
});

test('reads the owning session report through the real Main context service', async ({ launchElectronApp, homeDir }, testInfo) => {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ [keyA]: {
    sessionId: generationA, totalTokens: 4096, totalTokensFresh: true, contextTokens: 8192, updatedAt: generatedAt,
    systemPromptReport: {
      sessionKey: keyA, sessionId: generationA, generatedAt, source: 'run', provider: 'test', model: 'model',
      systemPrompt: { chars: 6000, projectContextChars: 3000, nonProjectContextChars: 3000 },
      currentTurn: { promptChars: 100, runtimeContextChars: 200 },
      injectedWorkspaceFiles: [{ name: 'LOCAL-AGENTS.md', path: join(homeDir, 'LOCAL-AGENTS.md'), rawChars: 4000, injectedChars: 3000, truncated: true }],
      skills: { promptChars: 1000, entries: [{ name: 'search', blockChars: 1000 }] },
      tools: { listChars: 500, schemaChars: 1500, definitionChars: 2000, entries: [{ name: 'exec', summaryChars: 500, schemaChars: 1500 }] },
    },
  } }));
  await writeFile(join(sessionsDir, `${generationA}.jsonl`), JSON.stringify({ type: 'message', timestamp: new Date(generatedAt).toISOString(), message: { role: 'assistant', usage: { input: 200000, output: 100, total: 200100 } } }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const config = mocks();
    delete config.hostApi['["usage","contextRange",null]'];
    delete config.hostApi['["usage","live",null]'];
    config.hostApi['["sessions","compactionStatus",null]'] = { success: true, available: false, canCompact: false, inProgress: false, pressure: 'unknown', truncatedMessageCount: 0, warnings: [] };
    await installIpcMocks(app, config);
    const page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const tag = page.getByTestId('chat-context-indicator');
    await expect(tag).toHaveAttribute('aria-label', 'Context: 4,096 of 8,192 tokens');
    await tag.click();
    const details = page.getByTestId('chat-context-details');
    await details.locator('summary').filter({ hasText: 'Project files' }).click();
    await expect(details.getByText('LOCAL-AGENTS.md', { exact: true })).toBeVisible();
    await expect(details.getByTestId('chat-context-usage')).toHaveText('4,096 / 8,192 tokens');
    await writeFile(testInfo.outputPath('persisted-context-host.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-runner', contextService: 'real-Main', electronVersion: await app.evaluate(() => process.versions.electron), usedTokens: 4096, maxTokens: 8192, transcriptBillingTokens: 200100, sourceFile: 'LOCAL-AGENTS.md' }));
  } finally { await closeElectronApp(app); }
});

test('persists the display switch to the host store and restores it after an app restart', async ({ launchElectronApp, userDataDir }, testInfo) => {
  let app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, mocks());
    let page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-context-indicator')).toBeVisible();
    await page.evaluate(() => { location.hash = '#/settings/general'; });
    const toggle = page.getByTestId('settings-chat-context-display');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const settingsFile = join(userDataDir, 'settings.json');
    await expect.poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).chatContextDisplayEnabled).toBe(false);
    await page.evaluate(() => { location.hash = '#/'; });
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await expect(page.getByTestId('chat-context-indicator')).toHaveCount(0);
    await closeElectronApp(app);
    app = await launchElectronApp({ skipSetup: true, skipSeed: true });
    await installIpcMocks(app, mocks());
    page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await expect(page.getByTestId('chat-context-indicator')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/settings/general'; });
    await expect(page.getByTestId('settings-chat-context-display')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('settings-chat-context-display').click();
    await expect.poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).chatContextDisplayEnabled).toBe(true);
    await page.evaluate(() => { location.hash = '#/'; });
    await expect(page.getByTestId('chat-context-indicator')).toBeVisible();
    await writeFile(testInfo.outputPath('context-setting-persistence.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-runner', disabledAfterRestart: true, reenabled: true }));
  } finally { await closeElectronApp(app); }
});

test('replaces source details when switching conversations', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const config = mocks();
    const snapshot = await hostInvoke<WorkspaceSnapshot>(app, 'workspaces', 'list');
    const owner = snapshot.activeWorkspace ?? snapshot.profiles[0];
    expect(owner).toBeDefined();
    const workspace = { ...owner, sessionStates: { ...owner.sessionStates, [keyA]: {}, [keyB]: {} } };
    config.hostApi['["workspaces","list",null]'] = { profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace };
    config.hostApi[JSON.stringify(['usage', 'contextRange', { expectedSessionId: generationB, messageCount: 0, modelRef: null, sessionKey: keyB, usedTokens: null }])] = {
      success: true, range: { sessionKey: keyB, sessionId: generationB, usedTokens: 1000, maxTokens: 128000, usageSource: 'runtime', status: 'bestEffort', composition: composition(generationB, 'PROJECT-B.md') },
    };
    config.hostApi[JSON.stringify(['sessions', 'compactionStatus', { agentId: 'main', sessionKey: keyB }])] = { success: true, available: false, canCompact: false, inProgress: false, pressure: 'unknown', warnings: [] };
    await installIpcMocks(app, config);
    const page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const tag = page.getByTestId('chat-context-indicator');
    await tag.click();
    await expect(page.getByTestId('chat-context-details')).toContainText('Project files');
    await page.getByTestId(`sidebar-session-${keyB}`).click();
    await expect(page.getByTestId('chat-context-details')).toHaveCount(0);
    await expect(tag).toHaveAttribute('aria-label', 'Context: 1,000 of 128,000 tokens');
    await tag.click();
    const details = page.getByTestId('chat-context-details');
    await details.locator('summary').filter({ hasText: 'Project files' }).click();
    await expect(details.getByText('PROJECT-B.md', { exact: true })).toBeVisible();
    await expect(details.getByText('AGENTS.md', { exact: true })).toHaveCount(0);
    await expect(details.getByText('working-memory', { exact: true })).toHaveCount(0);
  } finally { await closeElectronApp(app); }
});

test('renders the context details and setting in all four locales', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });
  try {
    const page = await getStableWindow(app);
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [language, title, setting] of [
      ['en', 'Context window', 'Show context usage'], ['zh', '上下文窗口', '显示上下文用量'],
      ['ja', 'コンテキストウィンドウ', 'コンテキスト使用量を表示'], ['ru', 'Окно контекста', 'Показывать использование контекста'],
    ]) {
      await installIpcMocks(app, mocks({ language, theme: 'dark' }));
      await page.evaluate(() => { location.hash = '#/'; });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const tag = page.getByTestId('chat-context-indicator');
      await expect(tag).toBeVisible();
      await tag.click();
      const details = page.getByRole('dialog', { name: title, exact: true });
      await expect(details).toBeVisible();
      if (language === 'zh') {
        await details.locator('summary').filter({ hasText: '项目文件' }).click();
        await expect(details.getByText('AGENTS.md', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('context-details-zh-dark.png') });
      }
      await page.keyboard.press('Escape');
      await page.evaluate(() => { location.hash = '#/settings/general'; });
      await expect(page.getByTestId('settings-chat-context-display')).toHaveAttribute('aria-label', setting);
      if (language === 'zh') await page.screenshot({ path: testInfo.outputPath('context-setting-zh-dark.png') });
    }
  } finally { await closeElectronApp(app); }
});
