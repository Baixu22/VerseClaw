import {expect,it,vi} from 'vitest';
import {chromium} from 'playwright';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createMcpServer} from '../src/mcp/server.ts';
import {resolveMcpPolicy} from '../src/mcp/capability-policy.ts';
import {createStandaloneFacade} from '../src/engine/standalone.ts';
import {createServer} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createUpstreamPageControl} from '../src/engine/upstream-control.ts';
import { sessionIdOf } from './session-result.ts';

it.each([false,true])('selects an upstream tab with preserveFocus=%s',async preserveFocus=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  const first=await context.newPage();await context.newPage();
  const focus=vi.spyOn(first,'bringToFront');
  const config:Parameters<typeof createConnection>[0]&{vbPreserveFocus:boolean}={browser:{isolated:false},vbPreserveFocus:preserveFocus};
  const server=await createConnection(config,async()=>context);
  const client=new Client({name:'focus-test',version:'1'});
  try {
    const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
    await client.callTool({name:'browser_tabs',arguments:{action:'list'}});focus.mockClear();
    await client.callTool({name:'browser_tabs',arguments:{action:'select',index:1}});focus.mockClear();
    const result=await client.callTool({name:'browser_tabs',arguments:{action:'select',index:0}});
    expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
    expect(focus).toHaveBeenCalledTimes(preserveFocus?0:1);
  }finally{focus.mockRestore();await client.close();await server.close();await browser.close();}
});

it('lists stable session page IDs and popup provenance without altering the source form',async()=>{
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<input value="original"><a target="_blank" href="/child">Child</a>');});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const {facade}=await createStandaloneFacade({backend:'upstream',workspaceRoot:await mkdtemp(join(tmpdir(),'vb-pages-'))});
  const sessionId=(result:{ok?:boolean;content?:string;data?:unknown})=>sessionIdOf(result);
  const inventory=(result:unknown)=>(result as {data:{pages:Array<{pageId:string;active:boolean;openerPageId?:string}>;activePageId:string}}).data;
  try {
    const first=sessionId(await facade.open({url}));const sibling=sessionId(await facade.open({url}));
    const before=inventory(await facade.listPages(first));expect(before.pages).toHaveLength(1);
    expect(inventory(await facade.listPages(sibling)).activePageId).not.toBe(before.activePageId);
    expect((await facade.click(first,'a',5000,'popup')).ok).toBe(true);
    const after=inventory(await facade.listPages(first));expect(after.pages).toHaveLength(2);expect(after.activePageId).toBe(before.activePageId);
    const child=after.pages.find(page=>!page.active)!;expect(child.openerPageId).toBe(before.activePageId);
    expect(inventory(await facade.listPages(first)).pages.map(page=>page.pageId)).toEqual(after.pages.map(page=>page.pageId));
    expect((await facade.wait({sessionId:first,selector:'input',valueEquals:'original'})).ok).toBe(true);
    const forms=await facade.readForms(first);expect(forms.ok).toBe(false); // Upstream page operations remain gated until selection is implemented.
    expect(inventory(await facade.listPages(sibling)).pages).toHaveLength(1);
  }finally{await facade.dispose();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

it('selects only owned pages, preserves forms and rejects references from another page',async()=>{
  const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(`<input aria-label="Value" value="${req.url==='/child'?'child':'parent'}"><a target="_blank" href="/child">Child</a>`);});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext();const parent=await context.newPage();
    const control=await createUpstreamPageControl(parent,url,await mkdtemp(join(tmpdir(),'vb-select-page-')));
    await control.navigate(url,'load');
    const parentId=(await control.listPages()).activePageId!;
    const oldRef=(await control.snapshot()).find(item=>item.role==='textbox')!.ref;
    const popup=context.waitForEvent('page');await control.click('a');const child=await popup;await child.waitForLoadState();
    expect(await child.locator('input').count(),`popup URL: ${child.url()}`).toBe(1);
    const childId=(await control.listPages()).pages.find(item=>!item.active)!.pageId;
    await expect(control.type('input','must not implicitly choose')).rejects.toThrow('E_UPSTREAM_PAGES');
    const focus=vi.spyOn(child,'bringToFront');
    expect((await control.selectPage(childId)).activePageId).toBe(childId);expect(focus).not.toHaveBeenCalled();
    await expect(control.type(`[data-vb-ref="${oldRef}"]`,'wrong')).rejects.toThrow('E_STALE_REF');
    await control.type('input','edited child');
    expect(await child.locator('input').inputValue()).toBe('edited child');expect(await parent.locator('input').inputValue()).toBe('parent');
    await expect(control.selectPage('foreign-session-page')).rejects.toThrow('E_PAGE_ID');
    expect((await control.listPages()).activePageId).toBe(childId);
    await child.close();expect((await control.listPages()).activePageId).toBeUndefined();
    await expect(control.selectPage(childId)).rejects.toThrow('E_PAGE_ID');
    await control.selectPage(parentId);await control.type('input','edited parent');expect(await parent.locator('input').inputValue()).toBe('edited parent');
    await control.close();
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

it('SDK selection switches reads, writes and page-local signal windows together',async()=>{
  const writes:string[]=[];
  const server=createServer((req,res)=>{
    if(req.url==='/redirect-created'){res.writeHead(302,{location:'/created'});res.end();return;}
    if(req.url==='/failed-created'){res.writeHead(302,{location:'http://127.0.0.1:9/denied'});res.end();return;}
    if(req.url?.startsWith('/signal-')){res.statusCode=req.url==='/signal-child'?500:200;res.end('signal');return;}
    if(req.url?.startsWith('/input-')){writes.push(req.url);res.end('saved');return;}
    const who=req.url==='/child'?'child':req.url==='/clean-child'?'clean':req.url==='/created'?'created':'parent';res.setHeader('content-type','text/html');res.setHeader('set-cookie','shared_fixture=one; Path=/; HttpOnly');
    res.end(`<h1>${who}</h1><p id="cookie">${req.headers.cookie??''}</p><input aria-label="Value" value="${who}" oninput="fetch('/input-${who}')"><a id="child" target="_blank" href="/child">Child</a><a id="clean" target="_blank" href="/clean-child">Clean</a><a id="bad" target="_blank" href="/failed-created">Bad</a><script>console.log('${who}-only');fetch('/signal-${who}').then(()=>document.body.dataset.ready='yes')</script>`);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const {facade}=await createStandaloneFacade({backend:'upstream',allowedOrigins:[url],workspaceRoot:await mkdtemp(join(tmpdir(),'vb-selected-signals-'))});
  try {
    const opened=await facade.open({url});expect(opened.ok,opened.content).toBe(true);
    const id=(opened.data as {session:{id:string}}).session.id;
    expect((await facade.wait({sessionId:id,selector:'body[data-ready=yes]'})).ok).toBe(true);
    const parentId=((await facade.listPages(id)).data as {activePageId:string}).activePageId;
    const parentNetwork=(await facade.networkList(id)).data as {requests:Array<{id:string;url:string}>;cursor:string};
    expect((await facade.click(id,'#child',5000,'popup')).ok).toBe(true);
    const pages=((await facade.listPages(id)).data as {pages:Array<{pageId:string;active:boolean}>}).pages;
    const childId=pages.find(page=>!page.active)!.pageId;
    const selecting=facade.selectPage(id,childId);
    const typing=facade.type(id,'input','child changed');
    expect((await selecting).ok).toBe(true);
    const typed=await typing;expect(typed.ok,typed.content).toBe(true);
    expect((typed.data as {observation:{beforeUrl:string;afterUrl:string}}).observation).toMatchObject({beforeUrl:url+'/child',afterUrl:url+'/child'});
    expect((await facade.wait({sessionId:id,selector:'body[data-ready=yes]'})).ok).toBe(true);
    const text=await facade.extractPageText({sessionId:id});expect((text.data as {source:{url:string}}).source.url).toBe(url+'/child');
    const childNetwork=await facade.networkList(id);expect(childNetwork.ok,childNetwork.content).toBe(true);
    expect(childNetwork.data).toMatchObject({collection:'degraded'});
    const childData=childNetwork.data as {requests:Array<{id:string;url:string}>;cursor:string};
    expect(childData.requests.some(row=>row.url.endsWith('/signal-child'))).toBe(true);
    expect(childData.requests.some(row=>row.url.endsWith('/signal-parent'))).toBe(false);
    expect(childData.requests.map(row=>row.id).some(id=>parentNetwork.requests.some(row=>row.id===id))).toBe(false);
    expect((await facade.networkWait(id,{sinceCursor:parentNetwork.cursor,filter:{urlIncludes:'/signal-child'},timeoutMs:50})).ok).toBe(false);
    expect((await facade.networkDetail(id,[parentNetwork.requests[0]!.id])).content).toContain('missing');
    const childConsole=await facade.console(id);expect(childConsole.content).toContain('child-only');expect(childConsole.content).not.toContain('parent-only');
    expect((await facade.verifyFlow({sessionId:id,screenshot:false})).data).toMatchObject({outcome:'fail'});
    const pendingNetwork=facade.networkWait(id,{filter:{urlIncludes:'/not-requested'},timeoutMs:5000});
    expect((await facade.selectPage(id,parentId)).ok).toBe(true);
    const stoppedWait=await pendingNetwork;expect(stoppedWait.ok).toBe(false);expect(stoppedWait.content).toContain('session/page changed');
    expect((await facade.wait({sessionId:id,selector:'input',valueEquals:'parent'})).ok).toBe(true);
    const restoredNetwork=(await facade.networkList(id)).data as {requests:Array<{url:string}>};
    expect(restoredNetwork.requests.some(row=>row.url.endsWith('/signal-parent'))).toBe(true);expect(restoredNetwork.requests.some(row=>row.url.endsWith('/signal-child'))).toBe(false);
    expect((await facade.console(id)).content).not.toContain('child-only');
    expect(writes).toEqual(['/input-child']);
    expect((await facade.verifyFlow({sessionId:id,screenshot:false})).data).toMatchObject({outcome:'pass'});
    await facade.selectPage(id,parentId);
    const beforeCreate=(await facade.listPages(id)).data as {pages:unknown[]};
    expect((await facade.newPage(id,{url:'http://127.0.0.1:9'})).ok).toBe(false);
    expect(((await facade.listPages(id)).data as {pages:unknown[]}).pages).toHaveLength(beforeCreate.pages.length);
    expect((await facade.newPage(id,{url:url+'/failed-created'})).ok).toBe(false);
    expect(((await facade.listPages(id)).data as {pages:unknown[]}).pages).toHaveLength(beforeCreate.pages.length);
    const created=await facade.newPage(id,{url:url+'/redirect-created',background:true});expect(created.ok,created.content).toBe(true);
    const createdId=(created.data as {createdPageId:string;activePageId:string}).createdPageId;
    expect(created.data).toMatchObject({activePageId:parentId});
    expect((await facade.wait({sessionId:id,selector:'input',valueEquals:'parent'})).ok).toBe(true);
    expect((await facade.selectPage(id,createdId)).ok).toBe(true);
    const cookie=await facade.extractPageText({sessionId:id,selector:'#cookie'});expect(cookie.content).toContain('shared_fixture=one');
    expect((cookie.data as {source:{url:string}}).source.url).toBe(url+'/created');
    const oldField=await facade.findElement({sessionId:id,role:'textbox',name:'Value'});
    const closed=await facade.closePage(id);expect(closed.ok,closed.content).toBe(true);expect(closed.data).toMatchObject({closedPageId:createdId});expect((closed.data as {activePageId?:string}).activePageId).toBeUndefined();
    expect((await facade.closePage(id,createdId)).ok).toBe(false);expect((await facade.selectPage(id,createdId)).ok).toBe(false);
    expect((await facade.selectPage(id,parentId)).ok).toBe(true);
    const stale=await facade.type(id,`[data-vb-ref="${(oldField.data as {item:{ref:string}}).item.ref}"]`,'wrong');expect(stale.ok).toBe(false);
    const blank=await facade.newPage(id,{background:true});expect(blank.ok,blank.content).toBe(true);expect(blank.data).toMatchObject({activePageId:parentId});
    await facade.closePage(id,(blank.data as {createdPageId:string}).createdPageId);
    await facade.closePage(id,childId);
    expect((await facade.wait({sessionId:id,selector:'input',valueEquals:'parent'})).ok).toBe(true);
    expect((await facade.click(id,'#clean',5000,'popup')).ok).toBe(true);
    const cleanId=((await facade.listPages(id)).data as {pages:Array<{pageId:string;url:string}>}).pages.find(page=>page.url.endsWith('/clean-child'))!.pageId;
    expect((await facade.selectPage(id,cleanId)).ok).toBe(true);
    expect((await facade.wait({sessionId:id,selector:'body[data-ready=yes]'})).ok).toBe(true);
    expect((await facade.verifyFlow({sessionId:id,screenshot:false})).data).toMatchObject({outcome:'unknown'});
    expect((await facade.nav(id,url+'/clean-child')).ok).toBe(true);
    expect((await facade.wait({sessionId:id,selector:'body[data-ready=yes]'})).ok).toBe(true);
    expect((await facade.verifyFlow({sessionId:id,screenshot:false})).data).toMatchObject({outcome:'pass'});
    await facade.selectPage(id,parentId);await facade.closePage(id,cleanId);
    const last=await facade.closePage(id,parentId);expect(last.ok).toBe(false);expect(last.content).toContain('E_LAST_PAGE');
    expect((await facade.click(id,'#bad',5000,'popup')).ok).toBe(true);
    const afterError=await facade.listPages(id);expect(afterError.ok,afterError.content).toBe(true);
    const errorPage=(afterError.data as {pages:Array<{pageId:string;active:boolean;titleUnavailable?:boolean}>}).pages.find(page=>!page.active)!;
    expect(errorPage.titleUnavailable).toBe(true);expect((await facade.closePage(id,errorPage.pageId)).ok).toBe(true);
    expect((await facade.wait({sessionId:id,selector:'input',valueEquals:'parent'})).ok).toBe(true);
  }finally{await facade.dispose();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

it('stdio MCP exposes page inventory and selects only pages owned by the requested session',async()=>{
  const server=createServer((req,res)=>{if(req.url==='/blocked'){res.writeHead(302,{location:'http://127.0.0.1:9/denied'});res.end();return;}res.setHeader('content-type','text/html');res.end(`<input value="${req.url==='/child'?'child':'parent'}"><a id="open" href="/child" target="_blank">Child</a><a id="bad" target="_blank" href="/blocked">Bad</a>`);});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const client=new Client({name:'mcp-pages',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',resolve('src/mcp/server.ts')],cwd:await mkdtemp(join(tmpdir(),'vb-mcp-pages-')),
    env:{...process.env,VERSEBROWSER_BACKEND:'upstream',VERSEBROWSER_TOOL_GROUPS:'core',VERSEBROWSER_CAPS:'browser.open,browser.observe,browser.act,browser.close'} as Record<string,string>,stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  const call=async(name:string,args:Record<string,unknown>)=>JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
  try {
    await client.connect(transport);
    const names=(await client.listTools()).tools.map(tool=>tool.name);expect(names).toContain('vb_pages');expect(names).toContain('vb_page_select');
    const opened=await call('vb_open',{url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const peer=await call('vb_open',{url});expect(peer.ok,peer.content).toBe(true);const peerId=peer.data.session.id;
    const parentId=(await call('vb_pages',{sessionId})).data.activePageId;
    const foreignId=(await call('vb_pages',{sessionId:peerId})).data.activePageId;
    expect((await call('vb_click',{sessionId,selector:'#open',after:'popup'})).ok).toBe(true);
    const childId=(await call('vb_pages',{sessionId})).data.pages.find((page:{active:boolean})=>!page.active).pageId;
    const selected=await call('vb_page_select',{sessionId,pageId:childId});expect(selected.ok,selected.content).toBe(true);
    expect((await call('vb_type',{sessionId,selector:'input',text:'changed child'})).ok).toBe(true);
    expect((await call('vb_wait',{sessionId,selector:'input',valueEquals:'changed child'})).ok).toBe(true);
    expect((await call('vb_page_select',{sessionId,pageId:foreignId})).ok).toBe(false);
    expect((await call('vb_pages',{sessionId})).data.activePageId).toBe(childId);
    expect((await call('vb_page_select',{sessionId,pageId:parentId})).ok).toBe(true);
    expect((await call('vb_wait',{sessionId,selector:'input',valueEquals:'parent'})).ok).toBe(true);
    const created=await call('vb_page_new',{sessionId,url:url+'/child',background:true});expect(created.ok,created.content).toBe(true);expect(created.data.activePageId).toBe(parentId);
    expect((await call('vb_page_close',{sessionId,pageId:created.data.createdPageId})).ok).toBe(true);
    expect((await call('vb_page_close',{sessionId,pageId:foreignId})).ok).toBe(false);expect((await call('vb_pages',{sessionId:peerId})).data.pages).toHaveLength(1);
    await call('vb_page_select',{sessionId,pageId:childId});
    const closed=await call('vb_page_close',{sessionId});expect(closed.ok,closed.content).toBe(true);expect(closed.data.activePageId).toBeUndefined();
    expect((await call('vb_page_select',{sessionId,pageId:childId})).ok).toBe(false);
    await call('vb_page_select',{sessionId,pageId:parentId});
    expect((await call('vb_page_close',{sessionId,pageId:parentId})).content).toContain('E_LAST_PAGE');
    const survivor=await call('vb_page_new',{sessionId,url:url+'/child'});expect(survivor.ok,survivor.content).toBe(true);
    const survivorId=survivor.data.createdPageId;expect(survivor.data.activePageId).toBe(survivorId);
    expect((await call('vb_page_close',{sessionId,pageId:parentId})).ok).toBe(true);
    expect((await call('vb_wait',{sessionId,selector:'input',valueEquals:'child'})).ok).toBe(true);
    expect((await call('vb_pages',{sessionId:peerId})).data.pages).toHaveLength(1);
    expect((await call('vb_click',{sessionId,selector:'#bad',after:'popup'})).ok).toBe(true);
    const errorPages=await call('vb_pages',{sessionId});expect(errorPages.ok,errorPages.content).toBe(true);
    const errorPage=errorPages.data.pages.find((page:{active:boolean})=>!page.active);expect(errorPage.titleUnavailable).toBe(true);
    expect((await call('vb_page_close',{sessionId,pageId:errorPage.pageId})).ok).toBe(true);
    expect((await call('vb_wait',{sessionId,selector:'input',valueEquals:'child'})).ok).toBe(true);
    await call('vb_close',{sessionId});await call('vb_close',{sessionId:peerId});
  }finally{await client.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

it('MCP rejects page selection without action permission',async()=>{
  const server=createMcpServer({noDriver:true,policy:resolveMcpPolicy({groups:'core',caps:'browser.observe',env:{}})});
  const client=new Client({name:'mcp-page-denial',version:'1'});
  try {
    const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
    const response=await client.callTool({name:'vb_page_select',arguments:{sessionId:'s',pageId:'p'}});
    const result=JSON.parse((response.content as Array<{text:string}>)[0]!.text);
    expect(result.ok).toBe(false);expect(result.error.code).toBe('E_CAPABILITY_DENY');expect(result.error.details.recoveryHint.execution).toBe('not_started');
    const dialog=await client.callTool({name:'vb_dialog_respond',arguments:{sessionId:'s',dialogId:'d',accept:true}});
    const refused=JSON.parse((dialog.content as Array<{text:string}>)[0]!.text);expect(refused.error.code).toBe('E_CAPABILITY_DENY');expect(refused.error.details.recoveryHint.execution).toBe('not_started');
  }finally{await client.close();await server.close();}
});

it.each(['sdk','stdio'])('observes and answers only the named dialog through %s',async entrance=>{
  const effects:Array<{kind:string;value:string|null}>=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url!,'http://localhost');
    if(url.pathname==='/effect'){effects.push({kind:url.searchParams.get('kind')!,value:url.searchParams.get('value')});res.end('ok');return;}
    res.setHeader('content-type','text/html');res.end(`<title>Dialog fixture</title><button id="confirm" onclick="if(confirm('password=DIALOG_PRIVATE Proceed?'))fetch('/effect?kind=confirm').then(()=>document.querySelector('output').textContent='confirmed')">Confirm</button><button id="prompt" onclick="const value=prompt('Enter value','default');if(value!==null)fetch('/effect?kind=prompt&value='+encodeURIComponent(value)).then(()=>document.querySelector('output').textContent='prompted')">Prompt</button><output>pending</output>`);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const workspaceRoot=await mkdtemp(join(tmpdir(),'vb-dialogs-'));
  const facade=entrance==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot})).facade:undefined;
  const client=new Client({name:'dialog-tests',version:'1'});
  if(!facade){const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',resolve('src/mcp/server.ts')],cwd:workspaceRoot,env:{...process.env,VERSEBROWSER_BACKEND:'upstream',VERSEBROWSER_TOOL_GROUPS:'core',VERSEBROWSER_CAPS:'browser.open,browser.observe,browser.act,browser.close'} as Record<string,string>,stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);}
  const call=async(name:string,args:Record<string,unknown>)=>{
    if(!facade)return JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
    const id=String(args.sessionId??'');
    if(name==='vb_open')return facade.open({url:String(args.url)});
    if(name==='vb_click')return facade.click(id,String(args.selector));
    if(name==='vb_dialogs')return facade.readDialogs(id);
    if(name==='vb_dialog_respond')return facade.respondDialog(id,String(args.dialogId),{accept:args.accept as boolean,...(typeof args.promptText==='string'?{promptText:args.promptText}:{})});
    if(name==='vb_pages')return facade.listPages(id);
    if(name==='vb_page_new')return facade.newPage(id,{background:true});
    if(name==='vb_page_select')return facade.selectPage(id,String(args.pageId));
    if(name==='vb_wait')return facade.wait({sessionId:id,text:String(args.text),timeoutMs:2000});
    return facade.close(id);
  };
  try {
    const opened=await call('vb_open',{url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const ownerId=(await call('vb_pages',{sessionId})).data.activePageId;
    const other=(await call('vb_page_new',{sessionId,background:true})).data.createdPageId;
    await call('vb_click',{sessionId,selector:'#confirm'});
    const observed=await call('vb_dialogs',{sessionId});expect(observed.ok,observed.content).toBe(true);
    const dialog=observed.data.dialogs[0];expect(dialog).toMatchObject({type:'confirm',pageId:ownerId,responseState:'pending'});expect(JSON.stringify(observed)).not.toContain('DIALOG_PRIVATE');expect(effects).toEqual([]);
    const peer=await call('vb_open',{url});expect(peer.ok,peer.content).toBe(true);const peerId=peer.data.session.id;
    expect((await call('vb_dialog_respond',{sessionId:peerId,dialogId:dialog.dialogId,accept:true})).ok).toBe(false);expect(effects).toEqual([]);
    await call('vb_close',{sessionId:peerId});
    const pages=await call('vb_pages',{sessionId});expect(pages.data.pages.find((page:{pageId:string})=>page.pageId===ownerId).title).toBe('Dialog fixture');
    expect((await call('vb_dialog_respond',{sessionId,dialogId:'not-owned',accept:true})).ok).toBe(false);expect(effects).toEqual([]);
    expect((await call('vb_page_select',{sessionId,pageId:other})).ok).toBe(true);
    const dismissed=await call('vb_dialog_respond',{sessionId,dialogId:dialog.dialogId,accept:false});expect(dismissed.ok,dismissed.content).toBe(true);expect(effects).toEqual([]);
    expect((await call('vb_pages',{sessionId})).data.activePageId).toBe(other);
    expect((await call('vb_dialog_respond',{sessionId,dialogId:dialog.dialogId,accept:true})).ok).toBe(false);
    expect((await call('vb_dialogs',{sessionId})).data.dialogs).toEqual([]);
    await call('vb_page_select',{sessionId,pageId:ownerId});await call('vb_click',{sessionId,selector:'#confirm'});
    const next=(await call('vb_dialogs',{sessionId})).data.dialogs[0];expect(next.dialogId).not.toBe(dialog.dialogId);
    expect((await call('vb_dialog_respond',{sessionId,dialogId:next.dialogId,accept:true})).ok).toBe(true);
    expect((await call('vb_wait',{sessionId,text:'confirmed'})).ok).toBe(true);expect(effects).toEqual([{kind:'confirm',value:null}]);
    await call('vb_click',{sessionId,selector:'#prompt'});const prompt=(await call('vb_dialogs',{sessionId})).data.dialogs[0];expect(prompt.defaultValue).toBe('default');
    expect((await call('vb_dialog_respond',{sessionId,dialogId:prompt.dialogId,accept:true})).ok).toBe(false);
    expect((await call('vb_dialog_respond',{sessionId,dialogId:prompt.dialogId,accept:true,promptText:'chosen'})).ok).toBe(true);
    expect((await call('vb_wait',{sessionId,text:'prompted'})).ok).toBe(true);expect(effects.at(-1)).toEqual({kind:'prompt',value:'chosen'});
    await call('vb_click',{sessionId,selector:'#prompt'});const empty=(await call('vb_dialogs',{sessionId})).data.dialogs[0];
    expect((await call('vb_dialog_respond',{sessionId,dialogId:empty.dialogId,accept:true,promptText:''})).ok).toBe(true);
    await expect.poll(()=>effects.filter(effect=>effect.kind==='prompt').length).toBe(2);expect(effects.at(-1)).toEqual({kind:'prompt',value:''});
    await call('vb_close',{sessionId});
  }finally{await facade?.dispose();await client.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

it('invalidates manually closed dialogs and releases a blocked read without accepting unknown types',async()=>{
  const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
  const control=await createUpstreamPageControl(page,'http://127.0.0.1:1',await mkdtemp(join(tmpdir(),'vb-dialog-native-')));
  try {
    const opened=page.waitForEvent('dialog');await page.evaluate(()=>{setTimeout(()=>confirm('First'),0);});const first=await opened;
    const oldId=control.readDialogs().dialogs[0]!.dialogId;await first.dismiss();expect(control.readDialogs().dialogs).toEqual([]);
    await expect(control.respondDialog(oldId,true)).rejects.toThrow('E_DIALOG_ID');
    const waiting=control.wait('#never',1500).catch(error=>error);const nextOpened=page.waitForEvent('dialog');await page.evaluate(()=>{setTimeout(()=>confirm('Second'),0);});const next=await nextOpened;
    const id=control.readDialogs().dialogs[0]!.dialogId;
    const type=vi.spyOn(next,'type').mockReturnValue('future-dialog');
    await expect(control.respondDialog(id,true)).rejects.toThrow('E_DIALOG_TYPE');type.mockRestore();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{expect(await Promise.race([control.respondDialog(id,false),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('dialog response queued behind blocked read')),700);})])).toMatchObject({accepted:false});}finally{clearTimeout(timer);}
    expect(await waiting).toBeInstanceOf(Error);
  }finally{await control.close();await browser.close();}
});

it.each(['sdk','stdio'])('returns pending navigation for load and beforeunload dialogs through %s',async entrance=>{
  let targetHits=0;
  const http=createServer((req,res)=>{
    res.setHeader('content-type','text/html');
    if(req.url==='/load'){res.end('<title>Load dialog</title><script>confirm("Load?")</script><p>loaded</p>');return;}
    if(req.url==='/target'){targetHits++;res.end('<h1>target reached</h1>');return;}
    res.end('<title>Source</title><input value="preserved"><button id="arm" onclick="onbeforeunload=e=>{e.preventDefault();e.returnValue=\'unsaved\'}">Arm</button>');
  });
  await new Promise<void>(done=>http.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
  const workspaceRoot=await mkdtemp(join(tmpdir(),'vb-navigation-dialog-'));
  const facade=entrance==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot})).facade:undefined;
  const client=new Client({name:'navigation-dialog',version:'1'});
  if(!facade){const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',resolve('src/mcp/server.ts')],cwd:workspaceRoot,env:{...process.env,VERSEBROWSER_BACKEND:'upstream',VERSEBROWSER_TOOL_GROUPS:'core',VERSEBROWSER_CAPS:'browser.open,browser.observe,browser.navigate,browser.act,browser.close'} as Record<string,string>,stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);}
  const call=async(name:string,args:Record<string,unknown>)=>{
    if(!facade)return JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
    const id=String(args.sessionId??'');
    if(name==='vb_open')return facade.open({url:String(args.url)});
    if(name==='vb_nav')return facade.nav(id,String(args.url));
    if(name==='vb_click')return facade.click(id,String(args.selector));
    if(name==='vb_dialogs')return facade.readDialogs(id);
    if(name==='vb_dialog_respond')return facade.respondDialog(id,String(args.dialogId),{accept:args.accept as boolean});
    if(name==='vb_page_new')return facade.newPage(id,{url:String(args.url)});
    if(name==='vb_wait')return facade.wait({sessionId:id,...(args.text?{text:String(args.text)}:{}),...(args.valueEquals?{selector:'input',valueEquals:String(args.valueEquals)}:{}),timeoutMs:3000});
    return facade.close(id);
  };
  try {
    let timer:ReturnType<typeof setTimeout>|undefined;
    const opening=call('vb_open',{url:url+'/load'});
    const opened=await Promise.race([opening,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('open did not return its pending dialog')),5000);})]).finally(()=>clearTimeout(timer));
    expect(opened.ok,opened.content).toBe(true);expect(opened.data.pendingDialog).toMatchObject({requestedUrl:url+'/load',navigationStarted:true});const sessionId=opened.data.session.id;
    const notStarted=await call('vb_nav',{sessionId,url:url+'/target'});expect(notStarted.data.pendingDialog.navigationStarted).toBe(false);expect(targetHits).toBe(0);
    await call('vb_dialog_respond',{sessionId,dialogId:opened.data.pendingDialog.dialogId,accept:false});expect((await call('vb_wait',{sessionId,text:'loaded'})).ok).toBe(true);expect(targetHits).toBe(0);
    const created=await call('vb_page_new',{sessionId,url:url+'/load'});expect(created.ok,created.content).toBe(true);expect(created.data.pendingDialog.pageId).toBe(created.data.createdPageId);
    await call('vb_dialog_respond',{sessionId,dialogId:created.data.pendingDialog.dialogId,accept:false});expect((await call('vb_wait',{sessionId,text:'loaded'})).ok).toBe(true);
    expect((await call('vb_nav',{sessionId,url})).ok).toBe(true);await call('vb_click',{sessionId,selector:'#arm'});
    const leaving=await call('vb_nav',{sessionId,url:url+'/target'});expect(leaving.data.pendingDialog.navigationStarted).toBe(true);expect(targetHits).toBe(0);
    expect((await call('vb_dialogs',{sessionId})).data.dialogs[0].type).toBe('beforeunload');
    await call('vb_dialog_respond',{sessionId,dialogId:leaving.data.pendingDialog.dialogId,accept:false});
    const preserved=await call('vb_wait',{sessionId,selector:'input',valueEquals:'preserved'});expect(preserved.ok,preserved.content).toBe(true);expect(targetHits).toBe(0);
    const retry=await call('vb_nav',{sessionId,url:url+'/target'});expect(retry.data.pendingDialog.navigationStarted).toBe(true);
    await call('vb_dialog_respond',{sessionId,dialogId:retry.data.pendingDialog.dialogId,accept:true});expect((await call('vb_wait',{sessionId,text:'target reached'})).ok).toBe(true);expect(targetHits).toBe(1);
    await call('vb_close',{sessionId});
  }finally{await facade?.dispose();await client.close();http.closeAllConnections();await new Promise<void>(done=>http.close(()=>done()));}
});
