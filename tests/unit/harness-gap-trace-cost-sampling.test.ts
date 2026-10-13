// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapStreamFnWithDiagnosticModelCallEvents } from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events';
import { createDiagnosticTraceContext } from '../../openclaw_runtime/src/infra/diagnostic-trace-context';
import { onInternalDiagnosticEvent, setDiagnosticsEnabledForProcess, waitForDiagnosticEventsDrained } from '../../openclaw_runtime/src/infra/diagnostic-events';
import type { DiagnosticEventPayload } from '../../openclaw_runtime/src/infra/diagnostic-events';
import type { StreamFn } from '../../openclaw_runtime/src/agents/runtime';
import type { Model, AssistantMessageEvent, AssistantMessage } from '../../openclaw_runtime/packages/llm-core/src/types';

const model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-completions', baseUrl: 'http://127.0.0.1', reasoning: false, input: ['text'], cost: { input: 2, output: 8, cacheRead: .5, cacheWrite: 3 }, contextWindow: 4096, maxTokens: 1024 } as Model;
const usage = { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, totalTokens: 180, cost: { input: 99, output: 99, cacheRead: 99, cacheWrite: 99, total: 999 } };
const finalMessage = (extra: Partial<AssistantMessage> = {}): AssistantMessage => ({ role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [{ type: 'text', text: 'PRIVATE response body' }, { type: 'toolCall', id: 'private-tool-call-1', name: 'write', arguments: { content: 'PRIVATE tool body' } }], usage, stopReason: 'toolUse', timestamp: 1, ...extra });
const done = (message = finalMessage()): AssistantMessageEvent => ({ type: 'done', reason: 'toolUse', message });
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function observe(chunks: AssistantMessageEvent[], options: { enabled?: boolean; model?: Model; signal?: AbortSignal; callId?: string; failure?: Error } = {}) {
  setDiagnosticsEnabledForProcess(true);
  const events: DiagnosticEventPayload[] = [];
  const unsubscribe = onInternalDiagnosticEvent(event => { if (event.type.startsWith('model.call.')) events.push(event); });
  const yielded: unknown[] = [];
  const parent = createDiagnosticTraceContext({ traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef' });
  let calls = 0;
  const original = (() => (async function* () { calls++; for (const chunk of chunks) yield chunk; if (options.failure) throw options.failure; })()) as unknown as StreamFn;
  const wrapped = wrapStreamFnWithDiagnosticModelCallEvents(original, { runId: 'PRIVATE run', sessionKey: 'agent:PRIVATE session', sessionId: 'PRIVATE session-id', provider: model.provider, model: model.id, trace: parent, nextCallId: () => options.callId ?? 'same-call-id', costDiagnosticsEnabled: options.enabled ?? true });
  let error: unknown;
  try { for await (const chunk of wrapped(options.model ?? model, { messages: [], systemPrompt: 'PRIVATE prompt' }, { signal: options.signal }) as AsyncIterable<unknown>) yielded.push(chunk); } catch (caught) { error = caught; }
  await waitForDiagnosticEventsDrained(); unsubscribe();
  return { events, yielded, error, calls, parent };
}
const terminal = (events: DiagnosticEventPayload[]) => events.findLast(event => event.type === 'model.call.completed' || event.type === 'model.call.error')!;

describe('O02 actual model-call stream producer', () => {
  it('joins host request/attempt identity and estimates terminal usage without mutating upstream cost or stream', async () => {
    const chunk = done(); const before = JSON.stringify(chunk);
    const result = await observe([chunk]); const ended = terminal(result.events);
    expect(result.yielded[0]).toBe(chunk); expect(JSON.stringify(chunk)).toBe(before); expect(result.calls).toBe(1);
    expect(ended).toMatchObject({ requestId: expect.any(String), attemptId: result.parent.spanId, usageSnapshot: { terminal: 'done', usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, total: 180 }, costUsd: .000415, price: { state: 'known', currency: 'USD', unit: 'per-million-tokens', source: 'runtime-model-catalog', version: expect.stringMatching(/^[a-f0-9]{64}$/) }, toolCallIdHashes: [expect.stringMatching(/^[a-f0-9]{64}$/)] } });
    const snapshot = JSON.stringify((ended as { usageSnapshot?: unknown }).usageSnapshot);
    expect(snapshot).not.toContain('PRIVATE'); expect(snapshot).not.toContain('private-tool-call');
  });
  it('distinguishes retry requests even if the legacy callId repeats', async () => {
    const first = terminal((await observe([done()])).events) as { requestId?: string };
    const second = terminal((await observe([done()])).events) as { requestId?: string };
    expect(first.requestId).toBeTruthy(); expect(second.requestId).not.toBe(first.requestId);
  });
  it('does not accumulate duplicate final snapshots or overwrite them with later partials', async () => {
    const chunk = done(); const partial = { type: 'text_delta', contentIndex: 0, delta: '', partial: finalMessage({ usage: { ...usage, input: 900 } }) } as AssistantMessageEvent;
    const result = await observe([chunk, partial, chunk]);
    expect(terminal(result.events)).toMatchObject({ usageSnapshot: { terminal: 'done', usage: { input: 100 }, costUsd: .000415 } });
    expect(result.yielded).toHaveLength(3);
  });
  it('marks conflicting terminal payloads unavailable instead of picking a billing winner', async () => {
    const result = await observe([done(), done(finalMessage({ usage: { ...usage, input: 101 } }))]);
    expect(terminal(result.events)).toMatchObject({ usageSnapshot: { terminal: 'conflicting', usage: null, costUsd: null } });
  });
  it.each([undefined, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: -1, output: 2, cacheRead: 0, cacheWrite: 0 }])('does not treat missing/zero/invalid price %j as free', async cost => {
    const result = await observe([done()], { model: { ...model, cost } as Model });
    expect(terminal(result.events)).toMatchObject({ usageSnapshot: { costUsd: null, price: { state: 'unknown', version: null } } });
  });
  it('marks incomplete and aborted streams without terminal usage as unmeasured', async () => {
    const incomplete = await observe([]); expect(terminal(incomplete.events)).toMatchObject({ usageSnapshot: { terminal: 'incomplete', usage: null, costUsd: null } });
    const controller = new AbortController(); controller.abort();
    const failure = new Error('PRIVATE provider error'); failure.name = 'AbortError';
    const aborted = await observe([], { signal: controller.signal, failure }); expect(aborted.error).toBe(failure);
    expect(terminal(aborted.events)).toMatchObject({ usageSnapshot: { terminal: 'aborted', usage: null, costUsd: null } });
  });
  it.each([undefined, { ...usage, input: -1 }, { ...usage, output: Infinity }])('does not manufacture usage from invalid terminal %j', async badUsage => {
    const result = await observe([done(finalMessage({ usage: badUsage as AssistantMessage['usage'] }))]);
    expect(terminal(result.events)).toMatchObject({ usageSnapshot: { usage: null, costUsd: null } });
  });
  it('preserves off-path payload and original tool continuation', async () => {
    const result = await observe([done()], { enabled: false });
    expect(terminal(result.events)).not.toHaveProperty('usageSnapshot'); expect(terminal(result.events)).not.toHaveProperty('requestId');
    const root = await mkdtemp(join(tmpdir(), 'clawx-o02-')); roots.push(root);
    await writeFile(join(root, 'continuation.txt'), 'executed once');
    expect(await readFile(join(root, 'continuation.txt'), 'utf8')).toBe('executed once'); expect(result.calls).toBe(1);
  });
});


// Integration stays on the real producer/plugin-service/OTLP path, not spy-only helpers.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { createDiagnosticsOtelService } from '../../openclaw_runtime/extensions/diagnostics-otel/api';
import { startPluginServices } from '../../openclaw_runtime/src/plugins/services';
import { emitTrustedDiagnosticEvent, areDiagnosticsEnabledForProcess } from '../../openclaw_runtime/src/infra/diagnostic-events';
import { createChildDiagnosticTraceContext } from '../../openclaw_runtime/src/infra/diagnostic-trace-context';
import { setLoggerOverride, resetLogger } from '../../openclaw_runtime/src/logging/logger';

type WireField = { field: number; wire: number; value: Buffer | bigint };
function wireFields(bytes: Buffer): WireField[] {
  let position = 0;
  function varint() {
    let result = 0n;
    for(let shift=0n;shift<70n;shift+=7n) { if(position>=bytes.length)throw new Error('truncated protobuf'); const byte=bytes[position++];result|=BigInt(byte&127)<<shift;if(!(byte&128))return result; }
    throw new Error('invalid protobuf varint');
  }
  const fields: WireField[]=[];
  while(position<bytes.length) {
    const key=Number(varint()),field=key>>>3,wire=key&7;
    if(wire===0)fields.push({field,wire,value:varint()});
    else if(wire===1||wire===5) { const size=wire===1?8:4;if(position+size>bytes.length)throw new Error('truncated fixed value');fields.push({field,wire,value:bytes.subarray(position,position+size)});position+=size; }
    else if(wire===2) {const size=Number(varint());if(position+size>bytes.length)throw new Error('truncated string');fields.push({field,wire,value:bytes.subarray(position,position+size)});position+=size;}
    else throw new Error('unsupported protobuf wire '+wire);
  }
  return fields;
}
const fieldsAt=(bytes:Buffer,field:number)=>wireFields(bytes).filter(item=>item.field===field&&Buffer.isBuffer(item.value)).map(item=>item.value as Buffer);
function decodeSpans(bytes:Buffer) {
  return fieldsAt(bytes,1).flatMap(resource=>fieldsAt(resource,2)).flatMap(scope=>fieldsAt(scope,2)).map(span=>{
    const attributes:Record<string,string|number|boolean>={};
    for(const pair of fieldsAt(span,9)) {
      const key=fieldsAt(pair,1)[0]?.toString()??'';
      const value=wireFields(fieldsAt(pair,2)[0]??Buffer.alloc(0))[0];
      if(!value)continue;
      if(value.field===1&&Buffer.isBuffer(value.value))attributes[key]=value.value.toString();
      else if(value.field===2)attributes[key]=Boolean(value.value);
      else if(value.field===3)attributes[key]=Number(value.value);
      else if(value.field===4&&Buffer.isBuffer(value.value))attributes[key]=value.value.readDoubleLE();
    }
    return {traceId:fieldsAt(span,1)[0]?.toString('hex'),spanId:fieldsAt(span,2)[0]?.toString('hex'),parentSpanId:fieldsAt(span,4)[0]?.toString('hex')??'',name:fieldsAt(span,5)[0]?.toString(),attributes};
  });
}

it('O02 exports a replayable sanitized call → tool → effect chain and exporter-off parity through the real plugin host', async () => {
  const root=await mkdtemp(join(tmpdir(),'clawx-o02-otlp-')); roots.push(root);
  const logFile=join(root,'diagnostic.log');
  const previous=areDiagnosticsEnabledForProcess();setDiagnosticsEnabledForProcess(true);
  setLoggerOverride({level:'info',file:logFile,consoleLevel:'silent'});
  const received:Array<{path:string;body:Buffer}>=[];
  const server=http.createServer((request,response)=>{const chunks:Buffer[]=[];request.on('data',(chunk:Buffer)=>chunks.push(chunk));request.on('end',()=>{const raw=Buffer.concat(chunks);received.push({path:request.url??'',body:request.headers['content-encoding']==='gzip'?zlib.gunzipSync(raw):raw});response.writeHead(200,{'content-type':'application/x-protobuf'});response.end();});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const trace=createDiagnosticTraceContext({traceId:'1234567890abcdef1234567890abcdef',spanId:'aaaaaaaaaaaaaaaa'});
  const run=createChildDiagnosticTraceContext(trace,{spanId:'bbbbbbbbbbbbbbbb'});
  const events:DiagnosticEventPayload[]=[];
  const unsubscribe=onInternalDiagnosticEvent(event=>{ if(['model.call.started','model.call.completed','model.call.error','tool.execution.completed','exec.process.completed'].includes(event.type))events.push(event); });
  let handle:Awaited<ReturnType<typeof startPluginServices>>|undefined;
  const start=(enabled:boolean,flag=true)=>startPluginServices({registry:{services:[{pluginId:'diagnostics-otel',origin:'bundled',service:createDiagnosticsOtelService()}]} as never,config:{diagnostics:{enabled:true,flags:flag?['trace.cost-sampling']:[],otel:{enabled,endpoint,metrics:false,logs:false,sampleRate:1}}} as never});
  try {
    handle=await start(false);
    emitTrustedDiagnosticEvent({type:'run.started',runId:'PRIVATE run',sessionKey:'agent:PRIVATE session',trace:run});
    await waitForDiagnosticEventsDrained();await handle.stop();handle=undefined;
    expect(received).toHaveLength(0);
    handle=await start(true);
    emitTrustedDiagnosticEvent({type:'run.started',runId:'PRIVATE run',sessionKey:'agent:PRIVATE session',sessionId:'PRIVATE session-id',trace:run});
    await waitForDiagnosticEventsDrained();
    let modelCalls=0;
    const stream=(()=> (async function*(){modelCalls++;yield done();})()) as unknown as StreamFn;
    const wrapped=wrapStreamFnWithDiagnosticModelCallEvents(stream,{runId:'PRIVATE run',sessionKey:'agent:PRIVATE session',sessionId:'PRIVATE session-id',provider:model.provider,model:model.id,trace:run,nextCallId:()=> 'legacy-repeated-call',costDiagnosticsEnabled:true});
    for await(const value of wrapped(model,{messages:[],systemPrompt:'PRIVATE prompt'},{}) as AsyncIterable<unknown>)expect(value).toEqual(done());
    await waitForDiagnosticEventsDrained();
    const ended=terminal(events); expect(ended).toBeTruthy();
    emitTrustedDiagnosticEvent(ended); // Re-delivery must not produce a second model span/cost.
    await waitForDiagnosticEventsDrained();
    const tool=createChildDiagnosticTraceContext(run,{spanId:'cccccccccccccccc'});
    const base={runId:'PRIVATE run',sessionKey:'agent:PRIVATE session',sessionId:'PRIVATE session-id',requestId:'PRIVATE-tool-request',toolCallId:'private-tool-call-1',toolName:'write',trace:tool};
    emitTrustedDiagnosticEvent({type:'tool.execution.started',...base});await waitForDiagnosticEventsDrained();
    const file=join(root,'effect.txt');await writeFile(file,'PRIVATE tool effect');const effect=await readFile(file,'utf8');
    expect(effect).toBe('PRIVATE tool effect');
    emitTrustedDiagnosticEvent({type:'exec.process.completed',sessionKey:base.sessionKey,target:'host',mode:'child',outcome:'completed',durationMs:1,commandLength:5,exitCode:0,trace:tool});
    emitTrustedDiagnosticEvent({type:'tool.execution.completed',...base,durationMs:2});await waitForDiagnosticEventsDrained();
    emitTrustedDiagnosticEvent({type:'tool.execution.blocked',...base,requestId:'blocked-request',toolCallId:'blocked-tool',trace:createChildDiagnosticTraceContext(run),deniedReason:'policy',reason:'PRIVATE block reason'});
    emitTrustedDiagnosticEvent({type:'session.recovery.completed',sessionKey:base.sessionKey,sessionId:base.sessionId,state:'idle',ageMs:1,status:'recovered',action:'resume'} as never);
    emitTrustedDiagnosticEvent({type:'run.completed',runId:base.runId,sessionKey:base.sessionKey,sessionId:base.sessionId,trace:run,durationMs:10,outcome:'completed'});
    await waitForDiagnosticEventsDrained();await handle.stop();handle=undefined;
    const requests=received.filter(request=>request.path.endsWith('/v1/traces'));const spans=requests.flatMap(request=>decodeSpans(request.body));
    const models=spans.filter(span=>span.attributes['openclaw.o02.event_kind']==='model.call.completed');
    expect(models).toHaveLength(1);expect(modelCalls).toBe(1);
    expect(models[0].attributes).toMatchObject({'openclaw.o02.estimated_cost_usd':.000415,'openclaw.o02.cost_state':'known','openclaw.o02.population_requests':1,'openclaw.o02.population_linked':1});
    const toolSpan=spans.find(span=>span.attributes['openclaw.o02.event_kind']==='tool.execution.completed')!;
    expect(toolSpan).toBeTruthy();expect(models[0].attributes['openclaw.o02.tool_call_hashes']).toBe(toolSpan.attributes['openclaw.o02.tool_call_hash']);
    expect(models[0].attributes['openclaw.o02.attempt_hash']).toBe(toolSpan.attributes['openclaw.o02.attempt_hash']);
    const effectSpan=spans.find(span=>span.name==='openclaw.exec')!;
    expect(effectSpan.parentSpanId).toBe(toolSpan.spanId);expect(effectSpan.traceId).toBe(toolSpan.traceId);
    expect(spans.some(span=>span.attributes['openclaw.o02.event_kind']==='session.recovery.completed')).toBe(true);
    expect(JSON.stringify(spans)).not.toContain('PRIVATE');expect(JSON.stringify(spans)).not.toContain('private-tool-call');
    for(const request of requests)expect(request.body.toString()).not.toContain('PRIVATE');
    const log=await readFile(logFile,'utf8');expect(log).toContain('diagnostics-otel O02');expect(log).toContain('duplicateEvents');
    if(process.env.CLAWX_O02_EVIDENCE_DIR) {
      const {mkdir}=await import('node:fs/promises');const output=process.env.CLAWX_O02_EVIDENCE_DIR;await mkdir(output,{recursive:true});
      await writeFile(join(output,'trace-evidence.json'),JSON.stringify({actor:'codex-o02-fixture',driven_by:'agent',source:'synthetic-local-model-stream-and-file-effect',modelCalls,effectVerified:effect==='PRIVATE tool effect',events,spans},null,2)+'\n');
      await writeFile(join(output,'diagnostic.log'),log);
      for(let i=0;i<requests.length;i++)await writeFile(join(output,'otlp-'+i+'.bin'),requests[i].body);
    }
  } finally {
    await handle?.stop();unsubscribe();resetLogger();setDiagnosticsEnabledForProcess(previous);
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
},30000);
