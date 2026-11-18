import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';
import type { ProjectPlanSnapshot, TaskEvidence, TaskSessionSnapshot } from '../../shared/task-system/types';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { getOpenClawProviderKeyForType } from '../../electron/utils/provider-keys';
import type { SessionDelegationResult } from '../../shared/types/session-delegation';

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
