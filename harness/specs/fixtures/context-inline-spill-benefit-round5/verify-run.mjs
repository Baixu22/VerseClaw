import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [dir,out]=process.argv.slice(2);
const design=JSON.parse(readFileSync(join(dir,'result.json'),'utf8')).design;
const expectedOutputTokens=design.maxOutputTokens??900;
const statsFile=out+'.stats.json';
execFileSync(process.execPath,[join(dirname(fileURLToPath(import.meta.url)),'context-inline-spill-benefit-round5-recompute.mjs'),dir,'-',statsFile],{stdio:'inherit',windowsHide:true});
const result=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));
const records=JSON.parse(readFileSync(join(dir,'runs.json'),'utf8')).records;
assert.equal(result.design.evidenceTasks.length,6);assert.equal(result.design.controlTasks.length,2);
assert.equal(records.length,4*8*result.design.repeats);
assert.equal(result.design.repeats,result.mode==='live'?3:1);
assert.equal(result.candidate.dirty,false,'primary fourth-round runs must use the clean candidate');
const hash=s=>createHash('sha256').update(s).digest('hex');
const oracle={'deploy-token':'DEPLOY_TOKEN_7f31ab','db-passport':'DB_PASSPORT_9c02de','cache-seed':'CACHE_SEED_44aa10','signing-key':'SIGNING_KEY_b71c55','tenant-id':'TENANT_ID_3d9e77','migration-hash':'MIGRATION_HASH_a1f4c8'};
let calls=0,outputs=0,baselineLeaks=0,incomplete=0,historyFallbacks=0,providerFailures=0;
const evictedEvidence=[];
for(const r of records){
 assert.equal(r.turns,r.providerCalls.length);
 assert.equal(r.mainContextChars,JSON.stringify(r.providerCalls.at(-1).request.input).length);
 assert.equal(r.initialRequestSha256,hash(JSON.stringify(r.providerCalls[0].request)));
 let inputTokens=0,outputTokens=0,totalTokens=0,modelRecalls=0;
 const modelCalls=[];
 for(const c of r.providerCalls){
  calls++;
  const body=JSON.stringify(c.request),inputJson=JSON.stringify(c.request.input);
  assert.equal(hash(body),c.request_sha256);assert.equal(body.length,c.request_chars);assert.equal(Buffer.byteLength(body),c.request_bytes);
  assert.equal(inputJson.length,c.input_chars);assert.equal(Buffer.byteLength(inputJson),c.input_bytes);
  assert.equal(c.request.max_output_tokens,expectedOutputTokens);assert.equal(c.request.temperature,0);
  if(result.design.reasoning)assert.deepEqual(c.request.reasoning,result.design.reasoning);
  const protocol=c.request.input.slice(1),callItems=protocol.filter(x=>x.type==='function_call');
  if(result.mode==='live'){
   assert.equal(callItems.length,modelCalls.length,'protocol function calls must come from earlier model responses');
   callItems.forEach((item,i)=>{const expected=modelCalls[i];assert.equal(item.call_id,expected.call_id);assert.equal(item.name,expected.name);let args={};try{args=JSON.parse(expected.arguments)}catch{}assert.equal(item.arguments,JSON.stringify(args))});
  }
  const expectedOutputs=c.projected_tool_outputs;
  for(const item of protocol.filter(x=>x.type==='function_call_output')){
   outputs++;
   const expected=Object.hasOwn(expectedOutputs,item.call_id)?expectedOutputs[item.call_id]:JSON.stringify({ok:false,diagnostics:[{code:'projection_omitted'}]});
   if(item.output!==expected)historyFallbacks++;
   assert.equal(item.output,expected,'output bypassed production projection');
   assert(callItems.some(call=>call.call_id===item.call_id));
   const value=oracle[r.fixtureId];if(value&&String(item.output).includes(value))assert(!String(c.request.input[0].content).includes(value),'recall appears in both prompt and protocol');
  }
  if(r.arm==='baseline-no-reference')for(const value of Object.values(oracle))if(inputJson.includes(value))baselineLeaks++;
  const value=oracle[r.fixtureId];
  if(value&&!Object.values(expectedOutputs).some(text=>String(text).includes(value))&&!String(c.request.input[0].content).includes(value)){assert(!inputJson.includes(value),'evicted oracle restored through hidden input');if(r.arm==='retention-off'&&r.turns-1===c.turn)evictedEvidence.push({fixtureId:r.fixtureId,repetition:r.repetition,success:r.success})}
  if(result.mode==='live'&&c.status!=='failed'){
   const raw=JSON.parse(c.raw_response);
   assert.deepEqual(raw.usage??null,c.usage);
   assert.equal(String(raw.output_text??''),c.text);
   const tools=(raw.output??[]).filter(x=>x.type==='function_call');assert.equal(tools.length,c.tool_call_count);
   modelCalls.push(...tools);modelRecalls+=tools.filter(x=>x.name==='context_archive_recall').length;
   incomplete+=Number(raw.status==='incomplete');
  }
  providerFailures+=Number(c.status==='failed');
  inputTokens+=Number(c.usage?.input_tokens??0);outputTokens+=Number(c.usage?.output_tokens??0);totalTokens+=Number(c.usage?.total_tokens??0);
 }
 assert.equal(inputTokens,r.inputTokens);assert.equal(outputTokens,r.outputTokens);assert.equal(totalTokens,r.totalTokens);
 if(result.mode==='live')assert.equal(r.recallAttempted,modelRecalls>0);
 assert.equal(r.recallOk,r.toolCalls.some(x=>x.ok));
 for(const t of r.toolCalls.filter(x=>x.raw_result)){const raw=JSON.parse(t.raw_result);assert.equal(raw.ok===true,t.ok);assert.equal(t.raw_result.length,t.result_chars);assert.equal(!!oracle[r.fixtureId]&&t.raw_result.includes(oracle[r.fixtureId]),t.result_has_oracle)}
 assert.equal(r.success,r.finalAnswer.ok&&r.finalAnswer.value===(oracle[r.fixtureId]??null));
}
assert.equal(baselineLeaks,0);assert.equal(historyFallbacks,0);
for(const pair of result.inputIntegrity.initialPairs){const a=records.find(r=>r.arm==='recall-stable'&&r.fixtureId===pair.fixtureId&&r.repetition===pair.repetition),b=records.find(r=>r.arm==='retention-off'&&r.fixtureId===pair.fixtureId&&r.repetition===pair.repetition);assert.equal(JSON.stringify(a.providerCalls[0].request),JSON.stringify(b.providerCalls[0].request));assert.equal(a.initialRequestSha256,b.initialRequestSha256)}
const facts={driven_by:'agent',actor:'codex-inline-spill-benefit-r4-relay',mode:result.mode,records:records.length,providerCalls:calls,protocolOutputs:outputs,initialPairs:result.inputIntegrity.initialPairs.length,allInitialPairsByteIdentical:true,actualInputCountsMatch:true,modelCallsAndRawUsageMatch:result.mode==='live',baselineOracleLeaks:baselineLeaks,unprojectedHistoryFallbacks:historyFallbacks,incompleteResponses:incomplete,providerFailures,retentionOffFinalOracleAbsent:evictedEvidence,stats:JSON.parse(readFileSync(statsFile,'utf8'))};
writeFileSync(out,JSON.stringify(facts,null,2)+'\n');
console.log(JSON.stringify({mode:result.mode,records:records.length,providerCalls:calls,initialPairs:facts.initialPairs,baselineLeaks,historyFallbacks,incomplete,passed:true}));
