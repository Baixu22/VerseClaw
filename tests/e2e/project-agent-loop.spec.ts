import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';
import type { TaskLedgerSnapshotResult, TaskSystemCommandResult, WorkspaceCoordinatorBindingResult } from '../../shared/host-api/contract';
import type { ProjectPlanSnapshot, TaskEvidence, TaskSessionSnapshot, TaskView } from '../../shared/task-system/types';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { getOpenClawProviderKeyForType } from '../../electron/utils/provider-keys';
import type { GatewayStatus } from '../../shared/types/gateway';
import type { SessionDelegationResult } from '../../shared/types/session-delegation';
import type { SessionHandoffOperation } from '../../shared/types/session-handoff';

for (const mode of ['cancel', 'failure', 'budget'] as const) test(
  mode === 'cancel' ? 'cancels the active project worker without delivering its late result'
    : mode === 'budget' ? 'advances an independent plan task when spend admission caps worker retries'
      : 'advances an independent plan task after terminal worker failure',
  async ({ launchElectronApp, userDataDir }, info) => {
    test.setTimeout(360_000);
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
    const sourceCandidate = git('rev-parse', 'HEAD');
    if (process.env.CLAWX_P3_EXPECTED_HEAD) {
      expect(sourceCandidate).toBe(process.env.CLAWX_P3_EXPECTED_HEAD);
      expect(git('status', '--porcelain')).toBe('');
    }
    const workerTask = 'P3 worker fault fixture';
    const independentTask = 'Write the independent index';
    const projectLimit = 4_000_000;
    // Two unpriced requests using the fixture model's 128k input and 4096 output bounds.
    const sessionLimit = mode === 'budget' ? 2 * (128_000 + 4_096) : undefined;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let workerCalls = 0;
    let completionCalls = 0;
    const llm = await startScriptedLlm(async (text, results) => {
      if (text.includes('A background task finished.') || text.includes('[Internal task completion event]')) {
        completionCalls++;
        if (mode === 'cancel') return { text: 'Unexpected cancellation wake.' };
        if (!Object.hasOwn(results, 'failureplan')) return { toolCall: { id: 'failureplan', name: 'task_control', args: { action: 'planStatus' } } };
        const plan = JSON.parse(results.failureplan) as ProjectPlanSnapshot;
        if (plan.children?.[0]?.contract.state !== 'paused') return { text: 'Failed worker still holds its task.' };
        if (!Object.hasOwn(results, 'independentclaim')) return { toolCall: { id: 'independentclaim', name: 'task_control', args: {
          action: 'startNextPlanTask', taskNodeId: plan.task.contract.taskNodeId, expectedRevision: plan.task.contract.revision,
          requestId: 'p3-worker-failure-next',
        } } };
        if ((JSON.parse(results.independentclaim) as TaskView)?.contract?.objective !== independentTask) return { text: 'Independent claim failed.' };
        if (!Object.hasOwn(results, 'independentwrite')) return { toolCall: { id: 'independentwrite', name: 'write', args: {
          path: 'index.txt', content: 'independent result',
        } } };
        return { text: 'Independent work advanced.' };
      }
      if (text.includes(workerTask)) {
        workerCalls++;
        if (mode !== 'cancel') return { rateLimited: true };
        await hold;
        return { toolCall: { id: 'lateworkerwrite', name: 'write', args: { path: 'late.txt', content: 'must not land' } } };
      }
      return { text: 'Fixture response.' };
    });
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await getStableWindow(app);
      await configureSessionChainProvider(app, llm.port);
      const root = info.outputPath('project');
      await mkdir(root, { recursive: true });
      git('init', '-b', 'main', root);
      git('-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture base');
      const project = await createSessionChainProject(app, root, 'Project worker faults');
      const config = await hostInvoke<{ hash: string }>(app, 'gateway', 'rpc', { method: 'config.get', params: {} });
      await hostInvoke(app, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: config.hash, raw: JSON.stringify({
        runtime: { providerBudget: {
          project: { maxTokens: projectLimit }, ...(sessionLimit ? { session: { maxTokens: sessionLimit } } : {}),
        } },
      }), note: 'P3 worker fault fixture' } });
      await hostInvoke(app, 'gateway', 'stop');
      await startGateway(app);
      const store = new TaskSystemStore(resolveTaskDomain(root));
      try {
        const goal = (objective: string, target: string) => ({ objective, target, constraints: [], acceptance: [{
          id: 'file', description: 'Read the expected file', verification: { kind: 'owner-receipt' as const, owner: 'fixture' },
        }] });
        const plan = store.saveProjectPlan(project, { goal: goal('Handle a project worker fault', '.'), requestId: 'p3-worker-fault',
          nextAction: workerTask, children: [
            { key: 'fault', contract: goal(workerTask, 'late.txt') },
            { key: 'dependent', contract: goal('Requires first result', 'dependent.txt'), dependsOn: ['fault'] },
            ...(mode !== 'cancel' ? [{ key: 'independent', contract: goal(independentTask, 'index.txt') }] : []),
          ],
        });
        const dispatch = { workspaceId: project.workspaceId, sessionKey: project.sessionKey, expectedSessionGeneration: project.generation,
          planId: plan.taskNodeId, expectedRevision: plan.revision, expectedChildId: plan.childIds[0] };
        const admitted = await hostInvoke<SessionDelegationResult>(app, 'sessions', 'dispatchPlanTask', dispatch);
        expect(admitted, admitted.error).toMatchObject({ success: true, status: 'accepted' });
        const worker = admitted.receipt!.children[0];
        expect(worker).toMatchObject({ childSessionKey: expect.any(String), childRunId: expect.any(String) });
        const readWorker = () => store.delegationForChild(worker.childSessionKey!);
        await expect.poll(readWorker, { timeout: 60_000 }).not.toBeNull();
        if (mode === 'cancel') {
          await expect.poll(() => workerCalls, { timeout: 60_000 }).toBe(1);
          const child = readWorker()!.child;
          const cancel = (generation = child.generation) => hostInvoke<TaskSystemCommandResult>(app, 'taskLedger', 'command', {
            workspaceId: project.workspaceId, command: { action: 'cancel', credential: { ...child, generation } },
          });
          const stale = await cancel('stale-worker');
          expect(stale, stale.error).toMatchObject({ success: false });
          expect(store.get(child.taskNodeId).contract.state).toBe('doing');
          const cancelled = await cancel();
          await writeFile(info.outputPath('cancel-responses.json'), JSON.stringify({ stale, cancelled }, null, 2));
          expect(cancelled, cancelled.error).toMatchObject({ success: true, result: { contract: { state: 'cancelled' } } });
          release();
          const describeChild = () => hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: child.sessionKey } });
          await expect.poll(describeChild).toMatchObject({ session: { sessionId: child.generation, hasActiveRun: false } });
          await hostInvoke(app, 'gateway', 'stop');
          await startGateway(app);
          const replay = await hostInvoke(app, 'sessions', 'dispatchPlanTask', dispatch);
          expect(replay).toMatchObject({ success: true, replayed: true });
          expect(completionCalls).toBe(0);
          expect(workerCalls).toBe(1);
          await expect(readFile(join(root, 'late.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
          expect(readWorker()).toMatchObject({ phase: 'returned', terminalReceipt: { outcome: 'cancelled' } });
        } else {
          await expect.poll(() => readFile(join(root, 'index.txt'), 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          }), { timeout: 100_000 }).toBe('independent result');
          const expectedAttempts = mode === 'budget' ? 2 : 3;
          expect(llm.log.filter(row => row.issued === 'http:429')).toHaveLength(expectedAttempts);
          expect(workerCalls).toBe(expectedAttempts);
          expect(llm.log.filter(row => row.issued === 'independentwrite')).toHaveLength(1);
          expect(store.get(plan.childIds[0])).toMatchObject({ contract: { state: 'paused' }, claim: { state: 'released' } });
          expect(store.get(plan.childIds[2]).claim).toMatchObject({ sessionKey: project.sessionKey, generation: project.generation, state: 'active' });
          expect(store.getTaskEvidence(plan.childIds[0])).toEqual([]);
        }
        expect(store.get(plan.childIds[1]).claim).toBeNull();
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite'), { readOnly: true });
        let registry, spend;
        try {
          const readRegistry = () => db.prepare(`SELECT run_id, ended_reason, outcome_json, completion_announced_at, last_announce_delivery_error FROM subagent_runs WHERE run_id=?`).get(worker.childRunId!);
          await expect.poll(readRegistry, { timeout: 45_000 }).toMatchObject(mode === 'cancel'
            ? { ended_reason: 'subagent-killed', completion_announced_at: null }
            : { ended_reason: 'subagent-error', completion_announced_at: expect.any(Number) });
          registry = readRegistry();
          spend = db.prepare(`SELECT run_id, model, state, reserved_tokens, actual_tokens, scope_json, reconciliation_ref
            FROM provider_spend_calls WHERE json_extract(scope_json,'$.sessionKey')=? ORDER BY created_at`).all(worker.childSessionKey!);
          expect(spend).toHaveLength(workerCalls);
          expect(spend.every(row => row.run_id === worker.childRunId && row.state === 'unknown' && row.actual_tokens === null)).toBe(true);
          if (sessionLimit) expect(spend.reduce((sum, row) => sum + Number(row.reserved_tokens), 0)).toBe(sessionLimit);
        } finally { db.close(); }
        if (mode !== 'cancel') {
          const callsBeforeReplay = llm.log.length;
          expect(await hostInvoke(app, 'sessions', 'dispatchPlanTask', dispatch)).toMatchObject({ success: true, replayed: true });
          expect(llm.log).toHaveLength(callsBeforeReplay);
        }
        await writeFile(info.outputPath('worker-fault-readback.json'), JSON.stringify({
          driven_by: 'agent', actor: 'playwright-project-worker-fault', sourceCandidate, sourceTree: git('rev-parse', 'HEAD^{tree}'),
          mode, worker, workerCalls, completionCalls, input: { projectLimit, sessionLimit, repeatedResponse: mode !== 'cancel' ? 429 : null },
          delegation: readWorker(), registry, spend, plan, tasks: plan.childIds.map(id => store.get(id)),
          events: plan.childIds.map(id => store.history(id)),
        }, null, 2));
        if (process.env.CLAWX_P3_EXPECTED_HEAD) {
          expect(git('rev-parse', 'HEAD')).toBe(sourceCandidate);
          expect(git('status', '--porcelain')).toBe('');
        }
      } finally { store.close(); }
    } finally {
      release();
      await writeFile(info.outputPath('provider-log.json'), JSON.stringify({ log: llm.log, workerCalls, completionCalls, anomalies: llm.anomalies }, null, 2));
      await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
      await closeElectronApp(app);
      llm.server.closeAllConnections();
      await new Promise<void>(resolve => llm.server.close(() => resolve()));
    }
  },
);

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
    const readToolResult = async (callId: string) => {
      const result = () => llm.log.find(entry => Object.hasOwn(entry.toolResults, callId))?.toolResults[callId];
      await expect.poll(result, {timeout:60_000}).toBeTruthy();
      return result()!;
    };
    await send('What does a checklist usually cover? Just discuss it.');
    await expect(page.getByText('Discussion noted.', { exact: true })).toBeVisible({ timeout: 45_000 });
    expect((await read()).projectPlan).toBeUndefined();
    await send(goal);
    await expect.poll(async () => (await read()).projectPlan?.task.contract.objective, {timeout:60_000}).toBe(goal);
    const snapshot = await read();
    const plan = snapshot.projectPlan!;
    expect(plan?.task.contract.objective).toBe(goal);
    expect(plan.children).toHaveLength(2);
    expect(plan.children[1].contract.dependencies).toEqual([plan.children[0].contract.taskNodeId]);
    expect(plan.children[0].contract.acceptance).toEqual(call.children[0].contract.acceptance);
    expect(plan.task.claim).toBeNull();
    const toolResult = await readToolResult('plansave');
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
      const accepted = JSON.parse(await readToolResult(`fixture${index}accept`)) as TaskView;
      expect(accepted.contract).toMatchObject({ taskNodeId: plan.children[index].contract.taskNodeId, state: 'done' });
      await expect.poll(async () => (await read()).projectPlan?.children[index].contract.state, {timeout:60_000}).toBe('done');
      setupReceipts.push(JSON.parse(await readToolResult(`fixture${index}verify`)) as TaskEvidence);
    }
    await send(revisedGoal);
    await expect.poll(async () => (await read()).projectPlan?.task.contract.revision, {timeout:60_000}).toBe(2);
    const revised = (await read()).projectPlan!;
    expect(revised.task.contract.revision).toBe(2);
    expect(revised.children[0].contract.acceptance).not.toEqual(plan.children[0].contract.acceptance);
    expect(revised.revisions.map((entry) => entry.revision)).toEqual([2, 1]);
    expect(revised.revisions[0].previousChildIds).toEqual(plan.children.map((child) => child.contract.taskNodeId));
    expect(revised.children.every((child) => child.contract.state === 'ready' && !plan.revisions[0].childIds.includes(child.contract.taskNodeId))).toBe(true);
    const revisionToolResult = await readToolResult('planrevise');
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

test('hands a project checkpoint to the new coordinator and rejects a late completion for the old one', async ({ launchElectronApp }, info) => {
  test.setTimeout(240_000);
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  const sourceCandidate = git('rev-parse', 'HEAD');
  const expectedHead = process.env.CLAWX_P3_EXPECTED_HEAD;
  if (expectedHead) {
    expect(sourceCandidate).toBe(expectedHead);
    expect(git('status', '--porcelain')).toBe('');
  }
  const draft = 'Resume the handed-off project task from its checkpoint.';
  const checkpoint = { nextAction: 'Read the confirmed handoff checkpoint', completed: ['Prepared fixture work'], unresolved: [], artifacts: [] };
  const continued = { ...checkpoint, nextAction: 'Continue with the replacement coordinator' };
  const resumedText = 'Resumed the confirmed checkpoint.';
  const llm = await startScriptedLlm((text, results) => {
    if (!text.includes(draft)) return { text: 'Fixture ready.' };
    if (!Object.hasOwn(results, 'currenttask')) return { toolCall: { id: 'currenttask', name: 'task_control', args: { action: 'current' } } };
    if ((JSON.parse(results.currenttask) as TaskView | null)?.checkpoint?.nextAction !== checkpoint.nextAction) {
      return { text: 'Checkpoint not found.' };
    }
    if (!Object.hasOwn(results, 'newcheckpoint')) return { toolCall: { id: 'newcheckpoint', name: 'task_control', args: { action: 'checkpoint', checkpoint: continued } } };
    return { text: resumedText };
  });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    const root = info.outputPath('project');
    await mkdir(root, { recursive: true });
    git('init', '-b', 'main', root);
    git('-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture base');
    const project = await createSessionChainProject(app, root, 'Checkpoint handoff');
    const ledger = await hostInvoke<TaskLedgerSnapshotResult>(app, 'taskLedger', 'createNode', {
      workspaceId: project.workspaceId, node: { title: 'Checkpoint handoff', kind: 'task', status: 'todo' },
      idempotencyKey: 'project-checkpoint-binding-task',
    });
    const bindingTask = ledger.snapshot.nodes.find(node => node.title === 'Checkpoint handoff');
    if (!bindingTask) throw new Error('Task Ledger did not return the coordinator binding task');
    const binding = await hostInvoke(app, 'workspaces', 'bindCoordinator', {
      ...project, agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [bindingTask.id],
      environment: { kind: 'local', rootPath: root }, archiveRestorePolicy: 'restore',
    });
    expect(binding).toMatchObject({ recovery: { state: 'ready' }, binding: { sessionGeneration: project.generation } });
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const goal = { objective: 'Continue a checkpointed project task', target: '.', constraints: [], acceptance: [{
        id: 'proof', description: 'Verify the replacement owner checkpoint', verification: { kind: 'owner-receipt' as const, owner: 'fixture' },
      }] };
      const plan = store.saveProjectPlan(project, { goal, requestId: 'handoff-plan', nextAction: goal.objective, children: [{ key: 'continue', contract: goal }] });
      const original = store.startNextPlanTask(project, plan.taskNodeId, plan.revision, 'claim-for-handoff').claim!;
      store.checkpoint(original, checkpoint);
      const create = () => hostInvoke<{ success: boolean; operation: SessionHandoffOperation }>(app, 'sessions', 'createHandoff', {
        sessionKey: project.sessionKey, workspaceId: project.workspaceId, agentId: 'main', draftInput: draft,
        operationId: 'project-checkpoint-handoff',
      });
      store.beginOperation(original, 'fixture-operation', 'write');
      await expect(create()).rejects.toThrow('TASK_OPERATIONS_PENDING');
      const blocked = store.get(original.taskNodeId);
      expect(blocked).toMatchObject({ checkpoint, pendingOperations: 1, claim: {
        taskNodeId: original.taskNodeId, sessionKey: original.sessionKey, generation: original.generation,
        epoch: original.epoch, attemptId: original.attemptId, state: 'active',
      } });
      store.finishOperation(original, 'fixture-operation', 'completed', 'Fixture operation settled');
      const { success, operation } = await create();
      expect(success).toBe(true);
      expect(operation.phase).toBe('ready');
      expect(operation.sessionGeneration).toBeTruthy();
      const transferred = store.get(original.taskNodeId);
      expect(transferred).toMatchObject({ checkpoint, pendingOperations: 0, claim: {
        taskNodeId: original.taskNodeId, sessionKey: operation.sessionKey, generation: operation.sessionGeneration,
        epoch: original.epoch + 1,
      } });
      expect(await hostInvoke(app, 'taskLedger', 'command', {
        workspaceId: project.workspaceId, command: { action: 'cancel', credential: original },
      })).toMatchObject({ success: false, error: 'TASK_COORDINATOR_REQUIRED' });
      const old = await hostInvoke<{ session?: { sessionId?: string } }>(app, 'gateway', 'rpc', {
        method: 'sessions.describe', params: { key: project.sessionKey },
      });
      expect(old.session?.sessionId).toBe(project.generation);
      expect(() => store.checkpoint(original, continued)).toThrow('TASK_STALE_OWNER');
      const beforeLate = llm.log.length;
      await expect(hostInvoke(app, 'gateway', 'rpc', { method: 'agent', params: {
        sessionKey: project.sessionKey, sessionId: project.generation, expectedSessionId: project.generation,
        message: 'A worker completed after the original coordinator handed off.', deliver: false, idempotencyKey: 'late-after-project-handoff',
      } })).rejects.toThrow('AGENT_CONTINUATION_OWNER_RETIRED');
      const lateCompletionProviderCalls = llm.log.length - beforeLate;
      expect(lateCompletionProviderCalls).toBe(0);
      expect(await hostInvoke(app, 'chat', 'sendWithMedia', {
        workspaceId: project.workspaceId, sessionKey: operation.sessionKey, message: draft,
        handoffOperationId: operation.id, idempotencyKey: operation.firstSendIdempotencyKey,
      })).toMatchObject({ success: true });
      await expect.poll(() => store.get(original.taskNodeId).checkpoint, { timeout: 60_000 }).toEqual(continued);
      await expect.poll(() => llm.log.find(row => row.toolResults.newcheckpoint)?.issued, { timeout: 30_000 })
        .toBe(`text:${resumedText}`);
      const observed = llm.log.find(row => row.toolResults.currenttask)!.toolResults.currenttask;
      expect(JSON.parse(observed)).toMatchObject({ checkpoint, claim: {
        taskNodeId: original.taskNodeId, sessionKey: operation.sessionKey, generation: operation.sessionGeneration,
        epoch: original.epoch + 1,
      } });
      expect(llm.log.filter(row => row.issued === 'newcheckpoint')).toHaveLength(1);
      const checkpoints = store.history(original.taskNodeId).filter(event => event.kind === 'checkpoint');
      expect(checkpoints.map(event => JSON.parse(event.json).nextAction))
        .toEqual([checkpoint.nextAction, continued.nextAction]);
      await writeFile(info.outputPath('project-handoff-checkpoint.json'), `${JSON.stringify({
        driven_by: 'agent', actor: 'playwright-project-handoff', sourceCandidate, original, operation,
        blocked, transferred, observed: JSON.parse(observed), resumed: store.get(original.taskNodeId), checkpoints,
        originalGenerationRetained: old.session?.sessionId === original.generation,
        lateCompletionProviderCalls,
      }, null, 2)}\n`);
    } finally {
      store.close();
    }
  } finally {
    await writeFile(info.outputPath('handoff-provider.json'), JSON.stringify({ log: llm.log, anomalies: llm.anomalies }, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

for (const mode of ['restart', 'unknown-effect', 'controls'] as const) test(
  mode === 'unknown-effect' ? 'blocks project replay after an in-flight Gateway restart until the effect owner reconciles'
    : mode === 'controls' ? 'separates project dispatch pause, run stop and task cancellation'
      : 'resumes the project coordinator from its confirmed checkpoint after an in-flight Gateway restart',
  async ({ launchElectronApp, userDataDir }, info) => {
  const unknownEffect = mode === 'unknown-effect';
  test.setTimeout(300_000);
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  const sourceCandidate = git('rev-parse', 'HEAD');
  if (process.env.CLAWX_P3_EXPECTED_HEAD) {
    expect(sourceCandidate).toBe(process.env.CLAWX_P3_EXPECTED_HEAD);
    expect(git('status', '--porcelain')).toBe('');
  }
  const prompt = 'Continue the P3 restart fixture.';
  const checkpoint = { nextAction: 'Read the confirmed restart checkpoint', completed: [], unresolved: [], artifacts: [] };
  const resumed = { ...checkpoint, nextAction: 'Checkpoint recovered from disk' };
  const recoveryPrompt = 'Your previous turn was interrupted by a gateway restart';
  const reconciledPrompt = 'Continue from the checkpoint after effect-owner reconciliation.';
  const marker = 'P3 checkpoint recovery finished.';
  let releaseProvider!: () => void;
  const hold = new Promise<void>(resolve => { releaseProvider = resolve; });
  let interruptedRequests = 0;
  let automaticRecoveryCalls = 0;
  const llm = await startScriptedLlm(async (text, results) => {
    if (text.includes(recoveryPrompt)) automaticRecoveryCalls++;
    if (text.includes(recoveryPrompt) || text.includes(reconciledPrompt)) {
      if (!Object.hasOwn(results, 'restartread')) return { toolCall: { id: 'restartread', name: 'task_control', args: { action: 'current' } } };
      const task = JSON.parse(results.restartread) as TaskView | null;
      if (task?.checkpoint?.nextAction !== checkpoint.nextAction) return { text: 'Restart checkpoint missing.' };
      if (!Object.hasOwn(results, 'restartwrite')) return { toolCall: { id: 'restartwrite', name: 'task_control', args: { action: 'checkpoint', checkpoint: resumed } } };
      return { text: marker };
    }
    if (text.includes(prompt)) { interruptedRequests++; await hold; }
    return { text: 'Fixture response.' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    const root = info.outputPath('project');
    await mkdir(root, { recursive: true });
    git('init', '-b', 'main', root);
    git('-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture base');
    const project = await createSessionChainProject(app, root, 'Checkpoint restart');
    const scope = { workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main' };
    let bindingInput: Record<string, unknown> | undefined;
    let bindingRevision: number | undefined;
    if (mode === 'controls') {
      const config = await hostInvoke<{ hash: string }>(app, 'gateway', 'rpc', { method: 'config.get', params: {} });
      await hostInvoke(app, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: config.hash,
        raw: JSON.stringify({ runtime: { providerBudget: { project: { maxTokens: 4_000_000 } } } }), note: 'Fixture project budget' } });
      await hostInvoke(app, 'gateway', 'stop');
      await startGateway(app);
      const ledger = await hostInvoke<TaskLedgerSnapshotResult>(app, 'taskLedger', 'createNode', {
        workspaceId: project.workspaceId, node: { title: 'Project controls', kind: 'task', status: 'todo' }, idempotencyKey: 'p3-controls-binding',
      });
      const taskRef = ledger.snapshot.nodes.find(node => node.title === 'Project controls');
      if (!taskRef) throw new Error('Missing coordinator binding task');
      bindingInput = { ...scope, expectedRevision: 0, taskLedgerNodeIds: [taskRef.id],
        environment: { kind: 'local', rootPath: root }, archiveRestorePolicy: 'restore' };
      const bound = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', bindingInput);
      expect(bound).toMatchObject({ recovery: { state: 'ready' }, binding: { sessionGeneration: project.generation } });
      bindingRevision = bound.binding!.bindingRevision;
    }
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const goal = { objective: 'Recover the current project task', target: '.', constraints: [], acceptance: [{
        id: 'proof', description: 'Confirm the recovered checkpoint', verification: { kind: 'owner-receipt' as const, owner: 'fixture' },
      }] };
      const plan = store.saveProjectPlan(project, { goal, requestId: 'restart-plan', nextAction: goal.objective, children: [{ key: 'recover', contract: goal }] });
      const original = store.startNextPlanTask(project, plan.taskNodeId, plan.revision, 'claim-for-restart').claim!;
      store.checkpoint(original, checkpoint);
      const describe = () => hostInvoke<{ session: { sessionId: string; hasActiveRun: boolean; status?: string } }>(app, 'gateway', 'rpc', {
        method: 'sessions.describe', params: { key: project.sessionKey },
      });
      const priorGateway = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      expect(priorGateway.pid).toBeGreaterThan(0);
      const sent = await hostInvoke<{ success: boolean; result: { runId: string } }>(app, 'chat', 'sendWithMedia', {
        workspaceId: project.workspaceId, sessionKey: project.sessionKey, message: prompt, idempotencyKey: 'p3-restart-original-turn',
      });
      expect(sent.success).toBe(true);
      await expect.poll(() => interruptedRequests, { timeout: 60_000 }).toBe(1);
      const inFlight = await describe();
      expect(inFlight.session).toMatchObject({ sessionId: project.generation, hasActiveRun: true });
      expect(store.get(original.taskNodeId)).toMatchObject({ checkpoint, pendingOperations: 0 });
      const activeRun = store.db.prepare('SELECT epoch, run_id, owner_pid FROM task_active_runs WHERE task_id=?')
        .get(original.taskNodeId);
      expect(activeRun).toEqual({ epoch: original.epoch, run_id: sent.result.runId, owner_pid: priorGateway.pid });
      if (mode === 'controls') {
        const paused = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'pauseCoordinator', {
          ...scope, expectedRevision: bindingRevision,
        });
        expect(paused.binding).toMatchObject({ state: 'paused', invalidationReason: 'user-paused' });
        const idle = async () => !(await describe()).session.hasActiveRun;
        expect(await idle()).toBe(false);
        const stopped = await hostInvoke(app, 'sessions', 'stop', { ...scope, expectedSessionId: original.generation });
        expect(stopped).toMatchObject({ success: true, stopped: true, expectedSessionId: original.generation,
          resourceReclamation: { action: 'run-cancel' } });
        releaseProvider();
        await expect.poll(idle).toBe(true);
        const afterStop = store.get(original.taskNodeId);
        expect(afterStop).toMatchObject({ contract: { state: 'doing' }, checkpoint, claim: { epoch: original.epoch, state: 'active' } });
        const dispatch = () => hostInvoke<SessionDelegationResult>(app, 'sessions', 'dispatchPlanTask', {
          ...scope, expectedSessionGeneration: original.generation, planId: plan.taskNodeId, expectedRevision: plan.revision,
          expectedChildId: original.taskNodeId,
        });
        const pausedDispatch = await dispatch();
        expect(pausedDispatch).toMatchObject({ status: 'rejected', error: 'TASK_PROJECT_COORDINATOR_REQUIRED' });
        const completionAttempts = llm.log.length;
        store.beginOperation(original, 'control-pending-effect', 'write');
        const missingPausedReceipt = await hostInvoke(app, 'taskLedger', 'command', {
          workspaceId: project.workspaceId, command: { action: 'reconcile', credential: original,
            operationId: 'control-pending-effect', effectReceiptId: 'missing-control-receipt' },
        });
        expect(missingPausedReceipt).toMatchObject({ success: false, error: expect.stringContaining('TASK_EFFECT_RECEIPT_UNAVAILABLE') });
        const cancelTask = (generation = original.generation) => hostInvoke<{ success: boolean; error?: string; result?: TaskView }>(app, 'taskLedger', 'command', {
          workspaceId: project.workspaceId, command: { action: 'cancel', credential: { ...original, generation } },
        });
        const staleCancel = await cancelTask('earlier-generation');
        expect(staleCancel).toMatchObject({ success: false, error: 'TASK_GENERATION_STALE' });
        const cancel = await cancelTask();
        expect(cancel.error).toBeUndefined();
        expect(cancel).toMatchObject({ success: true, result: { contract: { state: 'cancelling' }, pendingOperations: 1 } });
        const whileCancelling = store.get(original.taskNodeId);
        expect(whileCancelling).toMatchObject({ contract: { state: 'cancelling' }, checkpoint, pendingOperations: 1 });
        expect(() => store.beginOperation(original, 'late-write', 'write')).toThrow('TASK_EXECUTION_NOT_RUNNING');
        store.finishOperation(original, 'control-pending-effect', 'completed', 'Fixture effect owner settled the write');
        const cancelled = store.get(original.taskNodeId);
        expect(cancelled).toMatchObject({ contract: { state: 'cancelled' }, checkpoint, pendingOperations: 0,
          claim: { epoch: original.epoch + 1, state: 'released' } });
        const unpaused = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
          ...bindingInput, expectedRevision: paused.binding!.bindingRevision,
        });
        expect(unpaused.recovery.state).toBe('ready');
        const cancelledDispatch = await dispatch();
        expect(cancelledDispatch).toMatchObject({ status: 'rejected', error: 'TASK_PROJECT_NO_READY_CHILD' });
        expect(llm.log).toHaveLength(completionAttempts);
        await writeFile(info.outputPath('project-control-readback.json'), `${JSON.stringify({
          driven_by: 'agent', actor: 'playwright-project-controls', sourceCandidate, original, activeRun,
          paused, stopped, afterStop, pausedDispatch, missingPausedReceipt, staleCancel, whileCancelling, cancelled, cancelledDispatch,
          events: store.history(original.taskNodeId), modelCallsAfterStop: completionAttempts, modelCallsAfterCancel: llm.log.length,
        }, null, 2)}\n`);
        return;
      }
      const toolCallId = 'fixture-write';
      const operationId = `${sent.result.runId}:${toolCallId}`;
      const effectPath = join(root, 'unconfirmed.txt');
      const effectBytes = 'A fixture write with a missing effect receipt.\n';
      if (unknownEffect) {
        store.beginOperation(original, operationId, 'write');
        await writeFile(effectPath, effectBytes, { flag: 'wx' });
        store.finishOperation(original, operationId, 'unknown', 'Fixture lost the effect acknowledgement');
      }
      await hostInvoke(app, 'gateway', 'stop');
      releaseProvider();
      await startGateway(app);
      const nextGateway = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      expect(nextGateway.pid).toBeGreaterThan(0);
      expect(nextGateway.pid).not.toBe(priorGateway.pid);
      let effectReadback: unknown;
      if (unknownEffect) {
        await expect.poll(async () => (await describe()).session.status, { timeout: 75_000 }).toBe('failed');
        expect(automaticRecoveryCalls).toBe(0);
        const blocked = store.get(original.taskNodeId);
        expect(blocked).toMatchObject({ checkpoint, pendingOperations: 1, pendingOperationDetails: [{ operationId, state: 'unknown' }] });
        expect(store.history(original.taskNodeId).some(event => event.kind === 'interrupted_run_replaced')).toBe(false);
        const reconcile = (effectReceiptId: string, generation = original.generation) => hostInvoke(app, 'gateway', 'rpc', {
          method: 'tasks.contract.reconcile', params: { workspaceDir: root, credential: { ...original, generation }, operationId, effectReceiptId },
        });
        await expect(reconcile('missing-fixture-receipt')).rejects.toThrow('TASK_EFFECT_RECEIPT_UNAVAILABLE');
        const observed = await readFile(effectPath);
        expect(observed.toString('utf8')).toBe(effectBytes);
        const sha256 = createHash('sha256').update(observed).digest('hex');
        const { EffectReceiptStore } = await import('../../openclaw_runtime/src/agents/effect-receipt');
        const { closeOpenClawStateDatabase } = await import('../../openclaw_runtime/src/state/openclaw-state-db');
        const receipts = new EffectReceiptStore({ path: join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite') });
        try {
          const receipt = receipts.record({ idempotencyKey: operationId, proposal: { sha256 }, outcome: 'applied',
            domainExecutor: 'playwright-fixture-write-owner', recoverability: 'owner-readback', stage1Context: {
              actor: { sessionKey: original.sessionKey, runId: sent.result.runId, attemptIndex: 1, modelCallIndex: 1, actorKind: 'principal' },
              effect: { toolCallId, toolName: 'write', resource: 'workspace:unconfirmed.txt', action: 'write' },
            } });
          expect(receipt.ok).toBe(true);
          const owner = receipts.getById(receipt.effectReceiptId);
          expect(owner?.outcome).toBe('applied');
          await expect(reconcile(receipt.effectReceiptId, 'stale-generation')).rejects.toThrow('TASK_GENERATION_STALE');
          expect(store.get(original.taskNodeId).pendingOperations).toBe(1);
          for (let replay = 0; replay < 2; replay++) expect(await reconcile(receipt.effectReceiptId)).toMatchObject({
            success: true, task: { checkpoint, pendingOperations: 0 },
          });
          const reconciled = store.history(original.taskNodeId).filter(event => event.kind === 'effect_reconciled');
          expect(reconciled).toHaveLength(1);
          expect(JSON.parse(reconciled[0].json)).toMatchObject({ operationId, receipt: { id: receipt.effectReceiptId, outcome: 'applied' } });
          effectReadback = { blocked, owner, sha256, reconciled, automaticRecoveryCalls };
        } finally {
          closeOpenClawStateDatabase();
        }
        const retry = await hostInvoke<{ success: boolean }>(app, 'chat', 'sendWithMedia', {
          workspaceId: project.workspaceId, sessionKey: project.sessionKey, message: reconciledPrompt, idempotencyKey: 'p3-restart-reconciled-turn',
        });
        expect(retry.success).toBe(true);
      }
      await expect.poll(() => store.get(original.taskNodeId).checkpoint, { timeout: 75_000 }).toEqual(resumed);
      await expect.poll(async () => {
        const history = await hostInvoke<{ messages: unknown[] }>(app, 'sessions', 'history', { sessionKey: project.sessionKey });
        return JSON.stringify(history.messages);
      }, { timeout: 30_000 }).toContain(marker);
      const after = await describe();
      expect(after.session.sessionId).toBe(project.generation);
      const writes = llm.log.filter(row => row.issued === 'restartwrite');
      expect(writes).toHaveLength(1);
      const recoveredTask = JSON.parse(writes[0].toolResults.restartread) as TaskView;
      const claim = { taskNodeId: original.taskNodeId, sessionKey: original.sessionKey,
        generation: original.generation, epoch: original.epoch };
      expect(recoveredTask).toMatchObject({ checkpoint, pendingOperations: 0, claim });
      const history = store.history(original.taskNodeId);
      const replacements = history.filter(event => event.kind === 'interrupted_run_replaced');
      expect(replacements).toHaveLength(1);
      expect(JSON.parse(replacements[0].json)).toMatchObject({ generation: original.generation, epoch: original.epoch,
        previousRunId: sent.result.runId, previousPid: priorGateway.pid, runId: expect.any(String), pid: nextGateway.pid });
      const checkpoints = history.filter(event => event.kind === 'checkpoint');
      expect(checkpoints.map(event => JSON.parse(event.json).nextAction)).toEqual([checkpoint.nextAction, resumed.nextAction]);
      expect(replacements[0].seq).toBeLessThan(checkpoints[1].seq);
      const finalTask = store.get(original.taskNodeId);
      expect(finalTask).toMatchObject({ checkpoint: resumed, pendingOperations: 0, claim });
      await writeFile(info.outputPath('project-restart-checkpoint.json'), `${JSON.stringify({
        driven_by: 'agent', actor: 'playwright-project-checkpoint-restart', sourceCandidate, project,
        priorGateway: priorGateway.pid, nextGateway: nextGateway.pid, interruptedRequests, originalRunId: sent.result.runId,
        inFlight: inFlight.session, resumedGeneration: after.session.sessionId,
        original, activeRun, recoveredTask, replacements, checkpoints, resumed: finalTask, effectReadback,
      }, null, 2)}\n`);
    } finally {
      store.close();
    }
  } finally {
    releaseProvider();
    await writeFile(info.outputPath('restart-provider.json'), JSON.stringify({ interruptedRequests, automaticRecoveryCalls, log: llm.log, anomalies: llm.anomalies }, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

test('dispatches the ready plan child through the project menu and reads its worker effect', async ({ launchElectronApp, userDataDir }, info) => {
  test.setTimeout(360_000);
  const sourceCandidate = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  const llm = await startScriptedLlm((text, results, _index, request) => {
    if (text.includes('A background task completed.') || text.includes('[Internal task completion event]')) {
      if (!Object.hasOwn(results, 'continuationwrite')) return {toolCall:{id:'continuationwrite',name:'write',
        args:{path:'continuation.txt',content:'Coordinator resumed from the worker result'}}};
      return {text:'Coordinator continuation finished.'};
    }
    if (text.includes('Write the rollback checklist') && request.model === 'mock-coder') return {rateLimited:true};
    if (text.includes('Write the rollback checklist') && !Object.hasOwn(results, 'workerwrite'))
      return {toolCall:{id:'workerwrite',name:'write',args:{path:'checklist.txt',content:'rollback checklist'}}};
    return {text:'Worker turn finished.'};
  });
  const app = await launchElectronApp({skipSetup:true});
  const diagnose = await observeSessionUi(app);
  const log: string[] = [];
  app.process().stdout?.on('data', data => log.push(String(data)));
  app.process().stderr?.on('data', data => log.push(String(data)));
  try {
    const page = await getStableWindow(app);
    await configureSessionChainProvider(app,llm.port);
    const secondary = `${getOpenClawProviderKeyForType('custom','custom-canarybackup')}/mock-backup`;
    const primary = 'custom-sessionc/mock-coder';
    const date = new Date().toISOString();
    expect(await hostInvoke(app,'providers','createAccount',{account:{id:'custom-canarybackup',vendorId:'custom',label:'Canary backup',authMode:'api_key',
      apiProtocol:'openai-completions',baseUrl:`http://127.0.0.1:${llm.port}/v1`,model:'mock-backup',enabled:true,isDefault:false,createdAt:date,updatedAt:date,
      modelProfile:{supportsReasoning:true,supportsVision:false,contextWindow:128000,maxTokens:4096}},apiKey:'local-fixture'})).toMatchObject({success:true});
    expect(await hostInvoke(app,'providers','updateAccount',{accountId:'custom-sessionc',updates:{fallbackAccountIds:['custom-canarybackup']}})).toMatchObject({success:true});
    expect(await hostInvoke(app,'agents','updateModel',{id:'main',modelRef:null})).toMatchObject({success:true});
    const root = info.outputPath('project');
    await mkdir(root, {recursive:true});
    execFileSync('git',['init','-b','main',root]);
    execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Fixture base']);
    const project = await createSessionChainProject(app,root,'Worker canary');
    const store = new TaskSystemStore(resolveTaskDomain(project.rootPath));
    const goal = {objective:'Write the rollback checklist',target:'checklist.txt',constraints:[],acceptance:[{
      id:'file',description:'Read the written checklist',verification:{kind:'file-sha256' as const,path:'checklist.txt',sha256:createHash('sha256').update('rollback checklist').digest('hex')},
    }]};
    try { store.saveProjectPlan(project,{goal,requestId:'fixture-plan',nextAction:goal.objective,children:[{key:'write',contract:goal}]}); }
    finally { store.close(); }
    const read = () => hostInvoke<TaskSessionSnapshot>(app,'taskLedger','sessionTask',{workspaceId:project.workspaceId,sessionKey:project.sessionKey,expectedSessionGeneration:project.generation});
    const revised = (await read()).projectPlan!;
    const dock = page.getByTestId('session-task-dock');
    const dispatch = { workspaceId:project.workspaceId,sessionKey:project.sessionKey,expectedSessionGeneration:project.generation,
      planId:revised.task.contract.taskNodeId,expectedRevision:revised.task.contract.revision,expectedChildId:revised.children[0].contract.taskNodeId };
    const noBudget = await hostInvoke<SessionDelegationResult>(app,'sessions','dispatchPlanTask',dispatch);
    expect(noBudget).toMatchObject({success:false,status:'rejected',error:'TASK_PROJECT_BUDGET_UNAVAILABLE'});
    expect((await read()).projectPlan?.children[0].claim).toBeNull();
    const config = await hostInvoke<{hash:string}>(app,'gateway','rpc',{method:'config.get',params:{}});
    await hostInvoke(app,'gateway','rpc',{method:'config.patch',params:{baseHash:config.hash,
      raw:JSON.stringify({runtime:{providerBudget:{project:{maxTokens:4_000_000}}},agents:{defaults:{subagents:{model:{primary,fallbacks:[secondary]}}}}}),note:'Fixture project token budget and child model policy'}});
    await hostInvoke(app,'gateway','stop');
    await startGateway(app);
    const effective = await hostInvoke<{config:{agents:{defaults:{model:{primary:string;fallbacks:string[]}}}}}>(app,'gateway','rpc',{method:'config.get',params:{}});
    expect(effective.config.agents.defaults.model).toMatchObject({primary,fallbacks:[secondary]});
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await dock.getByTestId('session-task-menu').click();
    await page.getByTestId('project-plan-dispatch').click();
    await expect.poll(async () => (await read()).projectPlan?.children[0].contract.state, {timeout:30_000}).toBe('doing');
    await expect(page.getByText('Worker accepted the task',{exact:true})).toBeVisible({timeout:60_000});
    const admission = await hostInvoke<SessionDelegationResult>(app,'sessions','dispatchPlanTask',dispatch);
    await writeFile(info.outputPath('project-worker-admission.json'), JSON.stringify({driven_by:'agent',actor:'playwright-project-worker',sourceCandidate,dispatch,noBudget,admission},null,2));
    expect(admission,admission.error).toMatchObject({success:true,replayed:true,receipt:{taskRef:dispatch.expectedChildId,completionObserved:false}});
    const child = admission.receipt!.children[0];
    expect(child.childSessionKey).toBeTruthy();
    const described = await hostInvoke<{session?:{thinkingLevel?:string}}>(app,'gateway','rpc',{method:'sessions.describe',params:{key:child.childSessionKey}});
    expect(described.session?.thinkingLevel).toBe('medium');
    await expect.poll(() => readFile(join(project.rootPath, 'checklist.txt'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }), {timeout:60_000}).toBe('rollback checklist');
    const workerHistory = await hostInvoke<{messages:unknown[];model?:string;costUsd?:number}>(app,'sessions','history',{
      sessionKey:child.childSessionKey,expectedParentSessionKey:project.sessionKey,agentId:'main'});
    expect(workerHistory.model).toBe(secondary);
    expect(JSON.stringify(workerHistory.messages)).toContain('workerwrite');
    const {DatabaseSync} = await import('node:sqlite');
    const usageDb = new DatabaseSync(join(userDataDir,'openclaw-source-state','state','openclaw.sqlite'), {readOnly:true});
    let usage;
    try { usage = usageDb.prepare(`SELECT provider,model,state,reserved_tokens,actual_tokens,actual_cost_micros,scope_json FROM provider_spend_calls
      WHERE json_extract(scope_json,'$.sessionKey')=? ORDER BY created_at`).all(child.childSessionKey!); } finally { usageDb.close(); }
    expect(usage.some(row=>row.model==='mock-backup' && Number(row.actual_tokens)>0)).toBe(true);
    expect(usage.every(row=>row.actual_cost_micros===null && Number(row.reserved_tokens)>0)).toBe(true);
    expect(llm.log.some(row=>row.model==='mock-coder' && row.issued==='http:429')).toBe(true);
    expect(llm.log.filter(row=>row.issued==='workerwrite')).toHaveLength(1);
    await expect.poll(() => readFile(join(project.rootPath,'continuation.txt'),'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }), {timeout:90_000}).toBe('Coordinator resumed from the worker result');
    await expect.poll(async () => {
      const activity = await hostInvoke<{session?:{hasActiveRun?:boolean}}>(app,'gateway','rpc',{
        method:'sessions.describe',params:{key:project.sessionKey}});
      return activity.session?.hasActiveRun;
    },{timeout:30_000}).toBe(false);
    const ownerHistory = await hostInvoke<{messages:unknown[]}>(app,'sessions','history',{sessionKey:project.sessionKey});
    expect(JSON.stringify(ownerHistory.messages)).toContain('continuationwrite');
    const callsBeforeRestart = llm.log.length;
    await hostInvoke(app,'gateway','stop');
    await startGateway(app);
    expect(await hostInvoke(app,'sessions','dispatchPlanTask',dispatch)).toMatchObject({success:true,replayed:true});
    const callsAfterRestart = llm.log.length;
    expect(callsAfterRestart).toBe(callsBeforeRestart);
    expect(llm.log.filter(row=>row.issued==='continuationwrite')).toHaveLength(1);
    const reset = await hostInvoke<{entry:{sessionId:string}}>(app,'gateway','rpc',{
      method:'sessions.reset',params:{key:project.sessionKey,reason:'reset'}});
    expect(reset.entry.sessionId).not.toBe(project.generation);
    await expect(hostInvoke(app,'gateway','rpc',{method:'agent',params:{
      sessionKey:project.sessionKey,sessionId:project.generation,expectedSessionId:project.generation,
      message:'A background task completed. Replay the old worker result.',deliver:false,
      idempotencyKey:'late-completion-after-reset',
    }})).rejects.toThrow(/AGENT_SESSION_GENERATION_STALE/);
    expect(llm.log.length).toBe(callsAfterRestart);
    const current = await hostInvoke<{session?:{sessionId?:string}}>(app,'gateway','rpc',{
      method:'sessions.describe',params:{key:project.sessionKey}});
    expect(current.session?.sessionId).toBe(reset.entry.sessionId);
    await writeFile(info.outputPath('project-continuation.json'),JSON.stringify({
      driven_by:'agent',actor:'playwright-project-continuation',sourceCandidate,
      coordinator:project.sessionKey,originalGeneration:project.generation,replacementGeneration:reset.entry.sessionId,
      callsBeforeRestart,callsAfterRestart,callsAfterLateCompletion:llm.log.length,
      coordinatorWriteCalls:llm.log.filter(row=>row.issued==='continuationwrite').length,
      continuationSha256:createHash('sha256').update(await readFile(join(project.rootPath,'continuation.txt'))).digest('hex'),
      ownerHistory,
    },null,2));
    await writeFile(info.outputPath('project-worker-execution.json'),JSON.stringify({driven_by:'agent',actor:'playwright-project-worker',sourceCandidate,
      childSessionKey:child.childSessionKey,childRunId:child.childRunId,thinkingLevel:described.session?.thinkingLevel??null,workerHistory,usage,allowedModels:[primary,secondary],fileSha256:createHash('sha256').update(await readFile(join(project.rootPath,'checklist.txt'))).digest('hex')},null,2));
  } catch (error) { await diagnose(name=>info.outputPath(name)); throw error; }
  finally {
    await writeFile(info.outputPath('provider-log.json'),JSON.stringify({log:llm.log,anomalies:llm.anomalies},null,2));
    await writeFile(info.outputPath('native-log.txt'),log.join(''));
    await hostInvoke(app,'gateway','stop').catch(()=>undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve=>llm.server.close(()=>resolve()));
  }
});
