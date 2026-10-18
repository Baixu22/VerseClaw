import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { prepareSemanticBrowser, attachSemanticBrowser, type SemanticGateway } from '../src/engine/semantic-browser.ts';
import { createUpstreamPageControl } from '../src/engine/upstream-control.ts';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import { writeFile } from 'node:fs/promises';

const budgets = { modelId: 'deterministic-test-host', maxCalls: 3, maxInputChars: 100000, maxOutputChars: 20000, maxOutputTokens: 2048 };
async function fixture(generate: SemanticGateway['generate'], overrides: Partial<SemanticGateway> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vb-semantic-'));
  const server = createServer((_req,res) => {res.setHeader('content-type','text/html');res.end('<title>Semantic receipt</title><button>Only target</button><p>Name: Alex</p><p>Amount: 42</p><p>password=VB_SEMANTIC_SECRET</p><label>Password<input type="password" value="PRIVATE_INPUT_PASSWORD"></label>');});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const prepared=await prepareSemanticBrowser({...budgets,generate,...overrides});
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),ignoreDefaultArgs:['--disable-extensions'],chromiumSandbox:true,args:['--proxy-server=http://127.0.0.1:0','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-quic',...prepared.args]});
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false}),page=await context.newPage();
  const control=await createUpstreamPageControl(page,url,root);await control.navigate(url,'load');
  const adapter=await attachSemanticBrowser(browser,prepared);
  return {page,adapter,prepared,browser,close:async()=>{try{await adapter.close();}finally{await control.close();await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}}};
}
type StructuredResult = Extract<Awaited<ReturnType<SemanticGateway['generate']>>, { outputFormat: 'json_schema' }>;
const jsonResult = (data: StructuredResult['structuredContent'], usage?: {inputTokens:number;outputTokens:number;totalTokens:number}) => ({role:'assistant' as const,content:{type:'text' as const,text:JSON.stringify(data)},outputFormat:'json_schema' as const,structuredContent:data,...(usage?{usage}:{})});
it('uses exact owned page and host callback for observe/extract, preserves missing usage and disconnect ownership',async()=>{
  const names:string[]=[],inputs:string[]=[];
  const f=await fixture(async(input,context)=>{
    names.push(input.responseFormat?.type==='json_schema'?input.responseFormat.name:'text');inputs.push(JSON.stringify(input));expect(context.modelId).toBe(budgets.modelId);expect(context.maxOutputTokens).toBe(2048);
    const name=input.responseFormat?.type==='json_schema'?input.responseFormat.name:'';
    if(name==='Observation'){
      const match=/\[(\d+-\d+)\] button: Only target/.exec(JSON.stringify(input));expect(match).toBeTruthy();
      return jsonResult({elements:[{elementId:match![1],description:'Only target button',method:'click',arguments:[]}]});
    }
    return jsonResult(name==='Metadata'?{progress:'Read both fields',completed:true}:{name:'Alex',amount:42},{inputTokens:10,outputTokens:5,totalTokens:15});
  });
  try{
    expect(f.prepared.args.some(arg=>arg==='--remote-allow-origins=*')).toBe(false);
    const observed=await f.adapter.read(f.page,{action:'observe',instruction:'Find the Only target button'});
    expect(observed.data).toHaveLength(1);expect((observed.data as Array<{description:string}>)[0]!.description).toBe('Only target button');expect(observed.model.calls).toMatchObject([{status:'completed',usage:null}]);expect(observed.model.usageComplete).toBe(false);
    const extracted=await f.adapter.read(f.page,{action:'extract',instruction:'Read name and amount',schema:{type:'object',properties:{name:{type:'string'},amount:{type:'number'}},required:['name','amount'],additionalProperties:false}});
    expect(extracted.data).toEqual({name:'Alex',amount:42});expect(extracted.model.calls).toHaveLength(2);expect(extracted.model.usageComplete).toBe(true);expect(extracted.model.calls[0]!.usage).toEqual({input:10,output:5,total:15});
    expect(names).toEqual(['Observation','Extraction','Metadata']);expect(inputs.join('')).not.toContain('VB_SEMANTIC_SECRET');expect(inputs.join('')).not.toContain('PRIVATE_INPUT_PASSWORD');
    await f.adapter.stop();expect(f.page.isClosed()).toBe(false);expect(await f.page.locator('button').innerText()).toBe('Only target');
  }finally{await f.close();}
});
it('rejects absent model configuration and invalid host budgets before launching',async()=>{
  await expect(prepareSemanticBrowser(undefined as unknown as SemanticGateway)).rejects.toThrow('host model');
  await expect(prepareSemanticBrowser({...budgets,maxCalls:0,generate:async()=>jsonResult({})})).rejects.toThrow('budget');
});
it('keeps model schema errors and exhausted call budgets as failures',async()=>{
  let calls=0;
  const f=await fixture(async()=>{calls++;return jsonResult({name:'Alex'});});
  try{
    await expect(f.adapter.read(f.page,{action:'extract',instruction:'Read amount',schema:{type:'object',properties:{amount:{type:'number'}},required:['amount']}})).rejects.toThrow();expect(calls).toBe(1);
    await expect(f.adapter.read(f.page,{action:'observe',instruction:'Read',schema:{type:'object'}})).rejects.toThrow('schema');expect(calls).toBe(1);
    await expect(f.adapter.read(f.page,{action:'extract',instruction:'Read',schema:{name:{selector:'p'}}})).rejects.toThrow('object JSON Schema');expect(calls).toBe(1);
  }finally{await f.close();}
  const limited=await fixture(async()=>jsonResult({name:'Alex'}),{maxCalls:1});
  try{
    await expect(limited.adapter.read(limited.page,{action:'extract',instruction:'Read name',schema:{type:'object',properties:{name:{type:'string'}},required:['name']}})).rejects.toThrow('call budget');
  }finally{await limited.close();}
});
it.each(['cancel','timeout'])('aborts host inference on %s without killing another browser or claiming completion',async kind=>{
  let started!:()=>void;const begun=new Promise<void>(resolve=>{started=resolve;});let wasAborted=false;
  const f=await fixture(async(_input,{signal})=>{started();return new Promise((_,reject)=>{signal.addEventListener('abort',()=>{wasAborted=true;reject(signal.reason);},{once:true});});});
  const peer=await chromium.launch({headless:true}),peerPage=await peer.newPage();await peerPage.setContent('<p>Peer</p>');
  try{
    const abort=new AbortController();const reading=f.adapter.read(f.page,{action:'observe',instruction:'Find button',timeoutMs:kind==='timeout'?1200:5000},abort.signal);const failed=expect(reading).rejects.toThrow(kind==='timeout'?'deadline':'cancel');
    await begun;if(kind==='cancel')abort.abort(new Error('host cancellation'));await failed;
    expect(wasAborted).toBe(true);expect(peerPage.isClosed()).toBe(false);expect(await peerPage.innerText('p')).toBe('Peer');expect(f.page.isClosed()).toBe(true);
    await expect(f.adapter.read(f.page,{action:'observe',instruction:'Find button'})).rejects.toThrow('closed');
  }finally{await f.close();await peer.close();}
});

it('ends an unresponsive host inference on the original deadline',async()=>{
  let started!:()=>void;const begun=new Promise<void>(resolve=>{started=resolve;});
  const f=await fixture(async()=>{started();return new Promise(()=>{});});
  try{
    const start=Date.now();const pending=f.adapter.read(f.page,{action:'observe',instruction:'Find button',timeoutMs:1200});
    const failure=expect(pending).rejects.toThrow('deadline');await begun;await failure;
    expect(Date.now()-start).toBeLessThan(5000);expect(f.browser.isConnected()).toBe(false);
    const cleanup=await f.adapter.close();expect(cleanup.browserClosed).toBe(true);expect(cleanup.sdk).toHaveLength(2);
    expect(cleanup.sdk.every(item=>['closed','already_disconnected'].includes(item.state))).toBe(true);
  }finally{await f.close();}
});
it('rejects a native page from another browser before any model call',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return jsonResult({elements:[]});});
  const peer=await chromium.launch({headless:true}),page=await peer.newPage();
  try{await expect(f.adapter.read(page,{action:'observe',instruction:'Read foreign page'})).rejects.toThrow('not owned');expect(calls).toBe(0);expect(page.isClosed()).toBe(false);}
  finally{await f.close();await peer.close();}
});

it.each(['sdk','mcp'])('wires explicit semantic extract through %s without replacing deterministic reads',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-semantic-entry-'));
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<p>Name: Alex</p>');});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const gateway:SemanticGateway={...budgets,generate:async input=>jsonResult(input.responseFormat?.type==='json_schema'&&input.responseFormat.name==='Metadata'?{progress:'done',completed:true}:{name:'Alex'},{inputTokens:10,outputTokens:5,totalTokens:15})};
  let granted=true;
  const facade=kind==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot:root,semanticGateway:gateway})).facade:undefined;
  const mcp=createMcpServer({backend:'upstream',workspaceRoot:root,semanticGateway:kind==='mcp'?gateway:undefined,facade,getPolicy:()=>resolveMcpPolicy({groups:'core',caps:'browser.open,browser.close,browser.observe'+(granted?',browser.semantic':'')})});
  const client=new Client({name:'semantic-entry',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  try{
    await mcp.connect(a);await client.connect(b);
    const call=async(name:string,args:Record<string,unknown>):Promise<any>=>{if(!facade)return JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);if(name==='vb_open')return facade.open(args);if(name==='vb_semantic_read')return facade.semanticRead(args as Parameters<typeof facade.semanticRead>[0]);return facade.extractPageText(args as Parameters<typeof facade.extractPageText>[0]);};
    expect((await client.listTools()).tools.some(tool=>tool.name==='vb_semantic_read')).toBe(true);
    const opened=await call('vb_open',{url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const extracted=await call('vb_semantic_read',{sessionId,action:'extract',instruction:'Read name',schema:{type:'object',properties:{name:{type:'string'}},required:['name']}});
    expect(extracted.ok,extracted.content).toBe(true);expect(extracted.data).toMatchObject({mode:'semantic',value:{name:'Alex'},businessOutcome:'unknown',source:{sessionId,frameId:'main',url:url+'/'}});
    expect(extracted.data.model.calls[0].usage).toEqual({input:10,output:5,total:15});
    const deterministic=await call('vb_page_text',{sessionId});expect(deterministic.ok).toBe(true);expect(deterministic.content).toContain('Alex');
    granted=false;expect((await client.listTools()).tools.some(tool=>tool.name==='vb_semantic_read')).toBe(false);
  }finally{await client.close();await mcp.close();await facade?.dispose();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
it('the ordinary upstream instance neither advertises nor silently performs semantic inference',async()=>{
  const {facade}=await createStandaloneFacade({backend:'upstream',workspaceRoot:await mkdtemp(join(tmpdir(),'vb-no-semantic-'))});
  try{expect(facade.getDriverProfile().methods?.has('semanticRead')).toBe(false);expect((await facade.semanticRead({sessionId:'missing',action:'observe',instruction:'Read'})).error?.code).toBe('E_SEMANTIC_CONFIG');}
  finally{await facade.dispose();}
});

it('MCP revocation between extract and metadata prevents the second host inference',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-semantic-revoke-'));let allowed=true,calls=0;
  const fixture=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<p>Name: Alex</p>');});await new Promise<void>(done=>fixture.listen(0,'127.0.0.1',done));
  const url='http://127.0.0.1:'+(fixture.address() as {port:number}).port;
  const mcp=createMcpServer({backend:'upstream',workspaceRoot:root,semanticGateway:{...budgets,generate:async()=>{calls++;allowed=false;return jsonResult({name:'Alex'});}},getPolicy:()=>resolveMcpPolicy({groups:'core',caps:'browser.open,browser.close,browser.observe'+(allowed?',browser.semantic':'')})});
  const client=new Client({name:'semantic-revoke',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  const call=async(name:string,args:Record<string,unknown>)=>JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
  try{await mcp.connect(a);await client.connect(b);const opened=await call('vb_open',{url});expect(opened.ok,opened.content).toBe(true);
    const sessionId=opened.data.session.id;
    const result=await call('vb_semantic_read',{sessionId,action:'extract',instruction:'Read name',schema:{type:'object',properties:{name:{type:'string'}},required:['name']}});
    expect(result.ok).toBe(false);expect(result.content).toContain('browser.semantic');expect(calls).toBe(1);expect(result.error.details.model.calls).toHaveLength(2);
    expect((await call('vb_close',{sessionId})).ok).toBe(true);
  }finally{await client.close();await mcp.close();fixture.closeAllConnections();await new Promise<void>(done=>fixture.close(()=>done()));}
});
it('page navigation during inference cancels the read instead of attributing data to the replacement page',async()=>{
  let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  const f=await fixture(async(_input,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  try{const result=f.adapter.read(f.page,{action:'observe',instruction:'Read page'});const refused=expect(result).rejects.toThrow('page/frame');await began;
    await f.page.evaluate(()=>{location.hash='replacement';}).catch(()=>{});await refused;expect(f.browser.isConnected()).toBe(false);
  }finally{await f.close();}
});
it('serves a host-configured semantic read over real stdio without allowing tool-supplied gateway configuration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-semantic-stdio-'));
  const site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<p>Name: Alex</p>');});await new Promise<void>(done=>site.listen(0,'127.0.0.1',done));
  const serverUrl=new URL('../src/mcp/server.ts',import.meta.url).href;
  const policyUrl=new URL('../src/mcp/capability-policy.ts',import.meta.url).href;
  const bootstrap=join(root,'host.mjs');
  await writeFile(bootstrap,[
    'import {createMcpServer} from '+JSON.stringify(serverUrl)+';',
    'import {resolveMcpPolicy} from '+JSON.stringify(policyUrl)+';',
    'import {StdioServerTransport} from '+JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))+';',
    'const server=createMcpServer({backend:"upstream",workspaceRoot:process.cwd(),policy:resolveMcpPolicy({groups:"core",caps:"browser.open,browser.close,browser.observe,browser.semantic"}),semanticGateway:{modelId:"fixture-host",maxCalls:3,maxInputChars:100000,maxOutputChars:20000,maxOutputTokens:2048,generate:async input=>{const data=input.responseFormat.name==="Metadata"?{progress:"done",completed:true}:{name:"Alex"};return {role:"assistant",content:{type:"text",text:JSON.stringify(data)},outputFormat:"json_schema",structuredContent:data};}}});',
    'await server.connect(new StdioServerTransport());'
  ].join('\n'));
  const client=new Client({name:'semantic-stdio',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',bootstrap],cwd:root,env:{...process.env} as Record<string,string>,stderr:'pipe'});transport.stderr?.on('data',()=>{});
  const call=async(name:string,args:Record<string,unknown>)=>JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
  try{await client.connect(transport);const opened=await call('vb_open',{url:'http://127.0.0.1:'+(site.address() as {port:number}).port});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const args={sessionId,action:'extract',instruction:'Read name',schema:{type:'object',properties:{name:{type:'string'}},required:['name']}};
    expect((await call('vb_semantic_read',{...args,apiKey:'never-granted'})).error.code).toBe('E_ARG_UNKNOWN');
    const result=await call('vb_semantic_read',args);expect(result.ok,result.content).toBe(true);expect(result.data.value).toEqual({name:'Alex'});expect(result.data.model.usageComplete).toBe(false);expect(result.data.model.calls.every((row:{usage:unknown})=>row.usage===null)).toBe(true);
    expect((await call('vb_close',{sessionId})).ok).toBe(true);
  }finally{await client.close();site.closeAllConnections();await new Promise<void>(done=>site.close(()=>done()));}
});

it('retains network refusal with the semantic extension and exact CDP proxy exception',async()=>{
  let tcp=0,http=0;const target=createServer((_req,res)=>{http++;res.end('not authorized');});target.on('connection',()=>tcp++);
  await new Promise<void>(done=>target.listen(0,'127.0.0.1',done));const denied='http://127.0.0.1:'+(target.address() as {port:number}).port;
  const f=await fixture(async()=>jsonResult({elements:[]}));
  try{
    await f.page.evaluate(async url=>{
      await fetch(url+'/direct').catch(()=>{});
      await new Promise<void>(resolve=>{const socket=new WebSocket(url.replace('http:','ws:')+'/socket');socket.onopen=()=>{socket.close();resolve();};socket.onerror=()=>resolve();socket.onclose=()=>resolve();setTimeout(()=>{socket.close();resolve();},1000);});
      const iframe=document.createElement('iframe');iframe.src=url+'/frame';document.body.append(iframe);
    },denied);
    await new Promise(resolve=>setTimeout(resolve,200));
    expect(http).toBe(0);expect(tcp).toBe(0);
    await expect(f.adapter.read(f.page,{action:'observe',instruction:'Read'})).rejects.toThrow('single main frame');
  }finally{await f.close();target.closeAllConnections();await new Promise<void>(done=>target.close(()=>done()));}
});
it('refuses non-origin access to the owned debug port from untrusted page scripts',async()=>{
  const f=await fixture(async()=>jsonResult({elements:[]}));
  try{
    const response=await fetch(f.prepared.endpoint+'/json/version');const info=await response.json() as {webSocketDebuggerUrl:string};
    const report=await f.page.evaluate(async ({endpoint,ws})=>{
      const fetchRead=await fetch(endpoint+'/json/version').then(()=>true,()=>false);
      const socketOpen=await new Promise<boolean>(resolve=>{const socket=new WebSocket(ws);socket.onopen=()=>{socket.close();resolve(true);};socket.onerror=()=>resolve(false);socket.onclose=()=>resolve(false);setTimeout(()=>{socket.close();resolve(false);},1000);});
      return {fetchRead,socketOpen};
    },{endpoint:f.prepared.endpoint,ws:info.webSocketDebuggerUrl});
    expect(report).toEqual({fetchRead:false,socketOpen:false});
  }finally{await f.close();}
});

it('retries a failed owned-browser close instead of permanently caching cleanup failure',async()=>{
  const f=await fixture(async()=>jsonResult({elements:[]}));const native=f.browser.close.bind(f.browser);let calls=0;
  const close=vi.spyOn(f.browser,'close').mockImplementation(async options=>{calls++;if(calls===1)throw new Error('native shutdown temporarily refused');return native(options);});
  try{await expect(f.adapter.close()).rejects.toThrow('temporarily refused');expect(f.browser.isConnected()).toBe(true);const retried=await f.adapter.close();expect(retried.browserClosed).toBe(true);expect(f.browser.isConnected()).toBe(false);expect(calls).toBe(2);}
  finally{close.mockRestore();await f.browser.close();await f.close().catch(()=>{});}
});
it('Host timeout drains its upstream logs and keeps its session close idempotent while a peer stays usable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-semantic-host-timeout-'));
  const site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Fixture</h1><script src="http://127.0.0.1:1/semantic-terminal-marker"></script>');});await new Promise<void>(done=>site.listen(0,'127.0.0.1',done));
  const url='http://127.0.0.1:'+(site.address() as {port:number}).port;
  const {facade}=await createStandaloneFacade({backend:'upstream',workspaceRoot:root,semanticGateway:{...budgets,generate:async()=>new Promise(()=>{})}});
  try{const first=await facade.open({url}),peer=await facade.open({url});expect(first.ok,first.content).toBe(true);expect(peer.ok,peer.content).toBe(true);
    const id=(first.data as {session:{id:string}}).session.id,peerId=(peer.data as {session:{id:string}}).session.id;
    const result=await facade.semanticRead({sessionId:id,action:'observe',instruction:'Read the heading',timeoutMs:1200});expect(result.ok).toBe(false);expect(result.content).toContain('deadline');
    expect((await facade.extractPageText({sessionId:peerId})).ok).toBe(true);expect((await facade.close(id)).ok).toBe(true);
    const files=await readdir(join(root,'.ae','evidence'),{recursive:true,withFileTypes:true});const logs=files.filter(item=>item.isFile()&&item.name==='console.log');expect(logs.length).toBeGreaterThan(0);
    expect((await Promise.all(logs.map(item=>readFile(join(item.parentPath,item.name),'utf8')))).join('')).toContain('semantic-terminal-marker');
  }finally{await facade.dispose();site.closeAllConnections();await new Promise<void>(done=>site.close(()=>done()));}
});

it('a status read at native disconnect cannot discard pending semantic cleanup ownership',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-semantic-prune-'));
  const site=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Fixture</h1><script src="http://127.0.0.1:1/disconnect-prune-marker"></script>');});
  await new Promise<void>(done=>site.listen(0,'127.0.0.1',done));
  const {createPlaywrightHostApi}=await import('../src/engine/playwright-host-api.ts');
  const api=await createPlaywrightHostApi({upstream:true,workspaceRoot:root,semanticGateway:{...budgets,generate:async()=>new Promise(()=>{})}});
  let disconnectedStatus:ReturnType<typeof api.status>|undefined;
  const nativeLaunch=chromium.launch.bind(chromium);
  const launched:Awaited<ReturnType<typeof chromium.launch>>[]=[];
  const launch=vi.spyOn(chromium,'launch').mockImplementation(async options=>{
    const browser=await nativeLaunch(options);launched.push(browser);
    if(launched.length===1)browser.once('disconnected',()=>{disconnectedStatus=api.status();});
    return browser;
  });
  let id:string|undefined,peerId:string|undefined;
  try{
    const url='http://127.0.0.1:'+(site.address() as {port:number}).port;
    id=(await api.open({url})).session.id;peerId=(await api.open({url})).session.id;
    await expect(api.semanticRead!({sessionId:id,action:'observe',instruction:'Read heading',timeoutMs:1200})).rejects.toThrow('deadline');
    expect(disconnectedStatus).toBeDefined();
    const status=await disconnectedStatus!;expect(status.sessions.map(session=>session.id)).toEqual([peerId]);
    expect((await api.close({sessionId:id})).success).toBe(true);
    const files=await readdir(join(root,'.ae','evidence'),{recursive:true,withFileTypes:true});
    const logs=files.filter(item=>item.isFile()&&item.name==='console.log');
    expect(logs).toHaveLength(1);expect(await readFile(join(logs[0]!.parentPath,logs[0]!.name),'utf8')).toContain('disconnect-prune-marker');
    expect((await api.takeSnapshot({sessionId:peerId})).success).toBe(true);
  }finally{
    if(id)await api.close({sessionId:id});if(peerId)await api.close({sessionId:peerId});
    launch.mockRestore();for(const browser of launched)await browser.close();
    site.closeAllConnections();await new Promise<void>(done=>site.close(()=>done()));
  }
});
