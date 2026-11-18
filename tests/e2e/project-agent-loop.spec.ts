import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';
import type { ProjectPlanSnapshot, TaskEvidence, TaskSessionSnapshot } from '../../shared/task-system/types';

test('a project coordinator saves, revises and reopens its owner-backed plan', async ({ launchElectronApp, userDataDir }, info) => {
  test.setTimeout(240_000);
  const sourceCandidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceStatus = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (process.env.CLAWX_P1_EXPECTED_HEAD) {
    expect(sourceCandidate).toBe(process.env.CLAWX_P1_EXPECTED_HEAD);
    expect(sourceStatus, 'The frozen source checkout must be clean').toBe('');
  }
  const goal = 'Plan the release checklist and its verification without running either step.';
  const revisedGoal = 'Revise the checklist plan to include a rollback check; preserve the previous verification.';
  const completionPrompts = ['Verify the first fixture checklist step.', 'Verify the second fixture checklist step.'];
  const contract = (objective: string, content = 'release checklist') => ({ objective, target: 'checklist.txt', constraints: [], acceptance: [{
    id: 'checklist', description: 'Check the checklist against the agreed fixture', verification: {
      kind: 'file-sha256', path: 'checklist.txt', sha256: createHash('sha256').update(content).digest('hex'),
    },
  }] });
  const call = { action: 'savePlan', requestId: 'e2e-release-checklist-v1', contract: contract(goal),
    nextAction: 'Draft the release checklist', assumptions: ['Existing checklist format is suitable'],
    decisions: ['Confirm deployment scope'], children: [
      { key: 'draft', contract: contract('Draft the release checklist') },
      { key: 'verify', contract: contract('Verify the release checklist'), dependsOn: ['draft'] },
    ] };
  const llm = await startScriptedLlm((text, results) => {
    if (text.includes(revisedGoal)) {
      if (!Object.hasOwn(results, 'planreadv2')) return { toolCall: { id: 'planreadv2', name: 'task_control', args: { action: 'planStatus' } } };
      const current = JSON.parse(results.planreadv2) as ProjectPlanSnapshot;
      if (!Object.hasOwn(results, 'planrevise')) return { toolCall: { id: 'planrevise', name: 'task_control', args: {
        ...call, requestId: 'e2e-release-checklist-v2', contract: contract(revisedGoal, 'rollback checklist'), taskNodeId: current.task.contract.taskNodeId,
        expectedRevision: current.task.contract.revision, revisionReason: 'Add the rollback requirement',
        nextAction: 'Draft the rollback checklist', children: [
          { key: 'draft', contract: contract('Draft the rollback checklist', 'rollback checklist') },
          { key: 'verify', contract: contract('Verify rollback readiness', 'rollback checklist'), dependsOn: ['draft'] },
        ],
      } } };
      return { text: 'Project plan revision finished.' };
    }
    const fixtureIndex = completionPrompts.findLastIndex((prompt) => text.includes(prompt));
    if (fixtureIndex >= 0) {
      const key = `fixture${fixtureIndex}`;
      if (!Object.hasOwn(results, `${key}read`)) return { toolCall: { id: `${key}read`, name: 'task_control', args: { action: 'planStatus' } } };
      const current = JSON.parse(results[`${key}read`]) as ProjectPlanSnapshot;
      if (!Object.hasOwn(results, `${key}start`)) return { toolCall: { id: `${key}start`, name: 'task_control', args: {
        action: 'startNextPlanTask', taskNodeId: current.task.contract.taskNodeId, expectedRevision: current.task.contract.revision, requestId: `${key}-complete`,
      } } };
      if (!Object.hasOwn(results, `${key}verify`)) return { toolCall: { id: `${key}verify`, name: 'task_control', args: {
        action: 'verifyFile', criterionId: 'checklist', path: 'checklist.txt',
        sha256: call.children[fixtureIndex].contract.acceptance[0].verification.sha256, candidate: 'fixture-version-1',
      } } };
      for (const action of ['submit', 'accept']) {
        if (!Object.hasOwn(results, `${key}${action}`)) return { toolCall: { id: `${key}${action}`, name: 'task_control', args: { action, candidate: 'fixture-version-1' } } };
      }
      return { text: `Fixture step ${fixtureIndex + 1} verified.` };
    }
    if (!text.includes(goal)) return { text: 'Discussion noted.' };
    if (!Object.hasOwn(results, 'planread')) return { toolCall: { id: 'planread', name: 'task_control', args: { action: 'planStatus' } } };
    if (!Object.hasOwn(results, 'plansave')) return { toolCall: { id: 'plansave', name: 'task_control', args: call } };
    return { text: 'Project planning turn finished.' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  const observeUi = await observeSessionUi(app);
  const nativeLog: string[] = [];
  app.process().stdout?.on('data', (data: Buffer) => nativeLog.push(data.toString()));
  app.process().stderr?.on('data', (data: Buffer) => nativeLog.push(data.toString()));
  try {
    const page = await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, info.outputPath('project'), 'Planning project');
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Planning project');
    const send = async (message: string) => {
      await expect(page.getByTestId('chat-composer-send')).not.toHaveAttribute('data-send-state', /^running/, { timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill(message);
      await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
      await page.getByTestId('chat-composer-send').click();
    };
    const read = () => hostInvoke<TaskSessionSnapshot>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey, expectedSessionGeneration: project.generation,
    });
    await send('What does a checklist usually cover? Just discuss it.');
    await expect(page.getByText('Discussion noted.', { exact: true })).toBeVisible({ timeout: 45_000 });
    expect((await read()).projectPlan).toBeUndefined();
    await send(goal);
    await expect(page.getByText('Project planning turn finished.', { exact: true })).toBeVisible({ timeout: 60_000 });
    const snapshot = await read();
    const plan = snapshot.projectPlan!;
    expect(plan?.task.contract.objective).toBe(goal);
    expect(plan.children).toHaveLength(2);
    expect(plan.children[1].contract.dependencies).toEqual([plan.children[0].contract.taskNodeId]);
    expect(plan.children[0].contract.acceptance).toEqual(call.children[0].contract.acceptance);
    expect(plan.task.claim).toBeNull();
    const toolResult = llm.log.find((entry) => Object.hasOwn(entry.toolResults, 'plansave'))?.toolResults.plansave;
    expect(toolResult).toContain(plan.task.contract.taskNodeId);
    expect(llm.log.filter((entry) => entry.issued === 'plansave')).toHaveLength(1);
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    const dock = page.getByTestId('session-task-dock');
    await expect(dock).toContainText(goal);
    await dock.getByRole('button', { name: goal }).click();
    await expect(dock.getByTestId('session-task-steps')).toContainText('Verify the release checklist');
    const history = dock.getByTestId('project-plan-history');
    await history.locator('summary').click();
    await expect(history).toContainText('Plan version 1');
    await expect(history).toContainText('Assumption: Existing checklist format is suitable');
    await expect(history).toContainText('Decision pending: Confirm deployment scope');

    // Agent-driven fixture completion uses actual Runtime tool calls and the file verifier.
    await expect(page.getByTestId('chat-composer-send')).not.toHaveAttribute('data-send-state', /^running/, { timeout: 60_000 });
    await writeFile(join(project.rootPath, 'checklist.txt'), 'release checklist');
    const setupReceipts: TaskEvidence[] = [];
    for (const [index, prompt] of completionPrompts.entries()) {
      await send(prompt);
      await expect(page.getByText(`Fixture step ${index + 1} verified.`, { exact: true })).toBeVisible({ timeout: 60_000 });
      expect((await read()).projectPlan?.children[index].contract.state).toBe('done');
      const result = llm.log.find((entry) => Object.hasOwn(entry.toolResults, `fixture${index}verify`))?.toolResults[`fixture${index}verify`];
      expect(result).toBeTruthy();
      setupReceipts.push(JSON.parse(result!) as TaskEvidence);
    }
    await send(revisedGoal);
    await expect(page.getByText('Project plan revision finished.', { exact: true })).toBeVisible({ timeout: 60_000 });
    const revised = (await read()).projectPlan!;
    expect(revised.task.contract.revision).toBe(2);
    expect(revised.children[0].contract.acceptance).not.toEqual(plan.children[0].contract.acceptance);
    expect(revised.revisions.map((entry) => entry.revision)).toEqual([2, 1]);
    expect(revised.revisions[0].previousChildIds).toEqual(plan.children.map((child) => child.contract.taskNodeId));
    expect(revised.children.every((child) => child.contract.state === 'ready' && !plan.revisions[0].childIds.includes(child.contract.taskNodeId))).toBe(true);
    const revisionToolResult = llm.log.find((entry) => Object.hasOwn(entry.toolResults, 'planrevise'))?.toolResults.planrevise;
    expect(revisionToolResult).toContain(revised.task.contract.taskNodeId);
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(dock).toContainText(revisedGoal);
    await expect(history).toBeVisible();
    await history.locator('summary').click();
    await expect(history).toContainText('Plan version 2');
    await expect(history).toContainText('Plan version 1');
    await expect(history).toContainText('Add the rollback requirement');
    const workspaceOwnerSha256 = createHash('sha256').update(await readFile(join(userDataDir, 'workspaces.json'))).digest('hex');
    await page.screenshot({ path: info.outputPath('project-plan.png') });
    const otherProject = await createSessionChainProject(app, info.outputPath('other-project'), 'Another project');
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${otherProject.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Another project');
    await expect(dock).toBeHidden();
    const otherSnapshot = await hostInvoke<TaskSessionSnapshot>(app, 'taskLedger', 'sessionTask', {
      workspaceId: otherProject.workspaceId, sessionKey: otherProject.sessionKey, expectedSessionGeneration: otherProject.generation,
    });
    expect(otherSnapshot.projectPlan).toBeUndefined();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(dock).toContainText(revisedGoal);
    await writeFile(info.outputPath('project-plan-readback.json'), JSON.stringify({
      driven_by: 'agent', actor: 'playwright-project-agent-loop', provider: 'local-scripted', project, plan, revised,
      sourceCandidate, sourceClean: sourceStatus === '',
      toolResult, revisionToolResult, workspaceOwnerSha256, setup: { actor: 'project-plan-fixture', receipts: setupReceipts },
      isolation: { otherProject, otherSnapshot, returnedPlan: (await read()).projectPlan },
    }, null, 2));
  } catch (error) {
    await observeUi((name) => info.outputPath(name));
    throw error;
  } finally {
    await writeFile(info.outputPath('provider-log.json'), JSON.stringify({
      driven_by: 'agent', actor: 'playwright-project-agent-loop', log: llm.log, anomalies: llm.anomalies,
    }, null, 2));
    await writeFile(info.outputPath('native-log.txt'), nativeLog.join(''));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    const cleanup = await closeElectronApp(app);
    await writeFile(info.outputPath('cleanup.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-project-agent-loop', ...cleanup }, null, 2));
    llm.server.closeAllConnections();
    await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
