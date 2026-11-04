import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/electron';

test('real embedded browser preserves actions, denials and unsupported outcomes', async ({ page, electronApp }, testInfo) => {
  let privateHits = 0;
  const privateServer = createServer((_request, response) => { privateHits += 1; response.end('unapproved private data'); });
  await new Promise<void>((resolve) => privateServer.listen(0, '127.0.0.1', resolve));
  const privateAddress = privateServer.address();
  if (!privateAddress || typeof privateAddress === 'string') throw new Error('Private fixture did not bind');
  const privateUrl = `http://127.0.0.1:${privateAddress.port}/private`;
  const server = createServer((request, response) => {
    if (request.url === '/redirect-denied') {
      response.writeHead(302, { location: privateUrl }); response.end(); return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>VerseBrowser integration fixture</title>
      <h1>Agent-driven browser proof</h1><img src="${privateUrl}" alt="Optional blocked resource"><iframe src="${privateUrl}"></iframe><input id="name" aria-label="Name">
      <button id="submit" onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value">Save</button>
      <p id="result">Not saved</p>`);
  });
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', () => socket.end()); socket.on('error', () => socket.destroy());
    const timer = setTimeout(() => socket.destroy(), 5_000);
    socket.once('close', () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  const calls: Array<{ action: string; response: unknown }> = [];
  const invoke = async (action: string, payload?: Record<string, unknown>) => {
    const response = await page.evaluate(async ({ action, payload }) => {
      return await window.verseClaw!.hostInvoke({
        id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}),
      });
    }, { action, payload });
    calls.push({ action, response });
    return response;
  };
  let sessionId: string | undefined;
  try {
    await page.waitForFunction(() => Boolean(window.verseClaw?.hostInvoke));
    const baselineWindows = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect((await invoke('setEnabled', { enabled: true })).ok).toBe(true);
    const origin = `http://127.0.0.1:${address.port}`;
    const denied = await invoke('open', {
      url: `${origin}/`, mode: 'headless',
      profile: `agent-hygiene-denied-${Date.now()}`, sessionKey: 'agent:main:versebrowser-hygiene-denied',
    });
    expect(denied.ok, JSON.stringify(denied)).toBe(false);
    expect(JSON.stringify(denied)).toContain('private-network-default-deny');
    const forged = await invoke('open', {
      url: `${origin}/`, mode: 'headless', sessionKey: 'agent:main:versebrowser-hygiene',
      privateNetworkApprovedBy: 'agent', privateNetworkOrigin: origin,
    });
    expect(forged.ok, JSON.stringify(forged)).toBe(false);
    const embeddedPrivate = await invoke('open', {
      url: `http://[::ffff:0:127.0.0.1]:${address.port}/`, mode: 'headless',
      sessionKey: 'agent:main:embedded-private-negative',
    });
    expect(embeddedPrivate.ok, JSON.stringify(embeddedPrivate)).toBe(false);
    expect(JSON.stringify(embeddedPrivate)).toContain('private-network-default-deny');
    const approval = await electronApp.evaluate((_electron, input) => {
      const modules = process.mainModule!.require('node:module')._cache;
      const entry = Object.keys(modules).find((key) => typeof modules[key].exports?.approveBrowserPrivateNetwork === 'function');
      if (!entry) throw new Error('Main private-network approval owner is unavailable');
      return modules[entry].exports.approveBrowserPrivateNetwork(input);
    }, { sessionId: 'agent:main:versebrowser-hygiene', origin });
    calls.push({ action: 'main-private-network-approval', response: approval });
    const opened = await invoke('open', {
      url: `${origin}/`, mode: 'headless',
      profile: `agent-hygiene-${Date.now()}`, sessionKey: 'agent:main:versebrowser-hygiene',
    });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    if (!opened.ok) throw new Error('Open failed');
    sessionId = (opened.data as { session: { id: string } }).session.id;
    expect((await invoke('takeSnapshot', { sessionId })).ok).toBe(false);
    const upgrade = await invoke('requestModeUpgrade', { sessionId, targetMode: 'full_access', userApproval: true });
    expect(upgrade.ok, JSON.stringify(upgrade)).toBe(true);
    expect((await invoke('type', { sessionId, selector: '#name', text: 'Agent proof', clear: true })).ok).toBe(true);
    expect((await invoke('click', { sessionId, selector: '#submit' })).ok).toBe(true);
    const snapshot = await invoke('takeSnapshot', { sessionId });
    expect(snapshot.ok, JSON.stringify(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).toContain('Saved Agent proof');
    const websocket = await invoke('evaluate', { sessionId, expression: `new Promise(resolve => { const socket = new WebSocket(${JSON.stringify(origin.replace('http:', 'ws:') + '/socket')}); socket.onopen = () => { resolve('websocket-open'); socket.close(); }; socket.onerror = () => resolve('websocket-failed'); })` });
    expect(JSON.stringify(websocket)).toContain('websocket-open');

    const fetched = await invoke('evaluate', { sessionId, expression: `fetch(${JSON.stringify(privateUrl)}).then(() => 'unexpected').catch(() => 'request-blocked')` });
    expect(fetched.ok, JSON.stringify(fetched)).toBe(true);
    expect(JSON.stringify(fetched)).toContain('request-blocked');
    const image = await invoke('evaluate', { sessionId, expression: `new Promise(resolve => { const image = new Image(); image.onload = () => resolve('unexpected'); image.onerror = () => resolve('image-blocked'); image.src = ${JSON.stringify(privateUrl)}; document.body.appendChild(image); })` });
    expect(JSON.stringify(image)).toContain('image-blocked');
    const redirected = await invoke('navigate', { sessionId, url: `${origin}/redirect-denied` });
    expect(redirected.ok).toBe(false);
    expect(privateHits).toBe(0);
    calls.push({ action: 'private-request-count', response: { privateHits } });
    expect((await invoke('navigate', { sessionId, url: `${origin}/` })).ok).toBe(true);
    const extraUrl = `${origin}/extra`;
    expect((await invoke('newPage', { sessionId, url: extraUrl })).ok).toBe(true);
    await electronApp.evaluate(({ BrowserWindow }, url) => {
      const extra = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
      if (!extra) throw new Error('Owned extra tab was not found');
      extra.destroy();
    }, extraUrl);
    const remainingPages = await invoke('listPages', { sessionId });
    expect(remainingPages).toMatchObject({ ok: true, data: { activePageId: '0' } });
    expect((await invoke('takeSnapshot', { sessionId })).ok).toBe(true);
    expect((await invoke('evaluate', { sessionId, expression: 'window.onbeforeunload = () => false; true' })).ok).toBe(true);

    // A declared facade wrapper is NOT a supported driver capability: Main's capability gate
    // rejects it before any browser effect (N3), carrying the driver's own refusal as detail.
    const forms = await invoke('readForms', { sessionId });
    expect(forms.ok, JSON.stringify(forms)).toBe(false);
    expect(forms).toMatchObject({ error: { code: 'UNSUPPORTED' } });
    expect(JSON.stringify(forms)).toContain('readForms');
    expect((await invoke('fullAccessRevoke', { sessionId })).ok).toBe(true);
    expect((await invoke('takeSnapshot', { sessionId })).ok).toBe(false);
    expect((await invoke('close', { sessionId })).ok).toBe(true);
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(baselineWindows);
    const status = await invoke('status');
    expect(JSON.stringify(status)).not.toContain(sessionId);
    sessionId = undefined;
  } finally {
    if (sessionId) await invoke('close', { sessionId }).catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => privateServer.close((error) => error ? reject(error) : resolve()));
    const receipt = { driven_by: 'agent', actor: 'playwright-runner', scope: 'real renderer to Main to embedded Electron; local private-network negatives; no model or Gateway', calls };
    await writeFile(testInfo.outputPath('host-invocation.json'), JSON.stringify(receipt, null, 2));
    await electronApp.close();
  }
});
