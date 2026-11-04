import { repoRoot, outRoot, sourceUrl } from '../support.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const out=outRoot;const area=fs.mkdtempSync(path.join(out,'journal-'));
const workspace=path.join(area,'workspace');fs.mkdirSync(workspace);
process.env.OPENCLAW_HOME=area;process.env.OPENCLAW_STATE_DIR=path.join(area,'state');process.env.OPENCLAW_CONFIG_PATH=path.join(area,'openclaw.json');fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH,'{}');
const rows:Array<Record<string,unknown>>=[];
try {
  const {parsePatchText,resolvePatchPath,assertPatchParentPath}=await import(sourceUrl('openclaw_runtime/src/agents/apply-patch.ts'));
  const {preflightPatch,applyPreparedBatch}=await import(sourceUrl('openclaw_runtime/src/agents/apply-patch-preflight.ts'));
  const {decodeTextFile}=await import(sourceUrl('openclaw_runtime/src/agents/sessions/tools/text-file-codec.ts'));
  const {__resetWriteJournals,getOrCreateWriteJournal}=await import(sourceUrl('openclaw_runtime/src/agents/tools/write-journal-core.ts'));
  for (const readonly of [false,true]) {
    const sid=readonly?'locked':'normal', name=sid+'.txt';
    fs.writeFileSync(path.join(workspace,name),'before\n');
    const options={cwd:workspace,workspaceOnly:true,journal:{workspaceRoot:workspace,sessionId:sid,requestId:'request-'+sid,enabled:true}};
    const ops={exists:async(p:string)=>fs.existsSync(p),readFile:async(p:string)=>decodeTextFile(await fsp.readFile(p),p),writeFile:async(p:string,c:any)=>fsp.writeFile(p,c),remove:async(p:string)=>fsp.unlink(p),mkdirp:async(p:string)=>{await fsp.mkdir(p,{recursive:true});}};
    const hunks=parsePatchText(['*** Begin Patch','*** Update File: '+name,'@@','-before','+after','*** End Patch'].join('\n')).hunks;
    const batch=await preflightPatch(hunks,options,ops,{resolvePath:(p,policy)=>resolvePatchPath(p,options,policy),assertParentPath:p=>assertPatchParentPath(p,options)});
    const meta=batch.journalEntries[0].snapshotPath+'.meta.json';
    if(readonly) fs.chmodSync(meta,0o444);  // Windows file attribute; snapshot itself remains readable.
    try {
      const returned=await applyPreparedBatch(batch,options,ops);
      const persisted=JSON.parse(fs.readFileSync(meta,'utf8')).batch.state;
      __resetWriteJournals();
      const rehydrated=getOrCreateWriteJournal(workspace,sid).entries.at(-1)?.batch?.state;
      rows.push({id:'patch-sidecar-'+sid,returned:returned.batchState,journalInResult:returned.journal?.batchState,undoable:returned.journal?.undoable,persisted,rehydrated,actualFile:fs.readFileSync(path.join(workspace,name),'utf8')});
    } finally { if(readonly)fs.chmodSync(meta,0o666); }
  }
} catch(err){rows.push({id:'probe-error',error:String(err)});}
const report={driven_by:'agent',actor:'codex-coding-audit',realHumanEvidence:false,area,candidate:execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),rows};fs.writeFileSync(path.join(out,'journal-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=rows.some(r=>'error' in r)?2:0;
