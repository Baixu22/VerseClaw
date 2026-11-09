import { writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page } from '@playwright/test';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { closeElectronApp, expect, getStableWindow, revealSectionHeadingActionsFor, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import {
  addSessionChainChildren, configureSessionChainProvider, createSessionChainProject,
  observeSessionUi, setSessionChainViewport,
} from './fixtures/session-task-chain';

// Agent-driven U2 AC3/AC6 and AC4. Real Main/Gateway/session/transcript owners;
// only provider output/timing is scripted. No renderer store writes or replay events.
const rpc = <T,>(app: ElectronApplication, method: string, params: Record<string, unknown>) =>
  hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
const paint = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
const profile = async (app: ElectronApplication, id: string) => {
  const result = await hostInvoke<{ profiles: WorkspaceProfile[] }>(app, 'workspaces', 'list');
  const found = result.profiles.find(item => item.id === id);
  if (!found) throw new Error('U2 workspace disappeared: ' + id);
  return found;
};
type RunReceipt = { runId: string; status: string; error?: string; endedAt?: number };
async function terminal(app: ElectronApplication, runId: string, expected: 'ok' | 'error') {
  let last: RunReceipt | undefined;
  await expect.poll(async () => {
    last = await rpc<RunReceipt>(app, 'agent.wait', { runId, timeoutMs: 1000 });
    return last.status;
  }, { timeout: 120_000, intervals: [250, 500, 1000], message: 'Actual Gateway run must reach ' + expected }).toBe(expected);
  return last!;
}
async function send(app: ElectronApplication, workspaceId: string, sessionKey: string, message: string) {
  const result = await hostInvoke<{ success: boolean; result?: { runId?: string } }>(app, 'chat', 'sendWithMedia', {
    workspaceId, sessionKey, message, idempotencyKey: message,
  });
  if (!result.success || !result.result?.runId) throw new Error('U2 run was not admitted: ' + JSON.stringify(result));
  return result.result.runId;
}
async function reading(page: Page, wantedKey?: string) {
  return page.getByTestId('chat-scroll-container').evaluate((scroller, key) => {
    const viewport = scroller.getBoundingClientRect();
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-viewport-key]'))
      .map(row => ({ row, box: row.getBoundingClientRect(), marker: row.innerText.match(/U2-READ-\d{2}/)?.[0] }));
    const found = key
      ? rows.find(item => item.row.dataset.viewportKey === key)
      : rows.find(item => item.marker && item.box.top >= viewport.top + 8 && item.box.top < viewport.bottom - 60);
    return {
      top: scroller.scrollTop, height: scroller.clientHeight,
      bottomGap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      key: found?.row.dataset.viewportKey ?? null, marker: found?.marker ?? null,
      offset: found ? found.box.top - viewport.top : null,
      visible: Boolean(found && found.box.bottom > viewport.top && found.box.top < viewport.bottom),
    };
  }, wantedKey);
}

test('U2 restores the visible transcript message, reading offset and both session drafts', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm(() => ({ text: 'U2 reading fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = {
    driven_by: 'agent', actor: 'playwright-u2-reading', provider: 'local-scripted',
    acceptance: ['TF-0658/AC3', 'TF-0658/AC6'], status: 'running',
  };
  try {
    await configureSessionChainProvider(app, llm.port);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'U2 Reading');
    const child = (await addSessionChainChildren(app, project, 0, 1))[0];
    const seeded: unknown[] = [];
    for (let index = 0; index < 28; index++) {
      const marker = 'U2-READ-' + String(index).padStart(2, '0');
      seeded.push(await rpc(app, 'chat.inject', {
        sessionKey: project.sessionKey, label: 'agent-driven U2 transcript',
        message: marker + '\n\n' + Array.from({ length: 5 }, (_, paragraph) =>
          'Reading paragraph ' + (paragraph + 1) + ' for ' + marker + '. ' +
          'This persisted message gives the reader an identifiable place in the original conversation.').join('\n\n'),
      }));
    }
    await rpc(app, 'chat.inject', { sessionKey: child, label: 'agent-driven U2 child', message: 'U2-CHILD-CONTEXT' });
    const history = await rpc(app, 'chat.history', { sessionKey: project.sessionKey, limit: 100, maxChars: 500000 });
    expect(JSON.stringify(history)).toContain('U2-READ-00');
    expect(JSON.stringify(history)).toContain('U2-READ-27');
    const page = await getStableWindow(app);
    await setSessionChainViewport(app, { width: 1280, height: 800 });
    await page.reload();
    await expect(page.getByTestId('session-family-children')).toBeVisible({ timeout: 30_000 });
    const scroller = page.getByTestId('chat-scroll-container');
    await expect(scroller).toBeVisible();
    await page.getByTestId('chat-composer-input').fill('U2 parent draft must survive the reading round trip');
    // Scroll by a real pointer gesture; never set a saved position or change the DOM scrollTop here.
    await scroller.hover();
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.mouse.wheel(0, -450);
      await paint(page);
      const sample = await reading(page);
      if (sample.top > sample.height && sample.bottomGap > sample.height * 1.5 && sample.visible) break;
    }
    await paint(page);
    const before = await reading(page);
    expect(before.visible).toBe(true);
    expect(before.key).toBeTruthy();
    expect(before.top).toBeGreaterThan(before.height);
    expect(before.bottomGap).toBeGreaterThan(before.height);
    evidence.project = project; evidence.child = child; evidence.seedReceipts = seeded; evidence.before = before;
    await page.screenshot({ path: testInfo.outputPath('u2-reading-before.png') });

    await page.getByTestId('session-family-children').selectOption(child);
    await expect(page.getByTestId('chat-scroll-container')).toContainText('U2-CHILD-CONTEXT');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Child 1 draft');
    await page.getByTestId('chat-composer-input').fill('U2 child draft stays separate');
    await expect.poll(async () => (await profile(app, project.workspaceId)).sessionStates?.[project.sessionKey]?.readingPosition?.generation)
      .toBe(project.generation);
    const saved = (await profile(app, project.workspaceId)).sessionStates?.[project.sessionKey];
    evidence.savedWhileInChild = saved;
    expect(saved?.draftInput).toBe('U2 parent draft must survive the reading round trip');
    expect(Math.abs((saved?.readingPosition?.scrollTop ?? -1) - before.top)).toBeLessThanOrEqual(8);

    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U2 parent draft must survive the reading round trip');
    // No click/scroll/focus on the transcript after returning: automatic restoration is the behavior under test.
    await expect.poll(async () => {
      const after = await reading(page, before.key!);
      evidence.after = after;
      return after.visible && after.marker === before.marker && after.offset !== null &&
        Math.abs(after.offset - before.offset!) <= 8 && Math.abs(after.top - before.top) <= 8;
    }, { timeout: 15_000, message: 'Same visible message and offset must survive session navigation (8px rendering tolerance)' }).toBe(true);
    // Also catch a later sticky-bottom/ResizeObserver overwrite after the first matching paint.
    const samples = [];
    for (let index = 0; index < 8; index++) {
      await paint(page);
      const sample = await reading(page, before.key!);
      samples.push(sample);
      expect(sample.visible).toBe(true);
      expect(Math.abs((sample.offset ?? Infinity) - before.offset!)).toBeLessThanOrEqual(8);
      expect(Math.abs(sample.top - before.top)).toBeLessThanOrEqual(8);
    }
    evidence.returnSamples = samples;
    await expect.poll(async () => (await profile(app, project.workspaceId)).sessionStates?.[child]?.draftInput)
      .toBe('U2 child draft stays separate');
    const owner = await rpc<{ session: { sessionId: string } }>(app, 'sessions.describe', { key: project.sessionKey });
    expect(owner.session.sessionId).toBe(project.generation);
    evidence.owner = owner;
    await page.screenshot({ path: testInfo.outputPath('u2-reading-restored.png') });
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await captureUi(name => testInfo.outputPath(name)).catch(error => { evidence.diagnosticError = String(error); });
    evidence.providerLog = llm.log;
    await writeFile(testInfo.outputPath('u2-reading.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

type SidebarSample = { held: string | null; selected: string[]; parentState: string | null; order: string[]; hoverY: number | null; underPointer: string | null };
type SidebarWatch = { samples: SidebarSample[]; events: unknown[]; stop: () => void };
async function watchSidebar(page: Page, parent: string, hover: string, pointer: { x: number; y: number }) {
  await page.evaluate(({ parent, hover, pointer }) => {
    const target = window as unknown as { __u2SidebarWatch?: SidebarWatch };
    const samples: SidebarSample[] = [];
    const events:unknown[]=[];
    const eventTrace=(event:Event)=>{
      const target=event.target as HTMLElement,related=(event as FocusEvent).relatedTarget as HTMLElement|null;
      if(!target?.closest?.('[data-testid="sidebar"]')&&!related?.closest?.('[data-testid="sidebar"]'))return;
      events.push({type:event.type,at:performance.now(),target:target?.getAttribute?.('data-testid')??target?.className,
        related:related?.getAttribute?.('data-testid')??related?.className,x:(event as PointerEvent).clientX,y:(event as PointerEvent).clientY,
        focused:document.hasFocus(),held:target?.closest?.('.ws-tree')?.getAttribute('data-order-held')});
    };
    for(const type of ['pointerover','pointerout','focusin','focusout'])document.addEventListener(type,eventTrace,true);
    const sample = () => {
      const sidebar = document.querySelector('[data-testid="sidebar"]');
      if (!sidebar) return;
      const rows = Array.from(sidebar.querySelectorAll<HTMLElement>('.sidebar-row[data-hook-key]'));
      const row = rows.find(item => item.dataset.hookKey === hover);
      const state = document.querySelector('[data-testid="sidebar-session-status-' + parent + '"]');
      const next: SidebarSample = {
        held:row?.closest('.ws-tree')?.getAttribute('data-order-held')??null,
        selected: rows.filter(item => item.dataset.hookSelected === 'true').map(item => item.dataset.hookKey!),
        parentState: state?.getAttribute('data-state') ?? null,
        order: rows.map(item => item.dataset.hookKey!),
        hoverY: row ? Math.round(row.getBoundingClientRect().top * 10) / 10 : null,
        underPointer: document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('.sidebar-row[data-hook-key]')?.dataset.hookKey ?? null,
      };
      if (JSON.stringify(samples.at(-1)) !== JSON.stringify(next)) samples.push(next);
    };
    sample();
    // Read-only DOM sampling includes transient selection/status/reordering, not only final state.
    const timer = window.setInterval(sample, 50);
    target.__u2SidebarWatch = { samples, events, stop: () => { window.clearInterval(timer); sample();
      for(const type of ['pointerover','pointerout','focusin','focusout'])document.removeEventListener(type,eventTrace,true);
    } };
  }, { parent, hover, pointer });
}
async function stopWatch(page: Page) {
  return page.evaluate(() => {
    const target = window as unknown as { __u2SidebarWatch?: SidebarWatch };
    target.__u2SidebarWatch?.stop();
    const samples = target.__u2SidebarWatch?.samples ?? [];
    if(target.__u2SidebarWatch)(window as unknown as {__u2SidebarEvents?:unknown[]}).__u2SidebarEvents=target.__u2SidebarWatch.events;
    delete target.__u2SidebarWatch;
    return samples;
  });
}

test('U2 background child creation, failure and completion preserve parent selection, own state and hovered rows', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(420_000);
  let releaseSuccess = () => {}, releaseFailure = () => {};
  const successGate = new Promise<void>(resolve => { releaseSuccess = resolve; });
  const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
  let successRequested = 0, failureRequested = 0;
  const llm = await startScriptedLlm(async text => {
    if (text.includes('U2_CHILD_SUCCESS')) {
      successRequested++; await successGate; return { text: 'U2_CHILD_COMPLETED' };
    }
    if (text.includes('U2_CHILD_FAILURE')) {
      failureRequested++; await failureGate;
      // Real provider HTTP failure through the existing harness; Runtime must publish an error receipt.
      // A run still retrying, an abort, or only an error string in normal assistant prose cannot pass.
      throw new Error('U2 deterministic provider failure');
    }
    return { text: 'U2_PARENT_READY' };
  });
  const app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = {
    driven_by: 'agent', actor: 'playwright-u2-background', provider: 'local-scripted',
    fault: 'provider HTTP 500 via scripted endpoint', acceptance: ['TF-0658/AC4'], status: 'running',
  };
  let page: Page | undefined;
  try {
    await configureSessionChainProvider(app, llm.port);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'U2 Background');
    const [failureChild, hoveredChild] = await addSessionChainChildren(app, project, 0, 2);
    await rpc(app, 'chat.inject', { sessionKey: failureChild, message: 'U2 older child', label: 'agent fixture' });
    await rpc(app, 'chat.inject', { sessionKey: hoveredChild, message: 'U2 hovered child', label: 'agent fixture' });
    page = await getStableWindow(app);
    await setSessionChainViewport(app, { width: 1280, height: 800 });
    await page.reload();
    await page.evaluate(()=>{
      const state=window as unknown as {__u2RuntimeEvents:unknown[]};state.__u2RuntimeEvents=[];
      for(const channel of ['chat:runtime-event','gateway:message','gateway:chat-message'])
        window.electron.ipcRenderer.on(channel,(...args:unknown[])=>state.__u2RuntimeEvents.push({channel,args}));
    });
    evidence.parentReceipt=await terminal(app, await send(app, project.workspaceId, project.sessionKey, 'U2_PARENT_BASELINE'), 'ok');
    await expect(page.getByTestId('chat-scroll-container')).toContainText('U2_PARENT_READY', { timeout: 30_000 });
    await page.getByTestId('chat-composer-input').fill('U2 parent draft during background children');

    const organize = page.getByTestId('sidebar-session-organize');
    await revealSectionHeadingActionsFor(organize); await organize.click();
    await page.getByRole('menuitemradio', { name: 'Projects', exact: true }).click();
    await revealSectionHeadingActionsFor(organize); await organize.click();
    await page.getByTestId('sidebar-session-sort-newest').click();
    const disclosure = page.getByTestId('session-family-toggle-' + project.sessionKey);
    await expect(disclosure).toBeVisible();
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
    const parentStatus = page.getByTestId('sidebar-session-status-' + project.sessionKey);
    evidence.parentBeforeChildren=await rpc(app,'sessions.describe',{key:project.sessionKey});
    await expect(parentStatus).toHaveAttribute('data-state', 'completed');
    const hoveredRow = page.getByTestId('sidebar-session-' + hoveredChild);
    await expect(hoveredRow).toBeVisible();
    await hoveredRow.hover();
    const box = await hoveredRow.boundingBox();
    if (!box) throw new Error('U2 hovered child has no visible geometry');
    const pointer = { x: box.x + Math.min(24, box.width / 2), y: box.y + box.height / 2 };
    await page.mouse.move(pointer.x, pointer.y);
    await paint(page);
    await expect(hoveredRow.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ws-tree ")]')).toHaveAttribute('data-order-held','true');
    await watchSidebar(page, project.sessionKey, hoveredChild, pointer);
    await app.evaluate(({BrowserWindow})=>{
      BrowserWindow.getAllWindows().find(window=>!window.isDestroyed())?.blur();
    });
    evidence.windowDeactivation={driven_by:'agent',action:'BrowserWindow.blur',retainsPointerAnchor:true};
    evidence.project = project; evidence.failureChild = failureChild; evidence.hoveredChild = hoveredChild;

    // From this point until stopWatch no click, scroll, reload, or pointer relocation is permitted.
    const successChild = (await addSessionChainChildren(app, project, 2, 3))[0];
    evidence.successChild = successChild;
    const childOwner = await rpc<{ session: { parentSessionKey?: string; sessionId: string } }>(app, 'sessions.describe', { key: successChild });
    expect(childOwner.session.parentSessionKey).toBe(project.sessionKey);
    evidence.newChildOwner = childOwner;
    // Existing rows keep their geometry during pointer/keyboard interaction.
    // New membership is published on leaving the list; owner execution continues.
    await expect(disclosure).toContainText('3');
    const successRun = await send(app, project.workspaceId, successChild, 'U2_CHILD_SUCCESS');
    await expect.poll(() => successRequested).toBeGreaterThan(0);
    releaseSuccess();
    evidence.successReceipt = await terminal(app, successRun, 'ok');

    const failedRun = await send(app, project.workspaceId, failureChild, 'U2_CHILD_FAILURE');
    await expect.poll(() => failureRequested).toBeGreaterThan(0);
    await expect(page.getByTestId('sidebar-session-status-' + failureChild)).toHaveAttribute('data-state', 'running');
    releaseFailure();
    evidence.failureReceipt = await terminal(app, failedRun, 'error');
    await expect(page.getByTestId('sidebar-session-status-' + failureChild)).toHaveAttribute('data-state', 'error');
    const parentOwner = await rpc<{ session: { sessionId: string; hasActiveRun: boolean } }>(app, 'sessions.describe', { key: project.sessionKey });
    expect(parentOwner.session).toMatchObject({ sessionId: project.generation, hasActiveRun: false });
    evidence.parentOwner = parentOwner;
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U2 parent draft during background children');
    await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
    await expect(page.getByTestId('chat-scroll-container')).toContainText('U2_PARENT_READY');
    await expect(page.getByTestId('chat-scroll-container')).not.toContainText('U2_CHILD_COMPLETED');
    await paint(page);
    const samples = await stopWatch(page);
    evidence.sidebarSamples = samples;
    expect(samples.length).toBeGreaterThan(0);
    const baseline = samples[0];
    const originalKeys = new Set(baseline.order);
    for (const sample of samples) {
      expect(sample.held, 'Pointer interaction must keep the list order held').toBe('true');
      expect(sample.selected, 'Background lifecycle must not change the selected logical session').toEqual([project.sessionKey]);
      expect(sample.parentState, 'Parent own run state must not aggregate child status').toBe('completed');
      // Existing rows retain order and the pointer anchor while new membership waits for pointer leave.
      expect(sample.order.filter(key => originalKeys.has(key)), 'Existing hovered list order changed').toEqual(baseline.order);
      expect(sample.hoverY).not.toBeNull();
      expect(Math.abs(sample.hoverY! - baseline.hoverY!)).toBeLessThanOrEqual(2);
      expect(sample.underPointer, 'The stationary pointer must remain over the same row').toBe(hoveredChild);
    }
    await page.getByTestId('chat-composer-input').click();
    await expect(page.getByTestId('sidebar-session-' + successChild)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sidebar-session-status-' + successChild)).toHaveAttribute('data-state', 'completed');
    await page.screenshot({ path: testInfo.outputPath('u2-background-terminal.png') });
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    releaseSuccess(); releaseFailure();
    if (page) {
      evidence.runtimeEvents=await page.evaluate(()=>(window as unknown as {__u2RuntimeEvents?:unknown[]}).__u2RuntimeEvents).catch(()=>null);
      const remaining = await stopWatch(page).catch(() => []);
      if (remaining.length) evidence.sidebarSamples = remaining;
      evidence.pointerEvents=await page.evaluate(()=>(window as unknown as {__u2SidebarEvents?:unknown[]}).__u2SidebarEvents).catch(()=>null);
    }
    evidence.providerLog = llm.log; evidence.providerAnomalies = llm.anomalies;
    evidence.providerRequests = { successRequested, failureRequested };
    await captureUi(name => testInfo.outputPath(name)).catch(error => { evidence.diagnosticError = String(error); });
    await writeFile(testInfo.outputPath('u2-background.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
