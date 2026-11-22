import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKitesurfHostApi, openKitesurfSession } from '../src/engine/kitesurf-session.ts';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { loadSessionRecord } from '../src/engine/persistent-sessions.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import { cdpVersionUrl } from '../src/engine/kitesurf-cdp.ts';

const endpoint = process.env.KITESURF_CDP_ENDPOINT;
const describeLive = endpoint ? describe : describe.skip;
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureRoot = join(repository, 'harness/specs/fixtures/kitesurf-loopback-cdp');
const base = new URL('/__fixtures/', cdpVersionUrl(endpoint ?? 'ws://127.0.0.1:8787/devtools/browser')).href;
const checks: Array<{ name: string; ok: true; durationMs: number }> = [];
const calls: Array<{ method: string; outcome: 'fulfilled' | 'rejected' }> = [];
let root = '', id = '', workerPid = 0, failed = false;
let registered = 0, passed = 0;
function run(name: string, assertion: () => Promise<void>, timeout: number) {
  registered++;
  return it(name, assertion, timeout);
}
let api: AgentBrowserHostApi;

async function check(name: string, assertion: () => Promise<void>) {
  const started = Date.now();
  await assertion();
  checks.push({ name, ok: true, durationMs: Date.now() - started });
}
async function evaluate(expression: string) {
  return (await api.evaluate({ sessionId: id, expression })).value;
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describeLive('real Kitesurf CDP acceptance', () => {
  beforeEach(async () => {
    root = await mkdtemp(join('D:/tmp', 'kitesurf-live-'));
    id = ''; workerPid = 0;
    const opened = await openKitesurfSession({ browser: 'kitesurf', connectionMode: 'cdp', cdpEndpoint: endpoint!, url: base + 'accessibility.html' }, root);
    id = opened.session.id;
    expect(opened.session.title).toBe('a11y');
    const record = await loadSessionRecord(id, root);
    expect(record?.engine).toBe('kitesurf');
    workerPid = record!.pid;
    const host = createKitesurfHostApi(id, root);
    api = new Proxy(host, {
      get(target, property, receiver) {
        const method = Reflect.get(target, property, receiver);
        if (typeof method !== 'function') return method;
        return async (...args: unknown[]) => {
          try {
            const value = await method(...args);
            calls.push({ method: String(property), outcome: 'fulfilled' });
            return value;
          } catch (error) {
            calls.push({ method: String(property), outcome: 'rejected' });
            throw error;
          }
        };
      },
    });
  }, 40_000);

  afterEach(async ({ task }) => {
    if (task.result?.state === 'pass') passed++; else failed = true;
    try {
      if (id && existsSync(join(root, '.ae/sessions', id, 'session.json'))) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          expect(await Promise.race([api.close({ sessionId: id }), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Kitesurf close exceeded the 5s acceptance deadline')), 5_000);
          })])).toMatchObject({ success: true });
        } finally { clearTimeout(timer); }
      }
      if (workerPid) {
        await expect.poll(() => alive(workerPid)).toBe(false);
        expect(existsSync(join(root, '.ae/sessions', id))).toBe(false);
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (workerPid && alive(workerPid)) { failed = true; process.kill(workerPid); }
      if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 20_000);

  run('observes actual input, selection, pointer and drag effects', async () => {
    const markup = '<select id="choice"><option value="free">Free</option><option value="pro">Pro</option></select>' +
      '<button id="acceptance-button" type="button">Acceptance button</button>' +
      '<div id="acceptance-scroll" style="height:100px;width:300px;overflow:auto"><div style="height:1500px">Scrollable content</div></div>' +
      '<div style="display:flex"><div id="drag-source" style="width:100px;height:50px;background:blue">Source</div><div id="drag-target" style="width:100px;height:50px;background:red">Target</div></div>';
    await evaluate('document.body.insertAdjacentHTML("beforeend",' + JSON.stringify(markup) + ');' +
      'globalThis.__gesture={key:0,click:0,hover:0,double:0,context:0,down:"",up:""};' +
      'document.querySelector("#email").onkeydown=function(){__gesture.key++};' +
      'document.querySelector("#acceptance-button").onclick=function(){__gesture.click++};' +
      'document.querySelector("#acceptance-button").onmousemove=function(){__gesture.hover++};' +
      'document.querySelector("#acceptance-button").ondblclick=function(){__gesture.double++};' +
      'document.querySelector("#acceptance-button").oncontextmenu=function(event){event.preventDefault();__gesture.context++};' +
      'document.querySelector("#drag-source").onmousedown=function(){__gesture.down="source"};' +
      'document.querySelector("#drag-target").onmouseup=function(){__gesture.up="target"}');
    await check('input-and-key-effects', async () => {
      expect(await api.waitForSelector({ sessionId: id, selector: '#email' })).toMatchObject({ success: true });
      await api.type({ sessionId: id, selector: '#email', text: 'agent@example.com' });
      await api.appendText!({ sessionId: id, selector: '#email', text: '-suffix' });
      expect(await evaluate('document.querySelector("#email").value')).toBe('agent@example.com-suffix');
      await api.pressKey({ sessionId: id, selector: '#email', key: 'Tab' });
      expect(await evaluate('__gesture.key')).toBeGreaterThan(0);
    });
    await check('checkbox-and-select-effects', async () => {
      await api.setChecked!({ sessionId: id, selector: 'input[name=tos]', checked: true });
      expect(await evaluate('document.querySelector("input[name=tos]").checked')).toBe(true);
      await api.selectValues!({ sessionId: id, selector: '#choice', values: ['pro'] });
      expect(await evaluate('document.querySelector("#choice").value')).toBe('pro');
      await api.selectOption!({ sessionId: id, selector: '#choice', label: 'Free' });
      expect(await evaluate('document.querySelector("#choice").value')).toBe('free');
    });
    await check('pointer-and-click-effects', async () => {
      await api.pointer!({ sessionId: id, action: 'hover', selector: '#acceptance-button' });
      expect(await evaluate('__gesture.hover')).toBeGreaterThan(0);
      await api.click({ sessionId: id, selector: '#acceptance-button' });
      expect(await evaluate('__gesture.click')).toBe(1);
      await api.pointer!({ sessionId: id, action: 'double-click', selector: '#acceptance-button' });
      expect(await evaluate('__gesture.double')).toBe(1);
      await api.pointer!({ sessionId: id, action: 'right-click', selector: '#acceptance-button' });
      expect(await evaluate('__gesture.context')).toBe(1);
      await api.pointer!({ sessionId: id, action: 'scroll', selector: '#acceptance-scroll', deltaY: 120 });
      await expect.poll(() => evaluate('document.querySelector("#acceptance-scroll").scrollTop')).toBeGreaterThan(0);
    });
    await check('drag-gesture-effects', async () => {
      await api.drag!({ sessionId: id, sourceSelector: '#drag-source', targetSelector: '#drag-target' });
      expect(await evaluate('JSON.stringify({down:__gesture.down,up:__gesture.up})')).toBe('{"down":"source","up":"target"}');
    });
  }, 60_000);

  run('returns accurate form state and refs that act on the exact node', async () => {
    await evaluate('document.querySelector("#email").value="forms@example.com";document.querySelector("#pw").value="KITESURF_FORM_SENTINEL";document.querySelector("input[name=tos]").checked=true');
    await check('form-values-validation-and-redaction', async () => {
      const forms = await api.readForms!({ sessionId: id });
      expect(forms.fields).toContainEqual(expect.objectContaining({ type: 'email', value: 'forms@example.com', required: true, validity: expect.objectContaining({ valid: true }) }));
      expect(forms.fields).toContainEqual(expect.objectContaining({ name: 'tos', checked: true }));
      expect(forms.fields).toContainEqual(expect.objectContaining({ name: 'vol', value: '5', constraints: { min: '0', max: '10' } }));
      expect(forms.fields).toContainEqual(expect.objectContaining({ tag: 'button', disabled: true }));
      expect(JSON.stringify(forms)).not.toContain('KITESURF_FORM_SENTINEL');
      expect(forms.fields).toContainEqual(expect.objectContaining({ type: 'password', valueRedacted: true }));
    });
    await check('label-ref-acts-on-exact-input', async () => {
      const found = await api.findElement!({ sessionId: id, label: 'Email address' });
      expect(found).toMatchObject({ match: 'unique', item: { role: 'textbox', name: 'Email address' } });
      await api.type({ sessionId: id, selector: '[data-vb-ref="' + found.item!.ref + '"]', text: 'precise@example.com' });
      expect(await evaluate('document.querySelector("#email").value')).toBe('precise@example.com');
    });
    await evaluate('document.body.insertAdjacentHTML("beforeend",\'<button data-testid="save-a" onclick="globalThis.__saved=1">Save</button><button data-testid="save-b" onclick="globalThis.__saved=2">Save</button>\');globalThis.__saved=0');
    await check('test-id-ref-duplicate-and-stale-guards', async () => {
      expect(await api.findElement!({ sessionId: id, role: 'button', name: 'Save' })).toMatchObject({ match: 'ambiguous', count: 2 });
      const old = await api.findElement!({ sessionId: id, testId: 'save-a' });
      const chosen = await api.findElement!({ sessionId: id, testId: 'save-b' });
      await expect(api.click({ sessionId: id, selector: '[data-vb-ref="' + old.item!.ref + '"]' })).rejects.toThrow(/E_STALE_REF/);
      expect(await evaluate('__saved')).toBe(0);
      await api.click({ sessionId: id, selector: '[data-vb-ref="' + chosen.item!.ref + '"]' });
      expect(await evaluate('__saved')).toBe(2);
      expect(await api.findElement!({ sessionId: id, testId: 'missing-target' })).toMatchObject({ match: 'none', count: 0 });
    });
    await check('fresh-facade-native-routing', async () => {
      const { facade } = await createStandaloneFacade({ workspaceRoot: root, persistentSessions: true });
      expect(await facade.readForms(id, 'fieldset')).toMatchObject({ ok: true });
      expect(await facade.findElement({ sessionId: id, label: 'Email address' })).toMatchObject({ ok: true, data: { item: { role: 'textbox' } } });
      expect(await facade.listPages(id)).toMatchObject({ ok: true, data: { pages: expect.any(Array) } });
      expect(await facade.snapshot(id, { selector: 'form' })).toMatchObject({ ok: true });
      await facade.dispose();
      expect((await api.status()).sessions?.some(session => session.id === id)).toBe(true);
    });
  }, 60_000);

  run('reads actual console, runtime, network headers and response bodies', async () => {
    await check('script-and-console-observation', async () => {
      expect(await evaluate('1+1')).toBe(2);
      await evaluate('window.__KITESURF_ACCEPTANCE__={region:"acceptance",apiKey:"KITESURF_RUNTIME_SENTINEL"};console.info("kitesurf-acceptance-console")');
      expect((await api.getConsoleMessages({ sessionId: id })).content).toContain('kitesurf-acceptance-console');
    });
    await check('runtime-readonly-unavailable-before-page-read', async () => {
      await expect(api.runtimeInspectGlobals({ sessionId: id, paths: ['__KITESURF_ACCEPTANCE__'], maxDepth: 2, limit: 20 })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
      expect(await evaluate('window.__KITESURF_ACCEPTANCE__.region')).toBe('acceptance');
    });
    await check('network-details-body-and-redaction', async () => {
      const baseline = await api.networkListRequests({ sessionId: id });
      const body = await evaluate('fetch("/__fixtures/xhr-data.txt?token=KITESURF_NETWORK_SENTINEL",{headers:{authorization:"Bearer KITESURF_NETWORK_SENTINEL"}}).then(response=>response.text())');
      expect(String(body)).toContain('kitesurf-xhr-ok');
      const waited = await api.networkWaitForRequests({ sessionId: id, sinceCursor: baseline.cursor, responseComplete: true, filter: { urlIncludes: '/xhr-data.txt' }, timeoutMs: 5000 });
      expect(waited.success).toBe(true);
      expect(waited.requests!.length).toBeGreaterThan(0);
      const listed = await api.networkListRequests({ sessionId: id });
      const request = listed.requests!.find(request => request.url.includes('/xhr-data.txt'))!;
      expect(request).toBeDefined();
      const details = await api.networkGetRequestDetails({ sessionId: id, requestIds: [request.id] });
      expect(details.details).toContainEqual(expect.objectContaining({ status: 200, responseBody: expect.stringContaining('kitesurf-xhr-ok'), requestHeaders: expect.any(Object), responseHeaders: expect.any(Object) }));
      expect(JSON.stringify({ listed, details, waited })).not.toContain('KITESURF_NETWORK_SENTINEL');
    });
  }, 40_000);

  run('selects real pages, closes the active page and reads its same-origin frame', async () => {
    let first = '', second = '';
    await check('multi-page-create-select-close-and-continue', async () => {
      const initial = await api.listPages!({ sessionId: id });
      first = initial.activePageId!;
      const created = await api.newPage({ sessionId: id, url: base + 'xhr-boot.html', background: true });
      second = created.createdPageId!;
      expect(created.activePageId).toBe(first);
      expect((await api.listPages!({ sessionId: id })).pages).toHaveLength(2);
      await api.selectPage!({ sessionId: id, pageId: second });
      expect(await evaluate('location.href')).toBe(base + 'xhr-boot.html');
      await api.selectPage!({ sessionId: id, pageId: first });
      expect(await evaluate('document.title')).toBe('a11y');
      await api.selectPage!({ sessionId: id, pageId: second });
      const closed = await api.closePage!({ sessionId: id });
      expect(closed.activePageId).toBe(first);
      expect(closed.pages).toHaveLength(1);
      expect((await api.navigate({ sessionId: id, url: base + 'iframe-host.html' })).session.url).toBe(base + 'iframe-host.html');
    });
    await check('same-origin-frame-and-foreign-scope-rejection', async () => {
      const pages = await api.listPages!({ sessionId: id });
      const frame = pages.pages[0]!.frames!.find(frame => frame.name === 'child-a')!;
      expect(frame).toBeDefined();
      expect((await api.extractPageText({ sessionId: id, rules: [], frameId: frame.frameId })).text).toContain('Child heading child body text one two');
      await expect(api.extractPageText({ sessionId: id, rules: [], frameId: 'f999' })).rejects.toThrow(/E_PAGE_TEXT: unknown frame f999/);
      await expect(api.selectPage!({ sessionId: id, pageId: second })).rejects.toThrow(/E_PAGE/);
      expect(await evaluate('document.title')).toBe('kitesurf iframe host fixture');
    });
    await check('unnamed-frame-identity', async () => {
      await evaluate('document.body.insertAdjacentHTML("beforeend",\'<iframe src="/__fixtures/iframe-child.html"></iframe><iframe src="/__fixtures/accessibility.html"></iframe>\')');
      await expect.poll(() => evaluate('document.querySelectorAll("iframe")[3].contentDocument?.body?.textContent?.includes("Site Title") ?? false')).toBe(true);
      const pages = await api.listPages!({ sessionId: id });
      const secondFrame = pages.pages[0]!.frames!.find(frame => frame.url.endsWith('/accessibility.html'))!;
      expect(secondFrame.name).toBe('');
      expect((await api.extractPageText({ sessionId: id, rules: [], frameId: secondFrame.frameId })).text).toContain('Site Title');
    });
  }, 60_000);

  run('exports real snapshots, PNG pixels and PDF bytes', async () => {
    await check('snapshot-text-and-real-exports', async () => {
      expect((await api.takeSnapshot({ sessionId: id })).snapshot).toContain('Email address');
      expect((await api.extractPageText({ sessionId: id, rules: [] })).text).toContain('Site Title');
      const shot = await api.screenshot({ sessionId: id });
      const png = Buffer.from(shot.dataUrl.split(',')[1]!, 'base64');
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBeGreaterThan(0);
      expect(png.readUInt32BE(20)).toBeGreaterThan(0);
      const pdf = await api.pdf!({ sessionId: id, printBackground: true });
      const bytes = Buffer.from(pdf.dataUrl.split(',')[1]!, 'base64');
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.toString('latin1')).toContain('%%EOF');
      expect(pdf.bytes).toBe(bytes.length);
      if (process.env.KITESURF_ACCEPTANCE_OUTPUT) {
        const exports = join(process.env.KITESURF_ACCEPTANCE_OUTPUT, 'exports');
        await mkdir(exports, { recursive: true });
        await writeFile(join(exports, 'page.png'), png);
        await writeFile(join(exports, 'page.pdf'), bytes);
      }
    });
  }, 40_000);

  run('loads a public page and keeps private network access blocked', async () => {
    await check('public-egress-and-private-network-policy', async () => {
      let hits = 0;
      const server = createServer((_request, response) => { hits++; response.end('private fixture'); });
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
      const target = `http://127.0.0.1:${(server.address() as { port: number }).port}/private`;
      try {
        expect(await (await fetch(target)).text()).toBe('private fixture');
        expect(hits).toBe(1);
        hits = 0;
        await api.navigate({ sessionId: id, url: 'https://example.com/' });
        expect((await api.extractPageText({ sessionId: id, rules: [] })).text).toContain('documentation examples');
        expect((await api.networkListRequests({ sessionId: id })).requests).toContainEqual(expect.objectContaining({
          url: 'https://example.com/', status: 200, failed: false,
        }));
        expect(await evaluate(`fetch(${JSON.stringify(target)}).then(() => "unexpected success").catch(error => String(error))`))
          .toMatch(/a public document may not reach the loopback address/);
        expect(hits).toBe(0);
      } finally {
        server.closeAllConnections();
        await new Promise<void>(done => server.close(() => done()));
      }
    });
  }, 40_000);

  run('enforces control authentication, session ownership and file/AI boundaries', async () => {
    const lease = JSON.parse(await readFile(join(root, '.ae/sessions', id, 'kitesurf-control.json'), 'utf8'));
    async function request(method: string, sessionId: string, authorization = 'Bearer ' + lease.secret) {
      return fetch(new URL('/call', lease.endpoint), { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ method, payload: { sessionId } }) });
    }
    await check('control-auth-and-session-ownership', async () => {
      expect((await request('status', id, '')).status).toBe(403);
      expect((await request('status', id, 'Bearer wrong')).status).toBe(403);
      const mismatch = await request('status', 'another-session');
      expect(mismatch.status).toBe(400);
      expect((await mismatch.json()).error.code).toBe('E_NO_SESSION');
      expect((await api.status()).success).toBe(true);
    });
    await check('file-ai-and-unknown-method-rejection', async () => {
      await expect(api.uploadFiles!({ sessionId: id, selector: '#email', paths: ['ungranted.txt'] })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
      await expect(api.downloadFile!({ sessionId: id, selector: 'a', path: 'ungranted.txt' })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
      for (const method of ['semanticRead', 'unknownMethod']) {
        const denied = await request(method, id);
        expect(denied.status).toBe(400);
        expect((await denied.json()).error.message).toContain('E_CAPABILITY_UNAVAILABLE');
      }
      const { facade } = await createStandaloneFacade({ workspaceRoot: root, persistentSessions: true });
      expect(await facade.semanticRead({ sessionId: id, action: 'observe', instruction: 'read' })).toMatchObject({ ok: false, error: { code: 'E_SEMANTIC_CONFIG' } });
      await facade.dispose();
      expect(await evaluate('document.title')).toBe('a11y');
    });
  }, 40_000);

  run('reports the upstream JavaScript-dialog limit and refuses unowned dialog ids', async () => {
    await check('dialog-limit-and-identity-guard', async () => {
      expect((await api.readDialogs!({ sessionId: id })).dialogs).toEqual([]);
      await expect(api.evaluate({ sessionId: id, expression: 'confirm("kitesurf-acceptance")' })).rejects.toThrow(/confirm|not implemented|not defined/i);
      await expect(api.respondDialog!({ sessionId: id, dialogId: 'unowned-dialog', accept: true })).rejects.toThrow(/E_DIALOG_ID/);
      expect((await api.readDialogs!({ sessionId: id })).dialogs).toEqual([]);
      expect(await evaluate('document.title')).toBe('a11y');
    });
  }, 40_000);

  run('exits its worker when an action timeout closes the native session internally', async () => {
    await check('action-timeout-closes-worker', async () => {
      await expect(api.pointer!({ sessionId: id, action: 'hover', selector: '#intentionally-missing-timeout-target', timeoutMs: 50 })).rejects.toThrow(/timed out|timeout/i);
      await expect.poll(() => alive(workerPid)).toBe(false);
      expect(existsSync(join(root, '.ae/sessions', id))).toBe(false);
      await expect(api.status()).rejects.toThrow(/E_NO_SESSION/);
    });
  }, 40_000);
});

afterAll(async () => {
  if (!endpoint || failed || passed !== registered) return;
  const receipt = JSON.parse(await readFile(join(fixtureRoot, 'receipt.json'), 'utf8'));
  const sourceFiles = [...new Set([...Object.keys(receipt.sourceHashes), 'scripts/kitesurf-local-runtime.mjs', 'pnpm-workspace.yaml', 'scripts/contract-check.mjs', 'vitest.agent-dev.node.config.ts', 'scripts/typecheck-agent-dev.mjs', 'tests/unit/typecheck-gate.test.ts'])];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [
    file, createHash('sha256').update(await readFile(join(repository, file))).digest('hex'),
  ])));
  const version = await (await fetch(cdpVersionUrl(endpoint), { signal: AbortSignal.timeout(5000) })).json();
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, 'actions.json'), JSON.stringify({
    schema: 'clawx.kitesurf-loopback-cdp-actions/v5', driven_by: 'agent', actor: 'codex',
    liveEngine: true, remoteBrowserRun: false, engine: version.Browser, sourceHashes,
    testSourceHash: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    executedAt: new Date().toISOString(), checks, calls,
    engineLimits: ['Kitesurf confirm() is not implemented; unowned dialog ids are refused.', 'Kitesurf omits global property descriptors; bounded runtime inspection is refused before reading the page.'],
  }, null, 2) + '\n');
});
