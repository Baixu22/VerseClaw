import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { profileFromHostApi } from '../src/engine/driver-profile.ts';
import type { ToolResult } from '../src/contracts/index.ts';
import type { AgentBrowserFindPayload, AgentBrowserFindResult } from '../src/types/host-api.ts';

it.each(['sdk', 'stdio'] as const)('finds exact native targets with scoped refs and no guessed action through %s', async mode => {
  const writes: string[] = [], focus: string[] = [];
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/write/')) { writes.push(req.url); res.end('saved'); return; }
    if (req.url === '/focus') { focus.push('focus'); res.end('focused'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/frame') { res.end('<button>Save</button>'); return; }
    if (req.url === '/form-options') { res.end('<form id="owner"><select name="plan"><option value="free">Free</option><option value="pro" selected>Pro</option></select></form><input name="outside" form="owner" value="external"><form><input name="anonymous" value="a"></form><select name="token"><option value="OPTION_SECRET" selected>OPTION_SECRET</option></select><fieldset disabled><input name="inherited-disabled" value="locked"></fieldset>'); return; }
    if (req.url === '/form-errors') { res.end('<form id="form-a"><label for="email-a">Work email</label><input id="email-a" name="email" type="email" required value="bad" aria-invalid="true" aria-describedby="help email-error" aria-errormessage="email-error" oninput="document.getElementById(\'email-error\').textContent=\'\';this.removeAttribute(\'aria-invalid\')" onfocus="fetch(\'/focus\')"><span id="help">Use your work address</span><span id="email-error">Email invalid</span></form><form id="form-b"><input name="email" aria-label="Other email"><span>Unassociated error</span></form>'); return; }
    if (req.url === '/metadata-negative') { res.end('<title>Negative</title><link rel="canonical" href="https://unvisited.example.test/canonical?token=CANONICAL_SECRET"><script type="application/ld+json">invalid json</script><a href="/a?token=LINK_SECRET">Details</a>'); return; }
    if (req.url === '/metadata') { res.end('<html lang="en"><head><title>Toolbox Read</title><meta name="description" content="Read fixture"><link rel="canonical" href="/canonical"><meta property="og:title" content="Declared"><script type="application/ld+json">{"name":"Declared object"}</script></head><body><a href="/a">Details</a><a href="/b?q=2">Details</a></body></html>'); return; }
    if (req.url === '/table') { res.end('<table><tr><td class="id">r02</td><td class="amount">20</td></tr><tr><td class="id">r04</td><td class="amount"></td></tr><tr><td class="id">r06</td></tr></table>'); return; }
    if (req.url === '/discovery') { res.end('<span style="cursor:pointer" onclick="fetch(\'/write/pointer\')">Pointer target</span><span>Decorative decoy</span><button>Native target</button>'); return; }
    if (req.url === '/nested') { res.end('<article><ol><li>Parent<ul><li>Child <a href="/child">link</a></li></ul></li></ol></article>'); return; }
    if (req.url === '/roles') { res.end(`${['tab','menuitem','option','treeitem','row'].map(role => `<div role="${role}" tabindex="0" aria-label="Target ${role}" onclick="fetch('/write/${role}')">Target ${role}</div>`).join('')}<button hidden>Hidden decoy</button><span>Ordinary text</span>`); return; }
    if (req.url === '/document') { res.end('<article><h2>Repeated</h2><p>Read <a href="/guide"><b>this guide</b></a>.</p><ul><li>First</li><li>Second</li></ul><h2>Repeated</h2><p hidden>Hidden</p></article>'); return; }
    if (req.url === '/long-document') { res.end(`<article>${Array.from({length:120},(_,i)=>`<p>Paragraph ${i} ${'long text '.repeat(12)}</p>`).join('')}</article>`); return; }
    if (req.url === '/large') { res.end(`<section id="early">${Array.from({ length: 100 }, (_, i) => `<button>Early ${i}</button>`).join('')}</section><section id="last"><button onclick="fetch('/write/last')">Last target</button></section>`); return; }
    res.end(`<title>Exact queries</title>
      <iframe src="/frame"></iframe>
      <button data-testid="save-a" onclick="fetch('/write/a')">Save</button>
      <button data-testid="save-b" onclick="fetch('/write/b')">Save</button>
      <button onclick="fetch('/write/long')">Save later</button>
      <label for="email">Email address</label><input id="email" required readonly value="alex@example.test" onfocus="fetch('/focus')">
      <label for="secret">Secret</label><input id="secret" type="password" value="DO_NOT_RETURN_THIS_VALUE">
      <button data-testid="replace" onclick="document.querySelector('[data-testid=save-a]').outerHTML='<button data-testid=save-a>Save</button>'">Replace</button>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-find-'));
  const facade = mode === 'sdk' ? (await createStandaloneFacade({ backend: 'upstream', workspaceRoot })).facade : undefined;
  const client = new Client({ name: 'find-test', version: '1' });
  if (!facade) await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: workspaceRoot,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core', VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.observe,browser.act,browser.close' } as Record<string, string>, stderr: 'pipe' }));
  const sessions: string[] = [];
  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    if (!facade) {
      const response = await client.callTool({ name, arguments: args });
      return JSON.parse((response.content as { text: string }[])[0].text);
    }
    if (name === 'vb_open') return facade.open({ url });
    if (name === 'vb_find') return facade.findElement(args as AgentBrowserFindPayload);
    if (name === 'vb_forms') return facade.readForms(String(args.sessionId),args.selector as string | undefined);
    if (name === 'vb_type') return facade.type(String(args.sessionId), String(args.selector), String(args.text));
    if (name === 'vb_page_text') return facade.extractPageText({ sessionId: String(args.sessionId), selector: args.selector as string | undefined, structured: args.format === 'structured', metadata: args.metadata as boolean | undefined, maxLength: args.maxChars as number | undefined, rows: args.rows as import('../src/types/host-api.ts').AgentBrowserExtractPageTextPayload['rows'] });
    if (name === 'vb_snapshot') return facade.snapshot(String(args.sessionId), { selector: args.selector as string | undefined, includeText: args.includeText as boolean | undefined, diff: args.diff as boolean | undefined, paged: args.paged as boolean | undefined, cursor: args.cursor as string | undefined });
    if (name === 'vb_click') return facade.click(String(args.sessionId), String(args.selector), args.timeoutMs as number | undefined);
    if (name === 'vb_nav') return facade.nav(String(args.sessionId), String(args.url));
    if (name === 'vb_close') return facade.close(String(args.sessionId));
    throw new Error(name);
  };
  const find = async (sessionId: string, query: Record<string, unknown>) => {
    const result = await call('vb_find', { sessionId, ...query });
    expect(result.ok, result.content).toBe(true);
    return result.data as AgentBrowserFindResult;
  };
  const selector = (result: AgentBrowserFindResult) => `[data-vb-ref="${result.item!.ref}"]`;
  try {
    if (!facade) expect((await client.listTools()).tools.some(tool => tool.name === 'vb_find')).toBe(true);
    for (let i = 0; i < 2; i++) {
      const opened = await call('vb_open', { url }); expect(opened.ok, opened.content).toBe(true);
      sessions.push((opened.data as { session: { id: string } }).session.id);
    }
    const id = sessions[0];
    expect(await find(id, { role: 'button', name: 'Sav' })).toMatchObject({ match: 'none', count: 0 });
    const ambiguous = await find(id, { role: 'button', name: 'Save' });
    expect(ambiguous).toMatchObject({ match: 'ambiguous', count: 2 });
    expect(ambiguous.item).toBeUndefined();
    const email = await find(id, { label: 'Email address' });
    expect(email).toMatchObject({ match: 'unique', count: 1, item: { role: 'textbox' }, scope: { sessionId: id, frameId: 'main' } });
    expect(email.details).toMatchObject({tag:'input',required:true,readOnly:true,disabled:false,value:'alex@example.test',sourceUrl:`${url}/`,trust:'untrusted'});
    expect(await find(id, { role: 'textbox', label: 'Email address' })).toMatchObject({ match: 'unique', count: 1 });
    expect(await find(id, { testId: 'save-a', name: 'Save', role: 'button' })).toMatchObject({ match: 'unique', count: 1 });
    const secret = await call('vb_find', { sessionId: id, label: 'Secret' });
    expect(JSON.stringify(secret)).not.toContain('DO_NOT_RETURN_THIS_VALUE');
    if (secret.ok) expect((secret.data as AgentBrowserFindResult).details?.valueRedacted).toBe(true);
    expect(writes).toEqual([]); expect(focus).toEqual([]);
    expect((await call('vb_find', { sessionId: id, name: 'Save' })).ok).toBe(false);
    expect((await call('vb_find', { sessionId: id, testId: 'save-a', timeoutMs: -1 })).ok).toBe(false);
    const target = await find(id, { testId: 'save-a' });
    const other = await find(sessions[1], { testId: 'save-a' });
    expect(other.scope.pageId).not.toBe(target.scope.pageId);
    const cross = await call('vb_click', { sessionId: sessions[1], selector: selector(target), timeoutMs: 500 });
    expect(cross.ok).toBe(false); expect(cross.content).toContain('E_STALE_REF');
    const clicked = await call('vb_click', { sessionId: id, selector: selector(target) });
    expect(clicked.ok, clicked.content).toBe(true);
    await expect.poll(() => writes).toEqual(['/write/a']);
    const before = await find(id, { testId: 'save-a' });
    const fresh = await find(id, { testId: 'save-a' });
    expect(before.scope.observationId).not.toBe(fresh.scope.observationId);
    expect((await call('vb_click', { sessionId: id, selector: selector(before), timeoutMs: 500 })).ok).toBe(false);
    const preNav = await find(id, { testId: 'save-a' });
    expect((await call('vb_nav', { sessionId: id, url: `${url}/next` })).ok).toBe(true);
    expect((await call('vb_click', { sessionId: id, selector: selector(preNav), timeoutMs: 500 })).ok).toBe(false);
    expect(writes).toEqual(['/write/a']);
    expect((await call('vb_nav', { sessionId: id, url: `${url}/large` })).ok).toBe(true);
    const sourced = await call('vb_page_text', { sessionId: id, selector: '#last' });
    expect(sourced.ok, sourced.content).toBe(true);
    expect(sourced.data).toMatchObject({ source: { url: `${url}/large`, selector: '#last', trust: 'untrusted' } });
    expect((await call('vb_nav', { sessionId: id, url: `${url}/large?token=SOURCE_SECRET_123` })).ok).toBe(true);
    const secretSource = await call('vb_page_text', { sessionId: id });
    expect(secretSource.ok).toBe(true);
    expect(JSON.stringify(secretSource)).not.toContain('SOURCE_SECRET_123');
    expect((await call('vb_nav', { sessionId: id, url: `${url}/large` })).ok).toBe(true);
    expect((await call('vb_snapshot', { sessionId: id })).ok).toBe(false);
    const pages: string[] = [];
    let cursor: string | undefined;
    let observation: string | undefined;
    do {
      const part = await call('vb_snapshot', { sessionId: id, ...(cursor ? { cursor } : { paged: true }) });
      expect(part.ok, part.content).toBe(true);
      const info = (part.data as { page: { observationId: string; nextCursor?: string; total: number } }).page;
      expect(info.total).toBeGreaterThanOrEqual(101);
      if (observation) expect(info.observationId).toBe(observation);
      observation = info.observationId;
      pages.push(part.content);
      if (cursor) expect((await call('vb_snapshot', { sessionId: id, cursor })).ok).toBe(false);
      cursor = info.nextCursor;
    } while (cursor);
    expect(pages.length).toBe(6);
    expect(pages.join('\n')).toContain('Last target');
    for (let i = 0; i < 100; i++) expect(pages.join('\n').split(`"Early ${i}"`).length - 1).toBe(1);
    const initialPage = await call('vb_snapshot', { sessionId: id, paged: true });
    const invalidated = (initialPage.data as {page:{nextCursor:string}}).page.nextCursor;
    expect((await call('vb_snapshot', { sessionId: sessions[1], cursor: invalidated })).ok).toBe(false);
    const region = await call('vb_snapshot', { sessionId: id, selector: '#last' });
    expect(region.ok, region.content).toBe(true);
    const lastRef = /\[([^\]]+)\] button \| "Last target"/.exec(region.content)?.[1];
    expect(lastRef).toBeTruthy();
    expect((await call('vb_click', { sessionId: id, selector: `[data-vb-ref="${lastRef}"]` })).ok).toBe(true);
    expect((await call('vb_snapshot', { sessionId: id, cursor: invalidated })).ok).toBe(false);
    await expect.poll(() => writes).toEqual(['/write/a', '/write/last']);
    expect((await call('vb_snapshot', { sessionId: id, selector: 'section' })).ok).toBe(false);
    expect((await call('vb_snapshot', { sessionId: id, selector: '#last', includeText: true })).error?.code).toBe('E_ARG');
    expect((await call('vb_snapshot', { sessionId: id, selector: '#last', diff: true })).error?.code).toBe('E_ARG');
    const last = await find(id, { role: 'button', name: 'Last target' });
    expect(last.match).toBe('unique');
    expect((await call('vb_click', { sessionId: id, selector: selector(last) })).ok).toBe(true);
    await expect.poll(() => writes).toEqual(['/write/a', '/write/last', '/write/last']);
    expect((await call('vb_nav', { sessionId: id, url: `${url}/document` })).ok).toBe(true);
    const document = await call('vb_page_text', { sessionId: id, selector: 'article', format: 'structured' });
    expect(document.ok, document.content).toBe(true);
    const blocks = JSON.parse((document.data as {text:string}).text);
    expect(blocks).toEqual([
      {type:'heading',level:2,text:'Repeated'},
      {type:'paragraph',text:'Read this guide.',links:[{text:'this guide',href:`${url}/guide`}]},
      {type:'list-item',text:'First',listType:'unordered',listLevel:1}, {type:'list-item',text:'Second',listType:'unordered',listLevel:1}, {type:'heading',level:2,text:'Repeated'},
    ]);
    const limited = await call('vb_page_text', { sessionId: id, selector: 'article', format: 'structured', maxChars: 60 });
    expect(limited.ok, limited.content).toBe(true);
    expect(limited.data).toMatchObject({truncated:true});
    expect(JSON.parse((limited.data as {text:string}).text)).toHaveLength(1);
    expect((await call('vb_nav', { sessionId: id, url: `${url}/long-document` })).ok).toBe(true);
    const long = await call('vb_page_text', { sessionId: id, format: 'structured', maxChars: 20000 });
    expect(long.ok, long.content).toBe(true);
    expect(long.data).toHaveProperty('text');
    expect(() => JSON.parse((long.data as {text:string}).text)).not.toThrow();
    expect((long.data as {truncated:boolean}).truncated).toBe(true);
    expect((await call('vb_nav', { sessionId: id, url: `${url}/nested` })).ok).toBe(true);
    const nested = await call('vb_page_text', { sessionId: id, format: 'structured' });
    expect(nested.ok, nested.content).toBe(true);
    expect(JSON.parse((nested.data as {text:string}).text)).toEqual([
      {type:'list-item',text:'Parent',listType:'ordered',listLevel:1},
      {type:'list-item',text:'Child link',listType:'unordered',listLevel:2,links:[{text:'link',href:`${url}/child`}]},
    ]);
    expect((await call('vb_nav', { sessionId: id, url: `${url}/roles` })).ok).toBe(true);
    const roleSnapshot = await call('vb_snapshot', { sessionId: id });
    expect(roleSnapshot.ok, roleSnapshot.content).toBe(true);
    expect(roleSnapshot.content).not.toContain('Hidden decoy');
    expect(roleSnapshot.content.length).toBeLessThan(6000);
    for (const role of ['tab','menuitem','option','treeitem','row']) {
      expect(roleSnapshot.content).toContain(`Target ${role}`);
      const result = await find(id, { role, name: `Target ${role}` });
      expect(result.match).toBe('unique');
      expect(result.item?.role).toBe(role);
      expect((await call('vb_click', { sessionId: id, selector: selector(result) })).ok).toBe(true);
      await expect.poll(() => writes.at(-1)).toBe(`/write/${role}`);
    }
    expect((await call('vb_nav', { sessionId: id, url: `${url}/discovery` })).ok).toBe(true);
    const discovery = await call('vb_snapshot', { sessionId: id });
    expect(discovery.ok, discovery.content).toBe(true);
    const lines = discovery.content.split('\n').filter(line => /^- \[/.test(line));
    console.log(JSON.stringify({ mode, discoveryChars: discovery.content.length, targets: lines.length, pointerFound: lines.some(line=>line.includes('Pointer target')), decoyFound: lines.some(line=>line.includes('Decorative decoy')) }));
    expect(lines.some(line=>line.includes('Pointer target'))).toBe(true);
    expect(lines.some(line=>line.includes('Decorative decoy'))).toBe(false);
    const pointerRef = /\[([^\]]+)\].*"Pointer target"/.exec(discovery.content)?.[1];
    expect(pointerRef).toBeTruthy();
    expect((await call('vb_click', { sessionId: id, selector: `[data-vb-ref="${pointerRef}"]` })).ok).toBe(true);
    await expect.poll(() => writes.at(-1)).toBe('/write/pointer');
    expect((await call('vb_nav', { sessionId: id, url: `${url}/table` })).ok).toBe(true);
    const mapping = {selector:'tr',fields:{id:{selector:'.id'},amount:{selector:'.amount'}}};
    const extracted = await call('vb_page_text', {sessionId:id,rows:mapping});
    expect(extracted.ok,extracted.content).toBe(true);
    expect(extracted.data).toMatchObject({source:{observation:{sessionId:id,frameId:'main'}}});
    expect(JSON.parse((extracted.data as {text:string}).text)).toEqual([
      {id:{status:'present',value:'r02'},amount:{status:'present',value:'20'}},
      {id:{status:'present',value:'r04'},amount:{status:'present',value:''}},
      {id:{status:'present',value:'r06'},amount:{status:'missing'}},
    ]);
    expect((await call('vb_page_text',{sessionId:id,rows:{...mapping,selector:'['}})).ok).toBe(false);
    expect((await call('vb_page_text',{sessionId:id,rows:mapping,format:'structured'})).ok).toBe(false);
    const emptyRows = await call('vb_page_text',{sessionId:id,rows:{...mapping,selector:'.no-rows'}});
    expect(emptyRows.data).toMatchObject({match:'empty',count:0,text:'[]'});
    const unmatchedFields = await call('vb_page_text',{sessionId:id,rows:{selector:'tr',fields:{absent:{selector:'.absent'}}}});
    expect(unmatchedFields.data).toMatchObject({match:'fields-unmatched',count:3});
    const outsideFields = await call('vb_page_text',{sessionId:id,rows:{selector:'tr',fields:{outside:{selector:'body > table'}}}});
    expect(outsideFields.data).toMatchObject({match:'fields-unmatched'});
    const firstObservation = (extracted.data as {source:{observation:{observationId:string}}}).source.observation.observationId;
    expect((outsideFields.data as {source:{observation:{observationId:string}}}).source.observation.observationId).not.toBe(firstObservation);
    expect((await call('vb_nav',{sessionId:id,url:`${url}/metadata`})).ok).toBe(true);
    const metadata = await call('vb_page_text',{sessionId:id,metadata:true});
    expect(metadata.ok,metadata.content).toBe(true);
    expect(JSON.parse((metadata.data as {text:string}).text)[0]).toMatchObject({
      kind:'page-declared-metadata',title:{status:'present',value:'Toolbox Read'},description:{status:'present',value:'Read fixture'},
      language:{status:'present',value:'en'},canonical:{status:'present',value:`${url}/canonical`},
      links:[{text:'Details',href:`${url}/a`},{text:'Details',href:`${url}/b?q=2`}],
      jsonLd:[{status:'parsed',value:{name:'Declared object'}}],
    });
    expect(metadata.data).toMatchObject({source:{url:`${url}/metadata`}});
    expect((await call('vb_nav',{sessionId:id,url:`${url}/metadata-negative`})).ok).toBe(true);
    const negativeMetadata = await call('vb_page_text',{sessionId:id,metadata:true});
    expect(negativeMetadata.ok,negativeMetadata.content).toBe(true);
    const negativeRecord = JSON.parse((negativeMetadata.data as {text:string}).text)[0];
    expect(negativeRecord.description).toEqual({status:'missing'});
    expect(negativeRecord.jsonLd).toEqual([{status:'invalid'}]);
    expect(negativeRecord.canonical.value).toContain('https://unvisited.example.test/');
    expect(negativeMetadata.data).toMatchObject({source:{url:`${url}/metadata-negative`}});
    expect(JSON.stringify(negativeMetadata)).not.toContain('CANONICAL_SECRET');
    expect(JSON.stringify(negativeMetadata)).not.toContain('LINK_SECRET');
    expect((await call('vb_page_text',{sessionId:id,metadata:true,selector:'body'})).ok).toBe(false);
    expect((await call('vb_nav',{sessionId:id,url:`${url}/form-errors`})).ok).toBe(true);
    const invalidEmail = await find(id,{label:'Work email'});
    expect(invalidEmail.details).toMatchObject({form:{id:'form-a'},name:'email',type:'email',required:true,validity:{valid:false,typeMismatch:true},validitySource:'browser-native',serverValidation:'unknown',errors:[{id:'email-error',text:'Email invalid',source:'aria-errormessage'}]});
    // C96/TF-0123: the docs promise `bounded details`, but `name`/`type`/`form.name` had no cap -
    // a 6,000-char name came back whole and pushed the whole `data` out of the envelope.
    expect(String(invalidEmail.details?.name).length).toBeLessThanOrEqual(200);
    expect(String(invalidEmail.details?.type).length).toBeLessThanOrEqual(200);

    expect(invalidEmail.details).toMatchObject({ariaInvalid:'true',descriptions:[{id:'help',text:'Use your work address',source:'aria-describedby'},{id:'email-error',text:'Email invalid',source:'aria-describedby'}]});
    expect(JSON.stringify(invalidEmail.details)).not.toContain('Unassociated error');
    expect(focus).toEqual([]);
    const overview = await call('vb_forms',{sessionId:id});
    expect(overview.ok,overview.content).toBe(true);
    expect((overview.data as {fields:Array<{form:{id:string};ref:string}>}).fields.map(field=>field.form.id)).toEqual(['form-a','form-b']);
    expect((overview.data as {fields:Array<{ref:string}>}).fields.every(field=>field.ref)).toBe(true);
    expect(focus).toEqual([]);
    expect((await call('vb_type',{sessionId:id,selector:'#email-a',text:'alex@example.test'})).ok).toBe(true);
    const correctedEmail = await find(id,{label:'Work email'});
    expect(correctedEmail.details).toMatchObject({validity:{valid:true,typeMismatch:false},errors:[{text:''}],serverValidation:'unknown'});
    expect(correctedEmail.details).toMatchObject({ariaInvalid:null,descriptions:[{text:'Use your work address'},{text:''}]});
    expect((await call('vb_nav',{sessionId:id,url:`${url}/form-options`})).ok).toBe(true);
    const optionsOverview = await call('vb_forms',{sessionId:id});
    expect(optionsOverview.ok,optionsOverview.content).toBe(true);
    const optionFields = (optionsOverview.data as {fields:Array<Record<string,unknown>>}).fields;
    expect(optionFields.find(field=>field.name==='plan')).toMatchObject({form:{id:'owner',documentIndex:0},options:[{value:'free',label:'Free',selected:false},{value:'pro',label:'Pro',selected:true}]});
    expect(optionFields.find(field=>field.name==='outside')).toMatchObject({form:{id:'owner',documentIndex:0}});
    expect(optionFields.find(field=>field.name==='anonymous')).toMatchObject({form:{id:null,documentIndex:1}});
    expect(optionFields.find(field=>field.name==='inherited-disabled')).toMatchObject({disabled:true});
    expect(JSON.stringify(optionsOverview)).not.toContain('OPTION_SECRET');
  } finally {
    for (const sessionId of sessions) expect((await call('vb_close', { sessionId })).ok).toBe(true);
    if (facade) expect((await facade.dispose()).ok).toBe(true);
    await client.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  }
}, 40_000);

it('does not advertise exact upstream queries on the legacy driver', async () => {
  expect(profileFromHostApi(await createPlaywrightHostApi()).methods?.has('findElement')).toBe(false);
  const { facade } = await createStandaloneFacade({ preferPlaywright: true, workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-find-legacy-')) });
  try { expect(facade.getDriverProfile().methods?.has('findElement')).toBe(false); }
  finally { expect((await facade.dispose()).ok).toBe(true); }
});
