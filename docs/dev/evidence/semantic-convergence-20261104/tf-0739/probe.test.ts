import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {runRc03SealHook,resetRc03SealPlansForTest} from 'D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/src/context-engine/rc03-seal-hook.ts';
import {resetSealRegistryForTests} from 'D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/src/context-engine/seal-registry.ts';
import {resolveEmbeddedAgentStreamFn} from 'D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution.ts';
import {closeOpenClawStateDatabase} from 'D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/src/state/openclaw-state-db.ts';
let directory:string;
beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),'tf0739-probe-'));vi.stubEnv('OPENCLAW_STATE_DIR',directory);vi.stubEnv('OPENCLAW_CONFIG_PATH',join(directory,'absent.json'));vi.stubEnv('OPENCLAW_RC03_SEAL','');vi.stubEnv('OPENCLAW_RC02_SHADOW_CENSUS','');});
afterEach(()=>{closeOpenClawStateDatabase();resetRc03SealPlansForTest();resetSealRegistryForTests();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
it('measures unknown source and post-seal prompt behavior without claiming baseline acceptance',()=>{
 const observations:{operation:string;rejected:boolean;providerCalls?:number}[]=[];
 const lineage={sourceId:'unregistered-probe',candidateId:'probe',dedupKey:'probe',channel:'knowledge',target:'system_prompt',charsApplied:5,charsRequested:5,reason:'applied',disposition:'applied'};
 let rejected=false;
 try{runRc03SealHook({messages:[],lineage:[lineage],systemPromptAddition:'probe'} as never,[],{enabled:true,runId:'probe-unknown',systemPrompt:'base'});}catch{rejected=true;}
 observations.push({operation:'unknown-pre-seal-producer',rejected});
 runRc03SealHook({messages:[],lineage:[]} as never,[],{enabled:true,runId:'probe-stream',systemPrompt:'base'});
 let providerCalls=0;
 const wrapped=resolveEmbeddedAgentStreamFn({currentStreamFn:undefined,providerStreamFn:(()=>{providerCalls++;return {} as never;}),sessionId:'probe-session',runId:'probe-stream',model:{provider:'fixture',api:'fixture',id:'fixture'} as never});
 rejected=false;
 try{wrapped({provider:'fixture'} as never,{systemPrompt:'base plus unregistered instructions',messages:[]} as never);}catch{rejected=true;}
 observations.push({operation:'post-seal-system-change',rejected,providerCalls});
 const expected=process.env.RC03_PROBE_EXPECT_REJECTION==='1';
 expect(observations.map(row=>row.rejected)).toEqual([expected,expected]);
 expect(providerCalls).toBe(expected?0:1);
 writeFileSync(process.env.RC03_PROBE_OUT!,JSON.stringify({driven_by:'agent',actor:'codex/context-prompt-owner',expectedRejection:expected,observations},null,2));
});
it.skipIf(process.env.RC03_PROBE_BASELINE==='1')('records current seal denials and legal continuation from actual APIs',async()=>{
 const {assertSealMutation,getSealProducer,registerSealProducer,getSealCoverageMatrix}=await import('D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/src/context-engine/seal-registry.ts');
 const {registerRc03SealProducers}=await import('D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/src/context-engine/rc03-producers.ts');
 registerRc03SealProducers();
 const events:Array<Record<string,unknown>>=[];
 const refused=(operation:string,action:()=>unknown)=>{let error:unknown;try{action();}catch(e){error=e;}expect(error).toBeInstanceOf(Error);events.push({operation,outcome:'rejected',error:(error as Error).message});};
 refused('unknown-pre-seal',()=>assertSealMutation('unknown-agent-probe','pre-seal'));
 refused('semantic-post-seal',()=>assertSealMutation('compass-ssp','post-seal'));
 refused('duplicate-registration',()=>registerSealProducer(getSealProducer('compass-ssp')!));
 let providerCalls=0;
 runRc03SealHook({messages:[],lineage:[]} as never,[],{enabled:true,runId:'decision-run',systemPrompt:'base'});
 const wrapped=resolveEmbeddedAgentStreamFn({currentStreamFn:undefined,providerStreamFn:(()=>{providerCalls++;return {} as never;}),sessionId:'agent-decision-session',runId:'decision-run',model:{provider:'fixture',api:'fixture',id:'fixture'} as never});
 refused('changed-post-seal-prompt',()=>wrapped({provider:'fixture'} as never,{systemPrompt:'changed',messages:[]} as never));
 expect(providerCalls).toBe(0);events.push({operation:'provider-after-denial',providerCalls});
 wrapped({provider:'fixture'} as never,{systemPrompt:'base',messages:[]} as never);
 expect(providerCalls).toBe(1);events.push({operation:'legal-same-call-after-denial',outcome:'admitted',modelCallIndex:0,providerCalls});
 runRc03SealHook({messages:[],lineage:[]} as never,[],{enabled:true,runId:'decision-run',modelCallIndex:1,systemPrompt:'base'});
 wrapped({provider:'fixture'} as never,{systemPrompt:'base',messages:[]} as never);
 expect(providerCalls).toBe(2);events.push({operation:'legal-continuation',outcome:'admitted',modelCallIndex:1,providerCalls});
 writeFileSync('D:/tmp/tf0739-final-decisions.json',JSON.stringify({driven_by:'agent',actor:'codex/context-prompt-owner',provider:'simulated-stream-function',matrix:getSealCoverageMatrix(),events},null,2));
});
