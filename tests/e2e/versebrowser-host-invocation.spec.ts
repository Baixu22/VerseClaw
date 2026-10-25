import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/electron';

test('real embedded browser preserves actions, denials and unsupported outcomes', async ({ page }, testInfo) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>VerseBrowser integration fixture</title>
      <h1>Agent-driven browser proof</h1><input id="name" aria-label="Name">
      <button id="submit" onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value">Save</button>
      <p id="result">Not saved</p>`);
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
    expect((await invoke('setEnabled', { enabled: true })).ok).toBe(true);
    const origin = `http://127.0.0.1:${address.port}`;
    const denied = await invoke('open', {
      url: `${origin}/`, mode: 'headless',
      profile: `agent-hygiene-denied-${Date.now()}`, sessionKey: 'agent:main:versebrowser-hygiene-denied',
    });
    expect(denied.ok, JSON.stringify(denied)).toBe(false);
    expect(JSON.stringify(denied)).toContain('private-network-default-deny');
    const opened = await invoke('open', {
      url: `${origin}/`, mode: 'headless',
      profile: `agent-hygiene-${Date.now()}`, sessionKey: 'agent:main:versebrowser-hygiene',
      privateNetworkApprovedBy: 'agent', privateNetworkOrigin: origin,
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

    // A declared facade wrapper is NOT a supported driver capability: Main's capability gate
    // rejects it before any browser effect (N3), carrying the driver's own refusal as detail.
    const forms = await invoke('readForms', { sessionId });
    expect(forms.ok, JSON.stringify(forms)).toBe(false);
    expect(forms).toMatchObject({ error: { code: 'UNSUPPORTED' } });
    expect(JSON.stringify(forms)).toContain('readForms');
    expect((await invoke('fullAccessRevoke', { sessionId })).ok).toBe(true);
    expect((await invoke('takeSnapshot', { sessionId })).ok).toBe(false);
    expect((await invoke('close', { sessionId })).ok).toBe(true);
    const status = await invoke('status');
    expect(JSON.stringify(status)).not.toContain(sessionId);
    sessionId = undefined;
  } finally {
    if (sessionId) await invoke('close', { sessionId }).catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const receipt = { driven_by: 'agent', actor: 'playwright-runner', scope: 'real renderer to Main to embedded Electron driver; no model or Gateway', calls };
    await writeFile(testInfo.outputPath('host-invocation.json'), JSON.stringify(receipt, null, 2));
  }
});
