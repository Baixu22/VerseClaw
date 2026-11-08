// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionTaskEffectRequest } from '../../shared/session-task-scope';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { createExecutionTaskAccess, createExecutionTaskGuard, openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { admitExecutionCheckout } from '../../openclaw_runtime/src/agents/execution-checkout-admission';
import { executeManagedTaskTool, finishExecutionCheckoutRun, reconcileExecutionCheckout } from '../../openclaw_runtime/src/agents/execution-checkout-tools';
import { clearSessionTaskScopeRun, sessionTaskEffectsInFlight, sessionTaskOperationsInFlight } from '../../openclaw_runtime/src/agents/session-task-scope';
import { resolveExecutionCheckout } from '../../openclaw_runtime/src/agents/worktree-service';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { finishPersistentTaskRun } from '../../shared/task-system/runtime';
import { TaskSystemStore } from '../../shared/task-system/store';
import { admitManagedProcess, resetManagedProcessCapacity } from '../../openclaw_runtime/src/agents/verseshell/managed-process-capacity';
import { toToolDefinitions } from '../../openclaw_runtime/src/agents/agent-tool-definition-adapter';
import { wrapToolWithBeforeToolCallHook } from '../../openclaw_runtime/src/agents/agent-tools.before-tool-call';
import { returnPersistentTaskWriter } from '../../openclaw_runtime/src/agents/persistent-task-delegation';

const bridge=vi.hoisted(()=>({call:vi.fn()}));
const sessionGenerations=vi.hoisted(()=>new Map<string,string>());
vi.mock('../../openclaw_runtime/src/gateway/call',()=>({callGateway:(...args:unknown[])=>bridge.call(...args)}));
vi.mock('../../openclaw_runtime/src/config/sessions/store',async importOriginal=>({
  ...await importOriginal<typeof import('../../openclaw_runtime/src/config/sessions/store')>(),
  getSessionEntry:({sessionKey}:{sessionKey:string})=>sessionGenerations.has(sessionKey)?{sessionId:sessionGenerations.get(sessionKey)}:undefined,
}));
let root:string;
const executions:Array<{sessionKey:string;sessionId:string;runId:string;workspaceDir:string}>=[];
const endedRuns = new Set<string>();
function execution(name:string){const value={sessionKey:`agent:main:${name}`,sessionId:`generation-${name}`,runId:`${name}-${randomUUID()}`,workspaceDir:root};executions.push(value);sessionGenerations.set(value.sessionKey,value.sessionId);return value;}
function start(context:ReturnType<typeof execution>){const store=openExecutionTaskStore(root);try{return store.start({contract:{objective:context.sessionKey,target:'result.txt',constraints:['Retain earlier work'],
 acceptance:[{id:'owner',description:'Owner receipt',verification:{kind:'owner-receipt',owner:'test-verifier'}}]}},context.sessionKey,context.sessionId,context.runId).claim!;}finally{store.close();}}
function invoke(context:ReturnType<typeof execution>,call:string,body:()=>Promise<unknown>,tool='write',params:unknown={}){
 return executeManagedTaskTool(context,createExecutionTaskGuard(root,context.sessionKey,context.sessionId,context.runId),call,tool,params,undefined,body);
}
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),'joint-effect-'));executions.length=0;endedRuns.clear();sessionGenerations.clear();
 vi.stubEnv('OPENCLAW_STATE_DIR',join(root,'runtime-state'));vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE','1');
 bridge.call.mockImplementation(async({params:request}:{params:SessionTaskEffectRequest})=>{
  const context=executions.find(value=>value.runId===request.runId);
  if(!context||context.sessionKey!==request.sessionKey||context.sessionId!==request.sessionGeneration)throw new Error('TASK_SCOPE_RUN_STALE');
  if(request.expectedExecutionRevision!==undefined&&request.expectedExecutionRevision!==1)throw new Error('TASK_SCOPE_BINDING_FENCED');
  const access=createExecutionTaskAccess(root),store=openExecutionTaskStore(root);
  let task;try{task=store.binding(context.sessionKey,context.sessionId);if(!task?.claim||task.referenceOnly)throw new Error('TASK_REFERENCE_READ_ONLY');store.assertOwner(task.claim);}finally{store.close();}
  const claim={id:task.claim.attemptId,taskNodeId:task.contract.taskNodeId,credential:task.claim,
    run:normalizeRunScope({runId:request.runId,scope:{workspaceId:'workspace',sessionKey:request.sessionKey}}),
    sessionGeneration:request.sessionGeneration,executionRevision:1,createdAt:new Date().toISOString()};
  if(request.expectedClaimId&&request.expectedClaimId!==claim.id)throw new Error('TASK_SCOPE_WRITER_FENCED');
  if(request.checkoutAccess!=='write')return{status:'granted',claim,bindingRevision:1};
  const granted=await admitExecutionCheckout({workspaceRoot:root,authority:access.basis,task,claim,agentId:'main',operationId:request.operationId!,
    observeRun:async owner=>({active:!endedRuns.has(owner.run.runId),quiescent:endedRuns.has(owner.run.runId),inFlightEffects:sessionTaskEffectsInFlight(owner.run.runId),
      inFlightOperationIds:sessionTaskOperationsInFlight(owner.run.runId),inFlightProcesses:0})});
  return{status:'granted',claim,bindingRevision:1,checkout:granted.checkout};
 });
});
afterEach(async()=>{
 for(const context of executions){try{finishExecutionCheckoutRun(context.runId);}catch{};try{finishPersistentTaskRun(root,context.sessionKey,context.runId);}catch{};clearSessionTaskScopeRun(context.runId);}
 await Promise.resolve();resetManagedProcessCapacity();vi.restoreAllMocks();closeOpenClawStateDatabaseForTest();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});
});

describe('joint task and checkout effect boundary',()=>{
 it('retains one writer between tool calls and refuses another task before touching its file',async()=>{
  const first=execution('one'),second=execution('two');start(first);start(second);
  const file=join(root,'result.txt');
  await invoke(first,'write-1',async()=>{writeFileSync(file,'one');return{details:{status:'completed'}};});
  const intruder=vi.fn(async()=>{writeFileSync(file,'intruder');return{};});
  await expect(invoke(second,'write',intruder)).rejects.toThrow(/writer_busy/);
  expect(intruder).not.toHaveBeenCalled();expect(readFileSync(file,'utf8')).toBe('one');
  await invoke(first,'write-2',async()=>{writeFileSync(file,'two');return{};});
  const target=resolveExecutionCheckout(root);expect(target.service.writer(null)?.operations).toHaveLength(2);
  finishExecutionCheckoutRun(first.runId);expect(target.service.writer(null)?.state).toBe('released');
  await invoke(second,'write',intruder);expect(readFileSync(file,'utf8')).toBe('intruder');
 });
 it('retains unknown writes until the exact task owner receipt reconciles them',async()=>{
  const context=execution('unknown'),claim=start(context),file=join(root,'partial.txt');
  await expect(invoke(context,'partial',async()=>{writeFileSync(file,'partial');throw new Error('ack lost');})).rejects.toThrow('ack lost');
  const target=resolveExecutionCheckout(root),held=target.service.writer(null)!;
  expect(held.state).toBe('draining');expect(()=>target.service.releaseWriter(held)).toThrow(/operations_pending/);
  finishExecutionCheckoutRun(context.runId);expect(target.service.writer(null)?.state).toBe('draining');
  const store=openExecutionTaskStore(root);try{store.reconcileOperation(claim,`${context.runId}:partial`,{id:'file-owner-confirmed',outcome:'applied',owner:'test-file-owner'});}finally{store.close();}
  reconcileExecutionCheckout({baseRoot:root,worktreeId:null,credential:held});
  expect(target.service.writer(null)?.state).toBe('released');expect(readFileSync(file,'utf8')).toBe('partial');
 });
 it.each(['sessions_spawn','mission_loop','task_loop'])('transfers to a canonical child while the parent %s call is still active',async dispatchTool=>{
  const parent=execution('parent'),child=execution('child'),parentClaim=start(parent);
  await invoke(parent,'write',async()=>{writeFileSync(join(root,'result.txt'),'parent');return{};});
  const parentWriter=resolveExecutionCheckout(root).service.writer(null)!;
  await invoke(parent,'spawn',async()=>{
    const store=openExecutionTaskStore(root);try{store.prepareWriterDelegation(parentClaim,{delegationId:'dispatch',childSessionKey:child.sessionKey,
      childGeneration:child.sessionId,childWorktree:root,childRunId:child.runId,mode:'writer'});}finally{store.close();}
    await invoke(child,'write',async()=>{writeFileSync(join(root,'result.txt'),'child');return{};});
    return{details:{status:'accepted'}};
  },dispatchTool);
  const target=resolveExecutionCheckout(root),current=target.service.writer(null)!;
  expect(current.owner.kind==='run'&&current.owner.run.runId).toBe(child.runId);
  expect(current.epoch).toBe(parentWriter.epoch+1);
  expect(()=>target.service.beginWrite(parentWriter,'late','digest')).toThrow(/stale_credential/);
  expect(readFileSync(join(root,'result.txt'),'utf8')).toBe('child');
 });
 it('retains a returned child checkout for the canonical parent rather than a third task',async()=>{
  const parent=execution('return-parent'),child=execution('return-child'),claim=start(parent);
  await invoke(parent,'write',async()=>({}));
  await invoke(parent,'spawn',async()=>{
    const store=openExecutionTaskStore(root);try{store.prepareWriterDelegation(claim,{delegationId:'return-dispatch',childSessionKey:child.sessionKey,
      childGeneration:child.sessionId,childWorktree:root,childRunId:child.runId,mode:'writer'});}finally{store.close();}
    await invoke(child,'write',async()=>({}));return{};
  },'sessions_spawn');
  endedRuns.add(child.runId);finishExecutionCheckoutRun(child.runId);
  const store=openExecutionTaskStore(root);try{store.returnDelegatedWriter(child.sessionKey,{runId:child.runId,endedAt:Date.now(),outcome:'completed',parentGeneration:parent.sessionId});}finally{store.close();}
  const target=resolveExecutionCheckout(root),held=target.service.writer(null)!;
  expect(held.state).toBe('draining');
  const intruder=execution('return-intruder');start(intruder);
  await expect(invoke(intruder,'write',async()=>{throw new Error('should not execute');})).rejects.toThrow('checkout_writer_busy');
  const continuation={...parent,runId:'parent-continuation-'+randomUUID()};executions.push(continuation);
  await invoke(continuation,'write',async()=>{writeFileSync(join(root,'returned.txt'),'parent');return{};});
  expect(target.service.writer(null)!.epoch).toBe(held.epoch+1);
  expect(readFileSync(join(root,'returned.txt'),'utf8')).toBe('parent');
 });
 it('permits reuse after the returned parent explicitly releases its task ownership',async()=>{
  const parent=execution('release-parent'),child=execution('release-child'),claim=start(parent);
  await invoke(parent,'spawn',async()=>{
    const store=openExecutionTaskStore(root);try{store.prepareWriterDelegation(claim,{delegationId:'release-dispatch',childSessionKey:child.sessionKey,
      childGeneration:child.sessionId,childWorktree:root,childRunId:child.runId,mode:'writer'});}finally{store.close();}
    await invoke(child,'write',async()=>({}));return{};
  },'sessions_spawn');
  endedRuns.add(child.runId);finishExecutionCheckoutRun(child.runId);
  const store=openExecutionTaskStore(root);try{const returned=store.returnDelegatedWriter(child.sessionKey,{runId:child.runId,endedAt:Date.now(),outcome:'completed',parentGeneration:parent.sessionId});
    expect(returned?.phase).toBe('returned');store.control(store.get(claim.taskNodeId).claim!,'release');}finally{store.close();}
  const next=execution('released-successor');start(next);
  await invoke(next,'write',async()=>{writeFileSync(join(root,'successor.txt'),'successor');return{};});
  expect(readFileSync(join(root,'successor.txt'),'utf8')).toBe('successor');
 });
 it('retries deferred canonical return after the original process owner settles',async()=>{
  const parent=execution('pending-parent'),child=execution('pending-child'),claim=start(parent);
  await invoke(parent,'write',async()=>({}));
  const reservation=admitManagedProcess({identity:{sessionKey:child.sessionKey,sessionGeneration:child.sessionId,runId:child.runId}});
  expect(reservation.ok).toBe(true);
  await invoke(parent,'spawn',async()=>{
    const store=openExecutionTaskStore(root);try{store.prepareWriterDelegation(claim,{delegationId:'pending-dispatch',childSessionKey:child.sessionKey,
      childGeneration:child.sessionId,childWorktree:root,childRunId:child.runId,mode:'writer'});}finally{store.close();}
    await invoke(child,'exec',async()=>({details:{status:'running',sessionId:'child-process'}}),'exec',{command:'fixture'});return{};
  },'sessions_spawn');
  endedRuns.add(child.runId);finishExecutionCheckoutRun(child.runId);
  const deferred=returnPersistentTaskWriter({workspace:root,childSessionKey:child.sessionKey,runId:child.runId,
    endedAt:Date.now(),outcome:'completed',parentGeneration:parent.sessionId});
  expect(deferred?.phase).toBe('recovery_required');
  if(reservation.ok)reservation.lease.release();
  await invoke(child,'poll',async()=>({details:{status:'completed',sessionId:'child-process',exitCode:0}}),'process',{action:'poll',sessionId:'child-process'});
  const read=openExecutionTaskStore(root);try{
    expect(read.delegationForChild(child.sessionKey)?.phase).toBe('returned');
    expect(read.get(claim.taskNodeId).claim?.sessionKey).toBe(parent.sessionKey);
  }finally{read.close();}
  expect(resolveExecutionCheckout(root).service.writer(null)?.state).toBe('draining');
 });
 it('compensates both permits when cancellation happens before the raw effect',async()=>{
  const context=execution('cancel-before-effect'),claim=start(context),guard=createExecutionTaskGuard(root,context.sessionKey,context.sessionId,context.runId);
  const controller=new AbortController(),execute=vi.fn(async()=>({}));
  const original=TaskSystemStore.prototype.beginOperation;
  vi.spyOn(TaskSystemStore.prototype,'beginOperation').mockImplementation(function(this: TaskSystemStore,credential,id,kind){
    original.call(this,credential,id,kind);controller.abort();
  });
  await expect(executeManagedTaskTool(context,guard,'cancel','write',{},controller.signal,execute)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  const target=resolveExecutionCheckout(root),writer=target.service.writer(null)!;
  expect(writer.operations[0]).toMatchObject({state:'settled',receipt:{outcome:'not-applied'}});
  const store=openExecutionTaskStore(root);try{expect(store.get(claim.taskNodeId).pendingOperations).toBe(0);
    expect(store.operation(claim,`${context.runId}:cancel`).receipt?.outcome).toBe('not_applied');}finally{store.close();}
 });
 it('keeps background ownership until the process and task owners have both settled',async()=>{
  const context=execution('background');start(context);
  const process=admitManagedProcess({identity:{sessionKey:context.sessionKey,sessionGeneration:context.sessionId,runId:context.runId}});
  expect(process.ok).toBe(true);
  await invoke(context,'exec',async()=>({details:{status:'running',sessionId:'process-handle'}}),'exec',{command:'fixture'});
  const target=resolveExecutionCheckout(root);finishExecutionCheckoutRun(context.runId);
  await invoke(context,'poll',async()=>({details:{status:'completed',sessionId:'process-handle',exitCode:0}}),'process',{action:'poll',sessionId:'process-handle'});
  expect(target.service.writer(null)?.state).toBe('draining');
  if(process.ok)process.lease.release();
  await invoke(context,'poll-again',async()=>({details:{status:'completed',sessionId:'process-handle',exitCode:0}}),'process',{action:'poll',sessionId:'process-handle'});
  expect(target.service.writer(null)?.state).toBe('released');
 });
 it('rotates a recovered same-run writer without reviving its old token',async()=>{
  const context=execution('continuation');start(context);
  await invoke(context,'exec',async()=>({details:{status:'background',sessionId:'handle'}}),'exec',{command:'fixture'});
  const target=resolveExecutionCheckout(root),old=target.service.writer(null)!;
  await invoke(context,'poll',async()=>({details:{status:'completed',sessionId:'handle',exitCode:0}}),'process',{action:'poll',sessionId:'handle'});
  await invoke(context,'next-write',async()=>{writeFileSync(join(root,'continued.txt'),'continued');return{};});
  expect(target.service.writer(null)!.epoch).toBe(old.epoch+1);
  expect(()=>target.service.beginWrite(old,'late','late')).toThrow(/stale_credential/);
 });
 it('settles the exact completed process receipt after task cancellation advances the epoch',async()=>{
  const context=execution('cancel-background'),claim=start(context);
  await invoke(context,'exec',async()=>({details:{status:'running',sessionId:'cancel-handle'}}),'exec',{command:'fixture'});
  const store=openExecutionTaskStore(root);try{store.control(claim,'cancel');expect(store.get(claim.taskNodeId).contract.state).toBe('cancelling');}finally{store.close();}
  finishExecutionCheckoutRun(context.runId);
  await invoke(context,'poll',async()=>({details:{status:'killed',sessionId:'cancel-handle',exitCode:1}}),'process',{action:'poll',sessionId:'cancel-handle'});
  const read=openExecutionTaskStore(root);try{expect(read.get(claim.taskNodeId).contract.state).toBe('cancelled');expect(()=>read.assertOwner(claim)).toThrow();}finally{read.close();}
  expect(resolveExecutionCheckout(root).service.writer(null)?.state).toBe('released');
 });
 it('settles a process owner signal receipt without inventing a successful exit code',async()=>{
  const context=execution('signal-exit'),claim=start(context);
  await invoke(context,'exec',async()=>({details:{status:'running',sessionId:'signal-handle'}}),'exec',{command:'fixture'});
  finishExecutionCheckoutRun(context.runId);
  await invoke(context,'poll',async()=>({details:{status:'failed',sessionId:'signal-handle',exitCode:null,exitSignal:'SIGTERM'}}),'process',{action:'poll',sessionId:'signal-handle'});
  const read=openExecutionTaskStore(root);try{expect(read.get(claim.taskNodeId).pendingOperations).toBe(0);expect(read.get(claim.taskNodeId).contract.state).toBe('doing');}finally{read.close();}
  expect(resolveExecutionCheckout(root).service.writer(null)?.state).toBe('released');
 });
 it('rejects stale captured task credentials at the raw effect boundary',async()=>{
  const context=execution('stale'),claim=start(context),guard=createExecutionTaskGuard(root,context.sessionKey,context.sessionId,context.runId);
  const store=openExecutionTaskStore(root);try{store.control(claim,'release');store.claim(claim.taskNodeId,context.sessionKey,context.sessionId,'replacement');}finally{store.close();}
  const execute=vi.fn(async()=>{writeFileSync(join(root,'stale.txt'),'bad');return{};});
  await expect(executeManagedTaskTool(context,guard,'write','write',{},undefined,execute)).rejects.toThrow('TASK_STALE_OWNER');
  expect(execute).not.toHaveBeenCalled();
 });
 it('settles an unused grant from durable writer state when the run terminates before receiving its reply',async()=>{
  const context=execution('lost-grant'),claim=start(context),access=createExecutionTaskAccess(root);
  const store=openExecutionTaskStore(root);let task;try{task=store.get(claim.taskNodeId);}finally{store.close();}
  const granted=await admitExecutionCheckout({workspaceRoot:root,authority:access.basis,task,
    claim:{id:claim.attemptId,taskNodeId:claim.taskNodeId,credential:claim,run:normalizeRunScope({runId:context.runId,scope:{workspaceId:'workspace',sessionKey:context.sessionKey}}),
      sessionGeneration:context.sessionId,executionRevision:1,createdAt:new Date().toISOString()},agentId:'main',operationId:'never-dispatched',
    observeRun:async()=>({active:true,quiescent:false,inFlightEffects:1,inFlightProcesses:0})});
  expect(granted.unused).toBe(true);
  finishExecutionCheckoutRun(context.runId,{sessionKey:context.sessionKey,sessionGeneration:context.sessionId});
  expect(resolveExecutionCheckout(root).service.writer(null)?.state).toBe('released');
 });
 it.each([false,true])('guards the actual adapter path (hook wrapped: %s) exactly once',async wrapped=>{
  const context=execution(wrapped?'wrapped':'raw');start(context);
  const calls=vi.fn(async()=>{writeFileSync(join(root,'adapter.txt'),wrapped?'wrapped':'raw');return{content:[{type:'text',text:'written'}],details:{status:'completed'}};});
  const tool={name:'write',description:'fixture',parameters:{type:'object',properties:{}},execute:calls} as never;
  const selected=wrapped?wrapToolWithBeforeToolCallHook(tool,context):tool;
  const adapted=toToolDefinitions([selected],context)[0];
  await adapted.execute('adapter-call',{},undefined,undefined,{} as never);
  expect(calls).toHaveBeenCalledTimes(1);
  const target=resolveExecutionCheckout(root);expect(target.service.writer(null)?.operations).toHaveLength(1);
 });
});
