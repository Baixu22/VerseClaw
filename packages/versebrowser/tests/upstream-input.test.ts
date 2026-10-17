import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import type { ToolResult } from '../src/contracts/index.ts';
import { sessionIdOf } from './session-result.ts';

/**
 * Each case launches a real browser and (for stdio) a child MCP worker. Isolated runs take ~14-15 s,
 * but this file shares the host with three other workers; the 30 s default cap was observed to time
 * out here under full-suite contention while the isolated run passed 8/8 (documented C79 family).
 * The four sibling upstream-*.test.ts files already give their browser cases 40 s of headroom, so
 * this aligns with them. No assertion changed.
 */
it.each(['sdk', 'stdio', 'legacy'] as const)('fills and submits through %s with reference and key guards', async mode => {
  const receipts: string[] = [];
  let receiptArrived: (()=>void) | undefined;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url?.startsWith('/submit')) { receipts.push(new URL(req.url, 'http://localhost').searchParams.toString()); receiptArrived?.(); res.end('<output>saved</output>'); return; }
    if (req.url === '/popup') { res.end('<button onclick="window.open(\'/child\')">Open child</button>'); return; }
    if (req.url === '/click-fields') {res.end('<input id="check" type="checkbox"><input id="radio" type="radio" checked>');return;}
    if (req.url === '/frame-nav') { res.end('<iframe id="child" src="/child"></iframe><button onclick="document.getElementById(\'child\').src=\'/child?next=1\'">Navigate frame</button>'); return; }
    res.end('<form action="/submit"><input name="q" aria-label="Query" value="old"><select name="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select><input name="terms" type="checkbox"><button>Save</button></form><select id="ambiguous"><option value="a">Same</option><option value="b">Same</option></select><input id="locked" readonly value="locked">');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const root = await mkdtemp(join(tmpdir(), 'vb-upstream-input-'));
  const facade = mode !== 'stdio' ? (await createStandaloneFacade({ backend: mode === 'sdk' ? 'upstream' : 'legacy', preferPlaywright: true, workspaceRoot: root })).facade : undefined;
  const client = new Client({ name: 'input-probe', version: '1' });
  if (!facade) { const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core,evidence,network', VERSEBROWSER_CAPS: 'browser.open,browser.act,browser.observe,browser.close,evidence.write,network.read' } as Record<string,string>, stderr: 'pipe' }); transport.stderr?.on('data', () => {}); await client.connect(transport); }
  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    if (facade) {
      const id = String(args.sessionId ?? '');
      switch (name) {
        case 'vb_open': return facade.open({ url: String(args.url) });
        case 'vb_snapshot': return facade.snapshot(id);
        case 'vb_type': return facade.type(id, String(args.selector), String(args.text), { clear: args.clear as boolean, timeoutMs: args.timeoutMs as number });
        case 'vb_press': return facade.pressKey(id, String(args.key), args.selector as string | undefined);
        case 'vb_click': return facade.click(id, String(args.selector),args.timeoutMs as number|undefined,args.after as 'popup'|undefined);
        case 'vb_network_wait': return facade.networkWait(id, {sinceCursor:args.sinceCursor as string,filter:{urlIncludes:'/submit'},timeoutMs:1000});
        case 'vb_select': return facade.selectOption(id, String(args.selector), args.label as string);
        case 'vb_check': return facade.setChecked(id, String(args.selector), args.checked as boolean);
        case 'vb_verify_flow': return facade.verifyFlow({ sessionId: id, screenshot: false, expect: [{ type: 'value', selector: '[name=q]', equals: 'updated' }] });
        case 'vb_close': return facade.close(id);
      }
      throw new Error(name);
    }
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as {text:string}[])[0].text);
  };
  let id: string | undefined;
  try {
    const opened = await call('vb_open', { url }); expect(opened.ok, opened.content).toBe(true);
    id = (opened.data as {session:{id:string}}).session.id;
    const snapshot = await call('vb_snapshot', { sessionId: id });
    const ref = /\[([^\]]+)\] textbox \| "Query"/.exec(snapshot.content)?.[1]; expect(ref).toBeTruthy();
    const selector = `[data-vb-ref="${ref}"]`;
    expect((await call('vb_type', { sessionId: id, selector, text: 'updated', clear: false })).ok).toBe(true);
    if (mode !== 'legacy') expect((await call('vb_type', { sessionId: id, selector, text: 'stale' })).ok).toBe(false);
    expect((await call('vb_press', { sessionId: id, selector: '[name=q]', key: 'Control+W' })).ok).toBe(false);
    const verified = await call('vb_verify_flow', { sessionId: id, screenshot: false, expect: [{ type: 'value', selector: '[name=q]', equals: 'updated' }] });
    expect((verified.data as {outcome:string}).outcome).toBe('pass');
    const ambiguous = await call('vb_select', { sessionId: id, selector: '#ambiguous', label: 'Same' });
    expect(ambiguous.ok).toBe(false); expect(ambiguous.content).toContain('E_AMBIGUOUS_OPTION');
    expect((await call('vb_select', { sessionId: id, selector: '[name=plan]', label: 'Pro' })).ok).toBe(true);
    expect((await call('vb_select', { sessionId: id, selector: '[name=plan]', label: 'Pro' })).ok).toBe(true);
    expect((await call('vb_check', { sessionId: id, selector: '[name=terms]', checked: true })).ok).toBe(true);
    expect((await call('vb_check', { sessionId: id, selector: '[name=terms]', checked: true })).ok).toBe(true);
    expect((await call('vb_check', { sessionId: id, selector: '[name=terms]', checked: false })).ok).toBe(true);
    expect((await call('vb_check', { sessionId: id, selector: '[name=terms]', checked: false })).ok).toBe(true);
    expect((await call('vb_check', { sessionId: id, selector: '[name=terms]', checked: true })).ok).toBe(true);
    expect((await call('vb_check', { sessionId: id, selector: '[name=terms]', checked: 'false' })).ok).toBe(false);
    expect(receipts).toEqual([]);
    expect((await call('vb_press', { sessionId: id, selector: '[name=q]', key: 'Enter' })).ok).toBe(true);
    // Legacy keyboard.press returns before navigation; the server receipt is the oracle.
    await expect.poll(() => receipts, { timeout: 3000 }).toEqual(['q=updated&plan=pro&terms=on']);
    const fresh = await call('vb_open',{url});
    const freshId = sessionIdOf(fresh);
    try {
      const clicked = await call('vb_click',{sessionId:freshId,selector:'button',after:'navigation'});
      expect(clicked.ok,clicked.content).toBe(true);
      const observation = (clicked.data as {observation:{sinceCursor:string;businessOutcome:string}}).observation;
      expect(observation.businessOutcome).toBe('unknown'); expect(observation.sinceCursor).toBeTruthy();
      if (mode !== 'legacy') expect((observation as typeof observation & {events:Array<{type:string}>}).events).toContainEqual({type:'navigation'});
      const response = await call('vb_network_wait',{sessionId:freshId,sinceCursor:observation.sinceCursor,urlIncludes:'/submit',timeoutMs:1000});
      expect(response.ok,response.content).toBe(true);
    } finally { await call('vb_close',{sessionId:freshId}); }
    const popupSession = await call('vb_open',{url:`${url}/popup`});
    expect(popupSession.ok,popupSession.content).toBe(true);
    const popupId=(popupSession.data as {session:{id:string}}).session.id;
    try {
      // Explicit budget: the 5 s default observation deadline was exceeded under 4-worker load
      // (observed: E_AFTER_TIMEOUT -> empty events) while the isolated run passes 3/3. The click
      // itself is bounded and still fails closed with E_AFTER_TIMEOUT if the popup never arrives.
      const clicked = await call('vb_click',{sessionId:popupId,selector:'button',after:'popup',timeoutMs:15000});
      const observed = clicked.ok ? (clicked.data as {observation:{events:Array<{type:string}>}}).observation : clicked.error?.details?.observation as {events:Array<{type:string}>};
      expect(observed,clicked.content).toBeTruthy();
      expect(observed.events).toContainEqual({type:'popup'});
      expect(receipts).toHaveLength(2);
    } finally { await call('vb_close',{sessionId:popupId}); }
    const waitingSession=await call('vb_open',{url});
    expect(waitingSession.ok,waitingSession.content).toBe(true);
    const waitingId=(waitingSession.data as {session:{id:string}}).session.id;
    const receiptCount=receipts.length;
    const received = new Promise<void>(resolve=>{receiptArrived=resolve;});
    let finished=false, pendingResult:ToolResult|undefined;
    const pending=call('vb_click',{sessionId:waitingId,selector:'button',after:'popup',timeoutMs:5000}).then(result=>{finished=true;pendingResult=result;return result;});
    try {
      await Promise.race([received,pending]);
      expect(receipts.length,JSON.stringify(pendingResult)).toBe(receiptCount+1);
      await call('vb_close',{sessionId:waitingId});
      await expect.poll(()=>finished,{timeout:2000}).toBe(true);
      expect((await pending).ok).toBe(false);expect(receipts.length).toBe(receiptCount+1);
    } finally { receiptArrived=undefined; await call('vb_close',{sessionId:waitingId}); await pending; }
    const timeoutSession=await call('vb_open',{url});
    expect(timeoutSession.ok,timeoutSession.content).toBe(true);
    const timeoutId=(timeoutSession.data as {session:{id:string}}).session.id;
    const beforeTimeout=receipts.length;
    try {
      const timedOut=await call('vb_click',{sessionId:timeoutId,selector:'button',after:'popup',timeoutMs:2000});
      expect(timedOut.ok).toBe(false); expect(timedOut.content).toContain('E_AFTER_TIMEOUT');
      expect(timedOut.error?.details).toMatchObject({recovery:'observe-before-retry',observation:{businessOutcome:'unknown'}});
      expect(receipts.length).toBe(beforeTimeout+1);
    } finally { await call('vb_close',{sessionId:timeoutId}); }
    const frameSession=await call('vb_open',{url:`${url}/frame-nav`});
    expect(frameSession.ok,frameSession.content).toBe(true);
    const frameId=(frameSession.data as {session:{id:string}}).session.id;
    try {
      const frameOnly=await call('vb_click',{sessionId:frameId,selector:'button',after:'navigation',timeoutMs:2000});
      expect(frameOnly.ok,frameOnly.content).toBe(false);
      expect(frameOnly.content).toContain('E_AFTER_TIMEOUT');
    } finally { await call('vb_close',{sessionId:frameId}); }
    const fieldsSession=await call('vb_open',{url:`${url}/click-fields`});
    expect(fieldsSession.ok,fieldsSession.content).toBe(true);
    const fieldsId=(fieldsSession.data as {session:{id:string}}).session.id;
    try {
      const changed=await call('vb_click',{sessionId:fieldsId,selector:'#check'});
      expect(changed.ok,changed.content).toBe(true);
      expect(changed.data).toMatchObject({targetChange:'changed',fieldChange:{before:{checked:false},after:{checked:true}},observation:{businessOutcome:'unknown'}});
      const unchanged=await call('vb_click',{sessionId:fieldsId,selector:'#radio'});
      expect(unchanged.ok,unchanged.content).toBe(true);
      expect(unchanged.data).toMatchObject({targetChange:'no_change',fieldChange:{changed:false}});
    } finally {await call('vb_close',{sessionId:fieldsId});}
  } finally { if (id) await call('vb_close', { sessionId: id }); await facade?.dispose(); await client.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 40_000);

it.each(['sdk','stdio','legacy'] as const)('observes a download event without claiming a saved file through %s', async mode => {
  let downloads=0;
  const server=createServer((req,res)=>{
    if(req.url==='/file'){downloads++;res.setHeader('content-disposition','attachment; filename="test.txt"');res.end('fixture');return;}
    res.setHeader('content-type','text/html');res.end('<a href="/file" download>Download</a>');
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const root=await mkdtemp(join(tmpdir(),'vb-download-event-'));
  const facade=mode==='stdio'?undefined:(await createStandaloneFacade({backend:mode==='sdk'?'upstream':'legacy',preferPlaywright:true,workspaceRoot:root})).facade;
  const client=new Client({name:'download-event',version:'1'});
  let id:string|undefined;
  const call=async(name:string,args:Record<string,unknown>):Promise<ToolResult>=>{
    if(facade){if(name==='vb_open')return facade.open({url});if(name==='vb_click')return facade.click(id!,'a',5000,'download');if(name==='vb_close')return facade.close(id!);throw new Error(name);}
    const result=await client.callTool({name,arguments:args});return JSON.parse((result.content as {text:string}[])[0].text);
  };
  try {
    if(!facade) { const transport = new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',resolve('src/mcp/server.ts')],cwd:root,env:{...process.env,VERSEBROWSER_BACKEND:'upstream',VERSEBROWSER_TOOL_GROUPS:'core',VERSEBROWSER_CAPS:'browser.open,browser.act,browser.observe,browser.close'} as Record<string,string>,stderr:'pipe'}); transport.stderr?.on('data', () => {}); await client.connect(transport); }
    const opened=await call('vb_open',{url});expect(opened.ok,opened.content).toBe(true);id=(opened.data as {session:{id:string}}).session.id;
    const result=await call('vb_click',{sessionId:id,selector:'a',after:'download',timeoutMs:5000});
    const observation=result.ok?(result.data as {observation:Record<string,unknown>}).observation:result.error?.details?.observation;
    expect(observation,result.content).toMatchObject({events:[{type:'download'}],businessOutcome:'unknown'});
    expect(downloads).toBe(mode==='legacy'?1:0);expect(result.evidence ?? []).toEqual([]);
  }finally{if(id)await call('vb_close',{sessionId:id});await facade?.dispose();await client.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
},15000);

it.each(['sdk','stdio'] as const)('reports upstream dialog without accepting it through %s',async mode=>{
  let writes=0;
  const server=createServer((req,res)=>{if(req.url==='/write'){writes++;res.end('written');return;}res.setHeader('content-type','text/html');res.end('<button onclick="if(confirm(\'PRIVATE_DIALOG\'))fetch(\'/write\')">Ask</button>');});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const root=await mkdtemp(join(tmpdir(),'vb-dialog-observe-'));
  const facade=mode==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot:root})).facade:undefined;
  const client=new Client({name:'dialog-observe',version:'1'});let id:string|undefined;
  const call=async(name:string,args:Record<string,unknown>):Promise<ToolResult>=>{
    if(facade){if(name==='vb_open')return facade.open({url});if(name==='vb_click')return facade.click(id!,'button');if(name==='vb_close')return facade.close(id!);throw new Error(name);}
    const r=await client.callTool({name,arguments:args});return JSON.parse((r.content as {text:string}[])[0].text);
  };
  try{
    if(!facade){const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',resolve('src/mcp/server.ts')],cwd:root,env:{...process.env,VERSEBROWSER_BACKEND:'upstream',VERSEBROWSER_TOOL_GROUPS:'core',VERSEBROWSER_CAPS:'browser.open,browser.act,browser.observe,browser.close'} as Record<string,string>,stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);}
    const opened=await call('vb_open',{url});expect(opened.ok,opened.content).toBe(true);id=(opened.data as {session:{id:string}}).session.id;
    const clicked=await call('vb_click',{sessionId:id,selector:'button'});
    const observation=clicked.ok?(clicked.data as {observation:unknown}).observation:clicked.error?.details?.observation;
    expect(observation,clicked.content).toMatchObject({events:[{type:'dialog'}],businessOutcome:'unknown'});
    expect(JSON.stringify(clicked)).not.toContain('PRIVATE_DIALOG');expect(writes).toBe(0);
  }finally{if(id)await call('vb_close',{sessionId:id});await facade?.dispose();await client.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
},15000);
