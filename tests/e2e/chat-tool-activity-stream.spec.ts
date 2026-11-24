import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const SESSION = 'agent:main:main';
const CALL = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const NOW = Date.now();
const HISTORY = [
  { id: 'activity-user', role: 'user', content: '检查项目后更新配置，说明执行结果。', timestamp: NOW - 12000 },
  { id: 'activity-intro', role: 'assistant', content: [
    { type: 'text', text: '我会先读取配置、查阅文档，再运行检查。每组操作可以展开查看。' },
    CALL('read-config', 'read_file', { path: 'src/config.ts' }),
    CALL('search-docs', 'web_search', { query: 'React rendering reference' }),
    CALL('open-docs', 'web_fetch', { url: 'https://magicui.design/docs/components/dia-text-reveal' }),
    CALL('run-check', 'exec_command', { command: 'pnpm run check' }),
  ], timestamp: NOW - 11000 },
  { role: 'toolresult', toolCallId: 'read-config', content: '  export const enabled = false;\n', timestamp: NOW - 10000 },
  { role: 'toolresult', toolCallId: 'search-docs', content: 'Found the relevant documentation.', timestamp: NOW - 9000 },
  { role: 'toolresult', toolCallId: 'open-docs', content: 'The reference uses a moving highlight.', timestamp: NOW - 8500 },
  { role: 'toolresult', toolCallId: 'run-check', content: 'CHECK_RESULT: 18 checks passed.\n', timestamp: NOW - 8000 },
  { id: 'activity-progress', role: 'assistant', content: [
    { type: 'text', text: '配置项已经确认。接下来写入说明并修改配置，保留完整操作结果。' },
    CALL('write-note', 'write_file', { path: 'docs/rendering-note.md', content: 'Rendering notes' }),
    CALL('edit-config', 'edit_file', { path: 'src/config.ts', old_string: 'false', new_string: 'true' }),
  ], timestamp: NOW - 7000 },
  { role: 'toolresult', toolCallId: 'write-note', content: 'WRITE_RESULT: rendering notes saved.', timestamp: NOW - 6500 },
  { role: 'toolresult', toolCallId: 'edit-config', content: 'EDIT_RESULT: configuration updated.', timestamp: NOW - 6000 },
  { id: 'activity-final', role: 'assistant', content: '最终答复：配置已更新，检查已完成。', timestamp: NOW - 5000 },
];

async function seed(app: ElectronApplication, history: unknown[], workspace = 'D:/tmp/clawx-output-ui-fixture') {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    gatewayRpcByMethod: { 'sessions.list': { sessions: [{ key: SESSION, sessionId: 'activity-generation', displayName: '输出渲染' }] },
      'chat.history': { messages: history }, '*': {} },
    hostApi: { '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', canonicalSessionKey: SESSION, workspace }], defaultAgentId: 'main' } },
  });
}
async function language(page: Page, value: string) {
  await page.evaluate(async language => {
    await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'language', value: language } });
  }, value);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}
async function boundaries(page: Page) {
  return page.evaluate(() => {
    const transcript = document.querySelector('[data-testid="chat-virtual-history"]')!.getBoundingClientRect();
    const input = document.querySelector('[data-testid="chat-composer-shell"]')!.getBoundingClientRect();
    return { viewportWidth: innerWidth, left: Math.abs(transcript.left - input.left), right: Math.abs(transcript.right - input.right),
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
}
async function iconMotion(root: Locator) {
  return root.locator('.tool-activity-icon').evaluateAll(icons => icons.flatMap(icon =>
    icon.getAnimations({ subtree: true }).filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
      .map(animation => ({ name: animation.animationName, state: animation.playState,
        iterations: String(animation.effect?.getComputedTiming().iterations) })),
  ));
}
async function event(app: ElectronApplication, payload: Record<string, unknown>) {
  await app.evaluate(({ BrowserWindow }, event) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:runtime-event', event);
  }, { sessionKey: SESSION, runId: 'activity-live', ...payload });
}

test('keeps operation groups in conversation order with shared width, accessible details and four locales', async ({ launchElectronApp }, info) => {
  test.setTimeout(180000);
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark', deviceScaleFactor: 1 });
  try {
    await mkdir(info.outputPath('workspace'), { recursive: true });
    await seed(app, HISTORY, info.outputPath('workspace'));
    const page = await getStableWindow(app);
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.setMinimumSize(320, 600);
    });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.reload();
    const groups = page.getByTestId('chat-tool-activity-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).getByTestId('chat-tool-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(groups.nth(1).getByTestId('chat-tool-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    for (const group of await groups.all()) {
      await expect(group.getByTestId('chat-tool-activity-toggle').getByTestId('chat-call-chip')).toHaveCount(0);
      await expect(group.getByTestId('chat-tool-activity-toggle')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await expect(page.getByText('最终答复：配置已更新，检查已完成。', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="chat-tool-activity-group"]')];
      return rows.map(row => row.parentElement?.querySelector('.codex-markdown')?.textContent);
    })).toEqual(expect.arrayContaining([expect.stringContaining('先读取配置'), expect.stringContaining('配置项已经确认')]));
    await page.screenshot({ path: info.outputPath('history-collapsed-dark-1280.png') });
    const measurements: unknown[] = [];
    for (const lang of ['en', 'zh', 'ja', 'ru']) {
      await language(page, lang);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(async theme => {
          await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'settings', action: 'set', payload: { key: 'theme', value: theme } });
        }, theme);
        await page.reload();
        await expect(page.getByText('最终答复：配置已更新，检查已完成。', { exact: true })).toBeVisible();
        await expect(page.getByTestId('chat-page')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(33, 33, 31)' : 'rgb(247, 247, 245)');
        for (const width of [1280, 375]) {
          const nativeSize = await pinWindowContentSize(app, { width, height: 800 });
          expect(nativeSize.width).toBe(width);
          await expect.poll(async () => {
            const settled = await boundaries(page);
            return Math.max(settled.left, settled.right);
          }).toBeLessThan(2);
          const sizes = await boundaries(page);
          expect(sizes.viewportWidth).toBe(width);
          expect(sizes.left).toBeLessThan(2); expect(sizes.right).toBeLessThan(2); expect(sizes.overflow).toBe(false);
          measurements.push({ lang, theme, width, ...sizes });
        }
        if (lang === 'zh' || lang === 'ru') await page.screenshot({ path: info.outputPath(`history-${lang}-${theme}-375.png`) });
      }
    }
    await language(page, 'en');
    await pinWindowContentSize(app, { width: 1280, height: 800 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await groups.nth(0).getByTestId('chat-tool-activity-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(groups.nth(0).getByTestId('chat-tool-activity-details')).toBeVisible();
    await expect(groups.nth(0).locator('[data-testid="chat-tool-activity-step"][data-kind="read"] [data-testid="chat-call-chip"]')).toHaveCount(1);
    for (const kind of ['search', 'web', 'command']) await expect(groups.nth(0).locator(`[data-testid="chat-tool-activity-step"][data-kind="${kind}"] [data-testid="chat-call-chip"]`)).toHaveCount(1);
    await groups.nth(0).getByTestId('chat-execution-step-toggle').nth(0).click();
    await expect(groups.nth(0).getByTestId('chat-execution-step-detail')).toContainText('export const enabled = false;');
    await groups.nth(1).getByTestId('chat-tool-activity-toggle').click();
    await expect(groups.nth(1).locator('[data-testid="chat-tool-activity-step"][data-kind="write"] [data-testid="chat-call-chip"]')).toHaveCount(1);
    await expect(groups.nth(1).locator('[data-testid="chat-tool-activity-step"][data-kind="edit"] [data-testid="chat-call-chip"]')).toHaveCount(1);
    const expandedChip = groups.nth(1).getByTestId('chat-call-chip').first();
    await expect(expandedChip).toHaveAttribute('data-status', 'done');
    const expandedShape = await expandedChip.evaluate(node => {
      const name = node.querySelector<HTMLElement>('.font-medium')!;
      const nameStyle = getComputedStyle(name);
      return { radius: parseFloat(getComputedStyle(node).borderRadius), background: getComputedStyle(node).backgroundColor,
        nameFontSize: parseFloat(nameStyle.fontSize), nameLineHeight: parseFloat(nameStyle.lineHeight) };
    });
    expect(expandedShape.radius).toBeGreaterThan(0); expect(expandedShape.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(expandedShape.nameLineHeight).toBeGreaterThanOrEqual(expandedShape.nameFontSize * 1.3);
    await page.screenshot({ path: info.outputPath('history-expanded-dark-1280.png') });
    const expandedNarrow: unknown[] = [];
    for (const lang of ['en', 'ru']) {
      await language(page, lang);
      await pinWindowContentSize(app, { width: 375, height: 800 });
      const group = groups.nth(1);
      if (await group.getByTestId('chat-tool-activity-toggle').getAttribute('aria-expanded') !== 'true') {
        await group.getByTestId('chat-tool-activity-toggle').click();
      }
      const chip = group.getByTestId('chat-call-chip').first();
      await expect(chip).toBeVisible();
      await expect.poll(() => chip.evaluate(node => {
        const target = node.querySelector<HTMLElement>('.font-mono[title]')!;
        return target.getBoundingClientRect().width;
      })).toBeGreaterThan(40);
      const shape = await chip.evaluate(node => ({ width: node.getBoundingClientRect().width,
        nameWidth: node.querySelector<HTMLElement>('.font-medium')!.getBoundingClientRect().width,
        targetWidth: node.querySelector<HTMLElement>('.font-mono[title]')!.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth > innerWidth }));
      expect(shape.nameWidth).toBeLessThanOrEqual(shape.width * 0.43);
      expect(shape.overflow).toBe(false);
      expandedNarrow.push({ lang, viewportWidth: 375, ...shape });
      await page.screenshot({ path: info.outputPath(`history-expanded-${lang}-dark-375.png`) });
    }
    await language(page, 'en');
    await pinWindowContentSize(app, { width: 1280, height: 800 });
    await page.getByTestId('chat-workspace-toggle').click();
    await expect(page.getByTestId('artifact-panel-aside')).toBeVisible();
    const openPanel = await boundaries(page);
    expect(openPanel.left).toBeLessThan(2); expect(openPanel.right).toBeLessThan(2);
    await page.getByTestId('artifact-panel-close').click();
    await expect(page.getByTestId('artifact-panel-aside')).toBeHidden();
    expect(errors).toEqual([]);
    await writeFile(info.outputPath('history-geometry.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-output-ui', data: 'mocked history; real Electron rendering', measurements, expandedShape, expandedNarrow, openPanel, errors }, null, 2));
  } finally { await closeElectronApp(app); }
});

test('shows the current white shimmer once, preserves folding and settles runtime command output', async ({ launchElectronApp }, info) => {
  test.setTimeout(180000);
  const at = Date.now();
  const history = [
    { id: 'live-user', role: 'user', content: '读取配置后运行检查。', timestamp: at - 5000 },
    { id: 'live-intro', role: 'assistant', content: [{ type: 'text', text: '我会先读取项目配置。' }, CALL('live-read', 'read_file', { path: 'src/config.ts' })], timestamp: at - 4500 },
    { role: 'toolresult', toolCallId: 'live-read', content: 'CONFIG_RESULT\n', timestamp: at - 4000 },
    { id: 'live-progress', role: 'assistant', content: '配置已读取，正在运行检查并观察输出。', timestamp: at - 3500 },
  ];
  const command = 'python -X utf8 D:/project/a-long-path-for-conversation-rendering/checks/run-check.py --focus output';
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark', deviceScaleFactor: 1 });
  try {
    await seed(app, history);
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('配置已读取，正在运行检查并观察输出。', { exact: true })).toBeVisible();
    const liveAt = Date.now();
    await event(app, { type: 'run.started', startedAt: liveAt, ts: liveAt });
    await event(app, { type: 'tool.started', toolCallId: 'live-command', name: 'exec_command', args: { command }, ts: liveAt + 1 });
    await event(app, { type: 'command.output', toolCallId: 'live-command', itemId: 'live-command:output', command, output: 'Collecting checks…\n', phase: 'chunk', status: 'running', ts: liveAt + 2 });
    const groups = page.getByTestId('chat-tool-activity-group');
    await expect(groups).toHaveCount(2);
    const current = groups.nth(1);
    await expect(current).toHaveAttribute('data-status', 'running');
    await expect(current.getByTestId('chat-tool-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(current.getByTestId('chat-call-chip')).toHaveCount(0);
    await expect(current.getByTestId('ai-element-shimmer')).toContainText('python -X utf8');
    await expect(current.getByTestId('chat-tool-activity-text-enter')).toHaveCSS('animation-name', 'tool-activity-text-enter');
    await expect(current.getByTestId('chat-tool-activity-text-enter')).toHaveCSS('animation-iteration-count', '1');
    const entrance = await current.getByTestId('chat-tool-activity-text-enter').evaluate(node => {
      const animation = node.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === 'tool-activity-text-enter');
      const effect = animation?.effect;
      return { keyframes: effect instanceof KeyframeEffect ? effect.getKeyframes().map(frame => frame.clipPath) : [], duration: effect?.getComputedTiming().duration };
    });
    expect(entrance.keyframes?.[0]).toContain('100%');
    expect(entrance.keyframes?.at(-1)).not.toContain('100%');
    const gradient = await current.getByTestId('ai-element-shimmer').evaluate(node => getComputedStyle(node).backgroundImage);
    expect(gradient).toContain('rgb(255, 255, 255)');
    await expect(current.locator('.tool-activity-icon[data-kind="command"]')).toHaveCount(1);
    await expect(current.locator('.tool-activity-icon')).toHaveAttribute('data-animated', 'true');
    const activeMotion = await iconMotion(current);
    expect(activeMotion.map(animation => animation.name)).toEqual(expect.arrayContaining(['tool-activity-icon-cursor', 'tool-activity-icon-prompt']));
    expect(activeMotion.every(animation => animation.state === 'running' && animation.iterations === 'Infinity')).toBe(true);
    expect(await iconMotion(groups.first())).toEqual([]);
    const commandIcon = await current.locator('.tool-activity-icon').elementHandle();
    const commandEntrance = await current.getByTestId('chat-tool-activity-text-enter').elementHandle();
    await event(app, { type: 'command.output', toolCallId: 'live-command', itemId: 'live-command:output', command,
      output: 'Collecting checks…\nRunning focused checks…\n', phase: 'chunk', status: 'running', ts: Date.now() });
    expect(await current.locator('.tool-activity-icon').evaluate((node, previous) => node === previous, commandIcon)).toBe(true);
    expect(await current.getByTestId('chat-tool-activity-text-enter').evaluate((node, previous) => node === previous, commandEntrance)).toBe(true);
    await page.screenshot({ path: info.outputPath('live-shimmer-dark-1280.png') });
    await current.getByTestId('chat-tool-activity-toggle').click();
    await expect(current.getByTestId('chat-tool-activity-toggle').getByTestId('ai-element-shimmer')).toHaveCount(0);
    await expect(current.getByTestId('ai-element-shimmer')).toHaveCount(1);
    await expect(current.locator('.tool-activity-icon[data-animated="true"]')).toHaveCount(0);
    expect(await iconMotion(current)).toEqual([]);
    await current.getByTestId('chat-tool-activity-toggle').hover();
    expect(await iconMotion(current)).toEqual([]);
    await expect(current.getByTestId('chat-tool-activity-toggle').getByTestId('chat-call-chip')).toHaveCount(0);
    await expect(current.getByTestId('chat-run-terminal-toggle').getByTestId('chat-call-chip')).toHaveAttribute('data-status', 'running');
    await expect.poll(() => current.getByTestId('chat-call-chip-progress').evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBeGreaterThan(0);
    await current.getByTestId('chat-run-terminal-toggle').click();
    await expect(current.getByTestId('terminal-output')).toContainText('Collecting checks…');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(current.getByTestId('ai-element-shimmer')).toHaveCSS('animation-name', 'none');
    await expect(current.getByTestId('chat-run-terminal-toggle').getByTestId('chat-call-chip-progress')).toHaveCSS('transition-duration', '0s');
    expect(await iconMotion(current)).toEqual([]);
    await page.screenshot({ path: info.outputPath('live-expanded-reduced-motion.png') });
    await current.getByTestId('chat-tool-activity-toggle').click();
    await expect(current.locator('.tool-activity-icon')).toHaveAttribute('data-animated', 'true');
    expect(await iconMotion(current)).toEqual([]);
    await expect(current.getByTestId('ai-element-shimmer')).toHaveCSS('animation-name', 'none');
    await page.screenshot({ path: info.outputPath('live-collapsed-reduced-motion.png') });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => iconMotion(current)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool-activity-icon-cursor', iterations: 'Infinity' }),
    ]));
    await event(app, { type: 'tool.started', toolCallId: 'latest-search', name: 'web_search', args: { query: '最新查询目标' }, ts: Date.now() });
    await expect(current.getByTestId('chat-tool-activity-label')).toContainText('最新查询目标');
    await expect(current.getByTestId('chat-tool-activity-text-enter')).toHaveAttribute('data-tool-id', 'latest-search');
    await expect(current.locator('.tool-activity-icon[data-icon="search"]')).toHaveCount(1);
    await expect(current.locator('.tool-activity-icon svg')).toHaveCSS('animation-name', 'tool-activity-icon-search');
    await event(app, { type: 'tool.completed', toolCallId: 'latest-search', name: 'web_search', result: 'Search finished.', ts: Date.now() });
    await event(app, { type: 'tool.started', toolCallId: 'latest-web', name: 'web_fetch', args: { url: 'https://example.com/docs' }, ts: Date.now() });
    await expect(current.locator('.tool-activity-icon[data-icon="web"]')).toHaveCount(1);
    expect(await iconMotion(current)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool-activity-icon-globe', iterations: 'Infinity' }),
    ]));
    await event(app, { type: 'tool.completed', toolCallId: 'latest-web', name: 'web_fetch', result: 'Page fetched.', ts: Date.now() });
    await event(app, { type: 'tool.started', toolCallId: 'latest-file', name: 'read_file', args: { path: 'docs/configuration.md' }, ts: Date.now() });
    await expect(current.locator('.tool-activity-icon[data-icon="read"]')).toHaveCount(1);
    expect(await iconMotion(current)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool-activity-icon-line', iterations: 'Infinity' }),
    ]));
    await event(app, { type: 'tool.completed', toolCallId: 'latest-file', name: 'read_file', result: 'File read.', ts: Date.now() });
    await event(app, { type: 'tool.started', toolCallId: 'latest-memory', name: 'memory_search', args: { query: '当前记忆目标' }, ts: Date.now() });
    await expect(current.getByTestId('chat-tool-activity-label')).toContainText('当前记忆目标');
    await expect(current.getByTestId('chat-tool-activity-text-enter')).toHaveAttribute('data-tool-id', 'latest-memory');
    await expect(current.locator('.tool-activity-icon[data-icon="memory"]')).toHaveCount(1);
    await expect(current.locator('.tool-activity-icon svg')).toHaveCSS('animation-name', 'tool-activity-icon-pop');
    const memoryIcon = await current.locator('.tool-activity-icon').elementHandle();
    await event(app, { type: 'tool.completed', toolCallId: 'latest-memory', name: 'memory_search', result: 'Memory lookup finished.', ts: Date.now() });
    await event(app, { type: 'tool.started', toolCallId: 'latest-memory-next', name: 'memory_search', args: { query: '下一记忆目标' }, ts: Date.now() });
    await expect(current.getByTestId('chat-tool-activity-label')).toContainText('下一记忆目标');
    await expect(current.getByTestId('chat-tool-activity-text-enter')).toHaveAttribute('data-tool-id', 'latest-memory-next');
    expect(await current.locator('.tool-activity-icon').evaluate((node, previous) => node === previous, memoryIcon)).toBe(false);
    await event(app, { type: 'tool.completed', toolCallId: 'latest-memory-next', name: 'memory_search', result: 'Next memory lookup finished.', ts: Date.now() });
    await event(app, { type: 'command.output', toolCallId: 'live-command', itemId: 'live-command:output', command,
      output: 'Collecting checks…\n  COMPLETE_RESULT: 18 checks passed.\n', phase: 'end', status: 'completed', exitCode: 0, ts: Date.now() });
    await event(app, { type: 'tool.completed', toolCallId: 'live-command', name: 'exec_command', result: 'COMPLETE_RESULT: 18 checks passed.', ts: Date.now() });
    await seed(app, [...history, { id: 'live-final', role: 'assistant', content: '最终答复：读取和检查均已完成。', timestamp: Date.now() }]);
    await event(app, { type: 'run.ended', status: 'completed', endedAt: Date.now(), ts: Date.now() });
    await expect(current).toHaveAttribute('data-status', 'completed');
    await expect(current.getByTestId('chat-call-chip')).toHaveCount(0);
    await expect(current.getByTestId('chat-tool-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(current.getByTestId('ai-element-shimmer')).toHaveCount(0);
    await expect(current.locator('.tool-activity-icon')).toHaveAttribute('data-animated', 'false');
    await current.getByTestId('chat-tool-activity-toggle').hover();
    expect(await iconMotion(current)).toEqual([]);
    await current.getByTestId('chat-tool-activity-toggle').click();
    await current.getByTestId('chat-run-terminal-toggle').click();
    await expect(current.getByTestId('terminal-output')).toContainText('COMPLETE_RESULT: 18 checks passed.');
    await expect(current.getByTestId('chat-run-terminal')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('completed-command-dark-1280.png') });
    await mkdir(info.outputPath('evidence'), { recursive: true });
    await writeFile(join(info.outputPath('evidence'), 'live.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-output-ui', data: 'agent-generated runtime events; real Electron rendering', gradient, entrance, command, activeMotion,
      iconPolicy: 'current-folded-running-only', expandedIconsStatic: true, reducedMotionIconsStatic: true, settledHoverStatic: true,
      latestTargets: ['最新查询目标', 'https://example.com/docs', 'docs/configuration.md', '当前记忆目标', '下一记忆目标'], chunkKeepsIconAndEntrance: true, sameIconNewCallUpdatesMotion: true, status: 'passed' }, null, 2));
  } finally { await closeElectronApp(app); }
});
