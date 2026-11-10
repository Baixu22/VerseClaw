import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const runtime=path.resolve('openclaw_runtime');
const load=file=>import(pathToFileURL(path.join(runtime,file)).href);
const [{ProjectionStore},owner,{normalizeKnowledgeSourceDocument},{chunkKnowledgeDocument},profile,state]=await Promise.all([
  load('src/knowledge/retrieval/projection-store.ts'),load('src/runtime-core/knowledge-owner-read.ts'),
  load('src/knowledge/retrieval/source-document.ts'),load('src/knowledge/retrieval/chunker.ts'),
  load('src/knowledge/retrieval/index-profile.ts'),load('src/state/openclaw-state-db.ts'),
]);
const output=process.argv[2];assert(output,'Pass an output receipt path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'rag04-locator-fence-'));
try {
  const context=owner.deriveReadAdmissionContext({principalId:'agent-fixture',sessionId:'fixture-generation',workspaceId:'fixture-workspace',ownerNamespaces:['agent-fixture'],
    policyDigest:'agent-fixture-policy',egressProviderRefs:[],expiresAt:new Date(Date.now()+60000).toISOString()});
  const raw='alpha\n配置\n';
  const common={raw,context,policy:{status:'active',trust:'confirmed',sensitivity:'workspace',acl:{read:['agent-fixture']},retention:{policy:'source-coupled'}},
    source:{domain:'wiki',authorityId:'agent-fixture',namespaceId:'agent-fixture',subjectId:'same-file.md',revision:'1'},title:'Locator fixture'};
  const full=owner.createOwnerReadSnapshot({...common,startChar:0,endChar:raw.length});
  const ranged=owner.createOwnerReadSnapshot({...common,startChar:6,endChar:raw.length});
  assert.equal(full.source.sourceDigest,ranged.source.sourceDigest);
  const store=new ProjectionStore({database:{path:path.join(root,'openclaw.sqlite')}});
  const initial=store.observe({source:full.source,profileDigest:profile.lexicalProjectionProfileDigest,eligible:true,eventId:'full-source',deadlineAt:Date.now()+30000});
  const job=store.claim({namespaceId:'agent-fixture',leaseOwner:'fixture-worker',leaseMs:30000});assert(job);
  const chunks=chunkKnowledgeDocument(normalizeKnowledgeSourceDocument({snapshot:full,context}),{context,profile:profile.lexicalProjectionProfile,tokenizer:profile.lexicalProjectionTokenizer});
  const generation=store.publish(job,chunks);assert(generation);
  const changed=store.observe({source:ranged.source,profileDigest:profile.lexicalProjectionProfileDigest,eligible:true,eventId:'changed-range',deadlineAt:Date.now()+30000});
  const fenced=changed.source.sourceKey===initial.source.sourceKey&&changed.source.intentSequence===initial.source.intentSequence+1
    &&changed.source.eligible===false&&changed.source.activeGeneration===null&&changed.job?.state==='pending'
    &&store.generations(initial.source.sourceKey).every(row=>row.state==='retired');
  const receipt={schema:'ProjectRagLocatorIntentProbe/v1',actor:'codex/project-rag',driven_by:'agent',candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    scope:'single SQLite owner; no native model, Electron or full gates',fixtureOrigin:'agent-authored owner snapshots sharing file/revision/digest/policy',
    initialSource:initial.source,changedSource:changed.source,newJob:changed.job??null,oldGeneration:store.generations(initial.source.sourceKey),
    expected:'same subject row; changed locator advances intent, revokes old eligibility and schedules a new job',status:fenced?'pass':'fail'};
  fs.writeFileSync(path.resolve(output),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,initialIntent:initial.source.intentSequence,changedIntent:changed.source.intentSequence,
    oldGenerationStillEligible:changed.source.eligible,newJobCreated:Boolean(changed.job),output:path.resolve(output)}));
  if(process.argv.includes('--assert'))assert(fenced,'changed owner range did not fence the active generation');
}finally{state.closeOpenClawStateDatabase();fs.rmSync(root,{recursive:true,force:true});}
