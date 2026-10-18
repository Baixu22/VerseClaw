import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,stat,symlink,readdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createStandaloneFacade} from '../src/engine/standalone.ts';
import {createMcpServer} from '../src/mcp/server.ts';
import {resolveMcpPolicy} from '../src/mcp/capability-policy.ts';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const downloadBytes=Buffer.from([0,255,254,13,10,128,66,0]);
const downloadText=Buffer.from('PRIVATE_DOWNLOAD_FIXTURE\n');
async function fixture(){
  const receipts:Array<Array<{name:string;bytes:number;sha256:string;mimeType:string}>>=[];
  let noopHits=0,downloadHits=0;const heldDownloads:Array<()=>void>=[];
  const http=createServer((req,res)=>{
    if(req.url==='/noop'){noopHits++;res.end('clicked');return;}
    if(['/download','/download-text','/download-slow'].includes(req.url??'')){
      downloadHits++;const text=req.url==='/download-text';const send=()=>{if(!res.destroyed){res.writeHead(200,{'content-type':text?'text/plain; charset=utf-8':'application/octet-stream','content-disposition':'attachment; filename="../../web-name.bin"'});res.end(text?downloadText:downloadBytes);}};
      if(req.url==='/download-slow')heldDownloads.push(send);else send();return;
    }
    if(req.method==='POST'){
      const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
        const boundary=/boundary=(?:"([^"]+)"|([^;]+))/.exec(String(req.headers['content-type']))!;
        const received=[];
        for(const part of Buffer.concat(chunks).toString('latin1').split('--'+(boundary[1]??boundary[2]))){
          const split=part.indexOf('\r\n\r\n');if(split<0)continue;
          const name=/filename="([^"]+)"/.exec(part.slice(0,split))?.[1];if(!name)continue;
          const bytes=Buffer.from(part.slice(split+4).replace(/\r\n$/,''),'latin1');received.push({name,bytes:bytes.length,sha256:hash(bytes),mimeType:/Content-Type: ([^\r\n]+)/i.exec(part.slice(0,split))?.[1]??''});
        }
        receipts.push(received);res.setHeader('content-type','text/html');res.end('<h1>uploaded</h1>');
      });return;
    }
    res.setHeader('content-type','text/html');
    res.end(`<a id="download" href="/download">Download binary</a><a id="download-text" href="/download-text">Download text</a><a id="download-attr" href="/download" download="attr.bin">Download attribute</a><a id="download-slow" href="/download-slow">Download slow</a><form method="post" action="/upload" enctype="multipart/form-data"><input id="single" name="single" type="file"><input id="multi" name="multi" type="file" multiple><input id="hidden" name="hidden" type="file" multiple hidden><button id="choose" type="button" onclick="document.querySelector('#hidden').click()">Choose</button><button id="send">Send</button></form><button id="noop" onclick="fetch('/noop')">No picker</button><output id="selected">none</output><script>document.addEventListener('change',e=>{if(e.target.files)document.querySelector('output').textContent=Array.from(e.target.files).map(file=>file.name).join(',')})</script>`);
  });
  await new Promise<void>(done=>http.listen(0,'127.0.0.1',done));
  return {url:'http://127.0.0.1:'+(http.address() as {port:number}).port,receipts,noopHits:()=>noopHits,downloadHits:()=>downloadHits,releaseDownloads:()=>heldDownloads.splice(0).forEach(send=>send()),close:async()=>{http.closeAllConnections();await new Promise<void>(done=>http.close(()=>done()));}};
}
async function entrance(kind:string,root:string,grants:string[],downloadGrants?:string[]){
  const facade=kind==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot:root,allowedUploadPaths:grants,...(downloadGrants?{allowedDownloadPaths:downloadGrants}:{})})).facade:undefined;
  const client=new Client({name:'upload-tests',version:'1'});
  if(!facade){const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',resolve('src/mcp/server.ts')],cwd:root,env:{...process.env,VERSEBROWSER_BACKEND:'upstream',VERSEBROWSER_UPLOAD_PATHS:JSON.stringify(grants),VERSEBROWSER_DOWNLOAD_PATHS:JSON.stringify(downloadGrants??[]),VERSEBROWSER_TOOL_GROUPS:'core,network',VERSEBROWSER_CAPS:'browser.open,browser.navigate,browser.act,browser.observe,browser.close,browser.upload,browser.download,network.read'} as Record<string,string>,stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);}
  const call=async(name:string,args:Record<string,any>,signal?:AbortSignal):Promise<any>=>{
    if(!facade)return JSON.parse(((await client.callTool({name,arguments:args},undefined,{...(signal?{signal}:{}),timeout:15000})).content as Array<{text:string}>)[0]!.text);
    const id=String(args.sessionId??'');
    if(name==='vb_open')return facade.open({url:args.url});
    if(name==='vb_nav')return facade.nav(id,args.url);
    if(name==='vb_download')return facade.downloadFile({sessionId:id,selector:args.selector,path:args.path,timeoutMs:args.timeoutMs});
    if(name==='vb_network_list')return facade.networkList(id,args);
    if(name==='vb_network_detail')return facade.networkDetail(id,args.requestIds);
    if(name==='vb_page_new')return facade.newPage(id,args);
    if(name==='vb_upload')return facade.uploadFiles({sessionId:id,selector:args.selector,paths:args.paths,timeoutMs:args.timeoutMs});
    if(name==='vb_click')return facade.click(id,args.selector,args.timeoutMs,args.after);
    if(name==='vb_wait')return facade.wait({...args,sessionId:id});
    if(name==='vb_snapshot')return facade.snapshot(id);
    if(name==='vb_find')return facade.findElement({...args,sessionId:id});
    if(name==='vb_page_text')return facade.extractPageText({...args,sessionId:id});
    if(name==='vb_pages')return facade.listPages(id);
    if(name==='vb_close')return facade.close(id);
    throw new Error(name);
  };
  return {call,close:async()=>{await facade?.dispose();await client.close();}};
}

it.each(['sdk','stdio'])('uploads only granted workspace files through %s with native chooser semantics',async kind=>{
  const site=await fixture(), root=await mkdtemp(join(tmpdir(),'vb-upload-')), outside=await mkdtemp(join(tmpdir(),'vb-upload-outside-'));
  const one=Buffer.from('versebrowser\n'),two=Buffer.from([0,255,254,13,10,128,66,0]);
  await writeFile(join(root,'one.txt'),one);await writeFile(join(root,'two.bin'),two);await writeFile(join(root,'ungranted.txt'),'not authorized');
  await writeFile(join(outside,'outside.txt'),'OUTSIDE_UPLOAD_SECRET');await mkdir(join(root,'directory'));await writeFile(join(root,'oversized.bin'),Buffer.alloc(4*1024*1024+1));
  const grants=['one.txt','two.bin','link/outside.txt','directory','oversized.bin'];const api=await entrance(kind,root,grants);grants.push('ungranted.txt');
  const call=api.call;let id:string|undefined;
  try{
    const opened=await call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);id=opened.data.session.id;
    const run=async(name:string,args:Record<string,unknown>={})=>{const result=await call(name,{sessionId:id,...args});expect(result.ok,result.content).toBe(true);return result;};
    const pageId=(await run('vb_pages')).data.activePageId;
    const oldRef=(await run('vb_find',{role:'button',name:'Choose'})).data.item.ref;
    await run('vb_nav',{url:site.url});
    const old=await call('vb_upload',{sessionId:id,selector: '[data-vb-ref="'+oldRef+'"]',paths:['one.txt']});expect(old.ok).toBe(false);expect(old.content).toContain('E_STALE_REF');
    await symlink(outside,join(root,'link'),'junction');
    for(const paths of [[],[''],['one.txt','./one.txt'],['ungranted.txt'],['directory'],['oversized.bin'],['../outside.txt'],[join(outside,'outside.txt')],['link/outside.txt']]){
      const denied=await call('vb_upload',{sessionId:id,selector:'#single',paths,timeoutMs:1000});expect(denied.ok,JSON.stringify(paths)).toBe(false);expect(denied.evidence??[]).toEqual([]);
      expect(site.receipts).toEqual([]);expect((await run('vb_page_text',{selector:'#selected'})).content).toContain('none');
      expect(JSON.stringify(denied)).not.toContain('OUTSIDE_UPLOAD_SECRET');
    }
    const forged=await call('vb_upload',{sessionId:id,selector:'#single',paths:['ungranted.txt'],allowedUploadPaths:['ungranted.txt']});expect(forged.ok).toBe(false);
    const foreign=await call('vb_upload',{sessionId:'another-worker',selector:'#single',paths:['one.txt']});expect(foreign.ok).toBe(false);
    const single=await run('vb_upload',{selector:'#single',paths:['one.txt']});expect(single.data).toMatchObject({sessionId:id,pageId,status:'assigned',files:[{name:'one.txt',bytes:one.length}],businessOutcome:'unknown'});expect(single.data.observation.businessOutcome).toBe('unknown');expect(single.evidence??[]).toEqual([]);
    const multipleDenied=await call('vb_upload',{sessionId:id,selector:'#single',paths:['one.txt','two.bin']});expect(multipleDenied.ok).toBe(false);expect(multipleDenied.content).toContain('does not accept multiple');
    expect((await run('vb_page_text',{selector:'#selected'})).content).toContain('one.txt');
    await run('vb_click',{selector:'#send',after:'navigation'});
    expect(site.receipts).toEqual([[{name:'one.txt',bytes:one.length,sha256:hash(one),mimeType:'text/plain'}]]);
    await run('vb_nav',{url:site.url});
    await run('vb_upload',{selector:'#multi',paths:['one.txt','two.bin']});await run('vb_click',{selector:'#send',after:'navigation'});
    expect(site.receipts[1]).toEqual([{name:'one.txt',bytes:one.length,sha256:hash(one),mimeType:'text/plain'},{name:'two.bin',bytes:two.length,sha256:hash(two),mimeType:'application/octet-stream'}]);
    await run('vb_nav',{url:site.url});
    await run('vb_upload',{selector:'#choose',paths:['two.bin']});await run('vb_click',{selector:'#send',after:'navigation'});
    expect(site.receipts[2]).toEqual([{name:'two.bin',bytes:two.length,sha256:hash(two),mimeType:'application/octet-stream'}]);
    await run('vb_close');
    const artifacts=await readdir(join(root,'.ae'),{recursive:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});expect(artifacts.some(path=>/(one[.]txt|two[.]bin|outside[.]txt)$/.test(path))).toBe(false);
  }finally{await api.close();await site.close();}
});

it.each(['sdk','stdio'])('stops a pending upload through %s without assigning files or closing a peer',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-upload-cancel-'));await writeFile(join(root,'one.txt'),'versebrowser\n');const site=await fixture();const api=await entrance(kind,root,['one.txt']);
  try{
    const opened=await api.call('vb_open',{url:site.url}),peer=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);expect(peer.ok,peer.content).toBe(true);
    const id=opened.data.session.id,peerId=peer.data.session.id;const abort=new AbortController();
    const pending=api.call('vb_upload',{sessionId:id,selector:'#noop',paths:['one.txt'],timeoutMs:5000},kind==='stdio'?abort.signal:undefined).catch(error=>({transportError:String(error)}));
    await expect.poll(site.noopHits,{timeout:3000}).toBe(1);
    if(kind==='stdio')abort.abort();else expect((await api.call('vb_close',{sessionId:id})).ok).toBe(true);
    const ended=await pending;expect(ended.ok).not.toBe(true);expect(site.receipts).toEqual([]);
    await expect.poll(async()=> (await api.call('vb_pages',{sessionId:id})).ok,{timeout:3000}).toBe(false);
    const peerPages=await api.call('vb_pages',{sessionId:peerId});expect(peerPages.ok,peerPages.content).toBe(true);expect(peerPages.data.pages).toHaveLength(1);
  }finally{await api.close();await site.close();}
});

it.each(['sdk','stdio'])('expires an upload under its original deadline through %s without replaying the click',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-upload-timeout-'));await writeFile(join(root,'one.txt'),'versebrowser\n');const site=await fixture();const api=await entrance(kind,root,['one.txt']);
  try{
    const opened=await api.call('vb_open',{url:site.url}),peer=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);expect(peer.ok,peer.content).toBe(true);const sessionId=opened.data.session.id;
    const result=await api.call('vb_upload',{sessionId,selector:'#noop',paths:['one.txt'],timeoutMs:1500});
    expect(result.ok).toBe(false);expect(result.content).toContain('Request timed out');expect(result.data?.status).not.toBe('assigned');expect(site.noopHits()).toBe(1);expect(site.receipts).toEqual([]);
    expect((await api.call('vb_pages',{sessionId})).ok).toBe(false);
    const next=await api.call('vb_upload',{sessionId:peer.data.session.id,selector:'#single',paths:['one.txt']});expect(next.ok,next.content).toBe(true);expect(site.noopHits()).toBe(1);
  }finally{await api.close();await site.close();}
});

it('requires a separate upload capability before any driver is started',async()=>{
  const server=createMcpServer({backend:'upstream',noDriver:true,policy:resolveMcpPolicy({groups:'core',caps:'browser.act',env:{}})});const client=new Client({name:'upload-denial',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'vb_upload',arguments:{sessionId:'s',selector:'#file',paths:['one.txt']}});const data=JSON.parse((result.content as Array<{text:string}>)[0]!.text);expect(data.error.code).toBe('E_CAPABILITY_DENY');expect(data.error.details.recoveryHint.execution).toBe('not_started');}
  finally{await client.close();await server.close();}
});

async function runtimeOriginals(root:string){
  return (await readdir(join(root,'.ae','sessions'),{recursive:true,withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(entry=>entry.isFile());
}
it.each(['sdk','stdio'])('saves only authorized downloads through %s with native bytes and no automatic evidence original',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-download-')),outside=await mkdtemp(join(tmpdir(),'vb-download-outside-')),site=await fixture();
  await mkdir(join(root,'exports'));await writeFile(join(root,'exports','existing.bin'),'KEEP_EXISTING');
  const grants=['exports/result.bin','exports/text.txt','exports/existing.bin','link/escaped.bin','exports/stale.bin'];
  const api=await entrance(kind,root,[],grants);grants.push('exports/ungranted.bin');
  try{
    const opened=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const run=async(name:string,args:Record<string,unknown>={})=>{const result=await api.call(name,{sessionId,...args});expect(result.ok,result.content).toBe(true);return result;};
    const pageId=(await run('vb_pages')).data.activePageId;
    const stale=(await run('vb_find',{role:'link',name:'Download binary'})).data.item.ref;await run('vb_nav',{url:site.url});
    const rejectedRef=await api.call('vb_download',{sessionId,selector:'[data-vb-ref="'+stale+'"]',path:'exports/stale.bin'});expect(rejectedRef.ok).toBe(false);expect(rejectedRef.content).toContain('E_STALE_REF');
    await symlink(outside,join(root,'link'),'junction');
    for(const path of ['', '../outside.bin',join(outside,'outside.bin'),'link/escaped.bin','exports/existing.bin','exports/ungranted.bin']){
      const result=await api.call('vb_download',{sessionId,selector:'#download',path});expect(result.ok,path).toBe(false);expect(result.evidence??[]).toEqual([]);expect(site.downloadHits()).toBe(0);
    }
    expect((await readFile(join(root,'exports','existing.bin'))).toString()).toBe('KEEP_EXISTING');expect(await readdir(outside)).toEqual([]);
    expect((await api.call('vb_download',{sessionId:'foreign',selector:'#download',path:'exports/result.bin'})).ok).toBe(false);
    expect((await api.call('vb_download',{sessionId,selector:'#download',path:'exports/ungranted.bin',allowedDownloadPaths:['exports/ungranted.bin']})).ok).toBe(false);
    await run('vb_click',{selector:'#download',after:'download'});expect(site.downloadHits()).toBe(1);expect(await runtimeOriginals(root)).toEqual([]);expect(await readdir(join(root,'exports'))).toEqual(['existing.bin']);
    const result=await run('vb_download',{selector:'#download',path:'exports/result.bin'});
    expect(result.data).toMatchObject({sessionId,pageId,file:{reference:'exports/result.bin',bytes:downloadBytes.length,mimeType:'application/octet-stream'},status:'completed',businessOutcome:'unknown'});expect(result.evidence??[]).toEqual([]);
    const saved=await readFile(join(root,'exports','result.bin'));expect(hash(saved)).toBe(hash(downloadBytes));expect((await stat(join(root,'exports','result.bin'))).size).toBe(downloadBytes.length);expect(site.downloadHits()).toBe(2);expect(await runtimeOriginals(root)).toEqual([]);
    expect((await api.call('vb_download',{sessionId,selector:'#download',path:'exports/result.bin'})).ok).toBe(false);expect(site.downloadHits()).toBe(2);expect(hash(await readFile(join(root,'exports','result.bin')))).toBe(hash(downloadBytes));
    const text=await run('vb_download',{selector:'#download-text',path:'exports/text.txt'});expect(text.data.file.mimeType).toBe('text/plain');expect(await readFile(join(root,'exports','text.txt'))).toEqual(downloadText);
    const list=await run('vb_network_list',{urlIncludes:'/download-text'});expect(list.data.requests).toHaveLength(2);expect(list.data.requests.filter((row:{status?:number})=>row.status===200)).toHaveLength(1);expect(list.data.requests.find((row:{failed?:boolean;error?:string})=>row.failed)?.error).toContain('ERR_ABORTED');expect(site.downloadHits()).toBe(3);
    const detail=await run('vb_network_detail',{requestIds:list.data.requests.map((row:{id:string})=>row.id)});expect(detail.data.details).toHaveLength(2);expect(detail.data.details.every((row:{responseBody?:unknown})=>row.responseBody===undefined)).toBe(true);expect(JSON.stringify(detail)).not.toContain(downloadText.toString().trim());
    await run('vb_close');expect(await runtimeOriginals(root)).toEqual([]);expect(await readdir(outside)).toEqual([]);
    const evidence=await readdir(join(root,'.ae','evidence'),{recursive:true,withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const file of evidence.filter(entry=>entry.isFile())){expect(file.name).not.toMatch(/web-name|result.bin|text.txt/);expect((await readFile(join(file.parentPath,file.name))).includes(downloadText)).toBe(false);}
  }finally{await api.close();await site.close();}
});
it.each(['sdk','stdio'])('rechecks a changed destination junction through %s after the network wait',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-download-race-')),outside=await mkdtemp(join(tmpdir(),'vb-download-race-out-')),site=await fixture();await mkdir(join(root,'race'));
  const api=await entrance(kind,root,[],['race/result.bin']);
  try{
    const opened=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const pending=api.call('vb_download',{sessionId,selector:'#download-slow',path:'race/result.bin'});
    await expect.poll(site.downloadHits,{timeout:3000}).toBe(1);await rename(join(root,'race'),join(root,'race-original'));await symlink(outside,join(root,'race'),'junction');site.releaseDownloads();
    const result=await pending;expect(result.ok).toBe(false);expect(result.content).toContain('outside');expect(await readdir(outside)).toEqual([]);expect(await readdir(join(root,'race-original'))).toEqual([]);expect(await runtimeOriginals(root)).toEqual([]);
  }finally{site.releaseDownloads();await api.close();await site.close();}
});
it.each(['sdk','stdio'])('cancels an active download through %s without a saved file, replay or peer loss',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-download-cancel-')),site=await fixture();await mkdir(join(root,'exports'));const api=await entrance(kind,root,[],['exports/result.bin']);
  try{
    const opened=await api.call('vb_open',{url:site.url}),peer=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);expect(peer.ok,peer.content).toBe(true);
    const sessionId=opened.data.session.id,controller=new AbortController();
    const pending=api.call('vb_download',{sessionId,selector:'#download-slow',path:'exports/result.bin'},kind==='stdio'?controller.signal:undefined).catch(error=>({transportError:String(error)}));
    await expect.poll(site.downloadHits,{timeout:3000}).toBe(1);if(kind==='stdio')controller.abort();else expect((await api.call('vb_close',{sessionId})).ok).toBe(true);
    expect((await pending).ok).not.toBe(true);await expect.poll(async()=> (await api.call('vb_pages',{sessionId})).ok,{timeout:3000}).toBe(false);site.releaseDownloads();expect(site.downloadHits()).toBe(1);expect(await readdir(join(root,'exports'))).toEqual([]);expect(await runtimeOriginals(root)).toEqual([]);
    expect((await api.call('vb_pages',{sessionId:peer.data.session.id})).ok).toBe(true);
  }finally{site.releaseDownloads();await api.close();await site.close();}
});
it.each(['sdk','stdio'])('times out a download through %s without reporting completion or overwriting the target',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-download-timeout-')),site=await fixture();await mkdir(join(root,'exports'));const api=await entrance(kind,root,[],['exports/result.bin']);
  try{
    const opened=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const result=await api.call('vb_download',{sessionId,selector:'#download-slow',path:'exports/result.bin',timeoutMs:1500});expect(result.ok).toBe(false);expect(result.data?.status).not.toBe('completed');expect(site.downloadHits()).toBe(1);site.releaseDownloads();expect(await readdir(join(root,'exports'))).toEqual([]);expect(await runtimeOriginals(root)).toEqual([]);
  }finally{site.releaseDownloads();await api.close();await site.close();}
});
it('requires download permission separately from browser actions and evidence writes',async()=>{
  const server=createMcpServer({backend:'upstream',noDriver:true,policy:resolveMcpPolicy({groups:'core,evidence',caps:'browser.act,evidence.write',env:{}})}),client=new Client({name:'download-denial',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
  try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'vb_download',arguments:{sessionId:'s',selector:'#file',path:'output.bin'}});expect(JSON.parse((result.content as Array<{text:string}>)[0]!.text).error.code).toBe('E_CAPABILITY_DENY');}finally{await client.close();await server.close();}
});

it.each(['sdk','stdio'])('preserves a destination created during the download through %s',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-download-collision-')),site=await fixture();await mkdir(join(root,'exports'));
  const api=await entrance(kind,root,[],['exports/result.bin']);
  try{
    const opened=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const pending=api.call('vb_download',{sessionId,selector:'#download-slow',path:'exports/result.bin'});
    await expect.poll(site.downloadHits,{timeout:3000}).toBe(1);await writeFile(join(root,'exports','result.bin'),'CREATED_DURING_DOWNLOAD',{flag:'wx'});site.releaseDownloads();
    const result=await pending;expect(result.ok).toBe(false);expect(result.data?.status).not.toBe('completed');expect(result.content).toContain('EEXIST');
    expect((await readFile(join(root,'exports','result.bin'))).toString()).toBe('CREATED_DURING_DOWNLOAD');expect(site.downloadHits()).toBe(1);expect(await runtimeOriginals(root)).toEqual([]);
    expect((await api.call('vb_pages',{sessionId})).ok).toBe(true);
  }finally{site.releaseDownloads();await api.close();await site.close();}
});

it.each(['sdk','stdio'])('closes warmed upload sessions on either deadline without late assignment through %s',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-upload-chooser-timeout-'));await writeFile(join(root,'one.txt'),'versebrowser\n');const site=await fixture();const api=await entrance(kind,root,['one.txt']);
  try {
    const opened=await api.call('vb_open',{url:site.url}),peer=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);expect(peer.ok,peer.content).toBe(true);const sessionId=opened.data.session.id;
    expect((await api.call('vb_snapshot',{sessionId})).ok).toBe(true);
    const started=Date.now();const result=await api.call('vb_upload',{sessionId,selector:'#noop',paths:['one.txt'],timeoutMs:1500});
    const after=await api.call('vb_pages',{sessionId});
    console.log(JSON.stringify({kind,chooserTimeoutReceipt:{elapsedMs:Date.now()-started,result,sessionStillUsable:after.ok,noopHits:site.noopHits(),uploadReceipts:site.receipts.length}}));
    expect(result.ok).toBe(false);expect(result.content).toContain('Request timed out');
    expect(result.error.details.recoveryHint).toMatchObject({category:'timeout',retryable:false,execution:'may_have_side_effects'});
    expect(result.data?.status).not.toBe('assigned');expect(site.noopHits()).toBe(1);expect(site.receipts).toEqual([]);expect(after.ok).toBe(false);
    const next=await api.call('vb_upload',{sessionId:peer.data.session.id,selector:'#single',paths:['one.txt']});expect(next.ok,next.content).toBe(true);expect(site.noopHits()).toBe(1);
  } finally {await api.close();await site.close();}
});

/**
 * TF-0189: a download raised by an HTML download attribute must also land.
 *
 * The slice fulfils every request itself through context.route and binds the browser to a dead
 * proxy, but the browser's download-attribute channel bypasses context.route entirely, so that
 * request is never fulfilled and never leaves the browser. The accepted content-disposition shape
 * works; this pins the attribute shape too.
 */
it.each(['sdk','stdio'])('saves a download-attribute navigation through %s with native bytes',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'vb-download-attr-')),site=await fixture();
  await mkdir(join(root,'exports'));
  const api=await entrance(kind,root,[],['exports/attr.bin']);
  try{
    const opened=await api.call('vb_open',{url:site.url});expect(opened.ok,opened.content).toBe(true);const sessionId=opened.data.session.id;
    const result=await api.call('vb_download',{sessionId,selector:'#download-attr',path:'exports/attr.bin'});
    expect(result.ok,result.content).toBe(true);
    expect(result.data).toMatchObject({status:'completed',file:{reference:'exports/attr.bin',bytes:downloadBytes.length}});
    const saved=await readFile(join(root,'exports','attr.bin'));
    expect(hash(saved)).toBe(hash(downloadBytes));
  }finally{await api.close();await site.close();}
});