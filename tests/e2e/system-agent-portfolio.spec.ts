import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, pinWindowContentSize, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import type { TaskLedgerSnapshotResult, WorkspaceCoordinatorBindingResult } from '../../shared/host-api/contract';
import type { SystemPortfolio, SystemProjectSnapshot } from '../../shared/types/system-portfolio';

test('system portfolio reads two project owners and preserves navigation, isolation and unavailable observations', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const sourceCandidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceStatus = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (process.env.CLAWX_S1_EXPECTED_HEAD) {
    expect(sourceCandidate).toBe(process.env.CLAWX_S1_EXPECTED_HEAD);
    expect(sourceStatus).toBe('');
  }
  const observations: Record<string, unknown> = { driven_by: 'agent', actor: 's1-electron-verifier', realHumanEvidence: false,
    sourceCandidate, sourceStatus, fixture: 'Two plans seeded through TaskSystemStore; actual Workspace, Gateway, task and resource owners read through production Host API' };
  const llm = await startScriptedLlm(() => ({ text: 'Portfolio reads must not invoke a model.' }));
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, deviceScaleFactor: 1 });
  const captureUi = await observeSessionUi(app);
  let terminalId: string | undefined;
  try {
    const page = await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    const createProject = async (id: string, title: string) => {
      const root = info.outputPath(id);
      await mkdir(root, { recursive: true });
      execFileSync('git', ['init', '-b', 'main', root], { windowsHide: true });
      execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Agent fixture'], { windowsHide: true });
      const project = await createSessionChainProject(app, root, title);
      const ledger = await hostInvoke<TaskLedgerSnapshotResult>(app, 'taskLedger', 'createNode', {
        workspaceId: project.workspaceId, node: { title: `${title} binding`, kind: 'task', status: 'todo' }, idempotencyKey: `${id}-binding`,
      });
      const bindingTask = ledger.snapshot.nodes.find(node => node.title === `${title} binding`)!;
      const binding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
        ...project, agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [bindingTask.id],
        environment: { kind: 'local', rootPath: root }, archiveRestorePolicy: 'restore',
      });
      expect(binding.recovery.state).toBe('ready');
      const bytes = `verified-${id}`;
      await writeFile(join(root, 'proof.txt'), bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const store = new TaskSystemStore(resolveTaskDomain(root));
      try {
        const contract = { objective: `${title} delivery`, target: 'proof.txt', constraints: [], acceptance: [{ id: 'proof',
          description: 'Verify the fixture bytes', verification: { kind: 'file-sha256' as const, path: 'proof.txt', sha256 } }] };
        const plan = store.saveProjectPlan(project, { requestId: `${id}-plan`, goal: contract, nextAction: `${title} next action`,
          decisions: [`${title} scope decision`], children: [{ key: 'first', contract }, { key: 'next', contract: { ...contract, objective: `${title} next` }, dependsOn: ['first'] }] });
        const credential = store.startNextPlanTask(project, plan.taskNodeId, plan.revision, `${id}-start`).claim!;
        store.verifyFile(credential, 'proof', 'proof.txt', sha256, `${id}-candidate`);
        store.submit(credential, `${id}-candidate`); store.accept(credential, `${id}-candidate`);
        return { ...project, plan, sha256 };
      } finally { store.close(); }
    };
    const alpha = await createProject('alpha', 'Portfolio Alpha');
    const opened = await hostInvoke<{ success: boolean; sessionId: string }>(app, 'terminal', 'open', {
      workspaceId: alpha.workspaceId, sessionKey: alpha.sessionKey, cwd: alpha.rootPath,
    });
    expect(opened.success).toBe(true); terminalId = opened.sessionId;
    const beta = await createProject('beta', 'Portfolio Beta');
    await page.reload();
    const before = await hostInvoke(app, 'workspaces', 'list');
    const modelCalls = llm.log.length;
    await page.getByTestId('sidebar-nav-system').click();
    const card = (id: string) => page.getByTestId(`portfolio-project-${id}`);
    await expect(card(alpha.workspaceId)).toHaveAttribute('data-state', 'observed', { timeout: 45_000 });
    await expect(card(beta.workspaceId)).toHaveAttribute('data-state', 'observed');
    await expect(card(alpha.workspaceId)).toContainText('Portfolio Alpha delivery');
    await expect(card(beta.workspaceId)).toContainText('Portfolio Beta delivery');
    await expect(card(alpha.workspaceId)).not.toContainText('Portfolio Beta delivery');
    expect(await hostInvoke(app, 'workspaces', 'list')).toEqual(before);
    expect(llm.log.length).toBe(modelCalls);
    const manifest = await hostInvoke<SystemPortfolio>(app, 'workspaces', 'portfolio');
    const read = async (id: string) => hostInvoke<SystemProjectSnapshot>(app, 'workspaces', 'projectSummary', {
      workspaceId: id, expectedOwnerKey: manifest.profiles.find(p => p.id === id)!.ownerKey,
    });
    const a = await read(alpha.workspaceId), b = await read(beta.workspaceId);
    expect(a.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ sha256: alpha.sha256, candidate: 'alpha-candidate' })]));
    expect(b.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ sha256: beta.sha256, candidate: 'beta-candidate' })]));
    expect(a.resources.observations).toEqual(expect.arrayContaining([expect.objectContaining({ id: `main:pty-session:${terminalId}` })]));
    expect(b.resources.observations.some(entry => entry.id === `main:pty-session:${terminalId}`)).toBe(false);
    expect(a.resources.costUsd).toBeNull();
    observations.ownerReadbacks = { alpha: a, beta: b };
    observations.readOnly = { workspaceUnchanged: true, modelCallsBefore: modelCalls, modelCallsAfter: llm.log.length };
    const title = { en: 'System overview', zh: '系统总览', ja: 'システム概要', ru: 'Обзор системы' };
    const frames = [];
    for (const locale of ['en', 'zh', 'ja', 'ru'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
        await hostInvoke(app, 'settings', 'set', { key: 'theme', value: theme });
        await page.reload();
        await expect(page.getByTestId('system-portfolio').getByRole('heading', { level: 1 })).toHaveText(title[locale]);
        await expect(card(alpha.workspaceId)).toHaveAttribute('data-state', 'observed', { timeout: 45_000 });
        const dimensions = await pinWindowContentSize(app, { width: theme === 'light' ? 1280 : 960, height: 800 });
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        const overflow = await page.getByTestId('system-portfolio').evaluate(element => element.scrollWidth > element.clientWidth + 2);
        expect(overflow).toBe(false);
        await page.getByTestId(`portfolio-open-${alpha.workspaceId}`).focus();
        await expect(page.getByTestId(`portfolio-open-${alpha.workspaceId}`)).toBeFocused();
        const screenshot = `${locale}-${theme}.png`;
        await page.screenshot({ path: info.outputPath(screenshot) });
        frames.push({ locale, theme, dimensions, overflow, screenshot });
      }
    }
    observations.frames = frames;
    await page.getByTestId('portfolio-filter').fill('Alpha');
    await expect(card(beta.workspaceId)).toHaveCount(0);
    await page.getByTestId(`portfolio-open-${alpha.workspaceId}`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Portfolio Alpha');
    await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', alpha.generation, { timeout: 30_000 });
    await page.goBack();
    await expect(page.getByTestId('portfolio-filter')).toHaveValue('Alpha');
    await page.getByTestId('portfolio-filter').fill('');
    await hostInvoke(app, 'terminal', 'close', { sessionId: terminalId }); terminalId = undefined;
    await rename(beta.rootPath, `${beta.rootPath}-temporarily-unavailable`);
    await page.getByTestId('portfolio-refresh').click();
    await expect(card(beta.workspaceId)).toHaveAttribute('data-state', 'unavailable', { timeout: 30_000 });
    await expect(card(alpha.workspaceId)).toHaveAttribute('data-state', 'observed');
    await expect(card(beta.workspaceId)).toContainText('Portfolio Beta delivery');
    await rename(`${beta.rootPath}-temporarily-unavailable`, beta.rootPath);
    await page.getByTestId('portfolio-refresh').click();
    await expect(card(beta.workspaceId)).toHaveAttribute('data-state', 'observed');
    observations.unavailableRecovered = true;
    observations.status = 'passed';
  } catch (error) { observations.status = 'failed'; observations.error = String(error); throw error; }
  finally {
    await captureUi(name => info.outputPath(name));
    await writeFile(info.outputPath('system-portfolio.json'), JSON.stringify(observations, null, 2));
    if (terminalId) await hostInvoke(app, 'terminal', 'close', { sessionId: terminalId }).catch(() => undefined);
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(done => llm.server.close(() => done()));
  }
});
