// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import { createExecutionTaskAccess, createExecutionTaskGuard, openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { registerExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';
import { executeTaskGuarded, finishPersistentTaskRun } from '../../shared/task-system/runtime';

vi.mock('../../electron/services/workspaces-api', () => ({ getPersistedCoordinatorBinding: vi.fn(), getWorkspaceRootPathById: vi.fn() }));
import { readManagedSessionEffect, startManagedSessionEffect } from '../../electron/services/task-system-service';

let root: string, authority: string, clone: string;
const bytes='clone-owned artifact';
const contract={objective:'Write the registered checkout artifact',target:'result.txt',constraints:['One task owner'],
  acceptance:[{id:'artifact',description:'Exact bytes',verification:{kind:'file-sha256' as const,path:'result.txt',
    sha256:createHash('sha256').update(bytes).digest('hex')}}]};
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),'execution-authority-'));
 authority=join(root,'authority');clone=join(root,'clone');
 for(const path of [authority,clone]){mkdirSync(path);execFileSync('git',['init','-q'],{cwd:path,windowsHide:true,stdio:'pipe'});}
 vi.stubEnv('OPENCLAW_STATE_DIR',join(root,'runtime-state'));
});
afterEach(()=>{closeOpenClawStateDatabaseForTest();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
const register=(revision=0)=>registerExecutionDomain({workspaceRoot:clone,authorityRoot:authority,actor:'agent-test',
  operationId:'registration-'+revision,expectedRevision:revision,projectRevision:1});
function create(){const store=openExecutionTaskStore(authority);try{return store.create(contract,'create').task;}finally{store.close();}}

describe('registered authority reaches existing task owners',()=>{
 it('keeps independent clones separate until explicit registration',()=>{
  create();
  expect(createExecutionTaskAccess(clone).domain.id).not.toBe(createExecutionTaskAccess(authority).domain.id);
  register();
  const access=createExecutionTaskAccess(clone);
  expect(access.domain.id).toBe(resolveTaskDomain(authority).id);
  expect(access.domain.worktree).toBe(resolveTaskDomain(clone).worktree);
  expect(existsSync(resolveTaskDomain(clone).database)).toBe(false);
 });
 it('Main and task_control share the same task across explicit clones while files stay local',async()=>{
  const task=create();register();
  const first=startManagedSessionEffect({workspaceRoot:authority,sessionKey:'source',generation:'source-v1',
    taskNodeId:task.contract.taskNodeId,requestId:'source-start'});
  expect(()=>startManagedSessionEffect({workspaceRoot:clone,sessionKey:'child',generation:'child-v1',
    taskNodeId:task.contract.taskNodeId,requestId:'child-start'})).toThrow('TASK_ALREADY_CLAIMED');
  const store=openExecutionTaskStore(authority);
  try{store.handoff(first.claim!,'child','child-v1',clone);}finally{store.close();}
  const tool=createPersistentTaskTool({workspace:clone,sessionKey:'child',generation:'child-v1'});
  const current=await tool.execute('current',{action:'current'});
  expect(JSON.stringify(current)).toContain(task.contract.taskNodeId);
  const guarded=createExecutionTaskGuard(clone,'child','child-v1','clone-run');
  try{
   await executeTaskGuarded(guarded,'clone-run:write','write',async()=>{writeFileSync(join(clone,'result.txt'),bytes);return {details:{status:'completed'}};});
   const cloneStore=openExecutionTaskStore(clone);
   try{expect(cloneStore.get(task.contract.taskNodeId).claim?.worktree).toBe(resolveTaskDomain(clone).worktree);}finally{cloneStore.close();}
   expect(existsSync(join(authority,'result.txt'))).toBe(false);
   expect(existsSync(resolveTaskDomain(clone).database)).toBe(false);
  }finally{finishPersistentTaskRun(clone,'child','clone-run');}
 });
 it('pins both the Main read/claim gap and a task tool to the registration revision',async()=>{
  const task=create();register();
  const access=createExecutionTaskAccess(clone);
  const selected=openExecutionTaskStore(clone);selected.selectReference(task.contract.taskNodeId,'child','child-v1','select');selected.close();
  const read=readManagedSessionEffect({workspaceRoot:clone,sessionKey:'child',generation:'child-v1'});
  const tool=createPersistentTaskTool({workspace:clone,sessionKey:'child',generation:'child-v1'});
  register(1);
  expect(()=>access.assertCurrent()).toThrow('TASK_AUTHORITY_STALE');
  expect(()=>startManagedSessionEffect({workspaceRoot:clone,sessionKey:'child',generation:'child-v1',requestId:'stale',
    expectedAuthority:read.authorityBasis,expectedContract:read.contract})).toThrow('TASK_AUTHORITY_STALE');
  await expect(tool.execute('stale-tool',{action:'current'})).rejects.toThrow('TASK_AUTHORITY_STALE');
  const store=openExecutionTaskStore(authority);try{expect(store.get(task.contract.taskNodeId).claim).toBeNull();}finally{store.close();}
 });
 it('rejects a missing or replaced registered database instead of creating a local ledger',()=>{
  create();register();
  const database=resolveTaskDomain(authority).database;
  renameSync(database,database+'.original');
  expect(()=>openExecutionTaskStore(clone)).toThrow(/authority|ENOENT/);
  const replacement=new TaskSystemStore(resolveTaskDomain(authority));replacement.close();
  expect(()=>openExecutionTaskStore(clone)).toThrow('execution_task_authority_replaced');
  expect(existsSync(resolveTaskDomain(clone).database)).toBe(false);
 });
 it('refuses registration that would hide an independent local task ledger',()=>{
  create();const local=openExecutionTaskStore(clone);try{local.create(contract,'local-task');}finally{local.close();}
  expect(register).toThrow('execution_clone_has_local_tasks');
  const read=openExecutionTaskStore(clone);try{expect(read.list()).toHaveLength(1);expect(read.domain.id).toBe(resolveTaskDomain(clone).id);}finally{read.close();}
 });
 it('rejects a replaced independent database between Main resolution and claim even when its bytes match',()=>{
  const task=create();
  const store=openExecutionTaskStore(authority);store.selectReference(task.contract.taskNodeId,'source','generation','selection');store.close();
  const read=readManagedSessionEffect({workspaceRoot:authority,sessionKey:'source',generation:'generation'});
  expect(read.authorityBasis.databaseIdentity).toBeTruthy();
  const database=resolveTaskDomain(authority).database;
  renameSync(database,database+'.old');copyFileSync(database+'.old',database);
  expect(()=>startManagedSessionEffect({workspaceRoot:authority,sessionKey:'source',generation:'generation',requestId:'claim',
    expectedAuthority:read.authorityBasis,expectedContract:read.contract})).toThrow('TASK_AUTHORITY_DATABASE_REPLACED');
 });
});
