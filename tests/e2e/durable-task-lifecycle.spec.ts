import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import type {Page} from '@playwright/test';
import {test,expect,getStableWindow,closeElectronApp} from './fixtures/electron';
import type {TaskView} from '../../shared/task-system/types';

async function host<T>(page:Page,module:string,action:string,payload:unknown=null):Promise<T>{
  return page.evaluate(async({module,action,payload})=>{
    const response=await window.verseClaw!.hostInvoke({id:crypto.randomUUID(),module,action,payload});
    if(!response.ok)throw new Error(response.error?.message??'Host request failed');
    return response.data;
  },{module,action,payload}) as Promise<T>;
}

test('real sessions share task ownership across worktrees, recover, accept and cancel',async({launchElectronApp,homeDir},info)=>{
  test.setTimeout(300_000);
  const root=join(homeDir,'task-repository'),other=join(homeDir,'task-worktree');await mkdir(root,{recursive:true});await writeFile(join(root,'artifact.txt'),'approved bytes');
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root,windowsHide:true,stdio:'pipe'});
  git('init');git('add','artifact.txt');git('-c','user.name=Agent','-c','user.email=agent@example.invalid','commit','-m','fixture');git('worktree','add','--detach',other);
  const hash=createHash('sha256').update('approved bytes').digest('hex');
  const port=await new Promise<number>((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string'){server.close();reject(new Error('No private Gateway port'));return;}server.close(error=>error?reject(error):resolve(address.port));});});
  const profile=join(homeDir,'task-profile');await mkdir(profile,{recursive:true});await writeFile(join(profile,'settings.json'),JSON.stringify({language:'en',gatewayAutoStart:false,gatewayPort:port}));
  const app=await launchElectronApp({skipSetup:true,profileDir:profile});
  try{
    const page=await getStableWindow(app);
    await host(page,'gateway','start');
    await expect.poll(async()=>host<{gatewayReady?:boolean}>(page,'gateway','status').then(x=>x.gatewayReady),{timeout:120_000}).toBe(true);
    const createSession=async(label:string)=>{
      const s=await host<Record<string,unknown>>(page,'gateway','rpc',{method:'sessions.create',params:{agentId:'main',label}});
      const layers=[s,s.result,s.payload,s.data].filter((value):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'));
      const key=layers.flatMap(value=>[value.key,value.sessionKey]).find((value):value is string=>typeof value==='string'&&value.length>0);
      if(!key)throw new Error(`Session key missing: ${JSON.stringify(s)}`);return key;
    };
    const workspace=async(name:string,path:string,sessionKey:string)=>{
      const response=await host<{activeWorkspaceId:string}>(page,'workspaces','create',{name,rootPath:path,agentId:'main',activeSessionKey:sessionKey});
      await host(page,'workspaces','update',{id:response.activeWorkspaceId,agentId:'main',activeSessionKey:sessionKey,sessionKey,permissionMode:'fullAccess'});return response.activeWorkspaceId;
    };
    const wa=await workspace('Task owner A',root,'agent:main:main');const a=await createSession('Task owner A');
    await host(page,'workspaces','update',{id:wa,agentId:'main',activeSessionKey:a,sessionKey:a});
    const created=await host<{success:boolean;result:{task:TaskView}}>(page,'taskLedger','command',{workspaceId:wa,command:{action:'create',requestId:'lifecycle-goal',contract:{objective:'Persist and verify the same goal across worktrees',target:'artifact.txt',constraints:['Preserve existing content'],acceptance:[{id:'file',description:'Artifact matches the agreed bytes',verification:{kind:'file-sha256',path:'artifact.txt',sha256:hash}},{id:'owner',description:'Existing verifier accepts the evidence',verification:{kind:'owner-receipt',owner:'evidence-verifier',requires:['file']}}]}}});
    expect(created.success).toBe(true);const taskId=created.result.task.contract.taskNodeId;
    const bind=async(workspaceId:string,sessionKey:string,path:string)=>host(page,'workspaces','bindCoordinator',{workspaceId,sessionKey,agentId:'main',expectedRevision:0,taskLedgerNodeIds:[taskId],environment:{kind:'local',rootPath:path},archiveRestorePolicy:'restore'});
    await bind(wa,a,root);await page.reload();await page.getByTestId('sidebar-footer-menu-trigger').click();await page.getByTestId('sidebar-more-task-ledger').click();await page.getByRole('tab',{name:'Persistent tasks'}).click();
    await page.getByRole('button',{name:'Claim for this session'}).click();await expect(page.getByTestId('managed-task')).toContainText(a);await expect(page.getByTestId('managed-task')).toBeInViewport();
    const first=await host<{tasks:TaskView[]}>(page,'taskLedger','managedTasks',{workspaceId:wa});const ca=first.tasks.find(x=>x.contract.taskNodeId===taskId)!.claim!;
    const wb=await workspace('Task owner B',other,'agent:main:main');const b=await createSession('Task owner B');
    await host(page,'workspaces','update',{id:wb,agentId:'main',activeSessionKey:b,sessionKey:b});await bind(wb,b,other);
    const duplicate=await host<{success:boolean;error?:string}>(page,'taskLedger','command',{workspaceId:wb,command:{action:'claim',taskNodeId:taskId,sessionKey:b,requestId:'duplicate'}});expect(duplicate.success).toBe(false);expect(duplicate.error).toContain('ALREADY_CLAIMED');
    const transferred=await host<{success:boolean;result:TaskView}>(page,'taskLedger','command',{workspaceId:wa,command:{action:'handoff',credential:ca,targetSessionKey:b,targetWorkspaceId:wb}});expect(transferred.success).toBe(true);expect(transferred.result.claim!.epoch).toBeGreaterThan(ca.epoch);
    const stale=await host<{success:boolean;error?:string}>(page,'taskLedger','command',{workspaceId:wa,command:{action:'renew',credential:ca}});expect(stale.success).toBe(false);
    await page.reload();await page.getByRole('tab',{name:'Persistent tasks'}).click();await expect(page.getByTestId('managed-task')).toContainText(b);await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByTestId('managed-task')).toContainText('Paused');await page.getByRole('button',{name:'Resume',exact:true}).click();await expect(page.getByTestId('managed-task')).toContainText('In progress');
    const current=await host<{tasks:TaskView[]}>(page,'taskLedger','managedTasks',{workspaceId:wb});const cb=current.tasks.find(x=>x.contract.taskNodeId===taskId)!.claim!;
    for(const command of [{action:'verifyFile',credential:cb,criterionId:'file',path:'artifact.txt',expectedSha256:hash,candidate:hash},{action:'submit',credential:cb,candidate:hash},{action:'accept',credential:cb,candidate:hash}]){const response=await host<{success:boolean;error?:string}>(page,'taskLedger','command',{workspaceId:wb,command});expect(response.error).toBeUndefined();expect(response.success).toBe(true);}
    const completed=await host<{tasks:TaskView[]}>(page,'taskLedger','managedTasks',{workspaceId:wb});expect(completed.tasks[0].contract.state).toBe('done');
    await page.reload();await page.getByRole('tab',{name:'Persistent tasks'}).click();await expect(page.getByTestId('managed-task')).toContainText('Accepted');await page.screenshot({path:info.outputPath('accepted-task.png')});
    const cancelTask=await host<{success:boolean;result:{task:TaskView}}>(page,'taskLedger','command',{workspaceId:wb,command:{action:'create',requestId:'cancel-goal',contract:{objective:'Cancel an assigned task',target:'artifact.txt',constraints:[],acceptance:[{id:'file',description:'Expected file',verification:{kind:'file-sha256',path:'artifact.txt',sha256:hash}}]}}});
    const next=await host<{success:boolean;result:TaskView}>(page,'taskLedger','command',{workspaceId:wb,command:{action:'claim',taskNodeId:cancelTask.result.task.contract.taskNodeId,sessionKey:b,requestId:'cancel-claim'}});expect(next.success).toBe(true);
    await page.reload();await page.getByTestId(`sidebar-session-drag-${b}`).getByText('Task owner B',{exact:true}).click();await page.getByTestId('sidebar-footer-menu-trigger').click();await page.getByTestId('sidebar-more-task-ledger').click();await page.getByRole('tab',{name:'Persistent tasks'}).click();await page.getByRole('button',{name:'Cancel task',exact:true}).click();await expect(page.getByTestId('managed-task').filter({hasText:'Cancel an assigned task'})).toContainText('Cancelled');
    await writeFile(info.outputPath('lifecycle-readback.json'),JSON.stringify({driven_by:'agent',actor:'playwright',roots:[root,other],first,duplicate,transferred,stale,completed},null,2));
  }finally{const page=await getStableWindow(app).catch(()=>null);if(page)await host(page,'gateway','stop').catch(()=>{});await closeElectronApp(app);}
});
