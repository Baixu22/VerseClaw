import { repoRoot, outRoot, sourceUrl } from '../support.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const out=outRoot;
const area=fs.mkdtempSync(path.join(out,'routes-'));
process.env.OPENCLAW_HOME=area;
process.env.OPENCLAW_STATE_DIR=path.join(area,'state');
process.env.OPENCLAW_CONFIG_PATH=path.join(area,'openclaw.json');
fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH,'{}');
const rows:Array<Record<string,unknown>>=[];
const keep=(id:string,actual:unknown)=>rows.push({id,actual});
try {
  const { listGatewayMethods } = await import(sourceUrl('openclaw_runtime/src/gateway/server-methods-list.ts'));
  const names=listGatewayMethods();
  keep('stock-gateway-methods',Object.fromEntries(['mcp.listTools','mcp.callTool','mcp.heartbeat','tools.catalog','tools.effective','tools.invoke','orchestrator.plan','orchestrator.run'].map(n=>[n,names.includes(n)])));
  const { handleMcpJsonRpc } = await import(sourceUrl('openclaw_runtime/src/gateway/mcp-http.handlers.ts'));
  const { CallToolResultSchema }=await import(sourceUrl('openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js'));
  const adapt=(value:unknown)=>handleMcpJsonRpc({message:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'fixture',arguments:{}}},toolSchema:[{name:'fixture',description:'generated fixture',inputSchema:{type:'object'}}],tools:[{name:'fixture',execute:async()=>value}] as never,hookContext:{config:{}}});
  const image=await adapt({content:[{type:'image',data:'AA==',mimeType:'image/png'}],details:{}});
  const err=await adapt({content:[{type:'text',text:'fixture failed'}],details:{status:'error',mcpServer:'fixture',mcpTool:'probe'}});
  keep('mcp-image-real-hook-and-sdk',{actual:image,sdkAccepted:CallToolResultSchema.safeParse((image as any)?.result).success});
  keep('mcp-error-real-hook',{actual:err});
} catch(err){rows.push({id:'mcp-probe-error',error:String(err)});}
try {
  const { roleOrchestrationHandlers }=await import(sourceUrl('openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts'));
  const { runOrchestrationObserved }=await import(sourceUrl('openclaw_runtime/src/agents/orchestrator-run-observed.ts'));
  const worker={roleName:'implementer',task:'audit fixture only',writeSet:['sample.txt']};
  const base={task:'audit fixture',workspaceDir:area,workers:[worker],maxWorkers:1,includeVerifier:false};
  const ctx={agentSessionKey:'agent:main:audit'};
  const plan=async(params:unknown)=>{ let captured:any; await roleOrchestrationHandlers['orchestrator.plan']({params, context:{getRuntimeConfig:()=>({})},respond:(ok:boolean,body:any,error:any)=>{captured={ok,error,planIsolation:body?.plan?.isolation,workerIsolation:body?.taskGraph?.nodes?.[0]?.isolation??null};}} as never); return captured; };
  keep('rpc-top-level-isolation',{requested:'worktree',actual:await plan({...base,isolation:'worktree'}),workerOverride:await plan({...base,workers:[{...worker,isolation:'worktree'}]})});
  let wouldSpawn=0;
  const runner=await runOrchestrationObserved({...base,orchestrationRunId:'audit-isolation',workers:[{...worker,isolation:'worktree'}],cfg:{}},ctx,{spawn:async()=>{wouldSpawn++;return {status:'error',error:'fixture spawn sentinel'};} } as never);
  keep('rpc-run-workspace-carrier',{requestedRoot:area,ctxHasRoot:false,spawnCalls:wouldSpawn,failures:runner.failures});
  for (const optIn of [false,true]) {
    const probes:any[]=[];
    const bundle=await runOrchestrationObserved({ task:'audit dense multi-worker request', workspaceDir:area, durationMinutes:45, graphMode:'flat', maxWorkers:3, includeVerifier:false, cfg:{}, orchestrationRunId:'audit-patch-'+optIn, ...(optIn?{patchFlowExecution:true}:{}), workers:[1,2,3].map(n=>({...worker,task:'fixture '+n})) },{...ctx,workspaceDir:area},{spawn:async(params:any,spawnCtx:any)=>{probes.push({deniedWrite:spawnCtx.inheritedToolDenylist?.includes('write')??false,proposalPrompt:JSON.stringify(params).includes('Patch-Flow Proposal Contract')});return {status:'error',error:'fixture spawn sentinel'};} } as never);
    keep('retired-patch-flow-explicit-'+optIn,{recommendation:bundle.plan.routeDiagnostics.isolationAdvisory?.recommendedMode,spawnProbes:probes,failures:bundle.failures});
  }
} catch(err){rows.push({id:'orchestration-probe-error',error:String(err)});}
try {
  const coding=await import(sourceUrl('shared/types/coding-run.ts'));
  const head=coding.createCodingRunView({codingRunId:'run-A'});
  for(const [name,events] of [['optional',[{type:'loop',codingRunId:'run-A',phase:'verify',status:'complete',iteration:null}]],['cross-run',[{type:'verification',codingRunId:'run-B',status:'passed',authority:'task-loop-verification'}]]] as const){
    const p=path.join(area,name+'.jsonl');fs.writeFileSync(p,coding.serializeCodingRunJsonl(head,events as never));
    const r=spawnSync(process.execPath,['scripts/coding-run-summary.mjs',p],{cwd:repoRoot,encoding:'utf8',windowsHide:true});
    keep('coding-run-cli-'+name,{exit:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()});
  }
} catch(err){rows.push({id:'cli-probe-error',error:String(err)});}
const report={driven_by:'agent',actor:'codex-coding-audit',realHumanEvidence:false,area,candidate:execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),rows};
fs.writeFileSync(path.join(out,'routing-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
process.exitCode=rows.some(r=>'error' in r)?2:0;
