import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import type { ToolResult } from '../src/contracts/index.ts';
import type { AgentBrowserActionResult } from '../src/types/host-api.ts';
import { renderToolResultForTool } from '../src/mcp/result-envelope.ts';

it.each(['sdk', 'stdio', 'legacy'] as const)('selects values and appends with truthful field feedback through %s', async mode => {
  const receipts: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/submit') {
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { receipts.push(new URLSearchParams(body)); res.end('saved'); }); return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<form id="main-form" onsubmit="event.preventDefault();if(!email.value.includes('@')){statusText.textContent='invalid';return}fetch('/submit',{method:'POST',body:new URLSearchParams(new FormData(this))}).then(()=>statusText.textContent='saved')">
      <input id="person" name="person" value="First"><input id="email" name="email" value="bad">
      <input id="focus-trap" onfocus="person.focus();person.select()" value="trap"><input id="key-field" name="keyField" value="Alpha">
      <select id="plan" name="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select>
      <select id="tags" name="tags" multiple><option value="blue">Blue</option><option value="green">Green</option><option value="red">Red</option></select>
      <input id="terms" name="terms" type="checkbox"><input id="shade-a" name="shade" type="radio" value="a"><input id="shade-b" name="shade" type="radio" value="b">
      <input id="secret" type="password" value="OLD_FORM_SECRET"><input id="readonly" readonly value="locked"><input id="replace" oninput="this.outerHTML='<input id=replace value=replaced>'">
      <button type="button" id="combo" role="combobox" aria-expanded="false" onclick="choices.hidden=false;this.setAttribute('aria-expanded','true')">Tier</button>
      <div id="choices" role="listbox" hidden><button type="button" role="option" id="premium" onclick="tier.value='premium';choices.hidden=true;combo.setAttribute('aria-expanded','false')">Premium</button></div><input id="tier" name="tier" type="hidden">
      <button id="submit">Submit</button><output id="statusText">pending</output></form>
      <select id="collision" name="collision" form="main-form"><option value="one">two</option><option value="two">Other</option></select>
      <select id="duplicate"><option value="same">One</option><option value="same">Two</option></select>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = await mkdtemp(join(tmpdir(), 'vb-form-values-'));
  const facade = mode === 'stdio' ? undefined : (await createStandaloneFacade({ backend: mode === 'sdk' ? 'upstream' : 'legacy', preferPlaywright: true, workspaceRoot: root })).facade;
  const client = new Client({ name: 'form-values-test', version: '1' });
  if (!facade) await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core', VERSEBROWSER_CAPS: 'browser.open,browser.act,browser.observe,browser.close' } as Record<string, string>, stderr: 'pipe' }));
  let id: string | undefined;
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    if (facade) {
      if (name === 'vb_open') return facade.open({ url });
      if (name === 'vb_type') return facade.type(id!, String(args.selector), String(args.text), { clear: args.clear as boolean });
      if (name === 'vb_press') return facade.pressKey(id!, String(args.key), args.selector as string | undefined);
      if (name === 'vb_append') return facade.appendText(id!, String(args.selector), String(args.text));
      if (name === 'vb_select') return facade.selectOption(id!, String(args.selector), String(args.label));
      if (name === 'vb_select_values') return facade.selectValues(id!, String(args.selector), args.values as string[]);
      if (name === 'vb_check') return facade.setChecked(id!, String(args.selector), args.checked as boolean);
      if (name === 'vb_click') return facade.click(id!, String(args.selector));
      if (name === 'vb_close') return facade.close(id!);
      throw new Error(name);
    }
    const result = await client.callTool({ name, arguments: { ...(id ? { sessionId: id } : {}), ...args } });
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  const change = (result: ToolResult) => {
    expect(result.ok, result.content).toBe(true);
    expect(result.data).toMatchObject({observation:{businessOutcome:'unknown'}});
    return (result.data as { fieldChange: NonNullable<AgentBrowserActionResult['fieldChange']> }).fieldChange;
  };
  try {
    const opened = await call('vb_open', { url }); expect(opened.ok, opened.content).toBe(true); id = (opened.data as { session: { id: string } }).session.id;
    const refusedFocus = await call('vb_press', { selector: '#focus-trap', key: 'Backspace' });
    expect(refusedFocus.ok).toBe(false);
    expect(refusedFocus.content).toContain('E_FOCUS_CHANGED');
    const refusedAppend = await call('vb_append', { selector: '#focus-trap', text: 'forbidden' });
    expect(refusedAppend.ok).toBe(false);
    expect(refusedAppend.content).toContain('E_FOCUS_CHANGED');
    const refusedFill = await call('vb_type', { selector: '#focus-trap', text: 'forbidden' });
    expect(refusedFill.ok).toBe(false);
    expect(refusedFill.content).toContain('E_FOCUS_CHANGED');
    expect(change(await call('vb_press', { selector: '#key-field', key: 'Control+A' })).changed).toBe(false);
    expect(change(await call('vb_press', { selector: '#key-field', key: 'Backspace' }))).toMatchObject({ before: { value: 'Alpha' }, after: { value: '' }, changed: true });
    const typed=await call('vb_type', { selector: '#person', text: 'Alpha', clear: false });
    expect(change(typed)).toMatchObject({ before: { value: 'First' }, after: { value: 'Alpha' }, changed: true });
    expect(typed.data).toMatchObject({observation:{scope:'session-window',businessOutcome:'unknown'}});
    expect((typed.data as {observation:{sinceCursor:string}}).observation.sinceCursor).toBeTruthy();
    for (const [name,args] of [
      ['vb_select',{selector:'#plan',label:'Pro'}],
      ['vb_select_values',{selector:'#tags',values:['blue']}],
      ['vb_check',{selector:'#terms',checked:false}],
      ['vb_append',{selector:'#person',text:''}],
      ['vb_press',{selector:'#person',key:'End'}],
    ] as const) {
      const observed=await call(name,args);
      expect(observed.ok,observed.content).toBe(true);
      expect((observed.data as {observation:{sinceCursor:string}}).observation.sinceCursor).toMatch(/:\d+$/);
    }
    expect(change(await call('vb_append', { selector: '#person', text: ' 汉字' })).after?.value).toBe('Alpha 汉字');
    expect(change(await call('vb_select', { selector: '#plan', label: 'Pro' })).after?.value).toBe('pro');
    expect(change(await call('vb_select_values', { selector: '#plan', values: ['pro'] })).changed).toBe(false);
    expect(change(await call('vb_select_values', { selector: '#tags', values: ['blue', 'green'] })).after?.selectedValues).toEqual(['blue', 'green']);
    expect(change(await call('vb_select_values', { selector: '#tags', values: [] })).after?.selectedValues).toEqual([]);
    expect(change(await call('vb_select_values', { selector: '#tags', values: ['blue', 'green'] })).changed).toBe(true);
    expect(change(await call('vb_select_values', { selector: '#collision', values: ['two'] }))).toMatchObject({ after: { value: 'two', selectedValues: ['two'] }, changed: true });
    expect((await call('vb_select_values', { selector: '#duplicate', values: ['same'] })).ok).toBe(false);
    expect((await call('vb_select_values', { selector: '#tags', values: ['missing'] })).ok).toBe(false);
    expect(change(await call('vb_check', { selector: '#terms', checked: true })).changed).toBe(true);
    expect(change(await call('vb_check', { selector: '#terms', checked: true })).changed).toBe(false);
    expect(change(await call('vb_check', { selector: '#shade-a', checked: true })).after?.checked).toBe(true);
    expect(change(await call('vb_check', { selector: '#shade-b', checked: true })).after?.checked).toBe(true);
    expect(change(await call('vb_check', { selector: '#shade-b', checked: true })).changed).toBe(false);
    const secret = await call('vb_type', { selector: '#secret', text: 'FORM_SECRET_DO_NOT_RETURN' });
    expect(JSON.stringify(secret)).not.toContain('FORM_SECRET_DO_NOT_RETURN');
    expect(JSON.stringify(secret)).not.toContain('OLD_FORM_SECRET');
    expect(change(secret)).toMatchObject({ after: { valueRedacted: true }, changed: 'unknown' });
    expect(change(await call('vb_type', { selector: '#replace', text: 'entered' }))).toMatchObject({ changed: 'unknown', stateUnavailable: true });
    expect((await call('vb_append', { selector: '#readonly', text: 'forbidden' })).ok).toBe(false);
    expect((await call('vb_click', { selector: '#combo' })).ok).toBe(true);
    expect((await call('vb_click', { selector: '#premium' })).ok).toBe(true);
    expect((await call('vb_click', { selector: '#submit' })).ok).toBe(true);
    expect(receipts).toEqual([]);
    expect(change(await call('vb_type', { selector: '#email', text: 'alex@example.test' })).changed).toBe(true);
    expect((await call('vb_click', { selector: '#submit' })).ok).toBe(true);
    await expect.poll(() => receipts.length).toBe(1);
    expect(Object.fromEntries(receipts[0])).toMatchObject({ person: 'Alpha 汉字', plan: 'pro', terms: 'on', shade: 'b', tier: 'premium', collision: 'two', keyField: '' });
    expect(receipts[0].getAll('tags')).toEqual(['blue', 'green']);
  } finally { if (id) await call('vb_close'); await facade?.dispose(); await client.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 40_000);

it('retains bounded form feedback when the MCP envelope is large', () => {
  const result = { ok: true, content: 'selected values', data: { fieldChange: { before: { selectedValues: Array(80).fill('a'.repeat(120)) }, after: { selectedValues: Array(80).fill('b'.repeat(120)) }, changed: true } } } as ToolResult;
  const rendered = renderToolResultForTool('vb_select_values', result);
  expect(rendered.length).toBeLessThanOrEqual(12000);
  expect(JSON.parse(rendered).data.fieldChange.changed).toBe(true);
});
