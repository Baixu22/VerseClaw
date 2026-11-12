import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { TaskView } from '../../shared/task-system/types';
import type { ExecutionMigrationOperation } from '../../shared/types/execution-migration';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

for(const interrupted of [false,true])test(`moves one logical session and its task to a linked checkout and continues after restart (interrupted=${interrupted})`,async({launchElectronApp},testInfo)=>{
 test.setTimeout(300_000);
 const sourceRoot=testInfo.outputPath('source'),targetRoot=testInfo.outputPath('target'),artifact=join(sourceRoot,'prior.txt'),output=join(targetRoot,'after.txt');
 await mkdir(sourceRoot,{recursive:true});
 const git=(...args:string[])=>execFileSync('git',args,{cwd:sourceRoot,windowsHide:true,stdio:'pipe'});
 git('init','-b','migration-fixture');git('-c','user.name=Agent fixture','-c','user.email=agent@example.invalid','commit','--allow-empty','-m','Migration fixture');
 git('worktree','add','--detach',targetRoot,'HEAD');await writeFile(artifact,'prior accepted progress\n');
 let wrote=false;
 const llm=await startScriptedLlm(text=>{
  if(text.includes('MIGRATE-WRITE')&&!wrote){wrote=true;return{toolCall:{id:'write-after-migration',name:'write',args:{path:output,content:'continued original task\n'}}};}
  return{text:'MIGRATION-FIXTURE-READY'};
 });
 let app=await launchElectronApp({skipSetup:true});
 const evidence:Record<string,unknown>={driven_by:'agent',actor:'playwright-migration',provider:'local-scripted',status:'running'};
 try{
  await configureSessionChainProvider(app,llm.port);
  const source=await createSessionChainProject(app,sourceRoot,'Migration source');
  const task=await createSessionChainTask(app,source.workspaceId,'migration-task',{objective:'Continue the same task in another checkout',target:'after.txt',constraints:['Retain prior progress'],
   acceptance:[{id:'file',description:'Output after migration',verification:{kind:'file-sha256',path:'after.txt',sha256:createHash('sha256').update('continued original task\n').digest('hex')}}]});
  await hostInvoke(app,'taskLedger','linkSession',{workspaceId:source.workspaceId,sessionKey:source.sessionKey,sessionGeneration:source.generation,nodeId:task.contract.taskNodeId});
  await hostInvoke(app,'workspaces','bindCoordinator',{workspaceId:source.workspaceId,sessionKey:source.sessionKey,agentId:'main',expectedRevision:0,
   taskLedgerNodeIds:[task.contract.taskNodeId],environment:{kind:'local',rootPath:sourceRoot},archiveRestorePolicy:'restore'});
  const claimed=await hostInvoke<{result:TaskView}>(app,'taskLedger','command',{workspaceId:source.workspaceId,command:{action:'claim',taskNodeId:task.contract.taskNodeId,sessionKey:source.sessionKey,requestId:'migration-claim'}});
  await hostInvoke(app,'taskLedger','command',{workspaceId:source.workspaceId,command:{action:'checkpoint',credential:claimed.result.claim,
   checkpoint:{completed:['Prior work retained'],nextAction:'Continue in target checkout',unresolved:[],artifacts:[{path:artifact,sha256:createHash('sha256').update(await readFile(artifact)).digest('hex')}]}}});
  await hostInvoke(app,'chat','sendWithMedia',{workspaceId:source.workspaceId,sessionKey:source.sessionKey,message:'MIGRATE-INITIAL',idempotencyKey:'migration-initial'});
  await expect.poll(async()=>JSON.stringify(await hostInvoke(app,'gateway','rpc',{method:'chat.history',params:{sessionKey:source.sessionKey,limit:30}})).includes('MIGRATION-FIXTURE-READY'),{timeout:60_000}).toBe(true);
  await expect.poll(async()=>(await hostInvoke<{session:{hasActiveRun:boolean}}>(app,'gateway','rpc',{method:'sessions.describe',params:{key:source.sessionKey}})).session.hasActiveRun).toBe(false);
  const target=await hostInvoke<{activeWorkspace:{id:string}}>(app,'workspaces','create',{name:'Migration target',rootPath:targetRoot,agentId:'main',activeSessionKey:'agent:main:target-placeholder',permissionMode:'fullAccess'});
  await hostInvoke(app,'workspaces','switch',{id:source.workspaceId});
  let page=await getStableWindow(app);await page.reload();
  if(interrupted){
   evidence.locales=[];
   for(const language of ['en','zh','ja','ru']){
    const labels=JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`,'utf8')).migration;
    await hostInvoke(app,'settings','set',{key:'language',value:language});await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await page.getByTestId('chat-toolbar-more').click(); await page.getByTestId('execution-migration-open').click();
    const dialog=page.getByTestId('execution-migration-dialog');
    await expect(dialog).toContainText(labels.title);await expect(dialog).toContainText(labels.description);
    await expect(page.getByTestId('execution-migration-start')).toHaveText(labels.start);
    const bounds=await dialog.boundingBox();expect(bounds?.width).toBeLessThanOrEqual(600);expect(bounds?.x).toBeGreaterThan(0);
    await page.screenshot({path:testInfo.outputPath(`migration-select-${language}.png`)});
    await dialog.getByRole('button',{name:labels.cancel,exact:true}).click();
    expect((await hostInvoke<{operation:null}>(app,'workspaces','executionMigration',{workspaceId:source.workspaceId,sessionKey:source.sessionKey})).operation).toBeNull();
    (evidence.locales as unknown[]).push({language,selection:'passed',closeWithoutMutation:true});
   }
   await writeFile(artifact,'artifact changed during migration\n');
  }
  await page.getByTestId('chat-toolbar-more').click(); await page.getByTestId('execution-migration-open').click();
  await page.getByTestId('execution-migration-target').click();
  await page.getByRole('option',{name:'Migration target',exact:true}).click();
  await page.getByTestId('execution-migration-start').click();
  if(interrupted){
   await expect.poll(async()=>{
    const pending=await hostInvoke<{operation:ExecutionMigrationOperation}>(app,'workspaces','executionMigration',{workspaceId:source.workspaceId,sessionKey:source.sessionKey});
    return pending.operation?.error;
   },{timeout:60_000}).toBe('MIGRATION_ARTIFACT_CHANGED');
   const pending=await hostInvoke<{operation:ExecutionMigrationOperation}>(app,'workspaces','executionMigration',{workspaceId:source.workspaceId,sessionKey:source.sessionKey});
   expect(pending.operation.phase).toBe('binding-committed');evidence.interruptedOperation=pending.operation;
   const retainedProfile=await app.evaluate(({app})=>app.getPath('userData'));
   await hostInvoke(app,'gateway','stop');await closeElectronApp(app);
   app=await launchElectronApp({skipSetup:true,profileDir:retainedProfile});
   await configureSessionChainProvider(app,llm.port);await hostInvoke(app,'gateway','start');
   await expect.poll(async()=>(await hostInvoke<{state:string}>(app,'gateway','status')).state,{timeout:60_000}).toBe('running');
   page=await getStableWindow(app);
   for(const language of ['en','zh','ja','ru']){
    const labels=JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`,'utf8')).migration;
    await hostInvoke(app,'settings','set',{key:'language',value:language});await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await expect(page.getByTestId('execution-migration-open')).toHaveAttribute('aria-label',labels.resume);
    await page.getByTestId('chat-toolbar-more').click(); await page.getByTestId('execution-migration-open').click();
    await expect(page.getByTestId('execution-migration-phase')).toHaveText(labels.phase['binding-committed']);
    await expect(page.getByTestId('execution-migration-dialog').getByRole('alert')).toContainText(labels.artifactChanged);
    await expect(page.getByTestId('execution-migration-target')).toBeDisabled();
    await expect(page.getByTestId('execution-migration-start')).toHaveText(labels.resume);
    await page.screenshot({path:testInfo.outputPath(`migration-resume-${language}.png`)});
    await page.getByTestId('execution-migration-dialog').getByRole('button',{name:labels.cancel,exact:true}).click();
   }
   await writeFile(artifact,'prior accepted progress\n');
   await page.getByTestId('chat-toolbar-more').click(); await page.getByTestId('execution-migration-open').click();await page.getByTestId('execution-migration-start').click();
  }
  await expect(page.getByTestId('execution-migration-dialog')).toHaveCount(0,{timeout:60_000});
  const moved=await hostInvoke<{operation:ExecutionMigrationOperation}>(app,'workspaces','executionMigration',{workspaceId:source.workspaceId,sessionKey:source.sessionKey});
  expect(moved.operation.phase).toBe('confirmed');expect(moved.operation.sessionKey).toBe(source.sessionKey);
  if(interrupted)expect(moved.operation.id).toBe((evidence.interruptedOperation as ExecutionMigrationOperation).id);
  expect(moved.operation.targetGeneration).not.toBe(source.generation);
  const before=await hostInvoke<{task:TaskView}>(app,'taskLedger','sessionTask',{workspaceId:target.activeWorkspace.id,sessionKey:source.sessionKey});
  expect(before.task.contract.taskNodeId).toBe(task.contract.taskNodeId);expect(before.task.claim?.generation).toBe(moved.operation.targetGeneration);
  expect(before.task.checkpoint?.artifacts[0].path).toBe(artifact);
  await page.screenshot({path:testInfo.outputPath('migration-complete.png')});
  const profileDir=await app.evaluate(({app})=>app.getPath('userData'));
  await hostInvoke(app,'gateway','stop');await closeElectronApp(app);
  app=await launchElectronApp({skipSetup:true,profileDir});
  await configureSessionChainProvider(app,llm.port);await hostInvoke(app,'gateway','start');
  await expect.poll(async()=>(await hostInvoke<{state:string}>(app,'gateway','status')).state,{timeout:60_000}).toBe('running');
  await hostInvoke(app,'chat','sendWithMedia',{workspaceId:target.activeWorkspace.id,sessionKey:source.sessionKey,message:'MIGRATE-WRITE',idempotencyKey:'migration-after'});
  await expect.poll(()=>readFile(output,'utf8').catch(()=>null),{timeout:60_000}).toBe('continued original task\n');
  expect(await readFile(artifact,'utf8')).toBe('prior accepted progress\n');
  const after=await hostInvoke<{task:TaskView}>(app,'taskLedger','sessionTask',{workspaceId:target.activeWorkspace.id,sessionKey:source.sessionKey});
  expect(after.task.contract.taskNodeId).toBe(task.contract.taskNodeId);
  Object.assign(evidence,{source,target:target.activeWorkspace.id,operation:moved.operation,before,after,status:'passed'});
 }catch(error){evidence.error=String(error);evidence.status='failed';throw error;}
 finally{evidence.providerLog=llm.log;await writeFile(testInfo.outputPath('migration.json'),JSON.stringify(evidence,null,2));
  await hostInvoke(app,'gateway','stop').catch(()=>undefined);await closeElectronApp(app);
  llm.server.closeAllConnections();await new Promise<void>(resolve=>llm.server.close(()=>resolve()));}
});
