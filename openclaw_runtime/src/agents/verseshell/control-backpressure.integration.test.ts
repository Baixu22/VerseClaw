import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VerseShellProcessManager } from "./process-manager.js";
import { startGovernedVerseShellProcess } from "./governed-process.js";
import { resolveVerseShellPolicyProfile, VERSESHELL_GOVERNED_EXEC_PROFILE_ID } from "./policy-profile.js";

const server = String.raw`
const {spawn}=require('node:child_process');const readline=require('node:readline');
const processes=new Map();let serial=Promise.resolve();let id=0;
function snapshot(p){return{process_id:p.id,runtime_id:'node-runtime',agent_id:'test-agent',session_id:'test-session',state:p.state,pid:p.child.pid,mode:'pipe',exit_code:p.exitCode,timed_out:false,output:{cursor:p.output.length,chunks:[],lost_bytes:0},artifacts:[]}}
readline.createInterface({input:process.stdin}).on('line',line=>{
 if(line==='SHUTDOWN'){for(const p of processes.values())if(p.state==='running')p.child.kill();process.exit(0);}
 const request=JSON.parse(line);
 serial=serial.then(async()=>{
 let data={};
 if(request.op==='runtime.handshake')data=JSON.parse(process.env.ACI_HANDSHAKE);
 else if(request.op==='process.start'){
  const child=spawn(process.execPath,['-e',"process.stdin.on('data',b=>{if(b.toString().includes('exit'))process.exit(0);else console.log('INPUT')});setInterval(()=>{},1000)"],{windowsHide:true});
  const p={id:'proc-'+(++id),child,state:'running',output:'',exitCode:null};processes.set(p.id,p);
  child.stdout.on('data',b=>p.output=(p.output+b).slice(-1000));child.on('exit',code=>{p.state='exited';p.exitCode=code});data=snapshot(p);
 } else {
  const p=processes.get(request.args.process_id);
  if(request.op==='process.poll'){await new Promise(r=>setTimeout(r,request.args.wait_ms));data=snapshot(p);}
  if(request.op==='process.write'){p.child.stdin.write(request.args.data);data={};}
  if(request.op==='process.kill'){p.child.kill();data={};}
 }
 process.stdout.write(JSON.stringify({schema:'verseshell.observation/v1',id:request.id,op:request.op,ok:true,status:'ok',data,meta:{elapsed_ms:1,profile:'test',token_estimate:1}})+'\n');
 });
});
`;

describe("native protocol control isolation", () => {
  it("keeps a second real process alive when the first exits and controls it during poll pressure", async () => {
    const root=await mkdtemp(path.join(tmpdir(),"tf0836-protocol-"));const script=path.join(root,"server.cjs");await writeFile(script,server);
    let canonical=await realpath(root);if(process.platform==="win32")canonical=canonical.replace(/\\/g,"/").toLowerCase();
    const profile=resolveVerseShellPolicyProfile(VERSESHELL_GOVERNED_EXEC_PROFILE_ID);
    const handshake={crate_version:"1.0.0",runtime_version:"1.0.0",server_protocol:"verseshell.jsonl/v1",observation_schema:"verseshell.observation/v1",operation_catalog_schema:"verseshell.operation-catalog/v1",
      workspace:{id:`ws_sha256_${createHash('sha256').update(canonical).digest('hex')}`,canonical:true},capabilities:{mode:"allow_list",granted:[...profile.capabilities].sort()},policy_mode:"agent_strict",policy_profile:{id:profile.id,digest:profile.digest},artifact_defaults:{ttl_seconds:86400,max_total_bytes:536870912},max_concurrency:4,operation_catalog:{digest:`sha256:${"a".repeat(64)}`,count:26},features:["typed_operations","result_artifacts","bound_approvals","legacy_cmd"]};
    const children:ChildProcess[]=[];
    const manager=new VerseShellProcessManager({resolveBinary:()=>({path:process.execPath,source:"test",verified:true}),idleTtlMs:50,idleSweepMs:10,shutdownGraceMs:1000,
      spawnProcess:(_bin,args,opts)=>{const child=spawn(process.execPath,[script,...args],{...opts,env:{...opts.env,ACI_HANDSHAKE:JSON.stringify(handshake)}});children.push(child);return child as never;}});
    const options={command:"protocol fixture",argv:[process.execPath,script],cwd:root,processEnv:{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"C:/Windows"},timeoutMs:10000,maxOutputBytes:4096,usePty:false,agentId:"test-agent",sessionId:"test-session",hostPolicyApproved:true,manager,
      runtimeEnv:{VERSESHELL_RUNTIME_VERSION:"1.0.0",VERSESHELL_SERVER_PROTOCOL:"verseshell.jsonl/v1",VERSESHELL_OPERATION_CATALOG_DIGEST:`sha256:${"a".repeat(64)}`,VERSESHELL_OPERATION_CATALOG_COUNT:"26",VERSESHELL_OS_SHELL:"powershell"}};
    const isAlive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}};
    try {
      const first=await startGovernedVerseShellProcess(options);const second=await startGovernedVerseShellProcess(options);
      expect(children).toHaveLength(1);await new Promise(resolve=>setTimeout(resolve,100));await manager.collectIdle();expect(isAlive(second.pid)).toBe(true);
      const at=performance.now();await first.kill();await first.wait();const killMs=performance.now()-at;
      expect(isAlive(second.pid)).toBe(true);expect(manager.list()).toHaveLength(1);
      const inputAt=performance.now();await new Promise<void>((resolve,reject)=>second.stdin.write("exit\n",error=>error?reject(error):resolve()));const stdinMs=performance.now()-inputAt;
      await second.wait();await manager.shutdownAll();expect(killMs).toBeLessThan(5000);expect(stdinMs).toBeLessThan(5000);
      expect([first.pid,second.pid,...children.map(child=>child.pid!)].every(pid=>!isAlive(pid))).toBe(true);
      if(process.env.PROCESS_CONTROL_REPORT_DIR)await writeFile(path.join(process.env.PROCESS_CONTROL_REPORT_DIR,"protocol-control.json"),JSON.stringify({driven_by:"agent",actor:"codex",fixture:"Node JSONL server with real child processes; serial poll waits",killMs,stdinMs,executorCount:children.length,pids:[first.pid,second.pid,...children.map(c=>c.pid)],remaining:0},null,2));
    } finally {await manager.shutdownAll();await rm(root,{recursive:true,force:true});}
  },30000);
});
