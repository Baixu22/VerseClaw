import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const {values}=parseArgs({options:{root:{type:'string'},'run-dir':{type:'string'},out:{type:'string'}}});
assert(values.root&&values['run-dir']&&values.out,'root, run-dir and out required');
const root=resolve(values.root),dir=resolve(values['run-dir']);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const plan=read(join(dir,'plan.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [path,digest]of Object.entries(plan.source.bindings))assert.equal(hash(readFileSync(join(root,path),'utf8').replace(/\r\n?/gu,'\n')),digest,`verifier-source-drift:${path}`);
const {checkBenefitRun}=await import(pathToFileURL(join(root,'scripts/lib/rsi-benefit-eval.mjs')).href);
const {parseResponsesReply}=await import(pathToFileURL(join(root,'scripts/lib/rsi-responses-provider.mjs')).href);
const {parseCodingEdits}=await import(pathToFileURL(join(root,'scripts/lib/rsi-coding-protocol.mjs')).href);
assert.equal(plan.evidenceKind,'live-provider');assert.equal(plan.design.k,3);assert.equal(plan.slots.length,216);
assert.equal(plan.design.minimumImprovement,0.05);assert.equal(plan.design.costIncreaseMaximum,0.1);
const counts={pass:0,fail:0,incomplete:0,unexecuted:0},outcomes=new Map(),ids=new Set();
let knownTokens=0,unknownUsage=0,providerAttempts=0,terminalResponses=0;
for(const slot of plan.slots){
  let row;try{row=read(join(dir,'trials',slot.id+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;counts.unexecuted++;continue;}
  assert.equal(row.execution.attempts,1);assert.equal(row.providerAttempts.length,1);providerAttempts++;
  const raw=row.providerAttempts[0].rawResponse;
  if(raw){const parsed=parseResponsesReply(raw);assert(!ids.has(parsed.id),'reused-terminal-response');ids.add(parsed.id);terminalResponses++;
    if(parsed.usage)knownTokens+=parsed.usage.totalTokens;else unknownUsage++;
  }else unknownUsage++;
  let outcome='incomplete';
  if(row.execution.status==='completed'){
    const response=parseResponsesReply(row.rawResponse);
    if(response.status==='incomplete'&&response.incompleteReason==='max_output_tokens'&&response.usage&&plan.collector.incompleteOutcome==='known-output-limit-is-failure'){
      assert.equal(row.execution.failureCategory,'model-output-limit');assert.equal(row.grader,null);assert.deepEqual(row.edits,[]);outcome='fail';
    }else if(response.status==='completed'){
      const task=plan.tasks.find(t=>t.id===slot.caseId);let edits;
      try{edits=parseCodingEdits(response.text,task);}catch{assert.equal(row.execution.failureCategory,'model-format');outcome='fail';}
      if(edits){assert.deepEqual(edits,row.edits);const reports=row.grader?.reports;
        assert(Array.isArray(reports)&&reports.length===task.oracle.commands.length&&reports.length>0,'missing-independent-grade');
        const passed=reports.every(report=>report.exitCode===0&&(report.kind==='command'?report.report.exitCode===0:
          report.report.success===true&&report.report.numTotalTests>0&&report.report.numFailedTests===0&&report.report.numPendingTests===0&&
          report.report.testResults.flatMap(s=>s.assertionResults).every(a=>a.status==='passed')));
        outcome=passed?'pass':'fail';
      }
    }
  }
  counts[outcome]++;outcomes.set(slot.id,outcome);
}
const armCase=(task,arm)=>{const slots=plan.slots.filter(s=>s.caseId===task.id&&s.arm===arm);const results=slots.map(s=>outcomes.get(s.id));return results.every(r=>r==='pass'||r==='fail')?Number(results.every(r=>r==='pass')):null;};
const pairs=plan.tasks.map(task=>({caseId:task.id,off:armCase(task,'sekb-off'),confirmed:armCase(task,'sekb-confirmed')})).filter(p=>p.off!==null&&p.confirmed!==null);
const diffs=pairs.map(p=>p.confirmed-p.off),n=diffs.length;
const descriptiveMean=n?diffs.reduce((a,b)=>a+b,0)/n:null;
const enoughCases=n>=plan.design.minimumCompleteCases;
const mean=enoughCases?descriptiveMean:null;
const variance=n>1?diffs.reduce((sum,d)=>sum+(d-descriptiveMean)**2,0)/(n-1):null;
const ci=enoughCases&&variance>0?[mean-1.96*Math.sqrt(variance/n),mean+1.96*Math.sqrt(variance/n)]:null;
const saved=read(join(dir,'report.json')),reported=saved.comparisons.confirmedVsOff.pairedDiff;
assert.equal(reported.pairCount,n);assert(mean===null?reported.meanDiff===null:Math.abs(reported.meanDiff-mean)<1e-6,'paired-case-effect-drift');
assert(ci===null?reported.ci95===null:ci.every((v,i)=>Math.abs(v-reported.ci95[i])<1e-5),'independent-interval-drift');
const checked=checkBenefitRun(root,dir);
const result={driven_by:'agent',actor:'codex/rsi-final-independent-verifier',candidate:plan.source.commit,verifierCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),
  runId:plan.runId,scope:'Independent receipt projection and case-cluster arithmetic over the frozen run.',counts,
  provider:{capturedAttempts:providerAttempts,terminalResponses,knownTokens,unknownUsage},paired:{cases:n,descriptiveMean,meanDiff:mean,ci95:ci,unit:'caseId',k:3,minimumCompleteCases:plan.design.minimumCompleteCases},integrity:checked,
  claims:{newProviderCalls:false,realHuman:false,promotionReady:false,productDefaultsChanged:false}};
writeFileSync(resolve(values.out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));if(!checked.passed)process.exitCode=1;
