const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const root='D:/ClawX-work/knowledge-relay-20261105';
const out='D:/tmp/knowledge-relay-20261105/final'; fs.mkdirSync(out,{recursive:true});
process.env.TEMP='D:/tmp'; process.env.TMP='D:/tmp'; process.env.pnpm_config_verify_deps_before_run='false';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const candidate={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),dirty:!!git('status','--porcelain'),driven_by:'agent',actor:'codex-knowledge-convergence'};
if(candidate.dirty)throw Error('Expected clean candidate');
candidate.files=git('diff-tree','--no-commit-id','--name-only','-r','HEAD').split('\n').map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
fs.writeFileSync(path.join(out,'candidate.json'),JSON.stringify(candidate,null,2));
const report={candidate,startedAt:new Date().toISOString(),steps:[]};
const testFiles=['knowledge-source-sync','knowledge-github-connector','knowledge-api','knowledge-evidence-qa','knowledge-retrieval','knowledge-source-set-answer','knowledge-steward-semantic-pass','knowledge-steward-registry','knowledge-steward-notes-injection','knowledge-roletags','knowledge-host-api-split'].map(name=>`tests/unit/${name}.test.ts`);
const steps=[
['backend',['node_modules/vitest/vitest.mjs','run','--config','vitest.agent-dev.node.config.ts',...testFiles,'--maxWorkers=1','--testTimeout=60000','--hookTimeout=60000','--reporter=default','--reporter=json',`--outputFile=${out}/backend.json`]],
['renderer-host',['node_modules/vitest/vitest.mjs','run','tests/unit/knowledge-chat.test.tsx','tests/unit/host-api-facade.test.ts','tests/unit/host-api-client-error-metadata.test.ts','tests/unit/host-invoke.test.ts','tests/unit/host-invoke-security.test.ts','tests/unit/contract-check.test.ts','--maxWorkers=1','--testTimeout=60000','--hookTimeout=60000','--reporter=default','--reporter=json',`--outputFile=${out}/renderer-host.json`]],
...['node','web','test'].map(part=>[`typecheck-${part}`,['node_modules/@typescript/native-preview/bin/tsgo.js','--noEmit','-p',`tsconfig.${part}.json`,'--composite','false']]),
['lint',['node_modules/eslint/bin/eslint.js','electron/services/knowledge-api.ts','electron/services/knowledge-source-sync.ts','electron/services/knowledge-github-connector.ts','electron/services/knowledge-evidence-qa.ts','electron/services/knowledge-source-set-answer.ts','electron/services/knowledge-embedding-provider.ts','src/pages/Chat/KnowledgeChat.tsx','src/lib/host-api/knowledge/connectors.ts','scripts/knowledge-quality-eval.ts','scripts/run-knowledge-quality-eval.mjs','tests/e2e/knowledge-live.spec.ts']],
['contract',['scripts/contract-check.mjs']],['comms-replay',['scripts/comms/replay.mjs']],['comms-compare',['scripts/comms/compare.mjs']],
['harness-validate',['harness/src/cli.mjs','validate','--spec','harness/specs/tasks/knowledge-retrieval-and-governance-completion.md']],
['harness-dry-run',['harness/src/cli.mjs','run','--spec','harness/specs/tasks/knowledge-retrieval-and-governance-completion.md','--dry-run']],
['build',['--max-old-space-size=6144','node_modules/vite/bin/vite.js','build']],
];
(async()=>{for(const [name,args]of steps){
 if(git('rev-parse','HEAD')!==candidate.commit||git('status','--porcelain'))throw Error('Candidate changed');
 const started=Date.now(); console.log(`START ${name}`);const fd=fs.openSync(path.join(out,`${name}.txt`),'w');
 const exitCode=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:['ignore',fd,fd],windowsHide:true});p.on('error',reject);p.on('exit',code=>resolve(code??1));});fs.closeSync(fd);
 report.steps.push({name,command:['node',...args],exitCode,durationMs:Date.now()-started,candidate:{commit:candidate.commit,dirty:false}});
 fs.writeFileSync(path.join(out,'gates.json'),JSON.stringify(report,null,2)); console.log(`END ${name} exit=${exitCode}`);
 if(exitCode){process.exitCode=1;return;}
}report.finishedAt=new Date().toISOString();report.dirtyAfter=!!git('status','--porcelain');fs.writeFileSync(path.join(out,'gates.json'),JSON.stringify(report,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
