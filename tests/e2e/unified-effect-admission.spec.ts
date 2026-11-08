import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { TaskView } from '../../shared/task-system/types';
import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

test('actual task effects keep one checkout writer until the owning run ends', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const target=testInfo.outputPath('workspace','result.txt');
  let wrote=false,held=false,release=()=>{},contended=false,after=false;
  const llm=await startScriptedLlm(async text=>{
    if(text.includes('WRITER-CONTINUE')&&!after){after=true;return{toolCall:{id:'writer-b-next',name:'write',args:{path:target,content:'writer-b\n'}}};}
    if(text.includes('WRITER-CONTINUE'))return{text:'WRITER-FINISHED'};
    if(text.includes('WRITER-A')&&!wrote){wrote=true;return{toolCall:{id:'writer-a',name:'write',args:{path:target,content:'writer-a\n'}}};}
    if(text.includes('WRITER-A')){held=true;await new Promise<void>(resolve=>{release=resolve;});return{text:'WRITER-A-ENDED'};}
    if(text.includes('WRITER-B')&&!contended){contended=true;return{toolCall:{id:'writer-b-blocked',name:'write',args:{path:target,content:'intruder\n'}}};}
    if(text.includes('WRITER-B'))return{text:'WRITER-B-OBSERVED'};
    return{text:'WRITER-FINISHED'};
  });
  const app=await launchElectronApp({skipSetup:true});
  const evidence:Record<string,unknown>={driven_by:'agent',actor:'playwright-joint-admission',provider:'local-scripted',status:'running'};
  try{
    await configureSessionChainProvider(app,llm.port);
    const workspaceRoot=testInfo.outputPath('workspace');await mkdir(workspaceRoot,{recursive:true});
    execFileSync('git',['init','-b','joint-fixture'],{cwd:workspaceRoot,windowsHide:true,stdio:'pipe'});
    execFileSync('git',['-c','user.name=Agent fixture','-c','user.email=agent@example.invalid','commit','--allow-empty','-m','Joint checkout fixture'],
      {cwd:workspaceRoot,windowsHide:true,stdio:'pipe'});
    const project=await createSessionChainProject(app,testInfo.outputPath('workspace'),'Joint writers');
    evidence.project=project;
    const second=await hostInvoke<{key:string;sessionId:string}>(app,'gateway','rpc',{method:'sessions.create',params:{agentId:'main',label:'Second task writer'}});
    await hostInvoke(app,'workspaces','saveState',{id:project.workspaceId,sessionKey:second.key,state:{}});
    const taskInput={objective:'Produce the assigned result',target:'result.txt',constraints:['One checkout writer'],acceptance:[{
      id:'file',description:'Assigned output',verification:{kind:'file-sha256' as const,path:'result.txt',sha256:createHash('sha256').update('writer-a\n').digest('hex')},
    }]};
    const a=await createSessionChainTask(app,project.workspaceId,'task-a',taskInput);
    const b=await createSessionChainTask(app,project.workspaceId,'task-b',{...taskInput,objective:'Produce the later result'});
    for(const [key,generation,task] of [[project.sessionKey,project.generation,a],[second.key,second.sessionId,b]] as const){
      await hostInvoke(app,'taskLedger','linkSession',{workspaceId:project.workspaceId,sessionKey:key,sessionGeneration:generation,nodeId:task.contract.taskNodeId});
      await hostInvoke(app,'workspaces','selectSessionTask',{workspaceId:project.workspaceId,sessionKey:key,taskNodeId:task.contract.taskNodeId,expectedSessionGeneration:generation});
    }
    const send=(key:string,message:string)=>hostInvoke(app,'chat','sendWithMedia',{workspaceId:project.workspaceId,sessionKey:key,message,idempotencyKey:message});
    const history=(key:string)=>hostInvoke(app,'gateway','rpc',{method:'chat.history',params:{sessionKey:key,limit:100}});
    const writer=()=>app.evaluate(()=>{
      const {join}=process.mainModule!.require('node:path') as typeof import('node:path');
      const {DatabaseSync}=process.mainModule!.require('node:sqlite') as typeof import('node:sqlite');
      const db=new DatabaseSync(join(process.env.USERPROFILE!,'.openclaw','state','openclaw.sqlite'),{readOnly:true});
      try{return db.prepare("SELECT payload_json FROM state_leases WHERE scope='worktree-writer/v1'").all()
        .map(row=>JSON.parse(String(row.payload_json))).filter(row=>row.owner.kind==='run');}finally{db.close();}
    });
    await send(project.sessionKey,'WRITER-A');
    await expect.poll(()=>readFile(target,'utf8').catch(()=>null),{timeout:60_000}).toBe('writer-a\n');
    await expect.poll(()=>held,{timeout:30_000}).toBe(true);
    const during=await writer();expect(during).toHaveLength(1);
    expect(during[0].owner.task.taskNodeId).toBe(a.contract.taskNodeId);
    await send(second.key,'WRITER-B');
    await expect.poll(async()=>JSON.stringify(await history(second.key)).includes('WRITER-B-OBSERVED'),{timeout:60_000}).toBe(true);
    expect(await readFile(target,'utf8')).toBe('writer-a\n');
    expect(JSON.stringify(await history(second.key))).toContain('checkout_writer_busy');
    release();
    await expect.poll(async()=>(await writer())[0]?.state,{timeout:30_000}).toBe('released');
    await send(second.key,'WRITER-CONTINUE');
    await expect.poll(()=>readFile(target,'utf8').catch(()=>null),{timeout:60_000}).toBe('writer-b\n');
    const task=await hostInvoke<{task:TaskView}>(app,'taskLedger','sessionTask',{workspaceId:project.workspaceId,sessionKey:second.key});
    expect(task.task.contract.taskNodeId).toBe(b.contract.taskNodeId);
    evidence.project=project;evidence.tasks={a:a.contract.taskNodeId,b:b.contract.taskNodeId};evidence.during=during;evidence.after=await writer();evidence.status='passed';
    await (await getStableWindow(app)).screenshot({path:testInfo.outputPath('joint-writers.png')});
  }catch(error){
    evidence.status='failed';evidence.error=String(error);
    const project=evidence.project as {sessionKey:string}|undefined;
    if(project)evidence.failedHistory=await hostInvoke(app,'gateway','rpc',{method:'chat.history',params:{sessionKey:project.sessionKey,limit:100}}).catch(String);
    evidence.hostCalls=await getAgentDevHostCalls(await getStableWindow(app)).catch(String);
    throw error;
  }
  finally{release();evidence.providerLog=llm.log;await writeFile(testInfo.outputPath('joint-effect.json'),JSON.stringify(evidence,null,2));
    await hostInvoke(app,'gateway','stop').catch(()=>undefined);await closeElectronApp(app);
    llm.server.closeAllConnections();await new Promise<void>(resolve=>llm.server.close(()=>resolve()));}
});
