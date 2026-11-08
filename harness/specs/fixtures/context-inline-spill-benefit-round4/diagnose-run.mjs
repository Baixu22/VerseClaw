import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [dir,out]=process.argv.slice(2);
const result=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));
const rows=JSON.parse(readFileSync(join(dir,'runs.json'),'utf8')).records;
const oracle={'deploy-token':'DEPLOY_TOKEN_7f31ab','db-passport':'DB_PASSPORT_9c02de','cache-seed':'CACHE_SEED_44aa10','signing-key':'SIGNING_KEY_b71c55','tenant-id':'TENANT_ID_3d9e77','migration-hash':'MIGRATION_HASH_a1f4c8'};
const pageSizes={},statuses={},incompleteReasons={},returnedModels={},ignoredTexts=[],byArm={};
for(const r of rows){
 const arm=byArm[r.arm]??={rawOracleHits:0,overProjectionBudgetCalls:0,oracleDroppedBeforeNextRequest:0,modelRecalls:0};
 for(const t of r.toolCalls){arm.modelRecalls++;const size=t.arguments?.max_chars??'missing';pageSizes[size]=(pageSizes[size]??0)+1;arm.overProjectionBudgetCalls+=Number(t.result_chars>result.design.toolMaxChars);arm.rawOracleHits+=Number(t.result_has_oracle);if(t.result_has_oracle){const next=r.providerCalls.find(c=>Object.hasOwn(c.projected_tool_outputs,t.call_id));if(next&&!String(next.projected_tool_outputs[t.call_id]).includes(oracle[r.fixtureId]))arm.oracleDroppedBeforeNextRequest++}}
 for(const c of r.providerCalls){if(!c.raw_response||c.status==='failed')continue;const raw=JSON.parse(c.raw_response);statuses[raw.status]=(statuses[raw.status]??0)+1;returnedModels[raw.model??'unspecified']=(returnedModels[raw.model??'unspecified']??0)+1;if(raw.status==='incomplete'){const reason=raw.incomplete_details?.reason??'unspecified';incompleteReasons[reason]=(incompleteReasons[reason]??0)+1}const text=(raw.output??[]).filter(x=>x.type==='message').flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text??'').join('\n');if(raw.status==='completed'&&!c.text&&text)ignoredTexts.push({arm:r.arm,fixtureId:r.fixtureId,repetition:r.repetition,turn:c.turn,messageTextChars:text.length})}
}
const evidence=new Set(result.design.evidenceTasks);
const retentionPairs={};
for(const [kind,include] of Object.entries({evidence:r=>evidence.has(r.fixtureId),control:r=>!evidence.has(r.fixtureId)})){
 const counts={pairs:0,both:0,onlyStable:0,onlyOff:0,neither:0};
 for(const stable of rows.filter(r=>r.arm==='recall-stable'&&include(r))){
  const off=rows.find(r=>r.arm==='retention-off'&&r.fixtureId===stable.fixtureId&&r.repetition===stable.repetition);
  if(!off)throw new Error('Missing retention pair');
  counts.pairs++;counts[stable.success?(off.success?'both':'onlyStable'):(off.success?'onlyOff':'neither')]++;
 }
 retentionPairs[kind]=counts;
}
const calls=rows.flatMap(r=>r.providerCalls),tools=rows.flatMap(r=>r.toolCalls);
const validSize=t=>Number.isSafeInteger(t.arguments?.max_chars)&&t.arguments.max_chars>=1&&t.arguments.max_chars<=5500;
const pageContract={allToolDefinitionsIdentical:new Set(calls.map(c=>JSON.stringify(c.request.tools))).size===1,
 validSizeCalls:tools.filter(validSize).length,invalidSizeCalls:tools.filter(t=>!validSize(t)).length,
 invalidSizeDiagnostics:tools.filter(t=>!validSize(t)&&t.raw_result&&JSON.parse(t.raw_result).diagnostics?.[0]?.code==='invalid_arguments').length,
 maxSerializedResultChars:Math.max(0,...tools.map(t=>t.result_chars))};
const diagnostics={driven_by:'agent',actor:'codex-inline-spill-benefit-r4-relay',pageArgumentCounts:pageSizes,responseStatuses:statuses,incompleteReasons,returnedModels,completedMessageTextIgnoredByAdapter:ignoredTexts,byArm,retentionPairs,pageContract,note:'Observed request sizes and raw/projection differences; these diagnostics do not change scoring or frozen thresholds.'};
writeFileSync(out,JSON.stringify(diagnostics,null,2)+'\n');console.log(JSON.stringify(diagnostics));
