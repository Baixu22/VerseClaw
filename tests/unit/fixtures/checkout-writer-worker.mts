import { createWorktreeService } from '../../../openclaw_runtime/src/agents/worktree-service.js';
import { normalizeRunScope } from '../../../shared/types/identity-scope.js';
import { closeOpenClawStateDatabaseForTest } from '../../../openclaw_runtime/src/state/openclaw-state-db.js';
import { withCheckoutMaintenance } from '../../../openclaw_runtime/src/agents/worktree-writer.js';
import { loadWorktreeRegistryScope, saveWorktreeRegistryScope } from '../../../openclaw_runtime/src/agents/worktree-registry.js';
import { withTaskLedgerJournalLockSync } from '../../../shared/task-ledger-journal-lock.js';
import path from 'node:path';

const input=JSON.parse(Buffer.from(process.argv[2],'base64').toString('utf8')) as {root:string;id:string;generation:string;owner:string;mode?:'crash'|'maintenance-prepare-crash'};
const service=createWorktreeService(input.root);
try {
 if(input.mode==='maintenance-prepare-crash'){
  withTaskLedgerJournalLockSync(path.join(input.root,'.openclaw/worktrees/.merge.lock'),()=>{
   const scope=loadWorktreeRegistryScope(input.root),record=scope.records.get(input.id)!;
   withCheckoutMaintenance([{root:record.root,generation:record.generation,incarnation:record.registration.rootIdentity!}],'cleanup',()=>{throw new Error('effect must not start');},()=>{
    record.status='cleaning';saveWorktreeRegistryScope(scope);process.stdout.write(JSON.stringify({ok:true,phase:'prepared'})+'\n');process.exit(23);
   });
  });
 }
 const writer=service.claimWriter(input.id,input.generation,{kind:'run',agentId:'test-agent',sessionGeneration:'session-v1',bindingRevision:1,
   run:normalizeRunScope({runId:input.owner,scope:{workspaceId:'workspace',projectId:'project',sessionKey:`agent:test:${input.owner}`}})},`request:${input.owner}`);
 if(input.mode==='crash')service.beginWrite(writer,'effect','request-digest');
 process.stdout.write(JSON.stringify({ok:true,writer})+'\n');
 process.stdin.once('data',()=>{
   if(input.mode==='crash')process.exit(23);
   service.releaseWriter(writer);closeOpenClawStateDatabaseForTest();process.exit(0);
 });process.stdin.resume();
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:String(error)})+'\n');closeOpenClawStateDatabaseForTest();process.exit(0);}
