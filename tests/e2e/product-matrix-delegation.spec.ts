import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import type { SessionActivitySnapshot } from '../../shared/types/session-activity';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';

type History = { messages?: Array<{ role?: string; content?: string | Array<{ text?: string }> }> };
function assistantTexts(history: History) {
  return (history.messages ?? []).filter(message => message.role === 'assistant').map(message =>
    typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part.text ?? '').join(''));
}

test('a completed child resumes its idle parent with the actual result exactly once', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const marker = randomUUID().replaceAll('-', '');
  const finalText = `PARENT-CONSUMED:${marker}`;
  const target = testInfo.outputPath('workspace', 'child.txt');
  let started = false, spawned = false, wrote = false, childHolding = false;
  let releaseChild = () => {};
  const childMayFinish = new Promise<void>(resolve => { releaseChild = resolve; });
  const continuationRequests: Array<{ requestIndex: number; messages: unknown }> = [];
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-product-matrix-delegation',
    provider: 'local-scripted-model', marker, status: 'running' };
  const llm = await startScriptedLlm(async (text, _results, requestIndex, request) => {
    if (text.includes('MATRIX-PARENT-START') && JSON.stringify(request.messages).includes(marker)) {
      continuationRequests.push({ requestIndex, messages: request.messages });
      return { text: finalText };
    }
    if (text.includes('MATRIX-PARENT-START')) {
      if (!started) {
        started = true;
        return { toolCall: { id: 'matrix-parent-task', name: 'task_control', args: { action: 'start', requestId: 'matrix-parent-task',
          contract: { objective: 'Read the delegated child result', target: 'child.txt', constraints: ['Wait for the child result'],
            acceptance: [{ id: 'child-artifact', description: 'Exact child output', verification: { kind: 'file-sha256', path: 'child.txt',
              sha256: createHash('sha256').update(`${marker}\n`).digest('hex') } }] } } } };
      }
      if (!spawned) {
        spawned = true;
        return { toolCall: { id: 'matrix-parent-spawn', name: 'sessions_spawn', args: {
          task: 'MATRIX-CHILD-WORK: write the assigned artifact, then report its opaque result.', mode: 'run', cleanup: 'keep',
        } } };
      }
      return { text: 'MATRIX-PARENT-WAITING' };
    }
    if (text.includes('MATRIX-CHILD-WORK')) {
      if (!wrote) {
        wrote = true;
        return { toolCall: { id: 'matrix-child-write', name: 'write', args: { path: target, content: `${marker}\n` } } };
      }
      childHolding = true;
      await childMayFinish;
      return { text: `CHILD-RESULT:${marker}` };
    }
    return { text: 'Ready' };
  });
  let app: ElectronApplication | undefined;
  let captureUi: Awaited<ReturnType<typeof observeSessionUi>> | undefined;
  let cleanupError: unknown;
  try {
    app = await launchElectronApp({ skipSetup: true });
    const runningApp = app;
    captureUi = await observeSessionUi(app);
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Matrix delegation');
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(runningApp, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
    evidence.project = project;
    const page = await getStableWindow(app);
    await page.reload();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await page.getByTestId('chat-composer-input').fill('MATRIX-PARENT-START: delegate the assigned artifact and report the child result when it is delivered.');
    await page.getByTestId('chat-composer-send').click();
    await expect.poll(() => childHolding, { timeout: 90_000 }).toBe(true);
    await expect.poll(async () => assistantTexts(await rpc<History>('chat.history', { sessionKey: project.sessionKey, limit: 100 })), { timeout: 60_000 }).toContain('MATRIX-PARENT-WAITING');
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: project.sessionKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
    expect(continuationRequests).toHaveLength(0);
    expect(await readFile(target, 'utf8')).toBe(`${marker}\n`);
    const sessions = await rpc<{ sessions: Array<{ key: string; spawnedBy?: string }> }>('sessions.list', {});
    const children = sessions.sessions.filter(session => session.spawnedBy === project.sessionKey);
    expect(children).toHaveLength(1);
    const childKey = children[0].key;
    evidence.parentBeforeCompletion = await rpc<History>('chat.history', { sessionKey: project.sessionKey, limit: 100 });
    releaseChild();
    await expect.poll(async () => assistantTexts(await rpc<History>('chat.history', { sessionKey: project.sessionKey, limit: 100 })), { timeout: 90_000 }).toContain(finalText);
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: project.sessionKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
    const parentHistory = await rpc<History>('chat.history', { sessionKey: project.sessionKey, limit: 100 });
    const childHistory = await rpc<History>('chat.history', { sessionKey: childKey, limit: 100 });
    expect(assistantTexts(childHistory)).toContain(`CHILD-RESULT:${marker}`);
    expect(assistantTexts(parentHistory).filter(text => text === finalText)).toHaveLength(1);
    expect(continuationRequests).toHaveLength(1);
    expect(llm.log.filter(request => request.issued === 'matrix-child-write')).toHaveLength(1);
    expect(await readFile(target, 'utf8')).toBe(`${marker}\n`);
    const activity = await hostInvoke<{ snapshot: SessionActivitySnapshot }>(app, 'sessionActivity', 'snapshot', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey,
    });
    expect(activity.snapshot.subagents.find(child => child.childSessionKey === childKey)?.status).toMatch(/^(completed|verified)$/);
    await expect(page.locator('body')).toContainText(finalText, { timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('parent-continuation.png') });
    evidence.child = { childKey, history: childHistory };
    evidence.parentAfterCompletion = parentHistory;
    evidence.activity = activity;
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error); throw error;
  } finally {
    releaseChild();
    try {
      if (captureUi) await captureUi(name => testInfo.outputPath(name));
      if (app) {
        try { await hostInvoke(app, 'gateway', 'stop'); }
        finally { await closeElectronApp(app); }
      }
    } catch (error) {
      cleanupError = error; evidence.status = 'failed'; evidence.cleanupError = String(error);
    } finally {
      llm.server.closeAllConnections();
      await new Promise<void>(resolve => llm.server.close(() => resolve()));
      evidence.providerLog = llm.log; evidence.providerAnomalies = llm.anomalies; evidence.continuationRequests = continuationRequests;
      await writeFile(testInfo.outputPath('delegation-result.json'), JSON.stringify(evidence, null, 2) + '\n');
    }
  }
  if (cleanupError) throw cleanupError;
});
