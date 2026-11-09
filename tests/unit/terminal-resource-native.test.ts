import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { TerminalSessionManager } from '../../electron/services/terminal-session-manager';
import { configureManagedProcessCapacity, managedProcessCapacityStats, resetManagedProcessCapacity } from '../../openclaw_runtime/src/agents/verseshell/managed-process-capacity';
import { captureProcessTrees, verifyProcessTreesTerminated } from '../../openclaw_runtime/src/process/os-containment';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import type { WorkspaceProfile } from '../../shared/types/workspace';

const roots:string[]=[];
afterEach(()=>{resetManagedProcessCapacity();closeOpenClawStateDatabaseForTest();vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('native Windows PTY owns descendants, generation, capacity and cancellation receipt',async()=>{
 expect(process.platform).toBe('win32');
 const root=mkdtempSync(path.join(tmpdir(),'r3-native-'));roots.push(root);vi.stubEnv('OPENCLAW_STATE_DIR',path.join(root,'state'));
 configureManagedProcessCapacity({maxLiveProcesses:1});
 const workspace:WorkspaceProfile={id:'native-a',name:'Native',rootPath:root,agentId:'main',activeSessionKey:'agent:main:native',permissionMode:'fullAccess',createdAt:1,updatedAt:1,lastOpenedAt:1,state:{}};
 const script=path.join(root,'tree.cjs'),receipt=path.join(root,'pids.json');
 writeFileSync(script,"const fs=require('node:fs');const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(process.argv[2],JSON.stringify({root:process.pid,child:c.pid,env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP}}));setInterval(()=>{},1000);");
 const manager=new TerminalSessionManager();
 const terminal=manager.open({workspace,expectedSessionId:'native-generation',command:`"${process.execPath}" "${script}" "${receipt}"`});
 let capture:Awaited<ReturnType<typeof captureProcessTrees>>|undefined;
 try{
  const deadline=Date.now()+15_000;
  while(!existsSync(receipt)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  expect(existsSync(receipt)).toBe(true);
  const ids=JSON.parse(readFileSync(receipt,'utf8'));
  expect(ids.env.SystemRoot).toBeTruthy();expect(ids.env.TEMP.toLowerCase()).toContain('d:');
  capture=await captureProcessTrees([ids.root]);expect(capture.status).toBe('ok');expect(capture.capturedPids.has(ids.child)).toBe(true);
  expect(()=>manager.open({workspace:{...workspace,id:'native-b'},sessionKey:'agent:main:other'})).toThrow('E_PROCESS_CAPACITY_LIMIT');
  expect(()=>manager.write({sessionId:terminal.sessionId!,data:'bad',sessionKey:'agent:wrong:task'})).toThrow(/scope/);
  await manager.close(terminal.sessionId!);
  const terminated=await verifyProcessTreesTerminated(capture);
  expect(terminated).toMatchObject({status:'empty'});
  expect(managedProcessCapacityStats().live).toBe(0);
  console.log(JSON.stringify({driven_by:'agent',actor:'codex',scenario:'native-pty-tree',pids:[...capture.capturedPids.keys()],termination:terminated,liveAfter:managedProcessCapacityStats().live}));
 }finally{
  await manager.close(terminal.sessionId!).catch(()=>undefined);
 }
},45_000);

it('repeated native terminal exits release their input pipe handles', async () => {
 expect(process.platform).toBe('win32');
 const root=mkdtempSync(path.join(tmpdir(),'pty-pipes-'));roots.push(root);vi.stubEnv('OPENCLAW_STATE_DIR',path.join(root,'state'));
 const workspace:WorkspaceProfile={id:'pipe-owner',name:'Pipes',rootPath:root,agentId:'main',activeSessionKey:'agent:main:pipes',permissionMode:'fullAccess',createdAt:1,updatedAt:1,lastOpenedAt:1,state:{}};
 const handles=()=> (process as unknown as {_getActiveHandles():object[]})._getActiveHandles();
 const initial=new Set(handles()); const residual=()=>handles().filter(handle=>handle instanceof Socket && handle.writable && !handle.readable && !initial.has(handle));
 const manager=new TerminalSessionManager();const rows:Array<{cycle:number;remaining:number}>=[];
 let current:string|null=null;
 try {
  for(let i=0;i<12;i++) {
   const opened=manager.open({workspace});current=opened.sessionId!;
   await vi.waitFor(()=>expect(manager.status({sessionId:current!}).pid).toBeGreaterThan(0),{timeout:10000});
   await manager.close(current);current=null;
   rows.push({cycle:i,remaining:residual().length});
  }
  await vi.waitFor(()=>expect(residual()).toHaveLength(0),{timeout:5000});
  expect(manager.listAll()).toEqual([]);
 } finally {
  if(current)await manager.close(current);
  if(process.env.RESOURCE_SOAK_REPORT_DIR)writeFileSync(path.join(process.env.RESOURCE_SOAK_REPORT_DIR,`pty-pipes-${Date.now()}.json`),JSON.stringify({driven_by:'agent',actor:'codex',cycles:rows,remaining:residual().length}));
  // Negative-control runs leave test-owned pipes after their processes exited.
  for(const pipe of residual())(pipe as Socket).destroy();
 }
},60000);
