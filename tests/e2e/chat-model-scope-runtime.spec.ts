import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, resolve } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

test('turn model wins for one real Gateway request without changing the session choice', async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
  test.setTimeout(240_000);
  const models: string[] = [];
  const accounts: string[] = [];
  const llm = await startScriptedLlm((text) => ({ text: `Done ${[...text.matchAll(/SCOPE-[A-Z-]+/g)].at(-1)?.[0]}` }));
  llm.server.on('request', (request) => {
    if (!request.url?.includes('/chat/completions')) return;
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      models.push(String(JSON.parse(body).model));
      accounts.push(String(request.headers.authorization).match(/^Bearer local-scope-([abc])$/)?.[1] ?? 'unexpected');
    });
  });
  const app = await launchElectronApp({ skipSetup: true });
  const sessionKey = 'agent:main:main';
  const snapshots: unknown[] = [];
  let passed = false;
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();
    const now = new Date().toISOString();
    for (const name of ['a', 'b', 'c']) {
      await hostInvoke(app, 'providers', 'save', {
        config: { id: `scope-${name}`, name: `Scope ${name}`, type: 'custom', baseUrl: `http://127.0.0.1:${llm.port}/v1`, apiProtocol: 'openai-completions', model: `scope-${name}`, enabled: true, createdAt: now, updatedAt: now },
        apiKey: `local-scope-${name}`,
      });
    }
    await hostInvoke(app, 'providers', 'setDefault', { providerId: 'scope-a' });
    const workspace = testInfo.outputPath('workspace');
    await mkdir(workspace, { recursive: true });
    await hostInvoke(app, 'workspaces', 'create', { name: 'model-scope', rootPath: workspace, permissionMode: 'fullAccess' });
    await startGateway(app);
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
    const ref = (name: string) => `custom-scope${name}/scope-${name}`;
    const send = async (marker: string, modelRef?: string) => {
      const before = models.length;
      await hostInvoke(app, 'chat', 'sendWithMedia', { sessionKey, message: marker, idempotencyKey: marker, ...(modelRef ? { modelRef } : {}) });
      await expect.poll(async () => {
        const result = await rpc<{ messages?: unknown[] }>('chat.history', { sessionKey, limit: 20 });
        return JSON.stringify(result.messages ?? []).includes(`Done ${marker}`);
      }, { timeout: 45_000 }).toBe(true);
      expect(models.length).toBeGreaterThan(before);
      return models.at(-1);
    };
    const snapshot = async () => {
      const result = await rpc<{ sessions: Array<{ key: string; modelRefOverride?: string }> }>('sessions.list', {});
      const row = result.sessions.find((session) => session.key === sessionKey);
      snapshots.push(row);
      return row;
    };
    expect(await send('SCOPE-DEFAULT')).toBe('scope-a');
    await hostInvoke(app, 'sessions', 'patchRuntimeModel', { sessionKey, modelRef: ref('b') });
    const pinnedProfile = 'custom-scopeb:default';
    const stored = await rpc<{ path: string }>('sessions.patch', { key: sessionKey });
    expect(relative(userDataDir, stored.path).startsWith('..')).toBe(false);
    await hostInvoke(app, 'gateway', 'stop');
    // Agent-driven fixture: seed the existing user-choice enum through the
    // production store API while Gateway is stopped, then prove it survives.
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
      "import { updateSessionStore } from './src/config/sessions/store.ts'; await updateSessionStore(process.argv[1], store => { const entry = store[process.argv[2]]; entry.authProfileOverride = process.argv[3]; entry.authProfileOverrideSource = 'user'; });",
      stored.path, sessionKey, pinnedProfile,
    ], { cwd: resolve('openclaw_runtime'), env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir }, windowsHide: true, timeout: 30_000 });
    await startGateway(app);
    const authSelection = async () => {
      const state = await rpc<{ entry?: { authProfileOverride?: string; authProfileOverrideSource?: string } }>('sessions.patch', { key: sessionKey });
      return { id: state.entry?.authProfileOverride, source: state.entry?.authProfileOverrideSource };
    };
    await expect.poll(authSelection, { timeout: 30_000 }).toEqual({ id: pinnedProfile, source: 'user' });
    expect(await send('SCOPE-TURN-OVER-SESSION', ref('c'))).toBe('scope-c');
    expect((await snapshot())?.modelRefOverride).toBe(ref('b'));
    expect(await authSelection()).toEqual({ id: pinnedProfile, source: 'user' });
    expect(await send('SCOPE-SESSION')).toBe('scope-b');
    await hostInvoke(app, 'sessions', 'patchRuntimeModel', { sessionKey, modelRef: null });
    expect(await send('SCOPE-TURN-OVER-DEFAULT', ref('c'))).toBe('scope-c');
    expect((await snapshot())?.modelRefOverride).toBeUndefined();
    expect(await send('SCOPE-DEFAULT-AGAIN')).toBe('scope-a');
    expect(models).toEqual(['scope-a', 'scope-c', 'scope-b', 'scope-c', 'scope-a']);
    expect(accounts).toEqual(['a', 'c', 'b', 'c', 'a']);
    passed = true;
  } finally {
    await writeFile(testInfo.outputPath('model-scope-runtime.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-model-scope', provider: 'local-scripted', paidProviderCalls: 0, passed, models, accounts, snapshots }, null, 2));
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
