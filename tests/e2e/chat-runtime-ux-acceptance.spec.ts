import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION = 'agent:main:main';
const workspace = { id: 'ux-acceptance', name: 'UI workspace', rootPath: 'D:/tmp/ux-acceptance', agentId: 'main', selectedAgentId: 'main',
  activeSessionKey: SESSION, agentBindings: { main: { workspaceId: 'ux-acceptance', agentId: 'main', sessionKey: SESSION } },
  permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, state: {}, sessionStates: { [SESSION]: {} } };
const key = (module: string, action: string) => JSON.stringify([module, action, null]);
const fence = (value: unknown) => '```tool-ui\n' + JSON.stringify(value) + '\n```';
const at = Date.now();
const history = Array.from({ length: 12 }, (_, i) => ({ id: `history-${i}`, role: i % 2 ? 'assistant' : 'user',
  content: `${i % 2 ? 'Review result' : 'Review request'} ${i + 1}. ` + 'Keep the conversation readable while decisions remain beside the composer. '.repeat(3), timestamp: at / 1000 - 100 + i }));

async function seed(app: ElectronApplication, messages: unknown[], extra: Record<string, unknown> = {}, profile = workspace, realPermissions = false, statusSessions: Array<Record<string, unknown>> = []) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    gatewayRpcByMethod: {
      'sessions.list': { sessions: [{ key: SESSION, sessionId: 'ux-generation', displayName: 'UI acceptance', updatedAt: at }, ...statusSessions] },
      'chat.history': { messages },
    },
    hostApi: {
      [key('sessions', 'history')]: { success: true, messages, hasMore: false },
      [key('agents', 'list')]: { agents: [{ id: 'main', name: 'Main', workspace: workspace.rootPath }], defaultAgentId: 'main' },
      [key('workspaces', 'list')]: { profiles: [profile], activeWorkspaceId: profile.id, activeWorkspace: profile },
      [key('workspaces', 'getActive')]: { activeWorkspace: profile, activeWorkspaceId: profile.id, success: true },
      [key('workspaces', 'listSessionFolders')]: { folders: [], assignments: {} },
      [key('git', 'status')]: { success: true, status: { isRepository: false, changes: [], clean: true } },
      [key('taskLedger', 'sessionTask')]: { success: true, task: null, children: [] },
      ...(realPermissions ? {} : { [key('permissions', 'approvals')]: { approvals: [] } }),
      [key('runtimeApprovals', 'list')]: { pending: [] },
      [key('providers', 'accounts')]: [{ id: 'ux-provider', vendorId: 'openai', label: 'Local IPC fixture', authMode: 'oauth_browser', enabled: true }],
      [key('providers', 'accountKeyInfo')]: [],
      [key('providers', 'vendors')]: [],
      [key('providers', 'getDefaultAccount')]: { accountId: 'ux-provider' },
      [key('chat', 'sendWithMedia')]: { success: true, result: { runId: 'ux-answer', source: 'mock', message: { content: [{ type: 'text', text: 'Your response has been received.' }] } } },
      ...extra,
    },
  });
}

test('success and error use matching outline bounds in session rows and activity', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    const sessions = [
      { key: 'agent:main:finished', displayName: 'Completed review', status: 'completed', updatedAt: at },
      { key: 'agent:main:failed', displayName: 'Failed verification', status: 'error', updatedAt: at },
      { key: 'agent:main:running', displayName: 'Running build', status: 'running', hasActiveRun: true, updatedAt: at },
    ];
    await seed(app, history, {}, { ...workspace, sessionStates: { ...workspace.sessionStates, ...Object.fromEntries(sessions.map(session => [session.key, {}])) } }, false, sessions);
    const page = await getStableWindow(app); await page.reload();
    const success = page.getByTestId('sidebar-session-status-agent:main:finished');
    const error = page.getByTestId('sidebar-session-status-agent:main:failed');
    await expect(success).toBeVisible(); await expect(error).toBeVisible();
    await expect(success.locator('svg.lucide-circle-check')).toHaveCount(1);
    await expect(error.locator('svg.lucide-circle-x')).toHaveCount(1);
    const bounds = await Promise.all([success.locator('svg').boundingBox(), error.locator('svg').boundingBox(), page.getByTestId('sidebar-session-status-agent:main:running').locator('canvas').boundingBox()]);
    expect(bounds[0]!.width).toBeCloseTo(bounds[1]!.width, 0);
    expect(bounds[0]!.height).toBeCloseTo(bounds[1]!.height, 0);
    expect(bounds[2]!.width).toBeCloseTo(bounds[0]!.width, 0);
    for (const theme of ['light', 'dark'] as const) {
      await layout(page, 1280, 800, theme);
      await page.screenshot({path:testInfo.outputPath(`session-states-${theme}.png`)});
    }
    await testInfo.attach('status-bounds', {body:JSON.stringify({driven_by:'agent',bounds}),contentType:'application/json'});
  } finally { await closeElectronApp(app); }
});

test('real host command gate persists approve and deny decisions selected in the composer', async ({ launchElectronApp }, testInfo) => {
  const root = testInfo.outputPath('permission-workspace');
  await mkdir(root, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    const page = await getStableWindow(app);
    const created = await page.evaluate(async (rootPath) => {
      const api = (window as unknown as { verseClaw: { hostInvoke: (request: unknown) => Promise<{ok:boolean;data:unknown}> } }).verseClaw;
      return api.hostInvoke({ id: crypto.randomUUID(), module: 'workspaces', action: 'create', payload: { name: 'Permission UX', rootPath, agentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'acceptEdits' } });
    }, root);
    expect(created.ok).toBe(true);
    const profile = (created.data as { activeWorkspace: typeof workspace }).activeWorkspace;
    expect(profile.permissionMode).toBe('acceptEdits');
    const request = async (command: string) => page.evaluate(async (command) => {
      const api = (window as unknown as { verseClaw: { hostInvoke: (request: unknown) => Promise<{ok:boolean;data:{approvalRequired:boolean;approval:{id:string}}}> } }).verseClaw;
      return api.hostInvoke({ id: crypto.randomUUID(), module: 'terminal', action: 'run', payload: { command, timeoutMs: 1000 } });
    }, command);
    const denied = await request('curl --version');
    expect(denied.ok).toBe(true); expect(denied.data.approvalRequired).toBe(true);
    await seed(app, history, {}, profile, true);
    await page.reload();
    const card = page.getByTestId('chat-run-pending-approvals');
    await expect(card).toBeVisible();
    const permissionButtons = await Promise.all([
      card.getByRole('button', { name: 'Deny', exact: true }).boundingBox(),
      card.getByRole('button', { name: 'Approve', exact: true }).boundingBox(),
    ]);
    expect(Math.abs(permissionButtons[0]!.y - permissionButtons[1]!.y)).toBeLessThan(2);
    expect(permissionButtons[0]!.x).toBeLessThan(permissionButtons[1]!.x);
    await card.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(card).toHaveCount(0);
    const approved = await request('curl --help');
    expect(approved.data.approvalRequired).toBe(true);
    await page.reload();
    await expect(card).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await layout(page, 1280, 800, theme);
      await page.screenshot({ path: testInfo.outputPath(`real-host-approval-${theme}.png`) });
    }
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card).toHaveCount(0);
    const storePath = await app.evaluate(({ app }) => app.getPath('userData') + '/workspace-permissions.json');
    const store = JSON.parse(await readFile(storePath, 'utf8')) as { approvals: Array<{id:string;status:string}> };
    expect(store.approvals.find(item => item.id === denied.data.approval.id)?.status).toBe('denied');
    expect(store.approvals.find(item => item.id === approved.data.approval.id)?.status).toBe('approved');
    await testInfo.attach('real-host-permission-receipt', { body: JSON.stringify({ driven_by: 'agent', source: 'real Electron terminal/permissions services and persisted store',
      requestIds: [denied.data.approval.id, approved.data.approval.id], approvals: store.approvals }), contentType: 'application/json' });
  } finally { await closeElectronApp(app); }
});

async function layout(page: Page, width: number, height: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height });
  await page.evaluate((theme) => { document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.classList.toggle('light', theme === 'light'); }, theme);
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
  });
}

test('options preferences and model confirmations use the same decision surface', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    const requests = [
      { type: 'option-list', id: 'surface-options', title: 'Select a workspace', selectionMode: 'single', options: [{id:'current',label:'Current workspace'},{id:'new',label:'New workspace'}] },
      { type: 'preferences-panel', id: 'surface-preferences', title: 'Review preferences', sections: [{heading:'Verification',items:[{id:'tests',type:'switch',label:'Run regression tests',defaultChecked:true},{id:'depth',type:'toggle',label:'Review depth',options:[{value:'focused',label:'Focused'},{value:'complete',label:'Complete'}]}]}] },
      { type: 'approval-card', id: 'surface-confirmation', title: 'Continue with this review?', description: 'Use the selected workspace and verification preferences.', confirmLabel:'Continue', cancelLabel:'Cancel' },
    ];
    await seed(app, [...history, {id:'surface-requests',role:'assistant',content:requests.map(fence).join('\n'),timestamp:at/1000}]);
    const page=await getStableWindow(app); await page.reload();
    const dock=page.getByTestId('chat-composer-requests');
    const bounds=[];
    for (const [index, type] of ['option-list','preferences-panel','approval'].entries()) {
      await expect(dock).toBeVisible(); await expect(page.getByTestId('chat-composer-input')).toBeHidden();
      await expect(page.getByTestId(`chat-tool-ui-${type}`)).toBeVisible();
      await layout(page,1280,800,'dark');
      bounds.push(await dock.evaluate(el=>({width:el.getBoundingClientRect().width,radius:getComputedStyle(el).borderRadius,background:getComputedStyle(el).backgroundColor})));
      if(index===0) {
        const option = dock.getByTestId('chat-tool-ui-option-current');
        await option.focus();
        await page.keyboard.press('Space');
        await expect(option).toHaveAttribute('aria-selected', 'true');
      }
      if(index===1)await dock.getByRole('button',{name:'Complete',exact:true}).click();
      await layout(page,1280,800,'dark');
      await page.screenshot({path:testInfo.outputPath(`surface-${type}-dark.png`)});
      if(index<2)await dock.getByTestId('chat-tool-ui-action-send').click();
      else await dock.getByRole('button',{name:'Continue',exact:true}).click();
    }
    expect(bounds[0]).toEqual(bounds[1]); expect(bounds[1]).toEqual(bounds[2]);
    await expect(dock).toHaveCount(0); await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await testInfo.attach('shared-surface-style',{body:JSON.stringify({driven_by:'agent',bounds}),contentType:'application/json'});
  } finally { await closeElectronApp(app); }
});

test('irreversible permissions keep restrained danger accents and readable controls in both themes', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    await seed(app, history, { [key('permissions', 'approvals')]: { approvals: [{
      id: 'visual-external-write', workspaceId: workspace.id, sessionKey: SESSION, mode: 'acceptEdits',
      source: 'terminal', risk: 'external-write', status: 'pending', requestedAt: at,
    }] } });
    const page = await getStableWindow(app); await page.reload();
    const dock = page.getByTestId('chat-composer-requests');
    await expect(dock).toHaveAttribute('data-decision-tone', 'danger');
    const approve = dock.getByRole('button', { name: 'Approve', exact: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const contrasts = [];
    for (const theme of ['light', 'dark'] as const) {
      for (const width of [1280, 375]) {
        await layout(page, width, 800, theme);
        await expect(approve).toBeInViewport();
        expect(await dock.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        for (const hovered of [false, true]) {
          await (hovered ? approve : dock.locator('.composer-decision-title')).hover();
          const controls = await dock.locator('.composer-decision-actions button').evaluateAll(buttons => buttons.map(button => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d', { willReadFrequently: true })!;
            context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1);
            const ancestors = [];
            for (let node: Element | null = button; node; node = node.parentElement) ancestors.unshift(node);
            for (const node of ancestors) { context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1); }
            const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
            context.fillStyle = getComputedStyle(button).color; context.fillRect(0, 0, 1, 1);
            const color = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
            const luminance = (rgb: number[]) => rgb.map(channel => channel / 255)
              .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
              .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
            const a = luminance(color), b = luminance(background);
            return { text: button.textContent, color, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          }));
          for (const control of controls) expect(control.ratio).toBeGreaterThanOrEqual(4.5);
          contrasts.push({ theme, width, hovered, controls });
        }
        await page.screenshot({ path: testInfo.outputPath(`danger-${theme}-${width}.png`) });
      }
    }
    await testInfo.attach('danger-control-contrast', { body: JSON.stringify({ driven_by: 'agent', contrasts }), contentType: 'application/json' });
    await expect(approve).toHaveCSS('transition-duration', '0s');
    await approve.focus();
    await page.keyboard.press('Escape');
    await expect(dock).toBeVisible();
    const calls = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module: string; action: string }> }).__verseClawE2eHostCalls ?? []);
    expect(calls.filter(call => call.module === 'permissions' && call.action === 'decideApproval')).toEqual([]);
  } finally { await closeElectronApp(app); }
});

test('reasoning retains every line and folded process leaves no empty transcript gap', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    const thoughts = Array.from({ length: 18 }, (_, i) => ({ type: 'thinking', thinking: `Reasoning step ${i + 1}: ` + 'Inspect the source, confirm the interaction and record the result. '.repeat(3) }));
    const messages = [
      { id: 'reasoning-user', role: 'user', content: 'Review the output hierarchy', timestamp: at / 1000 },
      { id: 'reasoning-work', role: 'assistant', content: [...thoughts, { type: 'tool_use', id: 'terminal-1', name: 'exec', input: { command: 'node --test' } }], timestamp: at / 1000 + 1 },
      { id: 'reasoning-tool-result', role: 'toolResult', toolCallId: 'terminal-1', toolName: 'exec', content: 'All tests passed', timestamp: at / 1000 + 2 },
      { id: 'reasoning-answer', role: 'assistant', content: '### Review complete\n\nThe complete answer remains adjacent to the process disclosure.', timestamp: at / 1000 + 3 },
    ];
    await seed(app, messages);
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('Review complete', { exact: true })).toBeVisible();
    const process = page.getByTestId('chat-turn-summary-toggle');
    await expect(process).toHaveCount(1);
    if (await process.getAttribute('aria-expanded') !== 'true') await process.click();
    await expect(process).toHaveAttribute('aria-expanded', 'true');
    const reasoning = page.getByTestId('assistant-reasoning-panel');
    await reasoning.getByRole('button').click();
    const paragraphs = reasoning.locator('p');
    await expect(paragraphs).toHaveCount(18);
    const measurements = await paragraphs.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { y:r.y, h:r.height, lh:parseFloat(getComputedStyle(node).lineHeight), clamp:getComputedStyle(node).webkitLineClamp }; }));
    for (let i = 0; i < measurements.length; i++) {
      expect(measurements[i].h).toBeGreaterThanOrEqual(measurements[i].lh * 2);
      expect(measurements[i].clamp).toBe('none');
      if (i) expect(measurements[i].y).toBeGreaterThanOrEqual(measurements[i - 1].y + measurements[i - 1].h);
    }
    for (const theme of ['light', 'dark'] as const) {
      await layout(page, 1280, 800, theme);
      await page.screenshot({ path: testInfo.outputPath(`process-${theme}.png`) });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await process.click();
    await expect(page.getByTestId('chat-turn-summary-details')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-viewport-key]')].filter(el => el.getBoundingClientRect().height > 0);
      return Math.max(...rows.slice(1).map((row, i) => row.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom));
    })).toBeLessThan(45);
    await page.screenshot({ path: testInfo.outputPath('process-collapsed.png') });
    await testInfo.attach('reasoning-geometry', { body: JSON.stringify({ driven_by: 'agent', measurements }), contentType: 'application/json' });
  } finally { await closeElectronApp(app); }
});

test('plan and questions stay at the composer, submit once, preserve drafts and survive scroll', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    const plan = { type: 'plan', id: 'plan-proposal', title: 'Review the conversation', requiresApproval: true,
      todos: [{ id: 'read', label: 'Read the current implementation', status: 'pending' }, { id: 'verify', label: 'Verify the user journey', status: 'pending' }] };
    const question = { type: 'question-flow', id: 'question-request', steps: [
      { id: 'scope', title: 'Choose a review scope', options: [{ id: 'chat', label: 'Conversation' }, { id: 'all', label: 'Whole app' }] },
      { id: 'theme', title: 'Choose a theme', options: [{ id: 'both', label: 'Light and dark' }, { id: 'dark', label: 'Dark' }] },
    ] };
    await seed(app, [...history, { id: 'requests', role: 'assistant', content: fence(plan) + '\n' + fence(question), timestamp: at / 1000 }],
      { [key('runtimeApprovals', 'resolve')]: { success: true } },
      { ...workspace, sessionStates: { [SESSION]: { draftInput: 'Preserve my draft' } } });
    const page = await getStableWindow(app);
    await page.reload();
    const dock = page.getByTestId('chat-composer-requests');
    await expect(dock.getByTestId('chat-plan-approve')).toBeVisible();
    await expect(page.getByTestId('chat-scroll-container').getByTestId('chat-plan-proposal')).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toBeHidden();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Preserve my draft');
    await expect(dock).toHaveClass(/codex-composer-shell/);
    for (const theme of ['light', 'dark'] as const) {
      await layout(page, 1280, 800, theme);
      const y = (await dock.boundingBox())!.y;
      await page.getByTestId('chat-scroll-container').evaluate(el => el.scrollTo({ top: 0 }));
      expect((await dock.boundingBox())!.y).toBeCloseTo(y, 0);
      await page.screenshot({ path: testInfo.outputPath(`plan-${theme}.png`) });
    }
    await dock.getByTestId('chat-plan-approve').click();
    const questionView = dock.getByTestId('chat-tool-ui-question-flow');
    await expect(questionView).toBeVisible();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Preserve my draft');
    await expect(page.getByTestId('chat-tool-ui-question-flow')).toHaveCount(1);
    await questionView.getByTestId('chat-tool-ui-question-option-chat').click();
    await app.evaluate(({ BrowserWindow }, sessionKey) => {
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-approvals:requested', {
        approvalId: 'priority-exec', command: 'node --test', cwd: 'D:/workspace', agentId: 'main', sessionKey,
        allowedDecisions: ['allow-once', 'deny'], createdAtMs: Date.now(), expiresAtMs: Date.now() + 60000,
      });
    }, SESSION);
    const priority = page.getByTestId('runtime-approval-prompt');
    await expect(priority).toBeVisible();
    await expect(dock).toBeHidden();
    await expect(page.getByTestId('chat-composer-input')).toBeHidden();
    await expect(priority).toHaveClass(/codex-composer-shell/);
    await page.screenshot({ path: testInfo.outputPath('runtime-priority-dark.png') });
    await priority.getByTestId('runtime-approval-deny').click();
    await expect(questionView).toBeVisible();
    await expect(questionView.getByTestId('chat-tool-ui-question-option-chat')).toHaveAttribute('aria-pressed', 'true');
    await questionView.getByTestId('chat-tool-ui-question-next').click();
    await questionView.getByTestId('chat-tool-ui-question-back').click();
    await expect(questionView.getByTestId('chat-tool-ui-question-option-chat')).toHaveAttribute('aria-pressed', 'true');
    await questionView.getByTestId('chat-tool-ui-question-next').click();
    const both = questionView.getByTestId('chat-tool-ui-question-option-both');
    await both.focus();
    await page.keyboard.press('Space');
    await expect(both).toHaveAttribute('aria-pressed', 'true');
    await expect(both.locator('.composer-decision-choice svg')).toHaveCSS('opacity', '1');
    await layout(page, 1280, 800, 'dark');
    await page.screenshot({ path: testInfo.outputPath('question-keyboard-dark.png') });
    await questionView.getByRole('heading', { name: 'Choose a theme', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('question-dark.png') });
    await questionView.getByTestId('chat-tool-ui-question-option-dark').hover();
    await page.screenshot({ path: testInfo.outputPath('question-hover-dark.png') });
    await layout(page, 1280, 800, 'light');
    await page.screenshot({ path: testInfo.outputPath('question-light.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(both).toHaveCSS('transition-duration', '0s');
    for (const width of [640, 375]) {
      await layout(page, width, 800, 'light');
      await expect(questionView.getByTestId('chat-tool-ui-action-send')).toBeInViewport();
      const bounds = await page.evaluate(() => ({ w: innerWidth, document: document.documentElement.scrollWidth, dock: document.querySelector('[data-testid="chat-composer-requests"]')!.getBoundingClientRect().toJSON() }));
      expect(bounds.document).toBeLessThanOrEqual(bounds.w + 1);
      expect(bounds.dock.bottom).toBeLessThan(800);
      await page.screenshot({ path: testInfo.outputPath(`question-${width}.png`) });
    }
    await questionView.getByTestId('chat-tool-ui-action-send').click();
    await expect(dock).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Preserve my draft');
    const calls = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls: Array<{module:string;action:string;payload:Record<string,unknown>}> }).__verseClawE2eHostCalls.filter(c => c.module === 'chat' && c.action === 'sendWithMedia'));
    expect(calls).toHaveLength(2);
    expect(calls.map(c => JSON.parse(String(c.payload.message).split('\n').slice(1).join('\n')).id)).toEqual(['plan-proposal', 'question-request']);
    await testInfo.attach('request-receipts', { body: JSON.stringify({ driven_by: 'agent', transport: 'Electron IPC fixture', calls }), contentType: 'application/json' });
  } finally { await closeElectronApp(app); }
});

test('host approval stays visible across turns and retains retry state and request identity', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true });
  try {
    const approval = { id: 'ux-permission-1', workspaceId: workspace.id, sessionKey: SESSION, runId: 'older-run',
      source: 'terminal', risk: 'dangerous', status: 'pending', command: 'node --test', cwd: workspace.rootPath, reason: 'Run local verification', requestedAt: at };
    const overrides = { [key('permissions', 'approvals')]: { approvals: [approval] },
      [key('permissions', 'decideApproval')]: { __delayMs: 250, result: { success: false, error: 'Temporary permission service failure' } } };
    await seed(app, history, overrides, { ...workspace, sessionStates: { [SESSION]: { draftInput: 'Continue the review' } } });
    const page = await getStableWindow(app); await page.reload();
    const card = page.getByTestId('chat-run-pending-approvals');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('chat-composer-slot').getByTestId('chat-run-pending-approvals')).toHaveCount(1);
    await expect(page.getByTestId('chat-composer-input')).toBeHidden();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Continue the review');
    await page.getByTestId('chat-scroll-container').evaluate(el => el.scrollTo({top:0}));
    await expect(card).toBeInViewport();
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
    await expect(card.getByRole('alert')).toHaveText('Temporary permission service failure');
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('permission-retry.png') });
    await seed(app, history, { ...overrides, [key('permissions', 'approvals')]: { approvals: [] }, [key('permissions', 'decideApproval')]: { success: true } });
    await card.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Continue the review');
    const calls = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls: Array<{module:string;action:string;payload:unknown}> }).__verseClawE2eHostCalls.filter(c => c.module === 'permissions' && c.action === 'decideApproval'));
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ id: 'ux-permission-1', decision: 'denied' });
    await testInfo.attach('permission-receipt', { body: JSON.stringify({ driven_by: 'agent', transport: 'Electron IPC fixture', calls }), contentType: 'application/json' });
  } finally { await closeElectronApp(app); }
});
