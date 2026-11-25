import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(process.argv[process.argv.indexOf('--out')+1]);
assert(process.argv.includes('--out')&&!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const actor='codex-recovery-ga-closeout-20261114-01a1d4d8';
const owned=new Set(),runs=[];
const runtime=path.join(root,'openclaw_runtime');
const childFile=path.join(root,'scripts/recovery-acp-process-proof-child.mts');
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true}).toString().trim();
const candidate={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),dirty:Boolean(git('status','--porcelain'))};
function launch(home,mode){
 fs.mkdirSync(home,{recursive:true});
 const name=String(runs.length)+'-'+mode,stdout=path.join(out,name+'.stdout.log'),stderr=path.join(out,name+'.stderr.log');
 const errFd=fs.openSync(stderr,'w');
 const child=spawn(process.execPath,['--import',pathToFileURL(path.join(runtime,'node_modules/tsx/dist/loader.mjs')).href,childFile,home,mode],{cwd:runtime,windowsHide:true,env:{...process.env,TEMP:'D:/tmp',TMP:'D:/tmp',OPENCLAW_STATE_DIR:home,OPENCLAW_RECOVERY_AUTHORITY_MODE:'authority',OPENCLAW_DISABLE_BUNDLED_PLUGINS:'1',OPENCLAW_TEST_FAST:'1'},stdio:['ignore','pipe',errFd]});
 owned.add(child);
 let text='';child.stdout.on('data',data=>{text+=data.toString();fs.writeFileSync(stdout,text)});
 const ended=new Promise(resolve=>child.once('exit',(code,signal)=>{owned.delete(child);fs.closeSync(errFd);resolve({code,signal})}));
 const record={name,pid:child.pid,stdout,stderr};runs.push(record);
 return{child,record,ended,async wait(type){const deadline=Date.now()+45000;while(Date.now()<deadline){const rows=text.trim().split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return{}}});const row=rows.find(row=>row.type===type);if(row)return row;if(child.exitCode!==null)throw Error(name+' ended without '+type);await new Promise(resolve=>setTimeout(resolve,50));}throw Error(name+' timed out waiting for '+type)}};
}
function observe(databasePath){const db=new DatabaseSync(databasePath,{readOnly:true});try{const row=db.prepare('SELECT * FROM acp_sessions').get();return{raw:row,state:JSON.parse(row.recovery_json)}}finally{db.close()}}
const count=home=>fs.existsSync(path.join(home,'effects.jsonl'))?fs.readFileSync(path.join(home,'effects.jsonl'),'utf8').trim().split('\n').filter(Boolean).length:0;
let report;
try{
 const safe=path.join(out,'safe');let stage=launch(safe,'seed');const seed=await stage.wait('seeded');assert.equal((await stage.ended).code,0);
 stage=launch(safe,'before-turn');const first=await stage.wait('admitted-before-turn');assert.equal(observe(seed.databasePath).state.attempts,1);
 const peer=launch(safe,'run');await peer.wait('refused');await peer.ended;assert.equal(count(safe),0);
 stage.child.kill();await stage.ended;
 const resumed=launch(safe,'run');await resumed.wait('completed');await resumed.ended;
 const applied=observe(seed.databasePath);assert.equal(applied.state.attempts,2);assert.equal(applied.state.effect,'applied');assert.equal(count(safe),1);
 const duplicate=launch(safe,'run');await duplicate.wait('completed');await duplicate.ended;assert.equal(count(safe),1);
 const settled=observe(seed.databasePath);assert.equal(settled.state.authority.decision.kind,'settle');
 const unknown=path.join(out,'unknown');stage=launch(unknown,'seed');const unknownSeed=await stage.wait('seeded');await stage.ended;
 stage=launch(unknown,'after-effect');await stage.wait('effect-before-terminal');assert.equal(count(unknown),1);stage.child.kill();await stage.ended;
 const observer=launch(unknown,'run');await observer.wait('refused');await observer.ended;
 const uncertain=observe(unknownSeed.databasePath);assert.equal(uncertain.state.effect,'unknown');assert.equal(uncertain.state.attempts,1);assert.equal(uncertain.state.authority.decision.kind,'reconcile');assert.equal(count(unknown),1);
 report={schema:'RecoveryACPProcessProof/v1',driven_by:'agent',actor,realHumanEvidence:false,candidate,status:'PASS',safe:{initialPid:first.pid,attempts:2,effects:1,duplicateEffects:0,settled:settled.state},unknown:{attempts:1,effects:1,duplicateEffects:0,state:uncertain.state},runs,cleanup:{activeOwnedChildren:owned.size},source:[childFile,...['manager.turn-runner.ts','manager.runtime-resume-state.ts','manager.recovery-admission.ts','manager.core.ts'].map(file=>path.join(runtime,'src/acp/control-plane',file))].map(file=>({path:path.relative(root,file),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))};
}catch(error){report={schema:'RecoveryACPProcessProof/v1',driven_by:'agent',actor,realHumanEvidence:false,candidate,status:'FAIL',error:String(error),runs};process.exitCode=1}
finally{for(const child of owned){child.kill();await new Promise(resolve=>child.once('exit',resolve))}}
report.cleanup={activeOwnedChildren:owned.size};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:path.join(out,'report.json'),error:report.error}));
