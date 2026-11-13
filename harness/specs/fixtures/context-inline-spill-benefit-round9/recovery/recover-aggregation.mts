// driven_by: agent; actor: codex-g7-inline-spill-tf0749-01a1d34c; realHumanEvidence: false
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=process.cwd(),session='D:/tmp/g7-closeout-pass-r9-01a1d34c';
const source=join(session,'live/2026-11-13T11-48-49-224Z-live');
const dest=join(session,'recovered','2026-11-13T11-48-49-224Z-live-'+new Date().toISOString().replace(/[:.]/g,'-'));
const meta={driven_by:'agent',actor:'codex-g7-inline-spill-tf0749-01a1d34c',realHumanEvidence:false};
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const pre=json(join(source,'preflight.json'));
assert.equal(git(['rev-parse','HEAD']),pre.candidate.commit);assert.equal(git(['status','--porcelain=v1']),'');
for(const [path,value] of Object.entries(pre.sourceInputs) as Array<[string,any]>){assert.equal(hash(readFileSync(join(root,path))),value.sha256,path);assert.equal(git(['hash-object','--no-filters',path]),value.gitBlob,path);}
const rows=readFileSync(join(source,'runs.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line).record);
const wires=readFileSync(join(source,'provider-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
assert.equal(rows.length,96);assert.equal(wires.length,324);assert.equal(rows.reduce((s:any,r:any)=>s+r.turns,0),324);
mkdirSync(join(session,'recovered'),{recursive:true});cpSync(source,dest,{recursive:true,errorOnExist:true,force:false});
const frozenSource=execFileSync('git',['show',pre.candidate.commit+':scripts/context-inline-spill-benefit-loop-eval.mts'],{encoding:'utf8'}).replaceAll('\r\n','\n');
const corpusStart=frozenSource.lastIndexOf('// ---------------------------------------------------------------- fixtures');
const corpusEnd=frozenSource.indexOf('// ---------------------------------------------------------------- projection',corpusStart);
const summaryStart=frozenSource.lastIndexOf('// ---------------------------------------------------------------- summary');
assert(corpusStart>=0&&corpusEnd>corpusStart&&summaryStart>corpusEnd);
const corpus=frozenSource.slice(corpusStart,corpusEnd),tail=frozenSource.slice(summaryStart);
const recovery={...meta,schema:'G7AggregationRecovery/v1',recordedAt:new Date().toISOString(),originalDirectory:source,recoveredDirectory:dest,
 originalExitCodeObserved:false,originalExitCode:null,originalPostflightObserved:false,reason:'Executor process absent after host generation reload; all96 runs and324 model responses had already been written.',
 sourceCommit:pre.candidate.commit,originalRunFiles:readdirSync(source).filter(name=>name!=='archives').map(name=>({file:name,sha256:hash(readFileSync(join(source,name)))})),frozenCorpusSha256:hash(corpus),frozenSummarySha256:hash(tail),providerCallsAdded:0,modelOutputsChanged:false};
writeFileSync(join(dest,'recovery-provenance.json'),JSON.stringify(recovery,null,2)+'\n');
const header=[
 "import {execFileSync} from 'node:child_process';",
 "import {createHash} from 'node:crypto';",
 "import {readFileSync,writeFileSync} from 'node:fs';",
 "import {join,resolve} from 'node:path';",
 "import {mcnemarExact,parseAnswer,wilson} from "+JSON.stringify('file:///'+root.replaceAll('\\','/')+'/scripts/context-inline-spill-benefit-scoring.mts')+";",
 "const ROOT=process.cwd(),MODE='live',RUN_ID="+JSON.stringify(pre.startedAt.replace(/[:.]/g,'-')+'-live')+",runDir="+JSON.stringify(dest)+";",
 "const ACTOR="+JSON.stringify(meta.actor)+",MODEL='space-bunny',BASE_URL='http://127.0.0.1:3065/v1',REPEATS=3,MAX_TURNS=8,MAX_OUTPUT_TOKENS=900,STRATEGY='bookmarked',PRESSURE_SOURCE='tool',PROVIDER_TIMEOUT_MS=240000,DETERMINISTIC_FAULT='none';",
 "const CONTEXT_WINDOW_TOKENS=32000,TOOL_MAX_CHARS=6000,AGGREGATE_MAX_CHARS=16000,RECALL_PAGE_CHARS=5500,ARCHIVE_RECALL_RETENTION_MAX_CHARS=16000;",
 "const API_KEY=process.env.LOCAL3065_API_KEY,pre=JSON.parse(readFileSync(join(runDir,'preflight.json'),'utf8')),candidateAtStart=pre.candidate,sourceInputs=pre.sourceInputs,designFreeze=pre.designFreeze,freezePath=pre.designFreeze.path;",
 "const recovery=JSON.parse(readFileSync(join(runDir,'recovery-provenance.json'),'utf8'));",
 "function digest(value){return createHash('sha256').update(value).digest('hex')}",
 "function redact(value){return API_KEY?value.split(API_KEY).join('[redacted]'):value}",
 "function save(name,value){if(name==='postflight.json')value={...value,schema:'ContextInlineSpillRecoveredPostflight/v1',recovery};else value={...value,recovery};writeFileSync(join(runDir,name),redact(JSON.stringify(value,null,2))+'\\n')}",
 "const ARMS=['baseline-no-reference','reference-visible','recall-stable','retention-off'];",
 "const ARM_CONFIG={'baseline-no-reference':{reference:false,retention:false,pressure:false},'reference-visible':{reference:true,retention:false,pressure:false},'recall-stable':{reference:true,retention:true,pressure:true},'retention-off':{reference:true,retention:false,pressure:true}};",
 "const records=readFileSync(join(runDir,'runs.jsonl'),'utf8').trim().split('\\n').map(line=>JSON.parse(line).record);"
].join('\n')+'\n';
const script=join(session,'recovered-frozen-summary.mts');
writeFileSync(script,header+corpus+"\nconst fixtures=buildFixtures();\n"+tail);
const child=spawnSync(process.execPath,[join(root,'openclaw_runtime/node_modules/tsx/dist/cli.mjs'),script],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,TEMP:'D:/tmp',TMP:'D:/tmp'},timeout:60000});
writeFileSync(join(session,'aggregation-recovery.stdout.txt'),child.stdout??'');writeFileSync(join(session,'aggregation-recovery.stderr.txt'),child.stderr??'');
writeFileSync(join(session,'aggregation-recovery-receipt.json'),JSON.stringify({...meta,schema:'G7RecoveryCommandReceipt/v1',command:[process.execPath,'tsx',script],exitCode:child.status,error:child.error?String(child.error):null,recovery},null,2)+'\n');
assert.equal(child.status,0,child.stderr);
const post=json(join(dest,'postflight.json'));assert.equal(post.sameCandidate,true);assert.equal(post.candidate.dirty,false);
console.log(JSON.stringify({recoveredDirectory:dest,originalExitCode:null,aggregationExitCode:child.status,rawRuns:rows.length,rawCalls:wires.length,providerCallsAdded:0,sameCandidate:post.sameCandidate}));
