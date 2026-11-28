// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { migrateExecutionEnvironment, type MigrationRuntimeOwner, type MigrationWorkspaceOwner } from '../../electron/services/execution-migration';
import type { ExecutionMigrationOperation, SessionExecutionMigrationReceipt, SessionExecutionMigrationRequest } from '../../shared/types/execution-migration';
import type { WorkspaceCoordinatorBinding, WorkspaceProfile } from '../../shared/types/workspace';
import { createExecutionTaskAccess, openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { registerExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { resolveExecutionCheckout } from '../../openclaw_runtime/src/agents/worktree-service';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { canonicalPath } from '../../shared/task-system/identity';

let root:string,sourceRoot:string,targetRoot:string,operationPath:string,sessionPath:string;
let source:WorkspaceProfile,target:WorkspaceProfile,initial:WorkspaceCoordinatorBinding,taskId:string;
let failPhase:ExecutionMigrationOperation['phase']|undefined,lostPrepare=false,lostConfirm=false,busy=false;
let failPublish=false,lostPublish=false;
const key='agent:main:migrating',generation='source-generation';
const now='2026-11-09T00:00:00Z';
const read=()=>JSON.parse(readFileSync(operationPath,'utf8')) as ExecutionMigrationOperation|null;
const save=(operation:ExecutionMigrationOperation|null)=>writeFileSync(operationPath,JSON.stringify(operation));
const payload=()=>({workspaceId:'source',targetWorkspaceId:'target',sessionKey:key,operationId:'migration-1',expectedSessionGeneration:generation,expectedBindingRevision:1});
const owner=():MigrationWorkspaceOwner=>({
 read:async()=>({source,target,operation:read()}),
 save:async operation=>{save(operation);if(failPhase===operation.phase){failPhase=undefined;throw new Error('simulated crash after '+operation.phase);}},
 fence:async()=>{initial={...initial,state:'invalid',bindingRevision:2,invalidationReason:'execution-migration:migration-1'};},
 bind:async(operation,active)=>{
  if(active&&failPublish){failPublish=false;throw new Error('interrupted before publication');}
  const binding={...initial,workspaceId:target.id,sessionGeneration:operation.targetGeneration,bindingRevision:3,
   state:active?'active':'paused',environment:{...initial.environment,canonicalRoot:targetRoot},invalidationReason:active?null:'execution-migration:migration-1'} as WorkspaceCoordinatorBinding;
  target.coordinatorBindings={[key]:binding};if(active){save({...operation,phase:'confirmed'});
   if(lostPublish){lostPublish=false;throw new Error('lost publication reply');}}
  return binding;
 },
});
const runtime=():MigrationRuntimeOwner=>({rpc:async<T>(method:string,params:Record<string,unknown>)=>{
 const session=JSON.parse(readFileSync(sessionPath,'utf8')) as {generation:string;root:string;receipt?:SessionExecutionMigrationReceipt;request?:SessionExecutionMigrationRequest};
 if(method==='sessions.describe')return{session:{sessionId:session.generation,hasActiveRun:false}} as T;
 if(method==='taskScope.runState')return{quiescent:!busy} as T;
 const request=params as unknown as SessionExecutionMigrationRequest;
 if(session.request&&JSON.stringify(session.request)!==JSON.stringify(request))throw new Error('runtime request conflict');
 if(method==='taskScope.migration.prepare'){
  if(!session.receipt){const transcript=join(root,'target-transcript.jsonl');copyFileSync(join(root,'source-transcript.jsonl'),transcript);
   session.generation=request.targetGeneration;session.root=request.targetRoot;session.request=request;
   session.receipt={...request,state:'prepared',transcriptPath:transcript,transcriptSha256:createHash('sha256').update(readFileSync(transcript)).digest('hex')};
   writeFileSync(sessionPath,JSON.stringify(session));}
  if(lostPrepare){lostPrepare=false;throw new Error('lost prepare reply');}return session.receipt as T;
 }
 if(method==='taskScope.migration.confirm'){
  const store=openExecutionTaskStore(targetRoot);try{const task=store.get(taskId);expect(task.claim?.generation).toBe(request.targetGeneration);}finally{store.close();}
  session.receipt={...session.receipt!,state:'confirmed'};writeFileSync(sessionPath,JSON.stringify(session));
  if(lostConfirm){lostConfirm=false;throw new Error('lost confirm reply');}return session.receipt as T;
 }
 throw new Error('Unexpected '+method);
}});
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),'migration-main-'));sourceRoot=join(root,'source');targetRoot=join(root,'target');
 for(const cwd of [sourceRoot,targetRoot]){mkdirSync(cwd);execFileSync('git',['init','-q'],{cwd,windowsHide:true,stdio:'pipe'});}
 vi.stubEnv('OPENCLAW_STATE_DIR',join(root,'state'));
 operationPath=join(root,'operation.json');save(null);sessionPath=join(root,'session.json');writeFileSync(sessionPath,JSON.stringify({generation,root:sourceRoot}));
 writeFileSync(join(root,'source-transcript.jsonl'),'recorded objective and prior result\n');
 const store=openExecutionTaskStore(sourceRoot);
 try{const task=store.start({contract:{objective:'Continue original objective',target:'result.txt',constraints:['Retain prior result'],
   acceptance:[{id:'check',description:'Owner verification',verification:{kind:'owner-receipt',owner:'test-verifier'}}]}},key,generation,'start');taskId=task.contract.taskNodeId;
   const artifact=join(sourceRoot,'result.txt');writeFileSync(artifact,'retained');store.checkpoint(task.claim!,{completed:['initial work'],nextAction:'continue',unresolved:[],artifacts:[{path:artifact,sha256:createHash('sha256').update('retained').digest('hex')}]});
 }finally{store.close();}
 registerExecutionDomain({workspaceRoot:targetRoot,authorityRoot:sourceRoot,actor:'agent-fixture',operationId:'registration',expectedRevision:0,projectRevision:1});
 initial={schemaVersion:1,workspaceId:'source',agentId:'main',sessionKey:key,sessionGeneration:generation,activeTaskNodeId:taskId,taskLedgerReferences:[],
  environment:{kind:'local',backend:'git',canonicalRoot:sourceRoot,branch:'main',detachedHead:false,setupProfile:null},archiveRestorePolicy:'restore',state:'active',bindingRevision:1,invalidationReason:null,createdAt:now,updatedAt:now};
 source={id:'source',name:'Source',rootPath:sourceRoot,agentId:'main',activeSessionKey:key,permissionMode:'fullAccess',state:{},coordinatorBindings:{[key]:initial},createdAt:1,updatedAt:1,lastOpenedAt:1};
 target={...source,id:'target',name:'Target',rootPath:targetRoot,coordinatorBindings:{}};
 failPhase=undefined;lostPrepare=false;lostConfirm=false;busy=false;failPublish=false;lostPublish=false;
});
afterEach(()=>{closeOpenClawStateDatabaseForTest();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});

describe('Main environment migration composition',()=>{
 it('retains exact material and original run references after a lost task-transfer acknowledgement',async()=>{
  const sourceStore=openExecutionTaskStore(sourceRoot);
  let material;
  try{material=sourceStore.publishSharedMaterial(sourceStore.get(taskId).claim!,{id:'migration-finding',kind:'claim',summary:'Original finding',
    sensitivity:'internal',evidenceRefs:[]},'source-run',()=>({workspaceId:'source',projectId:'source',sessionKey:key,sessionGeneration:generation}) as never);}
  finally{sourceStore.close();}
  failPhase='task-committed';await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('simulated crash');
  const pending=read()!;const result=await migrateExecutionEnvironment(payload(),owner(),runtime());
  expect(result.targetGeneration).toBe(pending.targetGeneration);expect(result.id).toBe(pending.id);
  const targetStore=openExecutionTaskStore(targetRoot);
  try{const records=targetStore.collaborationContinuity(key,result.targetGeneration,taskId);
   expect(records).toHaveLength(1);expect(records[0]).toMatchObject({kind:'migration',sourceGeneration:generation,
    materials:[{source:{workspaceId:'source',sessionGeneration:generation},ref:{id:material.id,contentDigest:material.contentDigest}}]});
   expect(()=>targetStore.binding(key,generation)).toThrow('TASK_GENERATION_STALE');
  }finally{targetStore.close();}
 });
 it.each(['intent','fenced','drained','reserved','session-committed','task-committed','binding-committed'] as const)('resumes after durable %s without changing task identity',async phase=>{
  failPhase=phase;await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('simulated crash');
  const captured=read()!;closeOpenClawStateDatabaseForTest();
  const result=await migrateExecutionEnvironment(payload(),owner(),runtime());
  expect(result.phase).toBe('confirmed');expect(result.targetGeneration).toBe(captured.targetGeneration);expect(result.sessionKey).toBe(key);
  expect(result.reservationReleased).toBe(true);expect(read()?.reservationReleased).toBe(true);
  const store=openExecutionTaskStore(targetRoot);try{const task=store.get(taskId);expect(task.contract.objective).toBe('Continue original objective');expect(task.claim?.epoch).toBe(3);
    expect(task.claim?.generation).toBe(result.targetGeneration);expect(task.claim?.worktree).toBe(createExecutionTaskAccess(targetRoot).domain.worktree);expect(task.checkpoint?.artifacts).toHaveLength(1);}finally{store.close();}
  expect(readFileSync(join(sourceRoot,'result.txt'),'utf8')).toBe('retained');expect(readFileSync(result.runtimeReceipt!.transcriptPath,'utf8')).toContain('recorded objective');
  expect(resolveExecutionCheckout(targetRoot).service.writer(null)?.state).toBe('released');
 });
 it.each(['prepare','confirm'])('recovers a lost %s reply through the same Runtime operation',async stage=>{
  lostPrepare=stage==='prepare';lostConfirm=stage==='confirm';
  await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('lost '+stage+' reply');
  const saved=read()!;const result=await migrateExecutionEnvironment(payload(),owner(),runtime());
  expect(result.targetGeneration).toBe(saved.targetGeneration);expect(result.targetCredential?.epoch).toBe(3);
 });
 it('rejects changed request payload and retains unresolved resources',async()=>{
  busy=true;await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('MIGRATION_RESOURCES_PENDING');
  await expect(migrateExecutionEnvironment({...payload(),targetWorkspaceId:'another'},owner(),runtime())).rejects.toThrow('MIGRATION_REQUEST_CONFLICT');
  expect(read()?.phase).toBe('fenced');expect(JSON.parse(readFileSync(sessionPath,'utf8')).generation).toBe(generation);
 });
 it('holds target exclusion until publication and never releases a later writer on replay',async()=>{
  failPublish=true;await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('interrupted before publication');
  const checkout=resolveExecutionCheckout(targetRoot);
  const other={kind:'run' as const,agentId:'main',sessionGeneration:'other-generation',bindingRevision:1,
   run:normalizeRunScope({runId:'other-run',scope:{workspaceId:target.id,sessionKey:'agent:main:other'}})};
  expect(()=>checkout.service.claimWriter(checkout.worktreeId,checkout.basis.generation,other,'other-before')).toThrow('checkout_writer_busy');
  const result=await migrateExecutionEnvironment(payload(),owner(),runtime());expect(result.phase).toBe('confirmed');
  const next=checkout.service.claimWriter(checkout.worktreeId,checkout.basis.generation,other,'other-after');
  expect((await migrateExecutionEnvironment(payload(),owner(),runtime())).targetGeneration).toBe(result.targetGeneration);
  expect(checkout.service.writer(checkout.worktreeId)?.token).toBe(next.token);
  expect(checkout.service.writer(checkout.worktreeId)?.state).toBe('active');
 });
 it('reconciles an already published operation after its reply is lost',async()=>{
  lostPublish=true;expect((await migrateExecutionEnvironment(payload(),owner(),runtime())).phase).toBe('confirmed');
  expect(resolveExecutionCheckout(targetRoot).service.writer(null)?.state).toBe('released');
 });
 it.each([false,true])('settles a durable task receipt before pausing (previous pause=%s)',async previouslyPaused=>{
  const store=openExecutionTaskStore(sourceRoot),task=store.get(taskId),claim=task.claim!;
  const checkout=resolveExecutionCheckout(sourceRoot);
  const writer=checkout.service.claimWriter(checkout.worktreeId,checkout.basis.generation,{kind:'run',agentId:'main',sessionGeneration:generation,
   bindingRevision:1,run:normalizeRunScope({runId:'prior-run',scope:{workspaceId:source.id,sessionKey:key}}),
   task:{authorityId:store.domain.id,taskNodeId:taskId,epoch:claim.epoch,contractRevision:task.contract.revision}},'prior-writer');
  checkout.service.beginWrite(writer,'prior-write','prior-input');store.beginOperation(claim,'prior-write','write');
  store.finishOperation(claim,'prior-write','completed','written');
  if(previouslyPaused){failPhase='fenced';await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('simulated crash');
   store.control(claim,'pause');expect(()=>store.beginOperation(claim,'stale-write','write')).toThrow();}
  store.close();closeOpenClawStateDatabaseForTest();
  const result=await migrateExecutionEnvironment(payload(),owner(),runtime());expect(result.phase).toBe('confirmed');
  const settled=checkout.service.writer(checkout.worktreeId);expect(settled?.operations[0].state).toBe('settled');
  expect(settled?.state).toBe('released');expect(()=>checkout.service.beginWrite(writer,'stale-write','input')).toThrow();
 });
 it('retains unknown task effects without advancing the claim',async()=>{
  const store=openExecutionTaskStore(sourceRoot),claim=store.get(taskId).claim!;
  store.beginOperation(claim,'unknown-write','write');store.finishOperation(claim,'unknown-write','unknown','reply lost');store.close();
  await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('MIGRATION_EFFECTS_PENDING');
  const readback=openExecutionTaskStore(sourceRoot);try{expect(readback.get(taskId).claim?.epoch).toBe(claim.epoch);}finally{readback.close();}
 });
 it('binds relative checkpoint artifacts to the source checkout across recovery',async()=>{
  const store=openExecutionTaskStore(sourceRoot),task=store.get(taskId);
  store.checkpoint(task.claim!,{...task.checkpoint!,artifacts:[{path:'result.txt',sha256:createHash('sha256').update('retained').digest('hex')}]});store.close();
  writeFileSync(join(targetRoot,'result.txt'),'other checkout content');
  failPhase='task-committed';await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('simulated crash');
  const result=await migrateExecutionEnvironment(payload(),owner(),runtime());
  expect(canonicalPath(result.confirmation!.candidateArtifacts[0].path)).toBe(canonicalPath(join(sourceRoot,'result.txt')));
  const readback=openExecutionTaskStore(targetRoot);try{expect(canonicalPath(readback.get(taskId).checkpoint!.artifacts[0].path)).toBe(canonicalPath(join(sourceRoot,'result.txt')));}finally{readback.close();}
 });
 it('recovers its quiescent target claim after the saved migration outlives its lease',async()=>{
  failPhase='binding-committed';await expect(migrateExecutionEnvironment(payload(),owner(),runtime())).rejects.toThrow('simulated crash');
  const prior=read()!.targetCredential!,clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+180_000);
  try{
   const result=await migrateExecutionEnvironment(payload(),owner(),runtime());
   expect(result.phase).toBe('confirmed');expect(result.targetCredential?.epoch).toBe(prior.epoch+1);
   expect(result.reservationReleased).toBe(true);
   const ledger=openExecutionTaskStore(targetRoot);try{expect(()=>ledger.beginOperation(prior,'stale-after-recovery','write')).toThrow('TASK_STALE_OWNER');}finally{ledger.close();}
  }finally{clock.mockRestore();}
 });
});
