import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const index=process.argv.indexOf('--out');
assert(index>=0&&process.argv[index+1]);
const out=path.resolve(process.argv[index+1]);
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const home=path.join(out,'state'),runId='run_g3_native_goal';
const runtime=path.join(root,'openclaw_runtime');
const childFile=path.join(root,'scripts/recovery-goal-process-proof-child.mts');
const actor='codex-recovery-ga-closeout-20261114-01a1d4d8';
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'}).trim();
const candidate={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),dirty:Boolean(git('status','--porcelain'))};
const sourceFiles=['scripts/recovery-goal-process-proof-child.mts','scripts/recovery-goal-process-proof.mjs',...['goal-wake-recovery.ts','goal-wake-recovery-admission.ts','goal-wake-dispatch.ts','goal-wake-fencing.ts','goal-wake-helper-host.ts','goal-wake-helper-entry.ts','goal-wake-helper-protocol.ts','process-run-reconciler.ts'].map(name=>'openclaw_runtime/src/agents/'+name)];
const source=()=>sourceFiles.map(file=>({path:file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const sourceBefore=source(),owned=new Set(),runs=[];
function launch(mode){
 const name=runs.length+'-'+mode,stdout=path.join(out,name+'.stdout.log'),stderr=path.join(out,name+'.stderr.log');
 const errFd=fs.openSync(stderr,'w');
 const child=spawn(process.execPath,['--import',pathToFileURL(path.join(runtime,'node_modules/tsx/dist/loader.mjs')).href,childFile,home,mode],{cwd:runtime,windowsHide:true,env:{...process.env,TEMP:'D:/tmp',TMP:'D:/tmp',OPENCLAW_STATE_DIR:home,OPENCLAW_HOME:path.join(home,'home'),OPENCLAW_RECOVERY_AUTHORITY_MODE:'authority',OPENCLAW_DISABLE_BUNDLED_PLUGINS:'1',RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED:'1',RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED:'1',RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED:'1'},stdio:['ignore','pipe',errFd]});
 owned.add(child);let text='';child.stdout.on('data',chunk=>{text+=chunk;fs.writeFileSync(stdout,text)});
 const ended=new Promise(resolve=>child.once('exit',(code,signal)=>{owned.delete(child);fs.closeSync(errFd);resolve({code,signal})}));
 runs.push({name,pid:child.pid,stdout,stderr});
 return{child,ended,async wait(type){const limit=Date.now()+45000;while(Date.now()<limit){const rows=text.trim().split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});const row=rows.find(row=>row.type===type);if(row)return row;if(child.exitCode!==null)throw Error(name+' ended without '+type);await new Promise(resolve=>setTimeout(resolve,50));}throw Error(name+' timed out waiting for '+type)}};
}
function observe(databasePath){const db=new DatabaseSync(databasePath,{readOnly:true});try{return{task:db.prepare('SELECT * FROM task_runs WHERE run_id = ?').get(runId),mission:db.prepare('SELECT * FROM mission_runs WHERE mission_id = ?').get('g3-native-goal-mission'),flows:db.prepare('SELECT * FROM flow_runs').all()}}finally{db.close()}}
const count=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).length:0;
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function until(predicate){const limit=Date.now()+45000;while(Date.now()<limit){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Timed out waiting for owned helper terminal state')}
let report,helperPid,helperStartedAt;
try{
 const gateway=launch('launch'),started=await gateway.wait('helper-running');helperPid=started.started.helperPid;helperStartedAt=started.started.startedAtMs;
 const initial=observe(started.databasePath);assert.equal(initial.task.status,'running');assert.equal(count(path.join(home,'effects.jsonl')),0);
 gateway.child.kill();await gateway.ended;assert(alive(helperPid));
 const restarted=launch('observe');const running=await restarted.wait('observed');assert.equal((await restarted.ended).code,0);
 assert.equal(running.task.status,'running');assert.equal(JSON.parse(running.task.progress_summary).helperPid,helperPid);assert.equal(count(path.join(home,'effects.jsonl')),0);
 fs.writeFileSync(path.join(home,'release-effect'),'release');
 await until(()=>fs.existsSync(path.join(home,'background-processes',runId,'exit.json')));
 assert.equal(count(path.join(home,'effects.jsonl')),1);
 const interrupted=launch('before-wake');await interrupted.wait('task-terminal-before-wake');const terminal=observe(started.databasePath);
 assert.equal(terminal.task.status,'succeeded');assert.equal(terminal.flows[0].status,'running');assert.equal(count(path.join(home,'wake-effects.jsonl')),0);
 interrupted.child.kill();await interrupted.ended;
 const peers=[launch('settle'),launch('settle')];for(const peer of peers){await peer.wait('observed');assert.equal((await peer.ended).code,0)}
 const settled=observe(started.databasePath);assert.equal(settled.task.status,'succeeded');assert.equal(settled.flows[0].status,'succeeded');assert.equal(settled.mission.tick_count,1);
 assert.equal(count(path.join(home,'wake-effects.jsonl')),1);
 const protocol=path.resolve(home,'background-processes',runId),retained=path.resolve(home,'retained-terminal-protocol');
 assert(protocol.startsWith(path.resolve(home)+path.sep)&&retained.startsWith(path.resolve(home)+path.sep));fs.renameSync(protocol,retained);
 const repeat=launch('settle');await repeat.wait('observed');assert.equal((await repeat.ended).code,0);
 const final=observe(started.databasePath),authority=JSON.parse(final.task.progress_summary).recoveryAuthority;
 assert.equal(authority.decision.authorityId,'recovery-authority/v1');assert.equal(authority.attempts,0);assert.equal(authority.decision.kind,'settle');
 assert.equal(count(path.join(home,'effects.jsonl')),1);assert.equal(count(path.join(home,'wake-effects.jsonl')),1);
 await until(()=>!alive(helperPid));
 report={schema:'RecoveryGoalProcessProof/v1',driven_by:'agent',actor,realHumanEvidence:false,candidate,status:'PASS',originalHelperPid:helperPid,originalChildPid:started.started.childPid,helperEffects:1,wakeEffects:1,missionTicks:1,duplicateEffects:0,recoveryDispatchAttempts:0,initial,terminal,settled,final,runs,sourceBefore,sourceAfter:source(),cleanup:{activeOwnedChildren:owned.size,activeOriginalHelper:alive(helperPid)}};
 assert.deepEqual(report.sourceAfter,sourceBefore);
}catch(error){report={schema:'RecoveryGoalProcessProof/v1',driven_by:'agent',actor,realHumanEvidence:false,candidate,status:'FAIL',error:String(error),runs,sourceBefore,sourceAfter:source()};process.exitCode=1}
finally{
 for(const child of owned){child.kill();await new Promise(resolve=>child.once('exit',resolve))}
 if(helperPid&&alive(helperPid)){
  const identity=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${helperPid}'; @{command=$p.CommandLine;created=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'}));
  if(identity.command.includes(childFile)&&identity.command.includes(runId)&&Date.parse(identity.created)<=helperStartedAt)execFileSync('taskkill',['/PID',String(helperPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 }
}
report.cleanup={activeOwnedChildren:owned.size,activeOriginalHelper:helperPid?alive(helperPid):false};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:path.join(out,'report.json')}));
