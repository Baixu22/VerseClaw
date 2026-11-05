import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const rawPath=join(dir,'raw-evidence.json.gz');const originalHash=sha(readFileSync(rawPath));
const index=JSON.parse(readFileSync(join(dir,'bundle-index.json'),'utf8'));
if(originalHash!==index.bundleSha256)throw new Error('raw bundle hash mismatch');
const sourceIndex=JSON.parse(readFileSync(join(dir,'source-index.json'),'utf8'));
const sourceBytes=readFileSync(join(dir,'reader-source.json.gz'));
if(sha(sourceBytes)!==sourceIndex.archiveSha256)throw new Error('reader source hash mismatch');
const sources=JSON.parse(gunzipSync(sourceBytes).toString('utf8'));
const tmpRoot=process.env.TEMP||'D:/tmp';mkdirSync(tmpRoot,{recursive:true});
const isolatedRoot=mkdtempSync(join(tmpRoot,'recovery-offline-'));
for(const file of sources.files){const bytes=Buffer.from(file.base64,'base64');if(sha(bytes)!==file.sha256)throw new Error('source bytes changed');const target=resolve(isolatedRoot,file.path);if(!target.startsWith(resolve(isolatedRoot)+sep))throw new Error('source path escape');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
const raw=JSON.parse(gunzipSync(readFileSync(rawPath)).toString('utf8'));
const groups=['artifacts','receiptArtifacts','metadataArtifacts'];const rawReceipts=new Set();
for(const group of groups)for(const item of raw[group]){const bytes=Buffer.from(item.base64,'base64');if(sha(bytes)!==item.sha256)throw new Error('sealed bytes mismatch: '+item.path);if(group==='receiptArtifacts')rawReceipts.add(JSON.stringify(JSON.parse(bytes.toString('utf8'))));}
for(const receipt of [...raw.windows,...raw.quality,...raw.baselineRepeatWindows])if(!rawReceipts.has(JSON.stringify(receipt)))throw new Error('parsed receipt differs from original bytes');
const executions=[];
for(const arm of ['legacy','candidate'])for(const mode of ['verify','check']){const args=['--experimental-strip-types','scripts/recovery-contract-eval.mjs','--bundle',rawPath,'--arm',arm,mode==='verify'?'--verify':'--check'];if(mode==='verify')args.push(join(dir,arm+'-report.json'));const run=spawnSync(process.execPath,args,{cwd:isolatedRoot,windowsHide:true,encoding:'utf8',timeout:60000,env:{...process.env,TEMP:tmpRoot,TMP:tmpRoot}});if(run.error)throw run.error;const result=JSON.parse(run.stdout);const expected=mode==='verify'?0:1;if(run.status!==expected||(mode==='verify'&&result.reproduced!==true)||result.status!=='FAIL')throw new Error('unexpected offline '+arm+'/'+mode+' result');executions.push({arm,mode,exitCode:run.status,result,stderr:run.stderr});}
const answer=raw.quality.find(r=>r.arm==='candidate').artifacts.find(a=>a.path.endsWith('answer.json'));
const item=raw.artifacts.find(a=>a.path===answer.path);const artifactHash=item.sha256;item.base64=Buffer.from('{}').toString('base64');
const tamperedPath=join(isolatedRoot,'tampered-evidence.json.gz');writeFileSync(tamperedPath,gzipSync(JSON.stringify(raw),{level:9}));
const tamper=spawnSync(process.execPath,['--experimental-strip-types','scripts/recovery-contract-eval.mjs','--bundle',tamperedPath,'--arm','candidate','--verify',join(dir,'candidate-report.json')],{cwd:isolatedRoot,windowsHide:true,encoding:'utf8',timeout:60000,env:{...process.env,TEMP:tmpRoot,TMP:tmpRoot}});if(tamper.error)throw tamper.error;const rejected=JSON.parse(tamper.stdout);if(tamper.status!==1||rejected.reproduced!==false||rejected.status!=='EVIDENCE_INSUFFICIENT')throw new Error('tampered evidence was not rejected');
if(sha(readFileSync(rawPath))!==originalHash)throw new Error('original bundle changed');
const result={schema:'RecoveryOfflineVerification/v1',sourceCommit:sources.sourceCommit,nodeVersion:process.version,isolatedRoot,dependenciesInstalled:false,originalEvidencePathsRead:false,verifiedFiles:Object.fromEntries(groups.map(g=>[g,raw[g].length])),parsedReceiptsBoundToOriginalBytes:rawReceipts.size,executions,tamper:{artifactPath:answer.path,keptSha256:artifactHash,originalBundleUnchanged:true,exitCode:tamper.status,result:rejected},driven_by:'agent',actor:'recovery-offline-verifier',realHumanEvidence:false};
const outAt=process.argv.indexOf('--output');if(outAt>=0)writeFileSync(resolve(process.argv[outAt+1]),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({verified:true,sourceCommit:result.sourceCommit,rawFiles:result.verifiedFiles,verifyExits:executions.filter(e=>e.mode==='verify').map(e=>e.exitCode),acceptanceExits:executions.filter(e=>e.mode==='check').map(e=>e.exitCode),tamperExit:tamper.status,originalUnchanged:true}));
