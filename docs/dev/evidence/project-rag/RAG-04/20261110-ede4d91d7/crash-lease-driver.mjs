import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run with the worktree's runtime tsx loader and an output receipt argument.
const workspace=process.cwd(), runtime=path.join(workspace,'openclaw_runtime');
const output=process.argv[2]; assert(output,'Pass an output receipt path');
const runtimeRequire=createRequire(path.join(runtime,'package.json'));
const loader=pathToFileURL(runtimeRequire.resolve('tsx')).href;
const url=name=>pathToFileURL(path.join(runtime,name)).href;
const [{ProjectionStore},owner,{normalizeKnowledgeSourceDocument},{chunkKnowledgeDocument},profile,state]=await Promise.all([
  import(url('src/knowledge/retrieval/projection-store.ts')),
  import(url('src/runtime-core/knowledge-owner-read.ts')),
  import(url('src/knowledge/retrieval/source-document.ts')),
  import(url('src/knowledge/retrieval/chunker.ts')),
  import(url('src/knowledge/retrieval/index-profile.ts')),
  import(url('src/state/openclaw-state-db.ts')),
]);
const root=await mkdtemp(path.join(tmpdir(),'rag04-crash-lease-'));
const databasePath=path.join(root,'openclaw.sqlite');
try {
  const context=owner.deriveReadAdmissionContext({principalId:'agent-crash-probe',sessionId:'agent-crash-generation',workspaceId:'agent-crash-workspace',
    ownerNamespaces:['agent-crash-fixture'],policyDigest:'agent-crash-policy',egressProviderRefs:[],expiresAt:new Date(Date.now()+120000).toISOString()});
  const raw='# Crash lease probe\n\nAGENT_CRASH_PROBE 中文 😀\n';
  const snapshot=owner.createOwnerReadSnapshot({raw,startChar:0,endChar:raw.length,context,
    source:{domain:'wiki',authorityId:'agent-fixture',namespaceId:'agent-crash-fixture',subjectId:'crash-fixture.md',revision:'1'},
    policy:{status:'active',trust:'confirmed',sensitivity:'workspace',acl:{read:['agent-crash-probe']},retention:{policy:'source-coupled'}},title:'Crash probe'});
  const first=new ProjectionStore({database:{path:databasePath}});
  first.observe({source:snapshot.source,profileDigest:profile.lexicalProjectionProfileDigest,eligible:true,eventId:'agent-crash-observe',deadlineAt:Date.now()+60000});
  state.closeOpenClawStateDatabase();
  const child=`import {ProjectionStore} from ${JSON.stringify(url('src/knowledge/retrieval/projection-store.ts'))};
    const store=new ProjectionStore({database:{path:${JSON.stringify(databasePath)}}});
    const job=store.claim({namespaceId:'agent-crash-fixture',leaseOwner:'abrupt-child',leaseMs:5});
    process.stdout.write(JSON.stringify(job));
    process.exit(73);`;
  const processResult=spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',child],{
    cwd:runtime,env:process.env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  assert.equal(processResult.status,73,processResult.stderr);
  const abandoned=JSON.parse(processResult.stdout); assert.equal(abandoned.state,'leased');
  const restarted=new ProjectionStore({database:{path:databasePath}});
  const durableBefore=restarted.jobs('agent-crash-fixture');
  assert.equal(durableBefore[0].state,'leased'); assert.equal(durableBefore[0].attempt,1);
  await new Promise(resolve=>setTimeout(resolve,Math.max(1,abandoned.leaseExpiresAt-Date.now()+10)));
  assert.equal(restarted.recover('agent-crash-fixture'),1);
  const recovered=restarted.claim({namespaceId:'agent-crash-fixture',leaseOwner:'recovery-owner',leaseMs:30000});
  assert(recovered); assert.equal(recovered.attempt,2); assert.notEqual(recovered.leaseOwner,abandoned.leaseOwner);
  const document=normalizeKnowledgeSourceDocument({snapshot,context});
  const chunks=chunkKnowledgeDocument(document,{context,profile:profile.lexicalProjectionProfile,tokenizer:profile.lexicalProjectionTokenizer});
  assert.equal(restarted.publish(abandoned,chunks),undefined);
  const generation=restarted.publish(recovered,chunks); assert.equal(generation.state,'active');
  const hits=restarted.search({namespaceId:'agent-crash-fixture',query:'AGENT_CRASH_PROBE',limit:10,context});
  assert.equal(hits.status,'available'); assert(hits.candidates.length>0);
  const receipt={schema:'ProjectRagAbruptLeaseRecoveryProbe/v1',candidate:execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'}).trim(),
    actor:'codex/project-rag-crash-lease-probe',driven_by:'agent',fixtureOrigin:'agent-authored-owner-snapshot',clock:'real-wall-clock',
    childExitCode:processResult.status,abandonedLeasePersisted:true,abandonedClaim:{jobId:abandoned.jobId,attempt:1,leaseOwner:abandoned.leaseOwner},
    recoveredClaim:{jobId:recovered.jobId,attempt:2,leaseOwner:recovered.leaseOwner},oldLeasePublicationRejected:true,
    generation,lexicalHits:hits.candidates.length,status:'pass'};
  await mkdir(path.dirname(path.resolve(output)),{recursive:true}); await writeFile(path.resolve(output),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,childExitCode:receipt.childExitCode,recoveredAttempt:2,oldLeasePublicationRejected:true}));
} finally { state.closeOpenClawStateDatabase(); await rm(root,{recursive:true,force:true}); }
